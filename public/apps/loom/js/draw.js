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

  /**
   * A piece of art (a library image's link, or an older Storage path) as a
   * texture. WebGL needs it served with CORS, which Firebase Storage does.
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
            reject(new Error('the image did not load'));
          };
          img.src = url;
        });
      })
      .then(function (img) {
        return window.PIXI.Texture.from(img);
      });
  }

  Loom.draw = {
    loadTexture: loadTexture,
    line: line,
    polyline: polyline,
    padlock: padlock,
    label: label,
    token: token,
    initialsOf: initialsOf,
  };
})();
