'use strict';

/**
 * Seeded map generators (planning/maps-from-data.md §4.8, AU2; L-929 /
 * #733): a first draft of a grid battle map, for Claude to name and edit with
 * the patch tools. Four kinds:
 *
 *   rooms     rooms and corridors cut into rock: a dungeon
 *   caves     a cave grown by a cellular automaton, its walls traced at angles
 *   interior  a building's ground floor in its street: rooms split from its
 *             footprint with a door between each, windows, a front door
 *   deck      a ship's deck, `style` 'sailing' (a wooden deck in deep water,
 *             low rails, masts, hatches, a stern cabin, a gangplank) or
 *             'starship' (a metal hull, a corridor down its spine,
 *             compartments either side, an engine room, a bridge in the bow,
 *             an airlock to a docking tube)
 *
 * Seeded (decided with the user 2026-11-06): the same kind, seed, size and
 * style always give the same map (a seeded generator, never Math.random).
 *
 * What comes out is ordinary data, a battle map's fields: `geometry`
 * (ground, walls, doors, windows, objects, zones, lights), one entry and one
 * exit "out", and no features. Structure and sparse dressing (the user,
 * 2026-11-06): rooms are zones with no name (`room-1`, `cabin`) for Claude to
 * name, with a light or two and a little of the catalog's furniture; no
 * hidden things or spawns, which are the builder's choices.
 *
 * Every map is playable: its geometry passes map-geometry.js's check, its
 * entry reaches its exit, and every zone, both sides of every door and every
 * square of floor are reached from the entry by a medium walker
 * (`problems`). The generators check their own output and leave out
 * furniture that would block the way; the tests check a set of seeds.
 *
 *   generate(kind, { seed, width, height, style })
 *       { kind, seed, style?, width, height, geometry, entries, exits,
 *         features, rooms, floor } (`floor`: the squares that should be
 *         walkable, by "x,y", for `problems`; not stored)
 *   problems(map, { floor })   what keeps a map from being playable
 *   KINDS, STYLES, SIZES (each kind's default and smallest), VERSION
 *
 * Pure.
 */

const geo = require('./map-geometry');
const mapPaths = require('./map-paths');
const materials = require('./materials');

const FEET = 5;
const VERSION = 1;
const MAX_SIDE = 64;
const KINDS = ['rooms', 'caves', 'interior', 'deck'];
const STYLES = { deck: ['sailing', 'starship'] };
const SIZES = {
  rooms: { width: 32, height: 32, min: { width: 16, height: 16 } },
  caves: { width: 32, height: 32, min: { width: 16, height: 16 } },
  interior: { width: 24, height: 18, min: { width: 12, height: 10 } },
  deck: { width: 36, height: 16, min: { width: 20, height: 12 } },
};

// ── Seeded randomness ──────────────────────────────────────────────────

/** A 32-bit hash of a string (FNV-1a). */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A seeded source of numbers (mulberry32): the same key, the same numbers. */
function random(key) {
  let a = hash(key) || 1;
  function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const int = (lo, hi) => (hi <= lo ? lo : lo + Math.floor(next() * (hi - lo + 1)));
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

// ── Small things ───────────────────────────────────────────────────────

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round3 = (v) => Math.round(v * 1000) / 1000;
const keyOf = (x, y) => x + ',' + y;
const ft = (p) => [round3(p[0] * FEET), round3(p[1] * FEET)];

/** Ids by kind: wall-1, wall-2, door-1… */
function idMaker() {
  const n = {};
  return (prefix) => {
    n[prefix] = (n[prefix] || 0) + 1;
    return prefix + '-' + n[prefix];
  };
}

/** A rectangle of squares as a shape in feet. */
const rectShape = (x, y, w, h) => ({
  rect: { x: x * FEET, y: y * FEET, w: w * FEET, h: h * FEET },
});

/** Rectangles of squares as one shape's path data (they never overlap). */
const rectsPath = (rects) =>
  rects
    .map(
      ([x, y, w, h]) => `M${x * FEET} ${y * FEET}H${(x + w) * FEET}V${(y + h) * FEET}H${x * FEET}Z`
    )
    .join('');

/** A closed ring of points in feet as path data. */
const ringPath = (points) =>
  points.map((p, i) => (i ? 'L' : 'M') + round3(p[0]) + ' ' + round3(p[1])).join('') + 'Z';

/** The squares `inside` holds, merged into rectangles: [[x, y, w, h]]. */
function cellRects(W, H, inside) {
  const out = [];
  let open = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; ) {
      if (!inside(x, y)) {
        x++;
        continue;
      }
      let e = x;
      while (e < W && inside(e, y)) e++;
      row.push([x, e - x]);
      x = e;
    }
    const next = [];
    for (const [x, w] of row) {
      const i = open.findIndex((r) => r.x === x && r.w === w);
      if (i >= 0) {
        const r = open.splice(i, 1)[0];
        r.h++;
        next.push(r);
      } else next.push({ x, y, w, h: 1 });
    }
    out.push(...open);
    open = next;
  }
  out.push(...open);
  return out.map((r) => [r.x, r.y, r.w, r.h]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** Drops the points of a polyline that lie straight between their neighbours. */
function simplify(points) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-9) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Segments joined end to end into polylines: through every point two
 * segments share, so a wall runs on round its corners and stops where three
 * or more meet; loops come back to where they began. Straight runs are one
 * segment each, so a door or window set on any stretch of one lies on a
 * single straight run of its wall, as map-geometry.js asks.
 */
function chain(segments) {
  const pk = (p) => round3(p[0]) + ',' + round3(p[1]);
  const at = new Map();
  segments.forEach((s, i) => {
    for (const p of s) {
      const k = pk(p);
      if (!at.has(k)) at.set(k, { point: p, list: [] });
      at.get(k).list.push(i);
    }
  });
  const used = new Array(segments.length).fill(false);
  const lines = [];
  const walk = (start, first) => {
    const points = [start];
    let p = start;
    let seg = first;
    while (seg !== undefined) {
      used[seg] = true;
      const s = segments[seg];
      const q = pk(s[0]) === pk(p) ? s[1] : s[0];
      points.push(q);
      p = q;
      const here = at.get(pk(q)).list;
      if (here.length !== 2) break;
      seg = here.find((j) => !used[j]);
    }
    return simplify(points);
  };
  for (const { point, list } of at.values()) {
    if (list.length === 2) continue;
    for (const i of list) if (!used[i]) lines.push(walk(point, i));
  }
  segments.forEach((s, i) => {
    if (!used[i]) lines.push(walk(s[0], i));
  });
  return lines;
}

// ── Walls between squares ──────────────────────────────────────────────

// An edge between squares, in corners: 'h' along line y from x to x + 1
// (between squares (x, y - 1) and (x, y)), 'v' along line x from y to y + 1
// (between squares (x - 1, y) and (x, y)).
const edgeKey = (dir, x, y) => dir + x + ',' + y;
function edgeEnds(key) {
  const [x, y] = key.slice(1).split(',').map(Number);
  return key[0] === 'h'
    ? [
        [x, y],
        [x + 1, y],
      ]
    : [
        [x, y],
        [x, y + 1],
      ];
}

/**
 * The walls between squares: every edge where `material(a, b)` (the labels
 * of the squares either side, null off the map) names a material, or that
 * `forced` holds (key → material), once each, joined into polylines.
 * `{ material: [[points in corners]] }`, and `edges`, the set of walled
 * edges.
 */
