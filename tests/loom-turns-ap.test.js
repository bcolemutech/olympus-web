'use strict';

/**
 * Turns on action points (planning/action-points.md §4.3, §4.10; L-832 /
 * #682): a grid turn starts with the full pool; steps are priced by the cost
 * table (difficult ground double, a door its cost to open, the character's
 * traits counted); every action spends its cost, its own or the system's;
 * one the AP left won't pay for is refused, spending nothing; and a long
 * action is put in over several turns, interrupted by walking off or being
 * hurt. Pure, and by the two-configuration rule (MD2) under both built-in
 * systems; the emulator suite (loom-turns-ap-play) plays it through
 * loomPlayTurn.
 *
 * Run: cd tests && npx jest loom-turns-ap.test --verbose
 */

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const { planStep, planDoor } = require('../functions/loom-turn/steps');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { nextTurnState, turnStateOf } = require('../functions/loom-models');

const copyOf = (v) => JSON.parse(JSON.stringify(v));

// A hall, 10 by 6: a strip of mud (difficult) across column 3, a wall at
// x = 6 with a door in it at y 2–3, an altar beside the start, and an exit.
const HALL = {
  id: 'bm_hall',
  name: 'The hall',
  width: 10,
  height: 6,
  entries: [{ id: 'in', x: 0, y: 2 }],
  exits: [{ id: 'out', name: 'the way out', x: 0, y: 5, to: 'out' }],
  features: [{ id: 'altar', name: 'the altar', x: 1, y: 1, long: { ap: 50 } }],
  obstacles: [{ id: 'mud', name: 'mud', kind: 'difficult', x: 3, y: 0, h: 6 }],
  walls: [
    {
      points: [
        { x: 6, y: 0 },
        { x: 6, y: 2 },
      ],
    },
    {
      points: [
        { x: 6, y: 3 },
        { x: 6, y: 6 },
      ],
    },
  ],
  doors: [{ id: 'iron', name: 'the iron door', from: { x: 6, y: 2 }, to: { x: 6, y: 3 }, ap: 5 }],
};

