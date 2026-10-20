'use strict';

/**
 * The formula language (planning/game-systems.md §3 DC1, FX1–FX3, §4.3;
 * L-802 / #628): functions/loom-canon/formula.js, and a system's formulas
 * checked on save (functions/loom-canon/systems.js). Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-formula --verbose
 */

const formula = require('../functions/loom-canon/formula');
const { validateSystem, BUILT_IN } = require('../functions/loom-canon/systems');

const { parse, check, evaluate, range, seeded, FormulaError } = formula;

// Dice that come up as listed, in order.
function fixed(...faces) {
  const left = faces.slice();
  return (sides) => {
    if (!left.length) throw new Error('ran out of fixed dice');
    const face = left.shift();
    if (face < 1 || face > sides) throw new Error(`a d${sides} can't come up ${face}`);
    return face;
  };
}

const SYSTEM = {
  sheet: {
    attributes: [
      { id: 'DEX', name: 'Dexterity', min: 1, max: 20, modifier: 'floor((DEX - 10) / 2)' },
      { id: 'CHA', name: 'Charisma', min: 1, max: 20, modifier: 'floor((CHA - 10) / 2)' },
    ],
    resources: [{ id: 'health', name: 'Health', max: 10 }],
    level: { min: 1, max: 20 },
    optional: ['skills'],
    skills: [
      { id: 'Stealth', name: 'Stealth', attribute: 'DEX' },
      { id: 'Athletics', name: 'Athletics', attribute: 'DEX' },
    ],
  },
  tables: {
    damage: [
      { max: 2, value: '1d4' },
      { min: 3, max: 5, value: '1d8' },
      { min: 6, value: 12 },
    ],
  },
};
const VALUES = { DEX: 15, CHA: 8, Stealth: 3, Athletics: 2, health: 10, level: 2 };
const run = (text, ...faces) =>
  evaluate(text, { values: VALUES, system: SYSTEM, dice: fixed(...faces) });

// The breakdown's line evaluates, with no dice and no names, to the total.
function agrees(result) {
  const again = evaluate(result.breakdown.shown, { dice: fixed() });
  expect(again.total).toBe(result.total);
}

describe('every kind of check (DC1), with fixed dice', () => {
  test('roll and add: d20 + mod(DEX) + Stealth', () => {
    const r = run('d20 + mod(DEX) + Stealth', 14);
    expect(r).toMatchObject({ total: 14 + 2 + 3, type: 'number' });
    expect(r.breakdown.terms).toEqual([
      { kind: 'dice', expr: '1d20', rolls: [{ value: 14, kept: true }], value: 14 },
      { kind: 'mod', name: 'DEX', score: 15, value: 2 },
      { kind: 'field', name: 'Stealth', value: 3 },
    ]);
    expect(r.breakdown.shown).toBe('14 + 2 + 3');
    agrees(r);
  });

  test('roll under: d100 <= Stealth, true or false', () => {
    const under = evaluate('d100 <= Stealth', {
      values: { ...VALUES, Stealth: 45 },
      system: SYSTEM,
      dice: fixed(31),
    });
    expect(under).toMatchObject({ total: 1, type: 'bool' });
    expect(under.breakdown.shown).toBe('31 <= 45');
    agrees(under);
    const over = evaluate('d100 <= Stealth', {
      values: { ...VALUES, Stealth: 45 },
      system: SYSTEM,
      dice: fixed(77),
    });
    expect(over.total).toBe(0);
    agrees(over);
  });

  test('pools: count((DEX + Athletics)d10, >= 7) counts the dice that meet it', () => {
    const r = evaluate('count((DEX + Athletics)d10, >= 7)', {
      values: { ...VALUES, DEX: 3 },
      system: SYSTEM,
      dice: fixed(9, 2, 7, 6, 10),
    });
    expect(r.total).toBe(3);
    expect(r.breakdown.terms).toEqual([
      { kind: 'field', name: 'DEX', value: 3 },
      { kind: 'field', name: 'Athletics', value: 2 },
      {
        kind: 'count',
        expr: '5d10',
        op: '>=',
        than: 7,
        rolls: [
          { value: 9, kept: true, counted: true },
          { value: 2, kept: true, counted: false },
          { value: 7, kept: true, counted: true },
          { value: 6, kept: true, counted: false },
          { value: 10, kept: true, counted: true },
        ],
        value: 3,
      },
    ]);
    agrees(r);
  });

  test('bands: 2d6 + mod(CHA), a negative modifier', () => {
    const r = run('2d6 + mod(CHA)', 4, 5);
    expect(r.total).toBe(9 - 1);
    expect(r.breakdown.terms[0]).toMatchObject({
      expr: '2d6',
      rolls: [
        { value: 4, kept: true },
        { value: 5, kept: true },
      ],
    });
    agrees(r);
  });

  test('keep highest: 2d20kh1 + 3, with the dropped die listed', () => {
    const r = run('2d20kh1 + 3', 6, 17);
    expect(r.total).toBe(20);
    expect(r.breakdown.terms[0]).toEqual({
      kind: 'dice',
      expr: '2d20kh1',
      rolls: [
        { value: 6, kept: false },
        { value: 17, kept: true },
      ],
      value: 17,
    });
    agrees(r);
    // And keep lowest, for disadvantage.
    expect(run('2d20kl1', 6, 17).total).toBe(6);
  });
});