function cellWalls(W, H, labelAt, material, forced = new Map()) {
  const groups = new Map();
  const edges = new Map();
  const add = (key, m) => {
    edges.set(key, m);
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(edgeEnds(key));
  };
  const lab = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : labelAt(x, y));
  for (let y = 0; y <= H; y++) {
    for (let x = 0; x < W; x++) {
      const key = edgeKey('h', x, y);
      const m = material(lab(x, y - 1), lab(x, y)) || forced.get(key);
      if (m) add(key, m);
    }
  }
  for (let x = 0; x <= W; x++) {
    for (let y = 0; y < H; y++) {
      const key = edgeKey('v', x, y);
      const m = material(lab(x - 1, y), lab(x, y)) || forced.get(key);
      if (m) add(key, m);
    }
  }
  const lines = [];
  for (const [m, segs] of groups) for (const line of chain(segs)) lines.push({ material: m, line });
  return { lines, edges };
}

/** How many walled edges meet at a corner. */
function cornerDegree(edges, x, y) {
  return [
    edgeKey('h', x - 1, y),
    edgeKey('h', x, y),
    edgeKey('v', x, y - 1),
    edgeKey('v', x, y),
  ].filter((k) => edges.has(k)).length;
}

/**
 * Whether the wall an edge lies in runs on straight past both its ends, with
 * no corner or junction there: where a door or window looks right.
 */
function straightThrough(edges, key) {
  const [x, y] = key.slice(1).split(',').map(Number);
  const h = key[0] === 'h';
  const before = h ? edgeKey('h', x - 1, y) : edgeKey('v', x, y - 1);
  const after = h ? edgeKey('h', x + 1, y) : edgeKey('v', x, y + 1);
  return (
    edges.has(before) &&
    edges.has(after) &&
    edgeEnds(key).every(([cx, cy]) => cornerDegree(edges, cx, cy) === 2)
  );
}

/** The two squares either side of an edge. */
function sidesOf(key) {
  const [x, y] = key.slice(1).split(',').map(Number);
  return key[0] === 'h'
    ? [
        [x, y - 1],
        [x, y],
      ]
    : [
        [x - 1, y],
        [x, y],
      ];
}

/** A door or window on an edge: its ends in feet. */
const onEdge = (key) => {
  const [a, b] = edgeEnds(key);
  return { from: ft(a), to: ft(b) };
};

// ── Furniture ──────────────────────────────────────────────────────────

const KIND = Object.fromEntries(materials.OBJECT_KINDS.map((k) => [k.id, k]));
const blocks = (o) =>
  o.blocksMove !== undefined ? o.blocksMove !== false : KIND[o.kind].blocksMove !== false;

/**
 * Places objects against walls and in rooms, never on a square `busy` holds
 * and never over another: `against(room, kind, how)` puts one flush against
 * a wall of a room ({ x, y, w, h } in squares) where `walled(key)` says a
 * wall runs; `at(kind, point, turn)` puts one at a point in feet. Each
 * returns the object, or null when nothing fits.
 */
function furnisher(r, id, objects, { busy, walled, inside }) {
  const taken = new Set();
  const footprint = (kind, turn) => {
    const [w, h] = KIND[kind].size;
    return turn === 90 ? [h, w] : [w, h];
  };
  const cellsUnder = (cx, cy, fw, fh) => {
    const out = [];
    for (
      let x = Math.floor((cx - fw / 2) / FEET);
      x <= Math.floor((cx + fw / 2 - 1e-6) / FEET);
      x++
    ) {
      for (
        let y = Math.floor((cy - fh / 2) / FEET);
        y <= Math.floor((cy + fh / 2 - 1e-6) / FEET);
        y++
      ) {
        out.push(keyOf(x, y));
      }
    }
    return out;
  };
  const fitsAt = (cx, cy, fw, fh, room, share) => {
    if (room) {
      const m = 0.2;
      if (
        cx - fw / 2 < room.x * FEET + m - 1e-6 ||
        cx + fw / 2 > (room.x + room.w) * FEET - m + 1e-6
      )
        return null;
      if (
        cy - fh / 2 < room.y * FEET + m - 1e-6 ||
        cy + fh / 2 > (room.y + room.h) * FEET - m + 1e-6
      )
        return null;
    }
    const cells = cellsUnder(cx, cy, fw, fh);
    if (cells.some((k) => busy.has(k) || (!share && taken.has(k)) || (inside && !inside(k)))) {
      return null;
    }
    return cells;
  };
  const put = (kind, cx, cy, turn, cells, extra) => {
    for (const k of cells) taken.add(k);
    const o = { id: id(kind), kind, at: [round3(cx), round3(cy)], size: KIND[kind].size.slice() };
    // Play reads an object's own flag (map-paths.js), so a rug or a hatch
    // says it is walked over.
    if (KIND[kind].blocksMove === false) o.blocksMove = false;
    if (turn) o.turn = turn;
    Object.assign(o, extra || {});
    objects.push(o);
    return o;
  };
  // Against a wall: `how` 'along' (its long side to the wall) or 'across'
  // (its end to it: a bed's head).
  function against(room, kind, how = 'along', extra) {
    const spots = [];
    for (let x = room.x; x < room.x + room.w; x++) {
      spots.push({ x, y: room.y, side: 'top' });
      spots.push({ x, y: room.y + room.h - 1, side: 'bottom' });
    }
    for (let y = room.y; y < room.y + room.h; y++) {
      spots.push({ x: room.x, y, side: 'left' });
      spots.push({ x: room.x + room.w - 1, y, side: 'right' });
    }
    for (const s of r.shuffle(spots)) {
      const wallKey =
        s.side === 'top'
          ? edgeKey('h', s.x, s.y)
          : s.side === 'bottom'
            ? edgeKey('h', s.x, s.y + 1)
            : s.side === 'left'
              ? edgeKey('v', s.x, s.y)
              : edgeKey('v', s.x + 1, s.y);
      if (!walled(wallKey)) continue;
      const [w, h] = KIND[kind].size;
      const longX = w >= h;
      const horizontalWall = s.side === 'top' || s.side === 'bottom';
      // Along: the long side parallel to the wall; across: at right angles.
      const turn = (how === 'along') === (horizontalWall === longX) ? 0 : 90;
      const [fw, fh] = footprint(kind, turn);
      let cx = (s.x + 0.5) * FEET;
      let cy = (s.y + 0.5) * FEET;
      if (s.side === 'top') cy = s.y * FEET + fh / 2 + 0.25;
      if (s.side === 'bottom') cy = (s.y + 1) * FEET - fh / 2 - 0.25;
      if (s.side === 'left') cx = s.x * FEET + fw / 2 + 0.25;
      if (s.side === 'right') cx = (s.x + 1) * FEET - fw / 2 - 0.25;
      const cells = fitsAt(cx, cy, fw, fh, room);
      if (cells) return put(kind, cx, cy, turn, cells, extra);
    }
    return null;
  }
  // At a point; `share` lets it stand in squares something else has (a
  // table's chairs).
  function at(kind, point, turn = 0, room, extra, share = false) {
    const [fw, fh] = footprint(kind, turn);
    const cells = fitsAt(point[0], point[1], fw, fh, room, share);
    return cells ? put(kind, point[0], point[1], turn, cells, extra) : null;
  }
  return { against, at };
}

/** A light where an object stands, named after it so it goes with it. */
const lightAt = (o, radius) => ({ id: o.id + '-light', at: o.at.slice(), radius });

// ── Playable ───────────────────────────────────────────────────────────

