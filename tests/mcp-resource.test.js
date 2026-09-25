'use strict';

/**
 * Integration tests for per-app MCP resource servers (phase 1e, #352):
 * the §8 registry seam, /mcp/<appId> mounting, audience-bound token validation
 * (RFC 8707), the hasApp gate, and the authenticated ctx handed to handlers.
 *
 * A real MCP SDK client talks Streamable HTTP to handleAppRequest behind an
 * express server (the same req/res stack Cloud Functions uses). No emulator
 * or Firestore needed.
 *
 * Run: cd tests && npx jest mcp-resource --verbose
 */

// Signing secret must be resolvable before requiring the token modules.
process.env.MCP_JWT_SECRET = 'test-signing-secret-mcp-resource';
// Production "pinned origin" mode: audience/issuer are the canonical origin,
// never the test server's Host header.
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const express = require('express');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createRegistry, ToolError } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { protectedResourceMetadata } = require('../functions/mcp/discovery');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');
const { createInMemoryAuditLog } = require('../functions/mcp/audit');
const { createInMemoryRateLimiter } = require('../functions/mcp/rate-limit');

const CANONICAL = 'https://bcoletech.com';
const SECRET = process.env.MCP_JWT_SECRET;

// Grants live in an in-memory OAuth store; the audit log and rate limiter are
// swappable per test through `services`.
const oauthStore = createInMemoryStore();
const services = { audit: createInMemoryAuditLog(), rateLimiter: undefined };

const registry = createRegistry();
registry.registerApp('alpha', {
  tools: [
    {
      name: 'whoami',
      description: 'Returns the authenticated caller.',
      handler: async (ctx) => ({ uid: ctx.uid, appId: ctx.appId, scope: ctx.claims.scope }),
    },
    {
      name: 'echo',
      description: 'Echoes short text.',
      inputSchema: { text: z.string().max(10) },
      handler: async (ctx, { text }) => `echo:${text}`,
    },
    {
      name: 'reject',
      description: 'Fails with a user-facing message.',
      handler: async () => {
        throw new ToolError('Note not found.');
      },
    },
    {
      name: 'boom',
      description: 'Fails unexpectedly.',
      handler: async () => {
        throw new Error('firestore: PERMISSION_DENIED on projects/x/secret/path');
      },
    },
  ],
  resources: [
    {
      name: 'status',
      uri: 'alpha://status',
      read: async (ctx) => ({ owner: ctx.uid }),
    },
  ],
});
registry.registerApp('beta', {
  tools: [{ name: 'beta_only', description: 'Only on beta.', handler: async () => 'beta' }],
});

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.all('/mcp/:appId', (req, res) =>
    handleAppRequest(req, res, {
      registry,
      appId: req.params.appId,
      getGrant: (grantId) => oauthStore.getGrant(grantId),
      audit: services.audit,
      rateLimiter: services.rateLimiter,
    })
  );
  app.get('/.well-known/oauth-protected-resource/*', (req, res) =>
    protectedResourceMetadata(req, res, registry)
  );
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

// Creates an active grant for (uid, appId) and signs a token referencing it.
// Synchronous (seeds the in-memory map directly) so tokens can be minted in
// test.each tables.
let grantSeq = 0;
function grantFor(appId, uid = 'uid-alice') {
  grantSeq += 1;
  const grantId = `grant${grantSeq}`;
  oauthStore._debug.grants.set(grantId, { grantId, uid, appId, revoked: false });
  return grantId;
}

function tokenFor(appId, { uid = 'uid-alice', scope = `mcp:${appId}`, grantId } = {}) {
  return signAccessToken({
    uid,
    audience: `${CANONICAL}/mcp/${appId}`,
    scope,
    issuer: CANONICAL,
    grantId: grantId || grantFor(appId, uid),
  });
}

