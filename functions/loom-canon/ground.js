'use strict';

/**
 * A town's ground (planning/the-loom-movement-and-vision.md §7; L-652 /
 * #464): what blocks walking in a settlement's 0–1000 town square.
 *
 *   settlement.town.ground: {
 *     buildings: [{ points, name? }]          — polygons; never walkable
 *     water:     [{ points, name? }]          — polygons (a river, a harbour,
 *                                              a pond); walkable only where a
 *                                              crossing covers it
 *     walls:     [{ points, name? }]          — lines (a town wall, a fence);
 *                                              never crossed
 *     crossings: [{ points, name?, kind? }]   — polygons over water, a bridge
 *                                              (kind 'bridge', the default) or
 *                                              a ford ('ford')
 *   }
 *
 * Points are `{ x, y }` in the town square, as places' positions. A polygon's
 * points go round it once and close back to the first on their own. A gate
 * is a gap in a wall with a way in or out standing in it. Everything else is
 * open ground: the streets, squares and fields between the shapes.
 *
 * A place's `position` is its door, which must be on open ground and be
 * reachable on foot from a way in (`check`). A town without ground is open
 * ground everywhere, and none of this applies to it.
 *
 * Walking is worked out on a grid of CELL-unit squares over the town square
 * (`compile`): a square is blocked when its centre is in a building, or in
 * water outside every crossing, and whenever a wall or a water's edge passes
 * through it, so a wall or a narrow river is never slipped through. Steps go
 * 8 ways, and a diagonal can't cut the corner of a blocked square. Paths in
 * town (§8) build on this.
 *
 * Pure helpers over plain objects.
 */

const town = require('./town');

const SIDE = 1000; // the town square, as town.TOWN_SIDE
const CELL = 5; // the walking grid's squares, in town units
const N = SIDE / CELL;
const LIMITS = Object.freeze({
  buildings: 400,
  water: 30,
  walls: 60,
  crossings: 40,
  points: 200, // in any one shape
  totalPoints: 8000,
  name: 80,
});
const KINDS = ['buildings', 'water', 'walls', 'crossings'];
const SINGULAR = { buildings: 'building', water: 'water', walls: 'wall', crossings: 'crossing' };
const KINDS_OF = { building: 'buildings', water: 'water', wall: 'walls' };
const CROSSING_KINDS = ['bridge', 'ford'];
const EPS = 1e-9;

const compiled = new WeakMap();

const isPoint = (p) => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const at = (p) => '(' + p.x + ', ' + p.y + ')';

/** The town's ground, or null when it has none. */
function groundOf(settlement) {
  const ground = settlement && settlement.town && settlement.town.ground;
  return ground && typeof ground === 'object' ? ground : null;
}

/** Whether a settlement's town has ground: at least one shape. */
function hasGround(settlement) {
  const ground = groundOf(settlement);
  return Boolean(ground) && KINDS.some((kind) => (ground[kind] || []).length > 0);
}

// ── Geometry ───────────────────────────────────────────────────────────────

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(p, a, b) {
  return (
    Math.abs(cross(a, b, p)) < EPS &&
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS &&
    p.y <= Math.max(a.y, b.y) + EPS
  );
}

// Whether segments ab and cd touch at all (crossing, touching or overlapping).
function segmentsMeet(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (
    ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
    ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
  ) {
    return true;
  }
  return onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Even-odd point in polygon; a point on the edge counts as outside.
function inside(points, p) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (onSegment(p, a, b)) return false;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      result = !result;
    }
  }
  return result;
}

// A polygon's edges as [a, b] pairs, closing back to the first point; a
// line's (`closed` false) without the closing edge.
function edges(points, closed) {
  const list = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) list.push([points[i], points[(i + 1) % points.length]]);
  return list;
}

// Whether a polygon's edges cross themselves (other than neighbours meeting).
function selfIntersects(points) {
  const sides = edges(points, true);
  const n = sides.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const neighbours = j === i + 1 || (i === 0 && j === n - 1);
      if (neighbours) continue;
      if (segmentsMeet(sides[i][0], sides[i][1], sides[j][0], sides[j][1])) return true;
    }
  }
  return false;
}

