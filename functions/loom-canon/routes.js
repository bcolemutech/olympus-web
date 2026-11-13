'use strict';

/**
 * Route lengths (planning/the-loom-game-time.md §4.2, T6; L-372 / #500): how
 * many miles a world route is, from the map alone. A link stores only its
 * kind (`geo.links[otherId] = 'road' | 'trail' | 'sea'`); its length is the
 * straight line between the two places' `geo.x`, `geo.y` × the map's scale
 * × 1.25 for winding. It is worked out when read, never stored, so moving a
 * place or rescaling a map changes it at once. Nothing sets it by hand: the
 * map decides.
 *
 * A route can bend (L-715; planning/worlds-without-azgaar.md §4.5, PL4): its
 * `waypoints`, points in the map's units, make the line it follows, and its
 * length is that line's length × the scale, with no winding (the line is the
 * winding). It can carry rules (PL7), read as a place's are: `requiresAbility`
 * (an ability a traveller needs to take it) and `hostileToFactionId`. Both are
 * stored on each end of the link, `geo.routes[otherId] = { waypoints?, rules? }`
 * (waypoints from that place to the other), or on a map place's link
 * `{ placeId, kind, waypoints?, rules? }`; ./frames.js reads both as the first.
 *
 * The scale is `world.map.distance: { unit, perMapUnit }`, from Azgaar
 * (Nisia: 2 mi per map unit), turned into miles. A world without one, or
 * with a unit that isn't a known length, takes the default:
 * Azgaar's own, 3 mi per map unit.
 *
 * Shared by the Loom (travel time, L-373) and the Cartographer (get_location).
 * Pure: no Firestore.
 */

const WINDING = 1.25;
const DEFAULT_MILES_PER_MAP_UNIT = 3;

// Azgaar's distance units, in miles.
const UNIT_MILES = Object.freeze({
  mi: 1,
  km: 0.621371,
  m: 0.000621371,
  lg: 3, // league
  vr: 0.662879, // versta, 1.0668 km
  nmi: 1.15078, // nautical mile
  nlg: 3.45234, // nautical league
});

/** Miles per map unit for a world: its map's scale, or the default. */
function milesPerMapUnit(world) {
  const distance = world && world.map && world.map.distance;
  if (!distance) return DEFAULT_MILES_PER_MAP_UNIT;
  const perUnit = distance.perMapUnit;
  const miles = UNIT_MILES[String(distance.unit || '').toLowerCase()];
  if (!(typeof perUnit === 'number' && perUnit > 0) || !miles) return DEFAULT_MILES_PER_MAP_UNIT;
  return perUnit * miles;
}

const located = (location) => {
  const geo = (location && location.geo) || {};
  return Number.isFinite(geo.x) && Number.isFinite(geo.y) ? geo : null;
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPair = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
// A waypoint is stored as { x, y } (Firestore holds no array in an array) and
// read, given and sent as [x, y]; either is read.
const isPoint = (p) => isPair(p) || (isObject(p) && Number.isFinite(p.x) && Number.isFinite(p.y));
const asPair = (p) => (isPair(p) ? [p[0], p[1]] : [p.x, p.y]);
const asStored = (p) => ({ x: p[0], y: p[1] });

/** Waypoints as [x, y] pairs, whichever way they are held. */
const pairsOf = (list) => (Array.isArray(list) ? list.filter(isPoint).map(asPair) : []);

// The most points a route's line may have.
const MAX_WAYPOINTS = 40;
// The most characters of an ability a route may require.
const MAX_ABILITY = 60;

/** The length of the line through some points. */
function lineLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return sum;
}

const reversed = (points) => points.slice().reverse();

/**
 * Waypoints given as [x, y] or { x, y }, checked: at most MAX_WAYPOINTS, each a
 * finite point, and, given `bounds` ({ width, height } in the map's units),
 * inside the map. `{ points: [{ x, y }…], errors: [text] }`, the points as
 * they are stored.
 */
function checkWaypoints(list, bounds) {
  const errors = [];
  if (!Array.isArray(list)) return { points: [], errors: ['Waypoints are a list of points.'] };
  if (list.length > MAX_WAYPOINTS) {
    errors.push(`A route has at most ${MAX_WAYPOINTS} waypoints (it has ${list.length}).`);
  }
  const points = [];
  list.forEach((raw, i) => {
    if (!isPoint(raw)) {
      errors.push(`Waypoint ${i + 1} is not a point: give [x, y].`);
      return;
    }
    const point = asPair(raw);
    if (
      bounds &&
      (point[0] < 0 || point[1] < 0 || point[0] > bounds.width || point[1] > bounds.height)
    ) {
      errors.push(
        `Waypoint ${i + 1} (${point[0]}, ${point[1]}) is off the map (0–${bounds.width}, 0–${bounds.height}).`
      );
      return;
    }
    points.push(asStored(point));
  });
  return { points, errors };
}

const place = (world, l) => (typeof l === 'string' ? ((world && world.locations) || {})[l] : l);

