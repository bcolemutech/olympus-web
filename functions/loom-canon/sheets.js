'use strict';

/**
 * Character sheets (planning/game-systems.md §3 CS1–CS4, CS9, SY2, §4.2;
 * L-811 / #638): a player character's sheet, shaped by its world's game
 * system, at `save.character.sheet`.
 *
 *   Sheet
 *     attributes: { [id]: score }            every attribute, in its range
 *     skills:     { [id]: rank }             with 'skills': every skill, 0 untrained
 *     resources:  { [id]: { current } }      every resource; its maximum is
 *                                            worked out from its formula
 *     level:      number                     in the system's range
 *     traits:     [id]                       what the character can do (swim,
 *                                            climb): today's abilities (CS4),
 *                                            opening routes and places
 *     conditions: [{ id, ... }]              effects on them (L-815)
 *     speed:      number                     movement a turn (L-611), worked
 *                                            out: see speedFor
 *
 * A sheet that no longer fits its system (an attribute removed, a skill
 * renamed, a score out of range) is not refused: `misfits` says what, for
 * NARRATE and the Character panel, and the GM repairs it in play (SY2).
 *
 * Speed is worked out, never chosen: the system's `sheet.speed` formula
 * (its attributes, skill ranks and level) plus what the character's traits
 * add (a system trait's `modifiers.speed`, taken at creation, L-812). It is
 * worked out again whenever a save is loaded with its world (withSpeed), so
 * a changed sheet or system moves the character at once.
 *
 * Saves made before sheets keep `character.abilities`, `speed` and
 * `condition` until the backfill moves them in (CS9): the readers here take
 * either. Pure: no I/O.
 */

const formula = require('./formula');

const DEFAULT_SPEED = 20; // as loom-models' (L-611)
const MAX_SPEED = 1000;
const MAX_RANK = 20;
const MAX_LEVEL = 1000;
const TRAIT_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const MAX_TRAITS = 60;
const MAX_CONDITIONS = 30;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const skillsOn = (system) => ((system.sheet || {}).optional || []).includes('skills');
const middle = (a) => Math.floor((a.min + a.max) / 2);

// The values a sheet's formulas read: its scores, ranks and level.
function valuesOf(system, sheet) {
  const values = {};
  for (const a of system.sheet.attributes || []) {
    const score = sheet.attributes && sheet.attributes[a.id];
    values[a.id] = Number.isFinite(score) ? score : middle(a);
  }
  if (skillsOn(system)) {
    for (const k of system.sheet.skills || []) {
      const rank = sheet.skills && sheet.skills[k.id];
      values[k.id] = Number.isFinite(rank) ? rank : 0;
    }
  }
  values.level = Number.isFinite(sheet.level) ? sheet.level : system.sheet.level.min;
  for (const r of system.sheet.resources || []) values[r.id] = 0;
  return values;
}

/**
 * Each resource's maximum for this sheet, from the system's formulas:
 * `{ [id]: max }`. A formula that can't be worked out (it reads something
 * the sheet no longer has) gives null.
 */
function maxima(system, sheet) {
  const values = valuesOf(system, sheet);
  const out = {};
  for (const r of system.sheet.resources || []) {
    try {
      out[r.id] = Math.max(
        0,
        Math.floor(formula.evaluate(r.max, { values, system, dice: () => 1 }).total)
      );
    } catch {
      out[r.id] = null;
    }
  }
  return out;
}

/**
 * A character's speed (L-611; L-811): the system's speed formula over the
 * sheet, plus each of its traits' `modifiers.speed`, from 1 to MAX_SPEED.
 * A system with no speed formula moves everyone at the default.
 */
function speedFor(system, sheet) {
  const values = valuesOf(system, sheet || {});
  const at = (text) => {
    try {
      return formula.evaluate(text, { values, system, dice: () => 1 }).total;
    } catch {
      return 0;
    }
  };
  let speed = system.sheet.speed === undefined ? DEFAULT_SPEED : at(system.sheet.speed);
  const has = new Set((sheet && Array.isArray(sheet.traits) && sheet.traits) || []);
  for (const trait of system.sheet.traits || []) {
    const bonus = trait.modifiers && trait.modifiers.speed;
    if (has.has(trait.id) && bonus !== undefined) speed += at(bonus);
  }
  return Math.max(1, Math.min(MAX_SPEED, Math.floor(speed)));
}

