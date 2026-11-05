'use strict';

/**
 * Battle maps for the tests, written as the grid tools take them (walls
 * along grid lines, doors one square long, obstacles by the square;
 * functions/loom-canon/layers.js) and stored as geometry the way the Convert
 * Map Layers workflow and the grid tools store them (planning/maps-from-
 * data.md §4.7, EX4; L-928): play reads only the geometry, so every grid
 * test plays on the geometry alone.
 *
 *   gridMap(map)   the map with its walls, doors and obstacles converted into
 *                  `geometry` (beside any it has, its own items winning on
 *                  an id) and left out
 *   gridMaps(obj)  each map of an object of maps, by id
 *   gridFields(layers, FieldValue)
 *                  the fields to write for walls, doors and obstacles on a
 *                  stored map (its geometry, or a delete for none)
 *   layersSeen(view)
 *                  the walls, doors and obstacles a view's geometry holds, in
 *                  squares and corners, each door with its state
 */

const layerGeometry = require('../../functions/loom-canon/layer-geometry');

function gridMap(map) {
  if (!map || typeof map !== 'object') return map;
  const geometry = layerGeometry.converted(map);
  const out = { ...map };
  for (const k of layerGeometry.LAYERS) delete out[k];
  if (Object.keys(geometry).length) out.geometry = geometry;
  else delete out.geometry;
  return out;
}

function gridMaps(maps) {
  return Object.fromEntries(Object.entries(maps || {}).map(([id, m]) => [id, gridMap(m)]));
}

function gridFields(layers, FieldValue) {
  const geometry = layerGeometry.converted(layers || {});
  return { geometry: Object.keys(geometry).length ? geometry : FieldValue.delete() };
}

function layersSeen(view) {
  const g = (view && view.geometry) || {};
  const out = layerGeometry.layersOf(g);
  const states = Object.fromEntries((g.doors || []).map((d) => [d.id, d.state]));
  out.doors = out.doors.map((d) => ({ ...d, state: states[d.id] }));
  return out;
}

module.exports = { gridMap, gridMaps, gridFields, layersSeen };
