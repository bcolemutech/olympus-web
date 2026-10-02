'use strict';

const crypto = require('crypto');
const { isPlayable, isPlaceOpen } = require('../loom-canon/grading');
const town = require('../loom-canon/town');
const maps = require('../loom-canon/maps');

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
 * so no save is stranded. Hand-authored static worlds are exempt.
 *
 * Towns (§8; L-342 / #396): inside a settlement with a town layout, moves
 * between places follow the town's own links and are gated the same way.
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

function missingAbility(place, characterState) {
  const required = place.rules && place.rules.requiresAbility;
  const abilities = characterState.abilities || [];
  return required && abilities.indexOf(required) === -1 ? required : null;
}

// What to say when a traveller in town heads out from the wrong place.
function leaveHint(target, exits, via) {
  if (!exits.length) return 'No way out of town leads toward ' + target.name + '.';
  const names = exits.map((place) => place.name).join(' or ');
  return (
    'To set out for ' + target.name + (via ? ' by ' + via : '') + ', go to ' + names + ' first.'
  );
}

// A move to a place inside the current town (L-342): along the town's own
// links, gated like the world map.
function evaluateTownMove(target, characterState, canonWorld) {
  if (target.locationId !== characterState.location) {
    return blocked("You can't get there directly from here.");
  }
  const here = town.positionOf(canonWorld, characterState).place;
  if (here && here.id === target.id) return enterOrStay(target, characterState, canonWorld);
  const reachable = here ? (here.connections || []).includes(target.id) : town.isEntrance(target);
  if (!reachable) return blocked("You can't get there directly from here.");
  if (target.retired) return blocked("That place can't be reached anymore.");
  if (!isPlaceOpen(canonWorld, target)) {
    return blocked('The way to ' + target.name + ' is closed. Turn back.');
  }
  const required = missingAbility(target, characterState);
  if (required) return blocked('You lack what it takes to get in (requires: ' + required + ').');
  return {
    outcome: 'success',
    mutations: [
      { target: 'save', op: 'set-flag', path: 'placeId', value: target.id },
      // A place with a battle map (L-351) is entered on it, at its entry.
      ...maps.arrivalMutations(canonWorld, target, characterState),
      { op: 'increment', path: 'worldClock', value: 1 },
    ],
    constraints: ['You make your way to ' + target.name + '.'],
  };
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
// feature or an exit (typed: "feature:bar", "exit:front-door"), anywhere in the
// grid (nothing blocks movement yet). Stepping onto an exit leaves by it, out
// to the town or the world, or onto the map it leads to. Anything else waits
// until the player has left the map, as leaving a town waits for a gate.
function evaluateMapMove(proposedAction, characterState, canonWorld, here) {
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
  if (exit) return leaveMapBy(exit, hostName, canonWorld);
  if (maps.sameCell(cell, from)) {
    return { outcome: 'no_op', mutations: [], constraints: ["You're already there."] };
  }
  return {
    outcome: 'success',
    mutations: [
      { target: 'save', op: 'set-flag', path: 'cell', value: { x: cell.x, y: cell.y } },
      { op: 'increment', path: 'worldClock', value: 1 },
    ],
    constraints: [
      feature ? 'You move to ' + feature.name + '.' : 'You move across ' + map.name + '.',
    ],
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

function evaluateMove(proposedAction, worldState, characterState, canonWorld) {
  const currentId = characterState.location;

  if (!currentId || !canonWorld.locations[currentId]) {
    return blocked('You have nowhere established to move from yet.');
  }

  // On a battle map (L-351), moves happen on the map until the player leaves
  // it. A map with no exits holds nobody: it is passed over.
  const onMap = maps.positionOf(canonWorld, characterState);
  if (onMap.map && (onMap.map.exits || []).length) {
    return evaluateMapMove(proposedAction, characterState, canonWorld, onMap);
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

function nameList(places) {
  const names = places.map((p) => p.name);
  return names.length < 2
    ? names.join('')
    : names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1];
}

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
function evaluate(proposedAction, worldState, characterState, dice, canonWorld) {
  let resolution;
  if (proposedAction.verb === 'move') {
    resolution = evaluateMove(proposedAction, worldState, characterState, canonWorld);
  } else {
    resolution = evaluateGeneric(proposedAction, dice);
  }

  // Resolution is immutable once produced — NARRATE (L-113) can color it, never change it.
  return Object.freeze({
    outcome: resolution.outcome,
    mutations: Object.freeze(resolution.mutations),
    constraints: Object.freeze(resolution.constraints),
  });
}

/**
 * @param {{ proposedAction: object, canonWorld: object, save: object, worldState: object }} params
 * @param {() => number} [rollFn] - override for tests; defaults to the real server-side die
 * @returns {Promise<{ outcome: string, mutations: object[], constraints: string[] }>}
 */
async function adjudicateAction(params, rollFn = rollDie) {
  const { proposedAction, canonWorld, save, worldState } = params;
  const dice = rollFn();
  return evaluate(proposedAction, worldState, save, dice, canonWorld);
}

module.exports = { evaluate, adjudicateAction, rollDie, DEFAULT_DIFFICULTY_CLASS };
