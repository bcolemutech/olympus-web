'use strict';

/**
 * A world's own ground over MCP (planning/worlds-without-azgaar.md §4.3, R2;
 * L-713 / #818), driven by a real MCP client through /mcp/cartographer
 * against the Firestore and Storage emulators: set_world_materials making an
 * ashwaste like desert with art of its own, ground using it accepted and
 * drawn by view_image, list_materials showing it, the studio's "in use"
 * kept right, and the refusals (a clashing id, a like that isn't ground, a
 * material still in use, the wrong kind of image).
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-own-materials --verbose"
 */

const PROJECT = 'demo-cartographer-own-materials';
const BUCKET = `${PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-own-materials';
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
  client = new Client({ name: 'cartographer-own-materials-test', version: '0.0.0' });
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

// ── The tools ─────────────────────────────────────────────────────────

describe('set_world_materials', () => {
  const ids = {};

  beforeAll(async () => {
    const made = await ok('create_world', { name: 'Cinderfall', backdrop: { colour: '#101828' } });
    ids.world = made.worldId;
    ids.tile = (await addImage('other', { width: 128, height: 128 })).id;
    ids.tile2 = (await addImage('other', { width: 128, height: 128 })).id;
    ids.portrait = (await addImage('portrait')).id;
  }, 60000);

  test('is a write tool, and list_materials takes a world', async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.set_world_materials.annotations.readOnlyHint).toBe(false);
    expect(byName.list_materials.annotations.readOnlyHint).toBe(true);
  });

  test('makes an ashwaste like desert with art of its own', async () => {
    const result = await ok('set_world_materials', {
      worldId: ids.world,
      set: [{ id: 'ashwaste', name: 'Ashwaste', like: 'desert', imageId: ids.tile }],
    });
    expect(result).toMatchObject({
      count: 1,
      materials: [{ id: 'ashwaste', name: 'Ashwaste', like: 'desert', art: ids.tile }],
    });
    const { materials } = await worldDoc(ids.world);
    expect(materials).toHaveLength(1);
    expect(materials[0]).toMatchObject({
      id: 'ashwaste',
      like: 'desert',
      art: { imageId: ids.tile, width: 128 },
    });
    // The world as the page and the checks read it.
    expect((await loaded(ids.world)).materials[0].id).toBe('ashwaste');
    expect(
      catalog.materialArt('ground', 'ashwaste', null, (await loaded(ids.world)).materials)
    ).toMatchObject({ from: 'world', picture: { url: expect.stringContaining('http') } });
  });

  test('the studio’s “in use” shows the world', async () => {
    expect(await imageDoc(ids.tile)).toMatchObject({
      usedIn: [{ worldId: ids.world, target: 'material', id: 'ashwaste' }],
    });
  });

  test('list_materials shows it with the built-in ground, marked as its own', async () => {
    const listed = await ok('list_materials', { worldId: ids.world, kind: 'ground' });
    expect(listed.worldId).toBe(ids.world);
    expect(listed.materials).toContainEqual({
      kind: 'ground',
      id: 'ashwaste',
      name: 'Ashwaste',
      own: true,
      like: 'desert',
      art: ids.tile,
    });
    expect(listed.materials.filter((m) => m.own)).toHaveLength(1);
    // Without a world, the built-in set only.
    const plain = await ok('list_materials', {});
    expect(plain.count).toBe(catalog.MATERIALS.length);
    // Not in a list of walls.
    const walls = await ok('list_materials', { worldId: ids.world, kind: 'wall' });
    expect(walls.materials.some((m) => m.own)).toBe(false);
  });

  test('ground using it is accepted on a region map, and refused before it exists', async () => {
    const top = await ok('get_geometry', { worldId: ids.world, mapId: 'map_world' });
    const w = top.bounds.width;
    const shape = { rect: { x: 0, y: 0, w: w / 2, h: w / 2 } };
    expect(
      await refused('set_ground', {
        worldId: ids.world,
        mapId: 'map_world',
        set: [{ id: 'waste', material: 'saltflat', shape }],
      })
    ).toMatch(/unknown material "saltflat"/);
    const made = await ok('set_ground', {
      worldId: ids.world,
      mapId: 'map_world',
      set: [{ id: 'waste', material: 'ashwaste', shape }],
    });
    expect(made).toMatchObject({ added: ['waste'], counts: { ground: 1 } });
    const where = await ok('where', {
      worldId: ids.world,
      mapId: 'map_world',
      point: { x: w / 4, y: w / 4 },
    });
    expect(where.terrain).toMatchObject({ material: 'ashwaste', name: 'Ashwaste' });
  });

  test('view_image draws it as the ground it is like', async () => {
    const image = await call('view_image', { worldId: ids.world, of: 'map', id: 'map_world' });
    expect(image.isError).not.toBe(true);
    expect(image.content.some((c) => c.type === 'image')).toBe(true);
  });

  test('changes by id: a new name keeps the art; a new image replaces it, usedIn following', async () => {
    const renamed = await ok('set_world_materials', {
      worldId: ids.world,
      set: [{ id: 'ashwaste', name: 'Ash waste' }],
    });
    expect(renamed.materials[0]).toMatchObject({
      name: 'Ash waste',
      like: 'desert',
      art: ids.tile,
    });
    await ok('set_world_materials', {
      worldId: ids.world,
      set: [{ id: 'ashwaste', imageId: ids.tile2 }],
    });
    expect((await imageDoc(ids.tile)).usedIn).toEqual([]);
    expect((await imageDoc(ids.tile2)).usedIn).toEqual([
      { worldId: ids.world, target: 'material', id: 'ashwaste' },
    ]);
  });

  test('is refused for an id that clashes, a like that is no ground, a new one with no name', async () => {
    expect(
      await refused('set_world_materials', {
        worldId: ids.world,
        set: [{ id: 'desert', name: 'Desert', like: 'sand' }],
      })
    ).toMatch(/clashes with the built-in ground/);
    expect(
      await refused('set_world_materials', {
        worldId: ids.world,
        set: [{ id: 'brickfield', name: 'Brickfield', like: 'brick' }],
      })
    ).toMatch(/no built-in ground material/);
    expect(
      await refused('set_world_materials', {
        worldId: ids.world,
        set: [{ id: 'bare', like: 'sand' }],
      })
    ).toMatch(/needs a name and a like/);
    expect(await refused('set_world_materials', { worldId: ids.world })).toMatch(
      /something to set or remove/
    );
    // Nothing was kept of the refused ones.
    expect((await worldDoc(ids.world)).materials.map((m) => m.id)).toEqual(['ashwaste']);
  });

  test('is refused for the wrong kind of image', async () => {
    expect(
      await refused('set_world_materials', {
        worldId: ids.world,
        set: [{ id: 'ashwaste', imageId: ids.portrait }],
      })
    ).toMatch(/portrait image; terrain art takes an other image/);
  });

  test('a material still in use is not removed; once changed it goes, art and use with it', async () => {
    expect(
      await refused('set_world_materials', { worldId: ids.world, remove: ['ashwaste'] })
    ).toMatch(/still the ground of/);
    expect(
      await refused('set_world_materials', { worldId: ids.world, remove: ['nothing'] })
    ).toMatch(/No material "nothing"/);
    await ok('set_ground', { worldId: ids.world, mapId: 'map_world', remove: ['waste'] });
    const gone = await ok('set_world_materials', { worldId: ids.world, remove: ['ashwaste'] });
    expect(gone).toMatchObject({ count: 0, removed: ['ashwaste'] });
    expect((await worldDoc(ids.world)).materials).toEqual([]);
    expect((await imageDoc(ids.tile2)).usedIn).toEqual([]);
  });
});

describe('the studio’s assigner', () => {
  test('names a material that is not there', async () => {
    const made = await ok('create_world', { name: 'Emberlea', backdrop: { colour: '#101828' } });
    const image = await addImage('other');
    await expect(
      service.assignImage(BUILDER, {
        worldId: made.worldId,
        target: 'material',
        id: 'ashwaste',
        imageId: image.id,
      })
    ).rejects.toThrow(/No material "ashwaste"/);
  });
});
