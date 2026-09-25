'use strict';

/**
 * Scriptorium MCP app (phase 1f, #353): the four note tools and the notes
 * resource, driven by a real MCP client through the per-app resource server
 * (/mcp/scriptorium), backed by the in-memory notes store.
 *
 * Exit criterion: the tools CRUD notes under the caller's mapped identity —
 * and only the caller's.
 *
 * The Firestore-backed store is covered by scriptorium-firestore.test.js.
 * Run: cd tests && npx jest scriptorium.test --verbose
 */

process.env.MCP_JWT_SECRET = 'test-signing-secret-scriptorium';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { scriptoriumApp } = require('../functions/mcp/apps/scriptorium');
const { createInMemoryNotesStore } = require('../functions/mcp/apps/scriptorium/store');
const registerApps = require('../functions/mcp/apps');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');

const CANONICAL = 'https://bcoletech.com';
const AUD = `${CANONICAL}/mcp/scriptorium`;

let clock = Date.parse('2026-09-25T12:00:00Z');
const store = createInMemoryNotesStore();
const registry = createRegistry();
registry.registerApp('scriptorium', scriptoriumApp({ store, now: () => clock }));

let server;
let base;
let alice;
let bob;

// Each user connects under an active grant (phase 1h).
const oauthStore = createInMemoryStore();
function tokenFor(uid) {
  const grantId = `grant-${uid}`;
  oauthStore._debug.grants.set(grantId, { grantId, uid, appId: 'scriptorium', revoked: false });
  return signAccessToken({
    uid,
    audience: AUD,
    scope: 'mcp:scriptorium',
    issuer: CANONICAL,
    grantId,
  });
}

async function connect(uid) {
  const client = new Client({ name: 'scriptorium-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp/scriptorium`), {
      requestInit: { headers: { Authorization: `Bearer ${tokenFor(uid)}` } },
    })
  );
  return client;
}

async function call(client, name, args = {}) {
  clock += 1000; // distinct updatedAt per call, so ordering is deterministic
  return client.callTool({ name, arguments: args });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
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
  base = `http://127.0.0.1:${server.address().port}`;
  alice = await connect('uid-alice');
  bob = await connect('uid-bob');
});

