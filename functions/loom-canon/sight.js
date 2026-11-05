'use strict';

/**
 * The Loom — line of sight on battle maps (planning/maps-from-data.md §4.3,
 * GE3, DA2; L-923 / #727; on the grid before it, L-631).
 *
 * Sight is worked out on a map's geometry (./map-geometry.js; its layers
 * from before read as geometry, ./map-paths.js geometryOf), from the
 * viewer's eyes: their point in feet (a square read as its centre), at the
 * height of the floor they stand on plus their size's eyes (map-paths.js
 * eyeOf: medium 5 ft).
 *
 * What hides what's beyond it: walls that block sight (not glass, bars or a
 * fence: GE3), doors that aren't open or see-through (as a save has them,
 * `states`), windows that aren't see-through, and objects that block sight
 * (a pillar, a tree: the catalog, or the object, says). Each hides only when
 * its top reaches the viewer's eyes: the floor under it plus its `height`,
 * or always, with none (DA2, decided 2026-11-04: by eye level, a level line
 * from the eyes). So from a ledge you see over a wall your own height. The
 * ground never hides anything, nor does what blocks only movement.
 *
 * A square is in sight when more than a line of it can be seen: the region
 * seen from the eyes (a polygon, cast to every end and crossing of what
 * hides) covers some of it, so nothing is seen through the point where two
 * walls meet or along a line grazing a wall's end. A square something that
 * hides stands in is in sight when that thing's face in it is seen (a
 * pillar is seen; what's behind it isn't).
 *
 *   inSight(map, from, states, options)  the squares in sight, keyed "x,y"
 *   sees(map, from, to, states, options) whether one square is
 *   viewOf(map, from, states, options)   the region seen, and what hides
 *   linesTo(map, from, to, states, o)    lines across a target, for cover
 *   outline(map, from, states, options)  the region seen as points, for the fog
 *
 * `from` is a square ({ x, y }, its centre) or someone where they stand
 * ({ cell, point?, size? }); `options` { eye } (feet above the floor) or
 * { size }. Pure, and server-side: the browser is sent only what has been
 * seen (L-633). Looks are kept per map, so asking again costs nothing.
 */

const geo = require('./map-geometry');
const mapPaths = require('./map-paths');
const materials = require('./materials');

const FEET = 5;
const NUDGE = 1e-5; // radians either side of each corner a ray is cast to
const TURN_C = Math.cos(NUDGE);
const TURN_S = Math.sin(NUDGE);
const LINE = 1e-6; // an overlap of no more than this (ft²) is a line
const KEEP = 400; // looks kept per map

const key = (cell) => cell.x + ',' + cell.y;
// Plain arithmetic in the hot loops: Math's calls cost more where the rules
// run sandboxed (as in the tests).
const PI = Math.PI;
const TAU = 2 * Math.PI;
const abs = (v) => (v < 0 ? -v : v);
const max = (a, b) => (a > b ? a : b);
const min = (a, b) => (a < b ? a : b);
const hyp = (x, y) => Math.sqrt(x * x + y * y);
const isPoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

// ── Small geometry ─────────────────────────────────────────────────────

// Where a ray from (ox, oy) heading (dx, dy) meets segment a–b: its distance
// along the ray (the ray's direction a unit), or Infinity.
function rayHit(ox, oy, dx, dy, ax, ay, bx, by) {
  const sx = bx - ax;
  const sy = by - ay;
  const den = dx * sy - dy * sx;
  if (abs(den) < 1e-12) return Infinity;
  const qx = ax - ox;
  const qy = ay - oy;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * dy - qy * dx) / den;
  if (t < -1e-9 || u < -1e-9 || u > 1 + 1e-9) return Infinity;
  return t > 0 ? t : 0;
}

