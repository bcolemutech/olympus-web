'use strict';

/**
 * The Cartographer's callables (C-5 / #372): cartographerImport and
 * cartographerPublish, end to end against the Firestore and Storage emulators
 * — a real Nisia upload becomes a draft world, is published, and a player
 * starts a game in it.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-app --verbose"
 */

const PROJECT = 'demo-cartographer-app';
const BUCKET = `${PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;

jest.mock('../functions/gemini', () => ({ callGemini: jest.fn() }));

// firebase-functions-test sets FIREBASE_CONFIG from this, which gives
// functions/index.js's initializeApp() its default Storage bucket.
const functionsTest = require('firebase-functions-test')(
  { projectId: PROJECT, storageBucket: BUCKET },
  null
);
const {
  cartographerImport,
  cartographerPublish,
  cartographerCompletion,
  cartographerTownImage,
  loomCreateSave,
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
const { layOutTowns } = require('./helpers/towns');
const loomCanon = require('../functions/loom-canon');

const db = getFirestore();
const bucket = getStorage().bucket(BUCKET);
const RAW = fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'));

const BUILDER = { uid: 'builder-001', token: { apps: ['cartographer'] } };
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };

// A minimal PNG: signature + IHDR declaring width × height (enough for the
// header check; the image data itself isn't inspected).
function tinyPng(width, height) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
}

let seq = 0;
async function upload({ json = RAW, png, uid = BUILDER.uid } = {}) {
  seq += 1;
  const uploadId = `upload-${String(seq).padStart(4, '0')}`;
  const prefix = `cartographer/${uid}/${uploadId}/`;
  await bucket.file(prefix + 'map.json').save(json, { contentType: 'application/json' });
  if (png) await bucket.file(prefix + 'map.png').save(png, { contentType: 'image/png' });
  return uploadId;
}

const exists = async (name) => (await bucket.file(name).exists())[0];

// Writes a place up, as an MCP edit would, so the gate (L-322) lets players in.
async function writeUp(worldId, id) {
  const worldRef = db.collection('loom_worlds').doc(worldId);
  await worldRef
    .collection('locations')
    .doc(id)
    .update({ description: 'A rain-soaked port.', 'sources.description': 'mcp' });
  await layOutTowns(worldRef, id); // a settlement also needs its town
  await worldRef.update({ canonVersion: (await worldRef.get()).data().canonVersion + 1 });
}
const importAs = (auth, data) => cartographerImport.run({ data, auth });
const publishAs = (auth, data) => cartographerPublish.run({ data, auth });
const completionAs = (auth, data) => cartographerCompletion.run({ data, auth });
const townArtAs = (auth, data) => cartographerTownImage.run({ data, auth });

beforeEach(async () => {
  loomCanon.clearWorldCache();
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db.recursiveDelete(db.collection('loom_saves'));
  await bucket.deleteFiles().catch(() => {});
});

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db.recursiveDelete(db.collection('loom_saves'));
  await bucket.deleteFiles().catch(() => {});
  functionsTest.cleanup();
});

describe('cartographerImport', () => {
  test('loads an uploaded map and image as a draft world, then removes the upload', async () => {
    const uploadId = await upload({ png: tinyPng(5154, 3810) });
    const result = await importAs(BUILDER, { uploadId, name: 'The Nisian Reaches' });

    expect(result).toMatchObject({
      name: 'The Nisian Reaches',
      counts: { settlements: 663, pointsOfInterest: 56, factions: 23, regions: 145 },
      image: { width: 5154, height: 3810 },
    });
    expect(result.worldId).toMatch(/^the-nisian-reaches-[0-9a-f]{6}$/);
    expect(result.warnings.map((w) => w.code)).toEqual(['names_qualified', 'isolated_linked']);

    const world = (await db.collection('loom_worlds').doc(result.worldId).get()).data();
    expect(world).toMatchObject({
      status: 'draft',
      name: 'The Nisian Reaches',
      map: {
        width: 1718,
        height: 1270,
        imagePath: `worlds/${result.worldId}/map.png`,
        imageWidth: 5154,
        imageHeight: 3810,
      },
      source: { uploadedBy: BUILDER.uid, mapName: 'Nisia' },
    });
    expect(await exists(`worlds/${result.worldId}/map.png`)).toBe(true);
    expect(await exists(`cartographer/${BUILDER.uid}/${uploadId}/map.json`)).toBe(false);
    expect(await exists(`cartographer/${BUILDER.uid}/${uploadId}/map.png`)).toBe(false);
  });

  test('without an image the world has no image path', async () => {
    const result = await importAs(BUILDER, { uploadId: await upload() });
    expect(result.image).toBeNull();
    const world = (await db.collection('loom_worlds').doc(result.worldId).get()).data();
    expect(world.map.imagePath).toBeNull();
    expect(result.name).toBe('Nisia');
  });

  test('an invalid PNG is skipped with a warning; the world still loads', async () => {
    const uploadId = await upload({ png: Buffer.from('definitely not a png, just some text!!') });
    const result = await importAs(BUILDER, { uploadId });
    expect(result.image).toBeNull();
    expect(result.warnings.map((w) => w.code)).toContain('image_invalid');
    expect(await exists(`worlds/${result.worldId}/map.png`)).toBe(false);
  });

  test('a file that is not an Azgaar export is refused with a clear message, and nothing is created', async () => {
    const uploadId = await upload({
      json: Buffer.from('{"type":"FeatureCollection","features":[]}'),
    });
    await expect(importAs(BUILDER, { uploadId })).rejects.toMatchObject({
      code: 'invalid-argument',
      message: expect.stringMatching(/GeoJSON/),
    });
    expect((await db.collection('loom_worlds').get()).empty).toBe(true);
  });

  test('a missing upload or a malformed upload id is refused', async () => {
    await expect(importAs(BUILDER, { uploadId: 'upload-9999' })).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(importAs(BUILDER, { uploadId: '../../etc' })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  test('another user’s upload is not found — imports only read your own folder', async () => {
    const uploadId = await upload({ uid: 'someone-else' });
    await expect(importAs(BUILDER, { uploadId })).rejects.toMatchObject({ code: 'not-found' });
  });

  test('requires sign-in and the cartographer claim', async () => {
    const uploadId = await upload();
    await expect(importAs(undefined, { uploadId })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(importAs(PLAYER, { uploadId })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});

describe('cartographerPublish', () => {
  let worldId;
  beforeEach(async () => {
    ({ worldId } = await importAs(BUILDER, { uploadId: await upload() }));
  });

  test('refuses until the world is playable, naming what is missing', async () => {
    await expect(publishAs(BUILDER, { worldId })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringMatching(/opening hook.*starting location/),
    });
    await expect(
      publishAs(BUILDER, { worldId, openingHook: 'A storm.', startingLocationId: 'loc_99999' })
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringMatching(/starting location/),
    });
    // The start must be open to players: written up, not the import text (L-322).
    await expect(
      publishAs(BUILDER, { worldId, openingHook: 'A storm.', startingLocationId: 'loc_1' })
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message:
        'Not ready to publish. It needs a starting location players can enter ' +
        '(Burdendal: it has no town layout; its description is still the imported text).',
    });
    expect((await db.collection('loom_worlds').doc(worldId).get()).data().status).toBe('draft');
  });

  test('publishes with an opening hook and starting location; the Loom can then play it', async () => {
    await writeUp(worldId, 'loc_1');
    await expect(
      publishAs(BUILDER, {
        worldId,
        openingHook: 'A storm drives your ship ashore at Burdendal.',
        tagline: 'Twenty-three realms, one coastline.',
        startingLocationId: 'loc_1',
      })
    ).resolves.toEqual({ worldId, status: 'published' });

    const world = (await db.collection('loom_worlds').doc(worldId).get()).data();
    expect(world).toMatchObject({
      status: 'published',
      openingHook: 'A storm drives your ship ashore at Burdendal.',
      tagline: 'Twenty-three realms, one coastline.',
      rules: { startingLocationId: 'loc_1' },
      canonVersion: 3, // import 1, write-up 2, publish 3
      publishedBy: BUILDER.uid,
    });
    expect(typeof world.publishedAtMs).toBe('number');

    // Players can now start a game in it, at the chosen start.
    const { saveId } = await loomCreateSave.run({
      data: { worldId, name: 'First voyage', characterName: 'Mara' },
      auth: PLAYER,
    });
    expect((await db.collection('loom_saves').doc(saveId).get()).data().location).toBe('loc_1');
  });

  test('only a draft can be published', async () => {
    await writeUp(worldId, 'loc_1');
    await publishAs(BUILDER, { worldId, openingHook: 'A storm.', startingLocationId: 'loc_1' });
    await expect(
      publishAs(BUILDER, { worldId, openingHook: 'Again.', startingLocationId: 'loc_1' })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  test('unknown or malformed worlds, and callers without the claim, are refused', async () => {
    await expect(publishAs(BUILDER, { worldId: 'no-such-world' })).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(publishAs(BUILDER, { worldId: 'Bad/Id' })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(
      publishAs(PLAYER, { worldId, openingHook: 'A storm.', startingLocationId: 'loc_1' })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('rejects over-long text', async () => {
    await expect(
      publishAs(BUILDER, { worldId, openingHook: 'x'.repeat(2001), startingLocationId: 'loc_1' })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('cartographerCompletion (L-323)', () => {
  test('reports how many places are playable, graded on the server', async () => {
    const { worldId } = await importAs(BUILDER, { uploadId: await upload() });
    await expect(completionAs(BUILDER, { worldIds: [worldId, 'no-such-world'] })).resolves.toEqual({
      worlds: { [worldId]: { total: 719, playable: 0, rich: 0, share: 0 } },
    });

    const worldRef = db.collection('loom_worlds').doc(worldId);
    await worldRef
      .collection('locations')
      .doc('loc_1')
      .update({ description: 'A rain-soaked port.', 'sources.description': 'mcp' });
    await layOutTowns(worldRef, 'loc_1');
    await worldRef.update({ canonVersion: 2 });
    await expect(completionAs(BUILDER, { worldIds: [worldId] })).resolves.toEqual({
      worlds: { [worldId]: { total: 719, playable: 1, rich: 0, share: 0.001 } },
    });

    // Enough residents and lore for a great city (a capital of 28,473) make
    // it rich: still one playable place, now rich too.
    for (let i = 1; i <= 6; i += 1) {
      await worldRef
        .collection('characters')
        .doc(`chr_${i}`)
        .set({ id: `chr_${i}`, name: `Local ${i}`, description: 'A local.', locationId: 'loc_1' });
    }
    for (let i = 1; i <= 3; i += 1) {
      await worldRef
        .collection('lore')
        .doc(`lore_${i}`)
        .set({ id: `lore_${i}`, title: `Tale ${i}`, text: '…', entityRefs: ['loc_1'] });
    }
    await worldRef.update({ canonVersion: 3 });
    await expect(completionAs(BUILDER, { worldIds: [worldId] })).resolves.toEqual({
      worlds: { [worldId]: { total: 719, playable: 1, rich: 1, share: 0.001 } },
    });
  });

  test('needs the cartographer claim and valid world ids', async () => {
    await expect(completionAs(PLAYER, { worldIds: [] })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(completionAs(BUILDER, { worldIds: ['Bad/Id'] })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(
      completionAs(BUILDER, { worldIds: Array.from({ length: 21 }, (_, i) => `w-${i}`) })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('cartographerTownImage (L-347)', () => {
  let worldId;
  const loc1 = async () =>
    (
      await db.collection('loom_worlds').doc(worldId).collection('locations').doc('loc_1').get()
    ).data();
  const version = async () =>
    (await db.collection('loom_worlds').doc(worldId).get()).data().canonVersion;
  // Uploads a town image to the builder's folder, as the page does.
  async function uploadTown(png, uid = BUILDER.uid) {
    seq += 1;
    const uploadId = `town-up-${String(seq).padStart(4, '0')}`;
    await bucket
      .file(`cartographer/${uid}/${uploadId}/town.png`)
      .save(png, { contentType: 'image/png' });
    return uploadId;
  }

  // Every test starts from a fresh import (the suite clears worlds and files).
  beforeEach(async () => {
    ({ worldId } = await importAs(BUILDER, { uploadId: await upload() }));
  });
  const attach = async (png) =>
    townArtAs(BUILDER, { worldId, locationId: 'loc_1', uploadId: await uploadTown(png) });

  test('attaches a PNG to a settlement: copied beside the map, recorded, upload removed', async () => {
    const before = await version();
    const uploadId = await uploadTown(tinyPng(800, 600));
    await expect(townArtAs(BUILDER, { worldId, locationId: 'loc_1', uploadId })).resolves.toEqual({
      worldId,
      locationId: 'loc_1',
      name: 'Burdendal',
      image: { width: 800, height: 600 },
    });
    const { image } = (await loc1()).town;
    expect(image).toMatchObject({ width: 800, height: 600 });
    expect(image.path).toMatch(new RegExp(`^worlds/${worldId}/town-loc_1-[a-z0-9]+\\.png$`));
    expect(await exists(image.path)).toBe(true);
    expect(await exists(`cartographer/${BUILDER.uid}/${uploadId}/town.png`)).toBe(false);
    expect(await version()).toBe(before + 1); // games see it on their next turn
  });

  test('replacing it stores the new image under a new name and deletes the old one', async () => {
    await attach(tinyPng(800, 600));
    const old = (await loc1()).town.image.path;
    await attach(tinyPng(1024, 1024));
    const { image } = (await loc1()).town;
    expect(image).toMatchObject({ width: 1024, height: 1024 });
    expect(image.path).not.toBe(old);
    expect(await exists(image.path)).toBe(true);
    expect(await exists(old)).toBe(false);
  });

  test('removing it deletes the field and the file; removing again changes nothing', async () => {
    await attach(tinyPng(800, 600));
    const { path: art } = (await loc1()).town.image;
    await expect(
      townArtAs(BUILDER, { worldId, locationId: 'loc_1', remove: true })
    ).resolves.toMatchObject({ name: 'Burdendal', image: null });
    expect((await loc1()).town || {}).not.toHaveProperty('image');
    expect(await exists(art)).toBe(false);
    const before = await version();
    await townArtAs(BUILDER, { worldId, locationId: 'loc_1', remove: true });
    expect(await version()).toBe(before);
  });

  test('refuses what is not a settlement, a bad image, and a missing upload — leaving nothing behind', async () => {
    const poi = await uploadTown(tinyPng(64, 64));
    await expect(
      townArtAs(BUILDER, { worldId, locationId: 'poi_1', uploadId: poi })
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringMatching(/isn't a settlement/),
    });
    const [left] = await bucket.getFiles({ prefix: `worlds/${worldId}/town-poi_1` });
    expect(left).toEqual([]); // the copy made before the check is cleaned up
    await expect(
      townArtAs(BUILDER, {
        worldId,
        locationId: 'loc_99999',
        uploadId: await uploadTown(tinyPng(64, 64)),
      })
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      townArtAs(BUILDER, {
        worldId,
        locationId: 'loc_1',
        uploadId: await uploadTown(Buffer.from('not a png at all, just text')),
      })
    ).rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringMatching(/PNG/) });
    await expect(
      townArtAs(BUILDER, { worldId, locationId: 'loc_1', uploadId: 'never-uploaded' })
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  test('needs the cartographer claim, valid ids, and a world that exists', async () => {
    await expect(
      townArtAs(PLAYER, { worldId, locationId: 'loc_1', remove: true })
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      townArtAs(BUILDER, { worldId: 'Bad/Id', locationId: 'loc_1', remove: true })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(townArtAs(BUILDER, { worldId, locationId: 'loc_1' })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(
      townArtAs(BUILDER, { worldId: 'no-such-world', locationId: 'loc_1', remove: true })
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringMatching(/World not found/),
    });
  });
});
