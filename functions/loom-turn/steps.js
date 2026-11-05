'use strict';

const mapPaths = require('../loom-canon/map-paths');
const maps = require('../loom-canon/maps');
const mapDoors = require('../loom-canon/doors');
const sight = require('../loom-canon/sight');
const hazards = require('../loom-canon/hazards');
const conditions = require('../loom-canon/conditions');
const { systemOf } = require('../loom-canon/checks');
const { sheetOf, widthOf } = require('../loom-canon/sheets');
const { turnStateOf } = require('../loom-models');
const apRules = require('../loom-canon/ap');
const { doorSides, knownMap } = require('./known-map');

/**
 * Moving without the GM (planning/the-loom-movement-and-vision.md §3;
 * L-613 / #443): a move on a battle map, to a square or along the plan, is
 * worked out by the rules alone. The save walks the cheapest path as far as
 * its action points allow (map-paths.js, in feet; L-832, L-922), and the
 * rest of the path becomes its plan, which `continue` picks up next turn. Nothing is narrated: a step
 * answers with plain lines, and isn't written to the turn history.
 *
 * A path that reaches an exit leaves by it, as before, and that is narrated
 * (the caller runs the rest of the pipeline). Paths never cross an exit on
 * the way somewhere else, since stepping onto one leaves.
 *
 * Paths go around the map's walls, locked doors and obstacles (L-624 /
 * #449), through any gap as wide as the character (L-922), priced in AP by
 * the system's cost table as the character pays it (L-832; ../loom-canon/
 * ap.js pricesOf): 1 per 5 ft, difficult ground 2, rounded up once a move. A closed door on the way is
 * opened (its door cost) and the walk stops there, the rest kept as the
 * plan, so the player sees what's beyond before going on; the save
 * remembers the door open (`save.doors[mapId][doorId]`). Walking off ends a
 * long action under way (CT4).
 *
 * Only ground the save knows is walked (planning/the-loom-movement-and-
 * vision.md §5; L-635 / #458): what it has seen there, and what is in sight
 * now (./seen.js knownTo). A move must be to a square it has seen ("You
 * haven't seen that."), and its path treats unseen squares as blocked, so it
 * never gives away a hidden wall: it goes around, or there's no way.
 *
 * A door beside the player (on either side of it) opens or closes with a tap
 * (planDoor; L-625 / #450), for its door cost in AP; a locked one opens
 * only with its key in the character's inventory (L-626 / #451).
 *
 * People standing on squares (planning/the-loom-movement-and-vision.md §6;
 * L-642 / #461) are walked through at the normal cost, but a move never
 * ends on one: a path to someone's square stops on the last free square
 * before it (beside them), and a walk whose movement runs out on someone
 * backs off to the last free square. A walk stops on the square where
 * someone comes into view who wasn't in sight where it started, with a
 * plain line ("Old Mags is at the bar.") and the rest kept as the plan.
 *
 * A walk into a hazard (L-815; ../loom-canon/hazards.js), from a square
 * outside it to one inside, stops there, the rest kept as the plan, and
 * says which (`hazard`): the caller has it triggered, narrated. A character
 * whose conditions stop them moving (noMove: Stunned) doesn't step at all.
 *
 * Pure: planStep reads a save and the canon world and says what the step
 * does; the caller writes it inside a transaction, so two moves at once
 * can't spend the same AP.
 */

const OUT_OF_MOVEMENT = "You're out of movement. End your turn to go on.";
// On a battle map, where the steps are paid in AP (L-832).
const OUT_OF_AP = "That's as far as your AP takes you. End your turn to go on.";

/** A character's prices in AP on a battle map (L-832). */
function pricesFor(canonWorld, save) {
  return apRules.pricesOf(systemOf(canonWorld), sheetOf(save));
}

// A long action under way (CT4) ends when the player walks off.
function walkedOff(turn, walked) {
  if (!turn.long || !walked) return { turn, lines: [] };
  const { long, ...rest } = turn;
  return { turn: { ...rest, long: null }, lines: ['You stop ' + long.name + '.'] };
}

/** Why a character can't move now (a condition with noMove, L-815), or null. */
function heldBy(canonWorld, save) {
  // Down in a fight (L-827): no steps.
  if (save && save.down) return "You're down: you can only end your turn.";
  const names = conditions.flagsOf(systemOf(canonWorld), sheetOf(save)).noMove;
  return names.length ? "You can't move: you're " + names.join(' and ') + '.' : null;
}
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

/** Where a plan heads, in feet: its point, or (a plan from before) its square's centre. */
function planPoint(plan) {
  if (plan.point && Number.isFinite(plan.point.x) && Number.isFinite(plan.point.y)) {
    return { x: plan.point.x, y: plan.point.y };
  }
  return plan.to ? mapPaths.centreOf(plan.to) : null;
}