// Where two segments cross (not at an end both share), or null.
function crossingOf(s, t) {
  const rx = s.bx - s.ax;
  const ry = s.by - s.ay;
  const qx = t.bx - t.ax;
  const qy = t.by - t.ay;
  const den = rx * qy - ry * qx;
  if (abs(den) < 1e-12) return null;
  const wx = t.ax - s.ax;
  const wy = t.ay - s.ay;
  const a = (wx * qy - wy * qx) / den;
  const b = (wx * ry - wy * rx) / den;
  if (a <= 1e-9 || a >= 1 - 1e-9 || b <= 1e-9 || b >= 1 - 1e-9) return null;
  return { x: s.ax + a * rx, y: s.ay + a * ry };
}

// The area of a polygon (flat [x0, y0, x1, y1, …]) cut to a box
// (Sutherland–Hodgman: the box is convex).
function areaInBox(flat, x0, y0, x1, y1) {
  let pts = flat;
  for (let side = 0; side < 4 && pts.length; side++) {
    const next = [];
    const n = pts.length;
    for (let i = 0; i < n; i += 2) {
      const ax = pts[(i + n - 2) % n];
      const ay = pts[(i + n - 1) % n];
      const bx = pts[i];
      const by = pts[i + 1];
      const va = side === 0 ? ax - x0 : side === 1 ? x1 - ax : side === 2 ? ay - y0 : y1 - ay;
      const vb = side === 0 ? bx - x0 : side === 1 ? x1 - bx : side === 2 ? by - y0 : y1 - by;
      if (vb >= 0) {
        if (va < 0) {
          const t = va / (va - vb);
          next.push(ax + (bx - ax) * t, ay + (by - ay) * t);
        }
        next.push(bx, by);
      } else if (va >= 0) {
        const t = va / (va - vb);
        next.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
    }
    pts = next;
  }
  let sum = 0;
  const n = pts.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + n - 2) % n;
    sum += (pts[j] + pts[i]) * (pts[j + 1] - pts[i + 1]);
  }
  return Math.abs(sum) / 2;
}

// A segment cut to a box, or null when none of it lies in it.
function segmentInBox(a, b, x0, y0, x1, y1) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - x0],
    [dx, x1 - a.x],
    [-dy, a.y - y0],
    [dy, y1 - a.y],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
  }
  if (t1 - t0 < 1e-9) return null;
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ];
}

// ── What hides ─────────────────────────────────────────────────────────

const looks = new WeakMap(); // compiled geometry → what's kept for it

function keptFor(c) {
  let kept = looks.get(c);
  if (!kept) {
    kept = { blockers: new Map(), views: new Map(), squares: new Map() };
    looks.set(c, kept);
  }
  return kept;
}

function remember(map, k, value) {
  if (map.size >= KEEP) map.delete(map.keys().next().value);
  map.set(k, value);
  return value;
}

// A save's doors as a key: only those the map has.
function statesKey(c, states) {
  if (!states) return '';
  return c.openings
    .map((o) => o.item.id)
    .filter((id) => id && Object.prototype.hasOwnProperty.call(states, id))
    .sort()
    .map((id) => id + '=' + states[id])
    .join('&');
}

// The floor's height at a point (the ground's there, else 0).
function floorIn(c, p) {
  const g = c.ground.length ? geo.groundAt(c, [p.x, p.y]) : null;
  return g && typeof g.height === 'number' && Number.isFinite(g.height) ? g.height : 0;
}

// The top of something that hides, standing at `p` (on the higher side of
// a line), with its own `height`: Infinity with none.
function topOf(c, height, points) {
  if (typeof height !== 'number' || !Number.isFinite(height)) return Infinity;
  let floor = -Infinity;
  points.forEach((p) => {
    floor = Math.max(floor, floorIn(c, p));
  });
  return (Number.isFinite(floor) ? floor : 0) + height;
}

// The two sides of a line's middle, for the floor under it.
function sidesOf(a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const nx = (-(b.y - a.y) / len) * 0.05;
  const ny = ((b.x - a.x) / len) * 0.05;
  return [
    { x: mx + nx, y: my + ny },
    { x: mx - nx, y: my - ny },
  ];
}

