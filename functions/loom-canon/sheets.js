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
 *     attacks?:   [attack]                   what they strike with (L-822;
 *                                            ../loom-modules/combat/attacks.js);
 *                                            a player's without any has the
 *                                            system's starting attacks
 *     speed:      number                     action points a turn (L-831), worked
 *                                            out: see apFor; a turn's movement
 *                                            until turns run on AP (L-832)
 *
 * A sheet that no longer fits its system (an attribute removed, a skill
 * renamed, a score out of range) is not refused: `misfits` says what, for
 * NARRATE and the Character panel, and the GM repairs it in play (SY2).
 *
 * Action points are worked out, never chosen: the system's `sheet.ap`
 * formula (its attributes, skill ranks and level) plus what the character's
 * traits and conditions add (`modifiers.ap`; a trait taken at creation,
 * L-812). They are worked out again whenever a save is loaded with its world
 * (withAp), so a changed sheet or system changes them at once.
 *
 * A character without a sheet (one made before sheets, as tests still make
 * them) keeps `character.abilities`, `speed` and `condition`: the readers
 * here take either. Pure: no I/O.
 */

const formula = require('./formula');
const clock = require('./clock');
const conditions = require('./conditions');
const attacks = require('../loom-modules/combat/attacks');

const DEFAULT_AP = 20; // as loom-models' (L-611; L-831)
const MAX_AP = 1000;
const MAX_RANK = 20;
const MAX_LEVEL = 1000;
const TRAIT_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const MAX_TRAITS = 60;
const MAX_CONDITIONS = 30;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const skillsOn = (system) => ((system.sheet || {}).optional || []).includes('skills');
const middle = (a) => Math.floor((a.min + a.max) / 2);

// The values a sheet's formulas read: its scores, ranks and level, with
// what its conditions add to them (L-815) unless `bare`.
function valuesOf(system, sheet, { bare = false } = {}) {
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
  if (bare) return values;
  const mods = conditions.modifiersOf(system, sheet, values);
  for (const a of system.sheet.attributes || []) {
    values[a.id] = Math.max(a.min, Math.min(a.max, values[a.id] + conditions.sumOf(mods, a.id)));
  }
  if (skillsOn(system)) {
    for (const k of system.sheet.skills || []) {
      values[k.id] = Math.max(0, values[k.id] + conditions.sumOf(mods, k.id));
    }
  }
  return values;
}

/**
 * Each resource's maximum for this sheet, from the system's formulas:
 * `{ [id]: max }`, with what its conditions add (L-815) unless `bare`. A
 * formula that can't be worked out (it reads something the sheet no longer
 * has) gives null.
 */
function maxima(system, sheet, { bare = false } = {}) {
  const values = valuesOf(system, sheet, { bare });
  const mods = bare
    ? {}
    : conditions.modifiersOf(system, sheet, valuesOf(system, sheet, { bare: true }));
  const out = {};
  for (const r of system.sheet.resources || []) {
    try {
      out[r.id] = Math.max(
        0,
        Math.floor(formula.evaluate(r.max, { values, system, dice: () => 1 }).total) +
          conditions.sumOf(mods, r.id)
      );
    } catch {
      out[r.id] = null;
    }
  }
  return out;
}

/**
 * A character's action points a turn (L-831; planning/action-points.md
 * AP1): the system's `sheet.ap` formula over the sheet, plus each held
 * trait's and each condition's `modifiers.ap`, from 1 to MAX_AP. A system
 * with no formula gives everyone the default. (A system from before AP is
 * read with `sheet.speed` as its pool: ./ap.js convert.)
 */
function apFor(system, sheet) {
  const values = valuesOf(system, sheet || {});
  const at = (text) => {
    try {
      return formula.evaluate(text, { values, system, dice: () => 1 }).total;
    } catch {
      return 0;
    }
  };
  const pool = system.sheet.ap !== undefined ? system.sheet.ap : system.sheet.speed;
  let ap = pool === undefined ? DEFAULT_AP : at(pool);
  const has = new Set((sheet && Array.isArray(sheet.traits) && sheet.traits) || []);
  for (const trait of system.sheet.traits || []) {
    const mods = trait.modifiers || {};
    const bonus = mods.ap !== undefined ? mods.ap : mods.speed;
    if (has.has(trait.id) && bonus !== undefined) ap += at(bonus);
  }
  // What its conditions add (L-815): Prone's −10. A condition that stops it
  // moving (noMove) is the turn's business, not its pool's.
  const bare = valuesOf(system, sheet || {}, { bare: true });
  const mods = conditions.modifiersOf(system, sheet || {}, bare);
  ap += conditions.sumOf(mods, 'ap') + conditions.sumOf(mods, 'speed');
  return Math.max(1, Math.min(MAX_AP, Math.floor(ap)));
}

