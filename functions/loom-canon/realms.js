'use strict';

/**
 * Realms, regions and terrain on a world's region maps (planning/worlds-
 * without-azgaar.md §4.2, R1, R3, R4, R6; L-712 / #817).
 *
 *   Terrain    is a region map's ground (R1): ground items with terrain
 *              materials, a later one over an earlier. The terrain at a point
 *              is the topmost item holding it (map-geometry groundAt); none
 *              outside every item.
 *   A region   (`regions/{id}`, { name, factionId, … }) is shaped by zones on
 *              region maps naming it, `{ id, region: <regionId>, shape }`
 *              (R3). Its land is its zones together, on any map.
 *   A realm    (`factions/{id}`) holds the regions naming it (`factionId`):
 *              its land is theirs. Its colour is `politics.color` (Azgaar's,
 *              or set with add_realms and update_faction), else one picked
 *              from its id.
 *   A place    on a region map is in the topmost zone naming a live region
 *              at its position, and in that region's realm (R6), unless set
 *              by hand: a location's `geo.regionId` and `factionIds` as
 *              stored win. resolvePlaces fills them in where the world is
 *              loaded (./index.js), so every reader sees them, marked
 *              `geo.regionFrom: 'position'` and `geo.realmFrom: 'region'`.
 *
 *   regionAt(world, mapId, point)   { region, zone } at a point, or null
 *   whereOn(world, mapId, point)    terrain, region, realm and zones there
 *   regionLand(world, regionId)     [{ mapId, zones: [zoneId] }]
 *   realmLand(world, factionId)     { regions: [regionId], land: [...] }
 *   realmOf(world, regionId)        the region's live realm, or null
 *   colourOf(faction)               '#rrggbb'
 *   resolvePlaces(world)            fills in places' region and realm (mutates)
 *
 * Pure.
 */

const geo = require('./map-geometry');
const materials = require('./materials');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const live = (e) => Boolean(e) && !e.retired;

// Colours for a realm with none of its own: distinct, and readable on the
// map's dark backdrop and on terrain.
const PALETTE = [
  '#d0543f',
  '#3f7fd0',
  '#d0a23f',
  '#5aa65a',
  '#a35ad0',
  '#3fb3b3',
  '#d06aa0',
  '#8f8f3f',
  '#d07a3f',
  '#6a6ad0',
  '#3fa37a',
  '#b34a6a',
];

/** A map doc by id: a live region map, or null. */
function regionMap(world, mapId) {
  const map = ((world && world.maps) || {})[mapId];
  return map && !map.retired && map.kind === 'region' ? map : null;
}

/** A live region by id, or null. */
function regionOf(world, regionId) {
  const region = ((world && world.regions) || {})[regionId];
  return live(region) ? region : null;
}

/** The region's live realm, or null. */
function realmOf(world, regionId) {
  const region = regionOf(world, regionId);
  const faction = region && ((world && world.factions) || {})[region.factionId];
  return live(faction) ? faction : null;
}

// The compiled geometry of a region map, or null.
function compiledOf(world, mapId) {
  const map = regionMap(world, mapId);
  return map && isObject(map.geometry) ? geo.compile(map.geometry) : null;
}

/**
 * The region at a point on a region map: the topmost zone (the last in the
 * list) naming a live region and holding the point. `{ region, zone }`, or
 * null.
 */
function regionAt(world, mapId, point) {
  const c = compiledOf(world, mapId);
  if (!c) return null;
  const zones = geo.zonesAt(c, point);
  for (let i = zones.length - 1; i >= 0; i--) {
    const region = zones[i].region && regionOf(world, zones[i].region);
    if (region) return { region, zone: zones[i] };
  }
  return null;
}

const ref = (e) => (e ? { id: e.id, name: e.name || e.id } : null);

/**
 * What lies at a point on a region map: its terrain (the ground there: its
 * id, material and the material's name), region and realm, and every zone
 * holding it, bottom first.
 */
function whereOn(world, mapId, point) {
  const c = compiledOf(world, mapId);
  const ground = c && c.ground.length ? geo.groundAt(c, point) : null;
  const material = ground && materials.materialOf('ground', ground.material, world.materials);
  const at = regionAt(world, mapId, point);
  const realm = at ? realmOf(world, at.region.id) : null;
  return {
    terrain: ground
      ? {
          ...(ground.id ? { id: ground.id } : {}),
          material: ground.material,
          name: material ? material.name : ground.material,
        }
      : null,
    region: at ? { ...ref(at.region), zone: at.zone.id } : null,
    realm: realm ? ref(realm) : null,
    zones: (c ? geo.zonesAt(c, point) : []).map((z) => ({
      id: z.id,
      ...(z.name ? { name: z.name } : {}),
      ...(z.region ? { region: z.region } : {}),
    })),
  };
}

