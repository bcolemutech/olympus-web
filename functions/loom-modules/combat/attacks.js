'use strict';

/**
 * Attacks (planning/combat.md §3 AT4, AT5, DF4, §4.4; L-822 / #654): what a
 * fighter can strike with, on their sheet or stat block until L-770 moves
 * attacks onto weapons.
 *
 *   Attack
 *     id, name
 *     reach            squares, for a melee attack (1: beside), or
 *     range            { normal, long } squares, for a ranged one
 *     attack           a sheet formula: the roll to hit ("1d20 + mod(STR) + 2")
 *     damage           a sheet formula: the damage on a hit ("1d8 + mod(STR)")
 *     type             one of the system's damage types (combat's damageTypes)
 *     lethal           whether 0 kills (true, the default) or knocks out (DF4)
 *     ammo?            a resource it spends one of, and can't fire without
 *     onHit?           an effect put on whoever it hits (L-815: { condition,
 *                      duration, save? })
 *     area?            { shape, radius | length | size, width? }: an area
 *                      attack, at the target's square (burst, square) or out
 *                      from the attacker towards it (cone, line); everyone
 *                      caught is rolled against
 *
 * Whose attacks: a sheet's own `attacks`; a player character's sheet without
 * any has the system's starting attacks (combat's `attacks`); and every
 * fighter has the system's unarmed attack unless they list one of that id.
 *
 * Pure: formulas are checked by the formula language (../../loom-canon/
 * formula.js), effects and areas by their own modules (required where used,
 * since they read sheets, which read this).
 */

