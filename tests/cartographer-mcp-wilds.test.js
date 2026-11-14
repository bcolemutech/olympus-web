'use strict';

/**
 * Terrain speed and danger over MCP (planning/off-road-travel.md §4.1, TR2,
 * TR4, EV6; L-361 / #835), driven by a real MCP client through
 * /mcp/cartographer against the Firestore emulator: set_wilds changes how a
 * world's ground (built-in or its own) is crossed, merged by key and reset
 * with null, and refuses what isn't ground or is out of range; list_materials
 * shows each ground's values; add_regions and update_region set a region's
 * danger, get_region shows it, and null takes it back; and the world as
 * loaded plans a crossing on its top map with all of it.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-wilds --verbose"
 */

const PROJECT = 'demo-cartographer-wilds';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-wilds';
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

const loomCanon = require('../functions/loom-canon');
const frames = require('../functions/loom-canon/frames');
const wildPlan = require('../functions/loom-canon/wild-plan');
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

const db = getFirestore(initializeApp({ projectId: PROJECT }, 'cartographer-wilds-test'));
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
  client = new Client({ name: 'cartographer-wilds-test', version: '0.0.0' });
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
});

describe('how a world’s ground is crossed', () => {
  let worldId;
  let place;
  let regionId;

  beforeAll(async () => {
    ({ worldId } = await ok('create_world', {
      name: 'The Wildmarch',
      width: 1000,
      height: 800,
      milesPerUnit: 2,
    }));
    const { added } = await ok('add_locations', {
      worldId,
      locations: [
        { name: 'Westwick', x: 100, y: 400, population: 900 },
        { name: 'Eastholm', x: 900, y: 400, population: 900 },
      ],
    });
    place = Object.fromEntries(added.map((a) => [a.name, a.id]));
    await ok('set_world_materials', {
      worldId,
      set: [{ id: 'deadwood', name: 'Deadwood', like: 'forest' }],
    });
    await ok('set_ground', {
      worldId,
      mapId: 'map_world',
      set: [
        { id: 'land', material: 'grassland', shape: { rect: { x: 0, y: 0, w: 1000, h: 800 } } },
        { id: 'wood', material: 'deadwood', shape: { rect: { x: 300, y: 0, w: 400, h: 800 } } },
      ],
    });
  });

  test('list_materials shows each ground’s wild values, the world’s own like its like', async () => {
    const { materials } = await ok('list_materials', { worldId, kind: 'ground' });
    const by = Object.fromEntries(materials.map((m) => [m.id, m]));
    expect(by.forest.wild).toEqual({ speed: 0.5, danger: 1 });
    expect(by.ocean.wild).toEqual({ speed: 0, danger: 1, impassable: true });
    expect(by.deadwood).toMatchObject({
      own: true,
      like: 'forest',
      wild: { speed: 0.5, danger: 1 },
    });
  });

  test('set_wilds changes a material, merged by key; null resets a key or a material', async () => {
    const out = await ok('set_wilds', {
      worldId,
      set: { deadwood: { speed: 0.25, danger: 1.5 }, mountains: { impassable: true } },
    });
    expect(out.materials).toEqual({
      deadwood: { speed: 0.25, danger: 1.5 },
      mountains: { speed: 0, danger: 1, impassable: true },
    });
    await ok('set_wilds', { worldId, set: { deadwood: { danger: null } } });
    let stored = (await worlds().doc(worldId).get()).data().wilds;
    expect(stored).toEqual({
      materials: { deadwood: { speed: 0.25 }, mountains: { impassable: true } },
    });
    await ok('set_wilds', { worldId, set: { mountains: null } });
    stored = (await worlds().doc(worldId).get()).data().wilds;
    expect(stored).toEqual({ materials: { deadwood: { speed: 0.25 } } });
    const world = await loaded(worldId);
    expect(world.wilds).toEqual({ materials: { deadwood: { speed: 0.25 } } });
    const { materials } = await ok('list_materials', { worldId, kind: 'ground' });
    expect(materials.find((m) => m.id === 'deadwood').wild).toEqual({ speed: 0.25, danger: 1 });
  });

  test('set_wilds refuses what isn’t ground and values out of range, writing nothing', async () => {
    const before = (await worlds().doc(worldId).get()).data().canonVersion;
    expect(await refused('set_wilds', { worldId, set: { plasma: { speed: 1 } } })).toMatch(
      /"plasma" is no ground material/
    );
    expect(await refused('set_wilds', { worldId, set: { forest: { danger: 5 } } })).toMatch(
      /danger/
    );
    expect(await refused('set_wilds', { worldId, set: { forest: { speed: 0 } } })).toMatch(/speed/);
    expect(await refused('set_wilds', { worldId, set: {} })).toMatch(/Give a material/);
    expect((await worlds().doc(worldId).get()).data().canonVersion).toBe(before);
  });

  test('a region’s danger: set by add_regions and update_region, shown by get_region', async () => {
    const made = await ok('add_regions', {
      worldId,
      regions: [{ name: 'The Grey Wood', danger: 2 }, { name: 'The Fields' }],
    });
    regionId = made.regions[0].id;
    const fields = made.regions[1].id;
    expect((await ok('get_region', { worldId, regionId })).danger).toBe(2);
    expect((await ok('get_region', { worldId, regionId: fields })).danger).toBeNull();
    await ok('update_region', { worldId, regionId: fields, danger: 0.5 });
    expect((await ok('get_region', { worldId, regionId: fields })).danger).toBe(0.5);
    await ok('update_region', { worldId, regionId: fields, danger: null });
    const stored = (await worlds().doc(worldId).collection('regions').doc(fields).get()).data();
    expect('danger' in stored).toBe(false);
    expect(await refused('update_region', { worldId, regionId, danger: 3 })).toMatch(/danger/);
    expect(
      await refused('add_regions', { worldId, regions: [{ name: 'Calm', danger: 0.1 }] })
    ).toMatch(/danger/);
    await ok('set_zones', {
      worldId,
      mapId: 'map_world',
      set: [{ id: 'grey', region: regionId, shape: { rect: { x: 300, y: 0, w: 400, h: 800 } } }],
    });
  });

  test('the world as loaded plans a crossing with its ground, overrides and danger', async () => {
    const world = await loaded(worldId);
    const play = frames.playWorld(world);
    const view = frames.viewFor(play, play.topMapId);
    const crossing = wildPlan.planOn(view, place.Westwick, place.Eastholm, { state: {} });
    expect(crossing).not.toBeNull();
    // Within a cell or two of the straight line (a cell is 5 units here).
    const near = (value, expected) => {
      expect(value).toBeGreaterThanOrEqual(expected * 0.999);
      expect(value).toBeLessThan(expected * 1.02);
    };
    near(crossing.distance, 800 * 2);
    // 400 units of grassland at speed 1 and 400 of deadwood at 0.25, 2 mi a
    // unit, 1.5 mph.
    near(crossing.hours, (400 * 2) / 1.5 + (400 * 2) / (1.5 * 0.25));
    expect(crossing.terrain.map((t) => t.material).sort()).toEqual(['deadwood', 'grassland']);
    // Half the way in a region of danger 2.
    expect(crossing.danger).toBeGreaterThan(1.4);
    expect(crossing.danger).toBeLessThan(1.6);
    // A road between them is quicker, and taken.
    await ok('connect_locations', {
      worldId,
      fromId: place.Westwick,
      toId: place.Eastholm,
      via: 'road',
    });
    const after = frames.viewFor(frames.playWorld(await loaded(worldId)), play.topMapId);
    const byRoad = wildPlan.planOn(after, place.Westwick, place.Eastholm, { state: {} });
    expect(byRoad.legs.map((l) => l.by)).toEqual(['route']);
    expect(byRoad.hours).toBeCloseTo((800 * 2 * 1.25) / 3, 6);
  });
});