/**
 * A save with its character's speed worked out for its world's system: what
 * every reader of the save sees (speedOf). A save without a sheet is as it was.
 */
function withSpeed(save, system) {
  const sheet = sheetOf(save);
  if (!sheet || !save.character) return save;
  return {
    ...save,
    character: { ...save.character, sheet: { ...sheet, speed: speedFor(system, sheet) } },
  };
}

/**
 * A new sheet with the system's defaults (CS9): each attribute at the middle
 * of its range, every skill untrained, the lowest level, every resource
 * full, its speed worked out. `traits` carry over what the character could do.
 */
function defaultSheet(system, { traits = [] } = {}) {
  const sheet = { attributes: {}, resources: {}, level: system.sheet.level.min };
  for (const a of system.sheet.attributes) sheet.attributes[a.id] = middle(a);
  if (skillsOn(system)) {
    sheet.skills = {};
    for (const k of system.sheet.skills || []) sheet.skills[k.id] = 0;
  }
  const max = maxima(system, sheet);
  for (const r of system.sheet.resources) sheet.resources[r.id] = { current: max[r.id] || 0 };
  sheet.traits = [...new Set(traits.filter((t) => typeof t === 'string' && TRAIT_ID.test(t)))];
  sheet.conditions = [];
  sheet.speed = speedFor(system, sheet);
  return sheet;
}

/**
 * What's wrong with a sheet for this system, each named; empty when it
 * fits. A sheet that once fitted and no longer does (SY2) shows here too:
 * these are its misfits.
 */
function validateSheet(system, sheet) {
  if (!isObject(sheet)) return ['The sheet must be an object.'];
  const errors = [];
  const whole = (v) => Number.isInteger(v);

  // Attributes: every one the system has, in its range, and no others.
  const attributes = isObject(sheet.attributes) ? sheet.attributes : {};
  if (!isObject(sheet.attributes)) errors.push('attributes must map each attribute to its score.');
  for (const a of system.sheet.attributes) {
    const score = attributes[a.id];
    if (score === undefined) errors.push(`${a.name} (${a.id}) has no score.`);
    else if (!whole(score) || score < a.min || score > a.max) {
      errors.push(`${a.name} is ${score}; it must be a whole number from ${a.min} to ${a.max}.`);
    }
  }
  for (const id of Object.keys(attributes)) {
    if (!system.sheet.attributes.some((a) => a.id === id)) {
      errors.push(`There is no attribute "${id}" in this world's rules.`);
    }
  }

  // Skills: with 'skills' on, every one has a rank; otherwise none.
  if (skillsOn(system)) {
    const skills = isObject(sheet.skills) ? sheet.skills : {};
    if (!isObject(sheet.skills)) errors.push('skills must map each skill to its rank.');
    for (const k of system.sheet.skills || []) {
      const rank = skills[k.id];
      if (rank === undefined) errors.push(`${k.name} (${k.id}) has no rank.`);
      else if (!whole(rank) || rank < 0 || rank > MAX_RANK) {
        errors.push(`${k.name} is ${rank}; a rank is a whole number from 0 to ${MAX_RANK}.`);
      }
    }
    for (const id of Object.keys(skills)) {
      if (!(system.sheet.skills || []).some((k) => k.id === id)) {
        errors.push(`There is no skill "${id}" in this world's rules.`);
      }
    }
  } else if (sheet.skills !== undefined && Object.keys(sheet.skills || {}).length) {
    errors.push("This world's rules have no skills.");
  }

  // Level.
  const level = system.sheet.level;
  if (
    !whole(sheet.level) ||
    sheet.level < level.min ||
    sheet.level > Math.min(level.max, MAX_LEVEL)
  ) {
    errors.push(`The level is ${sheet.level}; it must be from ${level.min} to ${level.max}.`);
  }

  // Resources: every one, from 0 to its maximum.
  const resources = isObject(sheet.resources) ? sheet.resources : {};
  if (!isObject(sheet.resources)) errors.push('resources must map each resource to its current.');
  const max = maxima(system, sheet);
  for (const r of system.sheet.resources) {
    const held = resources[r.id];
    const current = isObject(held) ? held.current : undefined;
    if (current === undefined) errors.push(`${r.name} (${r.id}) has no current value.`);
    else if (!whole(current) || current < 0 || (max[r.id] !== null && current > max[r.id])) {
      errors.push(
        `${r.name} is ${current}; it must be a whole number from 0 to ${
          max[r.id] === null ? 'its maximum' : max[r.id]
        }.`
      );
    }
  }
  for (const id of Object.keys(resources)) {
    if (!system.sheet.resources.some((r) => r.id === id)) {
      errors.push(`There is no resource "${id}" in this world's rules.`);
    }
  }

  // Traits and conditions (speed is worked out, not checked: speedFor).
  if (!Array.isArray(sheet.traits)) errors.push('traits must be a list.');
  else {
    if (sheet.traits.length > MAX_TRAITS) errors.push(`More than ${MAX_TRAITS} traits.`);
    sheet.traits.forEach((t) => {
      if (typeof t !== 'string' || !TRAIT_ID.test(t)) {
        errors.push(`The trait "${t}" isn't an id (letters, digits, - and _).`);
      }
    });
  }
  if (!Array.isArray(sheet.conditions)) errors.push('conditions must be a list.');
  else {
    if (sheet.conditions.length > MAX_CONDITIONS) errors.push('Too many conditions.');
    sheet.conditions.forEach((c, i) => {
      if (!isObject(c) || typeof c.id !== 'string' || !c.id) {
        errors.push(`conditions[${i}] needs an id.`);
      }
    });
  }
  return errors;
}

