'use strict';

/**
 * Art sets over MCP (planning/game-art.md §4.3, AR3; L-944 / #798), driven by
 * a real MCP client through /mcp/cartographer against the Firestore and
 * Storage emulators: list_art_sets lists the sets, the built-in `classic`
 * the default, each with how much it paints; update_world sets a world's set
 * (art.set), refusing one there isn't; get_world and list_art_sets with a
 * worldId say which set a world uses; loomGetMap's view carries it; and a
 * world naming a set there isn't is drawn with `classic`, with a warning.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-art-sets --verbose"
 */

const PROJECT = 'demo-cartographer-art-sets';
const BUCKET = `${PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-art-sets';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

jest.mock('../functions/gemini', () => ({ callGemini: jest.fn() }));

const functionsTest = require('firebase-functions-test')(
  { projectId: PROJECT, storageBucket: BUCKET },
  null
);
// Loading the functions initializes the Admin app the tools use.
require('../functions/index');

const path = require('path');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { getStorage } = require(
  require.resolve('firebase-admin/storage', { paths: [functionsDir] })
);

const loomCanon = require('../functions/loom-canon');
const catalog = require('../functions/loom-canon/materials');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const { createCartographerService } = require('../functions/cartographer/service');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');
const { createInMemoryAuditLog } = require('../functions/mcp/audit');

const CANONICAL = 'https://bcoletech.com';
const AUD = `${CANONICAL}/mcp/cartographer`;
const BUILDER = 'builder-001';

const db = getFirestore();
const bucket = getStorage().bucket(BUCKET);
const worlds = () => db.collection('loom_worlds');
const writer = createFirestoreWorldWriter(() => db);
const service = createCartographerService({ db, bucket, writer });

const systems = { get: async (id) => BUILT_IN[id] || null };
const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader: createFirestoreWorldReader(() => db),
    writer,
    systems,
    studio: { assign: (uid, args) => service.assignImage(uid, args) },
  })
);
const oauthStore = createInMemoryStore();
const audit = createInMemoryAuditLog();

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

const worldDoc = async (id) => (await worlds().doc(id).get()).data();
const loaded = (worldId) => loomCanon.loadWorld(worldId, { db, playableOnly: false });

beforeAll(async () => {
  await db.recursiveDelete(worlds());
  await db.recursiveDelete(db.collection('studio_images'));
  const app = express();
  app.use(express.json());
  app.all('/mcp/:appId', (req, res) =>
    handleAppRequest(req, res, {
      registry,
      appId: req.params.appId,
      getGrant: (grantId) => oauthStore.getGrant(grantId),
      audit,
    })
  );
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  oauthStore._debug.grants.set('grant-builder', {
    grantId: 'grant-builder',
    uid: BUILDER,
    appId: 'cartographer',
    revoked: false,
  });
  const token = signAccessToken({
    uid: BUILDER,
    audience: AUD,
    scope: 'mcp:cartographer',
    issuer: CANONICAL,
    grantId: 'grant-builder',
  });
  client = new Client({ name: 'cartographer-art-sets-test', version: '0.0.0' });
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
  await db.recursiveDelete(worlds());
  await db.recursiveDelete(db.collection('studio_images'));
  functionsTest.cleanup();
});

const fs = require('fs');
const artSets = require('../functions/loom-canon/art-sets');

// A second set the server serves, for the test: the fixtures' own.
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/art-sets/files/manifest.json'), 'utf8')
);

describe('art sets', () => {
  let worldId;

  beforeAll(async () => {
    expect(catalog.registerSet(FIXTURE)).toEqual([]);
    artSets.SETS[FIXTURE.name] = FIXTURE;
    const made = await ok('create_world', { name: 'Gallery', backdrop: { colour: '#101828' } });
    worldId = made.worldId;
  });

  afterAll(() => {
    delete artSets.SETS[FIXTURE.name];
  });

  test('list_art_sets lists the sets, read-only, classic the default', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'list_art_sets');
    expect(tool.annotations.readOnlyHint).toBe(true);
    const { sets } = await ok('list_art_sets', {});
    expect(sets.find((s) => s.name === 'classic')).toMatchObject({
      name: 'classic',
      title: 'Classic',
      default: true,
      counts: { materials: 0, standing: 0, atlases: 0 },
    });
    expect(sets.find((s) => s.name === 'fixture-files')).toMatchObject({
      default: false,
      counts: { materials: 1, faces: 1, standing: 2, fromAbove: 0 },
    });
  });

  test('a world is drawn with classic until it names another', async () => {
    expect((await ok('get_world', { worldId })).art).toEqual({ set: 'classic' });
    expect((await ok('list_art_sets', { worldId })).world).toEqual({ set: 'classic' });
  });

  test('update_world sets a world’s art set, and get_world and list_art_sets say so', async () => {
    const result = await ok('update_world', { worldId, art: { set: 'fixture-files' } });
    expect(result.updated).toEqual(['art.set']);
    expect(result.art).toEqual({ set: 'fixture-files' });
    expect((await worldDoc(worldId)).art).toEqual({ set: 'fixture-files' });
    expect((await ok('get_world', { worldId })).art).toEqual({ set: 'fixture-files' });
    expect((await ok('list_art_sets', { worldId })).world).toEqual({ set: 'fixture-files' });
    // The world as the Loom loads it, and as loomGetMap sends it.
    const world = await loaded(worldId);
    expect(world.art).toEqual({ set: 'fixture-files' });
    expect(artSets.setFor(world)).toEqual({ name: 'fixture-files' });
    // Setting it again changes nothing.
    expect((await ok('update_world', { worldId, art: { set: 'fixture-files' } })).updated).toEqual(
      []
    );
    // And back.
    expect((await ok('update_world', { worldId, art: { set: 'classic' } })).updated).toEqual([
      'art.set',
    ]);
  });

  test('a set there isn’t is refused, saying which there are', async () => {
    const text = await refused('update_world', { worldId, art: { set: 'velvet' } });
    expect(text).toMatch(/No art set "velvet"/);
    expect(text).toMatch(/classic/);
    expect(await refused('update_world', { worldId, art: { set: 'Not A Name' } })).toMatch(/set/i);
  });

  test('a world naming a set there isn’t is drawn with classic, with a warning', async () => {
    await worlds().doc(worldId).update({ 'art.set': 'retired-set' });
    const overview = await ok('get_world', { worldId });
    expect(overview.art.set).toBe('classic');
    expect(overview.art.warning).toMatch(/"retired-set".*"classic"/);
    expect((await ok('list_art_sets', { worldId })).world.set).toBe('classic');
    await worlds().doc(worldId).update({ 'art.set': 'classic' });
  });
});
