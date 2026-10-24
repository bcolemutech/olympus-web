'use strict';

/**
 * Planning a step on a battle map (functions/loom-turn/steps.js; planning/
 * the-loom-movement-and-vision.md §3; L-613 / #443): how far a move goes on
 * the movement left, the plan it keeps, Continue, exits, and refusals. Pure;
 * the emulator suite (loom-battle-maps) plays the same through loomPlayTurn.
 *
 * Run: cd tests && npx jest loom-steps --verbose
 */

const { planStep, planDoor, planOn, OUT_OF_AP, UNSEEN } = require('../functions/loom-turn/steps');

const ROOM = {
  id: 'bm_room',
  name: 'A room',
  width: 10,
  height: 6,
  entries: [{ id: 'door', x: 0, y: 2 }],
  exits: [{ id: 'door', name: 'the door', x: 0, y: 3, to: 'out' }],
  features: [{ id: 'chest', name: 'the chest', x: 8, y: 1 }],
};
const WORLD = { battleMaps: { bm_room: ROOM } };
const standing = (cell, turn = {}) => ({
  mapId: 'bm_room',
  cell,
  character: { name: 'Tam', speed: 6 },
  turn: { n: 1, ap: 6, kept: 0, plan: null, ...turn },
});

test('a move in reach arrives; at a feature it says so; it lists the squares walked', () => {
  expect(planStep(WORLD, standing({ x: 2, y: 2 }), { cell: { x: 8, y: 1 } })).toEqual({
    cell: { x: 8, y: 1 },
    turn: { n: 1, ap: 0, kept: 0, plan: null, moved: 6 },
    lines: ["You're at the chest."],
    walked: [
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
      { x: 6, y: 1 },
      { x: 7, y: 1 },
      { x: 8, y: 1 },
    ],
  });
});

test('a move past reach lists only the squares walked this turn', () => {
  const step = planStep(WORLD, standing({ x: 1, y: 5 }, { ap: 2 }), {
    cell: { x: 9, y: 5 },
  });
  expect(step.walked).toEqual([
    { x: 2, y: 5 },
    { x: 3, y: 5 },
  ]);
});

test('a move past reach stops partway; the rest is the plan', () => {
  const step = planStep(WORLD, standing({ x: 1, y: 5 }, { ap: 2 }), {
    cell: { x: 9, y: 5 },
  });
  expect(step.cell).toEqual({ x: 3, y: 5 });
  expect(step.lines).toEqual([OUT_OF_AP]);
  expect(step.turn).toMatchObject({ ap: 0 });
  expect(step.turn.plan).toMatchObject({
    layer: 'battleMap',
    mapId: 'bm_room',
    to: { x: 9, y: 5 },
  });
  expect(step.turn.plan.path[0]).toEqual({ x: 4, y: 5, cost: 1 });
});

test('Continue walks the stored plan; a stale one is found afresh', () => {
  const first = planStep(WORLD, standing({ x: 1, y: 5 }, { ap: 2 }), {
    cell: { x: 9, y: 5 },
  });
  const next = { ...standing(first.cell), turn: { ...first.turn, ap: 6 } };
  expect(planStep(WORLD, next, { plan: true })).toMatchObject({
    cell: { x: 9, y: 5 },
    turn: { ap: 0, plan: null },
  });
  // Standing elsewhere now: the stored path no longer starts here.
  const moved = { ...next, cell: { x: 5, y: 0 } };
  expect(planStep(WORLD, moved, { plan: true })).toMatchObject({
    cell: { x: 9, y: 5 },
    turn: { ap: 1 },
  });
});

test('Continue follows the stored path, not one found afresh', () => {
  // A valid path, though not the one pathTo would choose (straight along row 1).
  const path = [
    { x: 2, y: 2, cost: 1 },
    { x: 3, y: 1, cost: 2 },
    { x: 4, y: 2, cost: 3 },
    { x: 5, y: 1, cost: 4 },
  ];
  const plan = { layer: 'battleMap', mapId: 'bm_room', to: { x: 5, y: 1 }, path };
  const step = planStep(WORLD, standing({ x: 1, y: 1 }, { ap: 1, plan }), {
    plan: true,
  });
  expect(step.cell).toEqual({ x: 2, y: 2 });
  expect(step.turn.plan.path[0]).toEqual({ x: 3, y: 1, cost: 1 });
});

