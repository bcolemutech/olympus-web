'use strict';

const {
  gradeLocation,
  gradePlace,
  gradeEntity,
  gradeWorld,
  settlementProgress,
  rank,
} = require('../../../loom-canon/grading');
const { hopsFrom } = require('./views');

// The build work list (planning/the-loom-layered-worlds.md §6; L-323 / #392):
// what to build next in a world, most useful first, each item with its grade
// and what it is missing. A place is open to players once it is Playable, so
// the list grows the world outward from where the game is:
//
//   frontier  closed places players are about to reach: next to an open
//             place, or the starting location (or `near`) itself
//   town      places inside towns that aren't Rich yet (L-343), nearest
//             town first: a town you can reach is worth building out
//   closed    every other closed place
//   enrich    open places that could be Rich (residents, lore)
//   describe  realms and regions to write up (never gated)
//
// Places within a tier come nearest first (travel steps from `near`, or the
// start), then largest, then by name. Grades are computed on every call
// (functions/loom-canon/grading.js), so an edit shows on the next one.

const TIERS = ['frontier', 'town', 'closed', 'enrich', 'describe'];

// Items list their needs by name; each need on a page is explained once.
const HOW_TO = {
  description:
    'Write a description: update_location for a place, update_faction for a realm, ' +
    'update_region for a region. Sending the current text again approves it as written.',
  residents:
    'Add a character who lives there: add_character (with placeId for a place in town). A ' +
    'settlement needs more people the bigger it is (progress shows have and want); anyone ' +
    'living anywhere in its town counts.',
  lore: 'Add lore about it: add_lore.',
  town:
    'Lay out the town: add_place (ways in and out with entranceFor), connect_places; check ' +
    'it with get_town.',
  battleMap: 'Draw its battle map.',
};

const geoOf = (location) => location.geo || {};

// "1 of 2" style counts for a settlement's Rich needs.
function progressOf(world, settlement) {
  const { size, residents, lore } = settlementProgress(world, settlement);
  return {
    size,
    residents: `${residents.have} of ${residents.want}`,
    lore: `${lore.have} of ${lore.want}`,
  };
}
const byTierThenNearest = (a, b) =>
  TIERS.indexOf(a.priority) - TIERS.indexOf(b.priority) ||
  (a.hops ?? Infinity) - (b.hops ?? Infinity) ||
  (b.population || 0) - (a.population || 0) ||
  a.name.localeCompare(b.name);

function workList(world, { kind, grade, need, near, limit, offset }) {
  const start = (world.rules || {}).startingLocationId;
  const usable = (id) => Boolean(id && world.locations[id] && !world.locations[id].retired);
  const origin = usable(near) ? near : usable(start) ? start : null;
  const hops = origin ? hopsFrom(world, origin) : new Map();
  const anchors = new Set([start, near].filter(usable));

  const places = Object.values(world.locations).filter((l) => !l.retired);
  const grades = new Map(places.map((l) => [l.id, gradeLocation(world, l)]));
  const isOpen = (id) => grades.has(id) && rank(grades.get(id).grade) >= rank('playable');

  const items = [];
  for (const place of places) {
    const { grade: placeGrade, checklist } = grades.get(place.id);
    if (placeGrade === 'rich') continue;
    let priority = 'enrich';
    if (!isOpen(place.id)) {
      const nextToOpen = (place.connections || []).some(isOpen);
      priority = anchors.has(place.id) || nextToOpen ? 'frontier' : 'closed';
    }
    const geo = geoOf(place);
    items.push({
      priority,
      type: 'location',
      id: place.id,
      name: place.name,
      kind: geo.kind || 'place',
      grade: placeGrade,
      hops: hops.has(place.id) ? hops.get(place.id) : null,
      ...(geo.kind === 'settlement' ? { population: Math.round(geo.population || 0) } : {}),
      missing: checklist.map((item) => item.need),
      // Counts, so "missing residents" reads as "1 of 2", not "nobody".
      ...(geo.kind === 'settlement' ? { progress: progressOf(world, place) } : {}),
    });
  }
  // Places inside towns (L-343), ordered by their town's distance.
  for (const place of Object.values(world.places || {}).filter((p) => !p.retired)) {
    const settlement = world.locations[place.locationId];
    if (!settlement || settlement.retired) continue;
    const { grade: placeGrade, checklist } = gradePlace(world, place);
    if (placeGrade === 'rich') continue;
    items.push({
      priority: 'town',
      type: 'place',
      id: place.id,
      name: place.name,
      kind: 'place',
      grade: placeGrade,
      hops: hops.has(settlement.id) ? hops.get(settlement.id) : null,
      town: { id: settlement.id, name: settlement.name },
      missing: checklist.map((item) => item.need),
    });
  }
  for (const [type, collection] of [
    ['faction', world.factions],
    ['region', world.regions || {}],
  ]) {
    for (const entity of Object.values(collection).filter((e) => !e.retired)) {
      const { grade: entityGrade, checklist } = gradeEntity(world, type, entity);
      if (entityGrade === 'rich') continue;
      items.push({
        priority: 'describe',
        type,
        id: entity.id,
        name: entity.name,
        kind: type,
        grade: entityGrade,
        missing: checklist.map((item) => item.need),
      });
    }
  }

  const matching = items
    .filter(
      (item) =>
        (!kind || item.kind === kind) &&
        (!grade || item.grade === grade) &&
        (!need || item.missing.includes(need))
    )
    .sort(byTierThenNearest);

  const byTier = Object.fromEntries(TIERS.map((tier) => [tier, 0]));
  for (const item of matching) byTier[item.priority] += 1;
  const page = matching.slice(offset, offset + limit);
  const result = {
    completion: gradeWorld(world).places,
    origin: origin ? { id: origin, name: world.locations[origin].name } : null,
    total: matching.length,
    byTier,
    offset,
    count: page.length,
    items: page,
    howTo: Object.fromEntries(
      [...new Set(page.flatMap((item) => item.missing))].map((n) => [n, HOW_TO[n] || n])
    ),
  };
  if (offset + page.length < matching.length) result.nextOffset = offset + page.length;
  return result;
}

module.exports = { workList, TIERS };
