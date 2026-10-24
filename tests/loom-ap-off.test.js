'use strict';

/**
 * AP off (planning/action-points.md §4.1; game systems MD9; L-838 / #692):
 * a system with `ap: false` plays without a pool. Steps on a grid are free,
 * each turn takes one action (anywhere, as before AP), End turn gives it
 * back, a long action takes a turn for each 10 of its AP, and in a fight
 * reactions count by the round (the combat module's `turn` rule). A system
 * with no `ap` still plays on the defaults. Pure, under each built-in copied
 * with `ap: false`: two systems that differ in kind (MD10).
 *
 * Run: cd tests && npx jest loom-ap-off.test --verbose
 */

const { BUILT_IN, validateSystem } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const apRules = require('../functions/loom-canon/ap');
const { planStep } = require('../functions/loom-turn/steps');
const { evaluate, ACTED } = require('../functions/loom-turn/adjudicate');
const { nextTurnState } = require('../functions/loom-models');
const reactions = require('../functions/loom-modules/combat/reactions');
const fight = require('../functions/loom-modules/combat/fight');

const copyOf = (v) => JSON.parse(JSON.stringify(v));
const high = (sides) => sides;

// A hall: mud down column 3, an altar to work at (a long action of 30 AP).
const HALL = {
  id: 'bm',
  name: 'The hall',
  width: 12,
  height: 6,
  entries: [{ id: 'in', x: 0, y: 2 }],
  exits: [{ id: 'out', name: 'the way out', x: 0, y: 5, to: 'out' }],
  features: [{ id: 'altar', name: 'the altar', x: 1, y: 1, long: { ap: 30 } }],
  obstacles: [{ id: 'mud', name: 'mud', kind: 'difficult', x: 3, y: 0, h: 6 }],
};

