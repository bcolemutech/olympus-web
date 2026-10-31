'use strict';

/**
 * Earning experience in play (planning/advancement.md §4.3; L-842 / #714),
 * through loomPlayTurn with Gemini stubbed, under both built-in systems: a
 * fight won pays each foe once (one dropped, one fled); a foe that
 * surrenders pays; a story moment the model names pays once, however often
 * it names it; NARRATE is told the levels; and a world with advancement off
 * pays nothing.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-advancement-earn-play --verbose"
 */

const PROJECT = 'demo-loom-advancement-earn-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// A hall 8 × 5, in at the west door; two bandits at the east end, in sight.
const mockHall = (group) => ({
  id: 'bm_hall',
  name: 'The hall',
  width: 8,
  height: 5,
  image: null,
  entries: [{ id: 'door', x: 1, y: 2 }],
  exits: mockState.exits ? [{ id: 'out', name: 'the door', x: 0, y: 2, to: 'out' }] : [],
  features: [],
  walls: [],
  doors: [],
  obstacles: [],
  hazards: [],
  figures: [group],
});
const mockCases = {
  'd20-fantasy': {
    system: FANTASY,
    melee: 'sword',
    weak: { STR: 10, DEX: 10, CON: 3, INT: 8, WIS: 3, CHA: 8 },
    strong: { STR: 18, DEX: 10, CON: 10, INT: 8, WIS: 8, CHA: 8 },
    club: {
      id: 'club',
      name: 'Club',
      reach: 1,
      attack: '1d20 + mod(STR) + 2',
      damage: '1d6 + mod(STR)',
      type: 'bludgeoning',
    },
    high: 20,
  },
  'pool-scifi': {
    system: SCIFI,
    melee: 'knife',
    skills: { Melee: 2 },
    weak: { Body: 1, Reflex: 1, Mind: 1, Presence: 1 },
    strong: { Body: 5, Reflex: 3, Mind: 2, Presence: 2 },
    club: {
      id: 'pipe',
      name: 'Pipe',
      reach: 1,
      attack: 'count((Body + Melee)d10, >= 7)',
      damage: '1d3',
      type: 'kinetic',
    },
    high: 10,
  },
};

const mockState = {
  id: 'd20-fantasy',
  intent: null,
  attributes: null,
  posture: 'cowardly',
  exits: true,
  off: false,
  moment: null,
};
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      const c = mockCases[mockState.id];
      return {
        ...COAST,
        system: c.system,
        rules: { ...(COAST.rules || {}), ...(mockState.off ? { advancement: false } : {}) },
        locations: {
          ...COAST.locations,
          'widows-reach': { ...COAST.locations['widows-reach'], battleMap: { mapId: 'bm_hall' } },
        },
        battleMaps: {
          bm_hall: mockHall({
            id: 'bandits',
            name: 'Bandit',
            posture: mockState.posture,
            statBlock: {
              attributes: mockState.attributes || c.weak,
              ...(c.skills ? { skills: c.skills } : {}),
              attacks: [c.club],
            },
            // With no way out, Bandit 1 stands beside the door (L-842).
            cells: mockState.exits
              ? [
                  { x: 6, y: 1 },
                  { x: 6, y: 3 },
                ]
              : [
                  { x: 2, y: 2 },
                  { x: 6, y: 3 },
                ],
          }),
        },
      };
    },
  };
});
const prompts = [];
const instructions = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return mockState.intent || { verb: 'search', targets: [], params: {} };
    }
    prompts.push(options.userMessage);
    instructions.push(options.systemInstruction);
    return {
      narration: 'Steel rings out.',
      inventedEntities: [],
      suggestedActions: [],
      ...(mockState.moment ? { moment: mockState.moment } : {}),
    };
  },
}));

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomPlayTurn, loomGetMap } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const db = getFirestore();
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };

