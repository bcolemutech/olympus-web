'use strict';

const crypto = require('crypto');
const { isPlayable, isPlaceOpen } = require('../loom-canon/grading');
const town = require('../loom-canon/town');
const maps = require('../loom-canon/maps');
const mapAreas = require('../loom-canon/map-areas');
const { turnStateOf, nextTurnState, applyStateMutations } = require('../loom-models');
const apRules = require('../loom-canon/ap');
const clock = require('../loom-canon/clock');
const travel = require('../loom-canon/travel');
const journeys = require('../loom-canon/journeys');
const checks = require('../loom-canon/checks');
const { planStep, heldBy, doorStatesOf, doorSides, hasKey, besideDoor } = require('./steps');
const effects = require('../loom-canon/effects');
const hazards = require('../loom-canon/hazards');
const conditions = require('../loom-canon/conditions');
const sheets = require('../loom-canon/sheets');
const layers = require('../loom-canon/layers');
const sight = require('../loom-canon/sight');
const ground = require('../loom-canon/ground');
const { planTownStep, walksTown, nearestWayOut } = require('./town-steps');
const { UNKNOWN } = require('./town-found');
const combat = require('../loom-modules/combat');
const { namedTurn } = require('./named-turns');

// A lock's difficulty when its door gives none (L-626).
const DEFAULT_LOCK_DIFFICULTY = 15;

// Down (L-827): the player can only end their turn.
const DOWN = "You're down: you can only end your turn.";

// Turned down before narration (L-614): the turn's one action is used.
// Turns run on AP now (L-832), so this is for older answers only.
const ACTED = "You've acted this turn. End your turn first.";

// Turned down without using the action (L-636): aimed at something out of
// sight, a thing or a person.
const NOT_SEEN = "You don't see that here.";
const NOBODY_SEEN = "You don't see anyone like that here.";

// Actions that need only sight (L-636): looking and talking, persuading and
// threatening among it (L-821: talking a foe down). Anything else aimed at
// something on a battle map is physical, and needs reach.
const SIGHT_ONLY =
  /^(look|examine|inspect|study|watch|observe|read|peer|glance|talk|speak|ask|tell|say|greet|call|shout|whisper|listen|wave|signal|point|nod|persuade|convince|reason|plead|negotiate|parley|intimidate|threaten|deceive|bluff|calm|reassure)/;

// Actions that need no roll unless someone resists them (#673): looking at
// what's in plain view, and talking. Persuading, deceiving and searching
// aren't among them.
const PLAIN =
  /^(look|examine|inspect|study|read|watch|observe|peer|glance|listen|talk|speak|ask|tell|say|greet|chat|whisper|call|wave|nod)/;

// Actions done at someone's side (#673): talking with them, and looking
// closely at a thing. Out of a fight they need the player beside the target,
// as anything physical does; in a fight, words carry (L-821: talking a foe
// down) and only the physical needs reach.
const CLOSE =
  /^(talk|speak|ask|tell|say|greet|chat|whisper|question|haggle|bargain|examine|inspect|study|read)/;

/** Whether an action needs no roll unless someone resists it (#673). */
function needsNoRoll(verb) {
  return PLAIN.test(String(verb || ''));
}

/** Whether an action needs the player beside what it is aimed at (#673). */
function needsBeside(verb, inFight) {
  const v = String(verb || '');
  return !SIGHT_ONLY.test(v) || (!inFight && CLOSE.test(v));
}

/**
 * Stage 3 — ADJUDICATE (design doc §5, §10 L-140).
 *
 * The spine of the control thesis: a deterministic rules engine + server-side
 * dice evaluate the proposed action against authoritative state and produce a
 * fixed Resolution. The model never adjudicates legality. Per the L-140
 * decision (#309), the pipeline reaches rules only through this seam:
 *
 *   evaluate(proposedAction, worldState, characterState, dice) → Resolution
 *
 * so a data-driven rules engine (Phase 2, L-202) can later replace the body
 * of evaluate() without reshaping the pipeline. evaluate() is a pure
 * function — dice is a source it is given, `(sides) => face`, or one fixed
 * face for every die — so behavior is fully reproducible in tests; only
 * adjudicateAction() (the orchestrator-facing wrapper) passes the RNG.
 *
 * MVP rule set (hand-coded per world, per L-140): a movement-legality check
 * — "can this character reach that location?" — against the canon
 * connections graph and the requiresAbility rule hook (L-103 / #296),
 * mirroring the design doc's own "can the character fly?" example. Anything
 * else is a check by the world's game system (L-803; planning/game-
 * systems.md §4.4, ../loom-canon/checks.js): the skill and rung INTERPRET
 * proposed, validated, rolled by the system's formula and read as one of
 * five degrees; a lock's difficulty wins over the proposal.
 *
 * The Layered Worlds gate (planning/the-loom-layered-worlds.md §5; L-322 /
 * #391): a place that isn't graded Playable (functions/loom-canon/grading.js)
 * is closed, and a move into it is blocked. Leaving a closed place never is,
 * so no save is stranded. A world object with no status (only tests build
 * one) is exempt.
 *
 * Effects (planning/game-systems.md §4.10; L-815): walking into a hazard on a
 * battle map rolls its save with the server's dice and puts its condition
 * on a failure (the save's roll is the turn's roll card); End turn ticks the
 * character's conditions (damage each turn, saves to shake them off, a turn
 * off each), and a wait ticks them for every turn it lasts; a condition
 * that stops acting or moving (noAction, noMove) turns those down.
 *
 * Fights (planning/combat.md §4.2; L-821; ../loom-modules/combat/): one
 * starts when the player comes into sight of a hostile on a battle map (a
 * move, or `verb: 'fight'` after a step), or attacks someone there; its
 * initiative and surprise are rolled with the server's dice. In a fight,
 * each End turn is a round: everyone else takes their turn, to the
 * player's next. Leaving the map, talking a foe down, and foes gone or no
 * longer hostile end it. No rest or wait in a fight.
 *
 * Towns (§8; L-342 / #396): inside a settlement with a town layout, moves
 * between places follow the town's own links and are gated the same way. A
 * move to any place in town walks the shortest open way there in one go
 * (L-600 / #433).
 * Leaving town is only from an entrance that serves the route out (a harbour
 * for the sea, a gate for the roads), and arriving lands at the open entrance
 * serving the route in (../loom-canon/town.js).
 */

const DEFAULT_DIFFICULTY_CLASS = 10;

/** Server-side d20, generated fresh per call — never client- or model-supplied. */
function rollDie(sides = 20) {
  return crypto.randomInt(1, sides + 1);
}

// The dice a check rolls with (L-803): a source `(sides) => face`, or, from
// a test, one fixed face for every die.
function diceSource(dice) {
  if (typeof dice !== 'function') return checks.fixedDice(dice);
  return (sides) => Math.max(1, Math.min(sides, Math.round(dice(sides))));
}

const blocked = (message) => ({ outcome: 'blocked', mutations: [], constraints: [message] });

// The character's sheet, or (a save from before sheets) the system's defaults.
function sheetFor(system, characterState) {
  return sheets.sheetOf(characterState) || sheets.defaultSheet(system);
}
const setSheet = (sheet) => ({
  target: 'save',
  op: 'set-flag',
  path: 'character.sheet',
  value: sheet,
});

// Walking into a hazard (L-815; ../loom-canon/hazards.js): its save, rolled
// by the character, resists it; on a failure its condition goes on. Returns
// the resolution's parts: `{ mutations, constraints, roll?, hazard }`.
function hazardOutcome(canonWorld, characterState, hazard, dice) {
  const system = checks.systemOf(canonWorld);
  const now = clock.timeOf(characterState);
  const result = effects.apply(
    system,
    sheetFor(system, characterState),
    { ...hazard.effect, source: { kind: 'hazard', id: hazard.id, name: hazard.name } },
    { now, dice, turnSeconds: clock.turnSeconds(canonWorld, true) }
  );
  const changed = result.outcome === 'applied' || result.outcome === 'replaced';
  return {
    mutations: changed ? [setSheet(result.sheet)] : [],
    constraints: ['You walk into ' + hazard.name + '.', result.line],
    ...(result.roll ? { roll: rolled(result.roll, 'save: ' + hazard.name, system) } : {}),
    hazard: {
      id: hazard.id,
      name: hazard.name,
      condition: result.name,
      outcome: result.outcome,
      ...(hazard.description ? { description: hazard.description } : {}),
    },
  };
}

// A hazard walked into by a step on the map (index.js runs this turn for it).
function evaluateHazard(proposedAction, characterState, dice, canonWorld) {
  const id = String((proposedAction.targets || [])[0] || '').replace(/^hazard:/, '');
  const hazard = hazards.find(canonWorld, characterState.mapId, id);
  if (!hazard) return blocked("There's no such hazard here.");
  const out = hazardOutcome(canonWorld, characterState, hazard, dice);
  return {
    outcome: out.hazard.outcome === 'resisted' ? 'success' : 'failure',
    ...out,
  };
}

// The ability a place requires that the character lacks (the save's
// character, or a bare character state), or null.
const missingAbility = town.missingAbility;

// What to say when a traveller in town heads out from the wrong place.
function leaveHint(target, exits, via) {
  if (!exits.length) return 'No way out of town leads toward ' + target.name + '.';
  const names = exits.map((place) => place.name).join(' or ');
  return (
    'To set out for ' + target.name + (via ? ' by ' + via : '') + ', go to ' + names + ' first.'
  );
}

// A move to a place inside the current town (L-342): gated like the world
// map, and walked in one go along the shortest way through the town's links
// (L-600 / #433), passing only places the player may enter.
function evaluateTownMove(target, characterState, canonWorld) {
  if (target.locationId !== characterState.location) {
    return blocked("You can't get there directly from here.");
  }
  const here = town.positionOf(canonWorld, characterState).place;
  if (here && here.id === target.id) return enterOrStay(target, characterState, canonWorld);
  if (target.retired) return blocked("That place can't be reached anymore.");
  if (!isPlaceOpen(canonWorld, target)) {
    return blocked('The way to ' + target.name + ' is closed. Turn back.');
  }
  const required = missingAbility(target, characterState);
  if (required) return blocked('You lack what it takes to get in (requires: ' + required + ').');
  const settlement = canonWorld.locations[target.locationId];
  // A town with ground is walked on its streets (L-662, L-663); its links
  // aren't used (L-665), so the walk through them (L-600) is for towns
  // without ground only.
  if (settlement && ground.hasGround(settlement)) {
    return evaluateStreetMove(target, characterState, canonWorld);
  }
  const walk = town.walkTo(canonWorld, here, target, town.passableFor(canonWorld, characterState));
  if (!walk) return blockedOnTheWay(here, target, characterState, canonWorld);
  const passed = walk.slice(0, -1);
  // The walk takes its length at 80 m a minute (L-373; game time T11).
  const { seconds } = travel.townWalk(canonWorld, settlement, here, walk);
  const time = travel.timeSpent(clock.timeOf(characterState), seconds);
  return {
    outcome: 'success',
    mutations: [
      { target: 'save', op: 'set-flag', path: 'placeId', value: target.id },
      // A place with a battle map (L-351) is entered on it, at its entry.
      ...maps.arrivalMutations(canonWorld, target, characterState),
      ...(seconds ? [{ target: 'save', op: 'set-flag', path: 'time', value: time.to }] : []),
      { op: 'increment', path: 'worldClock', value: 1 },
    ],
    ...(seconds ? { time } : {}),
    constraints: [
      passed.length
        ? 'You make your way ' +
          (here ? 'from ' + here.name + ' ' : '') +
          'past ' +
          andList(passed) +
          ' to ' +
          target.name +
          '.'
        : 'You make your way to ' + target.name + '.',
    ],
  };
}

