'use strict';

/**
 * Areas on battle maps (#670): named stretches of a map, not spots on it —
 * the back room, the hearth, behind the bar. A feature (./maps.js) is a spot
 * a player acts on; an area is where they are: a label on the grid and a
 * line for the GM, never a thing to click.
 *
 *   Area
 *     id, name
 *     polygon: [{ x, y }, …]  — its outline, at least 3 corners of the grid
 *                               (whole numbers, from (0, 0) at the map's
 *                               top-left corner to (width, height) at its
 *                               bottom-right), not crossing itself
 *
 * A square is in an area when its centre is inside the outline. Areas may
 * overlap: a square's area is the smallest that holds it (the bar inside
 * the taproom), fewest squares first, then by id.
 *
 * Pure.
 */

const MAX_AREAS = 30;
const MAX_CORNERS = 40;

const key = (x, y) => x + ',' + y;

// Whether a point is inside a polygon (ray casting; on an edge counts as
// either, which a square's centre never is: corners are whole numbers).
function inside(polygon, px, py) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** The squares of an area on a map, as "x,y" keys, in reading order. */
function squaresOf(map, area) {
  const polygon = area.polygon || [];
  if (polygon.length < 3) return [];
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(map.width, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(map.height, Math.ceil(Math.max(...ys)));
  const out = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (inside(polygon, x + 0.5, y + 0.5)) out.push(key(x, y));
    }
  }
  return out;
}

/** Each live area of a map with its squares: [{ area, squares }]. */
function areasOf(map) {
  return (map.areas || []).map((area) => ({ area, squares: squaresOf(map, area) }));
}

/** The area a square is in (the smallest holding it), or null. */
function areaAt(map, cell) {
  if (!cell) return null;
  const k = key(cell.x, cell.y);
  let best = null;
  for (const { area, squares } of areasOf(map)) {
    if (!squares.includes(k)) continue;
    if (
      !best ||
      squares.length < best.size ||
      (squares.length === best.size && area.id < best.area.id)
    ) {
      best = { area, size: squares.length };
    }
  }
  return best ? best.area : null;
}

// Whether segments ab and cd cross (touching at an end doesn't count).
function crosses(a, b, c, d) {
  const side = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  // Collinear and overlapping: a fold back along itself.
  const within = (p, q, r) =>
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y);
  const strictly = (p, q, r) =>
    within(p, q, r) && !(r.x === p.x && r.y === p.y) && !(r.x === q.x && r.y === q.y);
  return (
    (d1 === 0 && strictly(c, d, a)) ||
    (d2 === 0 && strictly(c, d, b)) ||
    (d3 === 0 && strictly(a, b, c)) ||
    (d4 === 0 && strictly(a, b, d))
  );
}

function selfCrossing(polygon) {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const c = polygon[j];
      const d = polygon[(j + 1) % n];
      if (adjacent) {
        // Neighbours share a corner; they may only fold back onto each other.
        const shared = j === i + 1 ? b : a;
        const far1 = j === i + 1 ? a : b;
        const far2 = j === i + 1 ? d : c;
        const back =
          Math.sign(
            (far1.x - shared.x) * (far2.y - shared.y) - (far1.y - shared.y) * (far2.x - shared.x)
          ) === 0 &&
          (far1.x - shared.x) * (far2.x - shared.x) + (far1.y - shared.y) * (far2.y - shared.y) > 0;
        if (back) return true;
        continue;
      }
      if (crosses(a, b, c, d)) return true;
    }
  }
  return false;
}

/**
 * Why a map's areas won't do: a list of plain sentences, empty when they
 * will. Checks each outline against the map's grid, and the ids.
 */
function validate(map, areas) {
  const errors = [];
  if (!Array.isArray(areas)) return ['Areas must be a list.'];
  if (areas.length > MAX_AREAS) errors.push(`A map has at most ${MAX_AREAS} areas.`);
  const ids = new Set();
  for (const area of areas) {
    const name = area && area.name ? `"${area.name}"` : 'An area';
    if (!area || typeof area.id !== 'string' || !area.id) {
      errors.push(`${name} needs an id.`);
      continue;
    }
    if (ids.has(area.id)) errors.push(`Two areas have the id "${area.id}".`);
    ids.add(area.id);
    const polygon = area.polygon;
    if (!Array.isArray(polygon) || polygon.length < 3) {
      errors.push(`${name} needs an outline of at least 3 corners.`);
      continue;
    }
    if (polygon.length > MAX_CORNERS) {
      errors.push(`${name} has more than ${MAX_CORNERS} corners.`);
      continue;
    }
    const off = polygon.find(
      (p) =>
        !p ||
        !Number.isInteger(p.x) ||
        !Number.isInteger(p.y) ||
        p.x < 0 ||
        p.y < 0 ||
        p.x > map.width ||
        p.y > map.height
    );
    if (off) {
      errors.push(
        `${name} has a corner (${off.x}, ${off.y}) that isn't a corner of the ` +
          `${map.width} × ${map.height} grid: whole numbers from (0, 0) to ` +
          `(${map.width}, ${map.height}).`
      );
      continue;
    }
    if (selfCrossing(polygon)) {
      errors.push(`${name}'s outline crosses itself: list its corners in order around it.`);
      continue;
    }
    if (!squaresOf(map, area).length) errors.push(`${name} holds no whole square's centre.`);
  }
  return errors;
}

// Names that say a space rather than a spot: candidates to be areas.
const SPACE_WORDS =
  /\b(room|hall|chamber|behind|corner|area|quarter|wing|yard|courtyard|loft|gallery|alcove|nook|hearth)\b/i;

/** Whether a feature's name sounds like a space (an area) more than a spot. */
function soundsLikeAnArea(feature) {
  return SPACE_WORDS.test(String((feature && feature.name) || ''));
}

/**
 * The middle of some squares, for an area's label: the square nearest their
 * centre, of those not in `taken` ("x,y" keys of squares something stands
 * on, so the label never covers what's there) when any are free.
 */
function labelSquare(squares, taken = new Set()) {
  if (!squares.length) return null;
  const free = squares.filter((k) => !taken.has(k));
  const cells = (free.length ? free : squares).map((k) => k.split(',').map(Number));
  const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
  const cy = cells.reduce((s, c) => s + c[1], 0) / cells.length;
  let best = cells[0];
  let bestD = Infinity;
  for (const c of cells) {
    const d = (c[0] - cx) ** 2 + (c[1] - cy) ** 2;
    if (d < bestD - 1e-9) {
      best = c;
      bestD = d;
    }
  }
  return { x: best[0], y: best[1] };
}

module.exports = {
  squaresOf,
  areasOf,
  areaAt,
  validate,
  soundsLikeAnArea,
  labelSquare,
  MAX_AREAS,
  MAX_CORNERS,
};
