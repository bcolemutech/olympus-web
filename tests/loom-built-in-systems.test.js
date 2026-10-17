'use strict';

/**
 * The two built-in game systems (planning/game-systems.md §3 SY3, SY4, §4.8;
 * L-804 / #630): the d20 fantasy and the dice-pool sci-fi validate with no
 * warnings; their checks come out in the odds each rung should have, by the
 * seeded dice test_roll uses; locks open on the rolls they always did; and
 * the backfill names the fantasy system on worlds made before systems.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-built-in-systems --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { initializeApp } = require(require.resolve('firebase-admin/app', { paths: [functionsDir] }));
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const systems = require('../functions/loom-canon/systems');
const checks = require('../functions/loom-canon/checks');
const formula = require('../functions/loom-canon/formula');
const loomCanon = require('../functions/loom-canon');
const { DEFAULT_LOCK_DIFFICULTY } = require('../functions/loom-turn/adjudicate');

const { BUILT_IN, RESERVED_IDS, DEFAULT_SYSTEM_ID, validateSystem } = systems;
const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// ── The odds each rung should have ────────────────────────────────────

const DEGREE_KEYS = ['criticalSuccess', 'success', 'successAtCost', 'failure', 'criticalFailure'];
const none = () => Object.fromEntries(DEGREE_KEYS.map((k) => [k, 0]));

// The fantasy system: d20 + bonus against v. A 20 is critical, a 1 a
// critical failure; reaching v by less than 2 is at a cost.
function fantasyOdds(v, bonus) {
  const odds = none();
  for (let face = 1; face <= 20; face++) {
    const total = face + bonus;
    const degree =
      face === 20
        ? 'criticalSuccess'
        : face === 1
          ? 'criticalFailure'
          : total >= v + 2
            ? 'success'
            : total >= v
              ? 'successAtCost'
              : 'failure';
    odds[degree] += 1 / 20;
  }
  return odds;
}

// The sci-fi system: n d10s, each 7 or more a success (p = 0.4), against v
// successes needed. Two over is critical, none at all a critical failure,
// one short a success at a cost.
function scifiOdds(v, n) {
  const odds = none();
  const choose = (a, b) => {
    let c = 1;
    for (let i = 0; i < b; i++) c = (c * (a - i)) / (i + 1);
    return c;
  };
  for (let k = 0; k <= n; k++) {
    const p = choose(n, k) * 0.4 ** k * 0.6 ** (n - k);
    const degree =
      k >= v + 2
        ? 'criticalSuccess'
        : k === 0
          ? 'criticalFailure'
          : k >= v
            ? 'success'
            : k === v - 1
              ? 'successAtCost'
              : 'failure';
    odds[degree] += p;
  }
  return odds;
}

// How often each degree came up in `n` seeded rolls (formula.seeded, as
// test_roll rolls).
function sampled(system, { check, sheet, rung }, n = 4000, seed = 804) {
  const dice = formula.seeded(seed);
  const counts = none();
  for (let i = 0; i < n; i++) {
    const roll = checks.rollCheck(system, {
      check: { ...check, rung },
      character: { sheet },
      dice,
    });
    counts[roll.degree] += 1;
  }
  return Object.fromEntries(DEGREE_KEYS.map((k) => [k, counts[k] / n]));
}

const expectNear = (got, want, label) => {
  for (const k of DEGREE_KEYS) {
    const off = Math.abs(got[k] - want[k]);
    if (off > 0.03) throw new Error(`${label}: ${k} came ${got[k]}, expected ~${want[k]}`);
  }
};

describe('the built-in systems', () => {
  test('both validate cleanly: no errors and no warnings', () => {
    expect(Object.keys(BUILT_IN)).toEqual(['d20-fantasy', 'pool-scifi']);
    expect(RESERVED_IDS).toEqual(['d20-fantasy', 'pool-scifi']);
    expect(DEFAULT_SYSTEM_ID).toBe('d20-fantasy');
    for (const system of [FANTASY, SCIFI]) {
      expect(validateSystem(system)).toMatchObject({ errors: [], warnings: [] });
    }
  });

  test('the fantasy system: six attributes 3–18, d20 + modifier + proficiency, 10 to 22', () => {
    expect(FANTASY.sheet.attributes.map((a) => [a.id, a.min, a.max])).toEqual(
      ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map((id) => [id, 3, 18])
    );
    expect(FANTASY.checks.formula).toBe('1d20 + modifier + rank');
    expect(FANTASY.checks.ladder.map((r) => r.value)).toEqual([10, 13, 16, 19, 22]);
    expect(FANTASY.words).toMatchObject({ health: 'Hit points' });
    expect(FANTASY.gmNotes).not.toBe('');
    // Hit points: 6 and the Constitution modifier per level.
    const health = (CON, level) =>
      formula.evaluate(FANTASY.sheet.resources[0].max, {
        values: { CON, level },
        system: FANTASY,
        dice: () => 1,
      }).total;
    expect([health(10, 1), health(14, 3), health(3, 1)]).toEqual([6, 24, 2]);
  });

  test('the sci-fi system: pools of 1–5, skills add dice, d10s of 7 or more, Hull and Credits', () => {
    expect(SCIFI.sheet.attributes.every((a) => a.min === 1 && a.max === 5)).toBe(true);
    expect(SCIFI.checks.formula).toBe('count((attribute + rank)d10, >= 7)');
    expect(SCIFI.checks.ladder.map((r) => r.value)).toEqual([1, 2, 3, 4, 5]);
    expect(SCIFI.sheet.resources.map((r) => r.id)).toEqual(['health', 'stress']);
    expect(SCIFI.words).toMatchObject({ ship: 'Hull', currency: 'Credits' });
    expect(SCIFI.gmNotes).not.toBe('');
  });
});

describe('odds bands: seeded rolls per rung land where each rung should', () => {
  // An untrained, middling character and a trained, able one, per system.
  const SHEETS = {
    'd20-fantasy': [
      { label: 'untrained', check: { skill: 'Stealth' }, sheet: {}, bonus: 0 },
      {
        label: 'DEX 16, Stealth +4',
        check: { skill: 'Stealth' },
        sheet: { attributes: { DEX: 16 }, skills: { Stealth: 4 } },
        bonus: 7,
      },
    ],
    'pool-scifi': [
      { label: 'untrained', check: { skill: 'Tech' }, sheet: {}, dice: 3 },
      {
        label: 'Mind 4, Tech 2',
        check: { skill: 'Tech' },
        sheet: { attributes: { Mind: 4 }, skills: { Tech: 2 } },
        dice: 6,
      },
    ],
  };

  describe.each([
    ['d20-fantasy', FANTASY, (rung, s) => fantasyOdds(rung.value, s.bonus)],
    ['pool-scifi', SCIFI, (rung, s) => scifiOdds(rung.value, s.dice)],
  ])('%s', (id, system, expected) => {
    test.each(SHEETS[id].map((s) => [s.label, s]))('%s, every rung', (label, s) => {
      for (const rung of system.checks.ladder) {
        expectNear(sampled(system, { ...s, rung: rung.name }), expected(rung, s), rung.name);
      }
    });
  });

  test('the bands, in words: a middling character, rung by rung, in both systems', () => {
    const at = (odds, degrees) => odds.map((o) => degrees.reduce((sum, d) => sum + o[d], 0));
    const round = (list) => list.map((x) => Math.round(x * 1000) / 1000);
    const any = ['criticalSuccess', 'success', 'successAtCost'];
    const full = ['criticalSuccess', 'success'];
    // A bare d20: Easy about half the time, as a d20 against 10 always was;
    // the two hardest only on a natural 20.
    const fantasy = FANTASY.checks.ladder.map((r) => fantasyOdds(r.value, 0));
    expect(round(at(fantasy, any))).toEqual([0.55, 0.4, 0.25, 0.1, 0.05]);
    expect(round(at(fantasy, full))).toEqual([0.45, 0.3, 0.15, 0.05, 0.05]);
    // Three dice: one short still gets it done at a cost, so Easy and
    // Moderate succeed as often, Moderate more often at a cost; Nearly
    // impossible is out of reach untrained.
    const scifi = SCIFI.checks.ladder.map((r) => scifiOdds(r.value, 3));
    expect(round(at(scifi, any))).toEqual([0.784, 0.784, 0.352, 0.064, 0]);
    expect(round(at(scifi, full))).toEqual([0.784, 0.352, 0.064, 0, 0]);
  });
});

describe('locks behave as before (SY4)', () => {
  // Before systems, a lock opened on a d20 at or above its difficulty.
  const before = (face, difficulty) => face >= difficulty;
  const now = (system, face, difficulty) =>
    checks.rollCheck(system, {
      check: system.checks.lock,
      difficulty: checks.canonRung(system, difficulty),
      dice: checks.fixedDice(face),
    });

  test('a lock that opened on a roll still opens; on 2 to 19 nothing changes at all', () => {
    const difficulties = [DEFAULT_LOCK_DIFFICULTY];
    for (let d = 1; d <= 30; d++) difficulties.push(d);
    for (const difficulty of difficulties) {
      for (let face = 1; face <= 20; face++) {
        const roll = now(FANTASY, face, difficulty);
        const label = `lock ${difficulty}, a ${face}`;
        if (before(face, difficulty) && face !== 1)
          expect([label, roll.success]).toEqual([label, true]);
        if (face > 1 && face < 20) {
          expect([label, roll.success]).toEqual([label, before(face, difficulty)]);
        }
        expect(roll.difficulty).toBe(difficulty);
      }
    }
  });

  test('the default lock (15) is named Hard on the fantasy ladder, Moderate on the sci-fi one', () => {
    expect(checks.canonRung(FANTASY, DEFAULT_LOCK_DIFFICULTY)).toEqual({
      name: 'Hard',
      value: 15,
    });
    expect(checks.canonRung(SCIFI, DEFAULT_LOCK_DIFFICULTY)).toEqual({
      name: 'Moderate',
      value: 2,
    });
    expect(now(FANTASY, 15, 15)).toMatchObject({ success: true, degree: 'successAtCost' });
    expect(now(FANTASY, 17, 15)).toMatchObject({ success: true, degree: 'success' });
    expect(now(FANTASY, 14, 15)).toMatchObject({ success: false, degree: 'failure' });
    // In the sci-fi system, Tech by Mind: three dice, two successes needed.
    expect(now(SCIFI, 7, 15)).toMatchObject({ total: 3, success: true, degree: 'success' });
    expect(now(SCIFI, 6, 15)).toMatchObject({ total: 0, degree: 'criticalFailure' });
  });
});

describe('worlds made before systems (SY4)', () => {
  const app = initializeApp({ projectId: 'demo-loom-built-in-systems' }, 'built-in-systems-test');
  const db = getFirestore(app);

  beforeEach(async () => {
    await db.recursiveDelete(db.collection('loom_worlds'));
    loomCanon.clearWorldCache();
  });

  test('play by the fantasy system; one that names a system plays by it', async () => {
    const worlds = db.collection('loom_worlds');
    await worlds.doc('old').set({ name: 'Old', status: 'published', canonVersion: 4, map: null });
    await worlds
      .doc('chosen')
      .set({ name: 'Chosen', status: 'draft', canonVersion: 2, map: null, systemId: 'pool-scifi' });

    const old = await loomCanon.loadWorld('old', { db });
    expect(old).toMatchObject({ systemId: null, system: { id: 'd20-fantasy' } });

    const chosen = await loomCanon.loadWorld('chosen', { db, playableOnly: false });
    expect(chosen.system).toMatchObject({ id: 'pool-scifi', builtIn: true, version: 0 });
  });
});
