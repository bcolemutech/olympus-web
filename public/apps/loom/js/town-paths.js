/* global module, window */
(function () {
  'use strict';

  // Paths in a town (planning/the-loom-movement-and-vision.md §8; L-661 /
  // #468), over its ground (§7; ./ground.js): buildings, water, walls and the
  // crossings over water, in the town's 0–1000 square. Shared by the server,
  // which decides moves, and the town view, which previews them. This file is
  // kept in two places with the same bytes, functions/loom-canon/
  // town-paths.js and public/apps/loom/js/town-paths.js (the functions folder
  // deploys on its own), and a test fails if they differ: change both.
  //
  // Walking is worked out on a grid of CELL-unit squares over the square
  // (compile): a square is blocked when its centre is in a building, or in
  // water outside every crossing, and whenever a wall or a water's edge
  // passes through it, so a wall or a narrow river is never slipped through.
  // A gate is a gap left in a wall. Steps go 8 ways, a diagonal costing √2,
  // and a diagonal can't cut the corner of a blocked square.
  //
  // pathTo searches the grid (A*, with squares taken in a fixed order: the
  // same path, every time, everywhere), then pulls the path straight: from
  // each corner it goes as far as a straight line stays on open ground, so a
  // path is a few straight runs between the points it turns at. Its length is
  // in town units and, from the town's size, in metres. walk(path, metres)
  // goes as far along it as a budget allows, and keeps the rest. inSight says
  // what a player can see from a point (L-671): buildings and walls block.

  var SIDE = 1000; // the town square, as places' positions use it
  var CELL = 5; // the walking grid's squares, in town units
  var N = SIDE / CELL;
  var EPS = 1e-9;
  var DIAGONAL = Math.SQRT2;
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
  var compiled = typeof WeakMap === 'function' ? new WeakMap() : null;

  // ── Geometry ─────────────────────────────────────────────────────────────

  function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  function onSegment(p, a, b) {
    return (
      Math.abs(cross(a, b, p)) < EPS &&
      p.x >= Math.min(a.x, b.x) - EPS &&
      p.x <= Math.max(a.x, b.x) + EPS &&
      p.y >= Math.min(a.y, b.y) - EPS &&
      p.y <= Math.max(a.y, b.y) + EPS
    );
  }

  // Whether segments ab and cd touch at all (crossing, touching or
  // overlapping).
  function segmentsMeet(a, b, c, d) {
    var d1 = cross(c, d, a);
    var d2 = cross(c, d, b);
    var d3 = cross(a, b, c);
    var d4 = cross(a, b, d);
    if (
      ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
      ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
    ) {
      return true;
    }
    return onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
  }

  function distanceToSegment(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var length = dx * dx + dy * dy;
    var t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  // Even-odd point in polygon; a point on the edge counts as outside.
  function inside(points, p) {
    var result = false;
    for (var i = 0, j = points.length - 1; i < points.length; j = i++) {
      var a = points[i];
      var b = points[j];
      if (onSegment(p, a, b)) return false;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        result = !result;
      }
    }
    return result;
  }

  // A polygon's edges as [a, b] pairs, closing back to the first point; a
  // line's (`closed` false) without the closing edge.
  function edges(points, closed) {
    var list = [];
    var count = closed ? points.length : points.length - 1;
    for (var i = 0; i < count; i++) list.push([points[i], points[(i + 1) % points.length]]);
    return list;
  }

  // A polygon's points without a repeated closing point.
  function closedRing(points) {
    var last = points[points.length - 1];
    if (points.length > 1 && last.x === points[0].x && last.y === points[0].y) {
      return points.slice(0, -1);
    }
    return points;
  }

  // ── The walking grid ─────────────────────────────────────────────────────

  /**
   * The ground as a walking grid: { cell, n, blocked }, `blocked` a
   * Uint8Array of n × n squares (index y * n + x), 1 where blocked. Compiled
   * once per ground object.
   */
  function compile(ground) {
    if (ground && compiled && compiled.has(ground)) return compiled.get(ground);
    var blocked = new Uint8Array(N * N);
    var grid = { cell: CELL, n: N, blocked: blocked };
    if (!ground) return grid;
    var water = new Uint8Array(N * N);
    var crossing = new Uint8Array(N * N);
    var i;
    (ground.buildings || []).forEach(function (shape) {
      fill(closedRing(shape.points), blocked);
    });
    (ground.water || []).forEach(function (shape) {
      var ring = closedRing(shape.points);
      fill(ring, water);
      edges(ring, true).forEach(function (side) {
        trace(side[0], side[1], water);
      });
    });
    (ground.crossings || []).forEach(function (shape) {
      fill(closedRing(shape.points), crossing);
    });
    for (i = 0; i < blocked.length; i++) if (water[i] && !crossing[i]) blocked[i] = 1;
    (ground.walls || []).forEach(function (shape) {
      edges(shape.points, false).forEach(function (side) {
        trace(side[0], side[1], blocked);
      });
    });
    if (compiled) compiled.set(ground, grid);
    return grid;
  }

  // Marks the squares whose centres are inside a polygon, a row at a time:
  // where the row's centre line crosses the edges, filled between pairs.
  function fill(ring, marks) {
    var ys = ring.map(function (p) {
      return p.y;
    });
    var y0 = Math.max(0, Math.floor(Math.min.apply(null, ys) / CELL));
    var y1 = Math.min(N - 1, Math.floor(Math.max.apply(null, ys) / CELL));
    var sides = edges(ring, true);
    for (var y = y0; y <= y1; y++) {
      var cy = (y + 0.5) * CELL;
      var xs = [];
      sides.forEach(function (side) {
        var a = side[0];
        var b = side[1];
        if (a.y > cy !== b.y > cy) xs.push(a.x + ((cy - a.y) * (b.x - a.x)) / (b.y - a.y));
      });
      xs.sort(function (p, q) {
        return p - q;
      });
      for (var k = 0; k + 1 < xs.length; k += 2) {
        // Squares whose centres lie strictly between the two crossings.
        var from = Math.max(0, Math.floor(xs[k] / CELL - 0.5) + 1);
        var to = Math.min(N - 1, Math.ceil(xs[k + 1] / CELL - 0.5) - 1);
        for (var x = from; x <= to; x++) marks[y * N + x] = 1;
      }
    }
  }

  // Marks every square a segment passes through.
  function trace(a, b, marks) {
    var steps = Math.max(1, Math.ceil((Math.hypot(b.x - a.x, b.y - a.y) / CELL) * 8));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var x = Math.min(N - 1, Math.floor((a.x + (b.x - a.x) * t) / CELL));
      var y = Math.min(N - 1, Math.floor((a.y + (b.y - a.y) * t) / CELL));
      marks[y * N + x] = 1;
    }
  }

  // The square a point is in.
  function squareAt(point) {
    return {
      x: Math.min(N - 1, Math.max(0, Math.floor(point.x / CELL))),
      y: Math.min(N - 1, Math.max(0, Math.floor(point.y / CELL))),
    };
  }

  function centre(square) {
    return { x: (square.x + 0.5) * CELL, y: (square.y + 0.5) * CELL };
  }

  function acrossAWall(ground, a, b) {
    return (ground.walls || []).some(function (shape) {
      return edges(shape.points, false).some(function (side) {
        return segmentsMeet(a, b, side[0], side[1]);
      });
    });
  }

  /**
   * The open square a point on open ground walks from: its own, or, when its
   * own is blocked (a door on a building's edge, beside a wall), the nearest
   * open one around it that isn't across a wall. Null when there is none.
   */
  function squareFor(ground, point) {
    var grid = compile(ground);
    var own = squareAt(point);
    if (!grid.blocked[own.y * N + own.x]) return own;
    var best = null;
    var bestDistance = Infinity;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var x = own.x + dx;
        var y = own.y + dy;
        if (x < 0 || y < 0 || x >= N || y >= N || grid.blocked[y * N + x]) continue;
        var middle = centre({ x: x, y: y });
        if (ground && acrossAWall(ground, point, middle)) continue;
        var distance = Math.hypot(middle.x - point.x, middle.y - point.y);
        if (distance < bestDistance) {
          best = { x: x, y: y };
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  // Whether a step from square (x, y) by (dx, dy) can be taken: onto an open
  // square, and a diagonal not cutting the corner of a blocked one.
  function canStep(blocked, x, y, dx, dy) {
    var nx = x + dx;
    var ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N || blocked[ny * N + nx]) return false;
    return !(dx && dy && (blocked[y * N + nx] || blocked[ny * N + x]));
  }

  /**
   * The squares reachable on foot from the given squares: a Uint8Array over
   * the grid, 1 where reached.
   */
  function reachableSquares(ground, from) {
    var blocked = compile(ground).blocked;
    var seen = new Uint8Array(N * N);
    var queue = new Int32Array(N * N);
    var head = 0;
    var tail = 0;
    from.forEach(function (square) {
      var i = square.y * N + square.x;
      if (!blocked[i] && !seen[i]) {
        seen[i] = 1;
        queue[tail++] = i;
      }
    });
    while (head < tail) {
      var i = queue[head++];
      var x = i % N;
      var y = (i - x) / N;
      for (var s = 0; s < STEPS.length; s++) {
        var j = (y + STEPS[s][1]) * N + x + STEPS[s][0];
        if (!canStep(blocked, x, y, STEPS[s][0], STEPS[s][1]) || seen[j]) continue;
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
    return seen;
  }

  // ── The search ───────────────────────────────────────────────────────────

  // A binary heap of entries, ordered by f, then by g (deeper first), then
  // by the order they were made: the same order always. An entry is its
  // number; its f, g and square are kept in typed arrays, grown as needed.
  function Heap() {
    this.size = 0;
    this.made = 0;
    this.grow(1 << 14);
  }
  Heap.prototype.grow = function (capacity) {
    var copy = function (Type, old) {
      var next = new Type(capacity);
      if (old) next.set(old);
      return next;
    };
    this.f = copy(Float64Array, this.f);
    this.g = copy(Float64Array, this.g);
    this.square = copy(Int32Array, this.square);
    this.heap = copy(Int32Array, this.heap);
    this.capacity = capacity;
  };
  Heap.prototype.before = function (a, b) {
    var f = this.f;
    var g = this.g;
    if (Math.abs(f[a] - f[b]) > EPS) return f[a] < f[b];
    if (Math.abs(g[a] - g[b]) > EPS) return g[a] > g[b];
    return a < b;
  };
  Heap.prototype.push = function (f, g, square) {
    if (this.made === this.capacity) this.grow(this.capacity * 2);
    var entry = this.made++;
    this.f[entry] = f;
    this.g[entry] = g;
    this.square[entry] = square;
    var heap = this.heap;
    var i = this.size++;
    heap[i] = entry;
    while (i > 0) {
      var parent = (i - 1) >> 1;
      if (!this.before(heap[i], heap[parent])) break;
      var swap = heap[i];
      heap[i] = heap[parent];
      heap[parent] = swap;
      i = parent;
    }
  };
  // Takes the first entry off, and returns its square.
  Heap.prototype.pop = function () {
    var heap = this.heap;
    var top = heap[0];
    var size = --this.size;
    if (size) {
      heap[0] = heap[size];
      var i = 0;
      for (;;) {
        var l = 2 * i + 1;
        var r = l + 1;
        var best = i;
        if (l < size && this.before(heap[l], heap[best])) best = l;
        if (r < size && this.before(heap[r], heap[best])) best = r;
        if (best === i) break;
        var swap = heap[i];
        heap[i] = heap[best];
        heap[best] = swap;
        i = best;
      }
    }
    return this.square[top];
  };

  // The octile distance between two squares: the shortest on an empty grid.
  function octile(ax, ay, bx, by) {
    var dx = Math.abs(ax - bx);
    var dy = Math.abs(ay - by);
    return Math.max(dx, dy) + (DIAGONAL - 1) * Math.min(dx, dy);
  }

  // The squares of the shortest path between two squares (A*), or null.
  function search(blocked, from, to) {
    var goal = to.y * N + to.x;
    var start = from.y * N + from.x;
    var cost = new Float64Array(N * N).fill(Infinity);
    var came = new Int32Array(N * N).fill(-1);
    var done = new Uint8Array(N * N);
    var heap = new Heap();
    cost[start] = 0;
    heap.push(octile(from.x, from.y, to.x, to.y), 0, start);
    while (heap.size) {
      var i = heap.pop();
      if (done[i]) continue;
      done[i] = 1;
      if (i === goal) break;
      var x = i % N;
      var y = (i - x) / N;
      for (var s = 0; s < STEPS.length; s++) {
        var dx = STEPS[s][0];
        var dy = STEPS[s][1];
        if (!canStep(blocked, x, y, dx, dy)) continue;
        var j = (y + dy) * N + x + dx;
        if (done[j]) continue;
        var g = cost[i] + (dx && dy ? DIAGONAL : 1);
        if (g < cost[j] - EPS) {
          cost[j] = g;
          came[j] = i;
          heap.push(g + octile(x + dx, y + dy, to.x, to.y), g, j);
        }
      }
    }
    if (!done[goal]) return null;
    var squares = [];
    for (var k = goal; k !== -1; k = came[k]) squares.push({ x: k % N, y: Math.floor(k / N) });
    return squares.reverse();
  }

  // ── Smoothing ────────────────────────────────────────────────────────────

  // Whether the straight line a → b stays on open ground: every square it
  // passes through is open (but those in `except`, the squares of a path's
  // ends), it cuts no blocked corner, and it crosses no wall. The squares are
  // walked exactly, one edge crossing at a time (Amanatides and Woo).
  function clearLine(ground, blocked, a, b, except) {
    var open = function (x, y) {
      var index = y * N + x;
      return !blocked[index] || except.indexOf(index) >= 0;
    };
    var start = squareAt(a);
    var end = squareAt(b);
    var x = start.x;
    var y = start.y;
    if (!open(x, y)) return false;
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    var stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    var nextX = stepX
      ? (stepX > 0 ? (x + 1) * CELL - a.x : a.x - x * CELL) / Math.abs(dx)
      : Infinity;
    var nextY = stepY
      ? (stepY > 0 ? (y + 1) * CELL - a.y : a.y - y * CELL) / Math.abs(dy)
      : Infinity;
    var deltaX = stepX ? CELL / Math.abs(dx) : Infinity;
    var deltaY = stepY ? CELL / Math.abs(dy) : Infinity;
    for (var guard = 0; (x !== end.x || y !== end.y) && guard < 4 * N; guard++) {
      if (Math.abs(nextX - nextY) < EPS) {
        // Through a corner: both squares beside it must be open.
        if (!inGrid(x + stepX, y) || !inGrid(x, y + stepY)) return false;
        if (!open(x + stepX, y) || !open(x, y + stepY)) return false;
        x += stepX;
        y += stepY;
        nextX += deltaX;
        nextY += deltaY;
      } else if (nextX < nextY) {
        x += stepX;
        nextX += deltaX;
      } else {
        y += stepY;
        nextY += deltaY;
      }
      if (!inGrid(x, y) || !open(x, y)) return false;
    }
    return !(ground && acrossAWall(ground, a, b));
  }

  function inGrid(x, y) {
    return x >= 0 && y >= 0 && x < N && y < N;
  }

  // Pulls a path of points straight: from each kept point, on along the
  // path while a straight line still reaches, keeping the last point it did.
  function smooth(ground, blocked, points, except) {
    var kept = [points[0]];
    var anchor = 0;
    while (anchor < points.length - 1) {
      var next = anchor + 1;
      while (
        next + 1 < points.length &&
        clearLine(ground, blocked, points[anchor], points[next + 1], except)
      ) {
        next++;
      }
      kept.push(points[next]);
      anchor = next;
    }
    return kept;
  }

  function lengthOf(points) {
    var units = 0;
    for (var i = 1; i < points.length; i++) {
      units += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return units;
  }

  function point(p) {
    return { x: p.x, y: p.y };
  }

  /**
   * The path on foot from one town point to another: { points, units,
   * metres }, points the corners it turns at (from first, to last), units its
   * length in the town square's units, and metres from `options.size`, the
   * town's width in metres (default 1000: a metre a unit). Null when either
   * end is off open ground, or there is no way. A town without ground
   * (ground null) is open ground: a straight line.
   */
  function pathTo(ground, from, to, options) {
    var size = (options && options.size) || SIDE;
    var points;
    if (!ground) {
      points = [point(from), point(to)];
    } else {
      var blocked = compile(ground).blocked;
      var start = squareFor(ground, from);
      var goal = squareFor(ground, to);
      if (!start || !goal) return null;
      var squares = search(blocked, start, goal);
      if (!squares) return null;
      var except = [squareAt(from), squareAt(to)].map(function (s) {
        return s.y * N + s.x;
      });
      var raw = [point(from)].concat(squares.map(centre), [point(to)]);
      points = smooth(ground, blocked, raw, except);
    }
    var units = lengthOf(points);
    return { points: points, units: units, metres: (units * size) / SIDE };
  }

  /**
   * How far a budget of metres goes along a path: { to, walked, arrived,
   * rest }, `to` the point reached, `walked` the metres used, and `rest` the
   * path still to go from there (null on arrival), as pathTo gives one.
   */
  function walk(path, metres) {
    var budget = Math.max(0, metres || 0);
    var points = path.points;
    var last = points[points.length - 1];
    if (budget >= path.metres - EPS) {
      return { to: point(last), walked: path.metres, arrived: true, rest: null };
    }
    var perUnit = path.units ? path.metres / path.units : 1;
    var left = budget / perUnit; // in units
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1];
      var b = points[i];
      var leg = Math.hypot(b.x - a.x, b.y - a.y);
      if (left <= leg) {
        var t = leg ? left / leg : 0;
        var reached = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        var restPoints = [reached].concat(points.slice(i));
        var units = lengthOf(restPoints);
        return {
          to: point(reached),
          walked: budget,
          arrived: false,
          rest: { points: restPoints, units: units, metres: units * perUnit },
        };
      }
      left -= leg;
    }
    return { to: point(last), walked: path.metres, arrived: true, rest: null };
  }

  // ── Sight (L-671) ────────────────────────────────────────────────────────
  //
  // What a player on the street can see (planning/the-loom-movement-and-
  // vision.md §9): the walking grid's squares within a radius of where they
  // stand, along straight lines that no building or wall cuts. Water doesn't
  // block sight. A building's or wall's own square, where a line meets it,
  // is seen (its front), but nothing behind it.

  var sightCompiled = typeof WeakMap === 'function' ? new WeakMap() : null;

  /** The squares that block sight: buildings and walls (a Uint8Array, 1 where blocked). */
  function sightGrid(ground) {
    if (ground && sightCompiled && sightCompiled.has(ground)) return sightCompiled.get(ground);
    var blocks = new Uint8Array(N * N);
    if (ground) {
      (ground.buildings || []).forEach(function (shape) {
        fill(closedRing(shape.points), blocks);
      });
      (ground.walls || []).forEach(function (shape) {
        edges(shape.points, false).forEach(function (side) {
          trace(side[0], side[1], blocks);
        });
      });
      if (sightCompiled) sightCompiled.set(ground, blocks);
    }
    return blocks;
  }

  /**
   * The squares in sight from a town point, out to `radius` town units: a
   * Uint8Array over the walking grid, 1 where seen. Lines are cast to every
   * square on the edge of the circle, close enough together that none is
   * missed, and each stops at the first square that blocks sight.
   */
  function inSight(ground, from, radius) {
    var blocks = sightGrid(ground);
    var seen = new Uint8Array(N * N);
    var start = squareAt(from);
    seen[start.y * N + start.x] = 1;
    var r = Math.max(0, radius) / CELL; // in squares
    if (!r) return seen;
    var rays = Math.max(8, Math.ceil(2 * Math.PI * r * 2));
    var ox = from.x / CELL;
    var oy = from.y / CELL;
    for (var k = 0; k < rays; k++) {
      var angle = (2 * Math.PI * k) / rays;
      var dx = Math.cos(angle);
      var dy = Math.sin(angle);
      // Walks the squares the line crosses, one edge at a time.
      var x = start.x;
      var y = start.y;
      var stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      var stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      var nextX = stepX ? (stepX > 0 ? x + 1 - ox : ox - x) / Math.abs(dx) : Infinity;
      var nextY = stepY ? (stepY > 0 ? y + 1 - oy : oy - y) / Math.abs(dy) : Infinity;
      var deltaX = stepX ? 1 / Math.abs(dx) : Infinity;
      var deltaY = stepY ? 1 / Math.abs(dy) : Infinity;
      for (;;) {
        var t = Math.min(nextX, nextY);
        if (t > r) break;
        if (nextX < nextY) {
          x += stepX;
          nextX += deltaX;
        } else {
          y += stepY;
          nextY += deltaY;
        }
        if (!inGrid(x, y)) break;
        var i = y * N + x;
        seen[i] = 1;
        if (blocks[i]) break;
      }
    }
    return seen;
  }

  /** The radius of sight in a town's units: `metres` (about 100) across a town `size` metres wide. */
  function sightRadius(size, metres) {
    return ((metres || 100) * SIDE) / (size || SIDE);
  }

  var api = {
    CELL: CELL,
    SIDE: SIDE,
    geometry: {
      cross: cross,
      onSegment: onSegment,
      segmentsMeet: segmentsMeet,
      distanceToSegment: distanceToSegment,
      inside: inside,
      edges: edges,
      closedRing: closedRing,
    },
    compile: compile,
    squareAt: squareAt,
    squareFor: squareFor,
    reachableSquares: reachableSquares,
    pathTo: pathTo,
    walk: walk,
    sightGrid: sightGrid,
    inSight: inSight,
    sightRadius: sightRadius,
  };

  if (typeof window === 'object' && window) {
    window.Loom = window.Loom || {};
    window.Loom.townPaths = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
