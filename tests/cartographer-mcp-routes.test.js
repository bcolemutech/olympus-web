'use strict';

/**
 * Routes with waypoints and rules over MCP (planning/worlds-without-azgaar.md
 * §4.5, PL4, PL7; L-715 / #820), driven by a real MCP client through
 * /mcp/cartographer against the Firestore emulator: two places connected with
 * waypoints and a rule, stored on both ends (the line turned round); the
 * route's length following the line in get_location and in loomGetMap's travel;
 * a move without the ability refused with its reason; connecting again
 * changing only what is given; bad waypoints and rules refused; disconnecting
 * clearing them; view_image drawing the route; and the same on a map's places
 * (add_places links, connect_places).
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-routes --verbose"
 */

const PROJECT = 'demo-cartographer-routes';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-routes';
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
const { mapView } = require('../functions/loom-turn/map-view');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const clock = require('../functions/loom-canon/clock');
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

const db = getFirestore(initializeApp({ projectId: PROJECT }, 'cartographer-routes-test'));
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
  client = new Client({ name: 'cartographer-routes-test', version: '0.0.0' });
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

describe('routes on the top map', () => {
  let worldId;
  let id; // by name
  const stored = async (placeId) =>
    (await worlds().doc(worldId).collection('locations').doc(placeId).get()).data();

  beforeAll(async () => {
    ({ worldId } = await ok('create_world', {
      name: 'Rivermarch',
      width: 1000,
      height: 800,
      milesPerUnit: 2,
    }));
    const { added } = await ok('add_locations', {
      worldId,
      locations: [
        { name: 'Alder', x: 100, y: 100, population: 800 },
        { name: 'Birch', x: 300, y: 100, population: 800 },
        { name: 'Cedar', x: 100, y: 300, population: 300 },
      ],
    });
    id = Object.fromEntries(added.map((a) => [a.name, a.id]));
  });

  test('connect_locations bends a route and rules it; stored on both ends, the line turned round', async () => {
    const out = await ok('connect_locations', {
      worldId,
      fromId: id.Alder,
      toId: id.Birch,
      via: 'road',
      waypoints: [
        [150, 250],
        [250, 250],
      ],
      rules: { requiresAbility: 'swimmer' },
    });
    expect(out.connection).toMatchObject({
      via: 'road',
      waypoints: [
        [150, 250],
        [250, 250],
      ],
      rules: { requiresAbility: 'swimmer' },
    });
    const alder = await stored(id.Alder);
    const birch = await stored(id.Birch);
    // Stored as { x, y } (Firestore holds no array in an array), the other end's
    // line turned round.
    expect(alder.geo.routes[id.Birch]).toEqual({
      waypoints: [
        { x: 150, y: 250 },
        { x: 250, y: 250 },
      ],
      rules: { requiresAbility: 'swimmer' },
    });
    expect(birch.geo.routes[id.Alder]).toEqual({
      waypoints: [
        { x: 250, y: 250 },
        { x: 150, y: 250 },
      ],
      rules: { requiresAbility: 'swimmer' },
    });
    expect(alder.geo.links[id.Birch]).toBe('road');
  });

  test('get_location gives its length along the line, its waypoints and rules, from either end', async () => {
    const line = Math.hypot(50, 150) + 100 + Math.hypot(50, 150);
    const miles = Math.round(line * 2);
    const alder = await ok('get_location', { worldId, locationId: id.Alder });
    const toBirch = alder.connections.find((c) => c.id === id.Birch);
    expect(toBirch.miles).toBe(miles);
    expect(toBirch.waypoints).toEqual([
      [150, 250],
      [250, 250],
    ]);
    expect(toBirch.rules).toEqual({ requiresAbility: 'swimmer' });
    const birch = await ok('get_location', { worldId, locationId: id.Birch });
    const back = birch.connections.find((c) => c.id === id.Alder);
    expect(back.miles).toBe(miles);
    expect(back.waypoints).toEqual([
      [250, 250],
      [150, 250],
    ]);
    // A route without them is as it was: the straight line, × 2 miles, × 1.25.
    await ok('connect_locations', { worldId, fromId: id.Alder, toId: id.Cedar });
    const plain = (await ok('get_location', { worldId, locationId: id.Alder })).connections.find(
      (c) => c.id === id.Cedar
    );
    expect(plain.miles).toBe(Math.round(200 * 2 * 1.25));
    expect(plain.waypoints).toBeUndefined();
    expect(plain.rules).toBeUndefined();
  });

  test('loomGetMap’s travel uses the new length, and a move without the ability is refused', async () => {
    const world = await loaded(worldId);
    const save = (abilities) => ({
      location: id.Alder,
      visited: [id.Alder, id.Birch, id.Cedar],
      discovered: [id.Alder, id.Birch, id.Cedar],
      waysKnown: {},
      time: clock.START,
      character: { name: 'Tam', inventory: [], abilities },
    });
    const view = mapView(world, save([]), null, null);
    const link = view.links.find((l) => [l.from, l.to].includes(id.Birch));
    const line = Math.hypot(50, 150) + 100 + Math.hypot(50, 150);
    expect(link.travel.miles).toBeCloseTo(line * 2, 5);
    expect(link.waypoints).toHaveLength(2);
    const plain = view.links.find((l) => [l.from, l.to].includes(id.Cedar));
    expect(plain.waypoints).toBeUndefined();
    expect(plain.travel.miles).toBeCloseTo(200 * 2 * 1.25, 5);

    // Draft places are gated; the rules under test are the route's, so grade
    // nothing here.
    const exempt = { ...world, status: undefined };
    const move = (abilities, to) =>
      evaluate({ verb: 'move', targets: [to], params: {} }, {}, save(abilities), 10, exempt);
    const refused_ = move([], id.Birch);
    expect(refused_.outcome).toBe('blocked');
    expect(refused_.constraints).toEqual([
      'You lack what it takes to go that way (the route requires: swimmer).',
    ]);
    expect(move(['swimmer'], id.Birch).outcome).toBe('success');
    expect(move([], id.Cedar).outcome).toBe('success');
  });

  test('connecting again changes only what is given', async () => {
    // Just the kind: the line and the rule stay.
    await ok('connect_locations', { worldId, fromId: id.Alder, toId: id.Birch, via: 'trail' });
    let alder = await stored(id.Alder);
    expect(alder.geo.links[id.Birch]).toBe('trail');
    expect(alder.geo.routes[id.Birch].waypoints).toHaveLength(2);
    // One rule off, a waypoint list replaced, given from the other end: the
    // line is read from Birch, so it is turned round for Alder.
    await ok('connect_locations', {
      worldId,
      fromId: id.Birch,
      toId: id.Alder,
      via: 'trail',
      waypoints: [[200, 400]],
      rules: { requiresAbility: null },
    });
    alder = await stored(id.Alder);
    const birch = await stored(id.Birch);
    expect(alder.geo.routes[id.Birch]).toEqual({ waypoints: [{ x: 200, y: 400 }] });
    expect(birch.geo.routes[id.Alder]).toEqual({ waypoints: [{ x: 200, y: 400 }] });
    // A hostile realm: stored and checked, and it changes no move.
    const made = await ok('add_realms', { worldId, realms: [{ name: 'The Rivermen' }] });
    await ok('connect_locations', {
      worldId,
      fromId: id.Alder,
      toId: id.Birch,
      via: 'trail',
      rules: { hostileToFactionId: made.realms[0].id },
    });
    expect((await stored(id.Alder)).geo.routes[id.Birch].rules).toEqual({
      hostileToFactionId: made.realms[0].id,
    });
    // [] takes the line away; with nothing left the entry goes.
    await ok('connect_locations', {
      worldId,
      fromId: id.Alder,
      toId: id.Birch,
      via: 'trail',
      waypoints: [],
      rules: { hostileToFactionId: null },
    });
    // Nothing left of either route (Firestore keeps an empty map where the last
    // entry was).
    expect((await stored(id.Alder)).geo.routes || {}).toEqual({});
    expect((await stored(id.Birch)).geo.routes || {}).toEqual({});
    // Back to a plain route, measured as it was.
    const miles = (await ok('get_location', { worldId, locationId: id.Alder })).connections.find(
      (c) => c.id === id.Birch
    ).miles;
    expect(miles).toBe(Math.round(200 * 2 * 1.25));
  });

  test('many links in one call, each with its own line; a pair given twice adds what each gives', async () => {
    const out = await ok('connect_locations', {
      worldId,
      links: [
        { fromId: id.Birch, toId: id.Cedar, waypoints: [[300, 300]] },
        { fromId: id.Cedar, toId: id.Birch, rules: { requiresAbility: 'climber' } },
      ],
    });
    expect(out.connections).toHaveLength(1);
    expect(out.connections[0]).toMatchObject({
      waypoints: [[300, 300]],
      rules: { requiresAbility: 'climber' },
    });
    const cedar = await stored(id.Cedar);
    expect(cedar.geo.routes[id.Birch]).toEqual({
      waypoints: [{ x: 300, y: 300 }],
      rules: { requiresAbility: 'climber' },
    });
  });

  test('bad waypoints and rules are refused, naming the link, and nothing is written', async () => {
    const before = await stored(id.Cedar);
    expect(
      await refused('connect_locations', {
        worldId,
        fromId: id.Birch,
        toId: id.Cedar,
        waypoints: [[1500, 100]],
      })
    ).toMatch(/Waypoint 1 \(1500, 100\) is off the map \(0–1000, 0–800\)/);
    expect(
      await refused('connect_locations', {
        worldId,
        links: [
          { fromId: id.Birch, toId: id.Cedar },
          { fromId: id.Alder, toId: id.Cedar, waypoints: [[10, 900]] },
        ],
      })
    ).toMatch(/^Link 2: Waypoint 1 \(10, 900\) is off the map/);
    expect(
      await refused('connect_locations', {
        worldId,
        fromId: id.Birch,
        toId: id.Cedar,
        rules: { hostileToFactionId: 'fac_nobody' },
      })
    ).toMatch(/No realm "fac_nobody"/);
    const text = await refused('connect_locations', {
      worldId,
      fromId: id.Birch,
      toId: id.Cedar,
      waypoints: Array(41).fill([5, 5]),
    });
    expect(text).toBeTruthy();
    expect(await stored(id.Cedar)).toEqual(before);
  });

  test('view_image draws the route along its waypoints', async () => {
    await ok('connect_locations', {
      worldId,
      fromId: id.Alder,
      toId: id.Birch,
      waypoints: [[200, 500]],
    });
    const result = await call('view_image', { worldId, of: 'map', id: 'map_world' });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    const legend = result.structuredContent;
    expect(legend.routes).toBe(3);
    expect(legend.reading).toMatch(/routes, bent through their waypoints/);
  });

  test('disconnecting takes the line and the rules with the link', async () => {
    await ok('connect_locations', {
      worldId,
      fromId: id.Alder,
      toId: id.Birch,
      waypoints: [[200, 500]],
      rules: { requiresAbility: 'swimmer' },
    });
    expect((await stored(id.Alder)).geo.routes[id.Birch]).toBeTruthy();
    await ok('disconnect_locations', { worldId, fromId: id.Alder, toId: id.Birch });
    const alder = await stored(id.Alder);
    expect((alder.geo.links || {})[id.Birch]).toBeUndefined();
    expect((alder.geo.routes || {})[id.Birch]).toBeUndefined();
    expect(((await stored(id.Birch)).geo.routes || {})[id.Alder]).toBeUndefined();
  });

  test('retiring a realm clears it from the routes hostile to it', async () => {
    const made = await ok('add_realms', { worldId, realms: [{ name: 'The Weirmen' }] });
    await ok('connect_locations', {
      worldId,
      fromId: id.Alder,
      toId: id.Birch,
      rules: { hostileToFactionId: made.realms[0].id },
    });
    expect((await stored(id.Alder)).geo.routes[id.Birch].rules.hostileToFactionId).toBe(
      made.realms[0].id
    );
    await ok('retire_entity', { worldId, type: 'faction', id: made.realms[0].id });
    const rules = ((await stored(id.Alder)).geo.routes || {})[id.Birch];
    expect(rules && rules.rules && rules.rules.hostileToFactionId).toBeFalsy();
  });
});

