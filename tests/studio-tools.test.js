'use strict';

/**
 * The image studio's library tools (planning/the-image-studio.md §4.7; L-703 /
 * #539), driven by a real MCP client through the Cartographer connector,
 * against the Firestore and Storage emulators: studio_find, studio_get,
 * studio_update, studio_labels and studio_delete, each tool's happy path and
 * its refusals.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest studio-tools --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.MCP_JWT_SECRET = 'test-signing-secret-studio-tools';
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
const jpegJs = require(require.resolve('jpeg-js', { paths: [functionsDir] }));
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
const { createCartographerService } = require('../functions/cartographer/service');
const { createLibrary, currentPath } = require('../functions/studio/library');
const { readImage } = require('../functions/studio/formats');
const { createCosts } = require('../functions/studio/costs');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');

const PROJECT = 'demo-studio-tools';
const CANONICAL = 'https://bcoletech.com';
const WORLD = 'nisia-s0s0s0';
const BUILDER = 'builder-001';

const adminApp = initializeApp({ projectId: PROJECT }, 'studio-tools-test');
const db = getFirestore(adminApp);
const bucket = getStorage(adminApp).bucket(`${PROJECT}.appspot.com`);
const writer = createFirestoreWorldWriter(() => db);
const service = createCartographerService({ db, bucket, writer });
const library = createLibrary({ db, bucket });
const costs = createCosts({ db, FieldValue });
const load = async (at) => (await bucket.file(at).download())[0];

const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader: createFirestoreWorldReader(() => db),
    writer,
    art: { load, draw: (uid, args) => service.drawArt(uid, args) },
    studio: {
      assign: (uid, args) => service.assignImage(uid, args),
      library: () => library,
      load,
      costs: () => costs,
    },
  })
);
const oauthStore = createInMemoryStore();

function png(width, height, shade = 170) {
  const img = new PNG({ width, height });
  img.data.fill(shade);
  return PNG.sync.write(img);
}
function jpeg(width, height) {
  const data = Buffer.alloc(width * height * 4, 120);
  return Buffer.from(jpegJs.encode({ data, width, height }, 80).data);
}
// A WebP header: enough for the library to read its size.
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
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect width="640" height="480" fill="#336"/></svg>'
);

let server;
let client;

const call = (name, args = {}) => client.callTool({ name, arguments: args });
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
const add = (fields, bytes) =>
  library.addImage({ createdBy: BUILDER, via: 'page', file: readImage(bytes), ...fields });
const record = async (id) => (await db.collection('studio_images').doc(id).get()).data();
const worldDoc = async () => (await db.collection('loom_worlds').doc(WORLD).get()).data();

// The library: a world map (used as the world's map), a harbour town with a
// prompt, a JPEG, a WebP and an SVG.
const img = {};

beforeAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db.recursiveDelete(db.collection('studio_images'));
  await db.recursiveDelete(db.collection('studio_costs'));
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
  loomCanon.clearWorldCache();

  img.map = await add(
    { title: 'Nisia, the whole coast', kind: 'worldMap', labels: ['Nisia', 'coast'] },
    png(400, 300)
  );
  img.town = await add(
    {
      title: 'Burdendal',
      kind: 'town',
      labels: ['nisia', 'harbour'],
      prompt: 'A rain-soaked port town at night, lanterns on the quay',
    },
    png(64, 64, 90)
  );
  img.photo = await add({ title: 'A big photograph', kind: 'scene' }, jpeg(2000, 1000));
  img.web = await add({ title: 'A banner', kind: 'interface', labels: ['coast'] }, webp(512, 256));
  img.drawn = await add({ title: 'A drawn cellar', kind: 'battleMap' }, SVG);
  await service.assignImage(BUILDER, { worldId: WORLD, target: 'map', imageId: img.map.id });

  const app = express();
  app.use(express.json());
  app.all('/mcp/:appId', (req, res) =>
    handleAppRequest(req, res, {
      registry,
      appId: req.params.appId,
      getGrant: (grantId) => oauthStore.getGrant(grantId),
    })
  );
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  oauthStore._debug.grants.set('g', { grantId: 'g', uid: BUILDER, appId: 'cartographer' });
  const token = signAccessToken({
    uid: BUILDER,
    audience: `${CANONICAL}/mcp/cartographer`,
    scope: 'mcp:cartographer',
    issuer: CANONICAL,
    grantId: 'g',
  });
  client = new Client({ name: 'studio-tools-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${server.address().port}/mcp/cartographer`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    )
  );
}, 60000);

afterAll(async () => {
  await client.close();
  await new Promise((resolve) => server.close(resolve));
  await db.terminate();
});

test('the library tools are there; finding and looking only read', async () => {
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const name of ['studio_find', 'studio_get', 'studio_labels']) {
    expect(byName[name].annotations.readOnlyHint).toBe(true);
  }
  expect(byName.studio_update.annotations.readOnlyHint).toBe(false);
  expect(byName.studio_delete.annotations.destructiveHint).toBe(true);
});

describe('studio_find', () => {
  test('matches words in prompts and labels, newest first, with links', async () => {
    const byPrompt = await ok('studio_find', { words: 'lanterns quay' });
    expect(byPrompt.images.map((i) => i.id)).toEqual([img.town.id]);
    expect(byPrompt.images[0]).toMatchObject({
      title: 'Burdendal',
      kind: 'town',
      link: img.town.link,
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });
    expect(byPrompt.images[0].versions).toBe(1); // a count, not the versions

    const byLabel = await ok('studio_find', { words: 'coast' });
    expect(byLabel.images.map((i) => i.id)).toEqual([img.web.id, img.map.id]);
    expect(byLabel.total).toBe(2);
  });

  test('filters by kind, labels, the world used in and dates, and pages', async () => {
    const ids = async (args) => (await ok('studio_find', args)).images.map((i) => i.id);
    expect(await ids({ kind: 'town' })).toEqual([img.town.id]);
    expect(await ids({ labels: ['NISIA'] })).toEqual([img.town.id, img.map.id]);
    expect(await ids({ worldId: WORLD })).toEqual([img.map.id]);
    expect(await ids({ before: '2000-01-01' })).toEqual([]);
    expect(await ids({ after: '2000-01-01', createdBy: BUILDER })).toHaveLength(5);
    const page = await ok('studio_find', { limit: 2 });
    expect(page).toMatchObject({ total: 5, count: 2, nextOffset: 2 });
  });

  test('refuses a kind outside the list', async () => {
    expect(await refused('studio_find', { kind: 'painting' })).toMatch(/kind/);
  });
});

describe('studio_get', () => {
  test('returns the record, its uses and link, and the image to look at', async () => {
    const result = await call('studio_get', { imageId: img.map.id });
    expect(result.isError).toBeFalsy();
    const [picture, text] = result.content;
    expect(picture).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    const size = jpegJs.decode(Buffer.from(picture.data, 'base64'));
    expect([size.width, size.height]).toEqual([400, 300]);
    expect(JSON.parse(text.text)).toEqual(result.structuredContent);
    expect(result.structuredContent).toMatchObject({
      id: img.map.id,
      kind: 'worldMap',
      labels: ['nisia', 'coast'],
      link: img.map.link,
      current: 1,
      showing: 1,
      versions: [{ n: 1, width: 400, height: 300, format: 'png' }],
      usedIn: [{ worldId: WORLD, target: 'map', id: WORLD }],
    });
    expect(result.structuredContent.versions[0].path).toBeUndefined();
    expect(result.structuredContent.linkToken).toBeUndefined();
  });

  test('scales a large image to 1568 px on the long side', async () => {
    const result = await call('studio_get', { imageId: img.photo.id });
    const shown = jpegJs.decode(Buffer.from(result.content[0].data, 'base64'));
    expect([shown.width, shown.height]).toEqual([1568, 784]);
  });

  test('draws SVG, and passes small WebP on as it is', async () => {
    const drawn = await call('studio_get', { imageId: img.drawn.id });
    const shown = jpegJs.decode(Buffer.from(drawn.content[0].data, 'base64'));
    expect([shown.width, shown.height]).toEqual([1568, 1176]); // vector: drawn at full size
    const web = await call('studio_get', { imageId: img.web.id });
    expect(web.content[0]).toMatchObject({ type: 'image', mimeType: 'image/webp' });
  });

  test('refuses an unknown image or version', async () => {
    expect(await refused('studio_get', { imageId: 'img_0000000000000000' })).toMatch(
      /No image "img_0000000000000000"/
    );
    expect(await refused('studio_get', { imageId: img.map.id, version: 4 })).toMatch(
      /no version 4/
    );
    expect(await refused('studio_get', { imageId: 'not-an-id' })).toMatch(/image id/);
  });
});

describe('studio_update', () => {
  test('changes the title and labels, given whole or added and removed', async () => {
    const result = await ok('studio_update', {
      imageId: img.town.id,
      title: 'Burdendal at night',
      addLabels: ['Night', 'harbour'],
      removeLabels: ['nisia'],
    });
    expect(result.image).toMatchObject({
      title: 'Burdendal at night',
      labels: ['harbour', 'night'],
    });
    await ok('studio_update', { imageId: img.town.id, labels: ['nisia', 'harbour', 'night'] });
    expect((await record(img.town.id)).labels).toEqual(['nisia', 'harbour', 'night']);
  });

  test('changes the kind of an image nothing uses', async () => {
    const result = await ok('studio_update', { imageId: img.photo.id, kind: 'cover' });
    expect(result.image.kind).toBe('cover');
  });

  test('makes an earlier version current, and the worlds using it follow', async () => {
    await library.addVersion(img.map.id, {
      file: readImage(png(800, 400, 30)),
      createdBy: BUILDER,
      via: 'mcp',
      instruction: 'make it wider',
    });
    // Assigning the same image again refreshes the size the world holds.
    await service.assignImage(BUILDER, { worldId: WORLD, target: 'map', imageId: img.map.id });
    expect((await worldDoc()).map.image).toMatchObject({ width: 800, height: 400 });

    const result = await ok('studio_update', { imageId: img.map.id, current: 1 });
    expect(result.image).toMatchObject({ current: 1, versions: 2, width: 400, height: 300 });
    expect(result.changed).toEqual([
      { worldId: WORLD, target: 'map', id: WORLD, name: expect.any(String) },
    ]);
    expect(result.next).toMatch(/view_image/);
    expect((await worldDoc()).map.image).toMatchObject({
      imageId: img.map.id,
      link: img.map.link,
      width: 400,
      height: 300,
    });
    // The link serves version 1 again.
    const [served] = await bucket.file(currentPath(img.map.id)).download();
    expect(readImage(served)).toMatchObject({ width: 400, height: 300 });
  });

  test('refuses a kind change in use, a kind outside the list, and nothing to change', async () => {
    expect(await refused('studio_update', { imageId: img.map.id, kind: 'cover' })).toMatch(
      /in use as a worldMap image.*Unassign/
    );
    expect(await refused('studio_update', { imageId: img.town.id, kind: 'painting' })).toMatch(
      /kind/
    );
    expect(await refused('studio_update', { imageId: img.town.id })).toMatch(/Say what to change/);
    expect(
      await refused('studio_update', { imageId: img.town.id, labels: ['a'], addLabels: ['b'] })
    ).toMatch(/not both/);
    expect(await refused('studio_update', { imageId: img.town.id, current: 3 })).toMatch(
      /no version 3/
    );
    expect(await refused('studio_update', { imageId: 'img_0000000000000000', title: 'x' })).toMatch(
      /No image/
    );
    expect(await refused('studio_update', { imageId: img.town.id, labels: ['no/slash'] })).toMatch(
      /isn't a label/
    );
  });
});

test('studio_labels lists the labels in use, most used first', async () => {
  const { labels } = await ok('studio_labels');
  expect(labels).toEqual([
    { label: 'coast', count: 2 },
    { label: 'nisia', count: 2 },
    { label: 'harbour', count: 1 },
    { label: 'night', count: 1 },
  ]);
});

describe('studio_delete', () => {
  test('refuses an image in use, and an unknown one', async () => {
    expect(await refused('studio_delete', { imageId: img.map.id })).toMatch(
      /is in use: nisia-s0s0s0 \(map nisia-s0s0s0\)\. Unassign it first/
    );
    expect(await record(img.map.id)).toBeDefined();
    expect(await refused('studio_delete', { imageId: 'img_0000000000000000' })).toMatch(/No image/);
  });

  test('deletes an unused image for good, with its files', async () => {
    const result = await ok('studio_delete', { imageId: img.town.id });
    expect(result.deleted).toEqual({ id: img.town.id, title: 'Burdendal at night' });
    expect(await record(img.town.id)).toBeUndefined();
    const [files] = await bucket.getFiles({ prefix: `studio/${img.town.id}/` });
    expect(files).toEqual([]);
    expect(await refused('studio_get', { imageId: img.town.id })).toMatch(/No image/);
  });

  test('once unassigned, an image can be deleted', async () => {
    await ok('studio_unassign', { worldId: WORLD, target: 'map' });
    expect((await ok('studio_delete', { imageId: img.map.id })).deleted.id).toBe(img.map.id);
  });
});

describe('costs (L-706)', () => {
  test('every studio tool’s result carries the cost line', async () => {
    await costs.record({ model: 'gemini-2.5-flash-image', createdBy: BUILDER, via: 'mcp' });
    const spare = await add({ title: 'A spare cover', kind: 'cover' }, png(32, 32));
    const calls = {
      studio_find: { words: 'spare' },
      studio_get: { imageId: spare.id },
      studio_update: { imageId: spare.id, addLabels: ['spare'] },
      studio_labels: {},
      studio_assign: { worldId: WORLD, imageId: spare.id, target: 'cover' },
      studio_unassign: { worldId: WORLD, target: 'cover' },
      studio_delete: { imageId: spare.id },
      studio_costs: {},
    };
    const { tools } = await client.listTools();
    const studioNames = tools.map((t) => t.name).filter((n) => n.startsWith('studio_'));
    expect(Object.keys(calls).sort()).toEqual(studioNames.sort());
    for (const [name, args] of Object.entries(calls)) {
      const result = await call(name, args);
      expect(result.isError).toBeFalsy();
      expect([name, result.structuredContent.cost]).toEqual([
        name,
        { job: 0, month: 0.039, warnAt: 50 },
      ]);
      // The text Claude reads says the same.
      const text = result.content.find((item) => item.type === 'text');
      expect(JSON.parse(text.text).cost).toEqual(result.structuredContent.cost);
    }
  });

  test('studio_costs gives the month by day, model and who', async () => {
    const result = await ok('studio_costs', {});
    expect(result).toMatchObject({
      total: 0.039,
      count: 1,
      warnAt: 50,
      days: [{ usd: 0.039, count: 1 }],
      models: [{ model: 'gemini-2.5-flash-image', usd: 0.039 }],
      who: [{ uid: BUILDER, usd: 0.039, mcp: { usd: 0.039, count: 1 } }],
      recent: [expect.objectContaining({ usd: 0.039, via: 'mcp' })],
    });
    expect(await refused('studio_costs', { month: '2026-13' })).toMatch(/month/);
  });

  test('past the figure, every result warns plainly', async () => {
    await costs.record({
      model: 'imagen-4.0-generate-001',
      usd: 50,
      createdBy: BUILDER,
      via: 'page',
    });
    for (const name of ['studio_find', 'studio_labels', 'studio_costs']) {
      const { cost } = await ok(name, {});
      expect(cost.month).toBe(50.039);
      expect(cost.warning).toMatch(/WARNING: .*past the \$50\.00 warning figure/);
    }
    expect((await ok('studio_costs', {})).warning).toMatch(/past the/);
  });
});
