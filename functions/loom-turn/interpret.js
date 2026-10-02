'use strict';

const { callGemini } = require('../gemini');

/**
 * Stage 2 — INTERPRET (design doc §5).
 *
 * The LLM (Gemini 2.5 Flash, structured output) converts player free-text
 * into a proposed action — fuzzy intent only, no authority over state or
 * legality. See ADJUDICATE (./adjudicate.js) for where legality is decided.
 *
 * Target strings the model returns are resolved against the world's known
 * canon entities (fuzzy match on id/name); anything that doesn't resolve is
 * passed through as raw text for ADJUDICATE to treat as unresolved rather
 * than crashing the turn.
 *
 * Any Gemini failure or malformed response falls back to a safe passthrough
 * proposedAction — INTERPRET never blocks a turn from reaching ADJUDICATE.
 */

const MODEL_NAME = 'gemini-2.5-flash';
const MAX_OUTPUT_TOKENS = 512;

function buildSystemInstruction(knownEntities) {
  const entityList = knownEntities
    .map((e) => '- ' + e.id + ' (' + e.kind + '): ' + e.name)
    .join('\n');

  return (
    'You are the INTERPRET stage of a text adventure turn pipeline. Your ONLY job is to ' +
    "parse the player's free-text action into a structured intent. You do NOT decide " +
    'whether the action succeeds, fails, or is legal — a separate deterministic system ' +
    'decides that. Never invent outcomes, dice rolls, or state changes.\n\n' +
    'Known entities in this world:\n' +
    entityList +
    '\n\n' +
    'Extract from the player action:\n' +
    '- verb: a short lowercase snake_case verb summarizing the intent (e.g. "look", ' +
    '"move", "attack", "talk", "take", "use")\n' +
    '- targets: an array of strings naming entities the action refers to. Use the exact ' +
    'id from the known-entities list when the player clearly means one of them; ' +
    'otherwise include the raw text mentioned. To travel to a town by one of its ways in ' +
    '("to Daldockley by the King\'s Causeway"), target that way in.\n' +
    '- params: an object of any other relevant details (e.g. {"item": "sword"}). Use an ' +
    'empty object if there are none.\n\n' +
    'Respond with ONLY a JSON object: { "verb": string, "targets": string[], "params": object }'
  );
}

// The world's places, realms and characters, plus the places of the town the
// player is in (L-342), so "go to the market" resolves to that town's market.
function buildKnownEntities(canonWorld, save) {
  const entities = [];
  // Retired entities (soft-removed from a published world) can't be targeted.
  const live = (entity) => !entity.retired;
  Object.values(canonWorld.locations)
    .filter(live)
    .forEach((location) => {
      entities.push({ id: location.id, name: location.name, kind: 'location' });
    });
  Object.values(canonWorld.factions)
    .filter(live)
    .forEach((faction) => {
      entities.push({ id: faction.id, name: faction.name, kind: 'faction' });
    });
  Object.values(canonWorld.characters)
    .filter(live)
    .forEach((character) => {
      entities.push({ id: character.id, name: character.name, kind: 'character' });
    });
  const here = save && save.location;
  Object.values(canonWorld.places || {})
    .filter((place) => live(place) && place.locationId === here)
    .forEach((place) => {
      entities.push({ id: place.id, name: place.name, kind: 'place' });
    });
  // The ways into the towns next to here (L-346), so "to Daldockley by the
  // King's Causeway" can name where to arrive. After the town's own places,
  // so a name both share ("The Harbour") means the one here.
  const neighbours = new Set((here && (canonWorld.locations[here] || {}).connections) || []);
  Object.values(canonWorld.places || {})
    .filter((place) => live(place) && place.entrance && neighbours.has(place.locationId))
    .forEach((place) => {
      const town = canonWorld.locations[place.locationId];
      entities.push({ id: place.id, name: place.name, kind: 'way into ' + town.name });
    });
  return entities;
}

function normalize(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Resolves a raw target string to a known entity id, or returns it unchanged if no match. */
function resolveTarget(rawTarget, knownEntities) {
  // An exact id first: Cartographer ids (loc_1, plc_1_tavern) contain
  // underscores, which normalizing would turn into dashes — and the fuzzy
  // match below would then find any place whose name appears in the id
  // ("plc-1-tavern" contains "ver").
  const exact = knownEntities.find((e) => e.id === String(rawTarget).trim());
  if (exact) return exact.id;

  const normalized = normalize(rawTarget);

  const byId = knownEntities.find((e) => e.id === normalized);
  if (byId) return byId.id;

  const byName = knownEntities.find((e) => normalize(e.name) === normalized);
  if (byName) return byName.id;

  const fuzzy = knownEntities.find((e) => {
    const normalizedName = normalize(e.name);
    return normalizedName.includes(normalized) || normalized.includes(normalizedName);
  });
  if (fuzzy) return fuzzy.id;

  return rawTarget;
}

function isValidRawProposedAction(raw) {
  return (
    !!raw && typeof raw === 'object' && typeof raw.verb === 'string' && Array.isArray(raw.targets)
  );
}

/** Safe passthrough used whenever the model call fails or returns something malformed. */
function fallbackProposedAction(actionText) {
  return { verb: 'unknown', targets: [], params: { raw: actionText } };
}

/**
 * @param {{ actionText: string, canonWorld: object, save: object, worldState: object }} params
 * @returns {Promise<{ verb: string, targets: string[], params: object }>}
 */
async function interpretAction(params) {
  const { actionText, canonWorld, save } = params;
  const knownEntities = buildKnownEntities(canonWorld, save);

  let raw;
  try {
    raw = await callGemini({
      modelName: MODEL_NAME,
      systemInstruction: buildSystemInstruction(knownEntities),
      userMessage: actionText,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      jsonMode: true,
      thinkingBudget: 0,
    });
  } catch (err) {
    console.error('interpretAction: callGemini failed, falling back to passthrough', err);
    return fallbackProposedAction(actionText);
  }

  if (!isValidRawProposedAction(raw)) {
    console.error('interpretAction: malformed model output, falling back to passthrough', raw);
    return fallbackProposedAction(actionText);
  }

  return {
    verb: raw.verb.toLowerCase().slice(0, 50),
    targets: raw.targets.map((t) => resolveTarget(t, knownEntities)),
    params: raw.params && typeof raw.params === 'object' ? raw.params : {},
  };
}

module.exports = { interpretAction, resolveTarget, buildKnownEntities, normalizeName: normalize };
