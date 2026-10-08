'use strict';

const { callGemini } = require('../gemini');
const loomCanon = require('../loom-canon');
const { isPlayable, isPlaceOpen } = require('../loom-canon/grading');
const town = require('../loom-canon/town');
const maps = require('../loom-canon/maps');
const { buildKnownEntities } = require('./interpret');
const { retrieveContextForEntities } = require('./retrieval');
const { turnStateOf, speedOf } = require('../loom-models');
const { doorStatesOf, doorSides } = require('./steps');
const layers = require('../loom-canon/layers');
const sight = require('../loom-canon/sight');
const { recordOf, squaresOf } = require('./seen');

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
  const onto = change('mapId');
  const cell = change('cell');
  return {
    location: move ? move.value : save.location,
    // A move across the map leaves town unless it lands somewhere in the next.
    placeId: step ? step.value : move ? null : save.placeId,
    // A battle map (L-351): a move between places leaves it unless it lands on one.
    mapId: onto ? onto.value : move || step ? null : save.mapId || null,
    cell: cell ? cell.value : onto || move || step ? null : save.cell || null,
  };
}

// A battle map's doors as this resolution leaves them (L-626): this save's own.
function doorsAfter(save, map, resolution) {
  const states = { ...doorStatesOf(save, map.id) };
  const prefix = 'doors.' + map.id + '.';
  for (const m of (resolution && resolution.mutations) || []) {
    if (m.target === 'save' && m.path.indexOf(prefix) === 0) {
      states[m.path.slice(prefix.length)] = m.value;
    }
  }
  return states;
}

/**
 * What the player sees and remembers of the battle map they stand on once
 * this resolves (planning/the-loom-movement-and-vision.md §5; L-636 / #459):
 * `inSight` from where they stand, with the doors as this leaves them; and
 * `known`, what they had seen there (`known` from intake, or for a map just
 * stepped onto, its record, ./seen.js) and see now. Without `known` (the
 * rules alone, as in tests) all of the map counts as known (`known` null).
 * Null off a map.
 */
async function mapSightAfter(canonWorld, save, position, resolution, known, saveRef) {
  const { map, cell } = maps.positionOf(canonWorld, position);
  if (!map) return null;
  const inSight = sight.inSight(map, cell, doorsAfter(save, map, resolution));
  let before = known;
  if (position.mapId !== save.mapId) {
    const { record } = saveRef ? await recordOf(null, saveRef, map.id) : { record: null };
    before = saveRef ? squaresOf(record, map) : null;
  }
  return { inSight, known: before ? Object.assign({}, before, inSight) : null };
}

// Where the player stands on a battle map (L-351), and how they can leave it:
// on a map, its exits are the only ways on. The narrator is told only what
// the player sees there, and what they remember seeing (L-636): never what
// they haven't seen.
function buildMapSection(canonWorld, position, save, resolution, view) {
  const { map, cell } = maps.positionOf(canonWorld, position);
  const host = maps.hostOf(canonWorld, position);
  const there = maps.at(map, cell);
  const spot = (item) => item.name + ' (' + item.x + ', ' + item.y + ')';
  const key = (square) => square.x + ',' + square.y;
  const inSight = (square) => !view || Boolean(view.inSight[key(square)]);
  const known = (square) => !view || !view.known || Boolean(view.known[key(square)]);
  const remembered = (square) => known(square) && !inSight(square);
  const AWAY = ', out of sight now: ';
  const lines = [
    'ON THE MAP OF ' +
      (host ? host.name : map.name) +
      ' (' +
      map.name +
      ', ' +
      map.width +
      ' × ' +
      map.height +
      ' cells): the player stands at (' +
      cell.x +
      ', ' +
      cell.y +
      ')' +
      (there.feature ? ', at ' + there.feature.name : '') +
      '.',
    'The player knows only what is listed here: what is in sight, and what they remember ' +
      "seeing that's out of sight now. Never describe anything else on this map, nor anything " +
      'remembered as if it were in view.',
  ];
  const features = map.features || [];
  const featuresNow = features.filter(inSight);
  const featuresThen = features.filter(remembered);
  if (featuresNow.length) lines.push('Features: ' + featuresNow.map(spot).join('; ') + '.');
  if (featuresThen.length) {
    lines.push('Features remembered' + AWAY + featuresThen.map(spot).join('; ') + '.');
  }
  // Its doors, as they stand once this resolves (L-626): this save's own. A
  // door is seen from either side of it.
  const states = doorsAfter(save, map, resolution);
  const door = (d) => (d.name || 'a door') + ' (' + layers.doorState(d, states) + ')';
  const doorsNow = (map.doors || []).filter((d) => doorSides(d).some(inSight));
  const doorsThen = (map.doors || []).filter(
    (d) => !doorSides(d).some(inSight) && doorSides(d).some(known)
  );
  if (doorsNow.length) lines.push('Doors: ' + doorsNow.map(door).join('; ') + '.');
  if (doorsThen.length) {
    lines.push('Doors remembered' + AWAY + doorsThen.map(door).join('; ') + '.');
  }
  const exits = (map.exits || []).filter(known);
  if (exits.length) {
    lines.push('Ways out (the only ways on from here):');
    exits.forEach((exit) => {
      const to =
        exit.to && typeof exit.to === 'object' ? (canonWorld.battleMaps || {})[exit.to.map] : null;
      lines.push(
        '- ' +
          spot(exit) +
          ': ' +
          (to ? 'to ' + to.name : 'out of ' + (host ? host.name : map.name)) +
          (inSight(exit) ? '' : ' (remembered, out of sight now)')
      );
    });
  }
  return lines.join('\n');
}

