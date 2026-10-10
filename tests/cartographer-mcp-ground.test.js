'use strict';

/**
 * A town's ground over MCP (planning/the-loom-movement-and-vision.md §7;
 * L-653 / #465), driven by a real MCP client against Nisia in the Firestore
 * emulator: set_town_ground lays out Burdendal's wall, river and bridge,
 * refusing ground its doors can't live with; get_town sums it up; once a town
 * has ground, adding, moving and removing places keeps its doors on open
 * ground and walkable; list_work flags towns without ground.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-ground --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-ground';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const fs = require('fs');
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

const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { loadDraftWorld } = require('../functions/cartographer/load');
const { GATEWAY } = require('./helpers/towns');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');

const CANONICAL = 'https://bcoletech.com';
const W = 'nisia-g1g1g1'; // published

const adminApp = initializeApp(
  { projectId: 'demo-cartographer-ground' },
  'cartographer-ground-test'
);
const db = getFirestore(adminApp);
const worlds = () => db.collection('loom_worlds');
const PARSED = parseAzgaarExport(
  fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
);

const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader: createFirestoreWorldReader(() => db),
    writer: createFirestoreWorldWriter(() => db),
  })
);
const oauthStore = createInMemoryStore();
let server;
let client;

// Every place needs a battle map to be open (L-622): new places here get the
// generic gateway, as Claude would give them a map.
async function call(name, args) {
  const withMap =
    name === 'add_place' && args && !('battleMap' in args)
      ? { ...args, battleMap: GATEWAY.id }
      : args;
  return client.callTool({ name, arguments: withMap });
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
const place = async (worldId, id) =>
  (await worlds().doc(worldId).collection('places').doc(id).get()).data();

async function importNisia(worldId, published) {
  await loadDraftWorld({
    db,
    mapped: mapToCanon(PARSED),
    source: PARSED.source,
    uploadedBy: 'builder-001',
    worldId,
  });
  if (published) {
    await worlds()
      .doc(worldId)
      .update({ status: 'published', rules: { startingLocationId: 'loc_1' }, canonVersion: 2 });
  }
}

beforeAll(async () => {
  await db.recursiveDelete(worlds());
  await importNisia(W, true);
  await worlds().doc(W).collection('battleMaps').doc(GATEWAY.id).set(GATEWAY);
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
  client = new Client({ name: 'cartographer-ground-test', version: '0.0.0' });
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
  await db.terminate();
});

const pt = (x, y) => ({ x, y });
const rect = (x0, y0, x1, y1) => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)];
const WALL = {
  name: 'the town wall',
  points: [pt(450, 900), pt(100, 900), pt(100, 100), pt(900, 100), pt(900, 900), pt(550, 900)],
};
const RIVER = { name: 'the Dal', points: rect(0, 480, 1000, 520) };
const BRIDGE = { name: 'the old bridge', kind: 'bridge', points: rect(480, 470, 520, 530) };
const INN = { name: 'the Gull', points: rect(600, 600, 700, 650) };
const BURDENDAL = { buildings: [INN], water: [RIVER], walls: [WALL], crossings: [BRIDGE] };

const setGround = (args) => call('set_town_ground', { worldId: W, locationId: 'loc_1', ...args });
const getTown = (args = {}) => ok('get_town', { worldId: W, locationId: 'loc_1', ...args });
const loc1 = async () => (await worlds().doc(W).collection('locations').doc('loc_1').get()).data();
const ids = {};

beforeAll(async () => {
  // Burdendal's places, doors placed for the ground to come: the south gate,
  // the market, the mill across the river.
  ids.gate = (
    await ok('add_place', {
      worldId: W,
      locationId: 'loc_1',
      name: 'The South Gate',
      kind: 'gate',
      description: 'The road comes in under the arch.',
      entranceFor: ['road', 'trail', 'sea'],
      position: pt(500, 900),
    })
  ).place.id;
  ids.market = (
    await ok('add_place', {
      worldId: W,
      locationId: 'loc_1',
      name: 'Market Square',
      kind: 'market',
      description: 'Stalls and gulls.',
      connectTo: [ids.gate],
      position: pt(500, 700),
    })
  ).place.id;
  ids.mill = (
    await ok('add_place', {
      worldId: W,
      locationId: 'loc_1',
      name: 'The Mill',
      kind: 'mill',
      description: 'Its wheel turns in the Dal.',
      connectTo: [ids.market],
      position: pt(300, 300),
    })
  ).place.id;
}, 60000);

test('set_town_ground is there, and changes the world', async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'set_town_ground');
  expect(tool.annotations.readOnlyHint).toBe(false);
  expect(Object.keys(tool.inputSchema.properties)).toEqual(
    expect.arrayContaining(['buildings', 'water', 'walls', 'crossings'])
  );
});

test('a town without ground says so', async () => {
  expect((await getTown()).ground).toBeNull();
});

describe('setting Burdendal’s ground', () => {
  test('refused: a door inside a building, with the reason', async () => {
    const result = await setGround({
      ...BURDENDAL,
      buildings: [{ points: rect(250, 250, 350, 350) }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(
      /The Mill \(plc_[a-z0-9_-]+\)’s door \(300, 300\) is inside the building 1\./
    );
    expect((await loc1()).town).toBeUndefined();
  });

  test('refused: no bridge leaves the mill across the river', async () => {
    const result = await setGround({ ...BURDENDAL, crossings: [] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Can’t be walked to from a way in: The Mill/);
  });

  test('refused: shapes that won’t do, by the schema or the checks', async () => {
    const outside = await setGround({ walls: [{ points: [pt(10, 10), pt(1200, 10)] }] });
    expect(outside.isError).toBe(true);
    const bowtie = await setGround({
      buildings: [{ points: [pt(0, 0), pt(10, 10), pt(10, 0), pt(0, 10)] }],
    });
    expect(bowtie.isError).toBe(true);
    expect(bowtie.content[0].text).toMatch(/crosses itself/);
    const dry = await setGround({ water: [RIVER], crossings: [{ points: rect(10, 10, 20, 20) }] });
    expect(dry.content[0].text).toMatch(/over no water/);
    expect(await refused('set_town_ground', { worldId: W, locationId: 'loc_1' })).toMatch(
      /Give buildings, water, walls or crossings/
    );
    expect(
      await refused('set_town_ground', { worldId: W, locationId: 'poi_1', buildings: [] })
    ).toMatch(/isn't a settlement/);
  });

  test('a gate in the wall and a bridge over the river: set, and summed up', async () => {
    const set = await ok('set_town_ground', { worldId: W, locationId: 'loc_1', ...BURDENDAL });
    expect(set.updated).toEqual(['buildings', 'water', 'walls', 'crossings']);
    expect(set.ground).toMatchObject({
      buildings: { count: 1, named: ['the Gull'] },
      water: { count: 1, named: ['the Dal'] },
      walls: { count: 1, named: ['the town wall'] },
      crossings: { count: 1, named: ['the old bridge'] },
      problems: [],
    });
    expect((await loc1()).town.ground).toEqual(BURDENDAL);
    const summary = (await getTown()).ground;
    expect(summary.problems).toEqual([]);
    expect(summary.shapes).toBeUndefined();
    expect((await getTown({ groundShapes: true })).ground.shapes).toEqual(BURDENDAL);
  });

  test('a list left out is kept; one given replaces it', async () => {
    const ford = { name: 'the ford', kind: 'ford', points: rect(200, 470, 260, 530) };
    const set = await ok('set_town_ground', {
      worldId: W,
      locationId: 'loc_1',
      crossings: [BRIDGE, ford],
    });
    expect(set.updated).toEqual(['crossings']);
    const stored = (await loc1()).town.ground;
    expect(stored.walls).toEqual([WALL]);
    expect(stored.crossings).toEqual([BRIDGE, ford]);
    await ok('set_town_ground', { worldId: W, locationId: 'loc_1', crossings: [BRIDGE] });
  });
});

describe('places in a town with ground', () => {
  test('moving a door into the river or a building is refused; onto the bridge is fine', async () => {
    expect(
      await refused('update_place', { worldId: W, placeId: ids.mill, position: pt(300, 500) })
    ).toMatch(/door \(300, 500\) is in the water 1 "the Dal"/);
    expect(
      await refused('update_place', { worldId: W, placeId: ids.market, position: pt(650, 625) })
    ).toMatch(/inside the building 1 "the Gull"/);
    expect(
      await refused('update_place', { worldId: W, placeId: ids.mill, position: null })
    ).toMatch(/has no door \(position\)/);
    await ok('update_place', { worldId: W, placeId: ids.mill, position: pt(500, 500) });
    await ok('update_place', { worldId: W, placeId: ids.mill, position: pt(300, 300) });
  });

  test('a new place needs a door on open ground', async () => {
    const base = {
      worldId: W,
      locationId: 'loc_1',
      kind: 'tavern',
      description: 'Low beams.',
      connectTo: [ids.market],
    };
    expect(await refused('add_place', { ...base, name: 'The Gull' })).toMatch(
      /The Gull \(plc_[a-z0-9_-]+\) has no door \(position\) in town/
    );
    expect(
      await refused('add_place', { ...base, name: 'The Gull', position: pt(650, 620) })
    ).toMatch(/inside the building 1 "the Gull"/);
    await ok('add_place', { ...base, name: 'The Gull', position: pt(650, 650) });
  });

  test('ground that strands a place is refused after the fact too', async () => {
    expect(
      (await setGround({ walls: [WALL, { points: [...rect(250, 250, 350, 350), pt(250, 250)] }] }))
        .content[0].text
    ).toMatch(/Can’t be walked to from a way in: The Mill/);
  });
});

describe('list_work and clearing the ground', () => {
  test('settlements say whether their town has ground; need ground lists those without', async () => {
    const all = await ok('list_work', { worldId: W, kind: 'settlement', limit: 100 });
    const burdendal = all.items.find((item) => item.id === 'loc_1');
    if (burdendal) expect(burdendal.ground).toBe(true);
    expect(all.items.every((item) => typeof item.ground === 'boolean')).toBe(true);
    const without = await ok('list_work', { worldId: W, need: 'ground', limit: 100 });
    expect(without.total).toBeGreaterThan(0);
    expect(without.items.every((item) => item.kind === 'settlement' && !item.ground)).toBe(true);
    expect(without.items.map((item) => item.id)).not.toContain('loc_1');
    expect(without.howTo.ground).toMatch(/set_town_ground/);
  });

  test('empty lists clear it, and the town is open ground again', async () => {
    const set = await ok('set_town_ground', {
      worldId: W,
      locationId: 'loc_1',
      buildings: [],
      water: [],
      walls: [],
      crossings: [],
    });
    expect(set.ground).toBeNull();
    expect((await loc1()).town).toEqual({}); // town.ground removed
    expect((await getTown()).ground).toBeNull();
    // Without ground, doors go anywhere again.
    await ok('update_place', { worldId: W, placeId: ids.mill, position: pt(300, 500) });
    const listed = await ok('list_work', { worldId: W, need: 'ground', limit: 100 });
    expect(listed.items.map((item) => item.id)).toContain('loc_1');
  });
});