describe.each([
  ['d20-fantasy', BUILT_IN['d20-fantasy']],
  ['pool-scifi', BUILT_IN['pool-scifi']],
])('AP off, from %s', (id, built) => {
  // The built-in copied with AP off: its pool formula and costs dropped.
  const off = () => {
    const s = { ...copyOf(built), id: 'my-copy', ap: false };
    delete s.sheet.ap;
    // Prone's 10 AP fewer (fantasy) goes too.
    for (const c of s.sheet.conditions || []) if (c.modifiers) delete c.modifiers.ap;
    return s;
  };
  const worldOf = (system) => ({
    id: 'w',
    system,
    locations: { hall: { id: 'hall', name: 'The hall', battleMap: { mapId: 'bm' } } },
    battleMaps: { bm: HALL },
    characters: {},
  });
  const standing = (system, cell, turn = {}) => ({
    location: 'hall',
    mapId: 'bm',
    cell,
    character: { name: 'Tam', sheet: sheets.defaultSheet(system), inventory: [] },
    turn: { n: 1, ap: 20, kept: 0, plan: null, ...turn },
  });
  const turnOf = (r) => (r.mutations.find((m) => m.path === 'turn') || {}).value;
  const act = (system, save, verb = 'search', targets = []) =>
    evaluate({ verb, targets, params: {} }, {}, save, 15, worldOf(system));

  test('switched off with ap: false, saved; AP settings left on it are warned about', () => {
    const s = off();
    const clean = validateSystem(s);
    expect(clean.errors).toEqual([]);
    expect(clean.warnings).toEqual([]);
    expect(apRules.isOff(clean.system)).toBe(true);
    s.sheet.ap = '20';
    s.modules.combat.attacks[0].ap = 7;
    const warned = validateSystem(s);
    expect(warned.errors).toEqual([]);
    expect(warned.warnings).toEqual([
      'sheet.ap is kept but unused: AP is off (ap: false).',
      'modules.combat.attacks[0].ap is kept but unused: AP is off (ap: false).',
    ]);
    // The combat module's turn rule: read with AP off, warned about with it on.
    s.modules.combat.turn = { actions: 2, reactions: 1 };
    expect(validateSystem(s).errors).toEqual([]);
    const on = { ...copyOf(built), id: 'my-copy' };
    on.modules.combat.turn = { actions: 2 };
    expect(validateSystem(on).warnings).toEqual([
      'modules.combat.turn is read only with AP off (ap: false); it is kept, unused.',
    ]);
    on.modules.combat.turn = { actions: 0, sneezes: 1 };
    expect(validateSystem(on).errors).toEqual(
      expect.arrayContaining([
        'modules.combat.turn: "sneezes" isn\'t part of a turn (actions, reactions).',
        'modules.combat.turn.actions must be a whole number from 1 to 5.',
      ])
    );
  });

  test('a system with no ap block still plays on AP, by the defaults', () => {
    const s = copyOf(built);
    delete s.ap;
    expect(apRules.isOff(s)).toBe(false);
    const step = planStep(worldOf(s), standing(s, { x: 2, y: 2 }), { cell: { x: 4, y: 2 } });
    expect(step.turn.ap).toBe(17); // the mud's 2 and a square's 1
  });

  test('a walk across difficult ground goes in one go, spending nothing', () => {
    const s = off();
    const step = planStep(worldOf(s), standing(s, { x: 0, y: 2 }, { ap: 3 }), {
      cell: { x: 10, y: 2 },
    });
    expect(step.cell).toEqual({ x: 10, y: 2 });
    expect(step.turn).toMatchObject({ ap: 3, plan: null, moved: 10 });
    expect(step.lines).toEqual([]);
  });

  test('a turn takes one action; a second is refused, spending nothing', () => {
    const s = off();
    const first = act(s, standing(s, { x: 2, y: 2 }));
    expect(first.outcome).not.toBe('blocked');
    expect(turnOf(first)).toMatchObject({ acted: true, ap: 20 });
    const second = act(s, { ...standing(s, { x: 2, y: 2 }), turn: turnOf(first) });
    expect(second).toEqual({
      outcome: 'blocked',
      mutations: [],
      constraints: [ACTED],
      plain: true,
    });
    // Off the map too, as before AP.
    const town = { ...standing(s, null), mapId: null, cell: null, turn: turnOf(first) };
    expect(act(s, town).constraints).toEqual([ACTED]);
    // Looking is free.
    expect(turnOf(act(s, standing(s, { x: 2, y: 2 }), 'look'))).toBeUndefined();
  });

  test('End turn gives the action back', () => {
    const s = off();
    const acted = {
      ...standing(s, { x: 2, y: 2 }),
      turn: { n: 3, ap: 20, kept: 0, plan: null, acted: true },
    };
    const ended = evaluate({ verb: 'end-turn', targets: [], params: {} }, {}, acted, 4, worldOf(s));
    expect(turnOf(ended).acted).toBeUndefined();
    expect(turnOf(ended).n).toBe(4);
    expect(ended.constraints[0]).toBe('Turn 3 ends.');
  });

  test('a long action takes a turn for each 10 of its AP: three for the altar', () => {
    const s = off();
    const use = (save) => act(s, save, 'use', ['feature:altar']);
    let save = standing(s, { x: 2, y: 2 });
    const first = use(save);
    expect(first.constraints).toEqual([
      "You keep at it: 1 of 3 turns' work done. Carry on next turn.",
    ]);
    save = { ...save, turn: nextTurnState({ ...save, turn: turnOf(first) }) };
    expect(use(save).constraints).toEqual([
      "You keep at it: 2 of 3 turns' work done. Carry on next turn.",
    ]);
    save = { ...save, turn: nextTurnState({ ...save, turn: turnOf(use(save)) }) };
    const third = use(save);
    expect(third.constraints).toEqual(['You use the altar.']);
    expect(turnOf(third)).toMatchObject({ acted: true, long: null });
  });

  test('in a fight, reactions count by the round: one each, refreshed as a round starts', () => {
    const s = off();
    const tough = () => {
      const sheet = sheets.defaultSheet(s);
      for (const r of s.sheet.resources) sheet.resources[r.id] = { current: 500 };
      return sheet;
    };
    const started = fight.start(s, {
      id: 'f',
      mapId: 'bm',
      by: 'gm',
      combatants: [
        { id: 'player', kind: 'player', name: 'Tam', sheet: sheets.defaultSheet(s) },
        { id: 'a', kind: 'character', side: 'hostile', name: 'Ash', sheet: tough() },
        { id: 'b', kind: 'character', side: 'hostile', name: 'Bel', sheet: tough() },
      ],
      dice: () => 10,
    }).fight;
    expect(started.combatants.player.reactionsLeft).toBe(1);
    const player = { id: 'player', side: 'party', name: 'you', cell: { x: 5, y: 2 } };
    const stepAway = (f, foe) =>
      reactions.reactToWalk(s, {
        map: HALL,
        doors: {},
        fight: { ...f, round: 2 },
        mover: { id: foe, side: 'hostile', name: foe, sheet: tough() },
        from: { x: 6, y: 2 },
        path: [{ x: 7, y: 2 }],
        fighters: [{ ...player, sheet: sheets.defaultSheet(s) }],
        dice: high,
      });
    const first = stepAway(started, 'a');
    expect(first.struck).toEqual([expect.objectContaining({ by: 'player' })]);
    expect(first.fight.combatants.player.reactionsLeft).toBe(0);
    const second = stepAway(first.fight, 'b');
    expect(second.struck).toEqual([]);
    // A new round: one again.
    const on = fight.toPlayer(s, { ...second.fight, turn: 'player' }).fight;
    expect(on.combatants.player.reactionsLeft).toBe(1);
  });
});
