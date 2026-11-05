'use strict';

/**
 * A battle map's doors as the rules read them (planning/maps-from-data.md
 * §4.1, §4.7; L-928 / #732): its geometry's doors (./map-geometry.js), each
 * a segment in feet, `{ id, material, from: [x, y], to: [x, y], wall?, name?,
 * state?, unlocks?: { key?, action? }, ap?, long?, difficulty? }`. Since
 * L-928 the map's old layers are dropped and nothing else is read.
 *
 *   doorsOf(map)          its doors, hidden ones left out (L-927 finds them)
 *   doorOf(map, id)       one by id, or null
 *   stateOf(door, states) 'open', 'closed' or 'locked': the save's (`states`,
 *                         by door id), else the map's, else closed
 *   keyOf(door)           the inventory item that unlocks it, or null
 *   sidesOf(door)         the two squares either side of its middle, the
 *                         ones it is opened from and seen from
 *
 * Pure.
 */

const FEET = 5;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pointOf = (p) =>
  Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
    ? { x: p[0], y: p[1] }
    : p && Number.isFinite(p.x) && Number.isFinite(p.y)
      ? { x: p.x, y: p.y }
      : null;

// The ids of a geometry's hidden things.
function hiddenOf(geometry) {
  return new Set(
    ((geometry && geometry.hidden) || [])
      .map((h) => (typeof h === 'string' ? h : h && h.id))
      .filter(Boolean)
  );
}

/** A map's doors, from its geometry, hidden ones left out. */
function doorsOf(map) {
  const g = map && isObject(map.geometry) ? map.geometry : null;
  if (!g || !Array.isArray(g.doors)) return [];
  const hidden = hiddenOf(g);
  return g.doors.filter((d) => isObject(d) && !hidden.has(d.id));
}

/** One of a map's doors by id, or null. */
function doorOf(map, id) {
  return doorsOf(map).find((d) => d.id === id) || null;
}

/** A door's state for a save: the save's, else the map's, else closed. */
function stateOf(door, states) {
  const saved = states && door && states[door.id];
  return saved || (door && door.state) || 'closed';
}

/** The inventory item that unlocks a door, or null. */
function keyOf(door) {
  return (door && isObject(door.unlocks) && door.unlocks.key) || null;
}

/**
 * The two squares either side of a door's middle (a quarter-square out from
 * its line), as `{ x, y }`: for a door along a grid line, the squares it
 * stands between.
 */
function sidesOf(door) {
  const a = pointOf(door && door.from);
  const b = pointOf(door && door.to);
  if (!a || !b) return [];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (-(b.y - a.y) / len) * (FEET / 4);
  const ny = ((b.x - a.x) / len) * (FEET / 4);
  const sq = (x, y) => ({ x: Math.floor(x / FEET + 1e-9), y: Math.floor(y / FEET + 1e-9) });
  // Left or above first.
  return [sq(mx - nx, my - ny), sq(mx + nx, my + ny)].sort((p, q) => p.x + p.y - (q.x + q.y));
}

module.exports = { FEET, doorsOf, doorOf, stateOf, keyOf, sidesOf };
