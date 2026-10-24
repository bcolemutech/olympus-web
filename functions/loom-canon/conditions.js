'use strict';

/**
 * Conditions on a sheet (planning/game-systems.md §3 EF3, §4.10; L-815 /
 * #642): what the effects on a character change while they last. Shared by
 * the sheet (./sheets.js: action points, resource maximums), checks (./checks.js:
 * attributes, skills, the check itself, a pool's dice) and the effects
 * engine (./effects.js), which puts them on and takes them off.
 *
 *   A system's condition (sheet.conditions, with 'conditions' on)
 *     { id, name, description?,
 *       modifiers?: { [target]: formula },   added while it lasts:
 *                     checks   every check's result (or, rolling under,
 *                              what it must be under)
 *                     dice     a pool's dice (count(...) checks)
 *                     ap       action points a turn (L-831)
 *                     an attribute, skill or resource id: its score, its
 *                     rank, its maximum
 *       each?: { [resource]: formula },      at the end of each turn: damage
 *                                            (negative) or healing
 *       costs?: { [spend]: n | 'x2' | 'never' },  what AP buys at (L-831,
 *                                            ./ap.js); 'never', not at all
 *       ap?: n,                              sets the pool (L-834): 0, Stunned
 *       standUp? }                           ended by standing up, for its
 *                                            cost (Prone)
 *   (The flags noAction and noMove, from before AP, are converted by
 *   ./ap.js: noAction to `ap: 0`, noMove to moving at 'never'.)
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
const MODIFIER_KINDS = ['checks', 'dice', 'ap'];

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
 * What the conditions on a sheet stop (L-834): `{ noAction: [name], noMove:
 * [name] }`, each the names of the conditions doing it. A condition that
 * sets the pool to 0 (Stunned) stops both; one that makes moving cost
 * 'never' (Restrained) stops moving. The same with AP off (L-838).
 */
function flagsOf(system, sheet) {
  const flags = { noAction: [], noMove: [] };
  for (const { condition } of activeOn(system, sheet)) {
    const empty = condition.ap === 0 || condition.noAction === true;
    const costs = isObject(condition.costs) ? condition.costs : {};
    if (empty) flags.noAction.push(condition.name);
    if (empty || costs.move === 'never' || condition.noMove === true) {
      flags.noMove.push(condition.name);
    }
  }
  return flags;
}

/** The pool the conditions on a sheet set (`ap: n`; the lowest), or null (L-834). */
function poolSetBy(system, sheet) {
  const set = activeOn(system, sheet)
    .map((a) => a.condition.ap)
    .filter((n) => Number.isInteger(n) && n >= 0);
  return set.length ? Math.min(...set) : null;
}

/**
 * What a condition does to AP, for the player and the GM (L-834): "0 AP",
 * "−10 AP", "moving costs ×2", "can't move", "ended by standing up", or ''.
 */
function apNoteOf(condition) {
  if (!isObject(condition)) return '';
  const notes = [];
  if (Number.isInteger(condition.ap)) notes.push(condition.ap + ' AP');
  const mod = isObject(condition.modifiers) && condition.modifiers.ap;
  if (mod !== undefined && mod !== false && !Number.isInteger(condition.ap)) {
    notes.push(String(mod).replace(/^\s*-/, '−') + ' AP');
  }
  const costs = isObject(condition.costs) ? condition.costs : {};
  const named = { move: 'moving', difficult: 'difficult ground', attack: 'attacking' };
  for (const [spend, value] of Object.entries(costs)) {
    const what = named[spend] || spend;
    if (spend === 'difficult' && costs.move === value) continue; // said with moving
    if (value === 'never') notes.push(spend === 'move' ? "can't move" : `no ${what}`);
    else if (typeof value === 'string') notes.push(`${what} costs ${value.replace(/^x/, '×')}`);
    else notes.push(`${what} costs ${value} AP`);
  }
  if (condition.standUp) notes.push('ended by standing up');
  return notes.join(', ');
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
  poolSetBy,
  apNoteOf,
};
