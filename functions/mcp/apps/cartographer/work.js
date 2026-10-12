'use strict';

const {
  gradeLocation,
  gradePlace,
  gradeEntity,
  gradeCharacter,
  gradeBattleMap,
  gradeWorld,
  placeWeights,
  settlementProgress,
  rank,
  QUALITY,
} = require('../../../loom-canon/grading');
const maps = require('../../../loom-canon/maps');
const layers = require('../../../loom-canon/layers');
const positions = require('../../../loom-canon/positions');
const ground = require('../../../loom-canon/ground');
const { hopsFrom, usersOf } = require('./views');

// The build work list (planning/the-loom-layered-worlds.md §6, L-323 / #392;
// ordered by score, planning/the-loom-grading.md §4.5, L-692 / #553): what to
// build next in a world, most useful first. A place is open to players once
// it is Playable, so closed places come first, growing the world outward from
// where the game is:
//
//   frontier  closed places players are about to reach: next to an open
//             place, the starting location (or `near`) itself, or a place in
//             an open town
//   closed    every other closed place
//
// Each says what opens it (`missing`: the gate's needs). Then comes the work
// that raises the world's score:
//
//   score     every unmet criterion of what is open (places, places in town,
//             characters, battle maps, realms, regions and the world itself),
//             grouped across entities ("12 settlements: town art · 90 points ·
//             the Cartographer page"), most points first. A piece of work's
//             points are the weight it would add times how near to play its
//             place is (§4.4: 3 for open places and their frontier, 1 within
//             two steps, 0.25 beyond), so work where the game is comes first.
//
// Closed places come nearest first (travel steps from `near`, or the start),
// then largest, then by name. Settlements also say whether their town has
// ground (L-653), and points of interest and places in town their battle map
// (L-352, L-628).
//
// Apart from the list, `unplaced` lists the characters without a valid
// position (L-683): a requirement, not a grade, so publishing refuses the
// world until each has one. Each comes with the default the tools suggest.
//
// Grades are computed on every call (functions/loom-canon/grading.js), so an
// edit shows on the next one.

const TIERS = ['frontier', 'closed', 'score'];
const GROUP_SHOWN = 10;

// Items list their needs by name; each need on a page is explained once.
const HOW_TO = {
  description:
    'Write a description: update_location for a place, update_place for a place in town, ' +
    'update_faction for a realm, update_region for a region, update_character for a ' +
    'character. Sending the current text again approves it as written. Scores ask for ' +
    `${QUALITY.words.place} words for a place, ${QUALITY.words.character} for a character ` +
    `and ${QUALITY.words.realm} for a realm or region.`,
  residents:
    'Add a character who lives there: add_character (with placeId for a place in town). A ' +
    'settlement needs more people the bigger it is (progress shows have and want); anyone ' +
    'living anywhere in its town counts.',
  lore:
    `Add lore about it: add_lore. An entry counts once it has ${QUALITY.words.lore} words; ` +
    'name every place, place in town, realm or person it is about.',
  town:
    'Lay out the town: add_place (ways in and out with entranceFor), connect_places; check ' +
    'it with get_town.',
  battleMap:
    'Give it a battle map: draw one with set_battle_map, or pick a generic one from ' +
    'list_battle_maps, then assign_battle_map. A generic map opens a place; only its own ' +
    'map, with walls, doors or obstacles, counts in full toward its score.',
  ground:
    'Give the town its ground: set_town_ground, with its buildings, water, walls and ' +
    'crossings (bridges and fords) in the town’s 0–1000 square, lined up with its art. ' +
    'Doors (place positions) must be on open ground and walkable from a way in; get_town ' +
    'shows what is wrong.',
  layers:
    'Give its battle map walls, doors and obstacles: set_map_layers (or with the grid, ' +
    'set_battle_map). Check them against the art with view_image.',
  townArt: 'Upload the town’s art on the Cartographer page (its town view).',
  mapArt:
    'Upload its battle map’s art on the Cartographer page, then line the grid up with ' +
    'view_image.',
  features: 'Name the features on its battle map (the bar, the altar): set_battle_map.',
  exits: 'Place its battle map’s exits: set_battle_map.',
  faction: 'Give them a realm: update_character with factionId.',
  people: 'Add notable people: add_character (with factionId for a realm).',
  hook: 'Give the world an opening hook and a tagline: publish_world.',
};

