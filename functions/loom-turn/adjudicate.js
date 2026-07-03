'use strict';

const crypto = require('crypto');

/**
 * Stage 3 — ADJUDICATE (design doc §5, §11 L-140).
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
 */

const DEFAULT_DIFFICULTY_CLASS = 10;

/** Server-side d20, generated fresh per call — never client- or model-supplied. */
function rollDie() {
  return crypto.randomInt(1, 21);
}

function evaluateMove(proposedAction, worldState, characterState, canonWorld) {
  const targetId = proposedAction.targets[0];
  const currentId = characterState.location;

  if (!currentId || !canonWorld.locations[currentId]) {
    return {
      outcome: 'blocked',
      mutations: [],
      constraints: ['You have nowhere established to move from yet.'],
    };
  }

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
    return {
      outcome: 'blocked',
      mutations: [],
      constraints: ["You can't get there directly from here."],
    };
  }

  const targetLocation = canonWorld.locations[targetId];
  const requiredAbility = targetLocation.rules && targetLocation.rules.requiresAbility;
  const abilities = characterState.abilities || [];
  if (requiredAbility && abilities.indexOf(requiredAbility) === -1) {
    return {
      outcome: 'blocked',
      mutations: [],
      constraints: [
        'You lack what it takes to make that crossing (requires: ' + requiredAbility + ').',
      ],
    };
  }

  return {
    outcome: 'success',
    mutations: [
      { target: 'save', op: 'set-flag', path: 'location', value: targetId },
      { op: 'increment', path: 'worldClock', value: 1 },
    ],
    constraints: ['You arrive at ' + targetLocation.name + '.'],
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
