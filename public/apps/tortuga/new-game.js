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

  var PORT_TYPE_LABELS = {
    colonial_port: 'Colonial Port',
    free_port: 'Free Port',
  };

  var SIZE_LABELS = {
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
  };

  var FRIENDLY_PORT_TYPES = T.FRIENDLY_PORT_TYPES;

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

  function _buildPortCards(ports, factions) {
    var factionMap = {};
    (factions || []).forEach(function (f) {
      factionMap[f.id] = f.name;
    });
    return ports
      .map(function (s) {
        var typeLabel = PORT_TYPE_LABELS[s.type] || s.type;
        var factionName = (s.parentFaction && factionMap[s.parentFaction]) || 'Independent';
        var sizeLabel = SIZE_LABELS[s.baseSize] || s.baseSize || '';
        return (
          '<button class="port-card" type="button" aria-pressed="false" data-port-id="' +
          _escapeAttr(s.id) +
          '">' +
          '<span class="port-card-name">' +
          _escapeHtml(s.name) +
          '</span>' +
          '<span class="port-card-type">' +
          _escapeHtml(typeLabel) +
          '</span>' +
          '<span class="port-card-faction">' +
          _escapeHtml(factionName) +
          '</span>' +
          '<span class="port-card-size">' +
          _escapeHtml(sizeLabel) +
          '</span>' +
          '</button>'
        );
      })
      .join('');
  }

  T.newGame = {
    _panelEl: null,
    _selectedPortrait: PORTRAITS[0].id,
    _selectedShipClass: null,
    _selectedPortId: null,
    _selectedDifficulty: 'normal',
    _portMap: null,
    _portMarkers: null,
    _worldId: null,
    _worldData: null,
    _captainName: '',
    _captainBio: '',

    show: function (worldId, worldData) {
      this._worldId = worldId;
      this._worldData = worldData;
      this._selectedPortrait = PORTRAITS[0].id;
      this._selectedShipClass = Object.keys(T.SHIP_TYPES)[0];
      this._selectedPortId = null;
      this._selectedDifficulty = 'normal';
      this._captainName = '';
      this._captainBio = '';

      var panelEl = document.getElementById('new-game-panel');
      if (!panelEl) return;
      this._panelEl = panelEl;
      panelEl.classList.remove('hidden');
      this._renderStep1();
    },

    _renderStep1: function () {
      var self = this;
      var panelEl = this._panelEl;
      if (!panelEl) return;
      var worldName = (this._worldData && this._worldData.name) || 'Unknown World';

      var portraitButtons = PORTRAITS.map(function (p) {
        var isSelected = p.id === self._selectedPortrait;
        return (
          '<button class="portrait-btn' +
          (isSelected ? ' portrait-btn--selected' : '') +
          '" type="button"' +
          ' data-portrait="' +
          _escapeAttr(p.id) +
          '"' +
          ' aria-label="' +
          _escapeAttr(p.label) +
          '"' +
          ' aria-pressed="' +
          (isSelected ? 'true' : 'false') +
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
        '<button class="app-btn app-btn--sm" id="ng-next" type="button">Next: Difficulty</button>' +
        '</div>' +
        '</div>';

      var nameInput = document.getElementById('ng-captain-name');
      if (nameInput) nameInput.value = this._captainName;
      var bioInput = document.getElementById('ng-bio');
      if (bioInput) bioInput.value = this._captainBio;

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

      document.getElementById('ng-next').addEventListener('click', function () {
        self._onNext();
      });
    },

    _onNext: function () {
      var nameEl = document.getElementById('ng-captain-name');
      var bioEl = document.getElementById('ng-bio');
      var errorEl = document.getElementById('ng-error');

      var captainName = (nameEl && nameEl.value.trim()) || '';
      if (!captainName) {
        if (errorEl) {
          errorEl.textContent = 'A captain needs a name.';
          errorEl.classList.remove('hidden');
        }
        if (nameEl) nameEl.focus();
        return;
      }

      var friendlyPorts = (this._worldData.settlements || []).filter(function (s) {
        return FRIENDLY_PORT_TYPES.indexOf(s.type) !== -1;
      });

      if (friendlyPorts.length === 0) {
        if (errorEl) {
          errorEl.textContent = 'This world has no friendly ports — choose a different world.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      if (errorEl) errorEl.classList.add('hidden');

      this._captainName = captainName;
      this._captainBio = (bioEl && bioEl.value.trim()) || '';
      this._renderDifficultyStep(friendlyPorts);
    },

    _renderDifficultyStep: function (friendlyPorts) {
      var self = this;
      var panelEl = this._panelEl;
      if (!panelEl) return;
      var worldName = (this._worldData && this._worldData.name) || 'Unknown World';

      var difficultyCards = Object.keys(T.DIFFICULTY_LEVELS)
        .map(function (id) {
          var d = T.DIFFICULTY_LEVELS[id];
          var isSelected = id === self._selectedDifficulty;
          return (
            '<button class="difficulty-card' +
            (isSelected ? ' difficulty-card--selected' : '') +
            '" type="button"' +
            ' data-difficulty="' +
            _escapeAttr(id) +
            '"' +
            ' aria-pressed="' +
            (isSelected ? 'true' : 'false') +
            '">' +
            '<span class="difficulty-card-label">' +
            _escapeHtml(d.label) +
            '</span>' +
            '<span class="difficulty-card-desc">' +
            _escapeHtml(d.description) +
            '</span>' +
            '</button>'
          );
        })
        .join('');

      panelEl.innerHTML =
        '<div class="new-game-panel">' +
        '<div class="new-game-world-badge">World: ' +
        _escapeAttr(worldName) +
        '</div>' +
        '<h2 class="new-game-title">Choose Difficulty</h2>' +
        '<div class="difficulty-picker">' +
        difficultyCards +
        '</div>' +
        '<p class="new-game-error hidden" id="ng-error"></p>' +
        '<div class="new-game-actions">' +
        '<button class="btn-cancel" id="ng-back" type="button">Back</button>' +
        '<button class="app-btn app-btn--sm" id="ng-next" type="button">Next: Choose Port</button>' +
        '</div>' +
        '</div>';

      panelEl.querySelectorAll('.difficulty-card').forEach(function (card) {
        card.addEventListener('click', function () {
          self._selectedDifficulty = card.getAttribute('data-difficulty');
          panelEl.querySelectorAll('.difficulty-card').forEach(function (c) {
            c.classList.remove('difficulty-card--selected');
            c.setAttribute('aria-pressed', 'false');
          });
          card.classList.add('difficulty-card--selected');
          card.setAttribute('aria-pressed', 'true');
        });
      });

      document.getElementById('ng-back').addEventListener('click', function () {
        self._renderStep1();
      });

      document.getElementById('ng-next').addEventListener('click', function () {
        self._renderPortStep(friendlyPorts);
      });
    },

    _renderPortStep: function (friendlyPorts) {
      if (this._portMap) {
        this._portMap.remove();
        this._portMap = null;
      }
      this._portMarkers = [];
      this._selectedPortId = null;

      var worldName = (this._worldData && this._worldData.name) || 'Unknown World';
      var factions = (this._worldData && this._worldData.factions) || [];
      var portCards = _buildPortCards(friendlyPorts, factions);
      var self = this;

      this._panelEl.innerHTML =
        '<div class="new-game-panel new-game-panel--wide">' +
        '<div class="new-game-world-badge">World: ' +
        _escapeAttr(worldName) +
        '</div>' +
        '<h2 class="new-game-title">Choose Your Starting Port</h2>' +
        '<div class="port-picker-layout">' +
        '<div class="port-picker-map" id="ng-port-map"></div>' +
        '<div class="port-picker-list" id="ng-port-list">' +
        portCards +
        '</div>' +
        '</div>' +
        '<p class="new-game-error hidden" id="ng-error"></p>' +
        '<div class="new-game-actions">' +
        '<button class="btn-cancel" id="ng-back" type="button">Back</button>' +
        '<button class="app-btn app-btn--sm" id="ng-confirm" type="button" disabled>' +
        'Begin Campaign' +
        '</button>' +
        '</div>' +
        '</div>';

      this._buildPortMap(friendlyPorts);

      var portList = document.getElementById('ng-port-list');
      if (portList) {
        portList.querySelectorAll('.port-card').forEach(function (card) {
          card.addEventListener('click', function () {
            self._selectPort(card.getAttribute('data-port-id'));
          });
        });
      }

      document.getElementById('ng-back').addEventListener('click', function () {
        if (self._portMap) {
          self._portMap.remove();
          self._portMap = null;
        }
        self._portMarkers = [];
        self._renderDifficultyStep(friendlyPorts);
      });

      document.getElementById('ng-confirm').addEventListener('click', function () {
        self._onConfirm();
      });
    },

    _buildPortMap: function (friendlyPorts) {
      var mapEl = document.getElementById('ng-port-map');
      if (!mapEl || typeof L === 'undefined') return;

      var worldData = this._worldData;
      var self = this;

      var map = L.map(mapEl, {
        crs: L.CRS.Simple,
        minZoom: -2,
        maxZoom: 4,
        zoomControl: true,
      });
      this._portMap = map;
      this._portMarkers = [];

      if (worldData && worldData.coastlines) {
        worldData.coastlines.forEach(function (ring) {
          L.polygon(ring, {
            color: '#4a7c59',
            fillColor: '#2d5a3d',
            fillOpacity: 0.6,
            weight: 2,
          }).addTo(map);
        });
      }

      friendlyPorts.forEach(function (s) {
        var pos = s.position || s.pos;
        if (!pos) return;
        var marker = L.circleMarker(pos, {
          radius: 8,
          color: '#a07028',
          fillColor: '#c8a84b',
          fillOpacity: 0.85,
          weight: 2,
        });
        marker.bindPopup('<strong>' + _escapeHtml(s.name) + '</strong>');
        marker.on('click', function () {
          self._selectPort(s.id);
        });
        marker.addTo(map);
        self._portMarkers.push({ id: s.id, marker: marker });
      });

      if (worldData && worldData.bounds) {
        map.fitBounds(worldData.bounds);
      }
    },

    _selectPort: function (id) {
      this._selectedPortId = id;

      this._portMarkers.forEach(function (entry) {
        if (entry.id === id) {
          entry.marker.setRadius(11);
          entry.marker.setStyle({
            color: '#ffb74d',
            fillColor: '#ffb74d',
            fillOpacity: 1,
            weight: 3,
          });
        } else {
          entry.marker.setRadius(8);
          entry.marker.setStyle({
            color: '#a07028',
            fillColor: '#c8a84b',
            fillOpacity: 0.85,
            weight: 2,
          });
        }
      });

      var portList = document.getElementById('ng-port-list');
      if (portList) {
        portList.querySelectorAll('.port-card').forEach(function (card) {
          var isSelected = card.getAttribute('data-port-id') === id;
          card.classList.toggle('port-card--selected', isSelected);
          card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });
      }

      var confirmBtn = document.getElementById('ng-confirm');
      if (confirmBtn) confirmBtn.disabled = false;
    },

    _hide: function () {
      if (this._portMap) {
        this._portMap.remove();
        this._portMap = null;
      }
      this._portMarkers = [];
      this._selectedPortId = null;
      this._captainName = '';
      this._captainBio = '';
      if (this._panelEl) {
        this._panelEl.classList.add('hidden');
        this._panelEl.innerHTML = '';
      }
      this._worldId = null;
      this._worldData = null;
      this._selectedShipClass = null;
    },

    _onConfirm: function () {
      var errorEl = document.getElementById('ng-error');
      var confirmBtn = document.getElementById('ng-confirm');
      var backBtn = document.getElementById('ng-back');

      if (!this._selectedPortId) {
        if (errorEl) {
          errorEl.textContent = 'Choose a port to begin your campaign.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      if (errorEl) errorEl.classList.add('hidden');
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Creating…';
      }
      if (backBtn) backBtn.disabled = true;

      var captainName = this._captainName;
      var bio = this._captainBio;
      var selectedShipClass = this._selectedShipClass;
      var shipType = T.SHIP_TYPES[selectedShipClass];
      var startingPortId = this._selectedPortId;
      var startingPort = (this._worldData.settlements || []).find(function (s) {
        return s.id === startingPortId;
      });

      var gameDoc = {
        worldId: this._worldId,
        worldName: (this._worldData && this._worldData.name) || '',
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
        startingPortId: startingPortId,
        fog: [startingPortId],
        settings: { difficulty: this._selectedDifficulty, mythicEnabled: true, pacing: 'async' },
        worldSnapshot: T.firestore.encodeWorld(this._worldData),
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
        location: startingPortId,
        position:
          startingPort && startingPort.position
            ? { y: startingPort.position[0], x: startingPort.position[1] }
            : null,
        apRemaining: T.seaGraph.speedToAP(shipType.baseStats.speed),
        squadId: null,
      };

      var self = this;
      var gameDocRef;
      var flagshipDocRef;
      T.firestore
        .createGame(gameDoc)
        .then(function (docRef) {
          gameDocRef = docRef;
          return T.firestore.createFlagship(docRef.id, flagshipDoc);
        })
        .then(function (shipDocRef) {
          flagshipDocRef = shipDocRef;
          return T.firestore.updateGame(gameDocRef.id, { flagshipId: shipDocRef.id });
        })
        .then(function () {
          if (self._portMap) {
            self._portMap.remove();
            self._portMap = null;
          }
          self._portMarkers = [];
          var fullGameDoc = Object.assign({}, gameDoc, { flagshipId: flagshipDocRef.id });
          T.gameMap.open(
            gameDocRef.id,
            fullGameDoc,
            flagshipDocRef.id,
            flagshipDoc,
            self._worldData
          );
        })
        .catch(function (err) {
          if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Begin Campaign';
          }
          if (backBtn) backBtn.disabled = false;
          if (errorEl) {
            errorEl.textContent = 'Failed to create campaign: ' + err.message;
            errorEl.classList.remove('hidden');
          }
        });
    },
  };
})();