/** Whether a point lies inside rings, even-odd (a ring inside another is a hole). */
function inRings(p, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (
        a[1] > p[1] !== b[1] > p[1] &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** The squares whose centres a compiled shape's rings hold. */
function squaresIn(rings, W, H) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  const out = [];
  for (
    let y = Math.max(0, Math.floor(y0 / FEET));
    y <= Math.min(H - 1, Math.floor(y1 / FEET));
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(x0 / FEET));
      x <= Math.min(W - 1, Math.floor(x1 / FEET));
      x++
    ) {
      if (inRings([(x + 0.5) * FEET, (y + 0.5) * FEET], rings)) out.push(keyOf(x, y));
    }
  }
  return out;
}

/**
 * What keeps a map from being playable, as sentences ([] when it is): its
 * geometry's faults (map-geometry.js), an exit its entries don't reach, a
 * zone none of whose squares is reached, a door with a side not reached, and
 * (given `floor`, squares by "x,y") a square of floor not reached that
 * nothing stands on. Reached as squaresReached says (a medium walker, doors
 * not locked opened).
 */
function problems(map, { floor } = {}) {
  const out = [];
  const g = map.geometry || {};
  const bounds = { width: map.width * FEET, height: map.height * FEET };
  out.push(...geo.check(g, bounds));
  if (out.length) return out;
  if (!(map.entries || []).length) out.push('It has no entry.');
  if (!(map.exits || []).length) out.push('It has no exit.');
  if (out.length) return out;
  const reached = mapPaths.squaresReached(map, map.entries);
  for (const e of map.exits) {
    if (!reached[keyOf(e.x, e.y)]) {
      out.push(`The exit ${e.id} at (${e.x}, ${e.y}) can’t be reached from the entry.`);
    }
  }
  const c = geo.compile(g);
  for (const z of c.zones) {
    if (!squaresIn(z.rings || [], map.width, map.height).some((k) => reached[k])) {
      out.push(`No square of the zone ${z.item.id} can be reached.`);
    }
  }
  for (const o of c.openings) {
    if (o.kind !== 'door') continue;
    const mid = [(o.from[0] + o.to[0]) / 2, (o.from[1] + o.to[1]) / 2];
    const len = Math.hypot(o.to[0] - o.from[0], o.to[1] - o.from[1]) || 1;
    const n = [-(o.to[1] - o.from[1]) / len, (o.to[0] - o.from[0]) / len];
    for (const s of [1, -1]) {
      const x = Math.floor((mid[0] + n[0] * s * 2.5) / FEET);
      const y = Math.floor((mid[1] + n[1] * s * 2.5) / FEET);
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      if (!reached[keyOf(x, y)]) {
        out.push(`The door ${o.item.id} leads to (${x}, ${y}), which can’t be reached.`);
      }
    }
  }
  if (floor) {
    const solid = c.objects.filter((o) => blocks(o.item));
    for (const k of floor) {
      if (reached[k]) continue;
      const [x, y] = k.split(',').map(Number);
      const p = [(x + 0.5) * FEET, (y + 0.5) * FEET];
      if (solid.some((o) => inRings(p, o.rings))) continue;
      out.push(`The square (${x}, ${y}) can’t be reached.`);
    }
  }
  return out;
}

/**
 * Takes away the furniture that keeps a map from being playable, the last
 * placed first (and its light), until nothing does: what is still wrong
 * after the last of it is gone is the generator's fault, and returned.
 */
function settle(map, floor) {
  const g = map.geometry;
  const faults = geo.check(g, { width: map.width * FEET, height: map.height * FEET });
  if (faults.length) return { problems: faults, removed: [] };
  let found = problems(map, { floor });
  const removed = [];
  while (found.length && (g.objects || []).some(blocks)) {
    const i = g.objects.map(blocks).lastIndexOf(true);
    const [gone] = g.objects.splice(i, 1);
    removed.push(gone.id);
    g.lights = (g.lights || []).filter((l) => l.id !== gone.id + '-light');
    found = problems(map, { floor });
  }
  return { problems: found, removed };
}

// ── Rooms and corridors ────────────────────────────────────────────────