test('a plan for another map is no plan', () => {
  const plan = { layer: 'battleMap', mapId: 'bm_elsewhere', to: { x: 3, y: 3 }, path: [] };
  const save = standing({ x: 1, y: 1 }, { plan });
  expect(planOn(save)).toBeNull();
  expect(planStep(WORLD, save, { plan: true })).toEqual({
    refused: 'You have no way planned. Tap where to go.',
  });
});

test('reaching an exit leaves by it; an exit is never on the way', () => {
  const step = planStep(WORLD, standing({ x: 3, y: 3 }), { cell: { x: 0, y: 3 } });
  expect(step).toEqual({
    exit: ROOM.exits[0],
    spent: 3,
    turn: { n: 1, ap: 3, kept: 0, plan: null, moved: 3 },
    // The squares walked to it, for the blows it draws in a fight (L-823).
    walked: [
      { x: 2, y: 3 },
      { x: 1, y: 3 },
      { x: 0, y: 3 },
    ],
  });
  // Heading past the door, one square at a time: never onto it (that would
  // leave), and the plan goes around it.
  const around = planStep(WORLD, standing({ x: 0, y: 4 }, { ap: 1 }), {
    cell: { x: 0, y: 0 },
  });
  expect(around.cell).toEqual({ x: 1, y: 3 });
  expect(around.turn.plan.path.some((s) => s.x === 0 && s.y === 3)).toBe(false);
});

describe('only on ground the save knows (L-635)', () => {
  // Every square of the room but those listed, as a save's known ground.
  const knownBut = (...hidden) => {
    const known = {};
    for (let x = 0; x < ROOM.width; x++) {
      for (let y = 0; y < ROOM.height; y++) known[x + ',' + y] = true;
    }
    hidden.forEach(([x, y]) => delete known[x + ',' + y]);
    return known;
  };
  const column5 = (...rows) => rows.map((y) => [5, y]);
  const across = { cell: { x: 8, y: 2 } };

  test('a square not seen is no destination: "You haven\'t seen that."', () => {
    expect(UNSEEN).toBe("You haven't seen that.");
    expect(
      planStep(WORLD, standing({ x: 2, y: 2 }), { cell: { x: 8, y: 1 } }, knownBut([8, 1]))
    ).toEqual({ refused: UNSEEN });
  });

  test('a path goes around ground not seen, never over it', () => {
    // Along row 2 is quickest, but column 5 is unknown down to row 4: the
    // way round is through (5, 5), the one known square in it.
    const open = planStep(WORLD, standing({ x: 2, y: 2 }), across);
    expect(open.walked).toContainEqual({ x: 5, y: 2 });
    const known = knownBut(...column5(0, 1, 2, 3, 4));
    const step = planStep(WORLD, standing({ x: 2, y: 2 }), across, known);
    expect(step.cell).toEqual({ x: 8, y: 2 });
    expect(step.walked).toContainEqual({ x: 5, y: 5 });
    expect(step.walked.every((s) => known[s.x + ',' + s.y])).toBe(true);
    expect(step.turn.ap).toBe(0); // round by (5, 5) is 6, as the straight way is
  });

  test('with no known way, there is no way', () => {
    const known = knownBut(...column5(0, 1, 2, 3, 4, 5));
    expect(planStep(WORLD, standing({ x: 2, y: 2 }), across, known)).toEqual({
      refused: "There's no way there from here.",
    });
  });

  test('Continue keeps to the known ground the plan was made on', () => {
    const known = knownBut(...column5(0, 1, 2, 3, 4));
    const first = planStep(WORLD, standing({ x: 2, y: 2 }, { ap: 2 }), across, known);
    const next = { ...standing(first.cell), turn: { ...first.turn, ap: 6 } };
    const step = planStep(WORLD, next, { plan: true }, known);
    expect(step.cell).toEqual({ x: 8, y: 2 });
    expect(step.walked).toContainEqual({ x: 5, y: 5 });
  });
});

