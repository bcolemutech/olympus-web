'use strict';

/**
 * Rolls in the Loom (planning/game-systems.md §3 DC5, DC6, SY7, §4.7;
 * L-805 / #631): the roll a turn returns for its card (its dice, its line
 * with each term named, the degree in the system's words), NARRATE told the
 * degree, the system's words and its GM notes, and the rules reference
 * loomGetMap sends. By the two-configuration rule (MD2), each runs under
 * both built-in systems: the d20 fantasy and the dice-pool sci-fi.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-rolls --verbose"
 */

const PROJECT = 'demo-loom-rolls';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const formula = require('../functions/loom-canon/formula');
const checks = require('../functions/loom-canon/checks');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { mapView } = require('../functions/loom-turn/map-view');
const { COAST } = require('./helpers/coast');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// ── The roll card's line ──────────────────────────────────────────────

describe('the line with each term named (DC6)', () => {
  const named = (text, values, labels) =>
    formula.evaluate(text, { values, system: FANTASY, dice: checks.fixedDice(14), labels })
      .breakdown.named;

  test('dice, fields by their labels, keep-highest, roll-under, pools', () => {
    expect(
      named(
        '1d20 + modifier + rank',
        { modifier: 3, rank: 2 },
        { modifier: 'Agility', rank: 'Stealth' }
      )
    ).toBe('d20 (14) + Agility (3) + Stealth (2)');
    expect(named('2d20kh1 + 1', {})).toBe('2d20kh1 (14) + 1');
    expect(named('d100 <= Stealth', { Stealth: 40 })).toBe('d100 (14) <= Stealth (40)');
    expect(
      named(
        'count((attribute + rank)d10, >= 7)',
        { attribute: 3, rank: 1 },
        { attribute: 'Mind', rank: 'Tech' }
      )
    ).toBe('(Mind (3) + Tech (1))d10 ≥ 7 (4)');
    expect(named('count(4d10, >= 7)', {})).toBe('4d10 ≥ 7 (4)');
    expect(named('mod(STR) + 2', { STR: 14 }, { STR: 'Strength' })).toBe('Strength (2) + 2');
  });

  test('the pool’s size is counted once among the terms', () => {
    const { terms } = formula.evaluate('count((attribute + rank)d10, >= 7)', {
      values: { attribute: 3, rank: 1 },
      dice: checks.fixedDice(7),
    }).breakdown;
    expect(terms.map((t) => t.kind)).toEqual(['field', 'field', 'count']);
  });
});

describe.each([
  ['d20-fantasy', FANTASY, { skill: 'Stealth' }, [10], 'd20 (10) + Dexterity (0) + Stealth (0)'],
  ['pool-scifi', SCIFI, { skill: 'Stealth' }, [9, 2, 2], '(Reflex (3) + Stealth (0))d10 ≥ 7 (1)'],
])('the turn’s roll under %s', (id, system, check, faces, line) => {
  const world = { ...COAST, system };
  const queue = () => {
    const left = faces.slice();
    return () => left.shift() || 1;
  };

  test('its dice, its line, and the degree in the system’s words', () => {
    const rung = id === 'd20-fantasy' ? 'Easy' : 'Moderate';
    const { roll } = evaluate(
      { verb: 'sneak', targets: [], params: { check: { ...check, rung } } },
      {},
      { location: 'widows-reach', character: { name: 'Tam' } },
      queue(),
      world
    );
    expect(roll).toMatchObject({
      line,
      degree: 'successAtCost',
      verdict: 'Success at a cost',
      rung,
      success: true,
    });
    expect(roll.dice).toEqual(
      id === 'd20-fantasy'
        ? [{ sides: 20, value: 10, kept: true }]
        : [
            { sides: 10, value: 9, kept: true, counted: true },
            { sides: 10, value: 2, kept: true, counted: false },
            { sides: 10, value: 2, kept: true, counted: false },
          ]
    );
  });

  test('a system’s words may name the degrees', () => {
    const renamed = { ...system, words: { ...system.words, successAtCost: 'Partial' } };
    expect(checks.degreeName(renamed, 'successAtCost')).toBe('Partial');
    expect(checks.degreeName(system, 'criticalFailure')).toBe('Critical failure');
  });
});

// ── The rules reference (SY7) ─────────────────────────────────────────