function rooms(r, W, H) {
  const id = idMaker();
  const room = new Int16Array(W * H);
  const corridor = new Uint8Array(W * H);
  const at = (x, y) => y * W + x;
  const list = [];
  const target = clamp(Math.round((W * H) / 90), 4, 18);
  const maxW = clamp(Math.floor(W / 3), 3, 9);
  const maxH = clamp(Math.floor(H / 3), 3, 8);
  for (let tries = 0; tries < target * 40 && list.length < target; tries++) {
    const w = r.int(3, maxW);
    const h = r.int(3, maxH);
    const x = r.int(1, W - w - 1);
    const y = r.int(1, H - h - 1);
    const clash = list.some(
      (o) => x < o.x + o.w + 1 && o.x < x + w + 1 && y < o.y + o.h + 1 && o.y < y + h + 1
    );
    if (!clash) list.push({ x, y, w, h });
  }
  if (list.length < 2) {
    list.length = 0;
    list.push({ x: 1, y: 1, w: 3, h: 3 }, { x: W - 4, y: H - 4, w: 3, h: 3 });
  }
  list.forEach((o, i) => {
    o.cx = o.x + Math.floor(o.w / 2);
    o.cy = o.y + Math.floor(o.h / 2);
    for (let x = o.x; x < o.x + o.w; x++)
      for (let y = o.y; y < o.y + o.h; y++) room[at(x, y)] = i + 1;
  });

  // Joined by the shortest tree between them, and a few loops.
  const n = list.length;
  const dist = (a, b) => Math.abs(list[a].cx - list[b].cx) + Math.abs(list[a].cy - list[b].cy);
  const joins = [];
  const inTree = [0];
  while (inTree.length < n) {
    let best = null;
    for (const i of inTree) {
      for (let j = 0; j < n; j++) {
        if (inTree.includes(j)) continue;
        if (!best || dist(i, j) < best.d) best = { i, j, d: dist(i, j) };
      }
    }
    joins.push([best.i, best.j]);
    inTree.push(best.j);
  }
  let loops = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (loops >= Math.ceil(n / 4)) break;
      if (joins.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) continue;
      if (dist(i, j) <= (W + H) / 3 && r.chance(0.12)) {
        joins.push([i, j]);
        loops++;
      }
    }
  }
  const carve = (x, y) => {
    if (!room[at(x, y)]) corridor[at(x, y)] = 1;
  };
  for (const [a, b] of joins) {
    const A = list[a];
    const B = list[b];
    const step = (from, to) => (to >= from ? 1 : -1);
    if (r.chance(0.5)) {
      for (let x = A.cx; x !== B.cx + step(A.cx, B.cx); x += step(A.cx, B.cx)) carve(x, A.cy);
      for (let y = A.cy; y !== B.cy + step(A.cy, B.cy); y += step(A.cy, B.cy)) carve(B.cx, y);
    } else {
      for (let y = A.cy; y !== B.cy + step(A.cy, B.cy); y += step(A.cy, B.cy)) carve(A.cx, y);
      for (let x = A.cx; x !== B.cx + step(A.cx, B.cx); x += step(A.cx, B.cx)) carve(x, B.cy);
    }
  }
  const floorAt = (x, y) =>
    x >= 0 && y >= 0 && x < W && y < H && (room[at(x, y)] > 0 || corridor[at(x, y)] > 0);

  // Doors where a corridor meets a room through a gap in its wall.
  const wallMaterial = r.pick(['stone', 'stone', 'brick', 'rock']);
  const doorEdges = [];
  const mouths = new Set();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!corridor[at(x, y)]) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const rx = x - dx;
        const ry = y - dy;
        if (rx < 0 || ry < 0 || rx >= W || ry >= H || !room[at(rx, ry)]) continue;
        mouths.add(keyOf(rx, ry));
        // The corridor's own sides are rock, so walls run either side of it.
        const [sx, sy] = [dy, dx];
        if (floorAt(x + sx, y + sy) || floorAt(x - sx, y - sy)) continue;
        const key = dx !== 0 ? edgeKey('v', Math.max(x, rx), y) : edgeKey('h', x, Math.max(y, ry));
        doorEdges.push(key);
      }
    }
  }
  const forced = new Map();
  const doors = [];
  for (const key of doorEdges) {
    if (!r.chance(0.6)) continue;
    forced.set(key, wallMaterial);
    const door = {
      id: id('door'),
      material: r.pick(['wood', 'wood', 'wood', 'iron']),
      ...onEdge(key),
    };
    if (r.chance(0.2)) door.state = 'open';
    doors.push(door);
  }
  const label = (x, y) => (room[at(x, y)] ? 'r' : corridor[at(x, y)] ? 'c' : 0);
  const { lines, edges } = cellWalls(
    W,
    H,
    label,
    (a, b) => (Boolean(a) !== Boolean(b) ? wallMaterial : null),
    forced
  );
  const walls = lines.map((l) => ({
    id: id('wall'),
    material: l.material,
    points: l.line.map(ft),
  }));

  const floorMaterial = r.pick(['flagstone', 'flagstone', 'stone', 'tile']);
  const corridorRects = cellRects(W, H, (x, y) => corridor[at(x, y)] > 0);
  const ground = [
    { id: 'rock', material: 'rock', shape: rectShape(0, 0, W, H) },
    ...list.map((o, i) => ({
      id: 'floor-' + (i + 1),
      material: floorMaterial,
      shape: rectShape(o.x, o.y, o.w, o.h),
    })),
  ];
  if (corridorRects.length) {
    ground.push({ id: 'corridors', material: 'stone', shape: rectsPath(corridorRects) });
  }
  const zones = list.map((o, i) => ({
    id: 'room-' + (i + 1),
    shape: rectShape(o.x, o.y, o.w, o.h),
  }));

  // In and out: the two rooms farthest apart.
  let pair = [0, 1];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) if (dist(i, j) > dist(pair[0], pair[1])) pair = [i, j];
  }
  const [inRoom, outRoom] = r.chance(0.5) ? pair : [pair[1], pair[0]];
  const entries = [{ id: 'way-in', x: list[inRoom].cx, y: list[inRoom].cy }];
  const exits = [
    { id: 'way-out', name: 'the way out', x: list[outRoom].cx, y: list[outRoom].cy, to: 'out' },
  ];

  // Dressing: braziers lighting a room or two, a chest, a shrine, pillars in
  // the great rooms.
  const busy = new Set();
  const around = (k) => {
    const [x, y] = k.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) busy.add(keyOf(x + dx, y + dy));
  };
  for (const k of mouths) around(k);
  for (const p of [...entries, ...exits]) around(keyOf(p.x, p.y));
  const objects = [];
  const lights = [];
  const furnish = furnisher(r, id, objects, {
    busy,
    walled: (key) => edges.has(key),
  });
  const order = r.shuffle(list.map((_, i) => i));
  for (const i of order.slice(0, Math.min(2, n))) {
    const o = furnish.against(list[i], 'brazier');
    if (o) lights.push(lightAt(o, 25));
  }
  const chestRoom = order.find((i) => i !== inRoom);
  if (chestRoom !== undefined) furnish.against(list[chestRoom], 'chest', 'along');
  if (r.chance(0.6)) {
    const shrine = order.find((i) => i !== inRoom && i !== chestRoom);
    if (shrine !== undefined)
      furnish.against(list[shrine], r.pick(['altar', 'statue', 'sarcophagus']), 'along');
  }
  for (const o of list) {
    if (o.w < 6 || o.h < 6) continue;
    for (const [px, py] of [
      [o.x + 1, o.y + 1],
      [o.x + o.w - 2, o.y + 1],
      [o.x + 1, o.y + o.h - 2],
      [o.x + o.w - 2, o.y + o.h - 2],
    ]) {
      furnish.at('pillar', [(px + 0.5) * FEET, (py + 0.5) * FEET], 0, o);
    }
  }

  const floor = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (floorAt(x, y)) floor.push(keyOf(x, y));
  return {
    geometry: { ground, walls, doors, objects, zones, lights },
    entries,
    exits,
    rooms: n,
    floor,
  };
}

// ── Caves ──────────────────────────────────────────────────────────────

/**
 * The outline of the open squares, traced by marching squares between their
 * centres: along the grid lines where a side runs straight, cut at 45° across
 * a corner. Squares that only touch at a corner are kept apart. Segments in
 * feet.
 */
function traceOpen(W, H, isOpen) {
  const segs = [];
  const o = (x, y) => (x >= 0 && y >= 0 && x < W && y < H && isOpen(x, y) ? 1 : 0);
  for (let j = -1; j < H; j++) {
    for (let i = -1; i < W; i++) {
      const a = o(i, j);
      const b = o(i + 1, j);
      const c = o(i + 1, j + 1);
      const d = o(i, j + 1);
      const index = a * 8 + b * 4 + c * 2 + d;
      if (index === 0 || index === 15) continue;
      // Midpoints of the square's sides (between the centres), in feet.
      const T = [(i + 1) * FEET, (j + 0.5) * FEET];
      const R = [(i + 1.5) * FEET, (j + 1) * FEET];
      const B = [(i + 1) * FEET, (j + 1.5) * FEET];
      const L = [(i + 0.5) * FEET, (j + 1) * FEET];
      const cases = {
        8: [[L, T]],
        4: [[T, R]],
        2: [[R, B]],
        1: [[B, L]],
        12: [[L, R]],
        6: [[T, B]],
        3: [[L, R]],
        9: [[T, B]],
        7: [[L, T]],
        11: [[T, R]],
        13: [[R, B]],
        14: [[B, L]],
        10: [
          [L, T],
          [R, B],
        ],
        5: [
          [T, R],
          [B, L],
        ],
      };
      for (const s of cases[index]) segs.push(s);
    }
  }
  return segs;
}

