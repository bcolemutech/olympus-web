'use strict';

const geo = require('../../../loom-canon/map-geometry');
const catalog = require('../../../loom-canon/materials');

// A map's geometry drawn for view_image (planning/maps-from-data.md §4.8; L-929
// / #733): what Claude sees to check what it has built. Not the page's
// painter (that needs a browser, and the materials' art): flat colours by
// material, so layout, heights and data can be checked, not the final look.
//
// Two passes, so the grid lies between them:
//   paintUnder   floors (ground, shaded by height, water by depth), lines
//                (rivers, roads) and dark areas
//   paintOver    zones, objects, light sources, walls, doors by state and
//                windows, spawns, notes and what is hidden, with numbered
//                markers for what has a name, an id to patch it by, or a
//                setting
//
// Units are the geometry's (feet on a grid, the map's own on a region or area
// map); the scale is pixels a unit, a number or { x, y } (art stretched to a
// grid that isn't its shape). `options`: { art (the map has art: floors are
// not filled, so it shows), heights (shade floors by height, default true),
// hidden (draw what is hidden, marked; false draws the map as players see
// it), doors (a save's door states), skipDoors and skipObjects (ids another
// marker already numbers) }.

const GROUND = {
  stone: [110, 112, 120],
  flagstone: [128, 128, 134],
  cobble: [120, 108, 96],
  marble: [214, 210, 204],
  tile: [170, 150, 140],
  wood: [140, 100, 60],
  carpet: [150, 50, 60],
  dirt: [120, 92, 60],
  grass: [76, 130, 62],
  sand: [218, 198, 140],
  gravel: [150, 146, 140],
  mud: [100, 80, 56],
  rock: [88, 84, 84],
  snow: [236, 240, 246],
  ice: [170, 210, 230],
  lava: [220, 80, 20],
  roof: [160, 70, 60],
  metal: [120, 128, 140],
  water: [40, 100, 190],
  'deep-water': [20, 60, 140],
  swamp: [70, 100, 70],
  ocean: [28, 70, 150],
  lake: [50, 120, 200],
  marsh: [90, 120, 90],
  grassland: [110, 160, 80],
  farmland: [190, 170, 80],
  forest: [40, 100, 50],
  jungle: [24, 110, 60],
  savanna: [190, 170, 90],
  desert: [225, 190, 110],
  hills: [130, 150, 90],
  mountains: [130, 125, 120],
  tundra: [170, 180, 170],
  taiga: [60, 100, 90],
  glacier: [200, 225, 240],
};
const LINE = {
  river: [60, 130, 220],
  stream: [100, 160, 230],
  canal: [70, 110, 180],
  road: [170, 150, 110],
  track: [140, 120, 90],
  street: [150, 150, 150],
  path: [160, 140, 100],
};
const WALL = {
  stone: [225, 225, 230],
  brick: [200, 115, 95],
  wood: [175, 125, 70],
  rock: [160, 150, 140],
  metal: [165, 175, 195],
  ice: [190, 225, 245],
  hedge: [70, 150, 70],
  palisade: [155, 115, 75],
  glass: [165, 225, 245],
  bars: [195, 195, 205],
  fence: [205, 175, 125],
};
const DOOR = {
  wood: [205, 150, 80],
  iron: [150, 160, 170],
  stone: [205, 205, 205],
  metal: [170, 180, 200],
  curtain: [190, 80, 120],
  glass: [170, 225, 240],
  bars: [190, 190, 200],
  gate: [210, 190, 120],
};
const WINDOW = {
  glass: [150, 215, 240],
  bars: [190, 190, 200],
  opening: [120, 200, 230],
  shutters: [170, 120, 70],
};
const GROUPS = {
  furniture: [176, 134, 84],
  containers: [150, 108, 62],
  machines: [140, 150, 170],
  outdoors: [90, 150, 90],
  sacred: [210, 190, 235],
  ways: [190, 190, 120],
};
const OTHER = {
  object: [160, 160, 160],
  locked: [225, 95, 75],
  zone: [77, 182, 172],
  spawn: [239, 83, 80],
  note: [200, 160, 235],
  light: [255, 214, 102],
  dark: [0, 0, 0],
  hidden: [236, 64, 200],
  outline: [10, 14, 26],
};

