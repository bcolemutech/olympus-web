'use strict';

const {
  gradeLocation,
  gradePlace,
  gradeEntity,
  gradeWorld,
  settlementProgress,
  rank,
} = require('../../../loom-canon/grading');
const maps = require('../../../loom-canon/maps');
const layers = require('../../../loom-canon/layers');
const positions = require('../../../loom-canon/positions');
const ground = require('../../../loom-canon/ground');
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
// Settlements also say whether their town has ground (`ground`, L-653), and
// `need: 'ground'` lists those without; ground is not graded (yet: L-655).
//
//
// Apart from the tiers, `unplaced` lists the characters without a valid
// position (L-683): a requirement, not a grade, so publishing refuses the
// world until each has one. Each comes with the default the tools suggest.
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
  battleMap:
    'Give it a battle map: draw one with set_battle_map, or pick a generic one from ' +
    'list_battle_maps, then assign_battle_map. A generic map opens a place; only its own ' +
    'map, with walls, doors or obstacles, can make it Rich.',
  ground:
    'Give the town its ground: set_town_ground, with its buildings, water, walls and ' +
    'crossings (bridges and fords) in the town’s 0–1000 square, lined up with its art. ' +
    'Doors (place positions) must be on open ground and walkable from a way in; get_town ' +
    'shows what is wrong.',
  layers:
    'Give its battle map walls, doors and obstacles: set_map_layers (or with the grid, ' +
    'set_battle_map). Check them against the art with view_image.',
};

const UNPLACED_SHOWN = 20;

// The characters still to place (L-683), each with a suggested position.
function unplacedOf(world) {
  const unplaced = positions.unplacedCharacters(world);
  if (!unplaced.length) return null;
  return {
    total: unplaced.length,
    characters: unplaced.slice(0, UNPLACED_SHOWN).map(({ character, problem }) => {
      const bare = { ...character };
      for (const field of positions.FIELDS) delete bare[field];
      const suggested = positions.defaultPosition(world, bare);
      return {
        id: character.id,
        name: character.name,
        problem,
        ...(suggested && Object.keys(suggested).length ? { suggested } : {}),
      };
    }),
    howTo:
      'Give each a position with update_character: cell, townPoint or worldPoint, as the ' +
      'problem says (suggested is a default that fits). Publishing refuses the world until ' +
      'everyone has one.',
  };
}

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

  // Battle maps (L-352): every point of interest and place in town says
  // whether it has a map ('own', 'generic' or 'none'), and an own map whether
  // it has walls, doors or obstacles (`layers`, L-628). The requirement is on
  // (L-622): no map is Unbuilt, a generic one or an own one without layers
  // short of Rich. `need: 'battleMap'` lists every one not finished: no own
  // map, or one without layers.
  const forMaps = need === 'battleMap';
  // Town ground (L-653): every settlement says whether its town has ground;
  // `need: 'ground'` lists every one without, Rich or not.
  const forGround = need === 'ground';
  const mapStatus = (entity) => maps.kindOf(world, entity) || 'none';
  const unlayered = (entity) =>
    mapStatus(entity) === 'own' && !layers.hasLayers(maps.mapOf(world, entity));
  const mapInfo = (entity) =>
    mapStatus(entity) === 'own'
      ? { battleMap: 'own', layers: !unlayered(entity) }
      : { battleMap: mapStatus(entity) };
  // Rich places leave the list, except from `need: 'battleMap'` while they
  // lack their own map (an own map without layers is never Rich).
  const skip = (grade, entity) =>
    grade === 'rich' && !(forMaps && entity && mapStatus(entity) !== 'own');

  const items = [];
  for (const place of places) {
    const { grade: placeGrade, checklist } = grades.get(place.id);
    const settled = geoOf(place).kind === 'settlement';
    const mapped = settled ? null : place;
    const grounded = settled && ground.hasGround(place);
    if (skip(placeGrade, mapped) && !(forGround && settled && !grounded)) continue;
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
      ...(mapped ? mapInfo(place) : {}),
      ...(settled ? { ground: grounded } : {}),
    });
  }
  // Places inside towns (L-343), ordered by their town's distance.
  for (const place of Object.values(world.places || {}).filter((p) => !p.retired)) {
    const settlement = world.locations[place.locationId];
    if (!settlement || settlement.retired) continue;
    const { grade: placeGrade, checklist } = gradePlace(world, place);
    if (skip(placeGrade, place)) continue;
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
      ...mapInfo(place),
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
        (!need ||
          item.missing.includes(need) ||
          (forMaps && item.battleMap && (item.battleMap !== 'own' || item.layers === false)) ||
          (forGround && item.ground === false))
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
      [
        ...new Set(
          page
            .flatMap((item) => item.missing)
            .concat(forMaps ? ['battleMap'] : [], forGround ? ['ground'] : [])
        ),
      ].map((n) => [n, HOW_TO[n] || n])
    ),
  };
  if (offset + page.length < matching.length) result.nextOffset = offset + page.length;
  const unplaced = unplacedOf(world);
  if (unplaced) result.unplaced = unplaced;
  return result;
}

module.exports = { workList, TIERS };