// What a group of entities is called, by kind.
const NOUNS = {
  settlement: ['settlement', 'settlements'],
  poi: ['point of interest', 'points of interest'],
  place: ['place in town', 'places in town'],
  character: ['character', 'characters'],
  battleMap: ['battle map', 'battle maps'],
  faction: ['realm', 'realms'],
  region: ['region', 'regions'],
  world: ['the world', 'the world'],
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
const live = (entity) => Boolean(entity) && !entity.retired;
const round1 = (n) => Math.round(n * 10) / 10;
const isOpenGrade = (grade) => rank(grade) >= rank('playable');

// "1 of 2" style counts for a settlement's people and lore.
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

// The gate's needs: what opens a place.
const gateNeeds = (checklist) =>
  checklist.filter((item) => item.for === 'playable').map((item) => item.need);

function mapInfo(world, entity) {
  const status = maps.kindOf(world, entity) || 'none';
  if (status !== 'own') return { battleMap: status };
  return { battleMap: 'own', layers: layers.hasLayers(maps.mapOf(world, entity)) };
}

// Closed places: on the map, and in towns.
function closedItems(world, grades, hops, anchors) {
  const isOpen = (id) => grades.has(id) && isOpenGrade(grades.get(id).grade);
  const items = [];
  for (const place of Object.values(world.locations).filter(live)) {
    const { grade, band, score, checklist } = grades.get(place.id);
    if (isOpenGrade(grade)) continue;
    const geo = geoOf(place);
    const settled = geo.kind === 'settlement';
    const nextToOpen = (place.connections || []).some(isOpen);
    items.push({
      priority: anchors.has(place.id) || nextToOpen ? 'frontier' : 'closed',
      type: 'location',
      id: place.id,
      name: place.name,
      kind: geo.kind || 'place',
      grade,
      band,
      score,
      hops: hops.has(place.id) ? hops.get(place.id) : null,
      ...(settled ? { population: Math.round(geo.population || 0) } : {}),
      missing: gateNeeds(checklist),
      // Counts, so "missing residents" reads as "1 of 2", not "nobody".
      ...(settled ? { progress: progressOf(world, place) } : {}),
      ...(settled ? { ground: ground.hasGround(place) } : mapInfo(world, place)),
    });
  }
  // Places inside towns (L-343): a closed place in an open town is reachable.
  for (const place of Object.values(world.places || {}).filter(live)) {
    const settlement = world.locations[place.locationId];
    if (!live(settlement)) continue;
    const { grade, band, score, checklist } = gradePlace(world, place);
    if (isOpenGrade(grade)) continue;
    items.push({
      priority: isOpen(settlement.id) ? 'frontier' : 'closed',
      type: 'place',
      id: place.id,
      name: place.name,
      kind: 'place',
      grade,
      band,
      score,
      hops: hops.has(settlement.id) ? hops.get(settlement.id) : null,
      town: { id: settlement.id, name: settlement.name },
      missing: gateNeeds(checklist),
      ...mapInfo(world, place),
    });
  }
  return items;
}

// Everything that can still score, with how near play its place is.
function scorable(world, grades) {
  const weights = placeWeights(world, grades);
  const { far, play } = QUALITY.nearness;
  const weightOf = (locationId) => weights.get(locationId) ?? far;
  const settlementsOf = (test) =>
    Object.values(world.locations).filter(
      (l) => live(l) && geoOf(l).kind === 'settlement' && test(l)
    );
  const most = (ids) => (ids.length ? Math.max(...ids.map(weightOf)) : far);
  const out = [];
  for (const location of Object.values(world.locations).filter(live)) {
    const graded = grades.get(location.id);
    // A closed place scores nothing yet: the gate's work comes first.
    if (!isOpenGrade(graded.grade)) continue;
    out.push({
      type: 'location',
      kind: geoOf(location).kind === 'settlement' ? 'settlement' : 'poi',
      entity: location,
      graded,
      nearness: weightOf(location.id),
    });
  }
  for (const place of Object.values(world.places || {}).filter(live)) {
    if (!live(world.locations[place.locationId])) continue;
    const graded = gradePlace(world, place);
    if (!isOpenGrade(graded.grade)) continue;
    out.push({
      type: 'place',
      kind: 'place',
      entity: place,
      graded,
      nearness: weightOf(place.locationId),
    });
  }
  for (const character of Object.values(world.characters || {}).filter(live)) {
    out.push({
      type: 'character',
      kind: 'character',
      entity: character,
      graded: gradeCharacter(world, character),
      nearness: weightOf(character.locationId),
    });
  }
  for (const map of Object.values(world.battleMaps || {}).filter(live)) {
    const homes = usersOf(world, map.id).map((user) =>
      user.type === 'location' ? user.id : (world.places[user.id] || {}).locationId
    );
    out.push({
      type: 'battleMap',
      kind: 'battleMap',
      entity: map,
      graded: gradeBattleMap(world, map),
      nearness: most(homes),
    });
  }
  for (const faction of Object.values(world.factions || {}).filter(live)) {
    const homes = settlementsOf((l) => (l.factionIds || []).includes(faction.id));
    out.push({
      type: 'faction',
      kind: 'faction',
      entity: faction,
      graded: gradeEntity(world, 'faction', faction),
      nearness: most(homes.map((l) => l.id)),
    });
  }
  for (const region of Object.values(world.regions || {}).filter(live)) {
    const homes = settlementsOf(
      (l) => geoOf(l).regionId === region.id || (region.locationIds || []).includes(l.id)
    );
    out.push({
      type: 'region',
      kind: 'region',
      entity: region,
      graded: gradeEntity(world, 'region', region),
      nearness: most(homes.map((l) => l.id)),
    });
  }
  const summary = gradeWorld(world);
  out.push({
    type: 'world',
    kind: 'world',
    entity: { id: world.id, name: world.name },
    graded: { grade: 'playable', band: summary.band, criteria: summary.criteria },
    nearness: play,
  });
  return out;
}

// The unmet criteria, grouped by criterion (and the work it asks for).
function scoreGroups(world, grades, { kind, grade, band, need }) {
  const groups = new Map();
  for (const { type, kind: entityKind, entity, graded, nearness } of scorable(world, grades)) {
    if (kind && entityKind !== kind) continue;
    if (grade && graded.grade !== grade) continue;
    if (band && graded.band !== band) continue;
    for (const criterion of graded.criteria || []) {
      if (criterion.met) continue;
      if (need && criterion.need !== need && !(need === 'battleMap' && criterion.need === 'layers'))
        continue;
      const missingWeight = criterion.weight * (1 - criterion.progress);
      // The same work with the same tool: realms and regions apart, say.
      const key = `${criterion.id}:${criterion.need}:${criterion.tool}`;
      if (!groups.has(key)) {
        groups.set(key, {
          criterion: criterion.id,
          label: criterion.label,
          need: criterion.need,
          tool: criterion.tool,
          weight: criterion.weight,
          entities: [],
        });
      }
      groups.get(key).entities.push({
        type,
        kind: entityKind,
        id: entity.id,
        name: entity.name,
        band: graded.band,
        points: round1(missingWeight * nearness),
        message: criterion.message,
        ...(criterion.have !== undefined ? { have: criterion.have, want: criterion.want } : {}),
      });
    }
  }
  return [...groups.values()]
    .map((group) => {
      const entities = group.entities.sort(
        (a, b) => b.points - a.points || a.name.localeCompare(b.name)
      );
      const points = round1(entities.reduce((sum, e) => sum + e.points, 0));
      const kinds = [...new Set(entities.map((e) => e.kind))];
      const plural = entities.length === 1 ? 0 : 1;
      const noun =
        kinds.length === 1
          ? NOUNS[kinds[0]][plural]
          : kinds.every((k) => k === 'poi' || k === 'place')
            ? ['place', 'places'][plural]
            : ['entity', 'entities'][plural];
      const count = kinds[0] === 'world' ? '' : `${entities.length} `;
      return {
        priority: 'score',
        type: 'criterion',
        criterion: group.criterion,
        label: group.label,
        need: group.need,
        tool: group.tool,
        weight: group.weight,
        count: entities.length,
        points,
        summary: `${count}${noun}: ${group.label.toLowerCase()} · ${points} points · ${group.tool}`,
        entities: entities.slice(0, GROUP_SHOWN),
        ...(entities.length > GROUP_SHOWN ? { more: entities.length - GROUP_SHOWN } : {}),
      };
    })
    .sort(
      (a, b) => b.points - a.points || b.weight - a.weight || a.criterion.localeCompare(b.criterion)
    );
}

function workList(world, { kind, grade, band, need, near, limit, offset }) {
  const start = (world.rules || {}).startingLocationId;
  const usable = (id) => Boolean(id && world.locations[id] && !world.locations[id].retired);
  const origin = usable(near) ? near : usable(start) ? start : null;
  const hops = origin ? hopsFrom(world, origin) : new Map();
  const anchors = new Set([start, near].filter(usable));

  const grades = new Map(
    Object.values(world.locations)
      .filter(live)
      .map((l) => [l.id, gradeLocation(world, l)])
  );

  const closed = closedItems(world, grades, hops, anchors)
    .filter(
      (item) =>
        (!kind || item.kind === kind) &&
        (!grade || item.grade === grade) &&
        (!band || item.band === band) &&
        (!need ||
          item.missing.includes(need) ||
          (need === 'ground' && item.ground === false) ||
          (need === 'battleMap' && item.battleMap && item.battleMap !== 'own'))
    )
    .sort(byTierThenNearest);
  const matching = closed.concat(scoreGroups(world, grades, { kind, grade, band, need }));

  const byTier = Object.fromEntries(TIERS.map((tier) => [tier, 0]));
  for (const item of matching) byTier[item.priority] += 1;
  const page = matching.slice(offset, offset + limit);
  const summary = gradeWorld(world);
  const result = {
    completion: summary.places,
    world: { score: summary.score, band: summary.band },
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
            .flatMap((item) => (item.priority === 'score' ? [item.need] : item.missing))
            .concat(need ? [need] : [])
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
