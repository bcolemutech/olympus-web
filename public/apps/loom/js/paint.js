(function () {
  'use strict';

  // Painting a map from its data (planning/maps-from-data.md §4.6, RD1, RD3,
  // RD4, EX2, PL4; L-924 / #728): the one painter the grid, area and region
  // drawers share. It draws a map's geometry (map-geometry.js) with the art
  // of its materials and objects (materials.js; the files under
  // /apps/loom/art/), in this order:
  //
  //   ground    each floor as its material's tile, repeating
  //   shading   by height: higher ground lighter, lower darker, a shadow
  //             along every ledge's edge (DA2)
  //   lines     rivers, roads and streets as strips of their material
  //   walls     strips of their material along their lines, as seen from
  //             above
  //   openings  doors and windows by their state: a closed door across its
  //             gap, an open one swung on its hinge, a locked one tinted red
  //   objects   with their art: their own, their world's for their kind, the
  //             catalog's, else the box with a question mark (OB1)
  //   light     dark areas shaded, lights glowing through them (drawing
  //             only, decided 2026-11-04)
  //
  // The fog is the drawer's, over all of it. A map with its own art (EX2)
  // has that art drawn in place of its ground, lines and walls: the painter
  // then draws only its doors, as thin lines by their state, and its objects.
  // The world's accent may tint the ground and the walls (RD4).
  //
  // Everything is built in the map's own units in one container per map
  // (`root`), which the drawer places and scales. Each item is its own
  // display object, kept by what it is (its kind, id and data), so painting
  // the same map again builds only what changed: a map revisited, or a turn
  // that changes nothing drawn, builds nothing (decided 2026-11-04: kept in
  // memory, per session). Building runs a few milliseconds at a time across
  // frames, never blocking input, and reports its progress (PL4): first the
  // textures loading, then the shapes drawing.
  //
  //   Loom.mapPaint.paint(host, key, geometry, options)  draw it into `host`
  //   Loom.mapPaint.stats()                                 built and kept, for tests
  //   Loom.mapPaint.describe(key)                           what's drawn, for tests
  //   Loom.mapPaint.forget(key)                             drop a map's drawing
  //
  // options: { tile (map units a tile of ground covers; 5 on a grid),
  //            wall (a wall's thickness in map units; 1 on a grid),
  //            art (true: the map has its own art), tint (the world's accent,
  //            0xRRGGBB, or null), worldKinds (the world's object kinds),
  //            onProgress (fraction 0–1, then null when done), onChange
  //            (something new to show: draw the stage again) }

  var Loom = window.Loom;
  var mat = Loom.materials;
  var geo = Loom.mapGeometry;

  var BUDGET_MS = 8; // building, per frame
  var KEEP = 8; // maps kept drawn
  var TILE_PX = 64; // a ground tile's picture
  var STRIP_PX = { w: 64, h: 16 }; // a wall's, door's, window's or line's
  var TINT = 0.12; // how far the accent tints the ground and the walls
  var STEP_UP = 2.5; // a ledge: more than this between two floors (DA2)
  var OPEN_SWING = (75 * Math.PI) / 180; // an open door's swing
  var LOCKED = 0xff9e9e;
  var LIGHT_RGB = '255,214,150';
  var COLOURS = { door: 0xffb74d, doorLocked: 0xe57373, dark: 0x05070d, ledge: 0x05070d };

  var counts = { built: 0, kept: 0, removed: 0 };
  var maps = new Map(); // key → { root, layers, items, job }

  function now() {
    return window.performance ? window.performance.now() : Date.now();
  }

  // ── Textures ──────────────────────────────────────────────────────────

  var textures = {}; // url → { promise, texture, failed }
  var glow = null;

  // A texture loaded once, set to repeat (tiles and strips).
  function load(url) {
    if (textures[url]) return textures[url].promise;
    var entry = { texture: null, failed: false, promise: null };
    textures[url] = entry;
    entry.promise = window.PIXI.Assets.load({ src: url, data: { resolution: 1 } })
      .then(function (texture) {
        if (texture && texture.source && texture.source.style) {
          texture.source.style.addressMode = 'repeat';
          if (texture.source.style.update) texture.source.style.update();
        }
        entry.texture = texture;
        return texture;
      })
      .catch(function () {
        entry.failed = true;
        return null;
      });
    return entry.promise;
  }

  function loaded(url) {
    var entry = url && textures[url];
    return entry && entry.texture ? entry.texture : null;
  }

  // A light's glow: a soft disc, warm in the middle.
  function glowTexture() {
    if (glow) return glow;
    var size = 128;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(' + LIGHT_RGB + ',0.85)');
    g.addColorStop(0.5, 'rgba(' + LIGHT_RGB + ',0.35)');
    g.addColorStop(1, 'rgba(' + LIGHT_RGB + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    glow = window.PIXI.Texture.from(canvas);
    return glow;
  }

  function materialUrl(kind, id) {
    var m = mat.materialOf(kind, id);
    return m ? mat.artUrl(m.art) : null;
  }

  // The url an object's art is drawn from (OB1): its own, else its world's
  // for its kind (each a library image, which the page is sent as its link
  // alone, A5), else the catalog's file, else the box with a question mark.
  function objectUrl(item, worldKinds) {
    if (item.art && item.art.link) return item.art.link;
    var own = worldKinds && worldKinds[item.kind];
    if (own && own.art && own.art.link) return own.art.link;
    var art = mat.artFor(item, worldKinds);
    return art.ref ? art.ref.link || null : art.url;
  }

  // The url an object's card shows (L-926): its own card art, else what it
  // is drawn with.
  function cardUrl(item, worldKinds) {
    if (item.cardArt && item.cardArt.link) return item.cardArt.link;
    return objectUrl(item, worldKinds);
  }

  // ── Small helpers ─────────────────────────────────────────────────────

  function pt(p) {
    if (Array.isArray(p)) return { x: p[0], y: p[1] };
    return p && isFinite(p.x) && isFinite(p.y) ? { x: p.x, y: p.y } : null;
  }

  function flat(ring) {
    var out = [];
    ring.forEach(function (p) {
      out.push(p[0], p[1]);
    });
    return out;
  }

  // An accent mixed into white: how much the ground and walls are tinted.
  function tintOf(accent) {
    if (typeof accent !== 'number') return 0xffffff;
    var mix = function (shift) {
      var c = (accent >> shift) & 255;
      return Math.round(255 + (c - 255) * TINT) << shift;
    };
    return mix(16) | mix(8) | mix(0);
  }

  // A strip of art along a segment: a wall, a line, a door or a window.
  // `fit` stretches one picture over the whole length (doors, windows);
  // else it repeats, keeping its shape.
  function strip(texture, a, b, thick, fit, cap) {
    var PIXI = window.PIXI;
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!len) return null;
    var ext = cap ? thick / 2 : 0;
    var s = new PIXI.TilingSprite({ texture: texture, width: len + 2 * ext, height: thick });
    s.anchor.set(0, 0.5);
    var ux = dx / len;
    var uy = dy / len;
    s.position.set(a.x - ux * ext, a.y - uy * ext);
    s.rotation = Math.atan2(dy, dx);
    var sy = thick / STRIP_PX.h;
    s.tileScale.set(fit ? (len + 2 * ext) / STRIP_PX.w : sy, sy);
    return s;
  }

  function segmentsOf(points) {
    var out = [];
    for (var i = 1; i < points.length; i++) out.push([pt(points[i - 1]), pt(points[i])]);
    return out;
  }

  // ── What to draw ──────────────────────────────────────────────────────

  // The items of a map to draw, in order, each { key, layer, order, urls,
  // build(): a display object }.
  function itemsOf(geometry, o) {
    var PIXI = window.PIXI;
    var g = geometry || {};
    var list = function (k) {
      return Array.isArray(g[k]) ? g[k] : [];
    };
    var out = [];
    var add = function (layer, kind, item, i, urls, build) {
      out.push({
        key: kind + '|' + (item.id || i) + '|' + JSON.stringify(item),
        layer: layer,
        order: i,
        urls: urls.filter(Boolean),
        // What it is, for describe(): its kind, id, state and the art used.
        about: function () {
          var used = urls.filter(function (u) {
            return u && loaded(u);
          })[0];
          return {
            layer: layer,
            kind: kind,
            id: item.id || null,
            ...(item.state ? { state: item.state } : {}),
            ...(used ? { art: used } : {}),
          };
        },
        build: build,
      });
    };
    var tile = o.tile;
    var thick = o.wall;

    if (!o.art) {
      list('ground').forEach(function (item, i) {
        var read = geo.ringsOf(item.shape);
        if (!read.rings) return;
        var url = materialUrl('ground', item.material);
        add('ground', 'ground', item, i, [url], function () {
          var gfx = new PIXI.Graphics();
          var texture = loaded(url);
          var fill = texture
            ? (function () {
                var pattern = new PIXI.FillPattern(texture, 'repeat');
                var m = new PIXI.Matrix();
                m.scale(tile / TILE_PX, tile / TILE_PX);
                pattern.setTransform(m);
                return { fill: pattern };
              })()
            : { color: 0x6b6f78 };
          read.rings.forEach(function (ring) {
            gfx.poly(flat(ring));
          });
          gfx.fill(fill);
          return gfx;
        });
      });
      // Shading by height (DA2): the floors off the ground, then the ledges.
      var heights = list('ground').filter(function (item) {
        return typeof item.height === 'number' && item.height !== 0;
      });
      if (heights.length) {
        add('shading', 'shading', { ground: list('ground') }, 0, [], function () {
          return shading(list('ground'), thick);
        });
      }
      list('lines').forEach(function (item, i) {
        var read = geo.linesOf(item.points);
        if (!read.lines) return;
        var url = materialUrl('line', item.material);
        var width = typeof item.width === 'number' && item.width > 0 ? item.width : thick * 3;
        add('lines', 'line', item, i, [url], function () {
          var c = new PIXI.Container();
          var texture = loaded(url);
          read.lines.forEach(function (line) {
            segmentsOf(line).forEach(function (seg) {
              var s = texture ? strip(texture, seg[0], seg[1], width, false, true) : null;
              if (s) c.addChild(s);
            });
          });
          return c;
        });
      });
      // The walls, less where doors and windows stand (map-geometry.js).
      var compiled = geo.compile(g);
      var byWall = {};
      compiled.edges.forEach(function (e) {
        (byWall[e.id] = byWall[e.id] || []).push(e);
      });
      list('walls').forEach(function (item, i) {
        var url = materialUrl('wall', item.material);
        var edges = byWall[item.id] || [];
        add('walls', 'wall', item, i, [url], function () {
          var c = new PIXI.Container();
          var texture = loaded(url);
          edges.forEach(function (e) {
            var s = texture ? strip(texture, pt(e.a), pt(e.b), thick, false, true) : null;
            if (s) c.addChild(s);
          });
          return c;
        });
      });
      list('windows').forEach(function (item, i) {
        var url = materialUrl('window', item.material);
        add('openings', 'window', item, i, [url], function () {
          var a = pt(item.from);
          var b = pt(item.to);
          var texture = loaded(url);
          var s = texture && a && b ? strip(texture, a, b, thick * 0.8, true, false) : null;
          if (s && item.state === 'open') s.alpha = 0.55;
          return s || new PIXI.Container();
        });
      });
    }

    list('doors').forEach(function (item, i) {
      var url = o.art ? null : materialUrl('door', item.material);
      add('openings', 'door', item, i + 1000, [url], function () {
        var a = pt(item.from);
        var b = pt(item.to);
        if (!a || !b) return new PIXI.Container();
        var state = item.state || 'closed';
        if (o.art) return doorLine(a, b, state, thick);
        var texture = loaded(url);
        if (!texture) return doorLine(a, b, state, thick);
        if (state === 'open') {
          // Swung on its hinge, `from`.
          var len = Math.hypot(b.x - a.x, b.y - a.y);
          var angle = Math.atan2(b.y - a.y, b.x - a.x) + OPEN_SWING;
          var swung = { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
          var leaf = strip(texture, a, swung, thick * 0.6, true, false);
          leaf.alpha = 0.9;
          return leaf;
        }
        var shut = strip(texture, a, b, thick, true, false);
        if (state === 'locked') shut.tint = LOCKED;
        return shut;
      });
    });

    list('objects').forEach(function (item, i) {
      var url = objectUrl(item, o.worldKinds);
      add('objects', 'object', item, i, [url, mat.artUrl(mat.FALLBACK_ART)], function () {
        var at = pt(item.at);
        var size = Array.isArray(item.size)
          ? item.size
          : typeof item.size === 'number'
            ? [item.size, item.size]
            : mat.sizeFor(item.kind, o.worldKinds) || [tile, tile];
        var texture = loaded(url) || loaded(mat.artUrl(mat.FALLBACK_ART));
        if (!at || !texture) return new PIXI.Container();
        var s = new PIXI.Sprite(texture);
        s.anchor.set(0.5);
        s.position.set(at.x, at.y);
        s.width = size[0];
        s.height = size[1];
        s.rotation = ((Number(item.turn) || 0) * Math.PI) / 180;
        return s;
      });
    });

    var lights = list('lights');
    if (lights.length) {
      add('light', 'light', { lights: lights }, 0, [], function () {
        return lighting(lights);
      });
    }
    return out;
  }

  // A door over a map's own art (EX2), or one whose art is missing: a line by
  // its state, as the grid view drew doors before (closed amber, open dashed,
  // locked red).
  function doorLine(a, b, state, thick) {
    var gfx = new window.PIXI.Graphics();
    var colour = state === 'locked' ? COLOURS.doorLocked : COLOURS.door;
    if (state === 'open') {
      var len = Math.hypot(b.x - a.x, b.y - a.y);
      var n = Math.max(2, Math.round(len / (thick * 1.5)));
      for (var k = 0; k < n; k += 2) {
        var t0 = k / n;
        var t1 = Math.min(1, (k + 1) / n);
        gfx
          .moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0)
          .lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
      }
      gfx.stroke({ width: thick * 0.7, color: colour, alpha: 0.85 });
    } else {
      gfx
        .moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: thick * 0.9, color: colour });
    }
    return gfx;
  }

  // Shading by height: lighter up, darker down, a shadow along each ledge.
  function shading(ground, thick) {
    var PIXI = window.PIXI;
    var gfx = new PIXI.Graphics();
    var c = geo.compile({ ground: ground });
    c.ground.forEach(function (g) {
      var h = g.item.height;
      if (typeof h !== 'number' || !h) return;
      g.rings.forEach(function (ring) {
        gfx.poly(flat(ring));
      });
      gfx.fill(
        h > 0
          ? { color: 0xffffff, alpha: Math.min(0.2, h / 60) }
          : { color: COLOURS.dark, alpha: Math.min(0.45, -h / 25) }
      );
    });
    var floor = function (p) {
      var g = geo.groundAt(c, [p.x, p.y]);
      return g && typeof g.height === 'number' ? g.height : 0;
    };
    c.ground.forEach(function (g) {
      g.rings.forEach(function (ring) {
        for (var i = 0; i < ring.length; i++) {
          var a = { x: ring[i][0], y: ring[i][1] };
          var b = { x: ring[(i + 1) % ring.length][0], y: ring[(i + 1) % ring.length][1] };
          var len = Math.hypot(b.x - a.x, b.y - a.y);
          if (!len) continue;
          var nx = (-(b.y - a.y) / len) * 0.05;
          var ny = ((b.x - a.x) / len) * 0.05;
          var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          var diff =
            floor({ x: mid.x + nx, y: mid.y + ny }) - floor({ x: mid.x - nx, y: mid.y - ny });
          if (Math.abs(diff) <= STEP_UP) continue;
          gfx.moveTo(a.x, a.y).lineTo(b.x, b.y);
        }
      });
    });
    gfx.stroke({ width: thick * 0.8, color: COLOURS.ledge, alpha: 0.6 });
    return gfx;
  }

  // Light: dark areas shaded, lights glowing over them.
  function lighting(lights) {
    var PIXI = window.PIXI;
    var c = new PIXI.Container();
    var dark = new PIXI.Graphics();
    var any = false;
    lights.forEach(function (l) {
      if (!l.dark) return;
      var read = geo.ringsOf(l.shape);
      if (!read.rings) return;
      read.rings.forEach(function (ring) {
        dark.poly(flat(ring));
      });
      any = true;
    });
    if (any) dark.fill({ color: COLOURS.dark, alpha: 0.55 });
    c.addChild(dark);
    // A light: bright to its radius, dimmer out to `dim` where it has one.
    var glowAt = function (at, r, alpha) {
      var s = new PIXI.Sprite(glowTexture());
      s.anchor.set(0.5);
      s.position.set(at.x, at.y);
      s.width = s.height = r * 2;
      s.blendMode = 'add';
      s.alpha = alpha;
      c.addChild(s);
    };
    lights.forEach(function (l) {
      var at = pt(l.at);
      if (l.dark || !at || !(l.radius > 0)) return;
      if (l.dim > l.radius) glowAt(at, l.dim, 0.3);
      glowAt(at, l.radius, 0.7);
    });
    return c;
  }

  // ── Painting ──────────────────────────────────────────────────────────

  var LAYERS = ['ground', 'shading', 'lines', 'walls', 'openings', 'objects', 'light'];

  function stateOf(key) {
    var s = maps.get(key);
    if (s) {
      maps.delete(key);
      maps.set(key, s); // the most recent last
      return s;
    }
    var PIXI = window.PIXI;
    var root = new PIXI.Container();
    var layers = {};
    LAYERS.forEach(function (name) {
      var layer = new PIXI.Container();
      layer.sortableChildren = true;
      layers[name] = layer;
      root.addChild(layer);
    });
    s = { key: key, root: root, layers: layers, items: new Map(), job: 0 };
    maps.set(key, s);
    while (maps.size > KEEP) {
      var oldest = maps.keys().next().value;
      forget(oldest);
    }
    return s;
  }

  /** Drops a map's drawing. */
  function forget(key) {
    var s = maps.get(key);
    if (!s) return;
    maps.delete(key);
    if (s.root.parent) s.root.parent.removeChild(s.root);
    s.root.destroy({ children: true });
  }

  /**
   * Draws `geometry` into `host` as the map `key`: what's already drawn of it
   * is kept, what's new built, what's gone removed. Returns the map's root
   * container (for the drawer to place and scale) at once; the building
   * follows across frames.
   */
  function paint(host, key, geometry, options) {
    var o = options || {};
    o.tile = o.tile > 0 ? o.tile : 5;
    o.wall = o.wall > 0 ? o.wall : 1;
    var s = stateOf(key);
    // Only this map in the host.
    host.children.slice().forEach(function (child) {
      if (child !== s.root && child.__loomPaint) host.removeChild(child);
    });
    s.root.__loomPaint = true;
    if (s.root.parent !== host) host.addChildAt(s.root, 0);
    var tint = tintOf(o.tint);
    ['ground', 'lines', 'walls'].forEach(function (name) {
      s.layers[name].tint = tint;
    });

    var wanted = itemsOf(geometry, o);
    var keys = new Set(
      wanted.map(function (w) {
        return w.key;
      })
    );
    s.items.forEach(function (node, k) {
      if (keys.has(k)) return;
      if (node.parent) node.parent.removeChild(node);
      node.destroy({ children: true });
      s.items.delete(k);
      counts.removed += 1;
    });
    var todo = wanted.filter(function (w) {
      if (s.items.has(w.key)) {
        counts.kept += 1;
        return false;
      }
      return true;
    });
    var job = ++s.job;
    if (!todo.length) {
      if (o.onProgress) o.onProgress(null);
      return s.root;
    }
    // The textures first, then the shapes, a few at a time.
    var urls = [];
    todo.forEach(function (w) {
      w.urls.forEach(function (u) {
        if (urls.indexOf(u) < 0 && !loaded(u)) urls.push(u);
      });
    });
    var ready = 0;
    var started = now();
    var report = function (f) {
      if (o.onProgress && job === s.job) o.onProgress(Math.max(0, Math.min(1, f)));
    };
    report(0);
    Promise.all(
      urls.map(function (u) {
        return load(u).then(function () {
          ready += 1;
          report((0.4 * ready) / urls.length);
        });
      })
    ).then(function () {
      var i = 0;
      var built = now();
      counts.texturesMs = built - started;
      var step = function () {
        if (job !== s.job || s.root.destroyed) return;
        var t0 = now();
        while (i < todo.length && now() - t0 < BUDGET_MS) {
          var w = todo[i++];
          var node = w.build();
          node.zIndex = w.order;
          node.__loomPainted = w.about();
          s.layers[w.layer].addChild(node);
          s.items.set(w.key, node);
          counts.built += 1;
        }
        report(0.4 + (0.6 * i) / todo.length);
        if (o.onChange) o.onChange();
        if (i < todo.length) window.requestAnimationFrame(step);
        else {
          counts.drawMs = now() - built;
          if (o.onProgress) o.onProgress(null);
        }
      };
      step();
    });
    return s.root;
  }

  /** How much has been built and kept, for tests (a second visit builds nothing). */
  function stats() {
    return {
      built: counts.built,
      kept: counts.kept,
      removed: counts.removed,
      // The last paint: its textures' loading, and its shapes' drawing.
      texturesMs: counts.texturesMs || 0,
      drawMs: counts.drawMs || 0,
      maps: Array.from(maps.keys()),
    };
  }

  /** What's drawn of a map, layer by layer: [{ layer, kind, id, state?, art? }], for tests. */
  function describe(key) {
    var s = maps.get(key);
    if (!s) return null;
    var out = [];
    LAYERS.forEach(function (name) {
      s.layers[name].children.forEach(function (node) {
        if (node.__loomPainted) out.push(node.__loomPainted);
      });
    });
    return out;
  }

  Loom.mapPaint = {
    paint: paint,
    forget: forget,
    stats: stats,
    describe: describe,
    objectUrl: objectUrl,
    cardUrl: cardUrl,
    LAYERS: LAYERS,
  };
})();
