'use strict';

// Pure views over a loaded world (the CanonWorld shape from functions/
// loom-canon, as imported by the Cartographer), sized for a conversation:
// rows carry ids for follow-up calls plus the names a reader needs, long lists
// are paged or capped, and nothing here mutates the (frozen) world.

const {
  gradeLocation,
  gradeEntity,
  gradeWorld,
  isPlayable,
} = require('../../../loom-canon/grading');

const LIST_CAP = 200;
const TOP_SETTLEMENTS = 10;
const COMPASS = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
];

const iso = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString() : null);

function fold(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function ref(collection, id, label = 'name') {
  if (!id) return null;
  const entity = collection[id];
  return { id, [label]: entity ? entity[label] : null };
}

const geoOf = (location) => location.geo || {};
const kindOf = (location) => geoOf(location).kind || 'place';
const populationOf = (location) => Math.round(geoOf(location).population || 0);

function hasPosition(location) {
  const { x, y } = geoOf(location);
  return typeof x === 'number' && typeof y === 'number';
}

// Straight-line distance in map units and the compass direction from a to b
// (map y grows downward, so north is -y).
function bearing(a, b) {
  if (!hasPosition(a) || !hasPosition(b)) return { distance: null, direction: null };
  const dx = b.geo.x - a.geo.x;
  const dy = a.geo.y - b.geo.y;
  const distance = Math.round(Math.hypot(dx, dy));
  if (distance === 0) return { distance: 0, direction: null };
  const degrees = (Math.atan2(dx, dy) * 180) / Math.PI;
  return { distance, direction: COMPASS[Math.round((degrees + 360) / 45) % 8] };
}

// Connection steps from `fromId` to every reachable location.
function hopsFrom(world, fromId) {
  const hops = new Map([[fromId, 0]]);
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    for (const next of world.locations[id].connections || []) {
      if (!hops.has(next) && world.locations[next]) {
        hops.set(next, hops.get(id) + 1);
        queue.push(next);
      }
    }
  }
  return hops;
}

function capped(items, cap = LIST_CAP) {
  return items.length > cap
    ? { items: items.slice(0, cap), note: `Showing ${cap} of ${items.length}.` }
    : { items, note: null };
}

function loreAbout(world, entityId) {
  return Object.values(world.lore || {})
    .filter((entry) => !entry.retired && (entry.entityRefs || []).includes(entityId))
    .map((entry) => ({ id: entry.id, title: entry.title, text: entry.text }));
}

function charactersAt(world, location) {
  const ids = new Set(location.npcIds || []);
  for (const character of Object.values(world.characters || {})) {
    if (character.locationId === location.id && !character.retired) ids.add(character.id);
  }
  return [...ids].map((id) => ref(world.characters, id));
}

const byPopulationThenName = (a, b) =>
  populationOf(b) - populationOf(a) || a.name.localeCompare(b.name);

// A grade and what it is missing (functions/loom-canon/grading.js).
const graded = ({ grade, checklist }) => ({ grade, missing: checklist });

// ── Rows ───────────────────────────────────────────────────────────────

// `within` drops the region or realm a list is already scoped to.
function locationRow(world, location, within = {}) {
  const geo = geoOf(location);
  const row = { id: location.id, name: location.name, kind: kindOf(location) };
  if (geo.kind === 'settlement') row.population = populationOf(location);
  if (geo.capital) row.capital = true;
  if (geo.port) row.port = true;
  if (geo.markerType) row.markerType = geo.markerType;
  const region = geo.regionId && world.regions[geo.regionId];
  if (region && !within.region) row.region = region.name;
  const faction = world.factions[(location.factionIds || [])[0]];
  if (faction && !within.realm) row.realm = faction.name;
  row.grade = gradeLocation(world, location).grade;
  if (location.retired) row.retired = true;
  return row;
}

function worldRow(meta) {
  const row = {
    id: meta.id,
    name: meta.name,
    tagline: meta.tagline || '',
    status: meta.status,
    canonVersion: meta.canonVersion,
    counts: meta.counts || {},
    createdAt: iso(meta.createdAtMs),
    updatedAt: iso(meta.updatedAtMs),
  };
  if (meta.publishedAtMs) row.publishedAt = iso(meta.publishedAtMs);
  if (meta.status === 'failed' && meta.error) row.error = meta.error;
  return row;
}

// ── Tool results ───────────────────────────────────────────────────────