// ── Stat blocks (CS7; L-813) ──────────────────────────────────────────
//
// The short form a template's figures carry (L-790), and a quick way to give
// a named character a sheet: every attribute, and only what differs from the
// defaults besides: `{ attributes, skills?, resources?, level?, traits? }`.
// A skill left out is untrained, a resource left out full, the level the
// lowest.

/** What's wrong with a stat block for this system, each named. */
function validateStatBlock(system, block) {
  if (!isObject(block)) return ['The stat block must be an object.'];
  return validateSheet(system, sheetFromStatBlock(system, block));
}

/** The full sheet a stat block stands for: its own values, the defaults for the rest. */
function sheetFromStatBlock(system, block) {
  const sheet = defaultSheet(system, { traits: Array.isArray(block.traits) ? block.traits : [] });
  if (block.traits !== undefined && !Array.isArray(block.traits)) sheet.traits = block.traits;
  sheet.attributes = isObject(block.attributes) ? { ...block.attributes } : block.attributes;
  if (isObject(block.skills)) sheet.skills = { ...(sheet.skills || {}), ...block.skills };
  else if (block.skills !== undefined) sheet.skills = block.skills;
  if (block.level !== undefined) sheet.level = block.level;
  // Every resource full for these scores, unless the block says otherwise.
  if (isObject(sheet.attributes)) {
    const full = maxima(system, sheet);
    for (const r of system.sheet.resources) sheet.resources[r.id] = { current: full[r.id] || 0 };
  }
  if (isObject(block.resources)) Object.assign(sheet.resources, block.resources);
  sheet.speed = speedFor(system, sheet);
  return sheet;
}

/** A save's character's sheet, or null for one made before sheets. */
function sheetOf(state) {
  const character = state && (state.character || state);
  return character && isObject(character.sheet) ? character.sheet : null;
}

/**
 * What a character can do (CS4): its sheet's traits, or an older
 * character's abilities (a bare character state carries them itself).
 */
function traitsOf(state) {
  const sheet = sheetOf(state);
  if (sheet && Array.isArray(sheet.traits)) return sheet.traits;
  return (state && ((state.character && state.character.abilities) || state.abilities)) || [];
}

/**
 * The backfill for a save made before sheets (CS9): `null` when it has one,
 * else the fields to write: its world's system's defaults, its abilities as
 * traits, its speed worked out, and the old fields removed (`DELETE` marks them).
 */
function sheetBackfill(save, system, DELETE = null) {
  const character = (save && save.character) || {};
  if (isObject(character.sheet)) return null;
  const sheet = defaultSheet(system, {
    traits: Array.isArray(character.abilities) ? character.abilities : [],
  });
  return {
    'character.sheet': sheet,
    'character.abilities': DELETE,
    'character.speed': DELETE,
    'character.condition': DELETE,
  };
}

module.exports = {
  DEFAULT_SPEED,
  MAX_SPEED,
  defaultSheet,
  speedFor,
  withSpeed,
  validateSheet,
  validateStatBlock,
  sheetFromStatBlock,
  maxima,
  sheetOf,
  traitsOf,
  sheetBackfill,
};
