'use strict';

/**
 * Making a character (planning/game-systems.md §3 CS5, §4.5; L-812 / #639):
 * by the system's own method, checked on the server.
 *
 *   creation (a system's)
 *     method:  'array'     values: [score]            each assigned to one attribute
 *              'pointBuy'  budget, costs: { [score]: cost }   scores bought, within budget
 *              'rolling'   formula                     rolled once per attribute by the
 *                                                     server, then assigned as an array
 *     skills:  { trained, rank }   (with 'skills') up to `trained` skills start at `rank`
 *     traits:  { pick }            (with 'traits') up to `pick` of the system's traits
 *
 *   choices (the player's)
 *     attributes: { [id]: score }, skills: [id], traits: [id]
 *
 * A sheet is built from the choices (./sheets.js) or refused with each
 * reason. Rolled scores are rolled first (rollAttributes) and recorded by the
 * caller, so the scores chosen must be exactly those rolled. Pure: no I/O.
 */

const formula = require('./formula');
const { defaultSheet, maxima, apFor } = require('./sheets');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v) => Number.isInteger(v);
const skillsOn = (system) => ((system.sheet || {}).optional || []).includes('skills');
const traitsOn = (system) => ((system.sheet || {}).optional || []).includes('traits');
const sorted = (list) => list.slice().sort((a, b) => a - b);
const sameScores = (a, b) => a.length === b.length && sorted(a).every((v, i) => v === sorted(b)[i]);

/**
 * What's wrong with a system's `creation` settings (L-801 checks the method
 * is named; this checks its settings against the sheet). Errors only.
 */
function validateCreation(system) {
  const c = system.creation;
  if (!isObject(c) || !c.method) return [];
  const errors = [];
  const attributes = system.sheet.attributes;
  const lo = Math.max(...attributes.map((a) => a.min));
  const hi = Math.min(...attributes.map((a) => a.max));
  if (c.method === 'array') {
    if (!Array.isArray(c.values) || c.values.length !== attributes.length) {
      errors.push(
        `creation.values needs one score for each of the ${attributes.length} attributes.`
      );
    } else if (!c.values.every((v) => whole(v) && v >= lo && v <= hi)) {
      errors.push(`creation.values must be whole numbers every attribute allows (${lo} to ${hi}).`);
    }
  } else if (c.method === 'pointBuy') {
    if (!whole(c.budget) || c.budget < 0) errors.push('creation.budget must be a whole number.');
    if (!isObject(c.costs) || !Object.keys(c.costs).length) {
      errors.push('creation.costs must map each score that can be bought to its cost.');
    } else {
      for (const [score, cost] of Object.entries(c.costs)) {
        if (!whole(Number(score)) || Number(score) < lo || Number(score) > hi) {
          errors.push(
            `creation.costs: ${score} isn't a score every attribute allows (${lo} to ${hi}).`
          );
        }
        if (!whole(cost) || cost < 0) errors.push(`creation.costs: ${score}'s cost must be whole.`);
      }
      const cheapest = Math.min(...Object.values(c.costs).filter(whole));
      if (whole(c.budget) && cheapest * attributes.length > c.budget) {
        errors.push('creation.budget is too small to buy every attribute its cheapest score.');
      }
    }
  } else if (c.method === 'rolling') {
    if (typeof c.formula !== 'string' || !c.formula.trim()) {
      errors.push('creation.formula is required for rolling (4d6kh3, say).');
    } else {
      const checked = formula.check(c.formula, {
        names: [],
        system: { ...system, sheet: { attributes: [] } },
      });
      checked.errors.forEach((e) => errors.push(`creation.formula: ${e}`));
      if (!checked.errors.length) {
        const [min, max] = formula.range(c.formula, { ranges: {}, system });
        if (min < lo || max > hi) {
          errors.push(
            `creation.formula rolls ${min} to ${max}; every attribute allows ${lo} to ${hi}.`
          );
        }
      }
    }
  }
  if (c.skills !== undefined) {
    const count = (system.sheet.skills || []).length;
    if (!skillsOn(system)) errors.push('creation.skills needs the system to have skills.');
    else if (
      !isObject(c.skills) ||
      !whole(c.skills.trained) ||
      c.skills.trained < 0 ||
      c.skills.trained > count
    ) {
      errors.push(`creation.skills.trained must be a whole number from 0 to ${count}.`);
    } else if (!whole(c.skills.rank) || c.skills.rank < 1) {
      errors.push('creation.skills.rank must be a whole number from 1.');
    }
  }
  if (c.traits !== undefined) {
    const count = (system.sheet.traits || []).length;
    if (!traitsOn(system)) errors.push('creation.traits needs the system to have traits.');
    else if (
      !isObject(c.traits) ||
      !whole(c.traits.pick) ||
      c.traits.pick < 0 ||
      c.traits.pick > count
    ) {
      errors.push(`creation.traits.pick must be a whole number from 0 to ${count}.`);
    }
  }
  return errors;
}

/**
 * Rolls a score for each attribute by the system's rolling formula, with the
 * server's dice: `[{ total, line, dice: [{ sides, value, kept }] }]`.
 */
function rollAttributes(system, dice) {
  const c = system.creation || {};
  return system.sheet.attributes.map(() => {
    const result = formula.evaluate(c.formula, { values: {}, system, dice });
    const rolled = [];
    for (const term of result.breakdown.terms) {
      if (term.kind !== 'dice') continue;
      const sides = Number(/d(\d+)/.exec(term.expr)[1]);
      term.rolls.forEach((r) => rolled.push({ sides, value: r.value, kept: r.kept }));
    }
    return { total: result.total, line: result.breakdown.named, dice: rolled };
  });
}

