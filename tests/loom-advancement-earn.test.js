'use strict';

/**
 * Earning experience (planning/advancement.md §4.3; L-842 / #714), pure,
 * under both built-in systems: a foe's worth by its level against the
 * player's; the same foe twice pays once; a moment's size pays its amount
 * and a moment repeated (however it is written) pays once; the quest hook;
 * the foes a turn overcomes; what NARRATE is told of levels; and nothing
 * with advancement off.
 *
 * Run: cd tests && npx jest loom-advancement-earn --verbose
 */

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const earning = require('../functions/loom-modules/advancement/earn');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// A save at `level` with no experience recorded yet, and a world with two
// foes, one at the player's level and one two above.
function setUp(system, level = 2) {
  const sheet = { ...sheets.defaultSheet(system), level };
  const save = { character: { name: 'Tam', sheet } };
  const foe = (id, name, foeLevel) => ({
    id,
    name,
    sheet: { ...sheets.defaultSheet(system), level: foeLevel },
  });
  const world = {
    rules: {},
    characters: {
      chr_cutter: foe('chr_cutter', 'Cutter', level),
      chr_ogre: foe('chr_ogre', 'Ogre', level + 2),
    },
  };
  return { save, world };
}

describe.each([
  ['d20 Fantasy', FANTASY, { even: 25, step: 10, notable: 25, major: 50, quest: 100 }],
  ['Dice-pool Sci-fi', SCIFI, { even: 40, step: 20, notable: 50, major: 100, quest: 200 }],
])('%s', (label, system, worth) => {
  test('a foe is worth more the further above you it is, and never nothing', () => {
    expect(earning.foeWorth(system, 3, 3)).toBe(worth.even);
    expect(earning.foeWorth(system, 3, 5)).toBe(worth.even + 2 * worth.step);
    expect(earning.foeWorth(system, 3, 2)).toBe(worth.even - worth.step);
    expect(earning.foeWorth(system, 9, 1)).toBeGreaterThan(0);
  });

  test('foes overcome pay their worth once, recorded in earned', () => {
    const { save, world } = setUp(system);
    const foes = [
      { id: 'chr_cutter', name: 'Cutter' },
      { id: 'chr_ogre', name: 'Ogre' },
    ];
    const first = earning.earn(system, world, save, { foes });
    expect(first.awards).toEqual([
      { kind: 'foe', id: 'chr_cutter', name: 'Cutter', xp: worth.even },
      { kind: 'foe', id: 'chr_ogre', name: 'Ogre', xp: worth.even + 2 * worth.step },
    ]);
    expect(first.earned).toEqual(['foe:chr_cutter', 'foe:chr_ogre']);
    earning.apply(system, save, first);
    // An older sheet starts from its level's total (SV1).
    const start = require('../functions/loom-modules/advancement').totalFor(system, 2);
    expect(save.character.sheet.xp).toBe(start + first.xp);
    expect(save.earned).toEqual(first.earned);
    // The same foe again pays nothing.
    const again = earning.earn(system, world, save, { foes: [foes[0]] });
    expect(again.awards).toEqual([]);
    expect(again.xp).toBe(0);
  });

  test('a story moment pays its size, once, however it is written', () => {
    const { save, world } = setUp(system);
    const notable = earning.earn(system, world, save, {
      moment: { id: 'The Drowned Bell', size: 'notable', name: 'You rang the drowned bell' },
    });
    expect(notable.awards).toEqual([
      {
        kind: 'moment',
        id: 'the-drowned-bell',
        name: 'You rang the drowned bell',
        size: 'notable',
        xp: worth.notable,
      },
    ]);
    earning.apply(system, save, notable);
    for (const id of ['the-drowned-bell', 'THE DROWNED  BELL', 'the_drowned_bell!']) {
      expect(earning.earn(system, world, save, { moment: { id, size: 'major' } }).awards).toEqual(
        []
      );
    }
    const major = earning.earn(system, world, save, { moment: { id: 'oath-kept', size: 'major' } });
    expect(major.xp).toBe(worth.major);
    // A size the system doesn't know, or no id, pays nothing.
    expect(earning.earn(system, world, save, { moment: { id: 'x', size: 'huge' } }).awards).toEqual(
      []
    );
    expect(earning.earn(system, world, save, { moment: { id: '', size: 'small' } }).awards).toEqual(
      []
    );
  });

  test('the quest hook pays the quest amount once', () => {
    const { save, world } = setUp(system);
    const done = earning.awardQuest(system, world, save, {
      id: 'lost-heir',
      name: 'The lost heir',
    });
    expect(done.awards).toEqual([
      { kind: 'quest', id: 'lost-heir', name: 'The lost heir', xp: worth.quest },
    ]);
    earning.apply(system, save, done);
    expect(earning.awardQuest(system, world, save, { id: 'lost-heir' }).awards).toEqual([]);
  });

  test('a world with advancement off pays nothing', () => {
    const { save, world } = setUp(system);
    world.rules.advancement = false;
    const none = earning.earn(system, world, save, {
      foes: [{ id: 'chr_ogre', name: 'Ogre' }],
      moment: { id: 'oath-kept', size: 'major' },
    });
    expect(none).toEqual({ awards: [], xp: 0, earned: [] });
    earning.apply(system, save, none);
    expect(save.character.sheet.xp).toBeUndefined();
    expect(save.earned).toBeUndefined();
  });

  test('NARRATE is told the player’s level against each foe’s', () => {
    const { save, world } = setUp(system);
    const line = earning.levelsLine(system, world, save, [
      { id: 'chr_cutter', name: 'Cutter' },
      { id: 'chr_ogre', name: 'Ogre' },
    ]);
    const word = (system.words && system.words.level) || 'level';
    expect(line).toContain(`the player is ${word} 2`);
    expect(line).toContain(`Cutter is ${word} 2, their equal`);
    expect(line).toContain(`Ogre is ${word} 4, above them`);
    world.rules.advancement = false;
    expect(earning.levelsLine(system, world, save, [{ id: 'chr_ogre', name: 'Ogre' }])).toBeNull();
  });
});

describe('the foes a turn overcomes', () => {
  const fight = (outs) => ({
    combatants: {
      player: { kind: 'player', side: 'party' },
      ally: { side: 'party', name: 'Ally', out: outs.ally },
      a: { side: 'hostile', name: 'A', out: outs.a },
      b: { side: 'hostile', name: 'B', out: outs.b },
      c: { side: 'hostile', name: 'C', out: outs.c },
    },
  });
  test('newly out by overcoming ways only; allies never; the ended fight’s list too', () => {
    const before = fight({ a: 'down' });
    const after = fight({ a: 'down', b: 'surrendered', c: 'gone', ally: 'down' });
    expect(earning.overcomeIn(before, after)).toEqual([{ id: 'b', name: 'B' }]);
    expect(
      earning.overcomeIn(before, null, [
        { id: 'a', name: 'A' },
        { id: 'c', name: 'C' },
      ])
    ).toEqual([{ id: 'c', name: 'C' }]);
    expect(earning.overcomeIn(null, fight({ a: 'talkedDown', b: 'fled' }))).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
  });

  test('a moment id is lower case with dashes', () => {
    expect(earning.momentId('  The Drowned Bell! ')).toBe('the-drowned-bell');
    expect(earning.lineOf({ xp: 25, name: 'Cutter' })).toBe('+25 experience: Cutter.');
  });
});