function area(points) {
  let sum = 0;
  for (const [a, b] of edges(points, true)) sum += a.x * b.y - b.x * a.y;
  return Math.abs(sum) / 2;
}

function polygonsOverlap(a, b) {
  if (a.some((p) => inside(b, p)) || b.some((p) => inside(a, p))) return true;
  for (const [p, q] of edges(a, true)) {
    for (const [r, s] of edges(b, true)) if (segmentsMeet(p, q, r, s)) return true;
  }
  return false;
}

// ── The shapes' own checks ─────────────────────────────────────────────────

function label(kind, shape, index) {
  const name = shape && typeof shape.name === 'string' && shape.name ? ' "' + shape.name + '"' : '';
  return SINGULAR[kind] + ' ' + (index + 1) + name;
}

/**
 * What's wrong with the shapes themselves, as plain sentences (none when
 * fine): unknown kinds, too many shapes or points, points off the town
 * square, polygons that aren't closed and simple, lines that go nowhere, and
 * crossings over no water.
 */
function shapeProblems(ground) {
  if (!ground || typeof ground !== 'object' || Array.isArray(ground)) {
    return ['The ground must be an object of buildings, water, walls and crossings.'];
  }
  const problems = [];
  for (const key of Object.keys(ground)) {
    if (!KINDS.includes(key)) {
      problems.push('Unknown ground "' + key + '": use buildings, water, walls or crossings.');
    }
  }
  let total = 0;
  for (const kind of KINDS) {
    const list = ground[kind] == null ? [] : ground[kind];
    if (!Array.isArray(list)) {
      problems.push('The ' + kind + ' must be a list.');
      continue;
    }
    if (list.length > LIMITS[kind]) {
      problems.push('Too many ' + kind + ': ' + list.length + ' (at most ' + LIMITS[kind] + ').');
    }
    const polygon = kind !== 'walls';
    list.forEach((shape, index) => {
      const name = label(kind, shape, index);
      const points = shape && shape.points;
      if (!Array.isArray(points)) {
        problems.push('The ' + name + ' has no points.');
        return;
      }
      total += points.length;
      if (
        shape.name != null &&
        (typeof shape.name !== 'string' || shape.name.length > LIMITS.name)
      ) {
        problems.push('The ' + name + '’s name must be text of at most ' + LIMITS.name + '.');
      }
      if (kind === 'crossings' && shape.kind != null && !CROSSING_KINDS.includes(shape.kind)) {
        problems.push('The ' + name + ' must be a bridge or a ford.');
      }
      if (points.length > LIMITS.points) {
        problems.push(
          'The ' + name + ' has ' + points.length + ' points (at most ' + LIMITS.points + ').'
        );
        return;
      }
      const bad = points.find((p) => !isPoint(p) || p.x < 0 || p.y < 0 || p.x > SIDE || p.y > SIDE);
      if (bad) {
        problems.push(
          'The ' +
            name +
            ' has a point ' +
            (isPoint(bad) ? at(bad) + ' ' : '') +
            'off the town square (0–1000 each way).'
        );
        return;
      }
      if (polygon) {
        const ring = closedRing(points);
        if (ring.length < 3) {
          problems.push('The ' + name + ' needs at least 3 corners.');
        } else if (hasRepeat(ring, true) || selfIntersects(ring)) {
          problems.push('The ' + name + ' crosses itself: go round its edge once.');
        } else if (area(ring) < EPS) {
          problems.push('The ' + name + ' has no area: its corners are in a line.');
        }
      } else if (points.length < 2) {
        problems.push('The ' + name + ' needs at least 2 points.');
      } else if (hasRepeat(points, false)) {
        problems.push('The ' + name + ' has two points in a row at the same spot.');
      }
    });
  }
  if (total > LIMITS.totalPoints) {
    problems.push('Too many points in all: ' + total + ' (at most ' + LIMITS.totalPoints + ').');
  }
  if (!problems.length) {
    const water = (ground.water || []).map((shape) => closedRing(shape.points));
    (ground.crossings || []).forEach((shape, index) => {
      const ring = closedRing(shape.points);
      if (!water.some((pond) => polygonsOverlap(ring, pond))) {
        problems.push('The ' + label('crossings', shape, index) + ' is over no water.');
      }
    });
  }
  return problems;
}

