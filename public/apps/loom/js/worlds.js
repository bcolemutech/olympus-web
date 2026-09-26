(function () {
  'use strict';

  var Loom = window.Loom;

  // Static worlds ship with the app; published Cartographer worlds are read
  // from Firestore (rules only let players see `published` ones).
  var STATIC_WORLDS = Loom.WORLDS.slice();

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

  // Renders the static worlds at once, then again with published worlds added.
  function renderWorldList() {
    renderWorlds(STATIC_WORLDS);
    return loadPublishedWorlds().then(function (published) {
      var staticIds = STATIC_WORLDS.map(function (w) {
        return w.id;
      });
      Loom.WORLDS = STATIC_WORLDS.concat(
        published.filter(function (w) {
          return staticIds.indexOf(w.id) === -1;
        })
      );
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
