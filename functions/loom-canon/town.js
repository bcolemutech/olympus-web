'use strict';

/**
 * The Loom — towns (planning/the-loom-layered-worlds.md §8; L-342 / #396).
 *
 * A settlement can have a town layout: places inside it (a harbour, gates, a
 * market, taverns, temples, districts), linked like the world map is. Places
 * live in the world's `places` collection:
 *
 *   Place
 *     id, locationId (its settlement), name, kind, description, sources
 *     connections: string[]      — places in the same town reachable directly
 *     entrance: { via: [...] }   — set on the ways in and out of town: the
 *                                  world routes it serves ('road', 'trail',
 *                                  'sea'); a harbour serves the sea, a gate the
 *                                  roads and trails. null for the rest.
 *     npcIds: string[], rules: object, position: { x, y }   — town coordinates
 *
 * A save's position is its settlement (`save.location`) and, inside a town
 * with a layout, the place it stands in (`save.placeId`). Arriving lands at
 * the open entrance that serves the route taken; leaving is only from an
 * entrance that serves the route out. A save with no place in a town that
 * has one (older saves, or a layout added later) stands at its default
 * entrance.
 *
 * Pure helpers over a loaded world (static worlds have no places), shared by
 * grading, the rules engine, the narrator, the interpreter and new games.
 */

const { isPlaceOpen } = require('./grading');

const live = (entity) => Boolean(entity) && !entity.retired;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The live places of a settlement's town, in id order. */
function placesOf(world, locationId) {
  return Object.values(world.places || {})
    .filter((place) => place.locationId === locationId && live(place))
    .sort(byId);
}

function isEntrance(place) {
  return Boolean(place && place.entrance);
}

/** Whether an entrance serves a world route of this kind (no list: all of them). */
function serves(place, via) {
  const kinds = place.entrance && place.entrance.via;
  return !Array.isArray(kinds) || !kinds.length || !via || kinds.includes(via);
}

/** A settlement's ways in and out. */
function entrancesOf(world, locationId) {
  return placesOf(world, locationId).filter(isEntrance);
}

/** How two world places are linked: 'road', 'trail', 'sea', or null. */
function routeBetween(world, fromId, toId) {
  const from = world.locations[fromId];
  return (from && from.geo && from.geo.links && from.geo.links[toId]) || null;
}

/**
 * Where a traveller arriving at a settlement by `via` lands: an open entrance
 * serving that route, else any open entrance, else null (no layout, or no
 * way in yet — the settlement is then entered as a whole, as before towns).
 */
function arrivalPlace(world, locationId, via) {
  const open = entrancesOf(world, locationId).filter((place) => isPlaceOpen(world, place));
  return open.find((place) => serves(place, via)) || open[0] || null;
}

/**
 * Where a save stands: its settlement, and its place in town (or null). A
 * recorded place is kept even if retired, so nobody is stranded.
 */
function positionOf(world, save) {
  const location = save.location && world.locations[save.location] ? save.location : null;
  if (!location) return { location: null, place: null };
  const recorded = save.placeId && (world.places || {})[save.placeId];
  if (recorded && recorded.locationId === location) return { location, place: recorded };
  const entrances = entrancesOf(world, location);
  const fallback = entrances.find((place) => isPlaceOpen(world, place)) || entrances[0] || null;
  return { location, place: fallback };
}

/**
 * Whether a settlement has a usable town layout: at least one open entrance,
 * and every place reachable from the entrances. This is the town requirement
 * grading applies once it is switched on (grading.LAYER_CHECKS.town).
 */
function hasTownLayout(world, settlement) {
  const places = placesOf(world, settlement.id);
  const entrances = places.filter(isEntrance);
  if (!entrances.some((place) => isPlaceOpen(world, place))) return false;
  const ids = new Set(places.map((place) => place.id));
  const seen = new Set(entrances.map((place) => place.id));
  const queue = [...seen];
  while (queue.length) {
    const place = world.places[queue.shift()];
    for (const next of place.connections || []) {
      if (ids.has(next) && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size === ids.size;
}

module.exports = {
  placesOf,
  entrancesOf,
  isEntrance,
  serves,
  routeBetween,
  arrivalPlace,
  positionOf,
  hasTownLayout,
};