// A move to a place in a town with ground (L-662, L-663): its streets, not
// its links, are the way, walked on the turn's movement as a tap would go
// (./town-steps.js), from the street or from the door of the place you're
// at. Reaching the door takes you in, onto its battle map; short of it, you
// stop on the street with the rest kept as the plan.
function evaluateStreetMove(target, characterState, canonWorld) {
  const step = planTownStep(canonWorld, characterState, { placeId: target.id });
  if (step.refused) return blocked(step.refused);
  const spend = { target: 'save', op: 'set-flag', path: 'turn', value: step.turn };
  if (!step.enter) {
    return {
      outcome: 'success',
      mutations: [
        { target: 'save', op: 'set-flag', path: 'placeId', value: null },
        { target: 'save', op: 'set-flag', path: 'townPoint', value: step.point },
        spend,
      ],
      constraints: ['You head for ' + target.name + '.'].concat(step.lines),
      // The way walked, for what is seen on it (L-671).
      walkedTown: step.walked,
    };
  }
  const walkedThere = step.lines.length > 0;
  return {
    outcome: 'success',
    mutations: [
      { target: 'save', op: 'set-flag', path: 'placeId', value: target.id },
      ...(characterState.townPoint
        ? [{ target: 'save', op: 'set-flag', path: 'townPoint', value: null }]
        : []),
      // A place with a battle map (L-351) is entered on it, at its entry.
      ...maps.arrivalMutations(canonWorld, target, characterState),
      spend,
      { op: 'increment', path: 'worldClock', value: 1 },
    ],
    constraints: [
      walkedThere
        ? 'You make your way to ' + target.name + '.'
        : 'You go into ' + target.name + '.',
    ],
  };
}

// Why there's no open way to a place in town: the first place in the way on
// the shortest walk (closed, or needing what the player lacks), or no walk.
function blockedOnTheWay(here, target, characterState, canonWorld) {
  const walk = town.walkTo(canonWorld, here, target);
  const passable = town.passableFor(canonWorld, characterState);
  const stop = walk && walk.slice(0, -1).find((place) => !passable(place));
  if (!stop) return blocked("You can't get there from here.");
  if (!isPlaceOpen(canonWorld, stop)) {
    return blocked('The way to ' + stop.name + ' is closed. Turn back.');
  }
  return blocked(
    'You lack what it takes to get past ' +
      stop.name +
      ' (requires: ' +
      missingAbility(stop, characterState) +
      ').'
  );
}

// A move to where the player already stands: back onto its battle map if it
// has one and they've stepped off it (L-351), else nothing to do.
function enterOrStay(place, characterState, canonWorld) {
  if (maps.mapOf(canonWorld, place) && !characterState.mapId) {
    return {
      outcome: 'success',
      mutations: [
        ...maps.arrivalMutations(canonWorld, place, characterState),
        { op: 'increment', path: 'worldClock', value: 1 },
      ],
      constraints: ['You go into ' + place.name + '.'],
    };
  }
  return { outcome: 'no_op', mutations: [], constraints: ["You're already there."] };
}

// ── Battle maps (L-351) ─────────────────────────────

const exitNames = (exits) => nameList(exits.map((e) => ({ name: e.name })));

// The square of an area to walk to (#670): the nearest of its squares (as
// movement counts, then as the crow flies, then reading order) the save knows and can stand on and
// get to. `{ cell }`, or `{ refused }` saying why none will do.
const AREA_TRIES = 24;
function nearestSquareIn(canonWorld, characterState, map, area, from, known) {
  const squares = mapAreas
    .squaresOf(map, area)
    .map((k) => {
      const [x, y] = k.split(',').map(Number);
      const dx = x - from.x;
      const dy = y - from.y;
      return { x, y, d: Math.max(Math.abs(dx), Math.abs(dy)), e: dx * dx + dy * dy };
    })
    .filter((c) => !known || known[c.x + ',' + c.y])
    .sort((a, b) => a.d - b.d || a.e - b.e || a.y - b.y || a.x - b.x);
  if (!squares.length) return { refused: "You haven't seen " + area.name + '.' };
  for (const c of squares.slice(0, AREA_TRIES)) {
    const step = planStep(canonWorld, characterState, { cell: { x: c.x, y: c.y } }, known);
    if (!step.refused) return { cell: { x: c.x, y: c.y } };
  }
  return { refused: "There's no way into " + area.name + ' from here.' };
}

// A move while the player is on a battle map: to a cell (from the grid), to a
// feature, an exit or an area (typed: "feature:bar", "exit:front-door",
// "area:back-room", #670: its nearest square), along the
// map's paths (L-624) over the ground the save knows (L-635), or to someone
// standing there in sight (L-642: the walk ends beside them). Stepping onto an exit leaves by it, out
// to the town or the world, or onto the map it leads to. Anything else waits
// until the player has left the map, as leaving a town waits for a gate.
function evaluateMapMove(proposedAction, characterState, canonWorld, here, known, dice) {
  const { map, cell: from } = here;
  const host = maps.hostOf(canonWorld, characterState);
  const hostName = host ? host.name : map.name;
  const target = proposedAction.targets[0];
  const named = (prefix, list) =>
    typeof target === 'string' && target.indexOf(prefix) === 0
      ? (list || []).find((item) => item.id === target.slice(prefix.length)) || false
      : null;

  let cell = proposedAction.params && proposedAction.params.cell;
  let feature = named('feature:', map.features);
  let exit = named('exit:', map.exits);
  const area = named('area:', map.areas);
  if (feature === false || exit === false || area === false) {
    return {
      outcome: 'invalid_target',
      mutations: [],
      constraints: ["There's no such place here."],
    };
  }
  if (feature) cell = { x: feature.x, y: feature.y };
  // Into an area (#670): its nearest square the save can walk to.
  if (area) {
    const inArea = mapAreas.areaAt(map, from);
    if (inArea && inArea.id === area.id) {
      return { outcome: 'no_op', mutations: [], constraints: ["You're in " + area.name + '.'] };
    }
    const square = nearestSquareIn(canonWorld, characterState, map, area, from, known);
    if (square.refused) return blocked(square.refused);
    cell = square.cell;
  }
  // Someone standing here (L-642): only if in sight now.
  const person =
    !cell && !exit && typeof target === 'string'
      ? mapTarget(canonWorld, characterState, map, target)
      : null;
  if (person && person.person) {
    const inSight = sight.inSight(map, from, doorStatesOf(characterState, map.id));
    if (!inSight[person.squares[0].x + ',' + person.squares[0].y]) return blocked(NOBODY_SEEN);
    cell = person.squares[0];
  }
  if (!cell && !exit) {
    if (host && target === host.id) {
      return { outcome: 'no_op', mutations: [], constraints: ["You're already there."] };
    }
    const out = maps.exitsOut(map);
    const ways = out.length ? out : map.exits || [];
    return blocked('To leave ' + hostName + ', go out by ' + exitNames(ways) + ' first.');
  }
  if (!exit) {
    if (!maps.inBounds(map, cell)) return blocked("That's off the map.");
    const there = maps.at(map, cell);
    exit = there.exit;
    feature = feature || there.feature;
  }
  if (!exit && maps.sameCell(cell, from)) {
    return { outcome: 'no_op', mutations: [], constraints: ["You're already there."] };
  }
  // The way there, on the turn's movement (L-614 / #444), as a tap would go
  // (./steps.js), over the ground the save knows (L-635): the rest kept as
  // the plan.
  const to = exit ? { x: exit.x, y: exit.y } : { x: cell.x, y: cell.y };
  const step = planStep(canonWorld, characterState, { cell: to }, known);
  if (step.refused) return blocked(step.refused);
  const spend = { target: 'save', op: 'set-flag', path: 'turn', value: step.turn };
  if (step.exit) {
    const left = leaveMapBy(exit, host, hostName, canonWorld);
    return left.outcome === 'success' ? { ...left, mutations: [...left.mutations, spend] } : left;
  }
  const name = exit
    ? exit.name
    : feature
      ? feature.name
      : area
        ? area.name
        : person && person.person
          ? person.name
          : null;
  const mutations = [{ target: 'save', op: 'set-flag', path: 'cell', value: step.cell }, spend];
  if (step.opened) {
    // A door opened on the way stays open for this save (L-624).
    const { mapId, doorId } = step.opened;
    mutations.push({
      target: 'save',
      op: 'set-flag',
      path: `doors.${mapId}.${doorId}`,
      value: 'open',
    });
  }
  // The squares walked through, for what is seen on the way (L-632).
  const walked = step.walked;
  // A hazard on the way stops the walk there and triggers (L-815).
  const into = step.hazard ? hazards.find(canonWorld, map.id, step.hazard.id) : null;
  if (into) {
    const out = hazardOutcome(canonWorld, characterState, into, diceSource(dice));
    return {
      outcome: out.hazard.outcome === 'resisted' ? 'success' : 'failure',
      mutations: mutations.concat(out.mutations),
      constraints: out.constraints,
      ...(out.roll ? { roll: out.roll } : {}),
      hazard: out.hazard,
      walked,
    };
  }
  if (step.turn.plan) {
    return {
      outcome: 'success',
      mutations,
      constraints: ['You head ' + (name ? 'for ' + name : 'across ' + map.name) + '.'].concat(
        step.lines
      ),
      walked,
    };
  }
  const arrived =
    person && person.person
      ? 'You go over to ' + name + '.'
      : area
        ? 'You move into ' + name + '.'
        : name
          ? 'You move to ' + name + '.'
          : 'You move across ' + map.name + '.';
  return {
    outcome: 'success',
    mutations,
    // Anyone who came into view on the way (L-642).
    constraints: [arrived].concat(step.seenLines || []),
    walked,
  };
}

function leaveMapBy(exit, host, hostName, canonWorld) {
  const to = exit.to && typeof exit.to === 'object' ? exit.to : null;
  if (to) {
    const next = (canonWorld.battleMaps || {})[to.map];
    if (!next || next.retired) return blocked('The way by ' + exit.name + ' leads nowhere now.');
    return {
      outcome: 'success',
      mutations: [
        { target: 'save', op: 'set-flag', path: 'mapId', value: next.id },
        { target: 'save', op: 'set-flag', path: 'cell', value: maps.entryCell(next, to.entry) },
        { op: 'increment', path: 'worldClock', value: 1 },
      ],
      constraints: ['You go by ' + exit.name + ' to ' + next.name + '.'],
    };
  }
  // Out of a place in a town with ground (L-662), onto the street at its
  // door; a way out of town keeps you there, ready to leave, as before.
  const settlement = host && host.locationId && canonWorld.locations[host.locationId];
  const street =
    settlement && ground.hasGround(settlement) && !town.isEntrance(host) && host.position;
  return {
    outcome: 'success',
    mutations: [
      { target: 'save', op: 'set-flag', path: 'mapId', value: null },
      { target: 'save', op: 'set-flag', path: 'cell', value: null },
      ...(street
        ? [
            { target: 'save', op: 'set-flag', path: 'placeId', value: null },
            {
              target: 'save',
              op: 'set-flag',
              path: 'townPoint',
              value: { x: host.position.x, y: host.position.y },
            },
          ]
        : []),
      { op: 'increment', path: 'worldClock', value: 1 },
    ],
    constraints: ['You leave ' + hostName + ' by ' + exit.name + '.'],
  };
}

// The way in a traveller asks to arrive by (L-346): a move whose target is a
// way into another town ("to the King's Causeway"), or one naming the town and
// then its way in ([loc_191, plc_191_…]). Null when they name none.
function chosenWayIn(proposedAction, canonWorld) {
  const places = canonWorld.places || {};
  const [first, second] = proposedAction.targets;
  const asked = places[first] ? places[first] : places[second];
  if (!asked || !town.isEntrance(asked)) return null;
  if (!places[first] && asked.locationId !== first) return null; // a way into another town
  return asked;
}

