'use strict';

/**
 * Striking (planning/combat.md §3 AT1–AT5, DF4, §4.4; L-822 / #654): an
 * attack rolled against one target or everyone an area catches, by the
 * system's combat settings (./settings.js) and the server's dice. No model
 * decides anything (CB0).
 *
 *   Hitting (AT1)   the attack's formula on the attacker's sheet, with what
 *                   their conditions add (as a check's) and Subdue's penalty;
 *                   against the target's defence (a formula of their sheet,
 *                   read as a check's degree), or their own roll (opposed:
 *                   the higher wins, ties to the defender unless the system
 *                   says otherwise). A success at a cost is a plain hit
 *                   (decided 2026-10-21).
 *   Damage (AT2)    the attack's damage formula on the attacker's sheet: a
 *                   critical doubles its dice (critical: 'doubleDice'); each
 *                   success past what was needed adds a die (extraSuccesses:
 *                   'addDie'), or 1 with no dice. At least 1 on a hit.
 *   Types (AT3)     halved when one of the target's traits or conditions
 *                   resists the attack's type, doubled when one is weak to it
 *                   (both: as it is).
 *   More (AT5)      onHit puts its effect on whoever is hit (L-815); an area
 *                   rolls once and is read against each target; ammunition
 *                   is spent by the caller (spendAmmo).
 *   At 0 (DF4)      a lethal attack kills, unless struck to subdue; a
 *                   non-lethal one knocks out.
 *
 * Pure: the dice come from the caller; every sheet returned is new.
 */

const formula = require('../../loom-canon/formula');
const checks = require('../../loom-canon/checks');
const conditions = require('../../loom-canon/conditions');
const effects = require('../../loom-canon/effects');
const { maxima } = require('../../loom-canon/sheets');
const { settingsOf } = require('./settings');
const { damageTypesOf } = require('./attacks');

const copyOf = (v) => JSON.parse(JSON.stringify(v));
const named = (name, v) => ({ k: 'name', v: name, value: v });
const rising = (system) => {
  const ladder = system.checks.ladder;
  return ladder[ladder.length - 1].value > ladder[0].value;
};

// A sheet's values with its conditions (as a check reads them), and the
// labels the roll card names them by.
function valuesOf(system, sheet, dice) {
  const { values, mods } = checks.valuesFor(system, { sheet: sheet || null }, {}, dice);
  const labels = checks.labelsFor(system, null, null);
  return { values, mods, labels };
}

/**
 * The attack's roll (AT1): its formula on the attacker's sheet, with their
 * conditions and, striking to subdue with a lethal attack, the system's
 * penalty, each a named term. Returns `{ total, type, breakdown, natural,
 * formula, line }`.
 */
function rollAttack(system, { sheet, attack, subdue = false, dice }) {
  const { values, mods, labels } = valuesOf(system, sheet, dice);
  let tree = checks.withConditions(String(attack.attack), mods, values, labels);
  const penalty = settingsOf(system).subduePenalty;
  if (subdue && attack.lethal !== false && penalty !== null) {
    values['@subdue'] = formula.evaluate(String(penalty), { values, system, dice }).total;
    labels['@subdue'] = 'Subdue';
    tree = { k: 'bin', op: '+', a: tree, b: { k: 'name', v: '@subdue' } };
  }
  const result = formula.evaluate(tree, { values, system, dice, labels });
  return {
    total: result.total,
    type: result.type,
    breakdown: result.breakdown,
    natural: checks.naturalOf(result.breakdown),
    formula: String(attack.attack),
    line: result.breakdown.named,
  };
}

/**
 * Whether a roll hits a target (AT1), and how well: `{ hit, degree, extra,
 * difficulty, defence?, opposed? }`. `extra` is the successes past what was
 * needed (opposed), `opposed` the target's own roll.
 */
