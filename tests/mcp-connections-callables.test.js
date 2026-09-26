'use strict';

/**
 * The mcpListConnections / mcpRevokeConnection callables (phase 1i, #356)
 * against the Firestore emulator via firebase-functions-test — the production
 * wiring from functions/index.js through the Firestore OAuth store.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest mcp-connections-callables --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = 'demo-mcp-connections';
process.env.MCP_JWT_SECRET = 'test-signing-secret-mcp-connections-callables';

const functionsTest = require('firebase-functions-test')(
  { projectId: 'demo-mcp-connections' },
  null
);
// Requiring functions/index.js triggers its single initializeApp() call.
const { mcpListConnections, mcpRevokeConnection } = require('../functions/index');
const path = require('path');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [path.resolve(__dirname, '../functions')] })
);

const db = getFirestore();
const GRANTS = 'mcp_oauth_grants';
const g = (n) => String(n).padStart(32, 'b');
const auth = (uid) => ({ uid, token: { apps: ['scriptorium'] } });

beforeEach(async () => {
  await db.recursiveDelete(db.collection(GRANTS));
  await db.recursiveDelete(db.collection('mcp_oauth_tokens'));
  await db.recursiveDelete(db.collection('mcp_audit'));
  const now = Date.now();
  const grants = [
    {
      grantId: g(1),
      uid: 'alice',
      appId: 'scriptorium',
      clientName: 'Claude',
      revoked: false,
      createdAtMs: now - 1000,
      lastUsedAtMs: now,
      expiresAtMs: now + 86400000,
    },
    {
      grantId: g(2),
      uid: 'alice',
      appId: 'scriptorium',
      clientName: 'Revoked',
      revoked: true,
      createdAtMs: now,
    },
    {
      grantId: g(3),
      uid: 'bob',
      appId: 'scriptorium',
      clientName: 'Bob',
      revoked: false,
      createdAtMs: now,
      expiresAtMs: now + 86400000,
    },
  ];
  await Promise.all(grants.map((grant) => db.collection(GRANTS).doc(grant.grantId).set(grant)));
  await db
    .collection('mcp_oauth_tokens')
    .doc('fs-h1')
    .set({ tokenHash: 'fs-h1', familyId: g(1), revoked: false });
});

afterAll(async () => {
  await db.recursiveDelete(db.collection(GRANTS));
  await db.recursiveDelete(db.collection('mcp_oauth_tokens'));
  await db.recursiveDelete(db.collection('mcp_audit'));
  functionsTest.cleanup();
});

test('mcpListConnections returns the caller’s active connections from Firestore', async () => {
  const result = await mcpListConnections.run({ data: {}, auth: auth('alice') });
  expect(result.connections).toEqual([
    expect.objectContaining({ grantId: g(1), clientName: 'Claude', appId: 'scriptorium' }),
  ]);
});

test('mcpRevokeConnection revokes the grant and its refresh family, then it drops off the list', async () => {
  await expect(
    mcpRevokeConnection.run({ data: { grantId: g(1) }, auth: auth('alice') })
  ).resolves.toEqual({ revoked: true, grantId: g(1) });
  const grant = (await db.collection(GRANTS).doc(g(1)).get()).data();
  expect(grant).toMatchObject({ revoked: true, revokedReason: 'user_request' });
  expect((await db.collection('mcp_oauth_tokens').doc('fs-h1').get()).data().revoked).toBe(true);
  expect((await mcpListConnections.run({ data: {}, auth: auth('alice') })).connections).toEqual([]);

  const events = (await db.collection('mcp_audit').get()).docs.map((d) => d.data());
  expect(events).toEqual([
    expect.objectContaining({ event: 'grant_revoked', reason: 'user_request', uid: 'alice' }),
  ]);
});

test('a user cannot revoke someone else’s connection', async () => {
  await expect(
    mcpRevokeConnection.run({ data: { grantId: g(3) }, auth: auth('alice') })
  ).rejects.toMatchObject({ code: 'not-found' });
  expect((await db.collection(GRANTS).doc(g(3)).get()).data().revoked).toBe(false);
});

test('both callables require sign-in', async () => {
  await expect(mcpListConnections.run({ data: {} })).rejects.toMatchObject({
    code: 'unauthenticated',
  });
  await expect(mcpRevokeConnection.run({ data: { grantId: g(1) } })).rejects.toMatchObject({
    code: 'unauthenticated',
  });
});
