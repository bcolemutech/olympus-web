/* global module, window, require */
(function () {
  'use strict';

  // A map's geometry (planning/maps-from-data.md §4.1, GE1, GE4, GE5, DA1,
  // DA2; L-921 / #725): precise shapes in the map's own units (feet on a
  // grid, a square being 5 ft; the map's units on a region or area map), not
  // lines on a grid. One vocabulary for every level:
  //
  //   ground   [{ id, material, shape, height?, cost?, depth? }] — floors and
  //            terrain; a later one lies over an earlier one. `height` the
  //            floor's height (ft, may be below 0), `cost` a multiple of the
  //            AP for moving (1 or more) or 'never', `depth` water's depth
  //   lines    [{ id, material, points, width? }] — rivers, roads, streets
  //   walls    [{ id, material, points, height?, blocksMove?, blocksSight? }]
  //            — polylines; they block both unless their flags say not
  //            (a see-through material, glass or bars, blocks movement only)
  //   doors    [{ id, material, from, to, wall?, name?, state?, unlocks?,
  //            seeThrough? }] — a segment lying in a wall, which it replaces
  //            there; state 'open', 'closed' (the default) or 'locked',
  //            unlocked by `unlocks: { key?, action? }`
  //   windows  [{ id, material, from, to, wall?, state?, seeThrough? }] — a
  //            segment in a wall; never walked through; seen through by its
  //            material, or open
  //   objects  [{ id, kind, at, size, turn?, height?, name?, blocksMove?,
  //            blocksSight?, … }] — at its centre, `size` [w, h] (or one
  //            number), turned `turn` degrees; its settings are L-926's
  //   zones    [{ id, name?, shape }] — named or not (DA1b)
  //   spawns   [{ id, name?, at | shape, what?, count? }] (DA4)
  //   lights   [{ id, at, radius, dim? }] a source, or [{ id, shape, dark:
  //            true }] a dark area
  //   notes    [{ id, text, at? | shape?, sense? }] — for the GM
  //   hidden   [{ id, dc? }] (or ids) — any of the above, hidden until found
  //
  // Points are [x, y] (or { x, y }). A shape (an area) is a list of points,
  // SVG path data ('M0 0 H10 V10 H0 Z', curves and arcs flattened; several
  // closed subpaths make holes, even-odd), { circle: { x, y, r } } or
  // { rect: { x, y, w, h } }; a line's `points` a list of points or path
  // data. Firestore keeps no arrays of arrays, so `normalize` stores every
  // list of points as path data, which is also the most compact.
  //
  // Materials are named from the built-in set (./materials.js, with their
  // art); any other is refused.
  //
  //   check(geometry, bounds)   reasons it won't do, [] if it's sound
  //   normalize(geometry)       as stored: point lists as path data, ids
  //   compile(geometry)         shapes read as polygons and edges (cached)
  //   edges(compiled, states)   walls, doors and windows as blocking edges
  //   hits(compiled, a, b, o)   the edges a segment crosses
  //   clearance(compiled, p, o) how far p is from anything blocking movement
  //   fits(compiled, p, width)  whether something that wide stands at p
  //   pointInShape, groundAt, zonesAt, boundsOf, ringsOf, linesOf
  //
  // This file is kept in two places with the same bytes, functions/loom-canon/
  // map-geometry.js and public/apps/loom/js/map-geometry.js (the page loads it
  // as Loom.mapGeometry, after materials.js), and a test fails if they
  // differ: change both.

  var FEET_PER_SQUARE = 5;
  var LISTS = [
    'ground',
    'lines',
    'walls',
    'doors',
    'windows',
    'objects',
    'zones',
    'spawns',
    'lights',
    'notes',
    'hidden',
  ];

  // The built-in materials, by what they're for (RD1), from ./materials.js
  // (L-925): MATERIALS[kind][id] holds the flags it carries. A see-through
  // wall, door or window lets sight through by default; water takes a depth.
  var catalog =
    typeof module === 'object' && module.exports ? require('./materials') : window.Loom.materials;
  var MATERIALS = {};
  catalog.KINDS.forEach(function (kind) {
    MATERIALS[kind] = {};
  });
  catalog.MATERIALS.forEach(function (item) {
    var flags = {};
    if (item.seeThrough) flags.seeThrough = true;
    if (item.water) flags.water = true;
    MATERIALS[item.kind][item.id] = flags;
  });
  var MATERIAL_OF = {
    ground: 'ground',
    lines: 'line',
    walls: 'wall',
    doors: 'door',
    windows: 'window',
  };
  var DOOR_STATES = ['open', 'closed', 'locked'];
  var WINDOW_STATES = ['open', 'closed'];

  var MAX_ITEMS = 500; // in one list
  var MAX_POINTS = 2000; // in one shape, curves and circles flattened
  var MAX_TOTAL = 20000; // in the whole map
  var CURVE_STEPS = 8;
  var ID = /^[A-Za-z0-9_-]{1,60}$/;

  var compiled = typeof WeakMap === 'function' ? new WeakMap() : null;

  // ── Small things ──────────────────────────────────────────────────────

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }
  function num(v) {
    return typeof v === 'number' && isFinite(v);
  }
  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  function fmt(n) {
    var r = Math.round(n * 1000) / 1000;
    return String(r === 0 ? 0 : r);
  }

  /** A point as [x, y], from [x, y] or { x, y }; null if it isn't one. */
  function pointOf(v) {
    if (Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1])) return [v[0], v[1]];
    if (isObject(v) && num(v.x) && num(v.y)) return [v.x, v.y];
    return null;
  }

  function same(a, b, eps) {
    return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
  }

  // ── SVG path data ─────────────────────────────────────────────────────

  var NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
  var ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

  // The arc from p0 to p1 as points after p0 (SVG's endpoint arc, F.6.5).
  function arcPoints(p0, rx, ry, rot, large, sweep, p1) {
    if (same(p0, p1, 0)) return [];
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (!rx || !ry) return [p1];
    var phi = (rot * Math.PI) / 180;
    var cos = Math.cos(phi);
    var sin = Math.sin(phi);
    var dx = (p0[0] - p1[0]) / 2;
    var dy = (p0[1] - p1[1]) / 2;
    var x1 = cos * dx + sin * dy;
    var y1 = -sin * dx + cos * dy;
    var lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lambda > 1) {
      rx *= Math.sqrt(lambda);
      ry *= Math.sqrt(lambda);
    }
    var num2 = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    var den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    var k = Math.sqrt(Math.max(0, num2 / den)) * (large === sweep ? -1 : 1);
    var cx1 = (k * rx * y1) / ry;
    var cy1 = (-k * ry * x1) / rx;
    var cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
    var cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
    var angle = function (ux, uy, vx, vy) {
      return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    };
    var t1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    var dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    var n = Math.max(2, Math.ceil(Math.abs(dt) / (Math.PI / 8)));
    var out = [];
    for (var i = 1; i < n; i++) {
      var t = t1 + (dt * i) / n;
      var ex = rx * Math.cos(t);
      var ey = ry * Math.sin(t);
      out.push([cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
    }
    out.push(p1);
    return out;
  }

  function bezier(p0, c1, c2, p1) {
    var out = [];
    for (var i = 1; i <= CURVE_STEPS; i++) {
      var t = i / CURVE_STEPS;
      var u = 1 - t;
      out.push(
        c2
          ? [
              u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
              u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
            ]
          : [
              u * u * p0[0] + 2 * u * t * c1[0] + t * t * p1[0],
              u * u * p0[1] + 2 * u * t * c1[1] + t * t * p1[1],
            ]
      );
    }
    out[out.length - 1] = p1;
    return out;
  }

  /**
   * SVG path data read as subpaths: { subpaths: [{ points, closed }] }, or
   * { error }. Curves and arcs are flattened into straight runs.
   */
  function parsePath(d) {
    if (typeof d !== 'string' || !d.trim()) return { error: 'path data is empty' };
    var pos = 0;
    var subpaths = [];
    var current = null;
    var pen = [0, 0];
    var start = [0, 0];
    var lastControl = null;
    var lastCmd = '';
    var cmd = '';

    function sep() {
      while (pos < d.length && /[\s,]/.test(d.charAt(pos))) pos++;
    }
    function number() {
      sep();
      var m = NUMBER.exec(d.slice(pos));
      if (!m) return null;
      pos += m[0].length;
      return parseFloat(m[0]);
    }
    function flag() {
      sep();
      var c = d.charAt(pos);
      if (c !== '0' && c !== '1') return null;
      pos++;
      return c === '1';
    }
    function add(points) {
      if (!current) {
        current = { points: [pen.slice()], closed: false };
        subpaths.push(current);
      }
      for (var i = 0; i < points.length; i++) current.points.push(points[i]);
      pen = points.length ? points[points.length - 1] : pen;
    }

    sep();
    while (pos < d.length) {
      var c = d.charAt(pos);
      if (/[A-Za-z]/.test(c)) {
        if (!has(ARGS, c.toUpperCase())) return { error: 'path data has an unknown command ' + c };
        cmd = c;
        pos++;
      } else if (!cmd) {
        return { error: 'path data must start with M' };
      } else if (cmd === 'Z' || cmd === 'z') {
        return { error: 'path data has numbers after Z' };
      }
      if (!subpaths.length && cmd !== 'M' && cmd !== 'm') {
        return { error: 'path data must start with M' };
      }
      var up = cmd.toUpperCase();
      var rel = cmd !== up;
      var a = [];
      if (up === 'A') {
        var rx = number();
        var ry = number();
        var rot = number();
        var large = flag();
        var sweep = flag();
        var ax = number();
        var ay = number();
        if (ry === null || ax === null || ay === null || rx === null || rot === null) {
          return { error: 'path data has an arc without its numbers' };
        }
        if (large === null || sweep === null)
          return { error: 'path data has an arc without flags' };
        a = [rx, ry, rot, large, sweep, ax, ay];
      } else {
        for (var i = 0; i < ARGS[up]; i++) {
          var v = number();
          if (v === null) return { error: 'path data has ' + c + ' without its numbers' };
          a.push(v);
        }
      }
      var ox = rel ? pen[0] : 0;
      var oy = rel ? pen[1] : 0;
      var control = null;
      if (up === 'M') {
        pen = [a[0] + ox, a[1] + oy];
        start = pen.slice();
        current = { points: [pen.slice()], closed: false };
        subpaths.push(current);
        cmd = rel ? 'l' : 'L'; // further pairs are lines
      } else if (up === 'L') {
        add([[a[0] + ox, a[1] + oy]]);
      } else if (up === 'H') {
        add([[a[0] + ox, pen[1]]]);
      } else if (up === 'V') {
        add([[pen[0], a[0] + (rel ? pen[1] : 0)]]);
      } else if (up === 'C' || up === 'S') {
        var c1;
        if (up === 'C') c1 = [a[0] + ox, a[1] + oy];
        else
          c1 =
            lastControl && /[CS]/i.test(lastCmd)
              ? [2 * pen[0] - lastControl[0], 2 * pen[1] - lastControl[1]]
              : pen.slice();
        var k = up === 'C' ? 2 : 0;
        var c2 = [a[k] + ox, a[k + 1] + oy];
        var end = [a[k + 2] + ox, a[k + 3] + oy];
        add(bezier(pen, c1, c2, end));
        control = c2;
      } else if (up === 'Q' || up === 'T') {
        var q =
          up === 'Q'
            ? [a[0] + ox, a[1] + oy]
            : lastControl && /[QT]/i.test(lastCmd)
              ? [2 * pen[0] - lastControl[0], 2 * pen[1] - lastControl[1]]
              : pen.slice();
        var qe = up === 'Q' ? [a[2] + ox, a[3] + oy] : [a[0] + ox, a[1] + oy];
        add(bezier(pen, q, null, qe));
        control = q;
      } else if (up === 'A') {
        add(arcPoints(pen, a[0], a[1], a[2], a[3], a[4], [a[5] + ox, a[6] + oy]));
      } else if (up === 'Z') {
        if (current) {
          current.closed = true;
          if (!same(current.points[current.points.length - 1], start, 1e-9)) {
            current.points.push(start.slice());
          }
        }
        pen = start.slice();
        current = null;
      }
      lastControl = control;
      lastCmd = up;
      sep();
    }
    if (!subpaths.length) return { error: 'path data has no points' };
    return { subpaths: subpaths };
  }

  // ── Shapes ────────────────────────────────────────────────────────────

  function circleRing(c) {
    var n = Math.max(16, Math.min(64, Math.ceil((2 * Math.PI * c.r) / 2)));
    var ring = [];
    for (var i = 0; i < n; i++) {
      var t = (2 * Math.PI * i) / n;
      ring.push([c.x + c.r * Math.cos(t), c.y + c.r * Math.sin(t)]);
    }
    return ring;
  }

  // A list of points: [[x, y]…] or [{ x, y }…], as [[x, y]…], or null.
  function pointList(list) {
    if (!Array.isArray(list)) return null;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = pointOf(list[i]);
      if (!p) return null;
      out.push(p);
    }
    return out;
  }

  // Drops a ring's closing point if it repeats its first.
  function openRing(points) {
    var ring = points.slice();
    while (ring.length > 1 && same(ring[0], ring[ring.length - 1], 1e-9)) ring.pop();
    return ring;
  }

  /**
   * An area read as polygons: { rings: [[[x, y]…]…] }, closed rings with no
   * repeated last point (several rings make holes, even-odd), or { error }.
   */
  function ringsOf(shape) {
    if (typeof shape === 'string') {
      var parsed = parsePath(shape);
      if (parsed.error) return parsed;
      var rings = [];
      for (var i = 0; i < parsed.subpaths.length; i++) {
        var sub = parsed.subpaths[i];
        var pts = sub.points;
        if (!sub.closed && !(pts.length > 2 && same(pts[0], pts[pts.length - 1], 1e-9))) {
          return { error: 'is an open polygon: its path data doesn’t close (end it with Z)' };
        }
        rings.push(openRing(pts));
      }
      return { rings: rings };
    }
    if (Array.isArray(shape)) {
      var list = pointList(shape);
      if (!list) return { error: 'has a point that isn’t [x, y]' };
      return { rings: [openRing(list)] };
    }
    if (isObject(shape) && isObject(shape.circle)) {
      var c = shape.circle;
      if (!num(c.x) || !num(c.y) || !num(c.r) || c.r <= 0) {
        return { error: 'has a circle without x, y and a radius above 0' };
      }
      return { rings: [circleRing(c)] };
    }
    if (isObject(shape) && isObject(shape.rect)) {
      var r = shape.rect;
      if (!num(r.x) || !num(r.y) || !num(r.w) || !num(r.h) || r.w <= 0 || r.h <= 0) {
        return { error: 'has a rect without x, y and a width and height above 0' };
      }
      return {
        rings: [
          [
            [r.x, r.y],
            [r.x + r.w, r.y],
            [r.x + r.w, r.y + r.h],
            [r.x, r.y + r.h],
          ],
        ],
      };
    }
    return { error: 'has no shape: give points, path data, a circle or a rect' };
  }

  /** A line read as polylines: { lines: [[[x, y]…]…] }, or { error }. */
  function linesOf(points) {
    if (typeof points === 'string') {
      var parsed = parsePath(points);
      if (parsed.error) return parsed;
      return {
        lines: parsed.subpaths.map(function (s) {
          return s.points;
        }),
      };
    }
    var list = pointList(points);
    if (!list) return { error: 'has a point that isn’t [x, y]' };
    return { lines: [list] };
  }

  function ringArea(ring) {
    var a = 0;
    for (var i = 0; i < ring.length; i++) {
      var p = ring[i];
      var q = ring[(i + 1) % ring.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  /** Whether a point lies inside rings (even-odd: a ring inside another is a hole). */
  function inRings(p, rings) {
    var inside = false;
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var a = ring[i];
        var b = ring[j];
        if (a[1] > p[1] !== b[1] > p[1]) {
          var x = ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
          if (p[0] < x) inside = !inside;
        }
      }
    }
    return inside;
  }

  /** Whether a point ([x, y] or { x, y }) lies inside a shape in any of its forms. */
  function pointInShape(point, shape) {
    var p = pointOf(point);
    var read = ringsOf(shape);
    return Boolean(p && read.rings && inRings(p, read.rings));
  }

  // ── Segments ──────────────────────────────────────────────────────────

  function cross(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  /**
   * Where segment a–b meets segment c–d: { t, u } (fractions along each), or
   * null. Touching counts; overlapping collinear segments meet at the first
   * shared point along a–b.
   */
  function meet(a, b, c, d) {
    var rx = b[0] - a[0];
    var ry = b[1] - a[1];
    var sx = d[0] - c[0];
    var sy = d[1] - c[1];
    var den = cross(rx, ry, sx, sy);
    var qx = c[0] - a[0];
    var qy = c[1] - a[1];
    var eps = 1e-9;
    if (Math.abs(den) < eps) {
      if (Math.abs(cross(qx, qy, rx, ry)) > eps) return null; // parallel
      var rr = rx * rx + ry * ry;
      if (rr < eps) return null;
      var t0 = (qx * rx + qy * ry) / rr;
      var t1 = t0 + (sx * rx + sy * ry) / rr;
      var lo = Math.max(0, Math.min(t0, t1));
      var hi = Math.min(1, Math.max(t0, t1));
      if (lo > hi + eps) return null;
      return { t: lo, u: null };
    }
    var t = cross(qx, qy, sx, sy) / den;
    var u = cross(qx, qy, rx, ry) / den;
    if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
    return { t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)) };
  }

  /** The distance from point p to segment a–b. */
  function distanceToSegment(p, a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len = dx * dx + dy * dy;
    var t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    var x = a[0] + t * dx - p[0];
    var y = a[1] + t * dy - p[1];
    return Math.sqrt(x * x + y * y);
  }

  // A ring's or a line's segments.
  function segmentsOf(points, closed) {
    var out = [];
    var n = points.length;
    for (var i = 0; i < (closed ? n : n - 1); i++) out.push([points[i], points[(i + 1) % n]]);
    return out;
  }

  // Where on a straight run a–b a door's segment lies: [t0, t1], or null.
  function along(a, b, from, to, eps) {
    if (distanceToSegment(from, a, b) > eps || distanceToSegment(to, a, b) > eps) return null;
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len = dx * dx + dy * dy;
    if (!len) return null;
    var t0 = ((from[0] - a[0]) * dx + (from[1] - a[1]) * dy) / len;
    var t1 = ((to[0] - a[0]) * dx + (to[1] - a[1]) * dy) / len;
    return [Math.max(0, Math.min(t0, t1)), Math.min(1, Math.max(t0, t1))];
  }

  function lerp(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  // An object's footprint: its rectangle turned about its centre.
  function objectRing(item) {
    var at = pointOf(item.at);
    var size = sizeOf(item.size);
    if (!at || !size) return null;
    var hw = size[0] / 2;
    var hh = size[1] / 2;
    var turn = num(item.turn) ? (item.turn * Math.PI) / 180 : 0;
    var cos = Math.cos(turn);
    var sin = Math.sin(turn);
    return [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ].map(function (c) {
      return [at[0] + c[0] * cos - c[1] * sin, at[1] + c[0] * sin + c[1] * cos];
    });
  }

  function sizeOf(size) {
    if (num(size) && size > 0) return [size, size];
    var p = pointOf(size);
    if (p && p[0] > 0 && p[1] > 0) return p;
    if (isObject(size) && num(size.w) && num(size.h) && size.w > 0 && size.h > 0) {
      return [size.w, size.h];
    }
    return null;
  }

  // ── Bounds and tolerance ─────────────────────────────────────────────

  /**
   * A map's bounds in its geometry's units: a grid (a battle map, or a grid
   * map's space) its squares at 5 ft; a region or area map its space. Null
   * when it has none.
   */
  function boundsOf(map) {
    if (!isObject(map)) return null;
    var space = isObject(map.space) ? map.space : null;
    var grid = map.kind === 'grid' || (!space && !map.kind);
    var w = space ? space.width : map.width;
    var h = space ? space.height : map.height;
    if (!num(w) || !num(h) || w <= 0 || h <= 0) return null;
    return grid
      ? { width: w * FEET_PER_SQUARE, height: h * FEET_PER_SQUARE }
      : { width: w, height: h };
  }

  function toleranceFor(bounds) {
    var side = bounds ? Math.max(bounds.width, bounds.height) : 0;
    return Math.max(0.01, side * 1e-5);
  }

  // ── Compiling ─────────────────────────────────────────────────────────

  function listOf(geometry, key) {
    return isObject(geometry) && Array.isArray(geometry[key]) ? geometry[key] : [];
  }

  function materialInfo(key, material) {
    var set = MATERIALS[MATERIAL_OF[key]];
    return set && has(set, material) ? set[material] : null;
  }

  function wallFlags(item) {
    var info = materialInfo('walls', item.material) || {};
    return {
      blocksMove: item.blocksMove !== false,
      blocksSight: typeof item.blocksSight === 'boolean' ? item.blocksSight : !info.seeThrough,
    };
  }

  function seeThrough(key, item) {
    if (typeof item.seeThrough === 'boolean') return item.seeThrough;
    return Boolean((materialInfo(key, item.material) || {}).seeThrough);
  }

  // A door's or window's place in the walls: the wall's id and its run, or null.
  function hostOf(walls, item, eps) {
    var from = pointOf(item.from);
    var to = pointOf(item.to);
    if (!from || !to) return null;
    for (var w = 0; w < walls.length; w++) {
      var wall = walls[w];
      if (item.wall && wall.item.id !== item.wall) continue;
      for (var l = 0; l < wall.lines.length; l++) {
        var segs = segmentsOf(wall.lines[l], false);
        for (var s = 0; s < segs.length; s++) {
          var span = along(segs[s][0], segs[s][1], from, to, eps);
          if (span) return { wall: wall, line: l, seg: s, span: span };
        }
      }
    }
    return null;
  }

  /**
   * The geometry read for the rules (cached per geometry object): its shapes
   * as polygons and lines, and its walls cut where doors and windows stand.
   * Items whose shapes don't read are left out; `check` says why.
   */
  function compile(geometry) {
    if (compiled && isObject(geometry) && compiled.has(geometry)) return compiled.get(geometry);
    var out = {
      ground: [],
      lines: [],
      walls: [],
      openings: [],
      objects: [],
      zones: [],
      spawns: [],
      lights: [],
      notes: [],
      hidden: {},
      byId: {},
    };
    var eps = 0.01;
    LISTS.forEach(function (key) {
      listOf(geometry, key).forEach(function (item) {
        if (!isObject(item) && key !== 'hidden') return;
        if (key === 'hidden') {
          var entry = typeof item === 'string' ? { id: item } : item;
          if (isObject(entry) && entry.id) out.hidden[entry.id] = entry;
          return;
        }
        if (item.id) out.byId[item.id] = { list: key, item: item };
        if (key === 'walls' || key === 'lines') {
          var read = linesOf(item.points);
          if (read.lines) out[key].push({ item: item, lines: read.lines });
        } else if (key === 'doors' || key === 'windows') {
          out.openings.push({ kind: key === 'doors' ? 'door' : 'window', item: item });
        } else if (key === 'objects') {
          var ring = objectRing(item);
          if (ring) out.objects.push({ item: item, rings: [ring] });
        } else {
          var shape = item.shape;
          var at = pointOf(item.at);
          if (shape !== undefined) {
            var rings = ringsOf(shape);
            if (rings.rings) out[key].push({ item: item, rings: rings.rings, at: at });
          } else if (at) {
            out[key].push({ item: item, rings: null, at: at });
          }
        }
      });
    });
    // Each wall's runs, less the stretches its doors and windows take.
    var cuts = {};
    out.openings.forEach(function (o) {
      var host = hostOf(out.walls, o.item, eps);
      o.from = pointOf(o.item.from);
      o.to = pointOf(o.item.to);
      if (!host) return;
      o.wall = host.wall.item.id;
      var key = host.wall.item.id + '|' + host.line + '|' + host.seg;
      (cuts[key] = cuts[key] || []).push(host.span);
    });
    out.edges = [];
    out.walls.forEach(function (w) {
      var flags = wallFlags(w.item);
      w.lines.forEach(function (line, l) {
        segmentsOf(line, false).forEach(function (seg, s) {
          var spans = (cuts[w.item.id + '|' + l + '|' + s] || []).slice().sort(function (p, q) {
            return p[0] - q[0];
          });
          var t = 0;
          spans.concat([[1, 1]]).forEach(function (span) {
            if (span[0] > t + 1e-9) {
              out.edges.push({
                a: lerp(seg[0], seg[1], t),
                b: lerp(seg[0], seg[1], span[0]),
                kind: 'wall',
                id: w.item.id,
                item: w.item,
                blocksMove: flags.blocksMove,
                blocksSight: flags.blocksSight,
              });
            }
            t = Math.max(t, span[1]);
          });
        });
      });
    });
    if (compiled && isObject(geometry)) compiled.set(geometry, out);
    return out;
  }

  /**
   * The walls, doors and windows as edges, with whether each blocks movement
   * and sight: doors by their state (`states[id]`, a save's, over the
   * geometry's), windows never walked through.
   */
  function edges(c, states) {
    var list = c.edges.slice();
    c.openings.forEach(function (o) {
      if (!o.from || !o.to) return;
      var stored = o.item.state || 'closed';
      var state = states && has(states, o.item.id) ? states[o.item.id] : stored;
      var open = state === 'open';
      var see = seeThrough(o.kind === 'door' ? 'doors' : 'windows', o.item);
      list.push({
        a: o.from,
        b: o.to,
        kind: o.kind,
        id: o.item.id,
        item: o.item,
        state: state,
        blocksMove: o.kind === 'window' ? true : !open,
        blocksSight: !(open || see),
      });
    });
    return list;
  }

  function wants(edge, opts) {
    if (opts && opts.move) return edge.blocksMove;
    if (opts && opts.sight) return edge.blocksSight;
    return true;
  }

  /**
   * The edges segment a–b crosses or touches, nearest first: [{ id, kind,
   * t, point }]. `opts.move` or `opts.sight` keeps only those blocking it;
   * `opts.states` a save's doors.
   */
  function hits(c, a, b, opts) {
    var p = pointOf(a);
    var q = pointOf(b);
    if (!p || !q) return [];
    var out = [];
    edges(c, opts && opts.states).forEach(function (e) {
      if (!wants(e, opts)) return;
      var m = meet(p, q, e.a, e.b);
      if (m) out.push({ id: e.id, kind: e.kind, t: m.t, point: lerp(p, q, m.t) });
    });
    return out.sort(function (x, y) {
      return x.t - y.t || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    });
  }

  function ringDistance(p, rings) {
    if (inRings(p, rings)) return 0;
    var best = Infinity;
    rings.forEach(function (ring) {
      segmentsOf(ring, true).forEach(function (s) {
        best = Math.min(best, distanceToSegment(p, s[0], s[1]));
      });
    });
    return best;
  }

  /**
   * How far point p lies from the nearest thing blocking movement: walls,
   * closed doors, windows, objects that block, ground that can't be crossed
   * and, given `opts.bounds`, the map's edge. 0 inside something solid.
   */
  function clearance(c, point, opts) {
    var p = pointOf(point);
    if (!p) return 0;
    var best = Infinity;
    edges(c, opts && opts.states).forEach(function (e) {
      if (e.blocksMove) best = Math.min(best, distanceToSegment(p, e.a, e.b));
    });
    c.objects.forEach(function (o) {
      if (o.item.blocksMove !== false) best = Math.min(best, ringDistance(p, o.rings));
    });
    c.ground.forEach(function (g) {
      if (g.item.cost === 'never') best = Math.min(best, ringDistance(p, g.rings));
    });
    var bounds = opts && opts.bounds;
    if (bounds) {
      var inside = p[0] >= 0 && p[1] >= 0 && p[0] <= bounds.width && p[1] <= bounds.height;
      best = inside ? Math.min(best, p[0], p[1], bounds.width - p[0], bounds.height - p[1]) : 0;
    }
    return best;
  }

  /** Whether something `width` across stands at p clear of everything blocking. */
  function fits(c, point, width, opts) {
    return clearance(c, point, opts) >= width / 2 - 1e-9;
  }

  /** The ground under a point (the last one laid that holds it), or null. */
  function groundAt(c, point) {
    var p = pointOf(point);
    if (!p) return null;
    for (var i = c.ground.length - 1; i >= 0; i--) {
      if (inRings(p, c.ground[i].rings)) return c.ground[i].item;
    }
    return null;
  }

  /** The zones holding a point. */
  function zonesAt(c, point) {
    var p = pointOf(point);
    if (!p) return [];
    return c.zones
      .filter(function (z) {
        return inRings(p, z.rings);
      })
      .map(function (z) {
        return z.item;
      });
  }

  // ── Checks ────────────────────────────────────────────────────────────

  function selfCrossing(ring) {
    var segs = segmentsOf(ring, true);
    var n = segs.length;
    for (var i = 0; i < n; i++) {
      for (var j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // neighbours round the end
        if (meet(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) return true;
      }
    }
    return false;
  }

  function outside(p, bounds, eps) {
    return (
      bounds &&
      (p[0] < -eps || p[1] < -eps || p[0] > bounds.width + eps || p[1] > bounds.height + eps)
    );
  }

  /**
   * Reasons a map's geometry won't do, each naming the item ("walls.w2 …"),
   * or [] if it's sound: shapes that don't read, open or crossed polygons,
   * unknown materials, doors and windows off their walls, anything outside
   * `bounds` (in the geometry's units), ids missing or used twice, hidden ids
   * naming nothing.
   */
  function check(geometry, bounds) {
    var problems = [];
    if (geometry === undefined || geometry === null) return problems;
    if (!isObject(geometry)) return ['The geometry must be an object of lists.'];
    var eps = toleranceFor(bounds);
    var ids = {};
    var total = 0;
    Object.keys(geometry).forEach(function (key) {
      if (LISTS.indexOf(key) === -1) {
        problems.push('"' + key + '" is no part of a map’s geometry (' + LISTS.join(', ') + ').');
      } else if (!Array.isArray(geometry[key])) {
        problems.push(key + ' must be a list.');
      } else if (geometry[key].length > MAX_ITEMS) {
        problems.push(key + ' has more than ' + MAX_ITEMS + '.');
      }
    });
    if (problems.length) return problems;

    function countPoints(name, n) {
      total += n;
      if (n > MAX_POINTS) problems.push(name + ' has more than ' + MAX_POINTS + ' points.');
    }
    function inBounds(name, points) {
      for (var i = 0; i < points.length; i++) {
        if (outside(points[i], bounds, eps)) {
          problems.push(
            name + ' runs outside the map (' + fmt(points[i][0]) + ', ' + fmt(points[i][1]) + ').'
          );
          return;
        }
      }
    }
    function area(name, shape) {
      var read = ringsOf(shape);
      if (read.error) {
        problems.push(name + ' ' + read.error + '.');
        return null;
      }
      var n = 0;
      read.rings.forEach(function (ring) {
        n += ring.length;
      });
      countPoints(name, n);
      read.rings.forEach(function (ring) {
        if (ring.length < 3)
          problems.push(name + ' is an open polygon: it needs 3 corners or more.');
        else if (Math.abs(ringArea(ring)) < 1e-9) problems.push(name + ' has no area.');
        else if (ring.length <= MAX_POINTS && selfCrossing(ring))
          problems.push(name + ' crosses itself.');
        inBounds(name, ring);
      });
      return read.rings;
    }
    function line(name, points) {
      var read = linesOf(points);
      if (read.error) {
        problems.push(name + ' ' + read.error + '.');
        return null;
      }
      var n = 0;
      read.lines.forEach(function (l) {
        n += l.length;
        if (l.length < 2) problems.push(name + ' needs 2 points or more.');
        else if (
          segmentsOf(l, false).every(function (s) {
            return same(s[0], s[1], 1e-9);
          })
        ) {
          problems.push(name + ' has no length.');
        }
        inBounds(name, l);
      });
      countPoints(name, n);
      return read.lines;
    }
    function material(key, name, item) {
      if (typeof item.material !== 'string' || !item.material) {
        problems.push(name + ' needs a material.');
      } else if (!materialInfo(key, item.material)) {
        problems.push(
          name +
            ' has an unknown material "' +
            item.material +
            '": the ' +
            MATERIAL_OF[key] +
            ' materials are ' +
            Object.keys(MATERIALS[MATERIAL_OF[key]]).join(', ') +
            '.'
        );
      }
    }
    function height(name, v, min) {
      if (v !== undefined && (!num(v) || (min !== null && v < min))) {
        problems.push(
          name +
            ' has a height that isn’t a number' +
            (min === null ? '' : ' of ' + min + ' or more') +
            '.'
        );
      }
    }
    function at(name, v) {
      var p = pointOf(v);
      if (!p) problems.push(name + ' needs `at`, a point [x, y].');
      else if (outside(p, bounds, eps)) problems.push(name + ' is outside the map.');
      return p;
    }

    LISTS.forEach(function (key) {
      (geometry[key] || []).forEach(function (raw, i) {
        if (key === 'hidden') return;
        var name = key + '[' + i + ']';
        if (!isObject(raw)) {
          problems.push(name + ' must be an object.');
          return;
        }
        if (raw.id !== undefined) {
          if (typeof raw.id !== 'string' || !ID.test(raw.id)) {
            problems.push(name + ' has an id that isn’t letters, digits, - and _ (60 at most).');
          } else if (has(ids, raw.id)) {
            problems.push(key + '.' + raw.id + ' uses an id ' + ids[raw.id] + ' has.');
          } else {
            ids[raw.id] = key + '.' + raw.id;
            name = key + '.' + raw.id;
          }
        }
        if (key === 'ground') {
          material(key, name, raw);
          area(name, raw.shape);
          height(name, raw.height, null);
          if (raw.cost !== undefined && raw.cost !== 'never' && !(num(raw.cost) && raw.cost >= 1)) {
            problems.push(name + ' has a cost that isn’t 1 or more, or "never".');
          }
          if (raw.depth !== undefined) {
            if (!num(raw.depth) || raw.depth < 0) problems.push(name + ' has a depth below 0.');
            else if (!(materialInfo(key, raw.material) || {}).water) {
              problems.push(name + ' has a depth but isn’t water.');
            }
          }
        } else if (key === 'lines') {
          material(key, name, raw);
          line(name, raw.points);
          if (raw.width !== undefined && !(num(raw.width) && raw.width > 0)) {
            problems.push(name + ' has a width that isn’t above 0.');
          }
        } else if (key === 'walls') {
          material(key, name, raw);
          line(name, raw.points);
          height(name, raw.height, 0);
          ['blocksMove', 'blocksSight'].forEach(function (f) {
            if (raw[f] !== undefined && typeof raw[f] !== 'boolean') {
              problems.push(name + '.' + f + ' must be true or false.');
            }
          });
        } else if (key === 'doors' || key === 'windows') {
          material(key, name, raw);
          var from = pointOf(raw.from);
          var to = pointOf(raw.to);
          if (!from || !to) problems.push(name + ' needs `from` and `to`, points [x, y].');
          else if (same(from, to, 1e-9)) problems.push(name + ' has no length.');
          var states = key === 'doors' ? DOOR_STATES : WINDOW_STATES;
          if (raw.state !== undefined && states.indexOf(raw.state) === -1) {
            problems.push(name + ' has a state that isn’t ' + states.join(', ') + '.');
          }
          if (raw.seeThrough !== undefined && typeof raw.seeThrough !== 'boolean') {
            problems.push(name + '.seeThrough must be true or false.');
          }
          if (key === 'doors' && raw.unlocks !== undefined) {
            var u = raw.unlocks;
            var ok =
              isObject(u) &&
              (typeof u.key === 'string' || typeof u.action === 'string') &&
              Object.keys(u).every(function (k) {
                return (k === 'key' || k === 'action') && typeof u[k] === 'string' && u[k];
              });
            if (!ok) problems.push(name + '.unlocks must be { key } or { action }, or both.');
          }
        } else if (key === 'objects') {
          if (typeof raw.kind !== 'string' || !ID.test(raw.kind)) {
            problems.push(name + ' needs a kind (from the catalog, or the world’s own).');
          }
          at(name, raw.at);
          if (!sizeOf(raw.size))
            problems.push(name + ' needs a size above 0: [w, h] or one number.');
          if (raw.turn !== undefined && !num(raw.turn))
            problems.push(name + ' has a turn that isn’t degrees.');
          height(name, raw.height, 0);
          var ring = objectRing(raw);
          if (ring && pointOf(raw.at) && !outside(pointOf(raw.at), bounds, eps)) {
            inBounds(name, ring);
          }
        } else if (key === 'zones') {
          if (raw.name !== undefined && typeof raw.name !== 'string')
            problems.push(name + ' has a name that isn’t text.');
          area(name, raw.shape);
        } else if (key === 'spawns' || key === 'notes') {
          if ((raw.at !== undefined) === (raw.shape !== undefined) && key === 'spawns') {
            problems.push(name + ' needs `at` (a point) or `shape` (an area), one of them.');
          } else if (raw.at !== undefined && raw.shape !== undefined) {
            problems.push(name + ' takes `at` or `shape`, not both.');
          } else if (raw.at !== undefined) at(name, raw.at);
          else if (raw.shape !== undefined) area(name, raw.shape);
          if (key === 'spawns' && raw.count !== undefined) {
            if (
              !(
                num(raw.count) &&
                Math.floor(raw.count) === raw.count &&
                raw.count >= 1 &&
                raw.count <= 50
              )
            ) {
              problems.push(name + ' has a count that isn’t a whole number from 1 to 50.');
            }
          }
          if (key === 'notes' && (typeof raw.text !== 'string' || !raw.text.trim())) {
            problems.push(name + ' needs its text.');
          }
        } else if (key === 'lights') {
          if (raw.dark === true) {
            if (raw.shape === undefined) problems.push(name + ' is dark and needs its shape.');
            else area(name, raw.shape);
          } else {
            at(name, raw.at);
            if (!(num(raw.radius) && raw.radius > 0))
              problems.push(name + ' needs a radius above 0.');
            if (raw.dim !== undefined && !(num(raw.dim) && raw.dim >= 0)) {
              problems.push(name + ' has a dim radius below 0.');
            }
          }
        }
      });
    });
    if (total > MAX_TOTAL) problems.push('The geometry has more than ' + MAX_TOTAL + ' points.');

    // Doors and windows lie in their walls, and not over each other.
    var c = compile(geometry);
    var tol = Math.max(eps, 0.01);
    var taken = [];
    c.openings.forEach(function (o, i) {
      var name = (o.kind === 'door' ? 'doors' : 'windows') + '.' + (o.item.id || i);
      if (!o.from || !o.to || same(o.from, o.to, 1e-9)) return;
      if (
        o.item.wall !== undefined &&
        !c.walls.some(function (w) {
          return w.item.id === o.item.wall;
        })
      ) {
        problems.push(name + ' names a wall "' + o.item.wall + '" there isn’t.');
        return;
      }
      var host = hostOf(c.walls, o.item, tol);
      if (!host) {
        problems.push(
          name +
            ' isn’t in a wall' +
            (o.item.wall ? ' ' + o.item.wall : '') +
            ': both its ends must lie on one straight run of it.'
        );
        return;
      }
      var key = host.wall.item.id + '|' + host.line + '|' + host.seg;
      taken.forEach(function (t) {
        if (t.key === key && t.span[0] < host.span[1] - 1e-9 && host.span[0] < t.span[1] - 1e-9) {
          problems.push(name + ' overlaps ' + t.name + '.');
        }
      });
      taken.push({ key: key, span: host.span, name: name });
    });

    // Hidden things name things there are, once each.
    var seen = {};
    (geometry.hidden || []).forEach(function (h, i) {
      var entry = typeof h === 'string' ? { id: h } : h;
      if (!isObject(entry) || typeof entry.id !== 'string') {
        problems.push('hidden[' + i + '] must be an id or { id, dc }.');
        return;
      }
      if (!has(ids, entry.id))
        problems.push('hidden names "' + entry.id + '", which isn’t in the geometry.');
      else if (has(seen, entry.id)) problems.push('hidden names "' + entry.id + '" twice.');
      seen[entry.id] = true;
      if (entry.dc !== undefined && !(num(entry.dc) && entry.dc >= 0)) {
        problems.push('hidden.' + entry.id + ' has a dc that isn’t a number.');
      }
    });
    return problems;
  }

  // ── Storing ───────────────────────────────────────────────────────────

  function pathData(lines, closed) {
    return lines
      .map(function (l) {
        var pts = closed ? openRing(l) : l;
        return (
          pts
            .map(function (p, i) {
              return (i ? 'L' : 'M') + fmt(p[0]) + ' ' + fmt(p[1]);
            })
            .join('') + (closed ? 'Z' : '')
        );
      })
      .join('');
  }

  function storedShape(shape) {
    if (Array.isArray(shape)) {
      var list = pointList(shape);
      return list ? pathData([list], true) : shape;
    }
    return shape;
  }

  function storedLine(points) {
    if (Array.isArray(points)) {
      var list = pointList(points);
      return list ? pathData([list], false) : points;
    }
    return points;
  }

  function storedPoint(v) {
    var p = pointOf(v);
    return p ? p : v;
  }

  /**
   * The geometry as it's stored (Firestore keeps no arrays of arrays): lists
   * of points as path data, points as [x, y], sizes as [w, h], hidden ids as
   * { id }, and an id for every item without one (`wall-3`). Empty lists are
   * dropped. Check it first: what doesn't read is passed as it is.
   */
  function normalize(geometry) {
    var out = {};
    if (!isObject(geometry)) return out;
    var used = {};
    LISTS.forEach(function (key) {
      (geometry[key] || []).forEach(function (item) {
        if (isObject(item) && typeof item.id === 'string') used[item.id] = true;
      });
    });
    var counter = {};
    function freshId(key) {
      var stem = key === 'ground' ? 'ground' : key.replace(/s$/, '');
      var n = counter[stem] || 1;
      while (used[stem + '-' + n]) n++;
      counter[stem] = n + 1;
      used[stem + '-' + n] = true;
      return stem + '-' + n;
    }
    LISTS.forEach(function (key) {
      var list = geometry[key];
      if (!Array.isArray(list) || !list.length) return;
      out[key] = list.map(function (raw) {
        if (key === 'hidden') return typeof raw === 'string' ? { id: raw } : Object.assign({}, raw);
        var item = {};
        Object.keys(raw).forEach(function (k) {
          if (raw[k] !== undefined) item[k] = raw[k];
        });
        if (typeof item.id !== 'string') item.id = freshId(key);
        if (has(item, 'shape')) item.shape = storedShape(item.shape);
        if (has(item, 'points')) item.points = storedLine(item.points);
        ['at', 'from', 'to'].forEach(function (k) {
          if (has(item, k)) item[k] = storedPoint(item[k]);
        });
        if (key === 'objects' && has(item, 'size')) item.size = sizeOf(item.size) || item.size;
        return item;
      });
    });
    return out;
  }

  /**
   * A battle map's layers from before (layers.js: walls along grid lines,
   * doors one square long, obstacles by the square) read as geometry in
   * feet (L-922; stored for good by L-928, ./layer-geometry.js): its walls
   * as walls; each door in a short wall of its own, which it replaces,
   * keeping its id, name, key, own AP, long action and lock's difficulty;
   * solid obstacles as tall objects over their squares (pillars, seen
   * themselves and hiding what's behind them, L-923); low ones as closed
   * walls round their squares, 3 ft high and not blocking sight; and
   * difficult squares as gravel costing 2.
   */
  function fromLayers(map) {
    var F = FEET_PER_SQUARE;
    var pt = function (c) {
      return [c.x * F, c.y * F];
    };
    var out = { ground: [], walls: [], doors: [], objects: [] };
    if (!isObject(map)) return out;
    (map.walls || []).forEach(function (wall, i) {
      var points = ((wall && wall.points) || []).filter(function (p) {
        return pointOf(p);
      });
      if (points.length >= 2) {
        out.walls.push({ id: 'layer-wall-' + i, material: 'stone', points: points.map(pt) });
      }
    });
    (map.doors || []).forEach(function (door, i) {
      if (!door || !pointOf(door.from) || !pointOf(door.to)) return;
      var id = door.id || 'layer-door-' + i;
      out.walls.push({
        id: 'layer-doorway-' + id,
        material: 'stone',
        points: [pt(door.from), pt(door.to)],
      });
      var item = {
        id: id,
        material: 'wood',
        from: pt(door.from),
        to: pt(door.to),
        wall: 'layer-doorway-' + id,
        state: door.locked ? 'locked' : 'closed',
      };
      if (door.name) item.name = door.name;
      if (door.key) item.unlocks = { key: door.key };
      if (num(door.ap)) item.ap = door.ap;
      // Picking or forcing it (L-833, L-928): kept for the rules that read them.
      if (isObject(door.long)) item.long = door.long;
      if (num(door.difficulty)) item.difficulty = door.difficulty;
      out.doors.push(item);
    });
    (map.obstacles || []).forEach(function (o, i) {
      if (!o || !num(o.x) || !num(o.y)) return;
      var w = (o.w || 1) * F;
      var h = (o.h || 1) * F;
      var x = o.x * F;
      var y = o.y * F;
      var id = 'layer-' + (o.id || 'obstacle-' + i);
      if (o.kind === 'difficult') {
        out.ground.push({
          id: id,
          material: 'gravel',
          cost: 2,
          shape: { rect: { x: x, y: y, w: w, h: h } },
        });
      } else if (o.kind === 'solid') {
        var pillar = {
          id: id,
          kind: 'pillar',
          at: [x + w / 2, y + h / 2],
          size: [w, h],
          blocksSight: true,
        };
        if (o.name) pillar.name = o.name;
        out.objects.push(pillar);
      } else if (o.kind === 'low') {
        var ring = {
          id: id,
          material: 'stone',
          points: [
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
            [x, y],
          ],
        };
        ring.blocksSight = false;
        ring.height = 3;
        out.walls.push(ring);
      }
    });
    return out;
  }

  /** Whether a map has any geometry at all. */
  function hasGeometry(geometry) {
    return (
      isObject(geometry) &&
      LISTS.some(function (key) {
        return Array.isArray(geometry[key]) && geometry[key].length > 0;
      })
    );
  }

  var api = {
    FEET_PER_SQUARE: FEET_PER_SQUARE,
    LISTS: LISTS,
    MATERIALS: MATERIALS,
    DOOR_STATES: DOOR_STATES,
    WINDOW_STATES: WINDOW_STATES,
    parsePath: parsePath,
    ringsOf: ringsOf,
    linesOf: linesOf,
    pointInShape: pointInShape,
    meet: meet,
    distanceToSegment: distanceToSegment,
    boundsOf: boundsOf,
    compile: compile,
    edges: edges,
    hits: hits,
    clearance: clearance,
    fits: fits,
    groundAt: groundAt,
    zonesAt: zonesAt,
    check: check,
    normalize: normalize,
    hasGeometry: hasGeometry,
    fromLayers: fromLayers,
  };

  if (typeof window !== 'undefined') {
    window.Loom = window.Loom || {};
    window.Loom.mapGeometry = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
