(function () {
  'use strict';

  // The world map, drawn by the map engine (planning/the-map-first-loom.md
  // §4.3; L-722 / #593): its art, the routes between the places the save has
  // discovered, and the places themselves, from loomGetMap, as the old SVG
  // view drew them (planning/the-loom-layered-worlds.md §7).
  //
  // - The art sits in map space under the camera; routes, pins and labels
  //   are drawn in screen space each time, so they stay the same size at
  //   every zoom.
  // - Markers are quiet (A2): small pins, the place you are in ringed, locked
  //   places grey with a padlock. Labels show on hover, for the selected
  //   place and where you are, and for every place once zoomed in.
  // - A click hit-tests places, then routes, and opens the engine's menu
  //   (I2): Move (travel there, the same turn as before) and Look.
  // - On a region map with no image, who holds the land (L-714; worlds-
  //   without-azgaar.md §4.4, R8): each realm's land has a soft inner edge in
  //   its colour and its name at its centre, from loomGetMap's `map.realms`,
  //   under the routes and places. With an image, nothing extra is drawn.
  // - Across country (L-367; planning/off-road-travel.md §4.7, TR5): where the
  //   world offers it (loomGetMap's `wilds`), a click on open ground, or the
  //   Travel across country item of a place's menu, previews the way (wild-
  //   view.js runs the turn's own planner): its path on the map and, on the
  //   card, its distance, time, ground crossed and how wild it is. A journey
  //   under way is drawn as the way still ahead, a tent at each camp made and
  //   the save's marker in the wilds, with Continue and Stop on the card.

  var Loom = window.Loom;
  var M = Loom.mapMath;
  var engine = Loom.engine;

  var HIT_RADIUS = 18; // px around a pin that a click selects
  var ROUTE_HIT = 6; // px either side of a route
  var LABEL_ALL_SCALE = 1.2; // above this zoom, every place is labelled
  // A realm's soft edge (R8): the widths of its strokes as fractions of the
  // map's space, centred on the border and clipped to the land, so only the
  // inner half shows; each lays its alpha over the one before.
  var EDGE_WIDTH = 1 / 24;
  var EDGE_BANDS = [
    { width: 1, alpha: 0.07 },
    { width: 0.78, alpha: 0.08 },
    { width: 0.58, alpha: 0.1 },
    { width: 0.4, alpha: 0.12 },
    { width: 0.22, alpha: 0.14 },
    { width: 0.1, alpha: 0.16 },
  ];

  var COLOURS = {
    road: 0xffb74d,
    trail: 0xd7b98a,
    sea: 0x4fc3f7,
    casing: 0x0a0e1a,
    open: 0xa5d6a7,
    closed: 0x4b5563,
    closedEdge: 0x9ca3af,
    here: 0xffb74d,
    edge: 0x0a0e1a,
    selected: 0xffffff,
    label: 0xe0e0e0,
    labelClosed: 0x9ca3af,
    preview: 0x80deea,
    journey: 0xfff59d,
    camp: 0xd7b98a,
  };
  // Dash and gap lengths in px, by route (a road is solid).
  var DASHES = { trail: [6, 5], sea: [2, 6] };

  var world = {
    data: null,
    selected: null, // a place id
    hovered: null, // a place id
    look: null, // what Look is showing: { kind: 'route', link } or null
    art: null, // the map's art (Loom.draw.art): its copy, then the full image
    nodes: null, // the PixiJS objects, built on first draw
    realmsKey: null, // what the realms drawn were made from
    realmNodes: [], // [{ id, root, name, bounds }] one a realm drawn
    realmBuilds: 0, // how many times they have been built, for tests
    labels: {}, // place id → its label
    preview: null, // the way across country being looked at (L-367): { to, plan, ... }
    trek: null, // what was drawn of it, in screen px, for tests
  };

  // ── Data ──────────────────────────────────────────

  function positioned() {
    return world.data
      ? world.data.places.filter(function (p) {
          return typeof p.x === 'number';
        })
      : [];
  }

  function placeById(id) {
    return (
      world.data &&
      world.data.places.filter(function (p) {
        return p.id === id;
      })[0]
    );
  }

  // The places one route from where the save stands, with how (road, …).
  function neighboursOfHere() {
    var here = world.data && world.data.here;
    var ids = {};
    (world.data ? world.data.links : []).forEach(function (l) {
      if (l.from === here) ids[l.to] = l.via || true;
      if (l.to === here) ids[l.from] = l.via || true;
    });
    return ids;
  }

  // How long the trip to a place takes from here (L-376; game time R3),
  // from loomGetMap's estimate (L-373): "about 6 hours by trail", and the
  // part of day on arrival when night falls or day breaks on the way:
  // "arriving at night", "arriving on Day 2, in the morning". Null without one.
  var ARRIVING = {
    night: 'at night',
    dawn: 'at dawn',
    midday: 'at midday',
    morning: 'in the morning',
    afternoon: 'in the afternoon',
    evening: 'in the evening',
  };
  function tripWords(placeId) {
    var here = world.data && world.data.here;
    var link = (world.data ? world.data.links : []).filter(function (l) {
      return (l.from === here && l.to === placeId) || (l.to === here && l.from === placeId);
    })[0];
    var travel = link && link.travel;
    if (!travel) return null;
    var words = travel.label;
    var arrives = travel.crossesDuskOrDawn && /^Day (\d+), (\w+)$/.exec(travel.arrives || '');
    if (arrives) {
      var now = /^Day (\d+)/.exec((Loom.store.get().turn || {}).time || '');
      var sameDay = now && now[1] === arrives[1];
      words +=
        ', arriving ' + (sameDay ? '' : 'on Day ' + arrives[1] + ', ') + ARRIVING[arrives[2]];
    }
    return words;
  }

  /** A new loomGetMap result (after loading or a turn). */
  function setData(data) {
    world.data = data;
    if (world.selected && !placeById(world.selected)) world.selected = null;
    world.look = null;
    world.preview = null;
    loadArt(data && data.map && data.map.image);
  }

  function reset() {
    world.data = null;
    world.selected = null;
    world.hovered = null;
    world.look = null;
    world.preview = null;
    world.trek = null;
  }

  // The world's art, as a texture under the camera: its screen-sized copy
  // first, the full image once zoomed in past it (A1; L-727).
  function loadArt(image) {
    if (!world.art) {
      world.art = Loom.draw.art(function () {
        engine.draw();
      }, 'map image');
    }
    world.art.set(image);
    engine.draw();
  }

  // ── Drawing ───────────────────────────────────────

  function build(container) {
    var PIXI = window.PIXI;
    var backdrop = new PIXI.Graphics();
    var art = new PIXI.Sprite();
    var painted = new PIXI.Container(); // the region map drawn from its data (L-924)
    var realms = new PIXI.Container(); // realms' soft edges, in map space (L-714)
    var realmNames = new PIXI.Container(); // and their names, in screen space
    var routes = new PIXI.Graphics();
    var trek = new PIXI.Graphics(); // the way across country (L-367)
    var pins = new PIXI.Graphics();
    var labels = new PIXI.Container();
    container.addChild(backdrop, art, painted, realms, realmNames, routes, trek, pins, labels);
    world.nodes = {
      backdrop: backdrop,
      art: art,
      painted: painted,
      realms: realms,
      realmNames: realmNames,
      routes: routes,
      trek: trek,
      pins: pins,
      labels: labels,
    };
  }

  var polyline = Loom.draw.polyline;

  // The points a route runs through, in map units: its first place, its
  // waypoints (L-715) and its second place.
  function routePoints(link, a, b) {
    var through = (link.waypoints || []).map(function (w) {
      return { x: w[0], y: w[1] };
    });
    return [{ x: a.x, y: a.y }].concat(through, [{ x: b.x, y: b.y }]);
  }

  function radiusOf(p) {
    return p.capital ? 5 : p.kind === 'settlement' ? 4 : 3;
  }

  function padlock(g, x, y) {
    Loom.draw.padlock(g, x, y, COLOURS.closedEdge);
  }

  function labelFor(p) {
    var label = world.labels[p.id];
    if (!label) {
      label = Loom.draw.label(p.name);
      world.labels[p.id] = label;
      world.nodes.labels.addChild(label);
    }
    label.text = p.name;
    label.style.fill = p.open ? COLOURS.label : COLOURS.labelClosed;
    return label;
  }

  // The world's own accent, for the painter's tint (RD4).
  function accent() {
    var v = document.documentElement.style.getPropertyValue('--loom-accent').trim();
    var m = /^#([0-9a-f]{6})$/i.exec(v);
    return m ? parseInt(m[1], 16) : null;
  }

  // Paints the region map's geometry once per change, and places it with
  // the camera every draw: map units to the world map's.
  function paintRegion(n, data, view) {
    var g = data.map && data.map.geometry;
    var space = data.map && data.map.space;
    n.painted.visible = Boolean(g && space && space.width);
    if (!n.painted.visible) return;
    if (world.paintedFor !== data) {
      world.paintedFor = data;
      world.paintRoot = Loom.mapPaint.paint(n.painted, 'region:' + (data.mapId || 'top'), g, {
        tile: space.width / 32,
        wall: space.width / 400,
        // A foot of height, for walls standing (L-941): on a region map a
        // wall stands as a wall a foot and a half thick would on a grid.
        feet: space.width / 400 / 1.5,
        set: data.artSet || null, // the world's art set (L-944)
        materials: data.materials || null, // the world's own ground (L-713)
        art: Boolean(data.map.image),
        tint: accent(),
        onProgress: engine.progress,
        onChange: function () {
          engine.draw();
        },
      });
    }
    if (world.paintRoot) {
      world.paintRoot.position.set(view.x, view.y);
      world.paintRoot.scale.set((view.scale * data.map.width) / space.width);
      // Only what's on the screen is drawn (L-943; EN5).
      var shown = engine.size();
      Loom.mapPaint.cull('region:' + (data.mapId || 'top'), shown.width, shown.height);
    }
  }

  // ── Realms (L-714) ────────────────────────────────

  function colourNumber(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    return m ? parseInt(m[1], 16) : 0xa0a0a0;
  }

  // A colour a third of the way to white, so a name reads on the land and the
  // dark edge the label draws round it.
  function lighter(colour) {
    var mix = function (shift) {
      var c = (colour >> shift) & 255;
      return Math.round(c + (255 - c) * 0.35);
    };
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
  }

  // What the realms drawn are made from: a cheap key, so a map sent again
  // with the same realms (every turn) isn't rebuilt.
  function realmsKey(realms) {
    return realms
      .map(function (r) {
        var sum = 0;
        var count = 0;
        r.outlines
          .concat(
            r.land.map(function (l) {
              return l.outer;
            })
          )
          .forEach(function (flat) {
            count += flat.length;
            for (var i = 0; i < flat.length; i++) sum += flat[i];
          });
        return [r.id, r.name, r.colour, count, Math.round(sum * 100)].join(':');
      })
      .join('|');
  }

  // A realm's land in map units, for culling it.
  function boundsOfRealm(r) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    r.land.forEach(function (l) {
      for (var i = 0; i + 1 < l.outer.length; i += 2) {
        b.x0 = Math.min(b.x0, l.outer[i]);
        b.x1 = Math.max(b.x1, l.outer[i]);
        b.y0 = Math.min(b.y0, l.outer[i + 1]);
        b.y1 = Math.max(b.y1, l.outer[i + 1]);
      }
    });
    return b;
  }

  function clearRealms(n) {
    n.realms.removeChildren().forEach(function (c) {
      c.destroy({ children: true });
    });
    n.realmNames.removeChildren().forEach(function (c) {
      c.destroy();
    });
    world.realmNodes = [];
    world.realmsKey = null;
  }

  // Builds each realm's edge once: its outline stroked in three bands and
  // clipped to its land, so the colour fades in from the border. In map
  // space, so it moves with the camera and costs nothing to pan.
  function buildRealms(n, realms, space) {
    var PIXI = window.PIXI;
    world.realmBuilds++;
    var full = space.width * EDGE_WIDTH;
    realms.forEach(function (r) {
      var colour = colourNumber(r.colour);
      var root = new PIXI.Container();
      var edge = new PIXI.Graphics();
      EDGE_BANDS.forEach(function (band) {
        r.outlines.forEach(function (flat) {
          if (flat.length < 4) return;
          edge.moveTo(flat[0], flat[1]);
          for (var i = 2; i + 1 < flat.length; i += 2) edge.lineTo(flat[i], flat[i + 1]);
        });
        edge.stroke({
          width: full * band.width,
          color: colour,
          alpha: band.alpha,
          join: 'round',
          cap: 'round',
        });
      });
      var land = new PIXI.Graphics();
      r.land.forEach(function (l) {
        land.poly(l.outer).fill({ color: 0xffffff });
        l.holes.forEach(function (hole) {
          land.poly(hole).cut();
        });
      });
      root.addChild(edge, land);
      edge.mask = land;
      n.realms.addChild(root);
      var name = Loom.draw.label(String(r.name).toUpperCase(), 15);
      name.style.fill = lighter(colour);
      name.style.letterSpacing = 3;
      name.alpha = 0.9;
      name.anchor.set(0.5, 0.5);
      n.realmNames.addChild(name);
      world.realmNodes.push({
        id: r.id,
        root: root,
        name: name,
        centre: r.centre,
        bounds: boundsOfRealm(r),
      });
    });
  }

  // Who holds the land, on a region map with no image (R8): its realms'
  // edges and names, or nothing.
  function paintRealms(n, data, view) {
    var map = data.map;
    var realms = map && !map.image && map.space && map.space.width ? map.realms : null;
    if (!realms || !realms.length) {
      n.realms.visible = false;
      n.realmNames.visible = false;
      if (world.realmNodes.length) clearRealms(n);
      return;
    }
    n.realms.visible = true;
    n.realmNames.visible = true;
    var key = realmsKey(realms);
    if (key !== world.realmsKey) {
      clearRealms(n);
      buildRealms(n, realms, map.space);
      world.realmsKey = key;
    }
    var k = (view.scale * map.width) / map.space.width;
    n.realms.position.set(view.x, view.y);
    n.realms.scale.set(k);
    var shown = engine.size();
    world.realmNodes.forEach(function (r) {
      var b = r.bounds;
      var off =
        view.x + b.x1 * k < 0 ||
        view.y + b.y1 * k < 0 ||
        view.x + b.x0 * k > shown.width ||
        view.y + b.y0 * k > shown.height;
      r.root.visible = !off;
      r.name.visible = !off;
      r.name.position.set(view.x + r.centre.x * k, view.y + r.centre.y * k);
    });
  }

  // ── Across country (L-367) ────────────────────────

  // Whether the world map offers travel across country: the world's wilds
  // module on, this the map the save stands on.
  function wildOn() {
    return Boolean(world.data && !world.data.peek && Loom.wildView.ready(world.data));
  }

  // A tent at a camp: a small triangle with a dark edge.
  function tent(g, x, y) {
    g.poly([x, y - 6, x + 5.5, y + 4, x - 5.5, y + 4])
      .fill({ color: COLOURS.camp })
      .stroke({ width: 1.5, color: COLOURS.edge });
  }

  // Where it is heading: a ring.
  function goalRing(g, x, y, colour) {
    g.circle(x, y, 7).stroke({ width: 2.5, color: COLOURS.casing, alpha: 0.7 });
    g.circle(x, y, 7).stroke({ width: 1.5, color: colour });
  }

  // The way across country being looked at (dashed), the journey under way
  // (its way still ahead, the camps made, where it heads) and the save's
  // marker in the wilds, in screen space. What it drew is kept for tests.
  function drawTrek(n, data, screen) {
    var g = n.trek;
    g.clear();
    var drawn = { preview: null, journey: null, marker: null };
    var preview = world.preview;
    if (preview && preview.plan) {
      var pts = preview.plan.path.map(function (p) {
        return screen({ x: p[0], y: p[1] });
      });
      polyline(g, pts);
      g.stroke({ width: 5.5, color: COLOURS.casing, alpha: 0.55, cap: 'round', join: 'round' });
      polyline(g, pts, [8, 5]);
      g.stroke({ width: 3, color: COLOURS.preview, cap: 'round', join: 'round' });
      var end = pts[pts.length - 1];
      goalRing(g, end.x, end.y, COLOURS.preview);
      drawn.preview = { path: pts, goal: end };
    }
    var journey = data.journey;
    if (journey && journey.path.length) {
      var ahead = journey.path.map(screen);
      polyline(g, ahead);
      g.stroke({ width: 5.5, color: COLOURS.casing, alpha: 0.55, cap: 'round', join: 'round' });
      polyline(g, ahead, [12, 4]);
      g.stroke({ width: 3, color: COLOURS.journey, cap: 'round', join: 'round' });
      var camps = (journey.camps || []).map(screen);
      camps.forEach(function (c) {
        tent(g, c.x, c.y);
      });
      var goal =
        journey.to && journey.to.point ? screen(journey.to.point) : ahead[ahead.length - 1];
      goalRing(g, goal.x, goal.y, COLOURS.journey);
      drawn.journey = { path: ahead, camps: camps, goal: goal };
    }
    // Standing in the wilds: where, as the place you are in is ringed.
    if (data.wild && !data.here) {
      var m = screen(data.wild);
      g.circle(m.x, m.y, 11).stroke({ width: 2, color: COLOURS.here });
      // At a camp the ring holds the tent; elsewhere a dot marks the spot.
      var atCamp = drawn.journey
        ? drawn.journey.camps.some(function (c) {
            return Math.hypot(c.x - m.x, c.y - m.y) < 3;
          })
        : false;
      if (!atCamp) {
        g.circle(m.x, m.y, 4.5)
          .fill({ color: COLOURS.here })
          .stroke({ width: 1.5, color: COLOURS.edge });
      }
      drawn.marker = m;
    }
    world.trek = drawn;
  }

  function draw(container, view) {
    if (!world.nodes) build(container);
    var n = world.nodes;
    var data = world.data;
    if (!data) return;

    // A world made from scratch has a plain colour under its art (L-391).
    n.backdrop.clear();
    if (data.map.backdrop) {
      n.backdrop
        .rect(view.x, view.y, data.map.width * view.scale, data.map.height * view.scale)
        .fill({ color: parseInt(data.map.backdrop.slice(1), 16) });
    }
    var texture = world.art && world.art.ready(data.map.image) ? world.art.texture : null;
    n.art.visible = Boolean(texture);
    if (texture) {
      n.art.texture = texture;
      n.art.position.set(view.x, view.y);
      n.art.width = data.map.width * view.scale;
      n.art.height = data.map.height * view.scale;
      world.art.sharpen(Loom.draw.devicePx(Math.max(n.art.width, n.art.height)));
    }

    // The region map drawn from its data (L-924; paint.js), under the
    // routes and places, when it has some: its art (EX2) in place of its
    // ground and lines.
    paintRegion(n, data, view);
    paintRealms(n, data, view);

    var byId = {};
    positioned().forEach(function (p) {
      byId[p.id] = p;
    });
    var screen = function (p) {
      return M.toScreen(view, p.x, p.y);
    };

    // Routes: a dark casing under each keeps it readable over the art.
    var g = n.routes;
    g.clear();
    data.links.forEach(function (link) {
      var a = byId[link.from];
      var b = byId[link.to];
      if (!a || !b) return;
      polyline(g, routePoints(link, a, b).map(screen));
      g.stroke({ width: 5.5, color: COLOURS.casing, alpha: 0.55, cap: 'round', join: 'round' });
    });
    data.links.forEach(function (link) {
      var a = byId[link.from];
      var b = byId[link.to];
      if (!a || !b) return;
      var via = COLOURS[link.via] ? link.via : 'road';
      polyline(g, routePoints(link, a, b).map(screen), DASHES[via]);
      g.stroke({ width: 3, color: COLOURS[via], cap: 'round', join: 'round' });
    });
    drawTrek(n, data, screen);

    // Pins, quiet (A2).
    var pins = n.pins;
    pins.clear();
    var shown = {};
    positioned().forEach(function (p) {
      var s = screen(p);
      var r = radiusOf(p);
      var here = p.id === data.here;
      var selected = p.id === world.selected;
      if (here) pins.circle(s.x, s.y, r + 5).stroke({ width: 2, color: COLOURS.here });
      var fill = here ? COLOURS.here : p.open ? COLOURS.open : COLOURS.closed;
      var edge = selected ? COLOURS.selected : p.open || here ? COLOURS.edge : COLOURS.closedEdge;
      var edgeWidth = selected ? 2.5 : 1.5;
      if (p.kind === 'poi') {
        pins.poly([s.x, s.y - r - 1, s.x + r + 1, s.y, s.x, s.y + r + 1, s.x - r - 1, s.y]);
      } else {
        pins.circle(s.x, s.y, r);
      }
      pins.fill({ color: fill }).stroke({ width: edgeWidth, color: edge });
      if (!p.open) padlock(pins, s.x + r + 2, s.y - r - 3);
      if (here || selected || p.id === world.hovered || view.scale > LABEL_ALL_SCALE) {
        var label = labelFor(p);
        label.position.set(s.x, s.y + r + 4);
        label.visible = true;
        shown[p.id] = true;
      }
    });
    Object.keys(world.labels).forEach(function (id) {
      if (!shown[id]) world.labels[id].visible = false;
    });
  }

  // ── Hit-testing and the menu ──────────────────────

  // The place nearest a point in the panel, if close enough.
  function placeAt(point, view) {
    var best = null;
    positioned().forEach(function (p) {
      var s = M.toScreen(view, p.x, p.y);
      var d = Math.hypot(s.x - point.x, s.y - point.y);
      if (d <= HIT_RADIUS && (!best || d < best.d)) best = { place: p, d: d };
    });
    return best ? best.place : null;
  }

  // The route under a point, if any.
  function routeAt(point, view) {
    var best = null;
    world.data.links.forEach(function (link) {
      var a = placeById(link.from);
      var b = placeById(link.to);
      if (!a || !b || typeof a.x !== 'number' || typeof b.x !== 'number') return;
      // Every leg of the route, along its waypoints (L-715).
      var pts = routePoints(link, a, b).map(function (p) {
        return M.toScreen(view, p.x, p.y);
      });
      for (var i = 1; i < pts.length; i++) {
        var s = pts[i - 1];
        var t = pts[i];
        var dx = t.x - s.x;
        var dy = t.y - s.y;
        var len2 = dx * dx + dy * dy || 1;
        var k = Math.max(0, Math.min(1, ((point.x - s.x) * dx + (point.y - s.y) * dy) / len2));
        var d = Math.hypot(point.x - (s.x + k * dx), point.y - (s.y + k * dy));
        if (d <= ROUTE_HIT && (!best || d < best.d)) best = { link: link, d: d };
      }
    });
    return best ? best.link : null;
  }

  /** What is under a point: { kind: 'place', place } or { kind: 'route', link }. */
  function hit(point, view) {
    if (!world.data) return null;
    var place = placeAt(point, view);
    if (place) return { kind: 'place', place: place };
    var link = routeAt(point, view);
    return link ? { kind: 'route', link: link } : null;
  }

  function factsOf(place, via) {
    var facts = [];
    if (place.kind === 'settlement') {
      facts.push(place.capital ? 'Capital' : place.port ? 'Port' : 'Settlement');
      if (place.population) {
        facts.push(Number(place.population).toLocaleString('en-US') + ' people');
      }
    } else {
      facts.push('Point of interest');
    }
    if (typeof via === 'string') facts.push('by ' + via);
    return facts.join(' · ');
  }

  // A journey's time and the towns passed (L-384): "about 3 days, through
  // Hatham and Bridgeford".
  function journeyWords(journey) {
    var names = journey.through || [];
    var through =
      names.length < 2
        ? names.join('')
        : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    return journey.label + (through ? ', through ' + through : '');
  }

  // Why a place can't be travelled to now, or null if it can.
  function refusal(place, via) {
    if (place.id === world.data.here) return 'You are here.';
    if (!place.open) return 'Not built yet. The way is closed.';
    if (!via) {
      // Somewhere you've been (L-384): a journey there, or no known way.
      if (place.journey) return null;
      return place.journey === false
        ? 'No way you know leads there.'
        : 'Not directly reachable from here.';
    }
    if (Loom.state.turnInProgress) return 'A turn is under way.';
    return null;
  }

  function travel(id, name) {
    Loom.play.travelTo(id, name);
  }

  function routeName(link) {
    var a = placeById(link.from);
    var b = placeById(link.to);
    var kind = link.via === 'sea' ? 'Sea route' : link.via === 'trail' ? 'Trail' : 'Road';
    return kind + ' between ' + (a ? a.name : '?') + ' and ' + (b ? b.name : '?');
  }

  // ── Setting out across country (L-367) ────────────

  // The way to a point or place, previewed: `target` { x, y, placeId?, name? }
  // with the plan and its words, or null when there is nowhere to set out from.
  function previewTo(target) {
    var data = world.data;
    var from = Loom.wildView.startOf(data, placeById(data.here));
    if (!from) return null;
    var plan = Loom.wildView.planTo(data, from, [target.x, target.y]);
    return Object.assign({}, target, {
      plan: plan,
      summary: plan ? Loom.wildView.summary(data, plan) : null,
    });
  }

  // Why it can't be set out on, or null.
  function crossRefusal(preview) {
    if (!preview) return 'There is nowhere to set out from here.';
    if (!preview.plan) return 'There is no way across country there that you can take.';
    return Loom.state.turnInProgress ? 'A turn is under way.' : null;
  }

  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  function setOut(preview) {
    if (preview.placeId) {
      Loom.play.travelAcross(preview.placeId, 'set out across country for ' + preview.name);
    } else {
      Loom.play.travelAcross(
        { point: { x: round3(preview.x), y: round3(preview.y) } },
        'set out across country'
      );
    }
  }

  // "Travel across country", beside a place's route (TR5): its time and how
  // wild the way is in the label.
  function crossItem(preview) {
    var no = crossRefusal(preview);
    var s = preview && preview.summary;
    return {
      label: 'Travel across country' + (s ? ' · ' + s.time + ', ' + s.rating : ''),
      disabled: Boolean(no),
      note: no || undefined,
      onSelect: function () {
        setOut(preview);
      },
    };
  }

  function title(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // A click on open ground: the way there previewed, with its menu.
  function openCountry(point, view) {
    var at = M.toMap(view, point.x, point.y);
    var map = world.data.map;
    if (at.x < 0 || at.y < 0 || at.x > map.width || at.y > map.height) {
      Loom.map.render();
      return;
    }
    world.preview = previewTo({ x: at.x, y: at.y });
    Loom.map.render();
    var ground = Loom.wildView.groundAt(world.data, [at.x, at.y]);
    var s = world.preview && world.preview.summary;
    Loom.engine.openMenu(point, {
      title: ground ? title(ground) : 'Open country',
      subtitle: s ? s.line : 'No way across country that you can take.',
      items: [crossItem(world.preview)],
    });
  }

  // A click on the world map (I2): what is there, and a menu for it.
  function tap(point, view) {
    var found = hit(point, view);
    world.look = null;
    world.preview = null;
    if (!found) {
      world.selected = null;
      if (wildOn()) {
        openCountry(point, view);
        return;
      }
      Loom.map.render();
      return;
    }
    if (found.kind === 'route') {
      world.selected = null;
      Loom.map.render();
      engine.openMenu(point, {
        title: routeName(found.link),
        items: [
          {
            label: 'Look',
            onSelect: function () {
              world.look = { kind: 'route', link: found.link };
              Loom.map.render();
            },
          },
        ],
      });
      return;
    }
    var place = found.place;
    world.selected = place.id;
    // The way across country there, drawn while it is looked at (TR5).
    var cross =
      wildOn() && place.id !== world.data.here
        ? previewTo({ x: place.x, y: place.y, placeId: place.id, name: place.name })
        : null;
    world.preview = cross;
    Loom.map.render();
    var via = neighboursOfHere()[place.id];
    var no = refusal(place, via);
    var items = [];
    var trip = no ? null : tripWords(place.id);
    // A place you've been that isn't a neighbour (L-384; JA6): a journey
    // there, through the places you've been on the way.
    var journey = place.journey;
    if (journey !== undefined && !via) {
      var busy = Loom.state.turnInProgress;
      var cannot = !place.open
        ? 'Not built yet. The way is closed.'
        : journey === false
          ? 'No way you know leads there.'
          : busy
            ? 'A turn is under way.'
            : null;
      items.push({
        label: 'Journey to ' + place.name + (journey ? ' · ' + journeyWords(journey) : ''),
        disabled: Boolean(cannot),
        note: cannot || undefined,
        onSelect: function () {
          travel(place.id, place.name);
        },
      });
    } else {
      // One entry a neighbour: arriving by the way in facing here (L-381,
      // L-383), so there is no choosing it.
      items.push({
        label: trip ? 'Travel to ' + place.name + ' · ' + trip : 'Move',
        disabled: Boolean(no),
        note: no || undefined,
        onSelect: function () {
          travel(place.id, place.name);
        },
      });
    }
    // In the wilds there is no route to take from here: across country is the way.
    if (cross && world.data.wild && !world.data.here) items.length = 0;
    if (cross) items.push(crossItem(cross));
    items.push({
      label: 'Look',
      onSelect: function () {
        world.selected = place.id;
        var s = engine.size();
        engine.setView(M.reveal(view, { x: place.x, y: place.y }, s, world.data.map));
      },
    });
    engine.openMenu(point, { title: place.name, subtitle: factsOf(place, via), items: items });
  }

  // A hover over a place labels it (A2) and shows it can be clicked.
  function hover(point, view) {
    var place = point && world.data ? placeAt(point, view) : null;
    var id = place ? place.id : null;
    var route = !place && point && world.data ? routeAt(point, view) : null;
    engine.panelCursor(place || route ? 'pointer' : '');
    if (id === world.hovered) return;
    world.hovered = id;
    engine.draw();
  }

  // ── The card ──────────────────────────────────────

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, id, disabled, onClick) {
    var b = el('button', 'loom-map-info-btn', label);
    b.type = 'button';
    b.id = id;
    b.disabled = Boolean(disabled);
    b.addEventListener('click', onClick);
    return b;
  }

  // The button that sets out on a previewed way (L-367).
  function crossButton(info, preview) {
    var actions = el('div', 'loom-map-info-actions');
    actions.appendChild(
      button(
        'Travel across country',
        'loom-wild-set-out',
        Boolean(crossRefusal(preview)),
        function () {
          setOut(preview);
        }
      )
    );
    info.appendChild(actions);
  }

  // A journey under way (L-367): where it heads, the time left, the camps made,
  // with Continue and Stop.
  function journeyCard(info) {
    var j = world.data.journey;
    if (!j) return;
    var camps = (j.camps || []).length;
    var heading = j.to && j.to.name ? j.to.name : 'a point on the map';
    info.appendChild(
      el(
        'p',
        'loom-map-info-status loom-map-info-journey',
        'On the way to ' +
          heading +
          ' · ' +
          j.label +
          ' left' +
          (camps ? ' · ' + camps + (camps === 1 ? ' camp' : ' camps') + ' made' : '')
      )
    );
    var busy = Loom.state.turnInProgress;
    var actions = el('div', 'loom-map-info-actions');
    actions.appendChild(
      button('Continue', 'loom-journey-continue', busy, function () {
        Loom.play.journeyOn();
      })
    );
    actions.appendChild(
      button('Stop', 'loom-journey-stop', busy, function () {
        Loom.play.journeyStop();
      })
    );
    info.appendChild(actions);
  }

  /** The card under the map: the selected place, a route looked at, or a hint. */
  function renderInfo(info) {
    info.innerHTML = '';
    if (world.look && world.look.kind === 'route') {
      info.appendChild(el('h3', 'loom-map-info-name', routeName(world.look.link)));
      journeyCard(info);
      return;
    }
    var place = placeById(world.selected);
    var preview = world.preview;
    // Open ground looked at: the way across country there (TR5).
    if (!place && preview) {
      var ground = Loom.wildView.groundAt(world.data, [preview.x, preview.y]);
      info.appendChild(el('h3', 'loom-map-info-name', ground ? title(ground) : 'Open country'));
      info.appendChild(
        el(
          'p',
          'loom-map-info-facts loom-map-info-cross',
          preview.summary ? preview.summary.line : 'No way across country that you can take.'
        )
      );
      if (preview.plan) crossButton(info, preview);
      journeyCard(info);
      return;
    }
    if (!place) {
      var data = world.data;
      var inWilds = wildOn() && data.wild && !data.here;
      var where = inWilds ? Loom.wildView.groundAt(data, [data.wild.x, data.wild.y]) : null;
      info.appendChild(
        el(
          'p',
          'loom-map-hint',
          inWilds
            ? 'You are in the wilds' +
                (where ? ', in the ' + where : '') +
                '. Click the map to set out across country.'
            : 'Click a place for what you can do there. Drag to pan, scroll or pinch to zoom.' +
                (wildOn() ? ' Click open ground to travel across country.' : '')
        )
      );
      journeyCard(info);
      return;
    }
    var via = neighboursOfHere()[place.id];
    info.appendChild(el('h3', 'loom-map-info-name', place.name));
    info.appendChild(el('p', 'loom-map-info-facts', factsOf(place, via)));
    var no = place.id === world.data.here ? 'You are here.' : refusal(place, via);
    if (no && no !== 'A turn is under way.') {
      info.appendChild(el('p', 'loom-map-info-status' + (place.open ? '' : ' is-closed'), no));
    }
    // A place you've been, a journey away (L-384).
    if (!via && place.journey && place.open) {
      info.appendChild(
        el('p', 'loom-map-info-status', 'A journey from here: ' + journeyWords(place.journey) + '.')
      );
    }
    // The way across country there, beside the route (L-367; TR5).
    if (preview && preview.placeId === place.id) {
      info.appendChild(
        el(
          'p',
          'loom-map-info-status loom-map-info-cross',
          preview.summary
            ? 'Across country: ' + preview.summary.line + '.'
            : 'No way across country there that you can take.'
        )
      );
      if (preview.plan) crossButton(info, preview);
    }
    journeyCard(info);
  }

  /** Where the camera frames the world: the discovered places, around you. */
  function frame(size) {
    var here = placeById(world.data.here);
    return M.fit(positioned(), size, world.data.map, here && { x: here.x, y: here.y });
  }

  /** The minimap's view of the world: its art and the places found. */
  function minimap() {
    var points = positioned().map(function (p) {
      var here = p.id === world.data.here;
      return {
        x: p.x,
        y: p.y,
        colour: here ? '#ffb74d' : p.open ? '#a5d6a7' : '#6b7280',
        r: here ? 3.5 : 2,
      };
    });
    var texture = world.art && world.art.texture;
    var art = texture && texture.source && texture.source.resource;
    return {
      rect: {
        x: 0,
        y: 0,
        width: world.data.map.width,
        height: world.data.map.height,
        fill: '#0d1424',
      },
      image: art || null,
      points: points,
    };
  }

  engine.addLayer('world', {
    draw: draw,
    hit: hit,
  });

  Loom.world = {
    setData: setData,
    reset: reset,
    tap: tap,
    hover: hover,
    minimap: minimap,
    renderInfo: renderInfo,
    frame: frame,
    usable: function () {
      return positioned().length > 0;
    },
    selectHere: function () {
      world.selected = world.data ? world.data.here : null;
      world.look = null;
    },
    /** A world place's point, by id (a town just left, L-725). */
    pointOf: function (id) {
      var p = placeById(id);
      return p && typeof p.x === 'number' ? { x: p.x, y: p.y } : null;
    },
    herePoint: function () {
      var here = placeById(world.data && world.data.here);
      return here && typeof here.x === 'number' ? { x: here.x, y: here.y } : null;
    },
    selected: function () {
      return world.selected;
    },
    /** Whether the map offers travel across country (L-367). */
    wildOn: wildOn,
    /**
     * The way across country being looked at, for tests (L-367): its plan's
     * hours, distance and path in map units, its words, and what was drawn.
     */
    previewed: function () {
      var p = world.preview;
      if (!p || !p.plan) return null;
      return {
        hours: p.plan.hours,
        distance: p.plan.distance,
        path: p.plan.path,
        line: p.summary.line,
        days: p.summary.days,
        ratingId: p.summary.ratingId,
        drawn: world.trek && world.trek.preview,
      };
    },
    /** What is drawn of the journey: its way, camps and goal, and the marker (L-367). */
    trekDrawn: function () {
      return world.trek;
    },
    /** How many times the realms have been built (they aren't for the same ones). */
    realmBuilds: function () {
      return world.realmBuilds;
    },
    /** The realms drawn now: [{ id, name, shown, x, y }], for tests (L-714). */
    realmsDrawn: function () {
      return world.realmNodes.map(function (r) {
        return {
          id: r.id,
          name: r.name.text,
          shown: r.root.visible,
          x: r.name.position.x,
          y: r.name.position.y,
        };
      });
    },
  };
})();
