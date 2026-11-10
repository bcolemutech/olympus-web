(function () {
  'use strict';

  // Drawing helpers the map engine's layers share (L-722, L-723): lines and
  // dashed paths in screen space, a padlock for a locked place, map labels,
  // and tokens.
  //
  // A token (A6) is a person's picture in a round frame, or their initials
  // in it (L-932); in the grid view it stands upright on a small base.

  var Loom = window.Loom;

  var FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  var DARK = 0x0a0e1a;

  /** A line from a to b, dashed if asked: dashes [dash, gap] in px. */
  function line(g, a, b, dashes) {
    polyline(g, [a, b], dashes);
  }

  /** A line through points, dashed if asked, the dashes running on round the bends. */
  function polyline(g, points, dashes) {
    if (points.length < 2) return;
    if (!dashes) {
      g.moveTo(points[0].x, points[0].y);
      for (var i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
      return;
    }
    var period = dashes[0] + dashes[1];
    var phase = 0; // how far into the pattern each leg starts
    for (var j = 1; j < points.length; j++) {
      var a = points[j - 1];
      var b = points[j];
      var length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!length) continue;
      var ux = (b.x - a.x) / length;
      var uy = (b.y - a.y) / length;
      var at = -phase;
      while (at < length) {
        var from = Math.max(0, at);
        var to = Math.min(length, at + dashes[0]);
        if (to > from) {
          g.moveTo(a.x + ux * from, a.y + uy * from).lineTo(a.x + ux * to, a.y + uy * to);
        }
        at += period;
      }
      phase = (phase + length) % period;
    }
  }

  /** A small padlock with its corner at (x, y), beside a locked place. */
  function padlock(g, x, y, colour) {
    g.moveTo(x + 0.8, y - 1)
      .arc(x + 3, y - 1, 2.2, Math.PI, 0)
      .stroke({ width: 1.2, color: colour });
    g.rect(x, y - 1, 6, 4.5).fill({ color: colour });
  }

  /** A map label: centred under its point, with a dark edge to read over art. */
  function label(text, size) {
    var node = new window.PIXI.Text({
      text: text,
      style: {
        fontFamily: FONT,
        fontSize: size || 12,
        fill: 0xe0e0e0,
        stroke: { color: DARK, width: 3, alpha: 0.85 },
      },
    });
    node.anchor.set(0.5, 0);
    return node;
  }

  /** "Tam Brook" → "TB"; "Tam" → "T". */
  function initialsOf(name) {
    return String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (word) {
        return word.charAt(0).toUpperCase();
      })
      .join('');
  }

  // Token pictures (L-932), loaded once each by their link and kept: a
  // texture, or the callbacks waiting for it.
  var pictures = {};

  /**
   * A token's picture by its link: the texture once loaded, else null (and
   * `onLoad` is called when it arrives). One that fails stays initials.
   */
  function picture(link, onLoad) {
    var entry = pictures[link];
    if (!entry) {
      entry = pictures[link] = { texture: null, failed: false, waiting: [] };
      loadTexture({ url: link })
        .then(function (texture) {
          entry.texture = texture;
          entry.waiting.splice(0).forEach(function (fn) {
            fn();
          });
        })
        .catch(function (err) {
          entry.failed = true;
          entry.waiting = [];
          console.error('Could not load a token picture:', err);
        });
    }
    if (!entry.texture && !entry.failed && onLoad && entry.waiting.indexOf(onLoad) < 0) {
      entry.waiting.push(onLoad);
    }
    return entry.texture;
  }

  var LIFT = 0.35; // how far a standing disc's bottom is off the floor, in radii (its stem)
  var GREY = 0x9e9e9e; // someone down
  var MARK = 0x3a0d0d; // the cross on someone down

  /**
   * A token (A6; planning/tokens.md §4.2, TK3, TK5; L-932): a person's picture
   * in a round frame, the ring coloured by their side, or their initials in
   * it with no picture (or until it loads).
   *
   * update({ x, y, radius, name, fill, edge?, ink?, ring?, turn?, picture?,
   * standing?, down?, shadow?, onLoad? }) moves and restyles it: (x, y) is
   * where they stand; `fill` their side's colour (the ring, and the disc
   * behind initials); `ring` the player's own highlight; `turn` a ring for
   * the one whose turn is playing; `picture` { link, crop } (crop { x, y,
   * zoom }: the circle's centre on the image, 0–1, and how far in);
   * `standing` stands the disc upright on a small base with its foot at
   * (x, y), as the grid view's three-quarter view draws people (else it lies
   * on its point, as the town view's); `down` lays it flat on the floor,
   * greyed, with a cross; `onLoad` is called when its picture arrives.
   */
  function token() {
    var PIXI = window.PIXI;
    var container = new PIXI.Container();
    var base = new PIXI.Graphics(); // the stand, under a standing disc
    var face = new PIXI.Container(); // the disc, raised when standing
    var back = new PIXI.Graphics();
    var photo = new PIXI.Sprite();
    var clip = new PIXI.Graphics();
    var frame = new PIXI.Graphics();
    var mark = new PIXI.Graphics();
    var text = new PIXI.Text({
      text: '',
      style: { fontFamily: FONT, fontSize: 10, fontWeight: '700', fill: DARK },
    });
    text.anchor.set(0.5, 0.5);
    photo.visible = false;
    photo.mask = clip;
    face.addChild(back, photo, clip, text, frame, mark);
    container.addChild(base, face);
    var shadow = null;
    var last = null;
    var options = null;
    var api = {
      container: container,
      /** Whether its picture is drawn (not initials). */
      get pictured() {
        return photo.visible;
      },
      update: function (o) {
        container.position.set(o.x, o.y);
        options = o;
        var link = o.picture && o.picture.link ? o.picture.link : null;
        var texture = link ? picture(link, loaded) : null;
        var crop = (o.picture && o.picture.crop) || {};
        var key = [
          o.radius,
          o.name,
          o.fill,
          o.edge,
          o.ink,
          o.ring,
          o.turn,
          o.shadow,
          o.standing,
          o.down,
          link,
          Boolean(texture),
          crop.x,
          crop.y,
          crop.zoom,
        ].join('|');
        if (key === last) return;
        last = key;
        draw(o, texture, crop);
      },
    };

    // Its picture arrived: drawn now, and the view told.
    function loaded() {
      if (!options) return;
      last = null;
      api.update(options);
      if (options.onLoad) options.onLoad();
    }

    function draw(o, texture, crop) {
      var r = o.radius;
      var standing = Boolean(o.standing) && !o.down;
      var lift = standing ? r * LIFT : 0;
      // The disc's middle: raised on its stem when standing.
      var cy = standing ? -(lift + r) : 0;
      // A token standing (the grid view, L-943; EN4) has a soft contact
      // shadow on the floor under it, from the painter.
      var paint = Loom.mapPaint;
      if (o.shadow && paint && paint.shadowTexture) {
        if (!shadow) {
          shadow = new PIXI.Sprite(paint.shadowTexture());
          shadow.anchor.set(0.5);
          container.addChildAt(shadow, 0);
        }
        if (standing) {
          shadow.position.set(0, 0);
          shadow.width = r * 1.9;
          shadow.height = r * 0.7;
        } else {
          shadow.position.set(0, r * 0.55);
          shadow.width = r * 2.5;
          shadow.height = r * 1.1;
        }
        shadow.visible = true;
      } else if (shadow) {
        shadow.visible = false;
      }

      // The stand: a small oval base on the floor and a short stem up to the disc.
      base.clear();
      if (standing) {
        base
          .ellipse(0, 0, r * 0.62, r * 0.2)
          .fill({ color: 0x2b2f3a })
          .stroke({ width: Math.max(1, r * 0.06), color: o.fill, alpha: 0.9 });
        base.rect(-r * 0.07, -lift - r * 0.05, r * 0.14, lift + r * 0.05).fill({ color: 0x2b2f3a });
      }

      face.position.set(0, cy);
      // Down, it lies on the floor: seen from above at an angle, squashed.
      face.scale.set(1, o.down ? 0.55 : 1);
      var side = o.down ? GREY : o.fill;
      var ringWidth = Math.max(2, r * 0.16);
      var inner = r - ringWidth;

      back.clear();
      back.circle(0, 0, inner).fill({ color: texture ? DARK : side });

      // The picture, clipped to the circle at its crop.
      clip.clear();
      if (texture) {
        var w = texture.width;
        var h = texture.height;
        var zoom = typeof crop.zoom === 'number' && crop.zoom >= 1 ? crop.zoom : 1;
        var across = Math.min(w, h) / zoom; // the image's pixels the circle spans
        var k = (inner * 2) / across;
        photo.texture = texture;
        photo.anchor.set(
          typeof crop.x === 'number' ? crop.x : 0.5,
          typeof crop.y === 'number' ? crop.y : 0.5
        );
        photo.scale.set(k);
        photo.position.set(0, 0);
        photo.tint = o.down ? 0x8a8a8a : 0xffffff;
        photo.visible = true;
        clip.circle(0, 0, inner).fill({ color: 0xffffff });
        text.visible = false;
      } else {
        photo.visible = false;
        text.visible = true;
        text.text = initialsOf(o.name);
        text.style.fontSize = Math.max(8, Math.round(inner * (text.text.length > 1 ? 0.85 : 1.1)));
        text.style.fill = o.ink === undefined ? DARK : o.ink;
      }

      // The frame: a ring in the side's colour, dark edges either side; the
      // player's highlight and the turn's ring outside it.
      frame.clear();
      frame
        .circle(0, 0, r - ringWidth / 2)
        .stroke({ width: ringWidth, color: side })
        .circle(0, 0, r)
        .stroke({ width: Math.max(1, r * 0.05), color: o.edge === undefined ? DARK : o.edge })
        .circle(0, 0, inner)
        .stroke({ width: Math.max(1, r * 0.04), color: DARK, alpha: 0.7 });
      if (o.ring) frame.circle(0, 0, r + 4).stroke({ width: 2, color: o.ring });
      if (o.turn) frame.circle(0, 0, r + (o.ring ? 8 : 4)).stroke({ width: 2.5, color: o.turn });

      // Down: a cross over it.
      mark.clear();
      if (o.down) {
        var m = inner * 0.6;
        mark
          .moveTo(-m, -m)
          .lineTo(m, m)
          .moveTo(m, -m)
          .lineTo(-m, m)
          .stroke({ width: Math.max(2, r * 0.18), color: MARK, alpha: 0.85 });
      }
    }

    return api;
  }

  /** How far a standing token's disc reaches above its foot, in radii (L-932). */
  function standHeight() {
    return 2 + LIFT;
  }

  var SVG_PX = 2048; // the long side SVG art is drawn at: sharp at any zoom the map allows

  /**
   * A piece of art (a library image's link, or an older Storage path) as a
   * texture. WebGL and canvas textures need it served with CORS: Cloud
   * Storage sends Access-Control-Allow-Origin once the bucket has its CORS
   * policy (storage-cors.json, the Set Storage CORS workflow). SVG is drawn
   * onto a canvas at SVG_PX on its long side first, since its own size is
   * often its grid's, a few dozen pixels, and would blur when stretched.
   */
  function loadTexture(image) {
    return Loom.artUrl(image)
      .then(function (url) {
        return new Promise(function (resolve, reject) {
          var img = new window.Image();
          img.crossOrigin = 'anonymous';
          img.onload = function () {
            resolve(img);
          };
          img.onerror = function () {
            reject(
              new Error(
                'the image did not load (from Cloud Storage, the bucket needs its CORS policy: ' +
                  'run the Set Storage CORS workflow)'
              )
            );
          };
          img.src = url;
        });
      })
      .then(function (img) {
        return window.PIXI.Texture.from(image.svg ? rasterized(img, image) : img);
      });
  }

  // SVG art on a canvas, SVG_PX on its long side, in the shape the world
  // gives it (its width and height), else its own.
  function rasterized(img, image) {
    var w = image.width || img.naturalWidth || 1;
    var h = image.height || img.naturalHeight || 1;
    var k = SVG_PX / Math.max(w, h);
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /**
   * A layer's art, sharper as it is zoomed (A1; L-727): its screen-sized copy
   * first, then the full image once the art shows bigger on screen than the
   * copy has pixels. Art without a copy (older art), or whose copy won't load,
   * loads whole. `onChange` is called when a texture arrives.
   *
   *   set(image)    a new piece of art from loomGetMap (or null)
   *   ready(image)  whether that art has a texture to draw
   *   texture       the sharpest texture loaded
   *   sharpen(px)   the art's long side on screen now, in device pixels
   */
  function art(onChange, what) {
    var a = { key: null, image: null, texture: null, full: true, fetching: false };
    var whole = function (key) {
      a.fetching = true;
      return loadTexture(a.image).then(function (texture) {
        if (a.key !== key) return;
        a.texture = texture;
        a.full = true;
        onChange();
      });
    };
    var failed = function (err) {
      console.error('Could not load the ' + what + ':', err);
    };
    function set(image) {
      var key = Loom.artKey(image);
      if (key === a.key) return;
      a.key = key;
      a.image = image || null;
      a.texture = null;
      a.full = !image || !image.screenUrl || image.svg; // SVG is sharp at any size: no copy
      a.fetching = false;
      if (!image) return;
      if (a.full) {
        whole(key).catch(failed);
        return;
      }
      loadTexture({ url: image.screenUrl })
        .then(function (texture) {
          if (a.key !== key) return;
          a.texture = texture;
          onChange();
        })
        .catch(function () {
          if (a.key === key) whole(key).catch(failed); // no copy yet: the full image
        });
    }
    function sharpen(px) {
      if (a.full || a.fetching || !a.texture) return;
      if (px <= Math.max(a.texture.width, a.texture.height)) return;
      whole(a.key).catch(failed); // once: a failure keeps the copy
    }
    return {
      set: set,
      sharpen: sharpen,
      ready: function (image) {
        return Boolean(a.texture) && a.key === Loom.artKey(image);
      },
      get texture() {
        return a.texture;
      },
    };
  }

  /** How many device pixels a length on screen covers (the stage's resolution). */
  function devicePx(length) {
    return length * Math.min(2, window.devicePixelRatio || 1);
  }

  Loom.draw = {
    art: art,
    devicePx: devicePx,
    loadTexture: loadTexture,
    line: line,
    polyline: polyline,
    padlock: padlock,
    label: label,
    token: token,
    tokenPicture: picture,
    standHeight: standHeight,
    initialsOf: initialsOf,
  };
})();
