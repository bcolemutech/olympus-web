'use strict';

/**
 * Taking a level in play (planning/advancement.md §4.4; L-843 / #715),
 * through loomPlayTurn with Gemini stubbed, under both built-in systems: a
 * long rest with a level ready offers the level-up, with the GM's
 * suggestion; levelUp takes it, and two ready levels come one after the
 * other; levelUp in a fight, or with no level offered, is refused; bad
 * choices are refused with reasons; the suggestion passes its own checks
 * (a bad one from the model is replaced by the rules' own).
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-advancement-level-up-play --verbose"
 */

const PROJECT = 'demo-loom-advancement-level-up-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const advancement = require('../functions/loom-modules/advancement');
const levelUp = require('../functions/loom-modules/advancement/level-up');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

const mockState = { system: null, suggestion: null };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) =>
      worldId === COAST.id
        ? { ...COAST, system: mockState.system }
        : real.loadWorld(worldId, options),
  };
});
const suggestCalls = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('suggesting how a player character grows')) {
      suggestCalls.push(options.userMessage);
      return mockState.suggestion;
    }
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return { verb: 'search', targets: [], params: {} };
    }
    return { narration: 'Night passes.', inventedEntities: [], suggestedActions: [] };
  },
}));

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomPlayTurn } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const db = getFirestore();
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

describe.each([
  ['d20-fantasy', FANTASY, 3],
  ['pool-scifi', SCIFI, 2],
])('levels under %s', (id, system, from) => {
  beforeAll(() => {
    mockState.system = system;
  });
  beforeEach(() => {
    mockState.suggestion = null;
    suggestCalls.length = 0;
  });

  // A save at `level` with experience for `n` more, off any battle map.
  async function ready(saveId, level, n) {
    const sheet = { ...sheets.defaultSheet(system), level };
    sheet.xp = advancement.totalFor(system, level + n);
    const ref = db.collection('loom_saves').doc(`${id}-${saveId}`);
    await ref.set(
      makeSave({
        ownerUid: PLAYER.uid,
        worldId: 'shattered-coast',
        name: 'Voyage',
        character: { name: 'Tam', sheet },
        location: 'widows-reach',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    );
    return ref;
  }
  const play = (ref, data) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, ...data },
      auth: PLAYER,
    });
  const sheetOf = async (ref) => (await ref.get()).data().character.sheet;

  test('a long rest with a level ready offers it, with a suggestion that passes its checks', async () => {
    const ref = await ready('offer', from, 1);
    const answer = await play(ref, { action: { verb: 'rest', rest: 'long' } });
    expect(answer.levelUp).toMatchObject({ level: from + 1 });
    const sheet = await sheetOf(ref);
    expect(answer.levelUp.grants).toEqual(levelUp.offerOf(system, sheet).grants);
    const { choices } = answer.levelUp.suggestion;
    expect(levelUp.check(system, sheet, choices)).toEqual([]);
    expect((await ref.get()).data().levelOffer).toBe(true);
  });

  test('a long rest with no level ready offers nothing', async () => {
    const ref = await ready('none', from, 0);
    const answer = await play(ref, { action: { verb: 'rest', rest: 'long' } });
    expect(answer.levelUp).toBeUndefined();
    expect((await ref.get()).data().levelOffer).toBeUndefined();
  });

  test('levelUp takes it, and a second ready level comes straight after', async () => {
    const ref = await ready('two', from, 2);
    const rested = await play(ref, { action: { verb: 'rest', rest: 'long' } });
    const first = await play(ref, {
      action: { verb: 'levelUp', choices: rested.levelUp.suggestion.choices },
    });
    const word = (system.words && system.words.level) || 'level';
    expect(first.narration).toBe(`You are now ${word} ${from + 1}.`);
    expect(first.levelUp).toMatchObject({ level: from + 2 });
    expect((await sheetOf(ref)).level).toBe(from + 1);
    const second = await play(ref, {
      action: { verb: 'levelUp', choices: first.levelUp.suggestion.choices },
    });
    expect(second.level).toBe(from + 2);
    expect(second.levelUp).toBeUndefined();
    const save = (await ref.get()).data();
    expect(save.character.sheet.level).toBe(from + 2);
    expect(save.levelOffer).toBeUndefined();
    expect(sheets.validateSheet(system, save.character.sheet)).toEqual([]);
    // No more to take.
    const third = await play(ref, { action: { verb: 'levelUp', choices: {} } });
    expect(third).toMatchObject({ refused: true });
  });

  test('bad choices are refused with reasons, and the offer stands', async () => {
    const ref = await ready('bad', from, 1);
    await play(ref, { action: { verb: 'rest', rest: 'long' } });
    const bad = await play(ref, {
      action: { verb: 'levelUp', choices: { attributes: { Nope: 9 } } },
    });
    expect(bad.refused).toBe(true);
    expect(bad.errors.length).toBeGreaterThan(0);
    expect((await sheetOf(ref)).level).toBe(from);
    expect((await ref.get()).data().levelOffer).toBe(true);
  });

  test('without a long rest, or after another turn, levelUp is refused', async () => {
    const ref = await ready('unoffered', from, 1);
    const early = await play(ref, { action: { verb: 'levelUp', choices: {} } });
    expect(early).toMatchObject({ refused: true });
    expect(early.narration).toMatch(/^A level is taken at a long rest/);
    await play(ref, { action: { verb: 'rest', rest: 'long' } });
    await play(ref, { actionText: 'look around' });
    expect((await ref.get()).data().levelOffer).toBeUndefined();
    const late = await play(ref, { action: { verb: 'levelUp', choices: {} } });
    expect(late).toMatchObject({ refused: true });
    // Still ready, for the next long rest.
    expect(advancement.levelsReady(system, await sheetOf(ref))).toBe(1);
  });

  test('levelUp in a fight is refused', async () => {
    const ref = await ready('fight', from, 1);
    await play(ref, { action: { verb: 'rest', rest: 'long' } });
    await ref.update({
      fight: {
        round: 1,
        turn: 'player',
        order: ['player'],
        combatants: { player: { kind: 'player', side: 'party', name: 'Tam' } },
      },
    });
    const answer = await play(ref, { action: { verb: 'levelUp', choices: {} } });
    expect(answer).toMatchObject({
      refused: true,
      narration: "You can't take a level in a fight.",
    });
    expect((await sheetOf(ref)).level).toBe(from);
  });

  test('the model’s suggestion is used when it passes, and replaced when it doesn’t', async () => {
    const ref = await ready('model', from, 1);
    const sheet = await sheetOf(ref);
    const good = levelUp.fallback(system, { ...sheet });
    mockState.suggestion = { ...good, reason: 'You have leaned on it all along.' };
    const rested = await play(ref, { action: { verb: 'rest', rest: 'long' } });
    const asked = Object.keys(rested.levelUp.grants).length > 0;
    if (asked) {
      expect(suggestCalls).toHaveLength(1);
      expect(rested.levelUp.suggestion).toEqual({
        choices: good,
        reason: 'You have leaned on it all along.',
      });
    }
    // One past every limit is replaced by the rules' own.
    const other = await ready('model-bad', from, 1);
    mockState.suggestion = { attributes: { Nope: 99 }, reason: 'Trust me.' };
    const replaced = await play(other, { action: { verb: 'rest', rest: 'long' } });
    expect(replaced.levelUp.suggestion.reason).toBeUndefined();
    expect(
      levelUp.check(system, await sheetOf(other), replaced.levelUp.suggestion.choices)
    ).toEqual([]);
  });
});
