(function () {
  'use strict';

  // The Muse (planning/the-muse.md; M-101 / #889): world bibles and, later,
  // manuscripts. A project is its owner's only (MU4); the page writes to
  // Firestore itself under rules that check each document's shape (D1).

  var Muse = (window.Muse = window.Muse || {});

  Muse.state = {
    db: null,
    uid: null,
    projects: [], // the owner's projects, last changed first
    project: null, // the open project
    index: null, // its index: { entries: { id: entry }, shards } (M-102)
    element: null, // the open element (M-102)
  };

  // The element types (§5, M-100), in the order a project lists them.
  Muse.TYPES = [
    { id: 'character', name: 'Characters', one: 'Character' },
    { id: 'faction', name: 'Factions', one: 'Faction' },
    { id: 'location', name: 'Locations', one: 'Location' },
    { id: 'object', name: 'Objects', one: 'Object' },
    { id: 'concept', name: 'Concepts', one: 'Concept' },
  ];

  // Limits, mirrored from firestore.rules (muse_projects).
  Muse.LIMITS = { title: 200, short: 300, summary: 200000, cover: 200 };

  // A project's subcollections, deleted with it. Each story that adds one
  // adds it here (M-102 onwards: index, elements, relationships, versions…).
  Muse.PROJECT_PARTS = ['index', 'elements'];

  // ── Helpers ─────────────────────────────────────
  Muse.$ = function (id) {
    return document.getElementById(id);
  };

  Muse.el = function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };

  Muse.say = function (node, text) {
    node.textContent = text || '';
    node.classList.toggle('hidden', !text);
  };

  Muse.show = function (node, visible) {
    node.classList.toggle('hidden', !visible);
  };

  // A Firestore time (or a pending server time) as milliseconds.
  Muse.millis = function (value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value === 'number') return value;
    return 0;
  };

  Muse.formatDate = function (value) {
    var ms = Muse.millis(value);
    return ms
      ? new Date(ms).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '';
  };

  Muse.TYPE = {};
  Muse.TYPES.forEach(function (type) {
    Muse.TYPE[type.id] = type;
  });

  Muse.go = function (hash) {
    if (window.location.hash === hash) Muse.app.route();
    else window.location.hash = hash;
  };
})();
