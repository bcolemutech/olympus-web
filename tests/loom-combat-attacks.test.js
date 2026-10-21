'use strict';

/**
 * Attacks and damage (planning/combat.md §3 AT1–AT5, DF4, §4.4; L-822 /
 * #654), pure, under both built-in systems (MD2): the combat settings for
 * attacks, attacks on sheets and who has which, hitting by defence or by an
 * opposed roll, damage by degree, types resisted and weak, conditions on a
 * hit, areas, ammunition, lethal attacks and Subdue.
 *
 * Run: cd tests && npx jest loom-combat-attacks --verbose
 */

const { validateSystem, BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const attacks = require('../functions/loom-modules/combat/attacks');
const strike = require('../functions/loom-modules/combat/strike');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];
const copyOf = (v) => JSON.parse(JSON.stringify(v));

// Dice that roll these faces in turn, then the last one forever.
const faces = (...list) => {
  let i = 0;
  return (sides) => Math.min(sides, list[Math.min(i++, list.length - 1)]);
};

describe('the combat settings for attacks', () => {
  test('the built-ins’ pass, with Armour derived in the fantasy system', () => {
    for (const system of [FANTASY, SCIFI]) {
      expect(validateSystem(system)).toMatchObject({ errors: [], warnings: [] });
    }
    expect(FANTASY.sheet.derived).toEqual([
      { id: 'Armour', name: 'Armour', formula: '10 + mod(DEX)' },
    ]);
    expect(FANTASY.modules.combat.attack).toEqual({
      hit: 'defence',
      defence: 'Armour',
      critical: 'doubleDice',
    });
    expect(SCIFI.modules.combat.attack).toMatchObject({ hit: 'opposed', extraSuccesses: 'addDie' });
  });

  test('bad ones are refused, each said', () => {
    const s = { ...copyOf(FANTASY), id: 'my-copy' };
    Object.assign(s.modules.combat, {
      attack: { hit: 'guess', critical: 'tripleDice' },
      damageTypes: [{ id: 'Fire', name: 'Fire' }, { id: 'cold' }],
      health: 'luck',
      unarmed: { reach: 1, attack: '1d20', damage: 'Brawn' },
      attacks: [{ id: 'axe', name: 'Axe', attack: '1d20', damage: '1d8', type: 'slashing' }],
    });
    const { errors } = validateSystem(s);
    expect(errors).toEqual(
      expect.arrayContaining([
        'modules.combat.attack.hit must be one of defence, opposed.',
        'modules.combat.attack.critical must be one of doubleDice, none.',
        'modules.combat.damageTypes[0].id must be lowercase letters, digits, - and _.',
        'modules.combat.damageTypes[1].name is required.',
        'modules.combat.health "luck" isn\'t one of the system\'s resources.',
        'modules.combat.unarmed.damage: Unknown name "Brawn".',
        'modules.combat.attacks[0] needs reach (melee, in squares) or range ({ normal, long }), not both.',
      ])
    );
  });

  test('a defence hit needs its defence, an opposed one its roll', () => {
    const s = { ...copyOf(SCIFI), id: 'my-copy' };
    s.modules.combat.attack = { hit: 'opposed' };
    expect(validateSystem(s).errors).toContain(
      "modules.combat.attack.defend is needed: the target's roll, a formula."
    );
    s.modules.combat.attack = { hit: 'defence', defence: 'Dodge' };
    expect(validateSystem(s).errors.join(' ')).toContain('modules.combat.attack.defence');
  });

  test('traits and conditions resist or are weak to the system’s damage types', () => {
    const s = { ...copyOf(FANTASY), id: 'my-copy' };
    s.sheet.traits = [{ id: 'scaled', name: 'Scaled', resist: ['slashing'], weak: ['cold'] }];
    s.sheet.conditions[0].resist = 'poison';
    const { errors } = validateSystem(s);
    expect(errors).toEqual([
      'sheet.traits[0].weak: "cold" isn\'t one of the system\'s damage types (slashing, piercing, bludgeoning, fire, poison).',
      'sheet.conditions[0].resist must be a list of damage types.',
    ]);
  });
});

