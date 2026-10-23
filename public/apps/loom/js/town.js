(function () {
  'use strict';

  // The town level of the map engine (planning/the-map-first-loom.md §4.3;
  // L-723 / #594), from loomGetMap's `town` (planning/the-loom-layered-
  // worlds.md §8): the town's art, or its ground where it has none, its
  // places and the paths between them, its fog, and you.
  //
  // - Every click opens the engine's menu (I2), with no one-tap shortcuts:
  //   on a place, Move (walk there, go in) and Look, and on a way out, Set
  //   out along each route it serves, from anywhere in town (#669), the
  //   routes labelled where its stub of road leads off; in a town with
  //   ground (L-664), on the street too. Move is one choice (#671): there
  //   this turn, or there across the turns it takes. Moves are structured moves (Loom.play), adjudicated and gated
  //   on the server like typed ones.
  // - Walks are previewed with the server's own rules (town-paths.js): this
  //   turn's part solid, the rest dashed, with how far and how many turns;
  //   the token walks the way it went.
  // - The fog (L-672): dark where never seen, less dark where seen, clear in
  //   sight; plain dimming until L-724 brings the soft fog. Places not found
  //   yet aren't sent (L-673), so they stay hidden.
  // - You are a token (A6): a disc with your initials.
  //
  // Everything is drawn in screen space from town coordinates (0–1000 each
  // way, PAD around them); places without a position are placed by
  // town-layout.js.

  var Loom = window.Loom;
  var state = Loom.state;
  var M = Loom.mapMath;
  var engine = Loom.engine;
  var HIT_RADIUS = 20; // px around a place that a click selects
  var STUB = 30; // px: the stub of road leading out from a way out
  var SPAN = Loom.townLayout.SPAN;
  // The view's space is the town's 0–1000 with room around it, so a place at
  // the edge of town still has room for its label.
  var PAD = 140;
  var BOUNDS = { width: SPAN + 2 * PAD, height: SPAN + 2 * PAD };

  var METRES_PER_POINT = 20; // a point of movement walks 20 m in town (L-662)
  var MS_PER_UNIT = 6; // the token's walk: town units a millisecond, inverted
  var MAX_WALK_MS = 2500;

  var COLOURS = {
    groundFill: 0xd7b98a,
    road: 0xffb74d,
    trail: 0xd7b98a,
    sea: 0x4fc3f7,
    casing: 0x0a0e1a,
    path: 0xcbbd9f,
    pathClosed: 0x4b5563,
    water: 0x286ee6,
    waterEdge: 0x78b4ff,
    crossing: 0xdeb86e,
    crossingEdge: 0xffecb3,
    ford: 0xbeebff,
    building: 0xb07048,
    buildingEdge: 0xf0be96,
    wall: 0xebebeb,
    open: 0xa5d6a7,
    entrance: 0x80cbc4,
    closed: 0x4b5563,
    closedEdge: 0x9ca3af,
    near: 0xffb74d,
    here: 0xffb74d,
    selected: 0xffffff,
    walk: 0xffb74d,
    target: 0xffffff,
    you: 0xffffff,
    label: 0xe0e0e0,
    labelClosed: 0x9ca3af,
    route: 0xffe0b2,
  };

  var town = {
    data: null, // loomGetMap's `town`
    turn: null, // loomGetMap's `turn`
    positions: {}, // id → { x, y, auto }
    selected: null, // a place id
    art: null, // the town's image (L-347; Loom.draw.art): its copy, then the full image
    target: null, // where a walk would go (L-664): { point } or { placeId }
    preview: null, // the walk there, as the server would find it
    pending: null, // a walk sent: { points }, for the token's walk when it lands
    anim: null, // the token's walk: { points, units, t0 }
    nodes: null, // the PixiJS objects, built on first draw
    labels: {}, // place id → its label
    routeLabels: {}, // way out id → the label of the routes it serves (#669)
    fog: { key: null, texture: null },
    mist: { key: null, texture: null, unseen: 0 }, // the mist over unseen ground (K3)
    mistAt: null, // where the mist is drawn this frame: { x, y, width, height }
  };

  // ── Helpers ───────────────────────────────────────

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
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

  // Loads the town's art (a library image's link, or from Cloud Storage for
  // older art): its screen-sized copy first, the full image once zoomed in
  // (A1; L-727).
  function loadArt(image) {
    if (!town.art) {
      town.art = Loom.draw.art(function () {
        engine.draw();
      }, 'town art');
    }
    town.art.set(image);
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
    engine.draw();
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

  // ── Fog (L-672) ───────────────────────────────────

  var FOG_UNSEEN = 0.72; // never seen: dark, the town still showing through
  var FOG_SEEN = 0.38; // seen before, out of sight now: less dark
  var MIST = 0.18; // the drifting mist over unseen ground, at its thickest (K3)
  var MIST_PERIOD = 9; // s for the mist to thin and thicken
  var SHIMMER_PERIOD = 3.5; // s for the water's shimmer to come and go

  function bitsOf(packed, size) {
    var bytes = window.atob(packed || '');
    var bits = new Uint8Array(size);
    for (var i = 0; i < size; i++) {
      if (bytes.charCodeAt(i >> 3) & (1 << (i & 7))) bits[i] = 1;
    }
    return bits;
  }

  // The fog as a texture the size of the walking grid (a pixel a square),
  // stretched over the town and smoothed: dark where never seen, less dark
  // where seen before, clear where in sight.
  function fogTexture(fog) {
    var key = fog.side + '|' + fog.seen + '|' + fog.inSight;
    if (town.fog.key === key) return town.fog.texture;
    var side = fog.side;
    var seen = bitsOf(fog.seen, side * side);
    var now = bitsOf(fog.inSight, side * side);
    var canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    var context = canvas.getContext('2d');
    var image = context.createImageData(side, side);
    for (var i = 0; i < side * side; i++) {
      var alpha = now[i] ? 0 : seen[i] ? FOG_SEEN : FOG_UNSEEN;
      image.data[i * 4] = 6;
      image.data[i * 4 + 1] = 9;
      image.data[i * 4 + 2] = 18;
      image.data[i * 4 + 3] = Math.round(alpha * 255);
    }
    context.putImageData(image, 0, 0);
    if (town.fog.texture) town.fog.texture.destroy(true);
    var texture = window.PIXI.Texture.from(canvas);
    texture.source.scaleMode = 'linear';
    town.fog = { key: key, texture: texture };
    return texture;
  }

  // A deterministic grain, 0–1, at whole points.
  function grain(x, y) {
    var h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
  }

  // Smooth noise, 0–1, its features about `size` across: the mist's clouds.
  function noise(x, y, size) {
    var gx = x / size;
    var gy = y / size;
    var x0 = Math.floor(gx);
    var y0 = Math.floor(gy);
    var fx = gx - x0;
    var fy = gy - y0;
    var sx = fx * fx * (3 - 2 * fx);
    var sy = fy * fy * (3 - 2 * fy);
    var a = grain(x0, y0);
    var b = grain(x0 + 1, y0);
    var c = grain(x0, y0 + 1);
    var d = grain(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  // The mist over unseen ground (K3; L-727), one layer the ambient touches
  // drift and thin and thicken: soft clouds some walking squares across.
  function mistTextures(fog) {
    var key = fog.side + '|' + fog.seen;
    if (town.mist.key === key) return town.mist;
    var side = fog.side;
    var seen = bitsOf(fog.seen, side * side);
    var unseen = 0;
    var make = function () {
      var canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      var context = canvas.getContext('2d');
      var image = context.createImageData(side, side);
      for (var i = 0; i < side * side; i++) {
        if (seen[i]) continue;
        unseen += 1;
        var x = i % side;
        var y = Math.floor(i / side);
        var blotch = noise(x, y, 9);
        image.data[i * 4] = 84;
        image.data[i * 4 + 1] = 98;
        image.data[i * 4 + 2] = 128;
        image.data[i * 4 + 3] = Math.round(MIST * blotch * 255);
      }
      context.putImageData(image, 0, 0);
      var texture = window.PIXI.Texture.from(canvas);
      texture.source.scaleMode = 'linear';
      return texture;
    };
    if (town.mist.texture) town.mist.texture.destroy(true);
    town.mist = { key: key, texture: make(), unseen: 0 };
    town.mist.unseen = unseen;
    return town.mist;
  }

  // ── Walks ─────────────────────────────────────────

  // Sends a walk: there this turn, or all the way across the turns (Walk
  // there's walk; #671).
  function sendWalk(there) {
    var target = town.target;
    var preview = town.preview;
    if (!target || !preview || !preview.path) return;
    var place = target.placeId ? placeById(target.placeId) : null;
    town.pending = { points: there || preview.thisTurn ? preview.path.points : preview.walked };
    var label = 'walk to ' + (place ? place.name : 'a spot in the street');
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

  // Why the preview can't be walked, or null.
  function walkRefusal(preview) {
    if (!preview) return "There's no way there from here.";
    if (preview.blocked) return "You can't stand there.";
    if (preview.none) return "There's no way there from here.";
    return null;
  }

  // A move to a place in town, or along a route out of it.
  function act(id, name) {
    Loom.play.travelTo(id, name);
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
    town.target = null;
    computePreview();
  }

  // ── Drawing ───────────────────────────────────────

  function build(container) {
    var PIXI = window.PIXI;
    var n = {
      ground: new PIXI.Graphics(),
      art: new PIXI.Sprite(),
      shapes: new PIXI.Graphics(),
      fog: new PIXI.Sprite(),
      mist: new PIXI.Sprite(),
      shimmer: new PIXI.Graphics(), // the water's shimmer, over a town drawn from its ground
      paths: new PIXI.Graphics(),
      pins: new PIXI.Graphics(),
      labels: new PIXI.Container(),
      routes: new PIXI.Container(),
      walk: new PIXI.Graphics(),
      you: Loom.draw.token(),
    };
    n.art.alpha = 0.9;
    container.addChild(n.ground, n.art, n.shapes, n.shimmer, n.fog, n.mist);
    container.addChild(n.paths, n.pins, n.routes, n.labels, n.walk);
    container.addChild(n.you.container);
    town.nodes = n;
  }

  function toScreen(view, p) {
    return M.toScreen(view, p.x + PAD, p.y + PAD);
  }

  // The town's shapes, for a town without art; its water again on `shimmer`,
  // which the ambient touches bring and take away (K3).
  function drawGround(g, view, shimmer) {
    var ground = town.data.ground;
    var flat = function (shape) {
      var out = [];
      shape.points.forEach(function (p) {
        var s = toScreen(view, p);
        out.push(s.x, s.y);
      });
      return out;
    };
    (ground.water || []).forEach(function (shape) {
      g.poly(flat(shape))
        .fill({ color: COLOURS.water, alpha: 0.45 })
        .stroke({ width: 1, color: COLOURS.waterEdge, alpha: 0.8 });
      if (shimmer) shimmer.poly(flat(shape)).fill({ color: COLOURS.waterEdge, alpha: 1 });
    });
    if (shimmer) {
      shimmer.visible = Boolean((ground.water || []).length) && !reducedMotion();
      shimmer.alpha = 0;
    }
    (ground.crossings || []).forEach(function (shape) {
      var ford = shape.kind === 'ford';
      g.poly(flat(shape))
        .fill({ color: ford ? COLOURS.ford : COLOURS.crossing, alpha: ford ? 0.6 : 0.85 })
        .stroke({ width: 1, color: COLOURS.crossingEdge, alpha: 0.9 });
    });
    (ground.buildings || []).forEach(function (shape) {
      g.poly(flat(shape))
        .fill({ color: COLOURS.building, alpha: 0.7 })
        .stroke({ width: 1, color: COLOURS.buildingEdge, alpha: 0.85 });
    });
    (ground.walls || []).forEach(function (shape) {
      var pts = shape.points.map(function (p) {
        return toScreen(view, p);
      });
      Loom.draw.polyline(g, pts);
      g.stroke({ width: 4, color: COLOURS.wall, cap: 'round', join: 'round' });
    });
  }

  // The walk: the preview, or the kept plan; the target.
  function drawWalk(g, view) {
    var screen = function (list) {
      return list.map(function (p) {
        return toScreen(view, p);
      });
    };
    var preview = town.preview;
    if (preview && preview.path && !town.anim) {
      Loom.draw.polyline(g, screen(preview.walked));
      g.stroke({ width: 3, color: COLOURS.walk, cap: 'round', join: 'round' });
      Loom.draw.polyline(g, screen(preview.later), [2, 7]);
      g.stroke({ width: 3, color: COLOURS.walk, alpha: 0.85, cap: 'round' });
    } else if (!town.target && !town.anim) {
      var plan = planPath();
      if (plan) {
        Loom.draw.polyline(g, screen(plan.points), [2, 7]);
        g.stroke({ width: 3, color: COLOURS.walk, alpha: 0.5, cap: 'round' });
      }
    }
    if (town.target && town.target.point) {
      var t = toScreen(view, town.target.point);
      g.circle(t.x, t.y, 7).stroke({ width: 2, color: COLOURS.target });
    }
  }

  // The end of the stub of road leading out from a way out, on screen: away
  // from the middle of town.
  function stubEnd(view, place) {
    var p = town.positions[place.id];
    var s = M.toScreen(view, p.x, p.y);
    var middle = M.toScreen(view, BOUNDS.width / 2, BOUNDS.height / 2);
    var dx = s.x - middle.x;
    var dy = s.y - middle.y;
    var d = Math.hypot(dx, dy) || 1;
    return { x: s.x + (dx / d) * STUB, y: s.y + (dy / d) * STUB, dx: dx / d, dy: dy / d };
  }

  // The places a way out's routes lead to, as a label beyond its stub
  // (#669): "To Dunscombe · about 14½ hours by sea", one line a route, all
  // dimmed when every one is closed. Null when it serves none the save
  // knows of.
  function routeLabelFor(place, end) {
    var exits = exitsFrom(place.id);
    var label = town.routeLabels[place.id];
    if (!exits.length) return null;
    if (!label) {
      label = Loom.draw.label('', 11.5);
      town.routeLabels[place.id] = label;
      town.nodes.routes.addChild(label);
    }
    label.text = exits
      .map(function (exit) {
        var trip = exit.open && exit.travel && exit.travel.label;
        return 'To ' + exit.name + (exit.open ? (trip ? ' · ' + trip : '') : ' (closed)');
      })
      .join('\n');
    var open = exits.some(function (exit) {
      return exit.open;
    });
    label.style.fill = open ? COLOURS.route : COLOURS.labelClosed;
    label.style.align = 'center';
    // Beyond the stub's end, on the side it leads away to.
    label.anchor.set(0.5 - end.dx * 0.5, end.dy < -0.5 ? 1 : end.dy > 0.5 ? 0 : 0.5);
    label.position.set(end.x + end.dx * 6, end.y + end.dy * 6);
    label.visible = true;
    return label;
  }

  function labelFor(place) {
    var label = town.labels[place.id];
    if (!label) {
      label = Loom.draw.label(place.name, 12.5);
      town.labels[place.id] = label;
      town.nodes.labels.addChild(label);
    }
    var here = place.id === town.data.here;
    var shut = !place.open || place.retired;
    label.text = place.name;
    label.style.fill = here ? COLOURS.here : shut ? COLOURS.labelClosed : COLOURS.label;
    label.style.fontWeight = here ? '600' : 'normal';
    return label;
  }

  /** Draws the town for a view in town coordinates (+ PAD). */
  function draw(container, view) {
    if (!town.nodes) build(container);
    var n = town.nodes;
    var data = town.data;
    if (!data) return;
    var corner = M.toScreen(view, PAD, PAD);
    var far = M.toScreen(view, PAD + SPAN, PAD + SPAN);
    var width = far.x - corner.x;
    var height = far.y - corner.y;

    n.ground.clear();
    n.ground
      .roundRect(corner.x, corner.y, width, height, 18)
      .fill({ color: COLOURS.groundFill, alpha: 0.05 })
      .stroke({ width: 1, color: COLOURS.groundFill, alpha: 0.18 });

    // The town's art (L-347), fitted inside the town's square, behind the
    // paths and places.
    var image = data.image;
    var art = image && town.art && town.art.ready(image);
    n.art.visible = Boolean(art);
    if (art) {
      var aspect = image.width / image.height || 1;
      var w = aspect >= 1 ? SPAN : SPAN * aspect;
      var h = aspect >= 1 ? SPAN / aspect : SPAN;
      var topLeft = M.toScreen(view, PAD + (SPAN - w) / 2, PAD + (SPAN - h) / 2);
      n.art.texture = town.art.texture;
      town.art.sharpen(Loom.draw.devicePx(Math.max(w, h) * view.scale));
      n.art.position.set(topLeft.x, topLeft.y);
      n.art.width = w * view.scale;
      n.art.height = h * view.scale;
    }

    // Without art, the town's shapes (L-664); over them, the fog (L-672).
    n.shapes.clear();
    n.shimmer.clear();
    if (data.ground && !art) drawGround(n.shapes, view, n.shimmer);
    n.fog.visible = Boolean(data.fog);
    if (data.fog) {
      n.fog.texture = fogTexture(data.fog);
      n.fog.position.set(corner.x, corner.y);
      n.fog.width = width;
      n.fog.height = height;
    }
    // The mist drifts over unseen ground, only while the ambient touches run.
    var mist = data.fog && !reducedMotion() ? mistTextures(data.fog) : null;
    var misty = Boolean(mist && mist.unseen);
    town.mistAt = misty ? { x: corner.x, y: corner.y, width: width, height: height } : null;
    n.mist.visible = misty;
    if (misty) {
      n.mist.texture = mist.texture;
      n.mist.position.set(corner.x, corner.y);
      n.mist.width = width;
      n.mist.height = height;
    }

    var at = function (id) {
      var p = town.positions[id];
      return p && M.toScreen(view, p.x, p.y);
    };

    // The roads out of town, as stubs leading away from the middle; the
    // paths between places, in a town without ground.
    var g = n.paths;
    g.clear();
    var routesShown = {};
    data.places.forEach(function (place) {
      if (!place.entranceFor) return;
      var s = at(place.id);
      var via = exitsFrom(place.id).map(function (exit) {
        return exit.via;
      })[0];
      via = via || place.entranceFor[0];
      var end = stubEnd(view, place);
      // Where the routes lead (#669), at the end of the stub: a click there
      // is a click on the way out.
      var routes = routeLabelFor(place, end);
      if (routes) routesShown[place.id] = true;
      Loom.draw.line(g, s, end);
      g.stroke({ width: 5.5, color: COLOURS.casing, alpha: 0.55, cap: 'round' });
      var colour = COLOURS[via] ? via : 'road';
      Loom.draw.line(g, s, end, colour === 'trail' ? [6, 5] : colour === 'sea' ? [2, 6] : null);
      g.stroke({ width: 3, color: COLOURS[colour], cap: 'round' });
    });
    data.links.forEach(function (link) {
      var s = at(link.from);
      var t = at(link.to);
      if (!s || !t) return;
      var a = placeById(link.from);
      var b = placeById(link.to);
      var shut = !a.open || !b.open || a.retired || b.retired;
      Loom.draw.line(g, s, t);
      g.stroke({ width: 8, color: COLOURS.casing, alpha: 0.6, cap: 'round' });
      Loom.draw.line(g, s, t, shut ? [4, 5] : null);
      g.stroke({ width: 4, color: shut ? COLOURS.pathClosed : COLOURS.path, cap: 'round' });
    });

    // The places.
    var pins = n.pins;
    pins.clear();
    var shown = {};
    data.places.forEach(function (place) {
      var s = at(place.id);
      var here = place.id === data.here;
      var shut = !place.open || place.retired;
      var r = 8;
      if (here) pins.circle(s.x, s.y, 14).stroke({ width: 2, color: COLOURS.here });
      if (place.entranceFor) pins.roundRect(s.x - r, s.y - r, r * 2, r * 2, 3);
      else pins.circle(s.x, s.y, r);
      var fill = here
        ? COLOURS.here
        : shut
          ? COLOURS.closed
          : place.entranceFor
            ? COLOURS.entrance
            : COLOURS.open;
      var edge = COLOURS.casing;
      var edgeWidth = 2;
      if (shut) edge = COLOURS.closedEdge;
      if (!walking() && isNext(place.id)) edge = COLOURS.near;
      if (place.id === town.selected) {
        edge = COLOURS.selected;
        edgeWidth = 3;
      }
      pins.fill({ color: fill }).stroke({ width: edgeWidth, color: edge });
      if (shut) Loom.draw.padlock(pins, s.x + r + 2, s.y - r - 3, COLOURS.closedEdge);
      var label = labelFor(place);
      label.position.set(s.x, s.y + r + 4);
      label.visible = true;
      shown[place.id] = true;
    });
    Object.keys(town.labels).forEach(function (id) {
      if (!shown[id]) town.labels[id].visible = false;
    });
    Object.keys(town.routeLabels).forEach(function (id) {
      if (!routesShown[id]) town.routeLabels[id].visible = false;
    });

    // The walk and you.
    n.walk.clear();
    if (walking()) drawWalk(n.walk, view);
    var you = walking() ? tokenPoint() : null;
    n.you.container.visible = Boolean(you);
    if (you) {
      var p = toScreen(view, you);
      var save = Loom.store.get().save;
      n.you.update({
        x: p.x,
        y: p.y,
        radius: 9,
        name: save && save.characterName,
        fill: COLOURS.you,
        ring: COLOURS.here,
      });
    }
  }

  // ── Clicks: the menu (I2) ─────────────────────────

  // The place nearest a point in the panel, if close enough.
  function placeAt(point, view) {
    var best = null;
    points().forEach(function (p) {
      var s = M.toScreen(view, p.x, p.y);
      var d = Math.hypot(s.x - point.x, s.y - point.y);
      if (d <= HIT_RADIUS && (!best || d < best.d)) best = { id: p.id, d: d };
    });
    if (best) return placeById(best.id);
    // A way out's routes (#669): a click on the label is one on the way out.
    var hit = null;
    Object.keys(town.routeLabels).forEach(function (id) {
      var label = town.routeLabels[id];
      if (!label.visible || hit) return;
      var b = label.getBounds();
      var pad = 6;
      if (
        point.x >= b.x - pad &&
        point.x <= b.x + b.width + pad &&
        point.y >= b.y - pad &&
        point.y <= b.y + b.height + pad
      ) {
        hit = id;
      }
    });
    return hit ? placeById(hit) : null;
  }

  function factsOf(place) {
    var facts = [capitalised(place.kind)];
    if (place.entranceFor) facts.push('Way in and out by ' + listOf(place.entranceFor));
    return facts.join(' · ');
  }

  // Setting out along the world routes from a way out: from where you
  // stand anywhere in town (#669), the server walking you there first (on
  // the streets, turn after turn; through the town's places, in one go).
  function setOutItems(place, away) {
    if (place.retired || !place.open) return [];
    var items = [];
    var first = away ? 'Walking to ' + place.name + ' first' : null;
    exitsFrom(place.id).forEach(function (exit) {
      var label = exit.name + (exit.via ? ' by ' + exit.via : '');
      if (!exit.open) {
        items.push({ label: 'Set out for ' + label, disabled: true, note: 'The way is closed.' });
        return;
      }
      var note = [first, exit.travel && exit.travel.label].filter(Boolean).join(' · ') || undefined;
      var ways = exit.waysIn || [];
      if (ways.length > 1) {
        // Where to arrive (L-346): travelling to a way in arrives by it.
        ways.forEach(function (way) {
          items.push({
            label: 'Set out for ' + label + ', arriving by ' + way.name,
            note: note,
            onSelect: function () {
              act(way.id, exit.name + ' by ' + way.name);
            },
          });
        });
      } else {
        items.push({
          label: 'Set out for ' + label,
          note: note,
          onSelect: function () {
            act(exit.id, exit.name);
          },
        });
      }
    });
    return items;
  }

  // The one walk item (#671): Move, there this turn, or there across the
  // turns it takes (Walk there's walk, which stops when something comes into
  // view), from the next turn when this one has no movement left. To go only
  // part of the way, tap a nearer spot: the preview shows this turn's reach.
  function walkItems() {
    var preview = town.preview;
    var no = walkRefusal(preview);
    if (no) return [{ label: 'Move', disabled: true, note: no }];
    return [
      {
        label: 'Move',
        note: walkLine(preview),
        onSelect: function () {
          sendWalk(!preview.thisTurn);
        },
      },
    ];
  }

  // What Move does for a place: walk there, go in, or why not.
  function placeItems(place) {
    var here = place.id === town.data.here;
    if (walking()) {
      var from = fromPoint();
      var atDoor = from && isPoint(place.position) && near(from, place.position);
      if (atDoor) {
        var items = [
          {
            label: 'Go in',
            onSelect: function () {
              act(place.id, place.name);
            },
          },
        ];
        return place.entranceFor ? items.concat(setOutItems(place)) : items;
      }
      if (place.retired) {
        return [{ label: 'Move', disabled: true, note: "That place can't be reached anymore." }];
      }
      if (!place.open) {
        return [{ label: 'Move', disabled: true, note: 'Not built yet. The way is closed.' }];
      }
      return place.entranceFor ? walkItems().concat(setOutItems(place, true)) : walkItems();
    }
    if (here) {
      var stay = [{ label: 'Move', disabled: true, note: 'You are here.' }];
      return place.entranceFor ? stay.concat(setOutItems(place)) : stay;
    }
    if (place.retired) {
      return [{ label: 'Move', disabled: true, note: "That place can't be reached anymore." }];
    }
    if (!place.open) {
      return [{ label: 'Move', disabled: true, note: 'Not built yet. The way is closed.' }];
    }
    var move = isNext(place.id)
      ? {
          label: 'Move',
          onSelect: function () {
            act(place.id, place.name);
          },
        }
      : { label: 'Move', disabled: true, note: "There's no open way there from here." };
    return place.entranceFor ? [move].concat(setOutItems(place, true)) : [move];
  }

  function busy(items) {
    if (!state.turnInProgress) return items;
    return items.map(function (item) {
      return item.disabled
        ? item
        : Object.assign({}, item, { disabled: true, note: 'A turn is under way.' });
    });
  }

  /** A click on the town (I2): what is there, and a menu for it. */
  function tap(point, view) {
    if (!town.data) return;
    // A click skips the token's walk to its end.
    if (town.anim) {
      town.anim = null;
      Loom.map.render();
      return;
    }
    var place = placeAt(point, view);
    town.selected = place ? place.id : null;
    town.target = null;
    if (walking()) {
      if (place) {
        town.target = { placeId: place.id };
      } else {
        var m = M.toMap(view, point.x, point.y);
        var spot = { x: Math.round(m.x - PAD), y: Math.round(m.y - PAD) };
        var inTown = spot.x >= 0 && spot.y >= 0 && spot.x <= SPAN && spot.y <= SPAN;
        town.target = inTown ? { point: spot } : null;
      }
    }
    computePreview();
    Loom.map.render();

    if (place) {
      engine.openMenu(point, {
        title: place.name,
        subtitle: factsOf(place),
        items: busy(placeItems(place)).concat([
          {
            label: 'Look',
            onSelect: function () {
              town.selected = place.id;
              town.target = null;
              computePreview();
              Loom.map.render();
            },
          },
        ]),
      });
    } else if (town.target && town.target.point) {
      engine.openMenu(point, { title: 'A spot in the street', items: busy(walkItems()) });
    }
  }

  /** A hover over a place shows it can be clicked. */
  function hover(point, view) {
    var over = point && town.data ? placeAt(point, view) : null;
    var street = !over && point && walking() && town.data;
    engine.panelCursor(over ? 'pointer' : street ? 'crosshair' : '');
  }

  // ── The card ──────────────────────────────────────

  /** Continue (L-662): walks the kept plan, the token walking it as it lands. */
  function continuePlan() {
    var turn = town.turn;
    var plan = planPath();
    if (plan && turn) {
      var w = P.walk(plan, turn.movementLeft * METRES_PER_POINT);
      town.pending = {
        points: w.arrived
          ? plan.points
          : plan.points.slice(0, plan.points.length - w.rest.points.length + 1).concat([w.to]),
      };
    }
    Loom.play.continuePlan();
  }

  /** The minimap's view of the town: its square, its art, its places and you. */
  function minimap() {
    var points = town.data.places.map(function (place) {
      var p = town.positions[place.id];
      var here = place.id === town.data.here;
      return {
        x: p.x,
        y: p.y,
        colour: here ? '#ffb74d' : place.open && !place.retired ? '#a5d6a7' : '#4b5563',
        r: here ? 3.5 : 2.5,
      };
    });
    var you = walking() ? tokenPoint() : null;
    if (you)
      points.push({ x: you.x + PAD, y: you.y + PAD, colour: '#ffffff', r: 3.5, ring: '#ffb74d' });
    var texture = town.art && town.art.texture;
    var art = texture && texture.source && texture.source.resource;
    return {
      rect: { x: PAD, y: PAD, width: SPAN, height: SPAN, fill: '#211f1c' },
      image: art || null,
      points: points,
    };
  }

  // The ways on from a way out, as facts.
  function waysOn(info, place) {
    var exits = exitsFrom(place.id);
    if (!exits.length) return;
    var names = exits.map(function (exit) {
      return exit.name + ' (' + (exit.via || 'route') + ')' + (exit.open ? '' : ', closed');
    });
    info.appendChild(el('p', 'loom-map-info-facts', 'Ways on from here: ' + names.join(', ')));
  }

  /** The card: the place or spot looked at, the walk there, and the turn. */
  function renderInfo(info) {
    info.innerHTML = '';
    var place = placeById(town.selected);
    if (place) {
      info.appendChild(el('h3', 'loom-map-info-name', place.name));
      info.appendChild(el('p', 'loom-map-info-facts', factsOf(place)));
      var status = null;
      var from = walking() && fromPoint();
      if (walking() && from && isPoint(place.position) && near(from, place.position)) {
        status = 'You are at its door.';
      } else if (!walking() && place.id === town.data.here) {
        status = 'You are here.';
      } else if (place.retired) {
        status = "That place can't be reached anymore.";
      } else if (!place.open) {
        status = 'Not built yet. The way is closed.';
      } else if (!walking() && !isNext(place.id)) {
        status = "There's no open way there from here.";
      }
      if (status) {
        info.appendChild(
          el('p', 'loom-map-info-status' + (place.open ? '' : ' is-closed'), status)
        );
      }
      if (place.entranceFor) waysOn(info, place);
      if (walking() && town.target && !walkRefusal(town.preview) && !town.preview.here) {
        info.appendChild(
          el('p', 'loom-map-info-facts loom-town-walk-line', walkLine(town.preview))
        );
      }
    } else if (walking() && town.target && town.target.point) {
      info.appendChild(el('h3', 'loom-map-info-name', 'A spot in the street'));
      var no = walkRefusal(town.preview);
      info.appendChild(
        no
          ? el('p', 'loom-map-info-status is-closed', no)
          : el('p', 'loom-map-info-facts loom-town-walk-line', walkLine(town.preview))
      );
    } else {
      var here = placeById(town.data.here);
      var where = walking()
        ? 'You are in ' + town.data.name + '. '
        : here
          ? "You're at " + here.name + ', ' + town.data.name + '. '
          : '';
      info.appendChild(
        el(
          'p',
          'loom-map-hint',
          where +
            (walking()
              ? 'Click the street or a place for what you can do. '
              : 'Click a place for what you can do there. ') +
            'Drag to pan, scroll or pinch to zoom.'
        )
      );
    }
  }

  // The ambient touches (K3; L-727): the water shimmers, and the mist over
  // unseen ground drifts to and fro, thinning and thickening as it goes.
  function ambient(container, t) {
    var n = town.nodes;
    if (!n || !town.data) return false;
    var any = false;
    if (n.shimmer.visible) {
      n.shimmer.alpha = 0.04 + 0.1 * (0.5 + 0.5 * Math.sin((t * 2 * Math.PI) / SHIMMER_PERIOD));
      any = true;
    }
    var at = town.mistAt;
    if (at && n.mist.visible) {
      var phase = (t * 2 * Math.PI) / MIST_PERIOD;
      n.mist.alpha = 0.55 + 0.45 * Math.sin(phase);
      n.mist.position.set(
        at.x + Math.sin(phase / 2) * at.width * 0.008,
        at.y + Math.cos(phase / 3) * at.width * 0.005
      );
      any = true;
    }
    return any;
  }

  engine.addLayer('town', { draw: draw, ambient: ambient });

  Loom.town = {
    BOUNDS: BOUNDS,
    setData: setData,
    reset: reset,
    points: points,
    framePoints: framePoints,
    herePoint: herePoint,
    selectHere: selectHere,
    tap: tap,
    hover: hover,
    continuePlan: continuePlan,
    minimap: minimap,
    renderInfo: renderInfo,
    current: function () {
      return town.data;
    },
  };
})();
