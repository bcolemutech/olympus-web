/* global module, window, require */
(function () {
  'use strict';

  // A battle map's layers (planning/the-loom-movement-and-vision.md §4;
  // L-621 / #446): walls, doors and obstacles over its grid.
  //
  //   walls:     [{ points: [{ x, y }, …] }]  — lines along the grid lines,
  //              between integer corners (0…width, 0…height), each run
  //              straight across or down; they block movement and sight
  //   doors:     [{ id, name, from: { x, y }, to: { x, y }, locked, key }]
  //              — one square long, on a grid line, in a gap in the walls;
  //              closed to start with; `key` names the inventory item that
  //              opens a locked one
  //   obstacles: [{ id, name, kind, x, y, w, h }] — rectangles of squares
  //              (w and h default to 1): `solid` blocks movement and sight (a
  //              pillar), `low` blocks movement only (a table, the bar, a pit),
  //              `difficult` costs 2 a square (rubble, mud)
  //
  // A map without layers is open ground. Squares are { x, y }; corners are
  // the grid points between them, so square (x, y) runs from corner (x, y) to
  // (x + 1, y + 1), as in SVG art's coordinates.
  //
  // Movement is in feet (L-922): layers are read as geometry
  // (map-geometry.js fromLayers) and moved over by map-paths.js, which also
  // says whether an entry reaches an exit (check).
  //
  // This file is kept in two places with the same bytes, functions/loom-canon/
  // layers.js and public/apps/loom/js/layers.js (the Loom page loads it as
  // Loom.mapLayers, for previews; L-624), and a test fails if they differ:
  // change both.

  var KINDS = ['solid', 'low', 'difficult'];
  var compiled = typeof WeakMap === 'function' ? new WeakMap() : null;

  function whole(n) {
    return typeof n === 'number' && Math.floor(n) === n;
  }

  function cellKey(x, y) {
    return x + ',' + y;
  }

  // Unit edges: across from corner (x, y) to (x + 1, y), or down from (x, y)
  // to (x, y + 1).
  function across(x, y) {
    return 'a' + x + ',' + y;
  }
  function down(x, y) {
    return 'd' + x + ',' + y;
  }

  // The unit edges along a straight run between two corners, or null if the
  // run isn't straight along a grid line (or goes nowhere).
  function edgesOf(a, b) {
    var keys = [];
    var i;
    if (a.y === b.y && a.x !== b.x) {
      for (i = Math.min(a.x, b.x); i < Math.max(a.x, b.x); i++) keys.push(across(i, a.y));
      return keys;
    }
    if (a.x === b.x && a.y !== b.y) {
      for (i = Math.min(a.y, b.y); i < Math.max(a.y, b.y); i++) keys.push(down(a.x, i));
      return keys;
    }
    return null;
  }

  // The corners at the ends of a unit edge.
  function cornersOf(key) {
    var parts = key.slice(1).split(',').map(Number);
    var x = parts[0];
    var y = parts[1];
    return key.charAt(0) === 'a'
      ? [cellKey(x, y), cellKey(x + 1, y)]
      : [cellKey(x, y), cellKey(x, y + 1)];
  }

  /**
   * A map's layers, ready to ask: edges walled, doors by edge, corners a wall
   * or door touches, and obstacles by square. Kept per map object.
   */
  function compile(map) {
    if (compiled && compiled.has(map)) return compiled.get(map);
    var walls = {};
    var doors = {};
    var corners = {};
    var cells = {};
    (map.walls || []).forEach(function (wall) {
      var points = (wall && wall.points) || [];
      for (var i = 1; i < points.length; i++) {
        (edgesOf(points[i - 1], points[i]) || []).forEach(function (key) {
          walls[key] = true;
          cornersOf(key).forEach(function (c) {
            corners[c] = true;
          });
        });
      }
    });
    (map.doors || []).forEach(function (door) {
      var keys = (door && door.from && door.to && edgesOf(door.from, door.to)) || [];
      if (keys.length !== 1) return;
      doors[keys[0]] = door;
      cornersOf(keys[0]).forEach(function (c) {
        corners[c] = true;
      });
    });
    (map.obstacles || []).forEach(function (obstacle) {
      var w = obstacle.w || 1;
      var h = obstacle.h || 1;
      for (var x = obstacle.x; x < obstacle.x + w; x++) {
        for (var y = obstacle.y; y < obstacle.y + h; y++) cells[cellKey(x, y)] = obstacle;
      }
    });
    var layers = { walls: walls, doors: doors, corners: corners, cells: cells };
    if (compiled) compiled.set(map, layers);
    return layers;
  }

  // The edge between two squares side by side.
  function edgeBetween(a, b) {
    if (b.x === a.x + 1) return down(b.x, a.y);
    if (b.x === a.x - 1) return down(a.x, a.y);
    if (b.y === a.y + 1) return across(a.x, b.y);
    return across(a.x, a.y);
  }

  /** The obstacle on a square, or null. */
  function obstacleAt(map, cell) {
    return compile(map).cells[cellKey(cell.x, cell.y)] || null;
  }

  /** A square's ground: 'open', or the kind of obstacle on it. */
  function groundAt(map, cell) {
    var obstacle = obstacleAt(map, cell);
    return obstacle ? obstacle.kind : 'open';
  }

  /**
   * What lies between two neighbouring squares: a wall, and the door on the
   * edge between them (side by side), or, on a diagonal, whether a wall or
   * door touches the corner it squeezes past (`wall: true`).
   */
  function between(map, a, b) {
    var layers = compile(map);
    if (a.x !== b.x && a.y !== b.y) {
      var corner = cellKey(Math.max(a.x, b.x), Math.max(a.y, b.y));
      return { wall: Boolean(layers.corners[corner]), door: null };
    }
    var key = edgeBetween(a, b);
    return { wall: Boolean(layers.walls[key]), door: layers.doors[key] || null };
  }

  // ── Paths (L-624 / #449) ───────────────────────────

  /**
   * A door's state for a save: what the save records (`states`, by door id:
   * 'open', 'closed' or 'locked'), else closed, or locked if the map says so.
   */
  function doorState(door, states) {
    var saved = states && states[door.id];
    return saved || (door.locked ? 'locked' : 'closed');
  }

  // ── Checks ─────────────────────────────────────────

  function where(item) {
    return '(' + item.x + ', ' + item.y + ')';
  }

  function onCorners(map, point) {
    return (
      Boolean(point) &&
      whole(point.x) &&
      whole(point.y) &&
      point.x >= 0 &&
      point.y >= 0 &&
      point.x <= map.width &&
      point.y <= map.height
    );
  }

  // map-paths.js, read when needed (it reads layers through map-geometry.js,
  // and the page loads it after this file).
  function paths() {
    return typeof module === 'object' && module.exports
      ? require('./map-paths')
      : window.Loom.mapPaths;
  }

  // Whether `entry` can walk to an exit (or is one), as a medium character
  // in feet (L-922).
  function reachesExit(map, entry) {
    var reached = paths().squaresReached(map, [entry]);
    return (map.exits || []).some(function (e) {
      return reached[cellKey(e.x, e.y)];
    });
  }

  /**
   * What's wrong with a map's layers, as plain sentences for the builders
   * (none for a map without layers): shapes off the grid or off its lines,
   * doors on walls or sharing an edge, obstacles of no kind or overlapping,
   * an entry or exit covered, and entries that can't reach an exit without
   * passing a locked door.
   */
  function check(map) {
    var problems = [];
    var grid = ' (corners run 0–' + map.width + ' across and 0–' + map.height + ' down)';
    var edges = {};
    (map.walls || []).forEach(function (wall, i) {
      var label = 'Wall ' + (i + 1);
      var points = (wall && wall.points) || [];
      if (points.length < 2) {
        problems.push(label + ' needs at least two points.');
        return;
      }
      if (!points.every(onCorners.bind(null, map))) {
        problems.push(
          label + ': every point must be a whole-number corner on the grid' + grid + '.'
        );
        return;
      }
      for (var j = 1; j < points.length; j++) {
        var keys = edgesOf(points[j - 1], points[j]);
        if (!keys) {
          problems.push(
            label +
              ' must run along the grid lines, straight across or down: from ' +
              where(points[j - 1]) +
              ' to ' +
              where(points[j]) +
              " doesn't."
          );
          return;
        }
        keys.forEach(function (key) {
          edges[key] = true;
        });
      }
    });

    var ids = {};
    var doorAt = {};
    (map.doors || []).forEach(function (door) {
      var label = 'The door "' + door.id + '"';
      if (ids[door.id]) problems.push('Two doors or obstacles are "' + door.id + '".');
      ids[door.id] = true;
      if (!onCorners(map, door.from) || !onCorners(map, door.to)) {
        problems.push(label + ' must run between whole-number corners on the grid' + grid + '.');
        return;
      }
      var keys = edgesOf(door.from, door.to);
      if (!keys || keys.length !== 1) {
        problems.push(label + ' must be one square long, along a grid line.');
        return;
      }
      if (edges[keys[0]]) {
        problems.push(label + ' sits on a wall: leave a gap in the wall for it.');
      }
      if (
        door.difficulty !== undefined &&
        !(whole(door.difficulty) && door.difficulty >= 5 && door.difficulty <= 30)
      ) {
        problems.push(label + "'s lock difficulty must be a whole number from 5 to 30.");
      }
      if (doorAt[keys[0]]) {
        problems.push(
          'The doors "' + doorAt[keys[0]] + '" and "' + door.id + '" are in the same place.'
        );
      }
      doorAt[keys[0]] = door.id;
    });

    var covered = {};
    (map.obstacles || []).forEach(function (obstacle) {
      var label = 'The obstacle "' + obstacle.id + '"';
      if (ids[obstacle.id]) problems.push('Two doors or obstacles are "' + obstacle.id + '".');
      ids[obstacle.id] = true;
      if (KINDS.indexOf(obstacle.kind) === -1) {
        problems.push(label + ' must be solid, low or difficult.');
      }
      var w = obstacle.w === undefined ? 1 : obstacle.w;
      var h = obstacle.h === undefined ? 1 : obstacle.h;
      if (
        ![obstacle.x, obstacle.y, w, h].every(whole) ||
        obstacle.x < 0 ||
        obstacle.y < 0 ||
        w < 1 ||
        h < 1 ||
        obstacle.x + w > map.width ||
        obstacle.y + h > map.height
      ) {
        problems.push(
          label + ' must lie on the ' + map.width + ' × ' + map.height + ' grid, at least a square.'
        );
        return;
      }
      for (var x = obstacle.x; x < obstacle.x + w; x++) {
        for (var y = obstacle.y; y < obstacle.y + h; y++) {
          var key = cellKey(x, y);
          if (covered[key]) {
            problems.push(
              'The obstacles "' +
                covered[key] +
                '" and "' +
                obstacle.id +
                '" overlap at (' +
                key.replace(',', ', ') +
                ').'
            );
          }
          covered[key] = obstacle.id;
        }
      }
    });
    if (problems.length) return problems;

    // Entries and exits stay clear of anything that blocks movement.
    [
      [map.entries || [], 'entry'],
      [map.exits || [], 'exit'],
    ].forEach(function (pair) {
      pair[0].forEach(function (item) {
        var obstacle = obstacleAt(map, item);
        if (obstacle && obstacle.kind !== 'difficult') {
          problems.push(
            'The obstacle "' +
              obstacle.id +
              '" covers the ' +
              pair[1] +
              ' "' +
              item.id +
              '" at ' +
              where(item) +
              '.'
          );
        }
      });
    });
    if (problems.length) return problems;

    // Nobody is stranded: every entry reaches an exit.
    if ((map.exits || []).length) {
      (map.entries || []).forEach(function (entry) {
        if (!reachesExit(map, entry)) {
          problems.push(
            'The entry "' +
              entry.id +
              '" at ' +
              where(entry) +
              " can't reach any exit without passing a locked door or a wall."
          );
        }
      });
    }
    return problems;
  }

  /** Whether a map has any layers at all. */
  function hasLayers(map) {
    return Boolean(
      (map.walls || []).length || (map.doors || []).length || (map.obstacles || []).length
    );
  }

  var api = {
    KINDS: KINDS,
    compile: compile,
    between: between,
    obstacleAt: obstacleAt,
    groundAt: groundAt,
    hasLayers: hasLayers,
    check: check,
    doorState: doorState,
  };

  if (typeof window !== 'undefined') {
    window.Loom = window.Loom || {};
    window.Loom.mapLayers = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
