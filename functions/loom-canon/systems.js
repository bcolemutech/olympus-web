'use strict';

/**
 * Game systems as data (planning/game-systems.md §3 SY1–SY7, MD1–MD3, §4.1;
 * L-801 / #627). A world has one game system, a document in `loom_systems`
 * written over MCP like canon; every world names one (`world.systemId`).
 *
 *   System
 *     id, name, version (raised on each change), credits: [{ source, licence, url? }]
 *     words:   { [thing]: word }        names the Loom shows ("health": "Hull")
 *     sheet:
 *       attributes: [{ id, name, min, max, modifier }]  modifier: a formula
 *       resources:  [{ id, name, max }]                  max: a formula
 *       level:      { min, max }
 *       ap:         a formula: action points a turn (default 20; L-831,
 *                   ./ap.js), plus what traits and conditions add
 *       optional:   which optional parts are on: skills, traits, conditions, derived
 *       skills:     [{ id, name, attribute }]            (with 'skills')
 *       traits:     [{ id, name, description?, modifiers?, resist?, weak?,
 *                   reaction? }]
 *                   (with 'traits'): modifiers { ap: formula } added while
 *                   it's held; costs { [spend]: n | 'x2' } what it changes
 *                   AP prices to (L-831); resist and weak list damage types it halves or
 *                   doubles (L-822, combat's damageTypes); reaction
 *                   { defend, against? } a defending reaction it gives
 *                   (L-823): the formula added to the holder's defence
 *                   against melee, ranged or all attacks
 *       conditions: [{ id, name, description?, modifiers?, each?, costs?, noAction?,
 *                   noMove?, resist?, weak? }]
 *                   (with 'conditions'; L-815, ./conditions.js): what each does
 *       derived:    [{ id, name, formula }]              (with 'derived')
 *     checks:  { formula, degrees: { [degree]: formula }, ladder: [{ name, value }] }
 *     creation: { method: 'array' | 'pointBuy' | 'rolling', ...its settings }
 *     advancement: {}                    empty for now (L-830)
 *     modules: { [module]: settings }    combat (L-821, ../loom-modules/combat/);
 *                                        others are kept, unused, with a warning
 *     tables:  { [name]: [{ min?, max?, value }] }   lookups for table(name, x)
 *     ap:      { costs?, tiers?, keepLimit? }  what AP pays for (L-831; ./ap.js)
 *     gmNotes: tone and pacing for NARRATE
 *
 * Formulas are text in the formula language (./formula.js; L-802), checked
 * on save where they stand: a sheet formula reads the sheet's fields and
 * level; the check formula also `attribute`, `modifier` and `rank` (what it
 * is rolled with); a degree is a comparison that also reads `result` and
 * `difficulty`. A modifier can't use mod(). Warnings: an attribute nothing
 * uses, and a ladder rung no check can reach.
 *
 * Sheet field ids (attributes, resources, skills, derived values) are the
 * names formulas use, so they are unique across the sheet.
 *
 * A world without a system reads as the built-in fantasy system (SY4). The
 * built-in systems, `d20-fantasy` and `pool-scifi`, are in ./built-in-systems.js
 * (L-804); their ids can't be set over MCP, only copied (SY5).
 *
 * Every save uses a system's latest version (SY2): loading a world loads its
 * system as it is now. `misfits` is where L-811 says what of a sheet no
 * longer fits it.
 *
 * A system written before action points (`sheet.speed`, `modifiers.speed`,
 * combat's `economy`) is converted to them (./ap.js convert): when it's set,
 * with warnings saying what changed, and when it's read.
 */

const SYSTEMS_COLLECTION = 'loom_systems';
const DEFAULT_SYSTEM_ID = 'd20-fantasy';
const OPTIONAL_PARTS = ['skills', 'traits', 'conditions', 'derived'];
const DEGREES = ['criticalFailure', 'failure', 'successAtCost', 'success', 'criticalSuccess'];
const CREATION_METHODS = ['array', 'pointBuy', 'rolling'];
// What a trait's modifiers may change (L-811); a condition's (L-815) may
// also change any attribute, skill or resource.
const MODIFIER_TARGETS = ['ap'];
// What a trait's defending reaction works against (L-823).
const REACTION_AGAINST = ['melee', 'ranged', 'all'];
const { MODIFIER_KINDS: CONDITION_TARGETS } = require('./conditions');