describe('people on squares (L-642)', () => {
  // The room at the Ruin, a wall at x = 5 from the top down to y = 4: Old
  // Mags stands behind it at (7, 3), out of sight from the west side, and
  // Wim in the open at (3, 4).
  const PEOPLE = {
    locations: { poi_ruin: { id: 'poi_ruin', name: 'The Ruin', battleMap: { mapId: 'bm_room' } } },
    battleMaps: {
      bm_room: {
        ...ROOM,
        walls: [
          {
            points: [
              { x: 5, y: 0 },
              { x: 5, y: 4 },
            ],
          },
        ],
      },
    },
    characters: {
      chr_mags: { id: 'chr_mags', name: 'Old Mags', locationId: 'poi_ruin', cell: { x: 7, y: 3 } },
      chr_wim: { id: 'chr_wim', name: 'Wim', locationId: 'poi_ruin', cell: { x: 3, y: 4 } },
      chr_away: {
        id: 'chr_away',
        name: 'Elsewhere',
        locationId: 'poi_other',
        cell: { x: 2, y: 4 },
      },
    },
  };
  const at = (cell, turn) => ({ ...standing(cell, turn), location: 'poi_ruin' });

  test('a path passes through someone at the normal cost', () => {
    const step = planStep(PEOPLE, at({ x: 1, y: 4 }), { cell: { x: 4, y: 4 } });
    expect(step.cell).toEqual({ x: 4, y: 4 });
    expect(step.walked).toEqual([
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
    ]);
    expect(step.turn.ap).toBe(3);
  });

  test("a way to someone's square ends on the last free square before it, beside them", () => {
    const step = planStep(PEOPLE, at({ x: 0, y: 2 }), { cell: { x: 3, y: 4 } });
    expect(step.cell).toEqual({ x: 2, y: 3 });
    expect(step.turn.plan).toBeNull();
    expect(step.lines).toEqual(["You're beside Wim."]);
    expect(planStep(PEOPLE, at({ x: 2, y: 4 }), { cell: { x: 3, y: 4 } }).refused).toBe(
      "You're beside Wim."
    );
  });

  test("a walk whose movement runs out on someone's square backs off; the plan goes on", () => {
    const step = planStep(PEOPLE, at({ x: 1, y: 4 }, { ap: 2 }), {
      cell: { x: 4, y: 4 },
    });
    expect(step.cell).toEqual({ x: 2, y: 4 });
    expect(step.turn.ap).toBe(1);
    expect(step.turn.plan.path).toEqual([
      { x: 3, y: 4, cost: 1 },
      { x: 4, y: 4, cost: 2 },
    ]);
  });

  test('walking stops where someone comes into view, with a line and the plan kept', () => {
    // Round the end of the wall: Old Mags comes into view at (4, 4).
    const step = planStep(PEOPLE, at({ x: 3, y: 1 }, { ap: 20 }), {
      cell: { x: 8, y: 5 },
    });
    expect(step.cell).toEqual({ x: 4, y: 4 });
    expect(step.lines).toEqual(['You see Old Mags.']);
    expect(step.seenLines).toEqual(['You see Old Mags.']);
    expect(step.turn.ap).toBeGreaterThan(0);
    expect(step.turn.plan).toMatchObject({ to: { x: 8, y: 5 } });
    // Next turn, Continue goes on: she is in sight already, so nothing stops it.
    const on = planStep(
      PEOPLE,
      { ...at(step.cell), turn: { ...step.turn, ap: 6 } },
      { plan: true }
    );
    expect(on.cell).toEqual({ x: 8, y: 5 });
    expect(on.lines).toEqual([]);
  });

  test('beside a feature, the line says where they are', () => {
    const world = {
      ...PEOPLE,
      characters: { chr_mags: { ...PEOPLE.characters.chr_mags, cell: { x: 7, y: 2 } } },
    };
    const step = planStep(world, at({ x: 3, y: 1 }, { ap: 20 }), {
      cell: { x: 8, y: 5 },
    });
    expect(step.lines).toEqual(['Old Mags is at the chest.']);
  });

  test('someone at another place is no one here', () => {
    const step = planStep(PEOPLE, at({ x: 1, y: 4 }), { cell: { x: 2, y: 4 } });
    expect(step.cell).toEqual({ x: 2, y: 4 });
  });
});

test('refusals: no map, off it, already there', () => {
  expect(
    planStep(WORLD, { ...standing({ x: 1, y: 1 }), mapId: null }, { cell: { x: 2, y: 2 } })
  ).toEqual({ refused: "There's no map here to move on." });
  expect(planStep(WORLD, standing({ x: 1, y: 1 }), { cell: { x: 10, y: 2 } })).toEqual({
    refused: "That's off the map.",
  });
  expect(planStep(WORLD, standing({ x: 1, y: 1 }), { cell: { x: 1, y: 1 } })).toEqual({
    refused: "You're already there.",
  });
});

