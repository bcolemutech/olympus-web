'use strict';

/**
 * Checks (planning/game-systems.md §3 DC1–DC8, §4.4; L-803 / #629): a check
 * is `{ skill or attribute, rung, opposedBy? }`, rolled by the world's system:
 * its check formula (./formula.js), its difficulty ladder, and its mapping of
 * results onto five degrees. INTERPRET proposes a check from the system's
 * lists; ADJUDICATE validates it here and rolls it with the server's dice.
 *
 * What a check reads (the check formula's names):
 *   attribute  the score of the attribute it is rolled with (a skill's own)
 *   modifier   that attribute's modifier, by the system's modifier formula
 *   rank       the skill's rank: 0 untrained, or with no skill
 *   ...and every sheet field and level, as the character has them.
 *
 * A character rolls from its sheet (L-811, ./sheets.js): `{ attributes:
 * { [id]: score }, skills: { [id]: rank }, resources: { [id]: { current } },
 * level }`. One without a sheet (an older save, an NPC until L-813) rolls
 * with the system's defaults: each attribute at the middle of its range,
 * untrained, at the lowest level, every resource full.
 *
 * Degrees (DC2): criticalSuccess, criticalFailure, success, successAtCost
 * and failure. The system's degree formulas are tried in that order (each a
 * comparison reading `result`, `difficulty` and `natural`, the first die
 * kept); the first that holds is the degree. With no `success` formula a
 * check succeeds when the result reaches the difficulty: at least it, on a
 * ladder that rises, at most it on one that falls (rolling under), or the
 * comparison itself for a check that is one (d100 <= Stealth). Otherwise it
 * fails.
 *
 * Conditions (EF3; L-815, ./conditions.js) join a check while they last: one
 * that changes an attribute or skill changes the score it reads; one that
 * changes `checks` is a term of its own on the result (or, rolling under, on
 * what it must be under), and one that changes `dice` a term in a pool's
 * size, each named on the roll card: "d20 (14) + Dexterity (2) + Poisoned (-2)".
 *
 * Opposed checks (DC8): both sides roll from their sheets; the higher result
 * wins, a tie going to the defender unless the system says
 * `checks.ties: 'attacker'`.
 *
 * Pure: the dice come from the caller.
 */

const formula = require('./formula');
const { maxima } = require('./sheets');
const conditions = require('./conditions');
const { DEFAULT_SYSTEM_ID, BUILT_IN } = require('./systems');

const DEGREE_ORDER = ['criticalSuccess', 'criticalFailure', 'success', 'successAtCost'];
const SUCCEEDS = ['criticalSuccess', 'success', 'successAtCost'];

// The five degrees by name, best first (DC2; L-805): what the roll card and
// the rules reference call them, unless the system's words name them.
const DEGREE_NAMES = {
  criticalSuccess: 'Critical success',
  success: 'Success',
  successAtCost: 'Success at a cost',
  failure: 'Failure',
  criticalFailure: 'Critical failure',
};

/** A degree in the system's words, or by its own name. */
function degreeName(system, degree) {
  const words = (system && system.words) || {};
  return words[degree] || DEGREE_NAMES[degree] || degree;
}

// The rungs a lock's number difficulty was written against (a d20 scale),
// for a system whose ladder doesn't span it (L-626 locks; mapped by place).
const REFERENCE_LADDER = [10, 15, 20, 25, 30];

/** The system a world plays by, as checks read it: its own, or the built-in fantasy one. */
function systemOf(world) {
  return (world && world.system) || BUILT_IN[DEFAULT_SYSTEM_ID];
}

const sheetOf = (system) => system.sheet || {};
const skillsOn = (system) => (sheetOf(system).optional || []).includes('skills');
const baseScore = (attribute) => Math.floor((attribute.min + attribute.max) / 2);

function rungByName(system, name) {
  const wanted = String(name || '').toLowerCase();
  return system.checks.ladder.find((r) => r.name.toLowerCase() === wanted) || null;
}

/**
 * Whether a proposed check can be rolled in this system: its skill or
 * attribute and its rung exist. The reason it can't, or null.
 */
