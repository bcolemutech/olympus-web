'use strict';

const { FieldValue } = require('firebase-admin/firestore');
const { callGemini } = require('../gemini');

/**
 * Rolling summary regeneration (design doc §4, §5 stage 5, §6 batch; L-116 /
 * #303).
 *
 * The event log is summarized, never dropped. COMMIT (functions/loom-turn/
 * commit.js) triggers this whenever the turn count crosses
 * SUMMARY_REGEN_THRESHOLD. Triggering is fire-and-forget (not awaited by
 * COMMIT) so it adds no per-turn latency, per the design doc.
 *
 * Condenses the most recent turns plus the existing recap into an updated
 * `loom_saves.recentSummary` via a single Flash call. The raw `loom_turns`
 * log itself is never touched here — it stays append-only and complete;
 * only the dense recap is ever regenerated/replaced.
 */

const SUMMARY_REGEN_THRESHOLD = 10;
const MODEL_NAME = 'gemini-2.5-flash';
const MAX_OUTPUT_TOKENS = 1024;
const MAX_SUMMARY_CHARS = 2000;

/** True once the (0-indexed) turnIndex completes a multiple of the threshold. */
function shouldRegenerateSummary(turnIndex) {
  return (turnIndex + 1) % SUMMARY_REGEN_THRESHOLD === 0;
}

function buildSystemInstruction() {
  return (
    'You are the summarizer for a persistent text-adventure game world. Condense the ' +
    'provided turn log into a dense recap of important, ongoing facts: where the character ' +
    'is, what they have done, who they have met, promises made, threats pending, and any ' +
    'other detail future turns need to remember.\n\n' +
    'Preserve hard facts exactly — never invent details, and never drop a fact that still ' +
    'matters. You will be given the PREVIOUS SUMMARY (may be empty) and the RECENT TURNS ' +
    'since. Merge them into a single updated summary that stays under ' +
    MAX_SUMMARY_CHARS +
    ' characters by trimming the least important older details first, never by dropping ' +
    'recent hard facts.\n\n' +
    'Respond with ONLY the updated summary as plain prose — no headings, no preamble, no ' +
    'commentary about the task.'
  );
}

function buildUserMessage(previousSummary, turns) {
  const turnLines = turns
    .map(
      (turn) =>
        '- Action: ' +
        turn.actionText +
        ' | Outcome: ' +
        turn.resolution.outcome +
        ' | Narration: ' +
        turn.narration
    )
    .join('\n');

  return (
    'PREVIOUS SUMMARY:\n' + (previousSummary || '(none yet)') + '\n\nRECENT TURNS:\n' + turnLines
  );
}

/** Calls Gemini to produce the updated summary text; falls back to the previous summary on failure. */
async function regenerateSummaryText(previousSummary, turns) {
  if (turns.length === 0) {
    return previousSummary || '';
  }

  let raw;
  try {
    raw = await callGemini({
      modelName: MODEL_NAME,
      systemInstruction: buildSystemInstruction(),
      userMessage: buildUserMessage(previousSummary, turns),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      jsonMode: false,
      thinkingBudget: 0,
    });
  } catch (err) {
    console.error('regenerateSummaryText: callGemini failed, keeping previous summary', err);
    return previousSummary || '';
  }

  const text = String(raw || '').trim();
  if (!text) {
    return previousSummary || '';
  }
  return text.length > MAX_SUMMARY_CHARS ? text.slice(0, MAX_SUMMARY_CHARS) : text;
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
  const { saveRef } = params;

  const turnsSnap = await saveRef
    .collection('loom_turns')
    .orderBy('index', 'desc')
    .limit(SUMMARY_REGEN_THRESHOLD)
    .get();
  if (turnsSnap.empty) {
    return;
  }
  const turns = turnsSnap.docs.map((doc) => doc.data()).reverse();

  const saveSnap = await saveRef.get();
  if (!saveSnap.exists) {
    return;
  }
  const previousSummary = saveSnap.data().recentSummary || '';

  const recentSummary = await regenerateSummaryText(previousSummary, turns);

  await saveRef.update({ recentSummary, updatedAt: FieldValue.serverTimestamp() });
}

module.exports = {
  SUMMARY_REGEN_THRESHOLD,
  MAX_SUMMARY_CHARS,
  shouldRegenerateSummary,
  maybeRegenerateSummary,
};
