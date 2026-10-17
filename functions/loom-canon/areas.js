'use strict';

/**
 * Areas on battle maps (planning/game-systems.md §3 EF2, EF7, §4.10; L-815 /
 * #642): the squares a burst, cone, line, square or aura covers. A square is
 * in when its centre is inside the shape, measured in squares from the
 * centre of the origin's as movement counts them (a diagonal step is one
 * square, grid-paths.js), so a burst is a square of squares; and it is in
 * line of effect from the origin: the
 * sight rules (./sight.js), so walls, closed doors and solid obstacles block
 * it. Pure geometry: who is caught is the caller's (everyone in the squares,
 * friend or foe; the source left out unless it says otherwise).
 *
 *   Area
 *     shape   'burst' { radius }            a circle around the origin
 *             'cone' { length, facing }    a quarter circle out from it, 90° wide
 *             'line' { length, width?, facing }   a strip out from it (width 1)
 *             'square' { size }            size × size squares, the origin its
 *                                          top-left (a cube is a square on one level)
 *             'aura' { radius }            a burst around its source, wherever
 *                                          it stands: it moves with it
 *     x, y    the origin's square (an aura's is its source's)
 *     facing  north, south, east, west, northeast, northwest, southeast or
 *             southwest (map north is up)
 *
 * The origin's own square is in a burst, square or aura, and not in a cone
 * or line, which start beside it.
 */

const sight = require('./sight');

const SHAPES = ['burst', 'cone', 'line', 'square', 'aura'];
const MAX_REACH = 30; // squares
const FACINGS = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
  northeast: [1, -1],
  northwest: [-1, -1],
  southeast: [1, 1],
  southwest: [-1, 1],
};
const EDGE = 1e-9; // a centre exactly on the edge is in
const CONE_COS = Math.cos(Math.PI / 4); // half of 90°

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** What's wrong with an area on a map, each named. */
function validateArea(map, area) {
  if (!isObject(area)) return ['The area must be an object.'];
  const errors = [];
  if (!SHAPES.includes(area.shape)) {
    errors.push(`area.shape must be one of ${SHAPES.join(', ')}.`);
    return errors;
  }
  if (
    area.shape !== 'aura' &&
    !(whole(area.x, 0, map.width - 1) && whole(area.y, 0, map.height - 1))
  ) {
    errors.push(`area x, y must be a square on the ${map.width} × ${map.height} grid.`);
  }
  const need = {
    burst: ['radius'],
    aura: ['radius'],
    cone: ['length'],
    line: ['length'],
    square: ['size'],
  };
  for (const field of need[area.shape]) {
    if (!whole(area[field], 1, MAX_REACH)) {
      errors.push(`area.${field} must be a whole number of squares from 1 to ${MAX_REACH}.`);
    }
  }
  if (area.shape === 'line' && area.width !== undefined && !whole(area.width, 1, MAX_REACH)) {
    errors.push(`area.width must be a whole number of squares from 1 to ${MAX_REACH}.`);
  }
  if ((area.shape === 'cone' || area.shape === 'line') && !FACINGS[area.facing]) {
    errors.push(`area.facing must be one of ${Object.keys(FACINGS).join(', ')}.`);
  }
  return errors;
}

// Whether a square's centre, (dx, dy) squares from the origin's, is inside.
function inside(area, dx, dy) {
  const dist = Math.max(Math.abs(dx), Math.abs(dy)); // in squares, as movement counts them
  switch (area.shape) {
    case 'burst':
    case 'aura':
      return dist <= area.radius + EDGE;
    case 'square':
      return dx >= 0 && dy >= 0 && dx < area.size && dy < area.size;
    case 'cone': {
      if (dist === 0 || dist > area.length + EDGE) return false;
      const [fx, fy] = FACINGS[area.facing];
      const cos = (dx * fx + dy * fy) / (Math.hypot(dx, dy) * Math.hypot(fx, fy));
      return cos >= CONE_COS - EDGE;
    }
    case 'line': {
      const [fx, fy] = FACINGS[area.facing];
      // Along it in steps (a diagonal step is one square), across it in squares.
      const along = (dx * fx + dy * fy) / (fx * fx + fy * fy);
      const across = Math.abs(dx * fy - dy * fx) / Math.hypot(fx, fy);
      return along > EDGE && along <= area.length + EDGE && across <= (area.width || 1) / 2 + EDGE;
    }
    default:
      return false;
  }
}

/**
 * The squares an area covers on a map, keyed "x,y": inside it and in line
 * of effect from its origin. `states` is the doors' states (a save's;
 * layers.doorState), `at` an aura's source's square (where it stands now).
 */
function squaresOf(map, area, { states = {}, at = null } = {}) {
  const origin = area.shape === 'aura' ? at : { x: area.x, y: area.y };
  const out = {};
  if (!origin || !Number.isInteger(origin.x) || !Number.isInteger(origin.y)) return out;
  const seen = sight.inSight(map, origin, states);
  const reach = Math.ceil(area.radius || area.length || area.size || 1) + 1;
  for (
    let y = Math.max(0, origin.y - reach);
    y <= Math.min(map.height - 1, origin.y + reach);
    y++
  ) {
    for (
      let x = Math.max(0, origin.x - reach);
      x <= Math.min(map.width - 1, origin.x + reach);
      x++
    ) {
      const key = x + ',' + y;
      if (seen[key] && inside(area, x - origin.x, y - origin.y)) out[key] = true;
    }
  }
  return out;
}

/**
 * Who an area catches (EF7): of `people` ({ id, cell }), those standing in
 * its squares, the source (`sourceId`) left out unless `includeSource`.
 */
function caught(squares, people, { sourceId = null, includeSource = false } = {}) {
  return (people || []).filter(
    (p) =>
      p.cell &&
      squares[p.cell.x + ',' + p.cell.y] &&
      (includeSource || !sourceId || p.id !== sourceId)
  );
}

module.exports = { SHAPES, FACINGS, MAX_REACH, validateArea, squaresOf, caught };
