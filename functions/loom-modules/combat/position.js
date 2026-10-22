'use strict';

/**
 * Position (planning/combat.md §3 PS1–PS3, TN4, §4.5; L-823 / #655): where
 * an attacker and their target stand, and what it adds to the roll, by the
 * system's settings (./settings.js). No model decides anything (CB0).
 *
 *   Reach and range (PS1)  a melee attack reaches someone within its reach
 *                  in squares (1: beside); a ranged one someone in sight
 *                  within its long range, past its normal range with the
 *                  system's `longRange` added to the roll
 *   Cover (PS2)    the line from the attacker's square's centre to the
 *                  target's: across a wall or a door that isn't open, or
 *                  through a solid obstacle, heavy cover (they are seen round
 *                  a corner, or past the obstacle's edge); past a wall's end,
 *                  or through a low obstacle, partial. The system's `cover`
 *                  term is added to their defence
 *   Flanking (PS3) a melee attack on someone with a friend of the attacker
 *                  standing on their far side: the system's `flanking` term
 *                  added to the roll; off unless set
 *   Dodge (TN5)    someone dodging adds the system's `dodge` to their defence
 *   Defending (TN4)  a trait's reaction (`reaction: { defend, against }`;
 *                  decided 2026-10-22: a reaction comes only from something
 *                  the character has, and nobody has one by default), used
 *                  when it turns a hit into a miss (./strike.js)
 *
 * Terms are `{ name, value }`, `value` a formula the striker evaluates on
 * the attacker's sheet (`bonus`) or the target's (`guard`).
 *
 * Pure.
 */

const layers = require('../../loom-canon/layers');
const sight = require('../../loom-canon/sight');
const { settingsOf } = require('./settings');

const COVER_NAMES = { partial: 'Partial cover', heavy: 'Heavy cover' };
const key = (cell) => cell.x + ',' + cell.y;
const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const RANK = { null: 0, partial: 1, heavy: 2 };
const more = (a, b) => (RANK[b] > RANK[a] ? b : a);

/**
 * How far an attack reaches from `from` to `to` (PS1): 'reach' (melee, in
 * reach), 'normal' or 'long' (ranged), or null (out of reach or range).
 * Sight is the caller's.
 */
function bandOf(attack, from, to) {
  const away = distance(from, to);
  if (attack.range) {
    if (away <= attack.range.normal) return 'normal';
    return away <= attack.range.long ? 'long' : null;
  }
  return away <= (attack.reach || 1) ? 'reach' : null;
}

/**
 * The steps a line from `from`'s centre to `to`'s takes across the grid, in
 * order: each `{ from, to }` between neighbouring squares, diagonal where it
 * passes exactly through a corner. Whole numbers only: the line crosses
 * column edge i at (2i − 1)·|dy| and row edge j at (2j − 1)·|dx|, scaled.
 */
function stepsOf(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const steps = [];
  let at = { x: from.x, y: from.y };
  let i = 1;
  let j = 1;
  while (i <= ax || j <= ay) {
    const tx = i <= ax ? (2 * i - 1) * ay : Infinity;
    const ty = j <= ay ? (2 * j - 1) * ax : Infinity;
    let next;
    if (tx === ty) {
      next = { x: at.x + sx, y: at.y + sy };
      i += 1;
      j += 1;
    } else if (tx < ty) {
      next = { x: at.x + sx, y: at.y };
      i += 1;
    } else {
      next = { x: at.x, y: at.y + sy };
      j += 1;
    }
    steps.push({ from: at, to: next });
    at = next;
  }
  return steps;
}

/**
 * The cover a target at `to` has from an attacker at `from` (PS2), on a map
 * with its doors as the save has them: null, 'partial' or 'heavy'.
 */
function coverOf(map, doors, from, to) {
  if (!map) return null;
  let cover = null;
  const shut = (door) => door && layers.doorState(door, doors || {}) !== 'open';
  for (const step of stepsOf(from, to)) {
    const there = layers.between(map, step.from, step.to);
    const diagonal = step.from.x !== step.to.x && step.from.y !== step.to.y;
    if (diagonal) {
      // Past a corner a wall or door touches: its end, or round it.
      if (there.wall) {
        const a = layers.between(map, step.from, { x: step.to.x, y: step.from.y });
        const b = layers.between(map, step.from, { x: step.from.x, y: step.to.y });
        const c = layers.between(map, { x: step.to.x, y: step.from.y }, step.to);
        const d = layers.between(map, { x: step.from.x, y: step.to.y }, step.to);
        const closed = (e) => e.wall || shut(e.door);
        const round = (closed(a) || closed(c)) && (closed(b) || closed(d));
        cover = more(cover, round ? 'heavy' : 'partial');
      }
    } else if (there.wall || shut(there.door)) cover = more(cover, 'heavy');
    if (!(step.to.x === to.x && step.to.y === to.y)) {
      const ground = layers.groundAt(map, step.to);
      if (ground === 'solid') cover = more(cover, 'heavy');
      else if (ground === 'low') cover = more(cover, 'partial');
    }
  }
  return cover;
}

/** Whether someone at `target` is flanked by an attacker at `from` (PS3): a friend opposite. */
function flanked(from, target, friends) {
  if (distance(from, target) !== 1) return false;
  const far = { x: 2 * target.x - from.x, y: 2 * target.y - from.y };
  return (friends || []).some((f) => f && f.x === far.x && f.y === far.y);
}

/** Whether someone at `from` sees `to`, with the save's doors. */
function sees(map, doors, from, to) {
  return Boolean(sight.inSight(map, from, doors || {})[key(to)]);
}

/**
 * A fighter's defending reaction (TN4): the first trait on their sheet with
 * `reaction.defend` that works against this attack (melee, ranged or all),
 * as `{ name, value }`, or null.
 */
function defendOf(system, sheet, attack) {
  const held = new Set(sheet && Array.isArray(sheet.traits) ? sheet.traits : []);
  const kind = attack && attack.range ? 'ranged' : 'melee';
  const trait = ((system.sheet || {}).traits || []).find(
    (t) =>
      held.has(t.id) &&
      t.reaction &&
      t.reaction.defend !== undefined &&
      [kind, 'all', undefined].includes(t.reaction.against)
  );
  return trait ? { id: trait.id, name: trait.name, value: trait.reaction.defend } : null;
}

/**
 * What position adds to an attack from `from` at `to` (PS1–PS3, TN5):
 * `{ band, cover, flanked, bonus: [term], guard: [term] }`. `friends` are the
 * squares of the attacker's friends standing; `dodging` whether the target
 * took the Dodge action. Reach, range and sight are checked by the caller
 * (band null: out of reach or range).
 */
function termsFor(system, { map, doors, attack, from, to, friends = [], dodging = false }) {
  const s = settingsOf(system);
  const band = bandOf(attack, from, to);
  const cover = coverOf(map, doors, from, to);
  const flank = !attack.range && s.flanking !== null && flanked(from, to, friends);
  const bonus = [];
  const guard = [];
  if (band === 'long' && s.longRange !== null)
    bonus.push({ name: 'Long range', value: s.longRange });
  if (flank) bonus.push({ name: 'Flanking', value: s.flanking });
  if (cover && s.cover[cover] !== null)
    guard.push({ name: COVER_NAMES[cover], value: s.cover[cover] });
  if (dodging && s.dodge !== null) guard.push({ name: 'Dodging', value: s.dodge });
  return { band, cover, flanked: flank, bonus, guard };
}

module.exports = {
  COVER_NAMES,
  distance,
  bandOf,
  stepsOf,
  coverOf,
  flanked,
  sees,
  defendOf,
  termsFor,
};
