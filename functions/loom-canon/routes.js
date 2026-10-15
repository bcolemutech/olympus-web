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

/**
 * The miles along the route between two places (location objects, or their
 * ids in `world`), or null when either has no position: no length rather
 * than a wrong one.
 */
function routeMiles(world, from, to) {
  const pick = (l) => (typeof l === 'string' ? ((world && world.locations) || {})[l] : l);
  const a = located(pick(from));
  const b = located(pick(to));
  if (!a || !b) return null;
  return Math.hypot(b.x - a.x, b.y - a.y) * milesPerMapUnit(world) * WINDING;
}

/** Miles for people to read: tenths under 10, whole miles from there. */
function roundMiles(miles) {
  if (typeof miles !== 'number') return null;
  return miles < 10 ? Math.round(miles * 10) / 10 : Math.round(miles);
}

module.exports = {
  WINDING,
  DEFAULT_MILES_PER_MAP_UNIT,
  UNIT_MILES,
  milesPerMapUnit,
  routeMiles,
  roundMiles,
};
