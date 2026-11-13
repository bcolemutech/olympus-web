'use strict';

/**
 * A world's layer from its Azgaar save (planning/worlds-without-azgaar.md
 * §4.7, AZ2, AZ5; L-717 / #822): an Azgaar "Export to JSON → Full" file read
 * and turned into the geometry of the world's top region map, with what to
 * call over MCP to write it and a dry-run report. Pure: no I/O, no Firebase.
 *
 *   readSave(input)          the save normalized: its size, cells (their
 *                            outlines, height, biome, province, state),
 *                            features, biomes, rivers, states, provinces,
 *                            burgs; or throws a SaveFormatError saying what
 *                            to give instead
 *   convert(save, options)   { mapId, bounds, geometry, realms, regions,
 *                            settlements, calls, report }
 *   biomeMaterial(name)      the built-in ground an Azgaar biome becomes
 *   formatReport(result)     the report as lines of text
 *   previewSvg(result)       an SVG of the result, to look at before writing
 *
 * What it makes, on the top region map (`map_world`), whose units are the
 * save's pixels (L-902), so nothing moves:
 *
 *   ground  `sea`: the whole map as ocean, first; over it the land and the
 *           lakes, every cell taking its biome's material (hills and
 *           mountains where Azgaar draws its relief icons: above 50 and 70),
 *           a lake its lake's. Cells of one material are merged into
 *           polygons, their shared edges removed and their rings traced
 *           (holes as rings inside, even-odd), packed into items of at most
 *           2000 points: `<material>-<n>`.
 *   lines   each river along its cells' centres, `river-<i>` (a creek,
 *           brook or stream as `stream`).
 *   zones   each province's land, `prov-<i>`, naming its region; a lake
 *           wholly inside one province is part of it.
 *
 * Realms and regions: each state is a realm and each province a region.
 * Given the world (`options.world`, get_world's answer or the world's own
 * factions and regions), each is matched by the id its import gave it
 * (`fac_<i>`, `reg_<i>`, ./functions/cartographer/map.js), else by name, else
 * it is to be added (add_realms, add_regions). Without the world, the
 * import's ids are assumed.
 *
 * Simplifying: borders are simplified once where two polygons share them,
 * so neighbours keep meeting with no gap, and the tolerance grows until the
 * map fits map-geometry.js's limits (2000 points a shape, 20 000 a map;
 * `options.budget`, 18 000 by default, leaves room for what else it has). A
 * ring left crossing itself gets its borders back. The result is checked
 * with map-geometry.js's own check, as set_ground will.
 */

const geo = require('../../functions/loom-canon/map-geometry');

const MAP_ID = 'map_world';
const SEA_LEVEL = 20;
const HILLS = 50; // above: hills (Azgaar's relief icons)
const MOUNTAINS = 70; // above: mountains
const MAX_POINTS = 2000; // in one shape (map-geometry.js)
const MAX_ITEMS = 500; // in one list (map-geometry.js)
const MAX_SET = 100; // items in one set_* call (patch-tools.js)
const MAX_NEW_REALMS = 20; // in one add_realms call (write-tools.js)
const MAX_NEW_REGIONS = 50; // in one add_regions call (write-tools.js)
const DEFAULTS = {
  mapId: MAP_ID,
  tolerance: 1,
  budget: 18000,
  relief: true,
  step: 1,
  callChars: 30000,
  worldId: '<worldId>',
};
const MAX_TRIES = 14;
const GROW = 1.4;

class SaveFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SaveFormatError';
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const normal = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

// ── Biomes ──────────────────────────────────────────────────────────────

// Azgaar's default biomes by name; a renamed or added one is read by its
// words (BIOME_WORDS), else grassland with a warning.
const BIOMES = {
  marine: 'ocean',
  'hot desert': 'desert',
  'cold desert': 'desert',
  savanna: 'savanna',
  grassland: 'grassland',
  'tropical seasonal forest': 'forest',
  'temperate deciduous forest': 'forest',
  'tropical rainforest': 'jungle',
  'temperate rainforest': 'forest',
  taiga: 'taiga',
  tundra: 'tundra',
  glacier: 'glacier',
  wetland: 'marsh',
};
const BIOME_WORDS = [
  [/rain ?forest|jungle/, 'jungle'],
  [/taiga|boreal/, 'taiga'],
  [/forest|wood/, 'forest'],
  [/desert|dune/, 'desert'],
  [/savann?a/, 'savanna'],
  [/tundra/, 'tundra'],
  [/glacier|ice|snow/, 'glacier'],
  [/swamp/, 'swamp'],
  [/wetland|marsh|bog|fen/, 'marsh'],
  [/farm|field/, 'farmland'],
  [/grass|steppe|prairie|meadow|plain/, 'grassland'],
  [/hill/, 'hills'],
  [/mountain/, 'mountains'],
  [/marine|ocean|sea/, 'ocean'],
];

/** The built-in ground an Azgaar biome becomes, or null if its name says nothing. */
function biomeMaterial(name) {
  const key = normal(name);
  if (BIOMES[key]) return BIOMES[key];
  for (const [pattern, material] of BIOME_WORDS) if (pattern.test(key)) return material;
  return null;
}

// A lake's ground by its group (Azgaar: freshwater, salt, frozen, lava, dry,
// sinkhole).
function lakeMaterial(group) {
  const key = normal(group);
  if (key === 'frozen') return 'ice';
  if (key === 'lava') return 'lava';
  if (key === 'dry') return 'mud';
  return 'lake';
}

// ── Reading the save ────────────────────────────────────────────────────

const realEntries = (list) =>
  (Array.isArray(list) ? list : []).filter((e) => isObject(e) && num(e.i) && e.i > 0 && !e.removed);

/**
 * An Azgaar full JSON export (a Buffer, a string or the parsed object) read
 * into what convert() needs. Throws a SaveFormatError for a .map file, a
 * minimal or slimmed export (no cell outlines), or anything else.
 */
