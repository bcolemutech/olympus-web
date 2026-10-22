'use strict';

const { callGemini } = require('../gemini');
const maps = require('../loom-canon/maps');
const { doorSides } = require('./steps');
const { peopleInSight } = require('./seen');
const clock = require('../loom-canon/clock');
const checks = require('../loom-canon/checks');
const sheets = require('../loom-canon/sheets');
const { attacksOf } = require('../loom-modules/combat/attacks');

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

function buildSystemInstruction(knownEntities, save, canonWorld) {
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
    // The time now (L-375; game time T14), to read the player by ("wait
    // until dusk"); it is not for deciding anything.
    'TIME: ' +
    clock.timeLine(clock.timeOf(save)) +
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
    checksSection(canonWorld) +
    attacksSection(canonWorld, save) +
    // Letting time pass (L-374; game time T12).
    'To let time pass ("wait an hour", "rest until evening", "sleep until dawn"), use the ' +
    'verb "wait" with params {"minutes": number} for a length of time, or {"until": part} ' +
    'for a time of day, where part is one of dawn, morning, midday, afternoon, evening or ' +
    'night; add {"how": "sleep"} or {"how": "rest"} when the player sleeps or rests. For a ' +
    'short rest or a long rest (to recover), use the verb "rest" with params {"rest": ' +
    '"short"} or {"rest": "long"}.\n\n' +
    'Respond with ONLY a JSON object: { "verb": string, "targets": string[], "params": object }'
  );
}

// The world's game system's lists, to propose a check from (L-803; game
// systems DC3, DC4): its skills (or attributes) and its difficulty rungs, by
// name. The model picks a rung, never a number, and decides nothing.
function checksSection(canonWorld) {
  const system = checks.systemOf(canonWorld);
  const sheet = system.sheet || {};
  const skills = (sheet.optional || []).includes('skills') ? sheet.skills || [] : [];
  const names = (list, show) => list.map(show).join(', ');
  return (
    'When the action’s outcome is uncertain and needs a roll (sneaking, climbing, ' +
    'persuading, searching), add params.check: { "skill": id, "rung": name }, or ' +
    '{ "attribute": id, "rung": name } when no skill fits, and "opposedBy": a character id ' +
    'when someone resists it. Pick the rung for how hard it is; never give a number. ' +
    'Leave check out for actions that need no roll.\n' +
    (skills.length ? 'Skills: ' + names(skills, (k) => `${k.id} (${k.attribute})`) + '.\n' : '') +
    'Attributes: ' +
    names(sheet.attributes || [], (a) => `${a.id} (${a.name})`) +
    '.\n' +
    'Difficulty, easiest first: ' +
    names(system.checks.ladder, (r) => r.name) +
    '.\n\n'
  );
}

// Attacking (L-822): the verb, the target, and which of the character's
// attacks; the rules roll it, so no check.
function attacksSection(canonWorld, save) {
  const system = checks.systemOf(canonWorld);
  const sheet = sheets.sheetOf(save) || sheets.defaultSheet(system);
  const list = attacksOf(system, sheet, { player: true });
  return (
    'To attack someone, use the verb "attack", target their id, and add params.attack: ' +
    'the id of the attack they use (' +
    list.map((a) => `${a.id} (${a.name})`).join(', ') +
    '; leave it out if they name none), and params.subdue: true when they mean to knock ' +
    'out rather than kill. Never add a check to an attack.\n\n'
  );
}

// A proposed check as ADJUDICATE reads it (L-803): its known keys as text,
// the person it is against resolved to an id; anything else dropped.
function cleanCheck(check, resolve) {
  if (!check || typeof check !== 'object') return undefined;
  const out = {};
  for (const key of ['skill', 'attribute', 'rung']) {
    if (typeof check[key] === 'string' && check[key].trim()) out[key] = check[key].trim();
  }
  if (typeof check.opposedBy === 'string' && check.opposedBy.trim()) {
    out.opposedBy = resolve(check.opposedBy.trim());
  }
  return Object.keys(out).length ? out : undefined;
}

