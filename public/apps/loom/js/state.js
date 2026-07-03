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

  // Display-only list of Phase 1 worlds. Canon itself lives server-side
  // (functions/loom-canon/) — this is just enough metadata for the world
  // picker; a Firestore-backed world list is a Phase 3 concern (L-300).
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
