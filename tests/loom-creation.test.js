'use strict';

/**
 * Making a character (planning/game-systems.md §3 CS5, §4.5; L-812 / #639):
 * a system's creation settings checked on save; a sheet built from the
 * player's choices by the system's method (an array, point buy, rolling), or
 * refused with each reason; rolls made and kept by the server and used once;
 * a premade character skipping it all; the first turn's roll reading the
 * scores chosen. Under both built-in systems (MD2), and a rolling one.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-creation --verbose"
 */

const PROJECT = 'demo-loom-creation';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const creation = require('../functions/loom-canon/creation');
const formula = require('../functions/loom-canon/formula');
const { BUILT_IN, validateSystem } = require('../functions/loom-canon/systems');
const { validateSheet } = require('../functions/loom-canon/sheets');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];
// The fantasy system, rolling 4d6 and keeping the best three, with a trait.
const ROLLING = {
  ...JSON.parse(JSON.stringify(FANTASY)),
  id: 'rolled-d20',
  name: 'Rolled d20',
  creation: {
    method: 'rolling',
    formula: '4d6kh3',
    skills: { trained: 2, rank: 2 },
    traits: { pick: 1 },
  },
};
ROLLING.sheet.traits = [{ id: 'fleet', name: 'Fleet of foot', modifiers: { speed: '5' } }];

const FANTASY_SCORES = { STR: 8, DEX: 15, CON: 14, INT: 10, WIS: 12, CHA: 13 };
const SCIFI_SCORES = { Body: 3, Reflex: 5, Mind: 1, Presence: 1 }; // 2 + 6 + 0 + 0 = 8

describe('a system’s creation settings, checked on save', () => {
  test('the built-in systems’ and a rolling one’s are sound', () => {
    for (const system of [FANTASY, SCIFI, ROLLING]) {
      expect(validateSystem(system)).toMatchObject({ errors: [], warnings: [] });
    }
  });

  test('settings that don’t fit the sheet are refused, each named', () => {
    const bad = (creationSettings, base = FANTASY) =>
      validateSystem({ ...base, creation: creationSettings }).errors;
    expect(bad({ method: 'array', values: [15, 14] })).toEqual([
      'creation.values needs one score for each of the 6 attributes.',
    ]);
    expect(bad({ method: 'array', values: [20, 14, 13, 12, 10, 8] })).toEqual([
      'creation.values must be whole numbers every attribute allows (3 to 18).',
    ]);
    expect(bad({ method: 'pointBuy', budget: 1, costs: { 1: 1, 9: 0 } }, SCIFI)).toEqual([
      "creation.costs: 9 isn't a score every attribute allows (1 to 5).",
    ]);
    expect(bad({ method: 'pointBuy', budget: 3, costs: { 2: 1 } }, SCIFI)).toEqual([
      'creation.budget is too small to buy every attribute its cheapest score.',
    ]);
    expect(bad({ method: 'rolling', formula: '5d6' })).toEqual([
      'creation.formula rolls 5 to 30; every attribute allows 3 to 18.',
    ]);
    expect(
      bad({ method: 'array', values: [15, 14, 13, 12, 10, 8], skills: { trained: 99, rank: 2 } })
    ).toEqual(['creation.skills.trained must be a whole number from 0 to 13.']);
    // One trait to pick from (L-823: Parry).
    expect(bad({ method: 'array', values: [15, 14, 13, 12, 10, 8], traits: { pick: 2 } })).toEqual([
      'creation.traits.pick must be a whole number from 0 to 1.',
    ]);
  });
});

