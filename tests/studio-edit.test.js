'use strict';

/**
 * Editing by instruction (planning/the-image-studio.md §3 E1–E3, §4.3, §4.4;
 * L-708 / #544), with the image model stubbed, against the Firestore and
 * Storage emulators and through a real MCP client: an edit makes version n+1
 * current and the link serves it; the in-use notice names every use; the
 * worlds using it pick it up; reverting serves the earlier version everywhere.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest studio-edit --verbose"
 */

const PROJECT = 'demo-studio-edit';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.MCP_JWT_SECRET = 'test-signing-secret-studio-edit';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const functionsDir = path.resolve(__dirname, '../functions');
const { PNG } = require(require.resolve('pngjs', { paths: [functionsDir] }));
const { initializeApp } = require(require.resolve('firebase-admin/app', { paths: [functionsDir] }));
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
const { createCartographerService } = require('../functions/cartographer/service');
const { createLibrary, currentPath } = require('../functions/studio/library');
const { createCosts } = require('../functions/studio/costs');
const { createJobs, editPrompt } = require('../functions/studio/jobs');
const { readImage } = require('../functions/studio/formats');
const { rasterize } = require('../functions/studio');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');
const { layOutTowns } = require('./helpers/towns');

const adminApp = initializeApp({ projectId: PROJECT }, 'studio-edit-test');
const db = getFirestore(adminApp);
const bucket = getStorage(adminApp).bucket(`${PROJECT}.appspot.com`);
const WORLD = 'nisia-e0e0e0';
const BUILDER = 'builder-001';
const CANONICAL = 'https://bcoletech.com';

function png(width, height, shade) {
  const img = new PNG({ width, height });
  img.data.fill(shade);
  return PNG.sync.write(img);
}

// The stubbed model: an edit comes back larger, in a new shade.
const model = {
  calls: [],
  next: () => png(96, 96, 40),
  before: null, // a step to take while the model is drawing
  async generate(request) {
    this.calls.push(request);
    if (this.before) await this.before(request);
    return {
      image: { bytes: this.next(), mimeType: 'image/png' },
      usage: { input: 1300, output: 1120, text: 0 },
      text: 'Night has fallen.',
      finishReason: 'STOP',
    };
  },
};

const writer = createFirestoreWorldWriter(() => db);
const service = createCartographerService({ db, bucket, writer });
const library = createLibrary({ db, bucket });
const costs = createCosts({ db, FieldValue });
const load = async (at) => (await bucket.file(at).download())[0];
const dispatched = [];
const jobs = createJobs({
  db,
  library,
  costs,
  model,
  enqueue: async ({ jobId }) => {
    dispatched.push(new Promise((resolve) => setImmediate(resolve)).then(() => jobs.run(jobId)));
  },
  loadWorld: async () => null,
  placesOf: town.placesOf,
  rasterize,
  load,
  refreshUses: async (record, uid) => {
    for (const use of record.usedIn || []) {
      await service.assignImage(uid, { ...use, imageId: record.id });
    }
    return record.usedIn || [];
  },
});
const drain = async () => {
  while (dispatched.length) await dispatched.shift();
};

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
let server;
let client;

const call = (name, args) => client.callTool({ name, arguments: args });
async function ok(name, args) {
  const result = await call(name, args);
  if (result.isError) throw new Error(`${name} failed: ${result.content[0].text}`);
  return result.structuredContent;
}
const worldDoc = async () => (await db.collection('loom_worlds').doc(WORLD).get()).data();
const settlement = async () =>
  (await db.collection('loom_worlds').doc(WORLD).collection('locations').doc('loc_1').get()).data();
const served = async (imageId) =>
  readImage((await bucket.file(currentPath(imageId)).download())[0]);

