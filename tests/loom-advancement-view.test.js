'use strict';

/**
 * What loomGetMap sends for advancement in the Loom (planning/advancement.md
 * §4.6; L-845 / #717), pure, under both built-in systems: the Character
 * panel's experience (this level's total, the next's, the levels ready), left
 * out with advancement off; the level-up offer kept on the save, with the
 * rules' suggestion, for the form after a reload; and the rules reference's
 * thresholds for improving by use. (The page itself: headless Chrome.)
 *
 * Run: cd tests && npx jest loom-advancement-view --verbose
 */

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const advancement = require('../functions/loom-modules/advancement');
const levelUp = require('../functions/loom-modules/advancement/level-up');
const { mapView } = require('../functions/loom-turn/map-view');
const { COAST } = require('./helpers/coast');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

describe.each([
  ['d20 Fantasy', FANTASY],
  ['Dice-pool Sci-fi', SCIFI],
])('%s', (label, system) => {
  const world = (rules = {}) => ({ ...COAST, system, rules: { ...COAST.rules, ...rules } });
  const saveAt = (xp, extra = {}) => ({
    location: 'widows-reach',
    character: { name: 'Tam', sheet: { ...sheets.defaultSheet(system), xp } },
    ...extra,
  });

  test('the panel’s experience: this level’s total, the next’s, the levels ready', () => {
    const next = advancement.totalFor(system, 2);
    const view = mapView(world(), saveAt(next / 2), null, null).character;
    expect(view.experience).toEqual({ xp: next / 2, from: 0, to: next, ready: 0 });
    const ready = mapView(world(), saveAt(advancement.totalFor(system, 3)), null, null).character;
    expect(ready.experience.ready).toBe(2);
  });

  test('at the top, there is no next total', () => {
    const top = system.sheet.level.max;
    const save = saveAt(1e9);
    save.character.sheet.level = top;
    expect(mapView(world(), save, null, null).character.experience).toMatchObject({
      to: null,
      ready: 0,
    });
  });

  test('with advancement off, no experience and no offer', () => {
    const save = saveAt(1e6, { levelOffer: true });
    const view = mapView(world({ advancement: false }), save, null, null);
    expect(view.character.experience).toBeUndefined();
    expect(view.levelUp).toBeNull();
    expect(view.rules.advancement).toEqual({ off: true });
  });

  test('a level offered at the last long rest comes back with the rules’ suggestion', () => {
    const save = saveAt(advancement.totalFor(system, 2), { levelOffer: true });
    const view = mapView(world(), save, null, null);
    expect(view.levelUp).toMatchObject({ level: 2 });
    const sheet = save.character.sheet;
    expect(levelUp.check(system, sheet, view.levelUp.suggestion.choices)).toEqual([]);
    // Not offered, or in a fight: none.
    expect(
      mapView(world(), saveAt(advancement.totalFor(system, 2)), null, null).levelUp
    ).toBeNull();
    const fighting = {
      ...save,
      fight: {
        round: 1,
        turn: 'player',
        order: ['player'],
        combatants: { player: { kind: 'player', side: 'party', name: 'Tam' } },
      },
    };
    expect(mapView(world(), fighting, null, null).levelUp).toBeNull();
  });
});

test('the rules reference carries what improving by use takes, where the system has it', () => {
  const pool = mapView({ ...COAST, system: SCIFI }, { location: 'widows-reach' }, null, null);
  expect(pool.rules.advancement.use.thresholds).toEqual([
    { rank: 0, uses: 3 },
    { rank: 1, uses: 6 },
    { rank: 2, uses: 9 },
    { rank: 3, uses: 12 },
  ]);
  const d20 = mapView({ ...COAST, system: FANTASY }, { location: 'widows-reach' }, null, null);
  expect(d20.rules.advancement.use).toBeUndefined();
});
