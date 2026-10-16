'use strict';

/**
 * Checks (planning/game-systems.md §3 DC1–DC8, §4.4; L-803 / #629): a check
 * proposed by INTERPRET, validated and rolled by ADJUDICATE with the
 * world's system; degrees; opposed checks; a lock's difficulty winning over
 * the proposal. By the two-configuration rule (MD2), everything here runs
 * under a d20 test system and a dice-pool test system. Pure tests of
 * functions/loom-canon/checks.js and ADJUDICATE's evaluate, then turns
 * through loomPlayTurn with Gemini stubbed and the server's dice fixed.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-checks --verbose"
 */

const PROJECT = 'demo-loom-checks';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { validateSystem } = require('../functions/loom-canon/systems');
const checks = require('../functions/loom-canon/checks');
const { evaluate } = require('../functions/loom-turn/adjudicate');

// ── The two test systems ──────────────────────────────────────────────

const D20 = {
  id: 'test-d20',
  name: 'Test d20',
  sheet: {
    attributes: [
      { id: 'STR', name: 'Strength', min: 1, max: 20, modifier: 'floor((STR - 10) / 2)' },
      { id: 'DEX', name: 'Dexterity', min: 1, max: 20, modifier: 'floor((DEX - 10) / 2)' },
    ],
    resources: [{ id: 'health', name: 'Health', max: '10 + STR' }],
    level: { min: 1, max: 10 },
    optional: ['skills'],
    skills: [
      { id: 'Stealth', name: 'Stealth', attribute: 'DEX' },
      { id: 'Athletics', name: 'Athletics', attribute: 'STR' },
      { id: 'Thievery', name: 'Thievery', attribute: 'DEX' },
    ],
  },
  checks: {
    formula: '1d20 + modifier + rank',
    degrees: {
      criticalSuccess: 'natural = 20',
      criticalFailure: 'natural = 1',
      successAtCost: 'result >= difficulty - 2',
    },
    ladder: [
      { name: 'Easy', value: 10 },
      { name: 'Hard', value: 15 },
      { name: 'Heroic', value: 20 },
    ],
    lock: { skill: 'Thievery' },
  },
  creation: { method: 'array', values: [14, 12] },
};

const POOL = {
  id: 'test-pool',
  name: 'Test pool',
  sheet: {
    attributes: [
      { id: 'Body', name: 'Body', min: 1, max: 5, modifier: 'Body' },
      { id: 'Reflex', name: 'Reflex', min: 1, max: 5, modifier: 'Reflex' },
    ],
    resources: [{ id: 'stress', name: 'Stress', max: '3 + Body' }],
    level: { min: 1, max: 10 },
    optional: ['skills'],
    skills: [
      { id: 'Stealth', name: 'Stealth', attribute: 'Reflex' },
      { id: 'Athletics', name: 'Athletics', attribute: 'Body' },
      { id: 'Thievery', name: 'Thievery', attribute: 'Reflex' },
    ],
  },
  checks: {
    formula: 'count((attribute + rank)d10, >= 7)',
    degrees: {
      criticalSuccess: 'result >= difficulty + 2',
      criticalFailure: 'result = 0',
      successAtCost: 'result = difficulty - 1',
    },
    ladder: [
      { name: 'Easy', value: 1 },
      { name: 'Hard', value: 2 },
      { name: 'Heroic', value: 3 },
    ],
    lock: { skill: 'Thievery' },
    ties: 'attacker',
  },
  creation: { method: 'pointBuy', budget: 6 },
};

// Dice that come up as listed, in order.
const fixed =
  (...faces) =>
  () => {
    if (!faces.length) throw new Error('ran out of fixed dice');
    return faces.shift();
  };