function readSave(input) {
  let doc = input;
  if (Buffer.isBuffer(doc)) doc = doc.toString('utf8');
  if (typeof doc === 'string') {
    const text = doc.replace(/^﻿/, '').trimStart();
    if (!text.startsWith('{')) {
      const first = text.slice(0, 200).split(/\r?\n/)[0];
      if (first.includes('|')) {
        throw new SaveFormatError(
          'This is an Azgaar .map file, which keeps no cell outlines. Open it in Azgaar ' +
            '(Load), then Export → Export to JSON → Full, and give that file.'
        );
      }
      throw new SaveFormatError('This is not an Azgaar JSON export.');
    }
    try {
      doc = JSON.parse(text);
    } catch (err) {
      throw new SaveFormatError(`The file is not valid JSON: ${err.message}`);
    }
  }
  if (!isObject(doc) || !isObject(doc.pack) || !Array.isArray(doc.pack.cells)) {
    throw new SaveFormatError('This is not an Azgaar full JSON export: it has no pack.cells.');
  }
  const info = isObject(doc.info) ? doc.info : {};
  const width = Number(info.width);
  const height = Number(info.height);
  if (!(width > 0) || !(height > 0)) {
    throw new SaveFormatError('The export has no map size (info.width and info.height).');
  }
  const { pack } = doc;
  const outlines = Array.isArray(pack.vertices) && pack.cells.some((c) => c && Array.isArray(c.v));
  if (!outlines) {
    throw new SaveFormatError(
      'The export keeps no cell outlines (pack.vertices and each cell’s v): export the Full ' +
        'JSON from Azgaar (Export → Export to JSON → Full), not the minimal one or a slimmed ' +
        'fixture.'
    );
  }
  const vertices = pack.vertices.map((v) => {
    const p = isObject(v) ? v.p : v;
    return Array.isArray(p) && num(p[0]) && num(p[1]) ? [p[0], p[1]] : null;
  });
  const cells = pack.cells.map((c, i) => ({
    i,
    v: c && Array.isArray(c.v) ? c.v : [],
    p: c && Array.isArray(c.p) && num(c.p[0]) && num(c.p[1]) ? [c.p[0], c.p[1]] : null,
    h: c && num(c.h) ? c.h : 0,
    f: c && num(c.f) ? c.f : 0,
    biome: c && num(c.biome) ? c.biome : 0,
    province: c && num(c.province) ? c.province : 0,
    state: c && num(c.state) ? c.state : 0,
  }));
  let biomes = [];
  if (Array.isArray(pack.biomes) && pack.biomes.length) {
    biomes = pack.biomes.map((b, i) => ({ i: num(b && b.i) ? b.i : i, name: (b && b.name) || '' }));
  } else if (isObject(doc.biomesData) && Array.isArray(doc.biomesData.name)) {
    biomes = doc.biomesData.name.map((name, i) => ({ i, name }));
  }
  const features = (Array.isArray(pack.features) ? pack.features : []).map((f) =>
    isObject(f) ? { i: f.i, type: f.type, group: f.group, land: f.land } : null
  );
  return {
    mapName: info.mapName || '',
    version: info.version || '',
    width,
    height,
    cells,
    vertices,
    features,
    biomes,
    rivers: realEntries(pack.rivers).map((r) => ({
      i: r.i,
      name: r.name || '',
      type: r.type || '',
      cells: Array.isArray(r.cells) ? r.cells : [],
    })),
    states: realEntries(pack.states).map((s) => ({
      i: s.i,
      name: s.name || `State ${s.i}`,
      fullName: s.fullName || '',
      color: s.color,
    })),
    provinces: realEntries(pack.provinces).map((p) => ({
      i: p.i,
      name: p.name || `Province ${p.i}`,
      fullName: p.fullName || '',
      state: num(p.state) ? p.state : 0,
    })),
    burgs: realEntries(pack.burgs)
      .filter((b) => num(b.x) && num(b.y))
      .map((b) => ({ i: b.i, name: b.name || `Burg ${b.i}`, x: b.x, y: b.y, cell: b.cell })),
  };
}

// ── Plane geometry ──────────────────────────────────────────────────────

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  let t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (p[0] < x) inside = !inside;
    }
  }
  return inside;
}

const inRings = (p, rings) => rings.reduce((inside, ring) => inside !== inRing(p, ring), false);

function boxOf(ring) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) {
    if (x < box[0]) box[0] = x;
    if (y < box[1]) box[1] = y;
    if (x > box[2]) box[2] = x;
    if (y > box[3]) box[3] = y;
  }
  return box;
}

// Whether a ring touches or crosses itself, as map-geometry.js's check reads
// it (two segments that aren't neighbours meeting at all).
function crossesItself(ring) {
  const n = ring.length;
  const segs = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    segs.push([
      a,
      b,
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ]);
  }
  for (let i = 0; i < n; i++) {
    const s = segs[i];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const t = segs[j];
      if (t[2] > s[4] || t[4] < s[2] || t[3] > s[5] || t[5] < s[3]) continue;
      if (geo.meet(s[0], s[1], t[0], t[1])) return true;
    }
  }
  return false;
}

// ── Path data, compact for sending over MCP ─────────────────────────────

function fmt(n) {
  const r = Math.round(n * 1000) / 1000;
  return String(r === 0 ? 0 : r);
}

// Relative moves after the first point: "M120 40l3 -5 4 2Z". map-geometry.js
// stores it as absolute path data.
function pathOf(lines, closed) {
  return lines
    .map((pts) => {
      let s = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
      if (pts.length > 1) s += 'l';
      for (let i = 1; i < pts.length; i++) {
        s += `${i > 1 ? ' ' : ''}${fmt(pts[i][0] - pts[i - 1][0])} ${fmt(pts[i][1] - pts[i - 1][1])}`;
      }
      return closed ? `${s}Z` : s;
    })
    .join('');
}

