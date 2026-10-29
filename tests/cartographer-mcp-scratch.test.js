'use strict';

/**
 * Worlds from scratch (planning/builders-tools.md §4.1; L-391 / #737), driven
 * by a real MCP client through /mcp/cartographer against the Firestore
 * emulator: create_world with a backdrop, add_locations, connect_locations in
 * batch, a town opened with add_place, and publishing; then the world played
 * through the Loom's own callables with Gemini mocked (travel takes its time,
 * loomGetMap returns the backdrop). And a place added to Nisia, an imported
 * world, between Hatham and Daldockley, reachable by its new route.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-scratch --verbose"
 */

const PROJECT = 'demo-cartographer-scratch';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-scratch';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomCreateSave, loomPlayTurn, loomGetMap } = require('../functions/index');

const fs = require('fs');
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

const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { loadDraftWorld } = require('../functions/cartographer/load');
const loomCanon = require('../functions/loom-canon');
const travel = require('../functions/loom-canon/travel');
const clock = require('../functions/loom-canon/clock');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const { GATEWAY, offMap } = require('./helpers/towns');
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
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };

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
  client = new Client({ name: 'cartographer-scratch-test', version: '0.0.0' });
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

// The combat test world's shape (§5): a fort hub, two towns and five sites.
const FORT = { name: 'Fort Vigil', kind: 'poi', x: 500, y: 400, markerType: 'fort' };
const TOWNS = [
  { name: 'Ashwick', x: 300, y: 400, population: 1200, description: 'Mud lanes and a mill.' },
  { name: 'Brennock', x: 700, y: 400, population: 800, port: true, description: 'A river port.' },
];
const SITES = ['The Barrow', 'Wolf Hollow', 'Old Quarry', 'The Hulks', 'Red Ford'].map(
  (name, i) => ({ name, kind: 'poi', x: 400 + i * 50, y: 600, markerType: 'ruins' })
);

