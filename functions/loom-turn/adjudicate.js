'use strict';

const crypto = require('crypto');
const { isPlayable, isPlaceOpen } = require('../loom-canon/grading');
const town = require('../loom-canon/town');
const maps = require('../loom-canon/maps');
const { turnStateOf, nextTurnState, speedOf } = require('../loom-models');
const { planStep, doorStatesOf, doorSides, hasKey, besideDoor } = require('./steps');
const layers = require('../loom-canon/layers');
const sight = require('../loom-canon/sight');

// A lock's difficulty when its door gives none (L-626).
const DEFAULT_LOCK_DIFFICULTY = 15;

// Turned down before narration (L-614): the turn's one action is used.
const ACTED = "You've acted this turn. End your turn first.";

// Turned down without using the action (L-636): aimed at something out of
// sight, a thing or a person.
const NOT_SEEN = "You don't see that here.";
const NOBODY_SEEN = "You don't see anyone like that here.";

// Actions that need only sight (L-636): looking and talking. Anything else
// aimed at something on a battle map is physical, and needs reach.
const SIGHT_ONLY =
  /^(look|examine|inspect|study|watch|observe|read|peer|glance|talk|speak|ask|tell|say|greet|call|shout|whisper|listen|wave|signal|point|nod)/;

/**
 * Stage 3 — ADJUDICATE (design doc §5, §10 L-140).
 *
 * The spine of the control thesis: a deterministic rules engine + server-side
 * dice evaluate the proposed action against authoritative state and produce a
 * fixed Resolution. The model never adjudicates legality. Per the L-140
 * decision (#309), the pipeline reaches rules only through this seam:
 *
 *   evaluate(proposedAction, worldState, characterState, dice) → Resolution
 *
 * so a data-driven rules engine (Phase 2, L-202) can later replace the body
 * of evaluate() without reshaping the pipeline. evaluate() is a pure
 * function — dice is an already-rolled value, not a source of randomness —
 * so behavior is fully reproducible in tests; only adjudicateAction() (the
 * orchestrator-facing wrapper) touches the RNG.
 *
 * MVP rule set (hand-coded per world, per L-140): a movement-legality check
 * — "can this character reach that location?" — against the canon
 * connections graph and the requiresAbility rule hook (L-103 / #296),
 * mirroring the design doc's own "can the character fly?" example. Anything
 * else falls back to a simple d20-vs-difficulty-class check so server dice
 * are exercised uniformly. Richer per-verb rules are Phase 2 (L-202 / #313).
 *
 * The Layered Worlds gate (planning/the-loom-layered-worlds.md §5; L-322 /
 * #391): a place that isn't graded Playable (functions/loom-canon/grading.js)
 * is closed, and a move into it is blocked. Leaving a closed place never is,
 * so no save is stranded. A world object with no status (only tests build
 * one) is exempt.
 *
 * Towns (§8; L-342 / #396): inside a settlement with a town layout, moves
 * between places follow the town's own links and are gated the same way. A
 * move to any place in town walks the shortest open way there in one go
 * (L-600 / #433).
 * Leaving town is only from an entrance that serves the route out (a harbour
 * for the sea, a gate for the roads), and arriving lands at the open entrance
 * serving the route in (../loom-canon/town.js).
 */

const DEFAULT_DIFFICULTY_CLASS = 10;

/** Server-side d20, generated fresh per call — never client- or model-supplied. */
function rollDie() {
  return crypto.randomInt(1, 21);
}

const blocked = (message) => ({ outcome: 'blocked', mutations: [], constraints: [message] });

// The ability a place requires that the character lacks (the save's
// character, or a bare character state), or null.
const missingAbility = town.missingAbility;

// What to say when a traveller in town heads out from the wrong place.
function leaveHint(target, exits, via) {
  if (!exits.length) return 'No way out of town leads toward ' + target.name + '.';
  const names = exits.map((place) => place.name).join(' or ');
  return (
    'To set out for ' + target.name + (via ? ' by ' + via : '') + ', go to ' + names + ' first.'
  );
}

