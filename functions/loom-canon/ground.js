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
 * 8 ways, and a diagonal can't cut the corner of a blocked square. The grid
 * is the town's paths' own (./town-paths.js, L-661), shared with the town
 * view, so the checks walk the ground players walk.
 *
 * Pure helpers over plain objects.
 */

const town = require('./town');
const paths = require('./town-paths');

const SIDE = 1000; // the town square, as town.TOWN_SIDE
const CELL = paths.CELL; // the walking grid's squares, in town units
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

// ── Geometry (shared with the town's paths: ./town-paths.js) ─────────────

const { segmentsMeet, distanceToSegment, inside, edges, closedRing } = paths.geometry;

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
//
// compile, squareFor and reachableSquares are the town's paths' own
// (./town-paths.js, shared with the town view): the checks walk the grid
// players walk.

const { compile, squareFor, reachableSquares } = paths;

// ── The town's checks ──────────────────────────────────────────────────────

const named = (place) => place.name + ' (' + place.id + ')';

// Walks a town's ground from its ways in: `{ problems, walkable }`, the
// problems as `check` reports them and the ids of the places whose doors can
// be walked to from a way in (the ways in among them).
function walk(world, settlement, ground) {
  const problems = shapeProblems(ground);
  if (problems.length) return { problems, walkable: new Set() };
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
    return { problems, walkable: new Set() };
  }
  const reached = reachableSquares(
    ground,
    ways.map((door) => door.square)
  );
  const walkable = new Set();
  const stranded = [];
  for (const door of doors) {
    if (reached[door.square.y * N + door.square.x]) walkable.add(door.place.id);
    else stranded.push(door);
  }
  if (stranded.length) {
    problems.push(
      'Can’t be walked to from a way in: ' +
        stranded.map((door) => named(door.place)).join(', ') +
        '.'
    );
  }
  return { problems, walkable };
}

/**
 * What's wrong with a settlement's ground and its places on it, as plain
 * sentences: the shapes' own problems; a place with no door (position); a
 * door inside a building, in water or on a wall; and doors that can't be
 * walked to from a way in. Empty for a town without ground, or when all is
 * well. `ground` checks proposed shapes in place of the settlement's own.
 */
function check(world, settlement, ground = groundOf(settlement)) {
  if (!ground) return [];
  return walk(world, settlement, ground).problems;
}

/**
 * The ids of a town's places whose doors can be walked to from a way in, on
 * its ground (L-655): the town requirement's reach in a town with ground.
 * Null for a town without ground, which goes by its links.
 */
function walkablePlaces(world, settlement) {
  if (!hasGround(settlement)) return null;
  return walk(world, settlement, groundOf(settlement)).walkable;
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
  walkablePlaces,
};