// A polygon's points without a repeated closing point.
function closedRing(points) {
  const last = points[points.length - 1];
  if (points.length > 1 && last.x === points[0].x && last.y === points[0].y) {
    return points.slice(0, -1);
  }
  return points;
}

function hasRepeat(points, closed) {
  return edges(points, closed).some(([a, b]) => a.x === b.x && a.y === b.y);
}

// ── What's at a point ──────────────────────────────────────────────────────

/**
 * What blocks a point, by the shapes themselves: `{ kind, name }` with kind
 * 'building', 'water' or 'wall' (within half a unit of one), or null on open
 * ground. A point on a building's or water's edge is outside it.
 */
function blockedAt(ground, point) {
  if (!ground) return null;
  const found = (kind, shape, index) => ({ kind, name: label(KINDS_OF[kind], shape, index) });
  for (const [index, shape] of (ground.walls || []).entries()) {
    for (const [a, b] of edges(shape.points, false)) {
      if (distanceToSegment(point, a, b) < 0.5) return found('wall', shape, index);
    }
  }
  for (const [index, shape] of (ground.buildings || []).entries()) {
    if (inside(closedRing(shape.points), point)) return found('building', shape, index);
  }
  const crossed = (ground.crossings || []).some((shape) => inside(closedRing(shape.points), point));
  if (!crossed) {
    for (const [index, shape] of (ground.water || []).entries()) {
      if (inside(closedRing(shape.points), point)) return found('water', shape, index);
    }
  }
  return null;
}

// ── The walking grid ───────────────────────────────────────────────────────

/**
 * The ground as a walking grid: `{ cell, n, blocked }`, `blocked` a
 * Uint8Array of n × n squares (index y * n + x), 1 where blocked. Compiled
 * once per ground object.
 */
function compile(ground) {
  if (ground && compiled.has(ground)) return compiled.get(ground);
  const blocked = new Uint8Array(N * N);
  const grid = { cell: CELL, n: N, blocked };
  if (!ground) return grid;
  const water = new Uint8Array(N * N);
  const crossing = new Uint8Array(N * N);
  for (const shape of ground.buildings || []) fill(closedRing(shape.points), blocked);
  for (const shape of ground.water || []) {
    const ring = closedRing(shape.points);
    fill(ring, water);
    for (const [a, b] of edges(ring, true)) trace(a, b, water);
  }
  for (const shape of ground.crossings || []) fill(closedRing(shape.points), crossing);
  for (let i = 0; i < blocked.length; i++) if (water[i] && !crossing[i]) blocked[i] = 1;
  for (const shape of ground.walls || []) {
    for (const [a, b] of edges(shape.points, false)) trace(a, b, blocked);
  }
  compiled.set(ground, grid);
  return grid;
}

// Marks the squares whose centres are inside a polygon, a row at a time:
// where the row's centre line crosses the edges, filled between pairs.
function fill(ring, marks) {
  const ys = ring.map((p) => p.y);
  const y0 = Math.max(0, Math.floor(Math.min(...ys) / CELL));
  const y1 = Math.min(N - 1, Math.floor(Math.max(...ys) / CELL));
  const sides = edges(ring, true);
  for (let y = y0; y <= y1; y++) {
    const cy = (y + 0.5) * CELL;
    const xs = [];
    for (const [a, b] of sides) {
      if (a.y > cy !== b.y > cy) xs.push(a.x + ((cy - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Squares whose centres lie strictly between the two crossings.
      const from = Math.max(0, Math.floor(xs[k] / CELL - 0.5) + 1);
      const to = Math.min(N - 1, Math.ceil(xs[k + 1] / CELL - 0.5) - 1);
      for (let x = from; x <= to; x++) marks[y * N + x] = 1;
    }
  }
}

// Marks every square a segment passes through.
function trace(a, b, marks) {
  const steps = Math.max(1, Math.ceil((Math.hypot(b.x - a.x, b.y - a.y) / CELL) * 8));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.min(N - 1, Math.floor((a.x + (b.x - a.x) * t) / CELL));
    const y = Math.min(N - 1, Math.floor((a.y + (b.y - a.y) * t) / CELL));
    marks[y * N + x] = 1;
  }
}

// The square a point is in.
function squareAt(point) {
  return {
    x: Math.min(N - 1, Math.max(0, Math.floor(point.x / CELL))),
    y: Math.min(N - 1, Math.max(0, Math.floor(point.y / CELL))),
  };
}

/**
 * The open square a point on open ground walks from: its own, or, when its
 * own is blocked (a door on a building's edge, beside a wall), the nearest
 * open one around it that isn't across a wall. Null when there is none.
 */
function squareFor(ground, point) {
  const grid = compile(ground);
  const own = squareAt(point);
  if (!grid.blocked[own.y * N + own.x]) return own;
  let best = null;
  let bestDistance = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = own.x + dx;
      const y = own.y + dy;
      if (x < 0 || y < 0 || x >= N || y >= N || grid.blocked[y * N + x]) continue;
      const centre = { x: (x + 0.5) * CELL, y: (y + 0.5) * CELL };
      if (acrossAWall(ground, point, centre)) continue;
      const distance = Math.hypot(centre.x - point.x, centre.y - point.y);
      if (distance < bestDistance) {
        best = { x, y };
        bestDistance = distance;
      }
    }
  }
  return best;
}