describe('the rest of the language', () => {
  test('arithmetic keeps its order, with brackets kept in the line', () => {
    const r = run('10 - (3 - 1) * 2 + floor(7 / 2) + max(1, Stealth, 2) - min(4, 5)');
    expect(r.total).toBe(10 - 4 + 3 + 3 - 4);
    expect(r.breakdown.shown).toBe('10 - (3 - 1) * 2 + floor(7 / 2) + max(1, 3, 2) - min(4, 5)');
    agrees(r);
    expect(run('ceil(7 / 2) * -2').total).toBe(-8);
  });

  test('tables: a number, or a formula rolled', () => {
    const r = run('table(damage, level) + 1', 3);
    expect(r.total).toBe(4);
    expect(r.breakdown.terms[1]).toMatchObject({
      kind: 'table',
      name: 'damage',
      input: 2,
      value: 3,
    });
    agrees(r);
    expect(run('table(damage, 9)').total).toBe(12);
    expect(() => run('table(damage, -1 * 0 - 0.5 * 0 + 0)', 1)).not.toThrow();
  });

  test('× and ÷ and ≤ read as * and / and <=', () => {
    expect(run('3 × 4 ÷ 2').total).toBe(6);
    expect(run('d10 ≤ 5', 5).total).toBe(1);
  });

  test('the same seed gives the same result, and the breakdown agrees', () => {
    const text = 'count((DEX + Athletics)d10, >= 7) + 2d20kh1 + d6';
    const one = evaluate(text, { values: VALUES, system: SYSTEM, dice: seeded(1234) });
    const two = evaluate(text, { values: VALUES, system: SYSTEM, dice: seeded(1234) });
    expect(two).toEqual(one);
    agrees(one);
    const other = evaluate(text, { values: VALUES, system: SYSTEM, dice: seeded(99) });
    expect(other.breakdown.terms).not.toEqual(one.breakdown.terms);
    // A seeded die stays on its faces.
    const d = seeded(7);
    for (let i = 0; i < 500; i++) {
      const face = d(6);
      expect(face >= 1 && face <= 6 && Number.isInteger(face)).toBe(true);
    }
  });

  test('a name with no value, or a division by zero, is an error, not a guess', () => {
    expect(() => evaluate('Luck + 1', { values: VALUES, dice: fixed() })).toThrow(
      'No value for "Luck".'
    );
    expect(() => run('4 / (Stealth - 3)')).toThrow('Division by zero.');
  });
});

describe('parsing and checking', () => {
  const errorsOf = (text, names) => check(text, { system: SYSTEM, names }).errors;

  test('the DC1 formulas check clean, with their types and names', () => {
    expect(check('d20 + mod(DEX) + Stealth', { system: SYSTEM })).toMatchObject({
      errors: [],
      type: 'number',
      names: ['DEX', 'Stealth'],
    });
    expect(check('d100 <= Stealth', { system: SYSTEM }).type).toBe('bool');
    expect(check('2d6', { system: SYSTEM }).type).toBe('pool');
    expect(errorsOf('count((DEX + Athletics)d10, >= 7)')).toEqual([]);
  });

  test('unknown names are rejected; a place may allow its own', () => {
    expect(errorsOf('d20 + Luck')).toEqual(['Unknown name "Luck".']);
    expect(errorsOf('d20 + rank')).toEqual(['Unknown name "rank".']);
    expect(errorsOf('d20 + rank', ['rank'])).toEqual([]);
    expect(errorsOf('mod(Stealth)')).toEqual([
      'mod(Stealth): "Stealth" isn\'t one of the system\'s attributes.',
    ]);
    expect(errorsOf('table(loot, 3)')).toEqual(['table(loot, …): the system has no table "loot".']);
    expect(errorsOf('roll(2)')).toEqual([
      '"roll" isn\'t a function (min, max, floor, ceil, mod, table, count).',
    ]);
  });

  test('type errors: counting what isn’t dice, a comparison used as a number', () => {
    expect(errorsOf('count(DEX, >= 7)')).toEqual(['count needs dice to count: count(4d10, >= 7).']);
    expect(errorsOf('count(2d6 + 1, >= 7)')).toEqual([
      'count needs dice to count: count(4d10, >= 7).',
    ]);
    // A comparison stands alone: inside anything else it can't be read.
    expect(errorsOf('table(damage, d20 <= 3)')).toEqual(['Expected ")" at 19.']);
  });

  test('impossible dice and oversize formulas are rejected', () => {
    expect(errorsOf('d1')).toEqual(['d1: dice need 2 to 1000 sides.']);
    expect(errorsOf('0d6')).toEqual(['0d6: roll 1 to 100 dice.']);
    expect(errorsOf('101d6')).toEqual(['101d6: roll 1 to 100 dice.']);
    expect(errorsOf('2d20kh3')).toEqual([
      '2d20kh3: keep at least one die, and no more than are rolled.',
    ]);
    const long = Array.from({ length: 200 }, () => '1').join(' + ');
    expect(errorsOf(long)).toEqual(['The formula is longer than 500 characters.']);
    const many = Array.from({ length: 130 }, () => '1').join('+');
    expect(errorsOf(many)).toEqual(['The formula has more than 120 terms.']);
  });

  test('broken formulas say where', () => {
    expect(errorsOf('2 +')).toEqual(['The formula ends too soon.']);
    expect(errorsOf('(1 + 2')).toEqual(['Expected ")" at the end.']);
    expect(errorsOf('1 2')).toEqual(['Unexpected "2" at 3.']);
    expect(errorsOf('2 $ 3')).toEqual(['Unexpected "$" at 3.']);
    expect(errorsOf('count(2d6)')).toEqual(['Expected "," at 10.']);
    expect(() => parse('')).toThrow(FormulaError);
  });

  test('ranges: the least and most a formula can come to', () => {
    expect(range('2d6 + mod(DEX)', { system: SYSTEM })).toEqual([2 - 5, 12 + 5]);
    expect(range('2d20kh1 + 3')).toEqual([4, 23]);
    expect(range('d20 + rank')).toEqual([-Infinity, Infinity]);
    expect(range('d20 + rank', { ranges: { rank: [0, 5] } })).toEqual([1, 25]);
  });
});

