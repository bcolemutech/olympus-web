'use strict';

/**
 * Rolling summary regeneration (design doc §4, §5 stage 5, §6 batch; L-116 /
 * #303).
 *
 * The event log is summarized, never dropped. COMMIT (functions/loom-turn/
 * commit.js) triggers this whenever the turn count crosses
 * SUMMARY_REGEN_THRESHOLD. Triggering is fire-and-forget (not awaited by
 * COMMIT) so it adds no per-turn latency, per the design doc.
 *
 * STUB (L-114 / #301): the threshold check and trigger point exist and are
 * wired into COMMIT, but regeneration itself is a no-op. Replaced by L-116
 * (#303) with a real callGemini call condensing loom_turns into
 * loom_saves.recentSummary.
 */

const SUMMARY_REGEN_THRESHOLD = 10;

/** True once the (0-indexed) turnIndex completes a multiple of the threshold. */
function shouldRegenerateSummary(turnIndex) {
  return (turnIndex + 1) % SUMMARY_REGEN_THRESHOLD === 0;
}

/**
 * @param {{
 *   db: FirebaseFirestore.Firestore,
 *   saveRef: FirebaseFirestore.DocumentReference,
 *   worldId: string,
 *   turnIndex: number,
 * }} params
 */
async function maybeRegenerateSummary(params) {
  // L-116 (#303) will condense loom_turns into recentSummary here.
}

module.exports = { SUMMARY_REGEN_THRESHOLD, shouldRegenerateSummary, maybeRegenerateSummary };