describe('a world from scratch', () => {
  test('create_world makes a draft with a backdrop and a system', async () => {
    const made = await ok('create_world', {
      name: 'The Proving Grounds',
      systemId: 'pool-scifi',
      backdrop: { colour: '#334455' },
      width: 1000,
      height: 800,
      milesPerUnit: 0.5,
    });
    expect(made).toMatchObject({
      worldId: expect.stringMatching(/^the-proving-grounds-[0-9a-f]{6}$/),
      status: 'draft',
      system: { id: 'pool-scifi' },
      map: { width: 1000, height: 800, backdrop: '#334455' },
    });
    expect((await worlds().doc(made.worldId).get()).data()).toMatchObject({
      status: 'draft',
      systemId: 'pool-scifi',
      source: { kind: 'scratch', createdBy: BUILDER },
      map: { width: 1000, height: 800, backdrop: '#334455', distance: { perMapUnit: 0.5 } },
    });
    const world = await ok('get_world', { worldId: made.worldId });
    expect(world.source).toEqual({ kind: 'scratch' });
    expect(world.map.backdrop).toBe('#334455');
  });

  test('refuses an unknown system or a bad colour', async () => {
    expect(await refused('create_world', { name: 'X', systemId: 'nope' })).toMatch(
      /No system "nope"/
    );
    expect(await refused('create_world', { name: 'X', backdrop: { colour: 'green' } })).toMatch(
      /#rrggbb/
    );
  });

  test('built in a few calls, published and played', async () => {
    mockCallGemini.mockReset();
    const { worldId } = await ok('create_world', {
      name: 'Combat Test',
      milesPerUnit: 0.1,
    });
    // The generic battle map, for places that need one.
    await worlds().doc(worldId).collection('battleMaps').doc(GATEWAY.id).set(GATEWAY);

    // A fort, two towns and five sites in one call…
    const { added } = await ok('add_locations', {
      worldId,
      locations: [FORT, ...TOWNS, ...SITES],
    });
    expect(added).toHaveLength(8);
    const id = Object.fromEntries(added.map((a) => [a.name, a.id]));
    expect(id).toMatchObject({ 'Fort Vigil': 'poi_fort-vigil', Ashwick: 'loc_ashwick' });

    // …linked in one call: the fort the hub.
    const links = [
      { fromId: id['Fort Vigil'], toId: id.Ashwick },
      { fromId: id['Fort Vigil'], toId: id.Brennock, via: 'trail' },
      { fromId: id.Ashwick, toId: id.Brennock, via: 'road' },
      ...SITES.map((s) => ({ fromId: id['Fort Vigil'], toId: id[s.name], via: 'trail' })),
    ];
    const linked = await ok('connect_locations', { worldId, links });
    expect(linked.connections).toHaveLength(8);
    let world = await loaded(worldId);
    expect(world.locations[id['Fort Vigil']].connections.slice().sort()).toEqual(
      [id.Ashwick, id.Brennock, ...SITES.map((s) => id[s.name])].sort()
    );
    expect(world.locations[id.Brennock].geo.links).toEqual({
      [id['Fort Vigil']]: 'trail',
      [id.Ashwick]: 'road',
    });
    expect(world.locations[id.Ashwick].geo).toMatchObject({
      kind: 'settlement',
      x: 300,
      y: 400,
      population: 1200,
      port: false,
    });
    expect(world.locations[id.Ashwick].sources).toEqual({ description: 'mcp' });

    // Open both towns with add_place, and publish with Ashwick as the start.
    for (const town of TOWNS) {
      await ok('add_place', {
        worldId,
        locationId: id[town.name],
        name: `${town.name} Gate`,
        kind: 'gate',
        description: 'A gate on the road.',
        entranceFor: ['road', 'trail'],
        battleMap: GATEWAY.id,
      });
    }
    await ok('update_world', {
      worldId,
      openingHook: 'The muster bell rings.',
      startingLocationId: id.Ashwick,
    });
    expect(await ok('publish_world', { worldId })).toMatchObject({ status: 'published' });

    // Played: the map has the backdrop, and the road to Brennock takes its time.
    mockCallGemini.mockImplementation(async (options) => {
      if (options.systemInstruction.includes('INTERPRET stage')) {
        return { verb: 'move', targets: [id.Brennock], params: {} };
      }
      if (options.systemInstruction.includes('summarizer')) return 'A summary.';
      return { narration: 'The road unwinds.', inventedEntities: [], suggestedActions: [] };
    });
    const { saveId } = await loomCreateSave.run({
      data: { worldId, name: 'Muster', characterName: 'Tam' },
      auth: PLAYER,
    });
    const view = await loomGetMap.run({ data: { worldId, saveId }, auth: PLAYER });
    expect(view.map).toMatchObject({ width: 1600, height: 1200, backdrop: '#26332a' });
    // Off the gate's map, in town, so the move sets out.
    await offMap(db, saveId);
    const before = (await db.collection('loom_saves').doc(saveId).get()).data();
    await loomPlayTurn.run({
      data: { worldId, saveId, actionText: 'take the road to Brennock' },
      auth: PLAYER,
    });
    const after = (await db.collection('loom_saves').doc(saveId).get()).data();
    expect(after.location).toBe(id.Brennock);
    world = await loaded(worldId);
    const trip = travel.trip(world, id.Ashwick, id.Brennock, clock.timeOf(before));
    expect(trip.seconds).toBeGreaterThan(0);
    expect(clock.timeOf(after) - clock.timeOf(before)).toBeGreaterThanOrEqual(trip.seconds);
  });

  test('add_locations refuses repeats, places off the map and facts of the wrong kind', async () => {
    const { worldId } = await ok('create_world', { name: 'Refusals', width: 500, height: 500 });
    await ok('add_locations', { worldId, locations: [{ name: 'Kell', x: 10, y: 10 }] });
    expect(
      await refused('add_locations', { worldId, locations: [{ name: 'kell', x: 20, y: 20 }] })
    ).toMatch(/already has that name/);
    expect(
      await refused('add_locations', {
        worldId,
        locations: [
          { name: 'Dun', x: 1, y: 1 },
          { name: 'DUN', x: 2, y: 2 },
        ],
      })
    ).toMatch(/given twice/);
    expect(
      await refused('add_locations', { worldId, locations: [{ name: 'Far', x: 900, y: 10 }] })
    ).toMatch(/off the map \(500 × 500\)/);
    expect(
      await refused('add_locations', {
        worldId,
        locations: [{ name: 'Cairn', kind: 'poi', x: 5, y: 5, population: 10 }],
      })
    ).toMatch(/population is for settlements/);
    // Nothing from a refused call was written.
    expect(Object.keys((await loaded(worldId)).locations)).toEqual(['loc_kell']);
  });

  test('connect_locations takes one pair or many, never both, never a place to itself', async () => {
    const { worldId } = await ok('create_world', { name: 'Links' });
    await ok('add_locations', {
      worldId,
      locations: [
        { name: 'Ayle', x: 10, y: 10 },
        { name: 'Bree', x: 20, y: 10 },
      ],
    });
    expect(
      await refused('connect_locations', {
        worldId,
        fromId: 'loc_ayle',
        toId: 'loc_bree',
        links: [{ fromId: 'loc_ayle', toId: 'loc_bree' }],
      })
    ).toMatch(/not both/);
    expect(await refused('connect_locations', { worldId })).toMatch(/Give fromId and toId/);
    expect(
      await refused('connect_locations', {
        worldId,
        links: [{ fromId: 'loc_ayle', toId: 'loc_ayle' }],
      })
    ).toMatch(/Link 1: A place can’t connect to itself/);
    // The single form still answers as before.
    expect(
      await ok('connect_locations', { worldId, fromId: 'loc_ayle', toId: 'loc_bree', via: 'sea' })
    ).toMatchObject({ connection: { via: 'sea' } });
  });
});

describe('a place added to Nisia', () => {
  test('between Hatham and Daldockley, reachable by its new route', async () => {
    const parsed = parseAzgaarExport(
      fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
    );
    const worldId = 'nisia-scratch';
    await loadDraftWorld({
      db,
      mapped: mapToCanon(parsed),
      source: parsed.source,
      uploadedBy: BUILDER,
      worldId,
    });
    // Hatham (loc_450) and Daldockley (loc_191): the smugglers' trail between.
    const { added } = await ok('add_locations', {
      worldId,
      locations: [
        {
          name: "Smugglers' Camp",
          kind: 'poi',
          x: 154.8,
          y: 613.4,
          markerType: 'camp',
          description: 'Tarps in the gorse, and a lantern hung low.',
        },
      ],
    });
    const camp = added[0].id;
    await ok('connect_locations', {
      worldId,
      links: [
        { fromId: 'loc_450', toId: camp, via: 'trail' },
        { fromId: camp, toId: 'loc_191', via: 'trail' },
      ],
    });
    const world = await loaded(worldId);
    expect(world.locations[camp].connections.slice().sort()).toEqual(['loc_191', 'loc_450']);
    expect(world.locations.loc_450.geo.links[camp]).toBe('trail');
    // Hatham's own links are kept.
    expect(world.locations.loc_450.connections).toEqual(
      expect.arrayContaining(['loc_191', 'loc_281', 'loc_445', camp])
    );
    for (const end of ['loc_450', 'loc_191']) {
      const trip = travel.trip(world, end, camp, clock.START);
      expect(trip).toMatchObject({ seconds: expect.any(Number) });
      expect(trip.seconds).toBeGreaterThan(0);
    }
  });
});