const formulaLanguage = require('./formula');
const apRules = require('./ap');

// The modules built (MD1; ../loom-modules/): each checks its own settings.
const MODULES = { combat: require('../loom-modules/combat/settings') };

// Whether a formula rolls dice (a modifier holds while it lasts, so it can't).
function rollsDice(text) {
  if (typeof text !== 'string') return false;
  let tree;
  try {
    tree = formulaLanguage.parse(text);
  } catch {
    return false; // the formula check says what's wrong
  }
  const walk = (n) =>
    Boolean(n) &&
    typeof n === 'object' &&
    (n.k === 'dice' ||
      n.k === 'count' ||
      Object.values(n).some((v) => (Array.isArray(v) ? v.some(walk) : walk(v))));
  return walk(tree);
}

// The names each place a formula is in may use besides the sheet's fields
// (L-802): a check reads the attribute and skill it is rolled with, and a
// degree the check's result against the rung it was rolled at.
const CHECK_NAMES = ['attribute', 'modifier', 'rank'];
const PLACE_NAMES = {
  sheet: [],
  modifier: [],
  check: CHECK_NAMES,
  degree: CHECK_NAMES.concat(['result', 'difficulty', 'natural']),
};
// Words formulas use, which no sheet field may be named.
const RESERVED_NAMES = formulaLanguage.FUNCTIONS.concat(PLACE_NAMES.degree, ['level']);

const SYSTEM_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FIELD_ID = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const MAX_LIST = 60;
const MAX_FORMULA = 500;
const MAX_TEXT = 4000;

// The built-in systems (SY3; L-804): set in code, copied over MCP, never set there.
const { FANTASY, SCIFI } = require('./built-in-systems');
const BUILT_IN = Object.freeze({ [FANTASY.id]: FANTASY, [SCIFI.id]: SCIFI });
const RESERVED_IDS = Object.freeze(Object.keys(BUILT_IN));

