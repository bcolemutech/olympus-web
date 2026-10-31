'use strict';

/**
 * The Cartographer's MCP battle-map tools (planning/the-loom-layered-worlds.md
 * §9; L-352 / #401), driven by a real MCP client against Nisia in the
 * Firestore emulator: drawing maps (and every way a map can be wrong),
 * generic maps, assigning maps to places in town and points of interest,
 * reading them back, the work list, and removing maps.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-maps --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-maps';
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
const { PNG } = require(require.resolve('pngjs', { paths: [functionsDir] }));
const jpeg = require(require.resolve('jpeg-js', { paths: [functionsDir] }));
const ARTS = {}; // Cloud Storage path → PNG, for view_image
function solidPng(width, height) {
  const img = new PNG({ width, height });
  img.data.fill(170);
  return PNG.sync.write(img);
}
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
const LIVE = 'nisia-m0m0m0'; // published
const DRAFT = 'nisia-m1m1m1';

const adminApp = initializeApp({ projectId: 'demo-cartographer-maps' }, 'cartographer-maps-test');
const db = getFirestore(adminApp);
const worlds = () => db.collection('loom_worlds');
const PARSED = parseAzgaarExport(
  fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
);

// SVG art (set_art) goes through the Cartographer's real service, into the
// Storage emulator; view_image reads from memory first, then from there.
const { getStorage } = require(
  require.resolve('firebase-admin/storage', { paths: [functionsDir] })
);
const { createCartographerService } = require('../functions/cartographer/service');
const bucket = getStorage(adminApp).bucket('demo-cartographer-maps.appspot.com');
const writer = createFirestoreWorldWriter(() => db);
const service = createCartographerService({ db, bucket, writer });

const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader: createFirestoreWorldReader(() => db),
    writer,
    art: {
      load: async (artPath) => {
        if (ARTS[artPath]) return ARTS[artPath];
        return (await bucket.file(artPath).download())[0];
      },
      draw: (uid, args) => service.drawArt(uid, args),
    },
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
  client = new Client({ name: 'cartographer-maps-test', version: '0.0.0' });
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

const mapDoc = async (worldId, id) =>
  (await worlds().doc(worldId).collection('battleMaps').doc(id).get()).data();

// The Gull & Anchor's ground floor: a door out, stairs down, a bar.
const TAVERN = {
  name: 'The Gull & Anchor, ground floor',
  width: 12,
  height: 8,
  entries: [
    { id: 'door', x: 1, y: 4 },
    { id: 'stair-top', x: 10, y: 6 },
  ],
  exits: [{ id: 'front-door', name: 'the front door', x: 0, y: 4, to: 'out' }],
  features: [{ id: 'bar', name: 'the bar', x: 3, y: 2 }],
};

test('the battle-map tools are there; the reads only read', async () => {
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  expect(byName.set_battle_map.annotations.readOnlyHint).toBe(false);
  expect(byName.assign_battle_map.annotations.readOnlyHint).toBe(false);
  expect(byName.list_battle_maps.annotations.readOnlyHint).toBe(true);
  expect(byName.get_battle_map.annotations.readOnlyHint).toBe(true);
});

describe('drawing maps', () => {
  const W = LIVE;

  test('set_battle_map makes a new map, stamped, with no image yet', async () => {
    const result = await ok('set_battle_map', { worldId: W, ...TAVERN });
    expect(result).toMatchObject({
      created: true,
      map: {
        id: 'bm_the-gull-anchor-ground-floor',
        size: { width: 12, height: 8 },
        generic: null,
        hasImage: false,
        usedBy: 0,
      },
    });
    expect(await mapDoc(W, 'bm_the-gull-anchor-ground-floor')).toMatchObject({
      name: 'The Gull & Anchor, ground floor',
      image: null,
      generic: null,
      sources: { map: 'mcp' },
      features: [{ id: 'bar', name: 'the bar', x: 3, y: 2 }],
    });
  });

  test.each([
    [
      'an entry off the grid',
      { entries: [{ id: 'door', x: 12, y: 0 }] },
      /The entry "door" at \(12, 0\) is off the 12 × 8 grid/,
    ],
    [
      'two exits with one id',
      {
        exits: [
          { id: 'door', name: 'a door', x: 0, y: 1, to: 'out' },
          { id: 'door', name: 'a door', x: 0, y: 2, to: 'out' },
        ],
      },
      /Two exit ids are "door"/,
    ],
    [
      'two exits on one cell',
      {
        exits: [
          { id: 'a', name: 'a door', x: 0, y: 1, to: 'out' },
          { id: 'b', name: 'a hatch', x: 0, y: 1, to: 'out' },
        ],
      },
      /The exits "a" and "b" share the cell \(0, 1\)/,
    ],
    [
      'a feature on an exit',
      { features: [{ id: 'mat', name: 'the mat', x: 0, y: 4 }] },
      /The feature "mat" sits on the exit "front-door"/,
    ],
    [
      'an exit to a map that does not exist',
      {
        exits: [{ id: 'down', name: 'the trapdoor', x: 5, y: 5, to: { map: 'bm_nowhere' } }],
      },
      /leads to "bm_nowhere", which is no live battle map/,
    ],
  ])('refuses %s', async (_label, change, message) => {
    expect(await refused('set_battle_map', { worldId: W, ...TAVERN, ...change })).toMatch(message);
  });

  test('the schema refuses a map with no entry, or bigger than 64 cells', async () => {
    expect((await call('set_battle_map', { worldId: W, ...TAVERN, entries: [] })).isError).toBe(
      true
    );
    expect((await call('set_battle_map', { worldId: W, ...TAVERN, width: 65 })).isError).toBe(true);
  });

  test('a cellar linked both ways; the entry it leads to can’t be taken away', async () => {
    const cellar = await ok('set_battle_map', {
      worldId: W,
      name: 'The cellar',
      width: 6,
      height: 6,
      entries: [{ id: 'stair-foot', x: 5, y: 5 }],
      exits: [
        {
          id: 'stairs-up',
          name: 'the stairs up',
          x: 5,
          y: 4,
          to: { map: 'bm_the-gull-anchor-ground-floor', entry: 'stair-top' },
        },
      ],
      features: [{ id: 'casks', name: 'the casks', x: 1, y: 1 }],
    });
    expect(cellar.map.id).toBe('bm_the-cellar');
    // The ground floor gains its stairs down; an entry the cellar doesn't have is refused.
    const down = (entry) => ({
      id: 'cellar-stairs',
      name: 'the cellar stairs',
      x: 11,
      y: 7,
      to: { map: 'bm_the-cellar', ...(entry ? { entry } : {}) },
    });
    expect(
      await refused('set_battle_map', {
        worldId: W,
        mapId: 'bm_the-gull-anchor-ground-floor',
        ...TAVERN,
        exits: [...TAVERN.exits, down('trapdoor')],
      })
    ).toMatch(/leads to an entry "trapdoor" it doesn't have/);
    await ok('set_battle_map', {
      worldId: W,
      mapId: 'bm_the-gull-anchor-ground-floor',
      ...TAVERN,
      exits: [...TAVERN.exits, down('stair-foot')],
    });
    // Dropping the stair-top entry would strand the cellar's stairs up.
    expect(
      await refused('set_battle_map', {
        worldId: W,
        mapId: 'bm_the-gull-anchor-ground-floor',
        ...TAVERN,
        entries: [{ id: 'door', x: 1, y: 4 }],
        exits: [...TAVERN.exits, down('stair-foot')],
      })
    ).toMatch(
      /"the stairs up" on The cellar \(bm_the-cellar\) leads to this map's entry "stair-top"/
    );
  });

  test('replacing a map keeps its image, and warns when the grid shrinks', async () => {
    await worlds()
      .doc(W)
      .collection('battleMaps')
      .doc('bm_the-cellar')
      .update({ image: { path: `worlds/${W}/map-bm_the-cellar.png`, width: 600, height: 600 } });
    await worlds()
      .doc(W)
      .update({ canonVersion: (await worlds().doc(W).get()).data().canonVersion + 1 });
    const result = await ok('set_battle_map', {
      worldId: W,
      mapId: 'bm_the-cellar',
      name: 'The cellar',
      width: 6,
      height: 5,
      entries: [{ id: 'stair-foot', x: 5, y: 4 }],
      exits: [
        {
          id: 'stairs-up',
          name: 'the stairs up',
          x: 5,
          y: 3,
          to: { map: 'bm_the-gull-anchor-ground-floor', entry: 'stair-top' },
        },
      ],
    });
    expect(result.warnings).toEqual([
      'The grid is smaller now: players standing beyond its edge are moved to its entry.',
      'Players who had explored it start over: what they had seen of it is forgotten.',
      'It has no walls, doors or obstacles: players walk anywhere on it, and a place with it ' +
        'as its own map earns only half its score for a map. Add them with set_map_layers.',
    ]);
    expect(await mapDoc(W, 'bm_the-cellar')).toMatchObject({
      image: { path: `worlds/${W}/map-bm_the-cellar.png`, width: 600, height: 600 },
      height: 5,
    });
    expect(result.map.hasImage).toBe(true);
  });

  test('a generic map, found by kind and terrain', async () => {
    await ok('set_battle_map', {
      worldId: W,
      name: 'A roadside tavern',
      width: 10,
      height: 8,
      entries: [{ id: 'door', x: 0, y: 4 }],
      exits: [{ id: 'door-out', name: 'the door', x: 0, y: 3, to: 'out' }],
      generic: { kind: 'Tavern', terrain: 'road' },
    });
    await ok('set_battle_map', {
      worldId: W,
      name: 'A forest clearing',
      width: 16,
      height: 16,
      entries: [{ id: 'path', x: 8, y: 15 }],
      exits: [{ id: 'path-out', name: 'the path', x: 8, y: 14, to: 'out' }],
      generic: { kind: 'clearing', terrain: 'forest' },
    });
    const taverns = await ok('list_battle_maps', { worldId: W, generic: true, kind: 'tavern' });
    expect(taverns.maps.map((m) => [m.id, m.generic])).toEqual([
      ['bm_a-roadside-tavern', { kind: 'tavern', terrain: 'road' }],
    ]);
    expect((await ok('list_battle_maps', { worldId: W, terrain: 'forest' })).count).toBe(1);
    expect(
      (await ok('list_battle_maps', { worldId: W, generic: false })).maps.map((m) => m.id)
    ).toEqual(['bm_the-cellar', 'bm_the-gull-anchor-ground-floor']);
  });
});

describe('assigning maps', () => {
  const W = LIVE;

  beforeAll(async () => {
    await ok('add_place', {
      worldId: W,
      locationId: 'loc_1',
      name: 'The Gull & Anchor',
      kind: 'tavern',
      description: 'Low beams, eel pie.',
      entranceFor: ['sea', 'trail'],
    });
  });

  test('a place in town and a point of interest take maps; settlements do not', async () => {
    const tavern = await ok('assign_battle_map', {
      worldId: W,
      placeId: 'plc_1_the-gull-anchor',
      mapId: 'bm_the-gull-anchor-ground-floor',
    });
    expect(tavern).toMatchObject({
      battleMap: {
        id: 'bm_the-gull-anchor-ground-floor',
        name: 'The Gull & Anchor, ground floor',
        generic: false,
      },
      updated: ['battleMap'],
    });
    expect(await place(W, 'plc_1_the-gull-anchor')).toMatchObject({
      battleMap: { mapId: 'bm_the-gull-anchor-ground-floor' },
    });
    const ruin = await ok('assign_battle_map', {
      worldId: W,
      placeId: 'poi_1',
      mapId: 'bm_a-forest-clearing',
    });
    expect(ruin.note).toMatch(/only its own map adds to its score/);
    expect(
      await refused('assign_battle_map', { worldId: W, placeId: 'loc_1', mapId: 'bm_the-cellar' })
    ).toMatch(/Burdendal is a settlement: it has a town, not a battle map/);
    expect(
      await refused('assign_battle_map', { worldId: W, placeId: 'poi_1', mapId: 'bm_nowhere' })
    ).toMatch(/No battleMap "bm_nowhere"/);
    // Assigning the same map again changes nothing.
    expect(
      (
        await ok('assign_battle_map', {
          worldId: W,
          placeId: 'poi_1',
          mapId: 'bm_a-forest-clearing',
        })
      ).updated
    ).toEqual([]);
  });

  test('reads show each place’s map, and each map its places', async () => {
    const detail = await ok('get_battle_map', {
      worldId: W,
      mapId: 'bm_the-gull-anchor-ground-floor',
    });
    expect(detail.exits.find((e) => e.id === 'cellar-stairs').to).toEqual({
      map: 'bm_the-cellar',
      mapName: 'The cellar',
      entry: 'stair-foot',
    });
    expect(detail.exits.find((e) => e.id === 'front-door').to).toBe('out');
    expect(detail.usedBy).toEqual([
      { type: 'place', id: 'plc_1_the-gull-anchor', name: 'The Gull & Anchor', town: 'Burdendal' },
    ]);
    const inTown = await ok('get_town', { worldId: W, locationId: 'loc_1' });
    expect(inTown.places.find((p) => p.id === 'plc_1_the-gull-anchor').battleMap).toEqual({
      id: 'bm_the-gull-anchor-ground-floor',
      name: 'The Gull & Anchor, ground floor',
      generic: false,
    });
    expect((await ok('get_location', { worldId: W, locationId: 'poi_1' })).battleMap).toEqual({
      id: 'bm_a-forest-clearing',
      name: 'A forest clearing',
      generic: true,
    });
    expect(await refused('get_battle_map', { worldId: W, mapId: 'bm_nowhere' })).toMatch(
      /No battle map "bm_nowhere"/
    );
  });

  test('list_work need battleMap: every place whose map is not finished (L-622, L-628)', async () => {
    // The ruin, written up and with lore, is on a generic map: open, but short
    // of Rich, so it stays on the ordinary work list too.
    await ok('update_location', { worldId: W, locationId: 'poi_1', description: 'Old towers.' });
    await ok('add_lore', { worldId: W, title: 'The Towers', text: 'Raised by…', about: ['poi_1'] });
    const ruin = await ok('get_location', { worldId: W, locationId: 'poi_1' });
    expect(ruin.grade).toBe('playable');
    expect(ruin.missing).toContainEqual(
      expect.objectContaining({
        need: 'battleMap',
        criterion: 'place.ownMap',
        message: 'It uses a generic battle map.',
      })
    );
    // Its own map is score work (L-692), grouped with every place on a
    // generic one; an own map without walls is work of its own.
    const scored = (list) => list.items.filter((i) => i.priority === 'score');
    const entitiesOf = (list, need) =>
      scored(list)
        .filter((g) => g.criterion === 'place.ownMap' && g.need === need)
        .flatMap((g) => g.entities.map((e) => e.id));
    const ordinary = await ok('list_work', { worldId: W, kind: 'poi', limit: 100 });
    expect(entitiesOf(ordinary, 'battleMap')).toContain('poi_1');
    const work = await ok('list_work', { worldId: W, need: 'battleMap', limit: 100 });
    expect(entitiesOf(work, 'battleMap')).toContain('poi_1');
    // The Gull & Anchor has its own map, but no walls yet: still listed.
    expect(entitiesOf(work, 'layers')).toContain('plc_1_the-gull-anchor');
    // And maps without walls of their own (battle maps are scored too).
    expect(
      scored(work).every((g) => ['place.ownMap', 'battleMap.layers'].includes(g.criterion))
    ).toBe(true);
    expect(
      work.items
        .filter((i) => i.priority !== 'score')
        .every((i) => i.missing.includes('battleMap') || i.battleMap !== 'own')
    ).toBe(true);
    expect(work.howTo.battleMap).toMatch(/set_battle_map/);
    // Walled, it leaves the battle-map list.
    await ok('set_map_layers', {
      worldId: W,
      mapId: 'bm_the-gull-anchor-ground-floor',
      walls: [
        {
          points: [
            { x: 6, y: 0 },
            { x: 6, y: 2 },
          ],
        },
      ],
    });
    const after = await ok('list_work', { worldId: W, need: 'battleMap', limit: 100 });
    expect(entitiesOf(after, 'layers')).not.toContain('plc_1_the-gull-anchor');
    // Closed places still say where their map stands.
    const all = await ok('list_work', { worldId: W, kind: 'poi', limit: 1 });
    expect(['none', 'generic', 'own']).toContain(all.items[0].battleMap);
  });

  test('mapId null takes a map away', async () => {
    await ok('assign_battle_map', { worldId: W, placeId: 'poi_1', mapId: null });
    expect((await ok('get_location', { worldId: W, locationId: 'poi_1' })).battleMap).toBeNull();
  });
});

describe('removing maps', () => {
  test('not while a place uses it, nor while another map’s exit leads to it', async () => {
    expect(
      await refused('retire_entity', {
        worldId: LIVE,
        type: 'battleMap',
        id: 'bm_the-gull-anchor-ground-floor',
      })
    ).toMatch(/It is the battle map of The Gull & Anchor \(plc_1_the-gull-anchor\)/);
    expect(
      await refused('retire_entity', { worldId: LIVE, type: 'battleMap', id: 'bm_the-cellar' })
    ).toMatch(/Exits on The Gull & Anchor, ground floor .* lead to it/);
  });

  test('in a published world a map is retired; in a draft it is deleted', async () => {
    const result = await ok('retire_entity', {
      worldId: LIVE,
      type: 'battleMap',
      id: 'bm_a-roadside-tavern',
    });
    expect(result.retired).toMatchObject({ id: 'bm_a-roadside-tavern' });
    expect(await mapDoc(LIVE, 'bm_a-roadside-tavern')).toMatchObject({ retired: true });
    expect(
      (await ok('list_battle_maps', { worldId: LIVE })).maps.some(
        (m) => m.id === 'bm_a-roadside-tavern'
      )
    ).toBe(false);
    expect(
      await refused('assign_battle_map', {
        worldId: LIVE,
        placeId: 'poi_1',
        mapId: 'bm_a-roadside-tavern',
      })
    ).toMatch(/has been retired/);

    await ok('set_battle_map', {
      worldId: DRAFT,
      name: 'A hut',
      width: 4,
      height: 4,
      entries: [{ id: 'in', x: 0, y: 1 }],
      exits: [{ id: 'out', name: 'the door', x: 0, y: 0, to: 'out' }],
    });
    expect(
      await ok('retire_entity', { worldId: DRAFT, type: 'battleMap', id: 'bm_a-hut' })
    ).toMatchObject({ deleted: { id: 'bm_a-hut' } });
    expect(await mapDoc(DRAFT, 'bm_a-hut')).toBeUndefined();
  });
});

describe('view_image: what Claude sees', () => {
  const W = LIVE;
  const view = (args) => call('view_image', { worldId: W, ...args });
  const pictureOf = (result) => {
    const [image] = result.content;
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    return jpeg.decode(Buffer.from(image.data, 'base64'));
  };

  test('a battle map without art: drawn on a plain grid, with its markers in the legend', async () => {
    const result = await view({ of: 'battleMap', id: 'bm_the-gull-anchor-ground-floor' });
    expect(result.isError).toBeFalsy();
    const picture = pictureOf(result);
    expect(picture.width / picture.height).toBeCloseTo(12 / 8, 2);
    expect(result.structuredContent).toMatchObject({
      worldId: W,
      of: 'battleMap',
      art: false,
      grid: { width: 12, height: 8 },
    });
    expect(result.structuredContent.markers.map((m) => [m.n, m.type, m.id])).toEqual([
      [1, 'entry', 'door'],
      [2, 'entry', 'stair-top'],
      [3, 'exit', 'front-door'],
      [4, 'exit', 'cellar-stairs'],
      [5, 'feature', 'bar'],
    ]);
    // The legend is also there as text, for clients that only read text.
    expect(JSON.parse(result.content[1].text).markers).toHaveLength(5);
  });

  test('with art: the art is drawn under the grid', async () => {
    ARTS[`worlds/${W}/map-bm_the-cellar.png`] = solidPng(600, 500);
    const result = await view({ of: 'battleMap', id: 'bm_the-cellar' });
    expect(result.structuredContent).toMatchObject({
      art: true,
      image: { width: 600, height: 500 },
    });
    expect(pictureOf(result).width).toBe(600);
  });

  test('a town: its places at their positions, the rest listed as not positioned', async () => {
    await ok('update_place', {
      worldId: W,
      placeId: 'plc_1_the-gull-anchor',
      position: { x: 300, y: 700 },
    });
    const result = await view({ of: 'town', id: 'loc_1' });
    expect(result.structuredContent).toMatchObject({
      of: 'town',
      name: 'Burdendal',
      art: false,
      markers: [{ n: 1, id: 'plc_1_the-gull-anchor', wayIn: true, position: { x: 300, y: 700 } }],
    });
    expect(pictureOf(result).width).toBe(1000);
  });

  test('the world map, once the world has one', async () => {
    expect((await view({ of: 'world' })).content[0].text).toMatch(
      /This world has no map image: it was imported without one/
    );
    const meta = (await worlds().doc(W).get()).data();
    await worlds()
      .doc(W)
      .update({ 'map.imagePath': `worlds/${W}/map.png`, canonVersion: meta.canonVersion + 1 });
    ARTS[`worlds/${W}/map.png`] = solidPng(1718, 1270);
    const result = await view({ of: 'world' });
    expect(result.structuredContent).toMatchObject({
      of: 'world',
      image: { width: 1568, height: 1159 },
    });
  });

  test('refusals: no id, not a settlement, art missing from storage', async () => {
    expect(await refused('view_image', { worldId: W, of: 'battleMap' })).toMatch(
      /Give the battle map id/
    );
    expect(await refused('view_image', { worldId: W, of: 'town', id: 'poi_1' })).toMatch(
      /isn't a settlement/
    );
    delete ARTS[`worlds/${W}/map-bm_the-cellar.png`];
    expect(
      await refused('view_image', { worldId: W, of: 'battleMap', id: 'bm_the-cellar' })
    ).toMatch(/could not be read from storage/);
  });

  test('view_image only reads', async () => {
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'view_image').annotations.readOnlyHint).toBe(true);
  });
});

describe('set_art: Claude draws the art, as SVG (L-356)', () => {
  const W = LIVE;
  const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8">' +
    '<rect width="12" height="8" fill="#6d5a45"/>' +
    '<rect x="2" y="1" width="4" height="2" fill="#3b2a1d"/></svg>';
  const tavernMap = () => mapDoc(W, 'bm_the-gull-anchor-ground-floor');
  // set_art's SVG is a library image (L-704).
  const libraryImage = async (imageId) =>
    (await db.collection('studio_images').doc(imageId).get()).data();

  test('a battle map’s art: stored as SVG, to be downloaded if opened directly', async () => {
    const result = await ok('set_art', {
      worldId: W,
      of: 'battleMap',
      id: 'bm_the-gull-anchor-ground-floor',
      svg: SVG,
    });
    expect(result).toEqual({
      of: 'battleMap',
      id: 'bm_the-gull-anchor-ground-floor',
      name: 'The Gull & Anchor, ground floor',
      art: { imageId: expect.stringMatching(/^img_/), format: 'svg', width: 12, height: 8 },
      next: 'Check it with view_image.',
    });
    const { image } = await tavernMap();
    expect(image).toMatchObject({
      imageId: result.art.imageId,
      width: 12,
      height: 8,
      format: 'svg',
    });
    const stored = await libraryImage(image.imageId);
    expect(stored).toMatchObject({
      kind: 'battleMap',
      via: 'mcp',
      usedIn: [{ worldId: W, target: 'battleMap', id: 'bm_the-gull-anchor-ground-floor' }],
    });
    expect(stored.versions[0].path).toMatch(new RegExp(`^studio/${image.imageId}/v1\\.svg$`));
    const [meta] = await bucket.file(stored.versions[0].path).getMetadata();
    expect(meta).toMatchObject({ contentType: 'image/svg+xml', contentDisposition: 'attachment' });
    // view_image draws it, under the grid.
    const seen = await call('view_image', {
      worldId: W,
      of: 'battleMap',
      id: 'bm_the-gull-anchor-ground-floor',
    });
    expect(seen.structuredContent).toMatchObject({ art: true });
    expect(seen.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
  });

  test('a shape that isn’t the grid’s is stretched, with a warning; replacing frees the old', async () => {
    const old = (await tavernMap()).image.imageId;
    const wide = await ok('set_art', {
      worldId: W,
      of: 'battleMap',
      id: 'bm_the-gull-anchor-ground-floor',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>',
    });
    expect(wide.warnings[0]).toMatch(/isn't the grid's \(12 × 8\), so it is stretched/);
    // The old image stays in the library, no longer used.
    expect((await libraryImage(old)).usedIn).toEqual([]);
  });

  test('a town’s art; not square is fitted, with a warning', async () => {
    const square = await ok('set_art', {
      worldId: W,
      of: 'town',
      id: 'loc_1',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><circle cx="500" cy="500" r="400"/></svg>',
    });
    expect(square).toMatchObject({ art: { format: 'svg', width: 1000, height: 1000 } });
    expect(square).not.toHaveProperty('warnings');
    const loc = (await worlds().doc(W).collection('locations').doc('loc_1').get()).data();
    expect(loc.town.image).toMatchObject({ format: 'svg', width: 1000 });
    const wide = await ok('set_art', {
      worldId: W,
      of: 'town',
      id: 'loc_1',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900"/></svg>',
    });
    expect(wide.warnings[0]).toMatch(/isn't square/);
    expect((await ok('get_town', { worldId: W, locationId: 'loc_1' })).art).toEqual({
      imageId: wide.art.imageId,
      width: 1600,
      height: 900,
    });
  });

  test('unsafe SVG is refused, and nothing is stored', async () => {
    const before = (await tavernMap()).image.imageId;
    expect(
      await refused('set_art', {
        worldId: W,
        of: 'battleMap',
        id: 'bm_the-gull-anchor-ground-floor',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8"><script>alert(1)</script></svg>',
      })
    ).toMatch(/can't be used: it has a script/);
    expect((await tavernMap()).image.imageId).toBe(before);
    expect(await refused('set_art', { worldId: W, of: 'town', id: 'poi_1', svg: SVG })).toMatch(
      /isn't a settlement/
    );
    expect(
      await refused('set_art', { worldId: W, of: 'battleMap', id: 'bm_nowhere', svg: SVG })
    ).toMatch(/No battle map "bm_nowhere"/);
  });

  test('svg null takes the art away', async () => {
    const art = (await tavernMap()).image.imageId;
    expect(
      await ok('set_art', {
        worldId: W,
        of: 'battleMap',
        id: 'bm_the-gull-anchor-ground-floor',
        svg: null,
      })
    ).toMatchObject({ art: null });
    expect((await tavernMap()).image).toBeNull();
    expect((await libraryImage(art)).usedIn).toEqual([]);
  });
});

describe('walls, doors and obstacles (L-622)', () => {
  const W = LIVE;
  // A back room: a wall across it at x = 4 with a door in the gap at y 2–3,
  // a table (low) and a pillar (solid); a chest to reach.
  const ROOM = {
    name: 'The back room',
    width: 8,
    height: 6,
    entries: [{ id: 'in', x: 1, y: 3 }],
    exits: [{ id: 'out', name: 'the hall door', x: 0, y: 3, to: 'out' }],
    features: [{ id: 'chest', name: 'the chest', x: 6, y: 1 }],
  };
  const WALLS = [
    {
      points: [
        { x: 4, y: 0 },
        { x: 4, y: 2 },
      ],
    },
    {
      points: [
        { x: 4, y: 3 },
        { x: 4, y: 6 },
      ],
    },
  ];
  const DOORS = [{ id: 'inner', name: 'the inner door', from: { x: 4, y: 2 }, to: { x: 4, y: 3 } }];
  const OBSTACLES = [
    { id: 'table', name: 'a table', kind: 'low', x: 2, y: 1, w: 2 },
    { id: 'pillar', name: 'a pillar', kind: 'solid', x: 6, y: 4 },
  ];
  let mapId;

  test('a new map without layers is made, with a warning', async () => {
    const result = await ok('set_battle_map', { worldId: W, ...ROOM });
    mapId = result.map.id;
    expect(result.map.hasLayers).toBe(false);
    expect(result.warnings).toEqual([
      expect.stringMatching(/^It has no walls, doors or obstacles: .*set_map_layers\.$/),
    ]);
  });

  test('set_map_layers gives it walls, a door and obstacles; the reads show them', async () => {
    const result = await ok('set_map_layers', {
      worldId: W,
      mapId,
      walls: WALLS,
      doors: DOORS,
      obstacles: OBSTACLES,
    });
    expect(result).toMatchObject({
      map: { id: mapId, hasLayers: true },
      layers: { walls: 2, doors: 1, obstacles: 2 },
      updated: ['walls', 'doors', 'obstacles'],
    });
    expect(result.warnings).toBeUndefined();
    expect(await mapDoc(W, mapId)).toMatchObject({
      walls: WALLS,
      doors: DOORS,
      obstacles: OBSTACLES,
    });
    const read = await ok('get_battle_map', { worldId: W, mapId });
    expect(read).toMatchObject({ walls: WALLS, doors: DOORS, obstacles: OBSTACLES });
    const listed = await ok('list_battle_maps', { worldId: W });
    expect(listed.maps.find((m) => m.id === mapId)).toMatchObject({ hasLayers: true });
  });

  test('view_image draws them, and its legend numbers the door and obstacles (L-623)', async () => {
    const seen = await call('view_image', { worldId: W, of: 'battleMap', id: mapId });
    expect(seen.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    expect(seen.structuredContent.walls).toBe(2);
    expect(
      seen.structuredContent.markers.filter((m) => ['door', 'obstacle'].includes(m.type))
    ).toEqual([
      expect.objectContaining({ type: 'door', id: 'inner' }),
      expect.objectContaining({ type: 'obstacle', id: 'table', kind: 'low' }),
      expect.objectContaining({ type: 'obstacle', id: 'pillar', kind: 'solid' }),
    ]);
  });

  test('a list left out is kept; an empty list clears that one', async () => {
    const result = await ok('set_map_layers', { worldId: W, mapId, obstacles: [] });
    expect(result).toMatchObject({
      layers: { walls: 2, doors: 1, obstacles: 0 },
      updated: ['obstacles'],
    });
    expect(await mapDoc(W, mapId)).toMatchObject({ walls: WALLS, doors: DOORS, obstacles: [] });
    await ok('set_map_layers', { worldId: W, mapId, obstacles: OBSTACLES });
  });

  test('the checks refuse what would break the map, and nothing is written', async () => {
    const before = await mapDoc(W, mapId);
    const cases = [
      [
        {
          walls: [
            {
              points: [
                { x: 1, y: 1 },
                { x: 3, y: 2 },
              ],
            },
          ],
        },
        /must run along the grid lines/,
      ],
      [{ doors: [{ ...DOORS[0], from: { x: 4, y: 1 }, to: { x: 4, y: 2 } }] }, /sits on a wall/],
      [
        { obstacles: [{ id: 'crate', name: 'a crate', kind: 'solid', x: 0, y: 3 }] },
        /covers the exit "out"/,
      ],
      [
        // Walled in: the entry boxed by walls all round it.
        {
          walls: [
            ...WALLS,
            {
              points: [
                { x: 1, y: 3 },
                { x: 2, y: 3 },
                { x: 2, y: 4 },
                { x: 1, y: 4 },
                { x: 1, y: 3 },
              ],
            },
          ],
        },
        /The entry "in" at \(1, 3\) can't reach any exit/,
      ],
    ];
    for (const [layers, message] of cases) {
      expect(await refused('set_map_layers', { worldId: W, mapId, ...layers })).toMatch(message);
    }
    expect(await refused('set_map_layers', { worldId: W, mapId })).toMatch(
      /Give walls, doors or obstacles/
    );
    expect(await mapDoc(W, mapId)).toEqual(before);
  });

  test('a locked door can name its key and its lock difficulty (L-626)', async () => {
    const locked = [{ ...DOORS[0], locked: true, key: 'the brass key', difficulty: 18 }];
    await ok('set_map_layers', { worldId: W, mapId, doors: locked });
    expect((await mapDoc(W, mapId)).doors).toEqual(locked);
    expect(
      (
        await call('set_map_layers', {
          worldId: W,
          mapId,
          doors: [{ ...locked[0], difficulty: 40 }],
        })
      ).isError
    ).toBe(true);
    await ok('set_map_layers', { worldId: W, mapId, doors: DOORS });
  });

  test('a door and a feature can have their own AP cost and be long actions (L-831, L-832)', async () => {
    const stiff = [{ ...DOORS[0], ap: 10 }];
    await ok('set_map_layers', { worldId: W, mapId, doors: stiff });
    expect((await mapDoc(W, mapId)).doors).toEqual(stiff);
    for (const ap of [0, 2.5, 201]) {
      const bad = await call('set_map_layers', { worldId: W, mapId, doors: [{ ...DOORS[0], ap }] });
      expect(bad.isError).toBe(true);
    }
    await ok('set_map_layers', { worldId: W, mapId, doors: DOORS });
    // A long action (L-832): its AP in all, kept as given.
    const long = [{ ...DOORS[0], long: { ap: 30 } }];
    await ok('set_map_layers', { worldId: W, mapId, doors: long });
    expect((await mapDoc(W, mapId)).doors).toEqual(long);
    await ok('set_map_layers', { worldId: W, mapId, doors: DOORS });
    const lever = [{ ...ROOM.features[0], ap: 8, long: { ap: 40 } }];
    await ok('set_battle_map', { worldId: W, mapId, ...ROOM, features: lever });
    expect((await mapDoc(W, mapId)).features).toEqual(lever);
    const bad = await call('set_battle_map', {
      worldId: W,
      mapId,
      ...ROOM,
      features: [{ ...lever[0], ap: 0 }],
    });
    expect(bad.isError).toBe(true);
    await ok('set_battle_map', { worldId: W, mapId, ...ROOM });
  });

  test('a feature walled in is warned about', async () => {
    const boxed = [
      ...WALLS,
      {
        points: [
          { x: 5, y: 0 },
          { x: 5, y: 3 },
          { x: 8, y: 3 },
        ],
      },
    ];
    const result = await ok('set_map_layers', { worldId: W, mapId, walls: boxed });
    expect(result.warnings).toEqual([
      "Nobody can reach the chest at (6, 1) from an entry: it's walled in.",
    ]);
    await ok('set_map_layers', { worldId: W, mapId, walls: WALLS });
  });

  test('replacing the grid keeps the layers; a grid they no longer fit is refused', async () => {
    const result = await ok('set_battle_map', { worldId: W, mapId, ...ROOM, width: 9 });
    expect(result.map.hasLayers).toBe(true);
    expect(await mapDoc(W, mapId)).toMatchObject({ width: 9, walls: WALLS, obstacles: OBSTACLES });
    expect(await refused('set_battle_map', { worldId: W, mapId, ...ROOM, height: 5 })).toMatch(
      /Wall 2: every point must be a whole-number corner on the grid/
    );
    // Layers given with the grid replace the ones it had.
    await ok('set_battle_map', { worldId: W, mapId, ...ROOM, obstacles: [] });
    expect((await mapDoc(W, mapId)).obstacles).toEqual([]);
  });
});

describe('characters on squares (L-641)', () => {
  const W = DRAFT;
  // The Salt Cellar: a counter (low) under the bar, a wall along its far
  // side, so the bar is reached from the room only.
  const CELLAR = {
    name: 'The Salt Cellar',
    width: 10,
    height: 6,
    entries: [{ id: 'in', x: 1, y: 3 }],
    exits: [{ id: 'out', name: 'the stairs up', x: 0, y: 3, to: 'out' }],
    features: [{ id: 'bar', name: 'the bar', x: 5, y: 1 }],
    walls: [
      {
        points: [
          { x: 4, y: 1 },
          { x: 7, y: 1 },
        ],
      },
    ],
    obstacles: [{ id: 'counter', name: 'the counter', kind: 'low', x: 4, y: 1, w: 3 }],
  };
  const character = async (id) =>
    (await worlds().doc(W).collection('characters').doc(id).get()).data();
  let mapId;
  let cellar;
  let market;

  beforeAll(async () => {
    mapId = (await ok('set_battle_map', { worldId: W, ...CELLAR })).map.id;
    cellar = (
      await ok('add_place', {
        worldId: W,
        locationId: 'loc_1',
        name: 'The Salt Cellar',
        kind: 'tavern',
        description: 'Brine and pipe smoke.',
        entranceFor: ['sea', 'trail'],
        battleMap: mapId,
      })
    ).place.id;
    market = (
      await ok('add_place', {
        worldId: W,
        locationId: 'loc_1',
        name: 'The Fishmarket',
        kind: 'market',
        description: 'Gulls and gutting knives.',
        battleMap: mapId,
      })
    ).place.id;
  });

  const add = (name, args) =>
    ok('add_character', {
      worldId: W,
      name,
      description: 'A regular.',
      locationId: 'loc_1',
      placeId: cellar,
      ...args,
    });

  test('add_character puts them on a square; the reads show who stands where', async () => {
    const mags = await add('Old Mags', { cell: { x: 3, y: 4 } });
    expect(mags.character).toMatchObject({
      id: 'chr_old-mags',
      position: { level: 'square', x: 3, y: 4 },
    });
    expect(mags.warnings).toBeUndefined();
    expect(await character('chr_old-mags')).toMatchObject({ cell: { x: 3, y: 4 } });
    expect(await ok('get_character', { worldId: W, characterId: 'chr_old-mags' })).toMatchObject({
      position: { level: 'square', at: { id: cellar, name: 'The Salt Cellar' }, x: 3, y: 4 },
    });
    const map = await ok('get_battle_map', { worldId: W, mapId });
    expect(map.characters).toEqual([
      {
        id: 'chr_old-mags',
        name: 'Old Mags',
        x: 3,
        y: 4,
        at: { id: cellar, name: 'The Salt Cellar' },
      },
    ]);
  });

  test('a feature: its square, else the nearest free one beside it, not through a wall', async () => {
    // The bar sits on the counter; above it is the wall, so the first free
    // square beside it is below.
    const barkeep = await add('Tobin the Barkeep', { cell: { feature: 'bar' } });
    expect(barkeep.character.position).toMatchObject({ x: 5, y: 2 });
    // By name, too; the square below is taken, and the diagonals above
    // squeeze past the wall's corners.
    const potboy = await add('Wim', { cell: { feature: 'The Bar' } });
    expect(potboy.character.position).toMatchObject({ x: 6, y: 2 });
    expect(
      await refused('add_character', {
        worldId: W,
        name: 'Nobody',
        description: 'x',
        locationId: 'loc_1',
        placeId: cellar,
        cell: { feature: 'hearth' },
      })
    ).toMatch(/The Salt Cellar has no feature "hearth"/);
  });

  test('bad squares are refused, and nothing is written', async () => {
    const at = (cell, more = {}) =>
      refused('add_character', {
        worldId: W,
        name: 'Stray',
        description: 'x',
        locationId: 'loc_1',
        placeId: cellar,
        cell,
        ...more,
      });
    expect(await at({ x: 10, y: 0 })).toMatch(/\(10, 0\) is off the 10 × 6 grid/);
    expect(await at({ x: 4, y: 1 })).toMatch(/\(4, 1\) is the counter \(low\)/);
    expect(await at({ x: 1, y: 3 })).toMatch(/the entry "in", where players arrive/);
    expect(await at({ x: 0, y: 3 })).toMatch(/\(0, 3\) is the stairs up, an exit/);
    expect(await at({ x: 3, y: 4 })).toMatch(
      /Old Mags \(chr_old-mags\) already stands at \(3, 4\)/
    );
    // A settlement itself has a town, not a map.
    expect(await at({ x: 2, y: 2 }, { placeId: undefined })).toMatch(
      /^Stray needs a position: Burdendal is a town, so they need a townPoint, not a cell\./
    );
    expect(await character('chr_stray')).toBeUndefined();
    // The same square at another place on the same (shared) map is free.
    const seller = await add('Fen the Fishwife', { placeId: market, cell: { x: 3, y: 4 } });
    expect(seller.character.position).toMatchObject({ x: 3, y: 4 });
    const map = await ok('get_battle_map', { worldId: W, mapId });
    expect(map.characters.find((c) => c.id === 'chr_fen-the-fishwife').at.id).toBe(market);
  });

  test('a walled-in square is allowed, with a warning', async () => {
    await ok('set_map_layers', {
      worldId: W,
      mapId,
      walls: [
        ...CELLAR.walls,
        {
          points: [
            { x: 8, y: 4 },
            { x: 8, y: 6 },
          ],
        },
        {
          points: [
            { x: 8, y: 4 },
            { x: 10, y: 4 },
          ],
        },
      ],
    });
    const hidden = await add('The Rat King', { cell: { x: 9, y: 5 } });
    expect(hidden.warnings).toEqual([
      "Nobody can reach (9, 5) from an entry of The Salt Cellar: it's walled in.",
    ]);
  });

  test('update_character moves them; a move or a cleared square needs a position (L-682)', async () => {
    const moved = await ok('update_character', {
      worldId: W,
      characterId: 'chr_old-mags',
      cell: { x: 2, y: 5 },
    });
    expect(moved).toMatchObject({
      character: { position: { level: 'square', at: { id: cellar }, x: 2, y: 5 } },
      updated: ['cell'],
    });
    // The same square again changes nothing.
    expect(
      (
        await ok('update_character', {
          worldId: W,
          characterId: 'chr_old-mags',
          cell: { x: 2, y: 5 },
        })
      ).updated
    ).toEqual([]);
    expect(
      await refused('update_character', {
        worldId: W,
        characterId: 'chr_old-mags',
        cell: { x: 5, y: 2 },
      })
    ).toMatch(/Tobin the Barkeep \(chr_tobin-the-barkeep\) already stands at \(5, 2\)/);
    // Nobody is left without a position: null is refused, with a square offered.
    expect(
      await refused('update_character', { worldId: W, characterId: 'chr_old-mags', cell: null })
    ).toMatch(
      /^Old Mags needs a position: The Salt Cellar has a battle map: they need a square \(cell\)\. For example cell: \{ x: \d+, y: \d+ \}\.$/
    );
    expect((await character('chr_old-mags')).cell).toEqual({ x: 2, y: 5 });

    // Another place in town needs a square there.
    expect(
      await refused('update_character', { worldId: W, characterId: 'chr_wim', placeId: market })
    ).toMatch(/^Wim needs a position: The Fishmarket has a battle map/);
    await ok('update_character', {
      worldId: W,
      characterId: 'chr_wim',
      placeId: market,
      cell: { x: 7, y: 3 },
    });
    expect(await character('chr_wim')).toMatchObject({ placeId: market, cell: { x: 7, y: 3 } });

    // The wilderness: no settlement, no place, a world point.
    expect(
      await refused('update_character', { worldId: W, characterId: 'chr_wim', locationId: null })
    ).toBe(
      'Wim needs a position: they are in the wilderness: they need a world point (worldPoint).'
    );
    const away = await ok('update_character', {
      worldId: W,
      characterId: 'chr_wim',
      locationId: null,
      worldPoint: { x: 10, y: 20 },
    });
    expect(away.updated.sort()).toEqual(['cell', 'locationId', 'placeId', 'worldPoint']);
    expect(away.character.position).toEqual({ level: 'world', x: 10, y: 20 });
    const wim = await character('chr_wim');
    expect(wim).toMatchObject({ worldPoint: { x: 10, y: 20 } });
    expect(wim.cell).toBeUndefined();
    expect(wim.placeId).toBeUndefined();
    expect(wim.locationId).toBeUndefined();
  });

  test('replacing the grid is a new map to players: its revision moves on', async () => {
    expect((await mapDoc(W, mapId)).revision).toBeUndefined();
    const redrawn = await ok('set_battle_map', { worldId: W, mapId, ...CELLAR });
    expect(redrawn.warnings).toContain(
      'Players who had explored it start over: what they had seen of it is forgotten.'
    );
    expect((await mapDoc(W, mapId)).revision).toBe(1);
    // Its layers alone are not a new map.
    await ok('set_map_layers', { worldId: W, mapId, walls: CELLAR.walls });
    expect((await mapDoc(W, mapId)).revision).toBe(1);
  });

  test('changing the map warns about characters left where they can’t stand', async () => {
    const shrunk = await ok('set_battle_map', {
      worldId: W,
      mapId,
      ...CELLAR,
      width: 8,
      walls: CELLAR.walls,
    });
    expect(shrunk.warnings).toEqual(
      expect.arrayContaining([
        'The grid is smaller now: players standing beyond its edge are moved to its entry.',
        "The Rat King (chr_the-rat-king) stands where they can't: (9, 5) is off the 8 × 6 grid. " +
          'Move them with update_character (cell).',
      ])
    );
    const covered = await ok('set_map_layers', {
      worldId: W,
      mapId,
      obstacles: [
        ...CELLAR.obstacles,
        { id: 'barrels', name: 'some barrels', kind: 'solid', x: 3, y: 4 },
      ],
    });
    expect(covered.warnings).toEqual([
      "Fen the Fishwife (chr_fen-the-fishwife) stands where they can't: (3, 4) is some barrels " +
        '(solid). Move them with update_character (cell).',
      "The Rat King (chr_the-rat-king) stands where they can't: (9, 5) is off the 8 × 6 grid. " +
        'Move them with update_character (cell).',
    ]);
  });

  test('giving a place another map, or none, moves its characters to fit (L-682)', async () => {
    const other = (await ok('set_battle_map', { worldId: W, ...CELLAR, name: 'A bare cellar' })).map
      .id;
    const result = await ok('assign_battle_map', { worldId: W, placeId: market, mapId: other });
    const fen = result.moved.find((m) => m.id === 'chr_fen-the-fishwife');
    expect(fen.position).toMatchObject({ level: 'square', at: { id: market } });
    expect((await character('chr_fen-the-fishwife')).cell).toEqual({
      x: fen.position.x,
      y: fen.position.y,
    });
    // Near the new map's entry (1, 3), never on it.
    expect(Math.max(Math.abs(fen.position.x - 1), Math.abs(fen.position.y - 3))).toBe(1);
    // The cellar's characters keep theirs.
    expect((await character('chr_tobin-the-barkeep')).cell).toEqual({ x: 5, y: 2 });

    // No map at all: a place in town with no map needs a town point.
    const none = await ok('assign_battle_map', { worldId: W, placeId: market, mapId: null });
    expect(none.moved.find((m) => m.id === 'chr_fen-the-fishwife').position).toMatchObject({
      level: 'town',
      place: { id: market },
    });
    const stored = await character('chr_fen-the-fishwife');
    expect(stored.cell).toBeUndefined();
    expect(stored.townPoint).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  });

  test('view_image draws them: on the map they stand on, and about town (L-684)', async () => {
    const legendOf = async (args) =>
      JSON.parse((await call('view_image', { worldId: W, ...args })).content[1].text);
    const map = await legendOf({ of: 'battleMap', id: mapId });
    expect(map.markers.filter((m) => m.type === 'person')).toContainEqual({
      n: expect.any(Number),
      type: 'person',
      id: 'chr_tobin-the-barkeep',
      name: 'Tobin the Barkeep',
      cell: { x: 5, y: 2 },
      at: { id: cellar, name: 'The Salt Cellar' },
      side: 'neutral',
    });
    // Fen, moved to a town point when the market lost its map.
    const fen = await character('chr_fen-the-fishwife');
    const inTown = await legendOf({ of: 'town', id: 'loc_1' });
    expect(inTown.markers).toContainEqual({
      n: expect.any(Number),
      type: 'person',
      id: 'chr_fen-the-fishwife',
      name: 'Fen the Fishwife',
      position: fen.townPoint,
      place: { id: market, name: 'The Fishmarket' },
    });
  });
});

describe('hazards (L-815)', () => {
  const W = LIVE;
  // A long hall with a wall across it at x = 6 (no gap): gas at the west end.
  const HALL = {
    name: 'The gas hall',
    width: 10,
    height: 5,
    entries: [{ id: 'in', x: 1, y: 2 }],
    exits: [{ id: 'out', name: 'the hall door', x: 0, y: 2, to: 'out' }],
    features: [],
    walls: [
      {
        points: [
          { x: 6, y: 0 },
          { x: 6, y: 5 },
        ],
      },
    ],
  };
  const GAS = {
    id: 'gas',
    name: 'the gas',
    description: 'a yellow fog, low to the floor',
    area: { shape: 'burst', x: 4, y: 2, radius: 3 },
    effect: {
      condition: 'poisoned',
      duration: { turns: 2 },
      save: { attribute: 'CON', against: 'Moderate', when: 'apply' },
    },
  };
  let mapId;

  test('set_hazards places one: its squares in line of effect, a wall stopping it', async () => {
    mapId = (await ok('set_battle_map', { worldId: W, ...HALL })).map.id;
    const result = await ok('set_hazards', { worldId: W, mapId, hazards: [GAS] });
    expect(result.hazards).toEqual([
      expect.objectContaining({ id: 'gas', name: 'the gas', conditionName: 'Poisoned' }),
    ]);
    const xs = result.hazards[0].squares.map((s) => s.x);
    expect(Math.min(...xs)).toBe(1);
    expect(Math.max(...xs)).toBe(5); // the wall at x = 6 stops it
    // It covers the entry: arriving there isn't walking into it.
    expect(result.warnings).toEqual([
      expect.stringMatching(/covers the entry "in" at \(1, 2\): arriving there doesn't trigger it/),
    ]);
    expect((await mapDoc(W, mapId)).hazards).toEqual([GAS]);
  });

  test('get_battle_map reads them back, with their squares', async () => {
    const map = await ok('get_battle_map', { worldId: W, mapId });
    expect(map.hazards).toEqual([
      expect.objectContaining({
        ...GAS,
        conditionName: 'Poisoned',
        squares: expect.arrayContaining([
          { x: 4, y: 2 },
          { x: 5, y: 4 },
        ]),
      }),
    ]);
    expect(map.hazards[0].squares).toHaveLength(25);
  });

  test('a hazard that is wrong is refused, each problem named', async () => {
    const bad = {
      ...GAS,
      area: { shape: 'cone', x: 4, y: 2, length: 3 },
      effect: {
        condition: 'frozen',
        duration: { untilSaved: true },
        save: { skill: 'Juggling', against: 'Moderate', when: 'apply' },
      },
    };
    const text = await refused('set_hazards', { worldId: W, mapId, hazards: [bad] });
    expect(text).toContain('area.facing must be one of north');
    expect(text).toContain('There is no condition "frozen" in this world\'s rules');
    expect(text).toContain('An effect until saved needs a save at the end of each turn');
    expect(text).toContain('There is no skill "Juggling"');
    // An aura can't be placed: the schema allows only what stays put.
    const aura = await refused('set_hazards', {
      worldId: W,
      mapId,
      hazards: [{ ...GAS, area: { shape: 'aura', x: 1, y: 1, radius: 1 } }],
    });
    expect(aura).toMatch(/shape/);
    // Two of the same id.
    expect(await refused('set_hazards', { worldId: W, mapId, hazards: [GAS, GAS] })).toContain(
      'Two hazards are "gas".'
    );
    // Nothing was changed.
    expect((await mapDoc(W, mapId)).hazards).toEqual([GAS]);
  });

  test('a new grid keeps them, saying when they no longer fit; an empty list clears them', async () => {
    const smaller = await ok('set_battle_map', {
      worldId: W,
      mapId,
      ...HALL,
      width: 4,
      walls: [],
    });
    expect((await mapDoc(W, mapId)).hazards).toEqual([GAS]);
    expect(smaller.warnings).toContainEqual(
      expect.stringMatching(/^Its hazards no longer fit it: .*Fix them with set_hazards\.$/)
    );
    const cleared = await ok('set_hazards', { worldId: W, mapId, hazards: [] });
    expect(cleared.hazards).toEqual([]);
    expect((await mapDoc(W, mapId)).hazards).toEqual([]);
  });
});

describe('figures, tactics and danger (L-824)', () => {
  const W = LIVE;
  const HALL = {
    name: 'The bandit hall',
    width: 10,
    height: 5,
    entries: [{ id: 'in', x: 1, y: 2 }],
    exits: [{ id: 'out', name: 'the hall door', x: 0, y: 2, to: 'out' }],
    features: [],
  };
  const BANDITS = {
    id: 'bandits',
    name: 'Bandit',
    statBlock: {
      attributes: { STR: 12, DEX: 12, CON: 10, INT: 8, WIS: 8, CHA: 8 },
      attacks: [
        {
          id: 'club',
          name: 'Club',
          reach: 1,
          attack: '1d20 + mod(STR) + 2',
          damage: '1d6 + mod(STR)',
          type: 'bludgeoning',
        },
      ],
    },
    posture: 'cowardly',
    cells: [
      { x: 7, y: 1 },
      { x: 7, y: 3 },
    ],
  };
  let mapId;

  test('a dangerous place is graded on foes; place_figures puts them there', async () => {
    mapId = (await ok('set_battle_map', { worldId: W, ...HALL })).map.id;
    await ok('assign_battle_map', { worldId: W, placeId: 'poi_1', mapId });
    const calm = await ok('get_location', { worldId: W, locationId: 'poi_1' });
    expect(calm.danger).toBe('none');
    expect(calm.checklist.find((c) => c.id === 'place.foes')).toBeUndefined();
    await ok('update_location', { worldId: W, locationId: 'poi_1', danger: 'high' });
    const risky = await ok('get_location', { worldId: W, locationId: 'poi_1' });
    expect(risky.danger).toBe('high');
    expect(risky.checklist.find((c) => c.id === 'place.foes')).toMatchObject({
      met: false,
      weight: 10,
      tool: 'place_figures',
    });

    const placed = await ok('place_figures', { worldId: W, mapId, figures: [BANDITS] });
    expect(placed.figures).toEqual([
      expect.objectContaining({
        id: 'bandits',
        side: 'hostile',
        role: 'brute',
        posture: 'cowardly',
        named: [
          { id: 'fig-bandits-1', name: 'Bandit 1', x: 7, y: 1 },
          { id: 'fig-bandits-2', name: 'Bandit 2', x: 7, y: 3 },
        ],
      }),
    ]);
    expect((await mapDoc(W, mapId)).figures).toEqual([BANDITS]);
    expect((await ok('get_battle_map', { worldId: W, mapId })).figures).toHaveLength(1);
    const met = await ok('get_location', { worldId: W, locationId: 'poi_1' });
    expect(met.checklist.find((c) => c.id === 'place.foes')).toMatchObject({ met: true });
  });

  test('figures that are wrong are refused, each problem named, nothing written', async () => {
    const text = await refused('place_figures', {
      worldId: W,
      mapId,
      figures: [
        {
          ...BANDITS,
          statBlock: { attributes: { STR: 30 } },
          cells: [
            { x: 0, y: 2 },
            { x: 1, y: 2 },
          ],
        },
      ],
    });
    expect(text).toContain('figures[0].statBlock: Strength is 30');
    expect(text).toContain('figures[0].cells[0] (0, 2) is an exit.');
    expect(text).toContain('figures[0].cells[1] (1, 2) is an entry, where players arrive.');
    expect(
      await refused('place_figures', {
        worldId: W,
        mapId,
        figures: [{ ...BANDITS, role: 'ninja' }],
      })
    ).toMatch(/role/);
    expect((await mapDoc(W, mapId)).figures).toEqual([BANDITS]);
  });

  test('wary figures (L-392): a challenge and triggers, checked against the system and map', async () => {
    const WARY = {
      ...BANDITS,
      side: 'wary',
      challenge: { says: 'Who goes there?', check: { skill: 'Deception' } },
      triggers: [{ on: 'allyAttacked', then: 'hostile' }],
    };
    await ok('place_figures', { worldId: W, mapId, figures: [WARY] });
    expect((await mapDoc(W, mapId)).figures).toEqual([WARY]);
    expect((await ok('get_battle_map', { worldId: W, mapId })).figures[0]).toMatchObject({
      side: 'wary',
      challenge: WARY.challenge,
    });
    const text = await refused('place_figures', {
      worldId: W,
      mapId,
      figures: [
        {
          ...WARY,
          challenge: { says: 'Who goes there?', check: { skill: 'Juggling' } },
          triggers: [{ on: 'doorForced', target: 'vault', then: 'hostile' }],
        },
      ],
    });
    expect(text).toContain('figures[0].challenge.check: the system has no skill "Juggling"');
    expect(text).toContain('figures[0].triggers[0].target: The bandit hall has no door "vault"');
    await ok('place_figures', { worldId: W, mapId, figures: [BANDITS] });
  });

  test('a new grid keeps them; an empty list clears them', async () => {
    await ok('set_battle_map', { worldId: W, mapId, ...HALL });
    expect((await mapDoc(W, mapId)).figures).toEqual([BANDITS]);
    await ok('place_figures', { worldId: W, mapId, figures: [] });
    expect((await mapDoc(W, mapId)).figures).toEqual([]);
  });

  test('set_tactics: a character’s role, posture and leader, with the defaults', async () => {
    const { character } = await ok('add_character', {
      worldId: W,
      name: 'Marsh Captain',
      description: 'Leads the marsh raiders from the back.',
      locationId: 'loc_1',
      townPoint: { x: 200, y: 200 },
    });
    const id = character.id;
    const set = await ok('set_tactics', {
      worldId: W,
      characterId: id,
      role: 'guard',
      posture: 'bold',
      leader: true,
    });
    expect(set).toMatchObject({
      tactics: { role: 'guard', posture: 'bold', leader: true },
      updated: expect.arrayContaining(['role', 'posture', 'leader']),
    });
    expect((await ok('get_character', { worldId: W, characterId: id })).tactics).toEqual({
      role: 'guard',
      posture: 'bold',
      leader: true,
    });
    const cleared = await ok('set_tactics', {
      worldId: W,
      characterId: id,
      role: null,
      posture: null,
      leader: false,
    });
    expect(cleared.tactics).toEqual({ role: 'brute', posture: 'steady' });
    expect(
      await refused('set_tactics', { worldId: W, characterId: id, posture: 'sleepy' })
    ).toMatch(/posture/);
  });

  test('set_tactics: combatNotes, for the model choosing a named character’s turns (L-825)', async () => {
    const { character } = await ok('add_character', {
      worldId: W,
      name: 'Harbour Warden',
      description: 'Keeps the quay; fights for the dockhands.',
      locationId: 'loc_1',
      townPoint: { x: 220, y: 220 },
    });
    const id = character.id;
    const notes = 'Protects the dockhands first; never fights by the water.';
    const set = await ok('set_tactics', { worldId: W, characterId: id, combatNotes: notes });
    expect(set).toMatchObject({ tactics: { combatNotes: notes }, updated: ['combatNotes'] });
    expect((await ok('get_character', { worldId: W, characterId: id })).tactics).toEqual({
      role: 'brute',
      posture: 'steady',
      combatNotes: notes,
    });
    const cleared = await ok('set_tactics', { worldId: W, characterId: id, combatNotes: null });
    expect(cleared.tactics).toEqual({ role: 'brute', posture: 'steady' });
    expect((await ok('get_character', { worldId: W, characterId: id })).tactics).toEqual({
      role: 'brute',
      posture: 'steady',
    });
    expect(
      await refused('set_tactics', { worldId: W, characterId: id, combatNotes: 'x'.repeat(1001) })
    ).toMatch(/combatNotes/);
  });

  test('a place in town takes a danger too', async () => {
    const result = await ok('update_place', {
      worldId: W,
      placeId: 'plc_1_the-gull-anchor',
      danger: 'low',
    });
    expect(result.updated).toContain('danger');
    const town = await ok('get_town', { worldId: W, locationId: 'loc_1' });
    expect(town.places.find((p) => p.id === 'plc_1_the-gull-anchor').danger).toBe('low');
  });
});

describe('areas (#670)', () => {
  const W = LIVE;
  // A taproom 12 × 8: the back room in its top-left corner, an L-shaped hall
  // round it, and a feature named like a space.
  const TAPROOM = {
    name: 'The taproom',
    width: 12,
    height: 8,
    entries: [{ id: 'in', x: 6, y: 6 }],
    exits: [{ id: 'out', name: 'the street door', x: 6, y: 7, to: 'out' }],
    features: [
      { id: 'lever', name: 'the cellar lever', x: 9, y: 5 },
      { id: 'hearth', name: 'Behind the bar', x: 10, y: 1 },
    ],
  };
  const rect = (x0, y0, x1, y1) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const BACK = { id: 'back-room', name: 'the back room', polygon: rect(0, 0, 4, 3) };
  const HALL = {
    id: 'hall',
    name: 'the hall',
    polygon: [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 6 },
      { x: 0, y: 6 },
    ],
  };
  let mapId;

  test('set_battle_map takes areas; get_battle_map shows each with its squares', async () => {
    const made = await ok('set_battle_map', { worldId: W, ...TAPROOM, areas: [BACK, HALL] });
    mapId = made.map.id;
    // A feature named like a space is a candidate to be an area.
    expect(made.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/^The feature "Behind the bar" \(hearth\)/)])
    );
    const detail = await ok('get_battle_map', { worldId: W, mapId });
    expect(detail.areas).toEqual([
      { ...BACK, squares: 12 },
      { ...HALL, squares: 20 },
    ]);
    expect(detail.warnings).toHaveLength(1);
    expect((await mapDoc(W, mapId)).areas).toEqual([BACK, HALL]);
  });

  test('replacing the grid without areas keeps them; set_map_layers replaces or clears', async () => {
    await ok('set_battle_map', { worldId: W, mapId, ...TAPROOM });
    expect((await mapDoc(W, mapId)).areas).toEqual([BACK, HALL]);
    const set = await ok('set_map_layers', { worldId: W, mapId, areas: [BACK] });
    expect(set).toMatchObject({ updated: ['areas'], layers: { areas: 1 } });
    expect((await mapDoc(W, mapId)).areas).toEqual([BACK]);
    await ok('set_map_layers', { worldId: W, mapId, areas: [] });
    expect((await mapDoc(W, mapId)).areas).toEqual([]);
    await ok('set_map_layers', { worldId: W, mapId, areas: [BACK, HALL] });
  });

  test('a bad outline is refused, naming why, and nothing changes', async () => {
    const before = await mapDoc(W, mapId);
    const bad = async (areas) => refused('set_map_layers', { worldId: W, mapId, areas });
    expect(
      await bad([
        {
          id: 'bow',
          name: 'the bow',
          polygon: [
            { x: 0, y: 0 },
            { x: 4, y: 4 },
            { x: 4, y: 0 },
            { x: 0, y: 4 },
          ],
        },
      ])
    ).toMatch(/"the bow"'s outline crosses itself/);
    expect(await bad([{ id: 'far', name: 'the yard', polygon: rect(10, 6, 13, 8) }])).toMatch(
      /"the yard" has a corner \(13, 6\) that isn't a corner of the 12 × 8 grid/
    );
    expect(await bad([BACK, { ...HALL, id: 'back-room' }])).toMatch(
      /Two areas have the id "back-room"/
    );
    expect(
      await bad([
        {
          id: 'thin',
          name: 'the crack',
          polygon: [
            { x: 1, y: 1 },
            { x: 2, y: 1 },
            { x: 3, y: 1 },
          ],
        },
      ])
    ).toMatch(/"the crack"/);
    expect(await mapDoc(W, mapId)).toEqual(before);
  });

  test('view_image outlines each area and numbers it at its middle square', async () => {
    const result = await call('view_image', { worldId: W, of: 'battleMap', id: mapId });
    const areas = result.structuredContent.markers.filter((m) => m.type === 'area');
    expect(areas).toEqual([
      expect.objectContaining({ type: 'area', id: 'back-room', name: 'the back room' }),
      expect.objectContaining({ type: 'area', id: 'hall', name: 'the hall' }),
    ]);
    expect(result.structuredContent.reading).toMatch(/Violet outlines are areas/);
  });
});

describe('seeing and placing (L-394)', () => {
  const W = DRAFT;
  // A shared tavern, 8 × 6: in at the west; a back room behind a locked door
  // (squares x 5–7, y 4–5), with a strongbox in it.
  const SHARED = {
    name: 'The shared tavern',
    width: 8,
    height: 6,
    generic: { kind: 'tavern', terrain: 'road' },
    entries: [{ id: 'in', x: 1, y: 2 }],
    exits: [{ id: 'out', name: 'the door', x: 0, y: 2, to: 'out' }],
    features: [
      { id: 'hearth', name: 'the hearth', x: 3, y: 0 },
      { id: 'strongbox', name: 'the strongbox', x: 6, y: 5 },
    ],
    walls: [
      {
        points: [
          { x: 5, y: 6 },
          { x: 5, y: 4 },
          { x: 6, y: 4 },
        ],
      },
      {
        points: [
          { x: 7, y: 4 },
          { x: 8, y: 4 },
        ],
      },
    ],
    doors: [
      { id: 'back', name: 'the back door', from: { x: 6, y: 4 }, to: { x: 7, y: 4 }, locked: true },
    ],
  };
  let mapId;
  let tavern;
  const person = (name, cell) =>
    call('add_character', {
      worldId: W,
      name,
      description: 'A drinker.',
      locationId: 'loc_1',
      placeId: tavern,
      cell,
    });

  beforeAll(async () => {
    const made = await ok('set_battle_map', { worldId: W, ...SHARED });
    mapId = made.map.id;
    // The strongbox, behind the locked door, isn't walled in.
    expect(made.warnings).toEqual(
      expect.arrayContaining([
        'the strongbox at (6, 5) is behind a locked door: only someone who opens it gets there.',
      ])
    );
    expect(made.warnings.join(' ')).not.toMatch(/walled in/);
    tavern = (
      await ok('add_place', {
        worldId: W,
        locationId: 'loc_1',
        name: 'The Wayside Inn',
        kind: 'tavern',
        description: 'Low beams and a smoky hearth.',
        entranceFor: ['sea', 'trail'],
        battleMap: mapId,
      })
    ).place.id;
  });

  test('cell "auto" on the shared tavern finds a free square nine times in a row', async () => {
    const cells = [];
    for (let i = 1; i <= 9; i++) {
      const result = await person(`Drinker ${i}`, 'auto');
      expect(result.isError).toBeFalsy();
      const { x, y } = result.structuredContent.character.position;
      cells.push(`${x},${y}`);
    }
    expect(new Set(cells).size).toBe(9);
    // Never the entry or the exit; the first beside the entry.
    expect(cells).not.toContain('1,2');
    expect(cells).not.toContain('0,2');
    expect(cells[0]).toMatch(/^[0-2],[1-3]$/);
  });

  test('a refusal names the nearest open square; nearest: true takes it', async () => {
    const text = (await person('Latecomer', { x: 1, y: 2 })).content[0].text;
    expect(text).toMatch(
      /They can't stand there: \(1, 2\) is the entry "in", where players arrive\. The nearest open square is \(\d+, \d+\)\./
    );
    const near = await person('Latecomer', { x: 1, y: 2, nearest: true });
    expect(near.isError).toBeFalsy();
    expect(near.structuredContent.character.position).not.toMatchObject({ x: 1, y: 2 });
  });

  test('a room behind a locked door gets the new warning, not "walled in"', async () => {
    const result = await person('The landlord', { feature: 'strongbox' });
    expect(result.structuredContent.warnings).toEqual([
      '(6, 5) on The shared tavern is behind a locked door: only someone who opens it gets there.',
    ]);
  });

  test('place_figures: "auto" squares, and a refusal naming the nearest open one', async () => {
    const block = {
      attributes: { STR: 12, DEX: 12, CON: 10, INT: 8, WIS: 8, CHA: 8 },
    };
    const placed = await ok('place_figures', {
      worldId: W,
      mapId,
      figures: [
        { id: 'toughs', name: 'Tough', statBlock: block, side: 'wary', cells: ['auto', 'auto'] },
      ],
    });
    const squares = placed.figures[0].named.map((f) => `${f.x},${f.y}`);
    expect(new Set(squares).size).toBe(2);
    const standing = (await mapDoc(W, mapId)).figures[0].cells;
    expect(standing.every((c) => typeof c === 'object')).toBe(true);
    const text = await refused('place_figures', {
      worldId: W,
      mapId,
      figures: [{ id: 'x', name: 'X', statBlock: block, cells: [{ x: 0, y: 2 }] }],
    });
    expect(text).toMatch(
      /figures\[0\]\.cells\[0\] \(0, 2\) is an exit\. The nearest open square is/
    );
  });

  test('view_image draws them numbered, by side, with a key; and sight from an entry', async () => {
    const result = await call('view_image', { worldId: W, of: 'battleMap', id: mapId });
    const legend = result.structuredContent;
    const people = legend.markers.filter((m) => m.type === 'person');
    const figs = legend.markers.filter((m) => m.type === 'figure');
    expect(people.length).toBeGreaterThanOrEqual(11);
    expect(people[0]).toMatchObject({ side: 'neutral', at: { id: tavern } });
    expect(figs).toEqual([
      expect.objectContaining({ id: 'fig-toughs-1', side: 'wary', group: 'toughs' }),
      expect.objectContaining({ id: 'fig-toughs-2', side: 'wary', group: 'toughs' }),
    ]);
    expect(legend.sides).toEqual({
      hostile: 'red',
      party: 'green',
      wary: 'yellow',
      neutral: 'teal',
    });
    expect(legend.reading).toMatch(/coloured by side/);

    const seen = await call('view_image', {
      worldId: W,
      of: 'battleMap',
      id: mapId,
      sightFrom: 'in',
    });
    const sight = seen.structuredContent;
    expect(sight.sight.from).toBe('in');
    expect(sight.sight.squaresSeen).toBeLessThan(8 * 6);
    // The landlord, behind the locked door, isn't seen from the entry.
    const landlord = sight.markers.find((m) => m.name === 'The landlord');
    expect(landlord.seen).toBe(false);
    expect(
      await refused('view_image', { worldId: W, of: 'battleMap', id: mapId, sightFrom: 'nope' })
    ).toMatch(/has no entry "nope" \(in\)/);
  });
});
