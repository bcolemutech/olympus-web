'use strict';

/**
 * Cloud Storage security rules (C-1 / #368): Cartographer map uploads and
 * world map images. Runs against the Storage emulator.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest storage-rules --verbose"
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve } = require('path');

const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'demo-olympus-rules-test';

const BUILDER = 'builder-001';
const UPLOAD = 'upload-0001';
const JSON_TYPE = { contentType: 'application/json' };
const PNG_TYPE = { contentType: 'image/png' };
const bytes = (n) => new Uint8Array(n);

let testEnv;

beforeAll(async () => {
  const [host, port] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199').split(':');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      rules: readFileSync(resolve(__dirname, '../storage.rules'), 'utf8'),
      host,
      port: parseInt(port, 10),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearStorage();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref('worlds/nisia-000001/map.png').put(bytes(16), PNG_TYPE);
    await ctx.storage().ref('worlds/nisia-000001/town-loc_1-abc123.png').put(bytes(16), PNG_TYPE);
    await ctx.storage().ref(`cartographer/${BUILDER}/${UPLOAD}/map.json`).put(bytes(16), JSON_TYPE);
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const storageAs = (uid, apps) => testEnv.authenticatedContext(uid, { apps }).storage();
const builder = () => storageAs(BUILDER, ['cartographer']);
const uploadPath = (file, uid = BUILDER, uploadId = UPLOAD) =>
  `cartographer/${uid}/${uploadId}/${file}`;

describe('Cartographer uploads', () => {
  test('a world builder can upload an Azgaar JSON export and a PNG to their own folder', async () => {
    await assertSucceeds(builder().ref(uploadPath('map.json')).put(bytes(1024), JSON_TYPE));
    await assertSucceeds(builder().ref(uploadPath('map.png')).put(bytes(1024), PNG_TYPE));
  });

  test("a town's art (town.png) uploads to the same folder, as a PNG only (L-347)", async () => {
    await assertSucceeds(builder().ref(uploadPath('town.png')).put(bytes(1024), PNG_TYPE));
    // A battle map's art (L-355) the same way.
    await assertSucceeds(builder().ref(uploadPath('battlemap.png')).put(bytes(1024), PNG_TYPE));
    await assertFails(builder().ref(uploadPath('battlemap.png')).put(bytes(64), JSON_TYPE));
    await assertFails(builder().ref(uploadPath('town.png')).put(bytes(64), JSON_TYPE));
    await assertFails(
      storageAs('someone-else', ['cartographer'])
        .ref(uploadPath('town.png'))
        .put(bytes(64), PNG_TYPE)
    );
    await assertFails(
      builder()
        .ref(uploadPath('town.png'))
        .put(bytes(30 * 1024 * 1024 + 1), PNG_TYPE)
    );
  });

  test('…and read and delete their own uploads', async () => {
    await assertSucceeds(builder().ref(uploadPath('map.json')).getMetadata());
    await assertSucceeds(builder().ref(uploadPath('map.json')).delete());
  });

  test("nobody can write into or read another user's upload folder", async () => {
    const other = storageAs('builder-002', ['cartographer']);
    await assertFails(other.ref(uploadPath('map.json')).put(bytes(8), JSON_TYPE));
    await assertFails(other.ref(uploadPath('map.json')).getMetadata());
    await assertFails(other.ref(uploadPath('map.json')).delete());
  });

  test('uploading needs the cartographer claim', async () => {
    const player = storageAs(BUILDER, ['loom']);
    await assertFails(player.ref(uploadPath('map.json')).put(bytes(8), JSON_TYPE));
    const anonymous = testEnv.unauthenticatedContext().storage();
    await assertFails(anonymous.ref(uploadPath('map.json')).put(bytes(8), JSON_TYPE));
  });

  test.each([
    ['a file name other than map.json / map.png', 'notes.txt', { contentType: 'text/plain' }],
    ['JSON uploaded as map.png', 'map.png', JSON_TYPE],
    ['a PNG uploaded as map.json', 'map.json', PNG_TYPE],
    ['an SVG image', 'map.png', { contentType: 'image/svg+xml' }],
  ])('rejects %s', async (_label, file, metadata) => {
    await assertFails(builder().ref(uploadPath(file)).put(bytes(64), metadata));
  });

  test('rejects an upload id that is too short or has odd characters', async () => {
    await assertFails(
      builder()
        .ref(uploadPath('map.json', BUILDER, 'short'))
        .put(bytes(8), JSON_TYPE)
    );
    await assertFails(
      builder()
        .ref(uploadPath('map.json', BUILDER, 'bad.id.!!!'))
        .put(bytes(8), JSON_TYPE)
    );
  });

  test('rejects a PNG over 30 MB', async () => {
    await assertFails(
      builder()
        .ref(uploadPath('map.png'))
        .put(bytes(30 * 1024 * 1024 + 1), PNG_TYPE)
    );
  });
});

describe('world map images', () => {
  test('players and world builders can read them', async () => {
    await assertSucceeds(
      storageAs('player-001', ['loom']).ref('worlds/nisia-000001/map.png').getMetadata()
    );
    await assertSucceeds(builder().ref('worlds/nisia-000001/map.png').getMetadata());
  });

  test("so can towns' art, which no client can write", async () => {
    const art = 'worlds/nisia-000001/town-loc_1-abc123.png';
    await assertSucceeds(storageAs('player-001', ['loom']).ref(art).getMetadata());
    await assertFails(storageAs('someone', ['symposium']).ref(art).getMetadata());
    await assertFails(builder().ref(art).put(bytes(8), PNG_TYPE));
  });

  test('others cannot, and no client can write them', async () => {
    await assertFails(
      storageAs('someone', ['symposium']).ref('worlds/nisia-000001/map.png').getMetadata()
    );
    await assertFails(builder().ref('worlds/nisia-000001/map.png').put(bytes(8), PNG_TYPE));
    await assertFails(builder().ref('worlds/nisia-000001/map.png').delete());
  });
});

test('everything else is denied', async () => {
  await assertFails(
    builder().ref('anything/else.txt').put(bytes(8), { contentType: 'text/plain' })
  );
  await assertFails(builder().ref('anything/else.txt').getMetadata());
});
