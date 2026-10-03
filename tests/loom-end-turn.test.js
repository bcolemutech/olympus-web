'use strict';

/**
 * The turn in saves (planning/the-loom-movement-and-vision.md §3; L-611 /
 * #441): ending a turn through loomPlayTurn refills movement and the action,
 * counts the turn, keeps the plan, records a plain line, and never calls
 * Gemini; loomGetMap carries the turn; older saves start a fresh one. Played
 * on the hand-authored Shattered Coast in the Firestore emulator.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-end-turn --verbose"
 */

const PROJECT = 'demo-loom-end-turn';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

// Ending a turn must never reach the model: any call fails the test.
const mockCallGemini = jest.fn(async () => {
  throw new Error('Gemini was called');
});
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomPlayTurn, loomGetMap } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const db = getFirestore();

const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };
const WORLD = 'shattered-coast';

const play = (saveId, data) =>
  loomPlayTurn.run({ data: { worldId: WORLD, saveId, ...data }, auth: PLAYER });
const endTurn = (saveId) => play(saveId, { action: { verb: 'end-turn' } });
const saveOf = async (saveId) => (await db.collection('loom_saves').doc(saveId).get()).data();
const turnsOf = async (saveId) =>
  (
    await db.collection('loom_saves').doc(saveId).collection('loom_turns').orderBy('index').get()
  ).docs.map((d) => d.data());
const clock = async () =>
  ((await db.collection('loom_world_state').doc(WORLD).get()).data() || {}).worldClock;

async function seed(saveId, fields = {}) {
  const save = makeSave({
    ownerUid: PLAYER.uid,
    worldId: WORLD,
    name: 'Voyage',
    character: { name: 'Tam' },
    location: 'widows-reach',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields,
  });
  await db.collection('loom_saves').doc(saveId).set(save);
  return save;
}

beforeEach(() => mockCallGemini.mockClear());

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

describe('ending a turn', () => {
  test('a new save starts on turn 1 with its full speed', async () => {
    const save = await seed('save-new');
    expect(save.character.speed).toBe(20);
    expect(save.turn).toEqual({ n: 1, movementLeft: 20, actionUsed: false, plan: null });
  });

  test('refills movement and the action, counts the turn, and keeps the plan', async () => {
    const plan = { layer: 'battleMap', to: { x: 9, y: 3 }, path: [{ x: 8, y: 3 }] };
    await seed('save-spent', { turn: { n: 3, movementLeft: 0, actionUsed: true, plan } });
    const before = (await clock()) || 0;
    const result = await endTurn('save-spent');
    expect(result).toEqual({ narration: 'Turn 3 ends.', stateSummary: '', suggestedActions: [] });
    expect((await saveOf('save-spent')).turn).toEqual({
      n: 4,
      movementLeft: 20,
      actionUsed: false,
      plan,
    });
    expect(await clock()).toBe(before + 1);
    expect(mockCallGemini).not.toHaveBeenCalled();
  });

  test('is recorded in the turn history with a plain line, not narration', async () => {
    await seed('save-log');
    await endTurn('save-log');
    await endTurn('save-log');
    const turns = await turnsOf('save-log');
    expect(turns.map((t) => [t.actionText, t.narration])).toEqual([
      ['end turn', 'Turn 1 ends.'],
      ['end turn', 'Turn 2 ends.'],
    ]);
    expect(turns[0].proposedAction).toEqual({ verb: 'end-turn', targets: [], params: {} });
    expect(mockCallGemini).not.toHaveBeenCalled();
  });

  test('a character with its own speed refills to it', async () => {
    await seed('save-quick', {
      character: { name: 'Wren', speed: 30 },
      turn: { n: 1, movementLeft: 4, actionUsed: false, plan: null },
    });
    await endTurn('save-quick');
    expect((await saveOf('save-quick')).turn).toMatchObject({ n: 2, movementLeft: 30 });
  });

  test('an older save, with no turn or speed, starts a fresh turn and plays', async () => {
    const older = await seed('save-old');
    delete older.turn;
    delete older.character.speed;
    await db.collection('loom_saves').doc('save-old').set(older);
    await endTurn('save-old');
    expect((await saveOf('save-old')).turn).toEqual({
      n: 2,
      movementLeft: 20,
      actionUsed: false,
      plan: null,
    });
  });

  test('anything else is still refused', async () => {
    await seed('save-bad');
    await expect(play('save-bad', { action: { verb: 'end' } })).rejects.toMatchObject({
      code: 'invalid-argument',
      message: expect.stringContaining('{ verb: "end-turn" }'),
    });
    await expect(
      play('save-bad', { action: { verb: 'end-turn' }, actionText: 'end it' })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('loomGetMap carries the turn', () => {
  test('the turn number, movement left of the speed, the action and the plan', async () => {
    await seed('save-view', { turn: { n: 7, movementLeft: 12, actionUsed: true, plan: null } });
    const view = await loomGetMap.run({
      data: { worldId: WORLD, saveId: 'save-view' },
      auth: PLAYER,
    });
    expect(view.turn).toEqual({ n: 7, movementLeft: 12, speed: 20, actionUsed: true, plan: null });
  });

  test('an older save shows a fresh turn', async () => {
    const older = await seed('save-view-old');
    delete older.turn;
    await db.collection('loom_saves').doc('save-view-old').set(older);
    const view = await loomGetMap.run({
      data: { worldId: WORLD, saveId: 'save-view-old' },
      auth: PLAYER,
    });
    expect(view.turn).toEqual({ n: 1, movementLeft: 20, speed: 20, actionUsed: false, plan: null });
  });
});