function caves(r, W, H) {
  const id = idMaker();
  const at = (x, y) => y * W + x;
  const inner = (W - 2) * (H - 2);
  let open = null;
  const grow = () => {
    let cells = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) cells[at(x, y)] = r.next() >= 0.45 ? 1 : 0;
    // Closed where most of its neighbours are; for the first rounds also
    // where hardly anything near it is, which leaves pillars standing in the
    // open (the cellular automaton cave method).
    const closedNear = (x, y, d) => {
      let n = 0;
      for (let dy = -d; dy <= d; dy++) {
        for (let dx = -d; dx <= d; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !cells[at(nx, ny)]) n++;
        }
      }
      return n;
    };
    for (let round = 0; round < 7; round++) {
      const next = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const closed = closedNear(x, y, 1) >= 5 || (round < 4 && closedNear(x, y, 2) <= 2);
          next[at(x, y)] = closed ? 0 : 1;
        }
      }
      cells = next;
    }
    return cells;
  };
  // The biggest stretch of open squares joined side to side; the rest filled.
  const keepBiggest = (cells) => {
    const seen = new Int32Array(W * H).fill(-1);
    let best = -1;
    let bestSize = 0;
    let region = 0;
    for (let s = 0; s < W * H; s++) {
      if (!cells[s] || seen[s] >= 0) continue;
      const queue = [s];
      seen[s] = region;
      for (let k = 0; k < queue.length; k++) {
        const q = queue[k];
        const x = q % W;
        const y = (q - x) / W;
        for (const [nx, ny] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const t = at(nx, ny);
          if (cells[t] && seen[t] < 0) {
            seen[t] = region;
            queue.push(t);
          }
        }
      }
      if (queue.length > bestSize) {
        bestSize = queue.length;
        best = region;
      }
      region++;
    }
    for (let s = 0; s < W * H; s++) if (seen[s] !== best) cells[s] = 0;
    return bestSize;
  };
  for (let attempt = 0; attempt < 12; attempt++) {
    const cells = grow();
    if (keepBiggest(cells) >= 0.3 * inner) {
      open = cells;
      break;
    }
  }
  if (!open) {
    // A plain cavern, if the automaton never grows a big enough one.
    open = new Uint8Array(W * H);
    const cx = (W - 1) / 2;
    const cy = (H - 1) / 2;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (((x - cx) / (cx - 1)) ** 2 + ((y - cy) / (cy - 1)) ** 2 < 1) open[at(x, y)] = 1;
      }
    }
  }
  const isOpen = (x, y) => open[at(x, y)] > 0;
  const roomy = (x, y, d) => {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !isOpen(nx, ny)) return false;
      }
    }
    return true;
  };

  // The way in: the roomiest square nearest the middle of the west side.
  let entry = null;
  for (const need of [1, 0]) {
    for (let x = 1; x < W - 1 && !entry; x++) {
      let best = null;
      for (let y = 1; y < H - 1; y++) {
        if (!roomy(x, y, need)) continue;
        if (!best || Math.abs(y - H / 2) < Math.abs(best.y - H / 2)) best = { x, y };
      }
      entry = best;
    }
    if (entry) break;
  }

  // Walls traced round the open squares; any square the walk can't reach is
  // filled, and the walls traced again, until every open square is reached.
  const material = r.pick(['rock', 'rock', 'stone', 'ice']);
  // Not rock, which the rock round it already is.
  const floorMaterial = material === 'ice' ? 'snow' : r.pick(['dirt', 'dirt', 'gravel']);
  const build = () => {
    const loops = chain(traceOpen(W, H, isOpen));
    return {
      walls: loops.map((line) => ({ id: id('wall'), material, points: line })),
      floorShape: loops.map((line) => ringPath(line.slice(0, -1))).join(''),
    };
  };
  let shape = null;
  for (let round = 0; round < 10; round++) {
    shape = build();
    const map = {
      width: W,
      height: H,
      geometry: { walls: shape.walls },
      entries: [{ id: 'way-in', x: entry.x, y: entry.y }],
      exits: [],
    };
    const reached = mapPaths.squaresReached(map, map.entries);
    let changed = false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (isOpen(x, y) && !reached[keyOf(x, y)]) {
          open[at(x, y)] = 0;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  // Ids again from 1, now the walls have settled.
  const ids = idMaker();
  shape.walls.forEach((w) => {
    w.id = ids('wall');
  });

  // The way out: the open square farthest from the way in, walking.
  const far = new Int32Array(W * H).fill(-1);
  far[at(entry.x, entry.y)] = 0;
  const queue = [at(entry.x, entry.y)];
  let exit = entry;
  let exitScore = -1;
  for (let k = 0; k < queue.length; k++) {
    const q = queue[k];
    const x = q % W;
    const y = (q - x) / W;
    const score = far[q] * 10 + (roomy(x, y, 1) ? 5 : 0);
    if (score > exitScore) {
      exitScore = score;
      exit = { x, y };
    }
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !isOpen(nx, ny) || far[at(nx, ny)] >= 0)
        continue;
      far[at(nx, ny)] = far[q] + 1;
      queue.push(at(nx, ny));
    }
  }
  const entries = [{ id: 'way-in', x: entry.x, y: entry.y }];
  const exits = [{ id: 'way-out', name: 'the way out', x: exit.x, y: exit.y, to: 'out' }];

  const ground = [
    { id: 'rock', material: 'rock', shape: rectShape(0, 0, W, H) },
    { id: 'cave-floor', material: floorMaterial, shape: shape.floorShape },
  ];
  const objects = [];
  const lights = [];
  const busy = new Set();
  for (const p of [entry, exit]) {
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) busy.add(keyOf(p.x + dx, p.y + dy));
  }
  const wide = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (roomy(x, y, 1) && !busy.has(keyOf(x, y))) wide.push({ x, y });
  const spots = r.shuffle(wide);
  const used = new Set();
  const claim = (s, d) => {
    for (let dx = -d; dx <= d; dx++) {
      for (let dy = -d; dy <= d; dy++) if (used.has(keyOf(s.x + dx, s.y + dy))) return false;
    }
    for (let dx = -d; dx <= d; dx++)
      for (let dy = -d; dy <= d; dy++) used.add(keyOf(s.x + dx, s.y + dy));
    return true;
  };
  const centreOf = (s) => [(s.x + 0.5) * FEET, (s.y + 0.5) * FEET];
  const furnish = furnisher(r, id, objects, { busy: new Set(), walled: () => false });
  // A pool, a campfire, a boulder or two.
  if (material !== 'ice') {
    const pool = spots.find((s) => claim(s, 2));
    if (pool) {
      ground.push({
        id: 'pool',
        material: 'water',
        shape: { circle: { x: centreOf(pool)[0], y: centreOf(pool)[1], r: 5 } },
        depth: 2,
        cost: 2,
      });
    }
  }
  const fire = spots.find((s) => claim(s, 2));
  if (fire) {
    const o = furnish.at('campfire', centreOf(fire));
    if (o) lights.push(lightAt(o, 25));
  }
  const boulders = clamp(Math.round(wide.length / 120), 1, 4);
  for (let k = 0; k < boulders; k++) {
    const s = spots.find((t) => roomy(t.x, t.y, 2) && claim(t, 2));
    if (s) furnish.at('boulder', centreOf(s), r.int(0, 3) * 30);
  }

  const floor = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isOpen(x, y)) floor.push(keyOf(x, y));
  return {
    geometry: { ground, walls: shape.walls, objects, lights },
    entries,
    exits,
    rooms: 0,
    floor,
  };
}

// ── A building's interior ──────────────────────────────────────────────

