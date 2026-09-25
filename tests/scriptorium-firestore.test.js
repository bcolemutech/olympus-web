'use strict';

/**
 * Scriptorium's Firestore-backed notes store (phase 1f, #353) against the
 * Firestore emulator: the same contract the in-memory store honours in
 * scriptorium.test.js — owner scoping, transactional ownership checks on
 * update/delete, ordering, and ISO timestamps — plus one MCP round trip so
 * Firestore Timestamps are exercised end to end through the tools.
 *
 * Run: firebase emulators:exec --only firestore --project demo-scriptorium-test \
 *        "cd tests && npx jest scriptorium-firestore --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.MCP_JWT_SECRET = 'test-signing-secret-scriptorium-fs';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const path = require('path');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

// Use the functions package's firebase-admin (the one store.js requires) so
// Timestamp instances and the Firestore client come from the same copy.
const functionsDir = path.resolve(__dirname, '../functions');
const { initializeApp } = require(require.resolve('firebase-admin/app', { paths: [functionsDir] }));
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);

const {
  createFirestoreNotesStore,
  COLLECTION,
} = require('../functions/mcp/apps/scriptorium/store');
const { scriptoriumApp } = require('../functions/mcp/apps/scriptorium');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');

const adminApp = initializeApp(
  { projectId: 'demo-scriptorium-test' },
  'scriptorium-firestore-test'
);
const db = getFirestore(adminApp);
const store = createFirestoreNotesStore(() => db);

const T0 = Date.parse('2026-09-25T12:00:00Z');

beforeEach(async () => {
  await db.recursiveDelete(db.collection(COLLECTION));
});

afterAll(async () => {
  await db.recursiveDelete(db.collection(COLLECTION));
  await db.terminate();
});

describe('Firestore notes store', () => {
  test('create persists the owner and returns a note without it', async () => {
    const note = await store.create('uid-alice', { title: 'First', body: 'hello' }, T0);
    expect(note).toEqual({
      id: expect.stringMatching(/^[A-Za-z0-9]{20}$/),
      title: 'First',
      body: 'hello',
      createdAt: '2026-09-25T12:00:00.000Z',
      updatedAt: '2026-09-25T12:00:00.000Z',
    });
    const raw = (await db.collection(COLLECTION).doc(note.id).get()).data();
    expect(raw.ownerUid).toBe('uid-alice');
  });

  test('list is owner-scoped, newest update first, and honours limit', async () => {
    const a = await store.create('uid-alice', { title: 'one', body: '' }, T0);
    await store.create('uid-alice', { title: 'two', body: '' }, T0 + 1000);
    await store.create('uid-alice', { title: 'three', body: '' }, T0 + 2000);
    await store.create('uid-bob', { title: 'bob', body: '' }, T0 + 3000);
    await store.update('uid-alice', a.id, { body: 'bumped' }, T0 + 4000);

    const titles = (await store.list('uid-alice', { limit: 10 })).map((n) => n.title);
    expect(titles).toEqual(['one', 'three', 'two']);
    expect(await store.list('uid-alice', { limit: 2 })).toHaveLength(2);
    expect((await store.list('uid-bob', { limit: 10 })).map((n) => n.title)).toEqual(['bob']);
  });

  test('update changes only the patched fields and bumps updatedAt', async () => {
    const note = await store.create('uid-alice', { title: 'Keep', body: 'old' }, T0);
    const updated = await store.update('uid-alice', note.id, { body: 'new' }, T0 + 5000);
    expect(updated).toMatchObject({ id: note.id, title: 'Keep', body: 'new' });
    expect(updated.createdAt).toBe(note.createdAt);
    expect(updated.updatedAt).toBe('2026-09-25T12:00:05.000Z');
  });

  test('another owner cannot update or delete, and the note is untouched', async () => {
    const note = await store.create('uid-alice', { title: 'Private', body: 'secret' }, T0);
    expect(await store.update('uid-bob', note.id, { title: 'Hijacked' }, T0 + 1000)).toBeNull();
    expect(await store.remove('uid-bob', note.id)).toBe(false);
    const raw = (await db.collection(COLLECTION).doc(note.id).get()).data();
    expect(raw).toMatchObject({ ownerUid: 'uid-alice', title: 'Private', body: 'secret' });
  });

  test('missing notes: update returns null, delete returns false', async () => {
    expect(await store.update('uid-alice', 'doesNotExist123', { title: 'x' }, T0)).toBeNull();
    expect(await store.remove('uid-alice', 'doesNotExist123')).toBe(false);
  });

  test('delete removes the owner’s note', async () => {
    const note = await store.create('uid-alice', { title: 'Temp', body: '' }, T0);
    expect(await store.remove('uid-alice', note.id)).toBe(true);
    expect((await db.collection(COLLECTION).doc(note.id).get()).exists).toBe(false);
  });
});

describe('MCP tools over the Firestore store', () => {
  let server;
  let client;

  beforeAll(async () => {
    const registry = createRegistry();
    registry.registerApp('scriptorium', scriptoriumApp({ store }));
    const app = express();
    app.use(express.json());
    const oauthStore = createInMemoryStore();
    oauthStore._debug.grants.set('grant-fs', {
      grantId: 'grant-fs',
      uid: 'uid-alice',
      appId: 'scriptorium',
      revoked: false,
    });
    app.all('/mcp/:appId', (req, res) =>
      handleAppRequest(req, res, {
        registry,
        appId: req.params.appId,
        getGrant: (grantId) => oauthStore.getGrant(grantId),
      })
    );
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const token = signAccessToken({
      uid: 'uid-alice',
      audience: 'https://bcoletech.com/mcp/scriptorium',
      scope: 'mcp:scriptorium',
      issuer: 'https://bcoletech.com',
      grantId: 'grant-fs',
    });
    client = new Client({ name: 'scriptorium-fs-test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${server.address().port}/mcp/scriptorium`),
        { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
      )
    );
  });

  afterAll(async () => {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('create → list → delete round trip', async () => {
    const created = await client.callTool({ name: 'create_note', arguments: { title: 'Via MCP' } });
    const { note } = created.structuredContent;
    expect(note.title).toBe('Via MCP');
    expect(Number.isNaN(Date.parse(note.createdAt))).toBe(false);

    const listed = await client.callTool({ name: 'list_notes', arguments: {} });
    expect(listed.structuredContent.notes.map((n) => n.id)).toEqual([note.id]);

    const deleted = await client.callTool({ name: 'delete_note', arguments: { id: note.id } });
    expect(deleted.structuredContent.deleted).toBe(true);
  });
});