// ── The cells as a planar map ───────────────────────────────────────────

// Vertices clamped into the map and snapped to `step`, those that land on
// one point merged, and each cell's outline as a ring of vertex ids, all
// turned the same way (positive area).
function planOf(save, step) {
  const { width, height } = save;
  const snap = (v, hi) => clamp(Math.round(v / step) * step, 0, hi);
  const byPoint = new Map();
  const points = [];
  const canon = save.vertices.map((p) => {
    if (!p) return -1;
    const x = snap(p[0], width);
    const y = snap(p[1], height);
    const key = `${x},${y}`;
    let id = byPoint.get(key);
    if (id === undefined) {
      id = points.length;
      points.push([x, y]);
      byPoint.set(key, id);
    }
    return id;
  });
  const loops = save.cells.map((cell) => {
    const ring = [];
    for (const j of cell.v) {
      const id = num(j) && j >= 0 && j < canon.length ? canon[j] : -1;
      if (id >= 0 && ring[ring.length - 1] !== id) ring.push(id);
    }
    while (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop();
    if (ring.length < 3 || new Set(ring).size !== ring.length) return null;
    const area = ringArea(ring.map((id) => points[id]));
    if (Math.abs(area) < 1e-9) return null;
    return area < 0 ? ring.reverse() : ring;
  });
  const N = points.length;
  const edgeCell = new Map();
  loops.forEach((loop, i) => {
    if (!loop) return;
    for (let k = 0; k < loop.length; k++) {
      edgeCell.set(loop[k] * N + loop[(k + 1) % loop.length], i);
    }
  });
  const neighbours = (i) => {
    const loop = loops[i];
    const out = new Set();
    if (!loop) return out;
    for (let k = 0; k < loop.length; k++) {
      const j = edgeCell.get(loop[(k + 1) % loop.length] * N + loop[k]);
      if (j !== undefined) out.add(j);
    }
    return out;
  };
  return { points, loops, edgeCell, N, neighbours };
}

// ── A partition: cells grouped by a key, traced and simplified ──────────

/**
 * The cells grouped by `keys[i]` (null: in no group), as each group's rings
 * of vertex ids, and the borders between groups as arcs that simplify once
 * for both sides. Returns { groups: Map(key → [ring]), simplify(tol) }, where
 * simplify gives Map(key → [[x, y] ring]) and what it dropped or repaired.
 */
function partition(plan, keys) {
  const { points, loops, edgeCell, N } = plan;
  const keyOf = (i) => (i === undefined || keys[i] === undefined ? null : keys[i]);
  const directed = new Map(); // key → [[a, b]]
  const adj = new Map(); // vertex → [{ to, label }]
  const link = (a, b, label) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, label });
  };
  loops.forEach((loop, i) => {
    const k = keyOf(i);
    if (!loop || k === null) return;
    for (let n = 0; n < loop.length; n++) {
      const a = loop[n];
      const b = loop[(n + 1) % loop.length];
      const other = keyOf(edgeCell.get(b * N + a));
      if (other === k) continue;
      if (!directed.has(k)) directed.set(k, []);
      directed.get(k).push([a, b]);
      if (other === null || String(k) < String(other)) {
        const label = other === null ? `${k}|` : [String(k), String(other)].sort().join('|');
        link(a, b, label);
        link(b, a, label);
      }
    }
  });

  // Arcs: runs of border between nodes (where the border forks or the groups
  // on its two sides change), and loops with no node.
  const nodes = new Set();
  for (const [v, list] of adj) {
    if (list.length !== 2 || list[0].label !== list[1].label) nodes.add(v);
  }
  const seen = new Set();
  const edgeKey = (a, b) => (a < b ? a * N + b : b * N + a);
  const arcs = [];
  const arcOf = new Map();
  const walk = (start, first) => {
    const arc = [start];
    let prev = start;
    let cur = first;
    seen.add(edgeKey(prev, cur));
    while (!nodes.has(cur)) {
      arc.push(cur);
      const next = adj.get(cur).find((e) => !seen.has(edgeKey(cur, e.to)));
      if (!next) break;
      seen.add(edgeKey(cur, next.to));
      prev = cur;
      cur = next.to;
    }
    arc.push(cur);
    const index = arcs.length;
    arcs.push(arc);
    for (let i = 1; i < arc.length - 1; i++) arcOf.set(arc[i], index);
  };
  for (const v of nodes) {
    for (const e of adj.get(v)) if (!seen.has(edgeKey(v, e.to))) walk(v, e.to);
  }
  for (const [v, list] of adj) {
    for (const e of list) {
      if (seen.has(edgeKey(v, e.to))) continue;
      nodes.add(v);
      walk(v, e.to);
    }
  }

  // Rings: each group's border edges followed round, turning at a fork onto
  // the edge that keeps the same wedge of the group, then split where a ring
  // comes back to a vertex (even-odd reads the pieces the same).
  const angle = (a, b) => Math.atan2(points[b][1] - points[a][1], points[b][0] - points[a][0]);
  const groups = new Map();
  let broken = 0;
  for (const [k, edges] of directed) {
    const out = new Map();
    for (const [a, b] of edges) {
      if (!out.has(a)) out.set(a, []);
      out.get(a).push(b);
    }
    const used = new Set();
    const rings = [];
    for (const [a0, b0] of edges) {
      if (used.has(a0 * N + b0)) continue;
      used.add(a0 * N + b0);
      const ring = [a0];
      let prev = a0;
      let cur = b0;
      let ok = true;
      while (cur !== a0) {
        ring.push(cur);
        const options = (out.get(cur) || []).filter((b) => !used.has(cur * N + b));
        if (!options.length) {
          ok = false;
          break;
        }
        let next = options[0];
        if (options.length > 1) {
          const back = angle(cur, prev);
          let best = Infinity;
          for (const b of options) {
            let turn = back - angle(cur, b);
            while (turn <= 0) turn += 2 * Math.PI;
            if (turn < best) {
              best = turn;
              next = b;
            }
          }
        }
        used.add(cur * N + next);
        prev = cur;
        cur = next;
      }
      if (!ok) {
        broken += 1;
        continue;
      }
      for (const piece of splitRepeats(ring)) rings.push(piece);
    }
    groups.set(k, rings);
  }

  function simplify(tol) {
    const kept = new Set(nodes);
    for (const arc of arcs) keepArc(arc, points, tol, kept);
    const restored = new Set();
    const read = (ring) => {
      const out = [];
      for (const v of ring) if (kept.has(v)) out.push(points[v]);
      return out;
    };
    const all = [];
    for (const [k, rings] of groups)
      for (const ring of rings) all.push({ k, ring, pts: read(ring) });
    let repaired = 0;
    let unrepaired = 0;
    let check = all;
    for (let round = 0; round < 8 && check.length; round++) {
      const bad = check.filter((r) => r.pts.length >= 3 && crossesItself(r.pts));
      if (!bad.length) break;
      let changed = false;
      for (const r of bad) {
        for (const v of r.ring) {
          const arc = arcOf.get(v);
          if (arc === undefined || restored.has(arc)) continue;
          restored.add(arc);
          for (const w of arcs[arc]) kept.add(w);
          changed = true;
        }
      }
      if (!changed) {
        unrepaired += bad.length;
        break;
      }
      repaired += bad.length;
      check = [];
      for (const r of all) {
        const pts = read(r.ring);
        if (pts.length !== r.pts.length) {
          r.pts = pts;
          check.push(r);
        }
      }
    }
    const out = new Map();
    let dropped = 0;
    for (const r of all) {
      if (r.pts.length < 3 || Math.abs(ringArea(r.pts)) < 1e-6) {
        dropped += 1;
        continue;
      }
      if (!out.has(r.k)) out.set(r.k, []);
      out.get(r.k).push(r.pts);
    }
    return { rings: out, dropped, repaired, unrepaired };
  }

  return { groups, simplify, broken };
}