async function connect(appId, token) {
  const client = new Client({ name: 'mcp-resource-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp/${appId}`), {
    requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
  await client.connect(transport);
  return client;
}

// A bare MCP initialize POST, for asserting status codes and challenge headers.
function rawInitialize(appId, token) {
  return fetch(`${base}/mcp/${appId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'raw', version: '0' },
      },
    }),
  });
}

describe('per-app MCP endpoint — authorized access', () => {
  let client;
  beforeAll(async () => {
    client = await connect('alpha', tokenFor('alpha'));
  });
  afterAll(() => client.close());

  test("a valid token connects and lists only that app's tools", async () => {
    expect(client.getServerVersion().name).toBe('olympus-alpha');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['boom', 'echo', 'reject', 'whoami']);
  });

  test('handlers receive the authenticated ctx from the verified token', async () => {
    const result = await client.callTool({ name: 'whoami', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      uid: 'uid-alice',
      appId: 'alpha',
      scope: 'mcp:alpha',
    });
  });

  test('input schemas are enforced before the handler runs', async () => {
    const ok = await client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    expect(ok.content[0].text).toBe('echo:hi');
    const tooLong = await client.callTool({ name: 'echo', arguments: { text: 'x'.repeat(11) } });
    expect(tooLong.isError).toBe(true);
  });

  test('ToolError messages reach the client', async () => {
    const result = await client.callTool({ name: 'reject', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Note not found.');
  });

  test('unexpected errors are logged, not leaked to the client', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await client.callTool({ name: 'boom', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Internal error.');
    expect(JSON.stringify(result)).not.toMatch(/PERMISSION_DENIED|secret/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('resources are listed and read with the authenticated ctx', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(['alpha://status']);
    const read = await client.readResource({ uri: 'alpha://status' });
    expect(JSON.parse(read.contents[0].text)).toEqual({ owner: 'uid-alice' });
  });
});

describe('per-app MCP endpoint — token and access enforcement', () => {
  test('exit criterion: a token minted for app A is rejected by app B', async () => {
    const res = await rawInitialize('beta', tokenFor('alpha'));
    expect(res.status).toBe(401);
    const header = res.headers.get('www-authenticate');
    expect(header).toMatch(/error="invalid_token"/);
    expect(header).toMatch(
      `resource_metadata="${CANONICAL}/.well-known/oauth-protected-resource/mcp/beta"`
    );
    await expect(connect('beta', tokenFor('alpha'))).rejects.toThrow();
  });

  test('the matching token works at app B, and sees only B’s tools', async () => {
    const client = await connect('beta', tokenFor('beta'));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['beta_only']);
    await client.close();
  });

  test('no token → 401 challenge that points at discovery, without an error code', async () => {
    const res = await rawInitialize('alpha');
    expect(res.status).toBe(401);
    const header = res.headers.get('www-authenticate');
    expect(header).toMatch(
      `resource_metadata="${CANONICAL}/.well-known/oauth-protected-resource/mcp/alpha"`
    );
    expect(header).not.toMatch(/error/);
  });

  test.each([
    [
      'expired',
      jwt.sign({ scope: 'mcp:alpha', exp: Math.floor(Date.now() / 1000) - 60 }, SECRET, {
        algorithm: 'HS256',
        issuer: CANONICAL,
        subject: 'uid-alice',
        audience: `${CANONICAL}/mcp/alpha`,
      }),
    ],
    [
      'signed with another key',
      jwt.sign({ scope: 'mcp:alpha' }, 'not-the-secret', {
        algorithm: 'HS256',
        issuer: CANONICAL,
        subject: 'uid-alice',
        audience: `${CANONICAL}/mcp/alpha`,
        expiresIn: 300,
      }),
    ],
    [
      'from another issuer',
      jwt.sign({ scope: 'mcp:alpha' }, SECRET, {
        algorithm: 'HS256',
        issuer: 'https://evil.example',
        subject: 'uid-alice',
        audience: `${CANONICAL}/mcp/alpha`,
        expiresIn: 300,
      }),
    ],
    [
      'bound to a Host-header origin instead of the canonical one',
      signAccessToken({
        uid: 'uid-alice',
        audience: 'https://olympus-dfa00.web.app/mcp/alpha',
        scope: 'mcp:alpha',
        issuer: CANONICAL,
        grantId: grantFor('alpha'),
      }),
    ],
    ['not a JWT', 'opaque-garbage-token'],
  ])('a token %s → 401 invalid_token', async (_label, token) => {
    const res = await rawInitialize('alpha', token);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/error="invalid_token"/);
  });

  test('hasApp gate: right audience but no mcp:<appId> scope → 403 insufficient_scope', async () => {
    const res = await rawInitialize('alpha', tokenFor('alpha', { scope: 'mcp:beta' }));
    expect(res.status).toBe(403);
    const header = res.headers.get('www-authenticate');
    expect(header).toMatch(/error="insufficient_scope"/);
    expect(header).toMatch(/scope="mcp:alpha"/);
  });

  test('an app that is not registered → 404', async () => {
    const res = await rawInitialize('gamma', tokenFor('gamma'));
    expect(res.status).toBe(404);
  });
});

describe('transport rejection logging', () => {
  // Spy on the functions package's logger — the instance transport.js uses.
  const logger = require(
    require.resolve('firebase-functions/logger', {
      paths: [require('path').resolve(__dirname, '../functions')],
    })
  );
  let warn;
  beforeEach(() => {
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  function post(body, headers = {}) {
    return fetch(`${base}/mcp/alpha`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${tokenFor('alpha')}`,
        ...headers,
      },
      body,
    });
  }
  // res 'finish' fires just after the client sees the response.
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  test('an unsupported protocol version is logged with what identifies it', async () => {
    const res = await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), {
      'Mcp-Protocol-Version': '2099-01-01',
    });
    expect(res.status).toBe(400);
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, fields] = warn.mock.calls[0];
    expect(message).toMatch(/rejected/);
    expect(fields).toEqual({
      status: 400,
      path: '/mcp/alpha',
      httpMethod: 'POST',
      rpcMethods: ['tools/list'],
      protocolVersion: '2099-01-01',
      bodyPresent: true,
      contentType: 'application/json',
    });
  });

  test('never logs the bearer token or message contents', async () => {
    const res = await post(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { secret: 'hunter2' },
      }),
      { 'Mcp-Protocol-Version': 'not a version <script>' }
    );
    expect(res.status).toBe(400);
    await settle();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toMatch(/hunter2|Bearer|eyJ/);
    expect(warn.mock.calls[0][1].protocolVersion).toBe('<invalid>');
  });

  test('successful requests and auth failures are not logged', async () => {
    const client = await connect('alpha', tokenFor('alpha'));
    await client.listTools();
    await client.close();
    await rawInitialize('beta', tokenFor('alpha')); // 401 before the transport
    await settle();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('per-app discovery (RFC 9728)', () => {
  test('each registered app publishes its own protected-resource metadata', async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp/alpha`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resource: `${CANONICAL}/mcp/alpha`,
      authorization_servers: [CANONICAL],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp:alpha'],
    });
  });

  test('no metadata for an app that is not registered', async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp/gamma`);
    expect(res.status).toBe(404);
  });
});

