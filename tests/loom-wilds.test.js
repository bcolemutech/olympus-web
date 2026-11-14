'use strict';

/**
 * The wilds module (planning/off-road-travel.md §4.3, MD1, MD2; L-362 /
 * #836), with both built-in systems: its settings read and checked, a bad
 * one refused with its reason; a world's own over its system's, and false
 * turning off-road travel off; the navigation check harder in deadlier
 * terrain, and a failure losing time by degree. Pure.
 *
 * Run: cd tests && npx jest loom-wilds --verbose
 */

const systems = require('../functions/loom-canon/systems');
const formula = require('../functions/loom-canon/formula');
const wilds = require('../functions/loom-modules/wilds');

const { settingsOf, check, checkOverride, DEFAULTS } = wilds.settings;
const { navigate, harderBy, rungFor } = wilds.navigate;
const { BUILT_IN, validateSystem } = systems;
const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];
const BOTH = [
  ['d20-fantasy', FANTASY],
  ['pool-scifi', SCIFI],
];

const copy = (v) => JSON.parse(JSON.stringify(v));
const withWilds = (system, settings) => ({
  ...copy(system),
  modules: { ...copy(system.modules), wilds: settings },
});
const problems = (system) => validateSystem(copy(system)).errors;
const world = (rules = {}) => ({ id: 'w', rules });

// Dice that always show one face: the highest, the lowest, or between.
const always = (face) => (sides) => Math.max(1, Math.min(sides, face));

describe.each(BOTH)('the settings, in %s', (id, system) => {
  test('read with the defaults filled in', () => {
    expect(settingsOf(system)).toEqual({
      pace: 1.5,
      dayHours: 8,
      eventChance: 0.25,
      discover: 3,
      navigation: {
        check: { skill: 'Survival' },
        dc: 'Moderate',
        harder: 0.5,
        lost: { ...DEFAULTS.lost },
      },
    });
    // Its navigation skill is one of its own.
    expect(system.sheet.skills.map((k) => k.id)).toContain('Survival');
  });

  test('the travel day comes from the world when the system leaves it out', () => {
    const w = world({ time: { travelDayHours: 10 } });
    expect(settingsOf(system, w).dayHours).toBe(10);
    const own = withWilds(system, { ...system.modules.wilds, dayHours: 6 });
    expect(settingsOf(own, w).dayHours).toBe(6);
  });

  test('checked on save: the built-in passes, a bad one is refused with its reason', () => {
    expect(problems(system)).toEqual([]);
    const bad = (settings) => problems(withWilds(system, settings));
    expect(bad({ pace: -1 })).toEqual([
      'modules.wilds.pace must be a number of distance units an hour, above 0 and at most 100.',
    ]);
    expect(bad({ dayHours: 0 })).toEqual([
      'modules.wilds.dayHours must be a number of hours from 1 to 24.',
    ]);
    expect(bad({ eventChance: 1 })).toEqual([
      'modules.wilds.eventChance must be a chance from 0 to 0.95.',
    ]);
    expect(bad({ discover: 'far' })).toEqual([
      'modules.wilds.discover must be a distance from 0 to 100.',
    ]);
    expect(bad({ hours: 8 })).toEqual([
      'modules.wilds: "hours" isn\'t a wilds setting (pace, dayHours, eventChance, discover, ' +
        'navigation).',
    ]);
    expect(bad('fast')).toEqual([
      "modules.wilds must be the wilds module's settings, or false: no off-road travel.",
    ]);
    const nav = (n) => bad({ navigation: n });
    expect(nav({ dc: 'Moderate' })).toEqual([
      'modules.wilds.navigation.check must be { skill } or { attribute }.',
    ]);
    expect(nav({ check: { skill: 'Sailing' }, dc: 'Moderate' })).toEqual([
      'modules.wilds.navigation.check.skill "Sailing" isn\'t one of the system\'s skills.',
    ]);
    expect(nav({ check: { attribute: 'Luck' }, dc: 'Moderate' })).toEqual([
      'modules.wilds.navigation.check.attribute "Luck" isn\'t one of the system\'s attributes.',
    ]);
    expect(nav({ check: { skill: 'Survival' }, dc: 'Medium' })).toEqual([
      'modules.wilds.navigation.dc must be a rung on the ladder (Easy, Moderate, Hard, ' +
        'Very hard, Nearly impossible).',
    ]);
    expect(nav({ check: { skill: 'Survival' }, dc: 'Hard', harder: 3 })).toEqual([
      'modules.wilds.navigation.harder must be the danger above 1 that makes it a rung harder ' +
        '(above 0, at most 1.5), or null: never harder.',
    ]);
    expect(
      nav({ check: { skill: 'Survival' }, dc: 'Hard', lost: { failure: 2, oops: 0 } })
    ).toEqual([
      'modules.wilds.navigation.lost.failure must be a share of the day from 0 to 1.',
      'modules.wilds.navigation.lost: "oops" isn\'t a degree (criticalSuccess, success, ' +
        'successAtCost, failure, criticalFailure).',
    ]);
    expect(nav({ check: { skill: 'Survival' }, dc: 'Hard', stray: 1 })).toEqual([
      'modules.wilds.navigation: "stray" isn\'t part of the check (check, dc, harder, lost).',
    ]);
    // Null: nobody gets lost. False: no off-road travel.
    expect(nav(null)).toEqual([]);
    expect(bad(false)).toEqual([]);
  });

  test('left out, the defaults with no navigation check', () => {
    const without = copy(system);
    delete without.modules.wilds;
    expect(problems(without)).toEqual([]);
    expect(settingsOf(without)).toEqual({
      pace: 1.5,
      dayHours: 8,
      eventChance: 0.25,
      discover: 3,
      navigation: null,
    });
    expect(navigate(null, without, 2, always(1))).toBeNull();
  });

  test("a world's own settings over its system's", () => {
    const w = world({ wilds: { pace: 1, eventChance: 0.1, navigation: { dc: 'Hard' } } });
    expect(checkOverride(w.rules.wilds, system)).toEqual([]);
    expect(settingsOf(system, w)).toEqual({
      pace: 1,
      dayHours: 8,
      eventChance: 0.1,
      discover: 3,
      navigation: {
        check: { skill: 'Survival' },
        dc: 'Hard',
        harder: 0.5,
        lost: { ...DEFAULTS.lost },
      },
    });
    // Its navigation null: nobody gets lost there.
    expect(settingsOf(system, world({ wilds: { navigation: null } })).navigation).toBeNull();
    // Checked against the system.
    expect(checkOverride({ discover: -1, navigation: { dc: 'Trivial' } }, system)).toEqual([
      'rules.wilds.discover must be a distance from 0 to 100.',
      'rules.wilds.navigation.dc must be a rung on the ladder (Easy, Moderate, Hard, ' +
        'Very hard, Nearly impossible).',
    ]);
  });

  test('false turns off-road travel off, by the world or the system', () => {
    const off = world({ wilds: false });
    expect(checkOverride(false, system)).toEqual([]);
    expect(settingsOf(system, off)).toBeNull();
    expect(navigate(null, system, 1, always(1), settingsOf(system, off))).toBeNull();
    expect(settingsOf(withWilds(system, false))).toBeNull();
    expect(wilds.settings.isOff(system, world())).toBe(false);
  });
});

