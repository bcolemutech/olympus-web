(function () {
  'use strict';

  // The Image Studio's page (planning/the-image-studio.md §4.1; L-702 / #538):
  // the library's grid with search and filters, an image's detail, upload and
  // download. Anyone with the cartographer claim may use it (S1). The page
  // reads studio_images and the version files directly (the rules let editors
  // read them); every write goes through a callable.

  window.Studio = window.Studio || {};
  var Studio = window.Studio;

  Studio.state = {
    db: null,
    functions: null,
    storage: null,
    uid: null,
    images: [], // every record, newest first
    worlds: {}, // worldId → name, for the worlds images are used in
  };

  // The kinds an image can be (functions/studio/library.js KINDS), with names.
  Studio.KINDS = [
    ['worldMap', 'World map'],
    ['regionMap', 'Region map'],
    ['town', 'Town'],
    ['battleMap', 'Battle map'],
    ['cover', 'Cover'],
    ['portrait', 'Portrait'],
    ['token', 'Token'],
    ['item', 'Item'],
    ['scene', 'Scene'],
    ['interface', 'Interface'],
    ['other', 'Other'],
  ];
  Studio.kindName = function (kind) {
    var found = Studio.KINDS.filter(function (k) {
      return k[0] === kind;
    })[0];
    return found ? found[1] : kind;
  };

  // What a world uses an image for (functions/studio/assign-targets.js).
  Studio.TARGETS = {
    map: 'World map',
    cover: 'Cover',
    town: 'Town art',
    battleMap: 'Battle-map art',
  };

  // Upload limits, mirrored from storage.rules (the server checks them too).
  Studio.MAX_BYTES = 30 * 1024 * 1024;
  Studio.MAX_SVG_BYTES = 1024 * 1024;
  // The upload's name, by type (storage.rules, functions/studio/service.js).
  Studio.UPLOADS = {
    'image/png': { file: 'studio.png', ext: 'png' },
    'image/jpeg': { file: 'studio.jpg', ext: 'jpg' },
    'image/webp': { file: 'studio.webp', ext: 'webp' },
    'image/svg+xml': { file: 'studio.svg', ext: 'svg' },
  };
  Studio.EXTENSIONS = { png: 'png', jpeg: 'jpg', webp: 'webp', svg: 'svg' };

  // ── Helpers ─────────────────────────────────────
  var refCache = {};
  Studio.getRef = function (id) {
    if (!refCache[id]) refCache[id] = document.getElementById(id);
    return refCache[id];
  };

  Studio.show = function (id, visible) {
    Studio.getRef(id).classList.toggle('hidden', !visible);
  };

  Studio.el = function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };

  Studio.say = function (node, text) {
    node.textContent = text || '';
    node.classList.toggle('hidden', !text);
  };

  Studio.formatDate = function (ms) {
    return ms
      ? new Date(ms).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '—';
  };

  Studio.formatBytes = function (n) {
    if (!n) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  };

  Studio.who = function (uid) {
    if (uid === Studio.state.uid) return 'you';
    if (uid === 'backfill') return 'moved in from a world';
    return uid || '—';
  };

  // The version a record shows: its current one.
  Studio.currentVersion = function (record) {
    return (
      (record.versions || []).filter(function (v) {
        return v.n === record.current;
      })[0] || {}
    );
  };
})();
