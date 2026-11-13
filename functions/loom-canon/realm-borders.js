'use strict';

/**
 * Realm borders on a region map (planning/worlds-without-azgaar.md §4.4, R8;
 * L-714 / #819), for the world map to draw where the map has no image: each
 * realm's land as its regions' zones together, with
 *
 *   outlines  the land's edge, the runs of every zone's edge that no other
 *             zone of the same realm lies over, so a border between two of a
 *             realm's own regions isn't drawn: lists of points, flat
 *             [x0, y0, x1, y1, …], one that goes all the way round ends on
 *             its first point;
 *   land      the zones to fill, for the page to clip the soft edge to the
 *             inside: [{ outer: flat, holes: [flat…] }];
 *   centre    where its name goes: inside its land, in the biggest part of it.
 *
 * `bordersOn(world, mapId)` → [{ id, name, colour, outlines, land, centre }],
 * realms with land on that map only, in id order. Pure. Coordinates are the
 * map's own units, to two decimals.
 */

const geo = require('./map-geometry');
const realms = require('./realms');

const round = (n) => Math.round(n * 100) / 100;
const flat = (points) => points.flatMap((p) => [round(p[0]), round(p[1])]);

// The box of a list of rings.
function boxOf(rings) {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const ring of rings) {
    for (const [x, y] of ring) {
      b.x0 = Math.min(b.x0, x);
      b.y0 = Math.min(b.y0, y);
      b.x1 = Math.max(b.x1, x);
      b.y1 = Math.max(b.y1, y);
    }
  }
  return b;
}

const overlap = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

// Even-odd, as geometry reads a shape (holes are out).
function holds(zone, p) {
  if (p[0] < zone.box.x0 || p[0] > zone.box.x1 || p[1] < zone.box.y0 || p[1] > zone.box.y1) {
    return false;
  }
  let inside = false;
  for (const ring of zone.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a[1] > p[1] !== b[1] > p[1]) {
        const x = ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
        if (p[0] < x) inside = !inside;
      }
    }
  }
  return inside;
}

// Where along a→b (as fractions) the edges of `rings` cross it or have a
// corner on it: the places to cut a→b so that each piece is wholly inside
// or wholly outside what they hold.
function cuts(a, b, rings, tol) {
  const out = [];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (!len2) return out;
  const near = (p) => {
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    if (t <= 0 || t >= 1) return;
    if (Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) <= tol) out.push(t);
  };
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const c = ring[j];
      const d = ring[i];
      near(c);
      const ex = d[0] - c[0];
      const ey = d[1] - c[1];
      const den = dx * ey - dy * ex;
      if (!den) continue; // parallel: the corners above cut an overlap
      const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
      const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push(t);
    }
  }
  return out;
}

/**
 * The runs of one zone's edge that are the edge of the realm's land: a piece
 * of an edge is, if just outside the zone there (the side its own inside is
 * not) no other zone of the realm holds the point. Runs join where
 * consecutive pieces are kept.
 */
function edgeOf(zone, others, tol) {
  const runs = [];
  for (const ring of zone.rings) {
    const kept = []; // [{ from, to }] pieces in order round the ring
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const near = others.filter((o) => overlap(o.box, boxOf([[a, b]])));
      const ts = [0, 1].concat(
        near.length ? cuts(a, b, [].concat(...near.map((o) => o.rings)), tol) : []
      );
      ts.sort((p, q) => p - q);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      for (let k = 0; k + 1 < ts.length; k++) {
        if (ts[k + 1] - ts[k] < 1e-9) continue;
        const at = (t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        const mid = at((ts[k] + ts[k + 1]) / 2);
        // The point just across the edge from the zone's inside.
        const nx = -(b[1] - a[1]) / len;
        const ny = (b[0] - a[0]) / len;
        const left = [mid[0] + nx * tol, mid[1] + ny * tol];
        const right = [mid[0] - nx * tol, mid[1] - ny * tol];
        const out = holds(zone, left) ? right : left;
        if (others.some((o) => holds(o, out))) continue;
        kept.push({ from: at(ts[k]), to: at(ts[k + 1]), edge: i });
      }
    }
    runs.push(...join(kept));
  }
  return runs;
}

// Chains consecutive kept pieces into runs of points. A ring wholly kept
// comes back closed (its first point at the end); one kept from the end
// round to the start joins at the seam.
function join(kept) {
  if (!kept.length) return [];
  const runs = [];
  let run = null;
  let last = null;
  for (const piece of kept) {
    const continues = run && Math.hypot(piece.from[0] - last[0], piece.from[1] - last[1]) < 1e-6;
    if (!continues) {
      run = [piece.from];
      runs.push(run);
    }
    run.push(piece.to);
    last = piece.to;
  }
  // Round the seam: the last run ends where the first begins.
  if (runs.length > 1) {
    const first = runs[0];
    const tail = runs[runs.length - 1];
    const close = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
    if (close(tail[tail.length - 1], first[0])) {
      runs.pop();
      runs[0] = tail.concat(first.slice(1));
    }
  }
  return runs;
}

