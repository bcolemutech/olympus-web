'use strict';

/**
 * Improving by use (planning/advancement.md §4.5; L-844 / #716), pure,
 * under both built-in systems: thresholds by rank; a use counted for a
 * skill and an attack; a rise at the threshold resets the count; the top
 * rank stops it; the d20 built-in, with no use, counts nothing; a world with
 * advancement off counts nothing. (INTERPRET's stakes flag, read through its
 * parsing: loom-advancement-use-play.)
 *
 * Run: cd tests && npx jest loom-advancement-use --verbose
 */

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const advancement = require('../functions/loom-modules/advancement');
const use = require('../functions/loom-modules/advancement/use');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

const times = (n, sheet, what, system = SCIFI, world = null) => {
  let out = sheet;
  for (let i = 0; i < n; i++) out = use.counted(system, world, out, what);
  return out;
};

describe('Dice-pool Sci-fi', () => {
  const fresh = (tech = 1) => {
    const sheet = sheets.defaultSheet(SCIFI);
    sheet.skills.Tech = tech;
    return sheet;
  };

  test('thresholds by rank: 3 × (rank + 1)', () => {
    expect([0, 1, 2, 4].map((r) => advancement.thresholdFor(SCIFI, r))).toEqual([3, 6, 9, 15]);
  });

  test('uses count for a skill and an attack, one a call', () => {
    const sheet = times(2, fresh(), { skill: 'Tech', attack: 'knife' });
    expect(sheet.uses).toEqual({ skills: { Tech: 2 }, attacks: { knife: 2 } });
    // A skill the system doesn't have counts nothing.
    expect(use.counted(SCIFI, null, sheet, { skill: 'Juggling' })).toBe(sheet);
  });

  test('a long rest at the threshold raises it one rank and resets the count', () => {
    const short = times(5, fresh(1), { skill: 'Tech' });
    expect(use.rise(SCIFI, null, short).rises).toEqual([]);
    const ready = use.counted(SCIFI, null, short, { skill: 'Tech' });
    const { sheet, rises } = use.rise(SCIFI, null, ready);
    expect(rises).toEqual([{ kind: 'skill', id: 'Tech', name: 'Tech', rank: 2 }]);
    expect(sheet.skills.Tech).toBe(2);
    expect(sheet.uses.skills.Tech).toBe(0);
    expect(use.lineOf(rises[0])).toBe('Your Tech rises to 2.');
    // One rank a rest, however far past the threshold.
    const far = use.rise(SCIFI, null, times(30, fresh(1), { skill: 'Tech' }));
    expect(far.sheet.skills.Tech).toBe(2);
    expect(sheets.validateSheet(SCIFI, sheet)).toEqual([]);
  });

  test('an attack rises too, its rank read by its formulas', () => {
    const ready = times(3, fresh(), { attack: 'knife' });
    const { sheet, rises } = use.rise(SCIFI, null, ready);
    expect(rises).toEqual([{ kind: 'attack', id: 'knife', name: expect.any(String), rank: 1 }]);
    expect(advancement.attackRankOf(sheet, 'knife')).toBe(1);
    expect(sheets.validateSheet(SCIFI, sheet)).toEqual([]);
  });

  test('the top rank stops it: skills at 5, attacks at 3', () => {
    const top = fresh(5);
    expect(use.counted(SCIFI, null, top, { skill: 'Tech' })).toBe(top);
    const atMax = { ...fresh(), attackRanks: { knife: 3 } };
    expect(use.counted(SCIFI, null, atMax, { attack: 'knife' })).toBe(atMax);
    // Counted below the top, it rises no further than it.
    const four = times(15, fresh(4), { skill: 'Tech' });
    expect(use.rise(SCIFI, null, four).sheet.skills.Tech).toBe(5);
  });

  test('never attributes, never the level', () => {
    const before = times(9, fresh(2), { skill: 'Tech' });
    const { sheet } = use.rise(SCIFI, null, before);
    expect(sheet.attributes).toEqual(before.attributes);
    expect(sheet.level).toBe(before.level);
  });

  test('a world with advancement off counts nothing', () => {
    const world = { rules: { advancement: false } };
    const sheet = fresh();
    expect(use.counted(SCIFI, world, sheet, { skill: 'Tech' })).toBe(sheet);
    const counted = times(6, sheet, { skill: 'Tech' });
    expect(use.rise(SCIFI, world, counted).rises).toEqual([]);
  });
});

describe('d20 Fantasy, which has no use', () => {
  test('counts nothing and raises nothing', () => {
    const sheet = sheets.defaultSheet(FANTASY);
    expect(advancement.thresholdFor(FANTASY, 1)).toBeNull();
    expect(use.counted(FANTASY, null, sheet, { skill: 'Thievery', attack: 'sword' })).toBe(sheet);
    const forced = { ...sheet, uses: { skills: { Thievery: 99 }, attacks: {} } };
    expect(use.rise(FANTASY, null, forced).rises).toEqual([]);
  });
});
