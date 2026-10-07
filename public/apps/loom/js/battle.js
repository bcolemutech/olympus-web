(function () {
  'use strict';

  // The grid view in the play view (planning/the-loom-layered-worlds.md §9;
  // L-354 / #403): the battle map the player stands on, from loomGetMap's
  // `battleMap`. The map's art (or a plain grid) under its grid, the player's
  // token, its exits and features. Tapping a cell shows a card with the one
  // move it allows: step there, go to a feature, or go out by an exit (which
  // leaves the map). Moves are structured moves on the grid
  // (Loom.play.moveToCell), adjudicated on the server like typed ones.
  //
  // The layers (§4; L-627 / #452): on a plain grid, walls and obstacles are
  // drawn (solid dark, low hatched, difficult dotted); over art, the art shows
  // them. Doors are always marked, by their state for this save (closed amber,
  // open dashed, locked red); tapping one opens a card to open or close it
  // from beside it (Loom.play.doorAction).
  //
  // The fog (planning/the-loom-movement-and-vision.md §5; L-634 / #457), from
  // loomGetMap's `fog` (L-633): squares never seen are dark, those seen before
  // but not in sight now are dimmed, and those in sight are clear. The dark
  // covers the art, the grid and what's on it; the dimming lies over the art
  // but under the grid and the layers, so the layout remembered still reads,
  // with what stands there faded. The token, the way and the names stay on
  // top. Only what the server sent is drawn: it sends nothing unseen.
  //
  // The turn (planning/the-loom-movement-and-vision.md §3; L-615 / #445): the
  // squares in reach of this turn's movement are lit; tapping a square draws
  // the path a move would take (grid-paths.js, the server's own rules), solid
  // for this turn and dashed after, and the card says what it costs and in
  // how many turns; a kept plan is drawn dashed. After a move the token walks
  // its path (a tap skips ahead; reduced motion jumps). Reach and paths cover
  // only squares seen, as on the server (L-635 / #458); a square in the dark
  // says "You haven't seen that."
  //
  // map.js owns the panel, pan and zoom, and switches between this, the town
  // view and the world map; this module draws the map into the panel's SVG
  // overlay in screen space. Map coordinates are CELL units per cell, with
  // room around the grid.

  var Loom = window.Loom;
  var state = Loom.state;
  var M = Loom.mapMath;
  var P = Loom.gridPaths;
  var L = Loom.mapLayers;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var CELL = 40;
  var PAD = 60; // room for the labels of cells at the edge
  var STEP_MS = 110; // the token's walk, a square at a time

  var battle = {
    data: null, // loomGetMap's `battleMap`
    turn: null, // loomGetMap's `turn` (L-611): movement left, the plan
    selected: null, // a cell { x, y }
    selectedDoor: null, // a door's id, when a door is tapped (L-627)
    art: { path: null, url: null },
    reach: null, // this turn's reach: { runs: [{ y, x0, x1 }] }
    fog: null, // the fog (L-634): { dark: runs, dim: runs }, as reach's runs
    known: null, // whether a square (by y × width + x) has been seen (L-635)
    preview: null, // the path to the selected cell: { path, walked, rest, cost, turns } or { none }
    pending: null, // a move sent: { mapId, from, path }, for the walk when it lands
    anim: null, // the token's walk: { cells, t0 }
  };

  // ── Helpers ───────────────────────────────────────

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      node.setAttribute(k, attrs[k]);
    });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function same(a, b) {
    return Boolean(a) && Boolean(b) && a.x === b.x && a.y === b.y;
  }

  // The exit and the feature at a cell, if any.
  function at(cell) {
    var d = battle.data;
    var find = function (list) {
      return (
        list.filter(function (item) {
          return same(item, cell);
        })[0] || null
      );
    };
    return { exit: find(d.exits), feature: find(d.features) };
  }

  // A cell's middle, in map coordinates.
  function centre(cell) {
    return { x: PAD + (cell.x + 0.5) * CELL, y: PAD + (cell.y + 0.5) * CELL };
  }

  // The server's own path rules (layers.js; L-624): around walls, locked
  // doors and obstacles, 2 a square on difficult ground, 1 more to open a
  // closed door (where a walk stops), and exits stepped onto, never through.
  // Doors are as this save has them, and only ground it knows is walked
  // (L-635): what it has seen, as the server does.
  function pathOptions() {
    var states = {};
    (battle.data.doors || []).forEach(function (door) {
      states[door.id] = door.state;
    });
    var rules = L.pathOptions(battle.data, states);
    if (!battle.known) return rules;
    return {
      avoid: rules.avoid,
      opens: rules.opens,
      cost: function (from, to) {
        return known(to) ? rules.cost(from, to) : Infinity;
      },
    };
  }

  // Whether the save has seen a square (L-635): everything, without a fog.
  function known(cell) {
    return !battle.known || battle.known(cell.y * battle.data.width + cell.x);
  }

  function doorById(id) {
    return (
      (battle.data.doors || []).filter(function (d) {
        return d.id === id;
      })[0] || null
    );
  }

  // The two squares a door stands between (as the server's steps.js has it).
  function doorSides(door) {
    if (door.from.x === door.to.x) {
      var y = Math.min(door.from.y, door.to.y);
      return [
        { x: door.from.x - 1, y: y },
        { x: door.from.x, y: y },
      ];
    }
    var x = Math.min(door.from.x, door.to.x);
    return [
      { x: x, y: door.from.y - 1 },
      { x: x, y: door.from.y },
    ];
  }

  function besideDoor(door) {
    return doorSides(door).some(function (side) {
      return same(side, battle.data.here);
    });
  }

  function doorName(id) {
    var door = (battle.data.doors || []).filter(function (d) {
      return d.id === id;
    })[0];
    return door ? door.name || 'a door' : 'a door';
  }

  function movementLeft() {
    return battle.turn ? battle.turn.movementLeft : 0;
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function now() {
    return window.performance ? window.performance.now() : Date.now();
  }

  function listOf(words) {
    if (words.length < 2) return words.join('');
    return words.slice(0, -1).join(', ') + ' or ' + words[words.length - 1];
  }

  // ── Data ──────────────────────────────────────────

  function loadArt(image) {
    if (!image) {
      battle.art = { path: null, url: null };
      return;
    }
    if (image.path === battle.art.path) return;
    battle.art = { path: image.path, url: null };
    firebase
      .storage()
      .ref(image.path)
      .getDownloadURL()
      .then(function (url) {
        if (battle.art.path !== image.path) return; // the player moved on meanwhile
        battle.art.url = url;
        Loom.map.render();
      })
      .catch(function (err) {
        console.error('Could not load the battle-map art:', err);
      });
  }

  /** Takes loomGetMap's `battleMap` (or null), and its `turn`. */
  function setData(data, turn) {
    var moved = !battle.data || !data || battle.data.id !== data.id;
    battle.data = data || null;
    battle.turn = turn || null;
    if (moved) {
      battle.selected = null;
      battle.anim = null;
    }
    walkIfMoved();
    if (battle.selectedDoor && (!battle.data || !doorById(battle.selectedDoor))) {
      battle.selectedDoor = null;
    }
    loadArt(data && data.image);
    computeFog();
    computeReach();
    computePreview();
  }

  // Whether bit `i` is set in squares packed as the server packs them (one bit
  // a square, y × width + x, lowest bit first, in base64; L-632).
  function unpacked(packed) {
    var bytes = window.atob(packed || '');
    return function (i) {
      return Boolean(bytes.charCodeAt(i >> 3) & (1 << (i & 7)));
    };
  }

  // The fog's dark and dim squares, as runs along each row (L-634).
  function computeFog() {
    var d = battle.data;
    battle.fog = null;
    battle.known = null;
    if (!d || !d.fog) return;
    var seen = unpacked(d.fog.seen);
    battle.known = seen;
    var inSight = unpacked(d.fog.inSight);
    var runs = { dark: [], dim: [] };
    for (var y = 0; y < d.height; y++) {
      var level = null;
      var x0 = 0;
      for (var x = 0; x <= d.width; x++) {
        var i = y * d.width + x;
        var here = x === d.width ? null : !seen(i) ? 'dark' : !inSight(i) ? 'dim' : null;
        if (here === level) continue;
        if (level) runs[level].push({ y: y, x0: x0, x1: x - 1 });
        level = here;
        x0 = x;
      }
    }
    battle.fog = runs;
  }

  // Whether a square is in sight (anything not under the fog).
  function inSightNow(cell) {
    return !(
      battle.fog &&
      ['dark', 'dim'].some(function (level) {
        return battle.fog[level].some(function (run) {
          return run.y === cell.y && run.x0 <= cell.x && cell.x <= run.x1;
        });
      })
    );
  }

  // A move sent from here has landed: walk the token along the path it took,
  // up to where it stands now (if that's on the path; else it simply jumps).
  function walkIfMoved() {
    var pending = battle.pending;
    battle.pending = null;
    var d = battle.data;
    if (!pending || !d || pending.mapId !== d.id || reducedMotion()) return;
    var i = -1;
    pending.path.forEach(function (step, j) {
      if (same(step, d.here)) i = j;
    });
    if (i < 0) return;
    battle.anim = { cells: [pending.from].concat(pending.path.slice(0, i + 1)), t0: now() };
    if (battle.selected && same(battle.selected, d.here)) battle.selected = null;
    window.requestAnimationFrame(frame);
  }

  function frame() {
    var anim = battle.anim;
    if (!anim) return;
    if ((now() - anim.t0) / STEP_MS >= anim.cells.length - 1) {
      battle.anim = null;
      Loom.map.render();
      return;
    }
    Loom.map.redrawOverlay();
    window.requestAnimationFrame(frame);
  }

  // Where the token is drawn: along its walk, or where it stands.
  function tokenCentre() {
    var anim = battle.anim;
    if (!anim) return centre(battle.data.here);
    var t = Math.max(0, (now() - anim.t0) / STEP_MS);
    var i = Math.min(Math.floor(t), anim.cells.length - 2);
    var f = Math.min(1, t - i);
    var a = centre(anim.cells[i]);
    var b = centre(anim.cells[i + 1]);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  // The squares this turn's movement reaches, as runs along each row.
  function computeReach() {
    var d = battle.data;
    battle.reach = null;
    if (!d || movementLeft() <= 0) return;
    var runs = [];
    P.reach(d, d.here, movementLeft(), pathOptions())
      .sort(function (a, b) {
        return a.y - b.y || a.x - b.x;
      })
      .forEach(function (cell) {
        var last = runs[runs.length - 1];
        if (last && last.y === cell.y && last.x1 === cell.x - 1) last.x1 = cell.x;
        else runs.push({ y: cell.y, x0: cell.x, x1: cell.x });
      });
    battle.reach = { runs: runs };
  }

  // How many turns walking `path` takes at full speed, from the next turn
  // (a door opened on the way ends a turn's walk).
  function turnsFor(path) {
    var speed = battle.turn ? battle.turn.speed : 20;
    var turns = 0;
    while (path.length) {
      var w = P.walk(path, speed);
      if (!w.walked.length && !w.opened) return Infinity;
      path = w.rest;
      turns += 1;
    }
    return turns;
  }

  // The path a move to the selected cell would take, as the server finds it.
  function computePreview() {
    var d = battle.data;
    var cell = battle.selected;
    battle.preview = null;
    if (!d || !cell || same(cell, d.here)) return;
    if (!known(cell)) {
      battle.preview = { unseen: true }; // (L-635)
      return;
    }
    var found = P.pathTo(d, d.here, cell, pathOptions());
    if (!found) {
      battle.preview = { none: true };
      return;
    }
    var w = P.walk(found.path, movementLeft());
    var doors = found.path
      .filter(function (step) {
        return step.opens;
      })
      .map(function (step) {
        return doorName(step.opens);
      });
    battle.preview = {
      path: found.path,
      walked: w.walked,
      rest: w.rest,
      cost: found.cost,
      turns: (w.walked.length || w.opened ? 1 : 0) + turnsFor(w.rest),
      doors: doors,
    };
  }

  function reset() {
    setData(null);
  }

  /** The map's coordinate space: the grid, with room around it. */
  function bounds() {
    var d = battle.data;
    return d
      ? { width: d.width * CELL + 2 * PAD, height: d.height * CELL + 2 * PAD }
      : { width: 1, height: 1 };
  }

  /** The grid, for framing: a battle map is small enough to show whole. */
  function framePoints() {
    var d = battle.data;
    return [
      { x: PAD, y: PAD },
      { x: PAD + d.width * CELL, y: PAD + d.height * CELL },
    ];
  }

  function herePoint() {
    return battle.data ? centre(battle.data.here) : null;
  }

  function selectHere() {
    battle.selected = battle.data ? { x: battle.data.here.x, y: battle.data.here.y } : null;
  }

  // ── Drawing ───────────────────────────────────────

  /** Draws the map into the overlay, for a view in map coordinates. */
  function draw(overlay, view) {
    var d = battle.data;
    var s = function (x, y) {
      return M.toScreen(view, x, y);
    };
    var topLeft = s(PAD, PAD);
    var bottomRight = s(PAD + d.width * CELL, PAD + d.height * CELL);
    var size = { width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
    overlay.appendChild(
      svg('rect', {
        class: 'loom-grid-ground',
        x: topLeft.x,
        y: topLeft.y,
        width: size.width,
        height: size.height,
      })
    );
    if (d.image && battle.art.url && battle.art.path === d.image.path) {
      // The art is stretched to the grid, as Claude sees it in view_image.
      overlay.appendChild(
        svg('image', {
          class: 'loom-grid-art',
          href: battle.art.url,
          x: topLeft.x,
          y: topLeft.y,
          width: size.width,
          height: size.height,
          preserveAspectRatio: 'none',
        })
      );
    }

    var cellPx = (bottomRight.x - topLeft.x) / d.width;
    // Row runs of squares as one shape, so no seams show between them.
    var runsPath = function (runs) {
      return runs
        .map(function (run) {
          var a = s(PAD + run.x0 * CELL, PAD + run.y * CELL);
          var b = s(PAD + (run.x1 + 1) * CELL, PAD + (run.y + 1) * CELL);
          return 'M' + a.x + ' ' + a.y + 'H' + b.x + 'V' + b.y + 'H' + a.x + 'Z';
        })
        .join('');
    };
    // The fog's dimming (L-634) lies under the grid and the layers, so the
    // layout of squares seen before still reads over their dimmed art.
    var fog = function (level) {
      if (battle.fog && battle.fog[level].length) {
        overlay.appendChild(
          svg('path', { class: 'loom-grid-fog is-' + level, d: runsPath(battle.fog[level]) })
        );
      }
    };
    fog('dim');
    if (battle.reach && !battle.anim) {
      // This turn's reach (L-615).
      overlay.appendChild(
        svg('path', { class: 'loom-grid-reach', d: runsPath(battle.reach.runs) })
      );
    }
    if (cellPx >= 6) {
      for (var gx = 0; gx <= d.width; gx++) {
        var x = s(PAD + gx * CELL, 0).x;
        overlay.appendChild(
          svg('line', {
            class: 'loom-grid-line' + (gx % 5 === 0 ? ' is-major' : ''),
            x1: x,
            y1: topLeft.y,
            x2: x,
            y2: bottomRight.y,
          })
        );
      }
      for (var gy = 0; gy <= d.height; gy++) {
        var y = s(0, PAD + gy * CELL).y;
        overlay.appendChild(
          svg('line', {
            class: 'loom-grid-line' + (gy % 5 === 0 ? ' is-major' : ''),
            x1: topLeft.x,
            y1: y,
            x2: bottomRight.x,
            y2: y,
          })
        );
      }
    }

    // The layers (L-627).
    var corner = function (p) {
      var c = s(PAD + p.x * CELL, PAD + p.y * CELL);
      return c.x + ',' + c.y;
    };
    var wallWidth = Math.max(3, cellPx / 7);
    if (!d.image) {
      var defs = svg('defs');
      var hatch = svg('pattern', {
        id: 'loom-grid-hatch',
        width: 8,
        height: 8,
        patternUnits: 'userSpaceOnUse',
        patternTransform: 'rotate(45)',
      });
      hatch.appendChild(svg('rect', { class: 'loom-grid-hatch', width: 3, height: 8 }));
      var dots = svg('pattern', {
        id: 'loom-grid-dots',
        width: 9,
        height: 9,
        patternUnits: 'userSpaceOnUse',
      });
      dots.appendChild(svg('circle', { class: 'loom-grid-dot', cx: 4.5, cy: 4.5, r: 1.6 }));
      defs.appendChild(hatch);
      defs.appendChild(dots);
      overlay.appendChild(defs);
      (d.obstacles || []).forEach(function (o) {
        var a = s(PAD + o.x * CELL, PAD + o.y * CELL);
        var b = s(PAD + (o.x + (o.w || 1)) * CELL, PAD + (o.y + (o.h || 1)) * CELL);
        var attrs = {
          class: 'loom-grid-obstacle is-' + o.kind,
          x: a.x,
          y: a.y,
          width: b.x - a.x,
          height: b.y - a.y,
        };
        if (o.kind === 'low') attrs.fill = 'url(#loom-grid-hatch)';
        if (o.kind === 'difficult') attrs.fill = 'url(#loom-grid-dots)';
        overlay.appendChild(svg('rect', attrs));
      });
      (d.walls || []).forEach(function (w) {
        overlay.appendChild(
          svg('polyline', {
            class: 'loom-grid-wall',
            points: (w.points || []).map(corner).join(' '),
            'stroke-width': wallWidth,
          })
        );
      });
    }
    (d.doors || []).forEach(function (door) {
      var a = corner(door.from).split(',');
      var b = corner(door.to).split(',');
      overlay.appendChild(
        svg('line', {
          class:
            'loom-grid-door is-' +
            door.state +
            (battle.selectedDoor === door.id ? ' is-selected' : ''),
          x1: a[0],
          y1: a[1],
          x2: b[0],
          y2: b[1],
          'stroke-width': wallWidth + 2,
        })
      );
    });

    // What stands on a square seen before but not in sight now is faded.
    var remembered = function (cell) {
      return inSightNow(cell) ? '' : ' is-remembered';
    };
    var cellBox = function (cell, className) {
      var a = s(PAD + cell.x * CELL, PAD + cell.y * CELL);
      overlay.appendChild(
        svg('rect', {
          class: className,
          x: a.x + 1,
          y: a.y + 1,
          width: Math.max(1, cellPx - 2),
          height: Math.max(1, cellPx - 2),
          rx: Math.min(4, cellPx / 6),
        })
      );
    };
    // Names are drawn after the fog, so one below a square at the fog's edge
    // still reads; dimmed for a square seen before but not in sight now.
    var labels = [];
    var label = function (cell, text, className) {
      var c = centre(cell);
      var p = s(c.x, c.y);
      labels.push(
        svg(
          'text',
          {
            class: className + remembered(cell),
            x: p.x,
            y: p.y + cellPx / 2 + 12,
          },
          text
        )
      );
    };

    d.entries.forEach(function (e) {
      cellBox(e, 'loom-grid-entry' + remembered(e));
    });
    d.exits.forEach(function (e) {
      cellBox(e, 'loom-grid-exit' + remembered(e));
      label(e, e.name, 'loom-grid-label is-exit');
    });
    d.features.forEach(function (f) {
      var c = centre(f);
      var p = s(c.x, c.y);
      overlay.appendChild(
        svg('circle', {
          class: 'loom-grid-feature' + remembered(f),
          cx: p.x,
          cy: p.y,
          r: Math.max(3, cellPx * 0.28),
        })
      );
      label(f, f.name, 'loom-grid-label');
    });

    // The fog's dark (L-634) covers everything never seen.
    fog('dark');
    labels.forEach(function (node) {
      overlay.appendChild(node);
    });
    if (battle.selected) cellBox(battle.selected, 'loom-grid-selected');

    // The way: the selected cell's path (this turn solid, the rest dashed), or
    // else the plan kept from an earlier move (L-615).
    var line = function (cells, className) {
      if (cells.length < 2) return;
      overlay.appendChild(
        svg('polyline', {
          class: className,
          points: cells
            .map(function (cell) {
              var c = centre(cell);
              var p = s(c.x, c.y);
              return p.x + ',' + p.y;
            })
            .join(' '),
        })
      );
    };
    var preview = battle.preview;
    var plan = battle.turn && battle.turn.plan;
    if (!battle.anim && preview && preview.path) {
      line([d.here].concat(preview.walked), 'loom-grid-path');
      line(
        [preview.walked.length ? preview.walked[preview.walked.length - 1] : d.here].concat(
          preview.rest
        ),
        'loom-grid-path is-later'
      );
    } else if (!battle.anim && !battle.selected && plan) {
      line([d.here].concat(plan.path), 'loom-grid-path is-later is-plan');
    }

    // The player's token: along its walk, or where it stands.
    var me = tokenCentre();
    var mp = s(me.x, me.y);
    overlay.appendChild(
      svg('circle', { class: 'loom-map-ring', cx: mp.x, cy: mp.y, r: Math.max(7, cellPx * 0.45) })
    );
    overlay.appendChild(
      svg('circle', { class: 'loom-grid-you', cx: mp.x, cy: mp.y, r: Math.max(5, cellPx * 0.3) })
    );
  }

  /** Selects the cell under a tap (screen point), if it is on the grid. */
  function pick(point, view) {
    if (battle.anim) {
      battle.anim = null; // a tap skips the walk ahead
      return;
    }
    var d = battle.data;
    var m = M.toMap(view, point.x, point.y);
    // A door, if the tap is on one (within a fifth of a square of its line).
    var gx = (m.x - PAD) / CELL;
    var gy = (m.y - PAD) / CELL;
    var door = (d.doors || []).filter(function (dr) {
      var x0 = Math.min(dr.from.x, dr.to.x);
      var x1 = Math.max(dr.from.x, dr.to.x);
      var y0 = Math.min(dr.from.y, dr.to.y);
      var y1 = Math.max(dr.from.y, dr.to.y);
      var dx = Math.max(x0 - gx, 0, gx - x1);
      var dy = Math.max(y0 - gy, 0, gy - y1);
      return Math.sqrt(dx * dx + dy * dy) <= 0.2;
    })[0];
    if (door) {
      battle.selectedDoor = door.id;
      battle.selected = null;
      battle.preview = null;
      return;
    }
    battle.selectedDoor = null;
    var cell = { x: Math.floor(gx), y: Math.floor(gy) };
    var inside = cell.x >= 0 && cell.y >= 0 && cell.x < d.width && cell.y < d.height;
    battle.selected = inside ? cell : null;
    computePreview();
  }

  // A tapped door's card (L-627): its state, and Open, Close or Try from
  // beside it.
  function renderDoorCard(info, door) {
    var name = door.name || 'the door';
    info.appendChild(el('h3', 'loom-map-info-name', capitalise(name)));
    info.appendChild(
      el(
        'p',
        'loom-map-info-facts',
        'Door · ' + (door.state === 'open' ? 'open' : door.state === 'locked' ? 'locked' : 'closed')
      )
    );
    if (!besideDoor(door)) {
      info.appendChild(el('p', 'loom-map-info-status', 'Walk beside it to open or close it.'));
      return;
    }
    var open = door.state !== 'open';
    var text =
      door.state === 'open'
        ? 'Close ' + name
        : door.state === 'locked'
          ? 'Try ' + name + ' (locked)'
          : 'Open ' + name;
    info.appendChild(
      button(capitalise(text), function () {
        Loom.play.doorAction(door.id, open, (open ? 'open ' : 'close ') + name);
      })
    );
  }

  // ── The cell card ─────────────────────────────────

  function button(text, onClick) {
    var b = el('button', 'app-btn loom-map-travel', text);
    b.type = 'button';
    b.disabled = state.turnInProgress;
    b.addEventListener('click', onClick);
    return b;
  }

  function whereTo(exit) {
    return exit.to === 'out'
      ? 'out of ' + (battle.data.host ? battle.data.host.name : 'here')
      : 'to ' + exit.to.name;
  }

  /**
   * Fills the card for the selected cell, and the turn under it (movement
   * left, Continue, End turn). `act(cell, label)` makes the move: a step on
   * the grid, which leaves by an exit if the cell is one.
   */
  function renderInfo(info, act) {
    info.innerHTML = '';
    renderCard(info, act);
    renderTurn(info);
  }

  function renderCard(info, act) {
    var d = battle.data;
    var tapped = battle.selectedDoor && doorById(battle.selectedDoor);
    if (tapped) {
      renderDoorCard(info, tapped);
      return;
    }
    var cell = battle.selected;
    if (!cell) {
      var here = at(d.here);
      var where =
        "You're at (" +
        d.here.x +
        ', ' +
        d.here.y +
        ')' +
        (here.feature ? ', at ' + here.feature.name : '') +
        (d.host ? ' in ' + d.host.name : '') +
        '. ';
      var ways = d.exits.length
        ? ' Ways out: ' +
          listOf(
            d.exits.map(function (e) {
              return e.name;
            })
          ) +
          '.'
        : '';
      info.appendChild(el('p', 'loom-map-hint', where + 'Tap a cell to move.' + ways));
      if (d.people.length) {
        info.appendChild(
          el(
            'p',
            'loom-map-info-facts',
            'Here: ' +
              listOf(
                d.people.map(function (p) {
                  return p.name;
                })
              ).replace(/ or /, ' and ') +
              '.'
          )
        );
      }
      return;
    }

    var there = at(cell);
    var coords = '(' + cell.x + ', ' + cell.y + ')';
    if (there.exit) {
      info.appendChild(el('h3', 'loom-map-info-name', capitalise(there.exit.name)));
      info.appendChild(
        el('p', 'loom-map-info-facts', 'Way out, ' + whereTo(there.exit) + ' · ' + coords)
      );
    } else if (there.feature) {
      info.appendChild(el('h3', 'loom-map-info-name', capitalise(there.feature.name)));
      info.appendChild(el('p', 'loom-map-info-facts', 'Feature · ' + coords));
    } else {
      info.appendChild(el('h3', 'loom-map-info-name', 'Cell ' + coords));
    }

    if (same(cell, d.here)) {
      info.appendChild(el('p', 'loom-map-info-status', 'You are here.'));
      return;
    }
    var preview = battle.preview;
    if (preview && preview.unseen) {
      info.appendChild(el('p', 'loom-map-info-status', "You haven't seen that."));
      return;
    }
    if (!preview || preview.none) {
      info.appendChild(el('p', 'loom-map-info-status', "There's no way there from here."));
      return;
    }
    info.appendChild(el('p', 'loom-map-info-facts', costLine(preview)));
    // The move, remembered so the token can walk it when it lands.
    var go = function (label) {
      return function () {
        battle.pending = { mapId: d.id, from: d.here, path: preview.path };
        act(cell, label);
      };
    };
    if (there.exit) {
      info.appendChild(button('Go out by ' + there.exit.name, go('go out by ' + there.exit.name)));
    } else if (there.feature) {
      info.appendChild(button('Go to ' + there.feature.name, go('go to ' + there.feature.name)));
    } else {
      info.appendChild(button('Move here', go('move to ' + coords)));
    }
  }

  // What a move costs, and when it gets there: "8 movement · this turn".
  function costLine(preview) {
    var when;
    if (!preview.rest.length) when = 'this turn';
    else if (preview.turns === Infinity) when = 'too far to walk';
    else if (!preview.walked.length) {
      when = preview.turns === 1 ? 'next turn' : preview.turns + ' turns, from next turn';
    } else when = preview.turns + ' turns';
    return (
      preview.cost +
      ' movement · ' +
      when +
      (preview.doors.length ? ' · opens ' + listOf(preview.doors).replace(/ or /, ' and ') : '')
    );
  }

  // The turn (L-613, L-615): the turn number, movement left, the action,
  // Continue for a kept plan, and End turn.
  function renderTurn(info) {
    var turn = battle.turn;
    if (!turn) return;
    info.appendChild(
      el(
        'p',
        'loom-map-info-facts loom-map-turn-state',
        'Turn ' +
          turn.n +
          ' · movement ' +
          turn.movementLeft +
          ' of ' +
          turn.speed +
          ' · ' +
          (turn.actionUsed ? 'you have acted' : 'your action is ready')
      )
    );
    var row = el('div', 'loom-map-turn');
    if (turn.plan && turn.movementLeft > 0) {
      row.appendChild(
        button('Continue', function () {
          battle.pending = { mapId: battle.data.id, from: battle.data.here, path: turn.plan.path };
          Loom.play.continuePlan();
        })
      );
    }
    row.appendChild(
      button('End turn', function () {
        Loom.play.endTurn();
      })
    );
    info.appendChild(row);
  }

  function capitalise(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  Loom.battle = {
    setData: setData,
    reset: reset,
    bounds: bounds,
    framePoints: framePoints,
    herePoint: herePoint,
    selectHere: selectHere,
    draw: draw,
    pick: pick,
    renderInfo: renderInfo,
    current: function () {
      return battle.data;
    },
  };
})();