/**
 * What the link between two places holds, as seen from `from`: `{ waypoints?,
 * rules? }`. Read from `from`'s end, else from the other's with its waypoints
 * turned round, so a link stored on one end only still works both ways.
 */
function extrasOf(world, from, to) {
  const a = place(world, from);
  const b = place(world, to);
  const mine = a && a.geo && isObject(a.geo.routes) ? a.geo.routes[b && b.id] : null;
  if (isObject(mine)) return mine;
  const theirs = b && b.geo && isObject(b.geo.routes) ? b.geo.routes[a && a.id] : null;
  if (!isObject(theirs)) return {};
  return {
    ...theirs,
    ...(Array.isArray(theirs.waypoints) ? { waypoints: reversed(theirs.waypoints) } : {}),
  };
}

/** The waypoints of the route from one place to another, [] when it runs straight. */
function waypointsOf(world, from, to) {
  return pairsOf(extrasOf(world, from, to).waypoints);
}

/**
 * The line a route follows from one place to another: the two ends with the
 * waypoints between, in the map's units, or null when either has no position.
 */
function pathOf(world, from, to) {
  const a = located(place(world, from));
  const b = located(place(world, to));
  if (!a || !b) return null;
  return [[a.x, a.y], ...waypointsOf(world, from, to), [b.x, b.y]];
}

/** A route's rules as stored: { requiresAbility?, hostileToFactionId? }. */
function rulesOf(world, from, to) {
  const rules = extrasOf(world, from, to).rules;
  return isObject(rules) ? rules : {};
}

/**
 * The ability the route from `fromId` to `toId` requires that the traveller
 * lacks, or null (the same test as a place's: ./town.js missingAbility).
 * `state` is the save or character state.
 */
function missingAbility(world, fromId, toId, state) {
  const required = rulesOf(world, fromId, toId).requiresAbility;
  if (!required) return null;
  return require('./sheets').traitsOf(state).includes(required) ? null : required;
}

/**
 * The extras a link holds once `change` is applied to `had`: `waypoints` set
 * ([] clears them), `rules` merged key by key (null removes one). Returns
 * `{ waypoints?, rules? }`, or null when nothing is left.
 */
function applyExtras(had, change) {
  const out = {};
  const waypoints = change.waypoints !== undefined ? change.waypoints : (had || {}).waypoints;
  if (Array.isArray(waypoints) && waypoints.length) out.waypoints = waypoints;
  const rules = { ...((had || {}).rules || {}) };
  for (const [key, value] of Object.entries(change.rules || {})) {
    if (value === undefined) continue;
    if (value === null) delete rules[key];
    else rules[key] = value;
  }
  if (Object.keys(rules).length) out.rules = rules;
  return Object.keys(out).length ? out : null;
}

/**
 * The miles along the route between two places (location objects, or their
 * ids in `world`), or null when either has no position: no length rather
 * than a wrong one. A route with waypoints is the length of its line; one
 * without, the straight line wound by WINDING.
 */
function routeMiles(world, from, to) {
  const a = located(place(world, from));
  const b = located(place(world, to));
  if (!a || !b) return null;
  const own = ownUnit(world);
  const waypoints = waypointsOf(world, from, to);
  if (waypoints.length) {
    const line = lineLength([[a.x, a.y], ...waypoints, [b.x, b.y]]);
    return line * (own || milesPerMapUnit(world));
  }
  const straight = Math.hypot(b.x - a.x, b.y - a.y);
  // A region map measured in its own unit, not a length on the ground
  // (light-years, AU; planning/map-levels.md TV1; L-903): the straight line
  // in that unit, which route speeds are then given in.
  if (own) return straight * own;
  return straight * milesPerMapUnit(world) * WINDING;
}

/**
 * A region map's own unit (L-903), when it isn't a length these routes turn
 * into miles: its size per map unit, or null. Set by ./frames.js for a map
 * below the top (`distance.own`).
 */
function ownUnit(world) {
  const distance = world && world.map && world.map.distance;
  if (!distance || !distance.own) return null;
  if (UNIT_MILES[String(distance.unit || '').toLowerCase()]) return null;
  return typeof distance.perMapUnit === 'number' && distance.perMapUnit > 0
    ? distance.perMapUnit
    : 1;
}

/** Miles for people to read: tenths under 10, whole miles from there. */
function roundMiles(miles) {
  if (typeof miles !== 'number') return null;
  return miles < 10 ? Math.round(miles * 10) / 10 : Math.round(miles);
}

module.exports = {
  WINDING,
  MAX_WAYPOINTS,
  MAX_ABILITY,
  lineLength,
  checkWaypoints,
  extrasOf,
  waypointsOf,
  pairsOf,
  pathOf,
  rulesOf,
  missingAbility,
  applyExtras,
  ownUnit,
  DEFAULT_MILES_PER_MAP_UNIT,
  UNIT_MILES,
  milesPerMapUnit,
  routeMiles,
  roundMiles,
};
