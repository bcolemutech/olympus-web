'use strict';

const crypto = require('crypto');
const { isPlayable, isPlaceOpen } = require('../loom-canon/grading');
const town = require('../loom-canon/town');

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
  if (here && here.id === target.id) {
    return { outcome: 'no_op', mutations: [], constraints: ["You're already there."] };
  }
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
      { op: 'increment', path: 'worldClock', value: 1 },
    ],
    constraints: ['You make your way to ' + target.name + '.'],
  };
}

function evaluateMove(proposedAction, worldState, characterState, canonWorld) {
  const targetId = proposedAction.targets[0];
  const currentId = characterState.location;

  if (!currentId || !canonWorld.locations[currentId]) {
    return blocked('You have nowhere established to move from yet.');
  }

  const targetPlace = targetId && (canonWorld.places || {})[targetId];
  if (targetPlace) return evaluateTownMove(targetPlace, characterState, canonWorld);

  if (!targetId || !canonWorld.locations[targetId]) {
    return {
      outcome: 'invalid_target',
      mutations: [],
      constraints: ["There's no such place to go."],
    };
  }

  if (targetId === currentId) {
    return {
      outcome: 'no_op',
      mutations: [],
      constraints: ["You're already there."],
    };
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

  // Arriving at a town lands at the open entrance serving the route.
  const arrival = town.arrivalPlace(canonWorld, targetId, via);
  const mutations = [{ target: 'save', op: 'set-flag', path: 'location', value: targetId }];
  if (arrival || characterState.placeId) {
    mutations.push({
      target: 'save',
      op: 'set-flag',
      path: 'placeId',
      value: arrival ? arrival.id : null,
    });
  }
  mutations.push({ op: 'increment', path: 'worldClock', value: 1 });
  return {
    outcome: 'success',
    mutations,
    constraints: [
      'You arrive at ' + targetLocation.name + (arrival ? ', at ' + arrival.name : '') + '.',
    ],
  };
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
