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
    Loom.theme.useAccent(null); // the Loom's own; each card has its world's
    showView('worlds');
  }

  // The world's cover in an element, in place of the one there (L-729).
  function putCover(el, world) {
    var old = el.querySelector('.loom-cover');
    if (old) old.remove();
    el.insertBefore(Loom.worlds.coverOf(world), el.firstChild);
  }

  var coverTimer = 0;

  /** While a save loads, its world's cover over the page; null hides it. */
  function showCover(world) {
    var el = Loom.getRef('loom-play-cover');
    window.clearTimeout(coverTimer);
    if (world) {
      putCover(el, world);
      Loom.getRef('loom-play-cover-name').textContent = world.name;
      el.classList.remove('hidden', 'is-leaving');
      return;
    }
    if (el.classList.contains('hidden')) return;
    el.classList.add('is-leaving'); // fades (none with reduced motion)
    coverTimer = window.setTimeout(function () {
      el.classList.add('hidden');
      el.classList.remove('is-leaving');
    }, 400);
  }

  function hideNewSaveForm() {
    Loom.getRef('loom-new-save-form').classList.add('hidden');
    Loom.getRef('loom-new-save-name').value = '';
    Loom.getRef('loom-new-character-name').value = '';
    Loom.getRef('loom-new-save-error').classList.add('hidden');
  }

  function showSaves(worldId, worldName) {
    state.worldId = worldId;
    var world = Loom.worlds.worldById(worldId) || { id: worldId, name: worldName };
    Loom.theme.useAccent(world.accent); // the world's accent, through to play (K1)
    putCover(Loom.getRef('loom-saves-hero'), world);
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
    showCover(Loom.worlds.worldById(state.worldId) || { name: worldName(state.worldId) });
    Loom.play.init(saveId, save).then(
      function () {
        showCover(null);
      },
      function () {
        showCover(null);
      }
    );
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
      Loom.rules.mount(); // L-805: the rules reference, from the menu bar
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
