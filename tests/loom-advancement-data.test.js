'use strict';

/**
 * Advancement as data (planning/advancement.md §4.1, §4.2; L-841 / #713):
 * the module's settings checked with the system, in both built-in systems
 * (d20: experience only; the dice pool: experience for Rank and improving
 * by use); levels ready from experience and the curve; an attack's rank read
 * in its own formula; an older save at its level's experience; and a world
 * with advancement off. Pure.
 *
 * Run: cd tests && npx jest loom-advancement-data --verbose
 */

const systems = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const formula = require('../functions/loom-canon/formula');
const advancement = require('../functions/loom-modules/advancement');
const attacks = require('../functions/loom-modules/combat/attacks');
const strike = require('../functions/loom-modules/combat/strike');

const { BUILT_IN, validateSystem } = systems;
const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];
const copy = (v) => JSON.parse(JSON.stringify(v));

// A built-in with its advancement replaced, saved as a builder's system.
function withAdvancement(base, settings) {
  const s = copy(base);
  s.id = 'test-' + base.id;
  s.advancement = settings;
  return validateSystem(s);
}

describe.each([
  ['d20 Fantasy', FANTASY],
  ['Dice-pool Sci-fi', SCIFI],
])('%s', (label, system) => {
  test('the built-in advancement passes with no warnings', () => {
    const { errors, warnings } = validateSystem(copy(system));
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(advancement.settingsOf(system).experience).not.toBeNull();
  });

  test('a falling curve is refused, as formula and as table', () => {
    const xp = system.advancement.experience;
    const falling = withAdvancement(system, {
      experience: { ...xp, curve: '1000 - 10 * level' },
    });
    expect(falling.errors.join('\n')).toMatch(/curve must rise: level \d+ needs/);
    const { min, max } = system.sheet.level;
    const table = Array.from({ length: max - min + 1 }, (_, i) => i * 100);
    table[2] = table[1];
    expect(withAdvancement(system, { experience: { ...xp, curve: table } }).errors).toEqual([
      expect.stringMatching(/curve must rise: level 3 needs 100, no more than level 2's 100/),
    ]);
    // A table with a total for each level, rising, passes.
    table[2] = 250;
    expect(withAdvancement(system, { experience: { ...xp, curve: table } }).errors).toEqual([]);
    expect(
      withAdvancement(system, { experience: { ...xp, curve: [0, 100] } }).errors.join()
    ).toMatch(/needs one total per level/);
  });

  test('a grant past a skill’s top rank is refused', () => {
    const xp = system.advancement.experience;
    const r = withAdvancement(system, {
      experience: { ...xp, skillMax: 3, grants: { every: { skillRanks: 4 } } },
    });
    expect(r.errors).toEqual([
      "advancement.experience.grants.every.skillRanks is 4, past a skill's top rank (3).",
    ]);
    const past = withAdvancement(system, { experience: { ...xp, skillMax: 25 } });
    expect(past.errors.join()).toMatch(/skillMax must be a whole number from \d+ .* to 20/);
  });

  test('a threshold that isn’t a formula of rank is refused', () => {
    const xp = system.advancement.experience;
    const bad = (threshold) =>
      withAdvancement(system, { experience: xp, use: { threshold } }).errors.join('\n');
    expect(bad('3 * (level + 1)')).toMatch(/threshold must be a formula of rank only; it reads level/);
    expect(bad('3 * (rank + 1')).toMatch(/advancement\.use\.threshold/);
    expect(bad('1d6 + rank')).toMatch(/mustn't roll dice/);
    expect(bad('5')).toMatch(/must be a formula of rank/);
    expect(withAdvancement(system, { experience: xp, use: { threshold: '2 * rank + 2' } }).errors).toEqual(
      []
    );
  });

  test('other mistakes are named', () => {
    const xp = system.advancement.experience;
    const r = withAdvancement(system, {
      experience: {
        ...xp,
        foe: 'foeLevel + ' + system.sheet.attributes[0].id,
        story: { small: 1, huge: 9 },
        grants: { at: { 1: { skillRanks: 1 }, 2: { feats: 1 } } },
      },
      levels: true,
    });
    const text = r.errors.join('\n');
    expect(text).toMatch(/"levels" isn't part of advancement/);
    expect(text).toContain(
      `foe must be a formula of foeLevel and level only; it reads ${system.sheet.attributes[0].id}`
    );
    expect(text).toMatch(/"huge" isn't a moment's size/);
    expect(text).toMatch(/story\.notable is needed/);
    expect(text).toMatch(/grants\.at: 1 isn't a level that can be reached/);
    expect(text).toMatch(/"feats" isn't something a level grants/);
  });

  test('levels ready from experience and the curve', () => {
    const { min } = system.sheet.level;
    const at = (n) => advancement.totalFor(system, n);
    const sheet = (xp, level = min) => ({ level, xp });
    expect(at(min)).toBe(0);
    expect(advancement.levelsReady(system, sheet(at(min + 1) - 1))).toBe(0);
    expect(advancement.levelsReady(system, sheet(at(min + 1)))).toBe(1);
    expect(advancement.levelsReady(system, sheet(at(min + 3)))).toBe(3);
    // Taken: none ready until the next level's total.
    expect(advancement.levelsReady(system, sheet(at(min + 1), min + 1))).toBe(0);
    // Never past the top.
    const { max } = system.sheet.level;
    expect(advancement.levelsReady(system, sheet(1e9, max - 1))).toBe(1);
  });

  test('an older save gets its level’s experience, worked out on load', () => {
    const level = system.sheet.level.min + 2;
    const old = { ...sheets.defaultSheet(system), level };
    delete old.xp;
    const save = { character: { name: 'Old hand', sheet: old } };
    const loaded = sheets.withAp(save, system).character.sheet;
    expect(loaded.xp).toBe(advancement.totalFor(system, level));
    expect(loaded.levelsReady).toBe(0);
    // A sheet with its own experience keeps it.
    const kept = sheets.withAp(
      { character: { name: 'Earner', sheet: { ...old, xp: advancement.totalFor(system, level + 1) } } },
      system
    ).character.sheet;
    expect(kept.levelsReady).toBe(1);
    expect(sheets.validateSheet(system, loaded)).toEqual([]);
  });

  test('a world with advancement off reads as off', () => {
    const world = { rules: { advancement: false } };
    expect(advancement.isOn(world)).toBe(false);
    expect(advancement.settingsOf(system, world)).toMatchObject({
      experience: null,
      use: null,
      off: true,
    });
    const sheet = { ...sheets.defaultSheet(system), xp: 1e6 };
    expect(advancement.levelsReady(system, sheet, world)).toBe(0);
    expect(advancement.levelsReady(system, sheet)).toBeGreaterThan(0);
    expect(sheets.withAp({ character: { sheet } }, system, world).character.sheet.levelsReady).toBe(0);
    expect(advancement.rulesView(system, world)).toEqual({ off: true });
    expect(advancement.isOn({ rules: {} })).toBe(true);
  });

  test('an attack’s rank is read in its own formula', () => {
    const blade = {
      id: 'blade',
      name: 'Blade',
      reach: 1,
      attack: system === FANTASY ? '1d20 + mod(STR) + rank' : 'count((Body + rank)d10, >= 7)',
      damage: '2 + rank',
      type: system.modules.combat.damageTypes[0].id,
    };
    expect(attacks.validateAttack(system, blade)).toEqual([]);
    const sheet = { ...sheets.defaultSheet(system), attacks: [blade] };
    const ranked = { ...sheet, attackRanks: { blade: 2 } };
    expect(attacks.attackOf(system, sheet, 'blade').rank).toBe(0);
    expect(attacks.attackOf(system, ranked, 'blade').rank).toBe(2);
    const dice = () => 1;
    const roll = (s) =>
      strike.rollAttack(system, { sheet: s, attack: attacks.attackOf(system, s, 'blade'), dice });
    if (system === FANTASY) expect(roll(ranked).total - roll(sheet).total).toBe(2);
    else expect(roll(ranked).breakdown).not.toEqual(roll(sheet).breakdown);
    const hit = (s) =>
      strike.rollDamage(system, {
        sheet: s,
        attack: attacks.attackOf(system, s, 'blade'),
        degree: 'success',
        extra: 0,
        target: null,
        dice,
      }).total;
    expect(hit(ranked) - hit(sheet)).toBe(2);
    // The Character panel's damage reads it too.
    const view = sheets.characterView(system, { name: 'Ranked', sheet: ranked });
    expect(view.attacks.find((a) => a.id === 'blade').damage).toBe('4');
    expect(formula.check('rank + 1', { system }).errors).toEqual(['Unknown name "rank".']);
  });
});

describe('the built-ins differ in kind', () => {
  test('d20 uses experience only; the dice pool both', () => {
    expect(advancement.settingsOf(FANTASY).use).toBeNull();
    expect(advancement.settingsOf(SCIFI).use).toMatchObject({
      threshold: '3 * (rank + 1)',
      skills: true,
      attacks: true,
      maxRank: 3,
    });
    expect(advancement.thresholdFor(SCIFI, 0)).toBe(3);
    expect(advancement.thresholdFor(SCIFI, 2)).toBe(9);
    expect(advancement.thresholdFor(FANTASY, 2)).toBeNull();
  });

  test('d20 grants a skill rank every level, attribute points every fourth', () => {
    expect(advancement.grantFor(FANTASY, 2)).toEqual({ skillRanks: 1 });
    expect(advancement.grantFor(FANTASY, 4)).toEqual({ skillRanks: 1, attributePoints: 2 });
    expect(advancement.grantFor(SCIFI, 2)).toEqual({});
    expect(advancement.grantFor(SCIFI, 3)).toEqual({ attributePoints: 1 });
  });

  test('the dice pool’s sheets count uses; d20’s don’t', () => {
    const pool = sheets.withAp({ character: { sheet: sheets.defaultSheet(SCIFI) } }, SCIFI);
    expect(pool.character.sheet.uses).toEqual({ skills: {}, attacks: {} });
    const d20 = sheets.withAp({ character: { sheet: sheets.defaultSheet(FANTASY) } }, FANTASY);
    expect(d20.character.sheet.uses).toBeUndefined();
    expect(d20.character.sheet.xp).toBe(0);
  });

  test('a system with no advancement grows nobody, and keeps nothing on sheets', () => {
    const s = copy(FANTASY);
    s.id = 'still';
    s.advancement = {};
    const { errors, system } = validateSystem(s);
    expect(errors).toEqual([]);
    const sheet = sheets.withAp({ character: { sheet: sheets.defaultSheet(system) } }, system)
      .character.sheet;
    expect(sheet.xp).toBeUndefined();
    expect(sheet.levelsReady).toBeUndefined();
    expect(advancement.rulesView(system)).toEqual({});
  });

  test('the rules reference carries the settings', () => {
    const view = advancement.rulesView(FANTASY);
    expect(view.experience.curve.slice(0, 3)).toEqual([
      { level: 1, xp: 0 },
      { level: 2, xp: 100 },
      { level: 3, xp: 300 },
    ]);
    expect(view.experience.curve).toHaveLength(20);
    expect(advancement.rulesView(SCIFI).use).toEqual({ skills: true, attacks: true, maxRank: 3 });
  });
});
