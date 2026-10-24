'use strict';

/**
 * Action points as data (planning/action-points.md §3 AP1, AP2, CT1, CT2,
 * KP2, MG1; L-831 / #681): the pool from `sheet.ap` with traits' and
 * conditions' `modifiers.ap`; `ap.costs`, `ap.tiers` and `ap.keepLimit`;
 * an attack's, a door's or a feature's own cost, and traits' and conditions'
 * `costs`; checked on save; systems written before AP converted, with a
 * warning for each change. By the two-configuration rule (MD2), each runs
 * under both built-in systems.
 *
 * Run: cd tests && npx jest loom-ap --verbose
 */

const ap = require('../functions/loom-canon/ap');
const sheets = require('../functions/loom-canon/sheets');
const { BUILT_IN, validateSystem } = require('../functions/loom-canon/systems');

const copyOf = (v) => JSON.parse(JSON.stringify(v));

describe.each([
  ['d20-fantasy', BUILT_IN['d20-fantasy']],
  ['pool-scifi', BUILT_IN['pool-scifi']],
])('AP under %s', (id, system) => {
  const fantasy = id === 'd20-fantasy';
  const mine = () => ({ ...copyOf(system), id: 'my-copy' });

  test('the built-in sets the pool by formula and the costs, tiers and keep limit', () => {
    const { errors, warnings } = validateSystem(system);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(system.sheet.ap).toBeDefined();
    expect(system.sheet.speed).toBeUndefined();
    expect(system.modules.combat.economy).toBeUndefined();
    expect(ap.settingsOf(system)).toEqual({
      costs: {
        move: 1,
        difficult: 2,
        door: 2,
        speak: 2,
        standUp: 5,
        lock: 5,
        object: 5,
        withdraw: 5,
        defend: 5,
        dodge: 8,
        attack: 10,
      },
      tiers: { minor: 3, standard: 10, major: 20 },
      keepLimit: null,
    });
    // 20 at the defaults; the pool rises with training.
    const sheet = sheets.defaultSheet(system);
    expect(sheets.apFor(system, sheet)).toBe(20);
    if (fantasy) sheet.attributes.DEX = 14;
    else sheet.attributes.Reflex = 4;
    expect(sheets.apFor(system, sheet)).toBe(22);
  });

  test('a system with no ap block, and no pool formula, has the defaults', () => {
    const s = mine();
    delete s.ap;
    delete s.sheet.ap;
    expect(validateSystem(s).errors).toEqual([]);
    expect(ap.settingsOf(s).costs.attack).toBe(10);
    expect(ap.settingsOf(s).keepLimit).toBeNull();
    expect(sheets.apFor(s, sheets.defaultSheet(s))).toBe(ap.DEFAULT_POOL);
  });

  test('its own costs, tiers and keep limit are used, the rest by default', () => {
    const s = mine();
    s.ap = { costs: { attack: 12, move: 2 }, tiers: { major: 25 }, keepLimit: 10 };
    expect(validateSystem(s).errors).toEqual([]);
    const settings = ap.settingsOf(s);
    expect(settings.costs).toMatchObject({ attack: 12, move: 2, dodge: 8 });
    expect(settings.tiers).toEqual({ minor: 3, standard: 10, major: 25 });
    expect(settings.keepLimit).toBe(10);
    expect(ap.costOf(s, sheets.defaultSheet(s), 'attack')).toBe(12);
    expect(ap.tierCost(s, 'major')).toBe(25);
    expect(ap.tierCost(s, 'enormous')).toBe(10);
  });

  test('bad AP settings are refused, each said', () => {
    const s = mine();
    s.ap = {
      costs: { attack: -1, sneeze: 2, move: 1.5 },
      tiers: { minor: 12, standard: 10, huge: 4 },
      keepLimit: 'lots',
      pace: 3,
    };
    const { errors } = validateSystem(s);
    expect(errors).toEqual(
      expect.arrayContaining([
        'ap: "pace" isn\'t an AP setting (costs, tiers, keepLimit).',
        expect.stringContaining('ap.costs.attack must be a whole number'),
        expect.stringContaining('ap.costs: "sneeze" isn\'t something AP pays for'),
        expect.stringContaining('ap.costs.move must be a whole number'),
        expect.stringContaining('ap.tiers: "huge" isn\'t a tier'),
        'ap.tiers must rise: minor, then standard, then major.',
        expect.stringContaining('ap.keepLimit must be a whole number'),
      ])
    );
    s.ap = 'cheap';
    expect(validateSystem(s).errors).toContain(
      'ap must be { costs?, tiers?, keepLimit? }, or false to switch AP off.'
    );
    s.ap = undefined;
    s.sheet.ap = '20 + Luck';
    expect(validateSystem(s).errors.join(' ')).toContain('sheet.ap');
  });

  test('traits and conditions change the pool and the prices, only while held', () => {
    const s = mine();
    s.sheet.traits = [
      { id: 'quick', name: 'Quick', modifiers: { ap: '4' } },
      { id: 'light', name: 'Light-footed', costs: { difficult: 1 } },
      { id: 'heavy', name: 'Heavy-handed', costs: { attack: 'x2' } },
    ];
    s.sheet.conditions = [
      ...(s.sheet.conditions || []),
      { id: 'mired', name: 'Mired', description: 'Stuck.', costs: { move: '×2', difficult: 3 } },
    ];
    expect(validateSystem(s).errors).toEqual([]);
    const plain = sheets.defaultSheet(s);
    const held = sheets.defaultSheet(s, { traits: ['quick', 'light', 'heavy'] });
    expect(sheets.apFor(s, plain)).toBe(20);
    expect(sheets.apFor(s, held)).toBe(24);
    expect(ap.costOf(s, plain, 'difficult')).toBe(2);
    expect(ap.costOf(s, held, 'difficult')).toBe(1);
    expect(ap.costOf(s, held, 'attack')).toBe(20);
    // An attack's own cost, then the multiple.
    expect(ap.costOf(s, held, 'attack', { own: 7 })).toBe(14);
    expect(ap.costOf(s, plain, 'attack', { own: 7 })).toBe(7);
    // A set cost goes first, then multiples: Light-footed's 1, then Mired's x2…
    const mired = s.sheet.conditions.find((c) => c.id === 'mired');
    expect(ap.costOf(s, held, 'move', { conditionsHeld: [mired] })).toBe(2);
    // …and the last set cost stands (Mired's 3 over Light-footed's 1).
    expect(ap.costOf(s, held, 'difficult', { conditionsHeld: [mired] })).toBe(3);
    expect(ap.costOf(s, held, 'nothing')).toBeNull();
  });

  test('a condition’s modifiers.ap takes from the pool, never below 1', () => {
    const s = mine();
    const sheet = sheets.defaultSheet(s);
    const prone = (s.sheet.conditions || []).find((c) => c.modifiers && c.modifiers.ap);
    if (prone) {
      sheet.conditions = [{ condition: prone.id }];
      expect(sheets.apFor(s, sheet)).toBeLessThan(20);
    }
    s.sheet.ap = '1 - level * 50';
    expect(sheets.apFor(s, sheets.defaultSheet(s))).toBe(1);
  });

  test('bad overrides on traits and conditions are refused', () => {
    const s = mine();
    s.sheet.traits = [{ id: 'odd', name: 'Odd', costs: { fly: 2, move: 'x99', attack: 'half' } }];
    const { errors } = validateSystem(s);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('sheet.traits[0].costs: "fly" isn\'t something AP pays for'),
        expect.stringContaining('sheet.traits[0].costs.move must be a cost'),
        expect.stringContaining('sheet.traits[0].costs.attack must be a cost'),
      ])
    );
    s.sheet.traits = [{ id: 'odd', name: 'Odd', costs: 'cheap' }];
    expect(validateSystem(s).errors.join(' ')).toContain('sheet.traits[0].costs must map');
  });

  test('an attack’s own ap is checked on save', () => {
    const s = mine();
    s.modules.combat.attacks[0].ap = 7;
    expect(validateSystem(s).errors).toEqual([]);
    for (const bad of [0, 1.5, '7', ap.MAX_COST + 1]) {
      s.modules.combat.attacks[0].ap = bad;
      expect(validateSystem(s).errors.join(' ')).toContain('modules.combat.attacks[0]');
    }
    expect(ap.ownCostOk(undefined)).toBe(true);
  });

  test('a system written before AP is converted, saying what changed', () => {
    const old = mine();
    old.sheet.speed = old.sheet.ap;
    delete old.sheet.ap;
    old.sheet.traits = [{ id: 'fleet', name: 'Fleet of foot', modifiers: { speed: '5' } }];
    old.modules.combat.economy = { actions: 1, reactions: 1, quick: 0 };
    delete old.ap;
    const { errors, warnings, system: saved } = validateSystem(old);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('sheet.speed is now sheet.ap');
    expect(warnings[1]).toContain('sheet.traits[0] (fleet): modifiers.speed is now modifiers.ap');
    expect(warnings[2]).toContain('modules.combat.economy is retired');
    expect(warnings[2]).not.toContain("weren't one each");
    expect(saved.sheet.ap).toBe(system.sheet.ap);
    expect(saved.sheet.speed).toBeUndefined();
    expect(saved.sheet.traits[0].modifiers).toEqual({ ap: '5' });
    expect(saved.modules.combat.economy).toBeUndefined();
    // The pool is the same as speed was: a square still costs 1.
    expect(sheets.apFor(saved, sheets.defaultSheet(saved, { traits: ['fleet'] }))).toBe(25);
    // The original isn't touched; one already on AP comes back as it was.
    expect(old.sheet.speed).toBeDefined();
    const again = ap.convert(system);
    expect(again.system).toBe(system);
    expect(again.warnings).toEqual([]);
  });

  test('both speed and ap: ap is kept, speed dropped, said', () => {
    const s = mine();
    s.sheet.speed = '99';
    const { system: saved, warnings } = ap.convert(s);
    expect(saved.sheet.ap).toBe(system.sheet.ap);
    expect(saved.sheet.speed).toBeUndefined();
    expect(warnings).toEqual([expect.stringContaining('sheet.speed is retired')]);
  });

  test('the rules reference reads the pool, each cost and the tiers (L-837)', () => {
    const view = ap.rulesView(system);
    expect(view.pool).toBe(system.sheet.ap);
    expect(view.costs.map((c) => c.id)).toEqual(ap.SPENDS);
    expect(view.costs.find((c) => c.id === 'dodge')).toMatchObject({ name: 'Dodge', ap: 8 });
    expect(view.tiers).toEqual([
      { id: 'minor', ap: 3 },
      { id: 'standard', ap: 10 },
      { id: 'major', ap: 20 },
    ]);
    expect(view.keepLimit).toBeNull();
    expect(ap.rulesView({ ...mine(), ap: false })).toEqual({ off: true });
  });
});