// A town image used twice: as the town art of two settlements.
let townImage;
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
  await layOutTowns(worldRef, 'loc_1');
  await layOutTowns(worldRef, 'loc_2');
  await worldRef.update({ canonVersion: (await worldRef.get()).data().canonVersion + 1 });
  loomCanon.clearWorldCache();

  townImage = await library.addImage({
    title: 'Burdendal by day',
    kind: 'town',
    file: readImage(png(64, 64, 200)),
    createdBy: BUILDER,
    via: 'page',
  });
  for (const id of ['loc_1', 'loc_2']) {
    await service.assignImage(BUILDER, {
      worldId: WORLD,
      target: 'town',
      id,
      imageId: townImage.id,
    });
  }

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
  store._debug.grants.set('g', { grantId: 'g', uid: BUILDER, appId: 'cartographer' });
  client = new Client({ name: 'studio-edit-test', version: '0.0.0' });
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
}, 60000);

afterAll(async () => {
  await drain();
  await client.close();
  await new Promise((resolve) => server.close(resolve));
  await db.terminate();
});

describe('an edit', () => {
  let jobId;

  test('studio_edit starts a job and names every use (the in-use notice)', async () => {
    const result = await ok('studio_edit', {
      imageId: townImage.id,
      instruction: 'Make it night, with lanterns lit along the quay',
    });
    jobId = result.job.id;
    expect(result.job).toMatchObject({
      kind: 'edit',
      state: 'queued',
      imageId: townImage.id,
      fromVersion: 1,
      request: { instruction: 'Make it night, with lanterns lit along the quay', kind: 'town' },
    });
    expect(result.inUse).toEqual([
      { worldId: WORLD, target: 'town', id: 'loc_1' },
      { worldId: WORLD, target: 'town', id: 'loc_2' },
    ]);
    expect(result.notice).toMatch(/in use in 2 places: .*loc_1.*loc_2.*view_image/);
    expect(result.next).toMatch(/studio_jobs/);
  });

  test('makes version 2 current, and the link serves it', async () => {
    await drain();
    // The model got the image as the first reference, the change, and its shape.
    const [sent] = model.calls.slice(-1);
    expect(sent.prompt).toBe(editPrompt('Make it night, with lanterns lit along the quay', false));
    expect(sent.references).toHaveLength(1);
    expect(readImage(sent.references[0].bytes)).toMatchObject({ width: 64, height: 64 });
    expect(sent.aspectRatio).toBe('1:1');

    const record = await library.getImage(townImage.id);
    expect(record.current).toBe(2);
    expect(record.versions[1]).toMatchObject({
      n: 2,
      width: 96,
      height: 96,
      instruction: 'Make it night, with lanterns lit along the quay',
      via: 'mcp',
      createdBy: BUILDER,
    });
    expect(record.versions[1].cost).toBeCloseTo(0.00065 + 0.0672, 6);
    expect(await served(townImage.id)).toMatchObject({ width: 96, height: 96 });

    const job = (await db.collection('studio_jobs').doc(jobId).get()).data();
    expect(job).toMatchObject({ state: 'done', kind: 'edit', imageId: townImage.id, version: 2 });
    const [entry] = (await db.collection('studio_costs').where('jobId', '==', jobId).get()).docs;
    expect(entry.data()).toMatchObject({ imageId: townImage.id, kind: 'town', failed: false });
  });

  test('every world using it picks it up', async () => {
    expect((await settlement()).town.image).toMatchObject({
      imageId: townImage.id,
      link: townImage.link, // the same link, serving the new version
      width: 96,
      height: 96,
    });
  });

  test('studio_jobs shows the edit, with the version it made', async () => {
    const result = await call('studio_jobs', { ids: [jobId] });
    expect(result.content[0]).toMatchObject({ type: 'image' });
    expect(result.structuredContent.jobs[0]).toMatchObject({
      kind: 'edit',
      state: 'done',
      version: 2,
      image: { id: townImage.id, current: 2, versions: 2 },
    });
    expect(result.structuredContent.cost.job).toBeGreaterThan(0);
  });
});

