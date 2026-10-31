'use strict';

/**
 * Taking a level (planning/advancement.md §4.4; L-843 / #715), pure, under
 * both built-in systems: the next level's grants and their limits; choices
 * that are good pass and bad ones are refused with reasons; d20 hit points
 * rise with the level; a level past the top is never ready; traits and
 * attacks from a grant's list; the rules' own suggestion passes its checks.
 *
 * Run: cd tests && npx jest loom-advancement-level-up --verbose
 */

const { BUILT_IN, validateSystem } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const attacks = require('../functions/loom-modules/combat/attacks');
const advancement = require('../functions/loom-modules/advancement');
const levelUp = require('../functions/loom-modules/advancement/level-up');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];
const copy = (v) => JSON.parse(JSON.stringify(v));

// A sheet at `level` with enough experience for `ready` more levels.
function ready(system, level, n = 1) {
  const sheet = { ...sheets.defaultSheet(system), level };
  sheet.xp = advancement.totalFor(system, level + n);
  return sheet;
}

describe('d20 Fantasy', () => {
  test('level 2: a skill rank, each skill to 10', () => {
    const sheet = ready(FANTASY, 1);
    const offer = levelUp.offerOf(FANTASY, sheet);
    expect(offer.level).toBe(2);
    expect(offer.grants).toEqual({ skillRanks: 1 });
    expect(offer.limits.skills[0]).toMatchObject({ rank: 0, max: 10 });
    expect(offer.limits.attributes).toBeUndefined();
  });

  test('level 4: a skill rank and two attribute points, within each score’s range', () => {
    const sheet = ready(FANTASY, 3);
    const offer = levelUp.offerOf(FANTASY, sheet);
    expect(offer.grants).toEqual({ skillRanks: 1, attributePoints: 2 });
    const str = offer.limits.attributes.find((a) => a.id === 'STR');
    expect(str).toMatchObject({ score: sheet.attributes.STR, max: 18 });
  });

  test('good choices pass; bad ones are refused with reasons', () => {
    const sheet = ready(FANTASY, 3);
    sheet.attributes.STR = 17;
    sheet.skills.Athletics = 10;
    expect(
      levelUp.check(FANTASY, sheet, { attributes: { DEX: 1, CON: 1 }, skills: { Stealth: 1 } })
    ).toEqual([]);
    expect(
      levelUp.check(FANTASY, sheet, { attributes: { STR: 2 }, skills: { Athletics: 1 } })
    ).toEqual([
      'Strength would be 19; it can be at most 18.',
      'Athletics would be 11; it can be at most 10.',
    ]);
    expect(levelUp.check(FANTASY, sheet, { attributes: { DEX: 1 }, skills: {} })).toEqual([
      'Spend 2 attribute points: 1 chosen.',
      'Spend 1 skill rank: 0 chosen.',
    ]);
    expect(
      levelUp.check(FANTASY, sheet, {
        attributes: { LUCK: 2 },
        skills: { Stealth: 1.5 },
        feats: ['x'],
        traits: ['darkvision'],
      })
    ).toEqual([
      '"feats" isn\'t something a level gives.',
      'There is no attribute "LUCK" to raise.',
      'Spend 2 attribute points: 0 chosen.',
      "Stealth: 1.5 isn't a whole number of skill ranks.",
      'Spend 1 skill rank: 0 chosen.',
      'This level gives no traits.',
    ]);
  });

  test('hit points rise with the level, by what the maximum rose', () => {
    const sheet = ready(FANTASY, 1);
    const before = sheets.maxima(FANTASY, sheet).health;
    sheet.resources.health.current = before - 2; // hurt
    const { sheet: after, errors } = levelUp.take(FANTASY, sheet, { skills: { Stealth: 1 } });
    expect(errors).toEqual([]);
    expect(after.level).toBe(2);
    expect(after.skills.Stealth).toBe(1);
    const max = sheets.maxima(FANTASY, after).health;
    expect(max).toBeGreaterThan(before);
    expect(after.resources.health.current).toBe(before - 2 + (max - before));
    expect(sheets.validateSheet(FANTASY, after)).toEqual([]);
  });

  test('two levels ready come one after the other', () => {
    const sheet = ready(FANTASY, 1, 2);
    expect(advancement.levelsReady(FANTASY, sheet)).toBe(2);
    const once = levelUp.take(FANTASY, sheet, levelUp.fallback(FANTASY, sheet)).sheet;
    expect(levelUp.offerOf(FANTASY, once).level).toBe(3);
    const twice = levelUp.take(FANTASY, once, levelUp.fallback(FANTASY, once)).sheet;
    expect(twice.level).toBe(3);
    expect(levelUp.offerOf(FANTASY, twice)).toBeNull();
    expect(levelUp.check(FANTASY, twice, {})).toEqual(['No level is ready to take.']);
  });

  test('a level past the top is never ready', () => {
    const top = { ...sheets.defaultSheet(FANTASY), level: 20, xp: 1e9 };
    expect(advancement.levelsReady(FANTASY, top)).toBe(0);
    expect(levelUp.offerOf(FANTASY, top)).toBeNull();
  });
});

