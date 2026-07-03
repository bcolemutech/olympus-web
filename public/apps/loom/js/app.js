(function () {
  'use strict';

  var Loom = window.Loom;
  var state = Loom.state;

  function showView(view) {
    state.currentView = view;
    Loom.getRef('loom-view-worlds').classList.toggle('hidden', view !== 'worlds');
    Loom.getRef('loom-view-saves').classList.toggle('hidden', view !== 'saves');
    Loom.getRef('loom-view-play').classList.toggle('hidden', view !== 'play');
  }

  function showWorlds() {
    state.worldId = null;
    state.saveId = null;
    showView('worlds');
  }

  function showSaves(worldId, worldName) {
    state.worldId = worldId;
    Loom.getRef('loom-save-select-title').textContent = worldName;
    Loom.getRef('loom-new-save-note').classList.add('hidden');
    showView('saves');
    Loom.saves.loadSaves(worldId);
  }

  function showPlay(saveId, save) {
    Loom.play.init(saveId, save);
    showView('play');
  }

  Loom.app = {
    showWorlds: showWorlds,
    showSaves: showSaves,
    showPlay: showPlay,

    init: function (user) {
      state.db = firebase.firestore();
      state.functions = firebase.functions();
      state.uid = user.uid;

      Loom.worlds.renderWorldList();
      showWorlds();

      Loom.getRef('loom-back-to-worlds').addEventListener('click', showWorlds);

      Loom.getRef('loom-back-to-saves').addEventListener('click', function () {
        var world = Loom.WORLDS.filter(function (w) {
          return w.id === state.worldId;
        })[0];
        showSaves(state.worldId, world ? world.name : '');
      });

      Loom.getRef('loom-new-save-btn').addEventListener('click', function () {
        Loom.getRef('loom-new-save-note').classList.remove('hidden');
      });

      Loom.getRef('loom-turn-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var inputEl = Loom.getRef('loom-turn-input');
        var actionText = inputEl.value;
        inputEl.value = '';
        Loom.play.submitTurn(actionText);
      });
    },
  };
})();
