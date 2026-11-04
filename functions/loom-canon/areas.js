'use strict';

/**
 * Areas on battle maps (planning/game-systems.md §3 EF2, EF7, §4.10; L-815 /
 * #642): what a burst, cone, line, square or aura covers. Its sizes are in
 * squares of 5 ft, and it is a true shape in feet (L-922, maps-from-data.md
 * DS1): a burst a circle round the origin's centre, a cone a quarter circle
 * out from it, a line a strip of its length. A square is in when its centre
 * is inside the shape; a person is caught when the point they stand at is
 * (catches); and either must be in line of effect from the origin: the
 * sight rules (./sight.js), so walls, closed doors and solid obstacles block
 * it. Who is caught is everyone so placed, friend or foe; the source left
 * out unless it says otherwise.
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
const mapPaths = require('./map-paths');

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

const FEET = mapPaths.FEET;

// Whether a point (dx, dy) ft from the centre of the origin's square is
// inside the shape (L-922: true shapes, sizes in squares of 5 ft).
function inside(area, dx, dy) {
  const dist = Math.hypot(dx, dy);
  switch (area.shape) {
    case 'burst':
    case 'aura':
      return dist <= area.radius * FEET + EDGE;
    case 'square': {
      // Its squares: the origin's the top-left one.
      const h = FEET / 2;
      return (
        dx >= -h - EDGE && dy >= -h - EDGE && dx < area.size * FEET - h && dy < area.size * FEET - h
      );
    }
    case 'cone': {
      if (dist <= EDGE || dist > area.length * FEET + EDGE) return false;
      const [fx, fy] = FACINGS[area.facing];
      const cos = (dx * fx + dy * fy) / (dist * Math.hypot(fx, fy));
      return cos >= CONE_COS - EDGE;
    }
    case 'line': {
      const [fx, fy] = FACINGS[area.facing];
      const n = Math.hypot(fx, fy);
      // Along it and across it, in feet.
      const along = (dx * fx + dy * fy) / n;
      const across = Math.abs(dx * fy - dy * fx) / n;
      return (
        along > EDGE &&
        along <= area.length * FEET + EDGE &&
        across <= ((area.width || 1) * FEET) / 2 + EDGE
      );
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
  const reach = Math.ceil(area.radius || area.length || area.size || 1) + 2;
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
      if (seen[key] && inside(area, (x - origin.x) * FEET, (y - origin.y) * FEET)) out[key] = true;
    }
  }
  return out;
}

/**
 * Who an area catches (EF7; L-922: by distance): of `people` ({ id, cell,
 * point? }), those whose point (or their square's centre) is inside its true
 * shape, in line of effect from its origin; the source (`sourceId`) left
 * out unless `includeSource`. `states` and `at` as squaresOf's.
 */
function catches(
  map,
  area,
  people,
  { states = {}, at = null, sourceId = null, includeSource = false } = {}
) {
  const origin = area.shape === 'aura' ? at : { x: area.x, y: area.y };
  if (!origin || !Number.isInteger(origin.x) || !Number.isInteger(origin.y)) return [];
  const seen = sight.inSight(map, origin, states);
  const centre = mapPaths.centreOf(origin);
  return (people || []).filter((p) => {
    if (!p.cell || (!includeSource && sourceId && p.id === sourceId)) return false;
    if (!seen[p.cell.x + ',' + p.cell.y]) return false;
    const spot = mapPaths.spotOf(p);
    return Boolean(spot) && inside(area, spot.point.x - centre.x, spot.point.y - centre.y);
  });
}

/**
 * Who an area's squares hold (EF7): of `people` ({ id, cell }), those on
 * them, the source (`sourceId`) left out unless `includeSource`. For an area
 * already worked out as squares; `catches` measures where people stand.
 */
function caught(squares, people, { sourceId = null, includeSource = false } = {}) {
  return (people || []).filter(
    (p) =>
      p.cell &&
      squares[p.cell.x + ',' + p.cell.y] &&
      (includeSource || !sourceId || p.id !== sourceId)
  );
}

module.exports = { SHAPES, FACINGS, MAX_REACH, validateArea, squaresOf, catches, caught };
