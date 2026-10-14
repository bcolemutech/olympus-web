'use strict';

/**
 * Named styles (planning/the-image-studio.md §3 M4, §4.2, §4.3; L-709 / #545),
 * with the image model stubbed, against the Firestore and Storage emulators
 * and through a real MCP client: a style's text and references reach the
 * request; a world's default applies and can be overridden or refused;
 * an edit can be redrawn in a style; filtering by style works.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest studio-styles --verbose"
 */

const PROJECT = 'demo-studio-styles';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.MCP_JWT_SECRET = 'test-signing-secret-studio-styles';
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
const { createLibrary } = require('../functions/studio/library');
const { createCosts } = require('../functions/studio/costs');
const { createJobs, buildPrompt, editPrompt } = require('../functions/studio/jobs');
const { createStyles, chooseStyle } = require('../functions/studio/styles');
const { readImage } = require('../functions/studio/formats');
const { rasterize } = require('../functions/studio');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');

const adminApp = initializeApp({ projectId: PROJECT }, 'studio-styles-test');
const db = getFirestore(adminApp);
const bucket = getStorage(adminApp).bucket(`${PROJECT}.appspot.com`);
const WORLD = 'nisia-f0f0f0';
const BUILDER = 'builder-001';
const CANONICAL = 'https://bcoletech.com';

function png(width, height, shade) {
  const img = new PNG({ width, height });
  img.data.fill(shade);
  return PNG.sync.write(img);
}

// The stubbed model: records each request, and draws a plain square.
const model = {
  calls: [],
  async generate(request) {
    this.calls.push(request);
    return {
      image: { bytes: png(48, 48, 90), mimeType: 'image/png' },
      usage: { input: 1300, output: 1120, text: 0 },
      text: null,
      finishReason: 'STOP',
    };
  },
};
// The widths of the images a request sent, in order: each test image has its own.
const widths = (request) => request.references.map((r) => readImage(r.bytes).width);

const writer = createFirestoreWorldWriter(() => db);
const reader = createFirestoreWorldReader(() => db);
const service = createCartographerService({ db, bucket, writer });
const library = createLibrary({ db, bucket });
const costs = createCosts({ db, FieldValue });
const styles = createStyles({ db, library });
const load = async (at) => (await bucket.file(at).download())[0];
const dispatched = [];
const jobs = createJobs({
  db,
  library,
  costs,
  model,
  styles,
  enqueue: async ({ jobId }) => {
    dispatched.push(new Promise((resolve) => setImmediate(resolve)).then(() => jobs.run(jobId)));
  },
  loadWorld: (worldId) => loomCanon.loadWorld(worldId, { db, playableOnly: false }),
  placesOf: town.placesOf,
  rasterize,
  load,
});
const drain = async () => {
  while (dispatched.length) await dispatched.shift();
};

