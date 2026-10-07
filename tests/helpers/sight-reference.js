'use strict';

/**
 * A slow, plain line of sight for checking functions/loom-canon/sight.js:
 * whether some part of a square is in sight from the centre of another, by
 * casting many lines across the square's span of directions. A line sees the
 * square when it enters it before touching a wall, a door that isn't open, or
 * a solid square other than this one. It reads the map's layers itself, not
 * through layers.js, so the two are worked out independently.
 *
 * Lines are spread evenly, so a square seen only through a narrow gap can be
 * missed by too few of them: ask again with more (`lines`) before calling it
 * hidden. On grids up to 12 × 12, 4000 lines catch every gap.
 */

const EPSILON = 1e-9;

// Where a line from (ox, oy) heading (dx, dy) runs through a box: [in, out],
// or null if it misses.
function throughBox(ox, oy, dx, dy, x0, y0, x1, y1) {
  let tIn = 0;
  let tOut = Infinity;
  for (const [o, d, lo, hi] of [
    [ox, dx, x0, x1],
    [oy, dy, y0, y1],
  ]) {
    if (Math.abs(d) < 1e-15) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    tIn = Math.max(tIn, a);
    tOut = Math.min(tOut, b);
  }
  return tIn <= tOut ? [tIn, tOut] : null;
}

// The unit edges a map's walls and shut doors run along, as boxes of no width.
function blockingEdges(map, states) {
  const edges = [];
  const run = (a, b) => {
    if (a.y === b.y) {
      for (let x = Math.min(a.x, b.x); x < Math.max(a.x, b.x); x++) {
        edges.push([x, a.y, x + 1, a.y]);
      }
    } else if (a.x === b.x) {
      for (let y = Math.min(a.y, b.y); y < Math.max(a.y, b.y); y++) {
        edges.push([a.x, y, a.x, y + 1]);
      }
    }
  };
  (map.walls || []).forEach((wall) => {
    for (let i = 1; i < wall.points.length; i++) run(wall.points[i - 1], wall.points[i]);
  });
  (map.doors || []).forEach((door) => {
    if ((states || {})[door.id] !== 'open') run(door.from, door.to);
  });
  return edges;
}

function solidSquares(map) {
  const squares = [];
  (map.obstacles || []).forEach((o) => {
    if (o.kind !== 'solid') return;
    for (let x = o.x; x < o.x + (o.w || 1); x++) {
      for (let y = o.y; y < o.y + (o.h || 1); y++) squares.push([x, y]);
    }
  });
  return squares;
}

/** Whether some part of `cell` is in sight from the centre of `from`. */
function sees(map, from, cell, states, lines = 64) {
  if (from.x === cell.x && from.y === cell.y) return true;
  const ox = from.x + 0.5;
  const oy = from.y + 0.5;
  const edges = blockingEdges(map, states);
  const solids = solidSquares(map).filter(([x, y]) => x !== cell.x || y !== cell.y);
  // The square's span of directions (under a half-turn, since it doesn't
  // hold the centre).
  const angles = [
    [cell.x, cell.y],
    [cell.x + 1, cell.y],
    [cell.x, cell.y + 1],
    [cell.x + 1, cell.y + 1],
  ].map(([x, y]) => Math.atan2(y - oy, x - ox));
  const offsets = angles.map((a) => {
    let d = a - angles[0];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  });
  const low = angles[0] + Math.min(...offsets);
  const high = angles[0] + Math.max(...offsets);
  for (let k = 0; k < lines; k++) {
    const angle = low + ((high - low) * (k + 0.5)) / lines;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const into = throughBox(ox, oy, dx, dy, cell.x, cell.y, cell.x + 1, cell.y + 1);
    if (!into || into[1] - into[0] < EPSILON) continue;
    let stop = Infinity;
    edges.forEach(([x0, y0, x1, y1]) => {
      const hit = throughBox(ox, oy, dx, dy, x0, y0, x1, y1);
      if (hit) stop = Math.min(stop, hit[0]);
    });
    solids.forEach(([x, y]) => {
      const hit = throughBox(ox, oy, dx, dy, x, y, x + 1, y + 1);
      if (hit) stop = Math.min(stop, hit[0]);
    });
    if (into[0] + EPSILON < stop) return true;
  }
  return false;
}

module.exports = { sees };
