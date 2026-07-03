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

  function hideNewSaveForm() {
    Loom.getRef('loom-new-save-form').classList.add('hidden');
    Loom.getRef('loom-new-save-name').value = '';
    Loom.getRef('loom-new-character-name').value = '';
    Loom.getRef('loom-new-save-error').classList.add('hidden');
  }

  function showSaves(worldId, worldName) {
    state.worldId = worldId;
    Loom.getRef('loom-save-select-title').textContent = worldName;
    hideNewSaveForm();
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
        Loom.getRef('loom-new-save-form').classList.remove('hidden');
      });

      Loom.getRef('loom-new-save-cancel').addEventListener('click', function () {
        hideNewSaveForm();
      });

      Loom.getRef('loom-new-save-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var name = Loom.getRef('loom-new-save-name').value.trim();
        var characterName = Loom.getRef('loom-new-character-name').value.trim();
        if (!name || !characterName) return;

        Loom.saves
          .createSave(state.worldId, name, characterName)
          .then(function (saveId) {
            hideNewSaveForm();
            showPlay(saveId, { recentSummary: '' });
          })
          .catch(function () {
            // Error already surfaced inline by createSave(); nothing more to do here.
          });
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