describe('routes on a map’s places', () => {
  let worldId;
  let places;
  const doc = async (placeId) =>
    (await worlds().doc(worldId).collection('places').doc(placeId).get()).data();

  beforeAll(async () => {
    ({ worldId } = await ok('create_world', { name: 'Starmarch', width: 1000, height: 1000 }));
  });

  test('add_places links take a line and rules, and the other end has the line turned round', async () => {
    const out = await ok('add_places', {
      worldId,
      mapId: 'map_world',
      places: [
        { name: 'Vega', kind: 'star', description: 'A star.', at: { x: 100, y: 100 } },
        {
          name: 'Sol',
          kind: 'star',
          description: 'A star.',
          at: { x: 500, y: 100 },
          links: [
            {
              to: 'Vega',
              kind: 'jump',
              waypoints: [
                [200, 300],
                [400, 300],
              ],
              rules: { requiresAbility: 'jump-drive' },
            },
          ],
        },
        { name: 'Deneb', kind: 'star', description: 'A star.', at: { x: 900, y: 900 } },
      ],
    });
    places = Object.fromEntries(out.places.map((p) => [p.name, p.id]));
    expect((await doc(places.Sol)).links).toEqual([
      {
        placeId: places.Vega,
        kind: 'jump',
        waypoints: [
          { x: 200, y: 300 },
          { x: 400, y: 300 },
        ],
        rules: { requiresAbility: 'jump-drive' },
      },
    ]);
    expect((await doc(places.Vega)).links).toEqual([
      {
        placeId: places.Sol,
        kind: 'jump',
        waypoints: [
          { x: 400, y: 300 },
          { x: 200, y: 300 },
        ],
        rules: { requiresAbility: 'jump-drive' },
      },
    ]);
  });

  test('add_places refuses a waypoint off the map', async () => {
    expect(
      await refused('add_places', {
        worldId,
        mapId: 'map_world',
        places: [
          {
            name: 'Rigel',
            kind: 'star',
            description: 'A star.',
            at: { x: 50, y: 50 },
            links: [{ to: places.Vega, waypoints: [[5000, 50]] }],
          },
        ],
      })
    ).toMatch(/"Rigel": Waypoint 1 \(5000, 50\) is off the map/);
  });

  test('connect_places gives a pair a line, and get_map shows it', async () => {
    const out = await ok('connect_places', {
      worldId,
      fromId: places.Sol,
      toId: places.Deneb,
      kind: 'jump',
      waypoints: [[700, 500]],
      rules: { requiresAbility: 'jump-drive' },
    });
    expect(out.connection).toMatchObject({
      kind: 'jump',
      waypoints: [[700, 500]],
      rules: { requiresAbility: 'jump-drive' },
    });
    expect((await doc(places.Deneb)).links).toEqual([
      {
        placeId: places.Sol,
        kind: 'jump',
        waypoints: [{ x: 700, y: 500 }],
        rules: { requiresAbility: 'jump-drive' },
      },
    ]);
    const map = await ok('get_map', { worldId, mapId: 'map_world' });
    const sol = map.places.find((p) => p.id === places.Sol);
    expect(sol.links.find((l) => l.placeId === places.Deneb)).toMatchObject({
      waypoints: [[700, 500]],
      rules: { requiresAbility: 'jump-drive' },
    });
    expect(
      await refused('connect_places', {
        worldId,
        fromId: places.Sol,
        toId: places.Deneb,
        kind: 'jump',
        waypoints: [[1200, 500]],
      })
    ).toMatch(/off the map/);
  });

  test('connect_places with nothing new keeps the line and rules', async () => {
    await ok('connect_places', { worldId, fromId: places.Deneb, toId: places.Sol, kind: 'jump' });
    expect((await doc(places.Sol)).links.find((l) => l.placeId === places.Deneb)).toMatchObject({
      waypoints: [{ x: 700, y: 500 }],
      rules: { requiresAbility: 'jump-drive' },
    });
  });

  test('view_image of the map draws its places’ routes', async () => {
    const result = await call('view_image', { worldId, of: 'map', id: 'map_world' });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.routes).toBe(2);
  });
});
