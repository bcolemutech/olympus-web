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

  var Loom = window.Loom;
  var M = Loom.mapMath;
  var engine = Loom.engine;

  var HIT_RADIUS = 18; // px around a pin that a click selects
  var ROUTE_HIT = 6; // px either side of a route
  var LABEL_ALL_SCALE = 1.2; // above this zoom, every place is labelled

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
  };
  // Dash and gap lengths in px, by route (a road is solid).
  var DASHES = { trail: [6, 5], sea: [2, 6] };

  var world = {
    data: null,
    selected: null, // a place id
    hovered: null, // a place id
    look: null, // what Look is showing: { kind: 'route', link } or null
    artKey: null,
    texture: null,
    nodes: null, // the PixiJS objects, built on first draw
    labels: {}, // place id → its label
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

  /** A new loomGetMap result (after loading or a turn). */
  function setData(data) {
    world.data = data;
    if (world.selected && !placeById(world.selected)) world.selected = null;
    world.look = null;
    loadArt(data && data.map && data.map.image);
  }

  function reset() {
    world.data = null;
    world.selected = null;
    world.hovered = null;
    world.look = null;
  }

  // The world's art, as a texture under the camera. It loads as today: the
  // full image (a screen-sized copy first comes with L-727).
  function loadArt(image) {
    var key = Loom.artKey(image);
    if (key === world.artKey) return;
    world.artKey = key;
    world.texture = null;
    if (!image) {
      engine.draw();
      return;
    }
    Loom.artUrl(image)
      .then(function (url) {
        return new Promise(function (resolve, reject) {
          var img = new window.Image();
          img.crossOrigin = 'anonymous'; // WebGL needs CORS; Storage sends it
          img.onload = function () {
            resolve(img);
          };
          img.onerror = function () {
            reject(new Error('the image did not load'));
          };
          img.src = url;
        });
      })
      .then(function (img) {
        if (world.artKey !== key) return; // another world's art meanwhile
        world.texture = window.PIXI.Texture.from(img);
        engine.draw();
      })
      .catch(function (err) {
        console.error('Could not load the map image:', err);
      });
  }

  // ── Drawing ───────────────────────────────────────

  function build(container) {
    var PIXI = window.PIXI;
    var art = new PIXI.Sprite();
    var routes = new PIXI.Graphics();
    var pins = new PIXI.Graphics();
    var labels = new PIXI.Container();
    container.addChild(art, routes, pins, labels);
    world.nodes = { art: art, routes: routes, pins: pins, labels: labels };
  }

  // A line from a to b, dashed if asked: [dash, gap] in px.
  function line(g, a, b, dashes) {
    if (!dashes) {
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      return;
    }
    var length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) return;
    var ux = (b.x - a.x) / length;
    var uy = (b.y - a.y) / length;
    for (var at = 0; at < length; at += dashes[0] + dashes[1]) {
      var end = Math.min(length, at + dashes[0]);
      g.moveTo(a.x + ux * at, a.y + uy * at).lineTo(a.x + ux * end, a.y + uy * end);
    }
  }

  function radiusOf(p) {
    return p.capital ? 5 : p.kind === 'settlement' ? 4 : 3;
  }

  // A small padlock beside a locked place.
  function padlock(g, x, y) {
    g.moveTo(x + 0.8, y - 1)
      .arc(x + 3, y - 1, 2.2, Math.PI, 0)
      .stroke({ width: 1.2, color: COLOURS.closedEdge });
    g.rect(x, y - 1, 6, 4.5).fill({ color: COLOURS.closedEdge });
  }

  function labelFor(p) {
    var label = world.labels[p.id];
    if (!label) {
      label = new window.PIXI.Text({
        text: p.name,
        style: {
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: 12,
          fill: COLOURS.label,
          stroke: { color: COLOURS.casing, width: 3, alpha: 0.85 },
        },
      });
      label.anchor.set(0.5, 0);
      world.labels[p.id] = label;
      world.nodes.labels.addChild(label);
    }
    label.text = p.name;
    label.style.fill = p.open ? COLOURS.label : COLOURS.labelClosed;
    return label;
  }

  function draw(container, view) {
    if (!world.nodes) build(container);
    var n = world.nodes;
    var data = world.data;
    if (!data) return;

    n.art.visible = Boolean(world.texture);
    if (world.texture) {
      n.art.texture = world.texture;
      n.art.position.set(view.x, view.y);
      n.art.width = data.map.width * view.scale;
      n.art.height = data.map.height * view.scale;
    }

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
      line(g, screen(a), screen(b));
      g.stroke({ width: 5.5, color: COLOURS.casing, alpha: 0.55, cap: 'round' });
    });
    data.links.forEach(function (link) {
      var a = byId[link.from];
      var b = byId[link.to];
      if (!a || !b) return;
      var via = COLOURS[link.via] ? link.via : 'road';
      line(g, screen(a), screen(b), DASHES[via]);
      g.stroke({ width: 3, color: COLOURS[via], cap: 'round' });
    });

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
      var s = M.toScreen(view, a.x, a.y);
      var t = M.toScreen(view, b.x, b.y);
      var dx = t.x - s.x;
      var dy = t.y - s.y;
      var len2 = dx * dx + dy * dy || 1;
      var k = Math.max(0, Math.min(1, ((point.x - s.x) * dx + (point.y - s.y) * dy) / len2));
      var d = Math.hypot(point.x - (s.x + k * dx), point.y - (s.y + k * dy));
      if (d <= ROUTE_HIT && (!best || d < best.d)) best = { link: link, d: d };
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

  // Why a place can't be travelled to now, or null if it can.
  function refusal(place, via) {
    if (place.id === world.data.here) return 'You are here.';
    if (!place.open) return 'Not built yet. The way is closed.';
    if (!via) return 'Not directly reachable from here.';
    if (Loom.state.turnInProgress) return 'A turn is under way.';
    return null;
  }

  function travel(id, name) {
    Loom.play.travelTo(id, name);
    Loom.map.showStory(); // on a phone, the story is where the journey is told
  }

  function routeName(link) {
    var a = placeById(link.from);
    var b = placeById(link.to);
    var kind = link.via === 'sea' ? 'Sea route' : link.via === 'trail' ? 'Trail' : 'Road';
    return kind + ' between ' + (a ? a.name : '?') + ' and ' + (b ? b.name : '?');
  }

  // A click on the world map (I2): what is there, and a menu for it.
  function tap(point, view) {
    var found = hit(point, view);
    world.look = null;
    if (!found) {
      world.selected = null;
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
    Loom.map.render();
    var via = neighboursOfHere()[place.id];
    var no = refusal(place, via);
    var items = [];
    // Where to arrive, when more than one way in serves the route (L-346).
    var ways = (place.waysIn || []).filter(function (w) {
      return typeof via !== 'string' || w.via.indexOf(via) !== -1;
    });
    if (!no && ways.length > 1) {
      ways.forEach(function (way) {
        items.push({
          label: 'Move, arriving by ' + way.name,
          onSelect: function () {
            travel(way.id, place.name + ' by ' + way.name);
          },
        });
      });
    } else {
      items.push({
        label: 'Move',
        disabled: Boolean(no),
        note: no || undefined,
        onSelect: function () {
          travel(place.id, place.name);
        },
      });
    }
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

  /** The card under the map: the selected place, a route looked at, or a hint. */
  function renderInfo(info) {
    info.innerHTML = '';
    if (world.look && world.look.kind === 'route') {
      info.appendChild(el('h3', 'loom-map-info-name', routeName(world.look.link)));
      return;
    }
    var place = placeById(world.selected);
    if (!place) {
      info.appendChild(
        el(
          'p',
          'loom-map-hint',
          'Click a place for what you can do there. Drag to pan, scroll or pinch to zoom.'
        )
      );
      return;
    }
    var via = neighboursOfHere()[place.id];
    info.appendChild(el('h3', 'loom-map-info-name', place.name));
    info.appendChild(el('p', 'loom-map-info-facts', factsOf(place, via)));
    var no = place.id === world.data.here ? 'You are here.' : refusal(place, via);
    if (no && no !== 'A turn is under way.') {
      info.appendChild(el('p', 'loom-map-info-status' + (place.open ? '' : ' is-closed'), no));
    }
  }

  /** Where the camera frames the world: the discovered places, around you. */
  function frame(size) {
    var here = placeById(world.data.here);
    return M.fit(positioned(), size, world.data.map, here && { x: here.x, y: here.y });
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
    renderInfo: renderInfo,
    frame: frame,
    usable: function () {
      return positioned().length > 0;
    },
    selectHere: function () {
      world.selected = world.data ? world.data.here : null;
      world.look = null;
    },
    herePoint: function () {
      var here = placeById(world.data && world.data.here);
      return here && typeof here.x === 'number' ? { x: here.x, y: here.y } : null;
    },
    selected: function () {
      return world.selected;
    },
  };
})();
