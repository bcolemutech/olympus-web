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
 * Before characters have sheets (L-811), a character rolls with the
 * system's defaults: each attribute at the middle of its range, untrained,
 * at the lowest level. A sheet, where there is one, is read as
 * `{ attributes: { [id]: score }, skills: { [id]: rank }, level }`.
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
 * Opposed checks (DC8): both sides roll from their sheets; the higher result
 * wins, a tie going to the defender unless the system says
 * `checks.ties: 'attacker'`.
 *
 * Pure: the dice come from the caller.
 */

const formula = require('./formula');
const { DEFAULT_SYSTEM_ID, BUILT_IN } = require('./systems');

const DEGREE_ORDER = ['criticalSuccess', 'criticalFailure', 'success', 'successAtCost'];
const SUCCEEDS = ['criticalSuccess', 'success', 'successAtCost'];

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
 * defaults): every attribute, skill rank and level, and the check's own
 * `attribute`, `modifier` and `rank`. Returns `{ values, attributeId, skillId }`.
 */
function valuesFor(system, character, check, dice) {
  const sheet = sheetOf(system);
  const own = (character && character.sheet) || {};
  const values = {};
  for (const a of sheet.attributes || []) {
    const score = own.attributes && own.attributes[a.id];
    values[a.id] = Number.isFinite(score) ? score : baseScore(a);
  }
  for (const r of sheet.resources || []) values[r.id] = 0;
  if (skillsOn(system)) {
    for (const k of sheet.skills || []) {
      const rank = own.skills && own.skills[k.id];
      values[k.id] = Number.isFinite(rank) ? rank : 0;
    }
  }
  values.level = Number.isFinite(own.level) ? own.level : (sheet.level || {}).min || 0;
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
  return { values, attributeId, skillId: skill ? skill.id : null };
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
  const { values, attributeId, skillId } = valuesFor(system, character, check, dice);
  const result = formula.evaluate(system.checks.formula, { values, system, dice });
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

/** A dice source that rolls a fixed face on every die (clamped to the die). */
function fixedDice(face) {
  return (sides) => Math.max(1, Math.min(sides, Math.round(face)));
}

module.exports = {
  DEGREE_ORDER,
  SUCCEEDS,
  REFERENCE_LADDER,
  systemOf,
  refusal,
  canonRung,
  valuesFor,
  degreeOf,
  rollCheck,
  rollOpposed,
  fixedDice,
};