// A move to a place inside the current town (L-342): gated like the world
// map, and walked in one go along the shortest way through the town's links
// (L-600 / #433), passing only places the player may enter.
function evaluateTownMove(target, characterState, canonWorld) {
  if (target.locationId !== characterState.location) {
    return blocked("You can't get there directly from here.");
  }
  const here = town.positionOf(canonWorld, characterState).place;
  if (here && here.id === target.id) return enterOrStay(target, characterState, canonWorld);
  if (target.retired) return blocked("That place can't be reached anymore.");
  if (!isPlaceOpen(canonWorld, target)) {
    return blocked('The way to ' + target.name + ' is closed. Turn back.');
  }
  const required = missingAbility(target, characterState);
  if (required) return blocked('You lack what it takes to get in (requires: ' + required + ').');
  const walk = town.walkTo(canonWorld, here, target, town.passableFor(canonWorld, characterState));
  if (!walk) return blockedOnTheWay(here, target, characterState, canonWorld);
  const passed = walk.slice(0, -1);
  return {
    outcome: 'success',
    mutations: [
      { target: 'save', op: 'set-flag', path: 'placeId', value: target.id },
      // A place with a battle map (L-351) is entered on it, at its entry.
      ...maps.arrivalMutations(canonWorld, target, characterState),
      { op: 'increment', path: 'worldClock', value: 1 },
    ],
    constraints: [
      passed.length
        ? 'You make your way ' +
          (here ? 'from ' + here.name + ' ' : '') +
          'past ' +
          andList(passed) +
          ' to ' +
          target.name +
          '.'
        : 'You make your way to ' + target.name + '.',
    ],
  };
}

// Why there's no open way to a place in town: the first place in the way on
// the shortest walk (closed, or needing what the player lacks), or no walk.
function blockedOnTheWay(here, target, characterState, canonWorld) {
  const walk = town.walkTo(canonWorld, here, target);
  const passable = town.passableFor(canonWorld, characterState);
  const stop = walk && walk.slice(0, -1).find((place) => !passable(place));
  if (!stop) return blocked("You can't get there from here.");
  if (!isPlaceOpen(canonWorld, stop)) {
    return blocked('The way to ' + stop.name + ' is closed. Turn back.');
  }
  return blocked(
    'You lack what it takes to get past ' +
      stop.name +
      ' (requires: ' +
      missingAbility(stop, characterState) +
      ').'
  );
}

// A move to where the player already stands: back onto its battle map if it
// has one and they've stepped off it (L-351), else nothing to do.
function enterOrStay(place, characterState, canonWorld) {
  if (maps.mapOf(canonWorld, place) && !characterState.mapId) {
    return {
      outcome: 'success',
      mutations: [
        ...maps.arrivalMutations(canonWorld, place, characterState),
        { op: 'increment', path: 'worldClock', value: 1 },
      ],
      constraints: ['You go into ' + place.name + '.'],
    };
  }
  return { outcome: 'no_op', mutations: [], constraints: ["You're already there."] };
}

// ── Battle maps (L-351) ─────────────────────────────

const exitNames = (exits) => nameList(exits.map((e) => ({ name: e.name })));

