(function () {
  'use strict';

  window.Loom = window.Loom || {};
  var Loom = window.Loom;

  // ── Shared mutable state ───────────────────────
  Loom.state = {
    db: null,
    functions: null,
    uid: null,
    currentView: 'worlds', // 'worlds' | 'saves' | 'play'
    worldId: null,
    saveId: null,
    turnInProgress: false,
  };

  // Static worlds shipped with the app (display metadata only; canon lives
  // server-side in functions/loom-canon/). worlds.js adds published
  // Cartographer worlds from Firestore at runtime.
  Loom.WORLDS = [
    {
      id: 'shattered-coast',
      name: 'The Shattered Coast',
      tagline: 'Where hidden coves and old scores meet the tide.',
    },
  ];

  // ── Lazy-cached DOM ref helper ──────────────────
  var refCache = {};
  Loom.getRef = function (id) {
    if (!refCache[id]) {
      refCache[id] = document.getElementById(id);
    }
    return refCache[id];
  };
})();