// Whether an object hides what's behind it: its own say, else its kind's.
function objectHides(item) {
  if (typeof item.blocksSight === 'boolean') return item.blocksSight;
  const kind = materials.objectKind(item.kind);
  return Boolean(kind && kind.blocksSight);
}

/**
 * What hides from eyes at `level` (feet), with a save's doors: segments
 * { ax, ay, bx, by, object? } (an object's index in `objects`), the map's
 * edge among them, kept in 5 ft cells; and the objects that hide, each
 * with its outline and its box.
 */
// The map's size, part of every key: its edge hides too, and maps of other
// sizes may share a geometry (a template's instances, a copy of a map).
const sizeKey = (map) => (map.width || 0) + 'x' + (map.height || 0);

function blockersOf(map, c, states, level) {
  const kept = keptFor(c);
  const k = sizeKey(map) + '|' + statesKey(c, states) + '|' + level;
  if (kept.blockers.has(k)) return kept.blockers.get(k);
  const W = (map.width || 0) * FEET;
  const H = (map.height || 0) * FEET;
  const segs = [];
  const add = (a, b, object) =>
    segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, ...(object !== undefined ? { object } : {}) });
  const hosts = {};
  c.openings.forEach((o) => {
    if (o.item.id && o.wall) hosts[o.item.id] = o.wall;
  });
  geo.edges(c, states).forEach((e) => {
    if (!e.blocksSight) return;
    const a = { x: e.a[0], y: e.a[1] };
    const b = { x: e.b[0], y: e.b[1] };
    // A door or window as high as the wall it stands in.
    const owner = e.kind === 'wall' ? e.item : (c.byId[hosts[e.id]] || {}).item || e.item;
    if (topOf(c, owner && owner.height, sidesOf(a, b)) < level) return;
    add(a, b);
  });
  const objects = [];
  c.objects.forEach((o) => {
    if (!objectHides(o.item)) return;
    const at = o.rings[0].reduce((s, p) => ({ x: s.x + p[0], y: s.y + p[1] }), { x: 0, y: 0 });
    const n = o.rings[0].length || 1;
    if (topOf(c, o.item.height, [{ x: at.x / n, y: at.y / n }]) < level) return;
    const index = objects.length;
    const ring = o.rings[0].map((p) => ({ x: p[0], y: p[1] }));
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    objects.push({
      item: o.item,
      ring,
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    });
    o.rings.forEach((r) => {
      for (let i = 0; i < r.length; i++) {
        const p = r[i];
        const q = r[(i + 1) % r.length];
        add({ x: p[0], y: p[1] }, { x: q[0], y: q[1] }, index);
      }
    });
  });
  // The squares each object that hides stands in, for their faces.
  const holding = new Set();
  objects.forEach((o) => {
    for (let x = Math.floor(o.box[0] / FEET); x < Math.ceil(o.box[2] / FEET); x++) {
      for (let y = Math.floor(o.box[1] / FEET); y < Math.ceil(o.box[3] / FEET); y++) {
        holding.add(x + ',' + y);
      }
    }
  });
  // What stops movement but doesn't hide from these eyes, for cover: a low
  // wall, glass or bars, a door that can be seen through, a table.
  const barriers = [];
  geo.edges(c, states).forEach((e) => {
    if (!e.blocksMove) return;
    const a = { x: e.a[0], y: e.a[1] };
    const b = { x: e.b[0], y: e.b[1] };
    const owner = e.kind === 'wall' ? e.item : (c.byId[hosts[e.id]] || {}).item || e.item;
    if (e.blocksSight && topOf(c, owner && owner.height, sidesOf(a, b)) >= level) return;
    barriers.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
  });
  c.objects.forEach((o) => {
    if (o.item.blocksMove === false) return;
    if (objects.some((h) => h.item === o.item)) return;
    o.rings.forEach((r) => {
      for (let i = 0; i < r.length; i++) {
        const p = r[i];
        const q = r[(i + 1) % r.length];
        barriers.push({ ax: p[0], ay: p[1], bx: q[0], by: q[1] });
      }
    });
  });
  // The map's edge: every look ends there.
  const inside = segs.length;
  add({ x: 0, y: 0 }, { x: W, y: 0 });
  add({ x: W, y: 0 }, { x: W, y: H });
  add({ x: W, y: H }, { x: 0, y: H });
  add({ x: 0, y: H }, { x: 0, y: 0 });
  // In cells of 5 ft, for the rays.
  const cols = Math.max(1, Math.ceil(W / FEET));
  const rows = Math.max(1, Math.ceil(H / FEET));
  const grid = new Array(cols * rows);
  segs.forEach((s, i) => {
    const x0 = Math.max(0, Math.floor(Math.min(s.ax, s.bx) / FEET - 1e-9));
    const x1 = Math.min(cols - 1, Math.floor(Math.max(s.ax, s.bx) / FEET + 1e-9));
    const y0 = Math.max(0, Math.floor(Math.min(s.ay, s.by) / FEET - 1e-9));
    const y1 = Math.min(rows - 1, Math.floor(Math.max(s.ay, s.by) / FEET + 1e-9));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) (grid[y * cols + x] = grid[y * cols + x] || []).push(i);
    }
  });
  return remember(kept.blockers, k, {
    segs,
    inside,
    barriers,
    objects,
    holding,
    grid,
    cols,
    rows,
    W,
    H,
    tried: new Uint32Array(segs.length),
    ray: 0,
  });
}

