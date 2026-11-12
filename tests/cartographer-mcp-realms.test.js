'use strict';

/**
 * Realms, regions and terrain over MCP (planning/worlds-without-azgaar.md
 * §4.2; L-712 / #817), driven by a real MCP client through /mcp/cartographer
 * against the Firestore emulator: a world from scratch gets two realms and
 * three regions in one call each, its land painted as terrain and its regions
 * as zones; `where` and `get_location` name a place's region and realm, taken
 * from where it sits or set by hand; a zone naming an unknown region is
 * refused; and view_image draws the realms overlay with its legend.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-realms --verbose"
 */

const PROJECT = 'demo-cartographer-realms';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-realms';
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

const db = getFirestore(initializeApp({ projectId: PROJECT }, 'cartographer-realms-test'));
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
  client = new Client({ name: 'cartographer-realms-test', version: '0.0.0' });
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

describe('realms, regions and terrain on a world from scratch', () => {
  let worldId;
  let realm;
  let region;
  let place;

  beforeAll(async () => {
    ({ worldId } = await ok('create_world', {
      name: 'The Sundered Crown',
      width: 1000,
      height: 800,
    }));
    const { added } = await ok('add_locations', {
      worldId,
      locations: [
        { name: 'Aldmere', x: 150, y: 400, population: 4000 },
        { name: 'Ford Hollow', x: 450, y: 300, population: 300 },
        { name: 'Kessing', x: 800, y: 400, population: 2500, factionIds: [] },
        { name: 'Lonely Tor', kind: 'poi', x: 980, y: 780, markerType: 'ruins' },
      ],
    });
    place = Object.fromEntries(added.map((a) => [a.name, a.id]));
  });

  test('add_realms adds two realms in one call, with a colour given or picked', async () => {
    const made = await ok('add_realms', {
      worldId,
      realms: [
        { name: 'The Crown of Aldmere', description: 'An old kingdom.', colour: '#AA3311' },
        { name: 'The Kessing League', disposition: 'friendly' },
      ],
    });
    expect(made.realms).toEqual([
      { id: 'fac_the-crown-of-aldmere', name: 'The Crown of Aldmere', colour: '#aa3311' },
      { id: 'fac_the-kessing-league', name: 'The Kessing League', colour: expect.any(String) },
    ]);
    realm = { crown: made.realms[0].id, league: made.realms[1].id };
    const stored = (
      await worlds().doc(worldId).collection('factions').doc(realm.crown).get()
    ).data();
    expect(stored).toMatchObject({
      name: 'The Crown of Aldmere',
      disposition: 'neutral',
      politics: { color: '#aa3311', relations: {} },
      sources: { description: 'mcp' },
    });
    expect(await refused('add_realms', { worldId, realms: [{ name: 'Aldmere' }] })).toMatch(
      /already has that name/
    );
    // update_faction takes a colour too.
    const changed = await ok('update_faction', {
      worldId,
      factionId: realm.league,
      colour: '#2255CC',
    });
    expect(changed.updated).toEqual(['colour']);
  });

  test('add_regions adds three regions in one call, each naming its realm', async () => {
    const made = await ok('add_regions', {
      worldId,
      regions: [
        { name: 'The Westmark', factionId: realm.crown, description: 'Wheat and old stone.' },
        { name: 'The Marches', factionId: realm.crown },
        { name: 'Kessingdale', factionId: realm.league },
      ],
    });
    expect(made.regions.map((r) => [r.name, r.realm && r.realm.id])).toEqual([
      ['The Westmark', realm.crown],
      ['The Marches', realm.crown],
      ['Kessingdale', realm.league],
    ]);
    region = Object.fromEntries(made.regions.map((r) => [r.name, r.id]));
    expect(await refused('add_regions', { worldId, regions: [{ name: 'The westmark' }] })).toMatch(
      /already has that name/
    );
    expect(
      await refused('add_regions', { worldId, regions: [{ name: 'Nowhere', factionId: 'fac_x' }] })
    ).toMatch(/No faction "fac_x"/);
  });

  test('terrain as ground and regions as zones; a zone naming an unknown region is refused', async () => {
    await ok('set_ground', {
      worldId,
      mapId: 'map_world',
      set: [
        { id: 'land', material: 'grassland', shape: { rect: { x: 0, y: 0, w: 900, h: 800 } } },
        { id: 'woods', material: 'forest', shape: { rect: { x: 0, y: 0, w: 300, h: 800 } } },
        { id: 'sea', material: 'ocean', shape: { rect: { x: 900, y: 0, w: 100, h: 800 } } },
      ],
    });
    const zoned = await ok('set_zones', {
      worldId,
      mapId: 'map_world',
      set: [
        {
          id: 'westmark',
          region: region['The Westmark'],
          shape: { rect: { x: 0, y: 0, w: 400, h: 800 } },
        },
        {
          id: 'marches',
          region: region['The Marches'],
          shape: { rect: { x: 350, y: 0, w: 250, h: 800 } },
        },
        { id: 'kessingdale', region: region.Kessingdale, shape: 'M650 0 H900 V800 H650 Z' },
      ],
    });
    expect(zoned.added).toEqual(['westmark', 'marches', 'kessingdale']);
    const why = await refused('set_zones', {
      worldId,
      mapId: 'map_world',
      set: [
        { id: 'atlantis', region: 'reg_atlantis', shape: { rect: { x: 0, y: 0, w: 10, h: 10 } } },
      ],
    });
    expect(why).toMatch(/zones\.atlantis names a region "reg_atlantis" the world hasn’t/);
    const geometry = (await worlds().doc(worldId).collection('maps').doc('map_world').get()).data()
      .geometry;
    expect(geometry.zones.map((z) => z.id)).toEqual(['westmark', 'marches', 'kessingdale']);
  });

  test('where names the terrain, region and realm at a point and at a place', async () => {
    const at = await ok('where', { worldId, mapId: 'map_world', point: { x: 380, y: 100 } });
    expect(at).toMatchObject({
      map: { mapId: 'map_world' },
      terrain: { id: 'land', material: 'grassland', name: 'Grassland' },
      // The Marches lie over the Westmark where they meet: the topmost wins.
      region: { id: region['The Marches'], name: 'The Marches', zone: 'marches' },
      realm: { id: realm.crown, name: 'The Crown of Aldmere' },
      zones: [
        { id: 'westmark', region: region['The Westmark'] },
        { id: 'marches', region: region['The Marches'] },
      ],
    });
    const aldmere = await ok('where', { worldId, placeId: place.Aldmere });
    expect(aldmere).toMatchObject({
      terrain: { material: 'forest' },
      region: { id: region['The Westmark'] },
      place: {
        id: place.Aldmere,
        region: { id: region['The Westmark'], from: 'position' },
        realms: [{ id: realm.crown, from: 'region' }],
      },
    });
    const tor = await ok('where', { worldId, placeId: place['Lonely Tor'] });
    expect(tor).toMatchObject({ terrain: { material: 'ocean' }, region: null, realm: null });
    expect(await refused('where', { worldId, mapId: 'map_world' })).toMatch(/Give a point/);
    expect(
      await refused('where', { worldId, mapId: 'map_world', point: { x: 5000, y: 1 } })
    ).toMatch(/is off/);
  });

  test('get_location names a place’s region and realm, from where it sits or set by hand', async () => {
    const kessing = await ok('get_location', { worldId, locationId: place.Kessing });
    expect(kessing.region).toEqual({
      id: region.Kessingdale,
      name: 'Kessingdale',
      from: 'position',
    });
    expect(kessing.factions).toEqual([{ id: realm.league, name: 'The Kessing League' }]);
    expect(kessing.factionsFrom).toBe('region');

    // Set by hand: kept over where it sits.
    await ok('update_location', {
      worldId,
      locationId: place['Ford Hollow'],
      regionId: region['The Westmark'],
      factionIds: [realm.league],
    });
    const ford = await ok('get_location', { worldId, locationId: place['Ford Hollow'] });
    expect(ford.region).toEqual({
      id: region['The Westmark'],
      name: 'The Westmark',
      from: 'set by hand',
    });
    expect(ford.factions).toEqual([{ id: realm.league, name: 'The Kessing League' }]);
    expect(ford.factionsFrom).toBeUndefined();

    // Back to where it sits.
    await ok('update_location', {
      worldId,
      locationId: place['Ford Hollow'],
      regionId: null,
      factionIds: [],
    });
    const back = (await loaded(worldId)).locations[place['Ford Hollow']];
    expect(back.geo).toMatchObject({ regionId: region['The Marches'], regionFrom: 'position' });
    expect(back.factionIds).toEqual([realm.crown]);
  });

  test('get_faction and get_region show their land', async () => {
    const crown = await ok('get_faction', { worldId, factionId: realm.crown });
    expect(crown.colour).toBe('#aa3311');
    expect(crown.land).toEqual([
      { mapId: 'map_world', regionId: region['The Marches'], zones: ['marches'] },
      { mapId: 'map_world', regionId: region['The Westmark'], zones: ['westmark'] },
    ]);
    const dale = await ok('get_region', { worldId, regionId: region.Kessingdale });
    expect(dale.land).toEqual([{ mapId: 'map_world', zones: ['kessingdale'] }]);
    expect(dale.realm).toMatchObject({ id: realm.league });
    expect(dale.locations.map((l) => l.id)).toEqual([place.Kessing]);
  });

  test('view_image draws the realms overlay with its legend', async () => {
    const result = await call('view_image', {
      worldId,
      of: 'map',
      id: 'map_world',
      overlay: 'realms',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    const legend = result.structuredContent;
    expect(legend.options.overlay).toBe('realms');
    expect(legend.overlay.of).toBe('realms');
    expect(legend.overlay.realms).toEqual([
      {
        n: expect.any(Number),
        id: realm.crown,
        name: 'The Crown of Aldmere',
        colour: '#aa3311',
        zones: ['westmark', 'marches'],
      },
      {
        n: expect.any(Number),
        id: realm.league,
        name: 'The Kessing League',
        colour: '#2255cc',
        zones: ['kessingdale'],
      },
    ]);
    const numbered = legend.markers.filter((m) => m.type === 'realm').map((m) => m.id);
    expect(numbered).toEqual([realm.crown, realm.league]);

    const regions = (
      await call('view_image', { worldId, of: 'map', id: 'map_world', overlay: 'regions' })
    ).structuredContent;
    expect(regions.overlay.regions.map((r) => r.name).sort()).toEqual([
      'Kessingdale',
      'The Marches',
      'The Westmark',
    ]);
  });
});
