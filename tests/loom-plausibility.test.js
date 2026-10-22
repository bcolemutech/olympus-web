'use strict';

/**
 * Plausibility (planning/combat.md §3 CB1, §4.3; L-826 / #658), with Gemini
 * stubbed, under both built-in systems (MD2), out of a fight and in one:
 * INTERPRET is told the four kinds and the character; an improbable action
 * is rolled at the ladder's top rung, whatever rung was proposed; an
 * extraordinary one is refused; a complicated one asks how, and the next
 * typed text is read as the answer and rolled from it (a second vague
 * answer is refused, and anything else drops the question); refusals and
 * questions spend no action and no time.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-plausibility --verbose"
 */

const PROJECT = 'demo-loom-plausibility';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const { evaluate } = require('../functions/loom-turn/adjudicate');

const mockCases = {
  'd20-fantasy': { system: BUILT_IN['d20-fantasy'], attribute: 'STR' },
  'pool-scifi': { system: BUILT_IN['pool-scifi'], attribute: 'Body' },
};

const mockState = { id: 'd20-fantasy', intent: null };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      return {
        ...COAST,
        system: mockCases[mockState.id].system,
        locations: {
          ...COAST.locations,
          'widows-reach': { ...COAST.locations['widows-reach'], battleMap: { mapId: 'bm_hall' } },
        },
        characters: {
          ...COAST.characters,
          grell: {
            id: 'grell',
            name: 'Grell',
            description: 'A bandit.',
            locationId: 'widows-reach',
            cell: { x: 8, y: 2 },
            side: 'hostile',
          },
        },
        battleMaps: {
          bm_hall: {
            id: 'bm_hall',
            name: 'The hall',
            width: 10,
            height: 5,
            image: null,
            entries: [{ id: 'door', x: 1, y: 2 }],
            exits: [{ id: 'out', name: 'the door', x: 0, y: 2, to: 'out' }],
            features: [],
            walls: [],
            doors: [],
            obstacles: [],
            hazards: [],
          },
        },
      };
    },
  };
});
const interpreted = [];
const narrated = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('COMBAT TURN stage')) return {};
    if (options.systemInstruction.includes('INTERPRET stage')) {
      interpreted.push(options.systemInstruction);
      return mockState.intent;
    }
    narrated.push(options.userMessage);
    return { narration: 'It is tried.', inventedEntities: [], suggestedActions: [] };
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