// How far a ray from `o` heading (dx, dy), a unit, goes before something hides what's
// beyond, and the object it stops on (-1 for none: a wall, where both meet
// it at once): a walk through the 5 ft cells it crosses.
function castRay(b, o, dx, dy) {
  let cx = min(b.cols - 1, max(0, (o.x / FEET) | 0));
  let cy = min(b.rows - 1, max(0, (o.y / FEET) | 0));
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const deltaX = abs(dx) < 1e-12 ? Infinity : abs(FEET / dx);
  const deltaY = abs(dy) < 1e-12 ? Infinity : abs(FEET / dy);
  let nextX = abs(dx) < 1e-12 ? Infinity : ((dx > 0 ? (cx + 1) * FEET : cx * FEET) - o.x) / dx;
  let nextY = abs(dy) < 1e-12 ? Infinity : ((dy > 0 ? (cy + 1) * FEET : cy * FEET) - o.y) / dy;
  let best = Infinity;
  let object = -1;
  const mark = ++b.ray;
  for (let guard = 0; guard < b.cols + b.rows + 4; guard++) {
    const list = b.grid[cy * b.cols + cx];
    if (list) {
      for (let n = 0; n < list.length; n++) {
        const i = list[n];
        if (b.tried[i] === mark) continue;
        b.tried[i] = mark;
        const s = b.segs[i];
        const t = rayHit(o.x, o.y, dx, dy, s.ax, s.ay, s.bx, s.by);
        const own = s.object !== undefined ? s.object : -1;
        if (t < best - 1e-9) {
          best = t;
          object = own;
        } else if (t <= best + 1e-9 && own < 0) {
          object = -1;
        }
      }
    }
    const leave = nextX < nextY ? nextX : nextY;
    if (best <= leave + 1e-9) break;
    if (nextX < nextY) {
      cx += stepX;
      nextX += deltaX;
    } else {
      cy += stepY;
      nextY += deltaY;
    }
    if (cx < 0 || cy < 0 || cx >= b.cols || cy >= b.rows) break;
  }
  return { d: Number.isFinite(best) ? best : 0, object };
}

// ── The region seen ────────────────────────────────────────────────────

