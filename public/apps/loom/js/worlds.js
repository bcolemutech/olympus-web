(function () {
  'use strict';

  var Loom = window.Loom;

  // The published Cartographer worlds, read from Firestore (rules only let
  // players see `published` ones). There are no built-in worlds (L-686).

  function loadPublishedWorlds() {
    return Loom.state.db
      .collection('loom_worlds')
      .where('status', '==', 'published')
      .get()
      .then(function (snap) {
        return snap.docs
          .map(function (doc) {
            var data = doc.data();
            return { id: doc.id, name: data.name || doc.id, tagline: data.tagline || '' };
          })
          .sort(function (a, b) {
            return a.name.localeCompare(b.name);
          });
      })
      .catch(function (err) {
        console.error('Failed to load published worlds:', err);
        return [];
      });
  }

  function renderWorldList() {
    return loadPublishedWorlds().then(function (published) {
      Loom.WORLDS = published;
      renderWorlds(Loom.WORLDS);
    });
  }

  function renderWorlds(worlds) {
    var container = Loom.getRef('loom-world-list');
    container.innerHTML = '';

    worlds.forEach(function (world) {
      var card = document.createElement('div');
      card.className = 'app-card loom-world-card';

      var title = document.createElement('h3');
      title.className = 'loom-card-title';
      title.textContent = world.name;

      var tagline = document.createElement('p');
      tagline.className = 'loom-card-tagline';
      tagline.textContent = world.tagline;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-btn';
      btn.textContent = 'Enter';
      btn.addEventListener('click', function () {
        Loom.app.showSaves(world.id, world.name);
      });

      card.appendChild(title);
      card.appendChild(tagline);
      card.appendChild(btn);
      container.appendChild(card);
    });
  }

  Loom.worlds = { renderWorldList: renderWorldList };
})();