function evaluateMove(proposedAction, worldState, characterState, canonWorld, known, found, dice) {
  const currentId = characterState.location;

  if (!currentId || !canonWorld.locations[currentId]) {
    return blocked('You have nowhere established to move from yet.');
  }

  // On a battle map (L-351), moves happen on the map until the player leaves
  // it. A map with no exits holds nobody: it is passed over.
  const onMap = maps.positionOf(canonWorld, characterState);
  if (onMap.map && (onMap.map.exits || []).length) {
    return evaluateMapMove(proposedAction, characterState, canonWorld, onMap, known, dice);
  }
  if (proposedAction.params && proposedAction.params.cell) {
    return blocked("There's no map here to move on.");
  }

  const first = proposedAction.targets[0];
  const targetPlace = first && (canonWorld.places || {})[first];
  if (targetPlace && targetPlace.locationId === currentId) {
    // A place in town it hasn't found yet (L-673).
    if (found && !found.has(targetPlace.id)) return blocked(UNKNOWN);
    return evaluateTownMove(targetPlace, characterState, canonWorld);
  }
  const out = leavingTown(proposedAction, characterState, canonWorld, found);
  if (out.result) return out.result;
  const { targetId, targetLocation, wayIn, via, here, exits, atWayOut, journey } = out;

  // In a town with ground, a typed move out walks to the nearest way out
  // first (L-663), and sets out from there if it gets there this turn. (The
  // pipeline walks it on, turn after turn, first: setOutWalk, #669.)
  let walkedOut = null;
  if (!atWayOut && walksTown(canonWorld, characterState)) {
    const way = nearestWayOut(canonWorld, characterState, exits);
    if (!way) return blocked(leaveHint(targetLocation, exits, via));
    const step = planTownStep(canonWorld, characterState, {
      point: way.position,
      leaveFor: wayIn ? wayIn.id : targetId,
    });
    if (step.refused) return blocked(step.refused);
    const spend = { target: 'save', op: 'set-flag', path: 'turn', value: step.turn };
    if (!step.leave) {
      return {
        outcome: 'success',
        mutations: [
          { target: 'save', op: 'set-flag', path: 'placeId', value: null },
          { target: 'save', op: 'set-flag', path: 'townPoint', value: step.point },
          spend,
        ],
        constraints: [
          'You head for ' + way.name + ', on your way to ' + targetLocation.name + '.',
        ].concat(step.lines),
      };
    }
    walkedOut = { way, passed: [], seconds: 0, spend, lines: step.lines };
  } else if (!atWayOut) {
    // In a town without ground, the way out is walked through the town's
    // links first, in one go, as a move in town is (L-600; #669).
    walkedOut = here && wayOutWalk(canonWorld, characterState, here, exits);
    if (!walkedOut) return blocked(leaveHint(targetLocation, exits, via));
  }

  // By the way in chosen, else the most direct (L-381): facing where you
  // came from.
  // The walk to the way out comes first (#669); a journey (L-384; JA3)
  // sets out when it ends: its legs and the walks across the towns between,
  // summed, arriving by the way in facing its last leg.
  const start = clock.timeOf(characterState);
  const walked = walkedOut ? walkedOut.seconds : 0;
  const made = journey
    ? journeys.journeyOf(canonWorld, characterState, currentId, targetId, start + walked)
    : null;
  const arrival = made
    ? made.arrival
    : wayIn || town.arrivalPlace(canonWorld, targetId, via, currentId);
  const mutations = [{ target: 'save', op: 'set-flag', path: 'location', value: targetId }];
  if (characterState.townPoint || (walkedOut && walkedOut.spend)) {
    mutations.push({ target: 'save', op: 'set-flag', path: 'townPoint', value: null });
  }
  if (walkedOut && walkedOut.spend) mutations.push(walkedOut.spend);
  if (arrival || characterState.placeId) {
    mutations.push({
      target: 'save',
      op: 'set-flag',
      path: 'placeId',
      value: arrival ? arrival.id : null,
    });
  }
  // Arriving where there is a battle map (L-351) lands on it, at its entry:
  // the way in reached, or the point of interest itself. A settlement
  // visited before is arrived at on its town map, at the way in (L-382;
  // journeys JA2): its map is entered from there, as any place's is.
  const been =
    Boolean(arrival) &&
    Array.isArray(characterState.visited) &&
    characterState.visited.includes(targetId);
  mutations.push(
    ...(been
      ? maps.arrivalMutations(canonWorld, null, characterState)
      : maps.arrivalMutations(canonWorld, arrival || targetLocation, characterState))
  );
  // The trip takes its time (L-373; game time T8–T10): the route's miles at
  // its speed, nights camped on land. The same trip() gives the map's
  // estimate before setting out (./map-view.js).
  // The walk to the way out comes first (#669).
  // The ways used in each town a journey crosses are found there (JA5).
  if (made) mutations.push(...crossingMutations(characterState, made));
  const trip = made ? null : travel.trip(canonWorld, currentId, targetId, start + walked);
  const end = made ? made.to : trip ? trip.to : start + walked;
  if (end !== start) mutations.push({ target: 'save', op: 'set-flag', path: 'time', value: end });
  mutations.push({ op: 'increment', path: 'worldClock', value: 1 });
  const arrived =
    'you arrive at ' + targetLocation.name + (arrival ? ', at ' + arrival.name : '') + '.';
  return {
    outcome: 'success',
    mutations,
    constraints: (walkedOut ? [wayOutLine(here, walkedOut)] : []).concat(
      made
        ? journeys.journeyLines(canonWorld, made)
        : trip
          ? travel.tripLines(trip, arrived)
          : ['Y' + arrived.slice(1)]
    ),
    ...(made ? { journey: { stops: made.stops, through: made.through } } : {}),
    ...(end !== start ? { time: travel.timeSpent(start, end - start) } : {}),
  };
}

// What crossing towns on a journey finds (L-384; JA5): the way in and the
// way out used in each, known there from now on, and the town visited.
function crossingMutations(characterState, journey) {
  const known = characterState.waysKnown || {};
  const out = [];
  for (const c of journey.crossings) {
    out.push({ target: 'save', op: 'add', path: 'visited', value: c.locationId });
    if (known[c.locationId] === 'all') continue;
    for (const way of [c.wayIn, c.wayOut]) {
      if (way) {
        out.push({ target: 'save', op: 'add', path: 'waysKnown.' + c.locationId, value: way.id });
      }
    }
  }
  return out;
}

// The way to a world place out of the current town, as far as the rules
// allow it before setting out (#669): `{ result }`, an answer at once (no
// such place, already there, or why not), or what leaving needs: the place
// and the way in asked for, the route, where the save is, the ways out
// serving the route and whether it stands at one. `found` the places it
// knows in this town (./town-found.js; null: all): it leaves only by a way
// out it knows (L-381).
function leavingTown(proposedAction, characterState, canonWorld, found = null) {
  const currentId = characterState.location;
  const first = proposedAction.targets[0];
  const targetPlace = first && (canonWorld.places || {})[first];
  // A place in another town can only be reached as its way in, travelling there.
  const wayIn = chosenWayIn(proposedAction, canonWorld);
  if (targetPlace && !wayIn) return { result: blocked("You can't get there directly from here.") };
  const targetId = wayIn ? wayIn.locationId : first;

  if (!targetId || !canonWorld.locations[targetId]) {
    return {
      result: {
        outcome: 'invalid_target',
        mutations: [],
        constraints: ["There's no such place to go."],
      },
    };
  }

  if (targetId === currentId) {
    return { result: enterOrStay(canonWorld.locations[currentId], characterState, canonWorld) };
  }

  const currentLocation = canonWorld.locations[currentId];
  const targetLocation = canonWorld.locations[targetId];
  // Not a neighbour: a journey there, through settlements visited before
  // (L-384; journeys JA1), if it has been there.
  if (currentLocation.connections.indexOf(targetId) === -1) {
    const visited = Array.isArray(characterState.visited) && characterState.visited;
    const stops =
      !wayIn && visited && journeys.routeOf(canonWorld, characterState, currentId, targetId);
    if (!stops) {
      return {
        result: blocked(
          visited && visited.includes(targetId)
            ? 'No way you know leads there.'
            : "You can't get there directly from here."
        ),
      };
    }
    return leavingBy(characterState, canonWorld, found, {
      targetId,
      targetLocation,
      wayIn: null,
      via: town.routeBetween(canonWorld, currentId, stops[1]),
      journey: { stops },
    });
  }

  // A retired place stays resolvable for saves already there, but nobody can
  // travel to it (Firestore worlds also drop it from connections).
  if (targetLocation.retired) return { result: blocked("That place can't be reached anymore.") };
  if (!isPlayable(canonWorld, targetLocation)) {
    return { result: blocked('The way to ' + targetLocation.name + ' is closed. Turn back.') };
  }
  const required = missingAbility(targetLocation, characterState);
  if (required) {
    return {
      result: blocked('You lack what it takes to make that crossing (requires: ' + required + ').'),
    };
  }

  // Leaving a town (L-342): only from a way out that serves the route — a
  // harbour for the sea, a gate for the roads and trails.
  const via = town.routeBetween(canonWorld, currentId, targetId);
  return leavingBy(characterState, canonWorld, found, {
    targetId,
    targetLocation,
    wayIn,
    via,
  });
}

// The rest of leaving (#669, L-381): a chosen way in checked, where the save
// is, the known ways out serving `via` (a journey's first leg's, L-384) and
// whether it stands at one.
function leavingBy(
  characterState,
  canonWorld,
  found,
  { targetId, targetLocation, wayIn, via, journey }
) {
  const currentId = characterState.location;
  const currentLocation = canonWorld.locations[currentId];
  // Arriving at a town lands at the way in the traveller chose (L-346), or
  // else at the open entrance serving the route: a way in that won't do is
  // turned down before any walk to the way out.
  if (wayIn) {
    const refused = refuseWayIn(wayIn, targetLocation, via, characterState, canonWorld);
    if (refused) return { result: refused };
  }
  const { place: here, point } = town.positionOf(canonWorld, characterState);
  const serving = town.entrancesOf(canonWorld, currentId).filter((p) => town.serves(p, via));
  const exits = serving.filter((p) => !found || found.has(p.id));
  // Out of town only from a way out that serves the route: standing in it,
  // or on the street at its door (L-662).
  const atAWayOut = (p) =>
    p.position && Math.hypot(point.x - p.position.x, point.y - p.position.y) < 0.5;
  const atWayOut =
    (here && town.isEntrance(here) && town.serves(here, via)) ||
    (!here && point && exits.some(atAWayOut)) ||
    (!here && !point);
  // Ways out serving the route, none of them known yet (L-381).
  if (!atWayOut && serving.length && !exits.length) {
    return {
      result: blocked(
        'You know no way out of ' +
          currentLocation.name +
          (via ? ' by ' + via : '') +
          '. Explore to find one.'
      ),
    };
  }
  return { targetId, targetLocation, wayIn, via, here, exits, atWayOut, journey };
}

// The walk through a town's links (L-600) from a place in it to the nearest
// way out of these that is open to the traveller (#669): { way, passed,
// seconds }, or null when none can be reached.
function wayOutWalk(canonWorld, characterState, here, exits) {
  const canPass = town.passableFor(canonWorld, characterState);
  let best = null;
  for (const way of exits) {
    if (way.retired || !canPass(way)) continue;
    const walk = town.walkTo(canonWorld, here, way, canPass);
    if (!walk) continue;
    if (!best || walk.length < best.walk.length) best = { way, walk };
  }
  if (!best) return null;
  const settlement = canonWorld.locations[characterState.location];
  const { seconds } = travel.townWalk(canonWorld, settlement, here, best.walk);
  return { way: best.way, passed: best.walk.slice(0, -1), seconds };
}

function wayOutLine(here, walkedOut) {
  return walkedOut.passed.length
    ? 'You make your way ' +
        (here ? 'from ' + here.name + ' ' : '') +
        'past ' +
        andList(walkedOut.passed) +
        ' to ' +
        walkedOut.way.name +
        '.'
    : 'You make your way to ' + walkedOut.way.name + '.';
}

/**
 * The walk out of a town with ground that a move to a world place needs
 * before it can set out (#669), for the pipeline to walk turn after turn:
 * `{ way, target: { point, leaveFor } }` (the nearest way out serving the
 * route, and the world place or way in to set out for once there), `{ refused }`
 * when the move can't be made, or null when no walk is needed (the save is
 * at a way out, isn't on a town's streets, or the move isn't out of town).
 */