function acrossAWall(ground, a, b) {
  return (ground.walls || []).some((shape) =>
    edges(shape.points, false).some(([p, q]) => segmentsMeet(a, b, p, q))
  );
}

/**
 * The squares reachable on foot from the given squares: a Uint8Array over the
 * grid, 1 where reached. Steps go 8 ways; a diagonal can't cut the corner of
 * a blocked square.
 */
function reachableSquares(ground, from) {
  const { blocked } = compile(ground);
  const seen = new Uint8Array(N * N);
  const queue = new Int32Array(N * N);
  let head = 0;
  let tail = 0;
  for (const square of from) {
    const i = square.y * N + square.x;
    if (!blocked[i] && !seen[i]) {
      seen[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % N;
    const y = (i - x) / N;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (seen[j] || blocked[j]) continue;
        if (dx && dy && (blocked[y * N + nx] || blocked[ny * N + x])) continue;
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
  }
  return seen;
}

// ── The town's checks ──────────────────────────────────────────────────────

const named = (place) => place.name + ' (' + place.id + ')';

/**
 * What's wrong with a settlement's ground and its places on it, as plain
 * sentences: the shapes' own problems; a place with no door (position); a
 * door inside a building, in water or on a wall; and doors that can't be
 * walked to from a way in. Empty for a town without ground, or when all is
 * well. `ground` checks proposed shapes in place of the settlement's own.
 */
function check(world, settlement, ground = groundOf(settlement)) {
  if (!ground) return [];
  const problems = shapeProblems(ground);
  if (problems.length) return problems;
  const places = town.placesOf(world, settlement.id);
  const doors = [];
  for (const place of places) {
    if (!isPoint(place.position)) {
      problems.push(named(place) + ' has no door (position) in town.');
      continue;
    }
    const blocker = blockedAt(ground, place.position);
    if (blocker) {
      const where = { building: 'inside the', water: 'in the', wall: 'on the' }[blocker.kind];
      problems.push(
        named(place) + '’s door ' + at(place.position) + ' is ' + where + ' ' + blocker.name + '.'
      );
      continue;
    }
    const square = squareFor(ground, place.position);
    if (!square) {
      problems.push(named(place) + '’s door ' + at(place.position) + ' is hemmed in.');
      continue;
    }
    doors.push({ place, square });
  }
  const ways = doors.filter((door) => town.isEntrance(door.place));
  if (!ways.length) {
    if (places.some(town.isEntrance)) {
      problems.push('No way in or out has a door on open ground, so nobody can walk in.');
    }
    return problems;
  }
  const reached = reachableSquares(
    ground,
    ways.map((door) => door.square)
  );
  const stranded = doors.filter((door) => !reached[door.square.y * N + door.square.x]);
  if (stranded.length) {
    problems.push(
      'Can’t be walked to from a way in: ' +
        stranded.map((door) => named(door.place)).join(', ') +
        '.'
    );
  }
  return problems;
}

module.exports = {
  CELL,
  LIMITS,
  KINDS,
  groundOf,
  hasGround,
  shapeProblems,
  blockedAt,
  compile,
  squareFor,
  reachableSquares,
  check,
};
