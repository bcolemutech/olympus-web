'use strict';

/**
 * The image studio's library (planning/the-image-studio.md §4.2, §4.6; L-701 /
 * #537): uploads in each format, search, labels, versions and the link that
 * follows the current one, and deleting. Runs against the Firestore and
 * Storage emulators, through the studioUpload callable and the library.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest studio-library --verbose"
 */

const PROJECT = 'demo-studio-library';
const BUCKET = `${PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;

jest.mock('../functions/gemini', () => ({ callGemini: jest.fn() }));

require('firebase-functions-test')({ projectId: PROJECT, storageBucket: BUCKET }, null);
const { studioUpload } = require('../functions/index');
const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { getStorage } = require(
  require.resolve('firebase-admin/storage', { paths: [functionsDir] })
);
const { createLibrary, KINDS, LINK_CACHE } = require('../functions/studio/library');
const { readImage } = require('../functions/studio/formats');

const db = getFirestore();
const bucket = getStorage().bucket(BUCKET);
const library = createLibrary({ db, bucket });

const BUILDER = { uid: 'builder-001', token: { apps: ['cartographer'] } };
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };
const uploadAs = (auth, data) => studioUpload.run({ data, auth });

// The smallest files each format's header check takes.
function png(width, height, fill = 0) {
  const ihdr = Buffer.alloc(25, fill);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
}
function jpeg(width, height) {
  // SOI, an APP0 segment to skip, then SOF0 with the size.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}
function webp(width, height) {
  const out = Buffer.alloc(30);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(22, 4);
  out.write('WEBP', 8, 'ascii');
  out.write('VP8X', 12, 'ascii');
  out.writeUInt32LE(10, 16);
  out.writeUIntLE(width - 1, 24, 3);
  out.writeUIntLE(height - 1, 27, 3);
  return out;
}
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect width="640" height="480" fill="#336"/></svg>';

let seq = 0;
async function upload(file, bytes, { contentType = 'application/octet-stream' } = {}) {
  seq += 1;
  const uploadId = `upload-${String(seq).padStart(4, '0')}`;
  await bucket
    .file(`cartographer/${BUILDER.uid}/${uploadId}/${file}`)
    .save(bytes, { contentType, resumable: false });
  return uploadId;
}
const exists = async (name) => (await bucket.file(name).exists())[0];
// What the link serves: the file it names, and whether its token is that
// file's download token. (Fetching it over HTTP depends on the emulator's
// project and rules, so the test reads the file and its token directly.)
const served = async (link) => {
  const url = new URL(link);
  const name = decodeURIComponent(url.pathname.replace(/^\/v0\/b\/[^/]+\/o\//, ''));
  const file = bucket.file(name);
  const [meta] = await file.getMetadata();
  const [bytes] = await file.download();
  const tokens = String((meta.metadata || {}).firebaseStorageDownloadTokens || '').split(',');
  return { tokenOk: tokens.includes(url.searchParams.get('token')), bytes };
};

beforeEach(async () => {
  await db.recursiveDelete(db.collection('studio_images'));
  await bucket.deleteFiles({ force: true }).catch(() => {});
});

afterAll(async () => {
  await db.terminate();
});

describe('studioUpload', () => {
  test('each format: PNG, JPEG, WebP and SVG, read by their bytes and sized', async () => {
    const cases = [
      ['studio.png', png(1600, 1200), 'png', 1600, 1200],
      ['studio.jpg', jpeg(800, 600), 'jpeg', 800, 600],
      ['studio.webp', webp(512, 256), 'webp', 512, 256],
      ['studio.svg', Buffer.from(SVG), 'svg', 640, 480],
    ];
    for (const [file, bytes, format, width, height] of cases) {
      const uploadId = await upload(file, bytes);
      const { image } = await uploadAs(BUILDER, {
        uploadId,
        title: `A ${format}`,
        kind: 'worldMap',
        labels: ['Coast', ' coast ', 'Night  Sky'],
      });
      expect(image).toMatchObject({
        id: expect.stringMatching(/^img_[0-9a-f]{16}$/),
        title: `A ${format}`,
        kind: 'worldMap',
        // Lower-case, one space, no repeats.
        labels: ['coast', 'night sky'],
        current: 1,
        versions: 1,
        width,
        height,
        format,
        usedIn: 0,
        createdBy: BUILDER.uid,
        via: 'upload',
      });
      const record = (await db.collection('studio_images').doc(image.id).get()).data();
      const ext = { png: 'png', jpeg: 'jpg', webp: 'webp', svg: 'svg' }[format];
      expect(record.versions[0]).toMatchObject({ n: 1, path: `studio/${image.id}/v1.${ext}` });
      expect(record.source).toEqual({ upload: file });
      expect(await exists(`studio/${image.id}/v1.${ext}`)).toBe(true);
      // The upload is gone once it's in the library.
      expect(await exists(`cartographer/${BUILDER.uid}/${uploadId}/${file}`)).toBe(false);
    }
  });

  test('refuses a file too big, a bad SVG, something that is not an image, and a bad kind', async () => {
    const tooBig = await upload(
      'studio.png',
      Buffer.concat([png(10, 10), Buffer.alloc(30 * 1024 * 1024)])
    );
    await expect(
      uploadAs(BUILDER, { uploadId: tooBig, title: 'Huge', kind: 'other' })
    ).rejects.toMatchObject({ code: 'invalid-argument', message: /larger than 30 MB/ });

    const scripted = await upload(
      'studio.svg',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    );
    await expect(
      uploadAs(BUILDER, { uploadId: scripted, title: 'Bad', kind: 'other' })
    ).rejects.toMatchObject({ code: 'invalid-argument', message: /script/ });

    const text = await upload('studio.png', Buffer.from('not an image at all'));
    await expect(
      uploadAs(BUILDER, { uploadId: text, title: 'Text', kind: 'other' })
    ).rejects.toMatchObject({ code: 'invalid-argument', message: /not a PNG, JPEG, WebP or SVG/ });

    const fine = await upload('studio.png', png(10, 10));
    await expect(
      uploadAs(BUILDER, { uploadId: fine, title: 'Odd', kind: 'poster' })
    ).rejects.toMatchObject({ code: 'invalid-argument', message: /kind must be one of/ });
    await expect(
      uploadAs(BUILDER, { uploadId: fine, title: '', kind: 'other' })
    ).rejects.toMatchObject({ code: 'invalid-argument', message: /title/ });
    await expect(
      uploadAs(BUILDER, { uploadId: fine, title: 'Labels', kind: 'other', labels: ['a<b>'] })
    ).rejects.toMatchObject({ code: 'invalid-argument', message: /isn't a label/ });
    // Nothing was added, and the good upload is still there to try again.
    expect((await db.collection('studio_images').get()).size).toBe(0);
    expect(await exists(`cartographer/${BUILDER.uid}/${fine}/studio.png`)).toBe(true);
    await expect(
      uploadAs(BUILDER, { uploadId: 'upload-none', title: 'None', kind: 'other' })
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  test('needs the cartographer claim', async () => {
    const uploadId = await upload('studio.png', png(10, 10));
    await expect(uploadAs(PLAYER, { uploadId, title: 'X', kind: 'other' })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(
      uploadAs(undefined, { uploadId, title: 'X', kind: 'other' })
    ).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  test('the kinds are the fixed list', () => {
    expect(KINDS).toEqual([
      'worldMap',
      'regionMap',
      'town',
      'battleMap',
      'cover',
      'portrait',
      'token',
      'item',
      'scene',
      'interface',
      'other',
    ]);
  });
});

describe('the link', () => {
  test('serves the current version, and keeps serving when another is made current', async () => {
    const first = png(100, 100, 1);
    const second = png(200, 100, 2);
    const record = await library.addImage({
      title: 'Harbour at dusk',
      kind: 'town',
      labels: ['harbour'],
      file: readImage(first),
      createdBy: BUILDER.uid,
      via: 'page',
    });
    expect(record.link).toMatch(
      new RegExp(
        `/v0/b/${BUCKET}/o/studio%2F${record.id}%2Fcurrent\\?alt=media&token=[0-9a-f-]{36}$`
      )
    );
    expect(await served(record.link)).toEqual({ tokenOk: true, bytes: first });
    const [meta] = await bucket.file(`studio/${record.id}/current`).getMetadata();
    expect(meta.cacheControl).toBe(LINK_CACHE);

    // A new version becomes current: the same link now serves it.
    const edited = await library.addVersion(record.id, {
      file: readImage(second),
      createdBy: BUILDER.uid,
      via: 'mcp',
      instruction: 'make it wider',
    });
    expect(edited).toMatchObject({ current: 2, link: record.link });
    expect(edited.versions.map((v) => [v.n, v.width, v.instruction])).toEqual([
      [1, 100, null],
      [2, 200, 'make it wider'],
    ]);
    expect(await served(record.link)).toEqual({ tokenOk: true, bytes: second });

    // Back to the first: still the same link.
    expect(await library.setCurrent(record.id, 1)).toMatchObject({ current: 1 });
    expect(await served(record.link)).toEqual({ tokenOk: true, bytes: first });
    // Every version's file is kept, unchanged.
    expect(await exists(`studio/${record.id}/v1.png`)).toBe(true);
    expect(await exists(`studio/${record.id}/v2.png`)).toBe(true);
    // A version that doesn't exist.
    await expect(library.setCurrent(record.id, 9)).rejects.toMatchObject({ code: 'not-found' });

    // Without the token, only editors may read it: storage.rules, in storage-rules.test.js
    // (this emulator project runs with open rules).
  });
});

describe('search and labels', () => {
  let ids;
  beforeEach(async () => {
    const add = (fields, at) =>
      createLibrary({ db, bucket, now: () => at }).addImage({
        file: readImage(png(10, 10)),
        createdBy: BUILDER.uid,
        via: 'page',
        ...fields,
      });
    const a = await add(
      {
        title: 'Nisia, the whole coast',
        kind: 'worldMap',
        labels: ['nisia', 'coast'],
        prompt: 'An old sea chart',
      },
      1000
    );
    const b = await add(
      { title: 'Hatham harbour', kind: 'town', labels: ['nisia', 'harbour'], styleId: 'sty_ink' },
      2000
    );
    const c = await add(
      {
        title: 'The Lantern & Oar',
        kind: 'battleMap',
        labels: ['tavern'],
        createdBy: 'builder-002',
      },
      3000
    );
    // A world uses the harbour (L-704 keeps this up to date).
    await db
      .collection('studio_images')
      .doc(b.id)
      .update({ usedIn: [{ worldId: 'nisia-625ffc', target: 'town', id: 'loc_450' }] });
    ids = { a: a.id, b: b.id, c: c.id };
  });
  const found = async (query) => (await library.search(query)).images.map((i) => i.id);

  test('newest first, by each filter, and by words in the title, prompt and labels', async () => {
    expect(await found({})).toEqual([ids.c, ids.b, ids.a]);
    expect(await found({ kind: 'town' })).toEqual([ids.b]);
    expect(await found({ labels: ['NISIA'] })).toEqual([ids.b, ids.a]);
    expect(await found({ labels: ['nisia', 'coast'] })).toEqual([ids.a]);
    expect(await found({ worldId: 'nisia-625ffc' })).toEqual([ids.b]);
    expect(await found({ styleId: 'sty_ink' })).toEqual([ids.b]);
    expect(await found({ createdBy: 'builder-002' })).toEqual([ids.c]);
    expect(await found({ after: 1500, before: 3000 })).toEqual([ids.b]);
    // Words: every one must appear, in the title, the prompt or the labels.
    expect(await found({ words: 'sea chart' })).toEqual([ids.a]);
    expect(await found({ words: 'HARBOUR' })).toEqual([ids.b]);
    expect(await found({ words: 'tavern lantern' })).toEqual([ids.c]);
    expect(await found({ words: 'harbour tavern' })).toEqual([]);
    // Filters and words together.
    expect(await found({ labels: ['nisia'], words: 'coast' })).toEqual([ids.a]);
    // Paged.
    expect(await library.search({ limit: 2 })).toMatchObject({
      total: 3,
      count: 2,
      nextOffset: 2,
    });
    const row = (await library.search({ kind: 'town' })).images[0];
    expect(row).toMatchObject({ usedIn: 1, styleId: 'sty_ink', link: expect.any(String) });
    expect(row).not.toHaveProperty('linkToken');
    await expect(library.search({ kind: 'poster' })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  test('the labels in use, with counts, most used first', async () => {
    expect(await library.labels()).toEqual([
      { label: 'nisia', count: 2 },
      { label: 'coast', count: 1 },
      { label: 'harbour', count: 1 },
      { label: 'tavern', count: 1 },
    ]);
  });

  test('deletes an unused image for good, and refuses one in use', async () => {
    expect(await library.deleteImage(ids.a)).toEqual({
      id: ids.a,
      title: 'Nisia, the whole coast',
    });
    expect((await db.collection('studio_images').doc(ids.a).get()).exists).toBe(false);
    expect(await exists(`studio/${ids.a}/v1.png`)).toBe(false);
    expect(await exists(`studio/${ids.a}/current`)).toBe(false);

    await expect(library.deleteImage(ids.b)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: '"Hatham harbour" is in use: nisia-625ffc (town loc_450). Unassign it first.',
    });
    expect((await db.collection('studio_images').doc(ids.b).get()).exists).toBe(true);
    await expect(library.deleteImage('img_nothing')).rejects.toMatchObject({ code: 'not-found' });
  });
});
