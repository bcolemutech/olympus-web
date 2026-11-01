'use strict';

/**
 * The map tools at any depth (planning/map-levels.md §4.7, §4.8; L-905 /
 * #723), driven by a real MCP client through /mcp/cartographer against the
 * Firestore emulator: a world built three maps deep with the new tools (a
 * sector, a star system, a station and its decks), list_maps' tree with
 * grades, two-way stairs between two new floors in one call, cell "auto" and
 * view_image's figures on a grid three maps deep, a change made with a
 * shortcut tool seen through the new tools, and the work list and grading
 * over every map.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-levels --verbose"
 */

const PROJECT = 'demo-cartographer-levels';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-levels';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
// Loading the functions initializes the Admin app the tools use.
require('../functions/index');

const path = require('path');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);

const loomCanon = require('../functions/loom-canon');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');
const { createInMemoryAuditLog } = require('../functions/mcp/audit');

const CANONICAL = 'https://bcoletech.com';
const AUD = `${CANONICAL}/mcp/cartographer`;
const BUILDER = 'builder-001';

const db = getFirestore();
const worlds = () => db.collection('loom_worlds');

// The built-in systems, as the system store would serve them.
const systems = { get: async (id) => BUILT_IN[id] || null };
const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader: createFirestoreWorldReader(() => db),
    writer: createFirestoreWorldWriter(() => db),
    systems,
  })
);
const oauthStore = createInMemoryStore();
const audit = createInMemoryAuditLog();

let server;
let client;

async function call(name, args) {
  return client.callTool({ name, arguments: args });
}
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
const loaded = (worldId) => loomCanon.loadWorld(worldId, { db, playableOnly: false });

