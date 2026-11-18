/* global module */
(function () {
  'use strict';

  // The isometric view's geometry (planning/isometric-view.md §4.1, §4.2,
  // IS2, IS3, C2; L-952 / #858): pure, for the painter (paint.js) and its
  // tests (tests/loom-iso-order.test.js, in Node).
  //
  // A floor point (x, y) in feet at a height h (already in screen units: feet
  // of height times the rise, 1.22 at the true 2:1, C2) stands at
  // (x − y, (x + y) / 2 − h): the map's north to the top right, a 5 ft square
  // a diamond twice as wide as tall. The camera looks along (−1, −1) on the
  // floor, so what lies further along (1, 1) is nearer.
  //
  // The depth order (§4.2, spike report §4.1): what stands is drawn back to
  // front. One depth number per piece mis-orders a prop beside a wall (the
  // spike's desk showed through a wall near its end), so pieces whose drawn
  // shapes overlap are ordered by their footprints on the floor, the way
  // isometric engines sort: two footprints apart have a line between them
  // (a separating axis), and the one on its camera side is in front. Only
  // footprints that overlap fall back to their depth.
  //
  //   Loom.iso.P(p, h)                        a floor point at a height, on the screen
  //   Loom.iso.segment(a, b, thick)           a wall's footprint: [{ x, y }] × 4
  //   Loom.iso.rect(at, w, d, turn)           a prop's: its size turned by `turn` (degrees)
  //   Loom.iso.square(at, r)                  a token's: r either side of its foot
  //   Loom.iso.depthOf(pts)                   a footprint's middle, its y on the screen
  //   Loom.iso.facing(turn, size, long)       which picture a prop stands as: { back, mirror }
  //   Loom.iso.front(a, b)                    1: a in front of b; −1: behind; 0: can't say
  //   Loom.iso.order(items)                   items' indices back to front
  //   Loom.iso.index(items) / slot(...)        where a moving token goes among them
  //   Loom.iso.hull(points)                   a convex outline, for picking
  //
  // An item is { pts (its footprint, convex), box ({ x0, y0, x1, y1 }: what it
  // covers on the screen), depth }.

  var EPS = 1e-6;
  var CELL = 8; // the index's cells, in screen units (feet)

  function P(p, h) {
    return { x: p.x - p.y, y: (p.x + p.y) / 2 - (h || 0) };
  }

  // A direction on the floor, on the screen.
  function V(v) {
    return { x: v.x - v.y, y: (v.x + v.y) / 2 };
  }

  function segment(a, b, thick) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var hx = (-dy / len) * (thick / 2);
    var hy = (dx / len) * (thick / 2);
    return [
      { x: a.x + hx, y: a.y + hy },
      { x: b.x + hx, y: b.y + hy },
      { x: b.x - hx, y: b.y - hy },
      { x: a.x - hx, y: a.y - hy },
    ];
  }

  function rect(at, w, d, turn) {
    var t = ((Number(turn) || 0) * Math.PI) / 180;
    var c = Math.cos(t);
    var s = Math.sin(t);
    return [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(function (q) {
      return { x: at.x + q[0] * c - q[1] * s, y: at.y + q[0] * s + q[1] * c };
    });
  }

  function square(at, r) {
    return [
      { x: at.x - r, y: at.y - r },
      { x: at.x + r, y: at.y - r },
      { x: at.x + r, y: at.y + r },
      { x: at.x - r, y: at.y + r },
    ];
  }

  function depthOf(pts) {
    var sx = 0;
    var sy = 0;
    pts.forEach(function (p) {
      sx += p.x;
      sy += p.y;
    });
    return (sx + sy) / 2 / (pts.length || 1);
  }

  /**
   * Which of its two painted pictures a prop stands as, and whether it's
   * mirrored (IS3, §4.2): facing south (turn 0) its front; west (90) its back
   * mirrored; north (180) its back; east (270) its front mirrored. `long`
   * ('x' or 'y') is the axis its pictures are painted long along; a prop long
   * the other way (its size, unturned) is mirrored, which swaps the screen's
   * two floor axes (spike report §4.2).
   */
  function facing(turn, size, long) {
    var q = ((Math.round((Number(turn) || 0) / 90) % 4) + 4) % 4;
    var out = { back: q === 1 || q === 2, mirror: q === 1 || q === 3 };
    var w = size && size[0];
    var d = size && size[1];
    if ((long === 'x' || long === 'y') && w > 0 && d > 0 && w !== d) {
      if (w > d !== (long === 'x')) out.mirror = !out.mirror;
    }
    return out;
  }

  // A convex footprint's edges' normals.
  function axesOf(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i];
      var b = pts[(i + 1) % pts.length];
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len > EPS) out.push({ x: -dy / len, y: dx / len });
    }
    return out;
  }

  function range(pts, n) {
    var lo = Infinity;
    var hi = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      var v = pts[i].x * n.x + pts[i].y * n.y;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return [lo, hi];
  }

  /**
   * Whether `a` stands in front of `b` (1), behind it (−1), or neither can be
   * told from their footprints (0: they overlap, or lie apart only side by
   * side on the screen, where the order doesn't show). Two convex footprints
   * apart have a separating axis; along it, the one on the camera's side
   * (further along (1, 1)) is in front, for every axis that separates them.
   */
  function front(a, b) {
    var axes = axesOf(a.pts).concat(axesOf(b.pts));
    var said = 0;
    for (var i = 0; i < axes.length; i++) {
      var n = axes[i];
      var s = n.x + n.y;
      if (Math.abs(s) < EPS) continue;
      var ra = range(a.pts, n);
      var rb = range(b.pts, n);
      var r = 0;
      if (ra[0] >= rb[1] - EPS) r = s > 0 ? 1 : -1;
      else if (rb[0] >= ra[1] - EPS) r = s > 0 ? -1 : 1;
      // Apart on a diagonal (east of it one way, north the other), the axes
      // disagree: it can't be told, and the first axis tried mustn't decide,
      // or three pieces at a junction can each be in front of the next (L-958).
      if (r && said && r !== said) return 0;
      if (r) said = r;
    }
    return said;
  }

  // In front by footprint, else by depth.
  function compare(a, b) {
    var r = front(a, b);
    if (r) return r;
    var dd = a.depth - b.depth;
    return dd > EPS ? 1 : dd < -EPS ? -1 : 0;
  }

  function boxesCross(a, b) {
    return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  }

  function cellsOf(box, fn) {
    var x0 = Math.floor(box.x0 / CELL);
    var x1 = Math.floor(box.x1 / CELL);
    var y0 = Math.floor(box.y0 / CELL);
    var y1 = Math.floor(box.y1 / CELL);
    for (var cx = x0; cx <= x1; cx++) for (var cy = y0; cy <= y1; cy++) fn(cx + ',' + cy);
  }

  /** A spatial index of items by what they cover on the screen. */
  function index(items) {
    var cells = new Map();
    items.forEach(function (item, i) {
      if (!item || !item.box) return;
      cellsOf(item.box, function (k) {
        var list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(i);
      });
    });
    return { cells: cells, items: items, stamp: new Int32Array(items.length), mark: 0 };
  }

  // Each index of `idx`'s items whose box crosses `box`, once.
  function near(idx, box, fn) {
    idx.mark += 1;
    var mark = idx.mark;
    cellsOf(box, function (k) {
      var list = idx.cells.get(k);
      if (!list) return;
      for (var i = 0; i < list.length; i++) {
        var j = list[i];
        if (idx.stamp[j] === mark) continue;
        idx.stamp[j] = mark;
        if (boxesCross(idx.items[j].box, box)) fn(j);
      }
    });
  }

  // A small heap of indices by depth (then index), for the order.
  function heap(items) {
    var h = [];
    var less = function (i, j) {
      var a = items[h[i]];
      var b = items[h[j]];
      return a.depth < b.depth || (a.depth === b.depth && h[i] < h[j]);
    };
    var swap = function (i, j) {
      var t = h[i];
      h[i] = h[j];
      h[j] = t;
    };
    return {
      size: function () {
        return h.length;
      },
      push: function (v) {
        h.push(v);
        for (var i = h.length - 1; i > 0; ) {
          var p = (i - 1) >> 1;
          if (!less(i, p)) break;
          swap(i, p);
          i = p;
        }
      },
      pop: function () {
        var top = h[0];
        var last = h.pop();
        if (h.length) {
          h[0] = last;
          for (var i = 0; ; ) {
            var l = 2 * i + 1;
            var r = l + 1;
            var m = i;
            if (l < h.length && less(l, m)) m = l;
            if (r < h.length && less(r, m)) m = r;
            if (m === i) break;
            swap(i, m);
            i = m;
          }
        }
        return top;
      },
    };
  }

  /**
   * The items' indices in the order they're drawn, back to front: each after
   * every item it overlaps on the screen and stands in front of, and
   * otherwise by depth. Where three or more ring round (rare, with long
   * pieces), the nearest-back is drawn first and the ring is broken there.
   */
  function order(items) {
    var n = items.length;
    var after = []; // i → those drawn after it
    var waits = new Int32Array(n); // how many must be drawn before it
    for (var i = 0; i < n; i++) after.push([]);
    var idx = index(items);
    idx.cells.forEach(function (list, k) {
      var at = k.split(',');
      var cx = Number(at[0]);
      var cy = Number(at[1]);
      for (var p = 0; p < list.length; p++) {
        var a = items[list[p]];
        for (var q = p + 1; q < list.length; q++) {
          var b = items[list[q]];
          if (!boxesCross(a.box, b.box)) continue;
          // Once per pair: in the cell where their overlap starts.
          if (
            Math.floor(Math.max(a.box.x0, b.box.x0) / CELL) !== cx ||
            Math.floor(Math.max(a.box.y0, b.box.y0) / CELL) !== cy
          ) {
            continue;
          }
          var r = compare(a, b);
          if (r > 0) {
            after[list[q]].push(list[p]);
            waits[list[p]] += 1;
          } else if (r < 0) {
            after[list[p]].push(list[q]);
            waits[list[q]] += 1;
          }
        }
      }
    });
    var out = [];
    var done = new Uint8Array(n);
    var ready = heap(items);
    var all = heap(items); // for breaking a ring
    for (var k = 0; k < n; k++) {
      all.push(k);
      if (!waits[k]) ready.push(k);
    }
    while (out.length < n) {
      var next = -1;
      while (ready.size()) {
        var c = ready.pop();
        if (!done[c]) {
          next = c;
          break;
        }
      }
      while (next < 0 && all.size()) {
        var d = all.pop();
        if (!done[d]) next = d;
      }
      done[next] = 1;
      out.push(next);
      after[next].forEach(function (j) {
        waits[j] -= 1;
        if (!waits[j] && !done[j]) ready.push(j);
      });
    }
    return out;
  }

  /**
   * Where `item` (a token, moving) goes among items already ordered, each
   * drawn at `zs[i]`: { lo, hi }, the highest z of those it overlaps and
   * stands in front of and the lowest of those it stands behind (−Infinity
   * and Infinity with none). lo ≥ hi: no place fits, the order needs making
   * again with it in.
   */
  function slot(item, idx, zs) {
    var lo = -Infinity;
    var hi = Infinity;
    near(idx, item.box, function (j) {
      var r = compare(item, idx.items[j]);
      if (r > 0) lo = Math.max(lo, zs[j]);
      else if (r < 0) hi = Math.min(hi, zs[j]);
    });
    return { lo: lo, hi: hi };
  }

  /** The convex hull of points (a piece's outline on the screen). */
  function hull(points) {
    var ps = points.slice().sort(function (a, b) {
      return a.x - b.x || a.y - b.y;
    });
    if (ps.length < 3) return ps;
    var cross = function (o, a, b) {
      return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    };
    var lower = [];
    ps.forEach(function (p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    });
    var upper = [];
    for (var i = ps.length - 1; i >= 0; i--) {
      var p = ps[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  var api = {
    P: P,
    V: V,
    segment: segment,
    rect: rect,
    square: square,
    depthOf: depthOf,
    facing: facing,
    front: front,
    compare: compare,
    order: order,
    index: index,
    slot: slot,
    hull: hull,
  };

  if (typeof window !== 'undefined') {
    window.Loom = window.Loom || {};
    window.Loom.iso = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