// Per system: a character with a sheet, and the rung and dice for each
// degree. The d20 sneak: DEX 14 (+2), Stealth 3, so d20 + 5, against Hard
// (15). The pool sneak: Reflex 2, Stealth 1, so 3d10 counting sevens and up,
// against Hard (2) or Heroic (3), or Easy (1) for a critical success.
const CASES = {
  [D20.id]: {
    system: D20,
    sheet: { attributes: { DEX: 14, STR: 12 }, skills: { Stealth: 3, Thievery: 4 } },
    sneakTotal: (faces) => faces[0] + 5,
    degrees: {
      criticalSuccess: ['Hard', [20]],
      success: ['Hard', [12]],
      successAtCost: ['Hard', [8]],
      failure: ['Hard', [4]],
      criticalFailure: ['Hard', [1]],
    },
  },
  [POOL.id]: {
    system: POOL,
    sheet: { attributes: { Reflex: 2, Body: 3 }, skills: { Stealth: 1, Thievery: 2 } },
    sneakTotal: (faces) => faces.filter((f) => f >= 7).length,
    degrees: {
      criticalSuccess: ['Easy', [7, 8, 9]],
      success: ['Hard', [9, 7, 2]],
      successAtCost: ['Hard', [9, 3, 2]],
      failure: ['Heroic', [9, 3, 2]],
      criticalFailure: ['Hard', [1, 2, 3]],
    },
  },
};

test('both test systems pass their checks on save', () => {
  expect(validateSystem(D20)).toMatchObject({ errors: [], warnings: [] });
  expect(validateSystem(POOL)).toMatchObject({ errors: [], warnings: [] });
});

