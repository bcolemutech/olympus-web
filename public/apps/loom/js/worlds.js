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
            return {
              id: doc.id,
              name: data.name || doc.id,
              tagline: data.tagline || '',
              // Its cover image (L-704): a library image's link, the file only.
              cover: data.cover && data.cover.link ? data.cover.link : null,
              // Its accent colour (K1, L-729): set from the brief's art
              // direction (L-710); null for the Loom's own.
              accent: typeof data.accent === 'string' ? Loom.theme.accentOf(data.accent) : null,
            };
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
      loadRatings(Loom.WORLDS);
    });
  }

  // How built each world is (L-694): its band's name, worked out on the
  // server (loomWorldRatings). The cards show without it if it fails.
  var BAND_LABELS = {
    playable: 'Playable',
    rich: 'Rich',
    vivid: 'Vivid',
    legendary: 'Legendary',
  };

  function loadRatings(worlds) {
    var ids = worlds.slice(0, 20).map(function (world) {
      return world.id;
    });
    if (!ids.length) return Promise.resolve();
    return Loom.state.functions
      .httpsCallable('loomWorldRatings')({ worldIds: ids })
      .then(function (result) {
        var ratings = (result.data && result.data.ratings) || {};
        ids.forEach(function (id) {
          var band = ratings[id];
          var node = document.getElementById('loom-world-band-' + id);
          if (!node || !BAND_LABELS[band]) return;
          node.textContent = BAND_LABELS[band];
          node.className = 'loom-world-band loom-world-band--' + band;
          node.title = 'How built this world is: ' + BAND_LABELS[band];
        });
      })
      .catch(function (err) {
        console.error('Failed to load world ratings:', err);
      });
  }

  /**
   * A world's cover art (A4): its cover image, or a plain one in its accent
   * with its initial; one that won't load leaves the plain one.
   */
  function coverOf(world, lazy) {
    var art = document.createElement('div');
    art.className = 'loom-cover';
    var initial = document.createElement('span');
    initial.className = 'loom-cover-initial';
    initial.setAttribute('aria-hidden', 'true');
    initial.textContent = (world.name || '?').trim().charAt(0).toUpperCase();
    art.appendChild(initial);
    if (world.cover) {
      var img = document.createElement('img');
      img.className = 'loom-cover-image';
      img.src = world.cover;
      img.alt = '';
      if (lazy) img.loading = 'lazy';
      art.classList.add('has-image');
      img.addEventListener('error', function () {
        img.remove();
        art.classList.remove('has-image');
      });
      art.appendChild(img);
    }
    return art;
  }

  /** The world entered, by id. */
  function worldById(worldId) {
    return (
      Loom.WORLDS.filter(function (w) {
        return w.id === worldId;
      })[0] || null
    );
  }

  function renderWorlds(worlds) {
    var container = Loom.getRef('loom-world-list');
    container.innerHTML = '';

    worlds.forEach(function (world) {
      var card = document.createElement('article');
      card.className = 'loom-world-card';
      card.dataset.worldId = world.id;
      // Each card in its own world's accent (K1).
      if (world.accent) card.style.setProperty('--loom-accent', world.accent);

      card.appendChild(coverOf(world, true));

      var body = document.createElement('div');
      body.className = 'loom-card-body';

      var title = document.createElement('h3');
      title.className = 'loom-card-title';
      title.textContent = world.name;
      // Its band, filled in once the ratings arrive (L-694).
      var band = document.createElement('span');
      band.id = 'loom-world-band-' + world.id;
      band.className = 'loom-world-band hidden';
      title.appendChild(band);

      var tagline = document.createElement('p');
      tagline.className = 'loom-card-tagline';
      tagline.textContent = world.tagline;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-btn';
      btn.textContent = 'Enter';
      btn.setAttribute('aria-label', 'Enter ' + world.name);
      btn.addEventListener('click', function () {
        Loom.app.showSaves(world.id, world.name);
      });

      body.appendChild(title);
      body.appendChild(tagline);
      body.appendChild(btn);
      card.appendChild(body);
      container.appendChild(card);
    });
  }

  Loom.worlds = { renderWorldList: renderWorldList, coverOf: coverOf, worldById: worldById };
})();