class SystemError extends Error {
  constructor(errors) {
    super(errors.join(' '));
    this.errors = errors;
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const copyOf = (value) => JSON.parse(JSON.stringify(value));

// A trait's or condition's resistances and weaknesses (L-822; combat AT3):
// lists of the system's damage types.
function checkDamageTypes(item, at, system, errors) {
  const combat = (system.modules && system.modules.combat) || {};
  const types = Array.isArray(combat.damageTypes) ? combat.damageTypes.map((t) => t && t.id) : [];
  for (const part of ['resist', 'weak']) {
    if (item[part] === undefined) continue;
    if (!Array.isArray(item[part]) || item[part].some((t) => typeof t !== 'string')) {
      errors.push(`${at}.${part} must be a list of damage types.`);
    } else {
      const unknown = item[part].filter((t) => !types.includes(t));
      if (unknown.length) {
        errors.push(
          `${at}.${part}: "${unknown[0]}" isn't one of the system's damage types` +
            ` (${types.join(', ') || 'none set: modules.combat.damageTypes'}).`
        );
      }
    }
  }
}
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v.trim() : v);

/**
 * Checks a system and returns `{ errors, warnings, system }`: the system with
 * its text trimmed and its defaults filled in. Errors refuse a save;
 * warnings are returned with it (FX3).
 */
function validateSystem(given) {
  const errors = [];
  const warnings = [];
  if (!isObject(given)) return { errors: ['A system must be an object.'], warnings, system: null };
  // One written before action points is converted first (L-831; MG1).
  const converted = apRules.convert(given);
  converted.warnings.forEach((w) => warnings.push(w));
  const s = copyOf(converted.system);

  // ── Who it is ──
  s.id = text(s.id);
  if (typeof s.id !== 'string' || !SYSTEM_ID.test(s.id)) {
    errors.push('id must be lowercase letters, digits and dashes (e.g. "pirate-d20").');
  }
  s.name = text(s.name);
  if (typeof s.name !== 'string' || !s.name || s.name.length > 80) {
    errors.push('name is required (at most 80 characters).');
  }
  s.credits = s.credits === undefined ? [] : s.credits;
  if (!Array.isArray(s.credits)) errors.push('credits must be a list.');
  else {
    s.credits.forEach((c, i) => {
      if (!isObject(c) || typeof c.source !== 'string' || !c.source.trim()) {
        errors.push(`credits[${i}] needs a source (and its licence, SY6).`);
      }
    });
  }
  s.words = s.words === undefined ? {} : s.words;
  if (!isObject(s.words) || Object.values(s.words).some((w) => typeof w !== 'string')) {
    errors.push('words must map each thing to a word ("health": "Hull").');
  }
  s.gmNotes = s.gmNotes === undefined ? '' : s.gmNotes;
  if (typeof s.gmNotes !== 'string' || s.gmNotes.length > MAX_TEXT) {
    errors.push(`gmNotes must be text (at most ${MAX_TEXT} characters).`);
  }

  // ── The sheet (CS1) ──
  const sheet = s.sheet;
  const fieldIds = new Map(); // lower-cased id → where it was declared
  const formulas = []; // every formula, to find what is used
  // Each formula and where it is, checked by the formula language once the
  // whole shape is known (L-802): `kind` says which names it may use.
  const formula = (value, where, kind = 'sheet', owner = null) => {
    if (typeof value === 'number' && Number.isFinite(value)) return undefined;
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_FORMULA) {
      errors.push(`${where} must be a formula (text, at most ${MAX_FORMULA} characters).`);
      return undefined;
    }
    return formulas.push({ value, where, kind, owner });
  };
  // A list of named things, each with an id unique across the sheet when
  // `field`, and names unique within it.
  const list = (items, where, { field = true, required = false, each } = {}) => {
    if (items === undefined && !required) return [];
    if (!Array.isArray(items)) {
      errors.push(`${where} must be a list.`);
      return [];
    }
    if (required && !items.length) errors.push(`${where} needs at least one.`);
    if (items.length > MAX_LIST) errors.push(`${where} has more than ${MAX_LIST}.`);
    const names = new Set();
    items.forEach((item, i) => {
      const at = `${where}[${i}]`;
      if (!isObject(item)) return errors.push(`${at} must be an object.`);
      item.id = text(item.id);
      item.name = text(item.name);
      if (typeof item.id !== 'string' || !FIELD_ID.test(item.id)) {
        errors.push(`${at}.id must start with a letter and use letters, digits and _ only.`);
      } else if (field && (/^d\d+$/i.test(item.id) || RESERVED_NAMES.includes(item.id))) {
        errors.push(`${at}.id "${item.id}" is a word formulas use; choose another.`);
      } else if (field) {
        const key = item.id.toLowerCase();
        if (fieldIds.has(key)) {
          errors.push(`${at}.id "${item.id}" is already used by ${fieldIds.get(key)}.`);
        } else fieldIds.set(key, at);
      }
      if (typeof item.name !== 'string' || !item.name) errors.push(`${at}.name is required.`);
      else if (names.has(item.name.toLowerCase())) {
        errors.push(`${at}.name "${item.name}" is used twice in ${where}.`);
      } else names.add(item.name.toLowerCase());
      if (each) each(item, at);
    });
    return items;
  };

