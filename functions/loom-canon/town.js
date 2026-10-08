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
 * with a layout, the place it stands in (`save.placeId`). A move to any place
 * in town walks there along the links in one go (L-600 / #433), passing only
 * places the traveller may enter (walkTo). Arriving lands at
 * the open entrance that serves the route taken; leaving is only from an
 * entrance that serves the route out. A save with no place in a town that
 * has one (older saves, or a layout added later) stands at its default
 * entrance.
 *
 * Pure helpers over a loaded world (one may have no places), shared by
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

// Places reachable from a town's entrances along its own links.
function reachableFromEntrances(world, places) {
  const ids = new Set(places.map((place) => place.id));
  const seen = new Set(places.filter(isEntrance).map((place) => place.id));
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
  return seen;
}

// The abilities a save's character has (`save.character.abilities`; a bare
// character state carries them itself).
function abilitiesOf(state) {
  return (state && ((state.character && state.character.abilities) || state.abilities)) || [];
}

/** The ability a place requires that the traveller lacks, or null. */
function missingAbility(place, state) {
  const required = place && place.rules && place.rules.requiresAbility;
  return required && !abilitiesOf(state).includes(required) ? required : null;
}

/**
 * Whether a traveller may pass through a place in town: it is open (graded
 * Playable) and they have what it requires.
 */
function passableFor(world, state) {
  return (place) => isPlaceOpen(world, place) && !missingAbility(place, state);
}

// The live places of `from`'s town linked to `place`, by id.
function linked(world, place, locationId) {
  return (place.connections || [])
    .slice()
    .sort()
    .map((id) => (world.places || {})[id])
    .filter((next) => live(next) && next.locationId === locationId);
}

// Breadth-first through the town's links from `from` (or, standing nowhere
// in town, from its ways in). `visit(place, path)` sees each place reached,
// with the walk to it; returning true stops the search. Only places `canPass`
// allows are walked through, though any linked place can be reached. Ties go
// to the lower id, so the same walk is found every time.
function search(world, locationId, from, canPass, visit) {
  const seen = new Set(from ? [from.id] : []);
  const queue = [];
  const reach = (place, path) => {
    if (seen.has(place.id)) return false;
    seen.add(place.id);
    if (visit(place, path)) return true;
    if (canPass(place)) queue.push({ place, path });
    return false;
  };
  if (from) {
    queue.push({ place: from, path: [] });
  } else {
    for (const entrance of entrancesOf(world, locationId)) {
      if (reach(entrance, [entrance])) return;
    }
  }
  while (queue.length) {
    const { place, path } = queue.shift();
    for (const next of linked(world, place, locationId)) {
      if (reach(next, path.concat(next))) return;
    }
  }
}

/**
 * The shortest walk through a town from where a traveller stands (`from`, a
 * place, or null for nowhere in particular) to `to`: the places passed and
 * then `to`, or null if there is none. Places along the way must satisfy
 * `canPass` (passableFor); `to` itself is checked by the caller.
 */
function walkTo(world, from, to, canPass = () => true) {
  let walk = null;
  search(world, to.locationId, from, canPass, (place, path) => {
    if (place.id !== to.id) return false;
    walk = path;
    return true;
  });
  return walk;
}

/**
 * Every place in town a traveller can walk to from `from` in one move,
 * nearest first: through places `canPass` allows, to any place linked to
 * them (closed ones included, so they can be shown as closed).
 */
function reachableFrom(world, locationId, from, canPass) {
  const found = [];
  search(world, locationId, from, canPass, (place) => {
    found.push(place);
    return false;
  });
  return found;
}

/**
 * What is wrong with a settlement's town, for the builders (get_town, and
 * the MCP town tools' warnings): `problems` make the layout invalid (no open
 * entrance, places that can't be reached); `warnings` don't (a world route
 * that no way out serves, so travellers can't leave that way).
 */
function layoutReport(world, settlement) {
  const places = placesOf(world, settlement.id);
  const entrances = places.filter(isEntrance);
  const problems = [];
  const warnings = [];
  if (!places.length) {
    return { valid: false, problems: ['It has no town layout yet.'], warnings };
  }
  if (!entrances.length) {
    problems.push('No place is a way in or out (give one entranceFor).');
  } else if (!entrances.some((place) => isPlaceOpen(world, place))) {
    problems.push(
      'No way in or out is open yet (written up, with a battle map), so nobody can enter.'
    );
  }
  const seen = reachableFromEntrances(world, places);
  const stranded = places.filter((place) => !seen.has(place.id));
  if (entrances.length && stranded.length) {
    problems.push(
      'Not reachable from a way in: ' +
        stranded.map((place) => place.name + ' (' + place.id + ')').join(', ') +
        '.'
    );
  }
  const links = (settlement.geo && settlement.geo.links) || {};
  for (const id of settlement.connections || []) {
    const via = links[id] || null;
    if (entrances.length && !entrances.some((place) => serves(place, via))) {
      const to = world.locations[id];
      warnings.push(
        'No way out serves the ' + (via || 'route') + ' to ' + (to ? to.name : id) + '.'
      );
    }
  }
  return { valid: !problems.length, problems, warnings };
}

/**
 * Whether a settlement has a usable town layout: at least one open entrance,
 * and every place reachable from the entrances. This is the town requirement
 * grading applies to every settlement (grading.LAYER_CHECKS.town).
 */
function hasTownLayout(world, settlement) {
  const places = placesOf(world, settlement.id);
  if (!places.filter(isEntrance).some((place) => isPlaceOpen(world, place))) return false;
  return reachableFromEntrances(world, places).size === places.length;
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
  layoutReport,
  missingAbility,
  passableFor,
  walkTo,
  reachableFrom,
};