function refusal(system, check) {
  if (!check || typeof check !== 'object') return 'A check needs a skill or attribute and a rung.';
  const sheet = sheetOf(system);
  if (check.skill !== undefined && check.skill !== null) {
    if (!skillsOn(system)) return 'This world’s rules have no skills; name an attribute.';
    if (!(sheet.skills || []).some((k) => k.id === check.skill)) {
      return `There is no skill "${check.skill}" in this world’s rules.`;
    }
  }
  if (check.attribute !== undefined && check.attribute !== null) {
    if (!(sheet.attributes || []).some((a) => a.id === check.attribute)) {
      return `There is no attribute "${check.attribute}" in this world’s rules.`;
    }
  }
  if (check.rung !== undefined && check.rung !== null && !rungByName(system, check.rung)) {
    return `There is no difficulty "${check.rung}" in this world’s rules.`;
  }
  return null;
}

/**
 * The rung for a canon difficulty (a lock's, L-626): a rung's name, or a
 * number written on the d20 scale locks have always used. On a ladder that
 * rises on such a scale (its hardest rung 10 or more), the number is the
 * difficulty as it is, named by the nearest rung. On any other ladder (a
 * dice pool's 1 to 4, or one that falls for rolling under) it takes the rung
 * at the same place on the d20 scale it was written against.
 * Returns `{ name, value }`.
 */
function canonRung(system, difficulty) {
  const ladder = system.checks.ladder;
  if (typeof difficulty === 'string') {
    const rung = rungByName(system, difficulty);
    if (rung) return rung;
  }
  if (typeof difficulty !== 'number' || !Number.isFinite(difficulty)) return ladder[0];
  const values = ladder.map((r) => r.value);
  const nearest = (list, v) =>
    list.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(list[best] - v) ? i : best), 0);
  const rising = values[values.length - 1] > values[0];
  if (rising && values[values.length - 1] >= REFERENCE_LADDER[0]) {
    return { name: ladder[nearest(values, difficulty)].name, value: difficulty };
  }
  const place = Math.min(nearest(REFERENCE_LADDER, difficulty), ladder.length - 1);
  return ladder[place];
}

/**
 * The numbers a check reads for a character (a sheet, or the system's
 * defaults): every attribute, skill rank and level, with what the
 * character's conditions add to them, and the check's own `attribute`,
 * `modifier` and `rank`. Returns `{ values, attributeId, skillId, mods }`,
 * `mods` what the conditions add, by target (./conditions.js modifiersOf).
 */
function valuesFor(system, character, check, dice) {
  const sheet = sheetOf(system);
  const own = (character && character.sheet) || {};
  const values = {};
  for (const a of sheet.attributes || []) {
    const score = own.attributes && own.attributes[a.id];
    values[a.id] = Number.isFinite(score) ? score : baseScore(a);
  }
  if (skillsOn(system)) {
    for (const k of sheet.skills || []) {
      const rank = own.skills && own.skills[k.id];
      values[k.id] = Number.isFinite(rank) ? rank : 0;
    }
  }
  values.level = Number.isFinite(own.level) ? own.level : (sheet.level || {}).min || 0;
  // Each resource as the character has it now (L-811), or full.
  const full = maxima(system, own);
  for (const r of sheet.resources || []) {
    const held = own.resources && own.resources[r.id];
    values[r.id] =
      held && Number.isFinite(held.current) ? held.current : full[r.id] === null ? 0 : full[r.id];
  }
  // What the conditions add (L-815), from the scores as they are without them.
  const mods = conditions.modifiersOf(system, own, { ...values });
  for (const a of sheet.attributes || []) {
    const by = conditions.sumOf(mods, a.id);
    if (by) values[a.id] = Math.max(a.min, Math.min(a.max, values[a.id] + by));
  }
  if (skillsOn(system)) {
    for (const k of sheet.skills || []) {
      const by = conditions.sumOf(mods, k.id);
      if (by) values[k.id] = Math.max(0, values[k.id] + by);
    }
  }
  for (const d of (sheetOf(system).optional || []).includes('derived') ? sheet.derived || [] : []) {
    values[d.id] = formula.evaluate(d.formula, { values, system, dice }).total;
  }

  const skill =
    check && check.skill ? (sheet.skills || []).find((k) => k.id === check.skill) : null;
  const attributeId =
    (skill && skill.attribute) ||
    (check && check.attribute) ||
    ((sheet.attributes || [])[0] || {}).id;
  const attribute = (sheet.attributes || []).find((a) => a.id === attributeId);
  values.attribute = values[attributeId];
  values.modifier = attribute
    ? formula.evaluate(attribute.modifier, { values, system, dice }).total
    : 0;
  values.rank = skill ? values[skill.id] : 0;
  return { values, attributeId, skillId: skill ? skill.id : null, mods };
}