/** A door on a map by id, from its geometry (L-922, L-928; ../loom-canon/doors.js). */
function doorOn(map, id) {
  return mapDoors.doorOf(map, id);
}

/**
 * A character's AP prices as the grid view is sent them (loomGetMap's turn
 * `prices`): a square's, difficult ground's, a door's, and each door's own
 * (of its geometry), with its conditions in them.
 */
function viewPrices(canonWorld, save, map) {
  const prices = pricesFor(canonWorld, save);
  const own = {};
  for (const door of (map && mapDoors.doorsOf(map)) || []) own[door.id] = prices.door(door);
  return { move: prices.move, difficult: prices.difficult, door: prices.door(null), doors: own };
}

/**
 * How a save's character moves on a map (L-922; ../loom-canon/map-paths.js):
 * planned on the map as far as it has been seen (`known`, keyed "x,y"; all of
 * it without), exactly as the grid view has it (./known-map.js), with the
 * view's prices and the character's width, through the planner the view
 * uses (viewPlanner): so the page's preview is the server's charge. It never
 * walks into a square not seen, nor an exit but the one at `goal`.
 */
function moverFor(canonWorld, save, map, { known = null, goal = null } = {}) {
  const on = known ? (sq) => Boolean(known[sq.x + ',' + sq.y]) : () => true;
  const view = {
    ...knownMap(map, on, doorStatesOf(save, map.id)),
    size: { width: widthOf(sheetOf(save)) },
  };
  return mapPaths.viewPlanner(view, viewPrices(canonWorld, save, map), {
    goal,
    known: known ? on : null,
  });
}

const inFeet = (map, p) =>
  Boolean(p) &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  p.x >= 0 &&
  p.y >= 0 &&
  p.x <= map.width * mapPaths.FEET &&
  p.y <= map.height * mapPaths.FEET;

/**
 * What a move on a battle map does, for a save as it stands now:
 *   { refused: line }                          — nothing happens
 *   { exit, spent, turn, walked?, feet }       — it reaches an exit and leaves by it
 *   { cell, point, turn, lines, walked, feet } — a quiet step (or none: out of AP)
 * `target` is { cell } (a square: where in it the character fits, its centre
 * if it can), { point } (in feet) or { plan: true } (walk the plan). `turn`
 * is the save's turn after the move: AP spent, the plan set or cleared.
 * `point` is where it stops, in feet, and `cell` the square that is in
 * (L-922), and `feet` how long the whole way is. `walked` lists the squares
 * stepped into, in order, for what is seen on the way (./seen.js; L-632),
 * and `stations` the walk in feet (map-paths.js walk), for the reactions it
 * draws. `known` is the squares the save knows,
 * keyed "x,y" (L-635): only those are headed for or walked over. Without it,
 * every square is (for the rules alone, as in tests).
 */
