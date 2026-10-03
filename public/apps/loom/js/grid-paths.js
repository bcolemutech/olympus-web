/* global module, window */
(function () {
  'use strict';

  // Paths on a battle map's grid (planning/the-loom-movement-and-vision.md §3;
  // L-612 / #442), shared by the server, which decides moves, and the grid
  // view, which previews them. This file is kept in two places with the same
  // bytes, functions/loom-canon/grid-paths.js and public/apps/loom/js/
  // grid-paths.js (the functions folder deploys on its own), and a test fails
  // if they differ: change both.
  //
  // Squares are { x, y } on a `width × height` grid. A step goes to any of the
  // 8 squares around, and costs 1, diagonals included (D&D 5e's rule). The
  // `cost(from, to)` option prices a step instead: a number of 1 or more, or
  // Infinity where it's blocked (walls, obstacles and difficult ground come
  // with L-624). The `avoid` option lists squares that can be stepped onto but
  // never through, such as exits, which leave the map when stepped on
  // (L-615): a path may end on one, and reach includes them, but nothing goes
  // on from one.
  //
  // Of the cheapest paths, the shortest on the ground wins (straight steps
  // over diagonals where they cost the same), then the one keeping closest to
  // the straight line between its ends, then the one found first, with
  // squares taken in a fixed order: the same path, every time, everywhere.

  var STEPS = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ];
  var DIAGONAL = Math.SQRT2;

  function inside(map, x, y) {
    return x >= 0 && y >= 0 && x < map.width && y < map.height;
  }

  function stepCost(options) {
    var cost = options && options.cost;
    return cost
      ? function (from, to) {
          var c = cost(from, to);
          return typeof c === 'number' && c >= 1 ? c : Infinity;
        }
      : function () {
          return 1;
        };
  }

  // A binary heap of entries ordered by (cost, length, off, index): `off` is
  // how far the path has strayed from the straight line. Lengths and strays
  // that differ only by rounding count as equal.
  function before(a, b) {
    if (a.cost !== b.cost) return a.cost < b.cost;
    if (Math.abs(a.length - b.length) > 1e-9) return a.length < b.length;
    if (Math.abs(a.off - b.off) > 1e-9) return a.off < b.off;
    return a.index < b.index;
  }

  // How far a square lies from the straight line through `from` and `to`
  // (0 everywhere when there's no `to`).
  function strayFrom(from, to) {
    var dx = to ? to.x - from.x : 0;
    var dy = to ? to.y - from.y : 0;
    var span = Math.sqrt(dx * dx + dy * dy);
    return function (x, y) {
      return span ? Math.abs(dx * (y - from.y) - dy * (x - from.x)) / span : 0;
    };
  }
  function push(heap, entry) {
    heap.push(entry);
    var i = heap.length - 1;
    while (i > 0) {
      var parent = (i - 1) >> 1;
      if (!before(heap[i], heap[parent])) break;
      var t = heap[i];
      heap[i] = heap[parent];
      heap[parent] = t;
      i = parent;
    }
  }
  function pop(heap) {
    var top = heap[0];
    var last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      var i = 0;
      for (;;) {
        var l = 2 * i + 1;
        var r = l + 1;
        var m = i;
        if (l < heap.length && before(heap[l], heap[m])) m = l;
        if (r < heap.length && before(heap[r], heap[m])) m = r;
        if (m === i) break;
        var t = heap[i];
        heap[i] = heap[m];
        heap[m] = t;
        i = m;
      }
    }
    return top;
  }

  // Cheapest costs from `from` (Dijkstra), up to `budget` if given, stopping
  // early once `to` is settled. Returns the settled squares by index.
  function search(map, from, options, budget, to) {
    var price = stepCost(options);
    var ends = {};
    ((options && options.avoid) || []).forEach(function (square) {
      if (inside(map, square.x, square.y)) ends[square.y * map.width + square.x] = true;
    });
    var stray = strayFrom(from, to);
    var width = map.width;
    var target = to ? to.y * width + to.x : -1;
    var best = {};
    var settled = {};
    var start = from.y * width + from.x;
    best[start] = { cost: 0, length: 0, off: 0, index: start, x: from.x, y: from.y, via: -1 };
    var heap = [best[start]];
    while (heap.length) {
      var at = pop(heap);
      if (settled[at.index]) continue;
      settled[at.index] = at;
      if (at.index === target) break;
      if (ends[at.index] && at.index !== start) continue;
      for (var s = 0; s < STEPS.length; s++) {
        var x = at.x + STEPS[s][0];
        var y = at.y + STEPS[s][1];
        if (!inside(map, x, y)) continue;
        var index = y * width + x;
        if (settled[index]) continue;
        var c = price({ x: at.x, y: at.y }, { x: x, y: y });
        if (c === Infinity) continue;
        var cost = at.cost + c;
        if (budget !== undefined && cost > budget) continue;
        var length = at.length + (STEPS[s][0] && STEPS[s][1] ? DIAGONAL : 1);
        var entry = {
          cost: cost,
          length: length,
          off: at.off + stray(x, y),
          index: index,
          x: x,
          y: y,
          via: at.index,
        };
        var known = best[index];
        if (known && !before(entry, known)) continue;
        best[index] = entry;
        push(heap, entry);
      }
    }
    return settled;
  }

  /**
   * The cheapest path from `from` to `to`: the squares stepped on, `from` left
   * out, each with the cost so far ({ x, y, cost }), and its total `cost`; or
   * null when `to` is off the grid or can't be reached.
   */
  function pathTo(map, from, to, options) {
    if (!inside(map, from.x, from.y) || !inside(map, to.x, to.y)) return null;
    var settled = search(map, from, options, undefined, to);
    var end = settled[to.y * map.width + to.x];
    if (!end) return null;
    var path = [];
    for (var at = end; at.via !== -1; at = settled[at.via]) {
      path.unshift({ x: at.x, y: at.y, cost: at.cost });
    }
    return { path: path, cost: end.cost };
  }

  /**
   * The squares `budget` movement can reach from `from`, `from` left out,
   * each with its cost ({ x, y, cost }), cheapest first, then by row and
   * column.
   */
  function reach(map, from, budget, options) {
    if (!inside(map, from.x, from.y)) return [];
    var settled = search(map, from, options, budget);
    var start = from.y * map.width + from.x;
    return Object.keys(settled)
      .map(Number)
      .filter(function (index) {
        return index !== start;
      })
      .map(function (index) {
        var at = settled[index];
        return { x: at.x, y: at.y, cost: at.cost };
      })
      .sort(function (a, b) {
        return a.cost - b.cost || a.y - b.y || a.x - b.x;
      });
  }

  /**
   * How far `budget` takes you along a path (pathTo's): the squares walked,
   * the cost spent, and the rest, its costs counted afresh from where you
   * stop, as a plan for the next turn.
   */
  function walk(path, budget) {
    var walked = path.filter(function (step) {
      return step.cost <= budget;
    });
    var spent = walked.length ? walked[walked.length - 1].cost : 0;
    var rest = path.slice(walked.length).map(function (step) {
      return { x: step.x, y: step.y, cost: step.cost - spent };
    });
    return { walked: walked, spent: spent, rest: rest };
  }

  var api = { pathTo: pathTo, reach: reach, walk: walk };

  if (typeof window !== 'undefined') {
    window.Loom = window.Loom || {};
    window.Loom.gridPaths = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