function interior(r, W, H) {
  const id = idMaker();
  const m = 2;
  const x0 = m;
  const y0 = m;
  const fw = W - 2 * m;
  const fh = H - 2 * m;
  const MIN = 3;
  const leaves = [];
  const splits = [];
  // Rooms of up to 30 to 50 squares in a house; a big building has bigger
  // rooms, ten or so, not a warren.
  const limit = Math.max(r.int(30, 50), Math.round((fw * fh) / 7));
  function split(x, y, w, h, depth) {
    const canV = w >= 2 * MIN;
    const canH = h >= 2 * MIN;
    if ((!canV && !canH) || (depth > 0 && w * h <= limit) || depth > 6) {
      leaves.push({ x, y, w, h });
      return;
    }
    const vertical = canV && (!canH || w > h || (w === h && r.chance(0.5)));
    if (vertical) {
      const c = r.int(x + MIN, x + w - MIN);
      splits.push({ axis: 'v', at: c, from: y, to: y + h });
      split(x, y, c - x, h, depth + 1);
      split(c, y, x + w - c, h, depth + 1);
    } else {
      const c = r.int(y + MIN, y + h - MIN);
      splits.push({ axis: 'h', at: c, from: x, to: x + w });
      split(x, y, w, c - y, depth + 1);
      split(x, c, w, y + h - c, depth + 1);
    }
  }
  split(x0, y0, fw, fh, 0);
  const leafOf = new Int16Array(W * H);
  leaves.forEach((o, i) => {
    for (let x = o.x; x < o.x + o.w; x++)
      for (let y = o.y; y < o.y + o.h; y++) leafOf[y * W + x] = i + 1;
  });
  const label = (x, y) => leafOf[y * W + x];
  const outer = r.pick(['stone', 'brick', 'brick', 'wood']);
  const material = (a, b) => {
    if (a === null || b === null || a === b) return null;
    if (a === 0 || b === 0) return outer;
    return 'wood';
  };
  const { lines, edges } = cellWalls(W, H, label, material);
  const walls = lines.map((l) => ({
    id: id('wall'),
    material: l.material,
    points: l.line.map(ft),
  }));

  // A door in each split, so every room is reached; the front door on the
  // street side.
  const doorKeys = [];
  for (const s of splits) {
    const all = [];
    for (let t = s.from; t < s.to; t++)
      all.push(s.axis === 'v' ? edgeKey('v', s.at, t) : edgeKey('h', t, s.at));
    const good = all.filter((k) => straightThrough(edges, k));
    doorKeys.push(r.pick(good.length ? good : all));
  }
  const frontAll = [];
  for (let x = x0; x < x0 + fw; x++) frontAll.push(edgeKey('h', x, y0 + fh));
  const frontGood = frontAll.filter((k) => straightThrough(edges, k));
  // Near the middle of the street side.
  const mid = x0 + fw / 2;
  const byMiddle = (frontGood.length ? frontGood : frontAll)
    .slice()
    .sort(
      (a, b) => Math.abs(edgeEnds(a)[0][0] + 0.5 - mid) - Math.abs(edgeEnds(b)[0][0] + 0.5 - mid)
    );
  const front = r.pick(byMiddle.slice(0, Math.max(1, Math.ceil(byMiddle.length / 3))));
  const doors = doorKeys.map((k) => ({ id: id('door'), material: 'wood', ...onEdge(k) }));
  doors.push({
    id: 'front-door',
    material: outer === 'wood' ? 'wood' : r.pick(['wood', 'iron']),
    name: 'the front door',
    ...onEdge(front),
  });

  // Windows: one in each room's outside wall, where it runs straight.
  const glass = r.pick(['glass', 'shutters']);
  const near = new Set();
  const markNear = (k) => {
    for (const [x, y] of edgeEnds(k)) near.add(keyOf(x, y));
  };
  markNear(front);
  const windows = [];
  leaves.forEach((o) => {
    const sides = [
      [o.y === y0, (t) => edgeKey('h', t, o.y), o.x, o.x + o.w],
      [o.y + o.h === y0 + fh, (t) => edgeKey('h', t, o.y + o.h), o.x, o.x + o.w],
      [o.x === x0, (t) => edgeKey('v', o.x, t), o.y, o.y + o.h],
      [o.x + o.w === x0 + fw, (t) => edgeKey('v', o.x + o.w, t), o.y, o.y + o.h],
    ];
    for (const [outside, keyAt, from, to] of sides) {
      if (!outside || !r.chance(0.75)) continue;
      const fits = [];
      for (let t = from + 1; t < to - 1; t++) {
        const k = keyAt(t);
        if (k === front || !straightThrough(edges, k)) continue;
        if (edgeEnds(k).some(([x, y]) => near.has(keyOf(x, y)))) continue;
        fits.push(k);
      }
      if (!fits.length) continue;
      const k = fits[Math.floor(fits.length / 2)];
      markNear(k);
      windows.push({ id: id('window'), material: glass, ...onEdge(k) });
    }
  });

  const street = r.pick(['cobble', 'cobble', 'grass', 'dirt']);
  const byArea = leaves
    .map((o, i) => i)
    .sort((a, b) => leaves[b].w * leaves[b].h - leaves[a].w * leaves[a].h || a - b);
  const hall = byArea[0];
  const ground = [{ id: 'street', material: street, shape: rectShape(0, 0, W, H) }];
  const zones = [];
  leaves.forEach((o, i) => {
    ground.push({
      id: 'floor-' + (i + 1),
      material:
        i === hall ? r.pick(['wood', 'flagstone']) : r.pick(['wood', 'wood', 'tile', 'carpet']),
      shape: rectShape(o.x, o.y, o.w, o.h),
    });
    zones.push({ id: 'room-' + (i + 1), shape: rectShape(o.x, o.y, o.w, o.h) });
  });

  const [fx] = edgeEnds(front)[0];
  const entries = [{ id: 'way-in', x: fx, y: y0 + fh }];
  const exits = [{ id: 'way-out', name: 'the street', x: fx, y: H - 1, to: 'out' }];

  // Dressing: the hall's table and chairs and its light, then each other
  // room by what it is for.
  const busy = new Set();
  for (const k of [...doorKeys, front]) {
    for (const [x, y] of sidesOf(k)) {
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) busy.add(keyOf(x + dx, y + dy));
    }
  }
  const objects = [];
  const lights = [];
  const furnish = furnisher(r, id, objects, { busy, walled: (k) => edges.has(k) });
  const H0 = leaves[hall];
  if (H0.w >= 4 && H0.h >= 4) {
    const cx = (H0.x + H0.w / 2) * FEET;
    const cy = (H0.y + H0.h / 2) * FEET;
    const turn = H0.w >= H0.h ? 0 : 90;
    if (furnish.at('table', [cx, cy], turn, H0)) {
      const off = 3;
      const sides =
        turn === 0
          ? [
              [0, -off],
              [0, off],
            ]
          : [
              [-off, 0],
              [off, 0],
            ];
      for (const [dx, dy] of sides) furnish.at('chair', [cx + dx, cy + dy], 0, H0, null, true);
    }
    lights.push({ id: id('light'), at: [round3(cx), round3(cy)], radius: 30 });
  } else {
    furnish.against(H0, 'bench');
  }
  const uses = r.shuffle(['bedroom', 'study', 'store', 'kitchen', 'bedroom']);
  byArea.slice(1).forEach((i, n) => {
    const o = leaves[i];
    const use = uses[n % uses.length];
    // One or two things a room, by what it is for.
    if (use === 'bedroom') {
      furnish.against(o, 'bed', 'across');
      if (r.chance(0.5)) furnish.against(o, 'wardrobe');
      else if (o.w >= 4 && o.h >= 4) {
        furnish.at('rug', [(o.x + o.w / 2) * FEET, (o.y + o.h / 2) * FEET], o.w >= o.h ? 0 : 90, o);
      }
    } else if (use === 'study') {
      furnish.against(o, 'desk');
      if (r.chance(0.5)) furnish.against(o, 'bookshelf');
    } else if (use === 'store') {
      furnish.against(o, 'barrel');
      furnish.against(o, 'crate');
    } else {
      furnish.against(o, 'cauldron');
      if (r.chance(0.5)) furnish.against(o, 'table');
    }
  });

  const floor = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) floor.push(keyOf(x, y));
  return {
    geometry: { ground, walls, doors, windows, objects, zones, lights },
    entries,
    exits,
    rooms: leaves.length,
    floor,
  };
}

// ── A ship's deck ──────────────────────────────────────────────────────

/** Whether a point lies in a convex polygon or on its edge. */
function inConvex(poly, p, eps = 1e-6) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(cross) <= eps) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

