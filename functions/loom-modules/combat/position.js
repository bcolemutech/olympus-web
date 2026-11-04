'use strict';

/**
 * Position (planning/combat.md §3 PS1–PS3, TN4, §4.5; L-823 / #655): where
 * an attacker and their target stand, and what it adds to the roll, by the
 * system's settings (./settings.js). No model decides anything (CB0).
 *
 *   Reach and range (PS1)  a melee attack reaches someone within its reach;
 *                  a ranged one someone in sight within its long range, past
 *                  its normal range with the system's `longRange` added to
 *                  the roll. Reach and ranges are in squares of 5 ft,
 *                  measured in feet edge to edge between where each stands
 *                  (L-922, maps-from-data.md DS1; ../../loom-canon/
 *                  map-paths.js bandOf): a reach of 1 touches anyone beside,
 *                  a diagonal too
 *   Cover (PS2)    from the geometry (L-923; coverOf): lines from the
 *                  attacker's eyes across the target; most stopped by
 *                  something that hides (round a corner, behind a pillar),
 *                  heavy; some, or crossing a low wall, a table or glass,
 *                  partial. The system's `cover` term is added to their
 *                  defence
 *   High ground    an attacker standing at least 5 ft above the target
 *                  (L-923; DA2): the system's `highGround` term added to the
 *                  roll; off unless set
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

const sight = require('../../loom-canon/sight');
const mapPaths = require('../../loom-canon/map-paths');
const { settingsOf } = require('./settings');

const COVER_NAMES = { partial: 'Partial cover', heavy: 'Heavy cover' };
// How much higher an attacker stands for high ground (L-923), in feet.
const HIGH_GROUND = 5;
const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// A person's square: a fighter's `cell`, or a square given as it is.
const cellOf = (v) => (v && v.cell ? v.cell : v);

/**
 * How far an attack reaches from `from` to `to` (PS1): 'reach' (melee, in
 * reach), 'normal' or 'long' (ranged), or null (out of reach or range).
 * Each a fighter ({ cell, point?, width? }) or a square (its centre), in
 * feet (L-922). Sight is the caller's.
 */
function bandOf(attack, from, to) {
  return mapPaths.bandOf(attack, from, to);
}

/**
 * The cover a target at `to` has from an attacker at `from` (PS2), on a map
 * with its doors as the save has them: null, 'partial' or 'heavy'. From the
 * geometry (L-923; ../../loom-canon/sight.js linesTo): five lines from the
 * attacker's eyes to points across the target; four or more stopped by
 * something that hides (round a corner, behind a pillar), heavy; any
 * stopped (half behind a wall's end), or crossing something that stops movement but doesn't hide (a
 * low wall, a table, glass or bars), partial. Each a fighter ({ cell,
 * point?, width?, size? }) or a square.
 */
function coverOf(map, doors, from, to) {
  if (!map || !from || !to) return null;
  const { blocked, covered } = sight.linesTo(map, from, to, doors || {});
  if (blocked >= 4) return 'heavy';
  return blocked || covered ? 'partial' : null;
}

/**
 * Whether an attacker at `from` stands on high ground over `to` (L-923;
 * DA2): their floor at least HIGH_GROUND feet above the target's.
 */
function onHighGround(map, from, to) {
  const a = mapPaths.spotOf(from);
  const b = mapPaths.spotOf(to);
  if (!map || !a || !b) return false;
  return mapPaths.floorAt(map, a.point) - mapPaths.floorAt(map, b.point) >= HIGH_GROUND - 1e-9;
}

/** Whether someone at `target` is flanked by an attacker at `from` (PS3): a friend opposite. */
function flanked(from, target, friends) {
  if (distance(from, target) !== 1) return false;
  const far = { x: 2 * target.x - from.x, y: 2 * target.y - from.y };
  return (friends || []).some((f) => f && f.x === far.x && f.y === far.y);
}

/**
 * Whether someone at `from` sees `to`, with the save's doors: each a fighter
 * ({ cell, point?, size? }) or a square (L-923: from their eyes).
 */
function sees(map, doors, from, to) {
  return sight.sees(map, from, to, doors || {});
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
 * `{ band, cover, flanked, bonus: [term], guard: [term] }`, each a fighter
 * or a square. `friends` are the squares of the attacker's friends standing; `dodging` whether the target
 * took the Dodge action. Reach, range and sight are checked by the caller
 * (band null: out of reach or range).
 */
function termsFor(system, { map, doors, attack, from, to, friends = [], dodging = false }) {
  const s = settingsOf(system);
  const band = bandOf(attack, from, to);
  // Cover from the geometry (L-923); flanking by their squares.
  const cover = coverOf(map, doors, from, to);
  const high = s.highGround !== null && onHighGround(map, from, to);
  const flank =
    !attack.range && s.flanking !== null && flanked(cellOf(from), cellOf(to), friends.map(cellOf));
  const bonus = [];
  const guard = [];
  if (band === 'long' && s.longRange !== null)
    bonus.push({ name: 'Long range', value: s.longRange });
  if (flank) bonus.push({ name: 'Flanking', value: s.flanking });
  if (high) bonus.push({ name: 'High ground', value: s.highGround });
  if (cover && s.cover[cover] !== null)
    guard.push({ name: COVER_NAMES[cover], value: s.cover[cover] });
  if (dodging && s.dodge !== null) guard.push({ name: 'Dodging', value: s.dodge });
  return { band, cover, flanked: flank, highGround: high, bonus, guard };
}

module.exports = {
  COVER_NAMES,
  distance,
  bandOf,
  HIGH_GROUND,
  coverOf,
  onHighGround,
  flanked,
  sees,
  defendOf,
  termsFor,
};