// A ring that comes back to a vertex, split there into simple rings.
function splitRepeats(ring) {
  const pieces = [];
  const stack = [];
  const at = new Map();
  for (const v of ring) {
    if (at.has(v)) {
      const piece = stack.splice(at.get(v) + 1);
      for (const p of piece) at.delete(p);
      pieces.push([v, ...piece]);
    } else {
      at.set(v, stack.length);
      stack.push(v);
    }
  }
  pieces.push(stack);
  return pieces.filter((p) => p.length >= 3);
}

// Douglas–Peucker over one arc, its ends kept; a closed arc (a loop) keeps
// two more points far apart so it stays a ring.
function keepArc(arc, points, tol, kept) {
  const at = (i) => points[arc[i]];
  const run = (i, j) => {
    const stack = [[i, j]];
    while (stack.length) {
      const [a, b] = stack.pop();
      if (b <= a + 1) continue;
      let far = -1;
      let best = tol;
      for (let k = a + 1; k < b; k++) {
        const d = segmentDistance(at(k), at(a), at(b));
        if (d > best) {
          best = d;
          far = k;
        }
      }
      if (far >= 0) {
        kept.add(arc[far]);
        stack.push([a, far], [far, b]);
      }
    }
  };
  const last = arc.length - 1;
  if (arc[0] !== arc[last]) {
    run(0, last);
    return;
  }
  // A loop: its start, the point farthest from it, and the one farthest from
  // the line between them.
  let far = 1;
  for (let k = 1; k < last; k++) {
    if (
      Math.hypot(at(k)[0] - at(0)[0], at(k)[1] - at(0)[1]) >
      Math.hypot(at(far)[0] - at(0)[0], at(far)[1] - at(0)[1])
    ) {
      far = k;
    }
  }
  let third = -1;
  let best = -1;
  for (let k = 1; k < last; k++) {
    if (k === far) continue;
    const d = segmentDistance(at(k), at(0), at(far));
    if (d > best) {
      best = d;
      third = k;
    }
  }
  const forced = [0, far, third, last].filter((k) => k >= 0).sort((a, b) => a - b);
  for (const k of forced) kept.add(arc[k]);
  for (let n = 0; n < forced.length - 1; n++) run(forced[n], forced[n + 1]);
}

// ── Rings into items ────────────────────────────────────────────────────

// A group's rings as parts: each outer ring with the holes inside it.
function partsOf(rings) {
  const outers = [];
  const holes = [];
  for (const ring of rings) {
    const area = ringArea(ring);
    (area > 0 ? outers : holes).push({ ring, area: Math.abs(area), box: boxOf(ring) });
  }
  const parts = outers.map((o) => ({ rings: [o.ring], points: o.ring.length, area: o.area }));
  let orphans = 0;
  for (const h of holes) {
    let home = -1;
    for (let i = 0; i < outers.length; i++) {
      const o = outers[i];
      if (o.area <= h.area) continue;
      if (
        h.box[0] < o.box[0] ||
        h.box[1] < o.box[1] ||
        h.box[2] > o.box[2] ||
        h.box[3] > o.box[3]
      ) {
        continue;
      }
      const sample = h.ring.filter((_, n) => n % Math.max(1, Math.floor(h.ring.length / 7)) === 0);
      const votes = sample.filter((p) => inRing(p, o.ring)).length;
      if (votes * 2 > sample.length && (home < 0 || o.area < outers[home].area)) home = i;
    }
    if (home < 0) {
      orphans += 1;
      continue;
    }
    parts[home].rings.push(h.ring);
    parts[home].points += h.ring.length;
    parts[home].area -= h.area;
  }
  return { parts, orphans };
}