/**
 * A sheet with its pool of action points worked out (`ap`, L-832), in place
 * of the `speed` a sheet from before AP kept.
 */
function withPool(system, sheet) {
  const { speed, ...rest } = sheet;
  void speed;
  return { ...rest, ap: apFor(system, sheet) };
}

/**
 * A save with its character's pool of action points worked out for its
 * world's system: what every reader of the save sees (apOf). A save without
 * a sheet is as it was.
 */
function withAp(save, system) {
  const sheet = sheetOf(save);
  if (!sheet || !save.character) return save;
  return { ...save, character: { ...save.character, sheet: withPool(system, sheet) } };
}

/**
 * A new sheet with the system's defaults (CS9): each attribute at the middle
 * of its range, every skill untrained, the lowest level, every resource
 * full, its pool of action points worked out. `traits` carry over what the character could do.
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
  sheet.ap = apFor(system, sheet);
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
  // Against the maximum without conditions (L-815): one that lowers it for a
  // while doesn't make the sheet a misfit.
  const max = maxima(system, sheet, { bare: true });
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

  // Traits and conditions (the pool is worked out, not checked: apFor).
  if (!Array.isArray(sheet.traits)) errors.push('traits must be a list.');
  else {
    if (sheet.traits.length > MAX_TRAITS) errors.push(`More than ${MAX_TRAITS} traits.`);
    sheet.traits.forEach((t) => {
      if (typeof t !== 'string' || !TRAIT_ID.test(t)) {
        errors.push(`The trait "${t}" isn't an id (letters, digits, - and _).`);
      }
    });
  }
  // Attacks (L-822): optional; checked against the system's combat settings.
  if (sheet.attacks !== undefined) errors.push(...attacks.validateAttacks(system, sheet.attacks));
  if (!Array.isArray(sheet.conditions)) errors.push('conditions must be a list.');
  else {
    if (sheet.conditions.length > MAX_CONDITIONS) errors.push('Too many conditions.');
    sheet.conditions.forEach((c, i) => {
      const id = conditions.idOf(c);
      if (typeof id !== 'string' || !id) errors.push(`conditions[${i}] needs its condition.`);
      else if (conditions.conditionsOn(system) && !conditions.conditionOf(system, id)) {
        errors.push(`There is no condition "${id}" in this world's rules.`);
      }
    });
  }
  return errors;
}

// ── Stat blocks (CS7; L-813) ──────────────────────────────────────────
//
// The short form a template's figures carry (L-790), and a quick way to give
// a named character a sheet: every attribute, and only what differs from the
// defaults besides: `{ attributes, skills?, resources?, level?, traits?,
// attacks? }`.
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
  if (block.attacks !== undefined) sheet.attacks = block.attacks;
  sheet.ap = apFor(system, sheet);
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

// ── The sheet as the player reads it (CS8, EF9; L-814) ────────────────

// What's left of a condition (EF9: "Poisoned · 2 turns"), from its duration
// as L-815 keeps it: rounds and turns left, game time left since it began
// (`since`, in the save's seconds), or until it's saved against. Null when
// it says nothing.
function leftOf(condition, now) {
  const d = isObject(condition.duration) ? condition.duration : null;
  if (!d) return null;
  const count = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  if (Number.isFinite(d.rounds)) return count(Math.max(0, d.rounds), 'round');
  if (Number.isFinite(d.turns)) return count(Math.max(0, d.turns), 'turn');
  if (Number.isFinite(d.seconds)) {
    const since = Number.isFinite(condition.since) ? condition.since : now;
    return clock.duration(Math.max(0, since + d.seconds - now));
  }
  if (d.untilSaved) return 'until saved';
  return null;
}

const titled = (id) => String(id).charAt(0).toUpperCase() + String(id).slice(1);

/**
 * A character's sheet for the Character panel and the strip on the map
 * (planning/game-systems.md CS8, EF9, MD1b; L-814), drawn from the system
 * and in its words, every number worked out here so the page never reads a
 * formula: attributes with their modifiers, resources with their maximums,
 * the level, skills with their ranks and attributes, traits and conditions
 * by name (conditions with what's left), derived values, speed, attacks
 * (L-822; a player's starting ones when the sheet lists none, `player`), and
 * what no longer fits (SY2). `now` is the save's time. Null without a sheet.
 */
