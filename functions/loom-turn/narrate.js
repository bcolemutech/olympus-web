'use strict';

/**
 * Stage 4 — NARRATE (design doc §5).
 *
 * The LLM (Flash) receives a canon snippet + current state + the FIXED
 * Resolution + rolling summary and writes prose. It may color *how*
 * something happened, never *whether* — the Resolution from ADJUDICATE
 * (./adjudicate.js) is final.
 *
 * STUB (L-110 / #297): returns a minimal templated acknowledgment with no
 * new entities and no suggested actions. Replaced by L-113 (#300) with a
 * real Flash call assembling canon (L-103 / #296) + entity-keyed retrieval
 * (L-117 / #304) + rolling summary (L-116 / #303) context.
 *
 * `inventedEntities` (added L-114 / #301) is the seam COMMIT's soft-canon
 * handoff (L-115 / #302) consumes: names the model mentions that don't match
 * a known canon/state entity. Always empty until L-113 adds real detection.
 *
 * @param {{
 *   actionText: string,
 *   proposedAction: object,
 *   resolution: object,
 *   canonWorld: object,
 *   save: object,
 *   worldState: object,
 * }} params
 * @returns {Promise<{
 *   narration: string,
 *   entityRefs: string[],
 *   inventedEntities: string[],
 *   suggestedActions: string[],
 * }>}
 */
async function narrateResolution(params) {
  const { actionText } = params;
  return {
    narration:
      'You attempt to ' + actionText + '. The Loom takes note, but has little more to say — yet.',
    entityRefs: [],
    inventedEntities: [],
    suggestedActions: [],
  };
}

module.exports = { narrateResolution };