const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader,
    writer,
    art: { load, draw: () => null },
    studio: {
      assign: (uid, args) => service.assignImage(uid, args),
      library: () => library,
      costs: () => costs,
      jobs: () => jobs,
      styles: () => styles,
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
async function refused(name, args) {
  const result = await call(name, args);
  expect(result.isError).toBe(true);
  return result.content[0].text;
}
const worldDoc = async () => (await db.collection('loom_worlds').doc(WORLD).get()).data();
// Generates, runs the job and returns what the model was sent and the image made.
async function generate(args) {
  const { job } = await ok('studio_generate', args);
  await drain();
  const done = await jobs.getJob(job.id);
  expect(done.state).toBe('done');
  return {
    job,
    sent: model.calls[model.calls.length - 1],
    image: await library.getImage(done.imageId),
  };
}

// Two style references (widths 30 and 31), another for a second style (32),
// and a plain reference (40).
const refs = {};
beforeAll(async () => {
  for (const c of ['loom_worlds', 'studio_images', 'studio_jobs', 'studio_styles']) {
    await db.recursiveDelete(db.collection(c));
  }
  for (const c of ['studio_costs', 'studio_costs_month']) {
    await db.recursiveDelete(db.collection(c));
  }
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
  loomCanon.clearWorldCache();

  for (const [name, width] of [
    ['ink1', 30],
    ['ink2', 31],
    ['oil', 32],
    ['plain', 40],
  ]) {
    refs[name] = (
      await library.addImage({
        title: `Reference ${name}`,
        kind: 'other',
        file: readImage(png(width, 20, 120)),
        createdBy: BUILDER,
        via: 'upload',
      })
    ).id;
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
  client = new Client({ name: 'studio-styles-test', version: '0.0.0' });
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

describe('the prompt and the choice of style', () => {
  const ink = { id: 'sty_1', name: 'Ink', prompt: 'Ink on parchment.', references: ['a', 'b'] };

  test('the world first, then the style and its images, then what was asked', () => {
    expect(buildPrompt('A harbour.', null, null)).toBe('A harbour.');
    expect(buildPrompt('A harbour.', { text: 'Burdendal: a settlement.' }, ink)).toBe(
      'About what to draw:\nBurdendal: a settlement.\n\n' +
        'The style:\nInk on parchment.\n' +
        'Follow the style of images 1–2 (the look, not the subject).\n\n' +
        'The image:\nA harbour.'
    );
    expect(buildPrompt('A harbour.', null, { ...ink, references: [] })).toBe(
      'The style:\nInk on parchment.\n\nThe image:\nA harbour.'
    );
  });

  test('an edit in a style: redrawn in it, the layout kept', () => {
    expect(editPrompt('Add a tower.', false, ink)).toBe(
      'Edit the first image: Add a tower.\n' +
        'Redraw it in this style: Ink on parchment.\n' +
        'Keep everything else as it is: the layout and the composition. ' +
        'Images 2–3 show the style.'
    );
    expect(editPrompt('Add a tower.', true, { ...ink, references: ['a'] })).toMatch(
      /Image 2 show the style\. Use the images after those as references for the change\.$/
    );
    expect(editPrompt('Add a tower.', true)).toMatch(/the style and the colours\. Use the other/);
  });

  test('named, none, or the world’s default', () => {
    const world = { studio: { styleId: 'sty_w' } };
    expect(chooseStyle(undefined, world)).toBe('sty_w');
    expect(chooseStyle('sty_x', world)).toBe('sty_x');
    expect(chooseStyle('none', world)).toBeNull();
    expect(chooseStyle(null, world)).toBeNull();
    expect(chooseStyle(undefined, null)).toBeNull();
    expect(chooseStyle(undefined, { studio: null })).toBeNull();
  });
});

describe('making styles', () => {
  test('studio_set_style makes a style; studio_styles lists it with its images', async () => {
    const made = await ok('studio_set_style', {
      name: 'Ink and wash',
      prompt: 'Ink and watercolour on parchment, muted earth tones, hand-lettered names.',
      references: [refs.ink1, refs.ink2],
    });
    expect(made.created).toBe(true);
    expect(made.style).toMatchObject({
      id: expect.stringMatching(/^sty_[0-9a-f]{16}$/),
      name: 'Ink and wash',
      references: [
        { id: refs.ink1, title: 'Reference ink1', link: expect.stringContaining('studio') },
        { id: refs.ink2, title: 'Reference ink2' },
      ],
    });
    await ok('studio_set_style', {
      name: 'Oil',
      prompt: 'Thick oil paint.',
      references: [refs.oil],
    });
    const listed = await ok('studio_styles', {});
    expect(listed.styles.map((s) => s.name)).toEqual(['Ink and wash', 'Oil']);
    expect(listed.cost).toMatchObject({ job: 0, warnAt: 50 });
  });

  test('changes a style: only what is given', async () => {
    const [ink] = (await ok('studio_styles', {})).styles;
    const changed = await ok('studio_set_style', {
      styleId: ink.id,
      prompt: 'Ink and watercolour on parchment, muted earth tones.',
    });
    expect(changed.created).toBeUndefined();
    expect(changed.style).toMatchObject({
      name: 'Ink and wash',
      prompt: 'Ink and watercolour on parchment, muted earth tones.',
    });
    expect(changed.style.references).toHaveLength(2);
  });

  test('refuses a style without a name or prompt, a taken name, a missing image', async () => {
    expect(await refused('studio_set_style', { prompt: 'Chalk.' })).toMatch(/Name the style/);
    expect(await refused('studio_set_style', { name: 'Chalk' })).toMatch(/prompt/);
    expect(await refused('studio_set_style', { name: 'oil', prompt: 'Again.' })).toMatch(
      /named "Oil" already/
    );
    expect(
      await refused('studio_set_style', {
        name: 'Chalk',
        prompt: 'Chalk.',
        references: ['img_0000000000000000'],
      })
    ).toMatch(/No image/);
    expect(
      await refused('studio_set_style', {
        name: 'Chalk',
        prompt: 'Chalk.',
        references: [refs.ink1, refs.ink2, refs.oil, refs.plain],
      })
    ).toMatch(/at most 3|too_big|Array must contain/i);
    expect(
      await refused('studio_set_style', { styleId: 'sty_0000000000000000', prompt: 'X.' })
    ).toMatch(/No style/);
    expect((await ok('studio_styles', {})).styles).toHaveLength(2);
  });
});

describe('a style in a request', () => {
  let ink;
  let oil;
  beforeAll(async () => {
    [ink, oil] = (await ok('studio_styles', {})).styles;
  });

  test('its text and references reach the model, and the image is in the style', async () => {
    const { job, sent, image } = await generate({
      prompt: 'A walled harbour town at dusk.',
      kind: 'scene',
      styleId: ink.id,
      references: [refs.plain],
    });
    expect(job.request.style).toEqual({ id: ink.id, name: 'Ink and wash' });
    expect(sent.prompt).toBe(
      'The style:\nInk and watercolour on parchment, muted earth tones.\n' +
        'Follow the style of images 1–2 (the look, not the subject).\n\n' +
        'The image:\nA walled harbour town at dusk.'
    );
    // The style's images first, then the request's own.
    expect(widths(sent)).toEqual([30, 31, 40]);
    expect(image.styleId).toBe(ink.id);
    expect(image.references).toEqual([refs.plain]);
  });

  test('refuses a style that isn’t there, and too many references with it', async () => {
    expect(
      await refused('studio_generate', {
        prompt: 'A tower.',
        kind: 'scene',
        styleId: 'sty_0000000000000000',
      })
    ).toMatch(/No style/);
    expect(
      await refused('studio_generate', {
        prompt: 'A tower.',
        kind: 'scene',
        styleId: ink.id,
        references: [refs.plain, refs.oil, refs.plain, refs.oil, refs.plain],
      })
    ).toMatch(/At most 4 reference images with the style "Ink and wash" \(it brings 2\)/);
  });

  test('an edit can be redrawn in a style, and the image is in it after', async () => {
    const { image: plain } = await generate({ prompt: 'A mill.', kind: 'scene' });
    expect(plain.styleId).toBeNull();
    const { job } = await ok('studio_edit', {
      imageId: plain.id,
      instruction: 'Add a waterwheel.',
      styleId: oil.id,
    });
    expect(job.request.style).toEqual({ id: oil.id, name: 'Oil' });
    await drain();
    const sent = model.calls[model.calls.length - 1];
    expect(sent.prompt).toMatch(
      /^Edit the first image: Add a waterwheel\.\nRedraw it in this style: Thick oil paint\./
    );
    expect(widths(sent)).toEqual([48, 32]); // the image, then the style's
    const edited = await library.getImage(plain.id);
    expect(edited.current).toBe(2);
    expect(edited.styleId).toBe(oil.id);
  });

  test('an edit without a style keeps the image’s look', async () => {
    const { image } = await generate({ prompt: 'A bridge.', kind: 'scene', styleId: ink.id });
    await ok('studio_edit', { imageId: image.id, instruction: 'Make it rain.' });
    await drain();
    const sent = model.calls[model.calls.length - 1];
    expect(sent.prompt).toMatch(/the style and the colours\.$/);
    expect(widths(sent)).toEqual([48]);
    expect((await library.getImage(image.id)).styleId).toBe(ink.id);
  });
});

describe('a world’s default style', () => {
  let ink;
  let oil;
  const from = { worldId: WORLD, kind: 'location', id: 'loc_1' };
  beforeAll(async () => {
    [ink, oil] = (await ok('studio_styles', {})).styles;
  });

  test('studio_set_style makes a style the world’s default', async () => {
    const result = await ok('studio_set_style', { styleId: ink.id, worldId: WORLD });
    expect(result).toMatchObject({ worldId: WORLD, defaultStyle: ink.id });
    expect((await worldDoc()).studio).toEqual({ styleId: ink.id });
    const listed = await ok('studio_styles', { worldId: WORLD });
    expect(listed).toMatchObject({ worldId: WORLD, defaultStyle: ink.id });
  });

  test('a request about the world uses it', async () => {
    const { job, sent, image } = await generate({
      prompt: 'Its market square.',
      kind: 'scene',
      from,
    });
    expect(job.request.style).toEqual({ id: ink.id, name: 'Ink and wash' });
    expect(sent.prompt).toMatch(/^About what to draw:\n.+\n\nThe style:\nInk and watercolour/s);
    expect(widths(sent)).toEqual([30, 31]);
    expect(image.styleId).toBe(ink.id);
  });

  test('another style named overrides it, and "none" refuses it', async () => {
    const other = await generate({
      prompt: 'Its market square.',
      kind: 'scene',
      from,
      styleId: oil.id,
    });
    expect(other.sent.prompt).toMatch(/The style:\nThick oil paint\./);
    expect(widths(other.sent)).toEqual([32]);
    expect(other.image.styleId).toBe(oil.id);

    const none = await generate({
      prompt: 'Its market square.',
      kind: 'scene',
      from,
      styleId: 'none',
    });
    expect(none.job.request.style).toBeNull();
    expect(none.sent.prompt).not.toMatch(/The style:/);
    expect(none.sent.references).toEqual([]);
    expect(none.image.styleId).toBeNull();
  });

  test('a request not about the world doesn’t use it', async () => {
    const { sent, image } = await generate({ prompt: 'A lone lighthouse.', kind: 'scene' });
    expect(sent.prompt).toBe('A lone lighthouse.');
    expect(image.styleId).toBeNull();
  });

  test('a new default replaces the old; clearing it leaves none', async () => {
    const changed = await ok('studio_set_style', { styleId: oil.id, worldId: WORLD });
    expect(changed).toMatchObject({ defaultStyle: oil.id, previousDefault: ink.id });
    expect((await generate({ prompt: 'Its gate.', kind: 'scene', from })).image.styleId).toBe(
      oil.id
    );

    expect(
      await refused('studio_set_style', { worldId: WORLD, clearDefault: true, styleId: oil.id })
    ).toMatch(/on its own/);
    const cleared = await ok('studio_set_style', { worldId: WORLD, clearDefault: true });
    expect(cleared).toMatchObject({ worldId: WORLD, defaultStyle: null, cleared: oil.id });
    expect((await worldDoc()).studio).toEqual({});
    expect((await ok('studio_styles', { worldId: WORLD })).defaultStyle).toBeNull();
    const { job } = await generate({ prompt: 'Its gate.', kind: 'scene', from });
    expect(job.request.style).toBeNull();
  });
});

describe('finding images by style', () => {
  test('studio_find filters by style', async () => {
    const [ink, oil] = (await ok('studio_styles', {})).styles;
    // In ink: the harbour, the bridge and the market square (the world's default).
    const inInk = await ok('studio_find', { styleId: ink.id });
    expect(inInk.images.map((i) => i.styleId)).toEqual([ink.id, ink.id, ink.id]);
    expect(inInk.images.some((i) => i.title === 'A bridge.')).toBe(true);
    // In oil: the mill (redrawn in it), the market square named so, the gate.
    const inOil = await ok('studio_find', { styleId: oil.id });
    expect(inOil.images.map((i) => i.styleId)).toEqual([oil.id, oil.id, oil.id]);
    expect(inOil.images.some((i) => i.title === 'A mill.')).toBe(true);
    // With words too.
    expect((await ok('studio_find', { styleId: oil.id, words: 'mill' })).images).toHaveLength(1);
    expect((await ok('studio_find', { styleId: ink.id, words: 'mill' })).images).toHaveLength(0);
  });
});