/**
 * A sheet from the player's choices by the system's method, or the reasons
 * it can't be: `{ sheet, errors }`. `rolled` is the list of scores the
 * server rolled (rolling); `startingTraits` the world's (always held).
 */
function buildSheet(system, choices, { rolled = null, startingTraits = [] } = {}) {
  const errors = [];
  const c = system.creation || {};
  const pick = isObject(choices) ? choices : {};
  const attributes = isObject(pick.attributes) ? pick.attributes : {};
  const scores = [];

  for (const a of system.sheet.attributes) {
    const score = attributes[a.id];
    if (score === undefined) errors.push(`Choose a score for ${a.name}.`);
    else if (!whole(score) || score < a.min || score > a.max) {
      errors.push(`${a.name} can't be ${score}; it must be from ${a.min} to ${a.max}.`);
    } else scores.push(score);
  }
  for (const id of Object.keys(attributes)) {
    if (!system.sheet.attributes.some((a) => a.id === id)) {
      errors.push(`There is no attribute "${id}" in this world's rules.`);
    }
  }
  if (scores.length === system.sheet.attributes.length) {
    if (c.method === 'array' && !sameScores(scores, c.values)) {
      errors.push(`Use each of these scores once: ${c.values.join(', ')}.`);
    } else if (c.method === 'pointBuy') {
      const unbuyable = scores.filter((s) => c.costs[String(s)] === undefined);
      if (unbuyable.length) {
        errors.push(`A score of ${unbuyable[0]} can't be bought.`);
      } else {
        const spent = scores.reduce((sum, s) => sum + c.costs[String(s)], 0);
        if (spent > c.budget) errors.push(`That costs ${spent} points; the budget is ${c.budget}.`);
      }
    } else if (c.method === 'rolling') {
      if (!rolled) errors.push('Roll the scores first.');
      else if (!sameScores(scores, rolled)) {
        errors.push(`Use each rolled score once: ${rolled.join(', ')}.`);
      }
    }
  }

  // Skills: up to `trained`, each a skill of the system, none twice.
  const skills = Array.isArray(pick.skills) ? pick.skills : [];
  if (skills.length) {
    const allowed = (c.skills && c.skills.trained) || 0;
    if (!skillsOn(system)) errors.push("This world's rules have no skills.");
    else if (skills.length > allowed) errors.push(`Choose at most ${allowed} skills.`);
    if (new Set(skills).size !== skills.length) errors.push('A skill is chosen twice.');
    skills.forEach((id) => {
      if (!(system.sheet.skills || []).some((k) => k.id === id)) {
        errors.push(`There is no skill "${id}" in this world's rules.`);
      }
    });
  }

  // Traits: up to `pick`, each a trait of the system, none twice.
  const traits = Array.isArray(pick.traits) ? pick.traits : [];
  if (traits.length) {
    const allowed = (c.traits && c.traits.pick) || 0;
    if (traits.length > allowed) errors.push(`Choose at most ${allowed} traits.`);
    if (new Set(traits).size !== traits.length) errors.push('A trait is chosen twice.');
    traits.forEach((id) => {
      if (!(system.sheet.traits || []).some((t) => t.id === id)) {
        errors.push(`There is no trait "${id}" in this world's rules.`);
      }
    });
  }
  if (errors.length) return { sheet: null, errors };

  const sheet = defaultSheet(system, { traits: [...startingTraits, ...traits] });
  sheet.attributes = { ...attributes };
  for (const id of skills) sheet.skills[id] = c.skills.rank;
  const max = maxima(system, sheet);
  for (const r of system.sheet.resources) sheet.resources[r.id] = { current: max[r.id] || 0 };
  sheet.ap = apFor(system, sheet);
  return { sheet, errors: [] };
}

/**
 * What the page needs to walk a player through making a character: the
 * method and its settings, each attribute with the modifier every score
 * gives (the page never works out formulas), the skills and traits to
 * choose from and how many.
 */
function creationView(system) {
  const c = system.creation || {};
  const attributes = system.sheet.attributes.map((a) => {
    const modifiers = {};
    for (let score = a.min; score <= a.max; score++) {
      modifiers[score] = formula.evaluate(a.modifier, {
        values: { [a.id]: score },
        system,
        dice: () => 1,
      }).total;
    }
    return { id: a.id, name: a.name, min: a.min, max: a.max, modifiers };
  });
  const nameOf = (id) => (system.sheet.attributes.find((a) => a.id === id) || {}).name || id;
  return {
    method: c.method || null,
    ...(c.method === 'array' ? { values: c.values } : {}),
    ...(c.method === 'pointBuy' ? { budget: c.budget, costs: c.costs } : {}),
    ...(c.method === 'rolling' ? { formula: c.formula } : {}),
    attributes,
    skills: skillsOn(system)
      ? (system.sheet.skills || []).map((k) => ({
          id: k.id,
          name: k.name,
          attribute: nameOf(k.attribute),
        }))
      : [],
    skillsToTrain: (c.skills && c.skills.trained) || 0,
    skillRank: (c.skills && c.skills.rank) || 0,
    traits: traitsOn(system)
      ? (system.sheet.traits || []).map((t) => ({
          id: t.id,
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
        }))
      : [],
    traitsToPick: (c.traits && c.traits.pick) || 0,
  };
}

module.exports = { validateCreation, rollAttributes, buildSheet, creationView };
