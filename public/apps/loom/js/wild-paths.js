/* global module, window, require */
(function () {
  'use strict';

  // The quickest way across a region map's painted ground (planning/off-
  // road-travel.md §4.2, TR2–TR4, TR8; L-361 / #835).
  //
  // The map's ground is laid on a coarse grid, about 200 cells on its long
  // side. Each cell is crossed at the speed of the topmost ground at its
  // centre (materials.wildOf: the built-in defaults, a world's own material
  // its `like`'s, a world's overrides over both), divided by that ground
  // item's own `cost`; ground with cost 'never', and impassable materials
  // (ocean, lake, deep water, lava, or whatever a world marks), are closed.
  // A cell with no ground at all is open ground (speed 1). A line of
  // `river` (or `canal`, or `stream`) material makes the cells it runs
  // through slow to cross, except where a route crosses it too.
  //
  // Routes are lanes: a path may join one anywhere along its line and leave
  // it anywhere, moving along it at its own speed. A lane marked `ends`
  // (a sea route) is joined and left only at its ends. Which routes a
  // traveller may take (their rules) is the caller's to decide: it passes
  // only those (../loom-canon/routes.js lanesOf on the server).
  //
  // A* over the cells and the lanes gives the quickest path:
  //
  //   plan(opts) → null when there is no way, else
  //     { path: [[x, y]],        the points walked, in map units
  //       length,                its length in map units
  //       distance,              in the map's distance unit (× scale)
  //       hours,                 at the pace given
  //       terrain: [{ material, distance }]   the ground crossed off the
  //                              road, longest first (none for unpainted)
  //       danger,                the average danger along it (material ×
  //                              region), by distance
  //       legs: [{ by: 'wild' | 'route', route?, from, to, distance, hours }] }
  //
  //   opts  { geometry, bounds: { width, height } (map units),
  //           from: [x, y], to: [x, y],
  //           scale   distance units per map unit (1),
  //           pace    distance units an hour off the road at speed 1 (1.5),
  //           own     the world's own materials (world.materials),
  //           wilds   the world's `wilds` ({ materials: overrides }),
  //           regions { [regionId]: danger } for the zones naming them,
  //           routes  [{ id, points: [[x, y]], speed (distance units an
  //                   hour), ends? }],
  //           cells   cells on the long side (200) }
  //
  //   grid(opts)   the rasterised grid alone (cached per geometry and
  //                settings): { cols, rows, cell, speed, danger, material,
  //                materials }
  //
  // This file is kept in two places with the same bytes, functions/loom-
  // canon/wild-paths.js and public/apps/loom/js/wild-paths.js (the page
  // loads it as Loom.wildPaths, after materials.js and map-geometry.js),
  // and a test fails if they differ: change both.

  var node = typeof module === 'object' && module.exports;
  var materials = node ? require('./materials') : window.Loom.materials;
  var geo = node ? require('./map-geometry') : window.Loom.mapGeometry;

  var DEFAULT_CELLS = 200;
  var MAX_CELLS = 400;
  var DEFAULT_PACE = 1.5;
  // How much slower a cell with a river in it is to cross, by its material.
  var RIVER_SLOW = { river: 4, canal: 4, stream: 2 };
  var SQRT2 = Math.SQRT2;

  var cache = typeof WeakMap === 'function' ? new WeakMap() : null;

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }
  function num(v) {
    return typeof v === 'number' && isFinite(v);
  }
  function pointOf(v) {
    if (Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1])) return [v[0], v[1]];
    if (isObject(v) && num(v.x) && num(v.y)) return [v.x, v.y];
    return null;
  }

  // ── The grid ──────────────────────────────────────────────────────────

  // The cells whose centres fall inside `rings` (even-odd), by scanline:
  // calls mark(index) for each.
  function fill(rings, g, mark) {
    var minY = Infinity;
    var maxY = -Infinity;
    rings.forEach(function (ring) {
      ring.forEach(function (p) {
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      });
    });
    var r0 = Math.max(0, Math.floor(minY / g.cell - 0.5));
    var r1 = Math.min(g.rows - 1, Math.ceil(maxY / g.cell - 0.5));
    var xs = [];
    for (var r = r0; r <= r1; r++) {
      var y = (r + 0.5) * g.cell;
      xs.length = 0;
      for (var k = 0; k < rings.length; k++) {
        var ring = rings[k];
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          var a = ring[i];
          var b = ring[j];
          if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      }
      if (xs.length < 2) continue;
      xs.sort(function (p, q) {
        return p - q;
      });
      for (var n = 0; n + 1 < xs.length; n += 2) {
        var c0 = Math.max(0, Math.ceil(xs[n] / g.cell - 0.5));
        var c1 = Math.min(g.cols - 1, Math.ceil(xs[n + 1] / g.cell - 0.5) - 1);
        for (var c = c0; c <= c1; c++) mark(r * g.cols + c);
      }
    }
  }

  // The cells a polyline passes through: calls mark(index) for each.
  function trace(points, g, mark) {
    var step = g.cell / 3;
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1];
      var b = points[i];
      var len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      var n = Math.max(1, Math.ceil(len / step));
      for (var s = 0; s <= n; s++) {
        var x = a[0] + ((b[0] - a[0]) * s) / n;
        var y = a[1] + ((b[1] - a[1]) * s) / n;
        var idx = cellAt(g, x, y);
        if (idx >= 0) mark(idx);
      }
    }
  }

  function cellAt(g, x, y) {
    var c = Math.floor(x / g.cell);
    var r = Math.floor(y / g.cell);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return -1;
    return r * g.cols + c;
  }

  function settingsKey(opts, cells) {
    return JSON.stringify([
      cells,
      opts.bounds.width,
      opts.bounds.height,
      opts.own || null,
      (opts.wilds && opts.wilds.materials) || null,
      opts.regions || null,
    ]);
  }

  /**
   * The map's ground on a coarse grid (see the top of this file). Cached
   * per geometry object and settings, so the page and a turn re-plan
   * cheaply. Null without a geometry or bounds.
   */
  function grid(opts) {
    var geometry = opts && opts.geometry;
    var bounds = opts && opts.bounds;
    if (!isObject(geometry) || !bounds || !(bounds.width > 0) || !(bounds.height > 0)) return null;
    var cells = Math.min(MAX_CELLS, Math.max(10, Math.round(opts.cells || DEFAULT_CELLS)));
    var key = settingsKey(opts, cells);
    var held = cache && cache.get(geometry);
    if (held && held.key === key) return held.grid;

    var cell = Math.max(bounds.width, bounds.height) / cells;
    var g = {
      cell: cell,
      cols: Math.max(1, Math.ceil(bounds.width / cell)),
      rows: Math.max(1, Math.ceil(bounds.height / cell)),
    };
    var n = g.cols * g.rows;
    g.speed = new Float64Array(n).fill(1);
    g.danger = new Float64Array(n).fill(1);
    g.material = new Int32Array(n).fill(-1); // index into g.materials
    g.materials = [];
    var region = new Float64Array(n).fill(1);
    var slow = new Float64Array(n).fill(1);
    var compiled = geo.compile(geometry);
    var known = {};

    // The ground, bottom first: a later item lies over an earlier one.
    compiled.ground.forEach(function (gr) {
      var item = gr.item;
      var id = typeof item.material === 'string' ? item.material : null;
      if (!id || !gr.rings) return;
      if (!(id in known)) {
        known[id] = g.materials.length;
        g.materials.push(id);
      }
      var wild = materials.wildOf(id, opts.own, opts.wilds);
      var speed = wild.speed;
      if (item.cost === 'never') speed = 0;
      else if (num(item.cost) && item.cost > 1) speed = speed / item.cost;
      var at = known[id];
      fill(gr.rings, g, function (i) {
        g.speed[i] = speed;
        g.danger[i] = wild.danger;
        g.material[i] = at;
      });
    });
    // Regions' danger, from the zones naming them (the topmost wins).
    var regions = isObject(opts.regions) ? opts.regions : {};
    compiled.zones.forEach(function (z) {
      var d = z.item.region && regions[z.item.region];
      if (!num(d) || !z.rings) return;
      fill(z.rings, g, function (i) {
        region[i] = d;
      });
    });
    // Rivers slow the cells they run through.
    compiled.lines.forEach(function (l) {
      var by = RIVER_SLOW[l.item.material];
      if (!by) return;
      l.lines.forEach(function (line) {
        trace(line, g, function (i) {
          slow[i] = Math.max(slow[i], by);
        });
      });
    });
    for (var i = 0; i < n; i++) g.danger[i] *= region[i];
    g.slow = slow;
    if (cache) cache.set(geometry, { key: key, grid: g });
    return g;
  }

  // ── A* ───────────────────────────────────────────────────────────────

  // A binary min-heap of node ids by f.
  function Heap() {
    this.ids = [];
    this.f = [];
  }
  Heap.prototype.push = function (id, f) {
    var ids = this.ids;
    var fs = this.f;
    var i = ids.length;
    ids.push(id);
    fs.push(f);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (fs[p] <= f) break;
      ids[i] = ids[p];
      fs[i] = fs[p];
      i = p;
    }
    ids[i] = id;
    fs[i] = f;
  };
  Heap.prototype.pop = function () {
    var ids = this.ids;
    var fs = this.f;
    var top = ids[0];
    var lastId = ids.pop();
    var lastF = fs.pop();
    var n = ids.length;
    if (n) {
      var i = 0;
      for (;;) {
        var l = 2 * i + 1;
        if (l >= n) break;
        var r = l + 1;
        var m = r < n && fs[r] < fs[l] ? r : l;
        if (fs[m] >= lastF) break;
        ids[i] = ids[m];
        fs[i] = fs[m];
        i = m;
      }
      ids[i] = lastId;
      fs[i] = lastF;
    }
    return top;
  };

  var NEIGHBOURS = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, SQRT2],
    [1, -1, SQRT2],
    [-1, 1, SQRT2],
    [-1, -1, SQRT2],
  ];

  /** The quickest path (see the top of this file), or null when there is none. */
  function plan(opts) {
    var g = grid(opts);
    var from = pointOf(opts && opts.from);
    var to = pointOf(opts && opts.to);
    if (!g || !from || !to) return null;
    var scale = num(opts.scale) && opts.scale > 0 ? opts.scale : 1;
    var pace = num(opts.pace) && opts.pace > 0 ? opts.pace : DEFAULT_PACE;
    var cols = g.cols;
    var N = cols * g.rows;
    var cell = g.cell;

    // Cells a route crosses keep no river's slowness.
    var routes = (Array.isArray(opts.routes) ? opts.routes : []).filter(function (r) {
      return r && num(r.speed) && r.speed > 0 && Array.isArray(r.points) && r.points.length > 1;
    });
    var onRoute = new Uint8Array(N);
    routes.forEach(function (r) {
      trace(r.points.map(pointOf).filter(Boolean), g, function (i) {
        onRoute[i] = 1;
      });
    });
    // Hours per map unit in each cell; Infinity when closed.
    var rate = new Float64Array(N);
    var top = 0;
    for (var i = 0; i < N; i++) {
      var sp = g.speed[i];
      if (!(sp > 0)) {
        rate[i] = Infinity;
        continue;
      }
      var eff = onRoute[i] ? sp : sp / g.slow[i];
      if (sp > top) top = sp;
      rate[i] = scale / (pace * eff);
    }

    // Nodes past the cells: each route's points, sampled a cell apart, then
    // the start and the goal.
    var pos = []; // [x, y] of each extra node
    var owner = []; // the route index of each extra node, -1 for start and goal
    var links = []; // links[k]: [[node, hours, kind]] — kind 'route' or 'join'
    var joins = {}; // cell → [extra node]
    var vmax = pace * top;
    function addNode(p, routeIndex) {
      pos.push(p);
      owner.push(routeIndex);
      links.push([]);
      return N + pos.length - 1;
    }
    function link(a, b, hours, kind) {
      if (a >= N) links[a - N].push([b, hours, kind]);
      if (b >= N) links[b - N].push([a, hours, kind]);
      if (a < N) (joins[a] = joins[a] || []).push([b, hours, kind]);
      if (b < N) (joins[b] = joins[b] || []).push([a, hours, kind]);
    }
    // The open cell to join at a point: its own, else the nearest open one
    // around it; -1 when none.
    function openCellNear(p) {
      var c = Math.min(cols - 1, Math.max(0, Math.floor(p[0] / cell)));
      var r = Math.min(g.rows - 1, Math.max(0, Math.floor(p[1] / cell)));
      var idx = r * cols + c;
      if (rate[idx] < Infinity) return idx;
      var best = -1;
      var bestD = Infinity;
      for (var k = 0; k < 8; k++) {
        var cc = c + NEIGHBOURS[k][0];
        var rr = r + NEIGHBOURS[k][1];
        if (cc < 0 || rr < 0 || cc >= cols || rr >= g.rows) continue;
        var j = rr * cols + cc;
        if (rate[j] === Infinity) continue;
        var d = Math.hypot((cc + 0.5) * cell - p[0], (rr + 0.5) * cell - p[1]);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      return best;
    }
    function centre(idx) {
      return [((idx % cols) + 0.5) * cell, (Math.floor(idx / cols) + 0.5) * cell];
    }
    function joinCell(nodeId, p) {
      var c = openCellNear(p);
      if (c < 0) return;
      var q = centre(c);
      link(nodeId, c, Math.hypot(q[0] - p[0], q[1] - p[1]) * rate[c], 'join');
    }

    var endsAt = {}; // "x,y" → [extra node] at route ends, joined to each other
    routes.forEach(function (r, ri) {
      var pts = r.points.map(pointOf).filter(Boolean);
      if (r.speed > vmax) vmax = r.speed;
      var prev = -1;
      var prevP = null;
      pts.forEach(function (p, pi) {
        var samples = [p];
        if (prevP) {
          var len = Math.hypot(p[0] - prevP[0], p[1] - prevP[1]);
          var n = Math.max(1, Math.ceil(len / cell));
          samples = [];
          for (var s = 1; s <= n; s++) {
            samples.push([
              prevP[0] + ((p[0] - prevP[0]) * s) / n,
              prevP[1] + ((p[1] - prevP[1]) * s) / n,
            ]);
          }
        }
        samples.forEach(function (q, si) {
          var id = addNode(q, ri);
          var isEnd =
            (pi === 0 && si === 0) || (pi === pts.length - 1 && si === samples.length - 1);
          if (prev >= 0) {
            var pp = pos[prev - N];
            link(prev, id, (Math.hypot(q[0] - pp[0], q[1] - pp[1]) * scale) / r.speed, 'route');
          }
          if (isEnd || !r.ends) joinCell(id, q);
          if (isEnd) {
            var key = q[0] + ',' + q[1];
            (endsAt[key] = endsAt[key] || []).forEach(function (other) {
              link(other, id, 0, 'join');
            });
            endsAt[key].push(id);
          }
          prev = id;
        });
        prevP = p;
      });
    });

    // The start and the goal: joined to their cell (or the nearest open one)
    // and to any route end standing on them.
    function addEnd(p) {
      var id = addNode(p, -1);
      joinCell(id, p);
      (endsAt[p[0] + ',' + p[1]] || []).forEach(function (other) {
        link(other, id, 0, 'join');
      });
      return id;
    }
    var start = addEnd(from);
    var goal = addEnd(to);
    if (!links[start - N].length || !links[goal - N].length) return null;

    var total = N + pos.length;
    var gScore = new Float64Array(total).fill(Infinity);
    var came = new Int32Array(total).fill(-1);
    var cameKind = new Array(total);
    var done = new Uint8Array(total);
    function where(id) {
      return id < N ? centre(id) : pos[id - N];
    }
    function h(id) {
      var p = where(id);
      return (Math.hypot(p[0] - to[0], p[1] - to[1]) * scale) / vmax;
    }
    var heap = new Heap();
    gScore[start] = 0;
    heap.push(start, h(start));
    function relax(from2, to2, cost, kind) {
      var tentative = gScore[from2] + cost;
      if (tentative < gScore[to2]) {
        gScore[to2] = tentative;
        came[to2] = from2;
        cameKind[to2] = kind;
        heap.push(to2, tentative + h(to2));
      }
    }
    while (heap.ids.length) {
      var cur = heap.pop();
      if (done[cur]) continue;
      done[cur] = 1;
      if (cur === goal) break;
      if (cur < N) {
        var c = cur % cols;
        var r = (cur - c) / cols;
        var rc = rate[cur];
        for (var k = 0; k < 8; k++) {
          var nb = NEIGHBOURS[k];
          var nc = c + nb[0];
          var nr = r + nb[1];
          if (nc < 0 || nr < 0 || nc >= cols || nr >= g.rows) continue;
          var nx = nr * cols + nc;
          var rn = rate[nx];
          if (rn === Infinity || done[nx]) continue;
          // No cutting a corner past a closed cell.
          if (
            nb[2] !== 1 &&
            (rate[r * cols + nc] === Infinity || rate[nr * cols + c] === Infinity)
          ) {
            continue;
          }
          relax(cur, nx, ((nb[2] * cell) / 2) * (rc + rn), 'wild');
        }
        var js = joins[cur];
        if (js) {
          for (var q = 0; q < js.length; q++) relax(cur, js[q][0], js[q][1], js[q][2]);
        }
      } else {
        var ls = links[cur - N];
        for (var m = 0; m < ls.length; m++) relax(cur, ls[m][0], ls[m][1], ls[m][2]);
      }
    }
    if (!(gScore[goal] < Infinity)) return null;

    // Walk back from the goal.
    var chain = [];
    for (var at = goal; at >= 0; at = came[at]) chain.push(at);
    chain.reverse();
    return describe(chain);

    function describe(ids) {
      var path = [];
      var legs = [];
      var byMaterial = {};
      var length = 0;
      var dangerSum = 0;
      function dangerAt(p) {
        var idx = cellAt(g, p[0], p[1]);
        return idx >= 0 ? g.danger[idx] : 1;
      }
      function materialAt(p) {
        var idx = cellAt(g, p[0], p[1]);
        return idx >= 0 && g.material[idx] >= 0 ? g.materials[g.material[idx]] : null;
      }
      for (var s = 0; s < ids.length; s++) {
        var p = where(ids[s]);
        if (s === 0) {
          path.push(p);
          continue;
        }
        var prevId = ids[s - 1];
        var a = where(prevId);
        var len = Math.hypot(p[0] - a[0], p[1] - a[1]);
        var hours = gScore[ids[s]] - gScore[prevId];
        var onLane = cameKind[ids[s]] === 'route';
        var by = onLane ? 'route' : 'wild';
        var routeId = onLane ? routes[owner[ids[s] - N]].id : undefined;
        length += len;
        var mid = [(a[0] + p[0]) / 2, (a[1] + p[1]) / 2];
        dangerSum += len * dangerAt(mid);
        if (!onLane && len > 0) {
          // Each half on its own cell's ground.
          [a, p].forEach(function (end) {
            var mat = materialAt(end);
            if (mat) byMaterial[mat] = (byMaterial[mat] || 0) + len / 2;
          });
        }
        var last = legs[legs.length - 1];
        if (last && last.by === by && last.route === routeId) {
          last.to = p;
          last.length += len;
          last.hours += hours;
        } else if (len > 0 || hours > 0) {
          legs.push({ by: by, route: routeId, from: a, to: p, length: len, hours: hours });
        }
        var before = path[path.length - 1];
        if (p[0] !== before[0] || p[1] !== before[1]) path.push(p);
      }
      return {
        path: straighten(path),
        length: length,
        distance: length * scale,
        hours: gScore[goal],
        terrain: Object.keys(byMaterial)
          .map(function (mat) {
            return { material: mat, distance: byMaterial[mat] * scale };
          })
          .sort(function (x, y) {
            return y.distance - x.distance || (x.material < y.material ? -1 : 1);
          }),
        danger: length > 0 ? dangerSum / length : dangerAt(from),
        legs: legs.map(function (l) {
          var out = {
            by: l.by,
            from: l.from,
            to: l.to,
            distance: l.length * scale,
            hours: l.hours,
          };
          if (l.route !== undefined) out.route = l.route;
          return out;
        }),
      };
    }
  }

  // A path less the points lying on a straight run between their neighbours.
  function straighten(path) {
    if (path.length < 3) return path;
    var out = [path[0]];
    for (var i = 1; i < path.length - 1; i++) {
      var a = out[out.length - 1];
      var b = path[i];
      var c = path[i + 1];
      var cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      var dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (Math.abs(cross) > 1e-9 || dot < 0) out.push(b);
    }
    out.push(path[path.length - 1]);
    return out;
  }

  var api = {
    DEFAULT_CELLS: DEFAULT_CELLS,
    DEFAULT_PACE: DEFAULT_PACE,
    RIVER_SLOW: RIVER_SLOW,
    grid: grid,
    plan: plan,
  };

  if (typeof window !== 'undefined') {
    window.Loom = window.Loom || {};
    window.Loom.wildPaths = api;
  }
  if (node) module.exports = api;
})();