describe('registry validation', () => {
  const tool = { name: 'ok', description: 'Fine.', handler: async () => 'ok' };

  test.each([
    ['an invalid appId', 'Bad App', {}],
    ['an empty appId', '', {}],
    ['a duplicate tool name', 'app-a', { tools: [tool, tool] }],
    ['a tool without a description', 'app-b', { tools: [{ ...tool, description: '' }] }],
    ['a tool without a handler', 'app-c', { tools: [{ ...tool, handler: undefined }] }],
    ['an invalid tool name', 'app-d', { tools: [{ ...tool, name: 'has space' }] }],
    ['a non-object inputSchema', 'app-e', { tools: [{ ...tool, inputSchema: 'x' }] }],
    ['a resource without read()', 'app-f', { resources: [{ name: 'r', uri: 'x://r' }] }],
  ])('rejects %s', (_label, appId, definition) => {
    expect(() => createRegistry().registerApp(appId, definition)).toThrow(/registerApp/);
  });

  test('rejects registering the same app twice', () => {
    const r = createRegistry();
    r.registerApp('once', { tools: [tool] });
    expect(() => r.registerApp('once', { tools: [tool] })).toThrow(/already registered/);
  });
});

describe('grant enforcement (phase 1h)', () => {
  test('a token without a grant id is refused — the client must refresh', async () => {
    const legacy = jwt.sign({ scope: 'mcp:alpha' }, SECRET, {
      algorithm: 'HS256',
      issuer: CANONICAL,
      subject: 'uid-alice',
      audience: `${CANONICAL}/mcp/alpha`,
      expiresIn: 300,
    });
    const res = await rawInitialize('alpha', legacy);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/error="invalid_token"/);
  });

  test('revoking the grant refuses the very next call', async () => {
    const grantId = grantFor('alpha');
    const client = await connect('alpha', tokenFor('alpha', { grantId }));
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);

    await oauthStore.revokeGrant(grantId, 'client_request', Date.now());

    await expect(client.listTools()).rejects.toThrow();
    const res = await rawInitialize('alpha', tokenFor('alpha', { grantId }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/revoked/);
    await client.close().catch(() => {});
  });

  test.each([
    ['another user', () => grantFor('alpha', 'uid-mallory')],
    ['another app', () => grantFor('beta')],
    ['no such grant', () => 'grant-does-not-exist'],
  ])('a grant belonging to %s is refused', async (_label, makeGrant) => {
    const res = await rawInitialize('alpha', tokenFor('alpha', { grantId: makeGrant() }));
    expect(res.status).toBe(401);
  });

  test('handleAppRequest refuses to run without a grant lookup', async () => {
    await expect(
      handleAppRequest({ headers: {} }, {}, { registry, appId: 'alpha' })
    ).rejects.toThrow(/getGrant/);
  });
});

