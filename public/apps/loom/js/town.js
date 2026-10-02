(function () {
  'use strict';

  // The town view in the play view (planning/the-loom-layered-worlds.md §8;
  // L-345 / #399): a drawn map of the town the player stands in, from
  // loomGetMap's `town`. Places are labelled and tappable, the paths between
  // them are drawn, and the place card offers the one move it allows: walk to
  // a place one step away, or set out along a world route from a way out.
  // Moves are structured moves (Loom.play.travelTo), adjudicated and gated on
  // the server like typed ones.
  //
  // map.js owns the panel, pan and zoom, and switches between the world map
  // and this view; this module draws the town into the panel's SVG overlay in
  // screen space, in town coordinates (0–1000 each way). Places without a
  // position are placed by town-layout.js.

  var Loom = window.Loom;
  var state = Loom.state;
  var M = Loom.mapMath;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var HIT_RADIUS = 20; // px around a place that selects it
  var STUB = 30; // px: the stub of road leading out from a way out
  var SPAN = Loom.townLayout.SPAN;
  // The view's space is the town's 0–1000 with room around it, so a place at
  // the edge of town still has room for its label.
  var PAD = 140;
  var BOUNDS = { width: SPAN + 2 * PAD, height: SPAN + 2 * PAD };

  var town = {
    data: null, // loomGetMap's `town`
    positions: {}, // id → { x, y, auto }
    selected: null, // a place id
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

  function placeById(id) {
    return (
      town.data &&
      town.data.places.filter(function (p) {
        return p.id === id;
      })[0]
    );
  }

  function capitalised(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function listOf(words) {
    if (words.length < 2) return words.join('');
    return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
  }

  function isNext(id) {
    return town.data.next.indexOf(id) !== -1;
  }

  // The first step on the shortest walk from here to `id`, through open
  // places, for "go by … first" (null if there is no such walk).
  function firstStep(id) {
    var here = town.data.here;
    if (!here || here === id) return null;
    var neighbours = {};
    town.data.links.forEach(function (l) {
      (neighbours[l.from] = neighbours[l.from] || []).push(l.to);
      (neighbours[l.to] = neighbours[l.to] || []).push(l.from);
    });
    var via = {};
    via[here] = here;
    var queue = [here];
    while (queue.length) {
      var at = queue.shift();
      var nexts = (neighbours[at] || []).slice().sort();
      for (var i = 0; i < nexts.length; i++) {
        var next = nexts[i];
        var place = placeById(next);
        if (via[next] || !place || !place.open || place.retired) continue;
        via[next] = at === here ? next : via[at];
        if (next === id) return via[next];
        queue.push(next);
      }
    }
    return null;
  }

  // The world routes this way out serves: loomGetMap's exits.
  function exitsFrom(id) {
    return town.data.exits.filter(function (exit) {
      return exit.waysOut.indexOf(id) !== -1;
    });
  }

  // ── Data ──────────────────────────────────────────

  /** Takes loomGetMap's `town` (or null), and places what has no position. */
  function setData(data) {
    town.data = data || null;
    var placed = data ? Loom.townLayout.layout(data.places, data.links) : {};
    town.positions = {};
    Object.keys(placed).forEach(function (id) {
      town.positions[id] = { x: placed[id].x + PAD, y: placed[id].y + PAD, auto: placed[id].auto };
    });
    if (town.selected && !placeById(town.selected)) town.selected = null;
  }

  function reset() {
    setData(null);
    town.selected = null;
  }

  /** The places as map points, for framing the view. */
  function points() {
    return Object.keys(town.positions).map(function (id) {
      return { id: id, x: town.positions[id].x, y: town.positions[id].y };
    });
  }

  /** The town's own ground, for framing: a town is small enough to show whole. */
  function framePoints() {
    return [
      { x: PAD, y: PAD },
      { x: PAD + SPAN, y: PAD + SPAN },
    ];
  }

  function herePoint() {
    var here = town.data && town.positions[town.data.here];
    return here ? { x: here.x, y: here.y } : null;
  }

  function selectHere() {
    town.selected = town.data ? town.data.here : null;
  }

  // ── Drawing ───────────────────────────────────────

  /** Draws the town into the overlay, for a view in town coordinates. */
  function draw(overlay, view) {
    var corner = M.toScreen(view, PAD, PAD);
    var far = M.toScreen(view, PAD + SPAN, PAD + SPAN);
    overlay.appendChild(
      svg('rect', {
        class: 'loom-town-ground',
        x: corner.x,
        y: corner.y,
        width: far.x - corner.x,
        height: far.y - corner.y,
        rx: 18,
      })
    );

    var at = function (id) {
      var p = town.positions[id];
      return p && M.toScreen(view, p.x, p.y);
    };

    // The roads out of town, as stubs leading away from the middle.
    var middle = M.toScreen(view, BOUNDS.width / 2, BOUNDS.height / 2);
    town.data.places.forEach(function (place) {
      if (!place.entranceFor) return;
      var s = at(place.id);
      var served = exitsFrom(place.id).map(function (exit) {
        return exit.via;
      });
      var via = served[0] || place.entranceFor[0];
      var dx = s.x - middle.x;
      var dy = s.y - middle.y;
      var d = Math.hypot(dx, dy) || 1;
      var ends = { x1: s.x, y1: s.y, x2: s.x + (dx / d) * STUB, y2: s.y + (dy / d) * STUB };
      overlay.appendChild(svg('line', Object.assign({ class: 'loom-map-route-casing' }, ends)));
      overlay.appendChild(
        svg(
          'line',
          Object.assign({ class: 'loom-map-route loom-map-route--' + (via || 'road') }, ends)
        )
      );
    });

    town.data.links.forEach(function (link) {
      var s = at(link.from);
      var t = at(link.to);
      if (!s || !t) return;
      var a = placeById(link.from);
      var b = placeById(link.to);
      var shut = !a.open || !b.open || a.retired || b.retired;
      var ends = { x1: s.x, y1: s.y, x2: t.x, y2: t.y };
      overlay.appendChild(svg('line', Object.assign({ class: 'loom-town-path-casing' }, ends)));
      overlay.appendChild(
        svg('line', Object.assign({ class: 'loom-town-path' + (shut ? ' is-closed' : '') }, ends))
      );
    });

    town.data.places.forEach(function (place) {
      var s = at(place.id);
      var here = place.id === town.data.here;
      var classes = [
        'loom-town-place',
        place.open && !place.retired ? 'is-open' : 'is-closed',
        'kind-' + place.kind,
      ];
      if (place.entranceFor) classes.push('is-entrance');
      if (here) classes.push('is-here');
      if (isNext(place.id)) classes.push('is-near');
      if (place.id === town.selected) classes.push('is-selected');
      var group = svg('g', {
        class: classes.join(' '),
        transform: 'translate(' + s.x + ',' + s.y + ')',
      });
      if (here) group.appendChild(svg('circle', { class: 'loom-map-ring', r: 14 }));
      var r = 8;
      if (place.entranceFor) {
        group.appendChild(
          svg('rect', {
            class: 'loom-town-dot',
            x: -r,
            y: -r,
            width: r * 2,
            height: r * 2,
            rx: 3,
          })
        );
      } else {
        group.appendChild(svg('circle', { class: 'loom-town-dot', r: r }));
      }
      if (!place.open || place.retired) {
        group.appendChild(svg('text', { class: 'loom-map-lock', x: r + 2, y: -r - 1 }, '🔒'));
      }
      group.appendChild(svg('text', { class: 'loom-town-label', x: 0, y: r + 16 }, place.name));
      overlay.appendChild(group);
    });
  }

  /** Selects the place nearest a tap (screen point), if any is close enough. */
  function pick(point, view) {
    var best = null;
    points().forEach(function (p) {
      var s = M.toScreen(view, p.x, p.y);
      var d = Math.hypot(s.x - point.x, s.y - point.y);
      if (d <= HIT_RADIUS && (!best || d < best.d)) best = { id: p.id, d: d };
    });
    town.selected = best ? best.id : null;
  }

  // ── The place card ────────────────────────────────

  function button(text, onClick) {
    var b = el('button', 'app-btn loom-map-travel', text);
    b.type = 'button';
    b.disabled = state.turnInProgress;
    b.addEventListener('click', onClick);
    return b;
  }

  // Routes out of town from a way out: set out along the open ones.
  function routesOut(info, place, act, standingHere) {
    var exits = exitsFrom(place.id);
    if (!exits.length) return;
    if (!standingHere) {
      var names = exits.map(function (exit) {
        return exit.name + ' (' + (exit.via || 'route') + ')';
      });
      info.appendChild(el('p', 'loom-map-info-facts', 'Ways on from here: ' + names.join(', ')));
      return;
    }
    exits.forEach(function (exit) {
      var label = exit.name + (exit.via ? ' by ' + exit.via : '');
      if (!exit.open) {
        info.appendChild(el('p', 'loom-map-info-status is-closed', label + ': the way is closed.'));
        return;
      }
      var list = el('div', 'loom-town-routes');
      var ways = exit.waysIn || [];
      if (ways.length > 1) {
        // Where to arrive (L-346): travelling to a way in arrives by it.
        info.appendChild(
          el('p', 'loom-map-info-status', 'Set out for ' + label + ', arriving by:')
        );
        ways.forEach(function (way) {
          list.appendChild(
            button(way.name, function () {
              act(way.id, exit.name + ' by ' + way.name);
            })
          );
        });
      } else {
        list.appendChild(
          button('Set out for ' + label, function () {
            act(exit.id, exit.name);
          })
        );
      }
      info.appendChild(list);
    });
  }

  /**
   * Fills the card for the selected place. `act(id, name)` makes the move:
   * a place in town, or a world place along a route out.
   */
  function renderInfo(info, act) {
    info.innerHTML = '';
    var here = placeById(town.data.here);
    var place = placeById(town.selected);
    if (!place) {
      var where = here ? "You're at " + here.name + ', ' + town.data.name + '. ' : '';
      info.appendChild(
        el(
          'p',
          'loom-map-hint',
          where + 'Tap a place to see it. Drag to pan, pinch or scroll to zoom.'
        )
      );
      return;
    }

    info.appendChild(el('h3', 'loom-map-info-name', place.name));
    var facts = [capitalised(place.kind)];
    if (place.entranceFor) facts.push('Way in and out by ' + listOf(place.entranceFor));
    info.appendChild(el('p', 'loom-map-info-facts', facts.join(' · ')));

    if (place.id === town.data.here) {
      info.appendChild(el('p', 'loom-map-info-status', 'You are here.'));
      if (place.entranceFor) {
        routesOut(info, place, act, true);
      } else if (town.data.exits.length) {
        var ways = town.data.places
          .filter(function (p) {
            return p.entranceFor && !p.retired;
          })
          .map(function (p) {
            return p.name;
          });
        if (ways.length) {
          info.appendChild(
            el('p', 'loom-map-info-facts', 'To leave town, go to ' + listOf(ways) + '.')
          );
        }
      }
      return;
    }
    if (place.retired) {
      info.appendChild(
        el('p', 'loom-map-info-status is-closed', "That place can't be reached anymore.")
      );
      return;
    }
    if (!place.open) {
      info.appendChild(
        el('p', 'loom-map-info-status is-closed', 'Not built yet. The way is closed.')
      );
      return;
    }
    if (isNext(place.id)) {
      info.appendChild(
        button('Go here', function () {
          act(place.id, place.name);
        })
      );
    } else {
      var step = placeById(firstStep(place.id));
      info.appendChild(
        el(
          'p',
          'loom-map-info-status',
          'Not directly reachable from here.' + (step ? ' Go by ' + step.name + ' first.' : '')
        )
      );
    }
    if (place.entranceFor) routesOut(info, place, act, false);
  }

  Loom.town = {
    BOUNDS: BOUNDS,
    setData: setData,
    reset: reset,
    points: points,
    framePoints: framePoints,
    herePoint: herePoint,
    selectHere: selectHere,
    draw: draw,
    pick: pick,
    renderInfo: renderInfo,
    current: function () {
      return town.data;
    },
  };
})();
