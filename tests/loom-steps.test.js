'use strict';

/**
 * Planning a step on a battle map (functions/loom-turn/steps.js; planning/
 * the-loom-movement-and-vision.md §3; L-613 / #443): how far a move goes on
 * the movement left, the plan it keeps, Continue, exits, and refusals. Pure;
 * the emulator suite (loom-battle-maps) plays the same through loomPlayTurn.
 *
 * Run: cd tests && npx jest loom-steps --verbose
 */

const { planStep, planOn, OUT_OF_MOVEMENT } = require('../functions/loom-turn/steps');

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