function setOutWalk(canonWorld, characterState, proposedAction, found = null) {
  if (proposedAction.verb !== 'move' || !walksTown(canonWorld, characterState)) return null;
  const first = proposedAction.targets[0];
  const targetPlace = first && (canonWorld.places || {})[first];
  if (!first || (targetPlace && targetPlace.locationId === characterState.location)) return null;
  const out = leavingTown(proposedAction, characterState, canonWorld, found);
  if (out.result) {
    return out.result.outcome === 'success' ? null : { refused: out.result.constraints[0] };
  }
  if (out.atWayOut) return null;
  const way = nearestWayOut(canonWorld, characterState, out.exits);
  if (!way) return { refused: leaveHint(out.targetLocation, out.exits, out.via) };
  return {
    way,
    target: { point: way.position, leaveFor: out.wayIn ? out.wayIn.id : out.targetId },
  };
}

// Why a chosen way in can't be used, or null if it can.
function refuseWayIn(wayIn, destination, via, characterState, canonWorld) {
  if (wayIn.retired) return blocked("That way in can't be used anymore.");
  if (!isPlaceOpen(canonWorld, wayIn)) {
    return blocked(
      'The way into ' + destination.name + ' by ' + wayIn.name + ' is closed. Turn back.'
    );
  }
  if (!town.serves(wayIn, via)) {
    const serving = town
      .entrancesOf(canonWorld, destination.id)
      .filter((p) => town.serves(p, via) && isPlaceOpen(canonWorld, p));
    return blocked(
      wayIn.name +
        ' is no way in by ' +
        (via || 'this route') +
        '.' +
        (serving.length ? ' Arrive by ' + nameList(serving) + '.' : '')
    );
  }
  const required = missingAbility(wayIn, characterState);
  if (required) return blocked('You lack what it takes to get in (requires: ' + required + ').');
  return null;
}

function nameList(places, last = 'or') {
  const names = places.map((p) => p.name);
  return names.length < 2
    ? names.join('')
    : names.slice(0, -1).join(', ') + ' ' + last + ' ' + names[names.length - 1];
}

const andList = (places) => nameList(places, 'and');

// A check as the panel's roll card shows it (L-726, the-map-first-loom.md
// L4; L-803, L-805): the die, the result, what it was against and whether
// it passed; the check's formula, breakdown, rung and degree; its line with
// each term named (DC6), the dice to tap (DC5: each die's sides and face,
// whether it was kept and, in a pool, counted) and the degree in the
// system's words.
function rolled(check, against, system) {
  const first = check.breakdown.terms.find((t) => t.kind === 'dice' || t.kind === 'count');
  const sides = first ? Number(/d(\d+)/.exec(first.expr)[1]) : 20;
  const dice = [];
  for (const term of check.breakdown.terms) {
    if (term.kind !== 'dice' && term.kind !== 'count') continue;
    const of = Number(/d(\d+)/.exec(term.expr)[1]);
    for (const r of term.rolls) {
      dice.push({
        sides: of,
        value: r.value,
        kept: r.kept,
        ...(term.kind === 'count' ? { counted: r.counted } : {}),
      });
    }
  }
  return {
    die: sides,
    value: check.type === 'bool' ? check.natural : check.total,
    difficulty: check.difficulty,
    against,
    success: check.success,
    total: check.total,
    formula: check.formula,
    breakdown: check.breakdown,
    rung: check.rung,
    degree: check.degree,
    line: check.breakdown.named,
    dice,
    verdict: checks.degreeName(system, check.degree),
  };
}

// What a check came to, by its degree (DC2), for NARRATE to honour.
const DEGREE_WORDS = {
  criticalSuccess: 'succeeds brilliantly',
  success: 'succeeds',
  successAtCost: 'succeeds, at a cost',
  failure: 'does not succeed',
  criticalFailure: 'fails badly',
};

// Plausibility (L-826; combat CB1), as INTERPRET judged a typed action:
// the extraordinary is refused, and the complicated asked how (once: a
// second answer that still doesn't say is refused), each plainly, spending
// nothing. A resolution, or null for an action to be tried.
const NO_HOW = "Without a clear way to do it, you can't attempt it.";
function plausibilityOf(proposedAction) {
  const params = proposedAction.params || {};
  if (params.plausibility === 'extraordinary') {
    return { ...blocked(params.why || "That's beyond you."), plain: true };
  }
  if (params.plausibility === 'complicated') {
    if (params.answering) return { ...blocked(NO_HOW), plain: true };
    const question = params.question || 'How exactly do you do that?';
    return { ...blocked(question), plain: true, ask: question };
  }
  return null;
}

// Anything else the player tries (L-803; game systems DC3): the check
// INTERPRET proposed (`params.check`: a skill or attribute, a rung, perhaps
// someone it is against), validated and rolled by the world's system; with
// none, a plain attempt at the ladder's easiest rung.
function evaluateGeneric(proposedAction, dice, characterState, canonWorld) {
  const system = checks.systemOf(canonWorld);
  let proposed = (proposedAction.params && proposedAction.params.check) || null;
  // Improbable (L-826; CB1): the ladder's hardest rung, whatever was
  // proposed, and never against someone's easier roll.
  if ((proposedAction.params || {}).plausibility === 'improbable') {
    const { opposedBy, ...rest } = proposed || {};
    void opposedBy;
    proposed = { ...rest, rung: system.checks.ladder[system.checks.ladder.length - 1].name };
  }
  if (proposed) {
    const why = checks.refusal(system, proposed);
    if (why) return blocked(why);
  }
  const character = (characterState && characterState.character) || null;
  const verb = proposedAction.verb;
  if (proposed && proposed.opposedBy) {
    const opponent = ((canonWorld && canonWorld.characters) || {})[proposed.opposedBy];
    if (!opponent || opponent.retired) return blocked(NOBODY_SEEN);
    let both;
    try {
      both = checks.rollOpposed(system, { check: proposed, character, opponent, dice });
    } catch (err) {
      return blocked(err.message);
    }
    const { attacker, defender } = both;
    return {
      outcome: attacker.success ? 'success' : 'failure',
      roll: rolled(attacker, opponent.name, system),
      opposed: { by: opponent.id, roll: rolled(defender, 'you', system) },
      mutations: [],
      constraints: [
        `The attempt to ${verb} against ${opponent.name} ${DEGREE_WORDS[attacker.degree]} ` +
          `(${attacker.total} against ${defender.total}).`,
      ],
    };
  }
  // No roll the rules don't call for (#673): looking at what's in plain
  // view, or talking with someone, just happens; persuading, deceiving,
  // searching and the like still roll, as does anything someone resists.
  if (
    PLAIN.test(String(verb || '')) &&
    (proposedAction.params || {}).plausibility !== 'improbable'
  ) {
    return { outcome: 'success', mutations: [], constraints: [] };
  }
  const roll = checks.rollCheck(system, { check: proposed || {}, character, dice });
  return {
    outcome: roll.success ? 'success' : 'failure',
    roll: rolled(roll, roll.rung, system),
    mutations: [],
    constraints: ['The attempt to ' + verb + ' ' + DEGREE_WORDS[roll.degree] + '.'],
  };
}

/**
 * @param {object} proposedAction - { verb, targets[], params } from INTERPRET (L-111 / #298)
 * @param {object} worldState
 * @param {object} characterState
 * @param {number|function} dice - a dice source `(sides) => face`, or a fixed face
 * @param {object} canonWorld - read-only canon (L-103 / #296)
 * @returns {{ outcome: string, mutations: object[], constraints: string[] }}
 */
// Ending the turn (planning/the-loom-movement-and-vision.md §3; L-611 / #441):
// movement and the action are refilled, the plan is kept, and the turn
// counts. Always allowed, wherever the player is. On a battle map, the record
// says how far the player moved this turn, since steps aren't recorded
// (L-613 / #443). The turn takes its length of game time (L-371; game time
// T4): 6 s on a battle map, 5 min anywhere else, from timeRules.
function evaluateEndTurn(characterState, canonWorld, dice, choose = null) {
  // The squares walked this turn (L-832: the turn counts them).
  const spent = turnStateOf(characterState).moved || 0;
  const { map, cell } = maps.positionOf(canonWorld || {}, characterState);
  const ends = clock.timeOf(characterState) + clock.turnSeconds(canonWorld, Boolean(map));
  // The character's conditions tick (L-815): damage each turn, a save to
  // shake one off, a turn off each, game time's end.
  const ticked = tickConditions(characterState, canonWorld, (system, sheet) =>
    effects.endOfTurn(system, sheet, { now: ends, dice })
  );
  // In a fight, everyone else takes their turn, to the player's next (L-821).
  const tickedSheet = (ticked.mutations.find((m) => m.path === 'character.sheet') || {}).value;
  const ticking = tickedSheet
    ? { ...characterState, character: { ...characterState.character, sheet: tickedSheet } }
    : characterState;
  // In a fight, the AP left is kept for reactions until the player's next
  // turn (L-833; action points KP1, KP2): their entry in the fight.
  const inFight = combat.play.fightOf(characterState);
  // (With AP off, L-838, nothing is kept: reactions count by the round.)
  const kept =
    inFight && !apRules.isOff(checks.systemOf(canonWorld))
      ? combat.others.keptFrom(checks.systemOf(canonWorld), turnStateOf(characterState).ap)
      : 0;
  const after = inFight
    ? {
        ...ticking,
        fight: {
          ...inFight,
          combatants: {
            ...inFight.combatants,
            [combat.fight.PLAYER]: { ...inFight.combatants[combat.fight.PLAYER], kept },
          },
        },
      }
    : ticking;
  // Dying (L-827): a save at the end of each of their turns; three of a kind
  // decides it. Dead, the fight and the save end here.
  const dying =
    characterState.down && characterState.down.kind === 'dying' ? characterState.down : null;
  let saved = null;
  if (dying) {
    saved = combat.down.deathSave(
      checks.systemOf(canonWorld),
      tickedSheet || sheets.sheetOf(characterState),
      dying,
      dice
    );
  }
  const round =
    saved && saved.outcome === 'dead'
      ? {
          mutations: combat.down.deathMutations(characterState),
          lines: [],
          fallen: { outcome: 'dead' },
          fight: {
            ended: true,
            winner: 'hostile',
            how: ['down'],
            rounds: (characterState.fight || {}).round || 1,
          },
        }
      : combat.play.afterTurn(canonWorld, saved ? { ...after, down: saved.down } : after, {
          dice,
          choose,
        }) ||
        (characterState.down
          ? // Down with no fight (the fight just ended): what becomes of them.
            combat.play.afterFight(canonWorld, saved ? { ...after, down: saved.down } : after, {
              dice,
            })
          : { mutations: [], lines: [] });
  let moved = '';
  if (map && spent > 0) {
    const feature = maps.at(map, cell).feature;
    moved =
      ' You moved ' +
      spent +
      (spent === 1 ? ' square' : ' squares') +
      (feature ? ', to ' + feature.name : '') +
      '.';
  }
  // A long action under way carries into the next turn, unless the player
  // was hurt meanwhile (CT4): that interrupts it.
  // The next turn's pool is worked out from the sheet as the turn leaves it
  // (L-834): a Stun just shaken off is gone, one a foe just landed counts.
  const lastSheet = ticked.mutations
    .concat(round.mutations)
    .filter((m) => m.path === 'character.sheet' && m.value)
    .pop();
  const leaving = lastSheet
    ? sheets.withAp(
        { ...characterState, character: { ...characterState.character, sheet: lastSheet.value } },
        checks.systemOf(canonWorld)
      )
    : characterState;
  const next = nextTurnState(leaving);
  const hurt = next.long && hurtBy(characterState, ticked.mutations.concat(round.mutations));
  const interrupted = hurt ? ['Hurt, you stop ' + next.long.name + '.'] : [];
  if (hurt) delete next.long;
  return {
    outcome: 'success',
    mutations: [
      { target: 'save', op: 'set-flag', path: 'turn', value: next },
      { target: 'save', op: 'set-flag', path: 'time', value: ends },
      { op: 'increment', path: 'worldClock', value: 1 },
      ...ticked.mutations,
      ...(saved && saved.outcome !== 'dead'
        ? [{ target: 'save', op: 'set-flag', path: 'down', value: saved.down }]
        : []),
      // The round after the conditions' tick: what it does to the sheet (and
      // the time, coming round) wins.
      ...round.mutations,
    ],
    constraints: [
      'Turn ' +
        turnStateOf(characterState).n +
        ' ends.' +
        moved +
        (kept ? ' You keep ' + kept + ' AP for reactions.' : ''),
    ].concat(ticked.lines, saved ? [saved.line] : [], round.lines, interrupted),
    ...(saved
      ? { roll: rolled(saved.roll, 'dying save', checks.systemOf(canonWorld)) }
      : ticked.roll
        ? { roll: ticked.roll }
        : {}),
    ...(round.fight ? { fight: round.fight } : {}),
    ...(round.fallen ? { fallen: round.fallen } : {}),
    ...(round.named && round.named.length ? { named: round.named } : {}),
    ...(round.turns && round.turns.length
      ? { playback: playbackOf(round.turns, characterState, canonWorld) }
      : {}),
    // The AP the player kept, and what the others' turns left of it, for
    // the turn bar (L-837; UI1).
    ...(kept && Number.isInteger(round.keptLeft)
      ? { held: { kept, left: Math.max(0, Math.min(kept, round.keptLeft)) } }
      : {}),
  };
}

