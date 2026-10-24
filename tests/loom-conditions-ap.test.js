'use strict';

/**
 * Conditions on AP (planning/action-points.md §3 EF1, §4.5; L-834 / #684):
 * a condition changes the pool (`modifiers.ap`: Slowed's −10), sets it
 * (`ap: 0`: Stunned), or changes prices (`costs`: Prone doubles moving;
 * 'never': Restrained can't move); standing up ends Prone for its 5 AP; a
 * world's conditions with the flags from before AP (noAction, noMove) are
 * converted, with a warning; the narrator and the Character panel say what
 * each does to AP. Pure, under both built-in systems (MD2).
 *
 * Run: cd tests && npx jest loom-conditions-ap.test --verbose
 */

const { BUILT_IN, validateSystem } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const effects = require('../functions/loom-canon/effects');
const conditions = require('../functions/loom-canon/conditions');
const { planStep } = require('../functions/loom-turn/steps');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { nextTurnState } = require('../functions/loom-models');

const copyOf = (v) => JSON.parse(JSON.stringify(v));

const HALL = {
  id: 'bm',
  name: 'The hall',
  width: 12,
  height: 5,
  entries: [{ id: 'in', x: 0, y: 2 }],
  exits: [{ id: 'out', name: 'the way out', x: 0, y: 4, to: 'out' }],
  features: [],
};