function hitOf(system, roll, target, dice) {
  const s = settingsOf(system).attack;
  const { values, mods, labels } = valuesOf(system, target.sheet, dice);
  const up = rising(system);
  if (s.hit === 'opposed' && s.defend) {
    const tree = checks.withConditions(String(s.defend), mods, values, labels);
    const theirs = formula.evaluate(tree, { values, system, dice, labels });
    const tieToAttacker = system.checks.ties === 'attacker';
    const bar = up
      ? theirs.total + (tieToAttacker ? 0 : 1)
      : theirs.total - (tieToAttacker ? 0 : 1);
    const hit = up ? roll.total >= bar : roll.total <= bar;
    const read = checks.degreeOf(system, {
      result: roll.total,
      difficulty: bar,
      natural: roll.natural,
      type: roll.type,
      values,
      dice,
    });
    // Beating the other side is what counts: critical where the system
    // says so, never "at a cost".
    const degree = hit
      ? read === 'criticalSuccess'
        ? 'criticalSuccess'
        : 'success'
      : read === 'criticalFailure'
        ? 'criticalFailure'
        : 'failure';
    return {
      hit,
      degree,
      extra: hit ? Math.abs(roll.total - bar) : 0,
      difficulty: bar,
      opposed: {
        total: theirs.total,
        type: theirs.type,
        breakdown: theirs.breakdown,
        natural: checks.naturalOf(theirs.breakdown),
        formula: String(s.defend),
        line: theirs.breakdown.named,
      },
    };
  }
  const difficulty = formula.evaluate(String(s.defence), { values, system, dice }).total;
  const degree = checks.degreeOf(system, {
    result: roll.total,
    difficulty,
    natural: roll.natural,
    type: roll.type,
    values,
    dice,
  });
  return {
    hit: checks.SUCCEEDS.includes(degree),
    degree,
    extra: 0,
    difficulty,
    defence: difficulty,
  };
}

// The damage formula's tree, its dice doubled on a critical (doubleDice) and
// a die more for each extra success (addDie; with no dice, 1 more each).
function damageTree(text, { critical, extra }) {
  let tree = formula.parse(String(text));
  let dice = 0;
  const walk = (n) => {
    if (!n || typeof n !== 'object') return n;
    if (n.k === 'dice') {
      dice += 1;
      let count = n.count;
      if (critical) count = { k: 'bin', op: '*', a: count, b: { k: 'num', v: 2 } };
      if (extra && dice === 1) count = { k: 'bin', op: '+', a: count, b: named('@extra', extra) };
      return { ...n, count };
    }
    const out = Array.isArray(n) ? [] : {};
    for (const [k, v] of Object.entries(n)) out[k] = typeof v === 'object' ? walk(v) : v;
    return out;
  };
  tree = walk(tree);
  if (extra && !dice) tree = { k: 'bin', op: '+', a: tree, b: named('@extra', extra) };
  return tree;
}

/**
 * How a target takes a damage type (AT3): 'resist' (half), 'weak' (double)
 * or null, from the system's traits they hold and the conditions on them.
 */
function takesOf(system, sheet, type) {
  if (!type || !sheet) return null;
  const traits = new Map(((system.sheet || {}).traits || []).map((t) => [t.id, t]));
  const held = (Array.isArray(sheet.traits) ? sheet.traits : [])
    .map((id) => traits.get(id))
    .filter(Boolean)
    .concat(conditions.activeOn(system, sheet).map((a) => a.condition));
  const resists = held.some((h) => (h.resist || []).includes(type));
  const weak = held.some((h) => (h.weak || []).includes(type));
  if (resists === weak) return null;
  return resists ? 'resist' : 'weak';
}

/**
 * Damage on a hit (AT2, AT3): `{ total, rolled, takes, breakdown, line, type }`,
 * `rolled` before the target's resistance or weakness.
 */
function rollDamage(system, { sheet, attack, degree, extra, target, dice }) {
  const s = settingsOf(system).attack;
  const { values, labels } = valuesOf(system, sheet, dice);
  values['@extra'] = extra;
  labels['@extra'] = extra === 1 ? 'Extra success' : 'Extra successes';
  const tree = damageTree(attack.damage, {
    critical: degree === 'criticalSuccess' && s.critical === 'doubleDice',
    extra: s.extraSuccesses === 'addDie' ? extra : 0,
  });
  const result = formula.evaluate(tree, { values, system, dice, labels });
  const rolled = Math.max(1, Math.trunc(result.total));
  const takes = takesOf(system, target, attack.type);
  const total =
    takes === 'resist' ? Math.floor(rolled / 2) : takes === 'weak' ? rolled * 2 : rolled;
  const type = damageTypesOf(system).find((t) => t.id === attack.type);
  return {
    total,
    rolled,
    takes,
    breakdown: result.breakdown,
    line: result.breakdown.named,
    type: type ? type.name : attack.type || null,
  };
}

/**
 * The attack read against one target, the roll already made: whether it hits,
 * the damage and what it does to them (their sheet after: health off, the
 * onHit effect on), and whether they are down. `target` { id, name, sheet };
 * `now` the save's time, for the effect.
 *
 * Returns `{ id, name, hit, degree, difficulty, defence?, opposed?, damage?,
 * sheet, down: null | 'dead' | 'out', effect?, lines }`.
 */