function worldOverview(meta, world) {
  const locations = Object.values(world.locations);
  const live = (items) => items.filter((item) => !item.retired);
  const settlementsIn = new Map();
  for (const location of locations) {
    if (kindOf(location) !== 'settlement' || location.retired) continue;
    for (const id of location.factionIds || []) {
      settlementsIn.set(id, (settlementsIn.get(id) || 0) + 1);
    }
  }
  const regions = Object.values(world.regions || {});
  const regionRow = (region) => ({ id: region.id, name: region.name });

  const factions = Object.values(world.factions)
    .map((faction) => ({
      id: faction.id,
      name: faction.name,
      form: (faction.politics || {}).formName || null,
      capital: ref(world.locations, (faction.politics || {}).capitalLocationId),
      settlements: settlementsIn.get(faction.id) || 0,
      regions: regions.filter((r) => r.factionId === faction.id).map(regionRow),
      ...(faction.retired ? { retired: true } : {}),
    }))
    .sort((a, b) => b.settlements - a.settlements || a.name.localeCompare(b.name));

  const characters = capped(
    Object.values(world.characters || {}).map((c) => ({
      id: c.id,
      name: c.name,
      location: c.locationId ? ref(world.locations, c.locationId).name : null,
      ...(c.retired ? { retired: true } : {}),
    }))
  );
  const lore = capped(
    Object.values(world.lore || {}).map((entry) => ({
      id: entry.id,
      title: entry.title,
      ...(entry.retired ? { retired: true } : {}),
    }))
  );

  const start = (world.rules || {}).startingLocationId;
  const missing = [];
  if (!world.openingHook) missing.push('an opening hook');
  if (!start || !world.locations[start] || world.locations[start].retired) {
    missing.push('a starting location');
  } else if (!isPlayable(world, world.locations[start])) {
    missing.push('a starting location players can enter (write it up first)');
  }

  const map = world.map || {};
  const result = {
    id: world.id,
    name: world.name,
    tagline: world.tagline || '',
    openingHook: world.openingHook || '',
    status: world.status,
    canonVersion: world.canonVersion,
    startingLocation: start ? ref(world.locations, start) : null,
    readyToPublish: missing.length === 0,
    ...(missing.length ? { missing } : {}),
    map: {
      width: map.width || null,
      height: map.height || null,
      hasImage: Boolean(map.imagePath),
      ...(map.distance ? { distance: map.distance } : {}),
    },
    source: meta.source
      ? { mapName: meta.source.mapName || null, azgaarVersion: meta.source.version || null }
      : null,
    completion: gradeWorld(world),
    counts: {
      settlements: live(locations.filter((l) => kindOf(l) === 'settlement')).length,
      pointsOfInterest: live(locations.filter((l) => kindOf(l) === 'poi')).length,
      factions: live(Object.values(world.factions)).length,
      regions: regions.length,
      characters: live(Object.values(world.characters || {})).length,
      lore: live(Object.values(world.lore || {})).length,
      retired: [world.locations, world.factions, world.characters || {}, world.lore || {}]
        .map((c) => Object.values(c).filter((e) => e.retired).length)
        .reduce((a, b) => a + b, 0),
    },
    factions,
    otherRegions: regions
      .filter((r) => !r.factionId || !world.factions[r.factionId])
      .map(regionRow),
    characters: characters.items,
    lore: lore.items,
    createdAt: iso(meta.createdAtMs),
    updatedAt: iso(meta.updatedAtMs),
  };
  if (meta.publishedAtMs) result.publishedAt = iso(meta.publishedAtMs);
  if (characters.note) result.charactersNote = characters.note;
  if (lore.note) result.loreNote = lore.note;
  if ((meta.warnings || []).length) result.importWarnings = meta.warnings;
  return result;
}

function findLocations(world, query) {
  const { name, regionId, factionId, near, kind, grade, includeRetired = false } = query;
  const { limit, offset } = query;
  const origin = near ? world.locations[near] : null;
  const needle = name ? fold(name) : '';

  let matches = Object.values(world.locations).filter(
    (location) =>
      (includeRetired || !location.retired) &&
      location.id !== near &&
      (!kind || kindOf(location) === kind) &&
      (!regionId || geoOf(location).regionId === regionId) &&
      (!factionId || (location.factionIds || []).includes(factionId)) &&
      (!needle || fold(location.name).includes(needle)) &&
      (!grade || gradeLocation(world, location).grade === grade)
  );

  // Exact name matches first, then prefixes; then nearest (with `near`) or
  // largest first.
  const nameRank = (location) => {
    if (!needle) return 0;
    const folded = fold(location.name);
    return folded === needle ? 0 : folded.startsWith(needle) ? 1 : 2;
  };
  let rows;
  if (origin) {
    const hops = hopsFrom(world, origin.id);
    rows = matches
      .map((location) => ({ location, ...bearing(origin, location) }))
      .sort(
        (a, b) =>
          nameRank(a.location) - nameRank(b.location) ||
          (a.distance ?? Infinity) - (b.distance ?? Infinity) ||
          a.location.name.localeCompare(b.location.name)
      )
      .map(({ location, distance, direction }) => ({
        ...locationRow(world, location),
        distance,
        direction,
        hops: hops.has(location.id) ? hops.get(location.id) : null,
      }));
  } else {
    matches = matches.sort((a, b) => nameRank(a) - nameRank(b) || byPopulationThenName(a, b));
    rows = matches.map((location) => locationRow(world, location));
  }

  const page = rows.slice(offset, offset + limit);
  const result = { total: rows.length, offset, count: page.length, locations: page };
  if (offset + page.length < rows.length) result.nextOffset = offset + page.length;
  if (origin) result.near = { id: origin.id, name: origin.name };
  return result;
}

