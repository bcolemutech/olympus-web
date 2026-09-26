'use strict';

/**
 * Grand Hall connection management (phase 1i, #356): the connections service
 * behind mcpListConnections / mcpRevokeConnection, and the exit criterion —
 * a user sees their active connector, revokes it, and its next MCP call is
 * refused.
 *
 * In-memory stores only; the callables on Firestore are covered by
 * mcp-connections-callables.test.js.
 *
 * Run: cd tests && npx jest mcp-connections.test --verbose
 */

process.env.MCP_JWT_SECRET = 'test-signing-secret-mcp-connections';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const crypto = require('crypto');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createConnectionsService, requireSignedIn } = require('../functions/mcp/connections');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');
const { createInMemoryAuditLog } = require('../functions/mcp/audit');
const { createRegisterHandler } = require('../functions/mcp/oauth/register');
const { createAuthorizeHandler } = require('../functions/mcp/oauth/authorize');
const { createTokenHandler } = require('../functions/mcp/oauth/token');
const { hashRefreshToken } = require('../functions/mcp/oauth/tokens');
const { base64UrlSha256 } = require('../functions/mcp/oauth/pkce');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { scriptoriumApp } = require('../functions/mcp/apps/scriptorium');
const { createInMemoryNotesStore } = require('../functions/mcp/apps/scriptorium/store');

const NOW = Date.parse('2026-09-26T12:00:00Z');
const DAY = 86400 * 1000;
const gid = (n) => String(n).padStart(32, 'a');

function seed(store, grants) {
  for (const g of grants) store._debug.grants.set(g.grantId, g);
}

function setup() {
  const store = createInMemoryStore();
  const audit = createInMemoryAuditLog();
  const service = createConnectionsService({ store, audit, now: () => NOW });
  return { store, audit, service };
}

describe('listing connections', () => {
  test('returns only the caller’s active connections, most recently used first', async () => {
    const { store, service } = setup();
    seed(store, [
      {
        grantId: gid(1),
        uid: 'alice',
        appId: 'scriptorium',
        clientName: 'Claude',
        revoked: false,
        createdAtMs: NOW - 5 * DAY,
        lastUsedAtMs: NOW - 2 * DAY,
        expiresAtMs: NOW + DAY,
      },
      {
        grantId: gid(2),
        uid: 'alice',
        appId: 'scriptorium',
        clientName: 'MCP Inspector',
        revoked: false,
        createdAtMs: NOW - DAY,
        lastUsedAtMs: NOW - 60_000,
        expiresAtMs: NOW + DAY,
      },
      {
        grantId: gid(3),
        uid: 'alice',
        appId: 'scriptorium',
        clientName: 'Old',
        revoked: true,
        createdAtMs: NOW - DAY,
      },
      {
        grantId: gid(4),
        uid: 'alice',
        appId: 'scriptorium',
        clientName: 'Expired',
        revoked: false,
        createdAtMs: NOW - 40 * DAY,
        expiresAtMs: NOW - 1,
      },
      {
        grantId: gid(5),
        uid: 'bob',
        appId: 'scriptorium',
        clientName: 'Bob’s Claude',
        revoked: false,
        createdAtMs: NOW,
        expiresAtMs: NOW + DAY,
      },
    ]);
    const list = await service.list('alice');
    expect(list.map((c) => c.clientName)).toEqual(['MCP Inspector', 'Claude']);
    expect(list[1]).toEqual({
      grantId: gid(1),
      appId: 'scriptorium',
      clientName: 'Claude',
      connectedAt: new Date(NOW - 5 * DAY).toISOString(),
      lastUsedAt: new Date(NOW - 2 * DAY).toISOString(),
      expiresAt: new Date(NOW + DAY).toISOString(),
    });
  });

  test('never exposes uid, client id, or token internals', async () => {
    const { store, service } = setup();
    seed(store, [
      {
        grantId: gid(1),
        uid: 'alice',
        clientId: 'c-secretish',
        appId: 'scriptorium',
        audience: 'x',
        revoked: false,
        createdAtMs: NOW,
      },
    ]);
    const [c] = await service.list('alice');
    expect(Object.keys(c).sort()).toEqual(
      ['appId', 'clientName', 'connectedAt', 'expiresAt', 'grantId', 'lastUsedAt'].sort()
    );
  });

  test('fills in a missing client name from the registration (backfilled grants)', async () => {
    const { store, service } = setup();
    await store.putClient({ clientId: 'c1', clientName: 'Claude' });
    seed(store, [
      {
        grantId: gid(1),
        uid: 'alice',
        clientId: 'c1',
        appId: 'scriptorium',
        revoked: false,
        createdAtMs: NOW,
      },
    ]);
    expect((await service.list('alice'))[0].clientName).toBe('Claude');
  });

  test('an unknown client stays null rather than failing', async () => {
    const { store, service } = setup();
    seed(store, [
      {
        grantId: gid(1),
        uid: 'alice',
        clientId: 'gone',
        appId: 'scriptorium',
        revoked: false,
        createdAtMs: NOW,
      },
    ]);
    expect((await service.list('alice'))[0].clientName).toBeNull();
  });

  test('no connections → empty list', async () => {
    expect(await setup().service.list('nobody')).toEqual([]);
  });
});