describe.each([
  ['d20-fantasy (an array)', FANTASY, FANTASY_SCORES, ['Stealth', 'Athletics']],
  ['pool-scifi (point buy)', SCIFI, SCIFI_SCORES, ['Stealth', 'Tech', 'Piloting']],
])('a sheet made under %s', (label, system, scores, skills) => {
  const fantasy = system === FANTASY;

  test('the choices make a sheet that fits', () => {
    const { sheet, errors } = creation.buildSheet(
      system,
      { attributes: scores, skills },
      { startingTraits: ['swim'] }
    );
    expect(errors).toEqual([]);
    expect(validateSheet(system, sheet)).toEqual([]);
    expect(sheet.attributes).toEqual(scores);
    const rank = fantasy ? 2 : 1;
    skills.forEach((id) => expect(sheet.skills[id]).toBe(rank));
    expect(sheet.skills[fantasy ? 'Persuasion' : 'Persuade']).toBe(0);
    expect(sheet.traits).toEqual(['swim']);
    // Full health for these scores, and speed by the formula.
    expect(sheet.resources.health.current).toBe(fantasy ? 8 : 6); // CON 14: 6 + 2; Body 3: 3 + 3
    expect(sheet.speed).toBe(fantasy ? 23 : 24); // DEX 15 and Athletics 2: 20 + 2 + 1; Reflex 5: 14 + 10
  });

  test('choices that break the method are refused, with the reason', () => {
    const refuse = (choices) => creation.buildSheet(system, choices).errors;
    const first = system.sheet.attributes[0];
    if (fantasy) {
      // A value used twice, and not every value used.
      expect(refuse({ attributes: { ...scores, STR: 15 } })).toEqual([
        'Use each of these scores once: 15, 14, 13, 12, 10, 8.',
      ]);
      expect(
        refuse({
          attributes: scores,
          skills: ['Stealth', 'Lore', 'Insight', 'Survival', 'Athletics'],
        })
      ).toEqual(['Choose at most 4 skills.']);
    } else {
      // Over budget, and a score that can't be bought.
      expect(refuse({ attributes: { ...scores, Mind: 3 } })).toEqual([
        'That costs 10 points; the budget is 8.',
      ]);
      expect(
        refuse({ attributes: scores, skills: ['Stealth', 'Tech', 'Notice', 'Melee'] })
      ).toEqual(['Choose at most 3 skills.']);
    }
    const missing = { ...scores };
    delete missing[first.id];
    expect(refuse({ attributes: missing })).toEqual([`Choose a score for ${first.name}.`]);
    expect(refuse({ attributes: scores, skills: ['Stealth', 'Stealth'] })).toEqual([
      'A skill is chosen twice.',
    ]);
    expect(refuse({ attributes: scores, skills: ['Juggling'] })).toEqual([
      'There is no skill "Juggling" in this world\'s rules.',
    ]);
    expect(refuse({ attributes: scores, traits: ['fleet'] })).toEqual([
      'Choose at most 0 traits.',
      'There is no trait "fleet" in this world\'s rules.',
    ]);
  });

  test('the page’s view: the method, and each score’s modifier', () => {
    const view = creation.creationView(system);
    expect(view.method).toBe(fantasy ? 'array' : 'pointBuy');
    expect(view.skillsToTrain).toBe(fantasy ? 4 : 3);
    const attr = view.attributes[0];
    expect(attr.modifiers[attr.min]).toBe(fantasy ? -4 : 1);
    expect(attr.modifiers[attr.max]).toBe(fantasy ? 4 : 5);
  });
});

describe('rolling', () => {
  test('the server rolls a score per attribute, with its dice', () => {
    const rolls = creation.rollAttributes(ROLLING, formula.seeded(3));
    expect(rolls).toHaveLength(6);
    rolls.forEach((r) => {
      expect(r.dice).toHaveLength(4);
      expect(r.dice.filter((d) => d.kept)).toHaveLength(3);
      expect(r.total).toBe(r.dice.filter((d) => d.kept).reduce((s, d) => s + d.value, 0));
      expect(r.line).toBe(`4d6kh3 (${r.total})`);
    });
  });

  test('the rolled scores, assigned; a changed one is refused; a trait adds its speed', () => {
    const rolled = [16, 12, 11, 10, 9, 7];
    const attributes = { STR: 7, DEX: 16, CON: 12, INT: 11, WIS: 10, CHA: 9 };
    const made = creation.buildSheet(ROLLING, { attributes, traits: ['fleet'] }, { rolled });
    expect(made.errors).toEqual([]);
    expect(made.sheet.speed).toBe(20 + 3 + 5);
    expect(
      creation.buildSheet(ROLLING, { attributes: { ...attributes, DEX: 18 } }, { rolled }).errors
    ).toEqual(['Use each rolled score once: 16, 12, 11, 10, 9, 7.']);
    expect(creation.buildSheet(ROLLING, { attributes }).errors).toEqual(['Roll the scores first.']);
  });
});

// ── Through the callables ──────────────────────────────────────────────

const mockState = { system: FANTASY, startingSheet: null };
const mockIntent = { verb: 'sneak', targets: [], params: {} };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) =>
      worldId === COAST.id
        ? {
            ...COAST,
            system: mockState.system,
            rules: {
              ...COAST.rules,
              ...(mockState.startingSheet ? { startingSheet: mockState.startingSheet } : {}),
            },
          }
        : real.loadWorld(worldId, options),
  };
});
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return JSON.parse(JSON.stringify(mockIntent));
    }
    return { narration: 'It happens.', inventedEntities: [], suggestedActions: [] };
  },
}));

