'use strict';

/**
 * A map's look (planning/game-art.md §4.8, GR1; L-947 / #801): what on a
 * battle map has no painted art. Every material and object on it should be
 * painted in its world's art set or have art of its own; one that falls back
 * to the built-in SVG, or to the "?" box, is what the grading asks to be
 * painted.
 *
 *   unpainted(world, map, { floorPainting })
 *                           { total, painted, materials: ['wall/stone'],
 *                             objects: ['crate'], ignored: ['crate'] }: each
 *                             name once, in the order met; `total` counts the
 *                             distinct materials and object kinds on the map;
 *                             `ignored` names those with art of their own made
 *                             for another view, which a grid doesn't draw
 *
 * A battle map is a grid, drawn in the isometric view (planning/
 * isometric-view.md §4.5, PL3; L-956): a thing is painted when the painter
 * draws it from art made for that view, as L-955 chose it:
 *
 *   - a material is painted by its set (floors, wall faces, doors and windows
 *     are laid on the isometric planes), or by a world's own ground made for
 *     it (an isometric or floor picture);
 *   - an object is painted by its own or its kind's art marked `iso`, or by
 *     its set's isometric pictures (`iso`). Art made for another view is not
 *     drawn on a grid, and a set that has only a three-quarter picture for it
 *     leaves it drawn in the old view: both count as missing.
 *
 * A map with a floor painting (`view` floor) is drawn with that for its
 * floors, so its ground and lines are not looked at; its walls, doors,
 * windows and objects stand from the data. A top-down painting is not drawn
 * on a grid, and counts for nothing.
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

function unpainted(world, map, { floorPainting = false } = {}) {
  const geometry = (map && map.geometry) || {};
  const setName = artSets.setFor(world).name;
  const seen = new Set();
  const lacking = { materials: [], objects: [] };
  // What the world gave art for that a grid doesn't draw (made for another
  // view): said so the work list can ask for it again.
  const ignored = [];
  for (const [key, kind] of ITEMS) {
    // A floor painting stands in for the ground and its lines.
    if (floorPainting && ['ground', 'lines'].includes(key)) continue;
    for (const item of geometry[key] || []) {
      const name = `${kind}/${item.material}`;
      if (!item.material || seen.has(name)) continue;
      seen.add(name);
      const own =
        kind === 'ground' ? materials.ownMaterial(world && world.materials, item.material) : null;
      if (
        !['set', 'world'].includes(
          materials.materialArt(kind, item.material, setName, world && world.materials, true).from
        )
      ) {
        lacking.materials.push(name);
      }
      if (own && own.art && own.art.link && !materials.gridArt(own.art, true)) ignored.push(name);
    }
  }
  const kinds = (world && world.objectKinds) || {};
  for (const item of geometry.objects || []) {
    const name = item.kind || 'unknown';
    if (seen.has(`object/${name}`)) continue;
    seen.add(`object/${name}`);
    // Painted: standing in isometric, from its own art made for it, or its
    // set's (L-955).
    if (!materials.isoFor(item, kinds, setName)) lacking.objects.push(name);
    const own = kinds[item.kind];
    if (
      [item.art, own && own.art].some((art) => art && (art.imageId || art.link)) &&
      ![item.art, own && own.art].some((art) => materials.gridArt(art))
    ) {
      ignored.push(name);
    }
  }
  return {
    total: seen.size,
    painted: seen.size - lacking.materials.length - lacking.objects.length,
    ...lacking,
    ignored,
  };
}

module.exports = { unpainted };