describe('tool calls: rate limiting and audit (phase 1h)', () => {
  let client;
  beforeEach(async () => {
    services.audit = createInMemoryAuditLog();
    client = await connect('alpha', tokenFor('alpha', { uid: 'uid-auditor' }));
  });
  afterEach(async () => {
    services.rateLimiter = undefined;
    await client.close();
  });

  test('every tool call is audited with its outcome, never its arguments', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await client.callTool({ name: 'echo', arguments: { text: 'private' } });
    await client.callTool({ name: 'reject', arguments: {} });
    await client.callTool({ name: 'boom', arguments: {} });
    spy.mockRestore();

    const calls = services.audit.events('tool_call');
    expect(calls.map((c) => [c.tool, c.outcome])).toEqual([
      ['echo', 'ok'],
      ['reject', 'tool_error'],
      ['boom', 'internal_error'],
    ]);
    for (const c of calls) {
      expect(c).toMatchObject({ uid: 'uid-auditor', appId: 'alpha' });
      expect(typeof c.durationMs).toBe('number');
      expect(c.grantId).toMatch(/^grant/);
    }
    expect(JSON.stringify(services.audit.entries)).not.toMatch(/private/);
  });

  test('over-limit tool calls return a tool error the model can relay', async () => {
    services.rateLimiter = createInMemoryRateLimiter({
      limits: { tool_call: { limit: 2, windowMs: 60_000 } },
    });
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await client.callTool({ name: 'whoami', arguments: {} }));
    }
    expect(results.map((r) => Boolean(r.isError))).toEqual([false, false, true]);
    expect(results[2].content[0].text).toMatch(/Rate limit reached\. Try again in \d+ seconds\./);
    expect(services.audit.events('rate_limited')).toEqual([
      expect.objectContaining({ bucket: 'tool_call', uid: 'uid-auditor', appId: 'alpha' }),
    ]);
  });

  test('refused tokens are audited with a reason', async () => {
    await rawInitialize('beta', tokenFor('alpha'));
    await rawInitialize('alpha', tokenFor('alpha', { scope: 'mcp:beta' }));
    await rawInitialize('alpha', tokenFor('alpha', { grantId: 'grant-does-not-exist' }));
    expect(services.audit.events('access_rejected').map((e) => e.reason)).toEqual([
      'invalid_token',
      'insufficient_scope',
      'grant_revoked',
    ]);
  });
});