  if (!isObject(sheet)) {
    errors.push('sheet is required: attributes, resources and level (CS1).');
  } else {
    list(sheet.attributes, 'sheet.attributes', {
      required: true,
      each: (a, at) => {
        if (!Number.isInteger(a.min) || !Number.isInteger(a.max) || a.min >= a.max) {
          errors.push(`${at} needs whole-number min and max, min below max.`);
        }
        formula(a.modifier, `${at}.modifier`, 'modifier', a.id);
      },
    });
    list(sheet.resources, 'sheet.resources', {
      required: true,
      each: (r, at) => formula(r.max, `${at}.max`),
    });
    const level = sheet.level;
    if (
      !isObject(level) ||
      !Number.isInteger(level.min) ||
      !Number.isInteger(level.max) ||
      level.min < 0 ||
      level.min > level.max
    ) {
      errors.push('sheet.level needs whole-number min and max, min not above max.');
    }
    sheet.optional = sheet.optional === undefined ? [] : sheet.optional;
    if (!Array.isArray(sheet.optional)) errors.push('sheet.optional must be a list of parts.');
    else {
      sheet.optional.forEach((part) => {
        if (!OPTIONAL_PARTS.includes(part)) {
          errors.push(
            `sheet.optional: "${part}" isn't an optional part (${OPTIONAL_PARTS.join(', ')}).`
          );
        }
      });
      if (new Set(sheet.optional).size !== sheet.optional.length) {
        errors.push('sheet.optional names a part twice.');
      }
    }
    const on = new Set(Array.isArray(sheet.optional) ? sheet.optional : []);
    const attributeIds = new Set(
      (Array.isArray(sheet.attributes) ? sheet.attributes : []).map((a) => a && a.id)
    );
    for (const part of OPTIONAL_PARTS) {
      if (sheet[part] === undefined) continue;
      if (!on.has(part)) {
        warnings.push(`sheet.${part} is given but "${part}" isn't in sheet.optional: ignored.`);
      }
    }
    if (on.has('skills')) {
      list(sheet.skills, 'sheet.skills', {
        each: (k, at) => {
          if (!attributeIds.has(k.attribute)) {
            errors.push(`${at}.attribute "${k.attribute}" isn't one of the system's attributes.`);
          }
        },
      });
    }
    // A trait may add to what the sheet works out (L-811): `modifiers`
    // { ap: formula }, a bonus taken with the trait (at creation, L-812);
    // and change what AP buys (L-831): `costs`.
    if (on.has('traits')) {
      list(sheet.traits, 'sheet.traits', {
        field: false,
        each: (t, at) => {
          checkDamageTypes(t, at, s, errors);
          // A reaction it gives (L-823; combat TN4): defending, a term
          // added to the holder's defence against an attack that would hit.
          if (t.reaction !== undefined) {
            const r = t.reaction;
            if (!isObject(r) || r.defend === undefined) {
              errors.push(`${at}.reaction must be { defend, against? }.`);
            } else {
              formula(r.defend, `${at}.reaction.defend`);
              if (r.against !== undefined && !REACTION_AGAINST.includes(r.against)) {
                errors.push(
                  `${at}.reaction.against must be one of ${REACTION_AGAINST.join(', ')}.`
                );
              }
              const extra = Object.keys(r).filter((k) => !['defend', 'against'].includes(k));
              if (extra.length) errors.push(`${at}.reaction: "${extra[0]}" isn't part of one.`);
            }
          }
          if (t.costs !== undefined) apRules.checkCosts(t.costs, `${at}.costs`, errors);
          if (t.modifiers === undefined) return;
          if (!isObject(t.modifiers)) {
            errors.push(`${at}.modifiers must map what it changes to a formula ({ ap: '5' }).`);
            return;
          }
          for (const [target, value] of Object.entries(t.modifiers)) {
            if (!MODIFIER_TARGETS.includes(target)) {
              errors.push(
                `${at}.modifiers: "${target}" isn't something a trait changes (${MODIFIER_TARGETS.join(', ')}).`
              );
            } else formula(value, `${at}.modifiers.${target}`);
          }
        },
      });
    }
    // Action points a turn (L-831; AP1), worked out from the sheet.
    if (sheet.ap !== undefined) formula(sheet.ap, 'sheet.ap');
    const lock = isObject(s.checks) && isObject(s.checks.lock) ? s.checks.lock : null;
    if (lock) {
      if (lock.skill !== undefined && !(sheet.skills || []).some((k) => k && k.id === lock.skill)) {
        errors.push(`checks.lock.skill "${lock.skill}" isn't one of the system's skills.`);
      }
      if (lock.attribute !== undefined && !attributeIds.has(lock.attribute)) {
        errors.push(
          `checks.lock.attribute "${lock.attribute}" isn't one of the system's attributes.`
        );
      }
    }
    // Conditions (EF3; L-815): what each does while it lasts, as data:
    // `modifiers` { target: formula } (checks, dice, ap, or an attribute,
    // skill or resource), `each` { resource: formula } at the end of each
    // turn, `costs` changing AP prices (L-831), and the flags noAction and
    // noMove. ./conditions.js reads them.
    if (on.has('conditions')) {
      const ids = (part) =>
        new Set((Array.isArray(sheet[part]) ? sheet[part] : []).map((x) => x && x.id));
      const fields = new Set([...ids('attributes'), ...ids('skills'), ...ids('resources')]);
      const resources = ids('resources');
      list(sheet.conditions, 'sheet.conditions', {
        field: false,
        each: (c, at) => {
          checkDamageTypes(c, at, s, errors);
          if (c.costs !== undefined) apRules.checkCosts(c.costs, `${at}.costs`, errors);
          if (c.modifiers !== undefined) {
            if (!isObject(c.modifiers)) {
              errors.push(
                `${at}.modifiers must map what it changes to a formula ({ checks: '-2' }).`
              );
            } else {
              for (const [target, value] of Object.entries(c.modifiers)) {
                if (!CONDITION_TARGETS.includes(target) && !fields.has(target)) {
                  errors.push(
                    `${at}.modifiers: "${target}" isn't something a condition changes ` +
                      `(${CONDITION_TARGETS.join(', ')}, or an attribute, skill or resource).`
                  );
                } else if (rollsDice(value)) {
                  errors.push(
                    `${at}.modifiers.${target} can't roll dice: it holds while it lasts.`
                  );
                } else formula(value, `${at}.modifiers.${target}`);
              }
              const pool = isObject(s.checks) && /\bcount\s*\(/.test(String(s.checks.formula));
              if (c.modifiers.dice !== undefined && !pool) {
                warnings.push(
                  `${at}.modifiers.dice changes a pool's dice, and the check rolls no pool: ignored.`
                );
              }
            }
          }
          if (c.each !== undefined) {
            if (!isObject(c.each) || !Object.keys(c.each).length) {
              errors.push(`${at}.each must map a resource to a formula ({ health: '-1d4' }).`);
            } else {
              for (const [target, value] of Object.entries(c.each)) {
                if (!resources.has(target)) {
                  errors.push(`${at}.each: "${target}" isn't one of the system's resources.`);
                } else formula(value, `${at}.each.${target}`);
              }
            }
          }
          for (const flag of ['noAction', 'noMove']) {
            if (c[flag] !== undefined && typeof c[flag] !== 'boolean') {
              errors.push(`${at}.${flag} must be true or false.`);
            }
          }
        },
      });
    }
    if (on.has('derived')) {
      list(sheet.derived, 'sheet.derived', {
        each: (d, at) => formula(d.formula, `${at}.formula`),
      });
    }
    for (const part of on) {
      if (OPTIONAL_PARTS.includes(part) && part !== 'traits' && part !== 'conditions') {
        if (!Array.isArray(sheet[part]) || !sheet[part].length) {
          warnings.push(`"${part}" is switched on but the system lists none.`);
        }
      }
    }
  }

  // ── Checks (DC1–DC4) ──
  const checks = s.checks;
  if (!isObject(checks)) {
    errors.push('checks is required: the check formula and the difficulty ladder.');
  } else {
    formula(checks.formula, 'checks.formula', 'check');
    checks.degrees = checks.degrees === undefined ? {} : checks.degrees;
    if (!isObject(checks.degrees)) errors.push('checks.degrees must map degrees to formulas.');
    else {
      for (const [degree, value] of Object.entries(checks.degrees)) {
        if (!DEGREES.includes(degree)) {
          errors.push(`checks.degrees: "${degree}" isn't a degree (${DEGREES.join(', ')}).`);
        } else formula(value, `checks.degrees.${degree}`, 'degree');
      }
    }
    // Ties in opposed checks (DC8; L-803): the defender's, unless the attacker's.
    if (checks.ties !== undefined && !['defender', 'attacker'].includes(checks.ties)) {
      errors.push('checks.ties must be "defender" or "attacker".');
    }
    // What picking a lock rolls (L-803): a skill or an attribute; checked below.
    if (checks.lock !== undefined && !isObject(checks.lock)) {
      errors.push('checks.lock must be { skill } or { attribute }.');
    }
    const ladder = checks.ladder;
    if (!Array.isArray(ladder) || ladder.length < 2) {
      errors.push('checks.ladder needs at least two rungs, easiest first (DC4).');
    } else {
      const names = new Set();
      ladder.forEach((rung, i) => {
        const at = `checks.ladder[${i}]`;
        if (!isObject(rung)) return errors.push(`${at} must be an object.`);
        rung.name = text(rung.name);
        if (typeof rung.name !== 'string' || !rung.name) errors.push(`${at}.name is required.`);
        else if (names.has(rung.name.toLowerCase())) {
          errors.push(`${at}.name "${rung.name}" is on the ladder twice.`);
        } else names.add(rung.name.toLowerCase());
        if (typeof rung.value !== 'number' || !Number.isFinite(rung.value)) {
          errors.push(`${at}.value must be a number.`);
        }
      });
      const values = ladder.map((r) => r && r.value).filter((v) => typeof v === 'number');
      if (values.length === ladder.length) {
        const steps = values.slice(1).map((v, i) => Math.sign(v - values[i]));
        if (!(steps.every((d) => d > 0) || steps.every((d) => d < 0))) {
          errors.push(
            'checks.ladder must be in order, easiest first: each rung strictly above the last ' +
              '(or strictly below, for a system that rolls under).'
          );
        }
      }
    }
  }

  // Lookup tables (FX2; L-802): { name: [{ min?, max?, value }] }, rows
  // tried in order; a value is a number or a formula ("1d6").
  s.tables = s.tables === undefined ? {} : s.tables;
  if (!isObject(s.tables)) errors.push('tables must map each table name to its rows.');
  else {
    for (const [name, rows] of Object.entries(s.tables)) {
      const at = `tables.${name}`;
      if (!FIELD_ID.test(name)) errors.push(`${at}: a table name starts with a letter.`);
      if (!Array.isArray(rows) || !rows.length || rows.length > MAX_LIST) {
        errors.push(`${at} needs 1 to ${MAX_LIST} rows.`);
        continue;
      }
      rows.forEach((row, i) => {
        const where = `${at}[${i}]`;
        if (!isObject(row)) return errors.push(`${where} must be { min?, max?, value }.`);
        for (const end of ['min', 'max']) {
          if (
            row[end] !== undefined &&
            (typeof row[end] !== 'number' || !Number.isFinite(row[end]))
          ) {
            errors.push(`${where}.${end} must be a number.`);
          }
        }
        if (typeof row.min === 'number' && typeof row.max === 'number' && row.min > row.max) {
          errors.push(`${where}: min is above max.`);
        }
        formula(row.value, `${where}.value`);
      });
    }
  }
  // ── Making, growing, modules (CS5, CS6, MD1) ──
  if (s.creation === undefined) {
    warnings.push('No creation method: the Loom can’t walk a player through making a character.');
    s.creation = {};
  } else if (!isObject(s.creation) || !CREATION_METHODS.includes(s.creation.method)) {
    errors.push(`creation.method must be one of ${CREATION_METHODS.join(', ')}.`);
  }
  s.advancement = s.advancement === undefined ? {} : s.advancement;
  if (!isObject(s.advancement)) errors.push('advancement must be an object (empty for now).');
  // What AP pays for (L-831; ./ap.js).
  apRules.check(s, { errors, warnings });
  s.modules = s.modules === undefined ? {} : s.modules;
  if (!isObject(s.modules)) errors.push('modules must map each module to its settings.');
  else {
    for (const [name, settings] of Object.entries(s.modules)) {
      const module = MODULES[name];
      if (module) module.check(settings, { system: s, errors, warnings, formula });
      else {
        warnings.push(`modules.${name}: no module by that name is built yet; it is kept, unused.`);
      }
    }
  }

  // ── The formulas (L-802), once the shape is known ──
  const reads = []; // every name each formula reads, for what isn't used
  let checkType = null;
  if (!errors.length) {
    for (const f of formulas) {
      const result = formulaLanguage.check(f.value, { system: s, names: PLACE_NAMES[f.kind] });
      result.errors.forEach((e) => errors.push(`${f.where}: ${e}`));
      if (result.errors.length) continue;
      if (f.kind === 'modifier' && /\bmod\s*\(/.test(f.value)) {
        errors.push(`${f.where}: a modifier can't use mod().`);
      }
      if (f.kind === 'degree' && result.type !== 'bool') {
        errors.push(`${f.where} must be a comparison (result >= difficulty, say).`);
      } else if (f.kind !== 'degree' && f.kind !== 'check' && result.type === 'bool') {
        errors.push(`${f.where} must come to a number, not a comparison.`);
      }
      if (f.kind === 'check') checkType = result.type;
      reads.push({ f, names: result.names });
    }
  }

  // ── What isn't used, and what can't happen (FX3) ──
  if (!errors.length) {
    const bySkill = new Set((sheet.skills || []).map((k) => k.attribute));
    for (const a of sheet.attributes) {
      const named = reads.some(
        ({ f, names }) => !(f.kind === 'modifier' && f.owner === a.id) && names.includes(a.id)
      );
      if (!bySkill.has(a.id) && !named) {
        warnings.push(`Attribute ${a.id} isn't used by any skill or formula.`);
      }
    }
    unreachableRungs(s, checkType).forEach((w) => warnings.push(w));
    // Its creation settings against its sheet (L-812).
    require('./creation')
      .validateCreation(s)
      .forEach((e) => errors.push(e));
  }

  return { errors, warnings, system: errors.length ? null : s };
}

// Ladder rungs no check can reach (FX3), as far as the ranges show: for a
// check that adds up, a rung above the most it can come to (or, on a ladder
// for rolling under, below the least). A name with no range (a skill's rank)
// leaves it unknown, and nothing is said.
function unreachableRungs(system, checkType) {
  if (checkType === 'bool') return [];
  const attributes = system.sheet.attributes;
  const ranges = { level: [system.sheet.level.min, system.sheet.level.max] };
  attributes.forEach((a) => {
    ranges[a.id] = [a.min, a.max];
  });
  ranges.attribute = [
    Math.min(...attributes.map((a) => a.min)),
    Math.max(...attributes.map((a) => a.max)),
  ];
  const mods = attributes.map((a) => formulaLanguage.range(a.modifier, { ranges, system }));
  ranges.modifier = [Math.min(...mods.map((r) => r[0])), Math.max(...mods.map((r) => r[1]))];
  const [lo, hi] = formulaLanguage.range(system.checks.formula, { ranges, system });
  const ladder = system.checks.ladder;
  const rising = ladder[ladder.length - 1].value > ladder[0].value;
  return ladder
    .filter((r) =>
      rising ? Number.isFinite(hi) && r.value > hi : Number.isFinite(lo) && r.value < lo
    )
    .map(
      (r) =>
        `checks.ladder: "${r.name}" (${r.value}) can never be reached; the check comes to ` +
        `${rising ? 'at most ' + hi : 'at least ' + lo}.`
    );
}

// ── In Firestore ──────────────────────────────────────────────────────

// A record's bookkeeping, kept off the system itself.
const META = ['createdAtMs', 'createdBy', 'updatedAtMs', 'updatedBy', 'copiedFrom'];
const stored = (data) =>
  Object.fromEntries(Object.entries(data).filter(([key]) => !META.includes(key)));

/** A system as it is now, or null: one in `loom_systems`, or a built-in. */
async function getSystem(db, systemId) {
  if (typeof systemId !== 'string' || !systemId) return null;
  const snap = await db.collection(SYSTEMS_COLLECTION).doc(systemId).get();
  // One stored before action points reads as on them (L-831).
  if (snap.exists) return { ...apRules.convert({ ...snap.data(), id: snap.id }).system };
  const builtIn = BUILT_IN[systemId];
  return builtIn ? { ...copyOf(builtIn), version: 0, builtIn: true } : null;
}

/**
 * The system a world plays by (SY2, SY4): the one it names, as it is now, or
 * the built-in fantasy system when it names none. Null when it names one that
 * doesn't exist. Frozen.
 */
async function loadSystem(db, systemId) {
  const system = await getSystem(db, systemId || DEFAULT_SYSTEM_ID);
  return system ? deepFreeze(system) : null;
}

/** Every system: those in `loom_systems`, and the built-ins not written there yet. */
async function listSystems(db) {
  const snap = await db.collection(SYSTEMS_COLLECTION).get();
  const rows = snap.docs.map((doc) => apRules.convert({ ...doc.data(), id: doc.id }).system);
  const have = new Set(rows.map((r) => r.id));
  for (const id of Object.keys(BUILT_IN)) {
    if (!have.has(id)) rows.push({ ...copyOf(BUILT_IN[id]), version: 0, builtIn: true });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Creates or replaces a system (set_system): checked first, and refused with
 * every error; its version is raised. Built-in ids are refused: copy one.
 * Returns `{ system, warnings, created }`.
 */
async function setSystem(db, input, { uid, now = Date.now() } = {}) {
  const { errors, warnings, system } = validateSystem(input);
  if (errors.length) throw new SystemError(errors);
  if (RESERVED_IDS.includes(system.id)) {
    throw new SystemError([
      `"${system.id}" is a built-in system and can't be changed. Copy it with copy_system and change the copy.`,
    ]);
  }
  const ref = db.collection(SYSTEMS_COLLECTION).doc(system.id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.exists ? snap.data() : null;
    const record = {
      ...stored(system),
      version: ((before && before.version) || 0) + 1,
      createdAtMs: (before && before.createdAtMs) || now,
      createdBy: (before && before.createdBy) || uid || null,
      ...(before && before.copiedFrom ? { copiedFrom: before.copiedFrom } : {}),
      updatedAtMs: now,
      updatedBy: uid || null,
    };
    delete record.builtIn;
    tx.set(ref, record);
    return { system: record, warnings, created: !before };
  });
}

/**
 * A new, named system made from another (SY5): independent of it from then
 * on. Refused if the new id is taken or built in.
 */
async function copySystem(db, fromId, { id, name }, { uid, now = Date.now() } = {}) {
  const source = await getSystem(db, fromId);
  if (!source) throw new SystemError([`No system "${fromId}". list_systems shows them.`]);
  const copy = { ...stored(copyOf(source)), id, name };
  delete copy.version;
  delete copy.builtIn;
  const { errors, warnings, system } = validateSystem(copy);
  if (errors.length) throw new SystemError(errors);
  if (RESERVED_IDS.includes(system.id)) {
    throw new SystemError([`"${system.id}" is a built-in system's id; choose another.`]);
  }
  const ref = db.collection(SYSTEMS_COLLECTION).doc(system.id);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) {
      throw new SystemError([`There is already a system "${system.id}"; choose another id.`]);
    }
    const record = {
      ...system,
      version: 1,
      copiedFrom: { id: source.id, version: source.version || 0 },
      createdAtMs: now,
      createdBy: uid || null,
      updatedAtMs: now,
      updatedBy: uid || null,
    };
    tx.set(ref, record);
    return { system: record, warnings };
  });
}

/**
 * What of a character's sheet no longer fits its system (SY2; L-811): each
 * problem named, or none. See ./sheets.js.
 */
function misfits(system, sheet) {
  return require('./sheets').validateSheet(system, sheet);
}

/** The store over Firestore, for the MCP tools: `getDb` is called lazily. */
function createSystemStore(getDb) {
  return {
    list: () => listSystems(getDb()),
    get: (id) => getSystem(getDb(), id),
    set: (input, options) => setSystem(getDb(), input, options),
    copy: (fromId, to, options) => copySystem(getDb(), fromId, to, options),
  };
}

module.exports = {
  createSystemStore,
  SYSTEMS_COLLECTION,
  DEFAULT_SYSTEM_ID,
  OPTIONAL_PARTS,
  DEGREES,
  CREATION_METHODS,
  RESERVED_IDS,
  BUILT_IN,
  SystemError,
  validateSystem,
  getSystem,
  loadSystem,
  listSystems,
  setSystem,
  copySystem,
  misfits,
};
