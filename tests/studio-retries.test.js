'use strict';

/**
 * Studio jobs when the model is busy, and art fitted to its target
 * (planning/builders-tools.md §4.6; L-396 / #742), against the Firestore and
 * Storage emulators with the image model faked:
 *
 *   - a job given two 429s, then an image, finishes done, its cost recorded
 *     once, waiting longer before each try;
 *   - one given six fails after five tries, saying why, charged nothing;
 *   - other errors fail at once, as before;
 *   - a 4:3 image assigned to a 26 × 20 grid with crop, and another with pad,
 *     gets a version at 26:20, the original kept; one used elsewhere is
 *     copied instead; stretch leaves it as it is.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest studio-retries --verbose"
 */

const PROJECT = 'demo-studio-retries';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;

const functionsTest = require('firebase-functions-test')(
  { projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` },
  null
);
require('../functions/index');
const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { PNG } = require(require.resolve('pngjs', { paths: [functionsDir] }));
const { getFirestore, FieldValue } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { getStorage } = require(
  require.resolve('firebase-admin/storage', { paths: [functionsDir] })
);

const loomCanon = require('../functions/loom-canon');
const town = require('../functions/loom-canon/town');
const { createLibrary } = require('../functions/studio/library');
const { createCosts } = require('../functions/studio/costs');
const { createJobs, MAX_TRIES, BACKOFF, isBusy } = require('../functions/studio/jobs');
const { createAssigner } = require('../functions/studio/assign');
const { readImage } = require('../functions/studio/formats');
const { rasterize } = require('../functions/studio');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');

const db = getFirestore();
const bucket = getStorage().bucket(`${PROJECT}.appspot.com`);
const BUILDER = 'builder-001';

function png(width, height, shade = 120) {
  const img = new PNG({ width, height });
  img.data.fill(shade);
  return PNG.sync.write(img);
}
const drawn = () => ({
  image: { bytes: png(64, 48), mimeType: 'image/png' },
  usage: { input: 500, output: 1120 },
  text: 'Here it is.',
  finishReason: 'STOP',
});
// What @google/genai throws when Vertex is out of quota.
const busy = () =>
  Object.assign(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'), {
    status: 429,
  });

// The faked model: each call takes the next answer in `answers`.
const model = {
  answers: [],
  calls: 0,
  async generate() {
    this.calls += 1;
    const next = this.answers.shift() || drawn;
    return next();
  },
};
// The queue: runs a job soon, noting any wait asked for.
const waits = [];
const dispatched = [];
const enqueue = async ({ jobId }, options = {}) => {
  if (options.scheduleDelaySeconds) waits.push(options.scheduleDelaySeconds);
  dispatched.push(new Promise((resolve) => setImmediate(resolve)).then(() => jobs.run(jobId)));
};
const drain = async () => {
  while (dispatched.length) await dispatched.shift();
};

const library = createLibrary({ db, bucket });
const costs = createCosts({ db, FieldValue });
const jobs = createJobs({
  db,
  library,
  costs,
  model,
  enqueue,
  loadWorld: (worldId) => loomCanon.loadWorld(worldId, { db, playableOnly: false }),
  placesOf: town.placesOf,
  rasterize,
  load: async (at) => (await bucket.file(at).download())[0],
});
const writer = createFirestoreWorldWriter(() => db);
const assigner = createAssigner({ db, bucket, writer, library });

const jobDoc = async (id) => (await db.collection('studio_jobs').doc(id).get()).data();
const charged = async (jobId) =>
  (await db.collection('studio_costs').where('jobId', '==', jobId).get()).docs.length;

beforeAll(async () => {
  for (const c of ['loom_worlds', 'studio_images', 'studio_jobs', 'studio_costs']) {
    await db.recursiveDelete(db.collection(c));
  }
  await db.recursiveDelete(db.collection('studio_costs_month'));
  await bucket.deleteFiles({ force: true }).catch(() => {});
}, 60000);
afterAll(() => functionsTest.cleanup());
beforeEach(() => {
  model.answers = [];
  model.calls = 0;
  waits.length = 0;
});

describe('when the model is busy', () => {
  test('a 429 is the model busy; other errors aren’t', () => {
    expect(isBusy(busy())).toBe(true);
    expect(isBusy(new Error('got status: 429 Too Many Requests'))).toBe(true);
    expect(isBusy(new Error('400 INVALID_ARGUMENT'))).toBe(false);
    expect(MAX_TRIES).toBe(5);
    // About ten minutes, waiting longer each time.
    expect(BACKOFF.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(540);
  });

  test('two 429s, then an image: done, charged once, after waiting longer each try', async () => {
    model.answers = [
      () => {
        throw busy();
      },
      () => {
        throw busy();
      },
      drawn,
    ];
    const { id: jobId } = await jobs.start(BUILDER, { prompt: 'A gate', kind: 'cover', tier: 'draft' });
    // Queued again with its try count, between tries.
    await dispatched.shift();
    expect(await jobDoc(jobId)).toMatchObject({ state: 'queued', tries: 2 });
    await drain();
    const job = await jobDoc(jobId);
    expect(job).toMatchObject({ state: 'done', tries: 3 });
    expect(job.imageId).toEqual(expect.any(String));
    expect(model.calls).toBe(3);
    expect(waits).toEqual([BACKOFF[0], BACKOFF[1]]);
    expect(await charged(jobId)).toBe(1);
  });

  test('six 429s: it fails after five tries, saying why, charged nothing', async () => {
    model.answers = Array.from({ length: 6 }, () => () => {
      throw busy();
    });
    const { id: jobId } = await jobs.start(BUILDER, { prompt: 'A gate', kind: 'cover', tier: 'draft' });
    await drain();
    const job = await jobDoc(jobId);
    expect(job.state).toBe('failed');
    expect(job.error).toMatch(/^The model stayed busy through 5 tries over about ten minutes:/);
    expect(model.calls).toBe(5);
    expect(waits).toEqual(BACKOFF.slice(0, 4));
    expect(await charged(jobId)).toBe(0);
  });

  test('another error fails at once, as before', async () => {
    model.answers = [
      () => {
        throw new Error('400 INVALID_ARGUMENT: bad prompt');
      },
    ];
    const { id: jobId } = await jobs.start(BUILDER, { prompt: 'A gate', kind: 'cover', tier: 'draft' });
    await drain();
    expect(await jobDoc(jobId)).toMatchObject({
      state: 'failed',
      error: '400 INVALID_ARGUMENT: bad prompt',
    });
    expect(model.calls).toBe(1);
    expect(waits).toEqual([]);
  });
});

describe('fit: art to its grid’s shape', () => {
  let worldId;
  const grid = (id) => ({
    id,
    name: id,
    width: 26,
    height: 20,
    entries: [{ id: 'in', x: 0, y: 0 }],
    exits: [],
    features: [],
  });
  const art = (title) =>
    library.addImage({
      title,
      kind: 'battleMap',
      createdBy: BUILDER,
      via: 'page',
      file: readImage(png(400, 300)),
    });
  const ratio = (v) => v.width / v.height;

  beforeAll(async () => {
    ({ worldId } = await writer.create(BUILDER, {
      name: 'Fit test',
      map: { width: 100, height: 100, backdrop: '#223322' },
    }));
    const ref = db.collection('loom_worlds').doc(worldId);
    for (const id of ['bm_a', 'bm_b', 'bm_c', 'bm_d']) {
      await ref.collection('battleMaps').doc(id).set(grid(id));
    }
    await ref.update({ canonVersion: FieldValue.increment(1) });
  });

  test.each(['crop', 'pad'])(
    '%s: a version at 26:20, made current, the original kept',
    async (fit) => {
      const image = await art(`Yard (${fit})`);
      const id = fit === 'crop' ? 'bm_a' : 'bm_b';
      const result = await assigner.assign(BUILDER, {
        worldId,
        target: 'battleMap',
        id,
        imageId: image.id,
        fit,
      });
      expect(result.fitted).toMatch(
        new RegExp(`^Version 2, ${fit === 'crop' ? 'cropped' : 'padded'} to 26:20`)
      );
      expect(result.warnings).toEqual([]);
      const record = await library.getImage(image.id);
      expect(record.current).toBe(2);
      expect(record.versions.map((v) => [v.n, v.width, v.height])).toEqual([
        [1, 400, 300],
        fit === 'crop' ? [2, 390, 300] : [2, 400, 308],
      ]);
      expect(Math.abs(ratio(record.versions[1]) - 26 / 20) / (26 / 20)).toBeLessThan(0.02);
      // The map holds the fitted version's size.
      const map = (await db.doc(`loom_worlds/${worldId}/battleMaps/${id}`).get()).data();
      expect(map.image).toMatchObject({ imageId: image.id, width: record.versions[1].width });
    }
  );

  test('an image used elsewhere is copied, so its other use keeps its shape', async () => {
    const image = await art('Shared yard');
    await assigner.assign(BUILDER, { worldId, target: 'battleMap', id: 'bm_c', imageId: image.id });
    const result = await assigner.assign(BUILDER, {
      worldId,
      target: 'battleMap',
      id: 'bm_d',
      imageId: image.id,
      fit: 'crop',
    });
    expect(result.fitted).toMatch(/^A copy cropped to 26:20/);
    expect(result.image.imageId).not.toBe(image.id);
    expect((await library.getImage(image.id)).versions).toHaveLength(1);
    const copy = await library.getImage(result.image.imageId);
    expect(copy).toMatchObject({ title: 'Shared yard (cropped to 26:20)', kind: 'battleMap' });
  });

  test('stretch leaves it as it is, unwarned; a bad fit is refused', async () => {
    const image = await art('Stretched yard');
    const result = await assigner.assign(BUILDER, {
      worldId,
      target: 'battleMap',
      id: 'bm_a',
      imageId: image.id,
      fit: 'stretch',
    });
    expect(result.warnings).toEqual([]);
    expect((await library.getImage(image.id)).versions).toHaveLength(1);
    await expect(
      assigner.assign(BUILDER, {
        worldId,
        target: 'battleMap',
        id: 'bm_a',
        imageId: image.id,
        fit: 'squash',
      })
    ).rejects.toThrow(/fit must be one of: crop, pad, stretch/);
  });
});