// Whether mutations take any of the character's resources down (L-832):
// damage, which interrupts a long action (CT4).
function hurtBy(characterState, mutations) {
  const sheet = sheets.sheetOf(characterState);
  const set = mutations.filter((m) => m.path === 'character.sheet').pop();
  if (!sheet || !set || !set.value) return false;
  const now = sheet.resources || {};
  const after = set.value.resources || {};
  return Object.keys(now).some(
    (id) => after[id] && now[id] && Number(after[id].current) < Number(now[id].current)
  );
}

// The turns everyone else played, for the Loom to play out on the map
// (L-828; combat UI3): each fighter's walk, only the squares the player can
// see once it's done, and their attack's roll as a card.
function playbackOf(turns, characterState, canonWorld, after) {
  if (!turns || !turns.length) return null;
  const system = checks.systemOf(canonWorld);
  const { map, cell } = maps.positionOf(canonWorld || {}, after || characterState);
  const doors = map ? doorStatesOf(after || characterState, map.id) : {};
  const seen = map && cell ? sight.inSight(map, cell, doors) : {};
  return turns.map((t) => ({
    id: t.id,
    name: t.name,
    path: (t.path || [])
      .filter((step) => seen[step.x + ',' + step.y])
      .map((step) => ({ x: step.x, y: step.y })),
    ...(t.attack
      ? {
          attack: {
            target: t.attack.target,
            hit: t.attack.hit,
            ...(t.attack.damage ? { damage: t.attack.damage } : {}),
            ...(t.attack.card
              ? {
                  card: {
                    ...rolled(t.attack.card, t.attack.card.against, system),
                    name: t.attack.card.name,
                  },
                }
              : {}),
          },
        }
      : {}),
  }));
}

// A fight starting where the player stands (L-821; SE1): hostiles in sight
// after a step, who lie in wait, so the player rolls to notice them. The
// rounds before the player's first turn (lost to surprise) take their time.
function evaluateFightStart(characterState, canonWorld, dice, choose = null) {
  if (combat.play.fightOf(characterState)) {
    return { outcome: 'no_op', mutations: [], constraints: ["You're already in a fight."] };
  }
  if (!combat.play.hostilesInSight(canonWorld, characterState).length) {
    return { outcome: 'no_op', mutations: [], constraints: ['Nobody here wants a fight.'] };
  }
  return fightStarted(characterState, canonWorld, {
    by: 'seen',
    ambushers: 'hostile',
    dice,
    choose,
  });
}

// A fight begun (../loom-modules/combat/play.js begin), as a resolution:
// its lines, the player's initiative as the roll card, and the time of the
// rounds lost before the player's first turn.
function fightStarted(characterState, canonWorld, options) {
  const begun = combat.play.begin(canonWorld, characterState, options);
  if (!begun) return null;
  const system = checks.systemOf(canonWorld);
  const lost = begun.rounds * clock.turnSeconds(canonWorld, true);
  return {
    outcome: 'success',
    // The rounds' time first: coming round after a fall (L-827) sets its own.
    mutations: (lost
      ? [
          {
            target: 'save',
            op: 'set-flag',
            path: 'time',
            value: clock.timeOf(characterState) + lost,
          },
        ]
      : []
    ).concat(begun.mutations),
    constraints: begun.lines,
    roll: { ...rolled(begun.roll, 'initiative', system), verdict: begun.roll.verdict },
    fight: begun.fight,
    ...(begun.fallen ? { fallen: begun.fallen } : {}),
    ...(begun.named ? { named: begun.named } : {}),
    ...(begun.turns ? { playback: playbackOf(begun.turns, characterState, canonWorld) } : {}),
  };
}

// A character's conditions, ticked by `tick(system, sheet)` (./effects.js):
// the sheet written back when anything changed, the lines, and the first
// save rolled as the turn's roll card (L-815).
function tickConditions(characterState, canonWorld, tick) {
  const system = checks.systemOf(canonWorld);
  const sheet = sheets.sheetOf(characterState);
  if (!sheet || !(sheet.conditions || []).length) return { mutations: [], lines: [] };
  const t = tick(system, sheet);
  const first = t.rolls[0];
  return {
    mutations: JSON.stringify(t.sheet) === JSON.stringify(sheet) ? [] : [setSheet(t.sheet)],
    lines: t.lines,
    ...(first ? { roll: rolled(first.roll, 'save: ' + first.name, system) } : {}),
  };
}

// Waiting, resting and sleeping (L-374; game time T12, §4.3): a `wait` for
// `params.minutes`, or `params.until` the next start of a part of the day
// (dawn, morning, midday, afternoon, evening, night). Capped at a day. It
// uses the turn's action and ends the turn, so the next starts fresh; the
// wait is its time, so End turn's length isn't added too.
const WAIT_VERBS = { wait: 'wait', rest: 'rest', sleep: 'sleep', nap: 'sleep', camp: 'rest' };
const MAX_WAIT = 24 * clock.HOUR;
const NO_REST = "You can't rest in the middle of a fight.";
const HOW_LONG =
  'How long? Wait a number of minutes, or until dawn, morning, midday, afternoon, evening ' +
  'or night.';

// A short or long rest (L-827; DF5; ../loom-modules/combat/rests.js): its
// hours, what it restores, once a day for a long one; somewhere dangerous it
// may be broken, and hostiles there come for the player.
function evaluateRest(kind, characterState, canonWorld, dice, choose = null) {
  const result = combat.rests.rest(canonWorld, characterState, kind, { dice });
  if (result.refused) return { ...blocked(result.refused), plain: true };
  const mutations = [
    { target: 'save', op: 'set-flag', path: 'turn', value: nextTurnState(characterState) },
    { target: 'save', op: 'set-flag', path: 'time', value: result.to },
    { op: 'increment', path: 'worldClock', value: 1 },
    setSheet(result.sheet),
    { target: 'save', op: 'set-flag', path: 'rested', value: result.rested },
  ];
  const resolution = {
    outcome: result.interrupted ? 'failure' : 'success',
    mutations,
    constraints: result.lines,
    time: travel.timeSpent(clock.timeOf(characterState), result.hours * clock.HOUR),
    rest: { kind, hours: result.hours, ...(result.interrupted ? { interrupted: true } : {}) },
  };
  if (!result.interrupted) return resolution;
  // Broken: hostiles at the place come for the player.
  const after = {
    ...characterState,
    time: result.to,
    character: { ...characterState.character, sheet: result.sheet },
  };
  const fought = fightStarted(after, canonWorld, {
    by: 'event',
    ambushers: 'hostile',
    dice,
    choose,
  });
  if (!fought) return resolution;
  return {
    ...resolution,
    mutations: mutations.concat(fought.mutations),
    constraints: resolution.constraints.concat(fought.constraints),
    roll: fought.roll,
    fight: fought.fight,
    ...(fought.fallen ? { fallen: fought.fallen } : {}),
    ...(fought.named ? { named: fought.named } : {}),
    ...(fought.playback ? { playback: fought.playback } : {}),
  };
}

function evaluateWait(proposedAction, characterState, canonWorld, dice, choose = null) {
  if (combat.play.fightOf(characterState)) return { ...blocked(NO_REST), plain: true };
  // With AP off (L-838), waiting is the turn's action, as before AP.
  if (apRules.isOff(checks.systemOf(canonWorld)) && turnStateOf(characterState).acted) {
    return blocked(ACTED);
  }
  const params = proposedAction.params || {};
  // A short or long rest (L-827), by the system's rests.
  const kind = String(params.rest || '').toLowerCase();
  if (combat.rests.KINDS.includes(kind)) {
    return evaluateRest(kind, characterState, canonWorld, dice, choose);
  }
  // Sleeping or resting, as the player put it ("sleep until dawn").
  const how = WAIT_VERBS[String(params.how || '').toLowerCase()] || WAIT_VERBS[proposedAction.verb];
  const now = clock.timeOf(characterState);
  const until = typeof params.until === 'string' ? params.until.toLowerCase().trim() : null;
  const minutes = Number(params.minutes !== undefined ? params.minutes : NaN);
  let seconds;
  let said;
  if (until) {
    const at = clock.nextStartOf(now, until);
    if (at === null) return blocked(HOW_LONG);
    seconds = at - now;
    said = 'You ' + how + ' until ' + until + '.';
  } else if (Number.isFinite(minutes) && minutes > 0) {
    seconds = Math.min(Math.round(minutes * clock.MINUTE), MAX_WAIT);
    said =
      seconds === MAX_WAIT && minutes * clock.MINUTE > MAX_WAIT
        ? 'You ' + how + ' for a day, as long as anyone can at a stretch.'
        : 'You ' + how + ' for ' + clock.duration(seconds) + '.';
  } else {
    return blocked(HOW_LONG);
  }
  const time = travel.timeSpent(now, seconds);
  // Its conditions tick for every turn the wait lasts (L-815): a long wait
  // outlasts them.
  const { map } = maps.positionOf(canonWorld || {}, characterState);
  const turnSeconds = clock.turnSeconds(canonWorld, Boolean(map));
  const ticked = tickConditions(characterState, canonWorld, (system, sheet) =>
    effects.overTurns(system, sheet, {
      from: now,
      to: time.to,
      turns: Math.min(100, Math.max(1, Math.floor(seconds / turnSeconds))),
      turnSeconds,
      dice,
    })
  );
  return {
    outcome: 'success',
    mutations: [
      { target: 'save', op: 'set-flag', path: 'turn', value: nextTurnState(characterState) },
      { target: 'save', op: 'set-flag', path: 'time', value: time.to },
      { op: 'increment', path: 'worldClock', value: 1 },
      ...ticked.mutations,
    ],
    constraints: [said].concat(ticked.lines),
    ...(ticked.roll ? { roll: ticked.roll } : {}),
    time,
  };
}

// What an action aims at on the battle map the player stands on: its name,
// the squares it stands on (a door, either side of it), and whether it's a
// person (someone placed on a square, §6), or null if it isn't there.
function mapTarget(canonWorld, characterState, map, target) {
  const named = (prefix, list) =>
    typeof target === 'string' && target.indexOf(prefix) === 0
      ? (list || []).find((item) => item.id === target.slice(prefix.length))
      : null;
  const spot = named('feature:', map.features) || named('exit:', map.exits);
  if (spot) return { name: spot.name, squares: [spot] };
  const door = named('door:', map.doors);
  if (door) return { name: door.name || 'the door', squares: doorSides(door), door: true };
  // Someone here (as the grid view lists them: at this place in town, or at
  // this point of interest), standing on a square.
  const person = (canonWorld.characters || {})[target];
  if (!person) return null;
  const host = maps.hostOf(canonWorld, characterState);
  const isPlace = host && Boolean((canonWorld.places || {})[host.id]);
  const here =
    person &&
    host &&
    (isPlace ? person.placeId === host.id : person.locationId === host.id && !person.placeId);
  if (here && !person.retired && person.cell) {
    return { name: person.name, squares: [person.cell], person: true };
  }
  return null;
}