describe.each(Object.keys(CASES))('checks under %s (the two-configuration rule)', (id) => {
  const { system, sheet, sneakTotal, degrees } = CASES[id];
  const character = { name: 'Tam', sheet };

  test('a proposed check rolls with its skill’s attribute and rank', () => {
    const faces = degrees.success[1];
    const roll = checks.rollCheck(system, {
      check: { skill: 'Stealth', rung: 'Hard' },
      character,
      dice: fixed(...faces),
    });
    expect(roll).toMatchObject({
      total: sneakTotal(faces),
      rung: 'Hard',
      difficulty: system.checks.ladder[1].value,
      degree: 'success',
      success: true,
      skillId: 'Stealth',
      attributeId: system.sheet.skills[0].attribute,
    });
    // Its breakdown names what it read.
    expect(roll.breakdown.terms.map((t) => t.name).filter(Boolean)).toEqual(
      id === D20.id ? ['modifier', 'rank'] : ['attribute', 'rank']
    );
  });

  test('every degree is reachable with fixed dice', () => {
    for (const [degree, [rung, faces]] of Object.entries(degrees)) {
      const roll = checks.rollCheck(system, {
        check: { skill: 'Stealth', rung },
        character,
        dice: fixed(...faces),
      });
      expect([degree, roll.degree]).toEqual([degree, degree]);
    }
  });

  test('an unknown skill, attribute or rung is refused', () => {
    expect(checks.refusal(system, { skill: 'Juggling', rung: 'Hard' })).toBe(
      'There is no skill "Juggling" in this world’s rules.'
    );
    expect(checks.refusal(system, { attribute: 'Luck', rung: 'Hard' })).toBe(
      'There is no attribute "Luck" in this world’s rules.'
    );
    expect(checks.refusal(system, { skill: 'Stealth', rung: 'Impossible' })).toBe(
      'There is no difficulty "Impossible" in this world’s rules.'
    );
    expect(checks.refusal(system, { skill: 'Stealth', rung: 'hard' })).toBeNull();
  });

  test('without a sheet: base attributes, untrained', () => {
    const roll = checks.rollCheck(system, {
      check: { skill: 'Stealth', rung: 'Easy' },
      character: { name: 'Nobody' },
      dice: fixed(10, 10, 10, 10, 10),
    });
    // d20: base DEX 10 (+0), untrained: 10. Pool: base Reflex 3, untrained: 3 dice, all tens.
    expect(roll.total).toBe(id === D20.id ? 10 : 3);
  });

  test('an opposed check rolls both sides, the higher wins, ties by the system', () => {
    const guard = { id: 'chr_guard', name: 'The guard', sheet };
    // Same sheets, same dice: a tie. The d20 system gives it to the defender,
    // the pool system to the attacker.
    const tie = checks.rollOpposed(system, {
      check: { skill: 'Stealth' },
      character,
      opponent: guard,
      dice: fixed(...(id === D20.id ? [12, 12] : [9, 7, 2, 9, 7, 2])),
    });
    expect(tie.defender.total).toBe(tie.attacker.total);
    expect(tie.attacker.success).toBe(id === POOL.id);
    // The attacker rolls higher: they win.
    const win = checks.rollOpposed(system, {
      check: { skill: 'Stealth' },
      character,
      opponent: guard,
      dice: fixed(...(id === D20.id ? [5, 15] : [2, 2, 2, 9, 9, 9])),
    });
    expect(win.attacker.total).toBeGreaterThan(win.defender.total);
    expect(win.attacker.success).toBe(true);
  });

  test('a lock’s difficulty is placed on the ladder', () => {
    if (id === D20.id) {
      // A d20 ladder: the number as it is, named by the nearest rung.
      expect(checks.canonRung(system, 15)).toEqual({ name: 'Hard', value: 15 });
      expect(checks.canonRung(system, 12)).toEqual({ name: 'Easy', value: 12 });
    } else {
      // A pool ladder: the same place on the d20 scale (15: the second rung).
      expect(checks.canonRung(system, 15)).toEqual({ name: 'Hard', value: 2 });
      expect(checks.canonRung(system, 30)).toEqual({ name: 'Heroic', value: 3 });
    }
    expect(checks.canonRung(system, 'Heroic')).toEqual(system.checks.ladder[2]);
  });

  describe('in ADJUDICATE', () => {
    const ROOM = {
      id: 'bm_room',
      name: 'A room',
      width: 10,
      height: 6,
      entries: [{ id: 'in', x: 0, y: 2 }],
      exits: [{ id: 'out', name: 'the way out', x: 0, y: 3, to: 'out' }],
      features: [],
      walls: [
        {
          points: [
            { x: 5, y: 0 },
            { x: 5, y: 2 },
          ],
        },
        {
          points: [
            { x: 5, y: 3 },
            { x: 5, y: 6 },
          ],
        },
      ],
      doors: [
        {
          id: 'inner',
          name: 'the inner door',
          from: { x: 5, y: 2 },
          to: { x: 5, y: 3 },
          locked: true,
          difficulty: 15,
        },
      ],
    };
    const world = {
      system,
      battleMaps: { bm_room: ROOM },
      characters: { chr_guard: { id: 'chr_guard', name: 'The guard', sheet } },
      locations: {},
    };
    const save = {
      mapId: 'bm_room',
      cell: { x: 4, y: 2 },
      character,
      turn: { n: 1, movementLeft: 6, actionUsed: false, plan: null },
    };
    const act = (params, dice, targets = []) =>
      evaluate({ verb: 'sneak', targets, params }, {}, save, dice, world);

    test('a proposed check is validated and rolled, its roll on the card', () => {
      const r = act({ check: { skill: 'Stealth', rung: 'Hard' } }, fixed(...degrees.success[1]));
      expect(r.outcome).toBe('success');
      expect(r.roll).toMatchObject({ rung: 'Hard', degree: 'success', success: true });
      expect(r.constraints).toEqual(['The attempt to sneak succeeds.']);
      const refused = act({ check: { skill: 'Juggling', rung: 'Hard' } }, fixed());
      expect(refused).toEqual({
        outcome: 'blocked',
        mutations: [],
        constraints: ['There is no skill "Juggling" in this world’s rules.'],
      });
    });

    test('a lock’s difficulty overrides the proposal; the lock check rolls Thievery', () => {
      const faces = id === D20.id ? [9] : [8, 8, 1, 1];
      const r = evaluate(
        { verb: 'pick_lock', targets: ['door:inner'], params: { check: { rung: 'Easy' } } },
        {},
        save,
        fixed(...faces),
        world
      );
      // Not Easy: the lock's 15 (Hard). d20: 9 + 2 + 4 = 15. Pool: 4 dice, 2 sevens.
      expect(r.roll).toMatchObject({ rung: 'Hard', against: 'the lock on the inner door' });
      expect(r.outcome).toBe('success');
      expect(r.constraints).toEqual(['The lock gives way: the inner door is unlocked.']);
    });

    test('an opposed check rolls both sides, and the resolution carries both', () => {
      const r = act(
        { check: { skill: 'Stealth', opposedBy: 'chr_guard' } },
        fixed(...(id === D20.id ? [5, 15] : [2, 2, 2, 9, 9, 9]))
      );
      expect(r.outcome).toBe('success');
      expect(r.roll).toMatchObject({ against: 'The guard', success: true });
      expect(r.opposed).toMatchObject({ by: 'chr_guard', roll: { against: 'you' } });
      expect(r.constraints[0]).toMatch(/^The attempt to sneak against The guard succeeds/);
      const nobody = act({ check: { skill: 'Stealth', opposedBy: 'chr_nobody' } }, fixed());
      expect(nobody.outcome).toBe('blocked');
    });
  });
});

