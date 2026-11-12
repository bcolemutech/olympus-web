(function () {
  'use strict';

  // Painting a map from its data (planning/maps-from-data.md §4.6, RD1, RD3,
  // RD4, EX2, PL4; L-924 / #728): the one painter the grid, area and region
  // drawers share. It draws a map's geometry (map-geometry.js) with the art
  // of its materials and objects (materials.js; the files under
  // /apps/loom/art/), in this order:
  //
  //   ground    each floor as its material's tile, repeating, or one of its
  //             variants picked by the floor's id (AR4); where it lies over
  //             a floor drawn before it, fading over that one along its edge,
  //             a foot or so (EN3; L-943 / #797)
  //   shading   by height: higher ground lighter, lower darker, a shadow
  //             along every ledge's edge (DA2)
  //   lines     rivers, roads and streets as strips of their material
  //   shadows   contact shadows (EN4; L-943): a soft band along the foot of
  //             each wall, window and shut door, and a soft ellipse under
  //             each object standing (the drawer's tokens have their own)
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
  //   Loom.mapPaint.cull(key, width, height)                draw only what a screen
  //                                                         that size shows of it, from
  //                                                         where the drawer placed it
  //                                                         (EN5; L-943), the rest kept
  //                                                         built; the drawer calls it
  //                                                         as its camera moves
  //   Loom.mapPaint.view(key, rect)                         the same for a rect in the
  //                                                         map's units (null: all), for
  //                                                         tests; describe() marks
  //                                                         what's culled
  //   Loom.mapPaint.fade(key, targets)                      fade the walls, doors and tall
  //                                                         objects standing over a
  //                                                         token, the cursor or the path
  //                                                         preview (TV1; L-942); the
  //                                                         drawer calls it as they move
  //   Loom.mapPaint.fading(key)                             pieces still easing, for tests
  //   Loom.mapPaint.shadowTexture()                         a contact shadow, for tokens
  //
  // options: { tile (map units a tile of ground covers; 5 on a grid),
  //            wall (a wall's thickness in map units; 1 on a grid),
  //            art (true: the map has its own art), tint (the world's accent,
  //            0xRRGGBB, or null), worldKinds (the world's object kinds),
  //            materials (the world's own ground, L-713: [{ id, like, art? }]),
  //            onProgress (fraction 0–1, then null when done), onChange
  //            (something new to show: draw the stage again), feet (map
  //            units a foot of height is; 1 on a grid), stand (a container
  //            to put the standing layer in, so the drawer can lay it over
  //            its fog; else it goes in the map's own, under the light),
  //            standAt ({ x, y, scale }: where the map's units are in
  //            `stand`'s), fades (true: the drawer fades what stands over its
  //            tokens, L-942, so long walls are cut along their length), set (the world's art set, L-944: its pictures
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
  // The finish (planning/game-art.md §4.2, EN3–EN5, AR4; L-943 / #797).
  var FADE_FT = 1; // a floor fades over the one under it this far past its edge
  var FADE_STEPS = 5; // strokes the fade is built of
  var FADE_ALPHA = 0.32; // each stroke's
  var SHADOW_ALPHA = 0.6; // a contact shadow's, at its darkest
  var BAND_FT = 1.5; // a wall's shadow, out from its foot
  var CULL_MARGIN = 0.15; // of the view's long side, drawn beyond it (at least two tiles)
  // Seeing behind walls (planning/game-art.md §4.1, TV1; L-942 / #796): a
  // piece standing over a token, the cursor or the path preview fades to this
  // much, taking this long to, and to come back.
  var FADE_TO = 0.3;
  var FADE_MS = 150;
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

  // A contact shadow (EN4, L-943): a soft dark disc, stretched to an
  // ellipse under what stands; and a band, darkest at its top, laid along a
  // wall's foot.
  var shadowTex = null;
  var bandTex = null;
  function shadowTexture() {
    if (shadowTex) return shadowTex;
    var size = 64;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,' + SHADOW_ALPHA + ')');
    g.addColorStop(0.55, 'rgba(0,0,0,' + SHADOW_ALPHA * 0.6 + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    shadowTex = window.PIXI.Texture.from(canvas);
    return shadowTex;
  }

  function bandTexture() {
    if (bandTex) return bandTex;
    var canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 32;
    var ctx = canvas.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, 'rgba(0,0,0,' + SHADOW_ALPHA * 0.9 + ')');
    g.addColorStop(0.4, 'rgba(0,0,0,' + SHADOW_ALPHA * 0.35 + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 32);
    bandTex = window.PIXI.Texture.from(canvas);
    return bandTex;
  }

  // A material's art in the map's set (L-944; materials.js materialArt):
  // { key, span, face (a key or null), variants (keys) }.
  function materialOf(kind, id, set, own) {
    var art = mat.materialArt(kind, id, set, own);
    return {
      key: keyOf(art.picture),
      span: art.span,
      face: keyOf(art.face),
      variants: (art.variants || []).map(keyOf).filter(Boolean),
    };
  }

  // A floor's picture for one area (AR4, L-943): its own or one of its
  // variants, picked by the area's id, so the same area always shows the same
  // one and areas side by side seldom match.
  function hashOf(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function variantOf(id, count) {
    return count > 1 ? hashOf(String(id)) % count : 0;
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

  // A box ({ x0, y0, x1, y1 }) round points, grown by `pad`.
  function boxOf(points, pad) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    points.forEach(function (p) {
      var q = pt(p);
      if (!q) return;
      b.x0 = Math.min(b.x0, q.x);
      b.y0 = Math.min(b.y0, q.y);
      b.x1 = Math.max(b.x1, q.x);
      b.y1 = Math.max(b.y1, q.y);
    });
    if (!isFinite(b.x0)) return null;
    var d = pad || 0;
    return { x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d };
  }

  function overlaps(a, b) {
    return Boolean(a && b) && a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
  }

  // Whether a point is inside rings (even-odd, so holes are out).
  function inside(rings, x, y) {
    var on = false;
    rings.forEach(function (ring) {
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var a = ring[i];
        var b = ring[j];
        if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
          on = !on;
        }
      }
    });
    return on;
  }

  // Where a floor lies over another (EN3, L-943): the runs of its edges
  // whose outside, just past them, is a floor drawn before it, each a list of
  // points ([x, y]) and whether it goes all the way round (`closed`).
  function edgesOver(rings, below) {
    var out = [];
    if (!below.length) return out;
    var step = 0.05 + FADE_FT * 0.25;
    var under = function (x, y) {
      return below.some(function (g) {
        return overlaps(g.box, { x0: x, y0: y, x1: x, y1: y }) && inside(g.rings, x, y);
      });
    };
    rings.forEach(function (ring) {
      var n = ring.length;
      var soft = [];
      for (var i = 0; i < n; i++) {
        var a = ring[i];
        var b = ring[(i + 1) % n];
        var len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!len) {
          soft.push(null);
          continue;
        }
        var mx = (a[0] + b[0]) / 2;
        var my = (a[1] + b[1]) / 2;
        var nx = (-(b[1] - a[1]) / len) * step;
        var ny = ((b[0] - a[0]) / len) * step;
        var o = inside(rings, mx + nx, my + ny) ? [mx - nx, my - ny] : [mx + nx, my + ny];
        soft.push(under(o[0], o[1]));
      }
      if (soft.every(Boolean)) {
        out.push({ points: ring.slice(), closed: true });
        return;
      }
      // Runs of soft edges, starting after a hard one so none is split.
      var start = soft.findIndex(function (v) {
        return !v;
      });
      var run = null;
      for (var k = 1; k <= n; k++) {
        var j = (start + k) % n;
        if (soft[j]) {
          if (!run) run = [ring[j]];
          run.push(ring[(j + 1) % n]);
        } else if (run) {
          out.push({ points: run, closed: false });
          run = null;
        }
      }
      if (run) out.push({ points: run, closed: false });
    });
    return out;
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
  // the depth order, and, with `span`, none longer than that along it, so one
  // can fade alone (L-942): [{ node, depth, box }], `depth` its foot's y,
  // `box` what it covers on the screen in map units.
  function slab(a, b, o) {
    var PIXI = window.PIXI;
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!len) return [];
    // Down the screen, a piece each `piece` (the depth order); along its length,
    // none longer than `span` (two pieces), so what fades over a token (L-942)
    // is the stretch of wall over it, not all of one running across the screen.
    var span = o.span > 0 ? o.span : Infinity;
    var n = Math.max(1, Math.ceil(Math.abs(dy) / o.piece - 1e-9), Math.ceil(len / span - 1e-9));
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

  // ── The finish's shadows (L-943) ──────────────────────────────────────

  // A wall's contact shadow (EN4): a soft band on the floor along its foot,
  // the side its face shows (south); one running more down the screen than
  // across, whose face can't be seen, a fainter one on its other side too.
  // `segs`: [[a, b]] the wall's pieces; null with none.
  function bands(segs, thick, o) {
    var PIXI = window.PIXI;
    var c = new PIXI.Container();
    var deep = BAND_FT * o.feet;
    var put = function (a, b, n, depth, alpha) {
      // The band's top along the wall's edge on the side `n`, its fade outwards.
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len = Math.hypot(dx, dy);
      var down = { x: -dy / len, y: dx / len }; // a sprite's own down, turned with it
      if (down.x * n.x + down.y * n.y < 0) {
        var t = a;
        a = b;
        b = t;
        dx = -dx;
        dy = -dy;
      }
      var sp = new PIXI.Sprite(bandTexture());
      sp.position.set(a.x + (n.x * thick) / 2, a.y + (n.y * thick) / 2);
      sp.rotation = Math.atan2(dy, dx);
      sp.width = len;
      sp.height = depth;
      sp.alpha = alpha;
      c.addChild(sp);
    };
    segs.forEach(function (seg) {
      var a = pt(seg[0]);
      var b = pt(seg[1]);
      if (!a || !b) return;
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len = Math.hypot(dx, dy);
      if (!len) return;
      var n = { x: -dy / len, y: dx / len };
      if (n.y < 0 || (n.y === 0 && n.x < 0)) n = { x: -n.x, y: -n.y };
      put(a, b, n, deep, 1);
      if (Math.abs(dy) > Math.abs(dx)) put(a, b, { x: -n.x, y: -n.y }, deep * 0.6, 0.6);
    });
    return c;
  }

  // A standing thing's contact shadow (EN4): a soft ellipse on the floor
  // under its footprint, `w` across and `d` deep around `at`, drawn toward
  // its foot (the footprint's south edge), so it shows below its picture.
  function ellipse(at, w, d) {
    var sp = new window.PIXI.Sprite(shadowTexture());
    sp.anchor.set(0.5);
    sp.position.set(at.x, at.y + d * 0.3);
    sp.width = w * 1.4;
    sp.height = Math.max(d * 1.1, w * 0.5);
    return sp;
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
    // `bounds`: what it covers lying flat, in map units, for culling (EN5);
    // null is never culled. A standing part's is its own `box`.
    var add = function (layer, kind, item, i, urls, build, extra, bounds) {
      out.push({
        key: [
          kind,
          item.id || i,
          JSON.stringify(item),
          o.set || '',
          // A world's own ground (L-713) is drawn with its art, which can change.
          kind === 'ground' && o.materials ? JSON.stringify(o.materials) : '',
          extra || '',
        ].join('|'),
        layer: layer,
        order: i,
        urls: urls.filter(Boolean),
        bounds: bounds || null,
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
    // Where the drawer fades what stands over its tokens (L-942), a long wall is
    // cut along its length too, in pieces of two tiles at most, so the stretch
    // over a token fades alone; elsewhere it's whole, as before.
    var standSlab = function (a, b, so) {
      return slab(a, b, Object.assign({ span: o.fades ? tile * 2 : 0 }, so));
    };
    var thick = o.wall;
    var wallsById = {};
    list('walls').forEach(function (w) {
      if (w && w.id) wallsById[w.id] = w;
    });

    if (!o.art) {
      // Each floor (AR4, EN3; L-943): its picture, or one of its variants
      // picked by its id; where it lies over a floor drawn before it, it
      // fades over that one along its edge, a foot or so, in strokes of its
      // own picture growing narrower and fainter outwards.
      var fade = FADE_FT * o.feet;
      var floors = [];
      list('ground').forEach(function (item, i) {
        var read = geo.ringsOf(item.shape);
        if (!read.rings) return;
        var art = materialOf('ground', item.material, o.set, o.materials);
        var choices = [art.key].concat(art.variants);
        var url = choices[variantOf(item.id || i, choices.length)];
        var span = art.span;
        var box = boxOf([].concat.apply([], read.rings), 0);
        var below = floors.filter(function (f) {
          return overlaps(f.box, {
            x0: box.x0 - fade,
            y0: box.y0 - fade,
            x1: box.x1 + fade,
            y1: box.y1 + fade,
          });
        });
        floors.push({ rings: read.rings, box: box });
        var soft = edgesOver(read.rings, below);
        add(
          'ground',
          'ground',
          item,
          i,
          [url],
          function () {
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
            for (var k = 0; k < FADE_STEPS && soft.length; k++) {
              soft.forEach(function (run) {
                if (run.closed) gfx.poly(flat(run.points), true);
                else gfx.poly(flat(run.points), false);
              });
              var width = (2 * fade * (FADE_STEPS - k)) / FADE_STEPS;
              gfx.stroke({ ...fill, width: width, cap: 'butt', join: 'round', alpha: FADE_ALPHA });
            }
            return gfx;
          },
          JSON.stringify(soft) + '|' + url,
          { x0: box.x0 - fade, y0: box.y0 - fade, x1: box.x1 + fade, y1: box.y1 + fade }
        );
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
        add(
          'lines',
          'line',
          item,
          i,
          [url],
          function () {
            var c = new PIXI.Container();
            var texture = loadedTiled(url);
            read.lines.forEach(function (line) {
              segmentsOf(line).forEach(function (seg) {
                var s = texture ? strip(texture, seg[0], seg[1], width, false, true) : null;
                if (s) c.addChild(s);
              });
            });
            return c;
          },
          '',
          boxOf([].concat.apply([], read.lines), width / 2)
        );
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
                standSlab(pt(e.a), pt(e.b), {
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
        if (edges.length) {
          var segs = edges.map(function (e) {
            return [e.a, e.b];
          });
          var reach = thick / 2 + BAND_FT * o.feet;
          add(
            'shadows',
            'shadow',
            item,
            i,
            [],
            function () {
              return bands(segs, thick, o);
            },
            'wall|' + cut,
            boxOf([].concat.apply([], segs), reach)
          );
        }
      });
      // A window: an upright pane between the wall below its sill and above
      // its top, the wall's top strip over it.
      list('windows').forEach(function (item, i) {
        var paneArt = materialOf('window', item.material, o.set);
        var url = paneArt.key;
        // A set's painted pane (its `face`, L-946), stretched over the opening.
        var pFace = paneArt.face;
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
          [pFace, url, wUrl, fUrl],
          function () {
            var a = pt(item.from);
            var b = pt(item.to);
            if (!a || !b) return [];
            var pane = loadedTiled(pFace) || loadedTiled(url);
            var cap = loadedTiled(wUrl);
            var own = loadedTiled(fUrl);
            var wallFace = own || cap;
            var common = { piece: tile, thick: thick, how: own ? 'face' : 'top' };
            var shade = own ? FACE_LIT : FACE_SHADE;
            var parts = standSlab(a, b, {
              ...common,
              base: 0,
              top: riseFor(sill, o),
              front: wallFace,
              tint: shade,
            });
            standSlab(a, b, {
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
              standSlab(a, b, {
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
        add(
          'shadows',
          'shadow',
          item,
          i + 2000,
          [],
          function () {
            return bands([[item.from, item.to]], thick, o);
          },
          'window',
          boxOf([item.from, item.to], thick / 2 + BAND_FT * o.feet)
        );
      });
    }

    // Doors: over a map's own art, flat lines by their state; else standing
    // (L-941): a closed one an upright panel in its wall, an open one a thin
    // leaf swung on its hinge (`from`), the wall going on above either.
    list('doors').forEach(function (item, i) {
      if (o.art) {
        add(
          'openings',
          'door',
          item,
          i + 1000,
          [],
          function () {
            var a = pt(item.from);
            var b = pt(item.to);
            if (!a || !b) return new PIXI.Container();
            return doorLine(a, b, item.state || 'closed', thick);
          },
          '',
          boxOf([item.from, item.to], thick)
        );
        return;
      }
      var doorArt = materialOf('door', item.material, o.set);
      var url = doorArt.key;
      // A set's painted front (its `face`, L-946), a portrait over the leaf.
      var dFace = doorArt.face;
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
        [dFace, url, wUrl, fUrl],
        function () {
          var a = pt(item.from);
          var b = pt(item.to);
          if (!a || !b) return [];
          var state = item.state || 'closed';
          var leafArt = loadedTiled(url);
          var leafFront = loadedTiled(dFace) || leafArt;
          var cap = loadedTiled(wUrl);
          var own = loadedTiled(fUrl);
          var parts = [];
          if (state === 'open') {
            var len = Math.hypot(b.x - a.x, b.y - a.y);
            var angle = Math.atan2(b.y - a.y, b.x - a.x) + OPEN_SWING;
            var swung = { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
            standSlab(a, swung, {
              piece: tile,
              thick: thick * LEAF,
              base: 0,
              top: riseFor(tall, o),
              front: leafFront,
              how: 'fit',
              tint: 0xffffff,
              cap: leafArt,
              capTint: FACE_SHADE,
            }).forEach(function (part) {
              if (see) part.node.alpha = 0.8;
              parts.push(part);
            });
          } else {
            standSlab(a, b, {
              piece: tile,
              thick: thick,
              base: 0,
              top: riseFor(tall, o),
              front: leafFront,
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
            standSlab(a, b, {
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
      if ((item.state || 'closed') !== 'open') {
        add(
          'shadows',
          'shadow',
          item,
          i + 1000,
          [],
          function () {
            return bands([[item.from, item.to]], thick, o);
          },
          'door',
          boxOf([item.from, item.to], thick / 2 + BAND_FT * o.feet)
        );
      }
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
              // Decor has no click menu (L-945): a click goes through it.
              hit: mat.isDecor(item) ? null : item.id || null,
              // A tall one (the sight rule's: its own `blocksSight`, else its
              // kind's) fades over what's behind it (L-942).
              fades:
                typeof item.blocksSight === 'boolean'
                  ? item.blocksSight
                  : Boolean((mat.objectKind(item.kind) || {}).blocksSight),
            },
          ];
        });
        // Its contact shadow, on the floor under its footprint (EN4), turned
        // as it is.
        var turned = ((Number(item.turn) || 0) * Math.PI) / 180;
        var sw = size[0] * Math.abs(Math.cos(turned)) + size[1] * Math.abs(Math.sin(turned));
        var sd = size[0] * Math.abs(Math.sin(turned)) + size[1] * Math.abs(Math.cos(turned));
        var foot = Math.max(sw, sd);
        add(
          'shadows',
          'shadow',
          item,
          i + 3000,
          [],
          function () {
            var at = pt(item.at);
            return at ? ellipse(at, sw, sd) : new PIXI.Container();
          },
          'object',
          boxOf([item.at], foot)
        );
        return;
      }
      var url = objectUrl(item, o.worldKinds, o.set);
      add(
        'objects',
        'object',
        item,
        i,
        [url, mat.artUrl(mat.FALLBACK_ART)],
        function () {
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
        },
        '',
        boxOf([item.at], Math.hypot(size[0], size[1]) / 2)
      );
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
  // `shadows` (L-943): the contact shadows of what stands, on the floor.
  var LAYERS = ['ground', 'shading', 'lines', 'shadows', 'walls', 'openings', 'objects', 'light'];

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
      view: null, // what's in view, in map units, for culling (EN5); null: all of it
      onChange: null, // the drawer's, to draw the stage again
      fadeTargets: null, // what's to be seen behind walls (L-942)
      fadeSig: '',
      easing: false,
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

  // ── Culling (EN5, L-943) ──────────────────────────────────────────────

  // Whether a node is out of the view (plus its margin): it isn't drawn,
  // but stays built, and shows again once the view comes back to it.
  function culls(s, node) {
    var v = s.view;
    var b = node.__loomBounds;
    var out = Boolean(v && b) && !overlaps(b, v);
    node.__loomCulled = out;
    node.visible = !out;
  }

  function cullAll(s) {
    s.items.forEach(function (nodes) {
      nodes.forEach(function (node) {
        culls(s, node);
      });
    });
  }

  /**
   * Culls a map's drawing to a view: `rect` { x0, y0, x1, y1 } in the map's
   * units (what the screen shows of it), grown by a margin; null draws all
   * of it. Returns how many of its pieces are culled.
   */
  function view(key, rect) {
    var s = maps.get(key);
    if (!s) return 0;
    var v = null;
    if (rect && isFinite(rect.x0) && isFinite(rect.x1) && isFinite(rect.y0) && isFinite(rect.y1)) {
      var m = Math.max(
        (s.tile || 5) * 2,
        CULL_MARGIN * Math.max(rect.x1 - rect.x0, rect.y1 - rect.y0)
      );
      v = { x0: rect.x0 - m, y0: rect.y0 - m, x1: rect.x1 + m, y1: rect.y1 + m };
    }
    var same =
      (v === null && s.view === null) ||
      (v &&
        s.view &&
        ['x0', 'y0', 'x1', 'y1'].every(function (k) {
          return Math.abs(v[k] - s.view[k]) < 1e-6;
        }));
    if (!same) {
      s.view = v;
      cullAll(s);
    }
    return culledOf(s);
  }

  function culledOf(s) {
    var n = 0;
    s.items.forEach(function (nodes) {
      nodes.forEach(function (node) {
        if (node.__loomCulled) n += 1;
      });
    });
    return n;
  }

  /**
   * Culls a map's drawing to what a screen `width` × `height` px shows of it,
   * from where its drawer has placed it (its root's position and scale, and
   * its parents'), for a drawer to call as its camera moves.
   */
  function cull(key, width, height) {
    var s = maps.get(key);
    if (!s || !(width > 0) || !(height > 0)) return 0;
    var sx = 1;
    var sy = 1;
    var ox = 0;
    var oy = 0;
    for (var node = s.root; node; node = node.parent) {
      ox = ox * node.scale.x + node.position.x;
      oy = oy * node.scale.y + node.position.y;
      sx *= node.scale.x;
      sy *= node.scale.y;
    }
    if (!sx || !sy) return 0;
    return view(key, {
      x0: (0 - ox) / sx,
      y0: (0 - oy) / sy,
      x1: (width - ox) / sx,
      y1: (height - oy) / sy,
    });
  }

  // ── Seeing behind walls (TV1, L-942) ──────────────────────────────────

  // Whether a standing piece covers any of the targets: its picture overlaps
  // them and it stands in front of them (its foot further down the screen).
  function covers(wrap, targets) {
    var box = wrap.__loomBox;
    if (!box) return false;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (t.depth < wrap.__loomDepth && overlaps(box, t.box)) return true;
    }
    return false;
  }

  function reducedMotion() {
    return Boolean(
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  // Eases the pieces that are changing toward their alpha, a frame at a time,
  // asking the drawer to draw each.
  function easeFades(s) {
    if (s.easing) return;
    s.easing = true;
    var last = now();
    var step = function () {
      if (maps.get(s.key) !== s || s.root.destroyed) {
        s.easing = false;
        return;
      }
      var t = now();
      var move = ((t - last) * (1 - FADE_TO)) / FADE_MS;
      last = t;
      var moving = false;
      s.stand.children.forEach(function (wrap) {
        var want = wrap.__loomWant === undefined ? 1 : wrap.__loomWant;
        if (!wrap.__loomFades || wrap.alpha === want) return;
        wrap.alpha =
          wrap.alpha < want ? Math.min(want, wrap.alpha + move) : Math.max(want, wrap.alpha - move);
        if (wrap.alpha !== want) moving = true;
      });
      if (s.onChange) s.onChange();
      if (moving) window.requestAnimationFrame(step);
      else s.easing = false;
    };
    window.requestAnimationFrame(step);
  }

  /**
   * Fades what stands over what's behind it (L-942; TV1). `targets`: what's
   * to be seen, each { box: { x0, y0, x1, y1 }, depth } in the map's units, a
   * token's disc (its foot's y the depth), the cursor's or the path preview's
   * points (a floor point, its y the depth). A wall piece, window, door or
   * tall object whose picture overlaps one and whose foot is further down
   * the screen fades to 30% over 150 ms; the rest return, the same way. Only
   * the pieces covering fade, not whole walls. Call it as they change: one
   * with the same targets as the last does nothing.
   */
  function fade(key, targets) {
    var s = maps.get(key);
    if (!s) return;
    var list = (targets || []).filter(function (t) {
      return t && t.box && isFinite(t.depth);
    });
    var sig = list
      .map(function (t) {
        return [t.box.x0, t.box.y0, t.box.x1, t.box.y1, t.depth]
          .map(function (n) {
            return Math.round(n * 10);
          })
          .join(',');
      })
      .join(';');
    if (sig === s.fadeSig) return;
    s.fadeSig = sig;
    s.fadeTargets = list;
    var instant = reducedMotion();
    var easing = false;
    s.stand.children.forEach(function (wrap) {
      if (!wrap.__loomFades) return;
      var want = list.length && covers(wrap, list) ? FADE_TO : 1;
      wrap.__loomWant = want;
      if (instant) wrap.alpha = want;
      else if (wrap.alpha !== want) easing = true;
    });
    if (instant && s.onChange) s.onChange();
    else if (easing) easeFades(s);
  }

  /** How many pieces of a map are still easing toward their alpha, for tests. */
  function fading(key) {
    var s = maps.get(key);
    if (!s) return 0;
    return s.stand.children.filter(function (wrap) {
      return wrap.__loomFades && wrap.__loomWant !== undefined && wrap.alpha !== wrap.__loomWant;
    }).length;
  }

  // An item's display objects: one in its layer, or its standing parts.
  function nodesOf(s, w) {
    var PIXI = window.PIXI;
    if (w.layer !== 'standing') {
      var node = w.build();
      node.zIndex = w.order;
      node.__loomPainted = w.about();
      node.__loomBounds = w.bounds;
      culls(s, node);
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
      // What fades over what's behind it (L-942): walls, windows and doors
      // (an open door's leaf and the wall over its doorway too), and tall objects.
      wrap.__loomFades =
        about.kind === 'object'
          ? Boolean(part.fades)
          : about.kind === 'wall' || about.kind === 'window' || about.kind === 'door';
      var info = {};
      Object.keys(about).forEach(function (name) {
        info[name] = about[name];
      });
      info.layer = 'standing';
      info.depth = Math.round(part.depth * 100) / 100;
      if (k) info.part = k;
      wrap.__loomPainted = info;
      wrap.__loomBounds = part.box || null;
      culls(s, wrap);
      // Built while something is behind it: faded at once.
      if (s.fadeTargets && wrap.__loomFades && covers(wrap, s.fadeTargets)) {
        wrap.__loomWant = FADE_TO;
        wrap.alpha = FADE_TO;
      }
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
    s.tile = o.tile;
    s.onChange = o.onChange || null;
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
      // Pieces culled, by map (L-943).
      culled: Array.from(maps.keys()).reduce(function (acc, k) {
        acc[k] = culledOf(maps.get(k));
        return acc;
      }, {}),
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
    var push = function (node) {
      if (!node.__loomPainted) return;
      var faded = node.__loomWant !== undefined && node.__loomWant < 1;
      if (!node.__loomCulled && !faded) {
        out.push(node.__loomPainted);
        return;
      }
      // A culled piece (L-943) and a faded one (L-942) say so.
      var info = Object.assign({}, node.__loomPainted);
      if (node.__loomCulled) info.culled = true;
      if (faded) info.faded = true;
      out.push(info);
    };
    var standing = function () {
      standingOrder(s).forEach(push);
    };
    var inRoot = s.stand.parent === s.root;
    LAYERS.forEach(function (name) {
      if (name === 'light' && inRoot) standing();
      s.layers[name].children.forEach(push);
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
    view: view,
    cull: cull,
    fade: fade,
    fading: fading,
    shadowTexture: shadowTexture,
    variantOf: variantOf,
    RISE: RISE,
    LAYERS: LAYERS,
  };
})();
