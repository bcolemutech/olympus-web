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
const { cartographerImport, cartographerPublish, loomCreateSave } = require('../functions/index');
const fs = require('fs');
const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { getStorage } = require(
  require.resolve('firebase-admin/storage', { paths: [functionsDir] })
);
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
const importAs = (auth, data) => cartographerImport.run({ data, auth });
const publishAs = (auth, data) => cartographerPublish.run({ data, auth });

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
    expect((await db.collection('loom_worlds').doc(worldId).get()).data().status).toBe('draft');
  });

  test('publishes with an opening hook and starting location; the Loom can then play it', async () => {
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
      canonVersion: 2,
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
