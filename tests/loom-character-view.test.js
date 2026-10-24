'use strict';

/**
 * The Character panel and the strip (planning/game-systems.md §3 CS8, EF9,
 * SY2, MD1b, §4.7; L-814 / #641): the sheet as the player reads it, sent with
 * the map (`character`, sheets.characterView), drawn from the system and in
 * its words, every number worked out on the server; and a roll card naming
 * the same attribute and skill the panel shows. Under both built-in systems
 * (MD2). The page itself is checked in headless Chrome.
 *
 * Run: cd tests && npx jest loom-character-view --verbose
 */

const sheets = require('../functions/loom-canon/sheets');
const checks = require('../functions/loom-canon/checks');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { mapView } = require('../functions/loom-turn/map-view');
const { COAST } = require('./helpers/coast');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// Each system's own numbers for a default sheet.
const EXPECT = {
  'd20-fantasy': {
    attribute: { id: 'DEX', name: 'Dexterity', score: 10, modifier: 0 },
    health: { id: 'health', name: 'Hit points', current: 6, max: 6 },
    level: { name: 'Level', value: 1 },
    rankName: 'Proficiency',
    ap: 20,
  },
  'pool-scifi': {
    attribute: { id: 'Reflex', name: 'Reflex', score: 3, modifier: 3 },
    health: { id: 'health', name: 'Health', current: 6, max: 6 },
    level: { name: 'Rank', value: 1 },
    rankName: 'Training',
    ap: 20,
  },
};