function against(system, { roll, attack, subdue = false, target, attackerName, now = 0, dice }) {
  const read = hitOf(system, roll, target, dice);
  const sheet = copyOf(target.sheet || {});
  const who = target.name;
  const by = attackerName === 'You' ? 'You' : attackerName;
  const base = {
    id: target.id,
    name: who,
    hit: read.hit,
    degree: read.degree,
    difficulty: read.difficulty,
    ...(read.defence !== undefined ? { defence: read.defence } : {}),
    ...(read.opposed ? { opposed: read.opposed } : {}),
  };
  if (!read.hit) {
    return { ...base, sheet, down: null, lines: [`${by} miss${by === 'You' ? '' : 'es'} ${who}.`] };
  }
  const damage = rollDamage(system, {
    sheet: target.attackerSheet,
    attack,
    degree: read.degree,
    extra: read.extra,
    target: sheet,
    dice,
  });
  const health = settingsOf(system).health;
  const max = health ? maxima(system, sheet)[health] : null;
  const held = (sheet.resources = sheet.resources || {})[health] || {};
  const before = Number.isFinite(held.current) ? held.current : max || 0;
  const after = Math.max(0, before - damage.total);
  if (health) sheet.resources[health] = { ...held, current: after };
  const lines = [
    `${by} hit${by === 'You' ? '' : 's'} ${who} with ${by === 'You' ? 'your' : 'their'} ` +
      `${attack.name.toLowerCase()} for ${damage.total}` +
      (damage.type ? ' ' + damage.type.toLowerCase() : '') +
      (damage.takes === 'resist' ? ' (resisted)' : damage.takes === 'weak' ? ' (a weakness)' : '') +
      (read.degree === 'criticalSuccess' ? ': a critical hit' : '') +
      '.',
  ];
  let next = sheet;
  let effect = null;
  if (attack.onHit && after > 0) {
    const put = effects.apply(
      system,
      next,
      { ...attack.onHit, source: { kind: 'attack', id: attack.id, name: attack.name } },
      { now, dice }
    );
    next = put.sheet;
    effect = { outcome: put.outcome, name: put.name, ...(put.roll ? { roll: put.roll } : {}) };
    if (put.outcome === 'resisted') lines.push(`${who} resists: not ${put.name}.`);
    else if (put.outcome !== 'kept') lines.push(`${who} is ${put.name}.`);
  }
  let down = null;
  if (after === 0 && health) {
    down = attack.lethal !== false && !subdue ? 'dead' : 'out';
    lines.push(down === 'dead' ? `${who} falls, dead.` : `${who} falls, knocked out.`);
  }
  return { ...base, damage, sheet: next, down, ...(effect ? { effect } : {}), lines };
}

/**
 * An attack (AT1–AT5): rolled once by the attacker, read against each target
 * (one, or everyone an area catches). `attacker` { name, sheet }, `targets`
 * [{ id, name, sheet }]. Returns `{ roll, results }`.
 */
function strike(system, { attacker, attack, targets, subdue = false, now = 0, dice }) {
  const roll = rollAttack(system, { sheet: attacker.sheet, attack, subdue, dice });
  const results = targets.map((target) =>
    against(system, {
      roll,
      attack,
      subdue,
      target: { ...target, attackerSheet: attacker.sheet },
      attackerName: attacker.name,
      now,
      dice,
    })
  );
  return { roll, results };
}

/**
 * Ammunition (AT5): `{ sheet }` with one spent, or `{ refused }` when there's
 * none left. An attack with no ammo passes through.
 */
function spendAmmo(system, sheet, attack) {
  if (!attack.ammo) return { sheet };
  const resource = ((system.sheet || {}).resources || []).find((r) => r.id === attack.ammo);
  const held = sheet && sheet.resources && sheet.resources[attack.ammo];
  const max = maxima(system, sheet || {})[attack.ammo];
  const current = held && Number.isFinite(held.current) ? held.current : max || 0;
  if (current < 1) {
    return { refused: `You're out of ${resource ? resource.name.toLowerCase() : attack.ammo}.` };
  }
  const next = copyOf(sheet);
  next.resources = next.resources || {};
  next.resources[attack.ammo] = { ...(held || {}), current: current - 1 };
  return { sheet: next };
}

module.exports = { rollAttack, hitOf, takesOf, rollDamage, against, strike, spendAmmo };