const clamp = (v, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, v));
const shade = (rgb, f) => rgb.map((v) => clamp(Math.round(v * f)));
const withAlpha = (rgb, a) => [rgb[0], rgb[1], rgb[2], a];
const middle = (points) => {
  const n = points.length || 1;
  return points.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
};

function makePainter(h) {
  const { fillRect, fillCircle, line, number, labelScale } = h;

  // Fills rings (arrays of [x, y] in pixels) with even-odd holes.
  function fillRings(c, rings, colour) {
    const ys = rings.flatMap((ring) => ring.map((p) => p[1]));
    if (!ys.length) return;
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(c.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      const xs = [];
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i];
          const b = ring[j];
          if (a[1] > cy !== b[1] > cy)
            xs.push(a[0] + ((cy - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let n = 0; n + 1 < xs.length; n += 2) {
        const from = Math.max(0, Math.ceil(xs[n] - 0.5));
        const to = Math.min(c.width - 1, Math.floor(xs[n + 1] - 0.5));
        if (to >= from) fillRect(c, from, y, to - from + 1, 1, colour);
      }
    }
  }
  const scaled = (ring, K) => ring.map((p) => [p[0] * K.x, p[1] * K.y]);
  const outlineRing = (c, ring, colour, width) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      line(c, a[0], a[1], b[0], b[1], colour, width);
    }
  };
  const stroke = (c, a, b, colour, width) => {
    line(c, a[0], a[1], b[0], b[1], withAlpha(OTHER.outline, 255), width + 2);
    line(c, a[0], a[1], b[0], b[1], colour, width);
  };

  /** Floors, lines and dark areas: under the grid. Returns the heights drawn. */
  function paintUnder(c, geometry, scale, options = {}) {
    const K = typeof scale === 'number' ? { x: scale, y: scale } : scale;
    const { art = false, heights = true, hidden = true } = options;
    const g = geo.compile(geometry || {});
    const shown = (item) => hidden || !g.hidden[item.id];
    const shaded = [];
    const ls = labelScale(c);
    for (const { item, rings } of g.ground) {
      if (!shown(item) || !rings) continue;
      const base = GROUND[item.material] || [120, 120, 120];
      let f = 1;
      const height = typeof item.height === 'number' ? item.height : 0;
      if (heights && height) f *= clamp(1 + height / 40, 0.55, 1.5);
      if (typeof item.depth === 'number') f *= clamp(1 - item.depth / 40, 0.5, 1);
      const px = rings.map((ring) => scaled(ring, K));
      if (!art) fillRings(c, px, withAlpha(shade(base, f), 255));
      // Costly ground has an orange rim, ground nothing crosses a red one.
      const rim =
        item.cost === 'never'
          ? [225, 90, 70, 255]
          : typeof item.cost === 'number' && item.cost >= 2
            ? [240, 170, 70, 255]
            : withAlpha(shade(base, 1.35), 200);
      px.forEach((ring) => outlineRing(c, ring, rim, 1));
      if (heights && height > 0 && !art) {
        const at = middle(px[0]);
        number(c, Math.round(height), at[0] - 4, at[1] - 4, ls);
      }
      if (height) shaded.push({ id: item.id, height });
    }
    for (const { item, lines } of g.lines) {
      if (!shown(item)) continue;
      const colour = withAlpha(LINE[item.material] || [200, 200, 200], 255);
      const width = Math.max(2, Math.round((item.width || 3) * Math.min(K.x, K.y)));
      lines.forEach((pts) => {
        for (let i = 1; i < pts.length; i++) {
          line(
            c,
            pts[i - 1][0] * K.x,
            pts[i - 1][1] * K.y,
            pts[i][0] * K.x,
            pts[i][1] * K.y,
            colour,
            width
          );
        }
      });
    }
    for (const { item, rings } of g.lights) {
      if (!item.dark || !rings || !shown(item)) continue;
      fillRings(
        c,
        rings.map((ring) => scaled(ring, K)),
        withAlpha(OTHER.dark, 140)
      );
    }
    return { heights: shaded };
  }

  /**
   * Everything standing on the floor, over the grid. `mark(type, info, x, y,
   * shape, colour)` numbers a marker (x, y in pixels) and returns its number.
   * Returns what was drawn, by list.
   */
  function paintOver(c, geometry, scale, options = {}, mark = () => 0) {
    const K = typeof scale === 'number' ? { x: scale, y: scale } : scale;
    const { hidden = true, doors = {}, skipDoors = [], skipObjects = [] } = options;
    const g = geo.compile(geometry || {});
    const shown = (item) => hidden || !g.hidden[item.id];
    const ls = labelScale(c);
    const drawn = {};
    const count = (key) => {
      drawn[key] = (drawn[key] || 0) + 1;
    };
    const at = (p) => [p[0] * K.x, p[1] * K.y];

    for (const { item, rings } of g.zones) {
      if (!shown(item) || !rings) continue;
      const px = rings.map((ring) => scaled(ring, K));
      fillRings(c, px, withAlpha(OTHER.zone, 26));
      px.forEach((ring) => outlineRing(c, ring, withAlpha(OTHER.zone, 220), 2));
      count('zones');
      if (item.name) {
        const m = middle(px[0]);
        const n = mark('zone', { id: item.id, name: item.name }, m[0], m[1], null);
        if (n) number(c, n, m[0] - 3, m[1] - 3, ls);
      }
    }
    for (const { item, rings } of g.objects) {
      if (!shown(item) || !rings) continue;
      const kind = catalog.objectKind(item.kind);
      const fill = GROUPS[kind && kind.group] || OTHER.object;
      const px = scaled(rings[0], K);
      fillRings(c, [px], withAlpha(fill, 235));
      outlineRing(c, px, withAlpha(OTHER.outline, 255), 2);
      count('objects');
      const usable = item.container || item.locked || (item.actions || []).length;
      if ((item.name || usable) && !skipObjects.includes(item.id)) {
        const m = middle(px);
        mark(
          'object',
          {
            id: item.id,
            kind: item.kind,
            ...(item.name ? { name: item.name } : {}),
            ...(usable ? { usable: true } : {}),
          },
          m[0],
          m[1],
          'square',
          withAlpha(item.locked ? OTHER.locked : fill, 255)
        );
      }
    }
    for (const { item, at: centre } of g.lights) {
      if (item.dark || !shown(item) || !centre) continue;
      const r = (item.radius || 0) * Math.min(K.x, K.y);
      fillCircle(c, centre[0] * K.x, centre[1] * K.y, r, withAlpha(OTHER.light, 38));
      if (item.dim)
        fillCircle(
          c,
          centre[0] * K.x,
          centre[1] * K.y,
          item.dim * Math.min(K.x, K.y),
          withAlpha(OTHER.light, 22)
        );
      count('lights');
      mark(
        'light',
        { id: item.id, radius: item.radius },
        centre[0] * K.x,
        centre[1] * K.y,
        'circle',
        withAlpha(OTHER.light, 255)
      );
    }
    // Walls, doors and windows as edges, doors by state (a save's, else the map's).
    const thick = Math.max(3, Math.round(0.7 * Math.min(K.x, K.y)));
    for (const e of geo.edges(g, doors)) {
      const a = at(e.a);
      const b = at(e.b);
      if (!shown(e.item)) {
        // A hidden door or window looks like the wall it stands in.
        const host = e.kind !== 'wall' && (g.openings.find((o) => o.item.id === e.id) || {}).wall;
        const wall = host && g.byId[host] && g.byId[host].item;
        if (wall && shown(wall)) {
          stroke(c, a, b, withAlpha(WALL[wall.material] || WALL.stone, 255), thick);
        }
        continue;
      }
      if (e.kind === 'wall') {
        stroke(c, a, b, withAlpha(WALL[e.item.material] || WALL.stone, 255), thick);
      } else if (e.kind === 'door') {
        const base = DOOR[e.item.material] || DOOR.wood;
        const colour = e.state === 'locked' ? OTHER.locked : base;
        stroke(
          c,
          a,
          b,
          withAlpha(colour, e.state === 'open' ? 130 : 255),
          thick + (e.state === 'open' ? 0 : 2)
        );
      } else {
        stroke(
          c,
          a,
          b,
          withAlpha(WINDOW[e.item.material] || WINDOW.glass, 255),
          Math.max(2, thick - 1)
        );
      }
    }
    for (const o of g.openings) {
      if (!shown(o.item)) continue;
      count(o.kind === 'door' ? 'doors' : 'windows');
      if (o.kind === 'door' && !skipDoors.includes(o.item.id) && o.from && o.to) {
        const m = [(o.from[0] + o.to[0]) / 2, (o.from[1] + o.to[1]) / 2];
        const state = (doors && doors[o.item.id]) || o.item.state || 'closed';
        mark(
          'door',
          {
            id: o.item.id,
            ...(o.item.name ? { name: o.item.name } : {}),
            state,
            from: o.from,
            to: o.to,
          },
          m[0] * K.x,
          m[1] * K.y,
          'square',
          withAlpha(state === 'locked' ? OTHER.locked : DOOR[o.item.material] || DOOR.wood, 255)
        );
      }
    }
    for (const { item, rings, at: centre } of g.spawns) {
      if (!shown(item)) continue;
      if (rings) {
        const px = rings.map((ring) => scaled(ring, K));
        fillRings(c, px, withAlpha(OTHER.spawn, 30));
        px.forEach((ring) => outlineRing(c, ring, withAlpha(OTHER.spawn, 230), 2));
      }
      const m = rings
        ? middle(scaled(rings[0], K))
        : centre
          ? [centre[0] * K.x, centre[1] * K.y]
          : null;
      if (!m) continue;
      count('spawns');
      mark(
        'spawn',
        {
          id: item.id,
          ...(item.name ? { name: item.name } : {}),
          ...(item.what ? { what: item.what } : { generic: true }),
          ...(item.count ? { count: item.count } : {}),
        },
        m[0],
        m[1],
        'circle',
        withAlpha(OTHER.spawn, 255)
      );
    }
    for (const { item, rings, at: centre } of g.notes) {
      if (!shown(item)) continue;
      const m = rings
        ? middle(scaled(rings[0], K))
        : centre
          ? [centre[0] * K.x, centre[1] * K.y]
          : null;
      if (!m) continue;
      count('notes');
      mark(
        'note',
        { id: item.id, text: String(item.text || '').slice(0, 60) },
        m[0],
        m[1],
        'circle',
        withAlpha(OTHER.note, 255)
      );
    }
    // What is hidden, marked: players don't see it until they find it.
    if (hidden) {
      for (const id of Object.keys(g.hidden)) {
        const found = g.byId[id];
        if (!found) continue;
        const { item } = found;
        const pt =
          item.from && item.to
            ? [(item.from[0] + item.to[0]) / 2, (item.from[1] + item.to[1]) / 2]
            : Array.isArray(item.at)
              ? item.at
              : null;
        const own = (g[found.list] || []).find((e) => e.item.id === id);
        const m = pt
          ? [pt[0] * K.x, pt[1] * K.y]
          : own && own.rings
            ? middle(scaled(own.rings[0], K))
            : own && own.lines
              ? middle(scaled(own.lines[0], K))
              : null;
        if (!m) continue;
        count('hidden');
        mark(
          'hidden',
          { id, of: found.list, ...(g.hidden[id].dc !== undefined ? { dc: g.hidden[id].dc } : {}) },
          m[0],
          m[1],
          'diamond',
          withAlpha(OTHER.hidden, 255)
        );
      }
    }
    return drawn;
  }

  return { paintUnder, paintOver };
}

module.exports = { makePainter };
