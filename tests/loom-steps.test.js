'use strict';

/**
 * Planning a step on a battle map (functions/loom-turn/steps.js; planning/
 * the-loom-movement-and-vision.md §3; L-613 / #443): how far a move goes on
 * the movement left, the plan it keeps, Continue, exits, and refusals. Pure;
 * the emulator suite (loom-battle-maps) plays the same through loomPlayTurn.
 *
 * Run: cd tests && npx jest loom-steps --verbose
 */

const { planStep, planDoor, planOn, OUT_OF_MOVEMENT } = require('../functions/loom-turn/steps');

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
  turn: { n: 1, movementLeft: 6, actionUsed: false, plan: null, ...turn },
});

test('a move in reach arrives; at a feature it says so', () => {
  expect(planStep(WORLD, standing({ x: 2, y: 2 }), { cell: { x: 8, y: 1 } })).toEqual({
    cell: { x: 8, y: 1 },
    turn: { n: 1, movementLeft: 0, actionUsed: false, plan: null },
    lines: ["You're at the chest."],
  });
});

test('a move past reach stops partway; the rest is the plan', () => {
  const step = planStep(WORLD, standing({ x: 1, y: 5 }, { movementLeft: 2 }), {
    cell: { x: 9, y: 5 },
  });
  expect(step.cell).toEqual({ x: 3, y: 5 });
  expect(step.lines).toEqual([OUT_OF_MOVEMENT]);
  expect(step.turn).toMatchObject({ movementLeft: 0 });
  expect(step.turn.plan).toMatchObject({
    layer: 'battleMap',
    mapId: 'bm_room',
    to: { x: 9, y: 5 },
  });
  expect(step.turn.plan.path[0]).toEqual({ x: 4, y: 5, cost: 1 });
});

test('Continue walks the stored plan; a stale one is found afresh', () => {
  const first = planStep(WORLD, standing({ x: 1, y: 5 }, { movementLeft: 2 }), {
    cell: { x: 9, y: 5 },
  });
  const next = { ...standing(first.cell), turn: { ...first.turn, movementLeft: 6 } };
  expect(planStep(WORLD, next, { plan: true })).toMatchObject({
    cell: { x: 9, y: 5 },
    turn: { movementLeft: 0, plan: null },
  });
  // Standing elsewhere now: the stored path no longer starts here.
  const moved = { ...next, cell: { x: 5, y: 0 } };
  expect(planStep(WORLD, moved, { plan: true })).toMatchObject({
    cell: { x: 9, y: 5 },
    turn: { movementLeft: 1 },
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
  const step = planStep(WORLD, standing({ x: 1, y: 1 }, { movementLeft: 1, plan }), {
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
    turn: { n: 1, movementLeft: 3, actionUsed: false, plan: null },
  });
  // Heading past the door, one square at a time: never onto it (that would
  // leave), and the plan goes around it.
  const around = planStep(WORLD, standing({ x: 0, y: 4 }, { movementLeft: 1 }), {
    cell: { x: 0, y: 0 },
  });
  expect(around.cell).toEqual({ x: 1, y: 3 });
  expect(around.turn.plan.path.some((s) => s.x === 0 && s.y === 3)).toBe(false);
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

  test('a closed door on the way is opened (1), and the walk stops there', () => {
    const step = planStep(WALLED, standing({ x: 3, y: 2 }), { cell: { x: 8, y: 1 } });
    expect(step.cell).toEqual({ x: 4, y: 2 });
    expect(step.turn.movementLeft).toBe(4); // 1 to (4, 2), 1 to open the door
    expect(step.lines).toEqual(['You open the inner door.']);
    expect(step.opened).toEqual({ mapId: 'bm_room', doorId: 'inner' });
    expect(step.turn.plan.to).toEqual({ x: 8, y: 1 });
  });

  test('with the door open, Continue walks through it', () => {
    const first = planStep(WALLED, standing({ x: 3, y: 2 }), { cell: { x: 8, y: 1 } });
    const after = {
      ...standing(first.cell, { ...first.turn, movementLeft: 6 }),
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

    test('opens from either side, for 1 movement', () => {
      expect(planDoor(WALLED, at({ x: 4, y: 2 }), 'inner', true)).toEqual({
        cell: { x: 4, y: 2 },
        turn: { n: 1, movementLeft: 5, actionUsed: false, plan: null },
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
      ['out of movement', at({ x: 4, y: 2 }, null, { movementLeft: 0 }), true, OUT_OF_MOVEMENT],
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
  const used = {
    target: 'save',
    op: 'set-flag',
    path: 'turn',
    value: expect.objectContaining({ actionUsed: true }),
  };

  test('a tap opens it with its key, for 1 movement; without, it stays locked', () => {
    expect(planDoor(LOCKED(), beside(['A Brass Key']), 'inner', true)).toMatchObject({
      lines: ['You unlock the inner door with the brass key and open it.'],
      door: { state: 'open' },
      turn: { movementLeft: 5 },
    });
    expect(planDoor(LOCKED(), beside(['a lantern']), 'inner', true)).toEqual({
      refused: 'The inner door is locked.',
    });
  });

  test('typed with the key: unlocked and opened, no roll; it uses the action', () => {
    expect(attempt('unlock', beside(['brass key']), 1)).toEqual({
      outcome: 'success',
      mutations: [doorTo('open'), used],
      constraints: ['You unlock the inner door with the brass key and open it.'],
    });
  });

  test('picked or forced: a roll against the lock; a success unlocks it, either way the action is used', () => {
    expect(DEFAULT_LOCK_DIFFICULTY).toBe(15);
    expect(attempt('pick_lock', beside(), 15)).toEqual({
      outcome: 'success',
      mutations: [doorTo('closed'), used],
      constraints: ['The lock gives way: the inner door is unlocked.'],
    });
    expect(attempt('force', beside(), 14)).toEqual({
      outcome: 'failure',
      mutations: [used],
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
      mutations: [doorTo('open'), used],
      constraints: ['You open the inner door.'],
    });
    const open = beside([], { doors: { bm_room: { inner: 'open' } } });
    expect(attempt('close', open, 1)).toMatchObject({
      mutations: [doorTo('closed'), used],
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

  test('a second attempt in one turn is turned down', () => {
    const acted = beside([], { turn: { n: 1, movementLeft: 6, actionUsed: true, plan: null } });
    expect(attempt('pick_lock', acted, 20).constraints).toEqual([
      "You've acted this turn. End your turn first.",
    ]);
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
