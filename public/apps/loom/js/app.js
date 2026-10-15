(function () {
  'use strict';

  var Loom = window.Loom;
  var state = Loom.state;

  function showView(view) {
    state.currentView = view;
    Loom.getRef('loom-view-worlds').classList.toggle('hidden', view !== 'worlds');
    Loom.getRef('loom-view-saves').classList.toggle('hidden', view !== 'saves');
    Loom.getRef('loom-view-play').classList.toggle('hidden', view !== 'play');
    // The play view widens for its map; the other views keep the narrow column.
    var withMap = Loom.getRef('loom-view-play').classList.contains('loom-play--map');
    Loom.getRef('loom-root').classList.toggle('loom-root--wide', view === 'play' && withMap);
    // In play the Olympus header gives way to the menu bar (L-721, L5); the
    // world list and saves keep it.
    document.body.classList.toggle('loom-playing', view === 'play');
    if (view !== 'play') Loom.store.setUi({ menu: null });
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

  function worldName(worldId) {
    var world = Loom.WORLDS.filter(function (w) {
      return w.id === worldId;
    })[0];
    return world ? world.name : '';
  }

  function showPlay(saveId, save) {
    Loom.store.set({
      save: {
        id: saveId,
        worldId: state.worldId,
        worldName: worldName(state.worldId),
        // For the player's token (A6): its initials.
        characterName: (save.character && save.character.name) || '',
      },
    });
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

      Loom.journal.mount(Loom.getRef('loom-story-pane')); // the panel's content (L-726)
      Loom.shell.mount(); // hosts the map and story panes before they are used
      Loom.worlds.renderWorldList();
      Loom.map.init();
      Loom.overlay.mount(Loom.getRef('loom-map-panel')); // L-725: over the map
      showWorlds();

      Loom.getRef('loom-back-to-worlds').addEventListener('click', showWorlds);

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
            showPlay(saveId, { recentSummary: '', character: { name: characterName } });
          })
          .catch(function () {
            // Error already surfaced inline by createSave(); nothing more to do here.
          });
      });
    },
  };
})();