describe.each([
  ['d20-fantasy', FANTASY],
  ['pool-scifi', SCIFI],
])('the sheet as the player reads it under %s', (id, system) => {
  const character = (sheet) => ({ name: 'Tam', sheet });

  test('drawn from the system: attributes, resources, level, skills, AP', () => {
    const view = sheets.characterView(system, character(sheets.defaultSheet(system)));
    expect(view.name).toBe('Tam');
    expect(view.system).toEqual({ id: system.id, name: system.name });
    // In the system's words: its level and its skills' ranks.
    expect(view.level).toEqual(EXPECT[id].level);
    expect(view.rankName).toBe(EXPECT[id].rankName);
    expect(view.attributes.map((a) => a.name)).toEqual(system.sheet.attributes.map((a) => a.name));
    expect(view.attributes).toContainEqual(EXPECT[id].attribute);
    expect(view.resources.map((r) => r.name)).toEqual(system.sheet.resources.map((r) => r.name));
    expect(view.resources[0]).toEqual(EXPECT[id].health);
    expect(view.skills.map((k) => k.name)).toEqual(system.sheet.skills.map((k) => k.name));
    expect(view.skills.find((k) => k.id === 'Stealth')).toEqual({
      id: 'Stealth',
      name: 'Stealth',
      attribute: id === 'd20-fantasy' ? 'Dexterity' : 'Reflex',
      rank: 0,
    });
    expect(view.ap).toBe(EXPECT[id].ap);
    expect(view.misfits).toEqual([]);
    expect(view.conditions).toEqual([]);
    // No formulas reach the page.
    const { system: named, ...rest } = view;
    expect(named.name).toBe(system.name);
    expect(JSON.stringify(rest)).not.toMatch(/mod\(|count\(|\dd\d/);
  });

  test('what a turn changed: a resource spent, a skill trained', () => {
    const sheet = sheets.defaultSheet(system);
    const stat = system.sheet.attributes[0].id;
    sheet.attributes[stat] = system.sheet.attributes[0].max;
    const full = sheets.maxima(system, sheet).health;
    sheet.resources.health = { current: full - 1 };
    sheet.skills.Stealth = 2;
    const view = sheets.characterView(system, character(sheet));
    expect(view.resources[0]).toMatchObject({ current: full - 1, max: full });
    expect(view.skills.find((k) => k.id === 'Stealth').rank).toBe(2);
    expect(view.attributes[0].score).toBe(system.sheet.attributes[0].max);
  });

  test('conditions with what is left (EF9)', () => {
    const sheet = sheets.defaultSheet(system);
    sheet.conditions = [
      { id: 'poisoned', duration: { turns: 2 } },
      { id: 'stunned', duration: { rounds: 1 } },
      { id: 'cursed', duration: { untilSaved: true } },
      { condition: 'blessed', duration: { seconds: 3600 }, since: 1000 },
      { id: 'tired' },
    ];
    const view = sheets.characterView(system, character(sheet), 1000 + 1800);
    expect(view.conditions).toEqual([
      { id: 'poisoned', name: 'Poisoned', left: '2 turns' },
      // What it does to AP (L-834).
      { id: 'stunned', name: 'Stunned', left: '1 round', ap: '0 AP' },
      { id: 'cursed', name: 'Cursed', left: 'until saved' },
      { id: 'blessed', name: 'Blessed', left: 'about 30 minutes' },
      { id: 'tired', name: 'Tired' },
    ]);
    // A system's own conditions give their names.
    const named = {
      ...system,
      sheet: {
        ...system.sheet,
        optional: [...system.sheet.optional, 'conditions'],
        conditions: [{ id: 'poisoned', name: 'Toxin' }],
      },
    };
    expect(sheets.characterView(named, character(sheet), 0).conditions[0]).toEqual({
      id: 'poisoned',
      name: 'Toxin',
      left: '2 turns',
    });
  });

  test('traits by name; an older ability by its id', () => {
    const withTraits = {
      ...system,
      sheet: {
        ...system.sheet,
        traits: [{ id: 'nimble', name: 'Nimble', description: 'Light on your feet.' }],
      },
    };
    const sheet = sheets.defaultSheet(withTraits, { traits: ['nimble', 'swim'] });
    expect(sheets.characterView(withTraits, character(sheet)).traits).toEqual([
      { id: 'nimble', name: 'Nimble', description: 'Light on your feet.' },
      { id: 'swim', name: 'Swim' },
    ]);
  });

  test('derived values, worked out (with "derived" on)', () => {
    const first = system.sheet.attributes[0];
    const off = system.sheet.optional.filter((part) => part !== 'derived');
    const withDerived = {
      ...system,
      sheet: {
        ...system.sheet,
        optional: [...off, 'derived'],
        derived: [{ id: 'carry', name: 'Carrying', formula: `${first.id} * 10` }],
      },
    };
    const without = { ...system, sheet: { ...system.sheet, optional: off } };
    const sheet = sheets.defaultSheet(withDerived);
    expect(sheets.characterView(withDerived, character(sheet)).derived).toEqual([
      { id: 'carry', name: 'Carrying', value: sheet.attributes[first.id] * 10 },
    ]);
    expect(sheets.characterView(without, character(sheet)).derived).toEqual([]);
  });

  test('a sheet that no longer fits says what (SY2)', () => {
    const sheet = sheets.defaultSheet(system);
    const gone = system.sheet.attributes[0];
    const changed = {
      ...system,
      sheet: { ...system.sheet, attributes: system.sheet.attributes.slice(1) },
    };
    sheet.attributes.Luck = 3;
    const view = sheets.characterView(changed, character(sheet));
    expect(view.misfits).toEqual(
      expect.arrayContaining([
        `There is no attribute "${gone.id}" in this world's rules.`,
        'There is no attribute "Luck" in this world\'s rules.',
      ])
    );
  });

  test('a save without a sheet has none to show', () => {
    expect(sheets.characterView(system, { name: 'Tam', abilities: ['swim'] })).toBeNull();
    expect(sheets.characterView(system, null)).toBeNull();
  });

  test('loomGetMap sends it with the map, at the save’s time', () => {
    const sheet = sheets.defaultSheet(system);
    sheet.conditions = [{ id: 'blessed', duration: { seconds: 600 }, since: 0 }];
    const save = { location: 'widows-reach', time: 300, character: character(sheet) };
    const view = mapView({ ...COAST, system }, save, null, null);
    expect(view.character).toEqual(sheets.characterView(system, save.character, 300));
    expect(view.character.conditions[0].left).toBe('about 5 minutes');
    expect(
      mapView({ ...COAST, system }, { location: 'widows-reach' }, null, null).character
    ).toBeNull();
  });

  test('a lock’s roll card names what the panel shows (the exit criterion)', () => {
    const sheet = sheets.defaultSheet(system);
    const lock = system.checks.lock.skill;
    sheet.skills[lock] = 2;
    const save = { location: 'widows-reach', character: character(sheet) };
    const panel = sheets.characterView(system, save.character);
    const skill = panel.skills.find((k) => k.id === lock);
    const attribute = panel.attributes.find((a) => a.name === skill.attribute);
    const { roll } = evaluate(
      { verb: 'pick', targets: [], params: { check: { skill: lock, rung: 'Moderate' } } },
      {},
      save,
      checks.fixedDice(7),
      { ...COAST, system }
    );
    const value = id === 'd20-fantasy' ? attribute.modifier : attribute.score;
    expect(roll.line).toContain(`${attribute.name} (${value})`);
    expect(roll.line).toContain(`${skill.name} (${skill.rank})`);
  });
});
