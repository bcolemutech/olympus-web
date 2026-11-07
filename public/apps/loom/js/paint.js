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
  //   objects   lying flat, with their art seen from above: their own, their
  //             world's for their kind, the catalog's, else the box with a
  //             question mark (OB1)
  //   standing  the three-quarter view (planning/game-art.md §4.1, TV2–TV5,
  //             SC1; L-941 / #795), one layer ordered by how far down the
  //             screen each thing's foot stands:
  //               walls      a face rising up the screen from the wall's foot,
  //                          RISE of a foot for each foot of its height (8 ft
  //                          unless it has its own), its top strip on it;
  //                          angled walls slanted, north-south walls showing
  //                          their top and their south end; a face from its
  //                          material's face picture, else its top's darkened
  //               doors      closed, an upright panel in the wall (a locked one
  //                          tinted red), the wall going on above it; open, a
  //                          thin upright leaf swung into the room on its hinge
  //               windows    an upright pane between the wall below its sill
  //                          and above its top
  //               objects    with a standing picture (materials.js standFor),
  //                          on the south edge of their footprint, as wide as
  //                          their size in feet and as tall as their picture's
  //                          proportions (never the picture's own size); one
  //                          with none lies flat, as before (TV5)
  //             and whatever the drawer adds to it (its tokens, standOf)
  //   light     dark areas shaded, lights glowing through them (drawing
  //             only, decided 2026-11-04)
  //
  // The fog is the drawer's, over all of it. A map with its own art (EX2)
  // has that art drawn in place of its ground, lines and walls: the painter
  // then draws only its doors, as thin lines by their state, and its objects,
  // standing on it. The rules (moving, sight, fog, clicks, paths) stay on the
  // flat map: only the drawing stands up.
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
  //                                                         (the standing layer in
  //                                                         its depth order)
  //   Loom.mapPaint.forget(key)                             drop a map's drawing
  //   Loom.mapPaint.standOf(key)                            the standing layer, for
  //                                                         the drawer's tokens
  //   Loom.mapPaint.standingAt(key, x, y)                   the standing object whose
  //                                                         picture is at a point
  //                                                         (map units), or null
  //   Loom.mapPaint.riseOf(geometry, options)               how far up the screen its
  //                                                         tallest wall reaches
  //
  // options: { tile (map units a tile of ground covers; 5 on a grid),
  //            wall (a wall's thickness in map units; 1 on a grid),
  //            art (true: the map has its own art), tint (the world's accent,
  //            0xRRGGBB, or null), worldKinds (the world's object kinds),
  //            onProgress (fraction 0–1, then null when done), onChange
  //            (something new to show: draw the stage again), feet (map
  //            units a foot of height is; 1 on a grid), stand (a container
  //            to put the standing layer in, so the drawer can lay it over
  //            its fog; else it goes in the map's own, under the light),
  //            standAt ({ x, y, scale }: where the map's units are in
  //            `stand`'s), set (the world's art set, L-944: its pictures
  //            over the built-in art; its manifest fetched the first time) }

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
  // The three-quarter view (TV2): a foot of height rises this far up the
  // screen, one angle for the game; a wall with no height of its own is
  // WALL_FT tall, a door DOOR_FT (or its wall's, if lower), a window from its
  // sill to its top.
  var RISE = 0.6;
  var WALL_FT = 8;
  var DOOR_FT = 7;
  var SILL_FT = 3;
  var WINDOW_FT = 6.5;
  var FACE_SHADE = 0x9a9a9a; // a face drawn from its top's picture
  var FACE_LIT = 0xe4e4e4; // a face drawn from its own
  var LEAF = 0.4; // an open door's leaf, as part of the wall's thickness
  var LIGHT_RGB = '255,214,150';
  var COLOURS = { door: 0xffb74d, doorLocked: 0xe57373, dark: 0x05070d, ledge: 0x05070d };

  var counts = { built: 0, kept: 0, removed: 0 };
  var maps = new Map(); // key → { root, layers, items, job }

  function now() {
    return window.performance ? window.performance.now() : Date.now();
  }

  // ── Textures ──────────────────────────────────────────────────────────

  var textures = {}; // url → { promise, texture, failed }
  var frames = {}; // an atlas frame's key → its texture, for sprites
  var tiles = {}; // a frame's key → a copy of it that repeats, for tiles and strips
  var glow = null;

  // A picture's key (L-944): a file's url, or an atlas frame as
  // `<atlas url>#x,y,w,h` (materials.js picture).
  function keyOf(picture) {
    if (!picture) return null;
    if (picture.url) return picture.url;
    return picture.atlas + '#' + picture.frame.join(',');
  }

  function split(key) {
    var at = key.lastIndexOf('#');
    if (at < 0) return null;
    var frame = key
      .slice(at + 1)
      .split(',')
      .map(Number);
    return frame.length === 4 && frame.every(isFinite)
      ? { atlas: key.slice(0, at), frame: frame }
      : null;
  }

  // A texture loaded once, set to repeat (tiles and strips). A frame's key
  // loads its atlas, once for all its frames.
  function load(key) {
    var part = split(key);
    var url = part ? part.atlas : key;
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

  function isLoaded(key) {
    if (!key) return false;
    var part = split(key);
    var entry = textures[part ? part.atlas : key];
    return Boolean(entry && entry.texture);
  }

  // A picture's texture once loaded, or null: a file's own, or a frame of its
  // atlas (sharing the atlas's pixels; for a sprite).
  function loaded(key) {
    if (!isLoaded(key)) return null;
    var part = split(key);
    if (!part) return textures[key].texture;
    if (frames[key]) return frames[key];
    var PIXI = window.PIXI;
    var base = textures[part.atlas].texture;
    var f = part.frame;
    frames[key] = new PIXI.Texture({
      source: base.source,
      frame: new PIXI.Rectangle(f[0], f[1], f[2], f[3]),
    });
    return frames[key];
  }

  // A picture's texture to repeat across a shape (a floor, a strip, a face):
  // a file's own, or an atlas frame copied out once, since a frame can't
  // repeat within its atlas.
  function loadedTiled(key) {
    var part = key && split(key);
    if (!part) return loaded(key);
    if (tiles[key]) return tiles[key];
    if (!isLoaded(key)) return null;
    var source = textures[part.atlas].texture.source;
    var image = source && source.resource;
    var f = part.frame;
    if (!image) return loaded(key);
    var canvas = document.createElement('canvas');
    canvas.width = f[2];
    canvas.height = f[3];
    canvas.getContext('2d').drawImage(image, f[0], f[1], f[2], f[3], 0, 0, f[2], f[3]);
    var texture = window.PIXI.Texture.from(canvas);
    texture.source.style.addressMode = 'repeat';
    if (texture.source.style.update) texture.source.style.update();
    tiles[key] = texture;
    return texture;
  }

  // ── Art sets (L-944) ──────────────────────────────────────────────────

  var sets = {}; // name → { promise, done }

  // A set's manifest, fetched once and registered (materials.js); one that
  // won't load or isn't right leaves the built-in art.
  function loadSet(name) {
    if (sets[name]) return sets[name].promise;
    var entry = { done: false, promise: null };
    sets[name] = entry;
    entry.promise = window
      .fetch(mat.ART_BASE + 'sets/' + encodeURIComponent(name) + '/manifest.json')
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (manifest) {
        if (manifest && manifest.name === name) mat.registerSet(manifest);
      })
      .catch(function () {})
      .then(function () {
        entry.done = true;
      });
    return entry.promise;
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

  // A material's art in the map's set (L-944; materials.js materialArt):
  // { key, span, face (a key or null) }.
  function materialOf(kind, id, set) {
    var art = mat.materialArt(kind, id, set);
    return { key: keyOf(art.picture), span: art.span, face: keyOf(art.face) };
  }

  // The url an object's art is drawn from lying flat (OB1): its own, else its
  // world's for its kind (each a library image, which the page is sent as its
  // link alone, A5), else its set's (a key, L-944), else the catalog's file,
  // else the box with a question mark.
  function objectUrl(item, worldKinds, set) {
    if (item.art && item.art.link) return item.art.link;
    var own = worldKinds && worldKinds[item.kind];
    if (own && own.art && own.art.link) return own.art.link;
    var art = mat.artFor(item, worldKinds, set);
    if (art.picture) return keyOf(art.picture);
    return art.ref ? art.ref.link || null : art.url;
  }

  // The url an object's card shows (L-926): its own card art, else its
  // picture: its set's standing one if it's a file of its own (a frame of an
  // atlas can't be put on a card), else what it is drawn with flat, else the
  // catalog's.
  function cardUrl(item, worldKinds, set) {
    if (item.cardArt && item.cardArt.link) return item.cardArt.link;
    var up = mat.standFor(item, worldKinds, set);
    if (up && up.picture.url) return up.picture.url;
    var url = objectUrl(item, worldKinds, set);
    return url && split(url) ? objectUrl(item, worldKinds, null) : url;
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
    // Scaled by the picture's own size, so art sharper than 64 × 16 (a
    // studio-made PNG) draws the same size as the SVG it replaces.
    var h = texture.height || STRIP_PX.h;
    var w = texture.width || STRIP_PX.w;
    var sy = thick / h;
    s.tileScale.set(fit ? (len + 2 * ext) / w : sy, sy);
    return s;
  }

  function segmentsOf(points) {
    var out = [];
    for (var i = 1; i < points.length; i++) out.push([pt(points[i - 1]), pt(points[i])]);
    return out;
  }

  // ── The three-quarter view (L-941) ────────────────────────────────────

  function lifted(p, h) {
    return { x: p.x, y: p.y - h };
  }

  // A picture tiled over a face: `fit` stretches it once along the face
  // (a door), else it repeats at the face's height (a wall's face picture)
  // or, for a top's strip standing in for a face, at its own scale.
  function faceScale(s, texture, len, h, thick, how) {
    var th = texture.height || STRIP_PX.h;
    var tw = texture.width || STRIP_PX.w;
    if (how === 'fit') s.tileScale.set(len / tw, len / tw);
    else if (how === 'face') s.tileScale.set(h / th, h / th);
    else s.tileScale.set(thick / th, thick / th);
  }

  // A face standing on a segment's foot (the south edge of its thickness),
  // from `base` up to `base + h` (map units up the screen): a parallelogram,
  // slanted with the segment. `along` keeps a tiled picture continuous
  // across a wall cut into pieces. Null for a north-south segment, which
  // shows no face.
  function face(texture, a, b, base, h, thick, how, along) {
    var PIXI = window.PIXI;
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!len || h <= 0 || Math.abs(dx) < 1e-6) return null;
    var p = dx > 0 ? a : b; // drawn west to east
    var ux = Math.abs(dx) / len;
    var uy = (dx > 0 ? dy : -dy) / len;
    var s = new PIXI.TilingSprite({ texture: texture, width: len, height: h });
    s.setFromMatrix(new PIXI.Matrix(ux, uy, 0, 1, p.x, p.y + thick / 2 - base - h));
    faceScale(s, texture, len, h, thick, how);
    if (along) s.tilePosition.x = -along;
    return s;
  }

  // The south end of a north-south piece: as wide as the wall, `h` tall.
  function endFace(texture, end, base, h, thick, how) {
    var PIXI = window.PIXI;
    if (h <= 0) return null;
    var s = new PIXI.TilingSprite({ texture: texture, width: thick, height: h });
    s.position.set(end.x - thick / 2, end.y + thick / 2 - base - h);
    faceScale(s, texture, thick, h, thick, how === 'fit' ? 'top' : how);
    return s;
  }

  // A segment standing up: its faces from `base` to `top` (map units up the
  // screen) and, with `cap`, its top strip at `top`. Cut into pieces no
  // longer than `piece` down the screen, so each stands in its own place in
  // the depth order: [{ node, depth, box }], `depth` its foot's y, `box`
  // what it covers on the screen in map units.
  function slab(a, b, o) {
    var PIXI = window.PIXI;
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!len) return [];
    var n = Math.max(1, Math.ceil(Math.abs(dy) / o.piece - 1e-9));
    var parts = [];
    var thick = o.thick;
    var southern = dy >= 0 ? n - 1 : 0;
    for (var k = 0; k < n; k++) {
      var p = { x: a.x + (dx * k) / n, y: a.y + (dy * k) / n };
      var q = { x: a.x + (dx * (k + 1)) / n, y: a.y + (dy * (k + 1)) / n };
      var along = (len * k) / n;
      var c = new PIXI.Container();
      var h = o.top - o.base;
      if (o.front && h > 0) {
        var f = face(o.front, p, q, o.base, h, thick, o.how, along);
        if (f) {
          f.tint = o.tint;
          c.addChild(f);
        }
        if (k === southern && Math.abs(dx) < Math.abs(dy)) {
          var end = endFace(o.front, dy >= 0 ? q : p, o.base, h, thick, o.how);
          if (end) {
            end.tint = o.tint;
            c.addChild(end);
          }
        }
      }
      if (o.cap) {
        var t = strip(o.cap, lifted(p, o.top), lifted(q, o.top), thick, false, true);
        if (t) {
          if (along) t.tilePosition.x = -along;
          if (o.capTint !== undefined) t.tint = o.capTint;
          c.addChild(t);
        }
      }
      if (!c.children.length) continue;
      var foot = Math.max(p.y, q.y) + thick / 2;
      parts.push({
        node: c,
        depth: foot,
        box: {
          x0: Math.min(p.x, q.x) - thick / 2,
          x1: Math.max(p.x, q.x) + thick / 2,
          y0: Math.min(p.y, q.y) - thick / 2 - o.top,
          y1: foot - o.base,
        },
      });
    }
    return parts;
  }

  // How far up the screen a height in feet stands, in map units.
  function riseFor(feet, o) {
    return feet * RISE * (o.feet > 0 ? o.feet : 1);
  }

  function heightOf(item, fallback) {
    return item && typeof item.height === 'number' && item.height > 0 ? item.height : fallback;
  }

  /** How far up the screen the tallest wall of a map reaches (map units). */
  function riseOf(geometry, options) {
    var o = options || {};
    var walls = (geometry && Array.isArray(geometry.walls) && geometry.walls) || [];
    var tallest = walls.length ? WALL_FT : 0;
    walls.forEach(function (w) {
      tallest = Math.max(tallest, heightOf(w, WALL_FT));
    });
    return riseFor(tallest, o);
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
    var add = function (layer, kind, item, i, urls, build, extra) {
      out.push({
        key: [kind, item.id || i, JSON.stringify(item), o.set || '', extra || ''].join('|'),
        layer: layer,
        order: i,
        urls: urls.filter(Boolean),
        // What it is, for describe(): its kind, id, state and the art used.
        about: function () {
          var used = urls.filter(function (u) {
            return isLoaded(u);
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
    var wallsById = {};
    list('walls').forEach(function (w) {
      if (w && w.id) wallsById[w.id] = w;
    });

    if (!o.art) {
      list('ground').forEach(function (item, i) {
        var read = geo.ringsOf(item.shape);
        if (!read.rings) return;
        var art = materialOf('ground', item.material, o.set);
        var url = art.key;
        var span = art.span;
        add('ground', 'ground', item, i, [url], function () {
          var gfx = new PIXI.Graphics();
          var texture = loadedTiled(url);
          var fill = texture
            ? (function () {
                var pattern = new PIXI.FillPattern(texture, 'repeat');
                var m = new PIXI.Matrix();
                // A picture spans `span` tiles, whatever its pixel size.
                var px = (texture.width || TILE_PX) / span;
                m.scale(tile / px, tile / px);
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
        var url = materialOf('line', item.material, o.set).key;
        var width = typeof item.width === 'number' && item.width > 0 ? item.width : thick * 3;
        add('lines', 'line', item, i, [url], function () {
          var c = new PIXI.Container();
          var texture = loadedTiled(url);
          read.lines.forEach(function (line) {
            segmentsOf(line).forEach(function (seg) {
              var s = texture ? strip(texture, seg[0], seg[1], width, false, true) : null;
              if (s) c.addChild(s);
            });
          });
          return c;
        });
      });
      // The walls, less where doors and windows stand (map-geometry.js),
      // standing (L-941).
      var compiled = geo.compile(g);
      var byWall = {};
      compiled.edges.forEach(function (e) {
        (byWall[e.id] = byWall[e.id] || []).push(e);
      });
      list('walls').forEach(function (item, i) {
        var wallArt = materialOf('wall', item.material, o.set);
        var url = wallArt.key;
        var fUrl = wallArt.face;
        var edges = byWall[item.id] || [];
        var top = riseFor(heightOf(item, WALL_FT), o);
        var cut = JSON.stringify(
          edges.map(function (e) {
            return [e.a, e.b];
          })
        );
        add(
          'standing',
          'wall',
          item,
          i,
          [url, fUrl],
          function () {
            var cap = loadedTiled(url);
            var own = loadedTiled(fUrl);
            var parts = [];
            edges.forEach(function (e) {
              parts = parts.concat(
                slab(pt(e.a), pt(e.b), {
                  piece: tile,
                  thick: thick,
                  base: 0,
                  top: top,
                  front: own || cap,
                  how: own ? 'face' : 'top',
                  tint: own ? FACE_LIT : FACE_SHADE,
                  cap: cap,
                })
              );
            });
            return parts;
          },
          cut + '|' + top
        );
      });
      // A window: an upright pane between the wall below its sill and above
      // its top, the wall's top strip over it.
      list('windows').forEach(function (item, i) {
        var url = materialOf('window', item.material, o.set).key;
        var wall = wallsById[item.wall] || null;
        var wallArt = wall ? materialOf('wall', wall.material, o.set) : {};
        var wUrl = wallArt.key || null;
        var fUrl = wallArt.face || null;
        var height = heightOf(wall, WALL_FT);
        var sill = Math.min(SILL_FT, height);
        var head = Math.min(heightOf(item, WINDOW_FT), height);
        var wallKey = wall ? wall.material + '|' + height + '|' + o.feet : '';
        add(
          'standing',
          'window',
          item,
          i,
          [url, wUrl, fUrl],
          function () {
            var a = pt(item.from);
            var b = pt(item.to);
            if (!a || !b) return [];
            var pane = loadedTiled(url);
            var cap = loadedTiled(wUrl);
            var own = loadedTiled(fUrl);
            var wallFace = own || cap;
            var common = { piece: tile, thick: thick, how: own ? 'face' : 'top' };
            var shade = own ? FACE_LIT : FACE_SHADE;
            var parts = slab(a, b, {
              ...common,
              base: 0,
              top: riseFor(sill, o),
              front: wallFace,
              tint: shade,
            });
            slab(a, b, {
              piece: tile,
              thick: thick * 0.8,
              base: riseFor(sill, o),
              top: riseFor(head, o),
              front: pane,
              how: 'fit',
              tint: 0xffffff,
            }).forEach(function (part) {
              part.node.alpha = item.state === 'open' ? 0.55 : 0.85;
              parts.push(part);
            });
            parts = parts.concat(
              slab(a, b, {
                ...common,
                base: riseFor(head, o),
                top: riseFor(height, o),
                front: wallFace,
                tint: shade,
                cap: cap || pane,
              })
            );
            return parts;
          },
          wallKey
        );
      });
    }

    // Doors: over a map's own art, flat lines by their state; else standing
    // (L-941): a closed one an upright panel in its wall, an open one a thin
    // leaf swung on its hinge (`from`), the wall going on above either.
    list('doors').forEach(function (item, i) {
      if (o.art) {
        add('openings', 'door', item, i + 1000, [], function () {
          var a = pt(item.from);
          var b = pt(item.to);
          if (!a || !b) return new PIXI.Container();
          return doorLine(a, b, item.state || 'closed', thick);
        });
        return;
      }
      var url = materialOf('door', item.material, o.set).key;
      var wall = wallsById[item.wall] || null;
      var wallArt = wall ? materialOf('wall', wall.material, o.set) : {};
      var wUrl = wallArt.key || null;
      var fUrl = wallArt.face || null;
      var height = heightOf(wall, WALL_FT);
      var tall = Math.min(heightOf(item, DOOR_FT), height);
      var see = (mat.materialOf('door', item.material) || {}).seeThrough;
      add(
        'standing',
        'door',
        item,
        i + 1000,
        [url, wUrl, fUrl],
        function () {
          var a = pt(item.from);
          var b = pt(item.to);
          if (!a || !b) return [];
          var state = item.state || 'closed';
          var leafArt = loadedTiled(url);
          var cap = loadedTiled(wUrl);
          var own = loadedTiled(fUrl);
          var parts = [];
          if (state === 'open') {
            var len = Math.hypot(b.x - a.x, b.y - a.y);
            var angle = Math.atan2(b.y - a.y, b.x - a.x) + OPEN_SWING;
            var swung = { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
            slab(a, swung, {
              piece: tile,
              thick: thick * LEAF,
              base: 0,
              top: riseFor(tall, o),
              front: leafArt,
              how: 'fit',
              tint: 0xffffff,
              cap: leafArt,
              capTint: FACE_SHADE,
            }).forEach(function (part) {
              if (see) part.node.alpha = 0.8;
              parts.push(part);
            });
          } else {
            slab(a, b, {
              piece: tile,
              thick: thick,
              base: 0,
              top: riseFor(tall, o),
              front: leafArt,
              how: 'fit',
              tint: state === 'locked' ? LOCKED : 0xffffff,
              cap: leafArt,
              capTint: state === 'locked' ? LOCKED : FACE_SHADE,
            }).forEach(function (part) {
              if (see) part.node.alpha = 0.8;
              parts.push(part);
            });
          }
          // The wall over the doorway. In a wall running down the screen, whose
          // face can't be seen, a shut door's own picture is its top strip, so
          // the door still shows.
          var across = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) || state === 'open';
          parts = parts.concat(
            slab(a, b, {
              piece: tile,
              thick: thick,
              base: riseFor(tall, o),
              top: riseFor(height, o),
              front: own || cap,
              how: own ? 'face' : 'top',
              tint: own ? FACE_LIT : FACE_SHADE,
              cap: across ? cap : leafArt || cap,
              capTint: across || !leafArt ? undefined : state === 'locked' ? LOCKED : undefined,
            })
          );
          if (!leafArt) {
            // Its art missing: the line by its state, lying flat, as before.
            var line = doorLine(a, b, state, thick);
            parts.push({
              node: line,
              depth: Math.max(a.y, b.y) + thick / 2,
              box: null,
            });
          }
          return parts;
        },
        (wall ? wall.material + '|' + height : '') + '|' + o.feet
      );
    });

    list('objects').forEach(function (item, i) {
      var size = Array.isArray(item.size)
        ? item.size
        : typeof item.size === 'number'
          ? [item.size, item.size]
          : mat.sizeFor(item.kind, o.worldKinds) || [tile, tile];
      var stand = mat.standFor(item, o.worldKinds, o.set);
      var standKey = stand ? keyOf(stand.picture) : null;
      if (stand) {
        // Standing on the south edge of its footprint (SC1): as wide as the
        // footprint turned by its `turn`, as tall as its picture's shape.
        add('standing', 'object', item, i, [standKey], function () {
          var at = pt(item.at);
          var texture = loaded(standKey);
          if (!at || !texture) return [];
          var turn = ((Number(item.turn) || 0) * Math.PI) / 180;
          var c = Math.abs(Math.cos(turn));
          var sn = Math.abs(Math.sin(turn));
          var w = size[0] * c + size[1] * sn;
          var d = size[0] * sn + size[1] * c;
          var tall = (w * (texture.height || 1)) / (texture.width || 1);
          var up = new PIXI.Sprite(texture);
          // Its foot (L-944: the point of the picture its manifest names) on the
          // middle of its footprint's south edge.
          up.anchor.set(stand.foot[0], stand.foot[1]);
          up.position.set(at.x, at.y + d / 2);
          up.width = w;
          up.height = tall;
          return [
            {
              node: up,
              depth: at.y + d / 2,
              box: {
                x0: at.x - w * stand.foot[0],
                x1: at.x + w * (1 - stand.foot[0]),
                y0: at.y + d / 2 - tall * stand.foot[1],
                y1: at.y + d / 2 + tall * (1 - stand.foot[1]),
              },
              hit: item.id || null,
            },
          ];
        });
        return;
      }
      var url = objectUrl(item, o.worldKinds, o.set);
      add('objects', 'object', item, i, [url, mat.artUrl(mat.FALLBACK_ART)], function () {
        var at = pt(item.at);
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

  // `walls` stays for the order of before; since L-941 walls stand, and only
  // a map with its own art lays anything (its doors' lines) in `openings`.
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
    // The standing layer (L-941): one container, sorted by each thing's foot.
    var stand = new PIXI.Container();
    stand.sortableChildren = true;
    stand.__loomStand = key;
    s = {
      key: key,
      root: root,
      layers: layers,
      stand: stand,
      standAt: { x: 0, y: 0, scale: 1 },
      items: new Map(),
      job: 0,
    };
    maps.set(key, s);
    while (maps.size > KEEP) {
      var oldest = maps.keys().next().value;
      forget(oldest);
    }
    return s;
  }

  /** Drops a map's drawing (what the drawer put in its standing layer is left to it). */
  function forget(key) {
    var s = maps.get(key);
    if (!s) return;
    maps.delete(key);
    s.stand.children.slice().forEach(function (child) {
      if (!child.__loomDepth && child.__loomDepth !== 0) s.stand.removeChild(child);
    });
    if (s.stand.parent) s.stand.parent.removeChild(s.stand);
    s.stand.destroy({ children: true });
    if (s.root.parent) s.root.parent.removeChild(s.root);
    s.root.destroy({ children: true });
  }

  // Where a standing part goes: wrapped in the map's units where the standing
  // layer is the drawer's own, its place in the order its foot's y there.
  function placePart(s, wrap) {
    var at = s.standAt;
    wrap.position.set(at.x, at.y);
    wrap.scale.set(at.scale);
    wrap.zIndex = at.y + wrap.__loomDepth * at.scale;
  }

  // The standing layer in the drawer's container, or in the map's own,
  // under the light.
  function hostStand(s, o) {
    var host = o.stand || s.root;
    if (o.stand) {
      o.stand.children.slice().forEach(function (child) {
        if (child !== s.stand && child.__loomStand) o.stand.removeChild(child);
      });
    }
    var at = o.stand && o.standAt ? o.standAt : { x: 0, y: 0, scale: 1 };
    var moved = at.x !== s.standAt.x || at.y !== s.standAt.y || at.scale !== s.standAt.scale;
    s.standAt = { x: at.x || 0, y: at.y || 0, scale: at.scale > 0 ? at.scale : 1 };
    if (s.stand.parent !== host) {
      if (s.stand.parent) s.stand.parent.removeChild(s.stand);
      if (host === s.root) host.addChildAt(s.stand, host.getChildIndex(s.layers.light));
      else host.addChild(s.stand);
    }
    if (moved) {
      s.stand.children.forEach(function (child) {
        if (child.__loomDepth !== undefined) placePart(s, child);
      });
    }
  }

  // An item's display objects: one in its layer, or its standing parts.
  function nodesOf(s, w) {
    var PIXI = window.PIXI;
    if (w.layer !== 'standing') {
      var node = w.build();
      node.zIndex = w.order;
      node.__loomPainted = w.about();
      s.layers[w.layer].addChild(node);
      return [node];
    }
    var about = w.about();
    return (w.build() || []).map(function (part, k) {
      var wrap = new PIXI.Container();
      wrap.addChild(part.node);
      wrap.__loomDepth = part.depth;
      wrap.__loomBox = part.box || null;
      wrap.__loomHit = part.hit || null;
      var info = {};
      Object.keys(about).forEach(function (name) {
        info[name] = about[name];
      });
      info.layer = 'standing';
      info.depth = Math.round(part.depth * 100) / 100;
      if (k) info.part = k;
      wrap.__loomPainted = info;
      placePart(s, wrap);
      s.stand.addChild(wrap);
      return wrap;
    });
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
    o.feet = o.feet > 0 ? o.feet : 1;
    // The map's art set (L-944), its manifest fetched the first time: the
    // map is painted once it has come (or failed, leaving the built-in art).
    if (o.set && !mat.setOf(o.set) && !(sets[o.set] && sets[o.set].done)) {
      var waiting = stateOf(key);
      if (o.onProgress) o.onProgress(0);
      loadSet(o.set).then(function () {
        if (!waiting.root.destroyed) paint(host, key, geometry, o);
      });
      return waiting.root;
    }
    var s = stateOf(key);
    // Only this map in the host.
    host.children.slice().forEach(function (child) {
      if (child !== s.root && child.__loomPaint) host.removeChild(child);
    });
    s.root.__loomPaint = true;
    if (s.root.parent !== host) host.addChildAt(s.root, 0);
    hostStand(s, o);
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
    s.items.forEach(function (nodes, k) {
      if (keys.has(k)) return;
      nodes.forEach(function (node) {
        if (node.parent) node.parent.removeChild(node);
        node.destroy({ children: true });
      });
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
        if (urls.indexOf(u) < 0 && !isLoaded(u)) urls.push(u);
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
          s.items.set(w.key, nodesOf(s, w));
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

  // The standing layer's children in the order they're drawn.
  function standingOrder(s) {
    return s.stand.children
      .map(function (node, i) {
        return { node: node, i: i };
      })
      .sort(function (a, b) {
        return a.node.zIndex - b.node.zIndex || a.i - b.i;
      })
      .map(function (e) {
        return e.node;
      });
  }

  /**
   * What's drawn of a map, layer by layer: [{ layer, kind, id, state?, art?,
   * depth?, part? }], for tests. The standing layer (L-941) comes in the
   * order it's drawn, back to front, with each part's `depth` (its foot's y
   * in map units) and what the drawer stood in it (its tokens, with what it
   * marked them with).
   */
  function describe(key) {
    var s = maps.get(key);
    if (!s) return null;
    var out = [];
    var standing = function () {
      standingOrder(s).forEach(function (node) {
        if (node.__loomPainted) out.push(node.__loomPainted);
      });
    };
    var inRoot = s.stand.parent === s.root;
    LAYERS.forEach(function (name) {
      if (name === 'light' && inRoot) standing();
      s.layers[name].children.forEach(function (node) {
        if (node.__loomPainted) out.push(node.__loomPainted);
      });
    });
    if (!inRoot) standing();
    return out;
  }

  /** A map's standing layer, for the drawer to stand its tokens in (by zIndex: their foot's y). */
  function standOf(key) {
    var s = maps.get(key);
    return s ? s.stand : null;
  }

  /**
   * The standing object whose picture is at a point (the map's units), the
   * front-most where pictures overlap, or null (L-941: a click on a standing
   * object's picture selects that object).
   */
  function standingAt(key, x, y) {
    var s = maps.get(key);
    if (!s) return null;
    var order = standingOrder(s);
    for (var i = order.length - 1; i >= 0; i--) {
      var node = order[i];
      var b = node.__loomBox;
      if (!node.__loomHit || !b || !node.visible) continue;
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return node.__loomHit;
    }
    return null;
  }

  Loom.mapPaint = {
    paint: paint,
    forget: forget,
    stats: stats,
    describe: describe,
    objectUrl: objectUrl,
    cardUrl: cardUrl,
    standOf: standOf,
    standingAt: standingAt,
    riseOf: riseOf,
    RISE: RISE,
    LAYERS: LAYERS,
  };
})();
