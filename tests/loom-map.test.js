'use strict';

/**
 * The server side of the world map (planning/the-loom-layered-worlds.md §7;
 * L-331 / #393): what a save has discovered, moves made by clicking the map,
 * and loomGetMap, which shows a save only what it has discovered. Played
 * through the Loom's callables on a Nisia world in the Firestore emulator,
 * with Gemini mocked.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-map --verbose"
 */

const PROJECT = 'demo-loom-map';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomCreateSave, loomPlayTurn, loomGetMap } = require('../functions/index');

const fs = require('fs');
const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { loadDraftWorld } = require('../functions/cartographer/load');
const { newlyDiscovered } = require('../functions/loom-turn/discovery');
const loomCanon = require('../functions/loom-canon');

const db = getFirestore();
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };
const OTHER = { uid: 'player-002', token: { apps: ['loom'] } };
const WORLD = 'nisia-m0m0m0';
const PARSED = parseAzgaarExport(
  fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
);
const places = () => db.collection('loom_worlds').doc(WORLD).collection('locations');

// Burdendal (loc_1) connects to Dunscombe loc_120, Wisin loc_229,
// Ashleaches loc_231 and Dunsmouth loc_631.
const BURDENDAL_AND_AROUND = ['loc_1', 'loc_120', 'loc_229', 'loc_231', 'loc_631'];

async function writeUp(...ids) {
  await Promise.all(
    ids.map((id) =>
      places()
        .doc(id)
        .update({ description: `Written up: ${id}.`, 'sources.description': 'mcp' })
    )
  );
  const ref = db.collection('loom_worlds').doc(WORLD);
  await ref.update({ canonVersion: (await ref.get()).data().canonVersion + 1 });
}

const newGame = (auth = PLAYER) =>
  loomCreateSave.run({ data: { worldId: WORLD, name: 'Voyage', characterName: 'Tam' }, auth });
const clickTo = (saveId, target, auth = PLAYER) =>
  loomPlayTurn.run({ data: { worldId: WORLD, saveId, action: { verb: 'move', target } }, auth });
const getMap = (saveId, auth = PLAYER) =>
  loomGetMap.run({ data: { worldId: WORLD, saveId }, auth });
const saveOf = async (saveId) => (await db.collection('loom_saves').doc(saveId).get()).data();
const interpretCalls = () =>
  mockCallGemini.mock.calls.filter(([o]) => o.systemInstruction.includes('INTERPRET stage'));

beforeAll(async () => {
  await loadDraftWorld({
    db,
    mapped: mapToCanon(PARSED),
    source: PARSED.source,
    uploadedBy: 'builder-001',
    worldId: WORLD,
  });
  await db
    .collection('loom_worlds')
    .doc(WORLD)
    .update({
      status: 'published',
      openingHook: 'A storm drives your ship ashore at Burdendal.',
      rules: { startingLocationId: 'loc_1' },
      canonVersion: 2,
      'map.imagePath': `worlds/${WORLD}/map.png`,
      'map.imageWidth': 5154,
      'map.imageHeight': 3810,
    });
  await writeUp('loc_1', 'loc_631');
});

beforeEach(() => {
  loomCanon.clearWorldCache();
  mockCallGemini.mockReset();
  mockCallGemini.mockImplementation(async (options) => {
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return { verb: 'look', targets: [], params: {} };
    }
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    return { narration: 'You walk on.', inventedEntities: [], suggestedActions: [] };
  });
});

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

describe('discovery', () => {
  test('a new game has discovered its start and the places around it', async () => {
    const { saveId } = await newGame();
    expect((await saveOf(saveId)).discovered.sort()).toEqual(BURDENDAL_AND_AROUND);
  });

  test('arriving somewhere discovers its neighbours, once', async () => {
    const { saveId } = await newGame();
    await clickTo(saveId, 'loc_631');
    const world = await loomCanon.loadWorld(WORLD, { db });
    const around = world.locations.loc_631.connections;
    const { discovered } = await saveOf(saveId);
    expect(discovered.slice(0, 5).sort()).toEqual(BURDENDAL_AND_AROUND);
    expect(discovered).toEqual(expect.arrayContaining(around));
    expect(new Set(discovered).size).toBe(discovered.length);
  });

  test('a move that is turned back discovers nothing', async () => {
    const { saveId } = await newGame();
    await clickTo(saveId, 'loc_229'); // Wisin: still import text, so closed
    expect((await saveOf(saveId)).discovered.sort()).toEqual(BURDENDAL_AND_AROUND);
  });

  test('an older save without discovery catches up on its next turn', async () => {
    const { saveId } = await newGame();
    await db.collection('loom_saves').doc(saveId).update({ discovered: null });
    const world = await loomCanon.loadWorld(WORLD, { db });
    expect(newlyDiscovered(world, { location: 'loc_1' }, { mutations: [] }).sort()).toEqual(
      BURDENDAL_AND_AROUND
    );
    await loomPlayTurn.run({
      data: { worldId: WORLD, saveId, actionText: 'look around' },
      auth: PLAYER,
    });
    expect((await saveOf(saveId)).discovered.sort()).toEqual(BURDENDAL_AND_AROUND);
  });
});