describe('revoking a connection', () => {
  test('revokes the caller’s grant, its refresh family, and audits it', async () => {
    const { store, audit, service } = setup();
    seed(store, [
      { grantId: gid(1), uid: 'alice', clientId: 'c1', appId: 'scriptorium', revoked: false },
    ]);
    await store.putRefreshToken({ tokenHash: 'h1', familyId: gid(1), revoked: false });

    expect(await service.revoke('alice', gid(1))).toEqual({ revoked: true, grantId: gid(1) });
    expect(await store.getGrant(gid(1))).toMatchObject({
      revoked: true,
      revokedReason: 'user_request',
    });
    expect((await store.getRefreshToken('h1')).revoked).toBe(true);
    expect(audit.events('grant_revoked')).toEqual([
      expect.objectContaining({ grantId: gid(1), uid: 'alice', reason: 'user_request' }),
    ]);
    expect(await service.list('alice')).toEqual([]);
  });

  test('is idempotent and audits once', async () => {
    const { store, audit, service } = setup();
    seed(store, [{ grantId: gid(1), uid: 'alice', appId: 'scriptorium', revoked: false }]);
    await service.revoke('alice', gid(1));
    await expect(service.revoke('alice', gid(1))).resolves.toEqual({
      revoked: true,
      grantId: gid(1),
    });
    expect(audit.events('grant_revoked')).toHaveLength(1);
  });

  test('another user’s connection is indistinguishable from a missing one', async () => {
    const { store, service } = setup();
    seed(store, [{ grantId: gid(1), uid: 'bob', appId: 'scriptorium', revoked: false }]);
    await expect(service.revoke('alice', gid(1))).rejects.toMatchObject({ code: 'not-found' });
    await expect(service.revoke('alice', gid(9))).rejects.toMatchObject({ code: 'not-found' });
    expect((await store.getGrant(gid(1))).revoked).toBe(false);
  });

  test.each([undefined, '', 'short', `${gid(1)}/x`, 'Z'.repeat(32), 42])(
    'rejects the malformed id %p',
    async (id) => {
      await expect(setup().service.revoke('alice', id)).rejects.toMatchObject({
        code: 'invalid-argument',
      });
    }
  );

  test('requireSignedIn refuses unauthenticated calls', () => {
    expect(() => requireSignedIn({})).toThrow(expect.objectContaining({ code: 'unauthenticated' }));
    expect(requireSignedIn({ auth: { uid: 'alice' } })).toBe('alice');
  });
});

describe('exit criterion: see the connector, revoke it, next call is denied', () => {
  test('end to end with a real OAuth flow and MCP client', async () => {
    const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
    const store = createInMemoryStore();
    const audit = createInMemoryAuditLog();
    const deps = { store, audit };

    // 1. Claude connects: register → approve → token.
    const res = () => {
      const r = { statusCode: 200, headers: {} };
      r.set = (k, v) => ((r.headers[k.toLowerCase()] = v), r);
      r.status = (c) => ((r.statusCode = c), r);
      r.json = (o) => ((r.body = o), r);
      return r;
    };
    const headers = { host: 'bcoletech.com' };
    const reg = res();
    await createRegisterHandler(deps)(
      { method: 'POST', headers, body: { client_name: 'Claude', redirect_uris: [REDIRECT] } },
      reg
    );
    const verifier = crypto.randomBytes(40).toString('base64url');
    const approval = res();
    await createAuthorizeHandler({
      ...deps,
      verifyIdToken: async () => ({ uid: 'alice', apps: ['scriptorium'] }),
      isKnownApp: () => true,
    })(
      {
        method: 'POST',
        headers,
        body: {
          client_id: reg.body.client_id,
          redirect_uri: REDIRECT,
          scope: 'mcp:scriptorium',
          code_challenge: base64UrlSha256(verifier),
          code_challenge_method: 'S256',
          idToken: 'ok',
        },
      },
      approval
    );
    const tokens = res();
    await createTokenHandler({ ...deps, getEntitlements: async () => ['scriptorium'] })(
      {
        method: 'POST',
        headers,
        body: {
          grant_type: 'authorization_code',
          code: new URL(approval.body.redirect).searchParams.get('code'),
          redirect_uri: REDIRECT,
          client_id: reg.body.client_id,
          code_verifier: verifier,
        },
      },
      tokens
    );

    // 2. It works over MCP.
    const registry = createRegistry();
    registry.registerApp('scriptorium', scriptoriumApp({ store: createInMemoryNotesStore() }));
    const app = express();
    app.use(express.json());
    app.all('/mcp/:appId', (req, r) =>
      handleAppRequest(req, r, {
        registry,
        appId: req.params.appId,
        getGrant: (id) => store.getGrant(id),
        audit,
      })
    );
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const client = new Client({ name: 'claude-stand-in', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${server.address().port}/mcp/scriptorium`),
        { requestInit: { headers: { Authorization: `Bearer ${tokens.body.access_token}` } } }
      )
    );
    expect((await client.callTool({ name: 'list_notes', arguments: {} })).isError).toBeFalsy();

    // 3. The user sees it in the Grand Hall and revokes it.
    const service = createConnectionsService(deps);
    const [connection] = await service.list('alice');
    expect(connection).toMatchObject({ appId: 'scriptorium', clientName: 'Claude' });
    await service.revoke('alice', connection.grantId);

    // 4. Its next call is denied, and it cannot refresh its way back in.
    await expect(client.callTool({ name: 'list_notes', arguments: {} })).rejects.toThrow();
    const refreshed = res();
    await createTokenHandler({ ...deps, getEntitlements: async () => ['scriptorium'] })(
      {
        method: 'POST',
        headers,
        body: {
          grant_type: 'refresh_token',
          refresh_token: tokens.body.refresh_token,
          client_id: reg.body.client_id,
        },
      },
      refreshed
    );
    expect(refreshed.body.error).toBe('invalid_grant');
    expect((await store.getRefreshToken(hashRefreshToken(tokens.body.refresh_token))).revoked).toBe(
      true
    );
    expect(await service.list('alice')).toEqual([]);

    await client.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  });
});