const formula = require('../../loom-canon/formula');

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const MAX_ATTACKS = 20;
const MAX_SQUARES = 100;
const MAX_FORMULA = 300;
const AREA_FIELDS = ['shape', 'radius', 'length', 'size', 'width'];
const FIELDS = [
  'id',
  'name',
  'reach',
  'range',
  'attack',
  'damage',
  'type',
  'lethal',
  'ammo',
  'onHit',
  'area',
];
// The unarmed attack when a system names none: a plain d20 for 1.
const UNARMED = Object.freeze({
  id: 'unarmed',
  name: 'Unarmed',
  reach: 1,
  attack: '1d20',
  damage: '1',
  lethal: false,
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** The system's combat settings, as given. */
const combatOf = (system) => (system && system.modules && system.modules.combat) || {};

/** The system's damage types: [{ id, name }]. */
function damageTypesOf(system) {
  const types = combatOf(system).damageTypes;
  return Array.isArray(types) ? types.filter((t) => isObject(t) && t.id) : [];
}

/** The system's unarmed attack, with its defaults. */
function unarmedOf(system) {
  const given = combatOf(system).unarmed;
  return isObject(given) ? { ...UNARMED, ...given, id: given.id || UNARMED.id } : { ...UNARMED };
}

/**
 * What's wrong with an attack for this system, each named (`where` its place:
 * "attacks[0]"). Errors only.
 */
function validateAttack(system, attack, where = 'attack') {
  if (!isObject(attack)) return [`${where} must be an object.`];
  const errors = [];
  for (const key of Object.keys(attack)) {
    if (!FIELDS.includes(key)) errors.push(`${where}: "${key}" isn't part of an attack.`);
  }
  if (typeof attack.id !== 'string' || !ID.test(attack.id)) {
    errors.push(`${where}.id must start with a letter and use letters, digits, - and _.`);
  }
  if (typeof attack.name !== 'string' || !attack.name.trim() || attack.name.length > 60) {
    errors.push(`${where}.name is required (at most 60 characters).`);
  }
  const hasReach = attack.reach !== undefined;
  const hasRange = attack.range !== undefined;
  if (hasReach === hasRange) {
    errors.push(`${where} needs reach (melee, in squares) or range ({ normal, long }), not both.`);
  } else if (hasReach && !whole(attack.reach, 1, 10)) {
    errors.push(`${where}.reach must be a whole number of squares from 1 to 10.`);
  } else if (hasRange) {
    const r = attack.range;
    if (!isObject(r) || !whole(r.normal, 1, MAX_SQUARES) || !whole(r.long, r.normal, MAX_SQUARES)) {
      errors.push(
        `${where}.range must be { normal, long }: whole squares, long at least normal, ` +
          `at most ${MAX_SQUARES}.`
      );
    }
  }
  for (const part of ['attack', 'damage']) {
    const value = attack[part];
    if (typeof value === 'number' && Number.isFinite(value)) continue;
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_FORMULA) {
      errors.push(`${where}.${part} must be a formula (at most ${MAX_FORMULA} characters).`);
      continue;
    }
    const checked = formula.check(value, { system });
    checked.errors.forEach((e) => errors.push(`${where}.${part}: ${e}`));
    if (!checked.errors.length && checked.type === 'bool') {
      errors.push(`${where}.${part} must come to a number, not a comparison.`);
    }
  }
  const types = damageTypesOf(system);
  if (types.length) {
    if (!types.some((t) => t.id === attack.type)) {
      errors.push(
        `${where}.type must be one of the system's damage types (${types.map((t) => t.id).join(', ')}).`
      );
    }
  } else if (attack.type !== undefined && typeof attack.type !== 'string') {
    errors.push(`${where}.type must be a damage type's id.`);
  }
  if (attack.lethal !== undefined && typeof attack.lethal !== 'boolean') {
    errors.push(`${where}.lethal must be true or false.`);
  }
  if (attack.ammo !== undefined) {
    const resources = ((system.sheet || {}).resources || []).map((r) => r.id);
    if (!resources.includes(attack.ammo)) {
      errors.push(`${where}.ammo "${attack.ammo}" isn't one of the system's resources.`);
    }
  }
  if (attack.onHit !== undefined) {
    const effects = require('../../loom-canon/effects');
    effects
      .validateEffect(system, attack.onHit)
      .forEach((e) => errors.push(`${where}.onHit: ${e}`));
  }
  if (attack.area !== undefined) {
    const area = attack.area;
    if (!isObject(area)) errors.push(`${where}.area must be { shape, radius | length | size }.`);
    else {
      const extra = Object.keys(area).filter((k) => !AREA_FIELDS.includes(k));
      if (extra.length) {
        errors.push(
          `${where}.area: ${extra.join(', ')} is set where it's used, not on the attack.`
        );
      }
      if (area.shape === 'aura') errors.push(`${where}.area can't be an aura.`);
      else {
        const areas = require('../../loom-canon/areas');
        areas
          .validateArea({ width: 61, height: 61 }, { ...area, x: 30, y: 30, facing: 'north' })
          .forEach((e) => errors.push(`${where}.${e}`));
      }
    }
  }
  return errors;
}

/** What's wrong with a list of attacks (a sheet's, or the system's starting ones). */
function validateAttacks(system, list, where = 'attacks') {
  if (!Array.isArray(list)) return [`${where} must be a list.`];
  const errors = [];
  if (list.length > MAX_ATTACKS) errors.push(`${where} has more than ${MAX_ATTACKS}.`);
  const ids = new Set();
  list.forEach((a, i) => {
    errors.push(...validateAttack(system, a, `${where}[${i}]`));
    if (a && ids.has(a.id)) errors.push(`${where}[${i}].id "${a.id}" is used twice.`);
    if (a) ids.add(a.id);
  });
  return errors;
}

/**
 * A fighter's attacks (AT4): their sheet's own, or, for a player character
 * (`player`) whose sheet lists none, the system's starting attacks; with the
 * system's unarmed attack unless one of its id is listed. Each with `lethal`
 * filled in.
 */
function attacksOf(system, sheet, { player = false } = {}) {
  const own = sheet && Array.isArray(sheet.attacks) ? sheet.attacks : null;
  const starting = Array.isArray(combatOf(system).attacks) ? combatOf(system).attacks : [];
  const list = (own || (player ? starting : [])).slice();
  const unarmed = unarmedOf(system);
  if (!list.some((a) => a.id === unarmed.id)) list.push(unarmed);
  return list.map((a) => ({ ...a, lethal: a.lethal !== false }));
}

/** One of a fighter's attacks by id, or their first (the unarmed one last). */
function attackOf(system, sheet, id, options) {
  const list = attacksOf(system, sheet, options);
  return (id ? list.find((a) => a.id === id) : list[0]) || null;
}

module.exports = {
  UNARMED,
  combatOf,
  damageTypesOf,
  unarmedOf,
  validateAttack,
  validateAttacks,
  attacksOf,
  attackOf,
};
