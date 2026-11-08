'use strict';

/**
 * Decor and scale over MCP (planning/game-art.md §4.5, §4.6; L-945 / #799),
 * driven by a real MCP client in the Firestore emulator:
 *
 *   - dress_room dresses a zone of a generated dungeon: the same seed the same
 *     dressing, another seed another, dressing again replacing the old, the
 *     pieces ordinary decor objects the patch tools edit;
 *   - view_image with sizes draws each footprint with its size in feet;
 *   - scale warnings: an object over twice its kind's size or into a wall
 *     (set_objects), and a figure too big for where it stands (place_figures)
 *     are said and kept;
 *   - what it refuses, and list_object_kinds' decor group.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-decor --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-decor';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const path = require('path');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const functionsDir = path.resolve(__dirname, '../functions');
const { initializeApp } = require(require.resolve('firebase-admin/app', { paths: [functionsDir] }));
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const geo = require('../functions/loom-canon/map-geometry');
const mapPaths = require('../functions/loom-canon/map-paths');
const dress = require('../functions/loom-canon/dress');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');

const CANONICAL = 'https://bcoletech.com';
const adminApp = initializeApp({ projectId: 'demo-cartographer-decor' }, 'cartographer-decor-test');
const db = getFirestore(adminApp);
const worlds = () => db.collection('loom_worlds');
const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader: createFirestoreWorldReader(() => db),
    writer: createFirestoreWorldWriter(() => db),
    art: { load: async () => Buffer.alloc(0), draw: async () => ({}) },
  })
);
const oauthStore = createInMemoryStore();
let server;
let client;

const call = (name, args) => client.callTool({ name, arguments: args });
async function ok(name, args) {
  const result = await call(name, args);
  if (result.isError) throw new Error(`${name} failed: ${result.content[0].text}`);
  return result.structuredContent;
}
async function refused(name, args) {
  const result = await call(name, args);
  expect(result.isError).toBe(true);
  return result.content[0].text;
}

beforeAll(async () => {
  await db.recursiveDelete(worlds());
  await db.recursiveDelete(db.collection('loom_saves'));
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
  server.keepAliveTimeout = 60000;
  oauthStore._debug.grants.set('g', {
    grantId: 'g',
    uid: 'builder-001',
    appId: 'cartographer',
    revoked: false,
  });
  const token = signAccessToken({
    uid: 'builder-001',
    audience: `${CANONICAL}/mcp/cartographer`,
    scope: 'mcp:cartographer',
    issuer: CANONICAL,
    grantId: 'g',
  });
  client = new Client({ name: 'cartographer-decor-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${server.address().port}/mcp/cartographer`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    )
  );
}, 60000);

afterAll(async () => {
  await client.close();
  await new Promise((resolve) => server.close(resolve));
  await db.recursiveDelete(worlds());
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.terminate();
});

let W;
let M;
let rooms;
const docOf = async () => (await worlds().doc(W).collection('battleMaps').doc(M).get()).data();
const decorOf = (doc, zone) =>
  (doc.geometry.objects || []).filter((o) => o.id.startsWith(`${zone}-decor-`));

describe('dress_room', () => {
  beforeAll(async () => {
    ({ worldId: W } = await ok('create_world', {
      name: 'The Dressed Halls',
      backdrop: { colour: '#101828' },
    }));
    const made = await ok('generate_map', {
      worldId: W,
      name: 'The deep halls',
      kind: 'rooms',
      seed: 5,
    });
    M = made.map.id;
    rooms = made.rooms;
  }, 60000);

  test('it dresses a zone: decor objects of the theme, written to the map', async () => {
    const dressed = await ok('dress_room', {
      worldId: W,
      mapId: M,
      zone: rooms[0],
      theme: 'dungeon',
      density: 'lived-in',
      seed: 11,
    });
    expect(dressed).toMatchObject({
      zone: rooms[0],
      theme: 'dungeon',
      density: 'lived-in',
      seed: 11,
      replaced: 0,
    });
    expect(dressed.placed).toBeGreaterThan(0);
    expect(dressed.placed + dressed.skipped).toBe(dressed.wanted);
    expect(Object.values(dressed.byKind).reduce((s, n) => s + n, 0)).toBe(dressed.placed);
    expect(dressed.objects).toHaveLength(dressed.placed);
    expect(dressed.next).toMatch(/view_image/);

    // Stored as ordinary objects, flagged decor, with the ids it said.
    const doc = await docOf();
    const stored = decorOf(doc, rooms[0]);
    expect(stored.map((o) => o.id).sort()).toEqual(dressed.objects.slice().sort());
    stored.forEach((o) => {
      expect(o).toMatchObject({ decor: true });
      expect(Object.keys(dress.THEMES.dungeon)).toContain(o.kind);
    });
    // The map's own furniture is untouched, and the whole checks out.
    const bounds = { width: doc.width * 5, height: doc.height * 5 };
    expect(geo.check(doc.geometry, bounds)).toEqual([]);
  });

  test('the same seed, the same dressing; another seed, another; dressing again replaces', async () => {
    const args = { worldId: W, mapId: M, zone: rooms[0], theme: 'dungeon', density: 'lived-in' };
    const before = decorOf(await docOf(), rooms[0]);
    const again = await ok('dress_room', { ...args, seed: 11 });
    expect(again.replaced).toBe(before.length);
    expect(decorOf(await docOf(), rooms[0])).toEqual(before);
    const other = await ok('dress_room', { ...args, seed: 12 });
    expect(other.replaced).toBe(before.length);
    const changed = decorOf(await docOf(), rooms[0]);
    expect(changed).not.toEqual(before);
    // Nothing of the first dressing is left over, only the second's pieces.
    expect(changed.map((o) => o.id).sort()).toEqual(other.objects.slice().sort());
    // A word works as a seed; leaving it out gives a new one and says which.
    const worded = await ok('dress_room', { ...args, seed: 'the old crypt' });
    expect(worded.seed).toBe('the old crypt');
    const fresh = await ok('dress_room', { ...args });
    expect(typeof fresh.seed).toBe('number');
  });

  test('another zone is its own dressing; a higher density puts down more', async () => {
    const second = await ok('dress_room', {
      worldId: W,
      mapId: M,
      zone: rooms[1],
      theme: 'crypt',
      density: 'sparse',
      seed: 3,
    });
    const crowded = await ok('dress_room', {
      worldId: W,
      mapId: M,
      zone: rooms[1],
      theme: 'crypt',
      density: 'cluttered',
      seed: 3,
    });
    expect(second.replaced).toBe(0);
    expect(crowded.replaced).toBe(second.placed);
    expect(crowded.placed).toBeGreaterThan(second.placed);
    // The first room's dressing is still there.
    expect(decorOf(await docOf(), rooms[0]).length).toBeGreaterThan(0);
  });

  test('it never blocks the way: the entry still reaches the exit, and the pieces are edited with set_objects', async () => {
    const doc = await docOf();
    const reached = mapPaths.squaresReached(doc, doc.entries);
    doc.exits.forEach((e) => expect(reached[`${e.x},${e.y}`]).toBe(true));
    // Take one away with the patch tools, as Claude would.
    const [one] = decorOf(doc, rooms[1]);
    const removed = await ok('set_objects', { worldId: W, mapId: M, remove: [one.id] });
    expect(removed.removed).toEqual([one.id]);
    expect(decorOf(await docOf(), rooms[1]).map((o) => o.id)).not.toContain(one.id);
  });

  test('what it won’t do: no such zone, no such theme, no such map', async () => {
    const args = { worldId: W, mapId: M, zone: rooms[0], theme: 'dungeon', density: 'sparse' };
    expect(await refused('dress_room', { ...args, zone: 'attic' })).toMatch(
      new RegExp(`no zone "attic" \\(it has ${rooms[0]}`)
    );
    expect(await refused('dress_room', { ...args, theme: 'swamp' })).toMatch(/theme|swamp/);
    expect(await refused('dress_room', { ...args, density: 'packed' })).toMatch(/density|packed/);
    expect(await refused('dress_room', { ...args, mapId: 'bm_nothing' })).toMatch(/bm_nothing/);
  });
});

describe('view_image with sizes', () => {
  const view = (args) => call('view_image', { worldId: W, of: 'battleMap', id: M, ...args });

  test('each object’s footprint is outlined and its size drawn, only when asked', async () => {
    const plain = await view({});
    const sized = await view({ sizes: true });
    expect(sized.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    expect(sized.structuredContent.options).toMatchObject({ sizes: true });
    expect(sized.structuredContent.sizes).toMatch(/footprint is outlined in white/);
    expect(plain.structuredContent.options).toEqual({ heights: true, hidden: true });
    expect(plain.structuredContent.sizes).toBeUndefined();
    // A different picture: the footprints and the numbers are on it.
    expect(sized.content[0].data).not.toBe(plain.content[0].data);
  });
});

describe('scale warnings', () => {
  test('set_objects says an object over twice its kind’s size or into a wall, and keeps it', async () => {
    const geometry = (await ok('get_geometry', { worldId: W, mapId: M, lists: ['walls'] }))
      .geometry;
    const wall = geometry.walls.find((w) => geo.linesOf(w.points).lines);
    const [a, b] = geo.linesOf(wall.points).lines[0];
    const onWall = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const done = await ok('set_objects', {
      worldId: W,
      mapId: M,
      set: [
        { id: 'giant-chest', kind: 'chest', at: [20, 20], size: [12, 8] },
        { id: 'wall-chest', kind: 'chest', at: onWall, size: [3, 2] },
        { id: 'fine-chest', kind: 'chest', at: [20, 80], size: [3, 2] },
      ],
    });
    expect(done.added).toEqual(expect.arrayContaining(['giant-chest', 'wall-chest', 'fine-chest']));
    const said = (done.warnings || []).join(' ');
    expect(said).toMatch(
      /chest "giant-chest" is 12 × 8 ft, over twice the usual 3 × 2 ft of a chest/
    );
    expect(said).toMatch(/chest "wall-chest" overlaps the wall/);
    expect(said).not.toMatch(/fine-chest/);
    // Kept, not refused.
    const stored = (await docOf()).geometry.objects.map((o) => o.id);
    expect(stored).toEqual(expect.arrayContaining(['giant-chest', 'wall-chest']));
    // Only what was set is looked at: setting another says nothing of those.
    const quiet = await ok('set_objects', {
      worldId: W,
      mapId: M,
      set: [{ id: 'fine-chest', name: 'a small chest' }],
    });
    expect((quiet.warnings || []).join(' ')).not.toMatch(/giant-chest|wall-chest/);
  });

  test('place_figures says a figure too big for where it stands, and places it', async () => {
    const placed = await ok('place_figures', {
      worldId: W,
      mapId: M,
      figures: [
        {
          id: 'giant',
          name: 'Hill giant',
          statBlock: {
            size: 'huge',
            attributes: { STR: 18, DEX: 8, CON: 18, INT: 6, WIS: 8, CHA: 6 },
          },
          cells: ['auto'],
        },
      ],
    });
    expect(placed.figures).toHaveLength(1);
    expect((placed.warnings || []).join(' ')).toMatch(
      /Hill giant is 10 ft across and doesn't fit at \(\d+, \d+\)/
    );
  });
});

describe('the decor kinds', () => {
  test('list_object_kinds shows the decor group, and what hangs on a wall', async () => {
    const listed = await ok('list_object_kinds', { group: 'decor' });
    expect(listed.count).toBe(14);
    listed.objectKinds.forEach((k) => expect(k).toMatchObject({ group: 'decor', decor: true }));
    expect(
      listed.objectKinds
        .filter((k) => k.onWall)
        .map((k) => k.id)
        .sort()
    ).toEqual(['banner', 'chains', 'tapestry']);
    const all = await ok('list_object_kinds', {});
    expect(all.objectKinds.find((k) => k.id === 'chest').decor).toBeUndefined();
  });
});
