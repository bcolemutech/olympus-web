/* global module, window, require */
(function () {
  'use strict';

  // Moving off the grid (planning/maps-from-data.md §4.2, GE2, MV1, SZ1, PL4;
  // L-922 / #726): paths over a battle map's geometry (./map-geometry.js), in
  // feet, for a character of a size, priced in action points. The server
  // charges a move and the Loom page previews it with this one file, so the
  // preview is always the charge.
  //
  //   Sizes (SZ1)   tiny, small, medium, large, huge and gargantuan, each a
  //                 width in feet (medium 2.5). A gap lets a character
  //                 through when it is no narrower than they are.
  //   Paths (GE2)   planned on a fine hidden grid, a quarter of a 5 ft
  //                 square (1.25 ft): a point on it is open where the
  //                 character fits clear of walls, closed windows, locked
  //                 doors, objects that block, ground that can't be crossed
  //                 and the map's edge. A point that doesn't quite fit is
  //                 nudged (by up to half the grid) to where it does, and the
  //                 middle of every narrow gap is a point too, so a path
  //                 passes any gap at least as wide as the character. The
  //                 path found is then pulled straight wherever that costs no
  //                 more, so it runs at any angle.
  //   AP (MV1)      a move costs its path's length at the character's price
  //                 per 5 ft (the system's `move`, 1 by default; ground
  //                 costing 2, `difficult`; other ground its multiple of
  //                 `move`), rounded up once for the whole move, plus each
  //                 closed door on the way (`door`), which the walk opens and
  //                 stops at. Conditions' prices come in through the prices.
  //   Where a save stands  a point in feet; a square from before reads as
  //                 its centre (centreOf), and the square a point is in is
  //                 squareOf.
  //
  // A battle map's geometry is its own (`geometry`, L-921) with its layers
  // from before read as geometry beside it (map-geometry.js fromLayers),
  // the stored geometry's items winning where ids are the same (geometryOf).
  //
  //   planner(map, options)       the map as a character moves on it
  //   pathTo(plan, from, to)      the cheapest way, { points, ap, feet, … }
  //   walk(plan, path, ap, opts)  how far a move gets: stations walked, AP
  //                               spent, a door opened
  //   reachable(plan, from, ap)   the squares whose centres a move reaches
  //
  // This file is kept in two places with the same bytes, functions/loom-canon/
  // map-paths.js and public/apps/loom/js/map-paths.js (the page loads it as
  // Loom.mapPaths, after map-geometry.js), and a test fails if they differ:
  // change both.

  var geo =
    typeof module === 'object' && module.exports
      ? require('./map-geometry')
      : window.Loom.mapGeometry;

  var FEET = 5; // a square
  var STEP = 1.25; // the fine grid: a quarter of a square
  var EPS = 1e-9;
  var ROUND = 1e-6; // AP rounding's tolerance: 15 ft is 3 AP, never 4
  var NEAR = 2 * STEP; // how far a gap's middle, the start or the goal links to the grid
  var MAX_GAPS = 5000;

  var SIZES = [
    { id: 'tiny', width: 1 },
    { id: 'small', width: 1.5 },
    { id: 'medium', width: 2.5 },
    { id: 'large', width: 5 },
    { id: 'huge', width: 10 },
    { id: 'gargantuan', width: 15 },
  ];
  var DEFAULT_SIZE = 'medium';

  function sizeOf(id) {
    for (var i = 0; i < SIZES.length; i++) if (SIZES[i].id === id) return SIZES[i];
    return null;
  }

  /** A size's width in feet: medium (2.5) for none, or one that isn't a size. */
  function widthOf(size) {
    return (sizeOf(size) || sizeOf(DEFAULT_SIZE)).width;
  }

  /** The centre of a square, in feet: where a square from before stands. */
  function centreOf(cell) {
    return { x: (cell.x + 0.5) * FEET, y: (cell.y + 0.5) * FEET };
  }

  /** The square a point in feet is in. */
  function squareOf(point) {
    return { x: Math.floor(point.x / FEET + EPS), y: Math.floor(point.y / FEET + EPS) };
  }

  function dist(a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }

  /** AP for a move's weight (its length in squares at its prices), rounded up once. */
  function apFor(weight) {
    return Math.max(0, Math.ceil(weight - ROUND));
  }

  // ── The geometry a battle map is moved on ───────────────────────────

  var merged = typeof WeakMap === 'function' ? new WeakMap() : null;

  /**
   * A battle map's geometry for moving: its own, with its layers from before
   * read as geometry beside it; where an id is in both, its own.
   */
  function geometryOf(map) {
    if (merged && map && typeof map === 'object' && merged.has(map)) return merged.get(map);
    var layers = geo.fromLayers(map);
    var stored = map && map.geometry;
    var out = layers;
    if (geo.hasGeometry(stored)) {
      out = {};
      var taken = {};
      geo.LISTS.forEach(function (key) {
        (stored[key] || []).forEach(function (item) {
          if (item && item.id) taken[item.id] = true;
        });
      });
      geo.LISTS.forEach(function (key) {
        var own = Array.isArray(stored[key]) ? stored[key] : [];
        var old = (layers[key] || []).filter(function (item) {
          return !taken[item.id];
        });
        if (own.length || old.length) out[key] = own.concat(old);
      });
    }
    if (merged && map && typeof map === 'object') merged.set(map, out);
    return out;
  }

  // ── Small geometry ──────────────────────────────────────────────────

  function closest(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = dx * dx + dy * dy;
    var t = len ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + t * dx, y: a.y + t * dy };
  }

  function pointToSegment(p, a, b) {
    return dist(p, closest(p, a, b));
  }

  function cross(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  // Where segment a–b crosses c–d, as a fraction along a–b, or null.
  function crossing(a, b, c, d) {
    var rx = b.x - a.x;
    var ry = b.y - a.y;
    var sx = d.x - c.x;
    var sy = d.y - c.y;
    var den = cross(rx, ry, sx, sy);
    if (Math.abs(den) < EPS) return null;
    var qx = c.x - a.x;
    var qy = c.y - a.y;
    var t = cross(qx, qy, sx, sy) / den;
    var u = cross(qx, qy, rx, ry) / den;
    if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
    return Math.max(0, Math.min(1, t));
  }

  function segmentToSegment(a, b, c, d) {
    if (crossing(a, b, c, d) !== null) return 0;
    return Math.min(
      pointToSegment(a, c, d),
      pointToSegment(b, c, d),
      pointToSegment(c, a, b),
      pointToSegment(d, a, b)
    );
  }

  function inRings(p, rings) {
    var inside = false;
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var a = ring[i];
        var b = ring[j];
        if (a[1] > p.y !== b[1] > p.y) {
          var x = ((b[0] - a[0]) * (p.y - a[1])) / (b[1] - a[1]) + a[0];
          if (p.x < x) inside = !inside;
        }
      }
    }
    return inside;
  }

  // Segments kept in 5 ft buckets, to find those near a point or a segment.
  // A bucket's key is a number (bx and by offset to stay positive).
  function buckets() {
    var cells = typeof Map === 'function' ? new Map() : null;
    var plain = cells ? null : {};
    var stamp = 0;
    var keyOf = function (bx, by) {
      return (bx + 4096) * 16384 + (by + 4096);
    };
    var get = function (k) {
      return cells ? cells.get(k) : plain[k];
    };
    var put = function (k, v) {
      if (cells) cells.set(k, v);
      else plain[k] = v;
    };
    return {
      add: function (item, minX, minY, maxX, maxY) {
        item.stamp = 0;
        for (var bx = Math.floor(minX / FEET); bx <= Math.floor(maxX / FEET); bx++) {
          for (var by = Math.floor(minY / FEET); by <= Math.floor(maxY / FEET); by++) {
            var k = keyOf(bx, by);
            var list = get(k);
            if (!list) put(k, (list = []));
            list.push(item);
          }
        }
      },
      near: function (minX, minY, maxX, maxY, each) {
        // Its own mark: a search inside another (a gap checked as it is
        // found) may visit an item again, but never makes this one miss one.
        var mine = ++stamp;
        var x1 = Math.floor(maxX / FEET);
        var y1 = Math.floor(maxY / FEET);
        for (var bx = Math.floor(minX / FEET); bx <= x1; bx++) {
          for (var by = Math.floor(minY / FEET); by <= y1; by++) {
            var list = get(keyOf(bx, by));
            if (!list) continue;
            for (var i = 0; i < list.length; i++) {
              var item = list[i];
              if (item.stamp === mine) continue;
              item.stamp = mine;
              if (each(item) === false) return;
            }
          }
        }
      },
    };
  }

  // ── The planner ─────────────────────────────────────────────────────

  function pricesOf(prices) {
    var p = prices || {};
    var move = typeof p.move === 'number' && p.move >= 0 ? p.move : 1;
    var difficult = typeof p.difficult === 'number' && p.difficult >= 0 ? p.difficult : 2 * move;
    var door = function (item) {
      var c = typeof p.door === 'function' ? p.door(item) : p.door;
      return typeof c === 'number' && c >= 0 ? c : 1;
    };
    return { move: move, difficult: difficult, door: door };
  }

  /**
   * A battle map as one character moves on it: { map, width, … } to plan
   * with. Options:
   *   width    the character's width in feet (widthOf(size)); medium by default
   *   states   the save's doors, by id ('open', 'closed', 'locked')
   *   prices   the character's AP prices: { move, difficult, door } (door a
   *            number or a function of the door), with its conditions in them
   *   blocked  (square) → true for a square never walked into: one the save
   *            hasn't seen, an exit that isn't where it's going. The squares
   *            a move starts and ends in are always allowed.
   */
  function planner(map, options) {
    var o = options || {};
    var width = o.width > 0 ? o.width : widthOf(DEFAULT_SIZE);
    var r = width / 2;
    var W = (map.width || 0) * FEET;
    var H = (map.height || 0) * FEET;
    var states = o.states || {};
    var prices = pricesOf(o.prices);
    var blockedSquare = typeof o.blocked === 'function' ? o.blocked : null;
    var c = geo.compile(geometryOf(map));

    // What blocks movement: walls and windows, locked doors, objects that
    // block and ground that can't be crossed, and the map's edge. A closed
    // door doesn't: it is opened on the way.
    var walls = buckets();
    var blockers = [];
    var addSegment = function (a, b) {
      var s = { a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } };
      blockers.push(s);
      walls.add(
        s,
        Math.min(s.a.x, s.b.x),
        Math.min(s.a.y, s.b.y),
        Math.max(s.a.x, s.b.x),
        Math.max(s.a.y, s.b.y)
      );
    };
    var doors = [];
    geo.edges(c, states).forEach(function (e) {
      if (e.kind === 'door') {
        if (e.state === 'open') return;
        if (e.state === 'locked') addSegment(e.a, e.b);
        else doors.push({ a: { x: e.a[0], y: e.a[1] }, b: { x: e.b[0], y: e.b[1] }, item: e.item });
        return;
      }
      if (e.blocksMove) addSegment(e.a, e.b);
    });
    var solids = [];
    c.objects.forEach(function (ob) {
      if (ob.item.blocksMove !== false) solids.push(ob.rings);
    });
    c.ground.forEach(function (g) {
      if (g.item.cost === 'never') solids.push(g.rings);
    });
    solids.forEach(function (rings) {
      rings.forEach(function (ring) {
        for (var i = 0; i < ring.length; i++) addSegment(ring[i], ring[(i + 1) % ring.length]);
      });
    });
    addSegment([0, 0], [W, 0]);
    addSegment([W, 0], [W, H]);
    addSegment([W, H], [0, H]);
    addSegment([0, H], [0, 0]);

    // Ground with a price of its own, and the edges where it changes.
    var grounds = buckets();
    var priced = c.ground.length > 0;
    c.ground.forEach(function (g) {
      g.rings.forEach(function (ring) {
        for (var i = 0; i < ring.length; i++) {
          var a = ring[i];
          var b = ring[(i + 1) % ring.length];
          grounds.add(
            { a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } },
            Math.min(a[0], b[0]),
            Math.min(a[1], b[1]),
            Math.max(a[0], b[0]),
            Math.max(a[1], b[1])
          );
        }
      });
    });
    var rateAt = function (p) {
      var g = priced ? geo.groundAt(c, [p.x, p.y]) : null;
      var cost = g && g.cost !== undefined ? g.cost : 1;
      if (cost === 'never') return Infinity;
      if (cost === 1) return prices.move;
      if (cost === 2) return prices.difficult;
      return prices.move * cost;
    };

    var plan = {
      map: map,
      width: width,
      radius: r,
      bounds: { width: W, height: H },
      states: states,
      prices: prices,
      geometry: c,
      priced: priced,
      allow: [],
    };

    var squareBlocked = function (p) {
      if (!blockedSquare) return false;
      var sq = squareOf(p);
      for (var i = 0; i < plan.allow.length; i++) {
        if (plan.allow[i].x === sq.x && plan.allow[i].y === sq.y) return false;
      }
      return blockedSquare(sq);
    };

    // How far p is from the nearest thing in the way, up to `upTo`; and that
    // thing's nearest point.
    var nearest = function (p, upTo) {
      var best = upTo;
      var at = null;
      walls.near(p.x - upTo, p.y - upTo, p.x + upTo, p.y + upTo, function (s) {
        var q = closest(p, s.a, s.b);
        var d = dist(p, q);
        if (d < best) {
          best = d;
          at = q;
        }
      });
      return { distance: best, at: at };
    };
    var insideSolid = function (p) {
      for (var i = 0; i < solids.length; i++) if (inRings(p, solids[i])) return true;
      return false;
    };

    // A point's room, up to a step more than the character needs: 0 where
    // it can't be stood on at all.
    var roomAt = function (p) {
      if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return 0;
      if (squareBlocked(p) || insideSolid(p)) return 0;
      return nearest(p, r + STEP).distance;
    };

    /** Whether the character stands at p: clear of everything by its half width. */
    plan.fits = function (p, rr) {
      var need = rr === undefined ? r : rr;
      if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return false;
      if (squareBlocked(p)) return false;
      if (insideSolid(p)) return false;
      return nearest(p, need).distance >= need - EPS;
    };

    /** How far p is from anything in the way (up to the map's size). */
    plan.clearance = function (p) {
      if (insideSolid(p)) return 0;
      return nearest(p, Math.max(W, H)).distance;
    };

    /** Whether the character moves straight from a to b, `rr` clear (its half width). */
    plan.clear = function (a, b, rr) {
      var need = rr === undefined ? r : rr;
      var ok = true;
      walls.near(
        Math.min(a.x, b.x) - need,
        Math.min(a.y, b.y) - need,
        Math.max(a.x, b.x) + need,
        Math.max(a.y, b.y) + need,
        function (s) {
          if (segmentToSegment(a, b, s.a, s.b) < need - EPS) {
            ok = false;
            return false;
          }
          return true;
        }
      );
      if (!ok) return false;
      if (insideSolid(a) || insideSolid(b)) return false;
      if (blockedSquare) {
        var len = dist(a, b);
        var n = Math.max(1, Math.ceil(len / 0.5));
        for (var i = 0; i <= n; i++) {
          var t = i / n;
          if (squareBlocked({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
        }
      }
      return true;
    };

    /** The closed doors a straight move from a to b passes, in order: [{ item, t }]. */
    plan.doorsOn = function (a, b) {
      var out = [];
      doors.forEach(function (d) {
        var t = crossing(a, b, d.a, d.b);
        if (t !== null) out.push({ item: d.item, t: t });
      });
      return out.sort(function (x, y) {
        return x.t - y.t;
      });
    };

    /** A straight move's weight: its length in squares, each part at its ground's price. */
    plan.weight = function (a, b) {
      var len = dist(a, b);
      if (!len) return 0;
      if (!priced) return (len / FEET) * prices.move;
      var ts = [0, 1];
      grounds.near(
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.max(a.x, b.x),
        Math.max(a.y, b.y),
        function (s) {
          var t = crossing(a, b, s.a, s.b);
          if (t !== null) ts.push(t);
        }
      );
      ts.sort(function (x, y) {
        return x - y;
      });
      var w = 0;
      for (var i = 1; i < ts.length; i++) {
        var part = ts[i] - ts[i - 1];
        if (part <= EPS) continue;
        var m = (ts[i] + ts[i - 1]) / 2;
        var rate = rateAt({ x: a.x + (b.x - a.x) * m, y: a.y + (b.y - a.y) * m });
        if (rate === Infinity) return Infinity;
        w += ((len * part) / FEET) * rate;
      }
      return w;
    };

    /** A straight move's cost for planning: its weight, and each closed door's AP. */
    plan.cost = function (a, b) {
      var w = plan.weight(a, b);
      plan.doorsOn(a, b).forEach(function (d) {
        w += prices.door(d.item);
      });
      return w;
    };

    // The fine grid's points: each at its place, nudged to fit if it's close
    // to fitting, or null where nothing fits.
    var nx = Math.floor(W / STEP + EPS);
    var ny = Math.floor(H / STEP + EPS);
    var nodes = {};
    plan.node = function (i, j) {
      if (i < 0 || j < 0 || i > nx || j > ny) return null;
      var key = i + ',' + j;
      if (Object.prototype.hasOwnProperty.call(nodes, key)) return nodes[key];
      var home = { x: i * STEP, y: j * STEP };
      var p = home;
      var found = null;
      var room = 0;
      for (var k = 0; k < 3 && !found; k++) {
        var probe = roomAt(p);
        if (probe >= r - EPS) {
          found = p;
          room = probe;
          break;
        }
        var near = nearest(p, r);
        if (!near.at) break;
        var d = dist(p, near.at);
        if (d < EPS) break;
        var push = r - d + 1e-6;
        p = { x: p.x + ((p.x - near.at.x) / d) * push, y: p.y + ((p.y - near.at.y) / d) * push };
        if (Math.abs(p.x - home.x) > STEP / 2 + EPS || Math.abs(p.y - home.y) > STEP / 2 + EPS) {
          break;
        }
      }
      if (!found && Math.abs(p.x - home.x) <= STEP / 2 + EPS) {
        if (Math.abs(p.y - home.y) <= STEP / 2 + EPS) {
          room = roomAt(p);
          if (room >= r - EPS) found = p;
        }
      }
      nodes[key] = found
        ? {
            x: found.x,
            y: found.y,
            i: i,
            j: j,
            id: key,
            // Its room, up to a step more than it needs: a short hop between
            // two points with room to spare needs no other check.
            room: room,
          }
        : null;
      return nodes[key];
    };

    /** Whether a move straight between two linked points is clear (fast between roomy points). */
    plan.link = function (a, b) {
      if (
        !blockedSquare &&
        a.room >= r + 0.9 &&
        b.room >= r + 0.9 &&
        dist(a, b) <= 1.8 &&
        !insideSolid(a) &&
        !insideSolid(b)
      ) {
        return true;
      }
      return plan.clear(a, b);
    };

    // The middle of every gap between two things in the way, a little wider
    // than the character: a point the path can pass through.
    var gaps = buckets();
    var gapList = [];
    var reach = width + 2 * STEP;
    var seenGap = {};
    var ends = [];
    blockers.forEach(function (s) {
      ends.push(s.a, s.b);
    });
    for (var e = 0; e < ends.length && gapList.length < MAX_GAPS; e++) {
      var v = ends[e];
      walls.near(v.x - reach, v.y - reach, v.x + reach, v.y + reach, function (s) {
        if ((s.a.x === v.x && s.a.y === v.y) || (s.b.x === v.x && s.b.y === v.y)) return true;
        var q = closest(v, s.a, s.b);
        var d = dist(v, q);
        if (d < width - EPS || d > reach) return true;
        var m = { x: (v.x + q.x) / 2, y: (v.y + q.y) / 2 };
        var key = Math.round(m.x * 1000) + ',' + Math.round(m.y * 1000);
        if (seenGap[key]) return true;
        seenGap[key] = true;
        if (!plan.fits(m)) return true;
        var g = { x: m.x, y: m.y, id: 'g' + gapList.length, gap: true };
        gapList.push(g);
        gaps.add(g, m.x, m.y, m.x, m.y);
        return gapList.length < MAX_GAPS;
      });
    }

    // The points a point links to: the fine grid round it, and gaps nearby.
    plan.around = function (p, span) {
      var out = [];
      var i0 = Math.floor((p.x - span) / STEP);
      var i1 = Math.ceil((p.x + span) / STEP);
      var j0 = Math.floor((p.y - span) / STEP);
      var j1 = Math.ceil((p.y + span) / STEP);
      for (var j = j0; j <= j1; j++) {
        for (var i = i0; i <= i1; i++) {
          var n = plan.node(i, j);
          if (n && dist(n, p) <= span + EPS) out.push(n);
        }
      }
      gaps.near(p.x - span, p.y - span, p.x + span, p.y + span, function (g) {
        if (dist(g, p) <= span + EPS) out.push(g);
      });
      return out;
    };

    plan.neighbours = function (n) {
      if (n.gap) return plan.around(n, NEAR);
      var out = [];
      for (var dj = -1; dj <= 1; dj++) {
        for (var di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          var m = plan.node(n.i + di, n.j + dj);
          if (m) out.push(m);
        }
      }
      gaps.near(n.x - NEAR, n.y - NEAR, n.x + NEAR, n.y + NEAR, function (g) {
        if (dist(g, n) <= NEAR + EPS) out.push(g);
      });
      return out;
    };

    return plan;
  }

  // ── Paths ───────────────────────────────────────────────────────────

  // A binary heap of [priority, order, item], the lowest first, ties by order.
  function heap() {
    var items = [];
    var order = 0;
    var less = function (a, b) {
      return a[0] < b[0] - EPS || (Math.abs(a[0] - b[0]) <= EPS && a[1] < b[1]);
    };
    return {
      size: function () {
        return items.length;
      },
      push: function (priority, item) {
        items.push([priority, order++, item]);
        var i = items.length - 1;
        while (i > 0) {
          var up = (i - 1) >> 1;
          if (!less(items[i], items[up])) break;
          var t = items[i];
          items[i] = items[up];
          items[up] = t;
          i = up;
        }
      },
      pop: function () {
        var top = items[0];
        var last = items.pop();
        if (items.length) {
          items[0] = last;
          var i = 0;
          for (;;) {
            var l = 2 * i + 1;
            var rr = l + 1;
            var m = i;
            if (l < items.length && less(items[l], items[m])) m = l;
            if (rr < items.length && less(items[rr], items[m])) m = rr;
            if (m === i) break;
            var t = items[i];
            items[i] = items[m];
            items[m] = t;
            i = m;
          }
        }
        return top[2];
      },
    };
  }

  function pt(p) {
    return { x: p.x, y: p.y };
  }

  // The start's own clearance: one standing squeezed (a square from before)
  // can still step away.
  function startRadius(plan, from) {
    return Math.min(plan.radius, plan.clearance(from)) - 1e-6;
  }

  /**
   * Where the character can stand in a square, nearest its centre: the
   * centre itself if it fits, else the nearest fine-grid point in the square
   * that does. Null when nothing in the square fits.
   */
  function spotIn(plan, cell) {
    var centre = centreOf(cell);
    if (plan.fits(centre)) return centre;
    var best = null;
    var i0 = Math.round((cell.x * FEET) / STEP);
    var j0 = Math.round((cell.y * FEET) / STEP);
    for (var j = j0; j <= j0 + FEET / STEP; j++) {
      for (var i = i0; i <= i0 + FEET / STEP; i++) {
        var n = plan.node(i, j);
        if (!n) continue;
        var sq = squareOf(n);
        if (sq.x !== cell.x || sq.y !== cell.y) continue;
        if (!best || dist(n, centre) < dist(best, centre) - EPS) best = n;
      }
    }
    return best ? pt(best) : null;
  }

  /**
   * The cheapest way from `from` to `to` (points in feet): { points, weight,
   * feet, ap, doors: [{ id, at }] } (`at` the index of the leg it is on), or
   * null when there's none. `ap` is the whole way's: its weight rounded up
   * once, and each closed door's AP.
   */
  function pathTo(plan, from, to) {
    if (!(plan.prices.move < Infinity)) return null;
    var start = pt(from);
    var goal = pt(to);
    plan.allow = [squareOf(start), squareOf(goal)];
    var done = function (value) {
      plan.allow = [];
      return value;
    };
    if (!plan.fits(goal)) return done(null);
    var rs = startRadius(plan, start);
    if (rs < 0) return done(null);
    // Straight there when that is the cheapest there could be: nothing in
    // the way, one price all over, no door.
    if (!plan.priced && plan.clear(start, goal, rs) && !plan.doorsOn(start, goal).length) {
      return done(describe(plan, [start, goal]));
    }
    var minRate = Math.min(plan.prices.move, plan.prices.difficult);
    var h = function (p) {
      return (dist(p, goal) / FEET) * minRate;
    };
    var best = { start: 0 };
    var prev = {};
    var where = { start: start, goal: goal };
    var closed = {};
    var open = heap();
    open.push(h(start), { id: 'start', p: start });
    var goalLinks = {};
    plan.around(goal, NEAR).forEach(function (n) {
      if (plan.clear(n, goal)) goalLinks[n.id] = true;
    });
    var reached = false;
    var guard = 0;
    while (open.size() && guard++ < 200000) {
      var cur = open.pop();
      if (closed[cur.id]) continue;
      closed[cur.id] = true;
      if (cur.id === 'goal') {
        reached = true;
        break;
      }
      var nexts;
      if (cur.id === 'start') {
        nexts = plan.around(start, NEAR).filter(function (n) {
          return plan.clear(start, n, rs);
        });
        if (plan.clear(start, goal, rs)) nexts.push({ id: 'goal', x: goal.x, y: goal.y });
      } else {
        nexts = plan.neighbours(cur.n).filter(function (n) {
          return plan.link(cur.n, n);
        });
        if (goalLinks[cur.id]) nexts.push({ id: 'goal', x: goal.x, y: goal.y });
      }
      for (var k = 0; k < nexts.length; k++) {
        var n = nexts[k];
        if (closed[n.id]) continue;
        var step = plan.cost(cur.p, n);
        if (!(step < Infinity)) continue;
        var total = best[cur.id] + step;
        if (best[n.id] === undefined || total < best[n.id] - EPS) {
          best[n.id] = total;
          prev[n.id] = cur.id;
          if (n.id !== 'goal') where[n.id] = pt(n);
          open.push(total + h(n), { id: n.id, p: where[n.id], n: n });
        }
      }
    }
    if (!reached) return done(null);
    var points = [];
    for (var id = 'goal'; id !== undefined; id = prev[id]) points.unshift(where[id]);
    return done(describe(plan, straighten(plan, points, rs)));
  }

  // The path pulled straight: from each point, on to the furthest point it
  // can reach in a straight line costing no more than the way it took.
  function straighten(plan, points, rs) {
    var out = [points[0]];
    var i = 0;
    while (i < points.length - 1) {
      var next = i + 1;
      var along = 0;
      var sums = [0];
      for (var k = i + 1; k < points.length; k++) {
        along += plan.cost(points[k - 1], points[k]);
        sums.push(along);
      }
      for (var j = points.length - 1; j > i + 1; j--) {
        if (!plan.clear(points[i], points[j], i === 0 ? rs : plan.radius)) continue;
        if (plan.cost(points[i], points[j]) <= sums[j - i] + 1e-7) {
          next = j;
          break;
        }
      }
      out.push(points[next]);
      i = next;
    }
    return out;
  }

  function describe(plan, points) {
    var weight = 0;
    var feet = 0;
    var doorAp = 0;
    var doors = [];
    for (var i = 1; i < points.length; i++) {
      weight += plan.weight(points[i - 1], points[i]);
      feet += dist(points[i - 1], points[i]);
      plan.doorsOn(points[i - 1], points[i]).forEach(function (d) {
        doors.push({ id: d.item.id, at: i - 1 });
        doorAp += plan.prices.door(d.item);
      });
    }
    return {
      points: points,
      weight: weight,
      feet: feet,
      ap: apFor(weight) + doorAp,
      doors: doors,
    };
  }

  // ── Walking ─────────────────────────────────────────────────────────

  /**
   * A path as the stations a walk passes, a fine-grid step apart: [{ x, y,
   * weight, square, door? }], the first where it starts; `weight` so far,
   * `door` a closed door passed just before reaching it.
   */
  function stations(plan, path) {
    var pts = path.points;
    var out = [{ x: pts[0].x, y: pts[0].y, weight: 0, square: squareOf(pts[0]) }];
    var weight = 0;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1];
      var b = pts[i];
      var len = dist(a, b);
      var n = Math.max(1, Math.ceil(len / STEP - EPS));
      var doorsHere = plan.doorsOn(a, b);
      var prevT = 0;
      var prevP = a;
      for (var k = 1; k <= n; k++) {
        var t = k / n;
        var p =
          k === n ? { x: b.x, y: b.y } : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        weight += plan.weight(prevP, p);
        var station = { x: p.x, y: p.y, weight: weight, square: squareOf(p), leg: i - 1 };
        for (var d = 0; d < doorsHere.length; d++) {
          if (doorsHere[d].t > prevT + EPS && doorsHere[d].t <= t + EPS)
            station.door = doorsHere[d].item;
        }
        out.push(station);
        prevT = t;
        prevP = p;
      }
    }
    return out;
  }

  /**
   * How far a move gets with `ap` to spend (Infinity: AP off): { walked,
   * spent, opened?, reached } — `walked` the stations stepped to (not the
   * start), `spent` its AP (the weight walked rounded up once, and a door
   * opened), `opened` the id of a closed door it opened and stopped before,
   * `reached` whether it got to the end. Options:
   *   stop(station, before)  true to stop on it (someone comes into view, a
   *                          hazard is entered)
   *   stand(station)         false where it can't end (someone stands there):
   *                          a walk ending there backs off
   *   arriveIn               a square: a walk that stops in it (out of AP a
   *                          step short of its point) has arrived all the same
   */
  function walk(plan, path, ap, options) {
    var o = options || {};
    var list = stations(plan, path);
    var budget = ap === Infinity ? Infinity : ap;
    var walked = [];
    var opened = null;
    var doorAp = 0;
    for (var i = 1; i < list.length; i++) {
      var st = list[i];
      if (st.door) {
        // A closed door on the way: opened, and the walk stops before it.
        var cost = plan.prices.door(st.door);
        var sofar = walked.length ? apFor(walked[walked.length - 1].weight) : 0;
        if (sofar + cost <= budget) {
          opened = st.door.id;
          doorAp = cost;
        }
        break;
      }
      if (apFor(st.weight) > budget) break;
      walked.push(st);
      if (o.stop && o.stop(st, list[i - 1])) break;
    }
    if (o.stand && walked.length && !o.stand(walked[walked.length - 1])) {
      while (walked.length && !o.stand(walked[walked.length - 1])) walked.pop();
      opened = null;
      doorAp = 0;
    }
    var last = walked.length ? walked[walked.length - 1] : null;
    var spent = (last ? apFor(last.weight) : 0) + doorAp;
    var end = list[list.length - 1];
    var inGoal =
      Boolean(last) &&
      Boolean(o.arriveIn) &&
      last.square.x === o.arriveIn.x &&
      last.square.y === o.arriveIn.y;
    return {
      walked: walked,
      spent: budget === Infinity ? 0 : spent,
      opened: inGoal ? null : opened,
      reached: Boolean(last) && (last === end || inGoal),
    };
  }

  /**
   * A path cut short before the first station `before(station)` says not to
   * reach (walking up to someone: never into their square): the path to the
   * station before it, described afresh; the path itself when none does;
   * null when even the first step would.
   */
  function cutBefore(plan, path, before) {
    var list = stations(plan, path);
    for (var k = 1; k < list.length; k++) {
      if (!before(list[k])) continue;
      if (k === 1) return null;
      var end = list[k - 1];
      var points = path.points.slice(0, end.leg + 1);
      var last = points[points.length - 1];
      if (dist(last, end) > EPS) points.push({ x: end.x, y: end.y });
      return points.length > 1 ? describe(plan, points) : null;
    }
    return path;
  }

  /** The squares walked into, in order, each once in a row: for what is seen on the way. */
  function squaresOf(stationsWalked) {
    var out = [];
    stationsWalked.forEach(function (st) {
      var last = out[out.length - 1];
      if (!last || last.x !== st.square.x || last.y !== st.square.y) {
        out.push({ x: st.square.x, y: st.square.y });
      }
    });
    return out;
  }

  /**
   * The squares whose centres (or the spot nearest it the character fits)
   * a move from `from` reaches with `ap` to spend, through no closed door:
   * [{ x, y, ap }].
   */
  function reachable(plan, from, ap) {
    if (!(plan.prices.move < Infinity)) return [];
    var start = pt(from);
    plan.allow = [squareOf(start)];
    var rs = startRadius(plan, start);
    var out = [];
    if (rs < 0) {
      plan.allow = [];
      return out;
    }
    var limit = ap + 1 - ROUND; // a weight rounding up to `ap` or less
    var best = {};
    var done = {};
    var open = heap();
    best.start = 0;
    open.push(0, { id: 'start', p: start });
    var guard = 0;
    while (open.size() && guard++ < 400000) {
      var cur = open.pop();
      if (done[cur.id]) continue;
      done[cur.id] = true;
      var g = best[cur.id];
      var nexts =
        cur.id === 'start'
          ? plan.around(start, NEAR).filter(function (n) {
              return plan.clear(start, n, rs);
            })
          : plan.neighbours(cur.n);
      for (var k = 0; k < nexts.length; k++) {
        var n = nexts[k];
        if (done[n.id]) continue;
        if (cur.id !== 'start' && !plan.link(cur.n, n)) continue;
        if (plan.doorsOn(cur.p, n).length) continue;
        var total = g + plan.weight(cur.p, n);
        if (!(total < limit)) continue;
        if (best[n.id] === undefined || total < best[n.id] - EPS) {
          best[n.id] = total;
          open.push(total, { id: n.id, p: pt(n), n: n });
        }
      }
    }
    // A square is reached when its spot is: the centre, or the point
    // nearest it on the fine grid.
    var seen = {};
    Object.keys(best).forEach(function (id) {
      if (id === 'start' || id.charAt(0) === 'g') return;
      var parts = id.split(',');
      var n = plan.node(+parts[0], +parts[1]);
      if (!n) return;
      var sq = squareOf(n);
      var key = sq.x + ',' + sq.y;
      var spot = spotIn(plan, sq);
      if (!spot || Math.abs(spot.x - n.x) > EPS || Math.abs(spot.y - n.y) > EPS) return;
      var cost = apFor(best[id]);
      if (cost > ap) return;
      if (!seen[key] || cost < seen[key].ap) seen[key] = { x: sq.x, y: sq.y, ap: cost };
    });
    plan.allow = [];
    Object.keys(seen).forEach(function (key) {
      out.push(seen[key]);
    });
    return out.sort(function (a, b) {
      return a.y - b.y || a.x - b.x;
    });
  }

  var api = {
    FEET: FEET,
    STEP: STEP,
    SIZES: SIZES,
    DEFAULT_SIZE: DEFAULT_SIZE,
    sizeOf: sizeOf,
    widthOf: widthOf,
    centreOf: centreOf,
    squareOf: squareOf,
    apFor: apFor,
    geometryOf: geometryOf,
    planner: planner,
    spotIn: spotIn,
    pathTo: pathTo,
    stations: stations,
    walk: walk,
    cutBefore: cutBefore,
    squaresOf: squaresOf,
    reachable: reachable,
  };

  if (typeof window !== 'undefined') {
    window.Loom = window.Loom || {};
    window.Loom.mapPaths = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