/**
 * The region seen from eyes at point `e`: its outline as rays sorted by
 * angle (`angles`, the points they reach, `xs`, `ys`, and the object each
 * stops on, `objects`).
 */
function regionOf(b, e) {
  const wanted = [];
  // A ray at each end, and a hair either side of it (turned by NUDGE).
  const aim = (x, y) => {
    const len = hyp(x - e.x, y - e.y);
    if (len < 1e-12) return;
    const ux = (x - e.x) / len;
    const uy = (y - e.y) / len;
    const a = Math.atan2(uy, ux);
    wanted.push(
      { a: a - NUDGE, dx: ux * TURN_C + uy * TURN_S, dy: uy * TURN_C - ux * TURN_S },
      { a, dx: ux, dy: uy },
      { a: a + NUDGE, dx: ux * TURN_C - uy * TURN_S, dy: uy * TURN_C + ux * TURN_S }
    );
  };
  // Each corner once: most are the ends of two segments.
  const aimed = new Set();
  const once = (x, y) => {
    const k = x + ',' + y;
    if (aimed.has(k)) return;
    aimed.add(k);
    aim(x, y);
  };
  b.segs.forEach((s) => {
    once(s.ax, s.ay);
    once(s.bx, s.by);
  });
  // Where two of them cross, in the same cell.
  b.grid.forEach((list) => {
    if (!list || list.length < 2) return;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = crossingOf(b.segs[list[i]], b.segs[list[j]]);
        if (x) aim(x.x, x.y);
      }
    }
  });
  wanted.forEach((w) => {
    if (w.a <= -PI) w.a += TAU;
    else if (w.a > PI) w.a -= TAU;
  });
  wanted.sort((p, q) => p.a - q.a);
  const angles = [];
  const xs = [];
  const ys = [];
  const objects = [];
  const ds = [];
  for (const w of wanted) {
    if (angles.length && w.a - angles[angles.length - 1] < 1e-12) continue;
    const hit = castRay(b, e, w.dx, w.dy);
    angles.push(w.a);
    xs.push(e.x + w.dx * hit.d);
    ys.push(e.y + w.dy * hit.d);
    objects.push(hit.object);
    ds.push(hit.d);
  }
  // The farthest ray in any run of them, at once (a sparse table).
  const far = [ds];
  for (let w = 1; 2 * w <= ds.length; w *= 2) {
    const prev = far[far.length - 1];
    const next = new Float64Array(ds.length - 2 * w + 1);
    for (let i = 0; i < next.length; i++) next[i] = max(prev[i], prev[i + w]);
    far.push(next);
  }
  return { e, angles, xs, ys, objects, far };
}

// The farthest any ray from i to j reaches (indices, wrapping).
function farthest(r, i, j) {
  const n = r.angles.length;
  if (i > j) return max(farthest(r, i, n - 1), farthest(r, 0, j));
  const len = j - i + 1;
  let level = 0;
  while (1 << (level + 1) <= len) level++;
  const row = r.far[level];
  return max(row[i], row[j - (1 << level) + 1]);
}

// The first ray at or after angle a (wrapping).
function rayAt(r, a) {
  while (a <= -PI) a += TAU;
  while (a > PI) a -= TAU;
  let lo = 0;
  let hi = r.angles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (r.angles[mid] < a) lo = mid + 1;
    else hi = mid;
  }
  return lo % r.angles.length;
}

// Where the outline is at angle a: on the line between the rays either side.
function outlineAt(r, a, toward) {
  const n = r.angles.length;
  const j = rayAt(r, a);
  const i = (j + n - 1) % n;
  // Along the line to `toward`, a point at angle a, when given.
  const len = toward ? hyp(toward.x - r.e.x, toward.y - r.e.y) : 0;
  const dx = len ? (toward.x - r.e.x) / len : Math.cos(a);
  const dy = len ? (toward.y - r.e.y) / len : Math.sin(a);
  const t = rayHit(r.e.x, r.e.y, dx, dy, r.xs[i], r.ys[i], r.xs[j], r.ys[j]);
  const d = t < Infinity ? t : hyp(r.xs[j] - r.e.x, r.ys[j] - r.e.y);
  return { x: r.e.x + dx * d, y: r.e.y + dy * d };
}

