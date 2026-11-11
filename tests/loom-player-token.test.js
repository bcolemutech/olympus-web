'use strict';

/**
 * The player's token (planning/tokens.md §4.3, TK2; L-933 / #791), against
 * the Firestore and Storage emulators, with a real MCP client for the
 * world's side:
 *
 *   - set_world_tokens sets the portraits a world offers players, in use by
 *     it in the studio, and get_world shows them; studio_assign (target
 *     playerToken) adds one and studio_unassign takes it away; the refusals;
 *   - loomCreationRules lists them, and picking one at creation sets the
 *     save's token, which loomGetMap sends (and on the battle map as yours);
 *   - changing it later (a token turn) costs no AP and no time and records
 *     no turn; a crop alone moves the circle; null takes it away;
 *   - loomUploadToken stores a 512 px square WebP with no metadata, readable
 *     at loom_tokens/{uid}/{saveId}.webp; a non-image, a file over 5 MB and
 *     another player's save are refused;
 *   - deleting the save deletes the file.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-player-token --verbose"
 */

const PROJECT = 'demo-loom-player-token';
const BUCKET = `${PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-loom-player-token';
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
  loomCreationRules,
  loomGetMap,
  loomPlayTurn,
  loomUploadToken,
  loomDeleteSave,
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
const sharp = require(require.resolve('sharp', { paths: [functionsDir] }));

const { BUILT_IN } = require('../functions/loom-canon/systems');
const { createLibrary } = require('../functions/studio/library');
const { readImage } = require('../functions/studio/formats');
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
const OTHER = { uid: 'player-002', token: { apps: ['loom'] } };

const db = getFirestore();
const bucket = getStorage().bucket(BUCKET);
const library = createLibrary({ db, bucket });
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

const solid = (width, height, background) =>
  sharp({ create: { width, height, channels: 3, background } });
const addImage = async (kind, title = `A ${kind}`) =>
  library.addImage({
    title,
    kind,
    file: readImage(await solid(64, 64, '#888').png().toBuffer()),
    createdBy: BUILDER,
    via: 'page',
  });
const usedIn = async (id) =>
  ((await db.collection('studio_images').doc(id).get()).data().usedIn || []).map(
    (u) => `${u.target}:${u.id}`
  );
const saveOf = async (id) => (await saves().doc(id).get()).data();
const turnsOf = async (id) => (await saves().doc(id).collection('loom_turns').get()).size;
const fileExists = async (p) => (await bucket.file(p).exists())[0];

beforeAll(async () => {
  await db.recursiveDelete(worlds());
  await db.recursiveDelete(db.collection('studio_images'));
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
  client = new Client({ name: 'loom-player-token-test', version: '0.0.0' });
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
  await db.recursiveDelete(saves());
  functionsTest.cleanup();
});

describe("the player's token", () => {
  const ids = {};
  const img = {};

  beforeAll(async () => {
    img.knight = await addImage('portrait', 'Knight');
    img.ranger = await addImage('token', 'Ranger');
    img.mage = await addImage('portrait', 'Mage');
    img.map = await addImage('battleMap', 'Not a portrait');

    // A town whose gate opens on a small battle map, where a new game lands.
    const { worldId } = await ok('create_world', { name: 'Faces', milesPerUnit: 0.1 });
    ids.world = worldId;
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
  }, 60000);

  test('set_world_tokens sets the portraits offered, in use by the world', async () => {
    const set = await ok('set_world_tokens', {
      worldId: ids.world,
      player: [
        { image: img.knight.id, crop: { x: 0.5, y: 0.3, zoom: 1.5 } },
        { image: img.ranger.id },
      ],
    });
    expect(set.player).toEqual([
      { imageId: img.knight.id, link: img.knight.link, crop: { x: 0.5, y: 0.3, zoom: 1.5 } },
      { imageId: img.ranger.id, link: img.ranger.link, crop: { x: 0.5, y: 0.5, zoom: 1 } },
    ]);
    expect(await usedIn(img.knight.id)).toEqual([`playerToken:${img.knight.id}`]);
    expect(await usedIn(img.ranger.id)).toEqual([`playerToken:${img.ranger.id}`]);
    const world = await ok('get_world', { worldId: ids.world });
    expect(world.tokens.player.map((t) => t.imageId)).toEqual([img.knight.id, img.ranger.id]);
  });

  test('studio_assign adds one, studio_unassign takes it away; the refusals', async () => {
    await ok('studio_assign', { worldId: ids.world, imageId: img.mage.id, target: 'playerToken' });
    let world = await ok('get_world', { worldId: ids.world });
    expect(world.tokens.player.map((t) => t.imageId)).toEqual([
      img.knight.id,
      img.ranger.id,
      img.mage.id,
    ]);
    expect(await usedIn(img.mage.id)).toEqual([`playerToken:${img.mage.id}`]);
    await ok('studio_unassign', { worldId: ids.world, target: 'playerToken', id: img.mage.id });
    world = await ok('get_world', { worldId: ids.world });
    expect(world.tokens.player.map((t) => t.imageId)).toEqual([img.knight.id, img.ranger.id]);
    expect(await usedIn(img.mage.id)).toEqual([]);

    expect(
      await refused('studio_assign', {
        worldId: ids.world,
        imageId: img.map.id,
        target: 'playerToken',
      })
    ).toMatch(/token or portrait/);
    expect(
      await refused('set_world_tokens', {
        worldId: ids.world,
        player: [{ image: img.map.id }],
      })
    ).toMatch(/token or portrait/);
    expect(
      await refused('set_world_tokens', {
        worldId: ids.world,
        player: [{ image: img.knight.id }, { image: img.knight.id }],
      })
    ).toMatch(/twice/);
    expect(
      await refused('set_world_tokens', {
        worldId: ids.world,
        player: [{ image: img.knight.id, crop: { x: 2 } }],
      })
    ).toMatch(/from 0 to 1/);
    // A list replaced lets go of those left out.
    await ok('set_world_tokens', { worldId: ids.world, player: [{ image: img.mage.id }] });
    expect(await usedIn(img.knight.id)).toEqual([]);
    await ok('set_world_tokens', {
      worldId: ids.world,
      player: [
        { image: img.knight.id, crop: { x: 0.5, y: 0.3, zoom: 1.5 } },
        { image: img.ranger.id },
      ],
    });
    expect(await usedIn(img.mage.id)).toEqual([]);
  });

  test('picking a portrait at creation sets the token, which loomGetMap sends', async () => {
    const rules = await loomCreationRules.run({ data: { worldId: ids.world }, auth: PLAYER });
    expect(rules.portraits).toEqual([
      { id: img.knight.id, link: img.knight.link, crop: { x: 0.5, y: 0.3, zoom: 1.5 } },
      { id: img.ranger.id, link: img.ranger.link, crop: { x: 0.5, y: 0.5, zoom: 1 } },
    ]);

    const { saveId } = await loomCreateSave.run({
      data: {
        worldId: ids.world,
        name: 'Dusk',
        characterName: 'Tam',
        token: { image: img.knight.id, crop: { x: 0.45, y: 0.3, zoom: 2 } },
      },
      auth: PLAYER,
    });
    ids.save = saveId;
    expect((await saveOf(saveId)).character.token).toMatchObject({
      imageId: img.knight.id,
      link: img.knight.link,
      crop: { x: 0.45, y: 0.3, zoom: 2 },
    });
    const view = await loomGetMap.run({ data: { worldId: ids.world, saveId }, auth: PLAYER });
    const sent = { link: img.knight.link, crop: { x: 0.45, y: 0.3, zoom: 2 } };
    expect(view.token).toEqual(sent);
    expect(view.battleMap.you).toEqual({ token: sent });

    // One the world doesn't offer is refused.
    const bad = await refusal(
      loomCreateSave.run({
        data: {
          worldId: ids.world,
          name: 'Dusk',
          characterName: 'Tam',
          token: { image: img.mage.id },
        },
        auth: PLAYER,
      })
    );
    expect(bad.code).toBe('invalid-argument');
    expect(bad.message).toMatch(/isn't one this world offers/);
  });

  test('changing it later costs no AP and no time, and records no turn', async () => {
    const before = await saveOf(ids.save);
    const turns = await turnsOf(ids.save);
    const play = (token) =>
      loomPlayTurn.run({
        data: { worldId: ids.world, saveId: ids.save, action: { verb: 'token', token } },
        auth: PLAYER,
      });

    const changed = await play({ image: img.ranger.id });
    expect(changed.refused).toBeUndefined();
    expect(changed.token).toEqual({ link: img.ranger.link, crop: { x: 0.5, y: 0.5, zoom: 1 } });
    let after = await saveOf(ids.save);
    expect(after.character.token.imageId).toBe(img.ranger.id);
    expect(after.turn).toEqual(before.turn);
    expect(after.time || 0).toBe(before.time || 0);
    expect(await turnsOf(ids.save)).toBe(turns);

    // A crop alone moves the circle on the token they have.
    const moved = await play({ crop: { x: 0.4, y: 0.35, zoom: 1.2 } });
    expect(moved.token.crop).toEqual({ x: 0.4, y: 0.35, zoom: 1.2 });
    after = await saveOf(ids.save);
    expect(after.character.token).toMatchObject({
      imageId: img.ranger.id,
      crop: { x: 0.4, y: 0.35, zoom: 1.2 },
    });

    // One the world doesn't offer: refused, nothing changed.
    const no = await play({ image: img.mage.id });
    expect(no.refused).toBe(true);
    expect((await saveOf(ids.save)).character.token.imageId).toBe(img.ranger.id);

    // null takes it away.
    const gone = await play(null);
    expect(gone.token).toBeNull();
    after = await saveOf(ids.save);
    expect(after.character.token).toBeUndefined();
    expect(after.turn).toEqual(before.turn);
    expect(await turnsOf(ids.save)).toBe(turns);

    // A token turn that isn't one.
    const malformed = await refusal(
      loomPlayTurn.run({
        data: {
          worldId: ids.world,
          saveId: ids.save,
          action: { verb: 'token', token: { image: 'not-an-image' } },
        },
        auth: PLAYER,
      })
    );
    expect(malformed.code).toBe('invalid-argument');
  });

  test('an upload is stored square at 512 px as WebP, with no metadata', async () => {
    // A wide JPEG with EXIF, the face on its right.
    const jpeg = await solid(1200, 600, '#336')
      .composite([
        {
          input: await solid(300, 300, '#e94').png().toBuffer(),
          left: 800,
          top: 150,
        },
      ])
      .withMetadata({ exif: { IFD0: { Copyright: 'Someone', Artist: 'Someone' } } })
      .jpeg()
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    const result = await loomUploadToken.run({
      data: {
        saveId: ids.save,
        image: jpeg.toString('base64'),
        crop: { x: 950 / 1200, y: 0.5, zoom: 2 },
      },
      auth: PLAYER,
    });
    const file = `loom_tokens/${PLAYER.uid}/${ids.save}.webp`;
    expect(result.token).toMatchObject({ file, crop: { x: 0.5, y: 0.5, zoom: 1 } });
    expect(typeof result.token.version).toBe('number');

    const [stored] = await bucket.file(file).download();
    const meta = await sharp(stored).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 512, height: 512 });
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    const [fileMeta] = await bucket.file(file).getMetadata();
    expect(fileMeta.contentType).toBe('image/webp');
    // Cut at the crop: the face fills it.
    const { data } = await sharp(stored).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(200); // orange, not the blue around it

    expect((await saveOf(ids.save)).character.token).toMatchObject({
      file,
      width: 512,
      height: 512,
      format: 'webp',
    });
    const view = await loomGetMap.run({
      data: { worldId: ids.world, saveId: ids.save },
      auth: PLAYER,
    });
    expect(view.token).toEqual(result.token);
    expect(view.battleMap.you.token).toEqual(result.token);
    expect(Object.keys(view.token).sort()).toEqual(['crop', 'file', 'version']);
  });

  test('a non-image, a file over 5 MB and another player’s save are refused', async () => {
    const png = await solid(64, 64, '#888').png().toBuffer();
    const upload = (data, auth = PLAYER) => refusal(loomUploadToken.run({ data, auth }));

    const text = await upload({
      saveId: ids.save,
      image: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),
    });
    expect(text).toMatchObject({ code: 'invalid-argument' });
    expect(text.message).toMatch(/isn’t a picture/);
    const junk = await upload({
      saveId: ids.save,
      image: Buffer.concat([png.subarray(0, 40), Buffer.alloc(200, 7)]).toString('base64'),
    });
    expect(junk.message).toMatch(/isn’t a picture/);

    const big = await upload({
      saveId: ids.save,
      image: Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]).toString('base64'),
    });
    expect(big.code).toBe('invalid-argument');
    expect(big.message).toMatch(/larger than 5 MB/);

    const theirs = await upload({ saveId: ids.save, image: png.toString('base64') }, OTHER);
    expect(theirs.code).toBe('permission-denied');
    expect(await fileExists(`loom_tokens/${OTHER.uid}/${ids.save}.webp`)).toBe(false);

    const crop = await upload({
      saveId: ids.save,
      image: png.toString('base64'),
      crop: { zoom: 0.5 },
    });
    expect(crop.code).toBe('invalid-argument');

    const none = await upload({ saveId: 'no-such-save', image: png.toString('base64') });
    expect(none.code).toBe('not-found');

    // Their token is the upload still.
    expect((await saveOf(ids.save)).character.token.file).toBeDefined();
  });

  test('picking a portrait over an upload deletes its file', async () => {
    const file = `loom_tokens/${PLAYER.uid}/${ids.save}.webp`;
    expect(await fileExists(file)).toBe(true);
    // Re-cropping keeps it.
    await loomPlayTurn.run({
      data: {
        worldId: ids.world,
        saveId: ids.save,
        action: { verb: 'token', token: { crop: { x: 0.5, y: 0.5, zoom: 1.5 } } },
      },
      auth: PLAYER,
    });
    expect(await fileExists(file)).toBe(true);
    await loomPlayTurn.run({
      data: {
        worldId: ids.world,
        saveId: ids.save,
        action: { verb: 'token', token: { image: img.knight.id } },
      },
      auth: PLAYER,
    });
    expect(await fileExists(file)).toBe(false);
  });

  test('deleting the save deletes the file', async () => {
    const { saveId } = await loomCreateSave.run({
      data: { worldId: ids.world, name: 'Dawn', characterName: 'Ida' },
      auth: PLAYER,
    });
    const png = await solid(300, 200, '#4a4').png().toBuffer();
    await loomUploadToken.run({
      data: { saveId, image: png.toString('base64') },
      auth: PLAYER,
    });
    const file = `loom_tokens/${PLAYER.uid}/${saveId}.webp`;
    expect(await fileExists(file)).toBe(true);
    // Not by anyone else.
    const theirs = await refusal(loomDeleteSave.run({ data: { saveId }, auth: OTHER }));
    expect(theirs.code).toBe('permission-denied');
    expect(await fileExists(file)).toBe(true);

    await loomDeleteSave.run({ data: { saveId }, auth: PLAYER });
    expect(await fileExists(file)).toBe(false);
    expect((await saves().doc(saveId).get()).exists).toBe(false);
  });
});
