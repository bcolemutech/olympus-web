'use strict';

/**
 * A battle map's layers stored as geometry (planning/maps-from-data.md §4.7,
 * EX4; L-928 / #732). A battle map's walls along grid lines, doors one
 * square long and obstacles by the square (./layers.js, as the grid tools
 * take them) are stored as its geometry (./map-geometry.js `fromLayers`),
 * in its battle map document (GE5), and play reads only the geometry: the
 * layers themselves are dropped.
 *
 *   converted(map)          a map's geometry with its layers' conversion
 *                           beside it, its own items winning on an id,
 *                           normalized: what the Convert Map Layers workflow
 *                           stores
 *   isLayerItem(key, item)  whether a stored item is one the layers made:
 *                           walls, doorways and obstacles have ids starting
 *                           "layer-" (`layer-wall-0`, `layer-doorway-<door>`,
 *                           `layer-<obstacle>`); a door, its own id, in a
 *                           doorway of that name
 *   ownOf(geometry)         a geometry less what the layers made
 *   layersOf(geometry)      the layers read back from what they made, in
 *                           squares and corners, as the grid tools show them
 *   withLayers(g, layers)   a geometry with what the layers made replaced by
 *                           the conversion of `layers` (`{ walls, doors,
 *                           obstacles }`, each one given replacing that one):
 *                           the grid tools' shortcut
 *   hasShapes(map)          whether a map's geometry has anything to play on
 *
 * Every id is kept: doors keep theirs, so a save's door states and wary
 * triggers on them still find them. Features, entries, exits, areas, hazards
 * and figures aren't layers: they stay as they are (decided 2026-11-04).
 *
 * Pure.
 */

const geo = require('./map-geometry');

const LAYERS = ['walls', 'doors', 'obstacles'];
const F = geo.FEET_PER_SQUARE;
const WALL_ID = /^layer-wall-(\d+)$/;
const DOORWAY = 'layer-doorway-';

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

/**
 * A map's geometry (`map.geometry`) with its layers (`map.walls`, `doors`,
 * `obstacles`) converted beside it, its own items winning where ids are the
 * same; normalized ({} when it has none).
 */
function converted(map) {
  const own = (map && isObject(map.geometry) && map.geometry) || {};
  const made = hasLayers(map) ? geo.fromLayers(map) : {};
  const taken = new Set();
  for (const key of geo.LISTS) {
    for (const item of own[key] || []) if (item && item.id) taken.add(item.id);
  }
  const out = {};
  for (const key of geo.LISTS) {
    const mine = Array.isArray(own[key]) ? own[key] : [];
    const theirs = (made[key] || []).filter((item) => !taken.has(item.id));
    if (mine.length || theirs.length) out[key] = mine.concat(theirs);
  }
  return geo.normalize(out);
}

/** Whether a stored item (in list `key`) is one the layers made. */
function isLayerItem(key, item) {
  if (!isObject(item)) return false;
  if (key === 'doors') return typeof item.wall === 'string' && item.wall === DOORWAY + item.id;
  return typeof item.id === 'string' && item.id.startsWith('layer-');
}

/** A geometry less what the layers made. */
function ownOf(geometry) {
  const out = {};
  if (!isObject(geometry)) return out;
  for (const key of Object.keys(geometry)) {
    const list = geometry[key];
    if (!Array.isArray(list)) {
      out[key] = list;
      continue;
    }
    const kept = list.filter((item) => !isLayerItem(key, item));
    if (kept.length) out[key] = kept;
  }
  return out;
}

// A point in feet as a corner of the grid.
const corner = (p) => ({
  x: Math.round((p[0] / F) * 1000) / 1000,
  y: Math.round((p[1] / F) * 1000) / 1000,
});
const pointOf = (p) => (Array.isArray(p) ? p : p && Number.isFinite(p.x) ? [p.x, p.y] : null);