// Parts packed into shapes of at most MAX_POINTS points, biggest first.
function pack(parts) {
  const bins = [];
  for (const part of [...parts].sort((a, b) => b.points - a.points)) {
    const bin = bins.find((b) => b.points + part.points <= MAX_POINTS);
    if (bin) {
      bin.rings.push(...part.rings);
      bin.points += part.points;
      bin.area += part.area;
    } else {
      bins.push({ rings: [...part.rings], points: part.points, area: part.area });
    }
  }
  return bins;
}

// ── Realms and regions ──────────────────────────────────────────────────

// The world's factions and regions from get_world's answer ({ factions |
// realms: [{ id, name, regions: [{ id, name }] }] }) or its own documents
// ({ factions: { id: {…} }, regions: { id: {…} } }).
function worldIndex(world) {
  if (!isObject(world)) return null;
  const list = (v) => (Array.isArray(v) ? v : isObject(v) ? Object.values(v) : []);
  const factions = new Map();
  const regions = new Map();
  for (const f of [...list(world.factions), ...list(world.realms)]) {
    if (!isObject(f) || !f.id || f.retired) continue;
    factions.set(f.id, { id: f.id, name: f.name || '' });
    for (const r of list(f.regions)) {
      if (isObject(r) && r.id && !r.retired) {
        regions.set(r.id, { id: r.id, name: r.name || '', factionId: f.id });
      }
    }
  }
  for (const r of list(world.regions)) {
    if (!isObject(r) || !r.id || r.retired) continue;
    regions.set(r.id, { id: r.id, name: r.name || '', factionId: r.factionId || null });
  }
  return { factions, regions };
}

function matchOne(index, id, names) {
  if (!index) return { id, how: 'assumed' };
  if (index.has(id)) return { id, how: 'id' };
  const wanted = names.map(normal).filter(Boolean);
  for (const entry of index.values()) {
    if (wanted.includes(normal(entry.name))) return { id: entry.id, how: 'name' };
  }
  return { id: null, how: 'new' };
}

const NEW = (name) => `new:${name}`;

function matchEntities(save, world) {
  const index = worldIndex(world);
  const realms = save.states.map((s) => {
    const m = matchOne(index && index.factions, `fac_${s.i}`, [s.name, s.fullName]);
    const colour =
      typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : null;
    return { state: s.i, name: s.name, id: m.id, how: m.how, ...(colour ? { colour } : {}) };
  });
  const realmOf = new Map(realms.map((r) => [r.state, r]));
  const regions = save.provinces.map((p) => {
    const m = matchOne(index && index.regions, `reg_${p.i}`, [p.name, p.fullName]);
    const realm = realmOf.get(p.state) || null;
    const realmId = realm ? realm.id || NEW(realm.name) : null;
    const entry = { province: p.i, name: p.name, id: m.id, how: m.how, realmId };
    if (index && m.id) {
      const has = index.regions.get(m.id);
      if (has && (has.factionId || null) !== realmId) entry.realmWas = has.factionId || null;
    }
    return entry;
  });
  return { realms, regions, checked: Boolean(index) };
}

// ── Converting ──────────────────────────────────────────────────────────

function cellKeys(save, plan, options, warn) {
  const terrain = [];
  const province = [];
  const unknownBiomes = new Map();
  const provinceIds = new Set(save.provinces.map((p) => p.i));
  const biomeName = new Map(save.biomes.map((b) => [b.i, b.name]));
  let stateless = 0;
  const lakeCells = new Map(); // lake feature → [cell]
  save.cells.forEach((cell, i) => {
    if (!plan.loops[i]) {
      terrain.push(null);
      province.push(null);
      return;
    }
    if (cell.h < SEA_LEVEL) {
      const feature = save.features[cell.f];
      if (feature && feature.type === 'lake') {
        terrain.push(lakeMaterial(feature.group));
        if (!lakeCells.has(cell.f)) lakeCells.set(cell.f, []);
        lakeCells.get(cell.f).push(i);
      } else {
        terrain.push(null); // the sea: under everything
      }
      province.push(null);
      return;
    }
    const name = biomeName.get(cell.biome) || '';
    let material = biomeMaterial(name);
    if (!material || material === 'ocean') {
      const label = name || `#${cell.biome}`;
      unknownBiomes.set(label, (unknownBiomes.get(label) || 0) + 1);
      material = 'grassland';
    }
    if (options.relief && material !== 'glacier') {
      if (cell.h > MOUNTAINS) material = 'mountains';
      else if (cell.h > HILLS) material = 'hills';
    }
    terrain.push(material);
    if (cell.province > 0 && provinceIds.has(cell.province)) province.push(cell.province);
    else {
      province.push(null);
      if (cell.state > 0) stateless += 1;
    }
  });
  // A lake wholly inside one province is part of it.
  let lakesIn = 0;
  for (const cellsOfLake of lakeCells.values()) {
    const around = new Set();
    const inLake = new Set(cellsOfLake);
    for (const i of cellsOfLake) {
      for (const j of plan.neighbours(i)) {
        if (!inLake.has(j) && save.cells[j].h >= SEA_LEVEL) around.add(province[j]);
      }
    }
    if (around.size === 1 && !around.has(null)) {
      const [only] = around;
      for (const i of cellsOfLake) province[i] = only;
      lakesIn += 1;
    }
  }
  for (const [name, count] of unknownBiomes) {
    warn('biome', `${count} land cells of the biome "${name}" taken as grassland.`, count);
  }
  if (stateless) {
    warn(
      'no-province',
      `${stateless} cells of a state are in no province, so in no region: their realm has no ` +
        'land there.',
      stateless
    );
  }
  return { terrain, province, lakesIn, lakes: lakeCells.size };
}