// A ring's signed area.
function areaOf(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// How many of a zone's other rings each ring lies inside (even-odd: an odd
// number makes it a hole).
function depthsOf(zone) {
  return zone.rings.map(
    (ring, i) =>
      zone.rings.filter(
        (other, j) => j !== i && holds({ rings: [other], box: boxOf([other]) }, ring[0])
      ).length
  );
}

// A zone's outer rings, each with the holes directly inside it.
function landOf(zone) {
  const depth = depthsOf(zone);
  const out = [];
  zone.rings.forEach((ring, i) => {
    if (depth[i] % 2) return;
    const around = { rings: [ring], box: boxOf([ring]) };
    const holes = zone.rings.filter(
      (hole, j) => depth[j] === depth[i] + 1 && holds(around, hole[0])
    );
    out.push({ outer: ring, holes });
  });
  return out;
}

// A zone's area and the centre of it, holes taken out: { area, x, y }.
function massOf(zone) {
  const depth = depthsOf(zone);
  let area = 0;
  let mx = 0;
  let my = 0;
  zone.rings.forEach((ring, i) => {
    const signed = areaOf(ring);
    if (!signed) return;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k];
      const q = ring[(k + 1) % ring.length];
      const cross = p[0] * q[1] - q[0] * p[1];
      cx += (p[0] + q[0]) * cross;
      cy += (p[1] + q[1]) * cross;
    }
    const weight = (depth[i] % 2 ? -1 : 1) * Math.abs(signed);
    mx += (cx / (6 * signed)) * weight;
    my += (cy / (6 * signed)) * weight;
    area += weight;
  });
  return { area, x: area ? mx / area : 0, y: area ? my / area : 0 };
}

// Where a realm's name goes, always inside its land: the centre of all its
// zones if that is in one; else the middle of the longest stretch of its
// biggest zone along the line through that zone's centre.
function centreOf(zones) {
  const masses = zones.map(massOf);
  const total = masses.reduce((sum, m) => sum + m.area, 0);
  if (total > 0) {
    const point = [
      masses.reduce((sum, m) => sum + m.x * m.area, 0) / total,
      masses.reduce((sum, m) => sum + m.y * m.area, 0) / total,
    ];
    if (zones.some((z) => holds(z, point))) return { x: round(point[0]), y: round(point[1]) };
  }
  let at = 0;
  masses.forEach((m, i) => {
    if (m.area > masses[at].area) at = i;
  });
  const biggest = zones[at];
  const y = masses[at].y || (biggest.box.y0 + biggest.box.y1) / 2;
  const xs = [];
  for (const ring of biggest.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a[1] > y !== b[1] > y) xs.push(((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]);
    }
  }
  xs.sort((p, q) => p - q);
  let best = null;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
  }
  return best
    ? { x: round((best[0] + best[1]) / 2), y: round(y) }
    : { x: round((biggest.box.x0 + biggest.box.x1) / 2), y: round(y) };
}

/**
 * The borders of the realms on a region map: see the top of this file.
 */
function bordersOn(world, mapId) {
  const map = ((world && world.maps) || {})[mapId];
  if (!map || map.retired || map.kind !== 'region' || !map.geometry) return [];
  const c = geo.compile(map.geometry);
  const byRealm = new Map();
  for (const z of c.zones) {
    const region = z.item.region && realms.regionOf(world, z.item.region);
    const realm = region && realms.realmOf(world, region.id);
    if (!realm || !z.rings.length) continue;
    if (!byRealm.has(realm.id)) byRealm.set(realm.id, { realm, zones: [] });
    byRealm.get(realm.id).zones.push({ rings: z.rings, box: boxOf(z.rings) });
  }
  // One tolerance for the map: a ten-thousandth of its size.
  const space = map.space || {};
  const tol = Math.max(space.width || 0, space.height || 0, 1) * 1e-4;
  const out = [];
  for (const id of [...byRealm.keys()].sort()) {
    const { realm, zones } = byRealm.get(id);
    const outlines = [];
    zones.forEach((zone, i) => {
      // A zone later in the list lies over an earlier: both count as land,
      // so any other zone of the realm covers an edge.
      const others = zones.filter((_, j) => j !== i);
      outlines.push(...edgeOf(zone, others, tol));
    });
    if (!outlines.length) continue;
    out.push({
      id: realm.id,
      name: realm.name || realm.id,
      colour: realms.colourOf(realm),
      outlines: outlines.map(flat),
      land: zones.flatMap(landOf).map((l) => ({
        outer: flat(l.outer),
        holes: l.holes.map(flat),
      })),
      centre: centreOf(zones),
    });
  }
  return out;
}

module.exports = { bordersOn };