describe('attacks on sheets', () => {
  const sword = {
    id: 'sword',
    name: 'Sword',
    reach: 1,
    attack: '1d20 + mod(STR)',
    damage: '1d8',
    type: 'slashing',
  };

  test('a sheet’s attacks are checked against the system', () => {
    const sheet = { ...sheets.defaultSheet(FANTASY), attacks: [sword] };
    expect(sheets.validateSheet(FANTASY, sheet)).toEqual([]);
    sheet.attacks = [
      { ...sword, reach: undefined, range: { normal: 10, long: 5 } },
      { ...sword, id: 'sword', type: 'kinetic', damage: '1d8 > 3' },
      {
        ...sword,
        id: 'bow',
        ammo: 'arrows',
        onHit: { condition: 'dazed', duration: { turns: 1 } },
      },
      { ...sword, id: 'blast', area: { shape: 'aura', radius: 2 } },
      { ...sword, id: 'cone', area: { shape: 'cone', length: 3, x: 2 } },
      { ...sword, id: 'odd', colour: 'red' },
    ];
    expect(sheets.validateSheet(FANTASY, sheet)).toEqual([
      'attacks[0].range must be { normal, long }: whole squares, long at least normal, at most 100.',
      'attacks[1].damage must come to a number, not a comparison.',
      "attacks[1].type must be one of the system's damage types (slashing, piercing, bludgeoning, fire, poison).",
      'attacks[1].id "sword" is used twice.',
      'attacks[2].ammo "arrows" isn\'t one of the system\'s resources.',
      expect.stringContaining('attacks[2].onHit: There is no condition "dazed"'),
      "attacks[3].area can't be an aura.",
      "attacks[4].area: x is set where it's used, not on the attack.",
      'attacks[5]: "colour" isn\'t part of an attack.',
    ]);
  });

  test('a stat block can list them', () => {
    const block = {
      attributes: { STR: 14, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      attacks: [sword],
    };
    expect(sheets.validateStatBlock(FANTASY, block)).toEqual([]);
    expect(sheets.sheetFromStatBlock(FANTASY, block).attacks).toEqual([sword]);
  });

  test.each([
    ['d20-fantasy', FANTASY, ['sword', 'bow', 'unarmed']],
    ['pool-scifi', SCIFI, ['knife', 'pistol', 'unarmed']],
  ])(
    'under %s: a player starts with the system’s attacks; others have unarmed',
    (id, system, ids) => {
      const sheet = sheets.defaultSheet(system);
      expect(attacks.attacksOf(system, sheet, { player: true }).map((a) => a.id)).toEqual(ids);
      expect(attacks.attacksOf(system, sheet).map((a) => a.id)).toEqual(['unarmed']);
      // Their own list, with unarmed added; theirs if they list one.
      const own = { ...sheet, attacks: [{ ...sword, type: undefined }] };
      expect(attacks.attacksOf(system, own, { player: true }).map((a) => a.id)).toEqual([
        'sword',
        'unarmed',
      ]);
      expect(attacks.attacksOf(system, sheet).find((a) => a.id === 'unarmed').lethal).toBe(false);
      expect(attacks.attacksOf(system, sheet, { player: true })[0].lethal).toBe(true);
    }
  );

  test('the Character panel lists them, in the system’s words', () => {
    const view = sheets.characterView(FANTASY, {
      name: 'Tam',
      sheet: sheets.defaultSheet(FANTASY),
    });
    expect(view.attacks[0]).toEqual({
      id: 'sword',
      name: 'Sword',
      reach: 1,
      damage: '1–8',
      type: 'Slashing',
      lethal: true,
    });
    expect(view.attacks[1]).toMatchObject({ id: 'bow', range: { normal: 16, long: 64 } });
    expect(view.derived).toEqual([{ id: 'Armour', name: 'Armour', value: 10 }]);
  });
});

describe('striking, d20 fantasy: against Armour', () => {
  const system = FANTASY;
  const sword = attacks.attackOf(system, null, 'sword', { player: true });
  const me = () => sheets.defaultSheet(system); // STR 10: +0
  const foe = (patch = {}) => ({
    id: 'grell',
    name: 'Grell',
    sheet: { ...sheets.defaultSheet(system), ...patch },
  });
  const hit = (dice, options = {}) =>
    strike.strike(system, {
      attacker: { name: 'You', sheet: options.sheet || me() },
      attack: options.attack || sword,
      targets: [options.target || foe()],
      subdue: options.subdue,
      dice,
    });

  test('a miss: under Armour', () => {
    const { roll, results } = hit(faces(7));
    expect(roll.line).toBe('d20 (7) + Strength (0) + 2');
    expect(results[0]).toMatchObject({ hit: false, degree: 'failure', defence: 10 });
    expect(results[0].lines).toEqual(['You miss Grell.']);
    expect(results[0].sheet.resources.health.current).toBe(6);
  });

  test('reaching Armour at all hits: at a cost is a plain hit', () => {
    const { results } = hit(faces(8, 4)); // 10 against 10: at a cost
    expect(results[0]).toMatchObject({ hit: true, degree: 'successAtCost' });
    expect(results[0].damage).toMatchObject({
      total: 4,
      type: 'Slashing',
      line: 'd8 (4) + Strength (0)',
    });
    expect(results[0].sheet.resources.health.current).toBe(2);
    expect(results[0].lines).toEqual(['You hit Grell with your sword for 4 slashing.']);
  });

  test('a critical doubles the dice', () => {
    const { results } = hit(faces(20, 3));
    expect(results[0].degree).toBe('criticalSuccess');
    expect(results[0].damage.line).toBe('2d8 (6) + Strength (0)');
    expect(results[0].damage.total).toBe(6);
    expect(results[0].lines[0]).toBe(
      'You hit Grell with your sword for 6 slashing: a critical hit.'
    );
  });

  test('a lethal blow at 0 kills; struck to subdue, it knocks out, at the system’s penalty', () => {
    const dead = hit(faces(15, 8)).results[0];
    expect(dead.down).toBe('dead');
    expect(dead.lines).toContain('Grell falls, dead.');
    const { roll, results } = hit(faces(15, 8), { subdue: true });
    expect(roll.line).toBe('d20 (15) + Strength (0) + 2 + Subdue (-4)');
    expect(results[0].down).toBe('out');
    expect(results[0].lines).toContain('Grell falls, knocked out.');
  });

  test('a non-lethal attack knocks out, with no penalty', () => {
    const unarmed = attacks.unarmedOf(system);
    const { roll, results } = hit(faces(15, 1), {
      attack: unarmed,
      subdue: true,
      target: foe({ resources: { health: { current: 1 } } }),
    });
    expect(roll.line).not.toContain('Subdue');
    expect(results[0]).toMatchObject({ down: 'out' });
    expect(results[0].damage.total).toBe(1); // at least 1 on a hit
  });

  test('the attacker’s conditions join the roll; the target’s Dexterity raises Armour', () => {
    const poisoned = { ...me(), conditions: [{ condition: 'poisoned', duration: { turns: 2 } }] };
    const { roll, results } = hit(faces(9, 1), {
      sheet: poisoned,
      target: foe({ attributes: { ...sheets.defaultSheet(system).attributes, DEX: 14 } }),
    });
    expect(roll.line).toBe('d20 (9) + Strength (0) + 2 + Poisoned (-2)');
    expect(results[0]).toMatchObject({ hit: false, defence: 12 });
  });

  test('resisted damage halves; a weakness doubles', () => {
    const s = copyOf(system);
    s.sheet.traits = [
      { id: 'scaled', name: 'Scaled', resist: ['slashing'] },
      { id: 'brittle', name: 'Brittle', weak: ['slashing'] },
    ];
    const strikeOn = (traits) =>
      strike.strike(s, {
        attacker: { name: 'You', sheet: me() },
        attack: sword,
        targets: [{ id: 'g', name: 'Grell', sheet: { ...sheets.defaultSheet(s), traits } }],
        dice: faces(15, 5),
      }).results[0];
    expect(strikeOn(['scaled']).damage).toMatchObject({ rolled: 5, total: 2, takes: 'resist' });
    expect(strikeOn(['scaled']).lines[0]).toBe(
      'You hit Grell with your sword for 2 slashing (resisted).'
    );
    expect(strikeOn(['brittle']).damage).toMatchObject({ total: 10, takes: 'weak' });
    expect(strikeOn(['scaled', 'brittle']).damage).toMatchObject({ total: 5, takes: null });
  });

  test('a condition on a hit (its save rolled by the target)', () => {
    const venom = {
      ...sword,
      onHit: {
        condition: 'poisoned',
        duration: { turns: 2 },
        save: { attribute: 'CON', against: 'Hard', when: 'apply' },
      },
    };
    const { results } = hit(faces(15, 2), { attack: venom });
    expect(results[0].effect).toMatchObject({ outcome: 'applied', name: 'Poisoned' });
    expect(results[0].sheet.conditions).toEqual([
      expect.objectContaining({
        condition: 'poisoned',
        source: { kind: 'attack', id: 'sword', name: 'Sword' },
      }),
    ]);
    expect(results[0].lines).toContain('Grell is Poisoned.');
  });

  test('an area: one roll, read against each target', () => {
    const fire = { ...sword, id: 'flask', area: { shape: 'burst', radius: 1 }, type: 'fire' };
    const { results } = strike.strike(system, {
      attacker: { name: 'You', sheet: me() },
      attack: fire,
      targets: [
        foe(),
        {
          ...foe({ attributes: { ...sheets.defaultSheet(system).attributes, DEX: 18 } }),
          id: 'nim',
          name: 'Nim',
        },
      ],
      dice: faces(10, 3),
    });
    // 12 reaches Grell's Armour of 10, not Nim's 14.
    expect(results.map((r) => [r.id, r.hit])).toEqual([
      ['grell', true],
      ['nim', false],
    ]);
  });

  test('ammunition: one spent each shot; none left, it can’t fire', () => {
    const s = copyOf(system);
    s.sheet.resources.push({ id: 'arrows', name: 'Arrows', max: '20' });
    const bow = { ...attacks.attackOf(system, null, 'bow', { player: true }), ammo: 'arrows' };
    const sheet = sheets.defaultSheet(s);
    const spent = strike.spendAmmo(s, sheet, bow);
    expect(spent.sheet.resources.arrows.current).toBe(19);
    const empty = { ...sheet, resources: { ...sheet.resources, arrows: { current: 0 } } };
    expect(strike.spendAmmo(s, empty, bow)).toEqual({ refused: "You're out of arrows." });
    expect(strike.spendAmmo(s, sheet, sword)).toEqual({ sheet });
  });
});

describe('striking, dice-pool sci-fi: opposed', () => {
  const system = SCIFI;
  const knife = attacks.attackOf(system, null, 'knife', { player: true });
  const me = () => sheets.defaultSheet(system); // Body 3: 3 dice
  const foe = () => ({ id: 'vex', name: 'Vex', sheet: sheets.defaultSheet(system) }); // Reflex 3

  test('beating their roll hits; each extra success adds a die', () => {
    // Ours first: 3 successes; then theirs: 1, so 2 needed and 1 past it.
    const dice = faces(9, 9, 9, 8, 2, 2, 1, 1);
    const { roll, results } = strike.strike(system, {
      attacker: { name: 'You', sheet: me() },
      attack: knife,
      targets: [foe()],
      dice,
    });
    expect(roll.total).toBe(3);
    expect(results[0].opposed.total).toBe(1);
    expect(results[0]).toMatchObject({ hit: true, degree: 'success', difficulty: 2 });
    // One success past what was needed: a second d2.
    expect(results[0].damage.line).toBe('2d2 (2)');
    expect(results[0].damage.total).toBe(2);
  });

  test('a tie goes to the defender', () => {
    const { results } = strike.strike(system, {
      attacker: { name: 'You', sheet: me() },
      attack: knife,
      targets: [foe()],
      dice: faces(9, 1, 1, 9, 1, 1),
    });
    expect(results[0]).toMatchObject({ hit: false, degree: 'failure' });
  });

  test('a damage formula with no dice adds 1 a success; Subdue costs a success', () => {
    const unarmed = attacks.unarmedOf(system);
    const { results } = strike.strike(system, {
      attacker: { name: 'You', sheet: me() },
      attack: unarmed,
      targets: [foe()],
      dice: faces(9, 9, 9, 1, 1, 1),
    });
    // 1, and 2 past the 1 needed.
    expect(results[0].damage).toMatchObject({ total: 3, line: '1 + Extra successes (2)' });
    const subdued = strike.strike(system, {
      attacker: { name: 'You', sheet: me() },
      attack: knife,
      subdue: true,
      targets: [foe()],
      dice: faces(9, 9, 9, 1, 1, 1),
    });
    expect(subdued.roll.total).toBe(2);
    expect(subdued.roll.line).toContain('Subdue (-1)');
  });

  test('Rattled: a die fewer in the attacker’s pool', () => {
    const rattled = { ...me(), conditions: [{ condition: 'rattled', duration: { turns: 1 } }] };
    const { roll } = strike.strike(system, {
      attacker: { name: 'You', sheet: rattled },
      attack: knife,
      targets: [foe()],
      dice: faces(1, 1, 1, 9),
    });
    expect(roll.line).toContain('Rattled (-1)');
    expect(roll.breakdown.terms.find((t) => t.kind === 'count').rolls).toHaveLength(2);
  });
});