// A move while the player is on a battle map: to a cell (from the grid), to a
// feature or an exit (typed: "feature:bar", "exit:front-door"), along the
// map's paths (L-624) over the ground the save knows (L-635), or to someone
// standing there in sight (L-642: the walk ends beside them). Stepping onto an exit leaves by it, out
// to the town or the world, or onto the map it leads to. Anything else waits
// until the player has left the map, as leaving a town waits for a gate.
function evaluateMapMove(proposedAction, characterState, canonWorld, here, known) {
  const { map, cell: from } = here;
  const host = maps.hostOf(canonWorld, characterState);
  const hostName = host ? host.name : map.name;
  const target = proposedAction.targets[0];
  const named = (prefix, list) =>
    typeof target === 'string' && target.indexOf(prefix) === 0
      ? (list || []).find((item) => item.id === target.slice(prefix.length)) || false
      : null;

  let cell = proposedAction.params && proposedAction.params.cell;
  let feature = named('feature:', map.features);
  let exit = named('exit:', map.exits);
  if (feature === false || exit === false) {
    return {
      outcome: 'invalid_target',
      mutations: [],
      constraints: ["There's no such place here."],
    };
  }
  if (feature) cell = { x: feature.x, y: feature.y };
  // Someone standing here (L-642): only if in sight now.
  const person =
    !cell && !exit && typeof target === 'string'
      ? mapTarget(canonWorld, characterState, map, target)
      : null;
  if (person && person.person) {
    const inSight = sight.inSight(map, from, doorStatesOf(characterState, map.id));
    if (!inSight[person.squares[0].x + ',' + person.squares[0].y]) return blocked(NOBODY_SEEN);
    cell = person.squares[0];
  }
  if (!cell && !exit) {
    if (host && target === host.id) {
      return { outcome: 'no_op', mutations: [], constraints: ["You're already there."] };
    }
    const out = maps.exitsOut(map);
    const ways = out.length ? out : map.exits || [];
    return blocked('To leave ' + hostName + ', go out by ' + exitNames(ways) + ' first.');
  }
  if (!exit) {
    if (!maps.inBounds(map, cell)) return blocked("That's off the map.");
    const there = maps.at(map, cell);
    exit = there.exit;
    feature = feature || there.feature;
  }
  if (!exit && maps.sameCell(cell, from)) {
    return { outcome: 'no_op', mutations: [], constraints: ["You're already there."] };
  }
  // The way there, on the turn's movement (L-614 / #444), as a tap would go
  // (./steps.js), over the ground the save knows (L-635): the rest kept as
  // the plan.
  const to = exit ? { x: exit.x, y: exit.y } : { x: cell.x, y: cell.y };
  const step = planStep(canonWorld, characterState, { cell: to }, known);
  if (step.refused) return blocked(step.refused);
  const spend = { target: 'save', op: 'set-flag', path: 'turn', value: step.turn };
  if (step.exit) {
    const left = leaveMapBy(exit, hostName, canonWorld);
    return left.outcome === 'success' ? { ...left, mutations: [...left.mutations, spend] } : left;
  }
  const name = exit
    ? exit.name
    : feature
      ? feature.name
      : person && person.person
        ? person.name
        : null;
  const mutations = [{ target: 'save', op: 'set-flag', path: 'cell', value: step.cell }, spend];
  if (step.opened) {
    // A door opened on the way stays open for this save (L-624).
    const { mapId, doorId } = step.opened;
    mutations.push({
      target: 'save',
      op: 'set-flag',
      path: `doors.${mapId}.${doorId}`,
      value: 'open',
    });
  }
  // The squares walked through, for what is seen on the way (L-632).
  const walked = step.walked;
  if (step.turn.plan) {
    return {
      outcome: 'success',
      mutations,
      constraints: ['You head ' + (name ? 'for ' + name : 'across ' + map.name) + '.'].concat(
        step.lines
      ),
      walked,
    };
  }
  const arrived =
    person && person.person
      ? 'You go over to ' + name + '.'
      : name
        ? 'You move to ' + name + '.'
        : 'You move across ' + map.name + '.';
  return {
    outcome: 'success',
    mutations,
    // Anyone who came into view on the way (L-642).
    constraints: [arrived].concat(step.seenLines || []),
    walked,
  };
}

function leaveMapBy(exit, hostName, canonWorld) {
  const to = exit.to && typeof exit.to === 'object' ? exit.to : null;
  if (to) {
    const next = (canonWorld.battleMaps || {})[to.map];
    if (!next || next.retired) return blocked('The way by ' + exit.name + ' leads nowhere now.');
    return {
      outcome: 'success',
      mutations: [
        { target: 'save', op: 'set-flag', path: 'mapId', value: next.id },
        { target: 'save', op: 'set-flag', path: 'cell', value: maps.entryCell(next, to.entry) },
        { op: 'increment', path: 'worldClock', value: 1 },
      ],
      constraints: ['You go by ' + exit.name + ' to ' + next.name + '.'],
    };
  }
  return {
    outcome: 'success',
    mutations: [
      { target: 'save', op: 'set-flag', path: 'mapId', value: null },
      { target: 'save', op: 'set-flag', path: 'cell', value: null },
      { op: 'increment', path: 'worldClock', value: 1 },
    ],
    constraints: ['You leave ' + hostName + ' by ' + exit.name + '.'],
  };
}