// ── Through loomPlayTurn ──────────────────────────────────────────────

const mockPrompts = [];
const mockIntent = { verb: 'sneak', targets: [], params: {} };
const mockState = { system: D20 };
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
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) {
      mockPrompts.push(options.systemInstruction);
      return JSON.parse(JSON.stringify(mockIntent));
    }
    return { narration: 'It happens.', inventedEntities: [], suggestedActions: [] };
  },
}));

describe.each([D20, POOL])('a typed check through loomPlayTurn under $id', (system) => {
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
  const saveRef = (id) => db.collection('loom_saves').doc(id);
  let faces = [];

  beforeAll(() => {
    mockState.system = system;
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => {
      const face = faces.length ? faces.shift() : min;
      return Math.max(min, Math.min(max - 1, face));
    });
  });
  afterAll(async () => {
    crypto.randomInt.mockRestore();
    await db.recursiveDelete(db.collection('loom_saves'));
    functionsTest.cleanup();
  });

  async function typed(saveId, actionText, params) {
    Object.assign(mockIntent, { verb: 'sneak', targets: [], params });
    mockPrompts.length = 0;
    await saveRef(saveId).set(
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
      data: { worldId: 'shattered-coast', saveId, actionText },
      auth: PLAYER,
    });
    const turns = await saveRef(saveId).collection('loom_turns').get();
    return { answer, turn: turns.docs[0] && turns.docs[0].data() };
  }

  test('INTERPRET is given the system’s skills and rungs; the proposal is rolled and recorded', async () => {
    faces = system === D20 ? [19] : [9, 9, 9];
    const { answer, turn } = await typed(`s-${system.id}-1`, 'sneak past', {
      check: { skill: 'Stealth', rung: 'Easy' },
    });
    expect(mockPrompts[0]).toContain('Skills: Stealth (');
    expect(mockPrompts[0]).toContain('Difficulty, easiest first: Easy, Hard, Heroic.');
    expect(answer.roll).toMatchObject({
      rung: 'Easy',
      formula: system.checks.formula,
      degree: expect.stringMatching(/uccess/),
    });
    expect(turn.resolution.roll).toEqual(answer.roll);
    expect(turn.proposedAction.params.check).toEqual({ skill: 'Stealth', rung: 'Easy' });
  });

  test('an unknown skill is refused, no roll, and the action isn’t used', async () => {
    faces = [];
    const { answer, turn } = await typed(`s-${system.id}-2`, 'juggle', {
      check: { skill: 'Juggling', rung: 'Hard' },
    });
    expect(answer.roll).toBeUndefined();
    expect(turn.resolution).toMatchObject({
      outcome: 'blocked',
      constraints: ['There is no skill "Juggling" in this world’s rules.'],
    });
    expect((await saveRef(`s-${system.id}-2`).get()).data().turn.actionUsed).toBe(false);
  });
});