describe.each(Object.keys(mockCases))('plausibility under %s', (id) => {
  const c = mockCases[id];
  const system = c.system;
  const ladder = system.checks.ladder;
  const top = ladder[ladder.length - 1];
  beforeAll(() => {
    mockState.id = id;
  });
  beforeEach(() => {
    interpreted.length = 0;
    narrated.length = 0;
  });

  const intent = (verb, params) => ({ verb, targets: [], params });
  async function saveOf(saveId, { fight = false } = {}) {
    await db
      .collection('loom_saves')
      .doc(saveId)
      .set({
        ...makeSave({
          ownerUid: PLAYER.uid,
          worldId: 'shattered-coast',
          name: 'Voyage',
          character: { name: 'Tam', sheet: sheets.defaultSheet(system) },
          location: 'widows-reach',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        mapId: 'bm_hall',
        cell: { x: 2, y: 2 },
        ...(fight
          ? {
              fight: {
                id: 'fight-1',
                mapId: 'bm_hall',
                by: 'seen',
                round: 1,
                order: ['player', 'grell'],
                turn: 'player',
                combatants: {
                  player: { kind: 'player', side: 'party', name: 'Tam', reactionsLeft: 1 },
                  grell: { kind: 'character', side: 'hostile', name: 'Grell', reactionsLeft: 1 },
                },
              },
            }
          : {}),
      });
    return db.collection('loom_saves').doc(saveId);
  }
  const type = (ref, actionText) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, actionText },
      auth: PLAYER,
    });
  const saved = async (ref) => (await ref.get()).data();

  test('ADJUDICATE: an improbable action is at the top rung, whatever was proposed', () => {
    const state = { location: 'widows-reach', character: { name: 'Tam' } };
    const world = { system, locations: {}, characters: {} };
    for (const rung of ladder.map((r) => r.name)) {
      const { roll } = evaluate(
        intent('leap', { plausibility: 'improbable', check: { attribute: c.attribute, rung } }),
        {},
        state,
        1,
        world
      );
      expect(roll.rung).toBe(top.name);
      expect(roll.difficulty).toBe(top.value);
    }
    // With no check proposed too, and never against someone's easier roll.
    expect(
      evaluate(intent('leap', { plausibility: 'improbable' }), {}, state, 1, world).roll.rung
    ).toBe(top.name);
    // An ordinary action keeps its rung.
    const easy = evaluate(
      intent('climb', {
        plausibility: 'ordinary',
        check: { attribute: c.attribute, rung: ladder[0].name },
      }),
      {},
      state,
      1,
      world
    );
    expect(easy.roll.rung).toBe(ladder[0].name);
  });

  test('INTERPRET is told the four kinds, the top rung and the character', async () => {
    mockState.intent = intent('look', { plausibility: 'ordinary' });
    const ref = await saveOf(`${id}-told`);
    await type(ref, 'look around');
    const told = interpreted[0];
    expect(told).toContain('PLAUSIBILITY: never make the improbable seem easy.');
    for (const kind of ['"ordinary"', '"improbable"', '"extraordinary"', '"complicated"']) {
      expect(told).toContain(kind);
    }
    expect(told).toContain(`the rules roll it at ${top.name}`);
    expect(told).toContain('THE CHARACTER: attributes ');
  });

  test('improbable, typed: rolled at the top rung, the action spent', async () => {
    mockState.intent = intent('leap', {
      plausibility: 'improbable',
      check: { attribute: c.attribute, rung: ladder[0].name },
    });
    const ref = await saveOf(`${id}-improbable`);
    const answer = await type(ref, 'leap across the chasm');
    expect(answer.roll).toMatchObject({ rung: top.name, difficulty: top.value });
    expect((await saved(ref)).turn.actionUsed).toBe(true);
  });

  test('extraordinary: refused with its reason, nothing spent', async () => {
    mockState.intent = intent('fly', {
      plausibility: 'extraordinary',
      why: "You can't fly: nothing in you or this world lets you.",
    });
    const ref = await saveOf(`${id}-extraordinary`);
    const before = await saved(ref);
    const answer = await type(ref, 'fly over the hall');
    expect(answer).toMatchObject({
      refused: true,
      narration: "You can't fly: nothing in you or this world lets you.",
    });
    const after = await saved(ref);
    expect(after.turn).toEqual(before.turn);
    expect(after.time).toEqual(before.time);
    expect((await ref.collection('loom_turns').get()).size).toBe(0);
    expect(narrated).toHaveLength(0);
  });

  test('complicated: asked how, nothing spent; the answer is rolled from', async () => {
    mockState.intent = intent('rig', {
      plausibility: 'complicated',
      question: 'How exactly do you bring the chandelier down on them?',
    });
    const ref = await saveOf(`${id}-complicated`);
    const before = await saved(ref);
    const asked = await type(ref, 'rig the chandelier to fall on them');
    expect(asked).toMatchObject({
      refused: true,
      asked: 'How exactly do you bring the chandelier down on them?',
      narration: 'How exactly do you bring the chandelier down on them?',
    });
    let save = await saved(ref);
    expect(save.asked).toEqual({
      action: 'rig the chandelier to fall on them',
      question: 'How exactly do you bring the chandelier down on them?',
    });
    expect(save.turn).toEqual(before.turn);
    expect(save.time).toEqual(before.time);

    // The answer: INTERPRET is told the question, and the check follows.
    mockState.intent = intent('cut', {
      plausibility: 'ordinary',
      check: { attribute: c.attribute, rung: ladder[1].name },
    });
    const tried = await type(ref, 'I climb the beam and saw through its rope');
    expect(interpreted[interpreted.length - 1]).toContain(
      'EARLIER: the player tried "rig the chandelier to fall on them" and was asked: ' +
        '"How exactly do you bring the chandelier down on them?"'
    );
    expect(tried.roll).toMatchObject({ rung: ladder[1].name });
    save = await saved(ref);
    expect(save.asked).toBeUndefined();
    expect(save.turn.actionUsed).toBe(true);
  });

  test('a second vague answer is refused; anything else drops the question', async () => {
    const question = 'How exactly?';
    mockState.intent = intent('rig', { plausibility: 'complicated', question });
    const ref = await saveOf(`${id}-vague`);
    await type(ref, 'rig a trap');
    // Still no how: no explanation, no attempt.
    const vague = await type(ref, 'you know, cleverly');
    expect(vague).toMatchObject({
      refused: true,
      narration: "Without a clear way to do it, you can't attempt it.",
    });
    let save = await saved(ref);
    expect(save.asked).toBeUndefined();
    expect(save.turn.actionUsed).toBe(false);

    // Asked again, then the player does something else: the question goes.
    await type(ref, 'rig a trap');
    expect((await saved(ref)).asked).toBeDefined();
    await loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, action: { verb: 'end-turn' } },
      auth: PLAYER,
    });
    save = await saved(ref);
    expect(save.asked).toBeUndefined();
  });

  test('in a fight too: extraordinary refused and asking spend nothing; improbable at the top', async () => {
    const ref = await saveOf(`${id}-fight`, { fight: true });
    mockState.intent = intent('teleport', { plausibility: 'extraordinary', why: 'No.' });
    expect(await type(ref, 'teleport behind Grell')).toMatchObject({
      refused: true,
      narration: 'No.',
    });
    mockState.intent = intent('trick', { plausibility: 'complicated', question: 'How?' });
    expect(await type(ref, 'trick Grell into the pit')).toMatchObject({
      refused: true,
      asked: 'How?',
    });
    const save = await saved(ref);
    expect(save.turn.actionUsed).toBe(false);
    expect(save.fight).toMatchObject({ round: 1, turn: 'player' });
    mockState.intent = intent('vault', {
      plausibility: 'improbable',
      check: { attribute: c.attribute, rung: ladder[0].name },
    });
    const vault = await type(ref, 'vault over Grell');
    expect(vault.roll).toMatchObject({ rung: top.name });
    expect((await saved(ref)).turn.actionUsed).toBe(true);
  });
});
