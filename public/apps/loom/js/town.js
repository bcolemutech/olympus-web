(function () {
  'use strict';

  // The town view in the play view (planning/the-loom-layered-worlds.md §8;
  // L-345 / #399): a drawn map of the town the player stands in, from
  // loomGetMap's `town`. Places are labelled and tappable, the paths between
  // them are drawn, and the place card offers the one move it allows: walk to
  // any place there's an open way to, in one move (L-600 / #433), or set out
  // along a world route from a way out.
  // Moves are structured moves (Loom.play.travelTo), adjudicated and gated on
  // the server like typed ones.
  //
  // In a town with ground (planning/the-loom-movement-and-vision.md §8; L-664
  // / #471), the player walks its streets: a tap on open ground or on a place
  // previews the path, found with the server's own rules (town-paths.js),
  // this turn's part solid and the rest dashed, with how far and how many
  // turns; Walk goes as far as this turn's movement allows, Walk there plays
  // out the turns, Continue walks a kept plan, and the token walks the way.
  // Without art, the town's shapes are drawn.
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

  var METRES_PER_POINT = 20; // a point of movement walks 20 m in town (L-662)
  var MS_PER_UNIT = 6; // the token's walk: town units a millisecond, inverted
  var MAX_WALK_MS = 2500;

  var town = {
    data: null, // loomGetMap's `town`
    turn: null, // loomGetMap's `turn`
    positions: {}, // id → { x, y, auto }
    selected: null, // a place id
    art: { path: null, url: null }, // the town's image (L-347), once its URL is known
    target: null, // where a walk would go (L-664): { point } or { placeId }
    preview: null, // the walk there, as the server would find it
    pending: null, // a walk sent: { points }, for the token's walk when it lands
    anim: null, // the token's walk: { points, units, t0 }
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

  // Whether the save can walk to a place in one move: loomGetMap's `next`,
  // every place there's an open way to.
  function isNext(id) {
    return town.data.next.indexOf(id) !== -1;
  }

  // The world routes this way out serves: loomGetMap's exits.
  function exitsFrom(id) {
    return town.data.exits.filter(function (exit) {
      return exit.waysOut.indexOf(id) !== -1;
    });
  }

  // ── Data ──────────────────────────────────────────

  // Fetches the town's image URL from Cloud Storage, then redraws.
  function loadArt(image) {
    if (!image) {
      town.art = { path: null, url: null };
      return;
    }
    if (image.path === town.art.path) return;
    town.art = { path: image.path, url: null };
    firebase
      .storage()
      .ref(image.path)
      .getDownloadURL()
      .then(function (url) {
        if (town.art.path !== image.path) return; // the player moved on meanwhile
        town.art.url = url;
        Loom.map.render();
      })
      .catch(function (err) {
        console.error('Could not load the town art:', err);
      });
  }

  /** Takes loomGetMap's `town` (or null) and `turn`, and places what has no position. */
  function setData(data, turn) {
    var before = town.data;
    town.data = data || null;
    town.turn = turn || null;
    if (!data || !before || before.locationId !== data.locationId) {
      town.target = null;
      town.pending = null;
    }
    loadArt(data && data.image);
    var placed = data ? Loom.townLayout.layout(data.places, data.links) : {};
    town.positions = {};
    Object.keys(placed).forEach(function (id) {
      town.positions[id] = { x: placed[id].x + PAD, y: placed[id].y + PAD, auto: placed[id].auto };
    });
    if (town.selected && !placeById(town.selected)) town.selected = null;
    walkIfMoved();
    computePreview();
  }

  function reset() {
    setData(null);
    town.selected = null;
    town.anim = null;
  }

  // ── Walking (L-664) ───────────────────────────────

  var P = Loom.townPaths;

  /** Whether the player walks this town's streets now: it has ground, and they're off any map. */
  function walking() {
    return Boolean(town.data && town.data.ground && town.data.walks);
  }

  function isPoint(p) {
    return Boolean(p) && typeof p.x === 'number' && typeof p.y === 'number';
  }

  // Where the player stands, in town coordinates: on the street, or at the
  // door of the place they're at.
  function fromPoint() {
    var d = town.data;
    if (!d) return null;
    if (isPoint(d.at)) return d.at;
    var here = placeById(d.here);
    return here && isPoint(here.position) ? here.position : null;
  }

  function near(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y) < 0.5;
  }

  function movementLeft() {
    return town.turn ? town.turn.movementLeft : 0;
  }

  function metresPerTurn() {
    return ((town.turn && town.turn.speed) || 20) * METRES_PER_POINT;
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function now() {
    return window.performance ? window.performance.now() : Date.now();
  }

  // Where a target leads: a point, or a place's door.
  function targetPoint(target) {
    if (!target) return null;
    if (target.point) return target.point;
    var place = placeById(target.placeId);
    return place && isPoint(place.position) ? place.position : null;
  }

  // Whether a town point is inside a building or water no crossing covers.
  function offOpenGround(point) {
    var g = town.data.ground;
    var inside = P.geometry.inside;
    var ring = function (shape) {
      return P.geometry.closedRing(shape.points);
    };
    var within = function (list) {
      return (list || []).some(function (shape) {
        return inside(ring(shape), point);
      });
    };
    return within(g.buildings) || (within(g.water) && !within(g.crossings));
  }

  // The walk to the target, as the server would go (town-steps.js): the
  // part this turn's movement covers, the rest, how far, and how many turns.
  function computePreview() {
    town.preview = null;
    if (!walking() || !town.target) return;
    var from = fromPoint();
    var to = targetPoint(town.target);
    if (!from || !to) return;
    if (near(from, to)) {
      town.preview = { here: true };
      return;
    }
    var path = P.pathTo(town.data.ground, from, to, { size: town.data.size });
    if (!path) {
      town.preview = town.target.point && offOpenGround(to) ? { blocked: true } : { none: true };
      return;
    }
    var w = P.walk(path, movementLeft() * METRES_PER_POINT);
    var walked = w.arrived
      ? path.points
      : path.points.slice(0, path.points.length - w.rest.points.length + 1).concat([w.to]);
    if (w.walked <= 0) walked = [];
    var later = w.arrived ? [] : w.rest.points;
    var restTurns = w.arrived ? 0 : Math.ceil(w.rest.metres / metresPerTurn() - 1e-9);
    town.preview = {
      path: path,
      walked: walked,
      later: later,
      metres: path.metres,
      thisTurn: w.arrived,
      turns: (walked.length ? 1 : 0) + restTurns,
      fromNextTurn: !walked.length,
    };
  }

  // The kept plan (L-662), for drawing dashed when nothing is chosen.
  function planPath() {
    var plan = town.turn && town.turn.plan;
    if (!walking() || !plan || plan.layer !== 'town' || plan.locationId !== town.data.locationId) {
      return null;
    }
    var from = fromPoint();
    return from ? P.pathTo(town.data.ground, from, plan.to, { size: town.data.size }) : null;
  }

  // A walk sent from here has landed: walk the token along the way it went,
  // to where the player stands now (else it simply jumps).
  function walkIfMoved() {
    var pending = town.pending;
    town.pending = null;
    if (!pending || !walking() || reducedMotion()) return;
    var at = fromPoint();
    var points = pending.points;
    var end = points[points.length - 1];
    if (!at || !end || !near(at, end) || points.length < 2) return;
    var units = 0;
    for (var i = 1; i < points.length; i++) {
      units += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    town.anim = { points: points, units: units, t0: now() };
    town.target = null;
    window.requestAnimationFrame(frame);
  }

  function walkMs(anim) {
    return Math.min(MAX_WALK_MS, anim.units * MS_PER_UNIT);
  }

  function frame() {
    var anim = town.anim;
    if (!anim) return;
    if (now() - anim.t0 >= walkMs(anim)) {
      town.anim = null;
      Loom.map.render();
      return;
    }
    Loom.map.redrawOverlay();
    window.requestAnimationFrame(frame);
  }

  // Where the token is drawn, in town coordinates: along its walk, or where
  // the player stands.
  function tokenPoint() {
    var anim = town.anim;
    if (!anim) return fromPoint();
    var left = (Math.min(1, (now() - anim.t0) / walkMs(anim)) || 0) * anim.units;
    var pts = anim.points;
    for (var i = 1; i < pts.length; i++) {
      var leg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (left <= leg) {
        var t = leg ? left / leg : 0;
        return {
          x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
          y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
        };
      }
      left -= leg;
    }
    return pts[pts.length - 1];
  }

  // The town's shapes, for a town without art.
  function drawGround(overlay, view) {
    var g = town.data.ground;
    var toPoints = function (shape) {
      return shape.points
        .map(function (p) {
          var s = M.toScreen(view, p.x + PAD, p.y + PAD);
          return s.x + ',' + s.y;
        })
        .join(' ');
    };
    var shapes = function (list, tag, className) {
      (list || []).forEach(function (shape) {
        overlay.appendChild(svg(tag, { class: className, points: toPoints(shape) }));
      });
    };
    shapes(g.water, 'polygon', 'loom-town-water');
    (g.crossings || []).forEach(function (shape) {
      overlay.appendChild(
        svg('polygon', {
          class: 'loom-town-crossing' + (shape.kind === 'ford' ? ' is-ford' : ''),
          points: toPoints(shape),
        })
      );
    });
    shapes(g.buildings, 'polygon', 'loom-town-building');
    shapes(g.walls, 'polyline', 'loom-town-wall');
  }

  // A line through town points, in screen space.
  function line(overlay, view, points, className) {
    if (points.length < 2) return;
    overlay.appendChild(
      svg('polyline', {
        class: className,
        points: points
          .map(function (p) {
            var s = M.toScreen(view, p.x + PAD, p.y + PAD);
            return s.x + ',' + s.y;
          })
          .join(' '),
      })
    );
  }

  // The walk: the preview, or the kept plan; the target; and you.
  function drawWalk(overlay, view) {
    var preview = town.preview;
    if (preview && preview.path && !town.anim) {
      line(overlay, view, preview.walked, 'loom-town-walk');
      line(overlay, view, preview.later, 'loom-town-walk is-later');
    } else if (!town.target && !town.anim) {
      var plan = planPath();
      if (plan) line(overlay, view, plan.points, 'loom-town-walk is-later is-plan');
    }
    if (town.target && town.target.point) {
      var t = M.toScreen(view, town.target.point.x + PAD, town.target.point.y + PAD);
      overlay.appendChild(svg('circle', { class: 'loom-town-target', cx: t.x, cy: t.y, r: 7 }));
    }
    var you = tokenPoint();
    if (you) {
      var s = M.toScreen(view, you.x + PAD, you.y + PAD);
      overlay.appendChild(svg('circle', { class: 'loom-town-you', cx: s.x, cy: s.y, r: 7 }));
    }
  }

  // Sends a walk: as far as this turn goes (Walk), or all the way (Walk there).
  function sendWalk(there) {
    var target = town.target;
    var preview = town.preview;
    if (!target || !preview || !preview.path) return;
    var place = target.placeId ? placeById(target.placeId) : null;
    town.pending = { points: there || preview.thisTurn ? preview.path.points : preview.walked };
    var label =
      (there ? 'walk to ' : 'walk toward ') + (place ? place.name : 'a spot in the street');
    var action = place ? { target: place.id } : { point: { x: target.point.x, y: target.point.y } };
    if (there) Loom.play.walkThere(action, label);
    else Loom.play.walkTo(action, label);
  }

  function distance(metres) {
    return metres >= 1000 ? (metres / 1000).toFixed(1) + ' km' : Math.round(metres) + ' m';
  }

  // "320 m · this turn", "1.2 km · 3 turns", "2 turns, from next turn".
  function walkLine(preview) {
    var when;
    if (preview.thisTurn) when = 'this turn';
    else if (preview.fromNextTurn) {
      when = preview.turns === 1 ? 'next turn' : preview.turns + ' turns, from next turn';
    } else when = preview.turns + ' turns';
    return distance(preview.metres) + ' · ' + when;
  }

  // The card's walking part: the preview's line and Walk and Walk there.
  function renderWalk(info) {
    var preview = town.preview;
    if (!preview) return;
    if (preview.blocked) {
      info.appendChild(el('p', 'loom-map-info-status is-closed', "You can't stand there."));
      return;
    }
    if (preview.none) {
      info.appendChild(
        el('p', 'loom-map-info-status is-closed', "There's no way there from here.")
      );
      return;
    }
    if (preview.here) return;
    info.appendChild(el('p', 'loom-map-info-facts loom-town-walk-line', walkLine(preview)));
    var row = el('div', 'loom-map-turn');
    if (preview.walked.length) {
      row.appendChild(
        button('Walk', function () {
          sendWalk(false);
        })
      );
    }
    if (!preview.thisTurn) {
      row.appendChild(
        button('Walk there', function () {
          sendWalk(true);
        })
      );
    }
    info.appendChild(row);
  }

  // The turn (as on battle maps, L-615): movement left, Continue for a kept
  // plan, and End turn.
  function renderTurn(info) {
    var turn = town.turn;
    if (!turn) return;
    info.appendChild(
      el(
        'p',
        'loom-map-info-facts loom-map-turn-state',
        'Turn ' +
          turn.n +
          ' · ' +
          distance(turn.movementLeft * METRES_PER_POINT) +
          ' left to walk · ' +
          (turn.actionUsed ? 'you have acted' : 'your action is ready')
      )
    );
    var row = el('div', 'loom-map-turn');
    var plan = planPath();
    if (plan && turn.movementLeft > 0) {
      row.appendChild(
        button('Continue', function () {
          var w = P.walk(plan, turn.movementLeft * METRES_PER_POINT);
          town.pending = {
            points: w.arrived
              ? plan.points
              : plan.points.slice(0, plan.points.length - w.rest.points.length + 1).concat([w.to]),
          };
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
    if (walking()) {
      var from = fromPoint();
      return from ? { x: from.x + PAD, y: from.y + PAD } : null;
    }
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

    // The town's art (L-347), fitted inside the town's square, behind the
    // paths and places.
    var image = town.data.image;
    if (image && town.art.url && town.art.path === image.path) {
      var aspect = image.width / image.height || 1;
      var w = aspect >= 1 ? SPAN : SPAN * aspect;
      var h = aspect >= 1 ? SPAN / aspect : SPAN;
      var topLeft = M.toScreen(view, PAD + (SPAN - w) / 2, PAD + (SPAN - h) / 2);
      var bottomRight = M.toScreen(view, PAD + (SPAN + w) / 2, PAD + (SPAN + h) / 2);
      overlay.appendChild(
        svg('image', {
          class: 'loom-town-art',
          href: town.art.url,
          x: topLeft.x,
          y: topLeft.y,
          width: bottomRight.x - topLeft.x,
          height: bottomRight.y - topLeft.y,
          preserveAspectRatio: 'none',
        })
      );
    }

    // Without art, the town's shapes (L-664).
    if (town.data.ground && !(image && town.art.url)) drawGround(overlay, view);

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

    if (walking()) drawWalk(overlay, view);
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
    if (!walking()) return;
    // A tap skips the token's walk to its end.
    if (town.anim) {
      town.anim = null;
      return;
    }
    // In a town with ground (L-664): a place's door, or a point on the street.
    if (best) {
      town.target = { placeId: best.id };
    } else {
      var m = M.toMap(view, point.x, point.y);
      var spot = { x: Math.round(m.x - PAD), y: Math.round(m.y - PAD) };
      var inTown = spot.x >= 0 && spot.y >= 0 && spot.x <= SPAN && spot.y <= SPAN;
      town.target = inTown ? { point: spot } : null;
    }
    computePreview();
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
    if (walking()) {
      renderWalkingInfo(info, act);
      return;
    }
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
        button('Walk here', function () {
          act(place.id, place.name);
        })
      );
    } else {
      info.appendChild(el('p', 'loom-map-info-status', "There's no open way there from here."));
    }
    if (place.entranceFor) routesOut(info, place, act, false);
  }

  // The card in a town the player walks (L-664): the place or spot chosen,
  // the walk there, and the turn.
  function renderWalkingInfo(info, act) {
    var place = placeById(town.selected);
    var from = fromPoint();
    if (place) {
      info.appendChild(el('h3', 'loom-map-info-name', place.name));
      var facts = [capitalised(place.kind)];
      if (place.entranceFor) facts.push('Way in and out by ' + listOf(place.entranceFor));
      info.appendChild(el('p', 'loom-map-info-facts', facts.join(' · ')));
      var atDoor = from && isPoint(place.position) && near(from, place.position);
      if (atDoor) {
        info.appendChild(el('p', 'loom-map-info-status', 'You are at its door.'));
        if (place.entranceFor) routesOut(info, place, act, true);
        info.appendChild(
          button('Go in', function () {
            act(place.id, place.name);
          })
        );
      } else if (place.retired) {
        info.appendChild(
          el('p', 'loom-map-info-status is-closed', "That place can't be reached anymore.")
        );
      } else if (!place.open) {
        info.appendChild(
          el('p', 'loom-map-info-status is-closed', 'Not built yet. The way is closed.')
        );
      } else {
        renderWalk(info);
      }
    } else if (town.target && town.target.point) {
      info.appendChild(el('h3', 'loom-map-info-name', 'A spot in the street'));
      renderWalk(info);
    } else {
      info.appendChild(
        el(
          'p',
          'loom-map-hint',
          'You are in ' +
            town.data.name +
            '. Tap the street or a place to walk there. Drag to pan, pinch or scroll to zoom.'
        )
      );
    }
    renderTurn(info);
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
