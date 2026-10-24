'use strict';

/**
 * Reaching what an action is aimed at (#673): talking with someone,
 * examining or using something needs the player beside it (ADJUDICATE's
 * reach rule, `needsBeside`). When it's out of reach, the rules work out the
 * walk there, for the player to confirm before anything is spent:
 *
 *   reachPlan(canonWorld, save, proposedAction, known)
 *     → null                      nothing to reach (no target, in reach, a
 *                                 sight-only action, or nothing the rules
 *                                 know to walk to)
 *     | { refused }               the target can't be reached: unseen, or
 *                                 no way to a square beside it
 *     | { kind: 'map', name, cell, squares, thisTurn }
 *                                 on the battle map: the square beside it to
 *                                 walk to, how far (as movement counts) and
 *                                 whether it's reached this turn
 *     | { kind: 'town', name, placeId, placeName }
 *                                 in town, someone at another place: go there
 *
 * `known` is the squares the save knows, keyed "x,y" (./seen.js).
 *
 * Pure.
 */

const maps = require('../loom-canon/maps');
const sight = require('../loom-canon/sight');
const combat = require('../loom-modules/combat');
const { planStep, doorStatesOf } = require('./steps');
const { needsBeside, mapTarget } = require('./adjudicate');

const TRIES = 24;
// Moves walk there themselves; attacks have their own reach and range (the
// combat module); a fight's other actions are the rules' own.
const OWN_WAY =
  /^(move|go|walk|run|head|travel|approach|enter|leave|exit|step|return|follow|flee|attack|strike|shoot|hit|fight|dash|dodge|withdraw|ready|end-turn|continue|door|hazard|rest|wait)/;
const key = (c) => c.x + ',' + c.y;
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// The squares beside some target squares (and on them, for a feature or an
// exit), nearest the player first.
function besideSquares(map, squares, from, standOn) {
  const out = new Map();
  for (const sq of squares) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!standOn && !dx && !dy) continue;
        const c = { x: sq.x + dx, y: sq.y + dy };
        if (!maps.inBounds(map, c)) continue;
        out.set(key(c), c);
      }
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      chebyshev(a, from) - chebyshev(b, from) ||
      (a.x - from.x) ** 2 + (a.y - from.y) ** 2 - ((b.x - from.x) ** 2 + (b.y - from.y) ** 2) ||
      a.y - b.y ||
      a.x - b.x
  );
}

function mapPlan(canonWorld, save, proposedAction, known) {
  const { map, cell: from } = maps.positionOf(canonWorld, save);
  if (!map) return null;
  const inFight = Boolean(combat.play.fightOf(save));
  if (!needsBeside(proposedAction.verb, inFight)) return null;
  const inSight = sight.inSight(map, from, doorStatesOf(save, map.id));
  for (const target of proposedAction.targets || []) {
    const thing = mapTarget(canonWorld, save, map, target);
    if (!thing || thing.door) continue;
    if (!thing.squares.some((s) => inSight[key(s)])) return null; // ADJUDICATE says so
    if (thing.squares.some((s) => chebyshev(s, from) <= 1)) return null; // in reach
    const squares = besideSquares(map, thing.squares, from, !thing.person).filter(
      (c) => !known || known[key(c)]
    );
    for (const c of squares.slice(0, TRIES)) {
      if (c.x === from.x && c.y === from.y) return null;
      const step = planStep(canonWorld, save, { cell: c }, known);
      if (step.refused || step.exit) continue;
      const rest = (step.turn.plan && step.turn.plan.path) || [];
      return {
        kind: 'map',
        name: thing.name,
        cell: c,
        squares: (step.walked || []).length + rest.length,
        thisTurn: !step.turn.plan,
      };
    }
    return { refused: "There's no way to " + thing.name + ' from here.' };
  }
  return null;
}

// In town: someone at another place in it (a character's `placeId`).
function townPlan(canonWorld, save, proposedAction) {
  if (save.mapId || !needsBeside(proposedAction.verb, false)) return null;
  for (const target of proposedAction.targets || []) {
    const person = (canonWorld.characters || {})[target];
    if (!person || person.retired || !person.placeId) continue;
    const place = (canonWorld.places || {})[person.placeId];
    if (!place || place.locationId !== save.location) continue;
    if (save.placeId === place.id) return null;
    return { kind: 'town', name: person.name, placeId: place.id, placeName: place.name };
  }
  return null;
}

function reachPlan(canonWorld, save, proposedAction, known) {
  if (OWN_WAY.test(String(proposedAction.verb || ''))) return null;
  return (
    mapPlan(canonWorld, save, proposedAction, known) || townPlan(canonWorld, save, proposedAction)
  );
}

module.exports = { reachPlan };
