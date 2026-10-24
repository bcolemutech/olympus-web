'use strict';

const { callGemini } = require('../gemini');
const loomCanon = require('../loom-canon');
const { isPlayable, isPlaceOpen } = require('../loom-canon/grading');
const town = require('../loom-canon/town');
const maps = require('../loom-canon/maps');
const mapAreas = require('../loom-canon/map-areas');
const { buildKnownEntities } = require('./interpret');
const { retrieveContextForEntities } = require('./retrieval');
const { turnStateOf, apOf } = require('../loom-models');
const { doorStatesOf, doorSides } = require('./steps');
const layers = require('../loom-canon/layers');
const sight = require('../loom-canon/sight');
const { recordOf, squaresOf, peopleInSight } = require('./seen');
const clock = require('../loom-canon/clock');
const checks = require('../loom-canon/checks');
const apRules = require('../loom-canon/ap');
const { sheetOf, validateSheet } = require('../loom-canon/sheets');
const conditions = require('../loom-canon/conditions');
const effects = require('../loom-canon/effects');

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

// What each degree asks of the narration (game systems DC2; L-805).
const DEGREE_GUIDANCE = {
  criticalSuccess: 'it works better than hoped: give a real extra benefit',
  success: 'it works as intended',
  successAtCost: 'it works, but it costs something real: name the cost',
  failure: 'it does not work; the situation moves on',
  criticalFailure: 'it goes badly wrong: give a real complication',
};

// The world's game system for the narrator (L-805; game-systems.md §4.4):
// its name, the words it uses for things, how to narrate each degree, and
// its GM notes on tone and pacing.
function buildSystemSection(canonWorld) {
  const system = checks.systemOf(canonWorld);
  const words = Object.entries(system.words || {})
    .filter(([thing]) => !checks.DEGREE_NAMES[thing])
    .map(([thing, word]) => thing + ' is called "' + word + '"');
  const degrees = Object.keys(DEGREE_GUIDANCE)
    .map((d) => '- ' + checks.degreeName(system, d) + ': ' + DEGREE_GUIDANCE[d] + '.')
    .join('\n');
  return (
    'THE GAME SYSTEM: ' +
    system.name +
    '. Use its words' +
    (words.length ? ': ' + words.join(', ') : '') +
    '.\n' +
    'When a check was rolled, the ROLL line gives its degree. Narrate by that degree:\n' +
    degrees +
    (system.gmNotes ? '\nGM notes for this system: ' + system.gmNotes : '')
  );
}

function buildSystemInstruction(knownEntities, canonWorld) {
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
    'The TIME line says the day and part of day once this resolves, and how much time ' +
    'passed. Let the time of day colour the scene when it matters (morning fog, the heat ' +
    'of midday, lanterns lit at night), and narrate any dusk or dawn it says came on the ' +
    'way. Never state a different time of day, or more or less time passing, than it ' +
    'says.\n\n' +
    buildSystemSection(canonWorld) +
    '\n\n' +
    'Optionally suggest 2-4 next actions the player might take, each an object: { "text": ' +
    'a short phrase (e.g. "talk to the innkeeper"), "verb": one word (talk, examine, use, ' +
    'move, look, search, …), "target": the exact id from the known-entities list it is ' +
    'aimed at, if any }. Leave the list empty if nothing obvious suggests itself.\n\n' +
    'Respond with ONLY a JSON object: { "narration": string, "inventedEntities": string[], ' +
    '"suggestedActions": [{ "text": string, "verb": string, "target"?: string }] }'
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
      (mapAreas.areaAt(map, cell) ? ', in ' + mapAreas.areaAt(map, cell).name : '') +
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
  // Its areas (#670): the stretches of the map the player can see into, and
  // those they remember; where the player and the people in sight stand.
  const square = (k) => ({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) });
  const areas = mapAreas.areasOf(map);
  const areasNow = areas.filter(({ squares }) => squares.map(square).some(inSight));
  const areasThen = areas.filter(
    ({ squares }) => !squares.map(square).some(inSight) && squares.map(square).some(known)
  );
  const named = (list) => list.map(({ area }) => area.name).join('; ');
  if (areasNow.length) lines.push('Areas in sight: ' + named(areasNow) + '.');
  if (areasThen.length) lines.push('Areas remembered' + AWAY + named(areasThen) + '.');
  // Who stands in sight, and who is beside the player (L-643): talking needs
  // sight, a hand on someone needs them beside. Nobody is remembered.
  const people = peopleInSight(canonWorld, position, view ? view.inSight : null);
  if (people.length) {
    lines.push(
      'People in sight: ' +
        people
          .map(
            ({ character, cell: at, beside }) =>
              character.name +
              ' (' +
              at.x +
              ', ' +
              at.y +
              ')' +
              (mapAreas.areaAt(map, at) ? ', in ' + mapAreas.areaAt(map, at).name : '') +
              (beside ? ', beside the player' : '')
          )
          .join('; ') +
        '.'
    );
  }
  lines.push(
    'Nobody else on this map is in sight: never describe anyone else here as seen or heard ' +
      'nearby.'
  );
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

