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
  // The turn (planning/the-loom-movement-and-vision.md §3; L-615 / #445): the
  // squares in reach of this turn's movement are lit; tapping a square draws
  // the path a move would take (grid-paths.js, the server's own rules), solid
  // for this turn and dashed after, and the card says what it costs and in
  // how many turns; a kept plan is drawn dashed. After a move the token walks
  // its path (a tap skips ahead; reduced motion jumps).
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
    art: { path: null, url: null },
    reach: null, // this turn's reach: { runs: [{ y, x0, x1 }] }
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
  // Doors are as this save has them.
  function pathOptions() {
    var states = {};
    (battle.data.doors || []).forEach(function (door) {
      states[door.id] = door.state;
    });
    return L.pathOptions(battle.data, states);
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
    loadArt(data && data.image);
    computeReach();
    computePreview();
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
    if (battle.reach && !battle.anim) {
      // This turn's reach, one shape of row runs (L-615).
      var dPath = battle.reach.runs
        .map(function (run) {
          var a = s(PAD + run.x0 * CELL, PAD + run.y * CELL);
          var b = s(PAD + (run.x1 + 1) * CELL, PAD + (run.y + 1) * CELL);
          return 'M' + a.x + ' ' + a.y + 'H' + b.x + 'V' + b.y + 'H' + a.x + 'Z';
        })
        .join('');
      overlay.appendChild(svg('path', { class: 'loom-grid-reach', d: dPath }));
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
    var label = function (cell, text, className) {
      var c = centre(cell);
      var p = s(c.x, c.y);
      overlay.appendChild(
        svg('text', { class: className, x: p.x, y: p.y + cellPx / 2 + 12 }, text)
      );
    };

    d.entries.forEach(function (e) {
      cellBox(e, 'loom-grid-entry');
    });
    d.exits.forEach(function (e) {
      cellBox(e, 'loom-grid-exit');
      label(e, e.name, 'loom-grid-label is-exit');
    });
    d.features.forEach(function (f) {
      var c = centre(f);
      var p = s(c.x, c.y);
      overlay.appendChild(
        svg('circle', {
          class: 'loom-grid-feature',
          cx: p.x,
          cy: p.y,
          r: Math.max(3, cellPx * 0.28),
        })
      );
      label(f, f.name, 'loom-grid-label');
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
    var cell = { x: Math.floor((m.x - PAD) / CELL), y: Math.floor((m.y - PAD) / CELL) };
    var inside = cell.x >= 0 && cell.y >= 0 && cell.x < d.width && cell.y < d.height;
    battle.selected = inside ? cell : null;
    computePreview();
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
