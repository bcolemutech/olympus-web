'use strict';

/**
 * The Cartographer's MCP town tools (planning/the-loom-layered-worlds.md §8;
 * L-343 / #397), driven by a real MCP client against Nisia in the Firestore
 * emulator: laying out Burdendal's town place by place, the town's integrity
 * rules, characters in town, retiring in a published world versus deleting
 * in a draft, and town work in list_work.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-town --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-town';
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
const loomCanon = require('../functions/loom-canon');
const town = require('../functions/loom-canon/town');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');

const CANONICAL = 'https://bcoletech.com';
const LIVE = 'nisia-p0p0p0'; // published
const DRAFT = 'nisia-d1d1d1';

const adminApp = initializeApp({ projectId: 'demo-cartographer-town' }, 'cartographer-town-test');
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
  await importNisia(LIVE, true);
  await importNisia(DRAFT, false);
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
  client = new Client({ name: 'cartographer-town-test', version: '0.0.0' });
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

test('the town tools are there, and get_town only reads', async () => {
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const name of ['add_place', 'update_place', 'connect_places', 'disconnect_places']) {
    expect(byName[name].annotations.readOnlyHint).toBe(false);
  }
  expect(byName.get_town.annotations.readOnlyHint).toBe(true);
  expect(byName.disconnect_places.annotations.destructiveHint).toBe(true);
});

describe('laying out Burdendal, place by place', () => {
  const W = LIVE;

  test('an empty town says so, and lists the routes that need ways out', async () => {
    const empty = await ok('get_town', { worldId: W, locationId: 'loc_1' });
    expect(empty).toMatchObject({
      name: 'Burdendal',
      seeds: { type: 'Naval', walls: true, plaza: true },
      layout: { valid: false, problems: ['It has no town layout yet.'] },
      places: [],
    });
    expect(empty.routes.map((r) => [r.id, r.via, r.waysOut])).toEqual([
      ['loc_120', 'sea', []],
      ['loc_229', 'sea', []],
      ['loc_231', 'trail', []],
      ['loc_631', 'trail', []],
    ]);
    expect(await refused('get_town', { worldId: W, locationId: 'poi_1' })).toMatch(
      /isn't a settlement/
    );
  });

  test('a harbour for the sea routes: a working layout, trails still unserved', async () => {
    const { place: harbour, layout } = await ok('add_place', {
      worldId: W,
      locationId: 'loc_1',
      name: 'The Harbour',
      kind: 'Harbour',
      description: 'Slate quays and tarred rope.',
      entranceFor: ['sea'],
    });
    expect(harbour).toMatchObject({ id: 'plc_1_the-harbour', entranceFor: ['sea'] });
    expect(layout).toEqual({
      valid: true,
      problems: [],
      warnings: [
        'No way out serves the trail to Ashleaches.',
        'No way out serves the trail to Dunsmouth.',
      ],
    });
    expect(await place(W, 'plc_1_the-harbour')).toMatchObject({
      locationId: 'loc_1',
      kind: 'harbour',
      sources: { description: 'mcp' },
      entrance: { via: ['sea'] },
      connections: [],
    });
  });

  test('a gate for the trails, a market linking both, links written both ways', async () => {
    const gate = await ok('add_place', {
      worldId: W,
      locationId: 'loc_1',
      name: 'The North Gate',
      kind: 'gate',
      description: 'An old arch in the walls.',
      entranceFor: ['trail', 'road'],
    });
    expect(gate.place.entranceFor).toEqual(['road', 'trail']);
    expect(gate.layout.warnings).toEqual([]);
    const market = await ok('add_place', {
      worldId: W,
      locationId: 'loc_1',
      name: 'Market Square',
      kind: 'market',
      description: 'Stalls under canvas.',
      connectTo: ['plc_1_the-harbour', 'plc_1_the-north-gate'],
      position: { x: 500, y: 500 },
    });
    expect(market.place.connections.map((c) => c.id)).toEqual([
      'plc_1_the-harbour',
      'plc_1_the-north-gate',
    ]);
    expect((await place(W, 'plc_1_the-harbour')).connections).toEqual(['plc_1_market-square']);
    expect((await place(W, 'plc_1_the-north-gate')).connections).toEqual(['plc_1_market-square']);
    expect((await place(W, 'plc_1_market-square')).position).toEqual({ x: 500, y: 500 });
  });

  test('a place nobody can reach is reported, until it is linked', async () => {
    const tavern = await ok('add_place', {
      worldId: W,
      locationId: 'loc_1',
      name: 'The Gull & Anchor',
      kind: 'tavern',
      description: 'Low beams, eel pie.',
    });
    expect(tavern.layout).toMatchObject({
      valid: false,
      problems: ['Not reachable from a way in: The Gull & Anchor (plc_1_the-gull-anchor).'],
    });
    const linked = await ok('connect_places', {
      worldId: W,
      fromId: 'plc_1_market-square',
      toId: 'plc_1_the-gull-anchor',
    });
    expect(linked.layout).toMatchObject({ valid: true, problems: [] });
  });

  test('get_town and get_location show the finished layout', async () => {
    const built = await ok('get_town', { worldId: W, locationId: 'loc_1' });
    expect(built.layout).toEqual({ valid: true, problems: [], warnings: [] });
    expect(built.places.map((p) => [p.id, p.entranceFor, p.grade])).toEqual([
      ['plc_1_market-square', null, 'playable'],
      ['plc_1_the-gull-anchor', null, 'playable'],
      ['plc_1_the-harbour', ['sea'], 'playable'],
      ['plc_1_the-north-gate', ['road', 'trail'], 'playable'],
    ]);
    const bySea = built.routes.find((r) => r.id === 'loc_229');
    expect(bySea.waysOut).toEqual([{ id: 'plc_1_the-harbour', name: 'The Harbour' }]);
    const byTrail = built.routes.find((r) => r.id === 'loc_631');
    expect(byTrail.waysOut).toEqual([{ id: 'plc_1_the-north-gate', name: 'The North Gate' }]);

    const settlement = await ok('get_location', { worldId: W, locationId: 'loc_1' });
    expect(settlement.town).toEqual({
      places: 4,
      waysInAndOut: ['The Harbour', 'The North Gate'],
      valid: true,
    });
    // And the Loom's own check agrees: this town would pass the town requirement.
    loomCanon.clearWorldCache();
    const world = await loomCanon.loadWorld(W, { db });
    expect(town.hasTownLayout(world, world.locations.loc_1)).toBe(true);
  });
});

describe('the town’s rules', () => {
  const W = LIVE;

  test('names are unique in a town, and never a world name', async () => {
    const add = (name, locationId = 'loc_1') =>
      call('add_place', { worldId: W, locationId, name, kind: 'shop', description: 'A shop.' });
    const dup = await add('the harbour!');
    expect(dup.isError).toBe(true);
    expect(dup.content[0].text).toMatch(/The Harbour \(plc_1_the-harbour\) in Burdendal/);
    expect((await add('Dunsmouth')).content[0].text).toMatch(/location "Dunsmouth" \(loc_631\)/);
    // The same name is fine in another town.
    const elsewhere = await add('The Harbour', 'loc_631');
    expect(elsewhere.isError).toBeFalsy();
    expect(elsewhere.structuredContent.place.id).toBe('plc_631_the-harbour');
  });

  test('links stay inside one town, and never to itself', async () => {
    expect(
      await refused('connect_places', {
        worldId: W,
        fromId: 'plc_1_market-square',
        toId: 'plc_631_the-harbour',
      })
    ).toMatch(/is not in Burdendal/);
    expect(
      await refused('connect_places', {
        worldId: W,
        fromId: 'plc_1_market-square',
        toId: 'plc_1_market-square',
      })
    ).toMatch(/can’t link to itself/);
    expect(
      await refused('add_place', {
        worldId: W,
        locationId: 'poi_1',
        name: 'A Hut',
        kind: 'hut',
        description: 'A hut.',
      })
    ).toMatch(/isn't a settlement/);
  });

  test('a town always keeps a way in and out', async () => {
    await ok('update_place', { worldId: W, placeId: 'plc_1_the-harbour', entranceFor: null });
    expect(
      await refused('update_place', {
        worldId: W,
        placeId: 'plc_1_the-north-gate',
        entranceFor: null,
      })
    ).toMatch(/The North Gate is the town's only way in and out/);
    expect(
      await refused('retire_entity', { worldId: W, type: 'place', id: 'plc_1_the-north-gate' })
    ).toMatch(/only way in and out/);
    const restored = await ok('update_place', {
      worldId: W,
      placeId: 'plc_1_the-harbour',
      entranceFor: ['sea'],
    });
    expect(restored).toMatchObject({ updated: ['entrance'], layout: { valid: true } });
  });

  test('update_place renames, rekinds, redescribes and sets rules', async () => {
    const result = await ok('update_place', {
      worldId: W,
      placeId: 'plc_1_the-gull-anchor',
      name: 'The Gull and Anchor',
      description: 'Low beams, eel pie, a fire.',
      rules: { requiresAbility: 'good-coin' },
    });
    expect(result.updated.sort()).toEqual(['description', 'name', 'requiresAbility']);
    expect(await place(W, 'plc_1_the-gull-anchor')).toMatchObject({
      name: 'The Gull and Anchor',
      sources: { description: 'mcp' },
      rules: { requiresAbility: 'good-coin' },
    });
    await ok('update_place', {
      worldId: W,
      placeId: 'plc_1_the-gull-anchor',
      rules: { requiresAbility: null },
    });
    expect((await place(W, 'plc_1_the-gull-anchor')).rules).toEqual({});
  });

  test('disconnecting reports a place left unreachable', async () => {
    const result = await ok('disconnect_places', {
      worldId: W,
      fromId: 'plc_1_market-square',
      toId: 'plc_1_the-gull-anchor',
    });
    expect(result.layout.problems).toEqual([
      'Not reachable from a way in: The Gull and Anchor (plc_1_the-gull-anchor).',
    ]);
    expect((await place(W, 'plc_1_market-square')).connections).not.toContain(
      'plc_1_the-gull-anchor'
    );
    expect((await place(W, 'plc_1_the-gull-anchor')).connections).toEqual([]);
    await ok('connect_places', {
      worldId: W,
      fromId: 'plc_1_the-gull-anchor',
      toId: 'plc_1_market-square',
    });
  });
});

describe('characters in town', () => {
  const W = LIVE;

  test('a character can live at a place in their town, and only there', async () => {
    const { character } = await ok('add_character', {
      worldId: W,
      name: 'Brannoch',
      description: 'Keeps the tavern.',
      locationId: 'loc_1',
      placeId: 'plc_1_the-gull-anchor',
    });
    expect(character.place).toEqual({ id: 'plc_1_the-gull-anchor', name: 'The Gull and Anchor' });
    const inTown = await ok('get_town', { worldId: W, locationId: 'loc_1' });
    expect(inTown.places.find((p) => p.id === 'plc_1_the-gull-anchor')).toMatchObject({
      residents: [{ id: 'chr_brannoch', name: 'Brannoch' }],
      grade: 'rich',
    });
    expect(
      await refused('add_character', {
        worldId: W,
        name: 'Stranger',
        description: 'Lost.',
        locationId: 'loc_1',
        placeId: 'plc_631_the-harbour',
      })
    ).toMatch(/is not in Burdendal/);
  });

  test('moving a character to another settlement clears their place', async () => {
    await ok('update_character', {
      worldId: W,
      characterId: 'chr_brannoch',
      locationId: 'loc_631',
    });
    let stored = (await worlds().doc(W).collection('characters').doc('chr_brannoch').get()).data();
    expect(stored.locationId).toBe('loc_631');
    expect(stored).not.toHaveProperty('placeId');
    await ok('update_character', {
      worldId: W,
      characterId: 'chr_brannoch',
      locationId: 'loc_1',
      placeId: 'plc_1_market-square',
    });
    stored = (await worlds().doc(W).collection('characters').doc('chr_brannoch').get()).data();
    expect(stored).toMatchObject({ locationId: 'loc_1', placeId: 'plc_1_market-square' });
    await ok('update_character', { worldId: W, characterId: 'chr_brannoch', placeId: null });
    stored = (await worlds().doc(W).collection('characters').doc('chr_brannoch').get()).data();
    expect(stored).not.toHaveProperty('placeId');
  });
});

describe('removing places', () => {
  test('in a published world a place is retired, kept for saves standing there', async () => {
    const result = await ok('retire_entity', {
      worldId: LIVE,
      type: 'place',
      id: 'plc_1_the-gull-anchor',
    });
    expect(result.retired).toEqual({
      type: 'place',
      id: 'plc_1_the-gull-anchor',
      name: 'The Gull and Anchor',
    });
    expect(await place(LIVE, 'plc_1_the-gull-anchor')).toMatchObject({ retired: true });
    // Links to it stay stored; the loaded world drops them.
    expect((await place(LIVE, 'plc_1_market-square')).connections).toContain(
      'plc_1_the-gull-anchor'
    );
    const inTown = await ok('get_town', { worldId: LIVE, locationId: 'loc_1' });
    expect(inTown.layout.valid).toBe(true);
    expect(inTown.places.find((p) => p.id === 'plc_1_the-gull-anchor').retired).toBe(true);
  });

  test('in a draft a place is deleted, and every link to it cleaned', async () => {
    const W = DRAFT;
    const add = (name, extra) =>
      ok('add_place', {
        worldId: W,
        locationId: 'loc_1',
        name,
        kind: 'place',
        description: `${name}.`,
        ...extra,
      });
    await add('The Quay', { entranceFor: ['sea'] });
    await add('Fish Market', { connectTo: ['plc_1_the-quay'] });
    await add('Net Sheds', { connectTo: ['plc_1_fish-market'] });
    await ok('add_character', {
      worldId: W,
      name: 'Old Wick',
      description: 'Mends nets.',
      locationId: 'loc_1',
      placeId: 'plc_1_net-sheds',
    });
    expect(
      await refused('retire_entity', { worldId: W, type: 'place', id: 'plc_1_net-sheds' })
    ).toMatch(/Characters are found here: Old Wick/);
    expect(await refused('retire_entity', { worldId: W, type: 'location', id: 'loc_1' })).toMatch(
      /It has a town of 3 place\(s\)/
    );

    await ok('update_character', { worldId: W, characterId: 'chr_old-wick', placeId: null });
    const result = await ok('retire_entity', { worldId: W, type: 'place', id: 'plc_1_net-sheds' });
    expect(result.deleted).toMatchObject({ id: 'plc_1_net-sheds' });
    expect(await place(W, 'plc_1_net-sheds')).toBeUndefined();
    expect((await place(W, 'plc_1_fish-market')).connections).toEqual(['plc_1_the-quay']);
  });
});

test('list_work puts the places of the nearest towns right after the frontier', async () => {
  const list = await ok('list_work', { worldId: LIVE, kind: 'place' });
  expect(list.byTier).toMatchObject({ town: list.total });
  expect(list.items[0]).toMatchObject({
    priority: 'town',
    type: 'place',
    town: { id: 'loc_1', name: 'Burdendal' },
    hops: 0,
    missing: ['residents'],
  });
  expect(list.howTo.residents).toMatch(/placeId/);
  const all = await ok('list_work', { worldId: LIVE, limit: 100 });
  const tiers = [...new Set(all.items.map((i) => i.priority))];
  expect(tiers.indexOf('town')).toBeLessThan(tiers.indexOf('closed'));
});