// The way in a traveller asks to arrive by (L-346): a move whose target is a
// way into another town ("to the King's Causeway"), or one naming the town and
// then its way in ([loc_191, plc_191_…]). Null when they name none.
function chosenWayIn(proposedAction, canonWorld) {
  const places = canonWorld.places || {};
  const [first, second] = proposedAction.targets;
  const asked = places[first] ? places[first] : places[second];
  if (!asked || !town.isEntrance(asked)) return null;
  if (!places[first] && asked.locationId !== first) return null; // a way into another town
  return asked;
}

function evaluateMove(proposedAction, worldState, characterState, canonWorld, known) {
  const currentId = characterState.location;

  if (!currentId || !canonWorld.locations[currentId]) {
    return blocked('You have nowhere established to move from yet.');
  }

  // On a battle map (L-351), moves happen on the map until the player leaves
  // it. A map with no exits holds nobody: it is passed over.
  const onMap = maps.positionOf(canonWorld, characterState);
  if (onMap.map && (onMap.map.exits || []).length) {
    return evaluateMapMove(proposedAction, characterState, canonWorld, onMap, known);
  }
  if (proposedAction.params && proposedAction.params.cell) {
    return blocked("There's no map here to move on.");
  }

  const first = proposedAction.targets[0];
  const targetPlace = first && (canonWorld.places || {})[first];
  if (targetPlace && targetPlace.locationId === currentId) {
    return evaluateTownMove(targetPlace, characterState, canonWorld);
  }
  // A place in another town can only be reached as its way in, travelling there.
  const wayIn = chosenWayIn(proposedAction, canonWorld);
  if (targetPlace && !wayIn) return blocked("You can't get there directly from here.");
  const targetId = wayIn ? wayIn.locationId : first;

  if (!targetId || !canonWorld.locations[targetId]) {
    return {
      outcome: 'invalid_target',
      mutations: [],
      constraints: ["There's no such place to go."],
    };
  }

  if (targetId === currentId) {
    return enterOrStay(canonWorld.locations[currentId], characterState, canonWorld);
  }

  const currentLocation = canonWorld.locations[currentId];
  if (currentLocation.connections.indexOf(targetId) === -1) {
    return blocked("You can't get there directly from here.");
  }

  const targetLocation = canonWorld.locations[targetId];
  // A retired place stays resolvable for saves already there, but nobody can
  // travel to it (Firestore worlds also drop it from connections).
  if (targetLocation.retired) return blocked("That place can't be reached anymore.");
  if (!isPlayable(canonWorld, targetLocation)) {
    return blocked('The way to ' + targetLocation.name + ' is closed. Turn back.');
  }
  const required = missingAbility(targetLocation, characterState);
  if (required) {
    return blocked('You lack what it takes to make that crossing (requires: ' + required + ').');
  }

  // Leaving a town (L-342): only from a way out that serves the route — a
  // harbour for the sea, a gate for the roads and trails.
  const via = town.routeBetween(canonWorld, currentId, targetId);
  const here = town.positionOf(canonWorld, characterState).place;
  if (here && !(town.isEntrance(here) && town.serves(here, via))) {
    const exits = town.entrancesOf(canonWorld, currentId).filter((p) => town.serves(p, via));
    return blocked(leaveHint(targetLocation, exits, via));
  }

  // Arriving at a town lands at the way in the traveller chose (L-346), or
  // else at the open entrance serving the route.
  if (wayIn) {
    const refused = refuseWayIn(wayIn, targetLocation, via, characterState, canonWorld);
    if (refused) return refused;
  }
  const arrival = wayIn || town.arrivalPlace(canonWorld, targetId, via);
  const mutations = [{ target: 'save', op: 'set-flag', path: 'location', value: targetId }];
  if (arrival || characterState.placeId) {
    mutations.push({
      target: 'save',
      op: 'set-flag',
      path: 'placeId',
      value: arrival ? arrival.id : null,
    });
  }
  // Arriving where there is a battle map (L-351) lands on it, at its entry:
  // the way in reached, or the point of interest itself.
  mutations.push(...maps.arrivalMutations(canonWorld, arrival || targetLocation, characterState));
  mutations.push({ op: 'increment', path: 'worldClock', value: 1 });
  return {
    outcome: 'success',
    mutations,
    constraints: [
      'You arrive at ' + targetLocation.name + (arrival ? ', at ' + arrival.name : '') + '.',
    ],
  };
}

