'use strict';

/**
 * Screen-sized copies (planning/the-map-first-loom.md §3 A1; L-727 / #598):
 * a version bigger than a screen is stored with a copy at most 2048 px on its
 * long side, the screen link serves the current version's copy (or the
 * version itself), players are given it beside the full image, and the
 * backfill makes what images from before L-727 lack. Runs against the
 * Firestore and Storage emulators.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest studio-screen --verbose"
 */

const PROJECT = 'demo-studio-screen';
const BUCKET = `${PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const fromFunctions = (name) => require(require.resolve(name, { paths: [functionsDir] }));
const { initializeApp, getApps } = fromFunctions('firebase-admin/app');
if (!getApps().length) initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
const { getFirestore } = fromFunctions('firebase-admin/firestore');
const { getStorage } = fromFunctions('firebase-admin/storage');
const sharp = fromFunctions('sharp');

const { createLibrary, summary } = require('../functions/studio/library');
const { readImage } = require('../functions/studio/formats');
const { SCREEN_MAX, screenLinkOf } = require('../functions/studio/screen');
const { planScreenBackfill, applyScreenBackfill } = require('../functions/studio/screen-backfill');
const art = require('../functions/loom-canon/art');

const db = getFirestore();
const bucket = getStorage().bucket(BUCKET);
const library = createLibrary({ db, bucket });

// A real PNG of a size, in one colour.
const png = (width, height, colour = '#336699') =>
  sharp({ create: { width, height, channels: 3, background: colour } })
    .png()
    .toBuffer();
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect width="640" height="480" fill="#336"/></svg>';

const exists = async (name) => (await bucket.file(name).exists())[0];
const download = async (name) => (await bucket.file(name).download())[0];
// The file a link names, and whether the link's token is that file's.
const served = async (link) => {
  const url = new URL(link);
  const name = decodeURIComponent(url.pathname.replace(/^\/v0\/b\/[^/]+\/o\//, ''));
  const [meta] = await bucket.file(name).getMetadata();
  const tokens = String((meta.metadata || {}).firebaseStorageDownloadTokens || '').split(',');
  return {
    name,
    tokenOk: tokens.includes(url.searchParams.get('token')),
    bytes: await download(name),
    contentType: meta.contentType,
  };
};

const add = (bytes, title = 'Nisia') =>
  library.addImage({
    title,
    kind: 'worldMap',
    labels: ['nisia'],
    file: readImage(bytes),
    createdBy: 'builder-001',
    via: 'page',
  });

beforeEach(async () => {
  await db.recursiveDelete(db.collection('studio_images'));
  await bucket.deleteFiles({ force: true }).catch(() => {});
});

afterAll(async () => {
  await db.terminate();
});

describe('a new version', () => {
  test('bigger than a screen: stored with a WebP copy no larger than 2048 px on its long side', async () => {
    // The M2 trial's maps are 5504 × 3072 at 4K.
    const record = await add(await png(5504, 3072));
    const version = record.versions[0];
    expect(version.screen).toEqual({
      path: `studio/${record.id}/v1-screen.webp`,
      width: 2048,
      height: 1143,
      format: 'webp',
      bytes: expect.any(Number),
    });
    const meta = await sharp(await download(version.screen.path)).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 2048, height: 1143 });
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(SCREEN_MAX);
    // Its screen link serves the copy, under the image's token.
    const screen = await served(screenLinkOf(record.link));
    expect(screen).toMatchObject({ name: `studio/${record.id}/screen`, tokenOk: true });
    expect(screen.contentType).toBe('image/webp');
    expect(screen.bytes.equals(await download(version.screen.path))).toBe(true);
    // A tall one, too, by its long side.
    const tall = await add(await png(1200, 4096), 'A tall map');
    expect(tall.versions[0].screen).toMatchObject({ width: 600, height: 2048 });
  });

  test('a screen or smaller, or SVG: no copy, and the screen link serves the image itself', async () => {
    const small = await add(await png(2048, 1024));
    expect(small.versions[0].screen).toBeNull();
    expect((await served(screenLinkOf(small.link))).bytes.equals(await png(2048, 1024))).toBe(true);
    const svg = await add(Buffer.from(SVG));
    expect(svg.versions[0].screen).toBeNull();
    expect((await served(screenLinkOf(svg.link))).bytes.toString()).toContain('<svg');
  });

  test('a file sharp cannot read is still stored, without a copy', async () => {
    // Only a PNG header: the format check takes it, sharp can't decode it.
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0);
    ihdr.write('IHDR', 4, 'ascii');
    ihdr.writeUInt32BE(4000, 8);
    ihdr.writeUInt32BE(3000, 12);
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ihdr,
    ]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const record = await add(fake);
    expect(record.versions[0].screen).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('the screen link follows the current version, and deleting removes every copy', async () => {
    const record = await add(await png(4000, 2000, '#aa3333'));
    const edited = await library.addVersion(record.id, {
      file: readImage(await png(3000, 3000, '#33aa33')),
      createdBy: 'builder-001',
      via: 'mcp',
      instruction: 'make it square',
    });
    expect(edited.versions.map((v) => v.screen && [v.screen.width, v.screen.height])).toEqual([
      [2048, 1024],
      [2048, 2048],
    ]);
    const link = screenLinkOf(record.link);
    expect((await sharp((await served(link)).bytes).metadata()).height).toBe(2048);
    await library.setCurrent(record.id, 1);
    expect((await sharp((await served(link)).bytes).metadata()).height).toBe(1024);

    await library.deleteImage(record.id);
    for (const name of ['v1-screen.webp', 'v2-screen.webp', 'screen', 'current', 'v1.png']) {
      expect(await exists(`studio/${record.id}/${name}`)).toBe(false);
    }
  });

  test('players are given the screen link beside the full image; the studio its thumbnails', async () => {
    const record = await add(await png(3000, 2000));
    const ref = { imageId: record.id, link: record.link, width: 3000, height: 2000 };
    expect(art.forPlayer(art.fromRef(ref))).toEqual({
      url: record.link,
      screenUrl: record.link.replace('%2Fcurrent?', '%2Fscreen?'),
      width: 3000,
      height: 2000,
    });
    // Older art on a Storage path has no copy.
    expect(art.forPlayer({ path: 'worlds/w/map.png', width: 10, height: 10 })).toEqual({
      path: 'worlds/w/map.png',
      width: 10,
      height: 10,
    });
    expect(summary(record.id, record).screenLink).toBe(screenLinkOf(record.link));
    expect(screenLinkOf('https://example.com/elsewhere.png')).toBeNull();
  });
});

describe('the backfill', () => {
  // An image as L-727 found it: its versions without copies, no screen file.
  async function fromBefore(bytes, title) {
    const record = await add(bytes, title);
    const versions = record.versions.map((v) => {
      const old = { ...v };
      delete old.screen;
      return old;
    });
    await db.collection('studio_images').doc(record.id).update({ versions });
    for (const v of record.versions) {
      if (v.screen) await bucket.file(v.screen.path).delete();
    }
    await bucket.file(`studio/${record.id}/screen`).delete();
    return { ...record, versions };
  }

  test('a dry run lists what it would make; apply makes it; a second run finds nothing', async () => {
    const big = await fromBefore(await png(5504, 3072), 'Nisia');
    const small = await fromBefore(await png(800, 600), 'A tavern');
    expect(planScreenBackfill(big)).toEqual({ copies: [1] });
    expect(planScreenBackfill(small)).toEqual({ copies: [] });

    const dry = await applyScreenBackfill({ db, bucket, apply: false });
    const byId = Object.fromEntries(dry.images.map((i) => [i.id, i]));
    expect(byId[big.id]).toEqual({
      id: big.id,
      title: 'Nisia',
      copies: [{ n: 1, from: '5504 × 3072', to: '2048 × 1143' }],
      link: true,
    });
    expect(byId[small.id]).toEqual({ id: small.id, title: 'A tavern', copies: [], link: true });
    // Nothing written.
    expect(await exists(`studio/${big.id}/v1-screen.webp`)).toBe(false);
    expect(await exists(`studio/${big.id}/screen`)).toBe(false);
    const before = (await db.collection('studio_images').doc(big.id).get()).data();
    expect(before.versions[0].screen).toBeUndefined();

    const done = await applyScreenBackfill({ db, bucket, apply: true });
    expect(done.images).toHaveLength(2);
    expect(done.missing).toEqual([]);
    const after = (await db.collection('studio_images').doc(big.id).get()).data();
    expect(after.versions[0].screen).toMatchObject({ width: 2048, height: 1143, format: 'webp' });
    const screen = await served(screenLinkOf(big.link));
    expect(screen.tokenOk).toBe(true);
    expect((await sharp(screen.bytes).metadata()).width).toBe(2048);
    // The small one's screen link serves the image itself.
    expect((await served(screenLinkOf(small.link))).bytes.equals(await png(800, 600))).toBe(true);

    expect(await applyScreenBackfill({ db, bucket, apply: true })).toEqual({
      images: [],
      missing: [],
    });
  });

  test('one image by its id', async () => {
    const one = await fromBefore(await png(3000, 1000), 'One');
    const other = await fromBefore(await png(3000, 1000), 'Other');
    const done = await applyScreenBackfill({ db, bucket, apply: true, imageId: one.id });
    expect(done.images.map((i) => i.id)).toEqual([one.id]);
    expect(await exists(`studio/${other.id}/v1-screen.webp`)).toBe(false);
  });
});