describe.each([
  ['d20-fantasy', BUILT_IN['d20-fantasy']],
  ['pool-scifi', BUILT_IN['pool-scifi']],
])('turns on AP under %s', (id, built) => {
  const worldOf = (system = built) => ({
    id: 'w',
    system,
    locations: { hall: { id: 'hall', name: 'The hall', battleMap: { mapId: 'bm_hall' } } },
    battleMaps: { bm_hall: HALL },
    characters: {
      grell: {
        id: 'grell',
        name: 'Grell',
        locationId: 'hall',
        cell: { x: 2, y: 3 },
        sheet: sheets.defaultSheet(system),
      },
    },
  });
  const standing = (cell, turn = {}, system = built, traits = []) => {
    const sheet = sheets.defaultSheet(system, { traits });
    return {
      location: 'hall',
      mapId: 'bm_hall',
      cell,
      character: { name: 'Tam', sheet, inventory: [] },
      turn: { n: 1, ap: sheet.ap, kept: 0, plan: null, ...turn },
    };
  };
  const turnOf = (r) => (r.mutations.find((m) => m.path === 'turn') || {}).value;

  test('a turn starts with the full pool: 20 at the defaults', () => {
    const save = standing({ x: 2, y: 2 });
    expect(save.character.sheet.ap).toBe(20);
    expect(turnStateOf({ ...save, turn: undefined })).toEqual({
      n: 1,
      ap: 20,
      kept: 0,
      plan: null,
    });
    expect(nextTurnState({ ...save, turn: { n: 3, ap: 0, kept: 0, plan: null } }).ap).toBe(20);
  });

  test('difficult ground costs double; a trait that changes it is counted', () => {
    const world = worldOf();
    const across = planStep(world, standing({ x: 2, y: 2 }), { cell: { x: 4, y: 2 } });
    // One square of mud (2) and one of open ground (1).
    expect(across.turn).toMatchObject({ ap: 17, moved: 2 });
    const light = copyOf(built);
    light.sheet.optional = [...new Set([...(light.sheet.optional || []), 'traits'])];
    light.sheet.traits = [
      ...(light.sheet.traits || []),
      { id: 'light-footed', name: 'Light-footed', costs: { difficult: 1 } },
    ];
    const footed = planStep(worldOf(light), standing({ x: 2, y: 2 }, {}, light, ['light-footed']), {
      cell: { x: 4, y: 2 },
    });
    expect(footed.turn).toMatchObject({ ap: 18, moved: 2 });
  });

  test('a door on the way is opened for its own cost, and the walk stops there', () => {
    const step = planStep(worldOf(), standing({ x: 5, y: 2 }), { cell: { x: 8, y: 2 } });
    expect(step.lines).toEqual(['You open the iron door.']);
    expect(step.opened).toEqual({ mapId: 'bm_hall', doorId: 'iron' });
    expect(step.turn.ap).toBe(20 - 5);
    // By a tap too, its own cost.
    expect(planDoor(worldOf(), standing({ x: 5, y: 2 }), 'iron', true).turn.ap).toBe(15);
  });

  test('a walk stops where AP runs out, the rest kept as the plan', () => {
    const step = planStep(worldOf(), standing({ x: 0, y: 2 }, { ap: 4 }), { cell: { x: 5, y: 2 } });
    // Two squares (2), then the mud (2): the AP is gone at (3, 2).
    expect(step.cell).toEqual({ x: 3, y: 2 });
    expect(step.turn).toMatchObject({ ap: 0, plan: { to: { x: 5, y: 2 } } });
  });

  test('an attack costs 10, or the attack’s own; refused when short, spending nothing', () => {
    const attack = (world, save) =>
      evaluate({ verb: 'attack', targets: ['grell'], params: {} }, {}, save, 10, world);
    const struck = attack(worldOf(), standing({ x: 2, y: 2 }));
    expect(struck.outcome).not.toBe('blocked');
    expect(turnOf(struck).ap).toBe(10);
    // An attack with its own cost: 7.
    const quick = copyOf(built);
    quick.modules.combat.attacks[0].ap = 7;
    expect(turnOf(attack(worldOf(quick), standing({ x: 2, y: 2 }, {}, quick))).ap).toBe(13);
    // Short: refused with the cost and what's left, nothing spent.
    expect(attack(worldOf(), standing({ x: 2, y: 2 }, { ap: 6 }))).toEqual({
      outcome: 'blocked',
      mutations: [],
      constraints: ['An attack costs 10 AP; you have 6.'],
      plain: true,
    });
  });

  test('a few words cost 2; looking is free; a long action takes what the turn has', () => {
    const act = (verb, save, targets = []) =>
      evaluate({ verb, targets, params: {} }, {}, save, 10, worldOf());
    const greeted = act('greet', standing({ x: 2, y: 2 }), ['grell']);
    expect(turnOf(greeted).ap).toBe(18);
    const looked = act('look', standing({ x: 2, y: 2 }));
    expect(turnOf(looked)).toBeUndefined();
    const used = act('use', standing({ x: 2, y: 2 }), ['feature:altar']);
    // The altar is a long action: what this turn has goes in.
    expect(turnOf(used)).toMatchObject({ ap: 0, long: { put: 20, need: 50 } });
  });

  test('a long action is put in over three turns, then done', () => {
    const world = worldOf();
    const use = (save) =>
      evaluate({ verb: 'use', targets: ['feature:altar'], params: {} }, {}, save, 10, world);
    let save = standing({ x: 2, y: 2 });
    const first = use(save);
    expect(first.constraints).toEqual(['You keep at it: 20 of 50 AP put in. Carry on next turn.']);
    save = { ...save, turn: nextTurnState({ ...save, turn: turnOf(first) }) };
    const second = use(save);
    expect(second.constraints).toEqual(['You keep at it: 40 of 50 AP put in. Carry on next turn.']);
    save = { ...save, turn: nextTurnState({ ...save, turn: turnOf(second) }) };
    const third = use(save);
    expect(third.constraints).toEqual(['You use the altar.']);
    expect(turnOf(third)).toMatchObject({ n: 3, ap: 10, long: null });
  });

  test('a long action is interrupted by being hurt, and by walking off', () => {
    const world = worldOf();
    const long = { key: 'use feature:altar', name: 'working at the altar', put: 20, need: 50 };
    // Burning at the end of the turn: hurt, so the work stops.
    const sheet = { ...sheets.defaultSheet(built), conditions: [{ condition: 'burning' }] };
    const burning = {
      ...standing({ x: 2, y: 2 }, { ap: 0, long }),
      character: { name: 'Tam', sheet, inventory: [] },
    };
    const ended = evaluate({ verb: 'end-turn', targets: [], params: {} }, {}, burning, 4, world);
    expect(ended.constraints).toContain('Hurt, you stop working at the altar.');
    expect(turnOf(ended).long).toBeUndefined();
    // Unhurt, it carries into the next turn.
    const calm = standing({ x: 2, y: 2 }, { ap: 0, long });
    const carried = evaluate({ verb: 'end-turn', targets: [], params: {} }, {}, calm, 4, world);
    expect(turnOf(carried)).toMatchObject({ n: 2, ap: 20, long });
    // Walking off ends it.
    const walked = planStep(
      world,
      { ...calm, turn: { ...calm.turn, ap: 5 } },
      { cell: { x: 2, y: 1 } }
    );
    expect(walked.lines[0]).toBe('You stop working at the altar.');
  });
});
