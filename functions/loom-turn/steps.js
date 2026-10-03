'use strict';

const gridPaths = require('../loom-canon/grid-paths');
const maps = require('../loom-canon/maps');
const { turnStateOf } = require('../loom-models');

/**
 * Moving without the GM (planning/the-loom-movement-and-vision.md §3;
 * L-613 / #443): a move on a battle map, to a square or along the plan, is
 * worked out by the rules alone. The save walks the cheapest path as far as
 * its movement allows (grid-paths.js), and the rest of the path becomes its
 * plan, which `continue` picks up next turn. Nothing is narrated: a step
 * answers with plain lines, and isn't written to the turn history.
 *
 * A path that reaches an exit leaves by it, as before, and that is narrated
 * (the caller runs the rest of the pipeline). Paths never cross an exit on
 * the way somewhere else, since stepping onto one leaves.
 *
 * Pure: planStep reads a save and the canon world and says what the step
 * does; the caller writes it inside a transaction, so two moves at once
 * can't spend the same movement.
 */

const OUT_OF_MOVEMENT = "You're out of movement. End your turn to go on.";

/** The save's plan, if it is a path on the battle map it stands on now. */
function planOn(save) {
  const plan = turnStateOf(save).plan;
  return plan && plan.layer === 'battleMap' && plan.mapId === save.mapId ? plan : null;
}

// A plan's path is walked as it is, if it still starts next to where the save
// stands and keeps to the grid; otherwise the path is found afresh.
function storedPath(map, from, plan, cost) {
  const path = Array.isArray(plan.path) ? plan.path : [];
  let at = from;
  let total = 0;
  for (const step of path) {
    const near = Math.max(Math.abs(step.x - at.x), Math.abs(step.y - at.y)) === 1;
    const price = maps.inBounds(map, step) && near ? cost(at, step) : Infinity;
    if (price === Infinity) return null;
    total += price;
    if (step.cost !== total) return null;
    at = step;
  }
  return path.length && maps.sameCell(at, plan.to) ? { path, cost: total } : null;
}

/**
 * What a move on a battle map does, for a save as it stands now:
 *   { refused: line }                          — nothing happens
 *   { exit, spent, turn }                      — it reaches an exit and leaves by it
 *   { cell, turn, lines }                      — a quiet step (or none: out of movement)
 * `target` is { cell } (a square) or { plan: true } (walk the plan). `turn` is
 * the save's turn after the move: movement spent, the plan set or cleared.
 */
function planStep(canonWorld, save, target) {
  const { map, cell: from } = maps.positionOf(canonWorld, save);
  if (!map || !(map.exits || []).length) return { refused: "There's no map here to move on." };
  const turn = turnStateOf(save);

  let plan = null;
  let to = target.cell;
  if (target.plan) {
    plan = planOn(save);
    if (!plan) return { refused: 'You have no way planned. Tap where to go.' };
    to = plan.to;
  }
  if (!maps.inBounds(map, to)) return { refused: "That's off the map." };
  if (maps.sameCell(to, from)) {
    // Standing on an exit (a map whose entry is its way out): leave by it.
    const { exit } = maps.at(map, to);
    if (exit) return { exit, spent: 0, turn: { ...turn, plan: null } };
    return { refused: "You're already there." };
  }

  // An exit is only stepped on to leave by it: it's never on the way.
  const options = { avoid: map.exits || [] };
  const cost = (step, next) => (!maps.sameCell(next, to) && maps.at(map, next).exit ? Infinity : 1);
  const found =
    (plan && storedPath(map, from, plan, cost)) ||
    gridPaths.pathTo(map, from, { x: to.x, y: to.y }, options);
  if (!found) return { refused: "There's no way there from here." };

  const { walked, spent, rest } = gridPaths.walk(found.path, turn.movementLeft);
  const movementLeft = turn.movementLeft - spent;
  if (!rest.length) {
    const { exit, feature } = maps.at(map, to);
    if (exit) return { exit, spent, turn: { ...turn, movementLeft, plan: null } };
    return {
      cell: { x: to.x, y: to.y },
      turn: { ...turn, movementLeft, plan: null },
      lines: feature ? ["You're at " + feature.name + '.'] : [],
    };
  }
  const stop = walked.length ? walked[walked.length - 1] : from;
  return {
    cell: { x: stop.x, y: stop.y },
    turn: {
      ...turn,
      movementLeft,
      plan: { layer: 'battleMap', mapId: map.id, to: { x: to.x, y: to.y }, path: rest },
    },
    lines: [OUT_OF_MOVEMENT],
  };
}

module.exports = { planStep, planOn, OUT_OF_MOVEMENT };
