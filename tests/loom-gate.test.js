'use strict';

/**
 * The Layered Worlds gate (planning/the-loom-layered-worlds.md §5; L-322 /
 * #391): players can only enter places graded Playable. Played through the
 * Loom's own callables on a Nisia world in the Firestore emulator, with
 * Gemini mocked, plus the rules engine's pure evaluate().
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-gate --verbose"
 */

const PROJECT = 'demo-loom-gate';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomCreateSave, loomPlayTurn } = require('../functions/index');

const fs = require('fs');
const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { loadDraftWorld } = require('../functions/cartographer/load');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const loomCanon = require('../functions/loom-canon');
const { makeWorld } = require('./fixtures/loom');

const db = getFirestore();
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };
const PARSED = parseAzgaarExport(
  fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
);
const worldRef = (id) => db.collection('loom_worlds').doc(id);

let seq = 0;
// A published Nisia, fresh from the import: every place is import text.
async function publishedNisia() {
  seq += 1;
  const worldId = `nisia-${String(seq).padStart(6, '0')}`;
  await loadDraftWorld({
    db,
    mapped: mapToCanon(PARSED),
    source: PARSED.source,
    uploadedBy: 'builder-001',
    worldId,
  });
  await worldRef(worldId).update({
    status: 'published',
    openingHook: 'A storm drives your ship ashore at Burdendal.',
    rules: { startingLocationId: 'loc_1' },
    canonVersion: 2,
  });
  return worldId;
}

// Writes places up, as an MCP edit would: that is what makes them Playable.
async function writeUp(worldId, ...ids) {
  await Promise.all(
    ids.map((id) =>
      worldRef(worldId)
        .collection('locations')
        .doc(id)
        .update({ description: `Written up: ${id}.`, 'sources.description': 'mcp' })
    )
  );
  const version = (await worldRef(worldId).get()).data().canonVersion;
  await worldRef(worldId).update({ canonVersion: version + 1 });
}

// Every turn is a move to `target`; narrator prompts are kept for inspection.
const prompts = [];
function playerMovesTo(target) {
  mockCallGemini.mockImplementation(async (options) => {
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return { verb: 'move', targets: [target], params: {} };
    }
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    prompts.push(options.userMessage);
    return { narration: 'The road unfolds.', inventedEntities: [], suggestedActions: [] };
  });
}

const newGame = (worldId) =>
  loomCreateSave.run({ data: { worldId, name: 'Voyage', characterName: 'Tam' }, auth: PLAYER });
const turn = (worldId, saveId) =>
  loomPlayTurn.run({ data: { worldId, saveId, actionText: 'go on' }, auth: PLAYER });
const saveOf = async (saveId) => (await db.collection('loom_saves').doc(saveId).get()).data();
const lastTurn = async (saveId) =>
  (
    await db
      .collection('loom_saves')
      .doc(saveId)
      .collection('loom_turns')
      .orderBy('index', 'desc')
      .limit(1)
      .get()
  ).docs[0].data();

beforeEach(() => {
  loomCanon.clearWorldCache();
  mockCallGemini.mockReset();
  prompts.length = 0;
});

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

describe('new games', () => {
  test('are refused while the start is closed, and begin once it is written up', async () => {
    const worldId = await publishedNisia();
    await expect(newGame(worldId)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: "This world isn't ready to play yet.",
    });
    await writeUp(worldId, 'loc_1');
    const { saveId } = await newGame(worldId);
    expect((await saveOf(saveId)).location).toBe('loc_1');
  });

  test('static, hand-authored worlds are never gated', async () => {
    const { saveId } = await loomCreateSave.run({
      data: { worldId: 'shattered-coast', name: 'Coast', characterName: 'Tam' },
      auth: PLAYER,
    });
    expect(saveId).toEqual(expect.any(String));
  });
});

describe('travel', () => {
  let worldId;
  let saveId;
  beforeAll(async () => {
    worldId = await publishedNisia();
    await writeUp(worldId, 'loc_1');
    loomCanon.clearWorldCache();
    ({ saveId } = await newGame(worldId));
  });

  test('a move into a closed place is turned back, and the narrator knows the way is closed', async () => {
    playerMovesTo('loc_631'); // Dunsmouth, still import text
    await expect(turn(worldId, saveId)).resolves.toMatchObject({ narration: 'The road unfolds.' });
    expect((await saveOf(saveId)).location).toBe('loc_1');
    expect((await lastTurn(saveId)).resolution).toEqual({
      outcome: 'blocked',
      mutations: [],
      constraints: ['The way to Dunsmouth is closed. Turn back.'],
    });
    const state = (await db.collection('loom_world_state').doc(worldId).get()).data();
    expect(state.worldClock || 0).toBe(0);
    expect(prompts.at(-1)).toContain('The way to Dunsmouth is closed. Turn back.');

    // The narrator is told which ways on are open and which are closed.
    expect(prompts.at(-1)).toContain('WAYS ON FROM Burdendal:');
    expect(prompts.at(-1)).toContain('- Dunsmouth (loc_631), by trail: CLOSED');
    expect(prompts.at(-1)).toContain('- Wisin (loc_229), by sea: CLOSED');
    expect(prompts.at(-1)).toMatch(/describe them as closed or impassable, never what lies beyond/);
  });

  test('once written up, the same place can be entered', async () => {
    await writeUp(worldId, 'loc_631');
    playerMovesTo('loc_631');
    await turn(worldId, saveId);
    expect((await saveOf(saveId)).location).toBe('loc_631');
    expect((await lastTurn(saveId)).resolution.outcome).toBe('success');
    // Narrated from where the player arrives: Burdendal is open behind them.
    expect(prompts.at(-1)).toContain('WAYS ON FROM Dunsmouth:');
    expect(prompts.at(-1)).toContain('- Burdendal (loc_1), by trail: open');
  });

  test('nobody is stranded: a save standing in a closed place can still leave', async () => {
    await db.collection('loom_saves').doc(saveId).update({ location: 'loc_229' }); // Wisin, closed
    playerMovesTo('loc_1');
    await turn(worldId, saveId);
    expect((await saveOf(saveId)).location).toBe('loc_1');
    expect((await lastTurn(saveId)).resolution.outcome).toBe('success');
  });
});

describe('the rules engine', () => {
  const move = (world, from, to) =>
    evaluate({ verb: 'move', targets: [to], params: {} }, {}, { location: from }, 10, world);

  test('checks connection and retirement before the gate, so nothing far away is revealed', async () => {
    const worldId = await publishedNisia();
    await writeUp(worldId, 'loc_1');
    const world = await loomCanon.loadWorld(worldId, { db });
    const far = Object.values(world.locations).find(
      (l) => l.id !== 'loc_1' && !world.locations.loc_1.connections.includes(l.id)
    );
    expect(move(world, 'loc_1', far.id).constraints).toEqual([
      "You can't get there directly from here.",
    ]);
  });

  test('a static world’s places are always open', () => {
    const world = makeWorld();
    expect(move(world, 'start', 'next').outcome).toBe('success');
  });
});
