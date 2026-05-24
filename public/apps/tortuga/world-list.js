(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  var ERA_LABELS = {
    caribbean_golden_age: 'Caribbean Golden Age',
    mediterranean_corsair: 'Mediterranean Corsair',
    indian_ocean: 'Indian Ocean',
    freeform: 'Freeform',
  };

  function renderSkeleton(container) {
    container.innerHTML = '';
    for (var i = 0; i < 3; i++) {
      var card = document.createElement('div');
      card.className = 'world-card world-card--skeleton';

      var block = document.createElement('div');
      block.className = 'skeleton-block';
      card.appendChild(block);

      var body = document.createElement('div');
      body.className = 'world-card-body';

      var lineTitle = document.createElement('div');
      lineTitle.className = 'skeleton-line skeleton-line--title';
      body.appendChild(lineTitle);

      var lineSub = document.createElement('div');
      lineSub.className = 'skeleton-line skeleton-line--sub';
      body.appendChild(lineSub);

      card.appendChild(body);
      container.appendChild(card);
    }
  }

  function renderEmpty(container) {
    container.innerHTML = '';
    var msg = document.createElement('p');
    msg.className = 'world-list-empty';
    msg.textContent = 'No worlds found. Use The Cartographer to create one.';
    container.appendChild(msg);
  }

  function buildCard(world, onSelect) {
    var card = document.createElement('div');
    card.className = 'world-card';

    var thumb;
    if (world.thumbnail) {
      thumb = document.createElement('img');
      thumb.className = 'world-card-thumb';
      thumb.src = world.thumbnail;
      thumb.alt = '';
    } else {
      thumb = document.createElement('div');
      thumb.className = 'world-card-thumb world-card-thumb--placeholder';
      thumb.textContent = '🗺️';
    }
    card.appendChild(thumb);

    var body = document.createElement('div');
    body.className = 'world-card-body';

    var nameEl = document.createElement('span');
    nameEl.className = 'world-card-name';
    nameEl.textContent = world.name || 'Untitled World';
    body.appendChild(nameEl);

    var eraLabel = ERA_LABELS[world.era] || world.era || 'Unknown Era';
    var settlementCount = (world.settlements || []).length;

    var metaEl = document.createElement('span');
    metaEl.className = 'world-card-meta';
    metaEl.textContent =
      eraLabel + ' · ' + settlementCount + ' settlement' + (settlementCount !== 1 ? 's' : '');
    body.appendChild(metaEl);

    if (world.createdBy === T.state.currentUser.uid) {
      var badge = document.createElement('span');
      badge.className = 'world-card-badge';
      badge.textContent = 'Your World';
      body.appendChild(badge);
    }

    card.appendChild(body);

    card.addEventListener('click', function () {
      onSelect(world.id, world);
    });

    return card;
  }

  function renderWorlds(container, sharedWorlds, ownedWorlds, onSelect) {
    // Merge: owned worlds take precedence (covers owned-but-not-shared)
    var merged = Object.assign({}, sharedWorlds, ownedWorlds);
    var worlds = Object.keys(merged).map(function (id) {
      return merged[id];
    });

    if (worlds.length === 0) {
      renderEmpty(container);
      return;
    }

    worlds.sort(function (a, b) {
      var ta = a.updatedAt && a.updatedAt.toMillis ? a.updatedAt.toMillis() : 0;
      var tb = b.updatedAt && b.updatedAt.toMillis ? b.updatedAt.toMillis() : 0;
      return tb - ta;
    });

    container.innerHTML = '';
    worlds.forEach(function (w) {
      container.appendChild(buildCard(w, onSelect));
    });
  }

  T.worldList = {
    _container: null,
    _onSelect: null,
    _unsubscribes: [],
    _sharedWorlds: {},
    _ownedWorlds: {},
    _sharedLoaded: false,
    _ownedLoaded: false,

    _mergeAndRender: function () {
      if (!this._sharedLoaded || !this._ownedLoaded) return;
      renderWorlds(this._container, this._sharedWorlds, this._ownedWorlds, this._onSelect);
    },

    render: function (containerEl, opts) {
      this.destroy();

      this._container = containerEl;
      this._onSelect = opts.onSelect || function () {};
      this._sharedWorlds = {};
      this._ownedWorlds = {};
      this._sharedLoaded = false;
      this._ownedLoaded = false;

      renderSkeleton(containerEl);

      var self = this;

      var unsubShared = T.firestore.listWorlds(function (worlds, err) {
        if (err) {
          console.error('[world-list] shared worlds error', err);
          self._sharedLoaded = true;
          self._mergeAndRender();
          return;
        }
        self._sharedWorlds = {};
        worlds.forEach(function (w) {
          self._sharedWorlds[w.id] = w;
        });
        self._sharedLoaded = true;
        self._mergeAndRender();
      });

      var unsubOwned = T.firestore.onOwnedWorlds(function (worlds, err) {
        if (err) {
          console.error('[world-list] owned worlds error', err);
          self._ownedLoaded = true;
          self._mergeAndRender();
          return;
        }
        self._ownedWorlds = {};
        worlds.forEach(function (w) {
          self._ownedWorlds[w.id] = w;
        });
        self._ownedLoaded = true;
        self._mergeAndRender();
      });

      this._unsubscribes = [unsubShared, unsubOwned];
    },

    destroy: function () {
      this._unsubscribes.forEach(function (u) {
        if (typeof u === 'function') u();
      });
      this._unsubscribes = [];
    },
  };
})();
