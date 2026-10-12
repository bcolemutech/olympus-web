'use strict';

/**
 * Today's art into the library (planning/the-image-studio.md §3 S6; L-705 /
 * #541): each kind of art still held as a Storage path moves into the
 * library and the world serves the same image; the same file in two worlds
 * becomes one image; a dry run writes nothing; a second run changes nothing.
 * Runs against the Firestore and Storage emulators, as
 * scripts/backfill-art-library.js does against production.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest studio-backfill --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';

const fs = require('fs');
const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { initializeApp } = require(require.resolve('firebase-admin/app', { paths: [functionsDir] }));
const { getFirestore, FieldValue } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { getStorage } = require(
  require.resolve('firebase-admin/storage', { paths: [functionsDir] })
);
const { PNG } = require(require.resolve('pngjs', { paths: [functionsDir] }));
const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { loadDraftWorld } = require('../functions/cartographer/load');
const loomCanon = require('../functions/loom-canon');
const art = require('../functions/loom-canon/art');
const { planArtBackfill, applyArtBackfill } = require('../functions/studio/art-backfill');
const { currentPath } = require('../functions/studio/library');

const PROJECT = 'demo-studio-backfill';
const adminApp = initializeApp(
  { projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` },
  'studio-backfill-test'
);
const db = getFirestore(adminApp);
const bucket = getStorage(adminApp).bucket(`${PROJECT}.appspot.com`);
const PARSED = parseAzgaarExport(
  fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
);

const A = 'nisia-b0b0b0';
const B = 'nisia-b1b1b1';
function png(width, height, shade) {
  const img = new PNG({ width, height });
  img.data.fill(shade);
  return PNG.sync.write(img);
}
const MAP = png(40, 30, 10);
const TOWN = png(20, 20, 20); // in both worlds: one image
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 6"><rect width="8" height="6"/></svg>'
);
const CELLAR = {
  id: 'bm_cellar',
  name: 'The cellar',
  width: 8,
  height: 6,
  entries: [{ id: 'in', x: 0, y: 0 }],
  exits: [{ id: 'out', name: 'the stairs', x: 0, y: 1, to: 'out' }],
  features: [],
  generic: null,
};

const loaded = async (id) => {
  loomCanon.clearWorldCache();
  return loomCanon.loadWorld(id, { db, playableOnly: false });
};
const run = async (id, apply) =>
  applyArtBackfill({ db, bucket, FieldValue, world: await loaded(id), apply });
const exists = async (name) => (await bucket.file(name).exists())[0];
const version = async (id) =>
  (await db.collection('loom_worlds').doc(id).get()).data().canonVersion;
const libraryCount = async () => (await db.collection('studio_images').get()).size;

// A world with art from before the library: its map, a town and a battle
// map, each a Storage path, as the Cartographer stored them until L-704.
async function oldWorld(worldId, { map, town, battleMap, missing } = {}) {
  await loadDraftWorld({
    db,
    mapped: mapToCanon(PARSED),
    source: PARSED.source,
    uploadedBy: 'b',
    worldId,
  });
  const ref = db.collection('loom_worlds').doc(worldId);
  const save = (name, bytes) => bucket.file(name).save(bytes, { resumable: false });
  if (map) {
    await save(`worlds/${worldId}/map.png`, map);
    await ref.update({
      'map.imagePath': `worlds/${worldId}/map.png`,
      'map.imageWidth': 40,
      'map.imageHeight': 30,
    });
  }
  if (town) {
    const at = `worlds/${worldId}/town-loc_1-x1.png`;
    await save(at, town);
    await ref
      .collection('locations')
      .doc('loc_1')
      .update({
        'town.image': { path: at, width: 20, height: 20 },
      });
  }
  if (battleMap) {
    const at = `worlds/${worldId}/map-bm_cellar-x2.svg`;
    await save(at, battleMap);
    await ref
      .collection('battleMaps')
      .doc(CELLAR.id)
      .set({ ...CELLAR, image: { path: at, width: 8, height: 6, format: 'svg' } });
  }
  if (missing) {
    await ref
      .collection('locations')
      .doc('loc_2')
      .update({
        'town.image': { path: `worlds/${worldId}/town-loc_2-gone.png`, width: 5, height: 5 },
      });
  }
  await ref.update({ canonVersion: (await ref.get()).data().canonVersion + 1 });
}

beforeAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db.recursiveDelete(db.collection('studio_images'));
  await bucket.deleteFiles({ force: true }).catch(() => {});
  await oldWorld(A, { map: MAP, town: TOWN, battleMap: SVG, missing: true });
  await oldWorld(B, { town: TOWN });
}, 60000);

afterAll(async () => {
  await db.terminate();
});

test('the plan lists the art still on a path, of each kind', async () => {
  expect(planArtBackfill(await loaded(A)).map((i) => [i.target, i.id, i.path])).toEqual([
    ['map', A, `worlds/${A}/map.png`],
    ['town', 'loc_1', `worlds/${A}/town-loc_1-x1.png`],
    ['town', 'loc_2', `worlds/${A}/town-loc_2-gone.png`],
    ['battleMap', 'bm_cellar', `worlds/${A}/map-bm_cellar-x2.svg`],
  ]);
});

test('a dry run writes nothing, and says what would move and what is missing', async () => {
  const before = await version(A);
  const result = await run(A, false);
  expect(result.moved.map((m) => m.target)).toEqual(['map', 'town', 'battleMap']);
  expect(result.missing).toEqual([
    expect.objectContaining({
      target: 'town',
      id: 'loc_2',
      path: `worlds/${A}/town-loc_2-gone.png`,
    }),
  ]);
  expect(result.canonVersion).toBeNull();
  expect(await libraryCount()).toBe(0);
  expect(await version(A)).toBe(before);
  expect(await exists(`worlds/${A}/map.png`)).toBe(true);
});

test('each kind of art moves into the library, and the world serves the same image', async () => {
  const before = await version(A);
  const result = await run(A, true);
  expect(result.moved.map((m) => [m.target, m.reused])).toEqual([
    ['map', false],
    ['town', false],
    ['battleMap', false],
  ]);
  expect(result.canonVersion).toBe(before + 1); // games reload it
  const world = await loaded(A);
  const pieces = [
    [art.worldMapArt(world), MAP, 'worldMap', 'world map'],
    [art.townArt(world.locations.loc_1), TOWN, 'town', 'town art'],
    [art.mapArt(world.battleMaps.bm_cellar), SVG, 'battleMap', 'battle-map art'],
  ];
  for (const [piece, bytes, kind, label] of pieces) {
    expect(piece).toMatchObject({
      imageId: expect.stringMatching(/^img_/),
      url: expect.any(String),
    });
    expect(piece.path).toBeUndefined();
    const record = (await db.collection('studio_images').doc(piece.imageId).get()).data();
    expect(record).toMatchObject({
      kind,
      labels: [A, label],
      via: 'backfill',
      createdBy: 'backfill',
      source: expect.objectContaining({ worldId: A, sha256: expect.any(String) }),
      link: piece.url,
    });
    // The same image: what the link serves is the old file's bytes.
    const [served] = await bucket.file(currentPath(piece.imageId)).download();
    expect(served.equals(bytes)).toBe(true);
  }
  // The old map fields and files are gone; the missing one is left as it was.
  const doc = (await db.collection('loom_worlds').doc(A).get()).data();
  expect(doc.map.imagePath).toBeUndefined();
  expect(await exists(`worlds/${A}/map.png`)).toBe(false);
  expect(await exists(`worlds/${A}/town-loc_1-x1.png`)).toBe(false);
  expect(art.townArt(world.locations.loc_2)).toMatchObject({
    path: `worlds/${A}/town-loc_2-gone.png`,
  });
});

test('the same file in another world becomes the same image, used twice', async () => {
  const result = await run(B, true);
  const townImage = art.townArt((await loaded(A)).locations.loc_1).imageId;
  expect(result.moved).toEqual([
    expect.objectContaining({ target: 'town', id: 'loc_1', imageId: townImage, reused: true }),
  ]);
  expect(await libraryCount()).toBe(3);
  const record = (await db.collection('studio_images').doc(townImage).get()).data();
  expect(record.usedIn).toEqual([
    { worldId: A, target: 'town', id: 'loc_1' },
    { worldId: B, target: 'town', id: 'loc_1' },
  ]);
});

test('a second run changes nothing', async () => {
  const before = [await version(A), await version(B)];
  for (const id of [A, B]) {
    const result = await run(id, true);
    expect(result.moved).toEqual([]);
    expect(result.canonVersion).toBeNull();
  }
  expect([await version(A), await version(B)]).toEqual(before);
  expect(await libraryCount()).toBe(3);
});