let face = 5; // every die rolls this
beforeAll(() => {
  jest
    .spyOn(crypto, 'randomInt')
    .mockImplementation((min, max) => Math.min(max - 1, min + face - 1));
});
afterAll(async () => {
  crypto.randomInt.mockRestore();
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

const earning = require('../functions/loom-modules/advancement/earn');
const advancement = require('../functions/loom-modules/advancement');

describe.each(Object.keys(mockCases))('experience under %s', (id) => {
  const c = mockCases[id];
  // A bandit's worth: their level (the lowest) against the player's (the same).
  const worth = () => earning.foeWorth(c.system, 1, 1);
  beforeAll(() => {
    mockState.id = id;
  });
  beforeEach(() => {
    Object.assign(mockState, {
      intent: null,
      attributes: null,
      posture: 'cowardly',
      exits: true,
      off: false,
      moment: null,
    });
    face = 5;
    prompts.length = 0;
    instructions.length = 0;
  });

  async function onTheMap(saveId) {
    const sheet = sheets.defaultSheet(c.system);
    sheet.skills = { ...sheet.skills, ...(c.skills || {}) };
    await db
      .collection('loom_saves')
      .doc(saveId)
      .set({
        ...makeSave({
          ownerUid: PLAYER.uid,
          worldId: 'shattered-coast',
          name: 'Voyage',
          character: { name: 'Tam', sheet },
          location: 'widows-reach',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        mapId: 'bm_hall',
        cell: { x: 1, y: 2 },
      });
    return db.collection('loom_saves').doc(saveId);
  }
  const play = (saveId, data) =>
    loomPlayTurn.run({ data: { worldId: 'shattered-coast', saveId, ...data }, auth: PLAYER });
  const saved = async (ref) => (await ref.get()).data();

  // Into sight, one round, Bandit 1 dropped; then morale fails and the
  // fight plays out. Returns every answer after the blow.
  async function winFight(ref) {
    await play(ref.id, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    await play(ref.id, { action: { verb: 'end-turn' } });
    face = c.high;
    const blow = await play(ref.id, {
      action: { verb: 'attack', target: 'fig-bandits-1', attack: c.melee },
    });
    face = 1;
    const answers = [blow];
    for (let i = 0; i < 5 && (await saved(ref)).fight; i++) {
      answers.push(await play(ref.id, { action: { verb: 'end-turn' } }));
    }
    return answers;
  }
  const awardsIn = (answers) => answers.flatMap((a) => a.awards || []);

  test('a fight won pays each foe once, in the answers and on the sheet', async () => {
    const ref = await onTheMap(`${id}-won`);
    const answers = await winFight(ref);
    const save = await saved(ref);
    expect(save.fight).toBeNull();
    expect(save.figures['fig-bandits-2']).toMatchObject({ gone: 'fled' });
    expect(awardsIn(answers)).toEqual([
      { kind: 'foe', id: 'fig-bandits-1', name: 'Bandit 1', xp: worth() },
      { kind: 'foe', id: 'fig-bandits-2', name: 'Bandit 2', xp: worth() },
    ]);
    expect(save.earned.sort()).toEqual(['foe:fig-bandits-1', 'foe:fig-bandits-2']);
    expect(save.character.sheet.xp).toBe(advancement.totalFor(c.system, 1) + 2 * worth());
    // Recorded with the turn too.
    const turns = await ref.collection('loom_turns').get();
    const recorded = turns.docs.flatMap((d) => d.data().resolution.awards || []);
    expect(recorded).toHaveLength(2);
  });

  test('a foe that surrenders pays', async () => {
    // No way out: Bandit 2, breaking, throws down their weapons. (A map
    // without one can't be walked, so Bandit 1 stands beside the player.)
    mockState.exits = false;
    const ref = await onTheMap(`${id}-surrender`);
    face = c.high;
    const answers = [
      await play(ref.id, { action: { verb: 'attack', target: 'fig-bandits-1', attack: c.melee } }),
    ];
    face = 1;
    for (let i = 0; i < 5 && (await saved(ref)).fight; i++) {
      answers.push(await play(ref.id, { action: { verb: 'end-turn' } }));
    }
    expect(answers.map((a) => a.narration).join(' ')).toContain(
      'Bandit 2 throws down their weapons.'
    );
    expect(awardsIn(answers).map((a) => a.id)).toEqual(['fig-bandits-1', 'fig-bandits-2']);
    expect((await saved(ref)).earned).toContain('foe:fig-bandits-2');
  });

  test('NARRATE is told the player’s level against the foes’', async () => {
    const ref = await onTheMap(`${id}-levels`);
    prompts.length = 0;
    // Coming into sight starts the fight; a typed action in it is narrated.
    await play(ref.id, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    mockState.intent = { verb: 'shout', targets: [], params: {} };
    await play(ref.id, { actionText: 'shout a challenge' });
    const word = (c.system.words && c.system.words.level) || 'level';
    const told = prompts.find((p) => p.includes('LEVELS:'));
    expect(told).toContain(`the player is ${word} 1`);
    expect(told).toContain(`Bandit 1 is ${word} 1, their equal`);
  });

  test('a story moment the model names pays once, however often it names it', async () => {
    const ref = await db.collection('loom_saves').doc(`${id}-moment`);
    await ref.set(
      makeSave({
        ownerUid: PLAYER.uid,
        worldId: 'shattered-coast',
        name: 'Voyage',
        character: { name: 'Tam', sheet: sheets.defaultSheet(c.system) },
        location: 'widows-reach',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    );
    mockState.intent = { verb: 'search', targets: [], params: {} };
    mockState.moment = { id: 'The Drowned Bell', size: 'notable', name: 'The drowned bell rang' };
    const first = await play(ref.id, { actionText: 'ring the drowned bell' });
    expect(first.awards).toEqual([
      {
        kind: 'moment',
        id: 'the-drowned-bell',
        name: 'The drowned bell rang',
        size: 'notable',
        xp: earning.momentWorth(c.system, 'notable', 1),
      },
    ]);
    mockState.moment = { id: 'the-drowned-bell', size: 'major' };
    const again = await play(ref.id, { actionText: 'ring the bell again' });
    expect(again.awards).toBeUndefined();
    const save = await saved(ref);
    expect(save.earned).toEqual(['moment:the-drowned-bell']);
    expect(save.character.sheet.xp).toBe(earning.momentWorth(c.system, 'notable', 1));
    // The model was told it may name one, and never an amount.
    expect(instructions[instructions.length - 1]).toContain('A STORY MOMENT');
    expect(instructions[instructions.length - 1]).toContain('Never say how much it is worth');
  });

  test('a world with advancement off pays nothing', async () => {
    mockState.off = true;
    mockState.moment = { id: 'oath-kept', size: 'major' };
    const ref = await onTheMap(`${id}-off`);
    const answers = await winFight(ref);
    expect(awardsIn(answers)).toEqual([]);
    const save = await saved(ref);
    expect(save.fight).toBeNull();
    expect(save.earned).toBeUndefined();
    // Its starting experience, written when it loads (L-841), and no more.
    expect(save.character.sheet.xp || 0).toBe(0);
  });
});