// The ids of those standing on the map where the player will be, but out of
// their sight (L-643).
function outOfSight(canonWorld, position, view) {
  const seen = new Set(
    peopleInSight(canonWorld, position, view.inSight).map((p) => p.character.id)
  );
  return new Set(
    maps
      .standingAt(canonWorld, maps.hostOf(canonWorld, position))
      .map((c) => c.id)
      .filter((id) => !seen.has(id))
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

// The time once this resolves, and what passed on the way (L-375; game time
// T14): the resolution's own account (L-373), or none.
function buildTimeSection(save, resolution) {
  const change = (resolution.mutations || []).find((m) => m.target === 'save' && m.path === 'time');
  const now = change ? change.value : clock.timeOf(save);
  return 'TIME (final):\n' + clock.timeLine(now, resolution.time || null);
}

// Where the player is in their turn once this resolves (L-614 / #444): the
// action points left (L-832) and any long action under way, for pacing;
// the rules have already decided what they may do.
function buildTurnSection(save, resolution, canonWorld = null) {
  const change = (resolution.mutations || []).find((m) => m.target === 'save' && m.path === 'turn');
  const turn = change ? change.value : turnStateOf(save);
  // With AP off (L-838): whether the turn's action is used.
  if (canonWorld && apRules.isOff(checks.systemOf(canonWorld))) {
    return (
      'THE TURN (for pacing only; the rules have decided what happens):\n' +
      'Turn ' +
      turn.n +
      '. The player ' +
      (turn.acted ? 'has used their action this turn.' : "hasn't acted yet this turn.")
    );
  }
  return (
    'THE TURN (for pacing only; the rules have decided what happens):\n' +
    'Turn ' +
    turn.n +
    '. Action points left: ' +
    turn.ap +
    ' of ' +
    apOf(save) +
    '.' +
    (turn.long
      ? ' The player is ' +
        turn.long.name +
        ' (' +
        turn.long.put +
        ' of ' +
        turn.long.need +
        ' AP put in).'
      : '')
  );
}

// What of the player's sheet no longer fits the world's rules (SY2; L-811),
// for the GM to repair in play; null when it all fits, or there's no sheet.
function buildSheetSection(save, canonWorld) {
  const sheet = sheetOf(save);
  if (!sheet) return null;
  const misfits = validateSheet(checks.systemOf(canonWorld), sheet);
  if (!misfits.length) return null;
  return (
    "THE PLAYER'S SHEET no longer fits this world's rules (they changed). When the story " +
    'allows, let the character notice and adjust; do not narrate rules:\n' +
    misfits.map((m) => '- ' + m).join('\n')
  );
}

// Effects (L-815): a hazard walked into this turn, how it went, and the
// conditions on the player once the turn is done, each with what it does
// and what it has left; null when there are none.
const HAZARD_WORDS = {
  applied: 'it took hold',
  replaced: 'it took hold again, worse',
  kept: 'they were already suffering it',
  resisted: 'they resisted it',
};
function buildEffectsSection(save, resolution, canonWorld) {
  const system = checks.systemOf(canonWorld);
  const set = (resolution.mutations || []).find(
    (m) => m.target === 'save' && m.path === 'character.sheet'
  );
  const sheet = set ? set.value : sheetOf(save);
  const now = clock.timeOf(save);
  const lines = [];
  const hazard = resolution.hazard;
  if (hazard) {
    lines.push(
      'HAZARD: the player walked into ' +
        hazard.name +
        (hazard.description ? ' (' + hazard.description + ')' : '') +
        ' and ' +
        (HAZARD_WORDS[hazard.outcome] || hazard.outcome) +
        (hazard.condition ? ': ' + hazard.condition + '.' : '.') +
        ' Narrate it happening to them, by that outcome.'
    );
  }
  const on = conditions.activeOn(system, sheet);
  if (on.length) {
    lines.push(
      "THE PLAYER'S CONDITIONS (they feel them; never name rules or numbers):\n" +
        on
          .map(
            ({ effect, condition }) =>
              '- ' +
              condition.name +
              ', ' +
              effects.leftWords(effect, now) +
              ' left' +
              (condition.description ? ': ' + condition.description : '')
          )
          .join('\n')
    );
  }
  return lines.length ? lines.join('\n\n') : null;
}

// A fight (L-821; planning/combat.md EN5): NARRATE writes when one starts
// and ends; the rules write each round. Told who is in it and how it went,
// and never to invent blows or wounds the rules didn't roll.
const FIGHT_ENDS = {
  fled: 'fled',
  down: 'fell',
  surrendered: 'surrendered',
  talkedDown: 'were talked down',
  gone: 'left',
  stoodDown: 'stood down',
};
// The player down (L-827; combat DF1–DF3): coming round, dead (the
// epilogue), or a fate for NARRATE to choose when death is off.
const FATE_WORDS = {
  captured: 'captured: taken by their foes or others, and held',
  robbed: 'robbed: left where they fell, everything they carried taken',
  rescued: 'rescued: found and carried to safety in the nearest settlement',
};
function buildFallenSection(resolution) {
  const fallen = resolution.fallen;
  if (!fallen) return null;
  if (fallen.outcome === 'dead') {
    return (
      "DEATH: the player's character has died. Write their epilogue: how they fell, what " +
      'they leave behind, and how the world they touched remembers them. This is the end of ' +
      'their story; write no choices or suggestions.'
    );
  }
  if (fallen.outcome === 'fate') {
    return (
      'FATE: the player fell and no one on their side was left standing; this world does not ' +
      'kill them. Choose what happens and add "fate" to your JSON, one of: ' +
      Object.entries(FATE_WORDS)
        .map(([id, words]) => '"' + id + '" (' + words + ')')
        .join(', ') +
      '. Pick what fits their foes and the place. Narrate them coming round, hours later.'
    );
  }
  return 'The player fell in the fight and came round afterwards, hurt: narrate it.';
}

function buildFightSection(save, resolution) {
  const f = resolution.fight;
  if (f && f.started) {
    return (
      'FIGHT STARTS: a fight breaks out' +
      (f.by === 'attack' ? ' as the player attacks' : ' as the player comes into sight of foes') +
      '. Turn order: ' +
      f.order.join(', ') +
      '.' +
      (f.surprised.length ? ' Caught off guard: ' + f.surprised.join(', ') + '.' : '') +
      ' Narrate the moment it breaks out. The rules decide every attack and wound: describe ' +
      'none that the hard facts do not state.'
    );
  }
  if (f && f.ended) {
    const how = (f.how || []).map((h) => FIGHT_ENDS[h] || h).join(' or ');
    return (
      (f.startedNow ? 'A FIGHT STARTED AND ' : '') +
      'FIGHT ENDS after ' +
      f.rounds +
      (f.rounds === 1 ? ' round' : ' rounds') +
      ': ' +
      (f.winner === 'party'
        ? 'the player’s foes ' + (how || 'are gone')
        : f.how && f.how.includes('fled')
          ? 'the player got away'
          : 'it is over') +
      '. Narrate the moment it ends and the quiet after.'
    );
  }
  const current = save && save.fight;
  if (current) {
    return (
      'IN A FIGHT (round ' +
      current.round +
      '): the rules decide every attack and wound; describe none that the hard facts do ' +
      'not state.'
    );
  }
  return null;
}

// What the named characters chose to do this round (L-825; EN5): one
// passage for the round, in their character, the rules' lines its facts.
function buildNamedSection(resolution) {
  const named = resolution.named || [];
  if (!named.length) return null;
  return (
    'NAMED CHARACTERS ACTED this round (the rules played their choices; the hard facts say ' +
    'what came of them):\n' +
    named
      .map(
        (n) =>
          '- ' +
          n.name +
          // The choice as the menu put it to them ("strike the player with your club").
          (n.did ? '’s choice: ' + n.did : ' fought by instinct') +
          (n.reason ? ' ("' + n.reason + '")' : '') +
          '.'
      )
      .join('\n') +
    '\nNarrate the round as one short passage, giving each of them their character. Describe ' +
    'no attack or wound the hard facts do not state.'
  );
}

// The check rolled this turn, if one was (L-805): what it was, its total,
// the rung, and the degree in the system's words.
function buildRollSection(resolution, canonWorld) {
  const roll = resolution.roll;
  if (!roll) return null;
  const system = checks.systemOf(canonWorld);
  const line = (r) =>
    (r.line || r.formula || 'd' + r.die) +
    ' = ' +
    r.total +
    ' against ' +
    r.against +
    (r.rung && r.rung !== r.against ? ' (' + r.rung + ')' : '') +
    ': ' +
    checks.degreeName(system, r.degree || (r.success ? 'success' : 'failure'));
  return (
    'ROLL (final):\n' +
    line(roll) +
    (resolution.opposed && resolution.opposed.roll
      ? '\nThe other side rolled: ' + line(resolution.opposed.roll)
      : '')
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
    timeSection,
    sheetSection,
  } = params;
  const rollSection = buildRollSection(resolution, canonWorld);
  const effectsSection = params.save
    ? buildEffectsSection(params.save, resolution, canonWorld)
    : null;
  const fightSection = buildFightSection(params.save, resolution);
  const fallenSection = buildFallenSection(resolution);
  const namedSection = buildNamedSection(resolution);

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
    (rollSection ? rollSection + '\n\n' : '') +
    (fightSection ? fightSection + '\n\n' : '') +
    (fallenSection ? fallenSection + '\n\n' : '') +
    (namedSection ? namedSection + '\n\n' : '') +
    (effectsSection ? effectsSection + '\n\n' : '') +
    (timeSection ? timeSection + '\n\n' : '') +
    'ROLLING SUMMARY:\n' +
    (recentSummary || '(none yet)') +
    '\n\n' +
    'RELEVANT ENTITIES:\n' +
    entitySections +
    (exitsSection ? '\n\n' + exitsSection : '') +
    (turnSection ? '\n\n' + turnSection : '') +
    (sheetSection ? '\n\n' + sheetSection : '')
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

// Without the model, a recap of the constraints, or the resolution's own
// `fallback` line where its constraints are words for the model alone (#672).
function fallbackNarration(actionText, resolution) {
  const constraintsText = (resolution.constraints || []).join(' ');
  return {
    narration: resolution.fallback || ('You ' + actionText + '. ' + constraintsText).trim(),
    inventedEntities: [],
    suggestedActions: [],
  };
}

/**
 * NARRATE's suggestions (#673), checked: each `{ text, verb?, target? }`, at
 * most 4, its target kept only when it is a known entity's id (one the save
 * may know: on a battle map, one it has seen), its verb only when it is one
 * word. A plain string, from an older model answer, is its text alone.
 */
const MAX_SUGGESTIONS = 4;
function sanitizeSuggestions(value, knownEntities) {
  if (!Array.isArray(value)) return [];
  const ids = new Set((knownEntities || []).map((e) => e.id));
  const out = [];
  for (const item of value) {
    const raw = typeof item === 'string' ? { text: item } : item;
    if (!raw || typeof raw !== 'object' || typeof raw.text !== 'string') continue;
    const text = raw.text.trim().slice(0, 120);
    if (!text) continue;
    const verb =
      typeof raw.verb === 'string' && /^[a-z][a-z_-]{1,20}$/.test(raw.verb.trim().toLowerCase())
        ? raw.verb.trim().toLowerCase()
        : null;
    const target = typeof raw.target === 'string' && ids.has(raw.target) ? raw.target : null;
    out.push({ text, ...(verb ? { verb } : {}), ...(verb && target ? { target } : {}) });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

function sanitizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter((v) => typeof v === 'string' && v.trim().length > 0)
    : [];
}

/**
 * Relevant entities for this scene: the location's default cast plus the
 * action's resolved targets, less `hidden` (people standing out of sight on
 * a battle map, L-643: the narrator isn't told of them), and less anyone in
 * the wilderness (no locationId; L-685), who isn't met until wilderness
 * travel (L-360), even when named. Someone about a settlement at a town point
 * is "about town": in the scene at any place in their town, unless they keep
 * to a place of their own.
 */
function resolveSceneEntityIds(canonWorld, save, proposedAction, hidden) {
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
    if (hidden && hidden.has(id)) return false;
    const resolved = loomCanon.findEntity(canonWorld, id);
    if (!resolved || resolved.entity.retired) return false;
    return !(resolved.type === 'character' && !resolved.entity.locationId);
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
 *   suggestedActions: [{ text, verb?, target? }],
 * }>}
 */
async function narrateResolution(params) {
  const { actionText, proposedAction, resolution, canonWorld, save, saveRef, known } = params;

  // On a battle map, only what the player has seen there is named (L-636).
  const knownEntities = buildKnownEntities(canonWorld, save, known);
  const position = positionAfter(save, resolution);
  const view = await mapSightAfter(canonWorld, save, position, resolution, known, saveRef);
  // People standing out of sight are left out of the scene (L-643).
  const hidden = view ? outOfSight(canonWorld, position, view) : null;
  const entityRefs = resolveSceneEntityIds(canonWorld, save, proposedAction, hidden);
  const entityContexts = await retrieveContextForEntities({ saveRef, save, entityIds: entityRefs });

  let raw;
  try {
    raw = await callGemini({
      modelName: MODEL_NAME,
      systemInstruction: buildSystemInstruction(knownEntities, canonWorld),
      userMessage: buildUserMessage({
        actionText,
        resolution,
        canonWorld,
        entityContexts,
        recentSummary: save.recentSummary,
        exitsSection: buildExitsSection(canonWorld, position, save, resolution, view),
        turnSection: buildTurnSection(save, resolution, canonWorld),
        timeSection: buildTimeSection(save, resolution),
        sheetSection: buildSheetSection(save, canonWorld),
        save,
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
    suggestedActions: sanitizeSuggestions(raw.suggestedActions, knownEntities),
    // The fate it chose for a player down (L-827), when asked.
    ...(Object.keys(FATE_WORDS).includes(raw.fate) ? { fate: raw.fate } : {}),
  };
}

module.exports = { narrateResolution, resolveSceneEntityIds, sanitizeSuggestions };
