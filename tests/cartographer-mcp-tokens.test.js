'use strict';

/**
 * Token pictures as data over MCP (planning/tokens.md §4.1; L-931 / #789),
 * driven by a real MCP client through /mcp/cartographer against the Firestore
 * and Storage emulators: a stat block's token set, and loomGetMap sending its
 * link for every figure naming it while a group with its own shows that one;
 * the studio's "in use" (usedIn) naming the stat block, the figures and the
 * character, and letting go when a token is taken away, a group is removed
 * or a stat block deleted; set_token's crop alone, and a crop kept when the
 * image's version changes; and the refusals (a bad crop, an unknown image, an
 * image of the wrong kind, a target that isn't there).
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-tokens --verbose"
 */

const PROJECT = 'demo-cartographer-tokens';
const BUCKET = `${PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-tokens';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

jest.mock('../functions/gemini', () => ({
  callGemini: async () => ({ narration: 'Quiet.', inventedEntities: [], suggestedActions: [] }),
}));

const functionsTest = require('firebase-functions-test')(
  { projectId: PROJECT, storageBucket: BUCKET },
  null
);
const { loomCreateSave, loomGetMap } = require('../functions/index');

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
const { PNG } = require(require.resolve('pngjs', { paths: [functionsDir] }));

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

const db = getFirestore();
const bucket = getStorage().bucket(BUCKET);
const library = createLibrary({ db, bucket });
const worlds = () => db.collection('loom_worlds');
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

function png(width, height, shade = 170) {
  const img = new PNG({ width, height });
  img.data.fill(shade);
  return PNG.sync.write(img);
}
const addImage = (kind, title = `A ${kind}`) =>
  library.addImage({
    title,
    kind,
    file: readImage(png(64, 64)),
    createdBy: BUILDER,
    via: 'page',
  });
const usedIn = async (id) =>
  ((await db.collection('studio_images').doc(id).get()).data().usedIn || []).map(
    (u) => `${u.target}:${u.id}`
  );
const sub = async (worldId, collection, id) =>
  (await worlds().doc(worldId).collection(collection).doc(id).get()).data();

beforeAll(async () => {
  await db.recursiveDelete(worlds());
  await db.recursiveDelete(db.collection('studio_images'));
  await db.recursiveDelete(db.collection('loom_saves'));
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
  client = new Client({ name: 'cartographer-tokens-test', version: '0.0.0' });
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
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

describe('token pictures', () => {
  const ids = {};
  const img = {};

  beforeAll(async () => {
    img.bandit = await addImage('token', 'Bandit');
    img.chief = await addImage('portrait', 'Bandit chief');
    img.hermit = await addImage('token', 'Hermit');
    img.map = await addImage('battleMap', 'Not a token');

    // A town whose gate opens on a small battle map, where a new game lands.
    const { worldId } = await ok('create_world', { name: 'Tokens', milesPerUnit: 0.1 });
    ids.world = worldId;
    await worlds().doc(worldId).collection('battleMaps').doc(GATEWAY.id).set(GATEWAY);
    const { added } = await ok('add_locations', {
      worldId,
      locations: [
        { name: 'Ashwick', x: 300, y: 400, population: 1200, description: 'Mud lanes.' },
        { name: 'Brennock', x: 600, y: 400, population: 800, description: 'A river port.' },
      ],
    });
    ids.town = added[0].id;
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
    await ok('update_world', { worldId, openingHook: 'Dusk.', startingLocationId: ids.town });
    await ok('publish_world', { worldId });
  }, 60000);

  test('set_token is offered, writing and idempotent', async () => {
    const { tools } = await client.listTools();
    const setToken = tools.find((t) => t.name === 'set_token');
    expect(setToken.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true });
    expect(setToken.inputSchema.properties.target.enum).toEqual([
      'character',
      'statBlock',
      'figure',
    ]);
  });

  test('a stat block’s token, in use by it, and kept when the block is replaced', async () => {
    const block = { attributes: { STR: 12, DEX: 14, CON: 12, INT: 10, WIS: 10, CHA: 8 } };
    const made = await ok('set_stat_block', {
      worldId: ids.world,
      id: 'bandit',
      name: 'Bandit',
      statBlock: block,
      token: { image: img.bandit.id, crop: { x: 0.5, y: 0.35, zoom: 1.4 } },
    });
    expect(made.statBlock.token).toEqual({
      imageId: img.bandit.id,
      link: img.bandit.link,
      crop: { x: 0.5, y: 0.35, zoom: 1.4 },
    });
    expect(await usedIn(img.bandit.id)).toEqual(['statBlock:bandit']);
    // Replaced without a token: its picture stays.
    await ok('set_stat_block', { worldId: ids.world, id: 'bandit', statBlock: block });
    expect((await sub(ids.world, 'statBlocks', 'bandit')).token).toMatchObject({
      imageId: img.bandit.id,
      crop: { x: 0.5, y: 0.35, zoom: 1.4 },
    });
    const listed = await ok('list_stat_blocks', { worldId: ids.world });
    expect(listed.statBlocks[0].token.imageId).toBe(img.bandit.id);
  });

  test('figures share their stat block’s picture; a group with its own shows that one', async () => {
    const placed = await ok('place_figures', {
      worldId: ids.world,
      mapId: GATEWAY.id,
      figures: [
        {
          id: 'bandits',
          name: 'Bandit',
          statBlock: 'bandit',
          side: 'neutral',
          cells: [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
          ],
        },
        {
          id: 'chief',
          name: 'Bandit chief',
          statBlock: 'bandit',
          side: 'neutral',
          token: { image: img.chief.id, crop: { y: 0.3 } },
          cells: [{ x: 0, y: 2 }],
        },
      ],
    });
    expect(placed.figures.find((g) => g.id === 'bandits').token).toMatchObject({
      imageId: img.bandit.id,
      from: 'statBlock',
    });
    expect(placed.figures.find((g) => g.id === 'chief').token).toMatchObject({
      imageId: img.chief.id,
      from: 'own',
    });
    expect(await usedIn(img.chief.id)).toEqual([`figure:${GATEWAY.id}/chief`]);

    // A new game lands on the gate's map, the figures in sight.
    const { saveId } = await loomCreateSave.run({
      data: { worldId: ids.world, name: 'Dusk', characterName: 'Tam' },
      auth: PLAYER,
    });
    ids.save = saveId;
    const view = await loomGetMap.run({ data: { worldId: ids.world, saveId }, auth: PLAYER });
    expect(view.battleMap.id).toBe(GATEWAY.id);
    const people = Object.fromEntries(view.battleMap.people.map((p) => [p.id, p]));
    for (const id of ['fig-bandits-1', 'fig-bandits-2']) {
      expect(people[id].token).toEqual({
        link: img.bandit.link,
        crop: { x: 0.5, y: 0.35, zoom: 1.4 },
      });
    }
    expect(people['fig-chief'].token).toEqual({
      link: img.chief.link,
      crop: { x: 0.5, y: 0.3, zoom: 1 },
    });
    // Links only: never the library record.
    for (const p of view.battleMap.people) expect(Object.keys(p.token).sort()).toEqual(['crop', 'link']);
  });

  test('a changed stat block picture reaches every figure naming it', async () => {
    const other = await addImage('token', 'Bandit, again');
    const set = await ok('set_token', {
      worldId: ids.world,
      target: 'statBlock',
      id: 'bandit',
      image: other.id,
    });
    expect(set.token).toEqual({ imageId: other.id, crop: { x: 0.5, y: 0.5, zoom: 1 } });
    expect(set.previous).toEqual({ imageId: img.bandit.id });
    expect(set.usedBy).toEqual({ characters: 0, groups: 2 });
    expect(await usedIn(img.bandit.id)).toEqual([]);
    expect(await usedIn(other.id)).toEqual(['statBlock:bandit']);
    const view = await loomGetMap.run({
      data: { worldId: ids.world, saveId: ids.save },
      auth: PLAYER,
    });
    const bandit = view.battleMap.people.find((p) => p.id === 'fig-bandits-1');
    expect(bandit.token.link).toBe(other.link);
    // And back, framed on the face with the crop alone afterwards.
    await ok('set_token', {
      worldId: ids.world,
      target: 'statBlock',
      id: 'bandit',
      image: img.bandit.id,
    });
    const moved = await ok('set_token', {
      worldId: ids.world,
      target: 'statBlock',
      id: 'bandit',
      crop: { x: 0.45, y: 0.3, zoom: 2 },
    });
    expect(moved.token).toEqual({ imageId: img.bandit.id, crop: { x: 0.45, y: 0.3, zoom: 2 } });
    expect(await usedIn(img.bandit.id)).toEqual(['statBlock:bandit']);
  });

  test('a new version made current keeps the crop', async () => {
    await library.addVersion(img.bandit.id, {
      file: readImage(png(128, 128, 90)),
      createdBy: BUILDER,
      via: 'page',
    });
    // As studio_update does when it makes a version current: assigned again.
    await service.assignImage(BUILDER, {
      worldId: ids.world,
      target: 'statBlock',
      id: 'bandit',
      imageId: img.bandit.id,
    });
    expect((await sub(ids.world, 'statBlocks', 'bandit')).token).toMatchObject({
      imageId: img.bandit.id,
      width: 128,
      crop: { x: 0.45, y: 0.3, zoom: 2 },
    });
  });

  test('a character’s token, from add_character, shown by get_character, taken away', async () => {
    const added = await ok('add_character', {
      worldId: ids.world,
      name: 'The Hermit',
      description: 'A recluse.',
      worldPoint: { x: 450, y: 420 },
      token: { image: img.hermit.id },
    });
    const id = added.character.id;
    expect(await usedIn(img.hermit.id)).toEqual([`character:${id}`]);
    const read = await ok('get_character', { worldId: ids.world, characterId: id });
    expect(read.token).toEqual({
      imageId: img.hermit.id,
      link: img.hermit.link,
      crop: { x: 0.5, y: 0.5, zoom: 1 },
      from: 'own',
    });
    // Naming the stat block, with none of their own: the block's.
    await ok('update_character', { worldId: ids.world, characterId: id, token: null });
    expect(await usedIn(img.hermit.id)).toEqual([]);
    await ok('set_sheets', {
      worldId: ids.world,
      sheets: [{ characterId: id, statBlock: 'bandit' }],
    });
    const named = await ok('get_character', { worldId: ids.world, characterId: id });
    expect(named.token).toMatchObject({ imageId: img.bandit.id, from: 'statBlock' });
    // set_sheets with a token alone.
    await ok('set_sheets', {
      worldId: ids.world,
      sheets: [{ characterId: id, token: { image: img.hermit.id, crop: { zoom: 1.2 } } }],
    });
    expect((await sub(ids.world, 'characters', id)).token).toMatchObject({
      imageId: img.hermit.id,
      crop: { zoom: 1.2 },
    });
    expect(await usedIn(img.hermit.id)).toEqual([`character:${id}`]);
    ids.hermit = id;
  });

  test('refusals: a bad crop, an unknown image, the wrong kind, a target not there', async () => {
    expect(
      await refused('set_token', {
        worldId: ids.world,
        target: 'statBlock',
        id: 'bandit',
        image: img.bandit.id,
        crop: { x: 1.5 },
      })
    ).toMatch(/crop\.x .*from 0 to 1/);
    expect(
      await refused('set_stat_block', {
        worldId: ids.world,
        id: 'bandit',
        statBlock: { attributes: { STR: 12, DEX: 14, CON: 12, INT: 10, WIS: 10, CHA: 8 } },
        token: { image: img.bandit.id, crop: { zoom: 0.2 } },
      })
    ).toMatch(/token\.crop\.zoom/);
    expect(
      await refused('set_token', {
        worldId: ids.world,
        target: 'character',
        id: ids.hermit,
        image: 'img_0000000000000000',
      })
    ).toMatch(/img_0000000000000000/);
    expect(
      await refused('update_character', {
        worldId: ids.world,
        characterId: ids.hermit,
        token: { image: 'img_0000000000000000' },
      })
    ).toMatch(/no image "img_0000000000000000"/);
    expect(
      await refused('set_token', {
        worldId: ids.world,
        target: 'statBlock',
        id: 'bandit',
        image: img.map.id,
      })
    ).toMatch(/battleMap image; a token takes a token or portrait image/);
    expect(
      await refused('place_figures', {
        worldId: ids.world,
        mapId: GATEWAY.id,
        figures: [
          {
            id: 'bandits',
            name: 'Bandit',
            statBlock: 'bandit',
            token: { image: img.map.id },
            cells: [{ x: 0, y: 0 }],
          },
        ],
      })
    ).toMatch(/figures\[0\]\.token: .*token or portrait/);
    expect(
      await refused('set_token', {
        worldId: ids.world,
        target: 'figure',
        id: `${GATEWAY.id}/wolves`,
        image: img.bandit.id,
      })
    ).toMatch(/No figures "wolves"/);
    expect(
      await refused('set_token', {
        worldId: ids.world,
        target: 'statBlock',
        id: 'ogre',
        image: img.bandit.id,
      })
    ).toMatch(/No stat block "ogre"/);
    // Nothing was changed by any of them.
    expect(await usedIn(img.map.id)).toEqual([]);
    expect((await sub(ids.world, 'statBlocks', 'bandit')).token.crop).toEqual({
      x: 0.45,
      y: 0.3,
      zoom: 2,
    });
  });

  test('a group removed, or a stat block deleted, lets its image go', async () => {
    await ok('place_figures', {
      worldId: ids.world,
      mapId: GATEWAY.id,
      figures: [
        {
          id: 'bandits',
          name: 'Bandit',
          statBlock: 'bandit',
          side: 'neutral',
          cells: [{ x: 0, y: 0 }],
        },
      ],
    });
    expect(await usedIn(img.chief.id)).toEqual([]);
    // Nobody names it now: deleted, its image let go.
    await ok('place_figures', { worldId: ids.world, mapId: GATEWAY.id, figures: [] });
    await ok('set_sheets', {
      worldId: ids.world,
      sheets: [
        {
          characterId: ids.hermit,
          statBlock: { attributes: { STR: 8, DEX: 8, CON: 8, INT: 14, WIS: 16, CHA: 10 } },
        },
      ],
    });
    await ok('set_stat_block', { worldId: ids.world, id: 'bandit', statBlock: null });
    expect(await usedIn(img.bandit.id)).toEqual([]);
    // The hermit keeps theirs.
    expect(await usedIn(img.hermit.id)).toEqual([`character:${ids.hermit}`]);
  });
});