// The box round a list of points, in squares.
function boxOf(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: x / F, y: y / F, w: (Math.max(...xs) - x) / F, h: (Math.max(...ys) - y) / F };
}

// An obstacle in squares, its width and height left out when 1.
function obstacle(id, name, kind, box) {
  const o = { id, ...(name ? { name } : {}), kind, x: box.x, y: box.y };
  if (box.w !== 1) o.w = box.w;
  if (box.h !== 1) o.h = box.h;
  return o;
}

/**
 * The layers read back from what they made in a geometry: `{ walls, doors,
 * obstacles }` in corners and squares, as the grid tools take them (low
 * obstacles first, then solid, then difficult).
 */
function layersOf(geometry) {
  const g = isObject(geometry) ? geometry : {};
  const walls = [];
  const low = [];
  for (const w of g.walls || []) {
    if (!isLayerItem('walls', w) || String(w.id).startsWith(DOORWAY)) continue;
    const read = geo.linesOf(w.points);
    const line = read.lines && read.lines[0];
    if (!line) continue;
    const m = WALL_ID.exec(w.id);
    if (m) walls.push({ n: Number(m[1]), wall: { points: line.map(corner) } });
    else low.push(obstacle(w.id.slice(6), w.name, 'low', boxOf(line)));
  }
  walls.sort((a, b) => a.n - b.n);
  const doors = (g.doors || [])
    .filter((d) => isLayerItem('doors', d))
    .map((d) => {
      const out = { id: d.id };
      if (d.name) out.name = d.name;
      out.from = corner(pointOf(d.from));
      out.to = corner(pointOf(d.to));
      if (d.state === 'locked') out.locked = true;
      if (Number.isFinite(d.ap)) out.ap = d.ap;
      if (isObject(d.long)) out.long = d.long;
      if (d.unlocks && d.unlocks.key) out.key = d.unlocks.key;
      if (Number.isFinite(d.difficulty)) out.difficulty = d.difficulty;
      return out;
    });
  const solid = (g.objects || [])
    .filter((o) => isLayerItem('objects', o))
    .map((o) => {
      const at = pointOf(o.at);
      const size = Array.isArray(o.size) ? o.size : [o.size, o.size];
      const box = {
        x: (at[0] - size[0] / 2) / F,
        y: (at[1] - size[1] / 2) / F,
        w: size[0] / F,
        h: size[1] / F,
      };
      return obstacle(o.id.slice(6), o.name, 'solid', box);
    });
  const difficult = (g.ground || [])
    .filter((x) => isLayerItem('ground', x))
    .map((x) => {
      const read = geo.ringsOf(x.shape);
      const ring = read.rings && read.rings[0];
      return ring ? obstacle(x.id.slice(6), x.name, 'difficult', boxOf(ring)) : null;
    })
    .filter(Boolean);
  return {
    walls: walls.map((w) => w.wall),
    doors,
    obstacles: low.concat(solid, difficult),
  };
}

/**
 * A geometry with what the layers made replaced by the conversion of
 * `layers`: each of `walls`, `doors` and `obstacles` given replaces that
 * one, the others read back and kept; the map's own items kept.
 */
function withLayers(geometry, layers = {}) {
  const now = layersOf(geometry);
  const next = {};
  for (const k of LAYERS) next[k] = layers[k] !== undefined ? layers[k] || [] : now[k];
  return converted({ ...next, geometry: ownOf(geometry) });
}

/** Whether a map's geometry has anything to play on: ground, walls, doors, windows or objects. */
function hasShapes(map) {
  const g = map && isObject(map.geometry) ? map.geometry : null;
  return (
    Boolean(g) &&
    ['ground', 'walls', 'doors', 'windows', 'objects'].some((k) => (g[k] || []).length)
  );
}

module.exports = {
  LAYERS,
  stable,
  hasLayers,
  converted,
  isLayerItem,
  ownOf,
  layersOf,
  withLayers,
  hasShapes,
};
