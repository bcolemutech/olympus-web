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

  // ── Art ───────────────────────────────────────────
  // A piece of art from loomGetMap: a library image's link (`url`, L-704), or
  // an older Storage `path` turned into a URL. Its key tells one piece from
  // another, so the page doesn't load the same art twice.
  Loom.artKey = function (image) {
    return image ? image.url || image.path || null : null;
  };
  Loom.artUrl = function (image) {
    if (image.url) return Promise.resolve(image.url);
    return firebase.storage().ref(image.path).getDownloadURL();
  };

  // ── Lazy-cached DOM ref helper ──────────────────
  var refCache = {};
  Loom.getRef = function (id) {
    if (!refCache[id]) {
      refCache[id] = document.getElementById(id);
    }
    return refCache[id];
  };
})();