function deck(r, W, H, style) {
  const id = idMaker();
  const m = 2;
  const x0 = m;
  const x1 = W - m;
  // As wide as a ship that long, at most the map: centred, with water or
  // space either side on a tall map.
  const beam = clamp(Math.round((x1 - x0) * 0.4), 8, H - 2 * m);
  const y0 = Math.floor((H - beam) / 2);
  const y1 = y0 + beam;
  const yc = (y0 + y1) / 2;
  const bowLen = clamp(Math.round(beam * 0.9), 4, Math.floor((x1 - x0) / 3));
  const xb = x1 - bowLen;
  const starship = style === 'starship';

  // The hull, in squares' corners: a rectangle and its bow.
  const hull = [
    [x0, y0],
    [xb, y0],
  ];
  const bowTop = [];
  if (starship) {
    const nose = Math.max(1, Math.round(beam * 0.15));
    bowTop.push([x1, yc - nose]);
    hull.push([x1, yc - nose], [x1, yc + nose]);
  } else {
    const steps = 6;
    for (let k = 1; k < steps; k++) {
      const t = ((k / steps) * Math.PI) / 2;
      bowTop.push([xb + bowLen * Math.sin(t), yc - (beam / 2) * Math.cos(t)]);
    }
    hull.push(...bowTop, [x1, yc], ...bowTop.map(([x, y]) => [x, 2 * yc - y]).reverse());
  }
  hull.push([xb, y1], [x0, y1]);
  const hullFt = hull.map(ft);
  const inside = (x, y) =>
    [
      [x, y],
      [x + 1, y],
      [x, y + 1],
      [x + 1, y + 1],
    ].every((p) => inConvex(hull, p));

  const walls = [];
  const doors = [];
  const windows = [];
  const objects = [];
  const lights = [];
  const zones = [];
  let ground;
  let entries;
  let exits;
  let rooms;
  const busy = new Set();
  const mark = (x, y, d = 1) => {
    for (let dx = -d; dx <= d; dx++)
      for (let dy = -d; dy <= d; dy++) busy.add(keyOf(x + dx, y + dy));
  };

  if (!starship) {
    // A sailing ship: a stern cabin, a low rail round the rest with a gap
    // for the gangplank, masts and hatches down the middle.
    const cl = clamp(Math.round((xb - x0) * 0.22), 4, 8);
    const cx1 = x0 + cl;
    const gx = r.int(cx1 + 2, Math.max(cx1 + 2, xb - 3));
    const cabin = [
      [cx1, y0],
      [x0, y0],
      [x0, y1],
      [cx1, y1],
      [cx1, y0],
    ];
    walls.push({ id: 'cabin-walls', material: 'wood', points: cabin.map(ft) });
    const dy = r.int(y0 + 1, y1 - 2);
    doors.push({
      id: 'cabin-door',
      material: 'wood',
      name: 'the cabin door',
      from: ft([cx1, dy]),
      to: ft([cx1, dy + 1]),
    });
    mark(cx1 - 1, dy);
    mark(cx1, dy);
    const sternWindows = beam >= 8 ? [Math.floor(yc) - 2, Math.ceil(yc) + 1] : [Math.floor(yc)];
    for (const wy of sternWindows) {
      windows.push({
        id: id('window'),
        material: 'glass',
        from: ft([x0, wy]),
        to: ft([x0, wy + 1]),
      });
    }
    const rail = [[gx + 1, y0], [xb, y0], ...hull.slice(2, hull.length - 2), [xb, y1], [cx1, y1]];
    walls.push({ id: 'rail', material: 'wood', points: rail.map(ft), height: 3 });
    walls.push({
      id: 'rail-aft',
      material: 'wood',
      points: [ft([cx1, y0]), ft([gx, y0])],
      height: 3,
    });
    // The sea all round, which nobody walks on: one outline from the map's
    // edge down the gangplank's side, round the hull and back up its other
    // side, so the deck and the gangplank lie outside it (play counts all
    // inside ground that can't be crossed as solid, whatever lies over it).
    const sea = [
      [0, 0],
      [gx, 0],
      [gx, y0],
      hull[0],
      ...hull.slice(1).reverse(),
      [gx + 1, y0],
      [gx + 1, 0],
      [W, 0],
      [W, H],
      [0, H],
    ];
    ground = [
      { id: 'sea', material: 'deep-water', shape: ringPath(sea.map(ft)), depth: 20, cost: 'never' },
      { id: 'deck-floor', material: 'wood', shape: ringPath(hullFt) },
      { id: 'gangplank', material: 'wood', shape: rectShape(gx, 0, 1, y0) },
    ];
    entries = [{ id: 'way-in', x: gx, y: y0 }];
    exits = [{ id: 'way-out', name: 'the gangplank', x: gx, y: 0, to: 'out' }];
    mark(gx, y0);
    zones.push({
      id: 'deck',
      shape: ringPath([[cx1, y0], ...hull.slice(1, hull.length - 1), [cx1, y1]].map(ft)),
    });
    zones.push({ id: 'cabin', shape: rectShape(x0, y0, cl, beam) });
    rooms = 2;

    // Walls to stand cargo against: the rails and the cabin's walls (not
    // the gangway's gap, nor the open bow).
    const walled = (k) => {
      const [x, y] = k.slice(1).split(',').map(Number);
      if (k[0] === 'h') return (y === y0 || y === y1) && x < xb && !(y === y0 && x === gx);
      return x === x0 || x === cx1;
    };
    const furnish = furnisher(r, id, objects, {
      busy,
      walled,
      inside: (k) => inside(...k.split(',').map(Number)),
    });
    // Masts down the middle, hatches between them.
    const open = xb - cx1;
    const count = open >= 16 ? 3 : 2;
    const mastX = [];
    for (let k = 1; k <= count; k++) mastX.push(cx1 + (open * k) / (count + 1));
    // Named stern to bow.
    const names =
      count === 3
        ? ['the mizzenmast', 'the mainmast', 'the foremast']
        : ['the mainmast', 'the foremast'];
    mastX.forEach((mx, k) => {
      furnish.at('pillar', [mx * FEET, yc * FEET], 0, null, { name: names[k] });
    });
    for (let k = 0; k < mastX.length - 1; k++) {
      furnish.at('trapdoor', [((mastX[k] + mastX[k + 1]) / 2) * FEET, yc * FEET], 0, null, {
        name: 'a hatch',
      });
    }
    // Cargo along the rails, clear of the gangway.
    const deckRoom = { x: cx1, y: y0, w: xb - cx1, h: beam };
    for (let k = 0; k < r.int(2, 4); k++)
      furnish.against(deckRoom, r.pick(['barrel', 'barrel', 'crate']));
    // The cabin: a table, a chest, a lantern.
    const room = { x: x0, y: y0, w: cl, h: beam };
    furnish.at('table', [(x0 + cl / 2) * FEET, yc * FEET], 90, room);
    furnish.against(room, 'chest');
    lights.push({ id: 'lantern', at: ft([x0 + cl / 2, yc - 1]), radius: 20 });
  } else {
    // A starship: an engine room astern, a bridge in the bow, a corridor
    // down the spine between them with compartments either side, one an
    // airlock to a docking tube.
    const el = clamp(Math.round((xb - x0) * 0.2), 3, 6);
    const ex = x0 + el;
    const cy0 = Math.floor(yc) - 1;
    const label = new Array(W * H).fill(null);
    const setLabel = (x, y, v) => {
      label[y * W + x] = v;
    };
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < W - m; x++) {
        if (x < ex) setLabel(x, y, 'engine');
        else if (x >= xb) setLabel(x, y, 'bridge');
        else if (y === cy0 || y === cy0 + 1) setLabel(x, y, 'corridor');
      }
    }
    const strips = [
      { y: y0, h: cy0 - y0, side: 'top' },
      { y: cy0 + 2, h: y1 - cy0 - 2, side: 'bottom' },
    ];
    const compartments = [];
    for (const s of strips) {
      let x = ex;
      while (x < xb) {
        let w = r.int(3, 6);
        if (xb - (x + w) < 3) w = xb - x;
        compartments.push({ x, y: s.y, w, h: s.h, side: s.side });
        x += w;
      }
    }
    compartments.forEach((c, i) => {
      for (let x = c.x; x < c.x + c.w; x++)
        for (let y = c.y; y < c.y + c.h; y++) setLabel(x, y, 'c' + i);
    });
    const tops = compartments.filter((c) => c.side === 'top');
    const lock = tops[Math.min(tops.length - 1, r.int(0, tops.length - 1))];
    lock.airlock = true;
    const gx = lock.x + Math.floor(lock.w / 2);
    const { lines } = cellWalls(
      W,
      H,
      (x, y) => label[y * W + x],
      (a, b) => (a !== null && b !== null && a !== b ? 'metal' : null)
    );
    walls.push({ id: 'hull', material: 'metal', points: [...hull, hull[0]].map(ft) });
    for (const l of lines)
      walls.push({ id: id('wall'), material: 'metal', points: l.line.map(ft) });
    walls.push({ id: 'tube-west', material: 'metal', points: [ft([gx, 0]), ft([gx, y0])] });
    walls.push({ id: 'tube-east', material: 'metal', points: [ft([gx + 1, 0]), ft([gx + 1, y0])] });
    doors.push({
      id: 'outer-hatch',
      material: 'metal',
      name: 'the outer hatch',
      from: ft([gx, y0]),
      to: ft([gx + 1, y0]),
    });
    const doorAt = (key, extra) => {
      doors.push({ id: extra.id || id('door'), material: 'metal', ...onEdge(key), ...extra });
      for (const [x, y] of sidesOf(key)) mark(x, y);
    };
    compartments.forEach((c) => {
      const t = c.airlock ? gx : c.x + r.int(1, c.w - 2);
      const lineY = c.side === 'top' ? cy0 : cy0 + 2;
      doorAt(
        edgeKey('h', t, lineY),
        c.airlock ? { id: 'inner-hatch', name: 'the inner hatch' } : {}
      );
    });
    doorAt(edgeKey('v', ex, cy0 + r.int(0, 1)), { id: 'engine-door' });
    doorAt(edgeKey('v', xb, cy0 + r.int(0, 1)), { id: 'bridge-door' });
    // Viewports on the bow's angled sides.
    const top = [ft([xb, y0]), ft(bowTop[0])];
    for (const [a, b] of [top, [ft([xb, y1]), ft([bowTop[0][0], 2 * yc - bowTop[0][1]])]]) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 12) continue;
      const t0 = 0.5 - 2.5 / len;
      const t1 = 0.5 + 2.5 / len;
      const p = (t) => [round3(a[0] + (b[0] - a[0]) * t), round3(a[1] + (b[1] - a[1]) * t)];
      windows.push({ id: id('window'), material: 'glass', from: p(t0), to: p(t1) });
    }
    ground = [
      { id: 'hull-floor', material: 'metal', shape: ringPath(hullFt) },
      { id: 'tube', material: 'metal', shape: rectShape(gx, 0, 1, y0) },
    ];
    entries = [{ id: 'way-in', x: gx, y: y0 }];
    exits = [{ id: 'way-out', name: 'the docking tube', x: gx, y: 0, to: 'out' }];
    mark(gx, y0);
    zones.push({ id: 'engine', shape: rectShape(x0, y0, el, beam) });
    zones.push({ id: 'corridor', shape: rectShape(ex, cy0, xb - ex, 2) });
    zones.push({ id: 'bridge', shape: ringPath(hull.slice(1, hull.length - 1).map(ft)) });
    let n = 0;
    compartments.forEach((c) => {
      zones.push({
        id: c.airlock ? 'airlock' : 'room-' + ++n,
        shape: rectShape(c.x, c.y, c.w, c.h),
      });
    });
    rooms = 3 + compartments.length;

    const furnish = furnisher(r, id, objects, {
      busy,
      // Every compartment, the engine room and the bridge are walled all round.
      walled: () => true,
      inside: (k) => inside(...k.split(',').map(Number)),
    });
    // The bridge's consoles, facing forward; the engines'.
    const bx = (xb + bowLen * 0.45) * FEET;
    for (const off of [-4, 4]) furnish.at('console', [bx, yc * FEET + off], 90);
    const engine = { x: x0, y: y0, w: el, h: beam };
    furnish.against(engine, 'console');
    furnish.against(engine, 'crate');
    // Compartments: bunks, stores, a mess.
    compartments.forEach((c) => {
      if (c.airlock) return;
      const use = r.pick(['bunks', 'bunks', 'store', 'mess']);
      if (use === 'bunks') {
        furnish.against(c, 'bed', 'across');
        if (c.w >= 4) furnish.against(c, 'bed', 'across');
      } else if (use === 'store') {
        furnish.against(c, 'crate');
        furnish.against(c, 'crate');
      } else furnish.against(c, 'table');
    });
    for (let x = ex + 3; x < xb - 1; x += 6)
      lights.push({ id: id('light'), at: ft([x, cy0 + 1]), radius: 15 });
    lights.push({ id: 'bridge-light', at: [round3(bx), round3(yc * FEET)], radius: 20 });
  }

  const floor = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) floor.push(keyOf(x, y));
  return {
    geometry: { ground, walls, doors, windows, objects, zones, lights },
    entries,
    exits,
    rooms,
    floor,
  };
}

