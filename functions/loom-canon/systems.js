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
 *       optional:   which optional parts are on: skills, traits, conditions, derived
 *       skills:     [{ id, name, attribute }]            (with 'skills')
 *       traits:     [{ id, name, description? }]         (with 'traits')
 *       conditions: [{ id, name, description? }]         (with 'conditions')
 *       derived:    [{ id, name, formula }]              (with 'derived')
 *     checks:  { formula, degrees: { [degree]: formula }, ladder: [{ name, value }] }
 *     creation: { method: 'array' | 'pointBuy' | 'rolling', ...its settings }
 *     advancement: {}                    empty for now (L-830)
 *     modules: { [module]: settings }    none are built yet (L-820 on)
 *     gmNotes: tone and pacing for NARRATE
 *
 * Formulas are stored as text. The formula language (L-802) parses and checks
 * them once it lands; until then a formula only has to be text.
 *
 * Sheet field ids (attributes, resources, skills, derived values) are the
 * names formulas use, so they are unique across the sheet.
 *
 * A world without a system reads as the built-in fantasy system (SY4). Until
 * L-804 writes the built-in systems, `d20-fantasy` is a placeholder here with
 * the same id; built-in ids can't be set over MCP, only copied (SY5).
 *
 * Every save uses a system's latest version (SY2): loading a world loads its
 * system as it is now. `misfits` is where L-811 says what of a sheet no
 * longer fits it.
 */

const SYSTEMS_COLLECTION = 'loom_systems';
const DEFAULT_SYSTEM_ID = 'd20-fantasy';
const OPTIONAL_PARTS = ['skills', 'traits', 'conditions', 'derived'];
const DEGREES = ['criticalFailure', 'failure', 'successAtCost', 'success', 'criticalSuccess'];
const CREATION_METHODS = ['array', 'pointBuy', 'rolling'];

const SYSTEM_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FIELD_ID = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const MAX_LIST = 60;
const MAX_FORMULA = 500;
const MAX_TEXT = 4000;

// The built-in fantasy system's placeholder (SY4), until L-804 writes it out.
const PLACEHOLDER_FANTASY = {
  id: DEFAULT_SYSTEM_ID,
  name: 'd20 Fantasy',
  credits: [{ source: 'The Loom', licence: 'Our own' }],
  words: { health: 'Hit points', level: 'Level' },
  sheet: {
    attributes: [
      ['STR', 'Strength'],
      ['DEX', 'Dexterity'],
      ['CON', 'Constitution'],
      ['INT', 'Intelligence'],
      ['WIS', 'Wisdom'],
      ['CHA', 'Charisma'],
    ].map(([id, name]) => ({ id, name, min: 1, max: 20, modifier: `floor((${id} - 10) / 2)` })),
    resources: [{ id: 'health', name: 'Hit points', max: '8 + CON' }],
    level: { min: 1, max: 20 },
    optional: ['skills', 'traits'],
    skills: [
      ['Athletics', 'STR'],
      ['Acrobatics', 'DEX'],
      ['Stealth', 'DEX'],
      ['Endurance', 'CON'],
      ['Lore', 'INT'],
      ['Perception', 'WIS'],
      ['Persuasion', 'CHA'],
    ].map(([id, attribute]) => ({ id, name: id, attribute })),
    traits: [],
  },
  checks: {
    formula: '1d20 + modifier + rank',
    degrees: {},
    ladder: [
      { name: 'Easy', value: 10 },
      { name: 'Moderate', value: 15 },
      { name: 'Hard', value: 20 },
      { name: 'Very hard', value: 25 },
      { name: 'Nearly impossible', value: 30 },
    ],
  },
  creation: { method: 'array', values: [15, 14, 13, 12, 10, 8] },
  advancement: {},
  modules: {},
  gmNotes: '',
};

// Built-in systems by id: set by code (L-804), copied over MCP, never set there.
const BUILT_IN = Object.freeze({ [DEFAULT_SYSTEM_ID]: PLACEHOLDER_FANTASY });
const RESERVED_IDS = Object.freeze([DEFAULT_SYSTEM_ID, 'pool-scifi']);

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
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v.trim() : v);

/**
 * Checks a system and returns `{ errors, warnings, system }`: the system with
 * its text trimmed and its defaults filled in. Errors refuse a save;
 * warnings are returned with it (FX3).
 */
function validateSystem(input) {
  const errors = [];
  const warnings = [];
  if (!isObject(input)) return { errors: ['A system must be an object.'], warnings, system: null };
  const s = copyOf(input);

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
  const formula = (value, where) => {
    if (typeof value === 'number' && Number.isFinite(value)) return formulas.push(String(value));
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_FORMULA) {
      errors.push(`${where} must be a formula (text, at most ${MAX_FORMULA} characters).`);
      return undefined;
    }
    return formulas.push(value);
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
        formula(a.modifier, `${at}.modifier`);
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
    if (on.has('traits')) list(sheet.traits, 'sheet.traits', { field: false });
    if (on.has('conditions')) list(sheet.conditions, 'sheet.conditions', { field: false });
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
    formula(checks.formula, 'checks.formula');
    checks.degrees = checks.degrees === undefined ? {} : checks.degrees;
    if (!isObject(checks.degrees)) errors.push('checks.degrees must map degrees to formulas.');
    else {
      for (const [degree, value] of Object.entries(checks.degrees)) {
        if (!DEGREES.includes(degree)) {
          errors.push(`checks.degrees: "${degree}" isn't a degree (${DEGREES.join(', ')}).`);
        } else formula(value, `checks.degrees.${degree}`);
      }
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

  // ── Making, growing, modules (CS5, CS6, MD1) ──
  if (s.creation === undefined) {
    warnings.push('No creation method: the Loom can’t walk a player through making a character.');
    s.creation = {};
  } else if (!isObject(s.creation) || !CREATION_METHODS.includes(s.creation.method)) {
    errors.push(`creation.method must be one of ${CREATION_METHODS.join(', ')}.`);
  }
  s.advancement = s.advancement === undefined ? {} : s.advancement;
  if (!isObject(s.advancement)) errors.push('advancement must be an object (empty for now).');
  s.modules = s.modules === undefined ? {} : s.modules;
  if (!isObject(s.modules)) errors.push('modules must map each module to its settings.');
  else {
    for (const name of Object.keys(s.modules)) {
      warnings.push(`modules.${name}: no module by that name is built yet; it is kept, unused.`);
    }
  }

  // ── What isn't used (FX3) ──
  if (!errors.length && isObject(sheet)) {
    const bySkill = new Set((sheet.skills || []).map((k) => k.attribute));
    for (const a of sheet.attributes) {
      const others = formulas.filter((f) => f !== a.modifier);
      const word = new RegExp(`(^|[^A-Za-z0-9_])${a.id}([^A-Za-z0-9_]|$)`);
      if (!bySkill.has(a.id) && !others.some((f) => word.test(f))) {
        warnings.push(`Attribute ${a.id} isn't used by any skill or formula.`);
      }
    }
  }

  return { errors, warnings, system: errors.length ? null : s };
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
  if (snap.exists) return { ...snap.data(), id: snap.id };
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
  const rows = snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
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
 * What of a character's sheet no longer fits its system (SY2): L-811 fills
 * this in when saves have sheets. Today there are none, so nothing.
 */
// eslint-disable-next-line no-unused-vars
function misfits(system, sheet) {
  return [];
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
