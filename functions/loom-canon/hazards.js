'use strict';

/**
 * Hazards on battle maps (planning/game-systems.md §3 EF8, EF9, §4.10; L-815
 * / #642): a gas cloud, a fire, a patch of thorns, placed over MCP
 * (set_hazards). Walking into one triggers it: ADJUDICATE rolls its save
 * with the server's dice and puts its effect on a failure (./effects.js),
 * and NARRATE is told. A seen hazard's squares are drawn on the grid.
 *
 *   Hazard (a battle map's `hazards`)
 *     id, name     "the gas", as players would say it
 *     area         a burst, cone, line or square on the map (./areas.js),
 *                  in line of effect from its origin: walls and closed doors
 *                  (as the save has them) stop it
 *     effect       { condition, duration, save? } (./effects.js): the save's
 *                  `against` a rung, a number on the d20 scale locks use, or
 *                  a formula; `when` apply and/or endOfTurn
 *     description? what it looks like, for the GM
 *
 * A step triggers a hazard when it goes from a square outside it to one
 * inside; walking on within it doesn't again. Pure.
 */

const areas = require('./areas');
const effects = require('./effects');

const MAX_HAZARDS = 30;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const key = (cell) => cell.x + ',' + cell.y;

/** The squares a hazard covers, keyed "x,y", for a save's doors (`states`). */
function squaresOf(map, hazard, states = {}) {
  return hazard && hazard.area ? areas.squaresOf(map, hazard.area, { states }) : {};
}

/**
 * What's wrong with a map's hazards against the world's system:
 * `{ errors, warnings }`, each named. Warnings: a hazard over an entry
 * (arriving there isn't walking into it) or an exit.
 */
function validate(system, map, hazards) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(hazards)) return { errors: ['hazards must be a list.'], warnings };
  if (hazards.length > MAX_HAZARDS) errors.push(`A map has at most ${MAX_HAZARDS} hazards.`);
  const ids = new Set();
  hazards.forEach((h, i) => {
    const at = isObject(h) && h.id ? `The hazard "${h.id}"` : `hazards[${i}]`;
    if (!isObject(h)) return errors.push(`${at} must be an object.`);
    if (ids.has(h.id)) errors.push(`Two hazards are "${h.id}".`);
    ids.add(h.id);
    if (isObject(h.area) && h.area.shape === 'aura') {
      errors.push(
        `${at}: an aura moves with whoever has it; a hazard stays put (burst, cone, line or square).`
      );
    } else {
      areas.validateArea(map, h.area).forEach((e) => errors.push(`${at}: ${e}`));
    }
    effects.validateEffect(system, h.effect).forEach((e) => errors.push(`${at}: ${e}`));
    if (errors.length) return undefined;
    const squares = squaresOf(map, h);
    if (!Object.keys(squares).length) errors.push(`${at} covers no square.`);
    for (const [list, what] of [
      [map.entries, 'entry'],
      [map.exits, 'exit'],
    ]) {
      for (const item of list || []) {
        if (squares[key(item)]) {
          warnings.push(
            `${at} covers the ${what} "${item.id}" at (${item.x}, ${item.y}): ` +
              (what === 'entry'
                ? "arriving there doesn't trigger it, only walking into it."
                : 'players must cross it to leave by it.')
          );
        }
      }
    }
    return undefined;
  });
  return { errors, warnings };
}

/**
 * The hazard a step from `from` to `to` walks into, or null: one whose
 * squares hold `to` and not `from`.
 */
function enteredBy(map, from, to, states = {}) {
  for (const hazard of map.hazards || []) {
    const squares = squaresOf(map, hazard, states);
    if (squares[key(to)] && !(from && squares[key(from)])) return hazard;
  }
  return null;
}

/** The hazards in sight, each with the squares of it in sight (EF9): for the grid view. */
function seenOn(map, inSight, states = {}) {
  return (map.hazards || [])
    .map((hazard) => ({
      hazard,
      squares: Object.keys(squaresOf(map, hazard, states)).filter((k) => inSight[k]),
    }))
    .filter((h) => h.squares.length);
}

/** Hazard id lookup on a world's map. */
function find(world, mapId, hazardId) {
  const map = (world.battleMaps || {})[mapId];
  return map ? (map.hazards || []).find((h) => h.id === hazardId) || null : null;
}

module.exports = { MAX_HAZARDS, squaresOf, validate, enteredBy, seenOn, find };
