/* global module */
(function () {
  'use strict';

  // Pan-and-zoom maths for the Loom's world map (planning/the-loom-layered-
  // worlds.md §7; L-332 / #394). Pure functions, so they are unit-tested
  // (tests/loom-map-math.test.js) and shared by the view (map.js).
  //
  // A view is { scale, x, y }: a map point (mx, my), in the world's own
  // coordinates (the Azgaar map's width × height), appears on screen at
  //   sx = mx * scale + x,   sy = my * scale + y
  // relative to the top-left of the map panel.

  var MAX_SCALE = 6;
  var FOCUS_SPAN = 110; // at least this many map units across the panel
  var MIN_SPREAD = 30; // px: a pinch is based on fingers at least this far apart
  var JUMP = 90; // px: further than a finger moves between two events

  function toScreen(view, mx, my) {
    return { x: mx * view.scale + view.x, y: my * view.scale + view.y };
  }

  function toMap(view, sx, sy) {
    return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
  }

  // The smallest scale: the whole map fits the panel.
  function minScale(panel, map) {
    return Math.min(panel.width / map.width, panel.height / map.height);
  }

  // Keeps the map covering the panel where it can, and centred where it
  // is smaller than the panel.
  function clamp(view, panel, map) {
    var scale = Math.max(minScale(panel, map), Math.min(MAX_SCALE, view.scale));
    var w = map.width * scale;
    var h = map.height * scale;
    var x =
      w <= panel.width ? (panel.width - w) / 2 : Math.min(0, Math.max(panel.width - w, view.x));
    var y =
      h <= panel.height ? (panel.height - h) / 2 : Math.min(0, Math.max(panel.height - h, view.y));
    return { scale: scale, x: x, y: y };
  }

  // Frames a set of map points (for example, the discovered places), with
  // padding, centred on `focus` if given (where the player stands).
  function fit(points, panel, map, focus) {
    var xs = points.map(function (p) {
      return p.x;
    });
    var ys = points.map(function (p) {
      return p.y;
    });
    var span = Math.max(
      FOCUS_SPAN,
      xs.length ? Math.max.apply(null, xs) - Math.min.apply(null, xs) : 0,
      ys.length ? Math.max.apply(null, ys) - Math.min.apply(null, ys) : 0
    );
    var scale = Math.min(panel.width, panel.height) / (span * 1.25);
    var centre = focus || {
      x: xs.length ? (Math.max.apply(null, xs) + Math.min.apply(null, xs)) / 2 : map.width / 2,
      y: ys.length ? (Math.max.apply(null, ys) + Math.min.apply(null, ys)) / 2 : map.height / 2,
    };
    return clamp(
      {
        scale: scale,
        x: panel.width / 2 - centre.x * scale,
        y: panel.height / 2 - centre.y * scale,
      },
      panel,
      map
    );
  }

  // Zooms by `factor` about a screen point, which stays put.
  function zoomAt(view, factor, sx, sy, panel, map) {
    var anchor = toMap(view, sx, sy);
    var scale = view.scale * factor;
    return clamp({ scale: scale, x: sx - anchor.x * scale, y: sy - anchor.y * scale }, panel, map);
  }

  // A pinch, worked out from where it started (#420): the map point that was
  // under the fingers' midpoint when the pinch began stays under their
  // midpoint now, at the scale their spread gives. Computing each step from
  // the start, not from the last step, means nothing drifts or builds up, and
  // moving both fingers together pans. `start` and `now` are
  // { mid: { x, y }, distance }, in panel pixels.
  function pinch(startView, start, now, panel, map) {
    if (!(start.distance > 0) || !(now.distance > 0)) return clamp(startView, panel, map);
    var anchor = toMap(startView, start.mid.x, start.mid.y);
    var scale = startView.scale * (now.distance / start.distance);
    return clamp(
      { scale: scale, x: now.mid.x - anchor.x * scale, y: now.mid.y - anchor.y * scale },
      panel,
      map
    );
  }

  // Two fingers' midpoint and how far apart they are.
  function spreadOf(points) {
    return {
      mid: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
      distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
    };
  }

  // One step of a two-finger pinch (#420), robust to points a browser reports
  // wrongly. `track` is null when the pinch begins, then what this returns.
  // The pinch is based on the fingers' first move, not where they were said
  // to touch down; it waits until they are at least MIN_SPREAD apart (a tiny
  // base turns any spread into a huge zoom); and if either finger jumps
  // further than JUMP in one step, which no finger does, the point was
  // misreported, so the pinch starts again from there. Returns
  // { track, view, based } (`based` when the pinch was (re)based this step).
  function pinchMove(track, points, view, panel, map) {
    var now = spreadOf(points);
    var jumped =
      track &&
      (Math.hypot(points[0].x - track.last[0].x, points[0].y - track.last[0].y) > JUMP ||
        Math.hypot(points[1].x - track.last[1].x, points[1].y - track.last[1].y) > JUMP);
    var last = [
      { x: points[0].x, y: points[0].y },
      { x: points[1].x, y: points[1].y },
    ];
    if (!track || jumped || track.start.distance < MIN_SPREAD) {
      return { track: { startView: view, start: now, last: last }, view: view, based: true };
    }
    return {
      track: { startView: track.startView, start: track.start, last: last },
      view: pinch(track.startView, track.start, now, panel, map),
      based: false,
    };
  }

  function pan(view, dx, dy, panel, map) {
    return clamp({ scale: view.scale, x: view.x + dx, y: view.y + dy }, panel, map);
  }

  // Keeps `point` on screen, moving the view as little as possible.
  function reveal(view, point, panel, map, margin) {
    var m = margin === undefined ? 40 : margin;
    var s = toScreen(view, point.x, point.y);
    var dx = s.x < m ? m - s.x : s.x > panel.width - m ? panel.width - m - s.x : 0;
    var dy = s.y < m ? m - s.y : s.y > panel.height - m ? panel.height - m - s.y : 0;
    return pan(view, dx, dy, panel, map);
  }

  var api = {
    MAX_SCALE: MAX_SCALE,
    toScreen: toScreen,
    toMap: toMap,
    minScale: minScale,
    clamp: clamp,
    fit: fit,
    zoomAt: zoomAt,
    pinch: pinch,
    pinchMove: pinchMove,
    spreadOf: spreadOf,
    MIN_SPREAD: MIN_SPREAD,
    JUMP: JUMP,
    pan: pan,
    reveal: reveal,
  };

  if (typeof window !== 'undefined') {
    window.Loom = window.Loom || {};
    window.Loom.mapMath = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