beforeAll(async () => {
  await db.recursiveDelete(worlds());
  const app = express();
  app.use(express.json());
  app.all('/mcp/:appId', (req, res) =>
    handleAppRequest(req, res, {
      registry,
      appId: req.params.appId,
      getGrant: (grantId) => oauthStore.getGrant(grantId),
      audit,
    })
  );
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  oauthStore._debug.grants.set('grant-builder', {
    grantId: 'grant-builder',
    uid: BUILDER,
    appId: 'cartographer',
    revoked: false,
  });
  const token = signAccessToken({
    uid: BUILDER,
    audience: AUD,
    scope: 'mcp:cartographer',
    issuer: CANONICAL,
    grantId: 'grant-builder',
  });
  client = new Client({ name: 'cartographer-levels-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${server.address().port}/mcp/cartographer`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    )
  );
});

afterAll(async () => {
  await client.close();
  await new Promise((resolve) => server.close(resolve));
  await db.recursiveDelete(worlds());
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

const ids = {};
const GOBLIN = { attributes: { STR: 8, DEX: 14, CON: 10, INT: 8, WIS: 8, CHA: 8 } };

describe('a world three maps deep, built with the map tools', () => {
  test('create_world gives it a top region map', async () => {
    const made = await ok('create_world', { name: 'Andor Reach', backdrop: { colour: '#101828' } });
    ids.world = made.worldId;
    const listed = await ok('list_maps', { worldId: ids.world });
    expect(listed.topMapId).toBe('map_world');
    expect(listed.tree).toMatchObject({ mapId: 'map_world', kind: 'region', children: [] });
  });

  test('a sector, a star system, a station and its decks; list_maps returns the tree', async () => {
    const W = ids.world;
    const sector = await ok('add_places', {
      worldId: W,
      mapId: 'map_world',
      places: [
        {
          name: 'Vega',
          kind: 'star',
          description: 'A blue-white star.',
          at: { x: 400, y: 300 },
          links: [{ to: 'Sol', kind: 'jump' }],
        },
        { name: 'Sol', kind: 'star', description: 'A yellow star.', at: { x: 600, y: 300 } },
      ],
    });
    const [vega, sol] = sector.places;
    expect(vega.links).toEqual([{ placeId: sol.id, kind: 'jump' }]);
    expect(sol.links).toEqual([{ placeId: vega.id, kind: 'jump' }]);
    ids.vega = vega.id;
    const system = await ok('add_map', {
      worldId: W,
      kind: 'region',
      name: 'The Vega system',
      parentPlaceId: vega.id,
      width: 100,
      height: 100,
      unit: 'AU',
      routeKinds: { sublight: { speed: 5, roundTheClock: true } },
    });
    expect(system.map).toMatchObject({
      kind: 'region',
      parent: { mapId: 'map_world', placeId: vega.id },
    });
    ids.system = system.map.mapId;
    const inSystem = await ok('add_places', {
      worldId: W,
      mapId: ids.system,
      places: [
        {
          name: 'Vega Gate',
          kind: 'gate',
          description: 'A jump buoy.',
          at: { x: 95, y: 50 },
          entrance: true,
          links: [{ to: 'Vega Station', kind: 'sublight' }],
        },
        {
          name: 'Vega Station',
          kind: 'station',
          description: 'A ring station.',
          at: { x: 50, y: 50 },
        },
      ],
    });
    ids.station = inSystem.places[1].id;
    const station = await ok('add_map', {
      worldId: W,
      kind: 'area',
      name: 'Vega Station',
      parentPlaceId: ids.station,
      width: 1000,
      height: 1000,
      size: 300,
    });
    ids.area = station.map.mapId;
    // One place with add_place's mapId, linked to it with connect_places.
    const lock = await ok('add_place', {
      worldId: W,
      mapId: ids.area,
      name: 'The Airlock',
      kind: 'gate',
      description: 'The way aboard.',
      at: { x: 500, y: 950 },
      entrance: true,
    });
    const dock = await ok('add_places', {
      worldId: W,
      mapId: ids.area,
      places: [{ name: 'The Dock', kind: 'dock', description: 'Berths.', at: { x: 500, y: 500 } }],
    });
    ids.dock = dock.places[0].id;
    await ok('connect_places', { worldId: W, fromId: lock.place.id, toId: ids.dock });
    const upper = await ok('add_map', {
      worldId: W,
      kind: 'grid',
      name: 'Upper deck',
      parentPlaceId: ids.dock,
      width: 12,
      height: 8,
      entries: [{ id: 'gangway', x: 1, y: 4 }],
      exits: [{ id: 'hatch', name: 'the hatch', x: 0, y: 4, to: 'out' }],
    });
    const lower = await ok('add_map', {
      worldId: W,
      kind: 'grid',
      name: 'Lower deck',
      parentPlaceId: ids.dock,
      width: 12,
      height: 8,
    });
    expect(lower.warnings.join(' ')).toMatch(/already opens/);
    ids.upper = upper.map.mapId;
    ids.lower = lower.map.mapId;

    const listed = await ok('list_maps', { worldId: W });
    const shape = (n) => [n.name, n.kind, (n.children || []).map(shape)];
    expect(shape(listed.tree)).toEqual([
      'Andor Reach',
      'region',
      [
        [
          'The Vega system',
          'region',
          [
            [
              'Vega Station',
              'area',
              [
                ['Lower deck', 'grid', []],
                ['Upper deck', 'grid', []],
              ],
            ],
          ],
        ],
      ],
    ]);
    // Each map with its grade (a draft is graded).
    expect(listed.tree).toMatchObject({ band: expect.any(String), score: expect.any(Number) });
    const map = await ok('get_map', { worldId: W, mapId: ids.system });
    expect(map.trail.map((t) => t.mapId)).toEqual(['map_world', ids.system]);
    expect(map.places.map((p) => p.name).sort()).toEqual(['Vega Gate', 'Vega Station']);
    expect(map.children).toEqual([
      { mapId: ids.area, kind: 'area', name: 'Vega Station', opensFrom: ids.station },
    ]);
    expect(map.grade).toMatchObject({ band: expect.any(String) });
  });

  test('two-way stairs between two new floors in one call', async () => {
    const W = ids.world;
    const made = await ok('add_exit', {
      worldId: W,
      from: { mapId: ids.upper, x: 10, y: 6 },
      to: { mapId: ids.lower, x: 10, y: 1 },
      name: 'the stairs down',
      backName: 'the stairs up',
      twoWay: true,
    });
    expect(made.exits.map((x) => [x.mapId, x.name, x.to.map])).toEqual([
      [ids.upper, 'the stairs down', ids.lower],
      [ids.lower, 'the stairs up', ids.upper],
    ]);
    const world = await loaded(W);
    const down = world.battleMaps[ids.upper].exits.find((x) => x.name === 'the stairs down');
    expect(world.battleMaps[ids.lower].entries.some((e) => e.id === down.to.entry)).toBe(true);
    // Places on maps: an exit from Sol to the station, both ways, with its time.
    const exits = await ok('add_exit', {
      worldId: W,
      from: { placeId: ids.station },
      to: { placeId: ids.vega },
      name: 'the courier lane',
      seconds: 3600,
      twoWay: true,
    });
    expect(exits.exits).toHaveLength(2);
  });

  test('cell "auto" and view_image’s figures on a grid three maps deep', async () => {
    const W = ids.world;
    const placed = await ok('place_figures', {
      worldId: W,
      mapId: ids.upper,
      figures: [{ id: 'raiders', name: 'Raider', statBlock: GOBLIN, cells: ['auto', 'auto'] }],
    });
    expect(placed.figures[0].named.map((f) => f.name)).toEqual(['Raider 1', 'Raider 2']);
    const seen = await call('view_image', { worldId: W, of: 'battleMap', id: ids.upper });
    expect(seen.isError).toBeFalsy();
    const text = seen.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join(' ');
    expect(text).toMatch(/Raider/);
  });

  test('set_grid and set_area_ground change maps made at depth', async () => {
    const W = ids.world;
    const grid = await ok('set_grid', {
      worldId: W,
      mapId: ids.lower,
      features: [{ id: 'crates', name: 'the crates', x: 5, y: 5 }],
    });
    expect(grid.updated).toEqual(['features']);
    const groundSet = await ok('set_area_ground', {
      worldId: W,
      mapId: ids.area,
      buildings: [
        {
          name: 'the hab block',
          points: [
            { x: 100, y: 100 },
            { x: 300, y: 100 },
            { x: 300, y: 300 },
          ],
        },
      ],
    });
    expect(groundSet.updated).toEqual(['buildings']);
  });

  test('a shortcut tool’s change shows up through the new tools', async () => {
    const W = ids.world;
    const { added } = await ok('add_locations', {
      worldId: W,
      locations: [{ name: 'Deneb Outpost', kind: 'poi', x: 200, y: 200, description: 'A relay.' }],
    });
    const id = added[0].id;
    const top = await ok('get_map', { worldId: W, mapId: 'map_world' });
    expect(top.places.map((p) => p.id)).toEqual(expect.arrayContaining([id, ids.vega]));
  });

  test('the work list and the page’s completion cover every map', async () => {
    const W = ids.world;
    const work = await ok('list_work', { worldId: W, kind: 'map' });
    // The lower deck, with no way off it, and nothing else built enough yet.
    expect(work.items.every((i) => i.kind === 'map')).toBe(true);
    const service = require('../functions/cartographer/service').createCartographerService({
      db,
      bucket: null,
      writer: createFirestoreWorldWriter(() => db),
    });
    const done = await service.worldCompletion({ worldIds: [W] });
    const tree = done.worlds[W].maps;
    expect(tree).toMatchObject({ mapId: 'map_world', children: [{ mapId: ids.system }] });
    expect(tree.children[0].children[0].children.map((c) => c.name).sort()).toEqual([
      'Lower deck',
      'Upper deck',
    ]);
  });
});