// On a battle map (planning/the-loom-movement-and-vision.md §5; L-636 /
// #459): an action aimed at something out of sight is turned down, and a
// physical one at something out of reach (you must be on or beside its
// square; a feature on an obstacle counts from beside it). Doors keep their
// own reach rule (evaluateDoorAttempt). A line to say, or null.
function outOfSightOrReach(proposedAction, characterState, canonWorld) {
  const { map, cell } = maps.positionOf(canonWorld || {}, characterState);
  if (!map) return null;
  const inSight = sight.inSight(map, cell, doorStatesOf(characterState, map.id));
  const seen = (square) => Boolean(inSight[square.x + ',' + square.y]);
  const near = (square) => Math.max(Math.abs(square.x - cell.x), Math.abs(square.y - cell.y)) <= 1;
  const physical = needsBeside(proposedAction.verb, Boolean(combat.play.fightOf(characterState)));
  for (const target of proposedAction.targets || []) {
    const thing = mapTarget(canonWorld, characterState, map, target);
    if (!thing) continue;
    if (!thing.squares.some(seen)) return thing.person ? NOBODY_SEEN : NOT_SEEN;
    if (physical && !thing.door && !thing.squares.some(near)) {
      return 'You need to be beside ' + thing.name + '.';
    }
  }
  return null;
}

// What an action costs in action points (L-832; planning/action-points.md
// §4.2), by what it is: looking is free; a few words 2; handling an object
// 5; a door 2 and a lock 5; Dodge, Withdraw and an attack their own;
// anything else typed by its tier (L-835: minor, standard or major). A feature's or a
// door's own `ap` and `long` count for what's done to it.
const LOOKING = /^(look|examine|inspect|study|read|watch|observe|peer|glance|listen)/;
// A few words (2 AP); persuading, threatening or deceiving someone is a
// standard action, rolled.
const SPEAKING =
  /^(talk|speak|ask|tell|say|greet|chat|whisper|call|shout|wave|signal|point|nod|hail|answer)/;
const HANDLING =
  /^(take|pick|grab|get|give|hand|drop|throw|pass|use|eat|drink|pull|push|lift|carry|light|turn|press|open|close|shut)/;
function spendOf(proposedAction, characterState, canonWorld, map) {
  const verb = String(proposedAction.verb || '').toLowerCase();
  const params = proposedAction.params || {};
  const named = (prefix, list) => {
    const t = (proposedAction.targets || []).find(
      (x) => typeof x === 'string' && x.indexOf(prefix) === 0
    );
    return t ? (list || []).find((item) => item.id === t.slice(prefix.length)) || null : null;
  };
  const door = map && named('door:', map.doors);
  if (door) {
    const state = layers.doorState(door, doorStatesOf(characterState, map.id));
    const picking = state === 'locked' && !hasKey(characterState, door);
    return picking
      ? { spend: 'lock', what: 'picking the lock', long: door.long, name: door.name }
      : { spend: 'door', what: 'a door', own: door.ap, name: door.name };
  }
  const feature = map && named('feature:', map.features);
  const long = params.long || (feature && feature.long);
  if (LOOKING.test(verb) && !long) return { spend: null };
  if (SPEAKING.test(verb) && !long) return { spend: 'speak', what: 'speaking' };
  if (feature || HANDLING.test(verb)) {
    return {
      spend: 'object',
      what: feature ? 'using ' + feature.name : 'that',
      own: feature && feature.ap,
      long,
      name: feature && feature.name,
    };
  }
  // Anything else typed (L-835; CT3): the tier INTERPRET named, standard
  // when it named none.
  return { spend: 'tier', tier: params.tier, what: 'that', long };
}

// The cost of a spend for this character (their traits and conditions).
function costFor(characterState, canonWorld, spend, own, tier) {
  const system = checks.systemOf(canonWorld);
  if (spend === 'tier') return apRules.tierCost(system, tier);
  return apRules.pricesOf(system, sheets.sheetOf(characterState)).of(spend, own);
}

/**
 * Paying for an action (L-832; CT4): `{ turn }` the turn with its cost
 * spent; `{ refused }` when it costs more than the AP left; or, for a long
 * action (`long: { ap }`), `{ turn, working }` while the AP put in falls
 * short of what it needs (kept on `turn.long` till the next turn), and
 * `{ turn }` once it's done. Starting anything else drops a long action
 * under way. Off a battle map actions cost nothing (WH2).
 */
function payFor(characterState, canonWorld, map, priced, key) {
  if (apRules.isOff(checks.systemOf(canonWorld))) {
    return payWithoutAp(characterState, canonWorld, priced, key);
  }
  const turn = turnStateOf(characterState);
  if (!map || !priced.spend) return { turn, free: true };
  const { long: under, ...rest } = turn;
  const own = Number.isInteger(priced.own) ? priced.own : undefined;
  const need = priced.long && Number.isInteger(priced.long.ap) ? priced.long.ap : null;
  if (need) {
    const going = under && under.key === key ? under : null;
    const put = going ? going.put : 0;
    const more = Math.min(turn.ap, need - put);
    if (more < 1) return { refused: "You've no AP left this turn. End your turn to go on." };
    const name = (going && going.name) || 'working at ' + (priced.name || 'it');
    if (put + more < need) {
      return {
        turn: { ...rest, ap: turn.ap - more, long: { key, name, put: put + more, need } },
        working: `You keep at it: ${put + more} of ${need} AP put in. Carry on next turn.`,
        dropped: under && !going ? under : null,
      };
    }
    return { turn: { ...rest, ap: turn.ap - more, long: null }, dropped: going ? null : under };
  }
  const cost = costFor(characterState, canonWorld, priced.spend, own, priced.tier);
  if (turn.ap < cost) return { refused: apRules.shortLine(priced.what, cost, turn.ap) };
  return { turn: { ...rest, ap: turn.ap - cost, long: null }, dropped: under || null };
}

/**
 * Paying for an action with AP off (L-838; `ap: false`): it uses the turn's
 * action, anywhere, as before AP (L-614); a second is refused. In a fight,
 * the combat module's turn rule says how many a turn has. A long action
 * takes a turn's action for each 10 of its AP. Looking is free.
 */
function payWithoutAp(characterState, canonWorld, priced, key) {
  const turn = turnStateOf(characterState);
  if (!priced.spend) return { turn, free: true };
  if (turn.acted) return { refused: ACTED };
  const inFight = combat.play.fightOf(characterState);
  const allowed = inFight
    ? combat.settings.settingsOf(checks.systemOf(canonWorld)).turn.actions
    : 1;
  const { long: under, ...rest } = turn;
  const used = (turn.actionsUsed || 0) + 1;
  const spent =
    used >= allowed
      ? { ...rest, acted: true, ...(allowed > 1 ? { actionsUsed: used } : {}) }
      : { ...rest, actionsUsed: used };
  const need = priced.long && Number.isInteger(priced.long.ap) ? priced.long.ap : null;
  if (need) {
    const going = under && under.key === key ? under : null;
    const put = (going ? going.put : 0) + 10;
    const name = (going && going.name) || 'working at ' + (priced.name || 'it');
    const turns = Math.ceil(need / 10);
    if (put < need) {
      return {
        turn: { ...spent, long: { key, name, put, need } },
        working: `You keep at it: ${put / 10} of ${turns} turns' work done. Carry on next turn.`,
        dropped: under && !going ? under : null,
      };
    }
    return { turn: { ...spent, long: null }, dropped: going ? null : under };
  }
  return { turn: { ...spent, long: null }, dropped: under || null };
}

/**
 * What an action would cost the character where they stand, in AP (L-832),
 * for the confirm card: a number, or null where it costs nothing (looking,
 * a move, off a battle map). A long action says what it needs in all.
 */
function priceOf(proposedAction, characterState, canonWorld) {
  const { map } = maps.positionOf(canonWorld || {}, characterState);
  if (!map) return null;
  let priced;
  if (attackTargetOf(proposedAction, canonWorld)) {
    const system = checks.systemOf(canonWorld);
    const pick = combat.attackTurn.chosen(
      system,
      sheets.sheetOf(characterState) || sheets.defaultSheet(system),
      (proposedAction.params || {}).attack
    );
    priced = { spend: 'attack', own: pick.attack && pick.attack.ap };
  } else {
    priced = spendOf(proposedAction, characterState, canonWorld, map);
  }
  if (!priced.spend) return null;
  if (priced.long && Number.isInteger(priced.long.ap)) return { long: priced.long.ap };
  return {
    cost: costFor(
      characterState,
      canonWorld,
      priced.spend,
      Number.isInteger(priced.own) ? priced.own : undefined,
      priced.tier
    ),
  };
}

const longKey = (proposedAction) =>
  [String(proposedAction.verb || '').toLowerCase()]
    .concat((proposedAction.targets || []).map(String))
    .join(' ');

// A turn mutation, and the line for a long action dropped by starting another.
const turnSet = (turn) => ({ target: 'save', op: 'set-flag', path: 'turn', value: turn });
const droppedLines = (paid) => (paid.dropped ? ['You stop ' + paid.dropped.name + '.'] : []);

// Anything typed that isn't a move is paid for in AP on a battle map (L-832;
// was the turn's one action, L-614), whether it succeeds or not, and is
// turned down, spending nothing, when the AP left won't cover it. What is
// turned down before it's tried (out of sight or reach; no such door; not
// beside it; no lock to pick) spends nothing. Off a battle map, actions cost
// nothing (WH2).
function evaluateAction(proposedAction, characterState, dice, canonWorld) {
  const inFight = combat.play.fightOf(characterState);
  const { map } = maps.positionOf(canonWorld || {}, characterState);
  // A condition that stops acting (L-815: Stunned) turns it down, unused.
  const stopped = conditions.flagsOf(
    checks.systemOf(canonWorld),
    sheets.sheetOf(characterState)
  ).noAction;
  if (stopped.length) {
    return { ...blocked("You can't act: you're " + stopped.join(' and ') + '.'), plain: true };
  }
  // Dodge, Withdraw and Ready (L-823; TN5): the rules' own, unnarrated;
  // Use something beside you, narrated. Each its cost (L-832).
  const tactic = combatAction(proposedAction, characterState, canonWorld, inFight);
  if (tactic) {
    if (tactic.outcome === 'blocked') return { ...tactic, plain: true };
    const paid = payFor(characterState, canonWorld, map, tactic.priced, longKey(proposedAction));
    if (paid.refused) return { ...blocked(paid.refused), plain: true };
    if (paid.working) {
      return {
        outcome: 'success',
        mutations: [turnSet(paid.turn)],
        constraints: droppedLines(paid).concat([paid.working]),
        ruled: true,
      };
    }
    const { priced, ...told } = tactic;
    const reserved = priced.reserve
      ? { reserved: (turnStateOf(characterState).ap || 0) - paid.turn.ap }
      : {};
    return {
      ...told,
      mutations: tactic.mutations.concat([
        turnSet({ ...paid.turn, ...(tactic.turn || {}), ...reserved }),
      ]),
      constraints: droppedLines(paid).concat(tactic.constraints),
    };
  }
  // An attack at someone on the map (L-822): by the combat module, its
  // reach or range its own; ruled, not narrated, unless a fight starts or
  // ends. Its cost is the attack's own, or the system's (L-832).
  if (attackTargetOf(proposedAction, canonWorld)) {
    const system = checks.systemOf(canonWorld);
    const pick = combat.attackTurn.chosen(
      system,
      sheets.sheetOf(characterState) || sheets.defaultSheet(system),
      (proposedAction.params || {}).attack
    );
    const priced = { spend: 'attack', what: 'an attack', own: pick.attack && pick.attack.ap };
    const paid = payFor(characterState, canonWorld, map, priced, longKey(proposedAction));
    const attacked = attackOn(proposedAction, characterState, dice, canonWorld);
    if (attacked && paid.refused) return { ...blocked(paid.refused), plain: true };
    if (attacked && attacked.outcome === 'blocked') return { ...attacked, plain: true };
    if (attacked) {
      return {
        ...attacked,
        mutations: attacked.mutations.concat(paid.free ? [] : [turnSet(paid.turn)]),
        constraints: droppedLines(paid).concat(attacked.constraints),
      };
    }
  }
  const unreached = outOfSightOrReach(proposedAction, characterState, canonWorld);
  if (unreached) return blocked(unreached);
  const doorTarget = (proposedAction.targets || []).find(
    (t) => typeof t === 'string' && t.indexOf('door:') === 0
  );
  // No such door, or not beside it: turned down by the door's own rules,
  // spending nothing.
  const door = doorTarget && map && (map.doors || []).find((d) => d.id === doorTarget.slice(5));
  if (doorTarget && !(door && besideDoor(door, maps.positionOf(canonWorld, characterState).cell))) {
    return evaluateDoorAttempt(
      proposedAction,
      doorTarget.slice(5),
      characterState,
      dice,
      canonWorld
    );
  }
  const priced = spendOf(proposedAction, characterState, canonWorld, map);
  const paid = payFor(characterState, canonWorld, map, priced, longKey(proposedAction));
  if (paid.refused) return { ...blocked(paid.refused), plain: true };
  if (paid.working) {
    return {
      outcome: 'success',
      mutations: [turnSet(paid.turn)],
      constraints: droppedLines(paid).concat([paid.working]),
      ruled: true,
    };
  }
  const resolution = doorTarget
    ? evaluateDoorAttempt(proposedAction, doorTarget.slice(5), characterState, dice, canonWorld)
    : evaluateGeneric(proposedAction, dice, characterState, canonWorld);
  if (['blocked', 'invalid_target', 'no_op'].includes(resolution.outcome)) return resolution;
  const fought = fightFrom(proposedAction, resolution, characterState, canonWorld);
  return {
    ...resolution,
    mutations: [
      ...resolution.mutations,
      ...(paid.free ? [] : [turnSet(paid.turn)]),
      ...(fought ? fought.mutations : []),
    ],
    constraints: droppedLines(paid).concat(
      resolution.constraints,
      fought ? fought.constraints : []
    ),
    ...(fought && fought.fight ? { fight: fought.fight } : {}),
  };
}

