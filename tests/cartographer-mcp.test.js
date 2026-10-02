'use strict';

/**
 * The Cartographer's MCP connector, read side (C-6 / #373): the read tools
 * and the worlds resource, driven by a real MCP client through the per-app
 * resource server (/mcp/cartographer), against worlds imported from the Nisia
 * fixture into the Firestore emulator.
 *
 * Acceptance: from Claude, list worlds and explore a loaded map's places,
 * factions and regions; users without the claim are refused.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

// The functions package's firebase-admin, so the Firestore client matches the
// one loom-canon and the loader use.
const functionsDir = path.resolve(__dirname, '../functions');
const { initializeApp } = require(require.resolve('firebase-admin/app', { paths: [functionsDir] }));
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);

const { layOutTowns } = require('./helpers/towns');
const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { loadDraftWorld } = require('../functions/cartographer/load');
const loomCanon = require('../functions/loom-canon');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const registerApps = require('../functions/mcp/apps');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');

const CANONICAL = 'https://bcoletech.com';
const AUD = `${CANONICAL}/mcp/cartographer`;
const T0 = Date.parse('2026-09-27T09:00:00Z');

const adminApp = initializeApp({ projectId: 'demo-cartographer-mcp' }, 'cartographer-mcp-test');
const db = getFirestore(adminApp);
const worlds = () => db.collection('loom_worlds');

const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader: createFirestoreWorldReader(() => db),
    writer: createFirestoreWorldWriter(() => db),
  })
);
const oauthStore = createInMemoryStore();

const DRAFT = 'nisia-d0d0d0';
const LIVE = 'nisia-e1e1e1';

let server;
let base;
let client;

function tokenFor(uid, { audience = AUD, scope = 'mcp:cartographer' } = {}) {
  const grantId = `grant-${uid}`;
  oauthStore._debug.grants.set(grantId, { grantId, uid, appId: 'cartographer', revoked: false });
  return signAccessToken({ uid, audience, scope, issuer: CANONICAL, grantId });
}

async function call(name, args = {}) {
  return client.callTool({ name, arguments: args });
}

async function read(name, args) {
  const result = await call(name, args);
  if (result.isError) throw new Error(`${name} failed: ${result.content[0].text}`);
  return result.structuredContent;
}

async function errorText(name, args) {
  const result = await call(name, args);
  expect(result.isError).toBe(true);
  return result.content[0].text;
}

// A bare MCP initialize POST, for asserting status codes.
function rawInitialize(token) {
  return fetch(`${base}/mcp/cartographer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'raw', version: '0' },
      },
    }),
  });
}

async function bumpCanon(worldId, changes = {}) {
  const snap = await worlds().doc(worldId).get();
  await worlds()
    .doc(worldId)
    .update({ ...changes, canonVersion: snap.data().canonVersion + 1 });
}

// Two imports of Nisia: one left as a draft, one published and built on —
// a character, lore, and retired entities — plus a world still importing
// and one whose import failed.
async function seed() {
  await db.recursiveDelete(worlds());
  const parsed = parseAzgaarExport(
    fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
  );
  const load = (worldId, at) =>
    loadDraftWorld({
      db,
      mapped: mapToCanon(parsed),
      source: parsed.source,
      uploadedBy: 'builder-001',
      now: () => at,
      worldId,
    });
  await load(DRAFT, T0);
  await load(LIVE, T0 + 1000);

  const live = worlds().doc(LIVE);
  await live.collection('characters').doc('chr_mara').set({
    id: 'chr_mara',
    name: 'Mara Quill',
    description: 'Harbourmaster of Burdendal.',
    factionId: 'fac_1',
    locationId: 'loc_1',
  });
  await live.collection('characters').doc('chr_ghost').set({
    id: 'chr_ghost',
    name: 'The Grey Pilot',
    description: 'Lost at sea.',
    locationId: 'loc_1',
    retired: true,
  });
  await live
    .collection('lore')
    .doc('lore_founding')
    .set({
      id: 'lore_founding',
      title: 'The Founding of Burdendal',
      text: 'Burdendal was raised on the wreck of the first fleet.',
      entityRefs: ['loc_1', 'fac_1'],
    });
  await live
    .collection('lore')
    .doc('lore_old')
    .set({
      id: 'lore_old',
      title: 'A Forgotten Tale',
      text: 'Nobody remembers.',
      entityRefs: ['loc_1'],
      retired: true,
    });
  await live.collection('locations').doc('poi_1').update({ retired: true });
  // The start, open to players (L-322): written up, with its town laid out.
  await live.collection('locations').doc('loc_1').update({ 'sources.description': 'mcp' });
  await layOutTowns(live, 'loc_1');
  await bumpCanon(LIVE, {
    status: 'published',
    tagline: 'Twenty-three realms, one coastline.',
    openingHook: 'A storm drives your ship ashore at Burdendal.',
    rules: { startingLocationId: 'loc_1' },
    publishedAtMs: T0 + 5000,
  });

  await worlds()
    .doc('half-built-aaaaaa')
    .set({
      id: 'half-built-aaaaaa',
      name: 'Half Built',
      status: 'importing',
      canonVersion: 0,
      createdAtMs: T0 + 2000,
      updatedAtMs: T0 + 2000,
    });
  await worlds()
    .doc('broken-bbbbbb')
    .set({
      id: 'broken-bbbbbb',
      name: 'Broken',
      status: 'failed',
      error: 'Write quota exceeded',
      canonVersion: 0,
      createdAtMs: T0 + 3000,
      updatedAtMs: T0 + 3000,
    });
}

beforeAll(async () => {
  loomCanon.clearWorldCache();
  await seed();
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
  client = new Client({ name: 'cartographer-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp/cartographer`), {
      requestInit: { headers: { Authorization: `Bearer ${tokenFor('builder-001')}` } },
    })
  );
}, 60000);

afterAll(async () => {
  await client.close();
  await new Promise((resolve) => server.close(resolve));
  await db.recursiveDelete(worlds());
  await db.terminate();
});

describe('connector surface', () => {
  test('exposes the read tools, all read-only, and the worlds resource', async () => {
    const { tools } = await client.listTools();
    const reads = tools.filter((t) => t.annotations.readOnlyHint);
    expect(reads.map((t) => t.name).sort()).toEqual([
      'find_locations',
      'get_battle_map',
      'get_character',
      'get_faction',
      'get_location',
      'get_lore',
      'get_region',
      'get_town',
      'get_world',
      'list_battle_maps',
      'list_work',
      'list_worlds',
      'view_image',
    ]);

    const { resources } = await client.listResources();
    expect(resources).toEqual([
      expect.objectContaining({ uri: 'cartographer://worlds', mimeType: 'application/json' }),
    ]);
    const { contents } = await client.readResource({ uri: 'cartographer://worlds' });
    expect(JSON.parse(contents[0].text).worlds.map((w) => w.id)).toContain(LIVE);
  });

  test('the production registration mounts the Cartographer beside Scriptorium', () => {
    const prod = createRegistry();
    registerApps(prod);
    expect(prod.appIds()).toEqual(['scriptorium', 'cartographer']);
  });
});

describe('only the cartographer claim gets in', () => {
  test('no token, or a token for another connector, is refused', async () => {
    expect((await rawInitialize(null)).status).toBe(401);
    const scriptoriumToken = tokenFor('builder-001', {
      audience: `${CANONICAL}/mcp/scriptorium`,
      scope: 'mcp:scriptorium',
    });
    expect((await rawInitialize(scriptoriumToken)).status).toBe(401);
  });

  test('a token without the mcp:cartographer scope is refused (the AS grants it only with the claim)', async () => {
    const res = await rawInitialize(tokenFor('player-001', { scope: 'mcp:scriptorium' }));
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toMatch(/insufficient_scope/);
  });
});

describe('list_worlds', () => {
  test('lists every world newest first, with status and what its map held', async () => {
    const { worlds: rows, count } = await read('list_worlds');
    expect(count).toBe(4);
    expect(rows.map((w) => [w.id, w.status])).toEqual([
      ['broken-bbbbbb', 'failed'],
      ['half-built-aaaaaa', 'importing'],
      [LIVE, 'published'],
      [DRAFT, 'draft'],
    ]);
    expect(rows[0].error).toBe('Write quota exceeded');
    expect(rows[2]).toMatchObject({
      name: 'Nisia',
      tagline: 'Twenty-three realms, one coastline.',
      canonVersion: 2,
      counts: { settlements: 663, pointsOfInterest: 56, factions: 23, regions: 145 },
      publishedAt: new Date(T0 + 5000).toISOString(),
    });
  });
});

describe('get_world', () => {
  test('a fresh draft: counts, realms with their regions, and what it still needs', async () => {
    const world = await read('get_world', { worldId: DRAFT });
    expect(world).toMatchObject({
      id: DRAFT,
      status: 'draft',
      canonVersion: 1,
      startingLocation: null,
      readyToPublish: false,
      missing: ['an opening hook', 'a starting location'],
      map: { width: 1718, height: 1270, hasImage: false, distance: { unit: 'mi', perMapUnit: 2 } },
      source: { mapName: 'Nisia', azgaarVersion: '1.153.1' },
      counts: {
        settlements: 663,
        pointsOfInterest: 56,
        factions: 23,
        regions: 145,
        characters: 0,
        lore: 0,
        retired: 0,
      },
    });
    expect(world.factions).toHaveLength(23);
    // Every region appears once, under its realm.
    const nested = world.factions.flatMap((f) => f.regions.map((r) => r.id));
    expect(new Set([...nested, ...world.otherRegions.map((r) => r.id)]).size).toBe(145);
    const pendonia = world.factions.find((f) => f.id === 'fac_1');
    expect(pendonia).toMatchObject({
      name: 'Kingdom of Pendonia',
      form: 'Kingdom',
      capital: { id: 'loc_1', name: 'Burdendal' },
      settlements: 63,
    });
    expect(pendonia.regions).toContainEqual({ id: 'reg_1', name: 'Burdendal County' });
    // Largest realm first.
    expect(world.factions[0].settlements).toBeGreaterThanOrEqual(world.factions[1].settlements);
    expect(world.importWarnings.map((w) => w.code)).toEqual(['names_qualified', 'isolated_linked']);
  });

  test('a published world: hook, start, characters and lore, retired ones marked', async () => {
    const world = await read('get_world', { worldId: LIVE });
    expect(world).toMatchObject({
      status: 'published',
      canonVersion: 2,
      openingHook: 'A storm drives your ship ashore at Burdendal.',
      startingLocation: { id: 'loc_1', name: 'Burdendal' },
      readyToPublish: true,
      counts: { pointsOfInterest: 55, characters: 1, lore: 1, retired: 3 },
    });
    expect(world).not.toHaveProperty('missing');
    expect(world.characters).toEqual(
      expect.arrayContaining([
        { id: 'chr_mara', name: 'Mara Quill', location: 'Burdendal' },
        { id: 'chr_ghost', name: 'The Grey Pilot', location: 'Burdendal', retired: true },
      ])
    );
    expect(world.lore).toEqual(
      expect.arrayContaining([
        { id: 'lore_founding', title: 'The Founding of Burdendal' },
        { id: 'lore_old', title: 'A Forgotten Tale', retired: true },
      ])
    );
  });

  test('explains worlds it cannot read', async () => {
    expect(await errorText('get_world', { worldId: 'nowhere-000000' })).toMatch(
      /not found.*list_worlds/
    );
    expect(await errorText('get_world', { worldId: 'half-built-aaaaaa' })).toMatch(
      /still importing/
    );
    expect(await errorText('get_world', { worldId: 'broken-bbbbbb' })).toMatch(
      /import failed: Write quota exceeded/
    );
  });

  test('rejects a malformed world id before any lookup', async () => {
    expect(await errorText('get_world', { worldId: '../loom_saves' })).not.toMatch(/not found/);
  });
});

describe('find_locations', () => {
  test('by name, ignoring case, exact matches first', async () => {
    const found = await read('find_locations', { worldId: DRAFT, name: 'BURDENDAL' });
    expect(found.locations[0]).toEqual({
      id: 'loc_1',
      name: 'Burdendal',
      kind: 'settlement',
      population: 28473,
      capital: true,
      port: true,
      region: 'Burdendal County',
      realm: 'Kingdom of Pendonia',
      grade: 'unbuilt', // no town yet
    });

    // Exact, then prefix, then anywhere in the name — each largest first,
    // points of interest (no population) after settlements.
    const bridges = await read('find_locations', { worldId: DRAFT, name: 'bridge' });
    expect(bridges.locations.map((l) => l.name)).toEqual([
      'Bridge',
      'Bridgeford',
      'Chichbridge',
      'Winchbridge',
      'Lymockleigh Bridge',
      'Rothbury Bridge',
    ]);
  });

  test('by region and by realm, largest first', async () => {
    const county = await read('find_locations', { worldId: DRAFT, regionId: 'reg_1' });
    expect(county.total).toBe(7);
    expect(county.locations[0].id).toBe('loc_1');
    const populations = county.locations.map((l) => l.population);
    expect(populations).toEqual([...populations].sort((a, b) => b - a));

    const realm = await read('find_locations', {
      worldId: DRAFT,
      factionId: 'fac_1',
      kind: 'settlement',
    });
    expect(realm.total).toBe(63);
  });

  test('near a place: nearest first, with direction, distance and travel hops', async () => {
    const near = await read('find_locations', { worldId: DRAFT, near: 'loc_1', limit: 5 });
    expect(near.near).toEqual({ id: 'loc_1', name: 'Burdendal' });
    expect(near.locations[0]).toMatchObject({
      id: 'loc_631',
      name: 'Dunsmouth',
      distance: 21,
      direction: 'southeast',
      hops: 1,
    });
    const distances = near.locations.map((l) => l.distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(near.locations.map((l) => l.id)).not.toContain('loc_1');
  });

  test('pages through large results', async () => {
    const first = await read('find_locations', { worldId: DRAFT, kind: 'poi', limit: 20 });
    expect(first).toMatchObject({ total: 56, offset: 0, count: 20, nextOffset: 20 });
    const second = await read('find_locations', {
      worldId: DRAFT,
      kind: 'poi',
      limit: 20,
      offset: first.nextOffset,
    });
    expect(second).toMatchObject({ offset: 20, count: 20, nextOffset: 40 });
    const last = await read('find_locations', { worldId: DRAFT, kind: 'poi', offset: 40 });
    expect(last).toMatchObject({ count: 16 });
    expect(last).not.toHaveProperty('nextOffset');
    const ids = [...first.locations, ...second.locations, ...last.locations].map((l) => l.id);
    expect(new Set(ids).size).toBe(56);
  });

  test('leaves retired places out unless asked', async () => {
    const live = await read('find_locations', { worldId: LIVE, kind: 'poi', limit: 100 });
    expect(live.total).toBe(55);
    const all = await read('find_locations', {
      worldId: LIVE,
      kind: 'poi',
      includeRetired: true,
      limit: 100,
    });
    expect(all.total).toBe(56);
    expect(all.locations.find((l) => l.id === 'poi_1')).toMatchObject({ retired: true });
  });

  test('refuses unknown filters and out-of-range paging', async () => {
    expect(await errorText('find_locations', { worldId: DRAFT, near: 'loc_99999' })).toMatch(
      /No location "loc_99999"/
    );
    expect(await errorText('find_locations', { worldId: DRAFT, regionId: 'reg_999' })).toMatch(
      /No region/
    );
    expect(await errorText('find_locations', { worldId: DRAFT, factionId: 'fac_999' })).toMatch(
      /No faction/
    );
    await errorText('find_locations', { worldId: DRAFT, limit: 101 });
    await errorText('find_locations', { worldId: DRAFT, offset: -1 });
  });
});

describe('get_location, get_faction, get_region', () => {
  test('a place in full: links by road, trail or sea, its people and its lore', async () => {
    const place = await read('get_location', { worldId: LIVE, locationId: 'loc_1' });
    expect(place).toMatchObject({
      worldId: LIVE,
      id: 'loc_1',
      name: 'Burdendal',
      kind: 'settlement',
      description: expect.stringMatching(/^Port city of about 28,500/),
      population: 28473,
      capital: true,
      port: true,
      biome: 'Temperate rainforest',
      seeds: {
        type: 'Naval',
        culture: 'Angshire',
        walls: true,
        citadel: true,
        plaza: true,
        temple: true,
        shanty: false,
      },
      region: { id: 'reg_1', name: 'Burdendal County' },
      factions: [{ id: 'fac_1', name: 'Kingdom of Pendonia' }],
      startingLocation: true,
      characters: [{ id: 'chr_mara', name: 'Mara Quill' }],
      lore: [
        {
          id: 'lore_founding',
          title: 'The Founding of Burdendal',
          text: 'Burdendal was raised on the wreck of the first fleet.',
        },
      ],
    });
    expect(place.connections).toEqual([
      {
        id: 'loc_120',
        name: 'Dunscombe',
        via: 'sea',
        distance: 29,
        direction: 'northwest',
        grade: 'unbuilt',
      },
      {
        id: 'loc_229',
        name: 'Wisin',
        via: 'sea',
        distance: 27,
        direction: 'south',
        grade: 'unbuilt',
      },
      {
        id: 'loc_231',
        name: 'Ashleaches',
        via: 'trail',
        distance: 25,
        direction: 'northeast',
        grade: 'unbuilt',
      },
      {
        id: 'loc_631',
        name: 'Dunsmouth',
        via: 'trail',
        distance: 21,
        direction: 'southeast',
        grade: 'unbuilt',
      },
    ]);
  });

  test('a retired place still resolves, and nothing links to it any more', async () => {
    const poi = await read('get_location', { worldId: LIVE, locationId: 'poi_1' });
    expect(poi).toMatchObject({ kind: 'poi', markerType: 'mines', retired: true });
    const neighbour = await read('get_location', { worldId: LIVE, locationId: 'loc_61' });
    expect(neighbour.connections.map((c) => c.id)).not.toContain('poi_1');
    const before = await read('get_location', { worldId: DRAFT, locationId: 'loc_61' });
    expect(before.connections.map((c) => c.id)).toContain('poi_1');
  });

  test('a realm in full: capital, largest towns, regions, relations, members, lore', async () => {
    const realm = await read('get_faction', { worldId: LIVE, factionId: 'fac_1' });
    expect(realm).toMatchObject({
      name: 'Kingdom of Pendonia',
      form: 'Kingdom',
      government: 'Monarchy',
      disposition: 'neutral',
      capital: { id: 'loc_1', name: 'Burdendal' },
      settlements: 63,
      characters: [{ id: 'chr_mara', name: 'Mara Quill' }],
      lore: [expect.objectContaining({ id: 'lore_founding' })],
    });
    expect(realm.largestSettlements).toHaveLength(10);
    expect(realm.largestSettlements[0]).not.toHaveProperty('realm');
    expect(realm.regions).toContainEqual({ id: 'reg_1', name: 'Burdendal County', settlements: 7 });
    expect(realm.relations.ally).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'fac_16' })])
    );
    expect(realm.relations.rival.map((r) => r.id).sort()).toEqual(['fac_13', 'fac_21']);
  });

  test('a region in full: realm, capital, settlements largest first', async () => {
    const region = await read('get_region', { worldId: DRAFT, regionId: 'reg_1' });
    expect(region).toMatchObject({
      name: 'Burdendal County',
      form: 'County',
      realm: { id: 'fac_1', name: 'Kingdom of Pendonia' },
      capital: { id: 'loc_1', name: 'Burdendal' },
      settlements: 7,
    });
    expect(region.locations[0]).toEqual({
      id: 'loc_1',
      name: 'Burdendal',
      kind: 'settlement',
      population: 28473,
      capital: true,
      port: true,
      grade: 'unbuilt',
    });
  });

  test('unknown ids are explained', async () => {
    expect(await errorText('get_location', { worldId: DRAFT, locationId: 'loc_0' })).toMatch(
      /No location "loc_0".*find_locations/
    );
    expect(await errorText('get_faction', { worldId: DRAFT, factionId: 'fac_0' })).toMatch(
      /No faction/
    );
    expect(await errorText('get_region', { worldId: DRAFT, regionId: 'reg_0' })).toMatch(
      /No region/
    );
  });
});

describe('get_character and get_lore', () => {
  test('a character in full', async () => {
    expect(await read('get_character', { worldId: LIVE, characterId: 'chr_mara' })).toEqual({
      worldId: LIVE,
      id: 'chr_mara',
      name: 'Mara Quill',
      description: 'Harbourmaster of Burdendal.',
      faction: { id: 'fac_1', name: 'Kingdom of Pendonia' },
      location: { id: 'loc_1', name: 'Burdendal' },
      lore: [],
    });
    expect(await read('get_character', { worldId: LIVE, characterId: 'chr_ghost' })).toMatchObject({
      retired: true,
    });
    expect(await errorText('get_character', { worldId: DRAFT, characterId: 'chr_mara' })).toMatch(
      /No character/
    );
  });

  test('a lore entry, with what it is about', async () => {
    expect(await read('get_lore', { worldId: LIVE, loreId: 'lore_founding' })).toEqual({
      worldId: LIVE,
      id: 'lore_founding',
      title: 'The Founding of Burdendal',
      text: 'Burdendal was raised on the wreck of the first fleet.',
      about: [
        { id: 'loc_1', type: 'location', name: 'Burdendal' },
        { id: 'fac_1', type: 'faction', name: 'Kingdom of Pendonia' },
      ],
    });
  });
});

test('a canon edit shows up on the next call', async () => {
  await read('get_character', { worldId: LIVE, characterId: 'chr_mara' }); // cached
  await worlds()
    .doc(LIVE)
    .collection('characters')
    .doc('chr_mara')
    .update({ description: 'Harbourmaster, and smuggler.' });
  await bumpCanon(LIVE);
  expect(await read('get_character', { worldId: LIVE, characterId: 'chr_mara' })).toMatchObject({
    description: 'Harbourmaster, and smuggler.',
  });
});
