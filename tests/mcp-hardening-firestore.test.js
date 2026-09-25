'use strict';

/**
 * Phase 1h (#355) Firestore implementations against the emulator: grants and
 * client TTLs in the OAuth store, the audit log, the rate-limit counters, and
 * one full register → authorize → token → refresh → revoke flow on real
 * Firestore transactions.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest mcp-hardening-firestore --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.MCP_JWT_SECRET = 'test-signing-secret-mcp-hardening';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const path = require('path');
const crypto = require('crypto');

// The functions package's firebase-admin (the one the modules under test use).
const functionsDir = path.resolve(__dirname, '../functions');
const { initializeApp } = require(require.resolve('firebase-admin/app', { paths: [functionsDir] }));
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);

const { createFirestoreStore } = require('../functions/mcp/oauth/store');
const { createFirestoreAuditLog, AUDIT_COLLECTION } = require('../functions/mcp/audit');
const {
  createFirestoreRateLimiter,
  RATE_LIMIT_COLLECTION,
} = require('../functions/mcp/rate-limit');
const { createRegisterHandler } = require('../functions/mcp/oauth/register');
const { createAuthorizeHandler } = require('../functions/mcp/oauth/authorize');
const { createTokenHandler } = require('../functions/mcp/oauth/token');
const { createRevokeHandler } = require('../functions/mcp/oauth/revoke');
const { verifyAccessToken, hashRefreshToken } = require('../functions/mcp/oauth/tokens');
const { base64UrlSha256 } = require('../functions/mcp/oauth/pkce');

const adminApp = initializeApp({ projectId: 'demo-mcp-hardening-test' }, 'mcp-hardening-test');
const db = getFirestore(adminApp);
const store = createFirestoreStore(db);

const COLLECTIONS = [
  'mcp_oauth_clients',
  'mcp_oauth_codes',
  'mcp_oauth_tokens',
  'mcp_oauth_grants',
  AUDIT_COLLECTION,
  RATE_LIMIT_COLLECTION,
];

beforeEach(async () => {
  await Promise.all(COLLECTIONS.map((c) => db.recursiveDelete(db.collection(c))));
});

afterAll(async () => {
  await Promise.all(COLLECTIONS.map((c) => db.recursiveDelete(db.collection(c))));
  await db.terminate();
});

const doc = async (collection, id) => (await db.collection(collection).doc(id).get()).data();

function mockRes() {
  const r = { statusCode: 200, headers: {} };
  r.set = (k, v) => ((r.headers[k.toLowerCase()] = v), r);
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (o) => ((r.body = o), r);
  r.send = (s) => ((r.html = s), r);
  r.get = (k) => r.headers[k.toLowerCase()];
  return r;
}

describe('OAuth store: grants and client TTL (Firestore)', () => {
  test('grants round-trip with an expireAt Timestamp', async () => {
    const t0 = Date.parse('2026-09-25T12:00:00Z');
    await store.putGrant({
      grantId: 'g1',
      uid: 'u1',
      appId: 'scriptorium',
      revoked: false,
      expiresAtMs: t0,
    });
    const grant = await store.getGrant('g1');
    expect(grant).toMatchObject({ grantId: 'g1', uid: 'u1', revoked: false });
    expect(grant.expireAt.toMillis()).toBe(t0);
    expect(await store.getGrant('missing')).toBeNull();
  });

  test('touchGrant records use and extends expiry without clobbering the grant', async () => {
    await store.putGrant({
      grantId: 'g2',
      uid: 'u1',
      appId: 'scriptorium',
      revoked: false,
      expiresAtMs: 1000,
    });
    await store.touchGrant('g2', 5000, 99_000);
    const grant = await store.getGrant('g2');
    expect(grant).toMatchObject({ uid: 'u1', lastUsedAtMs: 5000, expiresAtMs: 99_000 });
    expect(grant.expireAt.toMillis()).toBe(99_000);
  });

  test('revokeGrant marks the grant and kills its refresh family; idempotent', async () => {
    await store.putGrant({ grantId: 'g3', uid: 'u1', appId: 'scriptorium', revoked: false });
    for (const hash of ['h1', 'h2']) {
      await store.putRefreshToken({
        tokenHash: hash,
        familyId: 'g3',
        revoked: false,
        expiresAtMs: Date.now() + 60_000,
      });
    }
    await store.putRefreshToken({ tokenHash: 'other', familyId: 'g9', revoked: false });

    const before = await store.revokeGrant('g3', 'client_request', 1234);
    expect(before.revoked).toBe(false);
    expect(await store.getGrant('g3')).toMatchObject({
      revoked: true,
      revokedAtMs: 1234,
      revokedReason: 'client_request',
    });
    expect((await doc('mcp_oauth_tokens', 'h1')).revoked).toBe(true);
    expect((await doc('mcp_oauth_tokens', 'h2')).revoked).toBe(true);
    expect((await doc('mcp_oauth_tokens', 'other')).revoked).toBe(false);

    const again = await store.revokeGrant('g3', 'reuse', 9999);
    expect(again.revoked).toBe(true);
    expect((await store.getGrant('g3')).revokedReason).toBe('client_request');
  });

  test('clients get an expireAt on registration, extended by touchClient', async () => {
    await store.putClient({
      clientId: 'c1',
      clientName: 'Claude',
      redirectUris: ['https://x/cb'],
      expiresAtMs: 1000,
    });
    expect((await doc('mcp_oauth_clients', 'c1')).expireAt.toMillis()).toBe(1000);
    await store.touchClient('c1', 50_000);
    const client = await doc('mcp_oauth_clients', 'c1');
    expect(client).toMatchObject({ clientName: 'Claude', redirectUris: ['https://x/cb'] });
    expect(client.expireAt.toMillis()).toBe(50_000);
  });
});

describe('audit log (Firestore)', () => {
  test('writes whitelisted fields with a 90-day expireAt', async () => {
    const atMs = Date.parse('2026-09-25T12:00:00Z');
    const audit = createFirestoreAuditLog(() => db, { now: () => atMs });
    await audit.record('tool_call', {
      uid: 'u1',
      appId: 'scriptorium',
      tool: 'create_note',
      outcome: 'ok',
      durationMs: 12,
      args: { title: 'secret' },
      accessToken: 'eyJ...',
    });
    const snap = await db.collection(AUDIT_COLLECTION).get();
    expect(snap.size).toBe(1);
    const entry = snap.docs[0].data();
    expect(entry).toMatchObject({
      event: 'tool_call',
      uid: 'u1',
      tool: 'create_note',
      outcome: 'ok',
    });
    expect(entry).not.toHaveProperty('args');
    expect(entry).not.toHaveProperty('accessToken');
    expect(entry.at.toMillis()).toBe(atMs);
    expect(entry.expireAt.toMillis()).toBe(atMs + 90 * 86400 * 1000);
  });
});

describe('rate limiter (Firestore)', () => {
  const limits = { tool_call: { limit: 3, windowMs: 60_000 } };

  test('counts across calls, refuses past the budget, and separates keys', async () => {
    const limiter = createFirestoreRateLimiter(() => db, { limits, now: () => 120_000 });
    const results = [];
    for (let i = 0; i < 4; i += 1)
      results.push(await limiter.consume('tool_call', 'u1:scriptorium'));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].retryAfterSec).toBe(60);
    expect((await limiter.consume('tool_call', 'u2:scriptorium')).allowed).toBe(true);
  });

  test('concurrent requests are all counted (transactional increments)', async () => {
    const limiter = createFirestoreRateLimiter(() => db, {
      limits: { tool_call: { limit: 5, windowMs: 60_000 } },
      now: () => 240_000,
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => limiter.consume('tool_call', 'burst'))
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  test('counter docs store hashed keys and expire after their window', async () => {
    const limiter = createFirestoreRateLimiter(() => db, { limits, now: () => 360_000 });
    await limiter.consume('tool_call', '203.0.113.9');
    const snap = await db.collection(RATE_LIMIT_COLLECTION).get();
    expect(snap.size).toBe(1);
    expect(snap.docs[0].id).not.toContain('203.0.113.9');
    expect(snap.docs[0].data().expireAt.toMillis()).toBe(420_000 + 3600 * 1000);
  });
});

describe('full flow on Firestore: register → authorize → token → refresh → revoke', () => {
  test('revocation takes effect on the refresh chain and the grant', async () => {
    const CANONICAL = 'https://bcoletech.com';
    const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
    const audit = createFirestoreAuditLog(() => db);
    const deps = { store, audit };
    const register = createRegisterHandler(deps);
    const authorize = createAuthorizeHandler({
      ...deps,
      verifyIdToken: async () => ({ uid: 'uid-fs', apps: ['scriptorium'] }),
      isKnownApp: (appId) => appId === 'scriptorium',
    });
    const token = createTokenHandler({ ...deps, getEntitlements: async () => ['scriptorium'] });
    const revoke = createRevokeHandler(deps);
    const headers = { host: 'bcoletech.com' };

    const reg = mockRes();
    await register(
      { method: 'POST', headers, body: { client_name: 'Claude', redirect_uris: [REDIRECT] } },
      reg
    );
    const clientId = reg.body.client_id;

    const verifier = crypto.randomBytes(40).toString('base64url');
    const approval = mockRes();
    await authorize(
      {
        method: 'POST',
        headers,
        body: {
          client_id: clientId,
          redirect_uri: REDIRECT,
          scope: 'mcp:scriptorium',
          code_challenge: base64UrlSha256(verifier),
          code_challenge_method: 'S256',
          idToken: 'ok',
        },
      },
      approval
    );
    const code = new URL(approval.body.redirect).searchParams.get('code');

    const issued = mockRes();
    await token(
      {
        method: 'POST',
        headers,
        body: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT,
          client_id: clientId,
          code_verifier: verifier,
        },
      },
      issued
    );
    expect(issued.statusCode).toBe(200);
    const { gid } = verifyAccessToken(issued.body.access_token, {
      audience: `${CANONICAL}/mcp/scriptorium`,
    });
    expect(await store.getGrant(gid)).toMatchObject({
      uid: 'uid-fs',
      clientName: 'Claude',
      revoked: false,
    });

    const refreshed = mockRes();
    await token(
      {
        method: 'POST',
        headers,
        body: {
          grant_type: 'refresh_token',
          refresh_token: issued.body.refresh_token,
          client_id: clientId,
        },
      },
      refreshed
    );
    expect(refreshed.statusCode).toBe(200);

    const revoked = mockRes();
    await revoke(
      {
        method: 'POST',
        headers,
        body: { token: refreshed.body.refresh_token, client_id: clientId },
      },
      revoked
    );
    expect(revoked.statusCode).toBe(200);
    expect((await store.getGrant(gid)).revoked).toBe(true);
    expect(
      (await doc('mcp_oauth_tokens', hashRefreshToken(refreshed.body.refresh_token))).revoked
    ).toBe(true);

    const events = (await db.collection(AUDIT_COLLECTION).orderBy('atMs').get()).docs.map(
      (d) => d.data().event
    );
    expect(events).toEqual([
      'client_registered',
      'authorization_granted',
      'token_issued',
      'token_refreshed',
      'grant_revoked',
    ]);
  });
});
