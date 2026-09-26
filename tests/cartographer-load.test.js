'use strict';

/**
 * Cartographer loader + the Loom's Firestore-backed worlds (C-4 / #371).
 *
 * Loads the Nisia fixture into the Firestore emulator as a draft world, then
 * checks the Loom side: drafts aren't playable, published worlds are, canon
 * edits reach the next turn via canonVersion, retired places stay resolvable
 * but unreachable — and the real loomCreateSave / loomPlayTurn callables play
 * a loaded world (Gemini mocked).
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-load --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = 'demo-cartographer-load';

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')(
  { projectId: 'demo-cartographer-load' },
  null
);
// Requiring functions/index.js initializes the functions package's admin app,
// which the loader and loom-canon below share.
const { loomCreateSave, loomPlayTurn } = require('../functions/index');
const path = require('path');
const fs = require('fs');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [path.resolve(__dirname, '../functions')] })
);
const loomCanon = require('../functions/loom-canon');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { loadDraftWorld } = require('../functions/cartographer/load');

const db = getFirestore();
const RAW = fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'));
const PARSED = parseAzgaarExport(RAW);
const mapped = () => mapToCanon(PARSED);
const UID = 'builder-001';
const PLAYER = { uid: 'player-001', token: { apps: ['loom'], admin: false } };

async function importNisia(extra = {}) {
  return loadDraftWorld({ db, mapped: mapped(), source: PARSED.source, uploadedBy: UID, ...extra });
}

async function publish(worldId, patch = {}) {
  const ref = db.collection('loom_worlds').doc(worldId);
  await ref.update({
    status: 'published',
    openingHook: 'A storm drives you ashore at Burdendal.',
    rules: { startingLocationId: 'loc_1' },
    canonVersion: (await ref.get()).data().canonVersion + 1,
    ...patch,
  });
}

async function bump(worldId) {
  const ref = db.collection('loom_worlds').doc(worldId);
  await ref.update({ canonVersion: (await ref.get()).data().canonVersion + 1 });
}

const count = async (worldId, sub) =>
  (await db.collection('loom_worlds').doc(worldId).collection(sub).count().get()).data().count;

beforeEach(async () => {
  loomCanon.clearWorldCache();
  mockCallGemini.mockReset();
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
});

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

describe('loading a draft world', () => {
  test('writes the world document and every entity', async () => {
    const { worldId, counts } = await importNisia();
    expect(worldId).toMatch(/^nisia-[0-9a-f]{6}$/);
    const meta = (await db.collection('loom_worlds').doc(worldId).get()).data();
    expect(meta).toMatchObject({
      id: worldId,
      name: 'Nisia',
      status: 'draft',
      canonVersion: 1,
      tagline: '',
      openingHook: '',
      map: { width: 1718, height: 1270, imagePath: null },
      source: { format: 'azgaar-json', version: '1.153.1', mapName: 'Nisia', uploadedBy: UID },
      counts,
    });
    expect(meta.warnings.map((w) => w.code)).toEqual(['names_qualified', 'isolated_linked']);
    expect(await count(worldId, 'locations')).toBe(719);
    expect(await count(worldId, 'factions')).toBe(23);
    expect(await count(worldId, 'regions')).toBe(145);
  });

  test('reads back exactly what the mapper produced', async () => {
    const { worldId } = await importNisia();
    const world = await loomCanon.loadWorld(worldId, { db, playableOnly: false });
    const { canon } = mapped();
    expect(world.status).toBe('draft');
    expect(world.locations).toEqual(canon.locations);
    expect(world.factions).toEqual(canon.factions);
    expect(world.regions).toEqual(canon.regions);
    expect(Object.isFrozen(world.locations.loc_1)).toBe(true);
  });

  test('every import is a new world; an existing id is never overwritten', async () => {
    const a = await importNisia();
    const b = await importNisia();
    expect(a.worldId).not.toBe(b.worldId);
    await publish(a.worldId);
    await expect(importNisia({ worldId: a.worldId })).rejects.toThrow();
    expect((await db.collection('loom_worlds').doc(a.worldId).get()).data().status).toBe(
      'published'
    );
  });

  test('a failed import is marked failed and leaves no partial entities', async () => {
    const broken = mapped();
    broken.canon.regions.reg_1.color = undefined; // Firestore rejects undefined
    await expect(
      loadDraftWorld({
        db,
        mapped: broken,
        source: PARSED.source,
        uploadedBy: UID,
        worldId: 'broken-000001',
      })
    ).rejects.toThrow();
    const meta = (await db.collection('loom_worlds').doc('broken-000001').get()).data();
    expect(meta.status).toBe('failed');
    expect(meta.error).toMatch(/undefined/i);
    expect(await count('broken-000001', 'locations')).toBe(0);
    expect(await count('broken-000001', 'regions')).toBe(0);
    expect(await loomCanon.loadWorld('broken-000001', { db, playableOnly: false })).toBeNull();
  });
});

describe('the Loom and Firestore worlds', () => {
  test('a draft is not playable; a published world is', async () => {
    const { worldId } = await importNisia();
    expect(await loomCanon.loadWorld(worldId, { db })).toBeNull();
    await publish(worldId);
    const world = await loomCanon.loadWorld(worldId, { db });
    expect(world).toMatchObject({ id: worldId, name: 'Nisia', status: 'published' });
    expect(world.rules.startingLocationId).toBe('loc_1');
  });

  test('static worlds are unchanged', async () => {
    expect(await loomCanon.loadWorld('shattered-coast', { db })).toBe(
      loomCanon.getWorld('shattered-coast')
    );
  });

  test('canon is cached until canonVersion changes, then the next load sees the edit', async () => {
    const { worldId } = await importNisia();
    await publish(worldId);
    const first = await loomCanon.loadWorld(worldId, { db });
    expect(await loomCanon.loadWorld(worldId, { db })).toBe(first);

    const locationRef = db
      .collection('loom_worlds')
      .doc(worldId)
      .collection('locations')
      .doc('loc_1');
    await locationRef.update({ description: 'Rebuilt after the great fire.' });
    expect((await loomCanon.loadWorld(worldId, { db })).locations.loc_1.description).toBe(
      first.locations.loc_1.description
    );

    await bump(worldId);
    const next = await loomCanon.loadWorld(worldId, { db });
    expect(next).not.toBe(first);
    expect(next.locations.loc_1.description).toBe('Rebuilt after the great fire.');
    expect(loomCanon.entitySnippet(next, 'loc_1')).toMatch(/Rebuilt after the great fire/);
  });

  test('a retired place stays resolvable but can no longer be reached', async () => {
    const { worldId } = await importNisia();
    await publish(worldId);
    const retiredId = (await loomCanon.loadWorld(worldId, { db })).locations.loc_1.connections[0];
    await db
      .collection('loom_worlds')
      .doc(worldId)
      .collection('locations')
      .doc(retiredId)
      .update({ retired: true });
    await bump(worldId);

    const world = await loomCanon.loadWorld(worldId, { db });
    expect(world.locations[retiredId].retired).toBe(true);
    expect(loomCanon.findEntity(world, retiredId)).not.toBeNull();
    expect(world.locations.loc_1.connections).not.toContain(retiredId);
    for (const location of Object.values(world.locations)) {
      expect(location.connections).not.toContain(retiredId);
    }
    const move = (from, to) =>
      evaluate({ verb: 'move', targets: [to], params: {} }, {}, { location: from }, 10, world);
    expect(move('loc_1', retiredId).outcome).toBe('blocked');
    // Someone already standing there can still leave.
    const exit = world.locations[retiredId].connections[0];
    expect(move(retiredId, exit).outcome).toBe('success');
  });

  test('loomCreateSave refuses a draft and starts a published world at its starting location', async () => {
    const { worldId } = await importNisia();
    const create = () =>
      loomCreateSave.run({
        data: { worldId, name: 'First voyage', characterName: 'Mara' },
        auth: PLAYER,
      });
    await expect(create()).rejects.toThrow(/Unknown world/);

    await publish(worldId);
    const { saveId } = await create();
    const save = (await db.collection('loom_saves').doc(saveId).get()).data();
    expect(save).toMatchObject({ worldId, location: 'loc_1', ownerUid: 'player-001' });
  });

  test('loomPlayTurn moves a player along a loaded route', async () => {
    const { worldId } = await importNisia();
    await publish(worldId);
    const { saveId } = await loomCreateSave.run({
      data: { worldId, name: 'First voyage', characterName: 'Mara' },
      auth: PLAYER,
    });
    const world = await loomCanon.loadWorld(worldId, { db });
    const destination = world.locations.loc_1.connections[0];

    mockCallGemini.mockImplementation((options) => {
      if (options.systemInstruction.indexOf('INTERPRET stage') !== -1) {
        return Promise.resolve({ verb: 'move', targets: [destination], params: {} });
      }
      if (options.systemInstruction.indexOf('summarizer') !== -1) {
        return Promise.resolve('A summary.');
      }
      return Promise.resolve({
        narration: 'You set out.',
        inventedEntities: [],
        suggestedActions: [],
      });
    });

    const result = await loomPlayTurn.run({
      data: { worldId, saveId, actionText: `travel to ${world.locations[destination].name}` },
      auth: PLAYER,
    });
    expect(result.narration).toBe('You set out.');
    const save = (await db.collection('loom_saves').doc(saveId).get()).data();
    expect(save.location).toBe(destination);
  });
});
