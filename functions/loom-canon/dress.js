'use strict';

/**
 * Dressing a room (planning/game-art.md §4.5, DR1; L-945 / #799): decor put
 * in a zone of a battle map from a seed, so a room built from data doesn't
 * look empty. Decor (./materials.js: rubble, bones, candles, cobwebs, sacks,
 * a pile of crates, a tapestry, a banner, a plant, books, bottles, straw, a
 * puddle, chains) only dresses: it has no click menu, is never noticed or
 * searched, and blocks the way only when it's over 2.5 ft both ways.
 *
 *   zone      the id of a zone in the map's geometry: where to put it
 *   theme     what kind of room it is, which decor suits it
 *   density   sparse, lived-in or cluttered: how much, for its size
 *   seed      a number or a word: the same seed, the same dressing
 *
 * It keeps clear of the map's doors, windows, entries, exits, features and
 * the objects it already has, and of the walls (a tapestry, a banner and
 * chains hang on one instead). And it never closes the room: a piece that
 * blocks the way is put down only if a medium character, from the room's
 * middle, still reaches every door, entry and exit of the map it could reach
 * before (./map-paths.js: the same planner a move is planned on).
 *
 *   THEMES, DENSITIES, themeNames()    what it knows
 *   dress(map, options)
 *     → { objects, zone, theme, density, seed, wanted, skipped, byKind,
 *         prefix }
 *
 * `objects` are geometry items ({ id, kind, at, size, turn?, decor: true })
 * to add to the map's `objects`; their ids start with `prefix` (the zone's
 * id and "-decor-"), so dressing the zone again, with another seed, replaces
 * them: the old ones are ignored here, and the tool removes them. Pure.
 */

const geo = require('./map-geometry');
const materials = require('./materials');
const mapPaths = require('./map-paths');
const doors = require('./doors');

const FEET = mapPaths.FEET;
const WALL_CLEAR = 1; // feet kept between floor decor and a wall
const DOOR_CLEAR = 3.5; // feet kept round a door, an entry, an exit or a feature
const OBJECT_CLEAR = 0.5; // feet kept round what's there already
const ATTEMPTS = 60; // places tried for each piece
const MEDIUM = 2.5; // the width the way through must keep, feet

// How much decor a zone gets, as pieces to each square (5 × 5 ft) of it.
const DENSITIES = Object.freeze({ sparse: 0.15, 'lived-in': 0.4, cluttered: 0.8 });

// What suits each kind of room: decor kinds with a weight.
const THEMES = Object.freeze({
  dungeon: {
    rubble: 3,
    bones: 3,
    cobwebs: 3,
    chains: 2,
    puddle: 2,
    straw: 2,
    candles: 1,
    sacks: 1,
    'crate-pile': 1,
  },
  tavern: {
    bottles: 4,
    candles: 3,
    sacks: 2,
    'crate-pile': 2,
    straw: 2,
    books: 1,
    banner: 2,
    plant: 2,
    tapestry: 2,
  },
  crypt: { bones: 4, cobwebs: 4, candles: 3, rubble: 3, chains: 2, banner: 1, puddle: 1 },
  store: {
    sacks: 4,
    'crate-pile': 3,
    bottles: 3,
    books: 2,
    banner: 1,
    plant: 1,
    straw: 2,
    tapestry: 1,
  },
  bedroom: { books: 3, candles: 3, tapestry: 3, plant: 3, bottles: 2, sacks: 1, banner: 1 },
});

const themeNames = () => Object.keys(THEMES);