function locationDetail(world, location) {
  const geo = geoOf(location);
  const links = geo.links || {};
  const result = {
    id: location.id,
    name: location.name,
    kind: kindOf(location),
    description: location.description || '',
    ...graded(gradeLocation(world, location)),
  };
  if (location.retired) result.retired = true;
  if (geo.kind === 'settlement') {
    result.population = populationOf(location);
    result.capital = Boolean(geo.capital);
    result.port = Boolean(geo.port);
  }
  if (geo.biome) result.biome = geo.biome;
  if (geo.markerType) result.markerType = geo.markerType;
  // What Azgaar says about a town: the seeds for its layout (L-341).
  if (geo.seeds) result.seeds = geo.seeds;
  result.region = geo.regionId ? ref(world.regions, geo.regionId) : null;
  result.factions = (location.factionIds || []).map((id) => ref(world.factions, id));
  result.connections = (location.connections || []).map((id) => ({
    ...ref(world.locations, id),
    via: links[id] || null,
    ...bearing(location, world.locations[id] || {}),
    ...(world.locations[id] ? { grade: gradeLocation(world, world.locations[id]).grade } : {}),
  }));
  result.characters = charactersAt(world, location);
  result.lore = loreAbout(world, location.id);
  result.rules = location.rules || {};
  result.startingLocation = (world.rules || {}).startingLocationId === location.id;
  if (hasPosition(location)) result.position = { x: geo.x, y: geo.y };
  return result;
}

function factionDetail(world, faction) {
  const politics = faction.politics || {};
  const settlements = Object.values(world.locations)
    .filter(
      (l) => kindOf(l) === 'settlement' && !l.retired && (l.factionIds || []).includes(faction.id)
    )
    .sort(byPopulationThenName);

  // Relations grouped by stance — "ally: [...], rival: [...]" reads better
  // than one row per realm.
  const relations = {};
  for (const [otherId, relation] of Object.entries(politics.relations || {})) {
    if (!world.factions[otherId]) continue;
    (relations[relation] = relations[relation] || []).push(ref(world.factions, otherId));
  }

  const result = {
    id: faction.id,
    name: faction.name,
    description: faction.description || '',
    ...graded(gradeEntity(world, 'faction', faction)),
    disposition: faction.disposition || 'neutral',
    form: politics.formName || null,
    government: politics.form || null,
    capital: ref(world.locations, politics.capitalLocationId),
    settlements: settlements.length,
    largestSettlements: settlements
      .slice(0, TOP_SETTLEMENTS)
      .map((location) => locationRow(world, location, { realm: true })),
    regions: Object.values(world.regions || {})
      .filter((region) => region.factionId === faction.id)
      .map((region) => ({
        id: region.id,
        name: region.name,
        settlements: (region.locationIds || []).length,
      })),
    relations,
    characters: Object.values(world.characters || {})
      .filter((c) => c.factionId === faction.id && !c.retired)
      .map((c) => ({ id: c.id, name: c.name })),
    lore: loreAbout(world, faction.id),
  };
  if (faction.retired) result.retired = true;
  return result;
}

function regionDetail(world, region) {
  const locations = (region.locationIds || [])
    .map((id) => world.locations[id])
    .filter(Boolean)
    .sort(byPopulationThenName);
  const list = capped(
    locations.map((location) => locationRow(world, location, { region: true, realm: true })),
    100
  );
  const result = {
    id: region.id,
    name: region.name,
    description: region.description || '',
    ...graded(gradeEntity(world, 'region', region)),
    form: region.formName || null,
    realm: region.factionId ? ref(world.factions, region.factionId) : null,
    capital: ref(world.locations, region.capitalLocationId),
    settlements: locations.length,
    locations: list.items,
    lore: loreAbout(world, region.id),
  };
  if (list.note) result.locationsNote = list.note;
  return result;
}

function characterDetail(world, character) {
  const result = {
    id: character.id,
    name: character.name,
    description: character.description || '',
    faction: character.factionId ? ref(world.factions, character.factionId) : null,
    location: character.locationId ? ref(world.locations, character.locationId) : null,
    lore: loreAbout(world, character.id),
  };
  if (character.retired) result.retired = true;
  return result;
}

function loreDetail(world, entry) {
  const kinds = [
    ['location', world.locations],
    ['faction', world.factions],
    ['region', world.regions || {}],
    ['character', world.characters || {}],
  ];
  const result = {
    id: entry.id,
    title: entry.title,
    text: entry.text || '',
    about: (entry.entityRefs || []).map((id) => {
      const found = kinds.find(([, collection]) => collection[id]);
      return found
        ? { id, type: found[0], name: found[1][id].name }
        : { id, type: null, name: null };
    }),
  };
  if (entry.retired) result.retired = true;
  return result;
}

module.exports = {
  worldRow,
  worldOverview,
  findLocations,
  locationDetail,
  factionDetail,
  regionDetail,
  characterDetail,
  loreDetail,
  bearing,
  hopsFrom,
  fold,
};
