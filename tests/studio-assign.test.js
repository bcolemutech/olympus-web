'use strict';

/**
 * Worlds use library images (planning/the-image-studio.md §4.4; L-704 /
 * #540): assigning and unassigning each target, the kind check, usedIn,
 * uploads and set_art through the library, the Loom and view_image serving
 * an assigned image, and a world still on an older Storage path. Runs
 * against the Firestore and Storage emulators, through the callables, the
 * Cartographer's service and the connector's tools.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest studio-assign --verbose"
 */

const PROJECT = 'demo-studio-assign';
const BUCKET = `${PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;

jest.mock('../functions/gemini', () => ({ callGemini: jest.fn() }));

require('firebase-functions-test')({ projectId: PROJECT, storageBucket: BUCKET }, null);
const {
  cartographerImport,
  cartographerPublish,
  cartographerTownImage,
  loomCreateSave,
  loomGetMap,
} = require('../functions/index');
const fs = require('fs');
const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { getStorage } = require(
  require.resolve('firebase-admin/storage', { paths: [functionsDir] })
);
const { PNG } = require(require.resolve('pngjs', { paths: [functionsDir] }));
const loomCanon = require('../functions/loom-canon');
const { createLibrary } = require('../functions/studio/library');
const { readImage } = require('../functions/studio/formats');
const { createCartographerService } = require('../functions/cartographer/service');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { layOutTowns } = require('./helpers/towns');

const db = getFirestore();
const bucket = getStorage().bucket(BUCKET);
const library = createLibrary({ db, bucket });
const writer = createFirestoreWorldWriter(() => db);
const service = createCartographerService({ db, bucket, writer });
const app = cartographerApp({
  reader: createFirestoreWorldReader(() => db),
  writer,
  art: {
    load: async (artPath) => (await bucket.file(artPath).download())[0],
    draw: (uid, args) => service.drawArt(uid, args),
  },
  studio: { assign: (uid, args) => service.assignImage(uid, args) },
});
const tool = (name) => app.tools.find((t) => t.name === name);
const call = (name, args) => tool(name).handler({ uid: BUILDER.uid }, args);

const BUILDER = { uid: 'builder-001', token: { apps: ['cartographer'] } };
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };
const RAW = fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'));

function solidPng(width, height, shade = 170) {
  const img = new PNG({ width, height });
  img.data.fill(shade);
  return PNG.sync.write(img);
}

let seq = 0;
async function upload(files) {
  seq += 1;
  const uploadId = `upload-${String(seq).padStart(4, '0')}`;
  for (const [name, bytes] of Object.entries(files)) {
    await bucket
      .file(`cartographer/${BUILDER.uid}/${uploadId}/${name}`)
      .save(bytes, { resumable: false });
  }
  return uploadId;
}
const exists = async (name) => (await bucket.file(name).exists())[0];
const image = async (id) => (await db.collection('studio_images').doc(id).get()).data();
const worldDoc = async (id) => (await db.collection('loom_worlds').doc(id).get()).data();
const entity = async (worldId, collection, id) =>
  (await db.collection('loom_worlds').doc(worldId).collection(collection).doc(id).get()).data();
const addImage = (kind, { width = 64, height = 64, shade } = {}) =>
  library.addImage({
    title: `A ${kind}`,
    kind,
    file: readImage(solidPng(width, height, shade)),
    createdBy: BUILDER.uid,
    via: 'page',
  });
const bump = async (worldId, fields = {}) => {
  const ref = db.collection('loom_worlds').doc(worldId);
  await ref.update({ ...fields, canonVersion: (await ref.get()).data().canonVersion + 1 });
};

// A world imported with its map image, a battle map of its own, and the
// start written up with a town.
let worldId;
const BATTLE_MAP = {
  id: 'bm_cellar',
  name: 'The cellar',
  width: 8,
  height: 6,
  entries: [{ id: 'stairs', x: 0, y: 0 }],
  exits: [{ id: 'up', name: 'the stairs', x: 0, y: 1, to: 'out' }],
  features: [],
  generic: null,
};

beforeAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db.recursiveDelete(db.collection('studio_images'));
  await bucket.deleteFiles({ force: true }).catch(() => {});
  const uploadId = await upload({ 'map.json': RAW, 'map.png': solidPng(400, 300) });
  ({ worldId } = await cartographerImport.run({ data: { uploadId }, auth: BUILDER }));
  const worldRef = db.collection('loom_worlds').doc(worldId);
  await worldRef
    .collection('locations')
    .doc('loc_1')
    .update({ description: 'A rain-soaked port.', 'sources.description': 'mcp' });
  await layOutTowns(worldRef, 'loc_1');
  await worldRef.collection('battleMaps').doc(BATTLE_MAP.id).set(BATTLE_MAP);
  await bump(worldId);
  loomCanon.clearWorldCache();
}, 60000);

afterAll(async () => {
  await db.terminate();
});

describe('the import', () => {
  test('puts the world map image in the library and assigns it', async () => {
    const { map } = await worldDoc(worldId);
    expect(map.imagePath).toBeFalsy();
    expect(map.image).toEqual({
      imageId: expect.stringMatching(/^img_/),
      link: expect.stringContaining(`studio%2F${map.image.imageId}%2Fcurrent`),
      width: 400,
      height: 300,
      format: 'png',
    });
    expect(await image(map.image.imageId)).toMatchObject({
      kind: 'worldMap',
      via: 'upload',
      usedIn: [{ worldId, target: 'map', id: worldId }],
    });
    expect(await exists(`worlds/${worldId}/map.png`)).toBe(false);
  });
});

describe('studio_assign and studio_unassign', () => {
  test('assign each target, keeping usedIn right; a wrong kind is refused', async () => {
    const townArt = await addImage('town', { width: 100, height: 100 });
    const mapArt = await addImage('battleMap', { width: 80, height: 60 });
    const cover = await addImage('cover', { width: 300, height: 160 });

    const town = await call('studio_assign', {
      worldId,
      imageId: townArt.id,
      target: 'town',
      id: 'loc_1',
    });
    expect(town).toMatchObject({
      target: 'town',
      id: 'loc_1',
      name: 'Burdendal',
      image: { imageId: townArt.id, width: 100, height: 100, format: 'png' },
      previous: null,
      next: 'Check it with view_image.',
    });
    expect(town).not.toHaveProperty('warnings');
    expect((await entity(worldId, 'locations', 'loc_1')).town.image).toEqual({
      imageId: townArt.id,
      link: townArt.link,
      width: 100,
      height: 100,
      format: 'png',
    });

    const battle = await call('studio_assign', {
      worldId,
      imageId: mapArt.id,
      target: 'battleMap',
      id: BATTLE_MAP.id,
    });
    // 80 × 60 fits an 8 × 6 grid: no warning.
    expect(battle).not.toHaveProperty('warnings');
    expect((await entity(worldId, 'battleMaps', BATTLE_MAP.id)).image).toMatchObject({
      imageId: mapArt.id,
    });

    await call('studio_assign', { worldId, imageId: cover.id, target: 'cover' });
    expect((await worldDoc(worldId)).cover).toMatchObject({ imageId: cover.id, link: cover.link });

    for (const [id, target, at] of [
      [townArt.id, 'town', 'loc_1'],
      [mapArt.id, 'battleMap', BATTLE_MAP.id],
      [cover.id, 'cover', worldId],
    ]) {
      expect((await image(id)).usedIn).toEqual([{ worldId, target, id: at }]);
    }

    // A wrong kind is refused, and nothing changes.
    await expect(
      call('studio_assign', { worldId, imageId: townArt.id, target: 'cover' })
    ).rejects.toThrow(/is a town image; cover image takes a cover image/);
    expect((await worldDoc(worldId)).cover.imageId).toBe(cover.id);
    // An image that doesn't exist, and a target that doesn't.
    await expect(
      call('studio_assign', { worldId, imageId: 'img_0000000000000000', target: 'cover' })
    ).rejects.toThrow(/No image/);
    await expect(
      call('studio_assign', { worldId, imageId: townArt.id, target: 'town', id: 'loc_99999' })
    ).rejects.toThrow(/No place/);
  });

  test('replacing moves the use; a shape that doesn’t fit is warned about', async () => {
    const first = (await entity(worldId, 'locations', 'loc_1')).town.image.imageId;
    const wide = await addImage('town', { width: 200, height: 100 });
    const result = await call('studio_assign', {
      worldId,
      imageId: wide.id,
      target: 'town',
      id: 'loc_1',
    });
    expect(result.previous).toEqual({ imageId: first });
    expect(result.warnings).toEqual([expect.stringMatching(/isn't square \(200 × 100\)/)]);
    expect((await image(first)).usedIn).toEqual([]);
    expect((await image(wide.id)).usedIn).toEqual([{ worldId, target: 'town', id: 'loc_1' }]);
    // The image left unused can be deleted now; the one in use can't.
    await library.deleteImage(first);
    await expect(library.deleteImage(wide.id)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  test('unassigning takes the art away and frees the image', async () => {
    const coverId = (await worldDoc(worldId)).cover.imageId;
    const result = await call('studio_unassign', { worldId, target: 'cover' });
    expect(result).toMatchObject({ target: 'cover', removed: { imageId: coverId } });
    expect((await worldDoc(worldId)).cover).toBeUndefined();
    expect((await image(coverId)).usedIn).toEqual([]);
    // Nothing there: nothing changes.
    expect(await call('studio_unassign', { worldId, target: 'cover' })).toMatchObject({
      removed: null,
    });
  });
});

describe('art through the library', () => {
  test('a page upload becomes a library image, assigned in one step', async () => {
    const uploadId = await upload({ 'town.png': solidPng(500, 500, 90) });
    const result = await cartographerTownImage.run({
      data: { worldId, locationId: 'loc_1', uploadId },
      auth: BUILDER,
    });
    expect(result).toMatchObject({
      locationId: 'loc_1',
      name: 'Burdendal',
      image: { imageId: expect.stringMatching(/^img_/), width: 500, height: 500, format: 'png' },
    });
    expect(await image(result.image.imageId)).toMatchObject({
      title: 'Burdendal: town art',
      kind: 'town',
      via: 'page',
      source: { worldId, target: 'town', id: 'loc_1' },
      usedIn: [{ worldId, target: 'town', id: 'loc_1' }],
    });
    expect(await exists(`cartographer/${BUILDER.uid}/${uploadId}/town.png`)).toBe(false);
  });

  test('set_art stores its SVG as a library image and assigns it', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 6"><rect width="8" height="6"/></svg>';
    const result = await call('set_art', { worldId, of: 'battleMap', id: BATTLE_MAP.id, svg });
    expect(result.art).toMatchObject({ format: 'svg', width: 8, height: 6 });
    const record = await image(result.art.imageId);
    expect(record).toMatchObject({
      kind: 'battleMap',
      via: 'mcp',
      usedIn: [{ worldId, target: 'battleMap', id: BATTLE_MAP.id }],
    });
    expect(await exists(record.versions[0].path)).toBe(true);
    // Taking it away with svg null leaves the image in the library, unused.
    await call('set_art', { worldId, of: 'battleMap', id: BATTLE_MAP.id, svg: null });
    expect((await entity(worldId, 'battleMaps', BATTLE_MAP.id)).image).toBeNull();
    expect((await image(result.art.imageId)).usedIn).toEqual([]);
  });
});

describe('players and view_image see the assigned image', () => {
  let saveId;
  test('loomGetMap gives the image’s link, never its record', async () => {
    const mapArt = await addImage('battleMap', { width: 80, height: 60 });
    await call('studio_assign', {
      worldId,
      imageId: mapArt.id,
      target: 'battleMap',
      id: BATTLE_MAP.id,
    });
    await cartographerPublish.run({
      data: { worldId, openingHook: 'A storm.', startingLocationId: 'loc_1' },
      auth: BUILDER,
    });
    ({ saveId } = await loomCreateSave.run({
      data: { worldId, name: 'Voyage', characterName: 'Mara' },
      auth: PLAYER,
    }));
    const view = await loomGetMap.run({ data: { worldId, saveId }, auth: PLAYER });
    const { map } = await worldDoc(worldId);
    // With its screen-sized copy's link beside it (L-727).
    const screenOf = (link) => link.replace('%2Fcurrent?', '%2Fscreen?');
    expect(view.map.image).toEqual({
      url: map.image.link,
      screenUrl: screenOf(map.image.link),
      width: 400,
      height: 300,
    });
    const townArt = (await entity(worldId, 'locations', 'loc_1')).town.image;
    expect(view.town.image).toEqual({
      url: townArt.link,
      screenUrl: screenOf(townArt.link),
      width: 500,
      height: 500,
    });
    expect(JSON.stringify(view)).not.toMatch(/imageId|usedIn|createdBy/);
  });

  test('view_image draws an assigned image, for each kind of thing', async () => {
    for (const args of [
      { of: 'world' },
      { of: 'town', id: 'loc_1' },
      { of: 'battleMap', id: BATTLE_MAP.id },
    ]) {
      const result = await call('view_image', { worldId, ...args });
      expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    }
  });
});

describe('a world still on an older Storage path', () => {
  test('keeps working, and replacing its art deletes the old file', async () => {
    const oldPath = `worlds/${worldId}/town-loc_1-old.png`;
    await bucket.file(oldPath).save(solidPng(300, 300), { resumable: false });
    await db
      .collection('loom_worlds')
      .doc(worldId)
      .collection('locations')
      .doc('loc_1')
      .update({ 'town.image': { path: oldPath, width: 300, height: 300 } });
    await bump(worldId);
    loomCanon.clearWorldCache();

    const saveId = (
      await loomCreateSave.run({
        data: { worldId, name: 'Old art', characterName: 'Tobin' },
        auth: PLAYER,
      })
    ).saveId;
    const view = await loomGetMap.run({ data: { worldId, saveId }, auth: PLAYER });
    expect(view.town.image).toEqual({ path: oldPath, width: 300, height: 300 });
    const drawn = await call('view_image', { worldId, of: 'town', id: 'loc_1' });
    expect(drawn.content[0]).toMatchObject({ type: 'image' });

    const replacement = await addImage('town');
    const result = await call('studio_assign', {
      worldId,
      imageId: replacement.id,
      target: 'town',
      id: 'loc_1',
    });
    expect(result.previous).toEqual({ path: oldPath });
    expect(await exists(oldPath)).toBe(false);
  });
});