// The ways on from where the player ends up, each open or closed (the Layered
// Worlds gate, L-322 / #391), so the narrator never describes the far side of
// a place players can't enter.
// In a town with a layout (L-342), the ways on are every place the player can
// walk to in one move (L-600 / #433), nearest first, and, from an entrance,
// the routes out that it serves.
function buildTownExitsSection(canonWorld, settlement, place, save) {
  const links = (settlement.geo && settlement.geo.links) || {};
  const exits = town
    .reachableFrom(canonWorld, settlement.id, place, town.passableFor(canonWorld, save))
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

// `save` gives the character, for what it may walk through in town; `view`,
// what they see and remember of a battle map (mapSightAfter).
function buildExitsSection(canonWorld, position, save, resolution, view) {
  const locationId = position.location;
  const here = locationId && canonWorld.locations[locationId];
  if (!here) return '';
  const onMap = maps.positionOf(canonWorld, position).map;
  if (onMap && (onMap.exits || []).length) {
    return buildMapSection(canonWorld, position, save, resolution, view);
  }
  const place = town.positionOf(canonWorld, position).place;
  if (place) return buildTownExitsSection(canonWorld, here, place, save);
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

// Where the player is in their turn once this resolves (L-614 / #444): the
// movement left and whether they've acted, for pacing; the rules have
// already decided what they may do.
function buildTurnSection(save, resolution) {
  const change = (resolution.mutations || []).find((m) => m.target === 'save' && m.path === 'turn');
  const turn = change ? change.value : turnStateOf(save);
  return (
    'THE TURN (for pacing only; the rules have decided what happens):\n' +
    'Turn ' +
    turn.n +
    '. Movement left: ' +
    turn.movementLeft +
    ' of ' +
    speedOf(save) +
    '. The player ' +
    (turn.actionUsed ? 'has used their action this turn.' : "hasn't acted yet this turn.")
  );
}

function buildUserMessage(params) {
  const {
    actionText,
    resolution,
    canonWorld,
    entityContexts,
    recentSummary,
    exitsSection,
    turnSection,
  } = params;

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
    (exitsSection ? '\n\n' + exitsSection : '') +
    (turnSection ? '\n\n' + turnSection : '')
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
 *   known?: object,          — the ground the save knows on its battle map (L-635)
 * }} params
 * @returns {Promise<{
 *   narration: string,
 *   entityRefs: string[],
 *   inventedEntities: string[],
 *   suggestedActions: string[],
 * }>}
 */
async function narrateResolution(params) {
  const { actionText, proposedAction, resolution, canonWorld, save, saveRef, known } = params;

  const entityRefs = resolveSceneEntityIds(canonWorld, save, proposedAction);
  const entityContexts = await retrieveContextForEntities({ saveRef, save, entityIds: entityRefs });
  // On a battle map, only what the player has seen there is named (L-636).
  const knownEntities = buildKnownEntities(canonWorld, save, known);
  const position = positionAfter(save, resolution);
  const view = await mapSightAfter(canonWorld, save, position, resolution, known, saveRef);

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
        exitsSection: buildExitsSection(canonWorld, position, save, resolution, view),
        turnSection: buildTurnSection(save, resolution),
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
