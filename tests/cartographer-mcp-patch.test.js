'use strict';

/**
 * The Cartographer's patch tools (planning/maps-from-data.md §4.8; L-929 /
 * #733, #735 gap 17), driven by a real MCP client in the Firestore emulator:
 *
 *   - a small dungeon built with them, one kind of shape a tool, and read back
 *     with get_geometry (and drawn with view_image);
 *   - a patch changes only the fields given (null takes one away), adds what
 *     is new, removes by id, and gives an id to what has none;
 *   - a bad shape is refused with its reason, and nothing is written;
 *   - a region map takes them too, and a world map in today's shape does not;
 *   - features, entries and exits are patched by id the same way;
 *   - moving one exit keeps a save's seen map (a patch never bumps `revision`),
 *     where replacing the grid makes players forget it;
 *   - generate_map writes a seeded first draft as an ordinary battle map, the
 *     same from the same seed, for each kind, which the patch tools then edit.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-patch --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-patch';
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
const seen = require('../functions/loom-turn/seen');
const geo = require('../functions/loom-canon/map-geometry');
const generators = require('../functions/loom-canon/map-generators');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');

const CANONICAL = 'https://bcoletech.com';
const adminApp = initializeApp({ projectId: 'demo-cartographer-patch' }, 'cartographer-patch-test');
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
  client = new Client({ name: 'cartographer-patch-test', version: '0.0.0' });
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
const geometryOf = async (lists) => await ok('get_geometry', { worldId: W, mapId: M, lists });
const mapDoc = async () => (await worlds().doc(W).collection('battleMaps').doc(M).get()).data();

describe('a dungeon built with the patch tools', () => {
  beforeAll(async () => {
    ({ worldId: W } = await ok('create_world', {
      name: 'Crypt of Dust',
      backdrop: { colour: '#101828' },
    }));
    const made = await ok('set_battle_map', {
      worldId: W,
      name: 'The crypt',
      width: 12,
      height: 8,
      entries: [{ id: 'in', x: 1, y: 6 }],
      exits: [{ id: 'out', name: 'the stair', x: 0, y: 4, to: 'out' }],
    });
    M = made.map.id;
  });

  test('floors, walls, a door, a window, objects, a zone, a spawn, a light, a note, a secret', async () => {
    const at = (list, set) => ok(list, { worldId: W, mapId: M, set });
    expect(
      await at('set_ground', [
        { id: 'floor', material: 'flagstone', shape: { rect: { x: 0, y: 0, w: 60, h: 40 } } },
        { id: 'pool', material: 'water', depth: 3, shape: { circle: { x: 50, y: 30, r: 5 } } },
      ])
    ).toMatchObject({ list: 'ground', added: ['floor', 'pool'], counts: { ground: 2 } });
    await at('set_walls', [
      {
        id: 'west',
        material: 'stone',
        points: [
          [0, 0],
          [0, 40],
        ],
      },
      {
        id: 'divide',
        material: 'stone',
        points: [
          [30, 0],
          [30, 40],
        ],
        height: 9,
      },
    ]);
    // The gate is unlocked by the lever's use, so the lever comes first.
    await at('set_objects', [
      {
        id: 'chest',
        kind: 'chest',
        name: 'the chest',
        at: [7.5, 22.5],
        size: [3, 2],
        container: { contents: 'a silver dagger' },
        locked: true,
        unlocks: { key: 'brass key' },
        difficulty: 18,
      },
      {
        id: 'lever',
        kind: 'lever',
        at: [22.5, 2.5],
        size: [1, 1],
        actions: [{ id: 'pull', name: 'Pull', ap: 3 }],
      },
    ]);
    await at('set_doors', [
      {
        id: 'gate',
        material: 'wood',
        name: 'the iron gate',
        from: [30, 15],
        to: [30, 20],
        wall: 'divide',
        state: 'locked',
        unlocks: { action: 'lever.pull' },
      },
      {
        id: 'secret',
        material: 'wood',
        name: 'a secret door',
        from: [30, 25],
        to: [30, 30],
        wall: 'divide',
      },
    ]);
    await at('set_windows', [
      { id: 'slit', material: 'glass', from: [0, 10], to: [0, 15], wall: 'west' },
    ]);
    await at('set_zones', [
      { id: 'vestibule', name: 'the vestibule', shape: { rect: { x: 0, y: 0, w: 30, h: 40 } } },
    ]);
    await at('set_spawns', [
      { id: 'den', shape: { rect: { x: 40, y: 5, w: 15, h: 15 } }, what: 'goblin', count: 2 },
    ]);
    await at('set_lights', [{ id: 'torch', at: [12, 20], radius: 10 }]);
    await at('set_notes', [{ id: 'smell', text: 'The air smells of old smoke.', at: [7, 7] }]);
    const hidden = await at('set_hidden', [{ id: 'secret', dc: 12 }]);
    expect(hidden.counts).toEqual({
      ground: 2,
      walls: 2,
      doors: 2,
      windows: 1,
      objects: 2,
      zones: 1,
      spawns: 1,
      lights: 1,
      notes: 1,
      hidden: 1,
    });
  });

  test('get_geometry reads it back, to patch it by id', async () => {
    const all = await geometryOf();
    expect(all.bounds).toEqual({ width: 60, height: 40, units: 'feet' });
    expect(all.map).toMatchObject({ mapId: M, name: 'The crypt', kind: 'grid' });
    expect(all.geometry.walls.map((w) => w.id)).toEqual(['west', 'divide']);
    // Stored as path data.
    expect(all.geometry.walls[1]).toMatchObject({
      material: 'stone',
      points: 'M30 0L30 40',
      height: 9,
    });
    expect(all.geometry.hidden).toEqual([{ id: 'secret', dc: 12 }]);
    const only = await geometryOf(['doors']);
    expect(Object.keys(only.geometry)).toEqual(['doors']);
  });

  test('view_image draws it', async () => {
    const result = await call('view_image', { worldId: W, of: 'battleMap', id: M });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
  });

  test('a patch changes only the fields given; null takes one away', async () => {
    const moved = await ok('set_walls', {
      worldId: W,
      mapId: M,
      set: [
        {
          id: 'divide',
          points: [
            [30, 0],
            [30, 40],
          ],
          material: 'brick',
        },
      ],
    });
    expect(moved).toMatchObject({ added: [], changed: ['divide'], removed: [] });
    let divide = (await geometryOf(['walls'])).geometry.walls.find((w) => w.id === 'divide');
    // The material changed; the height it had is kept.
    expect(divide).toMatchObject({ material: 'brick', height: 9 });
    await ok('set_walls', { worldId: W, mapId: M, set: [{ id: 'divide', height: null }] });
    divide = (await geometryOf(['walls'])).geometry.walls.find((w) => w.id === 'divide');
    expect(divide.height).toBeUndefined();
    expect(divide.material).toBe('brick');
  });

  test('a shape with no id is given one; an id taken away takes its hidden mark with it', async () => {
    const added = await ok('set_walls', {
      worldId: W,
      mapId: M,
      set: [
        {
          material: 'stone',
          points: [
            [0, 39],
            [30, 39],
          ],
        },
      ],
    });
    expect(added.added).toEqual(['wall-1']);
    const removed = await ok('set_doors', { worldId: W, mapId: M, remove: ['secret'] });
    expect(removed).toMatchObject({ removed: ['secret'], unhidden: ['secret'] });
    const g = await geometryOf(['doors', 'hidden']);
    expect(g.geometry.doors.map((d) => d.id)).toEqual(['gate']);
    expect(g.geometry.hidden).toBeUndefined();
  });

  test('a bad shape is refused with its reason, and nothing is written', async () => {
    const before = (await geometryOf()).counts;
    const wall = (more) => ({
      worldId: W,
      mapId: M,
      set: [
        {
          id: 'bad',
          material: 'stone',
          points: [
            [0, 0],
            [10, 0],
          ],
          ...more,
        },
      ],
    });
    expect(await refused('set_walls', wall({ material: 'zzz' }))).toMatch(
      /walls\.bad has an unknown material "zzz"/
    );
    expect(
      await refused(
        'set_walls',
        wall({
          points: [
            [0, 0],
            [99, 0],
          ],
        })
      )
    ).toMatch(/runs outside the map \(99, 0\)/);
    expect(await refused('set_walls', wall({ points: [[0, 0]] }))).toMatch(/2 points or more/);
    // A door must lie in a wall.
    expect(
      await refused('set_doors', {
        worldId: W,
        mapId: M,
        set: [{ id: 'floating', material: 'wood', from: [10, 10], to: [15, 10] }],
      })
    ).toMatch(/floating/);
    // An id belongs to one shape: the chest is an object.
    expect(await refused('set_doors', { worldId: W, mapId: M, set: [{ id: 'chest' }] })).toMatch(
      /"chest" is already an object/
    );
    // Taking away what isn't there, setting and removing one id, hiding nothing.
    expect(await refused('set_walls', { worldId: W, mapId: M, remove: ['ghost'] })).toMatch(
      /"ghost" isn't one of the map's walls/
    );
    expect(
      await refused('set_walls', { worldId: W, mapId: M, set: [{ id: 'west' }], remove: ['west'] })
    ).toMatch(/both set and removed/);
    expect(await refused('set_hidden', { worldId: W, mapId: M, set: [{ id: 'ghost' }] })).toMatch(
      /hidden names "ghost"/
    );
    // The wall a door stands in can't go while the door does.
    expect(await refused('set_walls', { worldId: W, mapId: M, remove: ['divide'] })).toMatch(
      /gate/
    );
    expect(await refused('set_walls', { worldId: W, mapId: M })).toMatch(
      /something to set or remove/
    );
    expect((await geometryOf()).counts).toEqual(before);
  });

  test('a world map in today’s shape has no document to patch; an unknown map is no map', async () => {
    expect(
      await refused('set_ground', { worldId: W, mapId: 'map_town_nowhere', set: [{ id: 'g' }] })
    ).toMatch(/is no grid, or region or area map made with add_map/);
  });
});

describe('a region map takes them too', () => {
  test('ground on the world’s top map, in its own units', async () => {
    const top = await ok('get_geometry', { worldId: W, mapId: 'map_world' });
    expect(top.map).toMatchObject({ kind: 'region' });
    expect(top.bounds.units).toBe('map units');
    const w = top.bounds.width;
    const made = await ok('set_ground', {
      worldId: W,
      mapId: 'map_world',
      set: [
        { id: 'plain', material: 'grass', shape: { rect: { x: 0, y: 0, w: w / 2, h: w / 2 } } },
      ],
    });
    expect(made).toMatchObject({
      map: { kind: 'region' },
      added: ['plain'],
      counts: { ground: 1 },
    });
    expect(
      await refused('set_ground', {
        worldId: W,
        mapId: 'map_world',
        set: [{ id: 'sea', material: 'grass', shape: { rect: { x: 0, y: 0, w: w * 2, h: 5 } } }],
      })
    ).toMatch(/runs outside the map/);
  });
});

describe('features, entries and exits, patched by id', () => {
  test('moving an exit sends its id and its new square; the rest of it stays', async () => {
    const moved = await ok('set_exits', { worldId: W, mapId: M, set: [{ id: 'out', y: 5 }] });
    expect(moved).toMatchObject({ list: 'exits', changed: ['out'], added: [], removed: [] });
    expect(moved.exits).toEqual([{ id: 'out', name: 'the stair', x: 0, y: 5, to: 'out' }]);
  });

  test('a feature is added whole, then changed, then removed', async () => {
    const added = await ok('set_features', {
      worldId: W,
      mapId: M,
      set: [{ id: 'altar', name: 'the altar', x: 10, y: 2 }],
    });
    expect(added.added).toEqual(['altar']);
    await ok('set_features', { worldId: W, mapId: M, set: [{ id: 'altar', ap: 8 }] });
    expect((await mapDoc()).features).toEqual([
      { id: 'altar', name: 'the altar', x: 10, y: 2, ap: 8 },
    ]);
    await ok('set_features', { worldId: W, mapId: M, set: [{ id: 'altar', ap: null }] });
    expect((await mapDoc()).features).toEqual([{ id: 'altar', name: 'the altar', x: 10, y: 2 }]);
    await ok('set_features', { worldId: W, mapId: M, remove: ['altar'] });
    expect((await mapDoc()).features || []).toEqual([]);
  });

  test('refused with reasons: a new one without its fields, off the grid, on an exit, the last of its kind', async () => {
    expect(await refused('set_features', { worldId: W, mapId: M, set: [{ id: 'bare' }] })).toMatch(
      /features\[0\] "bare"/
    );
    expect(
      await refused('set_entries', { worldId: W, mapId: M, set: [{ id: 'in', x: 40 }] })
    ).toMatch(/off the 12 × 8 grid/);
    expect(
      await refused('set_features', {
        worldId: W,
        mapId: M,
        set: [{ id: 'on-exit', name: 'on the stair', x: 0, y: 5 }],
      })
    ).toMatch(/sits on the exit "out"/);
    expect(await refused('set_entries', { worldId: W, mapId: M, remove: ['in'] })).toMatch(
      /keeps at least one entry/
    );
    expect(await refused('set_exits', { worldId: W, mapId: M, remove: ['out'] })).toMatch(
      /keeps at least one exit/
    );
    expect(
      await refused('set_exits', {
        worldId: W,
        mapId: M,
        set: [
          { id: 'x', name: 'x', x: 1, y: 1, to: 'out' },
          { id: 'y', name: 'y', x: 1, y: 1, to: 'out' },
        ],
      })
    ).toMatch(/share the cell/);
  });

  test('an exit to another map names an entry it has', async () => {
    const upper = await ok('set_battle_map', {
      worldId: W,
      name: 'The upper crypt',
      width: 6,
      height: 6,
      entries: [{ id: 'down', x: 1, y: 1 }],
      exits: [{ id: 'back', name: 'the way down', x: 0, y: 0, to: { map: M, entry: 'in' } }],
    });
    expect(
      await refused('set_exits', {
        worldId: W,
        mapId: M,
        set: [
          { id: 'up', name: 'the way up', x: 11, y: 0, to: { map: upper.map.id, entry: 'nope' } },
        ],
      })
    ).toMatch(/entry "nope" it doesn't have/);
    const ok2 = await ok('set_exits', {
      worldId: W,
      mapId: M,
      set: [
        { id: 'up', name: 'the way up', x: 11, y: 0, to: { map: upper.map.id, entry: 'down' } },
      ],
    });
    expect(ok2.added).toEqual(['up']);
    // The upper map's exit leads to this map's entry, which can't be taken away.
    expect(
      await refused('set_entries', {
        worldId: W,
        mapId: M,
        set: [{ id: 'second', x: 2, y: 6 }],
        remove: ['in'],
      })
    ).toMatch(/leads to this map's entry "in"/);
  });
});

describe('a save keeps what it has seen of a map', () => {
  const seenRef = () => db.collection('loom_saves').doc('save-1').collection('seen').doc(M);

  test('moving one exit with a patch keeps it; replacing the grid makes players forget it', async () => {
    const before = await mapDoc();
    await seenRef().set({
      mapId: M,
      width: before.width,
      height: before.height,
      squares: seen.pack({ '1,6': true, '2,6': true, '3,6': true }, before.width, before.height),
    });
    const held = async () => seen.squaresOf((await seenRef().get()).data(), await mapDoc());
    expect(Object.keys(await held())).toHaveLength(3);

    await ok('set_exits', { worldId: W, mapId: M, set: [{ id: 'out', y: 3 }] });
    await ok('set_walls', { worldId: W, mapId: M, set: [{ id: 'west', height: 12 }] });
    const after = await mapDoc();
    expect(after.revision).toBe(before.revision);
    expect(Object.keys(await held())).toHaveLength(3);

    // set_grid replaces a list and redraws the map to players, as it always did.
    await ok('set_grid', {
      worldId: W,
      mapId: M,
      features: [{ id: 'altar', name: 'the altar', x: 10, y: 2 }],
    });
    expect((await mapDoc()).revision).toBe((before.revision || 0) + 1);
    expect(await held()).toEqual({});
  });
});

describe('view_image draws the geometry as it was built', () => {
  const view = (args) => call('view_image', { worldId: W, ...args });
  const legendOf = (result) => result.structuredContent;

  test('a grid: numbered with the ids to patch each by, its geometry counted', async () => {
    const result = await view({ of: 'battleMap', id: M });
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    const legend = legendOf(result);
    expect(legend.geometry).toMatchObject({ ground: 2, walls: 3, doors: 1, windows: 1 });
    const types = legend.markers.map((m) => `${m.type}:${m.id}`);
    expect(types).toEqual(expect.arrayContaining(['door:gate', 'object:chest', 'object:lever']));
    expect(legend.markers.find((m) => m.id === 'chest')).toMatchObject({
      type: 'object',
      kind: 'chest',
      usable: true,
    });
    expect(legend.options).toEqual({ heights: true, hidden: true });
    expect(legend.reading).toMatch(/get_geometry/);
  });

  test('without what is hidden, as players see it; heights off', async () => {
    await ok('set_hidden', { worldId: W, mapId: M, set: [{ id: 'chest', dc: 'Hard' }] });
    const mine = legendOf(await view({ of: 'battleMap', id: M }));
    expect(mine.markers.find((m) => m.type === 'hidden')).toMatchObject({
      id: 'chest',
      dc: 'Hard',
    });
    const players = legendOf(await view({ of: 'battleMap', id: M, hidden: false, heights: false }));
    expect(players.markers.find((m) => m.type === 'hidden')).toBeUndefined();
    expect(players.markers.find((m) => m.id === 'chest')).toBeUndefined();
    expect(players.options).toEqual({ heights: false, hidden: false });
    await ok('set_hidden', { worldId: W, mapId: M, remove: ['chest'] });
  });

  test('fog from a point in feet, as sightFrom does from an entry', async () => {
    const fogged = legendOf(await view({ of: 'battleMap', id: M, from: { x: 7.5, y: 32.5 } }));
    expect(fogged.sight.from).toBe('7.5, 32.5 ft');
    expect(fogged.sight.squaresSeen).toBeGreaterThan(0);
    expect(fogged.sight.squaresSeen).toBeLessThan(12 * 8);
    expect(
      await refused('view_image', { worldId: W, of: 'battleMap', id: M, from: { x: 500, y: 5 } })
    ).toMatch(/320|off The crypt/);
    expect(
      await refused('view_image', { worldId: W, of: 'battleMap', id: M, from: { x: 300, y: 5 } })
    ).toMatch(/off The crypt's 12 × 8 grid/);
    expect(
      await refused('view_image', {
        worldId: W,
        of: 'battleMap',
        id: M,
        sightFrom: 'in',
        from: { x: 5, y: 5 },
      })
    ).toMatch(/sightFrom \(an entry\) or from \(a point\), not both/);
  });

  test('of map: a region map in its own units; a grid as a battle map; anything else refused', async () => {
    const region = await view({ of: 'map', id: 'map_world' });
    expect(region.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    expect(legendOf(region)).toMatchObject({
      of: 'map',
      kind: 'region',
      geometry: { ground: 1 },
    });
    const grid = await view({ of: 'map', id: M });
    expect(legendOf(grid)).toMatchObject({ of: 'battleMap', id: M });
    expect(await refused('view_image', { worldId: W, of: 'map', id: 'map_nowhere' })).toMatch(
      /is no grid, or region or area map made with add_map/
    );
    expect(await refused('view_image', { worldId: W, of: 'map' })).toMatch(/Give the/);
  });
});

describe('generate_map: a seeded first draft to edit', () => {
  const docOf = async (id) => (await worlds().doc(W).collection('battleMaps').doc(id).get()).data();

  test('a dungeon from a seed, written as an ordinary battle map, the same from the same seed', async () => {
    const made = await ok('generate_map', {
      worldId: W,
      name: 'The deep halls',
      kind: 'rooms',
      seed: 99,
    });
    expect(made).toMatchObject({
      created: true,
      generated: { kind: 'rooms', seed: 99, version: generators.VERSION, width: 32, height: 32 },
      map: { name: 'The deep halls', size: { width: 32, height: 32 }, drawn: 'full' },
      entries: [{ id: 'way-in' }],
      exits: [{ id: 'way-out', to: 'out' }],
    });
    expect(made.rooms.length).toBeGreaterThanOrEqual(2);
    expect(made.counts).toMatchObject({ ground: expect.any(Number), doors: expect.any(Number) });
    expect(made.next).toMatch(/set_zones/);

    // Stored as the pure generator makes it, with how it was made.
    const doc = await docOf(made.map.id);
    const pure = generators.generate('rooms', { seed: 99 });
    expect(doc.geometry).toEqual(geo.normalize(pure.geometry));
    expect(doc.entries).toEqual(pure.entries);
    expect(doc.exits).toEqual(pure.exits);
    expect(doc.sources).toEqual({
      map: 'mcp',
      generated: { kind: 'rooms', seed: 99, version: generators.VERSION },
    });

    // The same seed again, the same map.
    const again = await ok('generate_map', {
      worldId: W,
      name: 'The deep halls again',
      kind: 'rooms',
      seed: 99,
    });
    expect(again.map.id).not.toBe(made.map.id);
    expect((await docOf(again.map.id)).geometry).toEqual(doc.geometry);

    // view_image draws it from its data.
    const view = await call('view_image', { worldId: W, of: 'battleMap', id: made.map.id });
    expect(view.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    expect(view.structuredContent.geometry).toMatchObject({
      walls: doc.geometry.walls.length,
      zones: made.rooms.length,
    });
  });

  test('then edited with the patch tools: a room named, a door hidden, the exit moved', async () => {
    const made = await ok('generate_map', {
      worldId: W,
      name: 'The old manse',
      kind: 'interior',
      seed: 'manse',
    });
    const mapId = made.map.id;
    expect(
      await ok('set_zones', { worldId: W, mapId, set: [{ id: 'room-1', name: 'the parlour' }] })
    ).toMatchObject({ changed: ['room-1'] });
    await ok('set_hidden', { worldId: W, mapId, set: [{ id: 'door-1', dc: 15 }] });
    await ok('set_exits', {
      worldId: W,
      mapId,
      set: [{ id: 'way-out', name: 'the lane', x: 0, y: made.generated.height - 1 }],
    });
    const back = await ok('get_geometry', { worldId: W, mapId, lists: ['zones', 'hidden'] });
    expect(back.geometry.zones.find((z) => z.id === 'room-1')).toMatchObject({
      name: 'the parlour',
    });
    expect(back.geometry.hidden).toEqual([{ id: 'door-1', dc: 15 }]);
    expect((await docOf(mapId)).exits[0]).toMatchObject({ name: 'the lane', x: 0 });
  });

  test('each kind, and a deck of either style; no seed makes a new map and says its seed', async () => {
    for (const [kind, style] of [
      ['caves'],
      ['interior'],
      ['deck', 'sailing'],
      ['deck', 'starship'],
    ]) {
      const made = await ok('generate_map', {
        worldId: W,
        name: `A ${style || kind}`,
        kind,
        seed: 5,
        ...(style ? { style } : {}),
      });
      expect(made).toMatchObject({ created: true, generated: { kind, seed: 5 } });
      if (style) expect(made.generated.style).toBe(style);
      expect(made.map.drawn).toBe('full');
    }
    const unseeded = await ok('generate_map', {
      worldId: W,
      name: 'Somewhere dark',
      kind: 'caves',
    });
    expect(Number.isInteger(unseeded.generated.seed)).toBe(true);
    expect((await docOf(unseeded.map.id)).geometry).toEqual(
      geo.normalize(generators.generate('caves', { seed: unseeded.generated.seed }).geometry)
    );
  });

  test('a wilds map (L-365): its terrain and scene, made generic for them, drawn by view_image', async () => {
    const made = await ok('generate_map', {
      worldId: W,
      name: 'The ford at the willows',
      kind: 'wilds',
      terrain: 'forest',
      scene: 'ford',
      seed: 12,
    });
    expect(made).toMatchObject({
      created: true,
      generated: { kind: 'wilds', seed: 12, terrain: 'forest', scene: 'ford', width: 30 },
      map: { name: 'The ford at the willows' },
    });
    expect(made.rooms).toContain('ford');
    expect(made.spawns).toEqual(['spawn-1', 'spawn-2', 'spawn-3']);
    expect(made.entries.length).toBeGreaterThanOrEqual(2);
    expect(made.exits.every((e) => e.to === 'out')).toBe(true);
    const doc = await docOf(made.map.id);
    const pure = generators.generate('wilds', { seed: 12, terrain: 'forest', scene: 'ford' });
    expect(doc.geometry).toEqual(geo.normalize(pure.geometry));
    expect(doc.generic).toEqual({ kind: 'ford', terrain: 'forest' });
    expect(doc.sources.generated).toEqual({
      kind: 'wilds',
      seed: 12,
      terrain: 'forest',
      scene: 'ford',
      version: generators.VERSION,
    });
    // Its objects are to scale: no warning.
    expect(made.warnings).toBeUndefined();

    // A terrain's own scene when none is asked for; a generic given is kept.
    const ridge = await ok('generate_map', {
      worldId: W,
      name: 'Under the scarp',
      kind: 'wilds',
      terrain: 'hills',
      seed: 3,
      generic: { kind: 'scarp' },
    });
    expect(ridge.generated.scene).toBe('ridge');
    expect((await docOf(ridge.map.id)).generic).toEqual({ kind: 'scarp' });

    const view = await call('view_image', { worldId: W, of: 'battleMap', id: made.map.id });
    expect(view.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    expect(view.structuredContent.geometry).toMatchObject({
      objects: doc.geometry.objects.length,
      spawns: 3,
    });

    // A terrain or scene there isn't, or one for another kind, is refused.
    expect(
      await refused('generate_map', { worldId: W, name: 'X', kind: 'wilds', terrain: 'ocean' })
    ).toMatch(/terrain/);
    expect(
      await refused('generate_map', { worldId: W, name: 'X', kind: 'rooms', scene: 'ford' })
    ).toMatch(/takes no terrain or scene/);
  });

  test('replacing a map’s grid makes players forget it', async () => {
    const first = await ok('generate_map', {
      worldId: W,
      name: 'The cellar',
      kind: 'rooms',
      seed: 1,
    });
    const replaced = await ok('generate_map', {
      worldId: W,
      mapId: first.map.id,
      name: 'The cellar',
      kind: 'caves',
      seed: 2,
    });
    expect(replaced.created).toBeUndefined();
    expect(replaced.map.id).toBe(first.map.id);
    expect(replaced.warnings[0]).toMatch(/start over/);
    expect(await docOf(first.map.id)).toMatchObject({
      revision: 1,
      sources: { generated: { kind: 'caves', seed: 2 } },
    });
  });

  test('refused with its reason, and nothing written', async () => {
    const before = (await worlds().doc(W).collection('battleMaps').get()).size;
    expect(
      await refused('generate_map', { worldId: W, name: 'Tiny', kind: 'rooms', width: 12 })
    ).toMatch(/from 16 to 64/);
    expect(
      await refused('generate_map', { worldId: W, name: 'Odd', kind: 'rooms', style: 'sailing' })
    ).toMatch(/takes no style/);
    expect(
      await refused('generate_map', {
        worldId: W,
        mapId: 'bm_nowhere',
        name: 'Gone',
        kind: 'caves',
      })
    ).toMatch(/bm_nowhere|battle map/i);
    expect((await worlds().doc(W).collection('battleMaps').get()).size).toBe(before);
  });
});