function planStep(canonWorld, save, target, known) {
  const { map, cell: from, point: start } = maps.positionOf(canonWorld, save);
  if (!map || !(map.exits || []).length) return { refused: "There's no map here to move on." };
  const held = heldBy(canonWorld, save);
  if (held) return { refused: held };
  const turn = turnStateOf(save);

  let plan = null;
  let aim = null; // a point in feet
  let to = target.cell || null; // a square
  if (target.plan) {
    plan = planOn(save);
    if (!plan) return { refused: 'You have no way planned. Tap where to go.' };
    aim = planPoint(plan);
    if (!aim) return { refused: 'You have no way planned. Tap where to go.' };
    to = mapPaths.squareOf(aim);
  } else if (target.point) {
    if (!inFeet(map, target.point)) return { refused: "That's off the map." };
    aim = { x: target.point.x, y: target.point.y };
    to = mapPaths.squareOf(aim);
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

  // The map as this character moves on it: around walls, locked doors and
  // whatever is in the way, through gaps as wide as they are, opening
  // closed doors on the way, over ground it knows. An exit is only stepped
  // into to leave by it: it's never on the way.
  const mover = moverFor(canonWorld, save, map, { known, goal: to });

  // People here (L-642): walked through, never stopped on. A way to
  // someone's square ends just before it, beside them.
  const people = maps.standingAt(canonWorld, maps.hostOf(canonWorld, save));
  const personAt = (cell) => people.find((p) => maps.sameCell(p.cell, cell)) || null;
  const meeting = personAt(to);
  if (meeting && besideOf(from, to)) return { refused: "You're beside " + meeting.name + '.' };

  // Someone not in sight where the walk starts stops it where they come
  // into view (with the doors as they were; L-642).
  // Seen from their eyes where they stand, by their size (L-923).
  const doors = doorStatesOf(save, map.id);
  const size = (sheetOf(save) || {}).size;
  const eyes = (cell, point) => ({ cell, ...(point ? { point } : {}), ...(size ? { size } : {}) });
  const atStart = sight.inSight(map, eyes(from, start), doors);
  const unseen = people.filter((p) => !atStart[key(p.cell)]);
  const cameIntoView = (at, states) => {
    if (!unseen.length) return [];
    const now = sight.inSight(map, at.cell ? at : eyes(at), states);
    return unseen.filter((p) => now[key(p.cell)]);
  };
  // Each square walked into: a hazard entered stops the walk there (L-815),
  // as does someone coming into view.
  // A drop of FALL or more walked off (L-923) stops it where it lands: a fall.
  const dropOf = (before, st) => mover.floor(before) - mover.floor(st);
  const intoSquare = (st, before) =>
    dropOf(before, st) >= mapPaths.FALL - 1e-9 ||
    (!maps.sameCell(st.square, before.square) &&
      (cameIntoView(eyes(st.square, { x: st.x, y: st.y }), doors).length > 0 ||
        Boolean(hazards.enteredBy(map, before.square, st.square, doors))));
  // The move, as the grid view previews it (map-paths.js moveTo): the spot
  // in the square the character fits, the way there, short of someone
  // standing there, and as far as the AP goes. With AP off (L-838) the walk
  // is free: it goes to the end of its path.
  const apOff = apRules.isOff(systemOf(canonWorld));
  const move = mapPaths.moveTo(
    mover,
    start,
    aim ? { point: aim } : { cell: to },
    apOff ? Infinity : turn.ap,
    { occupied: (sq) => Boolean(personAt(sq)), stop: intoSquare }
  );
  if (move.none === 'room') {
    return {
      refused: meeting ? "There's no room to stop there." : "There's no room for you there.",
    };
  }
  if (move.none) return { refused: "There's no way there from here." };
  const found = move.path;
  const went = move.walk;
  // How far the whole way is, in feet, for the confirm card (#673).
  const feet = Math.round(found.feet);
  aim = move.end;
  to = move.goal;
  const spent = went.spent;
  const stopAt = went.walked.length ? went.walked[went.walked.length - 1] : null;
  const stopPoint = stopAt ? { x: stopAt.x, y: stopAt.y } : start;
  const stop = stopAt ? stopAt.square : from;
  // The squares walked into, the start's left out.
  const squares = mapPaths
    .squaresOf(went.walked)
    .filter((sq, i) => i > 0 || !maps.sameCell(sq, from));
  // The walk as it went, in feet: each station `{ x, y, square, weight }`,
  // for the reactions it draws in a fight, by distance (L-922).
  const stations = went.walked;
  const before = squares.length > 1 ? squares[squares.length - 2] : from;
  const hazard = squares.length ? hazards.enteredBy(map, before, stop, doors) : null;
  // The walk's last step a fall (L-923): how far.
  const landed = went.walked.length
    ? dropOf(went.walked.length > 1 ? went.walked[went.walked.length - 2] : start, stopAt)
    : 0;
  const into = {
    ...(hazard ? { hazard: { id: hazard.id, name: hazard.name, mapId: map.id } } : {}),
    ...(landed >= mapPaths.FALL - 1e-9
      ? { fall: { feet: Math.round(landed), mapId: map.id } }
      : {}),
  };
  // What the walk leaves of the turn: its AP, the squares walked, and any
  // long action, ended by walking off.
  const off = walkedOff(turn, went.walked.length > 0);
  const ap = apOff ? turn.ap : turn.ap - spent;
  // How far it walked, in feet (L-922), for End turn's line.
  let walkedFeet = 0;
  went.walked.reduce((a, b) => {
    walkedFeet += Math.hypot(b.x - a.x, b.y - a.y);
    return b;
  }, start);
  const after = { ...off.turn, ap, moved: (turn.moved || 0) + Math.round(walkedFeet) };
  const door = went.opened ? doorOn(map, went.opened) : null;
  // Who came into view: on the way, or from where it ends, through a door
  // just opened.
  const sighted = unseen.filter((p) =>
    [{ cell: stop, states: door ? { ...doors, [door.id]: 'open' } : doors }]
      .concat(squares.map((cell) => ({ cell, states: doors })))
      .some(({ cell, states }) => cameIntoView(cell, states).includes(p))
  );
  const seenLines = sighted.map((p) => inViewLine(map, p));
  if (went.reached) {
    const { exit, feature } = maps.at(map, to);
    // The squares walked to it, for the reactions it draws in a fight (L-823).
    if (exit) {
      return { exit, spent, turn: { ...after, plan: null }, walked: squares, stations, feet };
    }
    return {
      feet,
      cell: { x: to.x, y: to.y },
      // Where it stopped: its point, or a step short of it in its square.
      point: stopPoint,
      turn: { ...after, plan: null },
      lines: off.lines
        .concat(feature ? ["You're at " + feature.name + '.'] : [])
        .concat(meeting ? ["You're beside " + meeting.name + '.'] : [])
        .concat(seenLines),
      ...(seenLines.length ? { seenLines } : {}),
      walked: squares,
      stations,
      ...into,
    };
  }
  // The rest of the way, kept as the plan: where it heads, and the squares
  // still to go (for a count of how far, ./reach.js).
  const rest = mapPaths
    .squaresOf(mapPaths.stations(mover, found).slice(went.walked.length + 1))
    .filter((sq, i) => i > 0 || !maps.sameCell(sq, stop));
  const lines = off.lines
    .concat(door ? ['You open ' + (door.name || 'the door') + '.'] : [])
    .concat(seenLines)
    .concat(
      !apOff && (!ap || (!door && !seenLines.length && !hazard && !into.fall)) ? [OUT_OF_AP] : []
    );
  return {
    feet,
    cell: { x: stop.x, y: stop.y },
    point: stopPoint,
    turn: {
      ...after,
      plan: {
        layer: 'battleMap',
        mapId: map.id,
        to: { x: to.x, y: to.y },
        point: { x: aim.x, y: aim.y },
        path: rest,
      },
    },
    lines,
    ...(seenLines.length ? { seenLines } : {}),
    walked: squares,
    stations,
    ...(door ? { opened: { mapId: map.id, doorId: door.id } } : {}),
    ...into,
  };
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
  const key = mapDoors.keyOf(door);
  if (!key) return false;
  const inventory = (save && save.character && save.character.inventory) || [];
  return inventory.some((item) => itemName(item) === itemName(key));
}

/** Whether a square is beside a door: on either side of it. */
function besideDoor(door, cell) {
  return Boolean(cell) && doorSides(door).some((side) => maps.sameCell(side, cell));
}

/**
 * Opening (`open` true) or closing a door beside the save, for its door cost
 * in AP (L-832; its own `ap`, else the system's):
 *   { refused: line }                          — nothing happens
 *   { cell, turn, lines, door: { mapId, doorId, state } }
 */
function planDoor(canonWorld, save, doorId, open) {
  const { map, cell } = maps.positionOf(canonWorld, save);
  if (!map || !(map.exits || []).length) return { refused: "There's no map here to move on." };
  const door = mapDoors.doorOf(map, doorId);
  if (!door) return { refused: "There's no such door here." };
  const name = door.name || 'the door';
  if (!besideDoor(door, cell)) {
    return { refused: 'You need to be beside ' + name + '.' };
  }
  const state = mapDoors.stateOf(door, doorStatesOf(save, map.id));
  // A locked door opens with its key, in one go (L-626 / #451).
  const withKey = open && state === 'locked' && hasKey(save, door);
  if (open && state === 'open') return { refused: capitalised(name) + ' is already open.' };
  if (open && state === 'locked' && !withKey) {
    return { refused: capitalised(name) + ' is locked.' };
  }
  if (!open && state !== 'open') return { refused: capitalised(name) + ' is already shut.' };
  const turn = turnStateOf(save);
  // Free with AP off (L-838).
  const cost = apRules.isOff(systemOf(canonWorld)) ? 0 : pricesFor(canonWorld, save).door(door);
  const doing = (open ? 'opening ' : 'closing ') + name;
  if (turn.ap < cost) return { refused: apRules.shortLine(doing, cost, turn.ap) };
  return {
    cell: { x: cell.x, y: cell.y },
    turn: { ...turn, ap: turn.ap - cost },
    lines: [
      withKey
        ? 'You unlock ' + name + ' with ' + mapDoors.keyOf(door) + ' and open it.'
        : (open ? 'You open ' : 'You close ') + name + '.',
    ],
    door: { mapId: map.id, doorId: door.id, state: open ? 'open' : 'closed' },
  };
}

module.exports = {
  planStep,
  heldBy,
  planDoor,
  planOn,
  planPoint,
  moverFor,
  viewPrices,
  doorOn,
  doorStatesOf,
  doorSides,
  hasKey,
  besideDoor,
  OUT_OF_MOVEMENT,
  OUT_OF_AP,
  pricesFor,
  UNSEEN,
};
