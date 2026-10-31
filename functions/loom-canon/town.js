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
 *     entrance: { via: [...], to?: [...] }
 *                                — set on the ways in and out of town: the
 *                                  world routes it serves ('road', 'trail',
 *                                  'sea'); a harbour serves the sea, a gate the
 *                                  roads and trails. `to` (L-395): the world
 *                                  places it serves them to and from, only
 *                                  those; others use any way serving the
 *                                  route. null for the rest.
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
 * A town's 0–1000 square has a real size (planning/the-loom-movement-and-
 * vision.md §7; L-651 / #463): `settlement.town.size`, in metres across, set
 * by Claude, or by default from the settlement's size as the Rich bar sizes
 * it (grading.js sizeTier: a capital one size larger): a village 300 m, a
 * town 600 m, a city 1.2 km, a great city 2.5 km. townMetres turns a distance
 * between two town points into metres.
 *
 * Pure helpers over a loaded world (one may have no places), shared by
 * grading, the rules engine, the narrator, the interpreter and new games.
 */

const { isPlaceOpen, sizeTier } = require('./grading');

// A town's width in metres, by the settlement's size (L-651).
const TOWN_SIZES = Object.freeze({
  village: 300,
  town: 600,
  city: 1200,
  'great city': 2500,
});
const TOWN_SIDE = 1000; // the town square's units, as places' positions use them
const MIN_TOWN_SIZE = 50;
const MAX_TOWN_SIZE = 20000;

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

/**
 * Whether an entrance serves a world route of this kind (no list: all of
 * them), to or from `otherId`, the world place at its far end (L-395): an
 * entrance with destinations (`to`) serves only them. Without `otherId`, any.
 */
function serves(place, via, otherId = null) {
  const kinds = place.entrance && place.entrance.via;
  if (!(!Array.isArray(kinds) || !kinds.length || !via || kinds.includes(via))) return false;
  const to = place.entrance && place.entrance.to;
  return !otherId || !Array.isArray(to) || !to.length || to.includes(otherId);
}

/** Whether an entrance is set aside for `otherId` (L-395): it names it among its destinations. */
function servesOnly(place, otherId) {
  const to = place && place.entrance && place.entrance.to;
  return Boolean(otherId) && Array.isArray(to) && to.includes(otherId);
}

/**
 * Of `ways`, those serving `via` to or from `otherId` (L-395): the ones set
 * aside for it, if any; else the rest that serve the route.
 */
function waysFor(ways, via, otherId = null) {
  const serving = ways.filter((place) => serves(place, via, otherId));
  const own = serving.filter((place) => servesOnly(place, otherId));
  return own.length ? own : serving;
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
 * Coming from `fromId` (a world place), the most direct of them (L-381;
 * journeys JA4): the one whose position in town lies nearest the bearing to
 * where the traveller came from on the world map.
 */
function arrivalPlace(world, locationId, via, fromId = null) {
  const open = entrancesOf(world, locationId).filter((place) => isPlaceOpen(world, place));
  // One set aside for where they came from first (L-395).
  const serving = waysFor(open, via, fromId);
  const ways = serving.length ? serving : open;
  return facing(world, locationId, fromId, ways) || ways[0] || null;
}

// Of `ways`, the one facing a world place (L-381): the smallest angle
// between its position from the town's middle and the bearing from the
// settlement to that place; null when either isn't placed. Ties go to the
// first, in id order.
function facing(world, locationId, fromId, ways) {
  const here = world.locations[locationId];
  const there = fromId && world.locations[fromId];
  const geo = (l) => l && l.geo && Number.isFinite(l.geo.x) && Number.isFinite(l.geo.y);
  if (!geo(here) || !geo(there)) return null;
  const bearing = Math.atan2(there.geo.y - here.geo.y, there.geo.x - here.geo.x);
  const middle = TOWN_SIDE / 2;
  let best = null;
  for (const way of ways) {
    const p = way.position;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x === middle && p.y === middle) continue;
    const angle = Math.atan2(p.y - middle, p.x - middle);
    const off = Math.abs(Math.atan2(Math.sin(angle - bearing), Math.cos(angle - bearing)));
    if (!best || off < best.off - 1e-9) best = { way, off };
  }
  return best ? best.way : null;
}

