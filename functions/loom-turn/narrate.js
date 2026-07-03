'use strict';

const { callGemini } = require('../gemini');
const loomCanon = require('../loom-canon');
const { buildKnownEntities } = require('./interpret');
const { retrieveContextForEntities } = require('./retrieval');

/**
 * Stage 4 — NARRATE (design doc §5).
 *
 * The LLM (Flash) receives a canon snippet + current state + the FIXED
 * Resolution + rolling summary and writes prose. It may color *how*
 * something happened, never *whether* — the Resolution from ADJUDICATE
 * (./adjudicate.js) is final, and its outcome/constraints are supplied to
 * the model as unchangeable hard facts, never as something to (re)decide.
 *
 * Context assembly (design doc §5 stage 4, §4 memory layers):
 *   - Canon snippets (L-103 / #296) for entities relevant to this scene
 *   - Entity-keyed history + disposition (L-117 / #304) for those entities
 *   - The rolling summary (L-116 / #303) — the dense recap of everything
 *     older than the entity-keyed detail above
 *   - The fixed Resolution's outcome + narrative_constraints
 *
 * "Relevant entities" = the current location's default canon cast
 * (npcIds/factionIds) union the proposed action's resolved targets,
 * filtered to ids that actually resolve against canon.
 *
 * Any name the model uses that isn't in the supplied known-entities list is
 * returned in `inventedEntities` for COMMIT to hand off to soft-canon
 * quarantine (L-115 / #302) — captured here, quarantined there.
 *
 * Any Gemini failure or malformed response falls back to a safe narration
 * built directly from the Resolution's own constraints, so the client never
 * sees an unresolved turn and the fallback still can't contradict the facts.
 */

const MODEL_NAME = 'gemini-2.5-flash';
const MAX_OUTPUT_TOKENS = 1024;

function buildSystemInstruction(knownEntities) {
  const entityList = knownEntities
    .map((e) => '- ' + e.id + ' (' + e.kind + '): ' + e.name)
    .join('\n');

  return (
    'You are the narrator for a persistent text-adventure game world. You receive a FIXED ' +
    'Resolution that has already been decided by a separate deterministic system. You may ' +
    'color HOW something happened, but never WHETHER it happened — never contradict the ' +
    "Resolution's outcome or any of its listed hard facts (narrative constraints).\n\n" +
    'Write 1-3 short second-person paragraphs narrating the result, consistent with the ' +
    'supplied canon, entity history, and rolling summary. Do not contradict established ' +
    'facts.\n\n' +
    'Known entities already established in this world:\n' +
    entityList +
    '\n\n' +
    'If your narration names a character, place, or faction NOT in that list, list its exact ' +
    'name in inventedEntities so it can be tracked as provisional. Most narration invents no ' +
    'new named entities at all — leave this empty unless you actually named someone/somewhere ' +
    'new.\n\n' +
    'Optionally suggest 2-4 short next actions as plain phrases (e.g. "search the wreck"). ' +
    'Leave empty if nothing obvious suggests itself.\n\n' +
    'Respond with ONLY a JSON object: { "narration": string, "inventedEntities": string[], ' +
    '"suggestedActions": string[] }'
  );
}

function buildEntitySection(canonWorldId, context) {
  const snippet = loomCanon.getEntitySnippet(canonWorldId, context.entityId);
  const historyText = context.turns.length
    ? context.turns.map((turn) => '  - ' + turn.narration).join('\n')
    : '  (no prior history)';
  const dispositionText = context.disposition
    ? 'Disposition: ' + context.disposition
    : 'Disposition: unknown';

  return (
    'Entity: ' +
    context.entityId +
    '\n' +
    (snippet ? snippet + '\n' : '') +
    dispositionText +
    '\nRecent history:\n' +
    historyText
  );
}

function buildUserMessage(params) {
  const { actionText, resolution, canonWorldId, entityContexts, recentSummary } = params;

  const constraintsText =
    (resolution.constraints || []).map((c) => '- ' + c).join('\n') || '(none)';
  const entitySections =
    entityContexts.map((ctx) => buildEntitySection(canonWorldId, ctx)).join('\n\n') || '(none)';

  return (
    'PLAYER ACTION:\n' +
    actionText +
    '\n\n' +
    'RESOLUTION (final — do not contradict):\n' +
    'Outcome: ' +
    resolution.outcome +
    '\n' +
    'Hard facts:\n' +
    constraintsText +
    '\n\n' +
    'ROLLING SUMMARY:\n' +
    (recentSummary || '(none yet)') +
    '\n\n' +
    'RELEVANT ENTITIES:\n' +
    entitySections
  );
}

function isValidRawNarration(raw) {
  return (
    !!raw &&
    typeof raw === 'object' &&
    typeof raw.narration === 'string' &&
    raw.narration.length > 0
  );
}

function fallbackNarration(actionText, resolution) {
  const constraintsText = (resolution.constraints || []).join(' ');
  return {
    narration: ('You ' + actionText + '. ' + constraintsText).trim(),
    inventedEntities: [],
    suggestedActions: [],
  };
}

function sanitizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter((v) => typeof v === 'string' && v.trim().length > 0)
    : [];
}

/** Relevant entities for this scene: the location's default cast plus the action's resolved targets. */
function resolveSceneEntityIds(canonWorld, save, proposedAction) {
  const currentLocation = save.location && canonWorld.locations[save.location];
  const sceneEntityIds = currentLocation
    ? [].concat(currentLocation.npcIds || [], currentLocation.factionIds || [])
    : [];
  const candidateIds = Array.from(new Set(sceneEntityIds.concat(proposedAction.targets || [])));
  return candidateIds.filter((id) => !!loomCanon.getEntity(canonWorld.id, id));
}

/**
 * @param {{
 *   actionText: string,
 *   proposedAction: object,
 *   resolution: { outcome: string, mutations: object[], constraints: string[] },
 *   canonWorld: object,
 *   save: object,
 *   worldState: object,
 *   saveRef: FirebaseFirestore.DocumentReference,
 * }} params
 * @returns {Promise<{
 *   narration: string,
 *   entityRefs: string[],
 *   inventedEntities: string[],
 *   suggestedActions: string[],
 * }>}
 */
async function narrateResolution(params) {
  const { actionText, proposedAction, resolution, canonWorld, save, saveRef } = params;

  const entityRefs = resolveSceneEntityIds(canonWorld, save, proposedAction);
  const entityContexts = await retrieveContextForEntities({ saveRef, save, entityIds: entityRefs });
  const knownEntities = buildKnownEntities(canonWorld);

  let raw;
  try {
    raw = await callGemini({
      modelName: MODEL_NAME,
      systemInstruction: buildSystemInstruction(knownEntities),
      userMessage: buildUserMessage({
        actionText,
        resolution,
        canonWorldId: canonWorld.id,
        entityContexts,
        recentSummary: save.recentSummary,
      }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      jsonMode: true,
      thinkingBudget: 0,
    });
  } catch (err) {
    console.error('narrateResolution: callGemini failed, falling back to constraint recap', err);
    return Object.assign({ entityRefs }, fallbackNarration(actionText, resolution));
  }

  if (!isValidRawNarration(raw)) {
    console.error(
      'narrateResolution: malformed model output, falling back to constraint recap',
      raw
    );
    return Object.assign({ entityRefs }, fallbackNarration(actionText, resolution));
  }

  return {
    narration: raw.narration,
    entityRefs,
    inventedEntities: sanitizeStringArray(raw.inventedEntities),
    suggestedActions: sanitizeStringArray(raw.suggestedActions),
  };
}

module.exports = { narrateResolution, resolveSceneEntityIds };
