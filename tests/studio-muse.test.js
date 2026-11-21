'use strict';

/**
 * The image studio opens for the `muse` claim as well as `cartographer`
 * (planning/the-muse.md IM1; M-104 / #892): a Muse writer uploads to the
 * library, sees the month's spending and starts a generation; anyone with
 * neither claim, and the signed-out, are refused by every callable. Runs
 * against the Firestore and Storage emulators.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest studio-muse --verbose"
 */

const PROJECT = 'demo-studio-muse';
const BUCKET = `${PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;

jest.mock('../functions/gemini', () => ({ callGemini: jest.fn() }));

require('firebase-functions-test')({ projectId: PROJECT, storageBucket: BUCKET }, null);
const { studioUpload, studioCosts, studioGenerate } = require('../functions/index');
const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { getStorage } = require(
  require.resolve('firebase-admin/storage', { paths: [functionsDir] })
);

const db = getFirestore();
const bucket = getStorage().bucket(BUCKET);

const WRITER = { uid: 'writer-001', token: { apps: ['muse'] } };
const BUILDER = { uid: 'builder-001', token: { apps: ['cartographer'] } };
const BOTH = { uid: 'both-001', token: { apps: ['muse', 'cartographer'] } };
const REFUSED = [
  ['a player', { uid: 'player-001', token: { apps: ['loom'] } }],
  ['someone with other apps', { uid: 'other-001', token: { apps: ['symposium'] } }],
  ['someone with no apps', { uid: 'none-001', token: {} }],
];

// The smallest PNG the studio takes: its header with a size.
function png(width, height) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
}

let seq = 0;
async function putUpload(uid, bytes = png(640, 480)) {
  seq += 1;
  const uploadId = `upload-${String(seq).padStart(4, '0')}`;
  await bucket
    .file(`cartographer/${uid}/${uploadId}/studio.png`)
    .save(bytes, { contentType: 'image/png', resumable: false });
  return uploadId;
}

beforeEach(async () => {
  await db.recursiveDelete(db.collection('studio_images'));
  await bucket.deleteFiles({ force: true }).catch(() => {});
});

afterAll(async () => {
  await db.terminate();
});

describe('a Muse writer, with the muse claim alone', () => {
  test('uploads an image into the library, as its maker', async () => {
    const uploadId = await putUpload(WRITER.uid);
    const { image } = await studioUpload.run({
      data: { uploadId, title: 'King Peter', kind: 'portrait', labels: ['The Court'] },
      auth: WRITER,
    });
    expect(image).toMatchObject({
      id: expect.stringMatching(/^img_[0-9a-f]{16}$/),
      title: 'King Peter',
      kind: 'portrait',
      labels: ['the court'],
      via: 'upload',
      createdBy: WRITER.uid,
    });
    const stored = (await db.collection('studio_images').doc(image.id).get()).data();
    expect(stored).toMatchObject({ title: 'King Peter', createdBy: WRITER.uid });
    // The upload folder is cleared once the image is in the library.
    const [left] = await bucket.getFiles({ prefix: `cartographer/${WRITER.uid}/${uploadId}/` });
    expect(left).toHaveLength(0);
  });

  test('an upload is read from the caller’s own folder only', async () => {
    const theirs = await putUpload(BUILDER.uid);
    await expect(
      studioUpload.run({
        data: { uploadId: theirs, title: 'Not mine', kind: 'other' },
        auth: WRITER,
      })
    ).rejects.toMatchObject({ code: 'not-found' });
    expect((await db.collection('studio_images').get()).size).toBe(0);
  });

  test('sees the month’s spending', async () => {
    const res = await studioCosts.run({ data: {}, auth: WRITER });
    expect(res).toHaveProperty('who');
    expect(res).toHaveProperty('names');
  });

  test('may start a generation: it is checked, not refused for the claim', async () => {
    await expect(studioGenerate.run({ data: {}, auth: WRITER })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});

describe('the studio’s other users are unchanged', () => {
  test('an editor and someone with both claims upload as before', async () => {
    for (const auth of [BUILDER, BOTH]) {
      const uploadId = await putUpload(auth.uid);
      const { image } = await studioUpload.run({
        data: { uploadId, title: `By ${auth.uid}`, kind: 'other' },
        auth,
      });
      expect(image.createdBy).toBe(auth.uid);
    }
  });
});

describe('with neither claim', () => {
  test.each(REFUSED)('%s is refused by every callable', async (_who, auth) => {
    const uploadId = await putUpload(auth.uid);
    for (const call of [
      () => studioUpload.run({ data: { uploadId, title: 'x', kind: 'other' }, auth }),
      () => studioCosts.run({ data: {}, auth }),
      () => studioGenerate.run({ data: { prompt: 'x' }, auth }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
    }
    expect((await db.collection('studio_images').get()).size).toBe(0);
  });

  test('the signed-out are refused', async () => {
    for (const call of [
      () => studioUpload.run({ data: {}, auth: null }),
      () => studioCosts.run({ data: {}, auth: null }),
      () => studioGenerate.run({ data: {}, auth: null }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'unauthenticated' });
    }
  });
});
