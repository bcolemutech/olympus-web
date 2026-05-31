(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  var PORTRAITS = [
    { id: 'anchor', symbol: '⚓', label: 'Anchor' },
    { id: 'skull', symbol: '💀', label: 'Skull' },
    { id: 'compass', symbol: '🧭', label: 'Compass' },
    { id: 'wheel', symbol: '⚙️', label: "Ship's Wheel" },
    { id: 'telescope', symbol: '🔭', label: 'Telescope' },
    { id: 'map', symbol: '🗺️', label: 'Map' },
  ];

  function _buildWorldSnapshot(worldData) {
    return {
      geography: {
        coastlines: worldData.coastlines || [],
        bounds: worldData.bounds || null,
        dimensions: worldData.dimensions || {},
        windCurrentZones: worldData.windCurrentZones || [],
        factionTerritory: worldData.factionTerritory || [],
      },
      settlements: (worldData.settlements || []).slice(),
      hazards: (worldData.hazards || []).slice(),
      factions: (worldData.factions || []).slice(),
      tradeRoutes: (worldData.tradeRoutes || []).slice(),
    };
  }

  function _escapeAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
  }

  function _escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function _shipStatBar(label, value) {
    var pct = Math.max(0, Math.min(100, value));
    return (
      '<div class="ship-stat-row">' +
      '<span class="ship-stat-label">' +
      _escapeHtml(label) +
      '</span>' +
      '<span class="ship-stat-bar"><span class="ship-stat-fill" style="width:' +
      pct +
      '%"></span></span>' +
      '<span class="ship-stat-value">' +
      value +
      '</span>' +
      '</div>'
    );
  }

  function _buildShipCards(selectedClassId) {
    return Object.keys(T.SHIP_TYPES)
      .map(function (classId) {
        var s = T.SHIP_TYPES[classId];
        var bs = s.baseStats;
        var isSelected = classId === selectedClassId;
        return (
          '<button class="ship-card' +
          (isSelected ? ' ship-card--selected' : '') +
          '" type="button"' +
          ' data-class="' +
          _escapeAttr(classId) +
          '"' +
          ' aria-pressed="' +
          (isSelected ? 'true' : 'false') +
          '">' +
          '<div class="ship-card-header">' +
          '<span class="ship-card-icon">' +
          s.icon +
          '</span>' +
          '<span class="ship-card-name">' +
          _escapeHtml(s.name) +
          '</span>' +
          '</div>' +
          '<p class="ship-card-desc">' +
          _escapeHtml(s.description) +
          '</p>' +
          '<div class="ship-card-stats">' +
          _shipStatBar('Speed', bs.speed) +
          _shipStatBar('Handle', bs.maneuverability) +
          _shipStatBar('Hull', bs.hull.max) +
          _shipStatBar('Cargo', bs.cargo.capacity) +
          '</div>' +
          '<div class="ship-card-guns">' +
          bs.guns.count +
          ' × ' +
          bs.guns.weight +
          'lb guns</div>' +
          '</button>'
        );
      })
      .join('');
  }

  T.newGame = {
    _panelEl: null,
    _selectedPortrait: PORTRAITS[0].id,
    _selectedShipClass: null,
    _worldId: null,
    _worldData: null,

    show: function (worldId, worldData) {
      this._worldId = worldId;
      this._worldData = worldData;
      this._selectedPortrait = PORTRAITS[0].id;
      this._selectedShipClass = Object.keys(T.SHIP_TYPES)[0];

      var panelEl = document.getElementById('new-game-panel');
      if (!panelEl) return;
      this._panelEl = panelEl;

      var worldName = (worldData && worldData.name) || 'Unknown World';

      var portraitButtons = PORTRAITS.map(function (p, i) {
        var selectedClass = i === 0 ? ' portrait-btn--selected' : '';
        return (
          '<button class="portrait-btn' +
          selectedClass +
          '" type="button"' +
          ' data-portrait="' +
          _escapeAttr(p.id) +
          '"' +
          ' aria-label="' +
          _escapeAttr(p.label) +
          '"' +
          ' aria-pressed="' +
          (i === 0 ? 'true' : 'false') +
          '">' +
          p.symbol +
          '</button>'
        );
      }).join('');

      panelEl.innerHTML =
        '<div class="new-game-panel">' +
        '<div class="new-game-world-badge">World: ' +
        _escapeAttr(worldName) +
        '</div>' +
        '<h2 class="new-game-title">New Campaign</h2>' +
        '<div class="knobs-field">' +
        '<label class="knobs-label" for="ng-captain-name">Captain\'s Name</label>' +
        '<input class="knobs-input" id="ng-captain-name" type="text"' +
        ' maxlength="50" placeholder="Enter your captain\'s name">' +
        '</div>' +
        '<div class="knobs-field">' +
        '<label class="knobs-label">Portrait</label>' +
        '<div class="portrait-picker">' +
        portraitButtons +
        '</div>' +
        '</div>' +
        '<div class="knobs-field">' +
        '<label class="knobs-label" for="ng-bio">Bio <span class="knobs-label-optional">(optional)</span></label>' +
        '<textarea class="knobs-input new-game-bio" id="ng-bio"' +
        ' rows="3" placeholder="Your captain\'s story…"></textarea>' +
        '</div>' +
        '<div class="knobs-field">' +
        '<label class="knobs-label">Flagship Class</label>' +
        '<div class="ship-picker" id="ng-ship-picker">' +
        _buildShipCards(this._selectedShipClass) +
        '</div>' +
        '</div>' +
        '<p class="new-game-error hidden" id="ng-error"></p>' +
        '<div class="new-game-actions">' +
        '<button class="btn-cancel" id="ng-cancel" type="button">Cancel</button>' +
        '<button class="app-btn app-btn--sm" id="ng-confirm" type="button">Begin Campaign</button>' +
        '</div>' +
        '</div>';

      panelEl.classList.remove('hidden');

      var self = this;

      panelEl.querySelectorAll('.portrait-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          self._selectedPortrait = btn.getAttribute('data-portrait');
          panelEl.querySelectorAll('.portrait-btn').forEach(function (b) {
            b.classList.remove('portrait-btn--selected');
            b.setAttribute('aria-pressed', 'false');
          });
          btn.classList.add('portrait-btn--selected');
          btn.setAttribute('aria-pressed', 'true');
        });
      });

      panelEl.querySelectorAll('.ship-card').forEach(function (card) {
        card.addEventListener('click', function () {
          self._selectedShipClass = card.getAttribute('data-class');
          panelEl.querySelectorAll('.ship-card').forEach(function (c) {
            c.classList.remove('ship-card--selected');
            c.setAttribute('aria-pressed', 'false');
          });
          card.classList.add('ship-card--selected');
          card.setAttribute('aria-pressed', 'true');
        });
      });

      document.getElementById('ng-cancel').addEventListener('click', function () {
        self._hide();
      });

      document.getElementById('ng-confirm').addEventListener('click', function () {
        self._onConfirm();
      });
    },

    _hide: function () {
      if (this._panelEl) {
        this._panelEl.classList.add('hidden');
        this._panelEl.innerHTML = '';
      }
      this._worldId = null;
      this._worldData = null;
      this._selectedShipClass = null;
    },

    _onConfirm: function () {
      var nameEl = document.getElementById('ng-captain-name');
      var bioEl = document.getElementById('ng-bio');
      var errorEl = document.getElementById('ng-error');
      var confirmBtn = document.getElementById('ng-confirm');
      var cancelBtn = document.getElementById('ng-cancel');

      var captainName = (nameEl && nameEl.value.trim()) || '';
      if (!captainName) {
        if (errorEl) {
          errorEl.textContent = 'A captain needs a name.';
          errorEl.classList.remove('hidden');
        }
        if (nameEl) nameEl.focus();
        return;
      }

      if (errorEl) errorEl.classList.add('hidden');
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Creating…';
      }
      if (cancelBtn) cancelBtn.disabled = true;

      var bio = (bioEl && bioEl.value.trim()) || '';
      var selectedShipClass = this._selectedShipClass;
      var shipType = T.SHIP_TYPES[selectedShipClass];

      var gameDoc = {
        worldId: this._worldId,
        worldSnapshot: _buildWorldSnapshot(this._worldData),
        phase: 'exploration',
        turnNumber: 0,
        captain: {
          name: captainName,
          portrait: this._selectedPortrait,
          bio: bio,
          reputation: 0,
          gold: 0,
          stats: { command: 50, navigation: 50, cunning: 50, charisma: 50 },
        },
        flagshipId: null,
        fog: [],
        settings: { difficulty: 'normal', mythicEnabled: true, pacing: 'async' },
      };

      var flagshipDoc = {
        classId: selectedShipClass,
        name: captainName + "'s " + shipType.name,
        customFlag: null,
        hull: { current: shipType.baseStats.hull.max, max: shipType.baseStats.hull.max },
        sails: { current: shipType.baseStats.sails.max, max: shipType.baseStats.sails.max },
        guns: { count: shipType.baseStats.guns.count, weight: shipType.baseStats.guns.weight },
        crew: {
          current: shipType.baseStats.crew.max,
          min: shipType.baseStats.crew.min,
          max: shipType.baseStats.crew.max,
        },
        morale: shipType.baseStats.morale,
        cargo: { used: 0, capacity: shipType.baseStats.cargo.capacity, manifest: [] },
        upgrades: [],
        speed: shipType.baseStats.speed,
        maneuverability: shipType.baseStats.maneuverability,
        draft: shipType.baseStats.draft,
        damage: { hull: 0, sails: 0, guns: 0, hold: 0 },
        location: null,
        squadId: null,
      };

      var self = this;
      var gameDocRef;
      T.firestore
        .createGame(gameDoc)
        .then(function (docRef) {
          gameDocRef = docRef;
          return T.firestore.createFlagship(docRef.id, flagshipDoc);
        })
        .then(function (shipDocRef) {
          return T.firestore.updateGame(gameDocRef.id, { flagshipId: shipDocRef.id });
        })
        .then(function () {
          if (self._panelEl) {
            self._panelEl.innerHTML =
              '<div class="new-game-success">' +
              '<p class="new-game-success-title">Campaign created!</p>' +
              '<p class="new-game-success-meta">Captain ' +
              _escapeAttr(captainName) +
              ' sails aboard the ' +
              _escapeAttr(captainName + "'s " + shipType.name) +
              '.</p>' +
              '<p class="new-game-success-id">Game ID: ' +
              _escapeAttr(gameDocRef.id) +
              '</p>' +
              '</div>';
          }
        })
        .catch(function (err) {
          if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Begin Campaign';
          }
          if (cancelBtn) cancelBtn.disabled = false;
          if (errorEl) {
            errorEl.textContent = 'Failed to create campaign: ' + err.message;
            errorEl.classList.remove('hidden');
          }
        });
    },
  };
})();
