'use strict';

const gridPaths = require('../loom-canon/grid-paths');
const maps = require('../loom-canon/maps');
const layers = require('../loom-canon/layers');
const sight = require('../loom-canon/sight');
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
 * Paths go around the map's walls, locked doors and obstacles, and pay 2
 * for difficult ground (L-624 / #449; layers.pathOptions). A closed door on
 * the way is opened (1 movement) and the walk stops there, the rest kept as
 * the plan, so the player sees what's beyond before going on; the save
 * remembers the door open (`save.doors[mapId][doorId]`).
 *
 * Only ground the save knows is walked (planning/the-loom-movement-and-
 * vision.md §5; L-635 / #458): what it has seen there, and what is in sight
 * now (./seen.js knownTo). A move must be to a square it has seen ("You
 * haven't seen that."), and its path treats unseen squares as blocked, so it
 * never gives away a hidden wall: it goes around, or there's no way.
 *
 * A door beside the player (on either side of it) opens or closes with a tap
 * (planDoor; L-625 / #450), for 1 movement; a locked one opens only with its
 * key in the character's inventory (L-626 / #451).
 *
 * People standing on squares (planning/the-loom-movement-and-vision.md §6;
 * L-642 / #461) are walked through at the normal cost, but a move never
 * ends on one: a path to someone's square stops on the last free square
 * before it (beside them), and a walk whose movement runs out on someone
 * backs off to the last free square. A walk stops on the square where
 * someone comes into view who wasn't in sight where it started, with a
 * plain line ("Old Mags is at the bar.") and the rest kept as the plan.
 *
 * Pure: planStep reads a save and the canon world and says what the step
 * does; the caller writes it inside a transaction, so two moves at once
 * can't spend the same movement.
 */

const OUT_OF_MOVEMENT = "You're out of movement. End your turn to go on.";
const UNSEEN = "You haven't seen that.";

/** The states of a save's doors on a map, by door id (none: as the map has them). */
function doorStatesOf(save, mapId) {
  return ((save && save.doors) || {})[mapId] || {};
}

const key = (cell) => cell.x + ',' + cell.y;
const besideOf = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;

/** The line for someone who comes into view (L-642): at a feature beside them, or just seen. */
function inViewLine(map, person) {
  const feature = (map.features || []).find(
    (f) => maps.sameCell(f, person.cell) || besideOf(f, person.cell)
  );
  return feature ? person.name + ' is at ' + feature.name + '.' : 'You see ' + person.name + '.';
}

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
 *   { cell, turn, lines, walked }              — a quiet step (or none: out of movement)
 * `target` is { cell } (a square) or { plan: true } (walk the plan). `turn` is
 * the save's turn after the move: movement spent, the plan set or cleared.
 * `walked` lists the squares stepped on, in order, for what is seen on the
 * way (./seen.js; L-632). `known` is the squares the save knows, keyed "x,y"
 * (L-635): only those are headed for or walked over. Without it, every
 * square is (for the rules alone, as in tests).
 */
function planStep(canonWorld, save, target, known) {
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
  const seen = (cell) => !known || Boolean(known[cell.x + ',' + cell.y]);
  if (!seen(to)) return { refused: UNSEEN };
  if (maps.sameCell(to, from)) {
    // Standing on an exit (a map whose entry is its way out): leave by it.
    const { exit } = maps.at(map, to);
    if (exit) return { exit, spent: 0, turn: { ...turn, plan: null } };
    return { refused: "You're already there." };
  }

  // The map's rules (layers.js), for this save's doors, on the ground it
  // knows. An exit is only stepped on to leave by it: it's never on the way.
  const rules = layers.pathOptions(map, doorStatesOf(save, map.id));
  const options = known
    ? { ...rules, cost: (step, next) => (seen(next) ? rules.cost(step, next) : Infinity) }
    : rules;
  const cost = (step, next) =>
    !maps.sameCell(next, to) && maps.at(map, next).exit ? Infinity : options.cost(step, next);
  const found =
    (plan && storedPath(map, from, plan, cost)) ||
    gridPaths.pathTo(map, from, { x: to.x, y: to.y }, options);
  if (!found) return { refused: "There's no way there from here." };

  // People here (L-642): walked through, never stopped on. A way to
  // someone's square ends on the last free square before it.
  const people = maps.standingAt(canonWorld, maps.hostOf(canonWorld, save));
  const personAt = (cell) => people.find((p) => maps.sameCell(p.cell, cell)) || null;
  const meeting = personAt(to);
  let path = found.path;
  if (meeting) {
    while (path.length && personAt(path[path.length - 1])) path = path.slice(0, -1);
    if (!path.length) {
      return {
        refused: besideOf(from, to)
          ? "You're beside " + meeting.name + '.'
          : "There's no room to stop there.",
      };
    }
    to = path[path.length - 1];
  }

  // Someone not in sight where the walk starts stops it where they come
  // into view (with the doors as they were; L-642).
  const doors = doorStatesOf(save, map.id);
  const atStart = sight.inSight(map, from, doors);
  const unseen = people.filter((p) => !atStart[key(p.cell)]);
  const cameIntoView = (cell, states) => {
    if (!unseen.length) return [];
    const now = sight.inSight(map, cell, states);
    return unseen.filter((p) => now[key(p.cell)]);
  };
  const { walked, spent, rest, opened } = gridPaths.walk(path, turn.movementLeft, {
    stop: (step) => cameIntoView(step, doors).length > 0,
    stand: (step) => !personAt(step),
  });
  const movementLeft = turn.movementLeft - spent;
  const squares = walked.map((step) => ({ x: step.x, y: step.y }));
  const door = opened ? (map.doors || []).find((d) => d.id === opened) : null;
  const stop = walked.length ? walked[walked.length - 1] : from;
  // Who came into view: on the way, or from where it ends, through a door
  // just opened.
  const sighted = unseen.filter((p) =>
    [{ cell: stop, states: door ? { ...doors, [door.id]: 'open' } : doors }]
      .concat(squares.map((cell) => ({ cell, states: doors })))
      .some(({ cell, states }) => cameIntoView(cell, states).includes(p))
  );
  const seenLines = sighted.map((p) => inViewLine(map, p));
  if (!rest.length) {
    const { exit, feature } = maps.at(map, to);
    if (exit) return { exit, spent, turn: { ...turn, movementLeft, plan: null } };
    return {
      cell: { x: to.x, y: to.y },
      turn: { ...turn, movementLeft, plan: null },
      lines: (feature ? ["You're at " + feature.name + '.'] : [])
        .concat(meeting ? ["You're beside " + meeting.name + '.'] : [])
        .concat(seenLines),
      ...(seenLines.length ? { seenLines } : {}),
      walked: squares,
    };
  }
  const lines = (door ? ['You open ' + (door.name || 'the door') + '.'] : [])
    .concat(seenLines)
    .concat(!movementLeft || (!door && !seenLines.length) ? [OUT_OF_MOVEMENT] : []);
  return {
    cell: { x: stop.x, y: stop.y },
    turn: {
      ...turn,
      movementLeft,
      plan: { layer: 'battleMap', mapId: map.id, to: { x: to.x, y: to.y }, path: rest },
    },
    lines,
    ...(seenLines.length ? { seenLines } : {}),
    walked: squares,
    ...(door ? { opened: { mapId: map.id, doorId: door.id } } : {}),
  };
}

/** The two squares a door stands between. */
function doorSides(door) {
  const { from, to } = door;
  if (from.x === to.x) {
    const y = Math.min(from.y, to.y);
    return [
      { x: from.x - 1, y },
      { x: from.x, y },
    ];
  }
  const x = Math.min(from.x, to.x);
  return [
    { x, y: from.y - 1 },
    { x, y: from.y },
  ];
}

const capitalised = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// "A brass key", "the Brass Key" and "brass key" are one item.
const itemName = (item) =>
  String((item && item.name) || item || '')
    .trim()
    .toLowerCase()
    .replace(/^(a|an|the)\s+/, '');

/** Whether the save's character carries a door's key (L-626). */
function hasKey(save, door) {
  if (!door.key) return false;
  const inventory = (save && save.character && save.character.inventory) || [];
  return inventory.some((item) => itemName(item) === itemName(door.key));
}

/** Whether a square is beside a door: on either side of it. */
function besideDoor(door, cell) {
  return Boolean(cell) && doorSides(door).some((side) => maps.sameCell(side, cell));
}

/**
 * Opening (`open` true) or closing a door beside the save, for 1 movement:
 *   { refused: line }                          — nothing happens
 *   { cell, turn, lines, door: { mapId, doorId, state } }
 */
function planDoor(canonWorld, save, doorId, open) {
  const { map, cell } = maps.positionOf(canonWorld, save);
  if (!map || !(map.exits || []).length) return { refused: "There's no map here to move on." };
  const door = (map.doors || []).find((d) => d.id === doorId);
  if (!door) return { refused: "There's no such door here." };
  const name = door.name || 'the door';
  if (!besideDoor(door, cell)) {
    return { refused: 'You need to be beside ' + name + '.' };
  }
  const state = layers.doorState(door, doorStatesOf(save, map.id));
  // A locked door opens with its key, in one go (L-626 / #451).
  const withKey = open && state === 'locked' && hasKey(save, door);
  if (open && state === 'open') return { refused: capitalised(name) + ' is already open.' };
  if (open && state === 'locked' && !withKey) {
    return { refused: capitalised(name) + ' is locked.' };
  }
  if (!open && state !== 'open') return { refused: capitalised(name) + ' is already shut.' };
  const turn = turnStateOf(save);
  if (turn.movementLeft < 1) return { refused: OUT_OF_MOVEMENT };
  return {
    cell: { x: cell.x, y: cell.y },
    turn: { ...turn, movementLeft: turn.movementLeft - 1 },
    lines: [
      withKey
        ? 'You unlock ' + name + ' with ' + door.key + ' and open it.'
        : (open ? 'You open ' : 'You close ') + name + '.',
    ],
    door: { mapId: map.id, doorId: door.id, state: open ? 'open' : 'closed' },
  };
}

module.exports = {
  planStep,
  planDoor,
  planOn,
  doorStatesOf,
  doorSides,
  hasKey,
  besideDoor,
  OUT_OF_MOVEMENT,
  UNSEEN,
};
