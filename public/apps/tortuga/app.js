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

  T._openWorldEditor = function () {
    var mapEl = document.getElementById('map-world');
    if (mapEl) {
      mapEl.classList.remove('hidden');
      T.mapRenderer.init(mapEl, T.mapRenderer.PLACEHOLDER_WORLD);
    }
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