describe.each([
  ['d20-fantasy', FANTASY],
  ['pool-scifi', SCIFI],
])('the rules reference under %s', (id, system) => {
  test('attributes, skills, the check, the ladder and the degrees, in its words', () => {
    const rules = checks.rulesOf(system);
    expect(rules).toMatchObject({
      id,
      name: system.name,
      check: system.checks.formula,
      reach: 'at least',
      ladder: system.checks.ladder,
    });
    expect(rules.attributes.map((a) => a.name)).toEqual(system.sheet.attributes.map((a) => a.name));
    expect(rules.skills.find((k) => k.id === 'Stealth')).toEqual({
      id: 'Stealth',
      name: 'Stealth',
      attribute: id === 'd20-fantasy' ? 'Dexterity' : 'Reflex',
    });
    expect(rules.degrees.map((d) => d.name)).toEqual([
      'Critical success',
      'Success',
      'Success at a cost',
      'Failure',
      'Critical failure',
    ]);
    // Each degree's formula in words.
    const when = Object.fromEntries(rules.degrees.map((d) => [d.id, d.when]));
    expect(when.failure).toBe('otherwise');
    if (id === 'd20-fantasy') {
      expect(when.criticalSuccess).toBe('the die is 20');
      expect(when.successAtCost).toBe('the result is at least the difficulty');
    } else {
      expect(when.success).toBe('the result reaches the difficulty');
      expect(when.criticalFailure).toBe('the result is 0');
    }
    // Nothing for the narrator alone.
    expect(JSON.stringify(rules)).not.toContain(system.gmNotes.slice(0, 20));
  });

  test('loomGetMap sends it with the map', () => {
    const view = mapView({ ...COAST, system }, { location: 'widows-reach' }, null, null);
    expect(view.rules).toEqual(checks.rulesOf(system));
  });
});

// ── NARRATE, through loomPlayTurn ─────────────────────────────────────

const mockNarrate = [];
const mockIntent = { verb: 'sneak', targets: [], params: {} };
const mockState = { system: FANTASY };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST: coast } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) =>
      worldId === coast.id
        ? { ...coast, system: mockState.system }
        : real.loadWorld(worldId, options),
  };
});
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return JSON.parse(JSON.stringify(mockIntent));
    }
    mockNarrate.push(options);
    return { narration: 'It happens.', inventedEntities: [], suggestedActions: [] };
  },
}));

describe.each([
  ['d20-fantasy', FANTASY, 'Easy', [10], ['Hit points', 'Gold']],
  ['pool-scifi', SCIFI, 'Moderate', [9, 2, 2], ['Hull', 'Credits', 'Stress']],
])('NARRATE under %s', (id, system, rung, faces, words) => {
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
  let queue = [];

  beforeAll(() => {
    mockState.system = system;
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => {
      const face = queue.length ? queue.shift() : min;
      return Math.max(min, Math.min(max - 1, face));
    });
  });
  afterAll(async () => {
    crypto.randomInt.mockRestore();
    await db.recursiveDelete(db.collection('loom_saves'));
    functionsTest.cleanup();
  });

  test('is told the degree, the system’s words and its GM notes', async () => {
    queue = faces.slice();
    mockNarrate.length = 0;
    Object.assign(mockIntent, { params: { check: { skill: 'Stealth', rung } } });
    const saveId = `rolls-${id}`;
    await db
      .collection('loom_saves')
      .doc(saveId)
      .set(
        makeSave({
          ownerUid: PLAYER.uid,
          worldId: 'shattered-coast',
          name: 'Voyage',
          character: { name: 'Tam' },
          location: 'widows-reach',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      );
    const answer = await loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId, actionText: 'sneak past the watch' },
      auth: PLAYER,
    });
    expect(answer.roll).toMatchObject({ degree: 'successAtCost', verdict: 'Success at a cost' });

    expect(mockNarrate).toHaveLength(1);
    const { systemInstruction, userMessage } = mockNarrate[0];
    expect(systemInstruction).toContain('THE GAME SYSTEM: ' + system.name);
    for (const word of words) expect(systemInstruction).toContain(`"${word}"`);
    expect(systemInstruction).toContain('Success at a cost: it works, but it costs something');
    expect(systemInstruction).toContain('GM notes for this system: ' + system.gmNotes);
    expect(userMessage).toContain('ROLL (final):\n' + answer.roll.line + ' = ');
    expect(userMessage).toContain(`against ${rung}`);
    expect(userMessage).toMatch(/: Success at a cost\n/);
  });
});
