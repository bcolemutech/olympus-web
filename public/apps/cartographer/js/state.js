(function () {
  'use strict';

  window.Cartographer = window.Cartographer || {};
  var Cartographer = window.Cartographer;

  Cartographer.state = {
    db: null,
    functions: null,
    storage: null,
    uid: null,
  };

  // Upload limits, mirrored from storage.rules (the server enforces them too).
  Cartographer.MAX_JSON_BYTES = 50 * 1024 * 1024;
  Cartographer.MAX_PNG_BYTES = 30 * 1024 * 1024;
  // Import runs parse → map → load server-side; big maps need more than the
  // callable default of 70 seconds.
  Cartographer.IMPORT_TIMEOUT_MS = 300000;
  // The MCP connector to add in Claude (always the canonical origin: its
  // tokens are issued for that audience).
  Cartographer.CONNECTOR_URL = 'https://bcoletech.com/mcp/cartographer';

  // ── Lazy-cached DOM ref helper ──────────────────
  var refCache = {};
  Cartographer.getRef = function (id) {
    if (!refCache[id]) {
      refCache[id] = document.getElementById(id);
    }
    return refCache[id];
  };

  Cartographer.show = function (id, visible) {
    Cartographer.getRef(id).classList.toggle('hidden', !visible);
  };

  Cartographer.formatNumber = function (n) {
    return Number(n || 0).toLocaleString('en-US');
  };

  // A world's settlements, sorted by name (firestore.rules lets the
  // cartographer claim read a world's locations).
  Cartographer.loadSettlements = function (worldId) {
    return Cartographer.state.db
      .collection('loom_worlds')
      .doc(worldId)
      .collection('locations')
      .where('geo.kind', '==', 'settlement')
      .get()
      .then(function (snap) {
        return snap.docs
          .map(function (d) {
            return d.data();
          })
          .sort(function (a, b) {
            return a.name.localeCompare(b.name);
          });
      });
  };

  Cartographer.formatDate = function (ms) {
    return ms
      ? new Date(ms).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '—';
  };
})();
