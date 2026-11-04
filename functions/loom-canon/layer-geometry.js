'use strict';

/**
 * A battle map's layers stored as geometry (planning/maps-from-data.md §4.7,
 * EX4; L-928 / #732). Since L-922 play reads a battle map's old layers
 * (walls along grid lines, doors one square long, obstacles by the square)
 * as geometry in memory (./map-geometry.js `fromLayers`), beside its own
 * geometry, its own items winning on an id (./map-paths.js `geometryOf`).
 * Converting a map stores that, in its battle map document (GE5), so it
 * plays on the geometry alone once its layers are dropped:
 *
 *   converted(map)            the geometry to store: its own, and its layers'
 *                             conversion beside it, normalized
 *   madeBy(map)               the items its layers convert to, by id
 *   isMade(made, item)        whether a stored item is one of those, unchanged
 *   withoutMade(map, g)       a geometry less what the map's layers made
 *   relayered(map, next)      the geometry for `next`, the map with new
 *                             layers: what the old ones made replaced by
 *                             what the new ones make (the grid tools, which
 *                             write both until the layers are dropped)
 *
 * The conversion keeps every id: doors keep theirs, so a save's door states
 * and wary triggers on them still find them; walls, doorways and obstacles
 * the ids fromLayers gives them (`layer-wall-0`, `layer-doorway-<door>`,
 * `layer-<obstacle>`), so what's stored shadows what's read from the layers
 * item for item, and nothing plays differently while both are there.
 * Features, entries, exits, areas, hazards and figures aren't layers: they
 * stay as they are (decided 2026-11-04).
 *
 * Pure.
 */

const geo = require('./map-geometry');
const mapPaths = require('./map-paths');

const LAYERS = ['walls', 'doors', 'obstacles'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A value as text with its keys in order, for comparing what Firestore hands back. */
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (isObject(v)) {
    return (
      '{' +
      Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stable(v[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(v);
}

/** Whether a map has old layers at all. */
function hasLayers(map) {
  return Boolean(map) && LAYERS.some((k) => Array.isArray(map[k]) && map[k].length > 0);
}

/** The geometry a battle map stores once converted (normalized; {} when it has none). */
function converted(map) {
  return geo.normalize(mapPaths.geometryOf({ ...map }));
}

/**
 * The items a map's layers convert to, as stored: by id, `{ key, text }`
 * (`text` the item as `stable` writes it). Kept per map object.
 */
const madeCache = new WeakMap();
function madeBy(map) {
  if (isObject(map) && madeCache.has(map)) return madeCache.get(map);
  const out = new Map();
  if (hasLayers(map)) {
    const made = geo.normalize(geo.fromLayers(map));
    for (const key of geo.LISTS) {
      for (const item of made[key] || []) out.set(item.id, { key, text: stable(item) });
    }
  }
  if (isObject(map)) madeCache.set(map, out);
  return out;
}

/** Whether a stored item (in list `key`) is one `made` holds, unchanged. */
function isMade(made, key, item) {
  const m = item && made.get(item.id);
  return Boolean(m) && m.key === key && m.text === stable(item);
}

/** A geometry less the items a map's layers make (an own item of the same id stays). */
function withoutMade(map, geometry) {
  const made = madeBy(map);
  const out = {};
  if (!isObject(geometry)) return out;
  for (const key of Object.keys(geometry)) {
    const list = geometry[key];
    if (!Array.isArray(list)) {
      out[key] = list;
      continue;
    }
    const kept = made.size ? list.filter((item) => !isMade(made, key, item)) : list;
    if (kept.length) out[key] = kept;
  }
  return out;
}

/**
 * The geometry for `next`, a battle map given new layers (or none): the
 * stored geometry of `map` less what its old layers made, with the new
 * layers' conversion beside it. Empty lists are dropped.
 */
function relayered(map, next) {
  const own = withoutMade(map, map && map.geometry);
  return converted({ ...next, geometry: own });
}

/** Whether a map's stored geometry already holds everything its layers make. */
function isConverted(map) {
  const made = madeBy(map);
  if (!made.size) return true;
  const stored = (map && map.geometry) || {};
  let found = 0;
  for (const key of geo.LISTS) {
    for (const item of stored[key] || []) if (isMade(made, key, item)) found++;
  }
  return found === made.size;
}

module.exports = {
  LAYERS,
  stable,
  hasLayers,
  converted,
  madeBy,
  isMade,
  withoutMade,
  relayered,
  isConverted,
};
