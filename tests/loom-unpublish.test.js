'use strict';

/**
 * Unpublishing worlds (isometric view WD1; L-957 / #863), against the
 * Firestore and Storage emulators, with a real MCP client for the builder:
 *
 *   - unpublish_world takes a published world back to draft, kept whole; a
 *     draft, an unknown world and a stranger are refused;
 *   - the Loom's list (published worlds) and loomWorldRatings leave it out;
 *   - a save in it is refused a turn and a map with the plain message, and
 *     nothing in the save changes;
 *   - publish_world publishes it again and the same save plays on;
 *   - the Cartographer page's callable does the same.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-unpublish --verbose"
 */

const PROJECT = 'demo-loom-unpublish';
const BUCKET = `${PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-loom-unpublish';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

jest.mock('../functions/gemini', () => ({
  callGemini: async () => ({ narration: 'Quiet.', inventedEntities: [], suggestedActions: [] }),
}));

const functionsTest = require('firebase-functions-test')(
  { projectId: PROJECT, storageBucket: BUCKET },
  null
);
const {
  loomCreateSave,
  loomGetMap,
  loomPlayTurn,
  loomWorldRatings,
  cartographerUnpublish,
  cartographerPublish,
} = require('../functions/index');

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
const { GATEWAY } = require('./helpers/towns');

const CANONICAL = 'https://bcoletech.com';
const AUD = `${CANONICAL}/mcp/cartographer`;
const BUILDER = 'builder-001';
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };
const STRANGER = { uid: 'stranger-001', token: { apps: ['loom'] } };
const CARTOGRAPHER = { uid: BUILDER, token: { apps: ['cartographer'] } };

const db = getFirestore();
const bucket = getStorage().bucket(BUCKET);
const worlds = () => db.collection('loom_worlds');
const saves = () => db.collection('loom_saves');
const writer = createFirestoreWorldWriter(() => db);
const service = createCartographerService({ db, bucket, writer });

const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader: createFirestoreWorldReader(() => db),
    writer,
    systems: { get: async (id) => BUILT_IN[id] || null },
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
// A callable's refusal: its code and message.
async function refusal(promise) {
  try {
    await promise;
  } catch (err) {
    return { code: err.code, message: err.message };
  }
  throw new Error('expected a refusal');
}

const saveOf = async (id) => (await saves().doc(id).get()).data();
const turnsOf = async (id) => (await saves().doc(id).collection('loom_turns').get()).size;
const statusOf = async (id) => (await worlds().doc(id).get()).data().status;
// What the Loom's world list reads: published worlds only.
const listed = async () =>
  (await worlds().where('status', '==', 'published').get()).docs.map((d) => d.id);
const entityCount = async (id) =>
  (await worlds().doc(id).collection('locations').get()).size +
  (await worlds().doc(id).collection('places').get()).size;

beforeAll(async () => {
  await db.recursiveDelete(worlds());
  await db.recursiveDelete(saves());
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
  client = new Client({ name: 'loom-unpublish-test', version: '0.0.0' });
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
  await db.recursiveDelete(saves());
  functionsTest.cleanup();
});

// A published two-town world with a game started in it.
async function publishedWorldWithSave(name) {
  const { worldId } = await ok('create_world', { name, milesPerUnit: 0.1 });
  await worlds().doc(worldId).collection('battleMaps').doc(GATEWAY.id).set(GATEWAY);
  const { added } = await ok('add_locations', {
    worldId,
    locations: [
      { name: 'Ashwick', x: 300, y: 400, population: 1200, description: 'Mud lanes.' },
      { name: 'Brennock', x: 600, y: 400, population: 800, description: 'A river port.' },
    ],
  });
  await ok('connect_locations', {
    worldId,
    links: [{ fromId: added[0].id, toId: added[1].id, via: 'road' }],
  });
  for (const a of added) {
    await ok('add_place', {
      worldId,
      locationId: a.id,
      name: `${a.name} Gate`,
      kind: 'gate',
      description: 'A gate on the road.',
      entranceFor: ['road'],
      battleMap: GATEWAY.id,
    });
  }
  await ok('update_world', { worldId, openingHook: 'Dusk.', startingLocationId: added[0].id });
  await ok('publish_world', { worldId });
  const { saveId } = await loomCreateSave.run({
    data: { worldId, name: 'Dusk', characterName: 'Tam' },
    auth: PLAYER,
  });
  return { worldId, saveId };
}

describe('unpublish_world', () => {
  let world;
  let saveId;

  beforeAll(async () => {
    ({ worldId: world, saveId } = await publishedWorldWithSave('Reworked'));
  }, 60000);

  test('is a tool of the connector', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('unpublish_world');
  });

  test('refuses a draft and an unknown world', async () => {
    const { worldId: draft } = await ok('create_world', { name: 'Never Published' });
    expect(await refused('unpublish_world', { worldId: draft })).toMatch(
      /Only a published world can be unpublished \(this world is draft\)/
    );
    expect(await refused('unpublish_world', { worldId: 'nowhere-000000' })).toMatch(
      /World not found/
    );
  });

  test('takes a published world back to draft, kept whole, and out of the Loom’s list', async () => {
    expect(await listed()).toContain(world);
    const before = await entityCount(world);
    const canonBefore = (await worlds().doc(world).get()).data().canonVersion;

    expect(await ok('unpublish_world', { worldId: world })).toMatchObject({
      worldId: world,
      status: 'draft',
    });

    const meta = (await worlds().doc(world).get()).data();
    expect(meta).toMatchObject({
      status: 'draft',
      openingHook: 'Dusk.',
      unpublishedBy: BUILDER,
      canonVersion: canonBefore + 1,
    });
    expect(typeof meta.unpublishedAtMs).toBe('number');
    expect(await entityCount(world)).toBe(before);
    expect(await listed()).not.toContain(world);
    // It can't be unpublished twice.
    expect(await refused('unpublish_world', { worldId: world })).toMatch(
      /Only a published world can be unpublished \(this world is draft\)/
    );
  });

  test('loomWorldRatings leaves it out', async () => {
    const { ratings } = await loomWorldRatings.run({ data: { worldIds: [world] }, auth: PLAYER });
    expect(ratings).toEqual({});
  });

  test('a save in it is refused a turn and a map with the plain message, and keeps its data', async () => {
    const before = await saveOf(saveId);
    const turns = await turnsOf(saveId);
    const message = expect.stringMatching(/being reworked.*published again.*kept as it is/);

    expect(
      await refusal(
        loomPlayTurn.run({
          data: { worldId: world, saveId, actionText: 'look around' },
          auth: PLAYER,
        })
      )
    ).toEqual({ code: 'failed-precondition', message });
    expect(
      await refusal(loomGetMap.run({ data: { worldId: world, saveId }, auth: PLAYER }))
    ).toEqual({ code: 'failed-precondition', message });

    expect(await saveOf(saveId)).toEqual(before);
    expect(await turnsOf(saveId)).toBe(turns);
  });

  test('another player’s save and a new game are still refused as before', async () => {
    expect(
      (
        await refusal(
          loomCreateSave.run({
            data: { worldId: world, name: 'Late', characterName: 'Ivo' },
            auth: PLAYER,
          })
        )
      ).code
    ).toBe('not-found');
    expect(
      (
        await refusal(
          loomPlayTurn.run({
            data: { worldId: world, saveId, actionText: 'look around' },
            auth: STRANGER,
          })
        )
      ).code
    ).toBe('permission-denied');
  });

  test('publish_world publishes it again and the same save plays on', async () => {
    const before = await saveOf(saveId);
    expect(await ok('publish_world', { worldId: world })).toMatchObject({
      worldId: world,
      status: 'published',
    });
    expect(await listed()).toContain(world);

    const view = await loomGetMap.run({ data: { worldId: world, saveId }, auth: PLAYER });
    expect(view.worldId).toBe(world);
    const turns = await turnsOf(saveId);
    const played = await loomPlayTurn.run({
      data: { worldId: world, saveId, actionText: 'look around' },
      auth: PLAYER,
    });
    expect(played.narration).toBeTruthy();
    expect(await turnsOf(saveId)).toBe(turns + 1);
    const after = await saveOf(saveId);
    expect(after.character.name).toBe(before.character.name);
    expect(after.worldId).toBe(world);
  });
});

describe('cartographerUnpublish', () => {
  test('is the page’s button: unpublishes for a cartographer, and no one else', async () => {
    const { worldId } = await publishedWorldWithSave('From The Page');

    await expect(
      cartographerUnpublish.run({ data: { worldId }, auth: PLAYER })
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(cartographerUnpublish.run({ data: { worldId } })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(await statusOf(worldId)).toBe('published');

    await expect(
      cartographerUnpublish.run({ data: { worldId: 'Bad Id' }, auth: CARTOGRAPHER })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(
      cartographerUnpublish.run({ data: { worldId }, auth: CARTOGRAPHER })
    ).resolves.toEqual({ worldId, status: 'draft' });
    expect(await statusOf(worldId)).toBe('draft');
    await expect(
      cartographerUnpublish.run({ data: { worldId }, auth: CARTOGRAPHER })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Publishing from the page works as before.
    await expect(
      cartographerPublish.run({ data: { worldId }, auth: CARTOGRAPHER })
    ).resolves.toEqual({ worldId, status: 'published' });
  });
});
