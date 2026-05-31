(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  // ── Module-local state ───────────────────────────────────────

  var _unsubGame = null;
  var _unsubFlagship = null;
  var _worldData = null;
  var _settlementIndex = {};
  var _lastGameDoc = null;
  var _lastFlagshipDoc = null;
  var _fogLayerRef = null;
  var _shipLayerRef = null;

  // ── Portrait symbols (mirrors new-game.js) ───────────────────

  var PORTRAIT_SYMBOLS = {
    anchor: '⚓',
    skull: '💀',
    compass: '🧭',
    wheel: '⚙️',
    telescope: '🔭',
    map: '🗺️',
  };

  // ── Helpers ──────────────────────────────────────────────────

  function _escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function _makeCircle(center, radius, steps) {
    var pts = [];
    for (var i = 0; i < steps; i++) {
      var angle = (2 * Math.PI * i) / steps;
      pts.push([center[0] + radius * Math.sin(angle), center[1] + radius * Math.cos(angle)]);
    }
    return pts;
  }

  // ── Fog layer ────────────────────────────────────────────────

  function _buildFogLayer(fog, worldData) {
    var bounds = (worldData && worldData.bounds) || [
      [0, 0],
      [600, 800],
    ];
    var minY = bounds[0][0];
    var minX = bounds[0][1];
    var maxY = bounds[1][0];
    var maxX = bounds[1][1];
    var pad = 50;

    var outer = [
      [minY - pad, minX - pad],
      [minY - pad, maxX + pad],
      [maxY + pad, maxX + pad],
      [maxY + pad, minX - pad],
    ];

    var height = maxY - minY;
    var width = maxX - minX;
    var revealR = Math.max(15, Math.min(height, width) * 0.035);

    var holes = [];
    (fog || []).forEach(function (settlementId) {
      var s = _settlementIndex[settlementId];
      if (!s || !s.position) return;
      holes.push(_makeCircle(s.position, revealR, 20));
    });

    var rings = [outer].concat(holes);
    return L.layerGroup([
      L.polygon(rings, {
        color: 'transparent',
        fillColor: '#0a0a14',
        fillOpacity: 0.75,
        weight: 0,
        interactive: false,
      }),
    ]);
  }

  function _setFogLayer(layer) {
    if (_fogLayerRef) _fogLayerRef.remove();
    _fogLayerRef = layer;
    T.mapRenderer.addExternalLayer('fog', layer);
  }

  // ── Ship layer ───────────────────────────────────────────────

  function _buildShipLayer(locationId) {
    var group = L.layerGroup();
    if (!locationId) return group;
    var s = _settlementIndex[locationId];
    var pos = s && s.position ? s.position : null;
    if (!pos) return group;
    L.circleMarker(pos, {
      radius: 9,
      color: '#ffb74d',
      fillColor: '#ffb74d',
      fillOpacity: 0.9,
      weight: 2,
      interactive: false,
    }).addTo(group);
    return group;
  }

  function _setShipLayer(layer) {
    if (_shipLayerRef) _shipLayerRef.remove();
    _shipLayerRef = layer;
    T.mapRenderer.addExternalLayer('ship', layer);
  }

  // ── HUD ──────────────────────────────────────────────────────

  function _renderHud(gameDoc, flagshipDoc) {
    var hudEl = document.getElementById('game-hud');
    if (!hudEl) return;

    var captain = (gameDoc && gameDoc.captain) || {};
    var captainName = captain.name || '—';
    var gold = captain.gold != null ? captain.gold : 0;
    var portraitSymbol = PORTRAIT_SYMBOLS[captain.portrait] || '⚓';

    var shipName = (flagshipDoc && flagshipDoc.name) || '—';
    var cargoStr = '—';
    if (flagshipDoc && flagshipDoc.cargo) {
      cargoStr = flagshipDoc.cargo.used + ' / ' + flagshipDoc.cargo.capacity;
    }

    var locationName = '—';
    if (flagshipDoc && flagshipDoc.location) {
      var s = _settlementIndex[flagshipDoc.location];
      if (s && s.name) locationName = s.name;
    }

    hudEl.innerHTML =
      '<div class="game-hud-portrait">' +
      portraitSymbol +
      '</div>' +
      '<div class="game-hud-item">' +
      '<span class="game-hud-label">Captain</span>' +
      '<span class="game-hud-value">' +
      _escapeHtml(captainName) +
      '</span>' +
      '</div>' +
      '<div class="game-hud-item">' +
      '<span class="game-hud-label">Ship</span>' +
      '<span class="game-hud-value">' +
      _escapeHtml(shipName) +
      '</span>' +
      '</div>' +
      '<div class="game-hud-item">' +
      '<span class="game-hud-label">Gold</span>' +
      '<span class="game-hud-value game-hud-gold">' +
      _escapeHtml(String(gold)) +
      '</span>' +
      '</div>' +
      '<div class="game-hud-item">' +
      '<span class="game-hud-label">Cargo</span>' +
      '<span class="game-hud-value">' +
      _escapeHtml(cargoStr) +
      '</span>' +
      '</div>' +
      '<div class="game-hud-item">' +
      '<span class="game-hud-label">Location</span>' +
      '<span class="game-hud-value">' +
      _escapeHtml(locationName) +
      '</span>' +
      '</div>';
  }

  // ── Live update handlers ─────────────────────────────────────

  function _onGameUpdate(gameDoc, err) {
    if (err) {
      console.error('[game-map] onGame error', err);
      return;
    }
    _lastGameDoc = gameDoc;
    _renderHud(gameDoc, _lastFlagshipDoc);

    var mapPanel = document.getElementById('game-map-panel');
    if (!mapPanel || mapPanel.classList.contains('hidden')) return;
    _setFogLayer(_buildFogLayer(gameDoc.fog, _worldData));
  }

  function _onFlagshipUpdate(flagshipDoc, err) {
    if (err) {
      console.error('[game-map] onFlagship error', err);
      return;
    }
    _lastFlagshipDoc = flagshipDoc;
    _renderHud(_lastGameDoc, flagshipDoc);

    var mapPanel = document.getElementById('game-map-panel');
    if (!mapPanel || mapPanel.classList.contains('hidden')) return;
    _setShipLayer(_buildShipLayer(flagshipDoc.location));
  }

  // ── Public API ───────────────────────────────────────────────

  T.gameMap = {
    open: function (gameId, gameDoc, flagshipId, flagshipDoc, worldData) {
      _worldData = worldData;
      _lastGameDoc = gameDoc;
      _lastFlagshipDoc = flagshipDoc;

      // Build settlement index
      _settlementIndex = {};
      (worldData.settlements || []).forEach(function (s) {
        _settlementIndex[s.id] = s;
      });

      // Show/hide panels
      var shellPlayEl = document.getElementById('shell-play');
      var worldListSection = shellPlayEl && shellPlayEl.querySelector('.world-list-section');
      var newGamePanel = document.getElementById('new-game-panel');
      var gameMapPanel = document.getElementById('game-map-panel');

      if (worldListSection) worldListSection.classList.add('hidden');
      if (newGamePanel) {
        newGamePanel.classList.add('hidden');
        newGamePanel.innerHTML = '';
      }
      if (gameMapPanel) gameMapPanel.classList.remove('hidden');

      // Render initial HUD
      _renderHud(gameDoc, flagshipDoc);

      // Init map renderer
      var mapEl = document.getElementById('map-play');
      T.mapRenderer.init(mapEl, worldData);

      // Add fog and ship layers
      _setFogLayer(_buildFogLayer(gameDoc.fog, worldData));
      _setShipLayer(_buildShipLayer(flagshipDoc.location));

      // Subscribe to live Firestore updates
      _unsubGame = T.firestore.onGame(gameId, _onGameUpdate);
      _unsubFlagship = T.firestore.onFlagship(gameId, flagshipId, _onFlagshipUpdate);
    },

    close: function () {
      if (_unsubGame) {
        _unsubGame();
        _unsubGame = null;
      }
      if (_unsubFlagship) {
        _unsubFlagship();
        _unsubFlagship = null;
      }

      T.mapRenderer.destroy();

      _fogLayerRef = null;
      _shipLayerRef = null;
      _worldData = null;
      _settlementIndex = {};
      _lastGameDoc = null;
      _lastFlagshipDoc = null;

      var gameMapPanel = document.getElementById('game-map-panel');
      if (gameMapPanel) gameMapPanel.classList.add('hidden');

      var shellPlayEl = document.getElementById('shell-play');
      var worldListSection = shellPlayEl && shellPlayEl.querySelector('.world-list-section');
      if (worldListSection) worldListSection.classList.remove('hidden');
    },
  };
})();