// The actions a fight offers besides attacking (L-823; TN5, PS4, TN4), each
// paid for in AP (L-832; `priced`, what payFor charges):
//   dash      retired: on AP, moving further is spending more on squares
//   stand     standing up, ending Prone (a condition with standUp; L-834)
//   dodge     harder to hit until the player's next turn (the system's dodge)
//   withdraw  moving out of reach draws no attacks this turn
//   ready     an attack (params.attack; their first by default) at the
//             first foe (or targets[0]) to come into its reach or range,
//             before the player's next turn
//   use       something beside them on the map (a feature: a lever, a
//             chest); what it does is the GM's to narrate (decided
//             2026-10-22)
// Returns a resolution, `turn` what to add to the turn and `priced` what it
// costs, or null when the action isn't one of these.
const TACTICS = {
  dash: 'dash',
  sprint: 'dash',
  dodge: 'dodge',
  withdraw: 'withdraw',
  disengage: 'withdraw',
  ready: 'ready',
  use: 'use',
  stand: 'stand',
  rise: 'stand',
  get_up: 'stand',
};
const NO_FIGHT = "That's for a fight, and you aren't in one.";
function combatAction(proposedAction, characterState, canonWorld, inFight) {
  const kind = TACTICS[String(proposedAction.verb || '').toLowerCase()];
  if (!kind) return null;
  const params = proposedAction.params || {};
  const { map } = maps.positionOf(canonWorld || {}, characterState);
  const line = (text) => ({ outcome: 'success', mutations: [], constraints: [text], ruled: true });
  const setFight = (f) => ({ target: 'save', op: 'set-flag', path: 'fight', value: f });
  if (kind === 'use') {
    const feature = (proposedAction.targets || []).find(
      (t) => typeof t === 'string' && t.indexOf('feature:') === 0
    );
    if (!map || !feature) return null;
    const unreached = outOfSightOrReach(proposedAction, characterState, canonWorld);
    if (unreached) return blocked(unreached);
    const thing = (map.features || []).find((f) => f.id === feature.slice(8));
    if (!thing) return blocked(NOT_SEEN);
    return {
      outcome: 'success',
      mutations: [],
      constraints: ['You use ' + thing.name + '.'],
      priced: {
        spend: 'object',
        what: 'using ' + thing.name,
        own: thing.ap,
        long: thing.long,
        name: thing.name,
      },
    };
  }
  // Standing up (L-834): ends what standing up ends (Prone), for its cost.
  if (kind === 'stand') {
    const system = checks.systemOf(canonWorld);
    const sheet = sheets.sheetOf(characterState);
    const down = conditions.activeOn(system, sheet).filter((a) => a.condition.standUp);
    if (!down.length) return blocked("You're already on your feet.");
    const ended = new Set(down.map((a) => a.condition.id));
    const after = {
      ...sheet,
      conditions: (sheet.conditions || []).filter((e) => !ended.has(conditions.idOf(e))),
    };
    return {
      ...line('You stand up.'),
      mutations: [{ target: 'save', op: 'set-flag', path: 'character.sheet', value: after }],
      priced: { spend: 'standUp', what: 'standing up' },
    };
  }
  if (kind === 'dash') {
    return blocked(
      'There is no dashing: every square costs its AP, so walk as far as your AP takes you.'
    );
  }
  if (!inFight) return blocked(NO_FIGHT);
  const f = JSON.parse(JSON.stringify(inFight));
  const me = f.combatants[combat.fight.PLAYER];
  if (kind === 'dodge') {
    me.dodging = true;
    return {
      ...line("You dodge: you're harder to hit until your next turn."),
      mutations: [setFight(f)],
      priced: { spend: 'dodge', what: 'dodging' },
    };
  }
  if (kind === 'withdraw') {
    return {
      ...line('You withdraw: moving away draws no attacks this turn.'),
      turn: { withdrawn: true },
      priced: { spend: 'withdraw', what: 'withdrawing' },
    };
  }
  // Ready: which attack, and perhaps at whom.
  const system = checks.systemOf(canonWorld);
  const pick = combat.attackTurn.chosen(
    system,
    sheets.sheetOf(characterState) || sheets.defaultSheet(system),
    params.attack
  );
  if (pick.refused) return blocked(pick.refused);
  const target = (proposedAction.targets || []).find((t) => f.combatants[t] && t !== 'player');
  me.readied = { attack: pick.attack.id, ...(target ? { target } : {}) };
  const who = target ? ' for ' + f.combatants[target].name : '';
  const reach = pick.attack.range ? 'range' : 'reach';
  return {
    ...line(
      `You ready your ${pick.attack.name.toLowerCase()}${who}: ` +
        `it strikes the first foe to come into its ${reach}.`
    ),
    mutations: [setFight(f)],
    // The attack's cost, set aside now (L-833; KP3): it fires from that,
    // or is lost at the player's next turn.
    priced: { spend: 'attack', what: 'readying an attack', own: pick.attack.ap, reserve: true },
  };
}

// An attack at someone on the battle map (L-822; ../loom-modules/combat/
// attack-turn.js), or null when the action isn't one.
// Whom an attack is at (L-822), or null when the action isn't one.
function attackTargetOf(proposedAction, canonWorld) {
  if (!combat.play.isAttack(proposedAction.verb)) return null;
  const params = proposedAction.params || {};
  return (
    params.target ||
    (proposedAction.targets || []).find((t) => ((canonWorld || {}).characters || {})[t]) ||
    null
  );
}

function attackOn(proposedAction, characterState, dice, canonWorld) {
  const targetId = attackTargetOf(proposedAction, canonWorld);
  if (!targetId) return null;
  const params = proposedAction.params || {};
  return combat.attackTurn.attackTurn(canonWorld, characterState, {
    targetId,
    params,
    dice,
    rolled: (check, against) => rolled(check, against, checks.systemOf(canonWorld)),
  });
}

// What an action does to a fight (L-821; SE1, SE4): a social check that
// succeeds against a foe in one talks them out of it. (An attack starts
// one: attackOn.)
function fightFrom(proposedAction, resolution, characterState, canonWorld) {
  const current = combat.play.fightOf(characterState);
  const params = proposedAction.params || {};
  const target =
    (params.check && params.check.opposedBy) ||
    (proposedAction.targets || []).find((t) => (canonWorld.characters || {})[t]);
  if (!target) return null;
  if (current) {
    const talked = combat.play.talkedDown(
      characterState,
      proposedAction.verb,
      target,
      resolution.outcome === 'success'
    );
    return talked
      ? { mutations: talked.mutations, constraints: talked.lines, fight: talked.fight }
      : null;
  }
  return null;
}

// A typed attempt at a door beside the player (L-626 / #451): with its key, a
// locked door unlocks and opens; picked or forced, it's rolled against the
// lock's difficulty, and unlocked (for this save) on a success. An unlocked
// door opens or closes as asked.
function evaluateDoorAttempt(proposedAction, doorId, characterState, dice, canonWorld) {
  const { map, cell } = maps.positionOf(canonWorld, characterState);
  const door = map && (map.doors || []).find((d) => d.id === doorId);
  if (!door) {
    return {
      outcome: 'invalid_target',
      mutations: [],
      constraints: ["There's no such door here."],
    };
  }
  const name = door.name || 'the door';
  if (!besideDoor(door, cell)) return blocked('You need to be beside ' + name + '.');
  const state = layers.doorState(door, doorStatesOf(characterState, map.id));
  const set = (value) => ({
    target: 'save',
    op: 'set-flag',
    path: `doors.${map.id}.${door.id}`,
    value,
  });
  const verb = String(proposedAction.verb || '');
  const closing = /close|shut|lock$/.test(verb) && !/unlock/.test(verb);
  if (state !== 'locked') {
    if (closing && state === 'open') {
      return {
        outcome: 'success',
        mutations: [set('closed')],
        constraints: ['You close ' + name + '.'],
      };
    }
    if (!closing && state === 'closed' && /^open/.test(verb)) {
      return {
        outcome: 'success',
        mutations: [set('open')],
        constraints: ['You open ' + name + '.'],
      };
    }
    return {
      outcome: 'no_op',
      mutations: [],
      constraints: [name.charAt(0).toUpperCase() + name.slice(1) + " isn't locked."],
    };
  }
  if (hasKey(characterState, door)) {
    return {
      outcome: 'success',
      mutations: [set('open')],
      constraints: ['You unlock ' + name + ' with ' + door.key + ' and open it.'],
    };
  }
  // The lock's difficulty wins over any proposed (DC3), placed on the
  // system's ladder; picking it rolls the system's lock check, or the
  // skill proposed for it (L-803).
  const system = checks.systemOf(canonWorld);
  const proposed = (proposedAction.params && proposedAction.params.check) || null;
  const names = proposed && (proposed.skill || proposed.attribute);
  const check =
    names && !checks.refusal(system, { ...proposed, rung: undefined })
      ? { skill: proposed.skill, attribute: proposed.attribute }
      : system.checks.lock || {};
  const lock = checks.rollCheck(system, {
    check,
    character: characterState.character || null,
    difficulty: checks.canonRung(
      system,
      door.difficulty !== undefined && door.difficulty !== null
        ? door.difficulty
        : DEFAULT_LOCK_DIFFICULTY
    ),
    dice,
  });
  const roll = rolled(lock, 'the lock on ' + name, system);
  if (roll.success) {
    return {
      outcome: 'success',
      roll,
      mutations: [set('closed')],
      constraints: ['The lock gives way: ' + name + ' is unlocked.'],
    };
  }
  return {
    outcome: 'failure',
    roll,
    mutations: [],
    constraints: ['The lock on ' + name + ' holds.'],
  };
}