describe('a system’s formulas, checked on save', () => {
  const fantasy = () => JSON.parse(JSON.stringify(BUILT_IN['d20-fantasy']));

  test('the built-in fantasy placeholder’s formulas check clean', () => {
    expect(validateSystem(fantasy())).toMatchObject({ errors: [], warnings: [] });
  });

  test('a formula that doesn’t check refuses the system, saying where', () => {
    const s = fantasy();
    s.checks.formula = '1d20 + modifier + bonus';
    s.sheet.resources[0].max = '8 + mod(CON) + count(CON, >= 3)';
    s.sheet.attributes[0].modifier = 'mod(STR) + 1';
    s.checks.degrees = { success: 'result + 10', criticalFailure: 'result <= 1' };
    expect(validateSystem(s).errors).toEqual([
      "sheet.attributes[0].modifier: a modifier can't use mod().",
      'sheet.resources[0].max: count needs dice to count: count(4d10, >= 7).',
      'checks.formula: Unknown name "bonus".',
      'checks.degrees.success must be a comparison (result >= difficulty, say).',
    ]);
  });

  test('a sheet formula must come to a number; a degree reads result and difficulty', () => {
    const s = fantasy();
    s.sheet.resources[0].max = 'CON >= 10';
    s.checks.degrees = { criticalSuccess: 'result >= difficulty + 10' };
    expect(validateSystem(s).errors).toEqual([
      'sheet.resources[0].max must come to a number, not a comparison.',
    ]);
  });

  test('a sheet field can’t take a word formulas use', () => {
    const s = fantasy();
    s.sheet.skills.push({ id: 'd20', name: 'Dice', attribute: 'DEX' });
    s.sheet.skills.push({ id: 'rank', name: 'Rank', attribute: 'DEX' });
    expect(validateSystem(s).errors).toEqual([
      'sheet.skills[13].id "d20" is a word formulas use; choose another.',
      'sheet.skills[14].id "rank" is a word formulas use; choose another.',
    ]);
  });

  test('tables are checked, and formulas can look them up', () => {
    const s = fantasy();
    s.tables = {
      size: [
        { max: 1, value: '1d6' },
        { min: 2, value: 'STR' },
      ],
    };
    s.sheet.resources[0].max = '8 + table(size, level)';
    expect(validateSystem(s).errors).toEqual([]);
    s.tables = { size: [], loot: [{ min: 3, max: 1, value: 'gold' }] };
    expect(validateSystem(s).errors).toEqual([
      'tables.size needs 1 to 60 rows.',
      'tables.loot[0]: min is above max.',
    ]);
  });

  test('warnings: an attribute nothing uses (its own modifier aside), a rung no check reaches', () => {
    const s = fantasy();
    s.sheet.skills = s.sheet.skills.filter((k) => k.attribute !== 'WIS');
    s.modules = {}; // its combat settings notice with Perception, a WIS skill
    s.checks.formula = '2d6 + modifier';
    expect(validateSystem(s).warnings).toEqual([
      "Attribute WIS isn't used by any skill or formula.",
      'checks.ladder: "Very hard" (19) can never be reached; the check comes to at most 16.',
      'checks.ladder: "Nearly impossible" (22) can never be reached; the check comes to at most 16.',
    ]);
    // Read through mod() elsewhere, it is used.
    s.sheet.resources[0].max = '8 + mod(WIS)';
    expect(validateSystem(s).warnings[0]).toMatch(/^checks\.ladder/);
  });
});