afterAll(async () => {
  await alice.close();
  await bob.close();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => store._debug.notes.clear());

describe('Scriptorium tool surface', () => {
  test('exposes the four note tools with accurate hints, and the notes resource', async () => {
    const { tools } = await alice.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual([
      'create_note',
      'delete_note',
      'list_notes',
      'update_note',
    ]);
    expect(byName.list_notes.annotations.readOnlyHint).toBe(true);
    expect(byName.delete_note.annotations.destructiveHint).toBe(true);
    expect(byName.create_note.inputSchema.required).toEqual(['title']);

    const { resources } = await alice.listResources();
    expect(resources).toEqual([
      expect.objectContaining({ uri: 'scriptorium://notes', mimeType: 'application/json' }),
    ]);
  });

  test('the production registration exposes the same app', () => {
    const prod = createRegistry();
    registerApps(prod);
    expect(prod.appIds()).toEqual(['scriptorium']);
    expect(prod.getApp('scriptorium').tools.map((t) => t.name)).toEqual([
      'list_notes',
      'create_note',
      'update_note',
      'delete_note',
    ]);
  });
});

describe('exit criterion: CRUD under the caller’s identity', () => {
  test('create → list → update → delete', async () => {
    const created = await call(alice, 'create_note', { title: '  First note ', body: 'hello' });
    expect(created.isError).toBeFalsy();
    const { note } = created.structuredContent;
    expect(note).toMatchObject({ title: 'First note', body: 'hello' });
    expect(note.id).toMatch(/^[A-Za-z0-9]+$/);
    expect(note).not.toHaveProperty('ownerUid');

    const listed = await call(alice, 'list_notes');
    expect(listed.structuredContent).toEqual({ notes: [note], count: 1 });

    const updated = await call(alice, 'update_note', { id: note.id, title: 'Renamed' });
    expect(updated.structuredContent.note).toMatchObject({
      id: note.id,
      title: 'Renamed',
      body: 'hello',
    });
    expect(Date.parse(updated.structuredContent.note.updatedAt)).toBeGreaterThan(
      Date.parse(note.updatedAt)
    );

    const deleted = await call(alice, 'delete_note', { id: note.id });
    expect(deleted.structuredContent).toEqual({ deleted: true, id: note.id });
    expect((await call(alice, 'list_notes')).structuredContent.count).toBe(0);
  });

  test('notes are stored under the caller’s uid', async () => {
    const { note } = (await call(alice, 'create_note', { title: 'Mine' })).structuredContent;
    expect(store._debug.notes.get(note.id).ownerUid).toBe('uid-alice');
  });

  test('list is newest-update first and honours limit', async () => {
    const ids = [];
    for (const title of ['one', 'two', 'three']) {
      ids.push((await call(alice, 'create_note', { title })).structuredContent.note.id);
    }
    await call(alice, 'update_note', { id: ids[0], body: 'bumped' });

    const all = (await call(alice, 'list_notes')).structuredContent.notes.map((n) => n.title);
    expect(all).toEqual(['one', 'three', 'two']);
    const two = (await call(alice, 'list_notes', { limit: 2 })).structuredContent;
    expect(two.count).toBe(2);
  });

  test('the notes resource returns only the caller’s notes', async () => {
    await call(alice, 'create_note', { title: 'Alice note' });
    await call(bob, 'create_note', { title: 'Bob note' });
    const read = await alice.readResource({ uri: 'scriptorium://notes' });
    const { notes } = JSON.parse(read.contents[0].text);
    expect(notes.map((n) => n.title)).toEqual(['Alice note']);
  });
});

describe('isolation between users', () => {
  let aliceNoteId;
  beforeEach(async () => {
    aliceNoteId = (await call(alice, 'create_note', { title: 'Private', body: 'secret' }))
      .structuredContent.note.id;
  });

  test('another user cannot see the note', async () => {
    expect((await call(bob, 'list_notes')).structuredContent.count).toBe(0);
  });

  test.each([
    ['update', 'update_note', (id) => ({ id, title: 'Hijacked' })],
    ['delete', 'delete_note', (id) => ({ id })],
  ])(
    'another user cannot %s it — indistinguishable from a missing note',
    async (_l, tool, args) => {
      const result = await call(bob, tool, args(aliceNoteId));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Note not found.');

      const missing = await call(bob, tool, args('doesNotExist123'));
      expect(missing.content[0].text).toBe('Note not found.');

      const stored = store._debug.notes.get(aliceNoteId);
      expect(stored).toMatchObject({ ownerUid: 'uid-alice', title: 'Private', body: 'secret' });
    }
  );
});

describe('input validation happens before any write', () => {
  test.each([
    ['an empty title', { title: '   ' }],
    ['a title over 200 characters', { title: 'x'.repeat(201) }],
    ['a body over 10000 characters', { title: 'ok', body: 'x'.repeat(10001) }],
    ['a missing title', { body: 'no title' }],
  ])('create_note rejects %s', async (_label, args) => {
    const result = await call(alice, 'create_note', args);
    expect(result.isError).toBe(true);
    expect(store._debug.notes.size).toBe(0);
  });

  test('update_note requires something to change', async () => {
    const { note } = (await call(alice, 'create_note', { title: 'Keep' })).structuredContent;
    const result = await call(alice, 'update_note', { id: note.id });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/title and\/or body/);
  });

  test.each(['a/b', '../x', '', 'x'.repeat(65)])(
    'rejects the malformed note id %j before touching the store',
    async (id) => {
      const update = await call(alice, 'update_note', { id, title: 'x' });
      const del = await call(alice, 'delete_note', { id });
      expect(update.isError).toBe(true);
      expect(del.isError).toBe(true);
      expect(update.content[0].text).not.toBe('Note not found.'); // failed validation, not lookup
    }
  );

  test('list_notes rejects an out-of-range limit', async () => {
    expect((await call(alice, 'list_notes', { limit: 0 })).isError).toBe(true);
    expect((await call(alice, 'list_notes', { limit: 101 })).isError).toBe(true);
  });
});