function riverLines(save, plan, tol, step) {
  const snap = (v, hi) => clamp(Math.round(v / step) * step, 0, hi);
  const lines = [];
  let skipped = 0;
  for (const river of save.rivers) {
    const pts = [];
    for (const c of river.cells) {
      const cell = num(c) && c >= 0 ? save.cells[c] : null;
      if (!cell || !cell.p) continue;
      const p = [snap(cell.p[0], save.width), snap(cell.p[1], save.height)];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
    }
    if (pts.length < 2) {
      skipped += 1;
      continue;
    }
    const kept = new Set([0, pts.length - 1]);
    const ids = pts.map((_, i) => i);
    keepArc(ids, pts, tol, kept);
    const line = pts.filter((_, i) => kept.has(i));
    const stream = /creek|brook|stream|rivulet|spring|burn|runnel/i.test(river.type);
    lines.push({
      id: `river-${river.i}`,
      material: stream ? 'stream' : 'river',
      pts: line,
      name: river.name,
    });
  }
  return { lines, skipped };
}

function build(save, plan, parts, options, tol) {
  const terrain = parts.terrain.simplify(tol);
  const provinces = parts.province.simplify(tol);
  const rivers = riverLines(save, plan, tol, options.step);
  let orphans = 0;
  let biggest = 0;

  const ground = [];
  const materials = [...terrain.rings.keys()].sort();
  for (const material of materials) {
    const read = partsOf(terrain.rings.get(material));
    orphans += read.orphans;
    pack(read.parts).forEach((bin, n) => {
      biggest = Math.max(biggest, bin.points);
      ground.push({
        id: `${material}-${n + 1}`,
        material,
        rings: bin.rings,
        points: bin.points,
        area: bin.area,
      });
    });
  }
  const zones = [];
  const byId = new Map(save.provinces.map((p) => [p.i, p]));
  for (const id of [...provinces.rings.keys()].sort((a, b) => a - b)) {
    const read = partsOf(provinces.rings.get(id));
    orphans += read.orphans;
    pack(read.parts).forEach((bin, n) => {
      biggest = Math.max(biggest, bin.points);
      zones.push({
        id: n ? `prov-${id}-${n + 1}` : `prov-${id}`,
        province: id,
        name: byId.get(id).name,
        rings: bin.rings,
        points: bin.points,
        area: bin.area,
      });
    });
  }
  const total =
    4 +
    ground.reduce((n, g) => n + g.points, 0) +
    zones.reduce((n, z) => n + z.points, 0) +
    rivers.lines.reduce((n, l) => n + l.pts.length, 0);
  return {
    tol,
    ground,
    zones,
    lines: rivers.lines,
    riversSkipped: rivers.skipped,
    total,
    biggest,
    orphans,
    dropped: terrain.dropped + provinces.dropped,
    repaired: terrain.repaired + provinces.repaired,
    unrepaired: terrain.unrepaired + provinces.unrepaired,
  };
}

const fits = (b, budget) =>
  b.biggest <= MAX_POINTS &&
  b.total <= budget &&
  b.ground.length + 1 <= MAX_ITEMS &&
  b.zones.length <= MAX_ITEMS &&
  b.lines.length <= MAX_ITEMS;