test('a map with no exits holds nobody: there is no moving on it', () => {
  const sealed = { battleMaps: { bm_room: { ...ROOM, exits: [] } } };
  expect(planStep(sealed, standing({ x: 1, y: 1 }), { cell: { x: 2, y: 2 } })).toEqual({
    refused: "There's no map here to move on.",
  });
});

describe('walls and doors (L-624)', () => {
  // The room again, split by a wall at x = 5 with a door in the gap at y 2–3.
  const WALLED = {
    battleMaps: {
      bm_room: {
        ...ROOM,
        walls: [
          {
            points: [
              { x: 5, y: 0 },
              { x: 5, y: 2 },
            ],
          },
          {
            points: [
              { x: 5, y: 3 },
              { x: 5, y: 6 },
            ],
          },
        ],
        doors: [{ id: 'inner', name: 'the inner door', from: { x: 5, y: 2 }, to: { x: 5, y: 3 } }],
      },
    },
  };

  test('a closed door on the way is opened (2 AP), and the walk stops there', () => {
    const step = planStep(WALLED, standing({ x: 3, y: 2 }), { cell: { x: 8, y: 1 } });
    expect(step.cell).toEqual({ x: 4, y: 2 });
    expect(step.turn.ap).toBe(3); // 1 to (4, 2), 2 to open the door (L-832)
    expect(step.lines).toEqual(['You open the inner door.']);
    expect(step.opened).toEqual({ mapId: 'bm_room', doorId: 'inner' });
    expect(step.turn.plan.to).toEqual({ x: 8, y: 1 });
  });

  test('with the door open, Continue walks through it', () => {
    const first = planStep(WALLED, standing({ x: 3, y: 2 }), { cell: { x: 8, y: 1 } });
    const after = {
      ...standing(first.cell, { ...first.turn, ap: 6 }),
      doors: { bm_room: { inner: 'open' } },
    };
    const next = planStep(WALLED, after, { plan: true });
    expect(next.cell).toEqual({ x: 8, y: 1 });
    expect(next.opened).toBeUndefined();
  });

  test('a locked door is no way through', () => {
    const locked = { ...standing({ x: 3, y: 2 }), doors: { bm_room: { inner: 'locked' } } };
    expect(planStep(WALLED, locked, { cell: { x: 8, y: 1 } })).toEqual({
      refused: "There's no way there from here.",
    });
  });

  describe('a door beside you, by a tap (L-625)', () => {
    const at = (cell, doors, turn) => ({
      ...standing(cell, turn),
      ...(doors ? { doors: { bm_room: doors } } : {}),
    });

    test('opens from either side, for its cost: 2 AP (L-832)', () => {
      expect(planDoor(WALLED, at({ x: 4, y: 2 }), 'inner', true)).toEqual({
        cell: { x: 4, y: 2 },
        turn: { n: 1, ap: 4, kept: 0, plan: null },
        lines: ['You open the inner door.'],
        door: { mapId: 'bm_room', doorId: 'inner', state: 'open' },
      });
      expect(planDoor(WALLED, at({ x: 5, y: 2 }), 'inner', true).door.state).toBe('open');
    });

    test('closes an open one', () => {
      expect(planDoor(WALLED, at({ x: 4, y: 2 }, { inner: 'open' }), 'inner', false)).toMatchObject(
        {
          lines: ['You close the inner door.'],
          door: { state: 'closed' },
        }
      );
    });

    test.each([
      ['from across the room', at({ x: 2, y: 2 }), true, 'You need to be beside the inner door.'],
      [
        'already open',
        at({ x: 4, y: 2 }, { inner: 'open' }),
        true,
        'The inner door is already open.',
      ],
      ['already shut', at({ x: 4, y: 2 }), false, 'The inner door is already shut.'],
      ['locked', at({ x: 4, y: 2 }, { inner: 'locked' }), true, 'The inner door is locked.'],
      [
        'short of AP',
        at({ x: 4, y: 2 }, null, { ap: 1 }),
        true,
        'Opening the inner door costs 2 AP; you have 1.',
      ],
    ])('is refused %s', (_label, save, open, line) => {
      expect(planDoor(WALLED, save, 'inner', open)).toEqual({ refused: line });
    });

    test('no such door, or no map', () => {
      expect(planDoor(WALLED, at({ x: 4, y: 2 }), 'vault', true)).toEqual({
        refused: "There's no such door here.",
      });
      expect(planDoor(WALLED, { ...at({ x: 4, y: 2 }), mapId: null }, 'inner', true)).toEqual({
        refused: "There's no map here to move on.",
      });
    });
  });
});

