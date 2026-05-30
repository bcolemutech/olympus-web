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

  function buildCard(world, favorites, selectedId, onSelect, onFavToggle) {
    var card = document.createElement('div');
    var classes = 'world-card';
    if (world.id === selectedId) classes += ' world-card--selected';
    card.className = classes;

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

    var isFav = !!favorites[world.id];
    var favBtn = document.createElement('button');
    favBtn.className = 'world-card-fav' + (isFav ? ' world-card-fav--active' : '');
    favBtn.setAttribute('aria-label', isFav ? 'Remove from favorites' : 'Add to favorites');
    favBtn.setAttribute('type', 'button');
    favBtn.textContent = isFav ? '★' : '☆';
    favBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      onFavToggle(world.id);
    });
    body.appendChild(favBtn);

    card.appendChild(body);

    card.addEventListener('click', function () {
      onSelect(world.id, world);
    });

    return card;
  }

  function renderWorlds(container, worlds, favorites, selectedId, onSelect, onFavToggle) {
    if (worlds.length === 0) {
      renderEmpty(container);
      return;
    }

    container.innerHTML = '';
    worlds.forEach(function (w) {
      container.appendChild(buildCard(w, favorites, selectedId, onSelect, onFavToggle));
    });
  }

  function _renderToolbar(toolbarEl, searchQuery, sortMode, onSearch, onSort) {
    toolbarEl.innerHTML = '';

    var toolbar = document.createElement('div');
    toolbar.className = 'world-list-toolbar';

    var searchInput = document.createElement('input');
    searchInput.className = 'knobs-input world-search-input';
    searchInput.setAttribute('type', 'search');
    searchInput.setAttribute('placeholder', 'Search worlds…');
    searchInput.setAttribute('aria-label', 'Search worlds');
    searchInput.value = searchQuery;
    searchInput.addEventListener('input', function () {
      onSearch(searchInput.value);
    });
    toolbar.appendChild(searchInput);

    var sortSelect = document.createElement('select');
    sortSelect.className = 'knobs-select world-sort-select';
    sortSelect.setAttribute('aria-label', 'Sort worlds');
    [
      { value: 'recent', label: 'Recent' },
      { value: 'alpha', label: 'A–Z' },
      { value: 'popular', label: 'Popular' },
    ].forEach(function (opt) {
      var option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === sortMode) option.selected = true;
      sortSelect.appendChild(option);
    });
    sortSelect.addEventListener('change', function () {
      onSort(sortSelect.value);
    });
    toolbar.appendChild(sortSelect);

    toolbarEl.appendChild(toolbar);
  }

  function _filterAndSort(sharedWorlds, ownedWorlds, searchQuery, sortMode) {
    var merged = Object.assign({}, sharedWorlds, ownedWorlds);
    var worlds = Object.keys(merged).map(function (id) {
      return merged[id];
    });

    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      worlds = worlds.filter(function (w) {
        var nameMatch = (w.name || '').toLowerCase().indexOf(q) !== -1;
        var creatorMatch = (w.createdByName || '').toLowerCase().indexOf(q) !== -1;
        return nameMatch || creatorMatch;
      });
    }

    worlds.sort(function (a, b) {
      if (sortMode === 'alpha') {
        return (a.name || '').localeCompare(b.name || '');
      }
      if (sortMode === 'popular') {
        var pa = a.playCount || 0;
        var pb = b.playCount || 0;
        if (pb !== pa) return pb - pa;
        return (a.name || '').localeCompare(b.name || '');
      }
      // recent (default)
      var ta = a.updatedAt && a.updatedAt.toMillis ? a.updatedAt.toMillis() : 0;
      var tb = b.updatedAt && b.updatedAt.toMillis ? b.updatedAt.toMillis() : 0;
      return tb - ta;
    });

    return worlds;
  }

  function _initPreviewMap(previewEl, worldData) {
    var decoded = T.firestore.decodeWorld(worldData);

    var previewMap = L.map(previewEl, {
      crs: L.CRS.Simple,
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      tap: false,
      attributionControl: false,
    });

    // Coastlines
    (decoded.coastlines || []).forEach(function (ring) {
      if (ring && ring.length > 2) {
        L.polygon(ring, {
          color: '#4a7c59',
          fillColor: '#2d5a3d',
          fillOpacity: 0.6,
          weight: 1,
        }).addTo(previewMap);
      }
    });

    // Faction territory (below settlements)
    (decoded.factionTerritory || []).forEach(function (ft) {
      if (ft.polygon && ft.polygon.length > 2) {
        L.polygon(ft.polygon, {
          color: ft.color || '#888',
          fillColor: ft.color || '#888',
          fillOpacity: 0.18,
          weight: 1,
        }).addTo(previewMap);
      }
    });

    // Hazards
    var HAZARD_COLORS = {
      reef: '#b07a3a',
      storm_band: '#8aa8b8',
      kraken_zone: '#4a2a5a',
      lake: '#4a8aaa',
    };
    (decoded.hazards || []).forEach(function (h) {
      if (h.polygon && h.polygon.length > 2) {
        var col = HAZARD_COLORS[h.type] || '#cc4444';
        L.polygon(h.polygon, {
          color: col,
          fillColor: col,
          fillOpacity: 0.4,
          weight: 1,
        }).addTo(previewMap);
      }
    });

    // Trade routes
    var posById = {};
    (decoded.settlements || []).forEach(function (s) {
      if (s.id && s.position) posById[s.id] = s.position;
    });
    (decoded.tradeRoutes || []).forEach(function (r) {
      var pts = r.points;
      if (!pts && r.fromId && r.toId) {
        var from = posById[r.fromId];
        var to = posById[r.toId];
        if (from && to) pts = [from, to];
      }
      if (pts && pts.length >= 2) {
        L.polyline(pts, { color: '#c8a84b', weight: 1, dashArray: '4 3', opacity: 0.7 }).addTo(
          previewMap
        );
      }
    });

    // Settlements (on top)
    (decoded.settlements || []).forEach(function (s) {
      if (s.position && !s.hidden) {
        L.circleMarker(s.position, {
          radius: 3,
          color: '#fff',
          fillColor: '#ffb74d',
          fillOpacity: 0.9,
          weight: 1,
        }).addTo(previewMap);
      }
    });

    if (decoded.bounds) {
      previewMap.fitBounds(decoded.bounds, { padding: [8, 8] });
    }

    return previewMap;
  }

  T.worldList = {
    _container: null,
    _toolbarEl: null,
    _previewEl: null,
    _onSelect: null,
    _unsubscribes: [],
    _unsubFavs: null,
    _sharedWorlds: {},
    _ownedWorlds: {},
    _sharedLoaded: false,
    _ownedLoaded: false,
    _favorites: {},
    _selectedId: null,
    _searchQuery: '',
    _sortMode: 'recent',
    _previewMap: null,

    _applyFiltersAndRender: function () {
      if (!this._sharedLoaded || !this._ownedLoaded) return;
      var self = this;
      var worlds = _filterAndSort(
        this._sharedWorlds,
        this._ownedWorlds,
        this._searchQuery,
        this._sortMode
      );
      renderWorlds(
        this._container,
        worlds,
        this._favorites,
        this._selectedId,
        function (worldId, worldData) {
          self._selectedId = worldId;
          self._applyFiltersAndRender();
          self._updatePreview(worldData);
          if (self._onSelect) self._onSelect(worldId, worldData);
        },
        function (worldId) {
          T.firestore.toggleFavorite(worldId).catch(function (err) {
            console.error('[world-list] toggleFavorite error', err);
          });
        }
      );
    },

    _updatePreview: function (worldData) {
      if (!this._previewEl) return;

      // Clear placeholder text
      this._previewEl.innerHTML = '';

      if (this._previewMap) {
        this._previewMap.remove();
        this._previewMap = null;
      }

      try {
        this._previewMap = _initPreviewMap(this._previewEl, worldData);
      } catch (err) {
        console.error('[world-list] preview error', err);
        this._previewEl.innerHTML = '<p class="world-preview-placeholder">Preview unavailable</p>';
      }
    },

    render: function (containerEl, opts) {
      this.destroy();

      this._container = containerEl;
      this._toolbarEl = (opts && opts.toolbarEl) || null;
      this._previewEl = (opts && opts.previewEl) || null;
      this._onSelect = (opts && opts.onSelect) || null;
      this._sharedWorlds = {};
      this._ownedWorlds = {};
      this._sharedLoaded = false;
      this._ownedLoaded = false;
      this._favorites = {};
      this._selectedId = null;
      this._searchQuery = '';
      this._sortMode = 'recent';

      var self = this;

      if (this._toolbarEl) {
        _renderToolbar(
          this._toolbarEl,
          this._searchQuery,
          this._sortMode,
          function (q) {
            self._searchQuery = q;
            self._applyFiltersAndRender();
          },
          function (mode) {
            self._sortMode = mode;
            self._applyFiltersAndRender();
          }
        );
      }

      renderSkeleton(containerEl);

      var unsubShared = T.firestore.listWorlds(function (worlds, err) {
        if (err) {
          console.error('[world-list] shared worlds error', err);
          self._sharedLoaded = true;
          self._applyFiltersAndRender();
          return;
        }
        self._sharedWorlds = {};
        worlds.forEach(function (w) {
          self._sharedWorlds[w.id] = w;
        });
        self._sharedLoaded = true;
        self._applyFiltersAndRender();
      });

      var unsubOwned = T.firestore.onOwnedWorlds(function (worlds, err) {
        if (err) {
          console.error('[world-list] owned worlds error', err);
          self._ownedLoaded = true;
          self._applyFiltersAndRender();
          return;
        }
        self._ownedWorlds = {};
        worlds.forEach(function (w) {
          self._ownedWorlds[w.id] = w;
        });
        self._ownedLoaded = true;
        self._applyFiltersAndRender();
      });

      this._unsubscribes = [unsubShared, unsubOwned];

      this._unsubFavs = T.firestore.getFavorites(function (favoriteIds, err) {
        if (err) {
          console.error('[world-list] favorites error', err);
          return;
        }
        self._favorites = {};
        favoriteIds.forEach(function (id) {
          self._favorites[id] = true;
        });
        self._applyFiltersAndRender();
      });
    },

    destroy: function () {
      this._unsubscribes.forEach(function (u) {
        if (typeof u === 'function') u();
      });
      this._unsubscribes = [];

      if (typeof this._unsubFavs === 'function') {
        this._unsubFavs();
        this._unsubFavs = null;
      }

      if (this._previewMap) {
        this._previewMap.remove();
        this._previewMap = null;
      }
    },
  };
})();