// Why a chosen way in can't be used, or null if it can.
function refuseWayIn(wayIn, destination, via, characterState, canonWorld) {
  if (wayIn.retired) return blocked("That way in can't be used anymore.");
  if (!isPlaceOpen(canonWorld, wayIn)) {
    return blocked(
      'The way into ' + destination.name + ' by ' + wayIn.name + ' is closed. Turn back.'
    );
  }
  if (!town.serves(wayIn, via)) {
    const serving = town
      .entrancesOf(canonWorld, destination.id)
      .filter((p) => town.serves(p, via) && isPlaceOpen(canonWorld, p));
    return blocked(
      wayIn.name +
        ' is no way in by ' +
        (via || 'this route') +
        '.' +
        (serving.length ? ' Arrive by ' + nameList(serving) + '.' : '')
    );
  }
  const required = missingAbility(wayIn, characterState);
  if (required) return blocked('You lack what it takes to get in (requires: ' + required + ').');
  return null;
}

function nameList(places, last = 'or') {
  const names = places.map((p) => p.name);
  return names.length < 2
    ? names.join('')
    : names.slice(0, -1).join(', ') + ' ' + last + ' ' + names[names.length - 1];
}

const andList = (places) => nameList(places, 'and');

function evaluateGeneric(proposedAction, dice) {
  const success = dice >= DEFAULT_DIFFICULTY_CLASS;
  return {
    outcome: success ? 'success' : 'failure',
    mutations: [],
    constraints: [
      success
        ? 'The attempt to ' + proposedAction.verb + ' succeeds.'
        : 'The attempt to ' + proposedAction.verb + ' does not succeed.',
    ],
  };
}

/**
 * @param {object} proposedAction - { verb, targets[], params } from INTERPRET (L-111 / #298)
 * @param {object} worldState
 * @param {object} characterState
 * @param {number} dice - an already-rolled d20 value (1-20)
 * @param {object} canonWorld - read-only canon (L-103 / #296)
 * @returns {{ outcome: string, mutations: object[], constraints: string[] }}
 */
// Ending the turn (planning/the-loom-movement-and-vision.md §3; L-611 / #441):
// movement and the action are refilled, the plan is kept, and the turn
// counts. Always allowed, wherever the player is. On a battle map, the record
// says how far the player moved this turn, since steps aren't recorded
// (L-613 / #443).
function evaluateEndTurn(characterState, canonWorld) {
  const spent = speedOf(characterState) - turnStateOf(characterState).movementLeft;
  const { map, cell } = maps.positionOf(canonWorld || {}, characterState);
  let moved = '';
  if (map && spent > 0) {
    const feature = maps.at(map, cell).feature;
    moved =
      ' You moved ' +
      spent +
      (spent === 1 ? ' square' : ' squares') +
      (feature ? ', to ' + feature.name : '') +
      '.';
  }
  return {
    outcome: 'success',
    mutations: [
      { target: 'save', op: 'set-flag', path: 'turn', value: nextTurnState(characterState) },
      { op: 'increment', path: 'worldClock', value: 1 },
    ],
    constraints: ['Turn ' + turnStateOf(characterState).n + ' ends.' + moved],
  };
}

