(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  function getMode() {
    var params = new URLSearchParams(window.location.search);
    var m = params.get('mode');
    return m === T.MODES.PLAY ? T.MODES.PLAY : T.MODES.WORLD;
  }

  T.showMode = function (mode) {
    var shells = [T.MODES.WORLD, T.MODES.PLAY];
    shells.forEach(function (m) {
      var el = document.getElementById('shell-' + m);
      if (el) el.classList.toggle('hidden', m !== mode);
    });
    T.state.currentMode = mode;
  };

  T._openWorldEditor = function (_worldId, _worldData) {
    // TODO (T-110): load worldData from Firestore and render it.
    var mapEl = document.getElementById('map-world');
    if (mapEl) {
      mapEl.classList.remove('hidden');
      T.mapRenderer.init(mapEl, T.mapRenderer.PLACEHOLDER_WORLD);
    }
  };

  T._previewImportedWorld = function (previewWorld) {
    var mapEl = document.getElementById('map-world');
    if (!mapEl) return;
    mapEl.classList.remove('hidden');
    T.mapRenderer.destroy();
    T.mapRenderer.init(mapEl, previewWorld);
  };

  T._startNewGame = function () {
    var mapEl = document.getElementById('map-play');
    if (mapEl) {
      mapEl.classList.remove('hidden');
      T.mapRenderer.init(mapEl, T.mapRenderer.PLACEHOLDER_WORLD);
    }
  };

  T.init = function (user) {
    T.state.currentUser = user;
    T.state.db = firebase.firestore();
    var mode = getMode();
    T.showMode(mode);

    if (mode === T.MODES.WORLD) {
      var importEl = document.getElementById('cartographer-import');
      if (importEl) {
        T.importer.render(importEl, {
          onParsed: function (parsed, previewWorld) {
            var warningEl = document.getElementById('land-heavy-warning');
            if (parsed.landPercentage > T.LAND_HEAVY_THRESHOLD && warningEl) {
              warningEl.classList.remove('hidden');
              document.getElementById('land-heavy-continue').onclick = function () {
                warningEl.classList.add('hidden');
                T._previewImportedWorld(previewWorld);
              };
              document.getElementById('land-heavy-cancel').onclick = function () {
                warningEl.classList.add('hidden');
              };
            } else {
              T._previewImportedWorld(previewWorld);
            }
          },
        });
      }
    }

    var listId = mode === T.MODES.PLAY ? 'world-list-play' : 'world-list-world';
    var listEl = document.getElementById(listId);
    if (listEl) {
      T.worldList.render(listEl, {
        onSelect: function (worldId, worldData) {
          if (mode === T.MODES.PLAY) {
            T._startNewGame(worldId, worldData);
          } else {
            T._openWorldEditor(worldId, worldData);
          }
        },
      });
    }
  };
})();
