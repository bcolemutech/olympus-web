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
  //                 nudged (by up to half the grid) to where it does, the
  //                 middle of every narrow gap is a point too, so a path
  //                 passes any gap at least as wide as the character, and a
  //                 ring of points hugs every corner, so it turns tight. The
  //                 search runs at any angle (Theta*: a point is reached
  //                 straight from further back whenever that's clear and
  //                 costs no more), and the path found is pulled straight
  //                 again, so it bends only round what is in the way.
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
  //   Heights (DA2) a size's eyes stand `eyeOf` above the floor (`floorAt`,
  //                 the ground's height); a ledge's edge more than STEP_UP
  //                 high can't be walked up, and a drop of FALL or more
  //                 walked off is a fall (L-923)
  //
  //   planner(map, options)       the map as a character moves on it
  //   pathTo(plan, from, to)      the cheapest way, { points, ap, feet, … }
  //   walk(plan, path, ap, opts)  how far a move gets: stations walked, AP
  //                               spent, a door opened
  //   reachable(plan, from, ap)   the squares whose centres a move reaches
  //   squaresReached(map, starts) the squares a walk from them gets to, for
  //                               builders' checks
  //   costsFrom(plan, from)       the cheapest way to each square, for choosing
  //   spotOf, feetBetween, gapBetween, bandOf   distances in feet (DS1):
  //                               between people, edge to edge, and how far
  //                               an attack reaches
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
  // Heights (L-923; DA2): a rise of more than STEP_UP can't be walked up (a
  // ledge's edge); a drop of FALL or more is a fall.
  var STEP_UP = 2.5;
  var FALL = 10;

  // Each size's width and the height of its eyes above the floor (L-923;
  // DA2: a wall or object hides what's beyond it when its top reaches the
  // eyes).
  var SIZES = [
    { id: 'tiny', width: 1, eye: 1 },
    { id: 'small', width: 1.5, eye: 2.5 },
    { id: 'medium', width: 2.5, eye: 5 },
    { id: 'large', width: 5, eye: 10 },
    { id: 'huge', width: 10, eye: 20 },
    { id: 'gargantuan', width: 15, eye: 30 },
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

  /** How high a size's eyes are above the floor, in feet (L-923). */
  function eyeOf(size) {
    return (sizeOf(size) || sizeOf(DEFAULT_SIZE)).eye;
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

  /**
   * The floor's height at a point in feet on a battle map (L-923; DA2): its
   * ground's `height` there, else 0.
   */
  function floorAt(map, point) {
    if (!map || !point) return 0;
    var c = geo.compile(geometryOf(map));
    var g = c.ground.length ? geo.groundAt(c, [point.x, point.y]) : null;
    return g && typeof g.height === 'number' && isFinite(g.height) ? g.height : 0;
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
   *   drops    'never' for someone who won't walk off a drop of FALL or
   *            more (foes, L-923); by default a drop is walked off: a fall
   *
   * Heights (L-923; DA2): where ground meets ground more than STEP_UP
   * higher, its edge can't be walked up; walked down, a drop of FALL or more
   * is a fall (the walk's caller stops there: ../loom-turn/steps.js).
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

    // The floor's height at a point (L-923): the ground's there, else 0.
    var heightAt = function (p) {
      var g = c.ground.length ? geo.groundAt(c, [p.x, p.y]) : null;
      return g && typeof g.height === 'number' && isFinite(g.height) ? g.height : 0;
    };
    // Ledges: ground edges with more than STEP_UP between their two sides.
    var ledges = buckets();
    var hasLedges = false;
    var noDrops = o.drops === 'never';
    c.ground.forEach(function (g) {
      if (typeof g.item.height !== 'number' || !g.item.height) return;
      g.rings.forEach(function (ring) {
        for (var i = 0; i < ring.length; i++) {
          var a = { x: ring[i][0], y: ring[i][1] };
          var b = { x: ring[(i + 1) % ring.length][0], y: ring[(i + 1) % ring.length][1] };
          var len = dist(a, b);
          if (!len) continue;
          var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          var offX = (-(b.y - a.y) / len) * 0.05;
          var offY = ((b.x - a.x) / len) * 0.05;
          var one = heightAt({ x: mid.x + offX, y: mid.y + offY });
          var two = heightAt({ x: mid.x - offX, y: mid.y - offY });
          if (Math.abs(one - two) <= STEP_UP + EPS) continue;
          hasLedges = true;
          ledges.add(
            { a: a, b: b },
            Math.min(a.x, b.x),
            Math.min(a.y, b.y),
            Math.max(a.x, b.x),
            Math.max(a.y, b.y)
          );
        }
      });
    });
    // Whether a straight move from a to b goes up a ledge (or, for those who
    // won't, off a drop of FALL or more).
    var ledgeBlocks = function (a, b) {
      if (!hasLedges) return false;
      var len = dist(a, b);
      if (!len) return false;
      var e = 0.02 / len;
      var blocked = false;
      ledges.near(
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.max(a.x, b.x),
        Math.max(a.y, b.y),
        function (s) {
          var t = crossing(a, b, s.a, s.b);
          if (t === null) return true;
          var before = heightAt({
            x: a.x + (b.x - a.x) * Math.max(0, t - e),
            y: a.y + (b.y - a.y) * Math.max(0, t - e),
          });
          var after = heightAt({
            x: a.x + (b.x - a.x) * Math.min(1, t + e),
            y: a.y + (b.y - a.y) * Math.min(1, t + e),
          });
          if (after - before > STEP_UP + EPS || (noDrops && before - after >= FALL - EPS)) {
            blocked = true;
            return false;
          }
          return true;
        }
      );
      return blocked;
    };

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
      if (ledgeBlocks(a, b)) return false;
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
        if (t !== null) out.push({ item: d.item, t: t, a: d.a, b: d.b });
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
        !insideSolid(b) &&
        !ledgeBlocks(a, b)
      ) {
        return true;
      }
      return plan.clear(a, b);
    };

    /** The floor's height at a point, in feet (L-923). */
    plan.floor = heightAt;

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

    // A ring of points just clear of every corner of what's in the way (16
    // round each, far enough out that a hop between two of them stays a half
    // width clear: r / cos(π/16)): where a path turns round a corner as
    // tight as the character can.
    var ring = r / Math.cos(Math.PI / 16) + 0.01;
    var corners = {};
    for (var c2 = 0; c2 < ends.length && gapList.length < MAX_GAPS; c2++) {
      var corner = ends[c2];
      var ck = Math.round(corner.x * 1000) + ',' + Math.round(corner.y * 1000);
      if (corners[ck]) continue;
      corners[ck] = true;
      for (var k2 = 0; k2 < 16 && gapList.length < MAX_GAPS; k2++) {
        var t2 = (k2 * Math.PI) / 8;
        var cp = {
          x: corner.x + Math.cos(t2) * ring,
          y: corner.y + Math.sin(t2) * ring,
        };
        if (!plan.fits(cp)) continue;
        var cn = { x: cp.x, y: cp.y, id: 'g' + gapList.length, gap: true };
        gapList.push(cn);
        gaps.add(cn, cp.x, cp.y, cp.x, cp.y);
      }
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
      // Any angle (Theta*): a point is reached straight from the parent of
      // the point it was found from, when that's clear and costs no more, so
      // a path bends only where something is in the way.
      var parent = prev[cur.id];
      for (var k = 0; k < nexts.length; k++) {
        var n = nexts[k];
        if (closed[n.id]) continue;
        var from = cur.id;
        var total = Infinity;
        if (parent !== undefined) {
          var pp = where[parent];
          var clearFromParent = parent === 'start' ? plan.clear(pp, n, rs) : plan.clear(pp, n);
          if (clearFromParent) {
            var direct = best[parent] + plan.cost(pp, n);
            if (direct < Infinity) {
              total = direct;
              from = parent;
            }
          }
        }
        var step = plan.cost(cur.p, n);
        if (step < Infinity && best[cur.id] + step < total - EPS) {
          total = best[cur.id] + step;
          from = cur.id;
        }
        if (!(total < Infinity)) continue;
        if (best[n.id] === undefined || total < best[n.id] - EPS) {
          best[n.id] = total;
          prev[n.id] = from;
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

  // The path pulled straight: the cheapest way through its own points, each
  // leg straight from any earlier point that sees it (clear for the
  // character) to any later one, within a window of points back.
  var WINDOW = 48;
  function straighten(plan, points, rs) {
    var n = points.length;
    if (n <= 2) return points;
    var best = [0];
    var from = [-1];
    for (var j = 1; j < n; j++) {
      best[j] = Infinity;
      from[j] = j - 1;
      for (var i = Math.max(0, j - WINDOW); i < j; i++) {
        if (!(best[i] < Infinity)) continue;
        var through = i === j - 1;
        if (!through && !plan.clear(points[i], points[j], i === 0 ? rs : plan.radius)) continue;
        var c = best[i] + plan.cost(points[i], points[j]);
        if (c < best[j] - 1e-9) {
          best[j] = c;
          from[j] = i;
        }
      }
    }
    var out = [];
    for (var k = n - 1; k >= 0; k = from[k]) out.unshift(points[k]);
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
          station.doorAt = { a: doorsHere[d].a, b: doorsHere[d].b };
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
   * opened), `opened` the id of a closed door it opened, from the first
   * station within 5 ft of it (beside it), and stopped at,
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
    // A closed door on the way is opened from beside it, within a square's
    // reach (5 ft): the walk goes no nearer, and stops there.
    var doorAt = -1;
    for (var k = 1; k < list.length && doorAt < 0; k++) if (list[k].door) doorAt = k;
    var openFrom = doorAt;
    if (doorAt > 0) {
      var span = list[doorAt].doorAt;
      for (var j = 0; j < doorAt; j++) {
        if (pointToSegment(list[j], span.a, span.b) <= FEET + EPS) {
          openFrom = j;
          break;
        }
      }
    }
    for (var i = 1; i < list.length; i++) {
      var st = list[i];
      if (doorAt > 0 && i > openFrom) {
        var door = list[doorAt].door;
        var cost = plan.prices.door(door);
        var sofar = walked.length ? apFor(walked[walked.length - 1].weight) : 0;
        if (sofar + cost <= budget && walked.length === openFrom) {
          opened = door.id;
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
   * A move to a square or a point, as the server makes it and the page
   * previews it (L-922): the spot the character fits (the point itself, else
   * where in its square nearest the centre), the way there, cut short of the
   * square of someone standing there (`occupied(square)` true), and how far
   * `ap` takes it. `target` is { cell } or { point }. Returns { path, walk,
   * end, goal } (`goal` the square it ends in), or { none: 'room' | 'way' }.
   * Options: occupied(square), stop(station, before) as walk's.
   */
  function moveTo(plan, from, target, ap, options) {
    var o = options || {};
    var cell = target.cell || squareOf(target.point);
    var aim = target.point && plan.fits(target.point) ? pt(target.point) : spotIn(plan, cell);
    if (!aim) return { none: 'room' };
    var found = pathTo(plan, from, aim);
    if (!found) return { none: 'way' };
    var occupied = o.occupied || null;
    if (occupied && occupied(cell)) {
      found = cutBefore(plan, found, function (st) {
        return st.square.x === cell.x && st.square.y === cell.y;
      });
      if (!found) return { none: 'room' };
    }
    var end = found.points[found.points.length - 1];
    var goal = squareOf(end);
    var went = walk(plan, found, ap, {
      stop: o.stop,
      stand: occupied
        ? function (st) {
            return !occupied(st.square);
          }
        : null,
      arriveIn: goal,
    });
    return { path: found, walk: went, end: pt(end), goal: goal };
  }

  /**
   * The planner for a battle map as the grid view has it (loomGetMap's
   * `battleMap`, the map as far as the save has seen it, and its turn's
   * `prices`): each door in the state the view gives it, or as `opened`
   * on the way; the character's width; never into a square not seen
   * (`known(square)` false) nor an exit but the one at `goal`. The server
   * plans a move on the same map (functions/loom-turn/steps.js moverFor).
   */
  function viewPlanner(view, prices, options) {
    var o = options || {};
    var opened = o.opened || {};
    var states = {};
    (view.doors || []).forEach(function (door) {
      states[door.id] = door.state;
    });
    Object.keys(opened).forEach(function (id) {
      states[id] = opened[id];
    });
    var map = view;
    if (view.geometry && Object.keys(opened).length) {
      // A door in the map's geometry opened on the way.
      var doors = (view.geometry.doors || []).map(function (door) {
        if (!opened[door.id]) return door;
        var copy = {};
        Object.keys(door).forEach(function (k) {
          copy[k] = door[k];
        });
        copy.state = opened[door.id];
        return copy;
      });
      var geometry = {};
      Object.keys(view.geometry).forEach(function (k) {
        geometry[k] = view.geometry[k];
      });
      geometry.doors = doors;
      map = {};
      Object.keys(view).forEach(function (k) {
        map[k] = view[k];
      });
      map.geometry = geometry;
    }
    var exits = {};
    (view.exits || []).forEach(function (e) {
      exits[e.x + ',' + e.y] = true;
    });
    var goalKey = o.goal ? o.goal.x + ',' + o.goal.y : null;
    var known = o.known || null;
    return planner(map, {
      width: view.size && view.size.width,
      states: states,
      prices: prices && {
        move: prices.move,
        difficult: prices.difficult,
        door: function (door) {
          var own = prices.doors && prices.doors[door.id];
          return typeof own === 'number' ? own : prices.door;
        },
      },
      blocked: function (sq) {
        if (sq.x < 0 || sq.y < 0 || sq.x >= view.width || sq.y >= view.height) return true;
        if (known && !known(sq)) return true;
        var k = sq.x + ',' + sq.y;
        return Boolean(exits[k]) && k !== goalKey;
      },
    });
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

  // The cheapest weight from `from` to every point of the fine grid (and the
  // gaps) within `limit`, through no closed door, at any angle (Theta*, as
  // pathTo): { id: weight }, and the points by id.
  function weightsFrom(plan, from, limit) {
    var best = {};
    var where = {};
    if (!(plan.prices.move < Infinity)) return { best: best, where: where };
    var start = pt(from);
    plan.allow = [squareOf(start)];
    var rs = startRadius(plan, start);
    if (rs < 0) {
      plan.allow = [];
      return { best: best, where: where };
    }
    var prev = {};
    var done = {};
    var open = heap();
    best.start = 0;
    where.start = start;
    open.push(0, { id: 'start', p: start });
    var guard = 0;
    while (open.size() && guard++ < 400000) {
      var cur = open.pop();
      if (done[cur.id]) continue;
      done[cur.id] = true;
      var nexts =
        cur.id === 'start'
          ? plan.around(start, NEAR).filter(function (n) {
              return plan.clear(start, n, rs);
            })
          : plan.neighbours(cur.n).filter(function (n) {
              return plan.link(cur.n, n);
            });
      var parent = prev[cur.id];
      for (var k = 0; k < nexts.length; k++) {
        var n = nexts[k];
        if (done[n.id]) continue;
        var total = Infinity;
        var from2 = cur.id;
        if (parent !== undefined) {
          var pp = where[parent];
          var clearFrom = parent === 'start' ? plan.clear(pp, n, rs) : plan.clear(pp, n);
          if (clearFrom && !plan.doorsOn(pp, n).length) {
            total = best[parent] + plan.weight(pp, n);
            from2 = parent;
          }
        }
        if (!plan.doorsOn(cur.p, n).length) {
          var step = best[cur.id] + plan.weight(cur.p, n);
          if (step < total - EPS) {
            total = step;
            from2 = cur.id;
          }
        }
        if (!(total < limit)) continue;
        if (best[n.id] === undefined || total < best[n.id] - EPS) {
          best[n.id] = total;
          prev[n.id] = from2;
          where[n.id] = pt(n);
          open.push(total, { id: n.id, p: where[n.id], n: n });
        }
      }
    }
    plan.allow = [];
    return { best: best, where: where };
  }

  // A square's spot as a fine-grid point's id (spotIn), or null.
  function spotId(plan, cell) {
    var spot = spotIn(plan, cell);
    if (!spot) return null;
    return { spot: spot, id: Math.round(spot.x / STEP) + ',' + Math.round(spot.y / STEP) };
  }

  /**
   * The cheapest way from `from` to each square's spot, for choosing where to
   * go (a foe closing in, L-836): a function of a square giving { spot,
   * weight }, or null where it isn't reached (within `limit`, a weight).
   */
  function costsFrom(plan, from, limit) {
    var found = weightsFrom(plan, from, limit === undefined ? Infinity : limit);
    return function (cell) {
      var s = spotId(plan, cell);
      if (!s) return null;
      var w = found.best[s.id];
      if (w === undefined) {
        // Where it stands now.
        var here = squareOf(from);
        if (here.x === cell.x && here.y === cell.y) return { spot: pt(from), weight: 0 };
        return null;
      }
      return { spot: s.spot, weight: w };
    };
  }

  /**
   * The squares whose centres (or the spot nearest it the character fits)
   * a move from `from` reaches with `ap` to spend, through no closed door:
   * [{ x, y, ap }].
   */
  function reachable(plan, from, ap) {
    var found = weightsFrom(plan, from, ap + 1 - ROUND); // a weight rounding up to `ap`
    var seen = {};
    Object.keys(found.best).forEach(function (id) {
      if (id === 'start' || id.charAt(0) === 'g') return;
      var parts = id.split(',');
      var n = plan.node(+parts[0], +parts[1]);
      if (!n) return;
      var sq = squareOf(n);
      var key = sq.x + ',' + sq.y;
      var s = spotId(plan, sq);
      if (!s || s.id !== id) return;
      var cost = apFor(found.best[id]);
      if (cost > ap) return;
      if (!seen[key] || cost < seen[key].ap) seen[key] = { x: sq.x, y: sq.y, ap: cost };
    });
    var out = Object.keys(seen).map(function (key) {
      return seen[key];
    });
    return out.sort(function (a, b) {
      return a.y - b.y || a.x - b.x;
    });
  }

  /**
   * The squares someone can walk to from `starts` (squares), by "x,y"
   * (L-394, L-922): those whose centre, or the spot in them nearest it they
   * fit, a walk reaches, as wide as `options.width` (medium by default).
   * Doors as `options.open(door)` says (by default any not locked: a closed
   * one opens); never on through an exit, since stepping on one leaves: an
   * exit is reached, not walked through. For builders' checks and placing
   * people; with no limit on AP.
   */
  function squaresReached(map, starts, options) {
    var o = options || {};
    var states = {};
    (geometryOf(map).doors || []).forEach(function (door) {
      var open = o.open ? o.open(door) : door.state !== 'locked';
      states[door.id] = open ? 'open' : 'locked';
    });
    var exits = {};
    (map.exits || []).forEach(function (e) {
      exits[e.x + ',' + e.y] = true;
    });
    var plan = planner(map, { width: o.width, states: states });
    var seen = {};
    var visited = {};
    var queue = [];
    var push = function (n) {
      if (visited[n.id]) return;
      visited[n.id] = n;
      queue.push(n);
    };
    (starts || []).forEach(function (start) {
      seen[start.x + ',' + start.y] = true;
      var at = spotIn(plan, start);
      if (!at) return;
      var rs = startRadius(plan, at);
      if (rs < 0) return;
      plan.around(at, NEAR).forEach(function (n) {
        if (plan.clear(at, n, rs)) push(n);
      });
    });
    // A flood over the fine grid: a point in an exit is reached, never
    // walked on from.
    for (var k = 0; k < queue.length; k++) {
      var n = queue[k];
      var sq = squareOf(n);
      if (exits[sq.x + ',' + sq.y] && !seen[sq.x + ',' + sq.y]) continue;
      var next = plan.neighbours(n);
      for (var m = 0; m < next.length; m++) {
        if (!visited[next[m].id] && plan.link(n, next[m])) push(next[m]);
      }
    }
    // A square is reached when its spot is; an exit when any point in it is.
    Object.keys(visited).forEach(function (id) {
      var in2 = squareOf(visited[id]);
      if (exits[in2.x + ',' + in2.y]) seen[in2.x + ',' + in2.y] = true;
    });
    for (var y = 0; y < (map.height || 0); y++) {
      for (var x = 0; x < (map.width || 0); x++) {
        var key = x + ',' + y;
        if (seen[key] || exits[key]) continue;
        var s2 = spotId(plan, { x: x, y: y });
        if (s2 && visited[s2.id]) seen[key] = true;
      }
    }
    return seen;
  }

  // ── Distances (DS1) ─────────────────────────────────────────────────

  /**
   * Where someone stands, as a spot: { point (in feet), width }. From a
   * spot, someone with a `cell` (and a `point` in it, L-922) and a `width`,
   * or a bare square ({ x, y }), read as its centre. Medium's width when
   * none is known.
   */
  function spotOf(v, width) {
    if (!v) return null;
    var w = v.width > 0 ? v.width : width > 0 ? width : widthOf(DEFAULT_SIZE);
    var p = v.point;
    var cell = v.cell || (v.point ? null : v);
    if (p && isFinite(p.x) && isFinite(p.y)) {
      var sq = squareOf(p);
      if (!cell || (sq.x === cell.x && sq.y === cell.y)) return { point: pt(p), width: w };
    }
    if (!cell || !isFinite(cell.x) || !isFinite(cell.y)) return null;
    return { point: centreOf(cell), width: w };
  }

  /** How far apart two people stand, centre to centre, in feet. */
  function feetBetween(a, b) {
    var p = spotOf(a);
    var q = spotOf(b);
    return p && q ? dist(p.point, q.point) : Infinity;
  }

  /** The gap between two people, edge to edge, in feet (0 when they touch). */
  function gapBetween(a, b) {
    var p = spotOf(a);
    var q = spotOf(b);
    if (!p || !q) return Infinity;
    return Math.max(0, dist(p.point, q.point) - (p.width + q.width) / 2);
  }

  /**
   * How far an attack reaches from one person to another (PS1, DS1): 'reach'
   * (melee, within its reach), 'normal' or 'long' (ranged), or null. Reach
   * and ranges are in squares of 5 ft, measured in feet, edge to edge: a
   * reach of 1 touches anyone beside, a diagonal too. Sight is the caller's.
   */
  function bandOf(attack, from, to) {
    var gap = gapBetween(from, to);
    if (attack.range) {
      if (gap <= attack.range.normal * FEET + 1e-6) return 'normal';
      return gap <= attack.range.long * FEET + 1e-6 ? 'long' : null;
    }
    return gap <= (attack.reach || 1) * FEET + 1e-6 ? 'reach' : null;
  }

  var api = {
    FEET: FEET,
    STEP: STEP,
    SIZES: SIZES,
    DEFAULT_SIZE: DEFAULT_SIZE,
    sizeOf: sizeOf,
    widthOf: widthOf,
    eyeOf: eyeOf,
    STEP_UP: STEP_UP,
    FALL: FALL,
    floorAt: floorAt,
    centreOf: centreOf,
    squareOf: squareOf,
    apFor: apFor,
    geometryOf: geometryOf,
    planner: planner,
    spotIn: spotIn,
    pathTo: pathTo,
    stations: stations,
    walk: walk,
    moveTo: moveTo,
    viewPlanner: viewPlanner,
    cutBefore: cutBefore,
    squaresOf: squaresOf,
    reachable: reachable,
    squaresReached: squaresReached,
    costsFrom: costsFrom,
    spotOf: spotOf,
    feetBetween: feetBetween,
    gapBetween: gapBetween,
    bandOf: bandOf,
  };

  if (typeof window !== 'undefined') {
    window.Loom = window.Loom || {};
    window.Loom.mapPaths = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