// Items into set_* calls of at most MAX_SET items and about `chars` long.
function batches(items, chars) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const item of items) {
    const n = JSON.stringify(item).length;
    if (cur.length && (cur.length >= MAX_SET || size + n > chars)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(item);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

const chunks = (list, n) => {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

/**
 * The save converted: the top region map's geometry and what to call to
 * write it. Options: mapId ('map_world'), worldId (in the calls), world (to
 * match realms and regions), tolerance (1, map units, grown until it fits),
 * budget (18 000 points), relief (true: hills and mountains by height),
 * step (1: points snapped to it), callChars (30 000: about how long one
 * set_* call may be).
 */
function convert(save, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const warnings = [];
  const warn = (code, message, count = 1) => warnings.push({ code, message, count });
  const bounds = { width: save.width, height: save.height };
  const plan = planOf(save, opts.step);
  const keys = cellKeys(save, plan, opts, warn);
  const parts = {
    terrain: partition(plan, keys.terrain),
    province: partition(plan, keys.province),
  };
  const broken = parts.terrain.broken + parts.province.broken;
  if (broken) warn('broken-ring', `${broken} borders didn’t close and were left out.`, broken);

  let tol = opts.tolerance;
  let built = build(save, plan, parts, opts, tol);
  for (let n = 0; n < MAX_TRIES && !fits(built, opts.budget); n++) {
    tol = Math.round(tol * GROW * 100) / 100;
    built = build(save, plan, parts, opts, tol);
  }
  if (!fits(built, opts.budget)) {
    warn('too-big', `Even at a tolerance of ${tol} it doesn’t fit: ${built.total} points.`);
  } else if (tol !== opts.tolerance) {
    warn(
      'tolerance',
      `Simplified at a tolerance of ${tol} map units (from ${opts.tolerance}) to fit.`
    );
  }
  if (built.dropped)
    warn('dropped', `${built.dropped} rings too small to keep were dropped.`, built.dropped);
  if (built.repaired)
    warn(
      'repaired',
      `${built.repaired} rings that crossed themselves got their borders back.`,
      built.repaired
    );
  if (built.unrepaired)
    warn('crossing', `${built.unrepaired} rings still cross themselves.`, built.unrepaired);
  if (built.orphans)
    warn('orphan-hole', `${built.orphans} holes inside no ring were left out.`, built.orphans);
  if (built.riversSkipped)
    warn(
      'river',
      `${built.riversSkipped} rivers with under two cells were left out.`,
      built.riversSkipped
    );

  const matched = matchEntities(save, opts.world);
  const regionOf = new Map(matched.regions.map((r) => [r.province, r]));
  const regionId = (province) => {
    const r = regionOf.get(province);
    return r.id || NEW(r.name);
  };

  const geometry = {
    ground: [
      {
        id: 'sea',
        material: 'ocean',
        shape: { rect: { x: 0, y: 0, w: save.width, h: save.height } },
      },
      ...built.ground.map((g) => ({
        id: g.id,
        material: g.material,
        shape: pathOf(g.rings, true),
      })),
    ],
    lines: built.lines.map((l) => ({
      id: l.id,
      material: l.material,
      points: pathOf([l.pts], false),
    })),
    zones: built.zones.map((z) => ({
      id: z.id,
      name: z.name,
      region: regionId(z.province),
      shape: pathOf(z.rings, true),
    })),
  };
  if (!geometry.lines.length) delete geometry.lines;
  // The ids a new region will be given aren't known yet: check with stand-ins.
  const problems = geo.check(geometry, bounds);

  const settlements = checkSettlements(save, built, keys);
  if (settlements.elsewhere.length || settlements.outside.length) {
    warn(
      'settlement',
      `${settlements.outside.length} settlements fall in no zone and ` +
        `${settlements.elsewhere.length} in another province’s.`,
      settlements.outside.length + settlements.elsewhere.length
    );
  }
  if (settlements.onWater.length) {
    warn(
      'settlement-water',
      `${settlements.onWater.length} settlements stand on water.`,
      settlements.onWater.length
    );
  }

  const calls = callsFor(geometry, matched, opts);
  const mapArea = save.width * save.height;
  const areaBy = {};
  for (const g of built.ground) areaBy[g.material] = (areaBy[g.material] || 0) + g.area;
  const covered = Object.values(areaBy).reduce((a, b) => a + b, 0);
  areaBy.ocean = (areaBy.ocean || 0) + Math.max(0, mapArea - covered);
  const share = (a) => Math.round((a / mapArea) * 1000) / 10;

  const report = {
    source: {
      mapName: save.mapName,
      version: save.version,
      width: save.width,
      height: save.height,
    },
    mapId: opts.mapId,
    tolerance: tol,
    counts: {
      cells: save.cells.length,
      landCells: save.cells.filter((c) => c.h >= SEA_LEVEL).length,
      lakes: keys.lakes,
      lakesInAProvince: keys.lakesIn,
      ground: geometry.ground.length,
      rings: built.ground.reduce((n, g) => n + g.rings.length, 0),
      rivers: built.lines.length,
      zones: built.zones.length,
      realms: matched.realms.length,
      regions: matched.regions.length,
      points: {
        ground: 4 + built.ground.reduce((n, g) => n + g.points, 0),
        lines: built.lines.reduce((n, l) => n + l.pts.length, 0),
        zones: built.zones.reduce((n, z) => n + z.points, 0),
        total: built.total,
        biggestShape: built.biggest,
      },
      calls: calls.length,
      callChars: calls.reduce((n, c) => n + JSON.stringify(c.args).length, 0),
    },
    areas: Object.fromEntries(
      Object.entries(areaBy)
        .sort((a, b) => b[1] - a[1])
        .map(([m, a]) => [m, share(a)])
    ),
    realms: tally(matched.realms),
    regions: tally(matched.regions),
    regionsMoved: matched.regions.filter((r) => r.realmWas !== undefined).length,
    settlements: {
      total: settlements.total,
      inTheirRegion: settlements.inTheirs,
      elsewhere: settlements.elsewhere.slice(0, 20),
      outside: settlements.outside.slice(0, 20),
      onWater: settlements.onWater.slice(0, 20),
    },
    warnings,
    problems,
  };
  return {
    mapId: opts.mapId,
    bounds,
    geometry,
    realms: matched.realms,
    regions: matched.regions,
    rivers: built.lines.map((l) => ({ id: l.id, name: l.name })),
    settlements,
    calls,
    report,
  };
}

function tally(list) {
  const out = { matchedById: 0, matchedByName: 0, assumed: 0, toAdd: 0 };
  for (const e of list) {
    if (e.how === 'id') out.matchedById += 1;
    else if (e.how === 'name') out.matchedByName += 1;
    else if (e.how === 'assumed') out.assumed += 1;
    else out.toAdd += 1;
  }
  return out;
}

// Where each settlement falls: in its own province's zone, another's, none;
// and whether the ground there is water.
function checkSettlements(save, built, keys) {
  const zones = built.zones.map((z) => ({
    province: z.province,
    rings: z.rings,
    box: boxOf(z.rings.flat()),
  }));
  const water = built.ground.filter(
    (g) => geo.MATERIALS.ground[g.material] && geo.MATERIALS.ground[g.material].water
  );
  const land = built.ground;
  const out = { total: 0, inTheirs: 0, elsewhere: [], outside: [], onWater: [] };
  for (const b of save.burgs) {
    out.total += 1;
    const p = [b.x, b.y];
    const want = num(b.cell) && keys.province[b.cell] !== undefined ? keys.province[b.cell] : null;
    let found = null;
    for (const z of zones) {
      if (p[0] < z.box[0] || p[0] > z.box[2] || p[1] < z.box[1] || p[1] > z.box[3]) continue;
      if (inRings(p, z.rings)) found = z.province;
    }
    if (found === null) out.outside.push(b.name);
    else if (want !== null && found !== want) out.elsewhere.push(b.name);
    else out.inTheirs += 1;
    // The topmost ground there; the sea where none.
    let top = 'ocean';
    for (const g of land) if (inRings(p, g.rings)) top = g.material;
    if (water.some((g) => g.material === top) || top === 'ocean') out.onWater.push(b.name);
  }
  return out;
}

function callsFor(geometry, matched, opts) {
  const calls = [];
  const worldId = opts.worldId;
  const newRealms = matched.realms.filter((r) => !r.id);
  for (const list of chunks(newRealms, MAX_NEW_REALMS)) {
    calls.push({
      tool: 'add_realms',
      args: {
        worldId,
        realms: list.map((r) => ({ name: r.name, ...(r.colour ? { colour: r.colour } : {}) })),
      },
      note: 'Put each new realm’s id in place of "new:<name>" in the calls after.',
    });
  }
  const newRegions = matched.regions.filter((r) => !r.id);
  for (const list of chunks(newRegions, MAX_NEW_REGIONS)) {
    calls.push({
      tool: 'add_regions',
      args: {
        worldId,
        regions: list.map((r) => ({
          name: r.name,
          ...(r.realmId ? { factionId: r.realmId } : {}),
        })),
      },
      note: 'Put each new region’s id in place of "new:<name>" in the zones.',
    });
  }
  for (const r of matched.regions) {
    if (r.id && r.realmWas !== undefined) {
      calls.push({
        tool: 'update_region',
        args: { worldId, regionId: r.id, factionId: r.realmId },
        note: `Its province is in that realm in the save; the world has it in ${r.realmWas || 'none'}.`,
      });
    }
  }
  const sets = [
    ['set_ground', geometry.ground],
    ['set_lines', geometry.lines || []],
    ['set_zones', geometry.zones],
  ];
  for (const [tool, items] of sets) {
    for (const set of batches(items, opts.callChars)) {
      calls.push({ tool, args: { worldId, mapId: opts.mapId, set } });
    }
  }
  return calls;
}

// ── Reading it ──────────────────────────────────────────────────────────

/** The dry-run report as lines of text. */
function formatReport(result) {
  const r = result.report;
  const c = r.counts;
  const lines = [
    `${r.source.mapName || 'The map'} (Azgaar ${r.source.version || '?'}), ${r.source.width} × ${r.source.height} → ${r.mapId}`,
    `Cells: ${c.cells} (${c.landCells} land); lakes ${c.lakes} (${c.lakesInAProvince} inside a province)`,
    `Ground: ${c.ground} items, ${c.rings} rings; rivers: ${c.rivers}; zones: ${c.zones}`,
    `Points: ${c.points.total} (ground ${c.points.ground}, lines ${c.points.lines}, zones ${c.points.zones}); biggest shape ${c.points.biggestShape}; tolerance ${r.tolerance}`,
    `Areas: ${Object.entries(r.areas)
      .map(([m, a]) => `${m} ${a}%`)
      .join(', ')}`,
    `Realms: ${describeTally(r.realms)}`,
    `Regions: ${describeTally(r.regions)}${r.regionsMoved ? `; ${r.regionsMoved} in another realm in the world` : ''}`,
    `Settlements: ${r.settlements.inTheirRegion} of ${r.settlements.total} in their province’s zone`,
    `Calls: ${c.calls} (${Math.round(c.callChars / 1000)}k characters)`,
  ];
  for (const w of r.warnings) lines.push(`Warning (${w.code}): ${w.message}`);
  for (const p of r.problems) lines.push(`Problem: ${p}`);
  if (!r.problems.length) lines.push('The geometry passes map-geometry.js’s check.');
  return lines;
}

function describeTally(t) {
  const parts = [];
  if (t.matchedById) parts.push(`${t.matchedById} matched by id`);
  if (t.matchedByName) parts.push(`${t.matchedByName} by name`);
  if (t.assumed) parts.push(`${t.assumed} assumed from the import's ids`);
  if (t.toAdd) parts.push(`${t.toAdd} to add`);
  return parts.join(', ') || 'none';
}

const COLOURS = {
  ocean: '#4f7fa8',
  lake: '#6fa8c9',
  ice: '#dfeef5',
  lava: '#c24a1a',
  mud: '#7a6248',
  grassland: '#b5c98a',
  farmland: '#d9cf8f',
  forest: '#5f8f4e',
  jungle: '#3f7a3a',
  savanna: '#d4c27a',
  desert: '#e6d29a',
  hills: '#a89a6a',
  mountains: '#8a7f72',
  tundra: '#b9c2b0',
  taiga: '#6f8f73',
  glacier: '#eef4f7',
  marsh: '#7f9f84',
  swamp: '#6b7f5a',
};

const escape = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );

/**
 * The result drawn as an SVG, to look at before writing: the terrain, the
 * rivers, each province's zone in its realm's colour (`overlay: 'realms'`,
 * the default) or outlined (`'regions'`), and the settlements as dots.
 */
function previewSvg(result, save, { overlay = 'realms' } = {}) {
  const { width, height } = result.bounds;
  const g = result.geometry;
  const realmColour = new Map(
    result.realms.map((r) => [r.id || NEW(r.name), r.colour || '#ff00ff'])
  );
  const regionRealm = new Map(result.regions.map((r) => [r.id || NEW(r.name), r.realmId]));
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<rect width="${width}" height="${height}" fill="${COLOURS.ocean}"/>`,
  ];
  for (const item of g.ground.slice(1)) {
    out.push(
      `<path d="${item.shape}" fill="${COLOURS[item.material] || '#cccccc'}" fill-rule="evenodd"/>`
    );
  }
  for (const line of g.lines || []) {
    const w = line.material === 'stream' ? 1 : 2;
    out.push(`<path d="${line.points}" fill="none" stroke="#2f6f9f" stroke-width="${w}"/>`);
  }
  for (const zone of g.zones) {
    const colour = realmColour.get(regionRealm.get(zone.region)) || '#ff00ff';
    const fill = overlay === 'realms' ? `fill="${colour}" fill-opacity="0.35"` : 'fill="none"';
    out.push(
      `<path d="${zone.shape}" ${fill} fill-rule="evenodd" stroke="${overlay === 'realms' ? colour : '#222'}" stroke-width="1"><title>${escape(zone.name)}</title></path>`
    );
  }
  for (const b of (save && save.burgs) || []) {
    out.push(
      `<circle cx="${fmt(b.x)}" cy="${fmt(b.y)}" r="2" fill="#111"><title>${escape(b.name)}</title></circle>`
    );
  }
  out.push('</svg>');
  return out.join('\n');
}

module.exports = {
  MAP_ID,
  SaveFormatError,
  readSave,
  convert,
  biomeMaterial,
  formatReport,
  previewSvg,
};