// What an action aims at on the battle map the player stands on: its name,
// the squares it stands on (a door, either side of it), and whether it's a
// person (someone placed on a square, §6), or null if it isn't there.
function mapTarget(canonWorld, characterState, map, target) {
  const named = (prefix, list) =>
    typeof target === 'string' && target.indexOf(prefix) === 0
      ? (list || []).find((item) => item.id === target.slice(prefix.length))
      : null;
  const spot = named('feature:', map.features) || named('exit:', map.exits);
  if (spot) return { name: spot.name, squares: [spot] };
  const door = named('door:', map.doors);
  if (door) return { name: door.name || 'the door', squares: doorSides(door), door: true };
  // Someone here (as the grid view lists them: at this place in town, or at
  // this point of interest), standing on a square.
  const person = (canonWorld.characters || {})[target];
  if (!person) return null;
  const host = maps.hostOf(canonWorld, characterState);
  const isPlace = host && Boolean((canonWorld.places || {})[host.id]);
  const here =
    person &&
    host &&
    (isPlace ? person.placeId === host.id : person.locationId === host.id && !person.placeId);
  if (here && !person.retired && person.cell) {
    return { name: person.name, squares: [person.cell], person: true };
  }
  return null;
}

// On a battle map (planning/the-loom-movement-and-vision.md §5; L-636 /
// #459): an action aimed at something out of sight is turned down, and a
// physical one at something out of reach (you must be on or beside its
// square; a feature on an obstacle counts from beside it). Doors keep their
// own reach rule (evaluateDoorAttempt). A line to say, or null.
function outOfSightOrReach(proposedAction, characterState, canonWorld) {
  const { map, cell } = maps.positionOf(canonWorld || {}, characterState);
  if (!map) return null;
  const inSight = sight.inSight(map, cell, doorStatesOf(characterState, map.id));
  const seen = (square) => Boolean(inSight[square.x + ',' + square.y]);
  const near = (square) => Math.max(Math.abs(square.x - cell.x), Math.abs(square.y - cell.y)) <= 1;
  const physical = !SIGHT_ONLY.test(String(proposedAction.verb || ''));
  for (const target of proposedAction.targets || []) {
    const thing = mapTarget(canonWorld, characterState, map, target);
    if (!thing) continue;
    if (!thing.squares.some(seen)) return thing.person ? NOBODY_SEEN : NOT_SEEN;
    if (physical && !thing.door && !thing.squares.some(near)) {
      return 'You need to be beside ' + thing.name + '.';
    }
  }
  return null;
}

// Anything typed that isn't a move uses the turn's one action (L-614 /
// #444), whether it succeeds or not; a second is turned down. What is turned
// down before it's tried (out of sight or reach; no such door; not beside it;
// no lock to pick) uses nothing.
function evaluateAction(proposedAction, characterState, dice, canonWorld) {
  const turn = turnStateOf(characterState);
  if (turn.actionUsed) return blocked(ACTED);
  const unreached = outOfSightOrReach(proposedAction, characterState, canonWorld);
  if (unreached) return blocked(unreached);
  const doorTarget = (proposedAction.targets || []).find(
    (t) => typeof t === 'string' && t.indexOf('door:') === 0
  );
  const resolution = doorTarget
    ? evaluateDoorAttempt(proposedAction, doorTarget.slice(5), characterState, dice, canonWorld)
    : evaluateGeneric(proposedAction, dice);
  if (['blocked', 'invalid_target', 'no_op'].includes(resolution.outcome)) return resolution;
  return {
    ...resolution,
    mutations: [
      ...resolution.mutations,
      { target: 'save', op: 'set-flag', path: 'turn', value: { ...turn, actionUsed: true } },
    ],
  };
}