// The check formula with what conditions add to it (L-815), each a named
// term: `checks` on the result (rolling under, on what it must be under),
// `dice` in each pool's size. Their values and labels are added to `values`
// and `labels`. Returns the formula's tree.
function withConditions(text, mods, values, labels) {
  let tree = formula.parse(text);
  const add = (node, target) =>
    (mods[target] || []).reduce((sum, m) => {
      const name = `@${target}:${m.id}`;
      values[name] = m.value;
      labels[name] = m.name;
      return { k: 'bin', op: '+', a: sum, b: { k: 'name', v: name } };
    }, node);
  if ((mods.dice || []).length) {
    const pools = (n) => {
      if (!n || typeof n !== 'object') return n;
      if (n.k === 'count') return { ...n, pool: { ...n.pool, count: add(n.pool.count, 'dice') } };
      const out = Array.isArray(n) ? [] : {};
      for (const [k, v] of Object.entries(n)) out[k] = typeof v === 'object' ? pools(v) : v;
      return out;
    };
    tree = pools(tree);
  }
  if ((mods.checks || []).length) {
    if (tree.k === 'cmp') {
      const under = tree.op === '<=' || tree.op === '<';
      tree = under ? { ...tree, b: add(tree.b, 'checks') } : { ...tree, a: add(tree.a, 'checks') };
    } else tree = add(tree, 'checks');
  }
  return tree;
}

// What the roll card calls each name a check reads (L-805): the sheet's
// fields by their names, and `attribute`, `modifier` and `rank` by what the
// check is rolled with.
function labelsFor(system, attributeId, skillId) {
  const sheet = sheetOf(system);
  const labels = {};
  for (const part of ['attributes', 'resources', 'skills', 'derived']) {
    for (const field of sheet[part] || []) labels[field.id] = field.name;
  }
  labels.level = (system.words && system.words.level) || 'Level';
  const attribute = (sheet.attributes || []).find((a) => a.id === attributeId);
  if (attribute) labels.attribute = labels.modifier = attribute.name;
  labels.rank = skillId ? labels[skillId] : 'Untrained';
  return labels;
}

// The first die kept in a breakdown: a d20's natural 20, say.
function naturalOf(breakdown) {
  for (const term of breakdown.terms) {
    if (term.kind === 'dice' || term.kind === 'count') {
      const kept = term.rolls.find((r) => r.kept);
      if (kept) return kept.value;
    }
  }
  return 0;
}

/** The degree a result comes to (DC2), by the system's mapping or the default. */
function degreeOf(system, { result, difficulty, natural, type, values, dice }) {
  const degrees = system.checks.degrees || {};
  const at = { ...values, result, difficulty, natural };
  const holds = (text) => formula.evaluate(text, { values: at, system, dice }).total === 1;
  for (const degree of DEGREE_ORDER) {
    if (degrees[degree] && holds(degrees[degree])) return degree;
    if (degree === 'success' && !degrees.success) {
      const ladder = system.checks.ladder;
      const rising = ladder[ladder.length - 1].value > ladder[0].value;
      const met =
        type === 'bool' ? result === 1 : rising ? result >= difficulty : result <= difficulty;
      if (met) return 'success';
    }
  }
  return 'failure';
}

/**
 * Rolls a check (DC1–DC4): `check` { skill?, attribute?, rung? },
 * `difficulty` a `{ name, value }` rung (canon's, where set) overriding the
 * proposal's, `character` the one rolling, `dice(sides)` the server's dice.
 * Returns `{ total, type, breakdown, natural, formula, rung, difficulty,
 * degree, success, attributeId, skillId }`.
 */
function rollCheck(system, { check = {}, character = null, difficulty = null, dice }) {
  const rung = difficulty || rungByName(system, check.rung) || system.checks.ladder[0];
  const { values, attributeId, skillId, mods } = valuesFor(system, character, check, dice);
  const labels = labelsFor(system, attributeId, skillId);
  const tree = withConditions(system.checks.formula, mods, values, labels);
  const result = formula.evaluate(tree, { values, system, dice, labels });
  const natural = naturalOf(result.breakdown);
  const degree = degreeOf(system, {
    result: result.total,
    difficulty: rung.value,
    natural,
    type: result.type,
    values,
    dice,
  });
  return {
    total: result.total,
    type: result.type,
    breakdown: result.breakdown,
    natural,
    formula: system.checks.formula,
    rung: rung.name,
    difficulty: rung.value,
    degree,
    success: SUCCEEDS.includes(degree),
    attributeId,
    skillId,
  };
}