// Whether a point lies in the region seen.
function inRegion(r, p) {
  const d = hyp(p.x - r.e.x, p.y - r.e.y);
  if (d < 1e-9) return true;
  const edge = outlineAt(r, Math.atan2(p.y - r.e.y, p.x - r.e.x), p);
  return d < hyp(edge.x - r.e.x, edge.y - r.e.y) - 1e-9;
}

// The part of the region within the angles from a to a + span (toward the
// points `from` and `to`, when given), as a flat polygon from the eyes
// ([x0, y0, x1, y1, …]).
function wedgeOf(r, a, span, from, to) {
  const n = r.angles.length;
  const e = r.e;
  const first = outlineAt(r, a, from);
  const flat = [e.x, e.y, first.x, first.y];
  let i = rayAt(r, a);
  for (let k = 0; k < n; k++, i = (i + 1) % n) {
    let off = r.angles[i] - a;
    while (off < 0) off += TAU;
    while (off >= TAU) off -= TAU;
    if (off <= 0 && k === 0) continue; // the ray at `a` itself
    if (off >= span) break;
    flat.push(r.xs[i], r.ys[i]);
  }
  const last = outlineAt(r, a + span, to);
  flat.push(last.x, last.y);
  return flat;
}

// The angle from the eyes to a corner of the grid, kept for the look.
function cornerAngle(view, x, y) {
  const w = view.width + 1;
  if (!view.corners) view.corners = new Float64Array(w * (view.height + 1)).fill(NaN);
  const i = y * w + x;
  let a = view.corners[i];
  if (a !== a) {
    a = Math.atan2(y * FEET - view.region.e.y, x * FEET - view.region.e.x);
    view.corners[i] = a;
  }
  return a;
}

// Whether a square is in sight in the region seen.
function squareSeen(view, cell) {
  const { region: r, blockers: b } = view;
  const x0 = cell.x * FEET;
  const y0 = cell.y * FEET;
  const x1 = x0 + FEET;
  const y1 = y0 + FEET;
  const e = r.e;
  if (e.x >= x0 - 1e-9 && e.x <= x1 + 1e-9 && e.y >= y0 - 1e-9 && e.y <= y1 + 1e-9) return true;
  // Its middle seen: it is.
  if (inRegion(r, { x: x0 + FEET / 2, y: y0 + FEET / 2 })) return true;
  // The square's span of angles from the eyes (under a half turn), each
  // corner's worked out once a look: corners 0–3 clockwise from (x0, y0).
  const a0 = cornerAngle(view, cell.x, cell.y);
  let lo = 0;
  let hi = 0;
  let lowest = 0;
  let highest = 0;
  for (let q = 1; q < 4; q++) {
    let d =
      cornerAngle(view, cell.x + (q === 1 || q === 2 ? 1 : 0), cell.y + (q >= 2 ? 1 : 0)) - a0;
    if (d > PI) d -= TAU;
    else if (d < -PI) d += TAU;
    if (d < lowest) {
      lowest = d;
      lo = q;
    }
    if (d > highest) {
      highest = d;
      hi = q;
    }
  }
  const cornerPoint = (q) => ({ x: q === 1 || q === 2 ? x1 : x0, y: q >= 2 ? y1 : y0 });
  const low = a0 + lowest;
  const span = highest - lowest;
  // All of it farther than anything seen that way: hidden, but for a face.
  const n = r.angles.length;
  const dx = max(max(x0 - e.x, 0), e.x - x1);
  const dy = max(max(y0 - e.y, 0), e.y - y1);
  const near = hyp(dx, dy);
  const reach = farthest(r, (rayAt(r, low) + n - 1) % n, rayAt(r, low + span));
  if (
    reach > near + 1e-9 &&
    areaInBox(wedgeOf(r, low, span, cornerPoint(lo), cornerPoint(hi)), x0, y0, x1, y1) > LINE
  )
    return true;
  // Something that hides standing in it: seen when its face there is, two
  // rays side by side stopping on it within the square.
  if (!b.holding.has(cell.x + ',' + cell.y)) return false;
  let i = (rayAt(r, low) + n - 1) % n;
  for (let k = 0; k <= n; k++, i = (i + 1) % n) {
    const j = (i + 1) % n;
    const ob = r.objects[i];
    if (ob >= 0 && r.objects[j] === ob) {
      const o = b.objects[ob];
      const inside = !(o.box[0] >= x1 || o.box[2] <= x0 || o.box[1] >= y1 || o.box[3] <= y0);
      const part =
        inside &&
        segmentInBox(
          { x: r.xs[i], y: r.ys[i] },
          { x: r.xs[j], y: r.ys[j] },
          x0 - 1e-6,
          y0 - 1e-6,
          x1 + 1e-6,
          y1 + 1e-6
        );
      if (part && hyp(part[1].x - part[0].x, part[1].y - part[0].y) > 1e-6) return true;
    }
    let off = r.angles[j] - low;
    while (off < 0) off += TAU;
    while (off >= TAU) off -= TAU;
    if (k > 0 && off > span) break;
  }
  return false;
}

