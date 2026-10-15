(function () {
  'use strict';

  // Drawing helpers the map engine's layers share (L-722, L-723): lines and
  // dashed paths in screen space, a padlock for a locked place, map labels,
  // and tokens.
  //
  // A token (A6) is a clean disc with the character's initials, built to
  // take a portrait in its place when L-730 brings them.

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

  /**
   * A token (A6): a disc with initials. update({ x, y, radius, name, fill,
   * edge, ink, ring }) moves and restyles it; `ring` circles it in a colour
   * (the player).
   */
  function token() {
    var PIXI = window.PIXI;
    var container = new PIXI.Container();
    var disc = new PIXI.Graphics();
    var text = new PIXI.Text({
      text: '',
      style: { fontFamily: FONT, fontSize: 10, fontWeight: '700', fill: DARK },
    });
    text.anchor.set(0.5, 0.5);
    container.addChild(disc, text);
    var last = null;
    return {
      container: container,
      update: function (o) {
        container.position.set(o.x, o.y);
        var key = [o.radius, o.name, o.fill, o.edge, o.ink, o.ring].join('|');
        if (key === last) return;
        last = key;
        disc.clear();
        if (o.ring) disc.circle(0, 0, o.radius + 4).stroke({ width: 2, color: o.ring });
        disc
          .circle(0, 0, o.radius)
          .fill({ color: o.fill })
          .stroke({ width: 2, color: o.edge === undefined ? DARK : o.edge });
        text.text = initialsOf(o.name);
        text.style.fontSize = Math.max(
          8,
          Math.round(o.radius * (text.text.length > 1 ? 0.85 : 1.1))
        );
        text.style.fill = o.ink === undefined ? DARK : o.ink;
      },
    };
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
    initialsOf: initialsOf,
  };
})();
