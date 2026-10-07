'use strict';

/**
 * The Loom — line of sight on battle maps (planning/the-loom-movement-and-
 * vision.md §5; L-631 / #454).
 *
 * A square is in sight when an unblocked line runs from the centre of yours to
 * some part of it. Walls block, and so do doors that aren't open (a save's
 * doors, by layers.doorState: closed and locked alike), and solid obstacles,
 * which are seen themselves but hide what's behind them. Low obstacles and
 * difficult ground don't block. Sight goes as far as the walls allow: rooms
 * count as lit.
 *
 * How: the view is split into four quarters around your square (east, south,
 * west, north). In each, a line's slope v/u, across its quarter's axis over
 * along it, lies between -1 and 1, so every line moves steadily away from you,
 * column after column of squares. Going out a column at a time, the quarter
 * keeps the slopes still open. A square is in sight when a range of open
 * slopes reaches into it: through the column's near side, or across its side
 * toward the axis from the square beside it, unless a wall or a solid square
 * is in the way there. Then the column's walls, doors and solid squares close
 * the slopes they catch, for the columns beyond.
 *
 * Slopes are ratios of small whole numbers, so equal slopes compare equal. A
 * square counts only when a range of slopes reaches it, never a single line,
 * so nothing is seen through the point where two walls meet, between two
 * solid squares touching at a corner, or along a line grazing a wall's end.
 *
 * Pure and server-side: what's in sight never needs to be worked out in the
 * browser, which is sent only what has been seen (L-633).
 */

const layers = require('./layers');

// The four quarters, by the map directions of their axis (u, along which
// lines move away) and across it (v).
const QUARTERS = [
  { u: [1, 0], v: [0, 1] },
  { u: [0, 1], v: [1, 0] },
  { u: [-1, 0], v: [0, 1] },
  { u: [0, -1], v: [1, 0] },
];

// Ranges of slopes no wider than this are single lines, not a view. Distinct
// slopes on a 64 × 64 grid differ by more than 1 / 129², far above it.
const LINE = 1e-9;

const key = (cell) => cell.x + ',' + cell.y;

function onGrid(map, cell) {
  return cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height;
}

// Whether any of the open slopes, a sorted list of [low, high] ranges, covers
// more than a line of the range from `low` to `high`.
function reaches(open, low, high) {
  for (let i = 0; i < open.length; i++) {
    if (open[i][0] >= high) return false;
    if (Math.min(open[i][1], high) - Math.max(open[i][0], low) > LINE) return true;
  }
  return false;
}

// The open slopes left once the ranges in `cuts` are closed.
function close(open, cuts) {
  if (!cuts.length) return open;
  cuts.sort((a, b) => a[0] - b[0]);
  const left = [];
  open.forEach(([low, high]) => {
    let from = low;
    for (let i = 0; i < cuts.length && from < high; i++) {
      const [a, b] = cuts[i];
      if (b <= from) continue;
      if (a >= high) break;
      if (a - from > LINE) left.push([from, a]);
      from = Math.max(from, b);
    }
    if (high - from > LINE) left.push([from, high]);
  });
  return left;
}

// One quarter's squares in sight, added to `seen`. Its squares are (i, j):
// i columns out along the axis, j across it, square (i, j) running from
// i − ½ to i + ½ along and j − ½ to j + ½ across, from your square's centre.
// Slopes into it are measured in halves, (2j ± 1) / (2i ± 1).
function look(map, from, quarter, sight, seen) {
  const at = (i, j) => ({
    x: from.x + i * quarter.u[0] + j * quarter.v[0],
    y: from.y + i * quarter.u[1] + j * quarter.v[1],
  });
  let open = onGrid(map, at(1, 0)) && !sight.blocks(at(0, 0), at(1, 0)) ? [[-1, 1]] : [];
  for (let i = 1; open.length && onGrid(map, at(i, 0)); i++) {
    const near = 2 * i - 1;
    const far = 2 * i + 1;
    const cuts = [];
    // Only the squares the open slopes cross this column can be seen, or
    // close any of them.
    const lowest = open[0][0];
    const highest = open[open.length - 1][1];
    const first = Math.max(-i, Math.floor((lowest * (lowest < 0 ? far : near)) / 2 + 0.5));
    const last = Math.min(i, Math.ceil((highest * (highest > 0 ? far : near)) / 2 - 0.5));
    for (let j = first; j <= last; j++) {
      const cell = at(i, j);
      if (!onGrid(map, cell)) continue;
      const low = 2 * j - 1;
      const high = 2 * j + 1;
      // Its slopes: through the near side, and across the side toward the
      // axis, unless the square there is solid or a wall or door is between.
      let into = [low / near, high / near];
      let whole = into;
      if (j !== 0) {
        const inner = at(i, j > 0 ? j - 1 : j + 1);
        const side = j > 0 ? [low / far, low / near] : [high / near, high / far];
        whole = j > 0 ? [low / far, high / near] : [low / near, high / far];
        if (sight.blocks(inner, cell)) cuts.push(side);
        else if (!sight.solid(inner)) into = whole;
      }
      if (reaches(open, into[0], into[1])) seen[key(cell)] = true;
      if (sight.solid(cell)) cuts.push(whole);
      if (onGrid(map, at(i + 1, j)) && sight.blocks(cell, at(i + 1, j))) {
        cuts.push([low / far, high / far]);
      }
    }
    open = close(open, cuts);
  }
}

/**
 * The squares in sight from `from` on a battle map, for a save's doors
 * (`states`, by door id, as layers.doorState reads them): an object keyed
 * "x,y", `from` included; empty when `from` is off the grid. A map without
 * layers is open ground, all in sight.
 */
function inSight(map, from, states) {
  const seen = {};
  if (!from || !onGrid(map, from)) return seen;
  seen[key(from)] = true;
  const sight = blockers(map, states);
  QUARTERS.forEach((quarter) => look(map, from, quarter, sight, seen));
  return seen;
}

// What blocks sight on a map, for a save's doors: solid squares, and the
// sides between squares with a wall or a door that isn't open. Each is asked
// of layers.js once, then remembered (by square, and by the side east or
// south of it), since the quarters ask again where they meet.
function blockers(map, states) {
  const size = map.width * map.height;
  const solid = new Int8Array(size).fill(-1);
  const sides = [new Int8Array(size).fill(-1), new Int8Array(size).fill(-1)];
  return {
    solid: (cell) => {
      const i = cell.y * map.width + cell.x;
      if (solid[i] < 0) solid[i] = layers.groundAt(map, cell) === 'solid' ? 1 : 0;
      return solid[i] === 1;
    },
    blocks: (a, b) => {
      const first = a.x + a.y < b.x + b.y ? a : b;
      const memo = sides[a.y === b.y ? 0 : 1];
      const i = first.y * map.width + first.x;
      if (memo[i] < 0) {
        const there = layers.between(map, a, b);
        memo[i] =
          there.wall || (there.door && layers.doorState(there.door, states) !== 'open') ? 1 : 0;
      }
      return memo[i] === 1;
    },
  };
}

module.exports = { inSight };
