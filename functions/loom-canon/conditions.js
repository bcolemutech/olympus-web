'use strict';

/**
 * Conditions on a sheet (planning/game-systems.md §3 EF3, §4.10; L-815 /
 * #642): what the effects on a character change while they last. Shared by
 * the sheet (./sheets.js: speed, resource maximums), checks (./checks.js:
 * attributes, skills, the check itself, a pool's dice) and the effects
 * engine (./effects.js), which puts them on and takes them off.
 *
 *   A system's condition (sheet.conditions, with 'conditions' on)
 *     { id, name, description?,
 *       modifiers?: { [target]: formula },   added while it lasts:
 *                     checks   every check's result (or, rolling under,
 *                              what it must be under)
 *                     dice     a pool's dice (count(...) checks)
 *                     speed    movement a turn
 *                     an attribute, skill or resource id: its score, its
 *                     rank, its maximum
 *       each?: { [resource]: formula },      at the end of each turn: damage
 *                                            (negative) or healing
 *       noAction?, noMove? }                 can't act, can't move
 *
 *   An effect on a sheet (sheet.conditions)
 *     { condition, source?, duration: { rounds | turns | seconds | untilSaved },
 *       save?, since }
 *
 * Modifier formulas read the character's own scores (never dice: they hold
 * while the condition does). Pure: no I/O.
 */

const formula = require('./formula');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const conditionsOn = (system) =>
  (((system && system.sheet) || {}).optional || []).includes('conditions');

// What a modifier may change besides the sheet's own fields.
const MODIFIER_KINDS = ['checks', 'dice', 'speed'];

/** The id of the condition an effect puts on (L-811's `{ id }`, or L-815's `{ condition }`). */
function idOf(effect) {
  return isObject(effect) ? effect.condition || effect.id || null : null;
}

/** A system's condition by id, or null (none without 'conditions' on). */
function conditionOf(system, id) {
  if (!conditionsOn(system)) return null;
  return ((system.sheet || {}).conditions || []).find((c) => c.id === id) || null;
}

/**
 * The effects on a sheet the system knows, each with its condition:
 * `[{ effect, condition }]`. An effect whose condition the system doesn't
 * list does nothing (it is a misfit, SY2).
 */
function activeOn(system, sheet) {
  const list = sheet && Array.isArray(sheet.conditions) ? sheet.conditions : [];
  return list
    .map((effect) => ({ effect, condition: conditionOf(system, idOf(effect)) }))
    .filter((a) => a.condition);
}

/**
 * What the conditions on a sheet add, by target: `{ [target]: [{ id, name,
 * value }] }`, each worked out from `values` (the character's own scores).
 * A formula that can't be worked out adds nothing.
 */
function modifiersOf(system, sheet, values) {
  const out = {};
  for (const { condition } of activeOn(system, sheet)) {
    for (const [target, text] of Object.entries(condition.modifiers || {})) {
      let value;
      try {
        value = formula.evaluate(String(text), { values, system, dice: () => 1 }).total;
      } catch {
        continue;
      }
      if (!Number.isFinite(value) || value === 0) continue;
      (out[target] = out[target] || []).push({ id: condition.id, name: condition.name, value });
    }
  }
  return out;
}

/** The sum of what the conditions add to one target. */
function sumOf(mods, target) {
  return (mods[target] || []).reduce((sum, m) => sum + m.value, 0);
}

/**
 * What the conditions on a sheet stop: `{ noAction: [name], noMove: [name] }`,
 * each the names of the conditions doing it.
 */
function flagsOf(system, sheet) {
  const flags = { noAction: [], noMove: [] };
  for (const { condition } of activeOn(system, sheet)) {
    if (condition.noAction) flags.noAction.push(condition.name);
    if (condition.noMove) flags.noMove.push(condition.name);
  }
  return flags;
}

module.exports = {
  MODIFIER_KINDS,
  idOf,
  conditionOf,
  conditionsOn,
  activeOn,
  modifiersOf,
  sumOf,
  flagsOf,
};
