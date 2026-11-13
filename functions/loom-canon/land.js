'use strict';

/**
 * A world's painted land, for grading (planning/worlds-without-azgaar.md §4.8,
 * GR1; L-718 / #823). Pure.
 *
 *   terrainCover(world, mapId)    the share of a region map under ground
 *   regionHasShape(world, id)     a zone on a region map names the region
 *   regionsOnMap(world, mapId)    the regions that belong on a region map
 *   realmHasLand(world, id)       one of the realm's regions has a shape
 *
 * Terrain is a region map's ground (R1), water counting: a lake or the ocean
 * is ground too. A map is covered where any ground item holds a point, so a
 * map with only its island painted has the sea unpainted.
 */

const geo = require('./map-geometry');
const realms = require('./realms');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const live = (e) => Boolean(e) && !e.retired;

// A map is sampled on a grid this many points along its longer side. Each
// sample stands for the cell around it, so the share is within a few points
// of the real area.
const SAMPLES = 48;

const covers = new WeakMap();

/**
 * The share (0–1) of a region map's area that has ground under it, or 0 for
 * a map with no ground or no size. Sampled; the same map gives the same share.
 */
function terrainCover(world, mapId) {
  const map = ((world && world.maps) || {})[mapId];
  if (!isObject(map) || map.retired || !isObject(map.geometry)) return 0;
  const bounds = geo.boundsOf(map);
  if (!bounds) return 0;
  const c = geo.compile(map.geometry);
  if (!c.ground.length) return 0;
  if (covers.has(c)) return covers.get(c);
  const step = Math.max(bounds.width, bounds.height) / SAMPLES;
  const across = Math.max(1, Math.round(bounds.width / step));
  const down = Math.max(1, Math.round(bounds.height / step));
  let held = 0;
  for (let j = 0; j < down; j++) {
    for (let i = 0; i < across; i++) {
      const point = [((i + 0.5) * bounds.width) / across, ((j + 0.5) * bounds.height) / down];
      if (geo.groundAt(c, point)) held += 1;
    }
  }
  const share = held / (across * down);
  covers.set(c, share);
  return share;
}

/** Whether a zone on a live region map names the region. */
function regionHasShape(world, regionId) {
  return realms.regionLand(world, regionId).length > 0;
}

/** Whether any of the realm's live regions has a shape: it has land. */
function realmHasLand(world, factionId) {
  return realms.realmLand(world, factionId).land.length > 0;
}

/**
 * The regions that belong on a region map: those its places name (set by hand
 * or from where they sit) and those with a zone on it. A region with neither
 * anywhere, one nothing has placed, belongs on the world's top map. Returns
 * their ids, sorted.
 */
function regionsOnMap(world, mapId) {
  const live_ = Object.values((world && world.regions) || {}).filter(live);
  if (!live_.length) return [];
  const here = new Set();
  const placed = new Set();
  const homes = (world && world.regionLocations) || {};
  for (const [id, places] of Object.entries(homes)) {
    for (const place of Object.values(places || {})) {
      const regionId = place && !place.retired && place.geo && place.geo.regionId;
      if (!regionId) continue;
      placed.add(regionId);
      if (id === mapId) here.add(regionId);
    }
  }
  for (const region of live_) {
    for (const part of realms.regionLand(world, region.id)) {
      placed.add(region.id);
      if (part.mapId === mapId) here.add(region.id);
    }
    if (!placed.has(region.id) && mapId === world.topMapId) here.add(region.id);
  }
  return [...here].filter((id) => live_.some((r) => r.id === id)).sort();
}

module.exports = {
  SAMPLES,
  terrainCover,
  regionHasShape,
  regionsOnMap,
  realmHasLand,
};
