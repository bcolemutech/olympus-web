(function () {
  'use strict';

  var Loom = window.Loom;
  var state = Loom.state;

  /**
   * Lists the current player's saves for a world. Read-only — loom_saves is
   * server-write-only (L-101), so there is nothing to create/delete from the
   * client yet; that lands with the real save-creation flow in L-121 (#306).
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

    if (save.character && save.character.name) {
      var meta = document.createElement('p');
      meta.className = 'loom-card-tagline';
      meta.textContent = save.character.name;
      card.appendChild(title);
      card.appendChild(meta);
    } else {
      card.appendChild(title);
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-btn';
    btn.textContent = 'Resume';
    btn.addEventListener('click', function () {
      Loom.app.showPlay(saveId, save);
    });
    card.appendChild(btn);

    return card;
  }

  Loom.saves = { loadSaves: loadSaves };
})();
