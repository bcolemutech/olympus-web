'use strict';

/**
 * Keeping objects to scale (planning/game-art.md §4.6, SC1; L-945 / #799):
 * art is drawn at an object's size in feet, so a chest saved at 12 × 8 ft is
 * drawn as big as a room. Warnings, never refusals (a giant's chest, a
 * wall of crates, is allowed), for what a save leaves odd:
 *
 *   an object under half or over twice its kind's usual size (the world's
 *   own, else the catalog's), either way across;
 *   an object whose footprint goes into a wall (one that hangs on a wall, and
 *   flat decor, rubble and straw, are let be);
 *   a figure whose size class doesn't fit where it stands.
 *
 *   sizeOf(item)                    [w, h] in feet, or null
 *   warnings(geometry, options)     the sentences for a geometry's objects;
 *                                   options { worldKinds?, only? (ids) }
 *   figureWarnings(map, fighters)   the sentences for placed figures, `fighters`
 *                                   as the combat module's instancesOf
 *
 * Pure.
 */

const geo = require('./map-geometry');
const materials = require('./materials');
const mapPaths = require('./map-paths');
const sheets = require('./sheets');

const MAX = 12; // sentences said before "and n more"
const SHRINK = 0.25; // feet a footprint may go into a wall's own thickness

const fmt = (n) => String(Math.round(n * 100) / 100);
const dims = ([w, h]) => `${fmt(w)} × ${fmt(h)} ft`;

function sizeOf(item) {
  const s = item && item.size;
  if (typeof s === 'number' && s > 0) return [s, s];
  if (Array.isArray(s) && s.length === 2 && s.every((n) => typeof n === 'number' && n > 0)) {
    return [s[0], s[1]];
  }
  if (s && typeof s === 'object' && s.w > 0 && s.h > 0) return [s.w, s.h];
  return null;
}

const nameOf = (item) => {
  const kind = materials.objectKind(item.kind);
  const word = String((kind && kind.name) || item.kind || 'object').toLowerCase();
  return `${word} "${item.id}"`;
};

// A footprint's corners, turned.
function ringOf(item, size, shrink) {
  const at = Array.isArray(item.at) ? item.at : [item.at.x, item.at.y];
  const a = ((item.turn || 0) * Math.PI) / 180 || 0;
  const hw = Math.max(0.01, size[0] / 2 - shrink);
  const hh = Math.max(0.01, size[1] / 2 - shrink);
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => [
    at[0] + x * Math.cos(a) - y * Math.sin(a),
    at[1] + x * Math.sin(a) + y * Math.cos(a),
  ]);
}

function crosses(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

// Whether a segment goes into a ring: through it, or ends inside it.
function meets(ring, a, b) {
  if (geo.pointInShape(a, ring) || geo.pointInShape(b, ring)) return true;
  for (let i = 0; i < ring.length; i++) {
    if (crosses(a, b, ring[i], ring[(i + 1) % ring.length])) return true;
  }
  return false;
}

/**
 * The sentences about a geometry's objects. Of `options.only` (ids) when
 * given, else all of them.
 */
function warnings(geometry, options) {
  const o = options || {};
  const c = geo.compile(geometry || {});
  const only = o.only ? new Set(o.only) : null;
  const walls = [];
  geo.edges(c, {}).forEach((e) => {
    if (e.kind === 'wall') walls.push({ a: e.a, b: e.b, id: (e.item && e.item.id) || 'a wall' });
  });
  const out = [];
  c.objects.forEach(({ item }) => {
    if (only && !only.has(item.id)) return;
    const size = sizeOf(item);
    if (!size) return;
    const kind = materials.objectKind(item.kind);
    const usual = materials.sizeFor(item.kind, o.worldKinds);
    if (usual) {
      // Across and along, either way round (a bed is 3 × 6, or 6 × 3 turned).
      const have = size.slice().sort((x, y) => y - x);
      const want = usual.slice().sort((x, y) => y - x);
      const under = have.some((n, i) => n < want[i] / 2);
      const over = have.some((n, i) => n > want[i] * 2);
      if (under || over) {
        out.push(
          `${nameOf(item)} is ${dims(size)}, ${under ? 'under half' : 'over twice'} the ` +
            `usual ${dims(usual)} of a ${kind ? kind.name.toLowerCase() : item.kind}.`
        );
      }
    }
    // Hung or flat decor lies against a wall or in a corner, by design.
    if (kind && kind.decor && (kind.onWall || kind.blocksMove === false)) return;
    const ring = ringOf(item, size, SHRINK);
    const hit = walls.find((w) => meets(ring, w.a, w.b));
    if (hit) out.push(`${nameOf(item)} overlaps the wall "${hit.id}": move it clear of it.`);
  });
  if (out.length > MAX) {
    const more = out.length - MAX;
    return [...out.slice(0, MAX), `…and ${more} more odd ${more === 1 ? 'object' : 'objects'}.`];
  }
  return out;
}

/**
 * Figures a size class won't fit where they're placed: `fighters`, each
 * { name, cell, sheet } (the combat module's instancesOf). A figure stands
 * at the middle of its square; it fits when its width (medium 2.5 ft) is
 * clear of walls and things that block.
 */
function figureWarnings(map, fighters) {
  const c = geo.compile(mapPaths.geometryOf(map));
  const bounds = {
    width: (map.width || 0) * mapPaths.FEET,
    height: (map.height || 0) * mapPaths.FEET,
  };
  const out = [];
  (fighters || []).forEach((f) => {
    const width = sheets.widthOf(f.sheet);
    const at = mapPaths.centreOf(f.cell);
    if (!geo.fits(c, [at.x, at.y], width, { bounds })) {
      out.push(
        `${f.name} is ${fmt(width)} ft across and doesn't fit at (${f.cell.x}, ${f.cell.y}): ` +
          'something there is in the way. Place them where there is room.'
      );
    }
  });
  if (out.length > MAX) {
    const more = out.length - MAX;
    return [...out.slice(0, MAX), `…and ${more} more figures that don't fit.`];
  }
  return out;
}

module.exports = { sizeOf, warnings, figureWarnings, MAX };