test("a world's navigation needs a check when its system has none", () => {
  const without = copy(FANTASY);
  delete without.modules.wilds;
  expect(checkOverride({ navigation: { dc: 'Hard' } }, without)).toEqual([
    'rules.wilds.navigation.check must be { skill } or { attribute }.',
  ]);
  expect(
    checkOverride({ navigation: { check: { attribute: 'WIS' }, dc: 'Hard' } }, without)
  ).toEqual([]);
  // The check() a system's save uses takes the same shape.
  const errors = [];
  check({ navigation: { check: { skill: 'Survival' } } }, { system: FANTASY, errors });
  expect(errors).toEqual([]);
});

describe.each(BOTH)('the navigation check, in %s', (id, system) => {
  const nav = settingsOf(system).navigation;

  test('a rung harder for each 0.5 of danger above 1, up to the top', () => {
    expect([0.5, 1, 1.25, 1.5, 1.99, 2].map((d) => harderBy(d, 0.5))).toEqual([0, 0, 0, 1, 1, 2]);
    expect([0.5, 1, 1.5, 2].map((d) => rungFor(system, nav, d).name)).toEqual([
      'Moderate',
      'Moderate',
      'Hard',
      'Very hard',
    ]);
    // Never past the ladder's top; never harder with harder null.
    expect(rungFor(system, { ...nav, dc: 'Very hard' }, 2).name).toBe('Nearly impossible');
    expect(rungFor(system, { ...nav, harder: null }, 2).name).toBe('Moderate');
  });

  test('deadlier terrain fails more often, by the same seeded dice', () => {
    const sheet = { attributes: {}, skills: { Survival: 1 } };
    const failures = (danger) => {
      let n = 0;
      for (let seed = 1; seed <= 400; seed++) {
        if (!navigate(sheet, system, danger, formula.seeded(seed)).success) n++;
      }
      return n;
    };
    const [calm, rough, deadly] = [1, 1.5, 2].map(failures);
    expect(calm).toBeLessThan(rough);
    expect(rough).toBeLessThan(deadly);
  });

  test('the roll for the roll card, the same for the same seed', () => {
    const one = navigate(null, system, 1.5, formula.seeded(7));
    expect(one).toEqual(navigate(null, system, 1.5, formula.seeded(7)));
    expect(one).toMatchObject({ rung: 'Hard', harder: 1 });
    expect(one.roll).toMatchObject({
      skillId: 'Survival',
      rung: 'Hard',
      degree: one.degree,
      success: one.success,
      breakdown: expect.objectContaining({ named: expect.stringContaining('Survival') }),
    });
  });

  test('a success keeps the day; a worse failure loses more of it', () => {
    // Every degree, over seeded rolls in all terrain, with the share it lost.
    const lost = {};
    for (const danger of [1, 1.5, 2]) {
      for (let seed = 1; seed <= 300; seed++) {
        const result = navigate({ skills: { Survival: 1 } }, system, danger, formula.seeded(seed));
        (lost[result.degree] = lost[result.degree] || new Set()).add(result.lost);
      }
    }
    const shares = Object.fromEntries(Object.entries(lost).map(([d, set]) => [d, [...set]]));
    expect(shares).toEqual({
      criticalSuccess: [0],
      success: [0],
      successAtCost: [0.125],
      failure: [0.25],
      criticalFailure: [0.5],
    });
    // A world's own shares.
    const w = world({ wilds: { navigation: { lost: { failure: 0.5, criticalFailure: 1 } } } });
    const worst = navigate(null, system, 2, always(1), settingsOf(system, w));
    expect(worst).toMatchObject({ degree: 'criticalFailure', lost: 1, success: false });
  });
});