// A typed attempt at a door beside the player (L-626 / #451): with its key, a
// locked door unlocks and opens; picked or forced, it's rolled against the
// lock's difficulty, and unlocked (for this save) on a success. An unlocked
// door opens or closes as asked.
function evaluateDoorAttempt(proposedAction, doorId, characterState, dice, canonWorld) {
  const { map, cell } = maps.positionOf(canonWorld, characterState);
  const door = map && (map.doors || []).find((d) => d.id === doorId);
  if (!door) {
    return {
      outcome: 'invalid_target',
      mutations: [],
      constraints: ["There's no such door here."],
    };
  }
  const name = door.name || 'the door';
  if (!besideDoor(door, cell)) return blocked('You need to be beside ' + name + '.');
  const state = layers.doorState(door, doorStatesOf(characterState, map.id));
  const set = (value) => ({
    target: 'save',
    op: 'set-flag',
    path: `doors.${map.id}.${door.id}`,
    value,
  });
  const verb = String(proposedAction.verb || '');
  const closing = /close|shut|lock$/.test(verb) && !/unlock/.test(verb);
  if (state !== 'locked') {
    if (closing && state === 'open') {
      return {
        outcome: 'success',
        mutations: [set('closed')],
        constraints: ['You close ' + name + '.'],
      };
    }
    if (!closing && state === 'closed' && /^open/.test(verb)) {
      return {
        outcome: 'success',
        mutations: [set('open')],
        constraints: ['You open ' + name + '.'],
      };
    }
    return {
      outcome: 'no_op',
      mutations: [],
      constraints: [name.charAt(0).toUpperCase() + name.slice(1) + " isn't locked."],
    };
  }
  if (hasKey(characterState, door)) {
    return {
      outcome: 'success',
      mutations: [set('open')],
      constraints: ['You unlock ' + name + ' with ' + door.key + ' and open it.'],
    };
  }
  const difficulty = Number.isInteger(door.difficulty) ? door.difficulty : DEFAULT_LOCK_DIFFICULTY;
  if (dice >= difficulty) {
    return {
      outcome: 'success',
      mutations: [set('closed')],
      constraints: ['The lock gives way: ' + name + ' is unlocked.'],
    };
  }
  return { outcome: 'failure', mutations: [], constraints: ['The lock on ' + name + ' holds.'] };
}

function evaluate(proposedAction, worldState, characterState, dice, canonWorld, known) {
  let resolution;
  if (proposedAction.verb === 'move') {
    resolution = evaluateMove(proposedAction, worldState, characterState, canonWorld, known);
  } else if (proposedAction.verb === 'end-turn') {
    resolution = evaluateEndTurn(characterState, canonWorld);
  } else {
    resolution = evaluateAction(proposedAction, characterState, dice, canonWorld);
  }

  // Resolution is immutable once produced — NARRATE (L-113) can color it, never change it.
  // A move on a battle map also says which squares it walked through, for
  // what is seen on the way (COMMIT; L-632), not for the turn record.
  return Object.freeze({
    outcome: resolution.outcome,
    mutations: Object.freeze(resolution.mutations),
    constraints: Object.freeze(resolution.constraints),
    ...(resolution.walked ? { walked: Object.freeze(resolution.walked) } : {}),
  });
}

/**
 * `known` is the ground the save knows on its battle map, keyed "x,y" (L-635;
 * ./seen.js knownTo): a move there heads only for and over it.
 *
 * @param {{ proposedAction: object, canonWorld: object, save: object, worldState: object,
 *           known?: object }} params
 * @param {() => number} [rollFn] - override for tests; defaults to the real server-side die
 * @returns {Promise<{ outcome: string, mutations: object[], constraints: string[] }>}
 */
async function adjudicateAction(params, rollFn = rollDie) {
  const { proposedAction, canonWorld, save, worldState, known } = params;
  const dice = rollFn();
  return evaluate(proposedAction, worldState, save, dice, canonWorld, known);
}

module.exports = {
  evaluate,
  adjudicateAction,
  rollDie,
  DEFAULT_DIFFICULTY_CLASS,
  DEFAULT_LOCK_DIFFICULTY,
  ACTED,
  NOT_SEEN,
  NOBODY_SEEN,
};
