'use strict';

/**
 * Waiting, resting and sleeping (planning/the-loom-game-time.md §3 T12,
 * §4.3; L-374 / #502): a typed "wait 30 minutes", "sleep until evening" or
 * "sleep until dawn" passes the time, capped at a day; it uses the turn's
 * action and ends the turn; a second action is turned down. Played through
 * loomPlayTurn on the Shattered Coast with Gemini stubbed: INTERPRET reads
 * the wait as the test says, NARRATE's prompt is kept.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-waiting --verbose"
 */

const PROJECT = 'demo-loom-waiting';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

// What INTERPRET reads the typed text as, and NARRATE's prompts.
const mockIntent = { verb: 'wait', targets: [], params: {} };
const mockNarrated = [];
const mockCallGemini = jest.fn(async (options) => {
  if (options.systemInstruction.includes('summarizer')) return 'A summary.';
  if (options.systemInstruction.includes('INTERPRET stage')) {
    return JSON.parse(JSON.stringify(mockIntent));
  }
  mockNarrated.push(options.userMessage);
  return { narration: 'Time passes.', inventedEntities: [], suggestedActions: [] };
});
jest.mock('../functions/loom-canon', () => require('./helpers/coast').canonWithCoast());
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomPlayTurn } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const clock = require('../functions/loom-canon/clock');

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const db = getFirestore();

const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };
const WORLD = 'shattered-coast';
const at = (day, hour, minute = 0) => (day - 1) * clock.DAY + hour * clock.HOUR + minute * 60;

const saveRef = (saveId) => db.collection('loom_saves').doc(saveId);
const saveOf = async (saveId) => (await saveRef(saveId).get()).data();
const lastTurn = async (saveId) =>
  (
    await saveRef(saveId).collection('loom_turns').orderBy('index', 'desc').limit(1).get()
  ).docs[0]?.data();

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
  await saveRef(saveId).set(save);
  return save;
}

// A typed turn read as `intent`.
async function typed(saveId, actionText, intent) {
  Object.assign(mockIntent, { targets: [], params: {} }, intent);
  return loomPlayTurn.run({ data: { worldId: WORLD, saveId, actionText }, auth: PLAYER });
}

beforeEach(() => {
  mockNarrated.length = 0;
});

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

describe('letting time pass', () => {
  test('"wait 30 minutes" adds 30 minutes and ends the turn', async () => {
    await seed('save-30', { time: at(1, 9) });
    await typed('save-30', 'wait 30 minutes', { verb: 'wait', params: { minutes: 30 } });
    const save = await saveOf('save-30');
    expect(save.time).toBe(at(1, 9, 30));
    // The turn ends: the next one starts fresh.
    expect(save.turn).toMatchObject({ n: 2, ap: 20 });
    const turn = await lastTurn('save-30');
    expect(turn.resolution.constraints).toEqual(['You wait for about 30 minutes.']);
    expect(turn.resolution.time).toMatchObject({ seconds: 30 * 60, crossed: [] });
    // The GM is told (L-375).
    expect(mockNarrated[0]).toContain('Day 1, morning. About 30 minutes passed.');
  });

  test('"sleep until evening" from the afternoon lands at 17:00', async () => {
    await seed('save-evening', { time: at(1, 15, 20) });
    await typed('save-evening', 'sleep until evening', {
      verb: 'wait',
      params: { until: 'evening', how: 'sleep' },
    });
    expect((await saveOf('save-evening')).time).toBe(at(1, 17));
    expect((await lastTurn('save-evening')).resolution.constraints).toEqual([
      'You sleep until evening.',
    ]);
  });

  test('"sleep until dawn" at dawn sleeps to the next dawn', async () => {
    await seed('save-dawn', { time: at(2, 5, 30) });
    await typed('save-dawn', 'sleep until dawn', { verb: 'sleep', params: { until: 'dawn' } });
    expect((await saveOf('save-dawn')).time).toBe(at(3, 5));
    const turn = await lastTurn('save-dawn');
    expect(turn.resolution.constraints).toEqual(['You sleep until dawn.']);
    expect(turn.resolution.time.crossed.map((c) => c.event)).toEqual(['dusk', 'dawn']);
    expect(mockNarrated[0]).toContain('dusk fell and dawn broke on the way');
  });

  test('a 3-day wait is capped at 24 hours', async () => {
    await seed('save-long', { time: at(1, 10) });
    await typed('save-long', 'wait three days', { verb: 'wait', params: { minutes: 3 * 1440 } });
    expect((await saveOf('save-long')).time).toBe(at(2, 10));
    expect((await lastTurn('save-long')).resolution.constraints).toEqual([
      'You wait for a day, as long as anyone can at a stretch.',
    ]);
  });

  test('a wait off a battle map needs no AP: it waits with none left (L-832; WH2)', async () => {
    await seed('save-acted', {
      time: at(1, 9),
      turn: { n: 4, ap: 0, kept: 0, plan: null },
    });
    await typed('save-acted', 'rest an hour', {
      verb: 'wait',
      params: { minutes: 60, how: 'rest' },
    });
    const save = await saveOf('save-acted');
    expect(save.time).toBe(at(1, 10));
    expect(save.turn).toMatchObject({ n: 5, ap: 20 });
  });

  test('a wait with no length or time of day asks how long, and spends nothing', async () => {
    await seed('save-vague', { time: at(1, 9) });
    await typed('save-vague', 'wait a while', { verb: 'wait', params: {} });
    await typed('save-vague', 'sleep until teatime', {
      verb: 'wait',
      params: { until: 'teatime' },
    });
    const save = await saveOf('save-vague');
    expect(save.time).toBe(at(1, 9));
    expect(save.turn).toMatchObject({ n: 1, ap: 20 });
    expect((await lastTurn('save-vague')).resolution).toMatchObject({
      outcome: 'blocked',
      constraints: [expect.stringMatching(/^How long\?/)],
    });
  });
});
