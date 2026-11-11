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

  // ── The player's own token (L-933) ──────────────────
  // A token picture as loomGetMap sends it: a portrait's `link`, or the
  // player's upload, a `file` only its owner can read (storage.rules), with a
  // `version` so a new one isn't the old one's cache. `Loom.tokenKey` names
  // it; `Loom.tokenUrl` gives a URL to draw it from, an upload fetched
  // signed in (never by a link anyone could open) and kept as a blob URL.
  var ownUrls = {};
  Loom.tokenKey = function (picture) {
    if (!picture) return null;
    if (picture.link) return picture.link;
    if (picture.file) return 'own:' + picture.file + '?v=' + (picture.version || 0);
    return null;
  };
  Loom.tokenUrl = function (picture) {
    var key = Loom.tokenKey(picture);
    if (!key) return Promise.reject(new Error('no picture'));
    if (picture.link) return Promise.resolve(picture.link);
    if (!ownUrls[key]) {
      ownUrls[key] = ownFile(picture.file).catch(function (err) {
        delete ownUrls[key];
        throw err;
      });
    }
    return ownUrls[key];
  };
  // A file of the player's own, read as them: Storage's download endpoint
  // with their ID token, which its rules check (what the SDK's getBlob does).
  function ownFile(path) {
    var storage = firebase.storage();
    var impl = storage._delegate || {};
    var host = impl.host || 'firebasestorage.googleapis.com';
    var protocol = impl._protocol || 'https';
    var bucket = storage.ref().bucket;
    var user = firebase.auth().currentUser;
    if (!user) return Promise.reject(new Error('not signed in'));
    return user
      .getIdToken()
      .then(function (idToken) {
        return fetch(
          protocol +
            '://' +
            host +
            '/v0/b/' +
            encodeURIComponent(bucket) +
            '/o/' +
            encodeURIComponent(path) +
            '?alt=media',
          { headers: { Authorization: 'Firebase ' + idToken } }
        );
      })
      .then(function (res) {
        if (!res.ok) throw new Error('your token picture did not load (' + res.status + ')');
        return res.blob();
      })
      .then(function (blob) {
        return window.URL.createObjectURL(blob);
      });
  }

  // ── Lazy-cached DOM ref helper ──────────────────
  var refCache = {};
  Loom.getRef = function (id) {
    if (!refCache[id]) {
      refCache[id] = document.getElementById(id);
    }
    return refCache[id];
  };
})();
