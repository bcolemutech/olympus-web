'use strict';

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
 * of evaluate() without reshaping the pipeline.
 *
 * STUB (L-110 / #297): evaluate() always returns a no-op acknowledgment with
 * no mutations and no constraints. Replaced by L-112 (#299) with the real
 * hand-coded rules engine + server dice.
 *
 * @param {object} proposedAction
 * @param {object} worldState
 * @param {object} characterState
 * @param {*} dice
 * @returns {{ outcome: string, mutations: object[], constraints: string[] }}
 */
function evaluate(proposedAction, worldState, characterState, dice) {
  return {
    outcome: 'acknowledged',
    mutations: [],
    constraints: [],
  };
}

/**
 * @param {{ proposedAction: object, canonWorld: object, save: object, worldState: object }} params
 * @returns {Promise<{ outcome: string, mutations: object[], constraints: string[] }>}
 */
async function adjudicateAction(params) {
  const { proposedAction, save, worldState } = params;
  // Server-side dice belongs here once real rules land (L-112); none needed yet.
  const dice = null;
  return evaluate(proposedAction, worldState, save, dice);
}

module.exports = { evaluate, adjudicateAction };