describe('Dice-pool Sci-fi', () => {
  test('Rank 2 gives nothing to choose; Rank 3 an attribute point, each score to 5', () => {
    const two = ready(SCIFI, 1);
    expect(levelUp.offerOf(SCIFI, two)).toMatchObject({ level: 2, grants: {} });
    expect(levelUp.check(SCIFI, two, {})).toEqual([]);
    expect(levelUp.take(SCIFI, two, {}).sheet.level).toBe(2);
    const three = ready(SCIFI, 2);
    three.attributes.Body = 5;
    const offer = levelUp.offerOf(SCIFI, three);
    expect(offer.grants).toEqual({ attributePoints: 1 });
    expect(levelUp.check(SCIFI, three, { attributes: { Body: 1 } })).toEqual([
      'Body would be 6; it can be at most 5.',
    ]);
    expect(levelUp.check(SCIFI, three, { attributes: { Mind: 1 } })).toEqual([]);
    expect(levelUp.check(SCIFI, three, { attributes: { Mind: 1 }, skills: { Tech: 1 } })).toEqual([
      'This level gives no skill ranks.',
    ]);
  });

  test('a level past the top (Rank 10) is never ready', () => {
    const top = { ...sheets.defaultSheet(SCIFI), level: 10, xp: 1e9 };
    expect(levelUp.offerOf(SCIFI, top)).toBeNull();
  });
});

describe.each([
  ['d20 Fantasy', FANTASY],
  ['Dice-pool Sci-fi', SCIFI],
])('%s with traits and attacks to choose', (label, base) => {
  // The built-in, with every level granting a trait and an attack to choose.
  const system = (() => {
    const s = copy(base);
    s.id = 'test-grants';
    const type = s.modules.combat.damageTypes[0].id;
    const sheet = s.sheet;
    sheet.optional = [...new Set([...(sheet.optional || []), 'traits'])];
    sheet.traits = [
      ...(sheet.traits || []),
      { id: 'keen', name: 'Keen eyes' },
      { id: 'tough', name: 'Tough' },
    ];
    const at = (id, name) => ({ id, name, reach: 1, attack: '1', damage: '2 + rank', type });
    s.advancement.experience.grants = {
      every: {
        traits: { from: ['keen', 'tough'], choose: 1 },
        attacks: { from: [at('spear', 'Spear'), at('maul', 'Maul')], choose: 1 },
      },
    };
    const checked = validateSystem(s);
    expect(checked.errors).toEqual([]);
    return checked.system;
  })();

  test('picks come from the list, the right number, none held already', () => {
    const sheet = ready(system, 1);
    const offer = levelUp.offerOf(system, sheet);
    expect(offer.grants.traits).toEqual({
      choose: 1,
      from: [
        { id: 'keen', name: 'Keen eyes' },
        { id: 'tough', name: 'Tough' },
      ],
    });
    expect(offer.grants.attacks.from.map((a) => a.id)).toEqual(['spear', 'maul']);
    expect(levelUp.check(system, sheet, { traits: ['keen'], attacks: ['spear'] })).toEqual([]);
    expect(levelUp.check(system, sheet, { traits: ['keen', 'tough'], attacks: ['axe'] })).toEqual([
      'Choose 1 traits: 2 chosen.',
      '"axe" isn\'t one of the attacks to choose from.',
    ]);
    // Taken: the trait held, the attack the player's own, the starting ones kept.
    const starting = attacks.attacksOf(system, sheet, { player: true }).map((a) => a.id);
    const after = levelUp.take(system, sheet, { traits: ['keen'], attacks: ['spear'] }).sheet;
    expect(after.traits).toContain('keen');
    expect(attacks.attacksOf(system, after, { player: true }).map((a) => a.id)).toEqual(
      expect.arrayContaining([...starting, 'spear'])
    );
    expect(sheets.validateSheet(system, after)).toEqual([]);
    // Next time, only what isn't held is offered.
    after.xp = advancement.totalFor(system, 3);
    const next = levelUp.offerOf(system, after);
    expect(next.grants.traits.from.map((t) => t.id)).toEqual(['tough']);
    expect(next.grants.attacks.from.map((a) => a.id)).toEqual(['maul']);
  });

  test('the rules’ own suggestion passes the checks', () => {
    const sheet = ready(system, 1);
    const suggested = levelUp.fallback(system, sheet);
    expect(levelUp.check(system, sheet, suggested)).toEqual([]);
  });
});

test('the rules’ suggestion passes in both built-ins at every level', () => {
  for (const system of [FANTASY, SCIFI]) {
    let sheet = ready(system, system.sheet.level.min, 30);
    while (levelUp.offerOf(system, sheet)) {
      const choices = levelUp.fallback(system, sheet);
      expect(levelUp.check(system, sheet, choices)).toEqual([]);
      sheet = levelUp.take(system, sheet, choices).sheet;
    }
    expect(sheet.level).toBe(system.sheet.level.max);
    expect(sheets.validateSheet(system, sheet)).toEqual([]);
  }
});