describe('moves made on the map', () => {
  test('skip INTERPRET, and are adjudicated and narrated like typed ones', async () => {
    const { saveId } = await newGame();
    await expect(clickTo(saveId, 'loc_631')).resolves.toMatchObject({ narration: 'You walk on.' });
    expect(interpretCalls()).toHaveLength(0);
    expect((await saveOf(saveId)).location).toBe('loc_631');
    const turns = await db.collection('loom_saves').doc(saveId).collection('loom_turns').get();
    expect(turns.docs[0].data()).toMatchObject({
      actionText: 'travel to Dunsmouth',
      proposedAction: { verb: 'move', targets: ['loc_631'], params: { from: 'map' } },
      resolution: { outcome: 'success' },
    });
  });

  test('are still gated: a closed place turns the player back', async () => {
    const { saveId } = await newGame();
    await clickTo(saveId, 'loc_229');
    expect(interpretCalls()).toHaveLength(0);
    expect((await saveOf(saveId)).location).toBe('loc_1');
    const turns = await db.collection('loom_saves').doc(saveId).collection('loom_turns').get();
    expect(turns.docs[0].data().resolution).toMatchObject({
      outcome: 'blocked',
      constraints: ['The way to Wisin is closed. Turn back.'],
    });
  });

  test('can only reach connected places, like typed moves', async () => {
    const { saveId } = await newGame();
    await clickTo(saveId, 'loc_24'); // Hitchel: far away
    const turns = await db.collection('loom_saves').doc(saveId).collection('loom_turns').get();
    expect(turns.docs[0].data().resolution.constraints).toEqual([
      "You can't get there directly from here.",
    ]);
  });

  test('are validated', async () => {
    const { saveId } = await newGame();
    const play = (data) =>
      loomPlayTurn.run({ data: { worldId: WORLD, saveId, ...data }, auth: PLAYER });
    await expect(
      play({ actionText: 'go', action: { verb: 'move', target: 'loc_631' } })
    ).rejects.toMatchObject({ code: 'invalid-argument', message: /not both/ });
    await expect(play({ action: { verb: 'attack', target: 'loc_631' } })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(play({ action: { verb: 'move', target: '../x' } })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(play({})).rejects.toMatchObject({ message: 'actionText is required.' });
  });
});

describe('loomGetMap', () => {
  test('shows exactly what the save has discovered, with links, open or closed, and here', async () => {
    const { saveId } = await newGame();
    const map = await getMap(saveId);
    expect(map).toMatchObject({
      worldId: WORLD,
      name: 'Nisia',
      here: 'loc_1',
      map: {
        width: 1718,
        height: 1270,
        image: { path: `worlds/${WORLD}/map.png`, width: 5154, height: 3810 },
      },
    });
    expect(map.places.map((p) => p.id).sort()).toEqual(BURDENDAL_AND_AROUND);
    expect(map.places.find((p) => p.id === 'loc_1')).toEqual({
      id: 'loc_1',
      name: 'Burdendal',
      kind: 'settlement',
      open: true,
      x: 922.31,
      y: 869.84,
      population: 28473,
      capital: true,
      port: true,
    });
    expect(map.places.find((p) => p.id === 'loc_229')).toMatchObject({ open: false });
    // Links only between discovered places, each once.
    const shown = new Set(BURDENDAL_AND_AROUND);
    expect(map.links.every((l) => shown.has(l.from) && shown.has(l.to))).toBe(true);
    expect(map.links).toContainEqual({ from: 'loc_1', to: 'loc_631', via: 'trail' });
    const keys = map.links.map((l) => [l.from, l.to].sort().join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('never includes an undiscovered place, and grows as the save explores', async () => {
    const { saveId } = await newGame();
    const before = await getMap(saveId);
    expect(before.places.map((p) => p.id)).not.toContain('loc_24');
    expect(JSON.stringify(before)).not.toMatch(/description/);
    await clickTo(saveId, 'loc_631');
    const after = await getMap(saveId);
    expect(after.here).toBe('loc_631');
    expect(after.places.length).toBeGreaterThan(before.places.length);
    const { discovered } = await saveOf(saveId);
    expect(after.places.map((p) => p.id).sort()).toEqual([...discovered].sort());
  });

  test('is for the save’s owner only, in its own world', async () => {
    const { saveId } = await newGame();
    await expect(getMap(saveId, OTHER)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      loomGetMap.run({ data: { worldId: 'shattered-coast', saveId }, auth: PLAYER })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: { uid: 'x', token: {} } })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('static worlds have no map image or coordinates', async () => {
    const { saveId } = await loomCreateSave.run({
      data: { worldId: 'shattered-coast', name: 'Coast', characterName: 'Tam' },
      auth: PLAYER,
    });
    const map = await loomGetMap.run({
      data: { worldId: 'shattered-coast', saveId },
      auth: PLAYER,
    });
    expect(map.map).toBeNull();
    expect(map.places.length).toBeGreaterThan(0);
    expect(map.places.every((p) => p.x === undefined && p.open === true)).toBe(true);
  });
});
