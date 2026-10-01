/* global module */
(function () {
  'use strict';

  // Where to draw a town's places (planning/the-loom-layered-worlds.md §8;
  // L-345 / #399). Places keep the position they were given over MCP
  // (`position`, 0–1000 each way); the rest are placed here, so a town built
  // without positions still draws. Pure and deterministic, so it is
  // unit-tested (tests/loom-town-layout.test.js) and shared by the view
  // (town.js).
  //
  // The placement is a small force layout: linked places pull together and
  // every place pushes the others apart, starting from a ring in walking
  // order (from the ways in). Placed positions stay fixed and take part.

  var SPAN = 1000;
  var MARGIN = 90;
  var ITERATIONS = 300;

  function finite(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function clampTo(n) {
    return Math.max(MARGIN, Math.min(SPAN - MARGIN, n));
  }

  // Walking order: breadth-first from the ways in, then the rest, by id.
  function walkingOrder(places, neighbours) {
    var byId = function (a, b) {
      return a < b ? -1 : a > b ? 1 : 0;
    };
    var ids = places
      .map(function (p) {
        return p.id;
      })
      .sort(byId);
    var starts = places
      .filter(function (p) {
        return p.entranceFor;
      })
      .map(function (p) {
        return p.id;
      })
      .sort(byId);
    var seen = {};
    var order = [];
    var queue = starts.length ? starts.slice() : ids.slice(0, 1);
    queue.forEach(function (id) {
      seen[id] = true;
    });
    function drain() {
      while (queue.length) {
        var id = queue.shift();
        order.push(id);
        (neighbours[id] || []).sort(byId).forEach(function (next) {
          if (!seen[next]) {
            seen[next] = true;
            queue.push(next);
          }
        });
      }
    }
    drain();
    ids.forEach(function (id) {
      if (!seen[id]) {
        seen[id] = true;
        queue.push(id);
        drain();
      }
    });
    return order;
  }

  /**
   * Positions for a town's places: { [id]: { x, y, auto } }, `auto` when this
   * module placed it. `places` are { id, entranceFor?, position? }; `links`
   * are { from, to }.
   */
  function layout(places, links) {
    var result = {};
    if (!places || !places.length) return result;

    var neighbours = {};
    var known = {};
    places.forEach(function (p) {
      known[p.id] = true;
      neighbours[p.id] = [];
    });
    (links || []).forEach(function (l) {
      if (!known[l.from] || !known[l.to] || l.from === l.to) return;
      neighbours[l.from].push(l.to);
      neighbours[l.to].push(l.from);
    });

    var nodes = {};
    var free = [];
    places.forEach(function (p) {
      var pos = p.position;
      if (pos && finite(pos.x) && finite(pos.y)) {
        nodes[p.id] = { x: pos.x, y: pos.y, fixed: true };
      } else {
        free.push(p.id);
      }
    });
    if (!free.length) {
      Object.keys(nodes).forEach(function (id) {
        result[id] = { x: nodes[id].x, y: nodes[id].y, auto: false };
      });
      return result;
    }

    // Start the free places on a ring, in walking order.
    var order = walkingOrder(places, neighbours).filter(function (id) {
      return !nodes[id];
    });
    var anyFixed = order.length < places.length;
    order.forEach(function (id, i) {
      if (order.length === 1 && !anyFixed) {
        nodes[id] = { x: SPAN / 2, y: SPAN / 2, fixed: false };
        return;
      }
      var angle = -Math.PI / 2 + (2 * Math.PI * i) / order.length;
      nodes[id] = {
        x: SPAN / 2 + SPAN * 0.3 * Math.cos(angle),
        y: SPAN / 2 + SPAN * 0.3 * Math.sin(angle),
        fixed: false,
      };
    });

    var ids = places.map(function (p) {
      return p.id;
    });
    var k = (SPAN * 0.55) / Math.sqrt(ids.length);
    for (var step = 0; step < ITERATIONS; step++) {
      var heat = (SPAN / 10) * (1 - step / ITERATIONS) + 1;
      var push = {};
      ids.forEach(function (id) {
        push[id] = { x: 0, y: 0 };
      });
      for (var a = 0; a < ids.length; a++) {
        for (var b = a + 1; b < ids.length; b++) {
          var na = nodes[ids[a]];
          var nb = nodes[ids[b]];
          var dx = na.x - nb.x;
          var dy = na.y - nb.y;
          var d = Math.hypot(dx, dy);
          if (d < 0.01) {
            // Coincident: separate them along a fixed direction.
            dx = (b - a) * 0.01;
            dy = 0.01;
            d = Math.hypot(dx, dy);
          }
          var repel = (k * k) / d;
          push[ids[a]].x += (dx / d) * repel;
          push[ids[a]].y += (dy / d) * repel;
          push[ids[b]].x -= (dx / d) * repel;
          push[ids[b]].y -= (dy / d) * repel;
        }
      }
      ids.forEach(function (id) {
        neighbours[id].forEach(function (other) {
          if (other < id) return; // each link once
          var n1 = nodes[id];
          var n2 = nodes[other];
          var dx = n1.x - n2.x;
          var dy = n1.y - n2.y;
          var d = Math.max(0.01, Math.hypot(dx, dy));
          var pull = (d * d) / k;
          push[id].x -= (dx / d) * pull;
          push[id].y -= (dy / d) * pull;
          push[other].x += (dx / d) * pull;
          push[other].y += (dy / d) * pull;
        });
      });
      ids.forEach(function (id) {
        var node = nodes[id];
        if (node.fixed) return;
        var f = push[id];
        var len = Math.hypot(f.x, f.y);
        if (len > 0) {
          var move = Math.min(len, heat);
          node.x = clampTo(node.x + (f.x / len) * move);
          node.y = clampTo(node.y + (f.y / len) * move);
        }
      });
    }

    // With nothing fixed, stretch the result to use the town's space.
    if (!anyFixed && order.length > 1) {
      var xs = order.map(function (id) {
        return nodes[id].x;
      });
      var ys = order.map(function (id) {
        return nodes[id].y;
      });
      var minX = Math.min.apply(null, xs);
      var minY = Math.min.apply(null, ys);
      var w = Math.max.apply(null, xs) - minX;
      var h = Math.max.apply(null, ys) - minY;
      var fitScale = (SPAN - 2 * MARGIN) / Math.max(w, h, 1);
      var offX = (SPAN - w * fitScale) / 2;
      var offY = (SPAN - h * fitScale) / 2;
      order.forEach(function (id) {
        nodes[id].x = offX + (nodes[id].x - minX) * fitScale;
        nodes[id].y = offY + (nodes[id].y - minY) * fitScale;
      });
    }

    ids.forEach(function (id) {
      var node = nodes[id];
      result[id] = {
        x: node.fixed ? node.x : Math.round(node.x * 10) / 10,
        y: node.fixed ? node.y : Math.round(node.y * 10) / 10,
        auto: !node.fixed,
      };
    });
    return result;
  }

  var api = { SPAN: SPAN, layout: layout };

  if (typeof window !== 'undefined') {
    window.Loom = window.Loom || {};
    window.Loom.townLayout = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