function characterView(system, character, now = 0, { player = true } = {}) {
  const sheet = sheetOf(character);
  if (!sheet) return null;
  const s = system.sheet;
  const words = system.words || {};
  const values = valuesOf(system, sheet);
  const at = (text) => {
    try {
      return formula.evaluate(text, { values, system, dice: () => 1 }).total;
    } catch {
      return null;
    }
  };
  const max = maxima(system, sheet);
  const held = isObject(sheet.resources) ? sheet.resources : {};
  const attributeName = (id) => ((s.attributes || []).find((a) => a.id === id) || {}).name || id;
  const traitDefs = new Map((s.traits || []).map((t) => [t.id, t]));
  const conditionDefs = new Map((s.conditions || []).map((c) => [c.id, c]));
  const on = new Set(s.optional || []);
  const misfits = validateSheet(system, sheet);

  return {
    name: (character && character.name) || '',
    system: { id: system.id, name: system.name },
    level: { name: words.level || 'Level', value: sheet.level },
    attributes: (s.attributes || []).map((a) => ({
      id: a.id,
      name: a.name,
      score: values[a.id],
      modifier: at(a.modifier),
    })),
    resources: (s.resources || []).map((r) => {
      const current = isObject(held[r.id]) ? held[r.id].current : null;
      return {
        id: r.id,
        name: r.name,
        current: Number.isFinite(current) ? current : null,
        max: max[r.id],
      };
    }),
    skills: skillsOn(system)
      ? (s.skills || []).map((k) => ({
          id: k.id,
          name: k.name,
          attribute: attributeName(k.attribute),
          rank: values[k.id],
        }))
      : [],
    rankName: words.rank || 'Rank',
    traits: (Array.isArray(sheet.traits) ? sheet.traits : []).map((id) => {
      const def = traitDefs.get(id) || {};
      return {
        id,
        name: def.name || titled(id),
        ...(def.description ? { description: def.description } : {}),
      };
    }),
    conditions: (Array.isArray(sheet.conditions) ? sheet.conditions : [])
      .filter((c) => isObject(c) && (c.id || c.condition))
      .map((c) => {
        const id = c.id || c.condition;
        const def = conditionDefs.get(id) || {};
        const left = leftOf(c, now);
        return { id, name: def.name || c.name || titled(id), ...(left ? { left } : {}) };
      }),
    derived: on.has('derived')
      ? (s.derived || []).map((d) => ({ id: d.id, name: d.name, value: at(d.formula) }))
      : [],
    ap: apFor(system, sheet),
    attacks: attacks.attacksOf(system, sheet, { player }).map((a) => attackView(system, a, values)),
    misfits,
  };
}

// An attack as the player reads it: its name, reach or range, the damage it
// does on a plain hit by this sheet ("2–9", worked out, never its formula),
// and its type.
function attackView(system, a, values) {
  const type = attacks.damageTypesOf(system).find((t) => t.id === a.type);
  const at = (dice) => {
    try {
      return Math.max(
        1,
        Math.trunc(formula.evaluate(String(a.damage), { values, system, dice }).total)
      );
    } catch {
      return null;
    }
  };
  const low = at(() => 1);
  const high = at((sides) => sides);
  return {
    id: a.id,
    name: a.name,
    ...(a.range ? { range: { ...a.range } } : { reach: a.reach || 1 }),
    damage: low === high ? String(low) : low + '–' + high,
    ...(a.type ? { type: type ? type.name : a.type } : {}),
    lethal: a.lethal !== false,
    ...(a.ammo ? { ammo: a.ammo } : {}),
    ...(a.area ? { area: { ...a.area } } : {}),
  };
}

module.exports = {
  DEFAULT_AP,
  MAX_AP,
  characterView,
  leftOf,
  defaultSheet,
  apFor,
  withPool,
  withAp,
  validateSheet,
  validateStatBlock,
  sheetFromStatBlock,
  maxima,
  sheetOf,
  traitsOf,
};
