'use strict';

/**
 * A map's look (planning/game-art.md §4.8, GR1; L-947 / #801): what on a
 * battle map has no painted art. Every material and object on it should be
 * painted in its world's art set or have art of its own; one that falls back
 * to the built-in SVG, or to the "?" box, is what the grading asks to be
 * painted.
 *
 *   unpainted(world, map)   { total, painted, materials: ['wall/stone'],
 *                             objects: ['crate'] }: each name once, in the
 *                             order met; `total` counts the distinct materials
 *                             and object kinds on the map
 *   hasArt(map)             whether the map has artwork of its own
 *
 * A map with its own artwork is drawn from that in place of its ground, lines
 * and walls, so only its doors, windows and objects are looked at.
 */

const materials = require('./materials');
const artSets = require('./art-sets');

const ITEMS = [
  ['ground', 'ground'],
  ['lines', 'line'],
  ['walls', 'wall'],
  ['doors', 'door'],
  ['windows', 'window'],
];

function unpainted(world, map, { ownArt = false } = {}) {
  const geometry = (map && map.geometry) || {};
  const setName = artSets.setFor(world).name;
  const seen = new Set();
  const lacking = { materials: [], objects: [] };
  for (const [key, kind] of ITEMS) {
    // The map's artwork stands in for its ground, lines and walls.
    if (ownArt && ['ground', 'lines', 'walls'].includes(key)) continue;
    for (const item of geometry[key] || []) {
      const name = `${kind}/${item.material}`;
      if (!item.material || seen.has(name)) continue;
      seen.add(name);
      if (
        !['set', 'world'].includes(
          materials.materialArt(kind, item.material, setName, world && world.materials).from
        )
      ) {
        lacking.materials.push(name);
      }
    }
  }
  const kinds = (world && world.objectKinds) || {};
  for (const item of geometry.objects || []) {
    const name = item.kind || 'unknown';
    if (seen.has(`object/${name}`)) continue;
    seen.add(`object/${name}`);
    // Painted: art of its own or its world's, or its set's, seen from above or
    // standing (the classic set paints objects standing).
    const from = materials.artFor(item, kinds, setName).from;
    const painted = from !== 'catalog' && from !== 'unknown';
    if (!painted && !materials.standFor(item, kinds, setName)) lacking.objects.push(name);
  }
  return {
    total: seen.size,
    painted: seen.size - lacking.materials.length - lacking.objects.length,
    ...lacking,
  };
}

module.exports = { unpainted };
