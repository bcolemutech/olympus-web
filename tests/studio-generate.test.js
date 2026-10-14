'use strict';

/**
 * Generation (planning/the-image-studio.md §4.3; L-707 / #543), with the
 * image model stubbed, against the Firestore and Storage emulators: a job
 * from queued to done with its image and cost; failures, charged and not;
 * references and `from` data reaching the request; several jobs at once; a
 * job never run twice; and, through a real MCP client, studio_generate then
 * studio_jobs returning the image and the cost line.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest studio-generate --verbose"
 */

const PROJECT = 'demo-studio-generate';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-studio-generate';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

require('firebase-functions-test')(
  { projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` },
  null
);
const { studioGenerate } = require('../functions/index');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const functionsDir = path.resolve(__dirname, '../functions');
const { PNG } = require(require.resolve('pngjs', { paths: [functionsDir] }));
const { getFirestore, FieldValue } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { getStorage } = require(
  require.resolve('firebase-admin/storage', { paths: [functionsDir] })
);

const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { loadDraftWorld } = require('../functions/cartographer/load');
const loomCanon = require('../functions/loom-canon');
const town = require('../functions/loom-canon/town');
const { createLibrary } = require('../functions/studio/library');
const { createCosts } = require('../functions/studio/costs');
const { createJobs, nearestRatio } = require('../functions/studio/jobs');
const { createStudioService } = require('../functions/studio/service');
const { createImageModel, usageOf } = require('../functions/studio/image-model');
const { readImage } = require('../functions/studio/formats');
const { rasterize } = require('../functions/studio');
const { createCartographerService } = require('../functions/cartographer/service');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');
const { layOutTowns } = require('./helpers/towns');

const db = getFirestore();
const bucket = getStorage().bucket(`${PROJECT}.appspot.com`);
const WORLD = 'nisia-g0g0g0';
const BUILDER = 'builder-001';
const CANONICAL = 'https://bcoletech.com';

function png(width, height, shade = 120) {
  const img = new PNG({ width, height });
  img.data.fill(shade);
  return PNG.sync.write(img);
}
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60"><rect width="80" height="60" fill="#363"/></svg>'
);

// An image made: what the stubbed model gives back by default.
const drawn = () => ({
  image: { bytes: png(64, 48), mimeType: 'image/png' },
  usage: { input: 500, output: 1120 },
  text: 'Here is your map.',
  finishReason: 'STOP',
});

// The stubbed model: records each request, and answers with `respond`.
const model = {
  calls: [],
  running: 0,
  most: 0,
  delay: 0,
  respond: () => drawn(),
  async generate(request) {
    this.calls.push(request);
    this.running += 1;
    this.most = Math.max(this.most, this.running);
    try {
      if (this.delay) await new Promise((resolve) => setTimeout(resolve, this.delay));
      return await this.respond(request);
    } finally {
      this.running -= 1;
    }
  },
};

// The queue: runs each job soon, side by side, as Cloud Tasks would.
const dispatched = [];
const enqueue = async ({ jobId }) => {
  dispatched.push(new Promise((resolve) => setImmediate(resolve)).then(() => jobs.run(jobId)));
};
const drain = async () => {
  while (dispatched.length) await dispatched.shift();
};

const library = createLibrary({ db, bucket });
const costs = createCosts({ db, FieldValue });
const load = async (at) => (await bucket.file(at).download())[0];
const jobs = createJobs({
  db,
  library,
  costs,
  model,
  enqueue,
  loadWorld: (worldId) => {
    loomCanon.clearWorldCache();
    return loomCanon.loadWorld(worldId, { db, playableOnly: false });
  },
  placesOf: town.placesOf,
  rasterize,
  load,
});

const jobDoc = async (id) => (await db.collection('studio_jobs').doc(id).get()).data();
const costEntries = async () =>
  (await db.collection('studio_costs').get()).docs.map((d) => d.data());
const add = (fields, bytes) =>
  library.addImage({ createdBy: BUILDER, via: 'page', file: readImage(bytes), ...fields });

const CELLAR = {
  id: 'bm_cellar',
  name: 'The cellar',
  width: 16,
  height: 9,
  entries: [{ id: 'in', x: 0, y: 0 }],
  exits: [{ id: 'out', name: 'the stairs', x: 0, y: 1, to: 'out' }],
  features: [{ id: 'casks', name: 'the wine casks', x: 3, y: 3 }],
  generic: null,
};

const refs = {};
beforeAll(async () => {
  for (const c of ['loom_worlds', 'studio_images', 'studio_jobs', 'studio_costs']) {
    await db.recursiveDelete(db.collection(c));
  }
  await db.recursiveDelete(db.collection('studio_costs_month'));
  await bucket.deleteFiles({ force: true }).catch(() => {});
  const parsed = parseAzgaarExport(
    fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
  );
  await loadDraftWorld({
    db,
    mapped: mapToCanon(parsed),
    source: parsed.source,
    uploadedBy: BUILDER,
    worldId: WORLD,
  });
  const worldRef = db.collection('loom_worlds').doc(WORLD);
  await worldRef
    .collection('locations')
    .doc('loc_1')
    .update({ description: 'A rain-soaked port of slate roofs.' });
  await layOutTowns(worldRef, 'loc_1');
  await worldRef.collection('battleMaps').doc(CELLAR.id).set(CELLAR);
  await worldRef.collection('characters').doc('chr_mara').set({
    id: 'chr_mara',
    name: 'Mara Quill',
    description: 'Harbourmaster, grey-eyed.',
    locationId: 'loc_1',
  });
  await worldRef.update({ canonVersion: (await worldRef.get()).data().canonVersion + 1 });
  refs.style = await add({ title: 'Ink style', kind: 'other' }, png(32, 32, 30));
  refs.drawn = await add({ title: 'A drawn plan', kind: 'other' }, SVG);
}, 60000);

afterEach(() => {
  model.delay = 0;
  model.respond = () => drawn();
});

describe('a job', () => {
  test('runs from queued to done, storing its image and its cost', async () => {
    const job = await jobs.start(BUILDER, {
      prompt: 'A coastline of grey cliffs, as an old map',
      kind: 'worldMap',
      labels: ['Nisia', 'trial'],
    });
    expect(job).toMatchObject({
      state: 'queued',
      request: { tier: 'draft', model: 'gemini-3.1-flash-image', size: '1K', kind: 'worldMap' },
    });
    expect((await jobDoc(job.id)).state).toBe('queued');
    await drain();

    const done = await jobDoc(job.id);
    expect(done).toMatchObject({ state: 'done', note: 'Here is your map.', error: null });
    // Charged by the tokens reported: 500 in at $0.50 and 1120 out at $60 a million.
    expect(done.cost).toBeCloseTo(0.00025 + 0.0672, 6);
    expect(done.finishedAt).toBeGreaterThanOrEqual(done.startedAt);

    const image = await library.getImage(done.imageId);
    expect(image).toMatchObject({
      title: 'A coastline of grey cliffs, as an old map',
      kind: 'worldMap',
      labels: ['nisia', 'trial'],
      prompt: 'A coastline of grey cliffs, as an old map',
      model: 'gemini-3.1-flash-image',
      tier: 'draft',
      via: 'mcp',
      source: { jobId: job.id },
    });
    expect(image.versions[0]).toMatchObject({ width: 64, height: 48, format: 'png' });
    expect(image.versions[0].cost).toBeCloseTo(done.cost, 6);

    const [entry] = (await costEntries()).filter((e) => e.jobId === job.id);
    expect(entry).toMatchObject({
      imageId: done.imageId,
      model: 'gemini-3.1-flash-image',
      tier: 'draft',
      kind: 'worldMap',
      failed: false,
      createdBy: BUILDER,
      via: 'mcp',
    });
    expect(entry.usd).toBeCloseTo(done.cost, 6);
  });

  test('a final job, or a named model and size', async () => {
    const final = await jobs.start(BUILDER, { prompt: 'x', kind: 'cover', tier: 'final' });
    expect(final.request).toMatchObject({ model: 'gemini-3-pro-image', size: '2K' });
    const named = await jobs.start(BUILDER, {
      prompt: 'x',
      kind: 'cover',
      model: 'gemini-3-pro-image',
      size: '4K',
      aspectRatio: '21:9',
    });
    expect(named.request).toMatchObject({ tier: null, size: '4K', aspectRatio: '21:9' });
    await drain();
    expect(model.calls.slice(-2).map((c) => [c.model, c.size, c.aspectRatio])).toEqual([
      ['gemini-3-pro-image', '2K', '16:9'],
      ['gemini-3-pro-image', '4K', '21:9'],
    ]);
  });
});

describe('the request', () => {
  test('references reach the model, SVG drawn to PNG', async () => {
    model.calls = [];
    await jobs.start(BUILDER, {
      prompt: 'In this style',
      kind: 'scene',
      references: [refs.style.id, refs.drawn.id],
    });
    await drain();
    const [call] = model.calls;
    expect(call.references.map((r) => r.mimeType)).toEqual(['image/png', 'image/png']);
    expect(readImage(call.references[0].bytes)).toMatchObject({ width: 32, height: 32 });
    expect(readImage(call.references[1].bytes)).toMatchObject({ format: 'png' });
    expect(call.prompt).toBe('In this style');
  });

  test('`from` data: a town, a battle map and a character', async () => {
    model.calls = [];
    const townJob = await jobs.start(BUILDER, {
      prompt: 'Lanterns along the quay',
      from: { worldId: WORLD, kind: 'town', id: 'loc_1' },
    });
    const mapJob = await jobs.start(BUILDER, {
      prompt: 'Damp stone',
      from: { worldId: WORLD, kind: 'battleMap', id: 'bm_cellar' },
    });
    const person = await jobs.start(BUILDER, {
      prompt: 'Head and shoulders',
      from: { worldId: WORLD, kind: 'character', id: 'chr_mara' },
    });
    // The kind and shape follow from what it is.
    expect([townJob, mapJob, person].map((j) => [j.request.kind, j.request.aspectRatio])).toEqual([
      ['town', '1:1'],
      ['battleMap', '16:9'],
      ['portrait', '3:4'],
    ]);
    await drain();
    const [t, m, p] = model.calls;
    expect(t.prompt).toMatch(/^About what to draw:\n.*settlement/);
    expect(t.prompt).toMatch(/A rain-soaked port of slate roofs\./);
    expect(t.prompt).toMatch(/In town: The Town Gate/);
    expect(t.prompt).toMatch(/straight above/);
    expect(t.prompt).toMatch(/\n\nThe image:\nLanterns along the quay$/);
    expect(t.aspectRatio).toBe('1:1');
    expect(m.prompt).toMatch(/The cellar: a battle map 16 by 9 squares/);
    expect(m.prompt).toMatch(/Features: the wine casks\./);
    expect(m.prompt).toMatch(/Ways out: the stairs\./);
    expect(p.prompt).toMatch(/Mara Quill, of .*\nHarbourmaster, grey-eyed\./);
    expect((await jobDoc(townJob.id)).request.from).toEqual({
      worldId: WORLD,
      kind: 'town',
      id: 'loc_1',
    });
  });

  test('a kind’s usual shape when none is asked for', async () => {
    const shape = async (input) =>
      (await jobs.start(BUILDER, { prompt: 'x', ...input })).request.aspectRatio;
    expect(await shape({ kind: 'portrait' })).toBe('3:4');
    expect(await shape({ kind: 'worldMap' })).toBe('16:9');
    expect(await shape({ kind: 'town' })).toBe('1:1');
    expect(await shape({ kind: 'token' })).toBe('1:1');
    expect(await shape({ kind: 'other' })).toBeNull(); // left to the model
    expect(await shape({ kind: 'portrait', aspectRatio: '1:1' })).toBe('1:1'); // as asked
    await drain();
  });

  test('the nearest shape to a grid', () => {
    expect(nearestRatio(16, 9)).toBe('16:9');
    expect(nearestRatio(10, 10)).toBe('1:1');
    expect(nearestRatio(30, 12)).toBe('21:9');
    expect(nearestRatio(6, 8)).toBe('3:4');
  });

  test('refuses a request that can’t be made', async () => {
    const no = (input) => expect(jobs.start(BUILDER, { prompt: 'x', kind: 'scene', ...input }));
    await no({ prompt: '' }).rejects.toThrow(/Say what to draw/);
    await no({ kind: undefined }).rejects.toThrow(/what kind of image/);
    await no({ kind: 'painting' }).rejects.toThrow(/what kind of image/);
    await no({ tier: 'best' }).rejects.toThrow(/draft or final/);
    await no({ model: 'imagen-4' }).rejects.toThrow(/The model is one of/);
    await no({ model: 'gemini-3.1-flash-lite-image', size: '4K' }).rejects.toThrow(/makes 1K/);
    await no({ aspectRatio: '5:1' }).rejects.toThrow(/aspectRatio/);
    await no({ references: ['img_0000000000000000'] }).rejects.toThrow(/No image/);
    await no({ references: Array(7).fill(refs.style.id) }).rejects.toThrow(/At most 6/);
    await no({ from: { worldId: WORLD, kind: 'town', id: 'loc_99999' } }).rejects.toThrow(
      /No place/
    );
    await no({ from: { worldId: WORLD, kind: 'region', id: 'x' } }).rejects.toThrow(/from.kind/);
    await no({ from: { worldId: 'nowhere-000000', kind: 'town', id: 'loc_1' } }).rejects.toThrow(
      /No world/
    );
  });
});

describe('failures', () => {
  test('a job the queue refuses says why, on the job and to whoever asked', async () => {
    const refusing = createJobs({
      db,
      library,
      costs,
      model,
      enqueue: async () => {
        throw new Error('7 PERMISSION_DENIED: lacks cloudtasks.tasks.create');
      },
      loadWorld: async () => null,
      placesOf: () => [],
      rasterize,
      load,
    });
    const err = await refusing.start(BUILDER, { prompt: 'x', kind: 'scene' }).catch((e) => e);
    expect(err).toMatchObject({
      code: 'unavailable',
      message: 'The job could not be queued: 7 PERMISSION_DENIED: lacks cloudtasks.tasks.create',
    });
    const [failed] = (await db.collection('studio_jobs').where('state', '==', 'failed').get()).docs
      .map((d) => d.data())
      .filter((j) => j.error && j.error.startsWith('The job could not be queued'));
    expect(failed.error).toBe(err.message);
  });

  test('a call that fails records its error, and isn’t charged', async () => {
    model.respond = () => {
      throw new Error('429 RESOURCE_EXHAUSTED');
    };
    const before = (await costEntries()).length;
    const job = await jobs.start(BUILDER, { prompt: 'x', kind: 'scene' });
    await drain();
    expect(await jobDoc(job.id)).toMatchObject({
      state: 'failed',
      error: '429 RESOURCE_EXHAUSTED',
      imageId: null,
      cost: null,
    });
    expect((await costEntries()).length).toBe(before);
  });

  test('no image back is a failure, charged for the tokens used', async () => {
    model.respond = () => ({
      image: null,
      usage: { input: 400, output: 0 },
      text: 'I can’t draw that.',
      finishReason: 'IMAGE_SAFETY',
    });
    const job = await jobs.start(BUILDER, { prompt: 'x', kind: 'scene', tier: 'final' });
    await drain();
    const failed = await jobDoc(job.id);
    expect(failed).toMatchObject({ state: 'failed', imageId: null });
    expect(failed.error).toBe('No image came back (IMAGE_SAFETY): I can’t draw that.');
    expect(failed.cost).toBeCloseTo(400 * 2e-6, 9);
    const [entry] = (await costEntries()).filter((e) => e.jobId === job.id);
    expect(entry).toMatchObject({ failed: true, model: 'gemini-3-pro-image' });
  });

  test('a job is run once: dispatched again, it isn’t charged twice', async () => {
    const job = await jobs.start(BUILDER, { prompt: 'x', kind: 'scene' });
    await drain();
    const charged = (await costEntries()).filter((e) => e.jobId === job.id).length;
    expect(await jobs.run(job.id)).toBeNull(); // done already
    // One still marked running (its first run crashed) is failed, not rerun.
    const stuck = await jobs.start(BUILDER, { prompt: 'y', kind: 'scene' });
    dispatched.length = 0; // the queue never ran it
    await db.collection('studio_jobs').doc(stuck.id).update({ state: 'running' });
    const calls = model.calls.length;
    expect(await jobs.run(stuck.id)).toBeNull();
    expect(model.calls.length).toBe(calls);
    expect((await jobDoc(stuck.id)).state).toBe('failed');
    expect((await costEntries()).filter((e) => e.jobId === job.id).length).toBe(charged);
  });
});

describe('the queue', () => {
  test('several jobs run at once', async () => {
    model.delay = 150;
    model.most = 0;
    const started = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => jobs.start(BUILDER, { prompt: `Map ${n}`, kind: 'worldMap' }))
    );
    await drain();
    expect(model.most).toBeGreaterThan(1);
    for (const job of started) expect((await jobDoc(job.id)).state).toBe('done');
  });

  test('list waits for a job to finish, or gives the latest', async () => {
    model.delay = 300;
    const job = await jobs.start(BUILDER, { prompt: 'Slow', kind: 'scene' });
    const first = await jobs.list({ ids: [job.id] });
    expect(first[0].state).toMatch(/queued|running/);
    const waited = await jobs.list({ ids: [job.id], wait: 10, poll: 50 });
    expect(waited[0].state).toBe('done');
    await drain();
    const latest = await jobs.list({ recent: 3 });
    expect(latest[0].id).toBe(job.id);
    await expect(jobs.getJob('job_0000000000000000')).rejects.toThrow(/No job/);
  });
});

describe('the page', () => {
  test('studioUpload’s service starts a job from the page', async () => {
    const service = createStudioService({ db, bucket, FieldValue, jobs: () => jobs });
    const { job } = await service.generate(BUILDER, { prompt: 'From the page', kind: 'cover' });
    expect(job).toMatchObject({ state: 'queued', request: { kind: 'cover' } });
    expect((await jobDoc(job.id)).via).toBe('page');
    await drain();
    await expect(service.generate(BUILDER, { prompt: '' })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  test('studioGenerate turns away anyone without the claim', async () => {
    await expect(
      studioGenerate.run({ data: { prompt: 'x' }, auth: { uid: 'p', token: { apps: ['loom'] } } })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('over MCP', () => {
  let server;
  let client;
  beforeAll(async () => {
    const writer = createFirestoreWorldWriter(() => db);
    const service = createCartographerService({ db, bucket, writer });
    const registry = createRegistry();
    registry.registerApp(
      'cartographer',
      cartographerApp({
        reader: createFirestoreWorldReader(() => db),
        writer,
        art: { load, draw: () => null },
        studio: {
          assign: (uid, args) => service.assignImage(uid, args),
          library: () => library,
          costs: () => costs,
          jobs: () => jobs,
          load,
        },
      })
    );
    const store = createInMemoryStore();
    store._debug.grants.set('g', { grantId: 'g', uid: BUILDER, appId: 'cartographer' });
    const app = express();
    app.use(express.json());
    app.all('/mcp/:appId', (req, res) =>
      handleAppRequest(req, res, {
        registry,
        appId: req.params.appId,
        getGrant: (id) => store.getGrant(id),
      })
    );
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    client = new Client({ name: 'studio-generate-test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${server.address().port}/mcp/cartographer`),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${signAccessToken({
                uid: BUILDER,
                audience: `${CANONICAL}/mcp/cartographer`,
                scope: 'mcp:cartographer',
                issuer: CANONICAL,
                grantId: 'g',
              })}`,
            },
          },
        }
      )
    );
  });

  afterAll(async () => {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('studio_generate, then studio_jobs returns the image and the cost line', async () => {
    model.delay = 200;
    const started = await client.callTool({
      name: 'studio_generate',
      arguments: {
        prompt: 'The town of Burdendal from above',
        from: { worldId: WORLD, kind: 'town', id: 'loc_1' },
        tier: 'final',
        labels: ['burdendal'],
      },
    });
    expect(started.isError).toBeFalsy();
    const { job, next, cost } = started.structuredContent;
    expect(job).toMatchObject({ state: 'queued', request: { kind: 'town', tier: 'final' } });
    expect(next).toMatch(/studio_jobs/);
    expect(cost).toMatchObject({ job: 0, warnAt: 50 });

    const collected = await client.callTool({
      name: 'studio_jobs',
      arguments: { ids: [job.id], wait: 10 },
    });
    expect(collected.isError).toBeFalsy();
    const [picture, text] = collected.content;
    expect(picture).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    const body = collected.structuredContent;
    expect(JSON.parse(text.text)).toEqual(body);
    expect(body.jobs[0]).toMatchObject({
      id: job.id,
      state: 'done',
      image: { kind: 'town', labels: ['burdendal'], link: expect.any(String), shown: 1 },
    });
    expect(body.jobs[0].cost).toBeCloseTo(0.002 * 0.5 + 0.1344, 3); // Pro: 500 in, 1120 out
    expect(body.cost.job).toBeCloseTo(body.jobs[0].cost, 6);
    expect(body.cost.month).toBeGreaterThan(0);
    expect(body.cost.warnAt).toBe(50);
    await drain();
  });

  test('refusals come back as tool errors', async () => {
    const bad = await client.callTool({
      name: 'studio_generate',
      arguments: { prompt: 'x', kind: 'scene', model: 'gemini-3.1-flash-lite-image', size: '4K' },
    });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/makes 1K/);
    const unknown = await client.callTool({
      name: 'studio_jobs',
      arguments: { ids: ['job_0000000000000000'] },
    });
    expect(unknown.isError).toBe(true);
  });
});

describe('the model call', () => {
  const fake = (response) => {
    const sent = [];
    return {
      sent,
      models: {
        generateContent: async (req) => {
          sent.push(req);
          return response;
        },
      },
    };
  };

  test('asks Vertex for one image, with its references, size and shape', async () => {
    const genai = fake({
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              { text: 'thinking', thought: true },
              { text: 'A map.' },
              { inlineData: { mimeType: 'image/png', data: png(8, 8).toString('base64') } },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 1120, thoughtsTokenCount: 80 },
    });
    const result = await createImageModel({ genai }).generate({
      model: 'gemini-3-pro-image',
      prompt: 'A map',
      references: [{ bytes: Buffer.from('ref'), mimeType: 'image/png' }],
      size: '4K',
      aspectRatio: '16:9',
    });
    expect(genai.sent[0]).toEqual({
      model: 'gemini-3-pro-image',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/png', data: Buffer.from('ref').toString('base64') } },
            { text: 'A map' },
          ],
        },
      ],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        candidateCount: 1,
        imageConfig: { aspectRatio: '16:9', imageSize: '4K' },
      },
    });
    expect(readImage(result.image.bytes)).toMatchObject({ width: 8, height: 8 });
    expect(result).toMatchObject({
      text: 'A map.',
      usage: { input: 300, output: 1120, text: 80 }, // thinking priced as text
      finishReason: 'STOP',
    });
  });

  test('image tokens and text tokens are counted apart, by modality when given', () => {
    expect(
      usageOf({
        promptTokenCount: 40,
        candidatesTokenCount: 2012,
        thoughtsTokenCount: 340,
        candidatesTokensDetails: [
          { modality: 'TEXT', tokenCount: 12 },
          { modality: 'IMAGE', tokenCount: 2000 },
        ],
      })
    ).toEqual({ input: 40, output: 2000, text: 352 });
    // Without the per-modality counts, all but thinking counts as image.
    expect(usageOf({ promptTokenCount: 5, candidatesTokenCount: 1120 })).toEqual({
      input: 5,
      output: 1120,
      text: 0,
    });
  });

  test('no image back: the reason, and the tokens used', async () => {
    const genai = fake({
      candidates: [],
      promptFeedback: { blockReason: 'SAFETY' },
      usageMetadata: { promptTokenCount: 50 },
    });
    const result = await createImageModel({ genai }).generate({
      model: 'gemini-3.1-flash-lite-image',
      prompt: 'x',
      size: '1K',
    });
    // A model with one size isn't asked for one.
    expect(genai.sent[0].config.imageConfig).toEqual({});
    expect(result).toEqual({
      image: null,
      usage: { input: 50, output: 0, text: 0 },
      text: '',
      finishReason: 'SAFETY',
    });
  });
});

afterAll(async () => {
  await drain();
  await db.terminate();
});