// ── Small things ─────────────────────────────────────────────────────

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// A seeded stream of numbers from 0 to 1 (mulberry32).
function rng(seed) {
  let a = hash(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (n) => Math.round(n * 10) / 10;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const inRing = (p, ring) => geo.pointInShape(p, ring);
const sizeOf = (size) => (Array.isArray(size) ? size : [size, size]);

function areaOf(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    sum += ax * by - bx * ay;
  }
  return Math.abs(sum) / 2;
}

const boxOfPoints = (points) => ({
  x0: Math.min(...points.map((p) => p[0])),
  y0: Math.min(...points.map((p) => p[1])),
  x1: Math.max(...points.map((p) => p[0])),
  y1: Math.max(...points.map((p) => p[1])),
});

const boxesTouch = (a, b, pad) =>
  a.x0 <= b.x1 + pad && a.x1 >= b.x0 - pad && a.y0 <= b.y1 + pad && a.y1 >= b.y0 - pad;

// A footprint, its corners: `at` the middle, `size` [w, h], turned `turn` degrees.
function footprint(at, size, turn) {
  const a = ((turn || 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [
    [-size[0] / 2, -size[1] / 2],
    [size[0] / 2, -size[1] / 2],
    [size[0] / 2, size[1] / 2],
    [-size[0] / 2, size[1] / 2],
  ].map(([x, y]) => [at[0] + x * cos - y * sin, at[1] + x * sin + y * cos]);
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

// How far a segment is from a ring's area: 0 when it touches or lies in it.
function ringToSegment(ring, a, b) {
  if (inRing(a, ring) || inRing(b, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if (segmentsCross(a, b, p, q)) return 0;
    best = Math.min(
      best,
      geo.distanceToSegment(p, a, b),
      geo.distanceToSegment(a, p, q),
      geo.distanceToSegment(b, p, q)
    );
  }
  return best;
}

// How far a point is from a ring's edge.
function pointToEdge(p, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    best = Math.min(best, geo.distanceToSegment(p, ring[i], ring[(i + 1) % ring.length]));
  }
  return best;
}

function weighted(table, r) {
  const total = Object.values(table).reduce((s, w) => s + w, 0);
  let at = r() * total;
  for (const [kind, w] of Object.entries(table)) {
    at -= w;
    if (at < 0) return kind;
  }
  return Object.keys(table)[0];
}

// ── The room ─────────────────────────────────────────────────────────

/**
 * What the dressing has to respect: the zone's outline, the wall segments, and
 * what to keep clear of (circles: doors, windows, entries, exits, features;
 * footprints: what's there already). `ignore` is the prefix of the decor this
 * dressing replaces.
 */
function surroundings(map, g, c, zone, prefix) {
  const rings = zone.rings;
  const walls = [];
  geo.edges(c, {}).forEach((e) => {
    if (e.kind === 'wall') walls.push([e.a, e.b]);
  });
  const clear = [];
  (g.doors || []).forEach((d) => {
    const from = Array.isArray(d.from) ? d.from : [d.from.x, d.from.y];
    const to = Array.isArray(d.to) ? d.to : [d.to.x, d.to.y];
    clear.push({
      at: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2],
      r: DOOR_CLEAR + dist(from, to) / 2,
      door: true,
    });
  });
  (g.windows || []).forEach((w) => {
    const from = Array.isArray(w.from) ? w.from : [w.from.x, w.from.y];
    const to = Array.isArray(w.to) ? w.to : [w.to.x, w.to.y];
    clear.push({
      at: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2],
      r: 1.5 + dist(from, to) / 2,
      window: true,
    });
  });
  const square = (s) => [(s.x + 0.5) * FEET, (s.y + 0.5) * FEET];
  (map.entries || []).forEach((s) => clear.push({ at: square(s), r: DOOR_CLEAR }));
  (map.exits || []).forEach((s) => clear.push({ at: square(s), r: DOOR_CLEAR }));
  (map.features || []).forEach((s) => clear.push({ at: square(s), r: DOOR_CLEAR - 0.5 }));
  const taken = [];
  c.objects.forEach(({ item, rings: rs }) => {
    if (typeof item.id === 'string' && item.id.indexOf(prefix) === 0) return;
    taken.push({ ring: rs[0], box: boxOfPoints(rs[0]) });
  });
  return { rings, walls, clear, taken };
}

// Whether a footprint is wholly inside the zone.
const insideZone = (ring, rings) => ring.every((p) => rings.some((r) => inRing(p, r)));

// Whether a footprint keeps clear of what it should.
function keepsClear(ring, kind, room, put) {
  const box = boxOfPoints(ring);
  for (const k of room.clear) {
    if (k.window && !kind.onWall) continue;
    // A circle against the footprint: its nearest corner or edge.
    let nearest = Infinity;
    for (let i = 0; i < ring.length; i++) {
      nearest = Math.min(
        nearest,
        geo.distanceToSegment(k.at, ring[i], ring[(i + 1) % ring.length])
      );
    }
    if (inRing(k.at, ring) || nearest < k.r) return false;
  }
  for (const t of room.taken) {
    if (boxesTouch(box, t.box, OBJECT_CLEAR) && ringsMeet(ring, t.ring, OBJECT_CLEAR)) return false;
  }
  for (const p of put) {
    if (boxesTouch(box, p.box, 0.25) && ringsMeet(ring, p.ring, 0.25)) return false;
  }
  if (!kind.onWall) {
    for (const [a, b] of room.walls) {
      if (ringToSegment(ring, a, b) < WALL_CLEAR) return false;
    }
  }
  return true;
}

// Whether two footprints are within `pad` feet of each other.
function ringsMeet(a, b, pad) {
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    if (ringToSegment(b, p, q) < pad) return true;
  }
  return inRing(a[0], b) || inRing(b[0], a);
}

// ── Crossing the room ────────────────────────────────────────────────

// The room's heart: the open point furthest from its edge, where someone
// crossing the room has to be able to get to.
function heartOf(map, c, rings, bounds) {
  const box = boxOfPoints(rings[0]);
  let best = null;
  for (let y = box.y0; y <= box.y1; y += 1.25) {
    for (let x = box.x0; x <= box.x1; x += 1.25) {
      const p = [x, y];
      if (!rings.some((r) => inRing(p, r))) continue;
      if (!geo.fits(c, p, MEDIUM, { bounds })) continue;
      const room = Math.min(...rings.map((r) => pointToEdge(p, r)));
      if (!best || room > best.room + 1e-9) best = { p, room };
    }
  }
  return best ? best.p : null;
}

// Where the map can be entered, left and passed through: the squares either
// side of every door, and its entries and exits, as "x,y" keys. A room's
// dressing mustn't cut the room's middle off from any it could reach.
function gatesOf(map, g) {
  const out = new Set();
  const take = (s) => {
    if (s.x >= 0 && s.y >= 0 && s.x < (map.width || 0) && s.y < (map.height || 0)) {
      out.add(s.x + ',' + s.y);
    }
  };
  (g.doors || []).forEach((d) => doors.sidesOf(d).forEach(take));
  [...(map.entries || []), ...(map.exits || [])].forEach(take);
  return Array.from(out);
}

// The squares a medium character gets to from the room's heart over this
// geometry, every door passable (a locked one can be opened), by "x,y".
function reached(map, geometry, heart) {
  return mapPaths.squaresReached(
    { ...map, geometry },
    [mapPaths.squareOf({ x: heart[0], y: heart[1] })],
    {
      width: MEDIUM,
      open: () => true,
    }
  );
}

// ── Dressing ─────────────────────────────────────────────────────────

/**
 * Decor for a zone. `options`: { zone, theme, density, seed, worldKinds? }.
 * Throws an Error saying what's wrong when the zone, theme or density isn't
 * there.
 */
function dress(map, options) {
  const o = options || {};
  const g = mapPaths.geometryOf(map);
  const c = geo.compile(g);
  const zone = c.zones.find((z) => z.item.id === o.zone);
  if (!zone || !zone.rings || !zone.rings.length) {
    const ids = c.zones.map((z) => z.item.id);
    throw new Error(
      `The map has no zone "${o.zone}" (it has ${ids.length ? ids.join(', ') : 'none'}): ` +
        'make one with set_zones.'
    );
  }
  if (!Object.prototype.hasOwnProperty.call(THEMES, o.theme)) {
    throw new Error(`No theme "${o.theme}": ${themeNames().join(', ')}.`);
  }
  if (!Object.prototype.hasOwnProperty.call(DENSITIES, o.density)) {
    throw new Error(`No density "${o.density}": ${Object.keys(DENSITIES).join(', ')}.`);
  }
  const seed = o.seed === undefined ? 1 : o.seed;
  const prefix = String(o.zone).slice(0, 24) + '-decor-';
  const r = rng(`${seed}|${o.zone}|${o.theme}|${o.density}`);
  const bounds = { width: (map.width || 0) * FEET, height: (map.height || 0) * FEET };
  const room = surroundings(map, g, c, zone, prefix);
  const area = areaOf(zone.rings[0]);
  const wanted =
    area < 10 ? 0 : Math.max(1, Math.round((area / (FEET * FEET)) * DENSITIES[o.density]));

  // What stands in the room's way, for the crossing check: the geometry with
  // this dressing's old decor left out, then each blocking piece put in.
  const base = {
    ...g,
    objects: (g.objects || []).filter(
      (item) => !(typeof item.id === 'string' && item.id.indexOf(prefix) === 0)
    ),
  };
  const heart = heartOf(map, geo.compile(base), zone.rings, bounds);
  const gates = gatesOf(map, g);
  const before = heart && gates.length ? reached(map, base, heart) : {};
  const baseline = gates.map((k) => Boolean(before[k]));

  const box = boxOfPoints(zone.rings[0]);
  const objects = [];
  const put = [];
  const byKind = {};
  let skipped = 0;
  let sofar = base;
  for (let n = 0; n < wanted; n++) {
    const kindId = weighted(THEMES[o.theme], r);
    const kind = materials.objectKind(kindId);
    const size = sizeOf(materials.sizeFor(kindId, o.worldKinds) || kind.size);
    let placed = null;
    for (let attempt = 0; attempt < ATTEMPTS && !placed; attempt++) {
      let at;
      let turn;
      if (kind.onWall) {
        const pick = room.walls[Math.floor(r() * room.walls.length)];
        if (!pick) break;
        const [a, b] = pick;
        const len = dist(a, b);
        if (len < size[0] + 1) continue;
        const t = (size[0] / 2 + 0.5 + r() * (len - size[0] - 1)) / len;
        const along = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const nx = -(b[1] - a[1]) / len;
        const ny = (b[0] - a[0]) / len;
        const off = size[1] / 2 + 0.8; // flush with the wall's face
        const side = [
          [along[0] + nx * off, along[1] + ny * off],
          [along[0] - nx * off, along[1] - ny * off],
        ].find((p) => zone.rings.some((ring) => inRing(p, ring)));
        if (!side) continue;
        at = side;
        turn = Math.round((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI);
      } else {
        at = [box.x0 + r() * (box.x1 - box.x0), box.y0 + r() * (box.y1 - box.y0)];
        turn = kind.blocksMove === false ? Math.floor(r() * 24) * 15 : r() < 0.5 ? 0 : 90;
      }
      at = [round1(at[0]), round1(at[1])];
      const ring = footprint(at, size, turn);
      if (!insideZone(ring, zone.rings)) continue;
      const ground = geo.groundAt(c, at);
      if (ground && ground.cost === 'never') continue;
      if (!keepsClear(ring, kind, room, put)) continue;
      const item = {
        id: `${prefix}${objects.length + 1}`,
        kind: kindId,
        at,
        size: size.slice(),
        ...(turn ? { turn } : {}),
        decor: true,
      };
      // A piece that blocks the way mustn't close the room.
      if (geo.objectBlocksMove(item) && heart && gates.length) {
        const trial = { ...sofar, objects: [...(sofar.objects || []), item] };
        const now = reached(map, trial, heart);
        if (gates.some((k, i) => baseline[i] && !now[k])) continue;
        sofar = trial;
      }
      placed = { item, ring, box: boxOfPoints(ring) };
    }
    if (!placed) {
      skipped += 1;
      continue;
    }
    objects.push(placed.item);
    put.push({ ring: placed.ring, box: placed.box });
    byKind[kindId] = (byKind[kindId] || 0) + 1;
  }
  return {
    objects,
    zone: o.zone,
    theme: o.theme,
    density: o.density,
    seed,
    wanted,
    skipped,
    byKind,
    prefix,
  };
}

module.exports = { THEMES, DENSITIES, themeNames, dress };