// ── Generating ─────────────────────────────────────────────────────────

const GENERATORS = { rooms, caves, interior, deck };

/**
 * A map of `kind`, from `seed` (a number or a string): the same kind, seed,
 * size and style, the same map. Throws for a kind, size or style it can't
 * make, and if what it made isn't playable (which the tests guard against).
 */
function generate(kind, { seed, width, height, style } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`No generator makes "${kind}": ${KINDS.join(', ')}.`);
  const size = SIZES[kind];
  const W = width === undefined ? size.width : width;
  const H = height === undefined ? size.height : height;
  for (const [v, lo, what] of [
    [W, size.min.width, 'width'],
    [H, size.min.height, 'height'],
  ]) {
    if (!Number.isInteger(v) || v < lo || v > MAX_SIDE) {
      throw new Error(
        `A ${kind} map’s ${what} is a whole number of squares from ${lo} to ${MAX_SIDE}.`
      );
    }
  }
  const styles = STYLES[kind];
  if (style !== undefined && !(styles && styles.includes(style))) {
    throw new Error(
      styles ? `A ${kind} map’s style is ${styles.join(' or ')}.` : `A ${kind} map takes no style.`
    );
  }
  const chosen = styles ? style || styles[0] : undefined;
  const s = seed === undefined ? 0 : seed;
  const r = random([kind, chosen || '', W + 'x' + H, String(s)].join('|'));
  const made = GENERATORS[kind](r, W, H, chosen);
  const map = {
    width: W,
    height: H,
    geometry: Object.fromEntries(
      Object.entries(made.geometry).filter(([, list]) => Array.isArray(list) && list.length)
    ),
    entries: made.entries,
    exits: made.exits,
    features: [],
  };
  const { problems: left, removed } = settle(map, made.floor);
  if (left.length) {
    throw new Error(
      `The ${kind} generator made a map that isn’t playable: ${left.slice(0, 3).join(' ')}`
    );
  }
  for (const k of Object.keys(map.geometry)) if (!map.geometry[k].length) delete map.geometry[k];
  return {
    kind,
    seed: s,
    ...(chosen ? { style: chosen } : {}),
    ...map,
    rooms: made.rooms,
    floor: made.floor,
    removed,
  };
}

module.exports = { KINDS, STYLES, SIZES, VERSION, generate, problems, random, hash };