// After a move (L-821): leaving the fight's map ends it (fled); arriving
// in sight of a hostile, out of one, starts one. Its lines follow the move's,
// and its roll card is the turn's when the move rolled none.
function afterMove(resolution, characterState, canonWorld, dice, choose = null) {
  const after = JSON.parse(JSON.stringify(characterState));
  applyStateMutations(
    after,
    resolution.mutations.filter((m) => m.target === 'save')
  );
  const current = combat.play.fightOf(characterState);
  const changed = current
    ? combat.play.leftMap(characterState, after.mapId)
    : combat.play.hostilesInSight(canonWorld, after).length
      ? fightStarted(after, canonWorld, { by: 'seen', ambushers: 'hostile', dice, choose })
      : null;
  if (!changed) return resolution;
  return {
    ...resolution,
    mutations: resolution.mutations.concat(changed.mutations),
    constraints: resolution.constraints.concat(changed.constraints || changed.lines),
    ...(!resolution.roll && changed.roll ? { roll: changed.roll } : {}),
    fight: changed.fight,
    ...(changed.named ? { named: changed.named } : {}),
    ...(changed.playback ? { playback: changed.playback } : {}),
  };
}

// Wary figures and triggers (L-392; ../loom-modules/combat/wary.js): the
// events an action makes, as its resolution has them: doors opened or
// forced, a feature touched, areas walked into, a challenge's check failed.
// (An attack's are the combat module's own.)
function eventsOf(proposedAction, resolution, characterState, canonWorld) {
  if (['blocked', 'invalid_target', 'no_op'].includes(resolution.outcome)) return [];
  const { map, cell } = maps.positionOf(canonWorld || {}, characterState);
  if (!map) return [];
  const events = [];
  const before = doorStatesOf(characterState, map.id);
  for (const m of resolution.mutations) {
    const door = m.target === 'save' && /^doors\.([^.]+)\.(.+)$/.exec(m.path || '');
    if (!door || door[1] !== map.id) continue;
    const was = layers.doorState((map.doors || []).find((d) => d.id === door[2]) || {}, before);
    events.push(...combat.wary.doorEvents(door[2], was, m.value, { keyed: !resolution.roll }));
  }
  for (const t of proposedAction.targets || []) {
    if (typeof t === 'string' && t.indexOf('feature:') === 0) {
      events.push({ on: 'featureTouched', target: t.slice(8) });
    }
  }
  if (resolution.walked) events.push(...combat.wary.walkEvents(map, cell, resolution.walked));
  const params = proposedAction.params || {};
  const target =
    (params.check && params.check.opposedBy) ||
    (proposedAction.targets || []).find((t) => (canonWorld.characters || {})[t]);
  if (target && params.check && resolution.roll && resolution.roll.success === false) {
    events.push({ on: 'challengeFailed', target, check: params.check });
  }
  return events;
}

// What an action's events turn (L-392), and what follows: out of a fight,
// a hostile now in sight starts one (initiative as ever, no surprise); in
// one, those turned hostile join it.
function afterEvents(resolution, characterState, canonWorld, events, dice, choose = null) {
  if (!events.length) return resolution;
  const after = JSON.parse(JSON.stringify(characterState));
  applyStateMutations(
    after,
    resolution.mutations.filter((m) => m.target === 'save')
  );
  const turned = combat.wary.react(canonWorld, after, events);
  if (!turned.length) return resolution;
  const sided = combat.wary.withTurned(after, turned);
  const seen = combat.figures.withFigures(canonWorld, sided);
  const mutations = resolution.mutations.concat(combat.wary.mutationsOf(turned));
  const constraints = resolution.constraints.concat(combat.wary.linesOf(turned));
  const hostile = turned.filter((t) => t.side === 'hostile').map((t) => t.id);
  if (combat.play.fightOf(sided)) {
    const joined = hostile.length && combat.play.joinFight(seen, sided, hostile, { dice });
    return joined
      ? {
          ...resolution,
          mutations: mutations.concat(joined.mutations),
          constraints: constraints.concat(joined.lines),
        }
      : { ...resolution, mutations, constraints };
  }
  const fought =
    hostile.length && combat.play.hostilesInSight(seen, sided).length
      ? fightStarted(sided, seen, { by: 'event', ambushers: null, dice, choose })
      : null;
  if (!fought) return { ...resolution, mutations, constraints };
  // A fight begun is narrated, however the action was ruled.
  const told = { ...resolution };
  delete told.ruled;
  return {
    ...told,
    mutations: mutations.concat(fought.mutations),
    constraints: constraints.concat(fought.constraints),
    ...(!resolution.roll ? { roll: fought.roll } : {}),
    fight: fought.fight,
    ...(fought.fallen ? { fallen: fought.fallen } : {}),
    ...(fought.named ? { named: fought.named } : {}),
    ...(fought.playback ? { playback: fought.playback } : {}),
  };
}

function evaluate(
  proposedAction,
  worldState,
  characterState,
  dice,
  canonWorld,
  known,
  found,
  { choose = null } = {}
) {
  let resolution;
  // Down (L-827): nothing but ending the turn.
  if (characterState.down && proposedAction.verb !== 'end-turn') {
    return Object.freeze({
      ...blocked(DOWN),
      mutations: Object.freeze([]),
      constraints: Object.freeze([DOWN]),
      plain: true,
    });
  }
  const held = proposedAction.verb === 'move' ? heldBy(canonWorld, characterState) : null;
  const judged = plausibilityOf(proposedAction);
  if (judged) {
    resolution = judged;
  } else if (held) {
    resolution = { ...blocked(held), plain: true };
  } else if (proposedAction.verb === 'move') {
    resolution = evaluateMove(
      proposedAction,
      worldState,
      characterState,
      canonWorld,
      known,
      found,
      diceSource(dice)
    );
  } else if (proposedAction.verb === 'end-turn') {
    resolution = evaluateEndTurn(characterState, canonWorld, diceSource(dice), choose);
  } else if (proposedAction.verb === 'hazard') {
    resolution = evaluateHazard(proposedAction, characterState, diceSource(dice), canonWorld);
  } else if (proposedAction.verb === 'fight') {
    resolution = evaluateFightStart(characterState, canonWorld, diceSource(dice), choose);
  } else if (WAIT_VERBS[proposedAction.verb]) {
    resolution = evaluateWait(proposedAction, characterState, canonWorld, diceSource(dice), choose);
  } else {
    resolution = evaluateAction(proposedAction, characterState, diceSource(dice), canonWorld);
  }
  if (proposedAction.verb === 'move' && resolution.outcome === 'success') {
    resolution = afterMove(resolution, characterState, canonWorld, diceSource(dice), choose);
  }
  // Wary figures turned by what was done (L-392), unless a fight began anyway.
  if (!(resolution.fight && !combat.play.fightOf(characterState))) {
    resolution = afterEvents(
      resolution,
      characterState,
      canonWorld,
      eventsOf(proposedAction, resolution, characterState, canonWorld),
      diceSource(dice),
      choose
    );
  }

  // Resolution is immutable once produced — NARRATE (L-113) can color it, never change it.
  // A move on a battle map also says which squares it walked through, and a
  // walk in town the way it went, for what is seen on the way (COMMIT; L-632,
  // L-671), not for the turn record.
  return Object.freeze({
    outcome: resolution.outcome,
    mutations: Object.freeze(resolution.mutations),
    constraints: Object.freeze(resolution.constraints),
    ...(resolution.roll ? { roll: Object.freeze({ ...resolution.roll }) } : {}),
    // The other side's roll in an opposed check (L-803).
    ...(resolution.opposed ? { opposed: Object.freeze({ ...resolution.opposed }) } : {}),
    // Turned down plainly, unnarrated (L-815: held by a condition).
    ...(resolution.plain ? { plain: true } : {}),
    // A question for the player (L-826: a complicated action), asked plainly.
    ...(resolution.ask ? { ask: resolution.ask } : {}),
    // Ruled by the combat module, not narrated (L-822; EN5).
    ...(resolution.ruled ? { ruled: true } : {}),
    // The attack made this turn (L-822), for the record and the GM.
    ...(resolution.attack ? { attack: Object.freeze({ ...resolution.attack }) } : {}),
    // What became of the player down (L-827): coming round, dead, or a fate
    // for NARRATE to choose.
    ...(resolution.fallen ? { fallen: Object.freeze({ ...resolution.fallen }) } : {}),
    // A fight started or ended this turn (L-821), for the GM.
    ...(resolution.fight ? { fight: Object.freeze({ ...resolution.fight }) } : {}),
    // A hazard walked into (L-815), for the GM.
    ...(resolution.hazard ? { hazard: Object.freeze({ ...resolution.hazard }) } : {}),
    // Everyone else's turns, for the Loom to play out (L-828); not recorded.
    ...(resolution.playback ? { playback: Object.freeze(resolution.playback.slice()) } : {}),
    // The AP the player kept for reactions, and what was left of it (L-837);
    // not recorded.
    ...(resolution.held ? { held: Object.freeze({ ...resolution.held }) } : {}),
    // What the named characters chose in the fight (L-825), for the GM.
    ...(resolution.named ? { named: Object.freeze(resolution.named.slice()) } : {}),
    // A rest taken (L-827), for the GM.
    ...(resolution.rest ? { rest: Object.freeze({ ...resolution.rest }) } : {}),
    // The time it took and the dawns and dusks on the way (L-373), for the GM (L-375).
    ...(resolution.time ? { time: Object.freeze({ ...resolution.time }) } : {}),
    ...(resolution.walked ? { walked: Object.freeze(resolution.walked) } : {}),
    ...(resolution.walkedTown ? { walkedTown: Object.freeze(resolution.walkedTown) } : {}),
    // A journey made (L-384): its stops and the towns passed, for the GM.
    ...(resolution.journey ? { journey: Object.freeze({ ...resolution.journey }) } : {}),
  });
}

// A named character's turn reached with no choice yet (L-825): what to ask.
class NeedChoice extends Error {
  constructor(key, menu) {
    super('A named character is to choose their turn: ' + key);
    this.key = key;
    this.menu = menu;
  }
}
// At most this many named turns are asked of the model in one player's turn;
// past it, the rest fight by their role's tactics.
const MAX_NAMED_TURNS = 12;

/**
 * `decide(menu, { canonWorld, save })`, async, answers a named character's
 * choice of turn (`{ option, reason }`, or null): by default the model's
 * (./named-turns.js); `decide: null` leaves named characters to tactics.
 *
 * `known` is the ground the save knows on its battle map, keyed "x,y" (L-635;
 * ./seen.js knownTo): a move there heads only for and over it.
 *
 * @param {{ proposedAction: object, canonWorld: object, save: object, worldState: object,
 *           known?: object }} params
 * @param {() => number} [rollFn] - override for tests; defaults to the real server-side die
 * @returns {Promise<{ outcome: string, mutations: object[], constraints: string[] }>}
 */
async function adjudicateAction(params, rollFn = rollDie) {
  const { proposedAction, canonWorld, save, worldState, known, found } = params;
  const decide = params.decide === undefined ? namedTurn : params.decide;
  if (!decide) return evaluate(proposedAction, worldState, save, rollFn, canonWorld, known, found);
  // Named characters' turns (L-825; EN3b): evaluate stays pure and
  // synchronous, so a turn that reaches one stops there (NeedChoice), the
  // model is asked, and the turn is worked out again from the start with the
  // same dice, played back in order, and the choices made so far.
  const choices = {};
  const tape = [];
  for (let asked = 0; ; asked++) {
    let at = 0;
    const dice =
      typeof rollFn === 'function'
        ? (sides) => {
            if (at < tape.length) return tape[at++];
            const face = rollFn(sides);
            tape.push(face);
            at += 1;
            return face;
          }
        : rollFn;
    const choose = (key, menu) => {
      if (key in choices) return choices[key];
      if (asked >= MAX_NAMED_TURNS) return null;
      throw new NeedChoice(key, menu);
    };
    try {
      return evaluate(proposedAction, worldState, save, dice, canonWorld, known, found, {
        choose,
      });
    } catch (err) {
      if (!(err instanceof NeedChoice)) throw err;
      choices[err.key] = await Promise.resolve()
        .then(() => decide(err.menu, { canonWorld, save }))
        .catch(() => null);
    }
  }
}

module.exports = {
  evaluate,
  adjudicateAction,
  setOutWalk,
  needsBeside,
  needsNoRoll,
  mapTarget,
  rollDie,
  DEFAULT_DIFFICULTY_CLASS,
  DEFAULT_LOCK_DIFFICULTY,
  ACTED,
  priceOf,
  NOT_SEEN,
  NOBODY_SEEN,
};
