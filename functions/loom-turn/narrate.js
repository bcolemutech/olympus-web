'use strict';

const { callGemini } = require('../gemini');
const loomCanon = require('../loom-canon');
const { isPlayable, isPlaceOpen } = require('../loom-canon/grading');
const town = require('../loom-canon/town');
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

function buildEntitySection(canonWorld, context) {
  const snippet = loomCanon.entitySnippet(canonWorld, context.entityId);
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

// Where the player stands once this action resolves: a successful move's
// destination, or where they already were (NARRATE runs before COMMIT).
function positionAfter(save, resolution) {
  const change = (path) =>
    (resolution.mutations || []).find((m) => m.target === 'save' && m.path === path);
  const move = change('location');
  const step = change('placeId');
  return {
    location: move ? move.value : save.location,
    // A move across the map leaves town unless it lands somewhere in the next.
    placeId: step ? step.value : move ? null : save.placeId,
  };
}

// The ways on from where the player ends up, each open or closed (the Layered
// Worlds gate, L-322 / #391), so the narrator never describes the far side of
// a place players can't enter.
// In a town with a layout (L-342), the ways on are the town's own links and,
// from an entrance, the routes out that it serves.
function buildTownExitsSection(canonWorld, settlement, place) {
  const links = (settlement.geo && settlement.geo.links) || {};
  const exits = (place.connections || [])
    .map((id) => canonWorld.places[id])
    .filter(Boolean)
    .map((to) => ({ label: to.name + ' (' + to.id + ')', open: isPlaceOpen(canonWorld, to) }));
  if (town.isEntrance(place)) {
    (settlement.connections || [])
      .map((id) => canonWorld.locations[id])
      .filter((to) => to && town.serves(place, links[to.id]))
      .forEach((to) => {
        exits.push({
          label:
            to.name + ' (' + to.id + '), out of town' + (links[to.id] ? ' by ' + links[to.id] : ''),
          open: isPlayable(canonWorld, to),
        });
      });
  }
  if (!exits.length) return '';
  const note = exits.some((exit) => !exit.open)
    ? 'Closed ways are barred to the player: describe them as closed or impassable, never ' +
      'what lies beyond them.\n'
    : '';
  return (
    'WAYS ON FROM ' +
    place.name +
    ', ' +
    settlement.name +
    ':\n' +
    note +
    exits.map(({ label, open }) => '- ' + label + ': ' + (open ? 'open' : 'CLOSED')).join('\n')
  );
}

function buildExitsSection(canonWorld, position) {
  const locationId = position.location;
  const here = locationId && canonWorld.locations[locationId];
  if (!here) return '';
  const place = town.positionOf(canonWorld, position).place;
  if (place) return buildTownExitsSection(canonWorld, here, place);
  const links = (here.geo && here.geo.links) || {};
  const exits = (here.connections || [])
    .map((id) => canonWorld.locations[id])
    .filter(Boolean)
    .map((place) => ({ place, open: isPlayable(canonWorld, place) }));
  if (!exits.length) return '';
  const lines = exits.map(
    ({ place, open }) =>
      '- ' +
      place.name +
      ' (' +
      place.id +
      ')' +
      (links[place.id] ? ', by ' + links[place.id] : '') +
      ': ' +
      (open ? 'open' : 'CLOSED')
  );
  const note = exits.some((exit) => !exit.open)
    ? 'Closed ways are barred to the player: describe them as closed or impassable, never ' +
      'what lies beyond them.\n'
    : '';
  return 'WAYS ON FROM ' + here.name + ':\n' + note + lines.join('\n');
}

function buildUserMessage(params) {
  const { actionText, resolution, canonWorld, entityContexts, recentSummary, exitsSection } =
    params;

  const constraintsText =
    (resolution.constraints || []).map((c) => '- ' + c).join('\n') || '(none)';
  const entitySections =
    entityContexts.map((ctx) => buildEntitySection(canonWorld, ctx)).join('\n\n') || '(none)';

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
    entitySections +
    (exitsSection ? '\n\n' + exitsSection : '')
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
  const place = currentLocation && town.positionOf(canonWorld, save).place;
  let sceneEntityIds = currentLocation
    ? [].concat(currentLocation.npcIds || [], currentLocation.factionIds || [])
    : [];
  if (place) {
    // In a town with a layout (L-342): the people at this place, and residents
    // with no place of their own, who could be anywhere about town.
    const aboutTown = Object.values(canonWorld.characters || {})
      .filter((c) => c.locationId === currentLocation.id && (!c.placeId || c.placeId === place.id))
      .map((c) => c.id);
    sceneEntityIds = [].concat(place.npcIds || [], aboutTown, currentLocation.factionIds || []);
  }
  const candidateIds = Array.from(new Set(sceneEntityIds.concat(proposedAction.targets || [])));
  // Works on the loaded world object (static or Firestore-backed); retired
  // entities are absent from the scene.
  return candidateIds.filter((id) => {
    const resolved = loomCanon.findEntity(canonWorld, id);
    return Boolean(resolved) && !resolved.entity.retired;
  });
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
  const knownEntities = buildKnownEntities(canonWorld, save);

  let raw;
  try {
    raw = await callGemini({
      modelName: MODEL_NAME,
      systemInstruction: buildSystemInstruction(knownEntities),
      userMessage: buildUserMessage({
        actionText,
        resolution,
        canonWorld,
        entityContexts,
        recentSummary: save.recentSummary,
        exitsSection: buildExitsSection(canonWorld, positionAfter(save, resolution)),
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
