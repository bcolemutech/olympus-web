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

  // The worlds a player can enter: the published Cartographer worlds, which
  // worlds.js reads from Firestore at runtime. There are no built-in worlds
  // (L-686 / #519).
  Loom.WORLDS = [];

  // ── Lazy-cached DOM ref helper ──────────────────
  var refCache = {};
  Loom.getRef = function (id) {
    if (!refCache[id]) {
      refCache[id] = document.getElementById(id);
    }
    return refCache[id];
  };
})();