// The things on the battle map a save stands on (L-351), targeted as
// "feature:<id>", "exit:<id>" and "door:<id>" (L-626): `seen` says whether
// the save has seen each (`known`, keyed "x,y", L-635; a door, from either
// side; without it, all have been).
function mapEntities(canonWorld, save, known) {
  const onMap = save ? maps.positionOf(canonWorld, save).map : null;
  if (!onMap) return [];
  const at = (square) => !known || Boolean(known[square.x + ',' + square.y]);
  return [].concat(
    (onMap.features || []).map((f) => ({
      id: 'feature:' + f.id,
      name: f.name,
      kind: 'feature here',
      seen: at(f),
    })),
    (onMap.exits || []).map((e) => ({
      id: 'exit:' + e.id,
      name: e.name,
      kind: 'way out of here',
      seen: at(e),
    })),
    (onMap.doors || []).map((d) => ({
      id: 'door:' + d.id,
      name: d.name || 'a door',
      kind: 'door here',
      seen: doorSides(d).some(at),
    }))
  );
}

// The world's places, realms and characters, plus the places of the town the
// player is in (L-342), so "go to the market" resolves to that town's market.
// On a battle map, first the things there the save has seen (L-636 / #459):
// only those are named to the model.
function buildKnownEntities(canonWorld, save, known) {
  const entities = mapEntities(canonWorld, save, known)
    .filter((e) => e.seen)
    .map(({ id, name, kind }) => ({ id, name, kind }));
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

// On a battle map, the people in sight (L-643 / #462) come first, marked so,
// and whether they are beside the player: "talk to her" and "grab the old
// woman" find them. Everyone else stays a plain character, never placed.
function withPeopleInSight(entities, canonWorld, save) {
  const people = save ? peopleInSight(canonWorld, save) : [];
  if (!people.length) return entities;
  const ids = new Set(people.map((p) => p.character.id));
  return people
    .map(({ character, cell, beside }) => ({
      id: character.id,
      name: character.name,
      kind:
        'person in sight here, at (' +
        cell.x +
        ', ' +
        cell.y +
        ')' +
        (beside ? ', beside the player' : ''),
    }))
    .concat(entities.filter((e) => !ids.has(e.id)));
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
 * On a battle map, the model is told only what the save has seen there
 * (`known`, L-636). A target it can't match to those is still matched to the
 * map's unseen things, here and never in the prompt, so ADJUDICATE can turn
 * it down as out of sight rather than treat it as made up.
 *
 * @param {{ actionText: string, canonWorld: object, save: object, worldState: object,
 *           known?: object }} params
 * @returns {Promise<{ verb: string, targets: string[], params: object }>}
 */
async function interpretAction(params) {
  const { actionText, canonWorld, save, known } = params;
  const knownEntities = withPeopleInSight(
    buildKnownEntities(canonWorld, save, known),
    canonWorld,
    save
  );
  const unseen = mapEntities(canonWorld, save, known).filter((e) => !e.seen);
  const resolve = (target) => {
    const resolved = resolveTarget(target, knownEntities);
    const matched = knownEntities.some((e) => e.id === resolved);
    return matched || !unseen.length ? resolved : resolveTarget(target, unseen);
  };

  let raw;
  try {
    raw = await callGemini({
      modelName: MODEL_NAME,
      systemInstruction: buildSystemInstruction(knownEntities, save, canonWorld),
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
    targets: raw.targets.map(resolve),
    params: withCheck(raw.params && typeof raw.params === 'object' ? raw.params : {}, resolve),
  };
}

function withCheck(params, resolve) {
  if (!('check' in params)) return params;
  const { check, ...rest } = params;
  const clean = cleanCheck(check, resolve);
  return clean ? { ...rest, check: clean } : rest;
}

module.exports = { interpretAction, resolveTarget, buildKnownEntities, normalizeName: normalize };