/**
 * An opposed check (DC8): the defender rolls first, from their own sheet,
 * and the attacker's difficulty is the defender's result (one more, where
 * ties go to the defender). Returns `{ attacker, defender }`, each a roll.
 */
function rollOpposed(system, { check = {}, character, opponent, opponentCheck, dice }) {
  const defender = rollCheck(system, {
    check: opponentCheck || check,
    character: opponent,
    dice,
  });
  if (defender.type === 'bool') {
    throw new Error('An opposed check needs a check formula that adds up, not a comparison.');
  }
  const ladder = system.checks.ladder;
  const rising = ladder[ladder.length - 1].value > ladder[0].value;
  const tieToAttacker = system.checks.ties === 'attacker';
  const bar = rising
    ? defender.total + (tieToAttacker ? 0 : 1)
    : defender.total - (tieToAttacker ? 0 : 1);
  const rolled = rollCheck(system, {
    check,
    character,
    difficulty: { name: 'opposed', value: bar },
    dice,
  });
  // Beating the other side is what counts: a win or a loss, critical where
  // the system says so, never "at a cost".
  const wins = rising ? rolled.total >= bar : rolled.total <= bar;
  const degree = wins
    ? rolled.degree === 'criticalSuccess'
      ? 'criticalSuccess'
      : 'success'
    : rolled.degree === 'criticalFailure'
      ? 'criticalFailure'
      : 'failure';
  const attacker = { ...rolled, degree, success: SUCCEEDS.includes(degree) };
  return { attacker, defender };
}

// A degree's formula in words for players: "the die is 20".
const READABLE = {
  natural: 'the die',
  result: 'the result',
  difficulty: 'the difficulty',
  '>=': 'is at least',
  '<=': 'is at most',
  '=': 'is',
  '>': 'is over',
  '<': 'is under',
};
function readable(text) {
  return String(text).replace(/\b(natural|result|difficulty)\b|>=|<=|=|>|</g, (w) => READABLE[w]);
}

/**
 * The rules reference (SY7; L-805): the system as players read it, in its
 * own words. Its attributes, resources and skills; the check, its ladder
 * and its degrees, best first, each with when it happens. Nothing for the
 * narrator alone (its GM notes) is in it.
 */
function rulesOf(system) {
  const sheet = sheetOf(system);
  const attributes = sheet.attributes || [];
  const nameOf = (id) => (attributes.find((a) => a.id === id) || {}).name || id;
  const ladder = system.checks.ladder;
  const rising = ladder[ladder.length - 1].value > ladder[0].value;
  const degrees = system.checks.degrees || {};
  const order = ['criticalSuccess', 'success', 'successAtCost', 'failure', 'criticalFailure'];
  return {
    id: system.id,
    name: system.name,
    words: { ...(system.words || {}) },
    attributes: attributes.map((a) => ({ id: a.id, name: a.name, min: a.min, max: a.max })),
    resources: (sheet.resources || []).map((r) => ({ id: r.id, name: r.name })),
    skills: skillsOn(system)
      ? (sheet.skills || []).map((k) => ({
          id: k.id,
          name: k.name,
          attribute: nameOf(k.attribute),
        }))
      : [],
    level: { name: (system.words && system.words.level) || 'Level', ...(sheet.level || {}) },
    check: system.checks.formula,
    ladder: ladder.map((r) => ({ name: r.name, value: r.value })),
    // How a check is read: reaching the difficulty is meeting or beating it,
    // or rolling at or under it.
    reach: rising ? 'at least' : 'at most',
    degrees: order
      .filter((d) => degrees[d] || d === 'success' || d === 'failure')
      .map((d) => ({
        id: d,
        name: degreeName(system, d),
        when: degrees[d]
          ? readable(degrees[d])
          : d === 'success'
            ? rising
              ? 'the result reaches the difficulty'
              : 'the result is at or under the difficulty'
            : 'otherwise',
      })),
  };
}

/** A dice source that rolls a fixed face on every die (clamped to the die). */
function fixedDice(face) {
  return (sides) => Math.max(1, Math.min(sides, Math.round(face)));
}

module.exports = {
  DEGREE_ORDER,
  DEGREE_NAMES,
  SUCCEEDS,
  degreeName,
  labelsFor,
  rulesOf,
  REFERENCE_LADDER,
  systemOf,
  refusal,
  canonRung,
  valuesFor,
  withConditions,
  naturalOf,
  degreeOf,
  rollCheck,
  rollOpposed,
  fixedDice,
};
