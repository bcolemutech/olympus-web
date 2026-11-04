(function () {
  'use strict';

  // The map's progress effect (planning/maps-from-data.md §4.6, PL4; L-924 /
  // #728): while a map's textures load and its shapes are drawn, a bar fills
  // across the top of the map panel under a quiet "Drawing the map…", with a
  // shimmer running along it (still, with reduced motion), so the screen
  // never looks frozen. It shows only after a moment, so a map drawn at once
  // never flickers it, and fades when the drawing is done.
  //
  //   Loom.mapProgress.create(panel)  → { set(fraction 0–1, or null when done), el }

  var SHOW_AFTER_MS = 150;

  function create(panel) {
    var el = document.createElement('div');
    el.className = 'loom-map-progress';
    el.setAttribute('role', 'progressbar');
    el.setAttribute('aria-label', 'Drawing the map');
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '100');
    el.hidden = true;
    var bar = document.createElement('div');
    bar.className = 'loom-map-progress-bar';
    var label = document.createElement('div');
    label.className = 'loom-map-progress-label';
    label.textContent = 'Drawing the map…';
    el.appendChild(bar);
    el.appendChild(label);
    panel.appendChild(el);
    var timer = null;
    var showing = false;
    return {
      el: el,
      set: function (fraction) {
        if (fraction === null || fraction === undefined) {
          if (timer) window.clearTimeout(timer);
          timer = null;
          showing = false;
          el.hidden = true;
          el.removeAttribute('data-state');
          return;
        }
        var pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
        bar.style.width = pct + '%';
        el.setAttribute('aria-valuenow', String(pct));
        if (showing || timer) return;
        timer = window.setTimeout(function () {
          timer = null;
          showing = true;
          el.hidden = false;
          el.setAttribute('data-state', 'drawing');
        }, SHOW_AFTER_MS);
      },
    };
  }

  window.Loom = window.Loom || {};
  window.Loom.mapProgress = { create: create, SHOW_AFTER_MS: SHOW_AFTER_MS };
})();
