'use strict';

/**
 * Events on the way over MCP (planning/off-road-travel.md §4.5, EV2; L-364 /
 * #838), driven by a real MCP client through /mcp/cartographer against the
 * Firestore emulator: set_encounters writes a table on a region, a region map
 * or the world (refusing what doesn't fit, writing nothing), get_region,
 * get_map and get_world show it, [] takes it away, and a journey's turn on
 * the world as loaded records the roll and the event from the region's table
 * where it camps, and the world's where it doesn't.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-encounters --verbose"
 */

jest.mock('../functions/gemini', () => ({ callGemini: jest.fn() }));
jest.mock('../functions/loom-turn/retrieval', () => ({
  retrieveContextForEntities: jest.fn(),
}));

const PROJECT = 'demo-cartographer-encounters';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-encounters';
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
const clock = require('../functions/loom-canon/clock');
const events = require('../functions/loom-modules/wilds/events');
const { evaluate } = require('../functions/loom-turn/adjudicate');
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

const db = getFirestore(initializeApp({ projectId: PROJECT }, 'cartographer-encounters-test'));
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
  client = new Client({ name: 'cartographer-encounters-test', version: '0.0.0' });
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


describe('events on the way, set by Claude', () => {
  let worldId;
  let place;
  let regionId;
  const RAIN = 'A cold rain sets in under the Greenwood’s boughs.';

  beforeAll(async () => {
    ({ worldId } = await ok('create_world', {
      name: 'The Greenmarch',
      // 40 × 24 miles, in tenths.
      width: 400,
      height: 240,
      milesPerUnit: 0.1,
    }));
    const { added } = await ok('add_locations', {
      worldId,
      locations: [
        { name: 'Westwick', x: 20, y: 100, population: 900 },
        { name: 'Eastholm', x: 300, y: 100, population: 900 },
      ],
    });
    place = Object.fromEntries(added.map((a) => [a.name, a.id]));
    await ok('set_ground', {
      worldId,
      mapId: 'map_world',
      set: [
        { id: 'land', material: 'grassland', shape: { rect: { x: 0, y: 0, w: 400, h: 240 } } },
        { id: 'wood', material: 'forest', shape: { rect: { x: 50, y: 0, w: 130, h: 240 } } },
      ],
    });
    const made = await ok('add_regions', {
      worldId,
      regions: [{ name: 'The Greenwood', danger: 2 }],
    });
    regionId = made.regions[0].id;
    await ok('set_zones', {
      worldId,
      mapId: 'map_world',
      set: [{ id: 'z-wood', region: regionId, shape: { rect: { x: 50, y: 0, w: 130, h: 240 } } }],
    });
    await ok('set_stat_block', {
      worldId,
      blocks: [
        {
          id: 'wolf',
          name: 'Wolf',
          statBlock: { attributes: { STR: 12, DEX: 14, CON: 12, INT: 3, WIS: 12, CHA: 6 } },
        },
      ],
    });
    // Off-road travel with the cap's chance, so a hit is easy to find.
    await ok('update_world', { worldId, wilds: { eventChance: 0.95 } });
  });

  test('set_encounters writes a region’s table, shown by get_region', async () => {
    const rows = [
      { text: RAIN, kind: 'weather', terrain: ['forest'], weight: 3 },
      { what: 'wolf', count: 2, terrain: ['forest'] },
    ];
    const out = await ok('set_encounters', { worldId, regionId, rows });
    expect(out).toMatchObject({ on: { regionId, name: 'The Greenwood' }, rows: 2 });
    expect((await ok('get_region', { worldId, regionId })).encounters).toEqual(rows);
    const stored = (await worlds().doc(worldId).collection('regions').doc(regionId).get()).data();
    expect(stored.encounters).toEqual(rows);
    // Sending it again changes nothing.
    const before = (await worlds().doc(worldId).get()).data().canonVersion;
    await ok('set_encounters', { worldId, regionId, rows });
    expect((await worlds().doc(worldId).get()).data().canonVersion).toBe(before);
  });

  test('a map’s table and the world’s, shown by get_map and get_world', async () => {
    const mapRows = [{ text: 'A drover hurries his cattle past.', kind: 'travellers' }];
    const worldRows = [{ text: 'A shrine stands by the track.', kind: 'find' }];
    expect(await ok('set_encounters', { worldId, mapId: 'map_world', rows: mapRows })).toMatchObject(
      { on: { mapId: 'map_world' }, rows: 1 }
    );
    expect(await ok('set_encounters', { worldId, world: true, rows: worldRows })).toMatchObject({
      on: { world: true },
      rows: 1,
    });
    expect((await ok('get_map', { worldId, mapId: 'map_world' })).encounters).toEqual(mapRows);
    expect((await ok('get_world', { worldId })).encounters).toEqual(worldRows);
    expect((await worlds().doc(worldId).get()).data().encounters).toEqual(worldRows);
    expect(
      (await worlds().doc(worldId).collection('maps').doc('map_world').get()).data().encounters
    ).toEqual(mapRows);
  });

  test('what doesn’t fit is refused, and nothing is written', async () => {
    const before = (await worlds().doc(worldId).get()).data().canonVersion;
    const rows = [{ text: 'x', kind: 'find' }];
    expect(await refused('set_encounters', { worldId, rows })).toMatch(/Give exactly one of/);
    expect(
      await refused('set_encounters', { worldId, regionId, world: true, rows })
    ).toMatch(/Give exactly one of/);
    expect(
      await refused('set_encounters', { worldId, regionId, rows: [{ what: 'dragon' }] })
    ).toMatch(/"dragon" isn't one of the world's stat blocks/);
    expect(await refused('set_encounters', { worldId, regionId, rows: [{ weight: 2 }] })).toMatch(
      /needs a `what`/
    );
    expect(
      await refused('set_encounters', { worldId, regionId, rows: [{ text: 'Something.' }] })
    ).toMatch(/kind is needed/);
    expect(
      await refused('set_encounters', {
        worldId,
        regionId,
        rows: [{ text: 'Something.', kind: 'find', terrain: ['plasma'] }],
      })
    ).toMatch(/"plasma" is no ground material/);
    expect(await refused('set_encounters', { worldId, regionId: 'nowhere', rows })).toMatch(
      /No region "nowhere"/
    );
    expect(await refused('set_encounters', { worldId, mapId: 'nowhere', rows })).toMatch(
      /isn’t a region map/
    );
    expect((await worlds().doc(worldId).get()).data().canonVersion).toBe(before);
  });

  test('a journey’s turn records the roll and the event: the region’s table in the wood, the world’s outside', async () => {
    const play = frames.playWorld(await loaded(worldId));
    expect(play.encounters).toHaveLength(1);
    const START = clock.START;
    // A save whose first leg's roll hits at the cap.
    const idFor = (hit) => {
      for (let n = 0; n < 500; n++) {
        const id = `save-${n}`;
        if (events.rollOf(`${id}:1:${START}`, 0.95).happened === hit) return id;
      }
      throw new Error('none');
    };
    const walk = (seed, fields = {}, to = { targets: [place.Eastholm] }) => {
      const framed = frames.frameOf(play, {
        location: place.Westwick,
        discovered: [place.Westwick, place.Eastholm],
        visited: [place.Westwick],
        time: START,
        character: { name: 'Ash' },
        ...fields,
      });
      const proposed = {
        verb: 'travel',
        targets: to.targets || [],
        params: { offRoad: true, ...(to.point ? { to: { mapId: 'map_world', point: to.point } } : {}) },
      };
      return evaluate(proposed, {}, framed.save, (sides) => sides, framed.view, null, null, {
        seed,
      });
    };

    // Leg 1 camps in the Greenwood (a 12-mile day: three on the grass, the rest in the wood).
    const hit = walk(idFor(true));
    expect(hit.journey).toMatchObject({ offRoad: true, camp: true });
    expect(hit.event).toMatchObject({ chance: 0.95, happened: true, danger: 2, material: 'forest' });
    expect(hit.event.event).toMatchObject({ source: 'region', kind: expect.any(String) });
    // Either of the region's rows, as the seeded pick falls.
    expect([RAIN, 'You are set upon by 2 Wolf.']).toContain(hit.event.event.text);
    expect(hit.constraints.join(' ')).toContain(hit.event.event.text);
    // The roll that hit, from the seed.
    expect(hit.event.roll).toBe(events.rollOf(`${idFor(true)}:1:${START}`, 0.95).roll);

    // A miss records the roll too, with no event.
    const miss = walk(idFor(false));
    expect(miss.event).toMatchObject({ happened: false, chance: 0.95 });
    expect(miss.event.event).toBeUndefined();

    // Setting out from Eastholm for a point eight miles west, on the grassland
    // outside the wood: the region has no say there, so the map's table is next.
    const east = walk(idFor(true), { location: place.Eastholm }, { point: { x: 220, y: 100 } });
    expect(east.journey).toMatchObject({ arrived: true });
    expect(east.event).toMatchObject({ happened: true, danger: 1, material: 'grassland' });
    expect(east.event.event).toMatchObject({
      source: 'map',
      kind: 'travellers',
      text: 'A drover hurries his cattle past.',
    });
  });

  test('[] takes a table away', async () => {
    expect(await ok('set_encounters', { worldId, regionId, rows: [] })).toMatchObject({
      rows: 0,
      removed: true,
    });
    expect('encounters' in (await ok('get_region', { worldId, regionId }))).toBe(false);
    const stored = (await worlds().doc(worldId).collection('regions').doc(regionId).get()).data();
    expect('encounters' in stored).toBe(false);
    // Nothing there to take away: nothing written.
    const before = (await worlds().doc(worldId).get()).data().canonVersion;
    expect(await ok('set_encounters', { worldId, regionId, rows: [] })).not.toHaveProperty(
      'removed'
    );
    expect((await worlds().doc(worldId).get()).data().canonVersion).toBe(before);
    await ok('set_encounters', { worldId, world: true, rows: [] });
    expect('encounters' in (await ok('get_world', { worldId }))).toBe(false);
  });
});