// ── Looking ────────────────────────────────────────────────────────────

// The viewer: their square and point, and the height of their eyes.
function viewerOf(map, from, options = {}) {
  if (!from) return null;
  const cell = from.cell || (isPoint(from) ? { x: from.x, y: from.y } : null);
  if (!cell) return null;
  let point = isPoint(from.point) ? from.point : null;
  if (point) {
    const sq = mapPaths.squareOf(point);
    if (sq.x !== cell.x || sq.y !== cell.y) point = null;
  }
  point = point || mapPaths.centreOf(cell);
  const eye = Number.isFinite(options.eye)
    ? options.eye
    : Number.isFinite(from.eye)
      ? from.eye
      : mapPaths.eyeOf(options.size || from.size);
  return { cell, point, level: mapPaths.floorAt(map, point) + eye };
}

function onGrid(map, cell) {
  return cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height;
}

/**
 * The region seen from `from` (L-923): what hides from them, their eyes
 * (`viewer`) and the region (`region`), or null off the grid.
 */
function viewOf(map, from, states, options) {
  const viewer = viewerOf(map, from, options);
  if (!map || !viewer || !onGrid(map, viewer.cell)) return null;
  const c = geo.compile(mapPaths.geometryOf(map));
  const blockers = blockersOf(map, c, states, viewer.level);
  const kept = keptFor(c);
  const k =
    sizeKey(map) +
    '|' +
    statesKey(c, states) +
    '|' +
    viewer.level +
    '|' +
    viewer.point.x +
    ',' +
    viewer.point.y;
  let region = kept.views.get(k);
  if (!region) region = remember(kept.views, k, regionOf(blockers, viewer.point));
  return { viewer, blockers, region, key: k, kept, width: map.width, height: map.height };
}

/**
 * The squares in sight from `from` on a battle map, for a save's doors
 * (`states`, by door id): an object keyed "x,y", `from`'s own square
 * included; empty when `from` is off the grid. It is kept for the next look
 * from there, so it is frozen: copy it to add to it.
 */
function inSight(map, from, states, options) {
  const view = viewOf(map, from, states, options);
  if (!view) return {};
  const done = view.kept.squares.get(view.key);
  if (done) return done;
  const seen = {};
  const cell = { x: 0, y: 0 };
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      cell.x = x;
      cell.y = y;
      if (squareSeen(view, cell)) seen[x + ',' + y] = true;
    }
  }
  seen[key(view.viewer.cell)] = true;
  return remember(view.kept.squares, view.key, Object.freeze(seen));
}

