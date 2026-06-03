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

  // Movement state
  var _seaGraph = null;
  var _apMax = 0;
  var _apRemaining = 0;
  var _currentPosition = null; // [y, x] in world coords
  var _pathPreviewLayer = null;
  var _movementAnimating = false;
  var _pendingMoveResult = null; // { displayPath, gridPath, steps }
  var _gameId = null;
  var _flagshipId = null;
  var _navCellLayer = null; // L.layerGroup of reachable-cell markers

  // ── Open port visit modal ────────────────────────────────────

  function _openPortVisit() {
    if (!_lastFlagshipDoc || !_lastFlagshipDoc.location) return;
    var s = _settlementIndex[_lastFlagshipDoc.location];
    T.portVisit.open(
      _gameId,
      _flagshipId,
      _lastGameDoc,
      _lastFlagshipDoc,
      _lastFlagshipDoc.location,
      (s && s.name) || 'Port',
      _apMax,
      function () {
        _showReachableCells();
      }
    );
  }

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

  // ── Discovery toast ──────────────────────────────────────────

  function _showDiscoveryToast(settlementIds) {
    var names = settlementIds.map(function (id) {
      return _escapeHtml((_settlementIndex[id] && _settlementIndex[id].name) || 'Unknown');
    });
    _setMoveInfo('<div class="game-hud-discovery">Discovered: ' + names.join(', ') + '</div>');
    setTimeout(function () {
      _setMoveInfo('');
    }, 3000);
  }

  // ── Discovery toast ──────────────────────────────────────────

  function _showDiscoveryToast(settlementIds) {
    var names = settlementIds.map(function (id) {
      return _escapeHtml((_settlementIndex[id] && _settlementIndex[id].name) || 'Unknown');
    });
    _setMoveInfo('<div class="game-hud-discovery">Discovered: ' + names.join(', ') + '</div>');
    setTimeout(function () {
      _setMoveInfo('');
    }, 3000);
  }

  // ── Fog layer ────────────────────────────────────────────────
  // Canvas-based fog uses destination-out compositing so overlapping
  // reveal circles don't re-fill each other (SVG evenodd fill rule breaks
  // when holes overlap).

  var _FogLayer = L.Layer.extend({
    initialize: function (fog, worldData) {
      this._fog = fog;
      this._worldData = worldData;
    },

    onAdd: function (map) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', 'tortuga-fog-canvas');
      this._canvas.style.position = 'absolute';
      this._canvas.style.pointerEvents = 'none';
      map.getPanes().overlayPane.appendChild(this._canvas);
      map.on('viewreset moveend', this._draw, this);
      this._draw();
    },

    onRemove: function (map) {
      map.off('viewreset moveend', this._draw, this);
      if (this._canvas && this._canvas.parentNode) {
        this._canvas.parentNode.removeChild(this._canvas);
      }
      this._canvas = null;
    },

    _draw: function () {
      var map = this._map;
      var canvas = this._canvas;
      if (!map || !canvas) return;

      var pad = 256;
      var size = map.getSize();
      var w = size.x + pad * 2;
      var h = size.y + pad * 2;

      canvas.width = w;
      canvas.height = h;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([-pad, -pad]));

      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(10, 10, 20, 0.75)';
      ctx.fillRect(0, 0, w, h);

      var bounds = (this._worldData && this._worldData.bounds) || [
        [0, 0],
        [600, 800],
      ];
      var mapH = bounds[1][0] - bounds[0][0];
      var mapW = bounds[1][1] - bounds[0][1];
      var revealR = Math.max(15, Math.min(mapH, mapW) * 0.035);

      ctx.globalCompositeOperation = 'destination-out';
      (this._fog || []).forEach(function (settlementId) {
        var s = _settlementIndex[settlementId];
        if (!s || !s.position) return;
        var pt = map.latLngToContainerPoint([s.position[0], s.position[1]]);
        var northPt = map.latLngToContainerPoint([s.position[0] + revealR, s.position[1]]);
        var rPx = Math.max(4, Math.abs(pt.y - northPt.y));
        ctx.beginPath();
        ctx.arc(pt.x + pad, pt.y + pad, rPx, 0, 2 * Math.PI);
        ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
    },
  });

  function _buildFogLayer(fog, worldData) {
    return new _FogLayer(fog, worldData);
  }

  function _setFogLayer(layer) {
    if (_fogLayerRef) _fogLayerRef.remove();
    _fogLayerRef = layer;
    T.mapRenderer.addExternalLayer('fog', layer);
  }

  // ── Ship layer ───────────────────────────────────────────────

  function _resolveShipPos(flagshipDoc) {
    if (flagshipDoc && flagshipDoc.position) {
      return [flagshipDoc.position.y, flagshipDoc.position.x];
    }
    // Fallback for pre-migration documents that have only a settlement location.
    if (flagshipDoc && flagshipDoc.location) {
      var s = _settlementIndex[flagshipDoc.location];
      if (s && s.position) return s.position;
    }
    return null;
  }

  function _buildShipLayer(flagshipDoc) {
    var group = L.layerGroup();
    var pos = _resolveShipPos(flagshipDoc);
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

  function _buildShipLayerAtPos(pos) {
    var group = L.layerGroup();
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

    // Preserve any active move-info content across re-renders.
    var moveInfoEl = document.getElementById('game-hud-move-info');
    var savedMoveInfo = moveInfoEl ? moveInfoEl.innerHTML : '';

    var captain = (gameDoc && gameDoc.captain) || {};
    var captainName = captain.name || '—';
    var gold = captain.gold != null ? captain.gold : 0;
    var portraitSymbol = PORTRAIT_SYMBOLS[captain.portrait] || '⚓';

    var shipName = (flagshipDoc && flagshipDoc.name) || '—';
    var cargoStr = '—';
    if (flagshipDoc && flagshipDoc.cargo) {
      cargoStr = flagshipDoc.cargo.used + ' / ' + flagshipDoc.cargo.capacity;
    }

    var locationName = 'At Sea';
    var atFriendlyPort = false;
    if (flagshipDoc && flagshipDoc.location) {
      var s = _settlementIndex[flagshipDoc.location];
      if (s && s.name) locationName = s.name;
      if (s && T.FRIENDLY_PORT_TYPES.indexOf(s.type) !== -1) atFriendlyPort = true;
    }

    var apRemaining =
      flagshipDoc && flagshipDoc.apRemaining != null ? flagshipDoc.apRemaining : _apRemaining;
    var apLowClass = apRemaining <= 2 ? ' game-hud-ap--low' : '';

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
      '</div>' +
      '<div class="game-hud-item">' +
      '<span class="game-hud-label">AP</span>' +
      '<span class="game-hud-value game-hud-ap' +
      apLowClass +
      '">' +
      apRemaining +
      ' / ' +
      _apMax +
      '</span>' +
      '</div>' +
      '<div class="game-hud-move-info" id="game-hud-move-info">' +
      savedMoveInfo +
      '</div>' +
      '<div class="game-hud-actions">' +
      (atFriendlyPort
        ? '<button class="game-hud-visit-port" id="game-hud-visit-port" type="button">Visit Port</button>'
        : '') +
      '<button class="game-hud-end-turn" id="game-hud-end-turn" type="button">End Turn</button>' +
      '</div>';

    // Re-attach button listeners after innerHTML replacement.
    var endTurnBtn = document.getElementById('game-hud-end-turn');
    if (endTurnBtn) endTurnBtn.addEventListener('click', _endTurn);
    var visitPortBtn = document.getElementById('game-hud-visit-port');
    if (visitPortBtn) visitPortBtn.addEventListener('click', _openPortVisit);

    if (savedMoveInfo) {
      var confirmBtn = document.getElementById('game-hud-move-confirm');
      var cancelBtn = document.getElementById('game-hud-move-cancel');
      if (confirmBtn) confirmBtn.addEventListener('click', _confirmMove);
      if (cancelBtn) cancelBtn.addEventListener('click', _cancelMove);
    }
  }

  // ── Move info area ───────────────────────────────────────────

  function _setMoveInfo(html) {
    var el = document.getElementById('game-hud-move-info');
    if (el) el.innerHTML = html || '';
  }

  // ── Path preview ─────────────────────────────────────────────

  function _clearPathPreview() {
    if (_pathPreviewLayer) {
      _pathPreviewLayer.remove();
      _pathPreviewLayer = null;
    }
    _pendingMoveResult = null;
    _setMoveInfo('');
  }

  function _showPathPreview(result) {
    _clearPathPreview();

    if (!result) {
      return;
    }

    var withinAP = result.steps <= _apRemaining;
    var color = withinAP ? '#4caf50' : '#f44336';
    var dashArray = withinAP ? null : '8 5';

    _pathPreviewLayer = L.polyline(result.displayPath, {
      color: color,
      weight: 3,
      dashArray: dashArray,
      opacity: 0.85,
      interactive: false,
    });
    T.mapRenderer.addExternalLayer('path-preview', _pathPreviewLayer);

    if (withinAP) {
      _pendingMoveResult = result;
      _setMoveInfo(
        '<div class="game-hud-move-prompt">' +
          '<span class="game-hud-move-cost">Move: ' +
          result.steps +
          ' AP</span>' +
          '<button class="game-hud-move-confirm" id="game-hud-move-confirm" type="button">Move</button>' +
          '<button class="game-hud-move-cancel" id="game-hud-move-cancel" type="button">Cancel</button>' +
          '</div>'
      );
      var confirmBtn = document.getElementById('game-hud-move-confirm');
      var cancelBtn = document.getElementById('game-hud-move-cancel');
      if (confirmBtn) confirmBtn.addEventListener('click', _confirmMove);
      if (cancelBtn) cancelBtn.addEventListener('click', _cancelMove);
    } else {
      _setMoveInfo(
        '<div class="game-hud-move-prompt game-hud-move-prompt--blocked">' +
          '<span class="game-hud-move-cost game-hud-move-cost--over">Not enough AP (' +
          result.steps +
          ' needed)</span>' +
          '</div>'
      );
    }
  }

  // ── Reachable-cell markers ───────────────────────────────────

  function _clearNavCells() {
    if (_navCellLayer) {
      _navCellLayer.remove();
      _navCellLayer = null;
    }
  }

  function _showReachableCells() {
    _clearNavCells();
    if (!_seaGraph || !_currentPosition || _movementAnimating || _apRemaining <= 0) return;
    var cells = T.seaGraph.reachableCells(_seaGraph, _currentPosition, _apRemaining);
    if (!cells.length) return;
    var group = L.layerGroup();
    cells.forEach(function (cell) {
      var marker = L.circleMarker(cell.worldPos, {
        radius: 6,
        color: '#4caf50',
        fillColor: '#4caf50',
        fillOpacity: 0.25,
        weight: 1,
        opacity: 0.7,
      });
      marker.on('click', function (e) {
        L.DomEvent.stopPropagation(e);
        _onNavCellClick(cell.worldPos);
      });
      marker.addTo(group);
    });
    _navCellLayer = group;
    T.mapRenderer.addExternalLayer('nav-cells', group);
  }

  function _onNavCellClick(pos) {
    if (_movementAnimating) return;
    _clearNavCells();
    _clearPathPreview();
    var result = T.seaGraph.findPath(_seaGraph, _currentPosition, pos);
    _showPathPreview(result);
  }

  // ── Movement ─────────────────────────────────────────────────

  function _cancelMove() {
    _clearPathPreview();
    _showReachableCells();
  }

  function _confirmMove() {
    if (!_pendingMoveResult || _movementAnimating) return;
    var result = _pendingMoveResult;
    _pendingMoveResult = null;
    _setMoveInfo('');

    _movementAnimating = true;
    var gridPath = result.gridPath;
    var stepIndex = 0;

    function _step() {
      stepIndex++;
      if (stepIndex >= gridPath.length) {
        _finishMove(gridPath[gridPath.length - 1], result.steps);
        return;
      }
      var pos = gridPath[stepIndex];
      _currentPosition = pos;
      _setShipLayer(_buildShipLayerAtPos(pos));
      setTimeout(_step, 150);
    }

    setTimeout(_step, 150);
  }

  function _finishMove(finalPos, stepsUsed) {
    _movementAnimating = false;
    _clearPathPreview();

    var newAP = Math.max(0, _apRemaining - stepsUsed);
    _apRemaining = newAP;
    _currentPosition = finalPos;

    // Determine if final position is at a settlement.
    var arrivedAtSettlement = null;
    var cellSize =
      _seaGraph && _seaGraph.cellH ? Math.max(_seaGraph.cellH, _seaGraph.cellW) / 2 : 8;
    Object.keys(_settlementIndex).forEach(function (id) {
      var s = _settlementIndex[id];
      if (!s || !s.position) return;
      var dy = s.position[0] - finalPos[0];
      var dx = s.position[1] - finalPos[1];
      if (Math.sqrt(dy * dy + dx * dx) < cellSize) {
        arrivedAtSettlement = id;
      }
    });

    // Scan for newly discovered settlements within discovery range.
    var currentFog = (_lastGameDoc && _lastGameDoc.fog) || [];
    var fogSet = {};
    currentFog.forEach(function (id) {
      fogSet[id] = true;
    });
    var newlyDiscovered = [];
    Object.keys(_settlementIndex).forEach(function (id) {
      if (fogSet[id]) return;
      var s = _settlementIndex[id];
      if (!s || !s.position) return;
      var dy = s.position[0] - finalPos[0];
      var dx = s.position[1] - finalPos[1];
      var dist = Math.sqrt(dy * dy + dx * dx);
      var radius = s.hidden || s.type === 'hidden_cove' ? T.HIDDEN_COVE_RADIUS : T.DISCOVERY_RADIUS;
      if (dist < radius) {
        newlyDiscovered.push(id);
      }
    });
    if (newlyDiscovered.length > 0) {
      T.firestore
        .updateGame(_gameId, {
          fog: firebase.firestore.FieldValue.arrayUnion.apply(null, newlyDiscovered),
        })
        .catch(function (err) {
          console.error('[game-map] fog discovery update failed', err);
        });
      _showDiscoveryToast(newlyDiscovered);
    }

    T.firestore
      .updateFlagship(_gameId, _flagshipId, {
        position: { y: finalPos[0], x: finalPos[1] },
        location: arrivedAtSettlement,
        apRemaining: newAP,
      })
      .catch(function (err) {
        console.error('[game-map] updateFlagship failed', err);
      });

    var patchedFlagship = Object.assign({}, _lastFlagshipDoc, {
      apRemaining: newAP,
      location: arrivedAtSettlement,
      position: { y: finalPos[0], x: finalPos[1] },
    });
    _renderHud(_lastGameDoc, patchedFlagship);

    if (arrivedAtSettlement) {
      var arrSett = _settlementIndex[arrivedAtSettlement];
      if (arrSett && T.FRIENDLY_PORT_TYPES.indexOf(arrSett.type) !== -1) {
        T.portVisit.open(
          _gameId,
          _flagshipId,
          _lastGameDoc,
          patchedFlagship,
          arrivedAtSettlement,
          arrSett.name,
          _apMax,
          function () {
            _showReachableCells();
          }
        );
        return;
      }
    }

    _showReachableCells();
  }

  // ── End Turn ─────────────────────────────────────────────────

  function _endTurn() {
    if (_movementAnimating) return;
    _clearPathPreview();
    _apRemaining = _apMax;

    T.firestore.updateFlagship(_gameId, _flagshipId, { apRemaining: _apMax }).catch(function (err) {
      console.error('[game-map] updateFlagship (endTurn) failed', err);
    });

    T.firestore
      .updateGame(_gameId, {
        turnNumber: firebase.firestore.FieldValue.increment(1),
      })
      .catch(function (err) {
        console.error('[game-map] updateGame (endTurn) failed', err);
      });

    _renderHud(_lastGameDoc, Object.assign({}, _lastFlagshipDoc, { apRemaining: _apMax }));
    _showReachableCells();
  }

  // ── Live update handlers ─────────────────────────────────────

  function _onGameUpdate(gameDoc, err) {
    if (err) {
      console.error('[game-map] onGame error', err);
      return;
    }
    _lastGameDoc = gameDoc;
    _renderHud(gameDoc, _lastFlagshipDoc);

    if (T.portVisit.isOpen()) {
      T.portVisit.updateDocs(_lastGameDoc, _lastFlagshipDoc);
    }

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

    // Sync AP and position from Firestore (covers resume-from-save).
    if (flagshipDoc.apRemaining != null) {
      _apRemaining = flagshipDoc.apRemaining;
    }
    if (flagshipDoc.position) {
      _currentPosition = [flagshipDoc.position.y, flagshipDoc.position.x];
    }

    _renderHud(_lastGameDoc, flagshipDoc);

    if (T.portVisit.isOpen()) {
      T.portVisit.updateDocs(_lastGameDoc, _lastFlagshipDoc);
    }

    var mapPanel = document.getElementById('game-map-panel');
    if (!mapPanel || mapPanel.classList.contains('hidden')) return;
    if (!_movementAnimating) {
      _setShipLayer(_buildShipLayer(flagshipDoc));
      _showReachableCells();
    }
  }

  // ── Public API ───────────────────────────────────────────────

  T.gameMap = {
    open: function (gameId, gameDoc, flagshipId, flagshipDoc, worldData) {
      _gameId = gameId;
      _flagshipId = flagshipId;
      _worldData = worldData;
      _lastGameDoc = gameDoc;
      _lastFlagshipDoc = flagshipDoc;

      // Build settlement index.
      _settlementIndex = {};
      (worldData.settlements || []).forEach(function (s) {
        _settlementIndex[s.id] = s;
      });

      // Movement state from flagship doc.
      _apMax = T.seaGraph.speedToAP((flagshipDoc && flagshipDoc.speed) || 0);
      _apRemaining =
        flagshipDoc && flagshipDoc.apRemaining != null ? flagshipDoc.apRemaining : _apMax;
      _currentPosition = _resolveShipPos(flagshipDoc);
      _movementAnimating = false;
      _pendingMoveResult = null;

      // Build sea graph from world coastlines.
      _seaGraph = T.seaGraph.buildGraph(worldData);

      // Show/hide panels.
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

      // Render initial HUD.
      _renderHud(gameDoc, flagshipDoc);

      // Init map renderer.
      var mapEl = document.getElementById('map-play');
      T.mapRenderer.init(mapEl, worldData);

      // Add fog and ship layers.
      _setFogLayer(_buildFogLayer(gameDoc.fog, worldData));
      _setShipLayer(_buildShipLayer(flagshipDoc));

      // Show reachable-cell markers for tap-to-move.
      _showReachableCells();

      // Subscribe to live Firestore updates.
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

      _clearNavCells();
      _clearPathPreview();
      T.mapRenderer.destroy();

      _fogLayerRef = null;
      _shipLayerRef = null;
      _navCellLayer = null;
      _pathPreviewLayer = null;
      _worldData = null;
      _settlementIndex = {};
      _lastGameDoc = null;
      _lastFlagshipDoc = null;
      _seaGraph = null;
      _currentPosition = null;
      _movementAnimating = false;
      _pendingMoveResult = null;
      _gameId = null;
      _flagshipId = null;

      var gameMapPanel = document.getElementById('game-map-panel');
      if (gameMapPanel) gameMapPanel.classList.add('hidden');

      var shellPlayEl = document.getElementById('shell-play');
      var worldListSection = shellPlayEl && shellPlayEl.querySelector('.world-list-section');
      if (worldListSection) worldListSection.classList.remove('hidden');
    },
  };
})();