describe('locked doors: keys, and picking or forcing (L-626)', () => {
  const { evaluate, DEFAULT_LOCK_DIFFICULTY } = require('../functions/loom-turn/adjudicate');
  const { buildKnownEntities } = require('../functions/loom-turn/interpret');
  // The room once more: the inner door at x = 5, y 2–3, locked, its key the
  // brass key.
  const LOCKED = (door = {}) => ({
    battleMaps: {
      bm_room: {
        ...ROOM,
        walls: [
          {
            points: [
              { x: 5, y: 0 },
              { x: 5, y: 2 },
            ],
          },
          {
            points: [
              { x: 5, y: 3 },
              { x: 5, y: 6 },
            ],
          },
        ],
        doors: [
          {
            id: 'inner',
            name: 'the inner door',
            from: { x: 5, y: 2 },
            to: { x: 5, y: 3 },
            locked: true,
            key: 'the brass key',
            ...door,
          },
        ],
      },
    },
  });
  const beside = (inventory = [], extra = {}) => ({
    ...standing({ x: 4, y: 2 }),
    character: { name: 'Tam', speed: 6, inventory },
    ...extra,
  });
  const attempt = (verb, save, dice, world = LOCKED()) =>
    evaluate({ verb, targets: ['door:inner'], params: {} }, {}, save, dice, world);
  const doorTo = (value) => ({
    target: 'save',
    op: 'set-flag',
    path: 'doors.bm_room.inner',
    value,
  });
  // The turn with the AP an action cost spent (L-832): a door 2, a lock 5.
  const used = (left) => ({
    target: 'save',
    op: 'set-flag',
    path: 'turn',
    value: expect.objectContaining({ ap: left }),
  });

  test('a tap opens it with its key, for its cost; without, it stays locked', () => {
    expect(planDoor(LOCKED(), beside(['A Brass Key']), 'inner', true)).toMatchObject({
      lines: ['You unlock the inner door with the brass key and open it.'],
      door: { state: 'open' },
      turn: { ap: 4 },
    });
    expect(planDoor(LOCKED(), beside(['a lantern']), 'inner', true)).toEqual({
      refused: 'The inner door is locked.',
    });
  });

  test('typed with the key: unlocked and opened, no roll; it costs the door’s 2 AP', () => {
    expect(attempt('unlock', beside(['brass key']), 1)).toEqual({
      outcome: 'success',
      mutations: [doorTo('open'), used(4)],
      constraints: ['You unlock the inner door with the brass key and open it.'],
    });
  });

  test('picked or forced: a roll against the lock; a success unlocks it, either way it costs 5 AP', () => {
    expect(DEFAULT_LOCK_DIFFICULTY).toBe(15);
    const lock = { die: 20, difficulty: 15, against: 'the lock on the inner door' };
    expect(attempt('pick_lock', beside(), 15)).toEqual({
      outcome: 'success',
      // For the panel's roll card (L-726), with the check (L-803): the
      // lock's 15, named by the fantasy system's nearest rung, Hard (16);
      // reaching it exactly is a success at a cost (L-804).
      roll: expect.objectContaining({
        ...lock,
        value: 15,
        success: true,
        rung: 'Hard',
        degree: 'successAtCost',
      }),
      mutations: [doorTo('closed'), used(1)],
      constraints: ['The lock gives way: the inner door is unlocked.'],
    });
    expect(attempt('force', beside(), 14)).toEqual({
      outcome: 'failure',
      roll: expect.objectContaining({ ...lock, value: 14, success: false, degree: 'failure' }),
      mutations: [used(1)],
      constraints: ['The lock on the inner door holds.'],
    });
    // The lock's own difficulty, when it has one.
    expect(attempt('pick_lock', beside(), 5, LOCKED({ difficulty: 5 })).outcome).toBe('success');
    expect(attempt('pick_lock', beside(), 19, LOCKED({ difficulty: 20 })).outcome).toBe('failure');
  });

  test('unlocked in this save only: another still finds it locked', () => {
    const unlocked = beside([], { doors: { bm_room: { inner: 'closed' } } });
    expect(attempt('pick_lock', unlocked, 20)).toEqual({
      outcome: 'no_op',
      mutations: [],
      constraints: ["The inner door isn't locked."],
    });
    expect(attempt('pick_lock', beside(), 1).outcome).toBe('failure');
  });

  test('typed open and close of an unlocked door', () => {
    const unlocked = beside([], { doors: { bm_room: { inner: 'closed' } } });
    expect(attempt('open', unlocked, 1)).toMatchObject({
      outcome: 'success',
      mutations: [doorTo('open'), used(4)],
      constraints: ['You open the inner door.'],
    });
    const open = beside([], { doors: { bm_room: { inner: 'open' } } });
    expect(attempt('close', open, 1)).toMatchObject({
      mutations: [doorTo('closed'), used(4)],
      constraints: ['You close the inner door.'],
    });
  });

  test('not beside it, or no such door: turned down, and the action is not used', () => {
    expect(attempt('pick_lock', { ...beside(), cell: { x: 1, y: 1 } }, 20)).toEqual({
      outcome: 'blocked',
      mutations: [],
      constraints: ['You need to be beside the inner door.'],
    });
    expect(
      evaluate(
        { verb: 'pick_lock', targets: ['door:vault'], params: {} },
        {},
        beside(),
        20,
        LOCKED()
      )
    ).toMatchObject({ outcome: 'invalid_target', mutations: [] });
  });

  test('an attempt the AP left won’t pay for is turned down, spending nothing (L-832)', () => {
    const spent = beside([], { turn: { n: 1, ap: 4, kept: 0, plan: null } });
    expect(attempt('pick_lock', spent, 20)).toEqual({
      outcome: 'blocked',
      mutations: [],
      constraints: ['Picking the lock costs 5 AP; you have 4.'],
      plain: true,
    });
  });

  test('a hard lock as a long action: put in over three turns, then rolled (CT4)', () => {
    const { nextTurnState } = require('../functions/loom-models');
    const world = LOCKED({ long: { ap: 15 } });
    let save = beside();
    const turnOf = (r) => r.mutations.find((m) => m.path === 'turn').value;
    const first = attempt('pick_lock', save, 20, world);
    expect(first.constraints).toEqual(['You keep at it: 6 of 15 AP put in. Carry on next turn.']);
    expect(first.roll).toBeUndefined();
    save = { ...save, turn: nextTurnState({ ...save, turn: turnOf(first) }) };
    expect(save.turn.long).toMatchObject({ put: 6, need: 15 });
    const second = attempt('pick_lock', save, 20, world);
    expect(second.constraints).toEqual(['You keep at it: 12 of 15 AP put in. Carry on next turn.']);
    save = { ...save, turn: nextTurnState({ ...save, turn: turnOf(second) }) };
    // The third turn puts in the last 3 and the lock is rolled.
    const third = attempt('pick_lock', save, 20, world);
    expect(third.constraints).toEqual(['The lock gives way: the inner door is unlocked.']);
    expect(turnOf(third)).toMatchObject({ ap: 3, long: null });
  });

  test('a long action is dropped by starting another, or by walking off (CT4)', () => {
    const world = LOCKED({ long: { ap: 15 } });
    const long = { key: 'pick_lock door:inner', name: 'picking the lock', put: 6, need: 15 };
    const working = beside([], { turn: { n: 2, ap: 6, kept: 0, plan: null, long } });
    const shouted = evaluate({ verb: 'shout', targets: [], params: {} }, {}, working, 20, world);
    expect(shouted.constraints[0]).toBe('You stop picking the lock.');
    expect(shouted.mutations.find((m) => m.path === 'turn').value).toMatchObject({ long: null });
    const walked = planStep(world, working, { cell: { x: 2, y: 2 } });
    expect(walked.lines[0]).toBe('You stop picking the lock.');
    expect(walked.turn.long).toBeNull();
  });

  test('the interpreter knows the doors as targets', () => {
    expect(
      buildKnownEntities({ ...LOCKED(), locations: {}, factions: {}, characters: {} }, beside())
    ).toContainEqual({
      id: 'door:inner',
      name: 'the inner door',
      kind: 'door here',
    });
  });
});