describe('reverting', () => {
  test('making version 1 current serves it everywhere again', async () => {
    const result = await ok('studio_update', { imageId: townImage.id, current: 1 });
    expect(result.image).toMatchObject({ current: 1, versions: 2, width: 64, height: 64 });
    expect(result.changed.map((c) => c.id).sort()).toEqual(['loc_1', 'loc_2']);
    expect(await served(townImage.id)).toMatchObject({ width: 64, height: 64 });
    expect((await settlement()).town.image).toMatchObject({ width: 64, height: 64 });
  });

  test('an edit of the reverted image builds on version 1, as version 3', async () => {
    model.next = () => png(80, 80, 90);
    await ok('studio_edit', { imageId: townImage.id, instruction: 'Add snow' });
    await drain();
    const [sent] = model.calls.slice(-1);
    expect(readImage(sent.references[0].bytes)).toMatchObject({ width: 64, height: 64 });
    const record = await library.getImage(townImage.id);
    expect(record.current).toBe(3);
    expect(record.versions.map((v) => v.n)).toEqual([1, 2, 3]);
    expect(await served(townImage.id)).toMatchObject({ width: 80, height: 80 });
  });
});

describe('refusals and failures', () => {
  test('refuses an edit that can’t be made', async () => {
    const refused = async (args) => {
      const result = await call('studio_edit', args);
      expect(result.isError).toBe(true);
      return result.content[0].text;
    };
    expect(await refused({ imageId: 'img_0000000000000000', instruction: 'x' })).toMatch(
      /No image/
    );
    expect(await refused({ imageId: townImage.id, instruction: ' ' })).toMatch(/what to change/);
    expect(
      await jobs
        .startEdit(BUILDER, {
          imageId: townImage.id,
          instruction: 'x',
          references: Array(6).fill(townImage.id),
        })
        .catch((e) => e.message)
    ).toMatch(/At most 5 more reference images/);
    expect(
      await refused({
        imageId: townImage.id,
        instruction: 'x',
        model: 'gemini-3.1-flash-lite-image',
        size: '4K',
      })
    ).toMatch(/makes 1K/);
  });

  test('an image deleted before its edit runs: failed, not charged', async () => {
    const lone = await library.addImage({
      title: 'A lone scene',
      kind: 'scene',
      file: readImage(png(32, 18, 10)),
      createdBy: BUILDER,
      via: 'page',
    });
    const { job } = await jobs.startEdit(BUILDER, { imageId: lone.id, instruction: 'Rain' });
    dispatched.length = 0; // run it by hand, after the delete
    await library.deleteImage(lone.id);
    await jobs.run(job.id);
    const failed = (await db.collection('studio_jobs').doc(job.id).get()).data();
    expect(failed).toMatchObject({ state: 'failed', cost: null });
    expect(failed.error).toMatch(/No image/);
    expect((await db.collection('studio_costs').where('jobId', '==', job.id).get()).size).toBe(0);
  });

  test('an image deleted while the model drew its edit: failed, and still charged', async () => {
    const lone = await library.addImage({
      title: 'Another scene',
      kind: 'scene',
      file: readImage(png(32, 18, 10)),
      createdBy: BUILDER,
      via: 'page',
    });
    const { job } = await jobs.startEdit(BUILDER, { imageId: lone.id, instruction: 'Fog' });
    dispatched.length = 0;
    model.before = () => library.deleteImage(lone.id); // deleted mid-call
    try {
      await jobs.run(job.id);
    } finally {
      model.before = null;
    }
    const failed = (await db.collection('studio_jobs').doc(job.id).get()).data();
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatch(/couldn't be kept: No image/);
    expect(failed.cost).toBeGreaterThan(0);
    const [entry] = (await db.collection('studio_costs').where('jobId', '==', job.id).get()).docs;
    expect(entry.data()).toMatchObject({ failed: true, imageId: lone.id });
  });
});