/** Whether `to` (a square, or someone with a `cell`) is in sight from `from`. */
function sees(map, from, to, states, options) {
  const view = viewOf(map, from, states, options);
  const cell = to && (to.cell || to);
  if (!view || !cell || !onGrid(map, cell)) return false;
  const done = view.kept.squares.get(view.key);
  if (done) return Boolean(done[key(cell)]);
  if (cell.x === view.viewer.cell.x && cell.y === view.viewer.cell.y) return true;
  return squareSeen(view, cell);
}

// Whether segment p–q crosses any of `list` ({ ax, ay, bx, by }), short of
// its ends.
function crossesAny(list, count, p, q) {
  const len = hyp(q.x - p.x, q.y - p.y);
  if (!len) return false;
  const dx = (q.x - p.x) / len;
  const dy = (q.y - p.y) / len;
  for (let i = 0; i < count; i++) {
    const s = list[i];
    const t = rayHit(p.x, p.y, dx, dy, s.ax, s.ay, s.bx, s.by);
    if (t > 1e-6 && t < len - 1e-6) return true;
  }
  return false;
}

/**
 * The lines from `from`'s eyes to points across `to` (someone where they
 * stand, { cell, point?, width? }, or a square), for cover (L-923; combat
 * PS2): five lines to points spread across the target's width, square to
 * the line between them. `{ blocked, covered }`: how many something that
 * hides from those eyes stops, and how many of the rest cross something
 * that stops movement but doesn't hide (a low wall, glass, a table).
 */
function linesTo(map, from, to, states, options) {
  const view = viewOf(map, from, states, options);
  const spot = mapPaths.spotOf(to);
  if (!view || !spot) return { blocked: 0, covered: 0 };
  const p = view.viewer.point;
  const t = spot.point;
  const len = hyp(t.x - p.x, t.y - p.y);
  if (!len) return { blocked: 0, covered: 0 };
  const px = -(t.y - p.y) / len;
  const py = (t.x - p.x) / len;
  const b = view.blockers;
  let blocked = 0;
  let covered = 0;
  for (const k of [-2, -1, 0, 1, 2]) {
    const off = (k / 2) * (spot.width / 2);
    const q = { x: t.x + px * off, y: t.y + py * off };
    if (crossesAny(b.segs, b.inside, p, q)) blocked++;
    else if (crossesAny(b.barriers, b.barriers.length, p, q)) covered++;
  }
  return { blocked, covered };
}

/**
 * The outline of what `from` sees (L-924, for the fog drawn to the sight
 * lines): the region seen as a flat list of points in feet, [x0, y0, x1, y1,
 * …], in order round the eyes, points on a straight run left out, each to
 * the hundredth of a foot. Null off the grid.
 */
function outline(map, from, states, options) {
  const view = viewOf(map, from, states, options);
  if (!view) return null;
  const r = view.region;
  const n = r.angles.length;
  const round = (v) => Math.round(v * 100) / 100 || 0; // never -0
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const q = (i + 1) % n;
    const ax = r.xs[i] - r.xs[p];
    const ay = r.ys[i] - r.ys[p];
    const bx = r.xs[q] - r.xs[p];
    const by = r.ys[q] - r.ys[p];
    // On a straight run: the turn there is nothing, however close the points.
    if (abs(ax * by - ay * bx) <= 1e-9 * hyp(ax, ay) * hyp(bx, by)) continue;
    out.push(round(r.xs[i]), round(r.ys[i]));
  }
  return out;
}

/**
 * The height of someone's eyes where they stand on a battle map, in feet:
 * the floor's height plus their size's eyes (for the GM, and high ground).
 */
function eyeLevel(map, from, options) {
  const viewer = viewerOf(map, from, options);
  return viewer ? viewer.level : 0;
}

module.exports = { inSight, sees, viewOf, outline, linesTo, eyeLevel, inRegion, rayHit };