/**
 * Whether a save knows a way in or out of a settlement (L-381; journeys
 * JA4): one it arrived by, stood in or crossed by (`save.waysKnown`, by
 * settlement), or every one where it knew the town before L-381 ('all'). A
 * save from before L-381 knows them all. (Sighting a way's door finds it too:
 * ../loom-turn/town-found.js.)
 */
function knowsWay(save, locationId, placeId) {
  const known = save && save.waysKnown;
  if (!known || typeof known !== 'object') return true;
  const here = known[locationId];
  return here === 'all' || (Array.isArray(here) && here.includes(placeId));
}

/**
 * Where a save stands: its settlement, and its place in town (or null). A
 * recorded place is kept even if retired, so nobody is stranded. On the
 * street of a town with ground (L-662), it is at a point, in no place:
 * `{ location, place: null, point }`.
 */
function positionOf(world, save) {
  const location = save.location && world.locations[save.location] ? save.location : null;
  if (!location) return { location: null, place: null };
  const recorded = save.placeId && (world.places || {})[save.placeId];
  if (recorded && recorded.locationId === location) return { location, place: recorded };
  const point = save.townPoint;
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    return { location, place: null, point: { x: point.x, y: point.y } };
  }
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

// What a save's character can do: its sheet's traits, or an older
// character's abilities (CS4; L-811, ./sheets.js).
const abilitiesOf = (state) => require('./sheets').traitsOf(state);

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
 * that no way out serves, so travellers can't leave that way). In a town with
 * ground (L-655) the problems are its ground's (ground.js check: doors off
 * open ground, places that can't be walked to); its links aren't used
 * (L-665).
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
  const strandedBy = (seen) => places.filter((place) => !seen.has(place.id));
  const list = (stranded) =>
    stranded.map((place) => place.name + ' (' + place.id + ')').join(', ') + '.';
  if (ground().hasGround(settlement)) {
    // A town with ground (L-655) is walked from its ways in: its streets,
    // not its links, decide what can be reached.
    // Its links aren't used (L-665): players walk its streets.
    if (entrances.length) problems.push(...ground().check(world, settlement));
  } else {
    const stranded = strandedBy(reachableFromEntrances(world, places));
    if (entrances.length && stranded.length) {
      problems.push('Not reachable from a way in: ' + list(stranded));
    }
  }
  const links = (settlement.geo && settlement.geo.links) || {};
  for (const id of settlement.connections || []) {
    const via = links[id] || null;
    if (entrances.length && !entrances.some((place) => serves(place, via, id))) {
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
 * and every place reachable from the entrances: along its links, or, in a
 * town with ground (L-655), on foot from the ways in's doors (ground.js). This
 * is the town requirement grading applies to every settlement
 * (grading.LAYER_CHECKS.town).
 */
function hasTownLayout(world, settlement) {
  const places = placesOf(world, settlement.id);
  if (!places.filter(isEntrance).some((place) => isPlaceOpen(world, place))) return false;
  const walkable = ground().walkablePlaces(world, settlement);
  const reached = walkable || reachableFromEntrances(world, places);
  return places.every((place) => reached.has(place.id));
}

// Required lazily: ./ground.js reads this module's helpers.
const ground = () => require('./ground');

/**
 * A town's size in metres across (L-651): `{ metres, set }`, `set` when Claude
 * gave it (settlement.town.size), else the default for the settlement's size.
 */
function townSize(settlement) {
  const given = settlement && settlement.town && settlement.town.size;
  if (Number.isFinite(given) && given > 0) return { metres: given, set: true };
  return { metres: TOWN_SIZES[sizeTier(settlement || {}).name], set: false };
}

/** Metres between two points in a settlement's town square (L-651). */
function townMetres(settlement, a, b) {
  const units = Math.hypot(b.x - a.x, b.y - a.y);
  return (units * townSize(settlement).metres) / TOWN_SIDE;
}

module.exports = {
  servesOnly,
  waysFor,
  TOWN_SIZES,
  TOWN_SIDE,
  MIN_TOWN_SIZE,
  MAX_TOWN_SIZE,
  townSize,
  townMetres,
  placesOf,
  entrancesOf,
  isEntrance,
  serves,
  routeBetween,
  arrivalPlace,
  knowsWay,
  positionOf,
  hasTownLayout,
  layoutReport,
  missingAbility,
  passableFor,
  walkTo,
  reachableFrom,
};
