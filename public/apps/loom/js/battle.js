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
  // map.js owns the panel, pan and zoom, and switches between this, the town
  // view and the world map; this module draws the map into the panel's SVG
  // overlay in screen space. Map coordinates are CELL units per cell, with
  // room around the grid.

  var Loom = window.Loom;
  var state = Loom.state;
  var M = Loom.mapMath;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var CELL = 40;
  var PAD = 60; // room for the labels of cells at the edge

  var battle = {
    data: null, // loomGetMap's `battleMap`
    selected: null, // a cell { x, y }
    art: { path: null, url: null },
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

  /** Takes loomGetMap's `battleMap` (or null). */
  function setData(data) {
    var moved = !battle.data || !data || battle.data.id !== data.id;
    battle.data = data || null;
    if (moved) battle.selected = null;
    loadArt(data && data.image);
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

    // The player's token.
    var me = centre(d.here);
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
    var d = battle.data;
    var m = M.toMap(view, point.x, point.y);
    var cell = { x: Math.floor((m.x - PAD) / CELL), y: Math.floor((m.y - PAD) / CELL) };
    var inside = cell.x >= 0 && cell.y >= 0 && cell.x < d.width && cell.y < d.height;
    battle.selected = inside ? cell : null;
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
   * Fills the card for the selected cell. `act(cell, label)` makes the move:
   * a step on the grid, which leaves by an exit if the cell is one.
   */
  function renderInfo(info, act) {
    var d = battle.data;
    info.innerHTML = '';
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
    if (there.exit) {
      info.appendChild(
        button('Go out by ' + there.exit.name, function () {
          act(cell, 'go out by ' + there.exit.name);
        })
      );
    } else if (there.feature) {
      info.appendChild(
        button('Go to ' + there.feature.name, function () {
          act(cell, 'go to ' + there.feature.name);
        })
      );
    } else {
      info.appendChild(
        button('Move here', function () {
          act(cell, 'move to ' + coords);
        })
      );
    }
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