describe('making a character in a new game', () => {
  const path = require('path');
  const functionsDir = path.resolve(__dirname, '../functions');
  const { getFirestore } = require(
    require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
  );
  const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
  const {
    loomCreationRules,
    loomRollCharacter,
    loomCreateSave,
    loomPlayTurn,
  } = require('../functions/index');
  const db = getFirestore();
  const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };
  const OTHER = { uid: 'player-002', token: { apps: ['loom'] } };
  const WORLD = 'shattered-coast';
  const create = (creationChoices, auth = PLAYER) =>
    loomCreateSave.run({
      data: { worldId: WORLD, name: 'Voyage', characterName: 'Tam', creation: creationChoices },
      auth,
    });
  const sheetOf = async (saveId) =>
    (await db.collection('loom_saves').doc(saveId).get()).data().character.sheet;

  afterEach(() => {
    mockState.system = FANTASY;
    mockState.startingSheet = null;
  });
  afterAll(async () => {
    await db.recursiveDelete(db.collection('loom_saves'));
    await db.recursiveDelete(db.collection('loom_creation_rolls'));
    functionsTest.cleanup();
  });

  test.each([
    ['d20-fantasy', FANTASY, FANTASY_SCORES, ['Stealth']],
    ['pool-scifi', SCIFI, SCIFI_SCORES, ['Stealth']],
  ])(
    '%s: the rules for the page, then a sheet made from the choices',
    async (id, system, scores, skills) => {
      mockState.system = system;
      const rules = await loomCreationRules.run({ data: { worldId: WORLD }, auth: PLAYER });
      expect(rules).toMatchObject({
        system: { id, name: system.name },
        creation: { method: system.creation.method },
        premade: false,
      });
      const { saveId } = await create({ attributes: scores, skills });
      const sheet = await sheetOf(saveId);
      expect(sheet.attributes).toEqual(scores);
      expect(sheet.traits).toEqual(['seaworthy-vessel']); // the world's starting abilities
      expect(validateSheet(system, sheet)).toEqual([]);
      // Refused with the reason.
      await expect(
        create({ attributes: { ...scores, [system.sheet.attributes[0].id]: 99 } })
      ).rejects.toThrow(/can't be 99/);
    }
  );

  test('the first turn’s roll uses the scores chosen', async () => {
    const { saveId } = await create({ attributes: FANTASY_SCORES, skills: ['Stealth'] });
    Object.assign(mockIntent, { params: { check: { skill: 'Stealth', rung: 'Easy' } } });
    const spy = jest.spyOn(crypto, 'randomInt').mockImplementation(() => 10);
    try {
      const answer = await loomPlayTurn.run({
        data: { worldId: WORLD, saveId, actionText: 'slip past' },
        auth: PLAYER,
      });
      // DEX 15 gives +2, and Stealth trained at +2.
      expect(answer.roll.line).toBe('d20 (10) + Dexterity (2) + Stealth (2)');
      expect(answer.roll.total).toBe(14);
    } finally {
      spy.mockRestore();
    }
  });

  test('rolling: rolled and kept by the server, used once, and only by the roller', async () => {
    mockState.system = ROLLING;
    await expect(create({ attributes: FANTASY_SCORES })).rejects.toThrow('Roll the scores first.');
    const { rollId, rolls } = await loomRollCharacter.run({
      data: { worldId: WORLD },
      auth: PLAYER,
    });
    expect(rolls).toHaveLength(6);
    const values = rolls.map((r) => r.total);
    const ids = ROLLING.sheet.attributes.map((a) => a.id);
    const attributes = Object.fromEntries(ids.map((id, i) => [id, values[i]]));
    // Someone else can't use them; a changed score is refused.
    await expect(create({ attributes, rollId }, OTHER)).rejects.toThrow(/not yours/);
    const changed = { ...attributes, STR: values[0] === 18 ? 17 : values[0] + 1 };
    await expect(create({ attributes: changed, rollId })).rejects.toThrow(
      /Use each rolled score once/
    );
    const { saveId } = await create({ attributes, rollId, traits: ['fleet'] });
    expect((await sheetOf(saveId)).attributes).toEqual(attributes);
    // Used once.
    expect((await db.collection('loom_creation_rolls').doc(rollId).get()).exists).toBe(false);
    await expect(create({ attributes, rollId })).rejects.toThrow(/not yours/);
    // A system that doesn't roll won't.
    mockState.system = FANTASY;
    await expect(loomRollCharacter.run({ data: { worldId: WORLD }, auth: PLAYER })).rejects.toThrow(
      /aren't rolled/
    );
  });

  test('a premade character skips it all; no choices, the defaults', async () => {
    const premade = creation.buildSheet(FANTASY, { attributes: FANTASY_SCORES }).sheet;
    mockState.startingSheet = premade;
    expect((await loomCreationRules.run({ data: { worldId: WORLD }, auth: PLAYER })).premade).toBe(
      true
    );
    const { saveId } = await create({ attributes: { STR: 3 } });
    expect((await sheetOf(saveId)).attributes).toEqual(FANTASY_SCORES);
    mockState.startingSheet = null;
    const plain = await create(undefined);
    expect((await sheetOf(plain.saveId)).attributes.STR).toBe(10);
  });
});
