'use strict';

/**
 * Stage 2 — INTERPRET (design doc §5).
 *
 * The LLM (Gemini 2.5 Flash, structured output) converts player free-text
 * into a proposed action — fuzzy intent only, no authority over state or
 * legality. See ADJUDICATE (./adjudicate.js) for where legality is decided.
 *
 * STUB (L-110 / #297): returns a passthrough proposedAction so the pipeline
 * runs end-to-end. Replaced by L-111 (#298) with a real Flash call.
 *
 * @param {{ actionText: string, canonWorld: object, save: object, worldState: object }} params
 * @returns {Promise<{ verb: string, targets: string[], params: object }>}
 */
async function interpretAction(params) {
  const { actionText } = params;
  return {
    verb: 'unknown',
    targets: [],
    params: { raw: actionText },
  };
}

module.exports = { interpretAction };