describe.each([
  ['d20-fantasy', BUILT_IN['d20-fantasy'], 'restrained'],
  ['pool-scifi', BUILT_IN['pool-scifi'], 'pinned'],
])('conditions on AP under %s', (id, system, held) => {
  const world = {
    id: 'w',
    system,
    locations: { hall: { id: 'hall', name: 'The hall', battleMap: { mapId: 'bm' } } },
    battleMaps: { bm: HALL },
    characters: {},
  };
  const withCondition = (condition, duration = { turns: 1 }) =>
    effects.apply(system, sheets.defaultSheet(system), { condition, duration }).sheet;
  const standing = (sheet, turn = {}) => ({
    location: 'hall',
    mapId: 'bm',
    cell: { x: 2, y: 2 },
    character: { name: 'Tam', sheet: { ...sheet, ap: sheets.apFor(system, sheet) }, inventory: [] },
    turn: { n: 1, ap: sheets.apFor(system, sheet), kept: 0, plan: null, ...turn },
  });
  const turnOf = (r) => (r.mutations.find((m) => m.path === 'turn') || {}).value;

  test('the built-ins’ conditions are on AP, with no flags left', () => {
    expect(validateSystem(system)).toMatchObject({ errors: [], warnings: [] });
    for (const c of system.sheet.conditions) {
      expect(c).not.toHaveProperty('noAction');
      expect(c).not.toHaveProperty('noMove');
    }
    expect(conditions.conditionOf(system, 'stunned')).toMatchObject({ ap: 0 });
    expect(conditions.conditionOf(system, 'prone')).toMatchObject({ standUp: true });
  });

  test('a stunned character has 0 AP for its duration: no moving, no acting', () => {
    const stunned = withCondition('stunned', { turns: 1 });
    expect(sheets.apFor(system, stunned)).toBe(0);
    const save = standing(stunned);
    expect(nextTurnState(save).ap).toBe(0);
    expect(planStep(world, save, { cell: { x: 4, y: 2 } })).toEqual({
      refused: "You can't move: you're Stunned.",
    });
    expect(
      evaluate({ verb: 'search', targets: [], params: {} }, {}, save, 10, world)
    ).toMatchObject({ outcome: 'blocked', constraints: ["You can't act: you're Stunned."] });
    // Its turn over, it's gone, and the pool is full again.
    const after = effects.endOfTurn(system, stunned, { now: 0, dice: () => 1 }).sheet;
    expect(sheets.apFor(system, after)).toBe(20);
  });

  test('Slowed lowers the pool by 10', () => {
    expect(sheets.apFor(system, withCondition('slowed'))).toBe(10);
  });

  test('Prone doubles a walk’s cost; standing up costs its 5 and ends it', () => {
    const prone = withCondition('prone', { turns: 5 });
    const walk = planStep(world, standing(prone), { cell: { x: 5, y: 2 } });
    expect(walk.turn).toMatchObject({ ap: 20 - 3 * 2, moved: 3 });
    const stood = evaluate(
      { verb: 'stand', targets: [], params: {} },
      {},
      standing(prone),
      10,
      world
    );
    expect(stood.constraints).toEqual(['You stand up.']);
    expect(turnOf(stood).ap).toBe(15);
    const sheet = stood.mutations.find((m) => m.path === 'character.sheet').value;
    expect(sheet.conditions).toEqual([]);
    // On your feet, the walk is as ever, and there is nothing to stand up from.
    const up = standing(sheet);
    expect(planStep(world, up, { cell: { x: 5, y: 2 } }).turn.ap).toBe(17);
    expect(evaluate({ verb: 'stand', targets: [], params: {} }, {}, up, 10, world)).toMatchObject({
      outcome: 'blocked',
      constraints: ["You're already on your feet."],
    });
  });

  test('a condition that stops moving (cost "never") leaves acting', () => {
    const save = standing(withCondition(held));
    const name = conditions.conditionOf(system, held).name;
    expect(planStep(world, save, { cell: { x: 4, y: 2 } })).toEqual({
      refused: `You can't move: you're ${name}.`,
    });
    const acted = evaluate({ verb: 'search', targets: [], params: {} }, {}, save, 10, world);
    expect(acted.outcome).not.toBe('blocked');
  });

  test('what each does to AP, for the GM and the Character panel', () => {
    expect(conditions.apNoteOf(conditions.conditionOf(system, 'stunned'))).toBe('0 AP');
    expect(conditions.apNoteOf(conditions.conditionOf(system, 'slowed'))).toBe('−10 AP');
    expect(conditions.apNoteOf(conditions.conditionOf(system, 'prone'))).toBe(
      'moving costs ×2, ended by standing up'
    );
    expect(conditions.apNoteOf(conditions.conditionOf(system, held))).toBe("can't move");
    const view = sheets.characterView(system, { name: 'Tam', sheet: withCondition('prone') }, 0);
    expect(view.conditions[0]).toMatchObject({
      id: 'prone',
      ap: 'moving costs ×2, ended by standing up',
    });
  });

  test('a world’s conditions with noAction and noMove are converted, with a warning', () => {
    const old = { ...copyOf(system), id: 'my-copy' };
    const n = old.sheet.conditions.length;
    old.sheet.conditions.push(
      { id: 'frozen', name: 'Frozen', noAction: true, noMove: true },
      { id: 'snared', name: 'Snared', noMove: true }
    );
    const { errors, warnings, system: saved } = validateSystem(old);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      `sheet.conditions[${n}] (frozen): noAction is now ap: 0 (no AP while it lasts) (L-834).`,
      `sheet.conditions[${n + 1}] (snared): noMove is now costs { move: 'never', difficult: 'never' } (L-834).`,
    ]);
    expect(saved.sheet.conditions[n]).toEqual({ id: 'frozen', name: 'Frozen', ap: 0 });
    expect(saved.sheet.conditions[n + 1]).toEqual({
      id: 'snared',
      name: 'Snared',
      costs: { move: 'never', difficult: 'never' },
    });
    // And they still stop what they stopped.
    const frozen = { conditions: [{ condition: 'frozen' }] };
    expect(conditions.flagsOf(saved, frozen)).toEqual({
      noAction: ['Frozen'],
      noMove: ['Frozen'],
    });
  });

  test('a condition’s own pool is checked on save', () => {
    const bad = { ...copyOf(system), id: 'my-copy' };
    bad.sheet.conditions = [{ id: 'odd', name: 'Odd', ap: -1, standUp: 'yes' }];
    expect(validateSystem(bad).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('sheet.conditions[0].ap must be a whole number from 0'),
        'sheet.conditions[0].standUp must be true or false.',
      ])
    );
  });
});