/** A region's land: the zones naming it, by map: [{ mapId, zones: [zoneId] }]. */
function regionLand(world, regionId) {
  const out = [];
  for (const mapId of Object.keys((world && world.maps) || {}).sort()) {
    const map = regionMap(world, mapId);
    const zones = ((map && isObject(map.geometry) && map.geometry.zones) || [])
      .filter((z) => isObject(z) && z.region === regionId)
      .map((z) => z.id);
    if (zones.length) out.push({ mapId, zones });
  }
  return out;
}

/**
 * A realm's land: its live regions (those naming it) and their land,
 * `{ regions: [regionId], land: [{ mapId, regionId, zones }] }`.
 */
function realmLand(world, factionId) {
  const regions = Object.values((world && world.regions) || {})
    .filter((r) => live(r) && r.factionId === factionId)
    .map((r) => r.id)
    .sort();
  const land = [];
  for (const regionId of regions) {
    for (const part of regionLand(world, regionId)) land.push({ ...part, regionId });
  }
  return { regions, land };
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/** A realm's colour: its own, else one picked from its id. */
function colourOf(faction) {
  const own = faction && faction.politics && faction.politics.color;
  if (typeof own === 'string' && /^#[0-9a-fA-F]{6}$/.test(own)) return own.toLowerCase();
  return PALETTE[hash(String((faction && faction.id) || '')) % PALETTE.length];
}

// Fills in one place's region and realm from where it sits, unless set.
function resolveOne(world, place, mapId, point) {
  const g = isObject(place.geo) ? place.geo : {};
  let regionId = g.regionId || null;
  const geoOut = { ...g };
  if (!regionId) {
    const at = point ? regionAt(world, mapId, point) : null;
    if (at) {
      regionId = at.region.id;
      geoOut.regionId = regionId;
      geoOut.regionFrom = 'position';
    }
  }
  const ownRealms = Array.isArray(place.factionIds) ? place.factionIds : [];
  let factionIds = ownRealms;
  if (!ownRealms.length && regionId) {
    const realm = realmOf(world, regionId);
    if (realm) {
      factionIds = [realm.id];
      geoOut.realmFrom = 'region';
    }
  }
  if (geoOut.regionFrom || geoOut.realmFrom) {
    place.geo = geoOut;
    place.factionIds = factionIds;
  }
}

/**
 * Fills in the region and realm of every place on a region map with
 * geometry, from where it sits (R6), where not set by hand: today's
 * locations on the top map (at `geo.x`, `geo.y`), and places in the new
 * shape (`mapPlaces`) on any region map (at `at`). Mutates the world, before
 * it is frozen; returns it.
 */
function resolvePlaces(world) {
  if (!world) return world;
  const hasZones = (mapId) => {
    const map = regionMap(world, mapId);
    return Boolean(map && isObject(map.geometry) && (map.geometry.zones || []).length);
  };
  const top = world.topMapId || null;
  if (top && hasZones(top)) {
    for (const location of Object.values(world.locations || {})) {
      const g = isObject(location.geo) ? location.geo : {};
      const point = Number.isFinite(g.x) && Number.isFinite(g.y) ? [g.x, g.y] : null;
      resolveOne(world, location, top, point);
    }
  }
  for (const place of Object.values(world.mapPlaces || {})) {
    if (!place || !hasZones(place.mapId)) continue;
    const a = place.at;
    const point = isObject(a) && Number.isFinite(a.x) && Number.isFinite(a.y) ? [a.x, a.y] : null;
    resolveOne(world, place, place.mapId, point);
  }
  return world;
}

/**
 * The regions a zone list names that the world hasn't, as reasons: a zone
 * naming a region must name a live one (L-712).
 */
function zoneProblems(world, zones) {
  const problems = [];
  for (const [i, zone] of (zones || []).entries()) {
    if (!isObject(zone) || zone.region === undefined || zone.region === null) continue;
    const region = ((world && world.regions) || {})[zone.region];
    const name = `zones.${zone.id || i}`;
    if (!region) {
      problems.push(
        `${name} names a region "${zone.region}" the world hasn’t (add_regions adds one; ` +
          'get_world lists them).'
      );
    } else if (region.retired) {
      problems.push(`${name} names the region "${region.name}", which has been retired.`);
    }
  }
  return problems;
}

module.exports = {
  PALETTE,
  regionAt,
  whereOn,
  regionLand,
  realmLand,
  realmOf,
  regionOf,
  colourOf,
  resolvePlaces,
  zoneProblems,
};
