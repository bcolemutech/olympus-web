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
 *   Position (L-823) terms from where they stand (./position.js): `bonus`
 *                   added to the attack's roll (long range, flanking),
 *                   `guard` to the target's defence or roll (cover, Dodge),
 *                   each named in the breakdown; and the target's defending
 *                   reaction (a trait's), used only when it turns a hit
 *                   into a miss, the caller spending their reaction.
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

// A formula's tree with terms added (L-823), each a named value: `{ name,
// value }`, the value a formula worked out on `values`.
function withTerms(tree, terms, { values, labels, system, dice, prefix }) {
  let out = tree;
  (terms || []).forEach((term, i) => {
    const id = `@${prefix}${i}`;
    values[id] = formula.evaluate(String(term.value), { values, system, dice }).total;
    labels[id] = term.name;
    out = { k: 'bin', op: '+', a: out, b: { k: 'name', v: id } };
  });
  return out;
}

// An attack's rank (L-841): given by attacksOf from the sheet, 0 otherwise.
const rankOf = (attack) => (attack && Number.isInteger(attack.rank) ? attack.rank : 0);

/**
 * The attack's roll (AT1): its formula on the attacker's sheet, with their
 * conditions and, striking to subdue with a lethal attack, the system's
 * penalty, each a named term. Returns `{ total, type, breakdown, natural,
 * formula, line }`.
 */
function rollAttack(system, { sheet, attack, subdue = false, bonus = [], dice }) {
  const { values, mods, labels } = valuesOf(system, sheet, dice);
  values.rank = rankOf(attack); // its own rank (L-841)
  labels.rank = 'Rank';
  let tree = checks.withConditions(String(attack.attack), mods, values, labels);
  const penalty = settingsOf(system).subduePenalty;
  if (subdue && attack.lethal !== false && penalty !== null) {
    values['@subdue'] = formula.evaluate(String(penalty), { values, system, dice }).total;
    labels['@subdue'] = 'Subdue';
    tree = { k: 'bin', op: '+', a: tree, b: { k: 'name', v: '@subdue' } };
  }
  tree = withTerms(tree, bonus, { values, labels, system, dice, prefix: 'bonus' });
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
  const guard = { values, labels, system, dice, prefix: 'guard' };
  // A defending reaction (L-823): its value, added only if it saves them.
  const reaction = target.reaction
    ? {
        ...target.reaction,
        total: formula.evaluate(String(target.reaction.value), { values, system, dice }).total,
      }
    : null;
  if (s.hit === 'opposed' && s.defend) {
    const tree = withTerms(
      checks.withConditions(String(s.defend), mods, values, labels),
      target.guard,
      guard
    );
    const theirs = formula.evaluate(tree, { values, system, dice, labels });
    const tieToAttacker = system.checks.ties === 'attacker';
    const barOf = (total) =>
      up ? total + (tieToAttacker ? 0 : 1) : total - (tieToAttacker ? 0 : 1);
    const hits = (bar) => (up ? roll.total >= bar : roll.total <= bar);
    let bar = barOf(theirs.total);
    let hit = hits(bar);
    let reacted = null;
    if (hit && reaction && !hits(barOf(theirs.total + reaction.total))) {
      bar = barOf(theirs.total + reaction.total);
      hit = false;
      reacted = { id: reaction.id, name: reaction.name, value: reaction.total };
    }
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
      ...(reacted ? { reacted } : {}),
      opposed: {
        total: theirs.total + (reacted ? reacted.value : 0),
        type: theirs.type,
        breakdown: theirs.breakdown,
        natural: checks.naturalOf(theirs.breakdown),
        formula: String(s.defend),
        line: theirs.breakdown.named,
      },
    };
  }
  const tree = withTerms(formula.parse(String(s.defence)), target.guard, guard);
  const read = formula.evaluate(tree, { values, system, dice, labels });
  const degreeAt = (difficulty) =>
    checks.degreeOf(system, {
      result: roll.total,
      difficulty,
      natural: roll.natural,
      type: roll.type,
      values,
      dice,
    });
  let difficulty = read.total;
  let degree = degreeAt(difficulty);
  let reacted = null;
  if (checks.SUCCEEDS.includes(degree) && reaction) {
    const raised = degreeAt(difficulty + reaction.total);
    if (!checks.SUCCEEDS.includes(raised)) {
      difficulty += reaction.total;
      degree = raised;
      reacted = { id: reaction.id, name: reaction.name, value: reaction.total };
    }
  }
  return {
    hit: checks.SUCCEEDS.includes(degree),
    degree,
    extra: 0,
    difficulty,
    defence: difficulty,
    defenceLine: read.breakdown.named,
    ...(reacted ? { reacted } : {}),
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
  values.rank = rankOf(attack); // its own rank (L-841)
  labels.rank = 'Rank';
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
    ...(read.defenceLine !== undefined ? { defenceLine: read.defenceLine } : {}),
    ...(read.opposed ? { opposed: read.opposed } : {}),
    ...(read.reacted ? { reacted: read.reacted } : {}),
  };
  if (!read.hit) {
    const you = target.id === 'player';
    const lines = read.reacted
      ? [
          `${you ? 'You' : who} use${you ? '' : 's'} ${read.reacted.name}: ` +
            `${by === 'You' ? 'your' : by + "'s"} blow misses.`,
        ]
      : [`${by} miss${by === 'You' ? '' : 'es'} ${who}.`];
    return { ...base, sheet, down: null, lines };
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
    const you = target.id === 'player';
    if (put.outcome === 'resisted') {
      lines.push(you ? `You resist: not ${put.name}.` : `${who} resists: not ${put.name}.`);
    } else if (put.outcome !== 'kept') {
      lines.push(you ? `You're ${put.name}.` : `${who} is ${put.name}.`);
    }
  }
  let down = null;
  if (after === 0 && health) {
    down = attack.lethal !== false && !subdue ? 'dead' : 'out';
    // The player's fall is said by whoever handles it (L-824; L-827).
    if (target.id !== 'player') {
      lines.push(down === 'dead' ? `${who} falls, dead.` : `${who} falls, knocked out.`);
    }
  }
  return { ...base, damage, sheet: next, down, ...(effect ? { effect } : {}), lines };
}

/**
 * An attack (AT1–AT5): rolled once by the attacker, read against each target
 * (one, or everyone an area catches). `attacker` { name, sheet }, `targets`
 * [{ id, name, sheet, guard?, reaction? }] (L-823: their terms from where
 * they stand, and a defending reaction they can use), `bonus` the attacker's
 * terms. Returns `{ roll, results }`, a result's `reacted` the reaction used.
 */
function strike(system, { attacker, attack, targets, subdue = false, bonus = [], now = 0, dice }) {
  const roll = rollAttack(system, { sheet: attacker.sheet, attack, subdue, bonus, dice });
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
