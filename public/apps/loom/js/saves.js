(function () {
  'use strict';

  var Loom = window.Loom;
  var state = Loom.state;

  /**
   * Lists the current player's saves for a world. Read-only Firestore query —
   * loom_saves is server-write-only (L-101), so create/delete below go
   * through the loomCreateSave/loomDeleteSave callables (L-121).
   */
  function loadSaves(worldId) {
    var listEl = Loom.getRef('loom-save-list');
    var emptyEl = Loom.getRef('loom-save-empty');
    var loadingEl = Loom.getRef('loom-saves-loading');
    var errorEl = Loom.getRef('loom-saves-error');

    listEl.innerHTML = '';
    emptyEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    state.db
      .collection('loom_saves')
      .where('ownerUid', '==', state.uid)
      .where('worldId', '==', worldId)
      .get()
      .then(function (snap) {
        loadingEl.classList.add('hidden');

        if (snap.empty) {
          emptyEl.classList.remove('hidden');
          return;
        }

        snap.forEach(function (doc) {
          listEl.appendChild(renderSaveCard(doc.id, doc.data()));
        });
      })
      .catch(function (err) {
        loadingEl.classList.add('hidden');
        errorEl.textContent = 'Could not load saves: ' + (err.message || 'Unknown error');
        errorEl.classList.remove('hidden');
      });
  }

  function renderSaveCard(saveId, save) {
    var card = document.createElement('div');
    card.className = 'app-card loom-save-card';

    var title = document.createElement('h3');
    title.className = 'loom-card-title';
    title.textContent = save.name || 'Unnamed Save';
    card.appendChild(title);

    if (save.character && save.character.name) {
      var meta = document.createElement('p');
      meta.className = 'loom-card-tagline';
      meta.textContent = save.character.name;
      card.appendChild(meta);
    }

    var actions = document.createElement('div');
    actions.className = 'loom-save-card-actions';

    var resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.className = 'app-btn';
    resumeBtn.textContent = 'Resume';
    resumeBtn.addEventListener('click', function () {
      Loom.app.showPlay(saveId, save);
    });
    actions.appendChild(resumeBtn);

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'loom-delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', function () {
      deleteSave(saveId, save.name || 'Unnamed Save');
    });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    return card;
  }

  function deleteSave(saveId, saveName) {
    if (!window.confirm('Delete "' + saveName + '"? This cannot be undone.')) {
      return;
    }

    var errorEl = Loom.getRef('loom-saves-error');
    errorEl.classList.add('hidden');

    var loomDeleteSave = state.functions.httpsCallable('loomDeleteSave');
    loomDeleteSave({ saveId: saveId })
      .then(function () {
        loadSaves(state.worldId);
      })
      .catch(function (err) {
        errorEl.textContent = 'Could not delete save: ' + (err.message || 'Unknown error');
        errorEl.classList.remove('hidden');
      });
  }

  /** Creates a new save via the loomCreateSave callable. Returns a promise of the new saveId. */
  function createSave(worldId, name, characterName) {
    var errorEl = Loom.getRef('loom-new-save-error');
    var submitBtn = Loom.getRef('loom-new-save-submit');
    errorEl.classList.add('hidden');
    submitBtn.disabled = true;

    var loomCreateSave = state.functions.httpsCallable('loomCreateSave');
    return loomCreateSave({ worldId: worldId, name: name, characterName: characterName })
      .then(function (result) {
        submitBtn.disabled = false;
        return result.data.saveId;
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        errorEl.textContent = 'Could not create save: ' + (err.message || 'Unknown error');
        errorEl.classList.remove('hidden');
        throw err;
      });
  }

  Loom.saves = { loadSaves: loadSaves, createSave: createSave };
})();
