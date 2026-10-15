/* global module */
(function () {
  'use strict';

  // The Loom's look (planning/the-map-first-loom.md §4.5; L-729 / #600): one
  // stylesheet of tokens (loom.css), with each world's accent colour (K1).
  //
  // A world's accent is `accent` on its document, a hex colour (L-710's brief
  // sets it from its art direction); without one, the Loom's own. An accent
  // too dark to read on the panels is lightened until it has 6:1 there: WCAG
  // AA (4.5:1) with room for the accent-tinted chips and buttons it sits on,
  // so text in it, and dark text on it, both stay readable.

  var DEFAULT_ACCENT = '#ffb74d';
  var PANEL = '#0f1525'; // --loom-panel-bg
  var TARGET = 6; // AA's 4.5, with room for tinted surfaces

  function parse(hex) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return [0, 2, 4].map(function (i) {
      return parseInt(h.slice(i, i + 2), 16);
    });
  }

  function toHex(rgb) {
    return (
      '#' +
      rgb
        .map(function (c) {
          return ('0' + Math.round(c).toString(16)).slice(-2);
        })
        .join('')
    );
  }

  function luminance(rgb) {
    var c = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /** The contrast ratio of two colours, as hex or [r, g, b]. */
  function contrast(a, b) {
    var la = luminance(Array.isArray(a) ? a : parse(a));
    var lb = luminance(Array.isArray(b) ? b : parse(b));
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** A world's accent, readable on the panels; the default for none or a bad one. */
  function accentOf(value) {
    var rgb = parse(value);
    if (!rgb) return DEFAULT_ACCENT;
    var panel = parse(PANEL);
    for (var i = 0; i < 20 && contrast(rgb, panel) < TARGET; i++) {
      rgb = rgb.map(function (c) {
        return c + (255 - c) * 0.15;
      });
    }
    return toHex(rgb);
  }

  /** Sets the accent the page is drawn in: a world's, or the Loom's own (null). */
  function useAccent(accent) {
    var root = document.documentElement;
    if (accent) root.style.setProperty('--loom-accent', accentOf(accent));
    else root.style.removeProperty('--loom-accent');
  }

  var api = {
    DEFAULT_ACCENT: DEFAULT_ACCENT,
    accentOf: accentOf,
    contrast: contrast,
    useAccent: useAccent,
  };

  if (typeof window !== 'undefined') {
    window.Loom = window.Loom || {};
    window.Loom.theme = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
