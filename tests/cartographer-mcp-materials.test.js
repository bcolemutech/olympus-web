'use strict';

/**
 * Materials and the object catalog over MCP (planning/maps-from-data.md RD1,
 * RD3, OB1; L-925 / #729), driven by a real MCP client through
 * /mcp/cartographer against the Firestore and Storage emulators:
 * list_materials and list_object_kinds, set_object_art giving a world's own
 * art to a catalog kind, to a kind of its own (with a name and a size) and to
 * a single object (on a grid's battle map and on a region map), taking it
 * away again, usedIn kept right, and the refusals (a wrong kind of image, an
 * object that isn't there, a template's copy, the wrong arguments).
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-materials --verbose"
 */

const PROJECT = 'demo-cartographer-materials';
const BUCKET = `${PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-materials';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

jest.mock('../functions/gemini', () => ({ callGemini: jest.fn() }));

const functionsTest = require('firebase-functions-test')(
  { projectId: PROJECT, storageBucket: BUCKET },
  null
);
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
const { getStorage } = require(
  require.resolve('firebase-admin/storage', { paths: [functionsDir] })
);
const { PNG } = require(require.resolve('pngjs', { paths: [functionsDir] }));

const loomCanon = require('../functions/loom-canon');
const catalog = require('../functions/loom-canon/materials');
const geo = require('../functions/loom-canon/map-geometry');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const { createLibrary } = require('../functions/studio/library');
const { readImage } = require('../functions/studio/formats');
const { createCartographerService } = require('../functions/cartographer/service');
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
const bucket = getStorage().bucket(BUCKET);
const library = createLibrary({ db, bucket });
const worlds = () => db.collection('loom_worlds');
const writer = createFirestoreWorldWriter(() => db);
const service = createCartographerService({ db, bucket, writer });

const systems = { get: async (id) => BUILT_IN[id] || null };
const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader: createFirestoreWorldReader(() => db),
    writer,
    systems,
    studio: { assign: (uid, args) => service.assignImage(uid, args) },
  })
);
const oauthStore = createInMemoryStore();
const audit = createInMemoryAuditLog();

let server;
let client;

const call = (name, args) => client.callTool({ name, arguments: args });
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

function png(width, height) {
  const img = new PNG({ width, height });
  img.data.fill(170);
  return PNG.sync.write(img);
}
const addImage = (kind, { width = 64, height = 64 } = {}) =>
  library.addImage({
    title: `A ${kind}`,
    kind,
    file: readImage(png(width, height)),
    createdBy: BUILDER,
    via: 'page',
  });
const imageDoc = async (id) => (await db.collection('studio_images').doc(id).get()).data();
const worldDoc = async (id) => (await worlds().doc(id).get()).data();
const sub = async (worldId, collection, id) =>
  (await worlds().doc(worldId).collection(collection).doc(id).get()).data();
const loaded = (worldId) => loomCanon.loadWorld(worldId, { db, playableOnly: false });

beforeAll(async () => {
  await db.recursiveDelete(worlds());
  await db.recursiveDelete(db.collection('studio_images'));
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
  client = new Client({ name: 'cartographer-materials-test', version: '0.0.0' });
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
  await db.recursiveDelete(db.collection('studio_images'));
  functionsTest.cleanup();
});

// ── What there is ─────────────────────────────────────────────────────

describe('the tools', () => {
  test('list the materials and object kinds read-only, and give art with honest hints', async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.list_materials.annotations.readOnlyHint).toBe(true);
    expect(byName.list_object_kinds.annotations.readOnlyHint).toBe(true);
    expect(byName.set_object_art.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  test('list_materials gives the whole fixed set, or one kind of it', async () => {
    const all = await ok('list_materials', {});
    expect(all.count).toBe(catalog.MATERIALS.length);
    expect(all.materials).toContainEqual({ kind: 'wall', id: 'brick', name: 'Brick' });
    expect(all.materials).toContainEqual({
      kind: 'wall',
      id: 'glass',
      name: 'Glass',
      seeThrough: true,
    });
    expect(all.materials).toContainEqual({
      kind: 'ground',
      id: 'water',
      name: 'Water',
      water: true,
      wild: { speed: 0.3, danger: 1 },
    });
    const walls = await ok('list_materials', { kind: 'wall' });
    expect(walls.materials.map((m) => m.id)).toEqual(catalog.materialsOf('wall').map((m) => m.id));
    expect(walls.materials.every((m) => m.kind === 'wall')).toBe(true);
    // The same materials the shapes are checked against.
    expect(walls.materials.map((m) => m.id)).toEqual(Object.keys(geo.MATERIALS.wall));
    expect(await refused('list_materials', { kind: 'ceiling' })).toMatch(/kind/i);
  });

  test('list_object_kinds gives the catalog with sizes, or one group of it', async () => {
    const all = await ok('list_object_kinds', {});
    expect(all.count).toBe(catalog.OBJECT_KINDS.length);
    expect(all.objectKinds).toContainEqual({
      id: 'chest',
      name: 'Chest',
      group: 'furniture',
      size: [3, 2],
      blocksMove: true,
      blocksSight: false,
    });
    expect(all.objectKinds.find((k) => k.id === 'rug').blocksMove).toBe(false);
    expect(all.objectKinds.find((k) => k.id === 'tree').blocksSight).toBe(true);
    const furniture = await ok('list_object_kinds', { group: 'furniture' });
    expect(furniture.objectKinds.every((k) => k.group === 'furniture')).toBe(true);
    expect(furniture.count).toBeLessThan(all.count);
  });
});

// ── A world's own art ─────────────────────────────────────────────────

describe('set_object_art', () => {
  const ids = {};

  beforeAll(async () => {
    const made = await ok('create_world', { name: 'Hallowmere', backdrop: { colour: '#101828' } });
    ids.world = made.worldId;
    // A grid's objects live in its battle map's geometry, a region map's on
    // its map doc (GE5); the geometry tools are L-929's, so it is written here.
    const objects = geo.normalize({
      objects: [
        { id: 'lamp', kind: 'brazier', at: [10, 10], size: [2, 2], name: 'The lamp' },
        { id: 'chest-1', kind: 'chest', at: [20, 10], size: [3, 2] },
      ],
    }).objects;
    await worlds()
      .doc(ids.world)
      .collection('battleMaps')
      .doc('bm_hall')
      .set({
        name: 'The hall',
        width: 8,
        height: 6,
        entries: [{ id: 'door', x: 0, y: 3 }],
        exits: [],
        features: [],
        revision: 4,
        geometry: { objects },
      });
    await worlds()
      .doc(ids.world)
      .collection('maps')
      .doc('map_world')
      .update({
        geometry: geo.normalize({
          objects: [{ id: 'ship', kind: 'ship-wheel', at: [300, 300], size: [20, 40] }],
        }),
      });
    const ref = worlds().doc(ids.world);
    await ref.update({ canonVersion: (await ref.get()).data().canonVersion + 1 });
    loomCanon.clearWorldCache();
    ids.chest = (await addImage('object', { width: 96, height: 64 })).id;
    ids.wheel = (await addImage('object', { width: 64, height: 64 })).id;
    ids.wheel2 = (await addImage('object', { width: 64, height: 64 })).id;
    ids.lamp = (await addImage('object', { width: 32, height: 32 })).id;
    ids.portrait = (await addImage('portrait')).id;
  }, 60000);

  test('with no art given, every kind’s art is the catalog’s, or a box with a question mark', async () => {
    const listed = await ok('list_object_kinds', { worldId: ids.world });
    expect(listed.worldId).toBe(ids.world);
    expect(listed.objectKinds.find((k) => k.id === 'chest').art).toBe('catalog');
    expect(listed.objectKinds.some((k) => k.ownKind)).toBe(false);
  });

  test('a catalog kind’s art for a world: its objects of that kind use it', async () => {
    const result = await ok('set_object_art', {
      worldId: ids.world,
      kind: 'chest',
      imageId: ids.chest,
    });
    expect(result).toMatchObject({
      kind: 'chest',
      name: 'Chest',
      art: { imageId: ids.chest, width: 96, height: 64, format: 'png' },
    });
    const { objectKinds } = await worldDoc(ids.world);
    expect(objectKinds.chest.art).toMatchObject({ imageId: ids.chest, width: 96 });
    expect((await loaded(ids.world)).objectKinds.chest.art.imageId).toBe(ids.chest);
    expect(await imageDoc(ids.chest)).toMatchObject({
      usedIn: [{ worldId: ids.world, target: 'objectKind', id: 'chest' }],
    });
    const listed = await ok('list_object_kinds', { worldId: ids.world });
    expect(listed.objectKinds.find((k) => k.id === 'chest').art).toBe('world');
    expect(listed.objectKinds.find((k) => k.id === 'table').art).toBe('catalog');
    // The art an object draws with, read as the page reads it.
    const world = await loaded(ids.world);
    expect(catalog.artFor({ kind: 'chest' }, world.objectKinds)).toMatchObject({
      from: 'world',
      ref: { imageId: ids.chest },
    });
  });

  test('a kind of the world’s own, with its name and size, and a shape that fits', async () => {
    const result = await ok('set_object_art', {
      worldId: ids.world,
      kind: 'ship-wheel',
      imageId: ids.wheel,
      name: 'Ship’s wheel',
      size: [3, 3],
    });
    expect(result).toMatchObject({
      kind: 'ship-wheel',
      art: { imageId: ids.wheel },
      updated: { name: 'Ship’s wheel', size: [3, 3] },
    });
    expect(result.warnings).toBeUndefined();
    const listed = await ok('list_object_kinds', { worldId: ids.world });
    expect(listed.objectKinds.find((k) => k.id === 'ship-wheel')).toEqual({
      id: 'ship-wheel',
      name: 'Ship’s wheel',
      group: 'the world’s own',
      size: [3, 3],
      art: 'world',
      ownKind: true,
    });
    expect(listed.count).toBe(catalog.OBJECT_KINDS.length + 1);
    // Another world doesn't see it.
    const other = await ok('create_world', { name: 'Elsewhere', backdrop: { colour: '#101828' } });
    const there = await ok('list_object_kinds', { worldId: other.worldId });
    expect(there.objectKinds.some((k) => k.id === 'ship-wheel')).toBe(false);
  });

  test('replacing a kind’s art drops the old image’s use', async () => {
    await ok('set_object_art', { worldId: ids.world, kind: 'ship-wheel', imageId: ids.wheel2 });
    expect((await imageDoc(ids.wheel)).usedIn).toEqual([]);
    expect((await imageDoc(ids.wheel2)).usedIn).toEqual([
      { worldId: ids.world, target: 'objectKind', id: 'ship-wheel' },
    ]);
    // Its name and size stayed.
    const { objectKinds } = await worldDoc(ids.world);
    expect(objectKinds['ship-wheel']).toMatchObject({ name: 'Ship’s wheel', size: [3, 3] });
  });

  test('one object on a grid: its own art in the battle map’s geometry, its revision moved', async () => {
    const result = await ok('set_object_art', {
      worldId: ids.world,
      mapId: 'bm_hall',
      objectId: 'lamp',
      imageId: ids.lamp,
    });
    expect(result).toMatchObject({
      object: { mapId: 'bm_hall', objectId: 'lamp' },
      name: 'The lamp',
      art: { imageId: ids.lamp },
    });
    const hall = await sub(ids.world, 'battleMaps', 'bm_hall');
    expect(hall.revision).toBe(5);
    expect(hall.geometry.objects.find((o) => o.id === 'lamp').art.imageId).toBe(ids.lamp);
    // Nothing else about it or the other object changed.
    expect(hall.geometry.objects.find((o) => o.id === 'lamp')).toMatchObject({
      kind: 'brazier',
      at: [10, 10],
      size: [2, 2],
    });
    expect(hall.geometry.objects.find((o) => o.id === 'chest-1').art).toBeUndefined();
    expect(await imageDoc(ids.lamp)).toMatchObject({
      usedIn: [{ worldId: ids.world, target: 'object', id: 'bm_hall/lamp' }],
    });
    // Its own art comes before its kind's.
    const world = await loaded(ids.world);
    const lamp = world.battleMaps.bm_hall.geometry.objects.find((o) => o.id === 'lamp');
    expect(catalog.artFor(lamp, world.objectKinds)).toMatchObject({
      from: 'object',
      ref: { imageId: ids.lamp },
    });
    const chest = world.battleMaps.bm_hall.geometry.objects.find((o) => o.id === 'chest-1');
    expect(catalog.artFor(chest, world.objectKinds).from).toBe('world');
  });

  test('one object on a region map is kept on its map doc; art of the wrong shape is warned of', async () => {
    const result = await ok('set_object_art', {
      worldId: ids.world,
      mapId: 'map_world',
      objectId: 'ship',
      imageId: ids.wheel,
    });
    expect(result.warnings).toEqual([
      expect.stringMatching(/Its shape \(64 × 64\) isn't the object's \(20 × 40 ft\)/),
    ]);
    const realm = await sub(ids.world, 'maps', 'map_world');
    expect(realm.geometry.objects[0].art.imageId).toBe(ids.wheel);
    expect(realm.revision).toBe(1);
  });

  test('a new version of an image refreshes the size a world holds, as an edit does (L-708)', async () => {
    const bigger = await addImage('object', { width: 64, height: 64 });
    await ok('set_object_art', { worldId: ids.world, kind: 'rune-stone', imageId: bigger.id });
    await ok('set_object_art', {
      worldId: ids.world,
      mapId: 'bm_hall',
      objectId: 'chest-1',
      imageId: bigger.id,
    });
    await library.addVersion(bigger.id, {
      file: readImage(png(128, 128)),
      createdBy: BUILDER,
      via: 'page',
    });
    // What the studio does for each use after an edit: assigns the image again.
    for (const use of (await imageDoc(bigger.id)).usedIn) {
      await service.assignImage(BUILDER, { ...use, imageId: bigger.id });
    }
    const { objectKinds } = await worldDoc(ids.world);
    expect(objectKinds['rune-stone'].art).toMatchObject({ imageId: bigger.id, width: 128 });
    const hall = await sub(ids.world, 'battleMaps', 'bm_hall');
    expect(hall.geometry.objects.find((o) => o.id === 'chest-1').art).toMatchObject({
      imageId: bigger.id,
      width: 128,
    });
    // Each use is kept once.
    expect((await imageDoc(bigger.id)).usedIn).toHaveLength(2);
    // Put back as it was for the next tests.
    await ok('set_object_art', { worldId: ids.world, kind: 'rune-stone', imageId: null });
    await ok('set_object_art', {
      worldId: ids.world,
      mapId: 'bm_hall',
      objectId: 'chest-1',
      imageId: null,
    });
  });

  test('taking art away: an object’s own, a kind’s (keeping its name and size, or going whole)', async () => {
    await ok('set_object_art', {
      worldId: ids.world,
      mapId: 'bm_hall',
      objectId: 'lamp',
      imageId: null,
    });
    const hall = await sub(ids.world, 'battleMaps', 'bm_hall');
    expect(hall.geometry.objects.find((o) => o.id === 'lamp').art).toBeUndefined();
    expect((await imageDoc(ids.lamp)).usedIn).toEqual([]);

    // A kind with a name and a size keeps them; a kind with only art goes.
    await ok('set_object_art', { worldId: ids.world, kind: 'ship-wheel', imageId: null });
    await ok('set_object_art', { worldId: ids.world, kind: 'chest', imageId: null });
    const { objectKinds } = await worldDoc(ids.world);
    expect(objectKinds['ship-wheel']).toEqual({ name: 'Ship’s wheel', size: [3, 3] });
    expect(objectKinds.chest).toBeUndefined();
    expect((await imageDoc(ids.chest)).usedIn).toEqual([]);
    const listed = await ok('list_object_kinds', { worldId: ids.world });
    expect(listed.objectKinds.find((k) => k.id === 'chest').art).toBe('catalog');
    expect(listed.objectKinds.find((k) => k.id === 'ship-wheel')).toMatchObject({
      art: 'unknown', // a box with a question mark, until it has art again
      size: [3, 3],
    });
    // Taking away what isn't there changes nothing.
    const before = (await worldDoc(ids.world)).canonVersion;
    const again = await ok('set_object_art', { worldId: ids.world, kind: 'chest', imageId: null });
    expect(again.art).toBeNull();
    expect((await worldDoc(ids.world)).canonVersion).toBe(before);
  });

  test('refuses what won’t do, saying why', async () => {
    const W = ids.world;
    expect(
      await refused('set_object_art', { worldId: W, kind: 'chest', imageId: ids.portrait })
    ).toMatch(/is a portrait image; object art takes an object image/);
    expect(
      await refused('set_object_art', {
        worldId: W,
        kind: 'chest',
        imageId: 'img_0123456789abcdef',
      })
    ).toMatch(/no image|not found|No image/i);
    expect(
      await refused('set_object_art', {
        worldId: W,
        mapId: 'bm_hall',
        objectId: 'nobody',
        imageId: ids.lamp,
      })
    ).toBe('No object "nobody" on The hall.');
    expect(
      await refused('set_object_art', {
        worldId: W,
        mapId: 'bm_nowhere',
        objectId: 'lamp',
        imageId: ids.lamp,
      })
    ).toBe('No map "bm_nowhere" in this world.');
    expect(
      await refused('set_object_art', {
        worldId: W,
        mapId: 'tpl_moon__pl_io',
        objectId: 'lamp',
        imageId: ids.lamp,
      })
    ).toMatch(/template's copy for one place/);
    // The wrong arguments.
    expect(await refused('set_object_art', { worldId: W, imageId: ids.lamp })).toMatch(
      /Give a kind .* or a mapId and objectId/
    );
    expect(
      await refused('set_object_art', {
        worldId: W,
        kind: 'chest',
        mapId: 'bm_hall',
        objectId: 'lamp',
        imageId: ids.lamp,
      })
    ).toMatch(/Give a kind .* or a mapId and objectId/);
    expect(
      await refused('set_object_art', { worldId: W, mapId: 'bm_hall', imageId: ids.lamp })
    ).toBe('An object is named by both mapId and objectId.');
    expect(
      await refused('set_object_art', { worldId: W, mapId: 'bm_hall', objectId: 'lamp', name: 'X' })
    ).toBe('name and size are for a kind.');
    expect(await refused('set_object_art', { worldId: W, kind: 'chest' })).toBe(
      'Give an imageId (null takes the art away).'
    );
    expect(
      await refused('set_object_art', { worldId: W, kind: 'a kind', imageId: ids.chest })
    ).toMatch(/letters, digits/);
    // Nothing above changed anything.
    expect((await worldDoc(W)).objectKinds.chest).toBeUndefined();
    expect((await imageDoc(ids.portrait)).usedIn).toEqual([]);
  });

  test('a name and a size alone make a kind with no art, which draws as a box with a question mark', async () => {
    const result = await ok('set_object_art', {
      worldId: ids.world,
      kind: 'rune-stone',
      name: 'Rune stone',
      size: [2, 2],
    });
    expect(result).toMatchObject({
      kind: 'rune-stone',
      updated: { name: 'Rune stone', size: [2, 2] },
    });
    expect(result.art).toBeUndefined();
    const world = await loaded(ids.world);
    expect(world.objectKinds['rune-stone']).toEqual({ name: 'Rune stone', size: [2, 2] });
    expect(catalog.artFor({ kind: 'rune-stone' }, world.objectKinds).from).toBe('unknown');
  });
});
