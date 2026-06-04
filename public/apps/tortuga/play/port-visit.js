(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  // ── Module-local state ───────────────────────────────────────

  var _gameId = null;
  var _flagshipId = null;
  var _apMax = 0;
  var _gameDoc = null;
  var _flagshipDoc = null;
  var _settlementName = '';
  var _onCloseCb = null;
  var _overlayEl = null;
  var _busy = false;

  // ── Prices ───────────────────────────────────────────────────

  var SUPPLY_PRICES = {
    food: { label: 'Food', cost: 2 },
    water: { label: 'Water', cost: 1 },
    rum: { label: 'Rum', cost: 3 },
    powder: { label: 'Powder', cost: 5 },
    shot: { label: 'Shot', cost: 4 },
    repairMaterials: { label: 'Repair Materials', cost: 6 },
  };
  var REPAIR_COST_PER_POINT = 5;
  var CREW_HIRE_COST = 10;

  // ── Helpers ──────────────────────────────────────────────────

  function _esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _gold() {
    return (_gameDoc && _gameDoc.captain && _gameDoc.captain.gold) || 0;
  }

  function _supplies() {
    return (_flagshipDoc && _flagshipDoc.supplies) || {};
  }

  function _statBar(current, max) {
    var pct = max > 0 ? Math.round((current / max) * 100) : 0;
    var color = pct > 60 ? '#66bb6a' : pct > 30 ? '#ffa726' : '#ef5350';
    return (
      '<span class="port-stat-bar">' +
      '<span class="port-stat-fill" style="width:' +
      pct +
      '%;background:' +
      color +
      '"></span></span>'
    );
  }

  // ── Error display ────────────────────────────────────────────

  function _showError(msg) {
    var el = _overlayEl && _overlayEl.querySelector('.port-error');
    if (el) el.textContent = msg || '';
  }

  function _clearError() {
    _showError('');
  }

  // ── Render ───────────────────────────────────────────────────

  function _render() {
    if (!_overlayEl) return;

    var ship = _flagshipDoc || {};
    var hull = ship.hull || { current: 0, max: 0 };
    var sails = ship.sails || { current: 0, max: 0 };
    var crew = ship.crew || { current: 0, min: 0, max: 0 };
    var cargo = ship.cargo || { used: 0, capacity: 0 };
    var supplies = _supplies();
    var gold = _gold();

    var cargoFree = Math.max(0, cargo.capacity - cargo.used);
    var hullRepairable = Math.max(0, hull.max - hull.current);
    var sailsRepairable = Math.max(0, sails.max - sails.current);
    var crewHirable = Math.max(0, crew.max - crew.current);
    var maxHullRepairAffordable = Math.min(
      hullRepairable,
      Math.floor(gold / REPAIR_COST_PER_POINT)
    );
    var maxSailsRepairAffordable = Math.min(
      sailsRepairable,
      Math.floor(gold / REPAIR_COST_PER_POINT)
    );
    var maxCrewAffordable = Math.min(crewHirable, Math.floor(gold / CREW_HIRE_COST));

    // Status strip
    var statusHtml =
      '<div class="port-status-strip">' +
      '<div class="port-status-item">' +
      '<span class="port-status-label">Gold</span>' +
      '<span class="port-status-value port-status-gold">' +
      _esc(String(gold)) +
      '</span>' +
      '</div>' +
      '<div class="port-status-item">' +
      '<span class="port-status-label">Hull</span>' +
      '<span class="port-status-value">' +
      hull.current +
      ' / ' +
      hull.max +
      ' ' +
      _statBar(hull.current, hull.max) +
      '</span>' +
      '</div>' +
      '<div class="port-status-item">' +
      '<span class="port-status-label">Sails</span>' +
      '<span class="port-status-value">' +
      sails.current +
      ' / ' +
      sails.max +
      ' ' +
      _statBar(sails.current, sails.max) +
      '</span>' +
      '</div>' +
      '<div class="port-status-item">' +
      '<span class="port-status-label">Crew</span>' +
      '<span class="port-status-value">' +
      crew.current +
      ' / ' +
      crew.max +
      '</span>' +
      '</div>' +
      '<div class="port-status-item">' +
      '<span class="port-status-label">Cargo</span>' +
      '<span class="port-status-value">' +
      cargo.used +
      ' / ' +
      cargo.capacity +
      '</span>' +
      '</div>' +
      '</div>';

    // Rest section
    var restHtml =
      '<div class="port-section">' +
      '<div class="port-section-title">Rest</div>' +
      '<div class="port-action-row">' +
      '<span class="port-action-label">Spend time in port (ends your turn, resets action points)</span>' +
      '<button class="port-btn port-btn--sm" id="port-rest-btn" type="button">Rest</button>' +
      '</div>' +
      '</div>';

    // Repair section
    var repairHtml =
      '<div class="port-section">' +
      '<div class="port-section-title">Repairs — ' +
      REPAIR_COST_PER_POINT +
      ' gold per point</div>' +
      '<div class="port-action-row">' +
      '<span class="port-action-label">Hull (' +
      hullRepairable +
      ' damaged)</span>' +
      '<input class="port-qty-input" id="port-hull-qty" type="number" min="0" max="' +
      maxHullRepairAffordable +
      '" value="0"' +
      (hullRepairable === 0 || gold < REPAIR_COST_PER_POINT ? ' disabled' : '') +
      '>' +
      '<span class="port-action-cost" id="port-hull-cost">0 gold</span>' +
      '<button class="port-btn port-btn--sm" id="port-hull-btn" type="button"' +
      (hullRepairable === 0 || gold < REPAIR_COST_PER_POINT ? ' disabled' : '') +
      '>Repair</button>' +
      '</div>' +
      '<div class="port-action-row">' +
      '<span class="port-action-label">Sails (' +
      sailsRepairable +
      ' damaged)</span>' +
      '<input class="port-qty-input" id="port-sails-qty" type="number" min="0" max="' +
      maxSailsRepairAffordable +
      '" value="0"' +
      (sailsRepairable === 0 || gold < REPAIR_COST_PER_POINT ? ' disabled' : '') +
      '>' +
      '<span class="port-action-cost" id="port-sails-cost">0 gold</span>' +
      '<button class="port-btn port-btn--sm" id="port-sails-btn" type="button"' +
      (sailsRepairable === 0 || gold < REPAIR_COST_PER_POINT ? ' disabled' : '') +
      '>Repair</button>' +
      '</div>' +
      '</div>';

    // Hire crew section
    var crewHtml =
      '<div class="port-section">' +
      '<div class="port-section-title">Hire Crew — ' +
      CREW_HIRE_COST +
      ' gold per crew</div>' +
      '<div class="port-action-row">' +
      '<span class="port-action-label">Crew (' +
      crewHirable +
      ' berths available)</span>' +
      '<input class="port-qty-input" id="port-crew-qty" type="number" min="0" max="' +
      maxCrewAffordable +
      '" value="0"' +
      (crewHirable === 0 || gold < CREW_HIRE_COST ? ' disabled' : '') +
      '>' +
      '<span class="port-action-cost" id="port-crew-cost">0 gold</span>' +
      '<button class="port-btn port-btn--sm" id="port-crew-btn" type="button"' +
      (crewHirable === 0 || gold < CREW_HIRE_COST ? ' disabled' : '') +
      '>Hire</button>' +
      '</div>' +
      '</div>';

    // Supplies section
    var supplyRows = Object.keys(SUPPLY_PRICES)
      .map(function (key) {
        var info = SUPPLY_PRICES[key];
        var current = supplies[key] || 0;
        var maxAffordable = Math.min(cargoFree, Math.floor(gold / info.cost));
        var disabled = cargoFree === 0 || gold < info.cost;
        return (
          '<div class="port-action-row">' +
          '<span class="port-action-label">' +
          _esc(info.label) +
          ' (have: ' +
          current +
          ') — ' +
          info.cost +
          'g each</span>' +
          '<input class="port-qty-input" id="port-supply-qty-' +
          _esc(key) +
          '" type="number" min="0" max="' +
          maxAffordable +
          '" value="0"' +
          (disabled ? ' disabled' : '') +
          '>' +
          '<span class="port-action-cost" id="port-supply-cost-' +
          _esc(key) +
          '">0 gold</span>' +
          '<button class="port-btn port-btn--sm" id="port-supply-btn-' +
          _esc(key) +
          '" type="button"' +
          (disabled ? ' disabled' : '') +
          ' data-supply-key="' +
          _esc(key) +
          '">Buy</button>' +
          '</div>'
        );
      })
      .join('');

    var suppliesHtml =
      '<div class="port-section">' +
      '<div class="port-section-title">Buy Supplies (1 cargo unit each)</div>' +
      (cargoFree === 0
        ? '<p class="port-error" style="margin-bottom:0.5rem">Cargo hold is full.</p>'
        : '') +
      supplyRows +
      '</div>';

    _overlayEl.innerHTML =
      '<div class="save-dialog-overlay" id="port-modal-backdrop">' +
      '<div class="port-dialog">' +
      '<div class="port-modal-header">' +
      '<span class="port-modal-title">Port of ' +
      _esc(_settlementName) +
      '</span>' +
      '<button class="port-modal-close" id="port-close-btn" type="button" aria-label="Leave port">&#x2715;</button>' +
      '</div>' +
      statusHtml +
      '<p class="port-error" id="port-error"></p>' +
      restHtml +
      repairHtml +
      crewHtml +
      suppliesHtml +
      '</div>' +
      '</div>';

    _attachListeners();
  }

  // ── Event wiring ─────────────────────────────────────────────

  function _attachListeners() {
    if (!_overlayEl) return;

    // Close button and backdrop click
    var closeBtn = document.getElementById('port-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', _close);

    var backdrop = document.getElementById('port-modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) _close();
      });
    }

    // Rest
    var restBtn = document.getElementById('port-rest-btn');
    if (restBtn) restBtn.addEventListener('click', _doRest);

    // Hull repair — live cost update
    var hullQty = document.getElementById('port-hull-qty');
    var hullCost = document.getElementById('port-hull-cost');
    var hullBtn = document.getElementById('port-hull-btn');
    if (hullQty) {
      hullQty.addEventListener('input', function () {
        var pts = Math.max(0, parseInt(hullQty.value, 10) || 0);
        if (hullCost) hullCost.textContent = pts * REPAIR_COST_PER_POINT + ' gold';
      });
    }
    if (hullBtn) {
      hullBtn.addEventListener('click', function () {
        var pts = Math.max(0, parseInt((hullQty && hullQty.value) || '0', 10));
        _doRepairHull(pts);
      });
    }

    // Sails repair — live cost update
    var sailsQty = document.getElementById('port-sails-qty');
    var sailsCost = document.getElementById('port-sails-cost');
    var sailsBtn = document.getElementById('port-sails-btn');
    if (sailsQty) {
      sailsQty.addEventListener('input', function () {
        var pts = Math.max(0, parseInt(sailsQty.value, 10) || 0);
        if (sailsCost) sailsCost.textContent = pts * REPAIR_COST_PER_POINT + ' gold';
      });
    }
    if (sailsBtn) {
      sailsBtn.addEventListener('click', function () {
        var pts = Math.max(0, parseInt((sailsQty && sailsQty.value) || '0', 10));
        _doRepairSails(pts);
      });
    }

    // Crew hire — live cost update
    var crewQty = document.getElementById('port-crew-qty');
    var crewCost = document.getElementById('port-crew-cost');
    var crewBtn = document.getElementById('port-crew-btn');
    if (crewQty) {
      crewQty.addEventListener('input', function () {
        var n = Math.max(0, parseInt(crewQty.value, 10) || 0);
        if (crewCost) crewCost.textContent = n * CREW_HIRE_COST + ' gold';
      });
    }
    if (crewBtn) {
      crewBtn.addEventListener('click', function () {
        var n = Math.max(0, parseInt((crewQty && crewQty.value) || '0', 10));
        _doHireCrew(n);
      });
    }

    // Supply buttons + live cost updates
    Object.keys(SUPPLY_PRICES).forEach(function (key) {
      var info = SUPPLY_PRICES[key];
      var qtyEl = document.getElementById('port-supply-qty-' + key);
      var costEl = document.getElementById('port-supply-cost-' + key);
      var buyBtn = document.getElementById('port-supply-btn-' + key);

      if (qtyEl) {
        qtyEl.addEventListener('input', function () {
          var n = Math.max(0, parseInt(qtyEl.value, 10) || 0);
          if (costEl) costEl.textContent = n * info.cost + ' gold';
        });
      }
      if (buyBtn) {
        buyBtn.addEventListener('click', function () {
          var n = Math.max(0, parseInt((qtyEl && qtyEl.value) || '0', 10));
          _doBuySupply(key, n);
        });
      }
    });
  }

  // ── Actions ──────────────────────────────────────────────────

  function _doRest() {
    if (_busy) return;
    _busy = true;
    _clearError();

    var inc = firebase.firestore.FieldValue.increment;

    Promise.all([
      T.firestore.updateFlagship(_gameId, _flagshipId, { apRemaining: _apMax }),
      T.firestore.updateGame(_gameId, { turnNumber: inc(1) }),
    ])
      .then(function () {
        _busy = false;
        _close();
      })
      .catch(function (err) {
        console.error('[port-visit] rest failed', err);
        _busy = false;
        _showError('Rest failed. Please try again.');
      });
  }

  function _doRepairHull(pts) {
    if (_busy) return;
    if (pts <= 0) return;

    var hull = (_flagshipDoc && _flagshipDoc.hull) || { current: 0, max: 0 };
    var gold = _gold();
    var cost = pts * REPAIR_COST_PER_POINT;

    if (hull.current + pts > hull.max) {
      _showError('Cannot repair beyond max hull (' + hull.max + ').');
      return;
    }
    if (cost > gold) {
      _showError('Not enough gold. Need ' + cost + ', have ' + gold + '.');
      return;
    }

    _busy = true;
    _clearError();

    var prevHull = hull.current;
    var prevGold = gold;
    _flagshipDoc.hull = Object.assign({}, hull, { current: hull.current + pts });
    _gameDoc.captain = Object.assign({}, _gameDoc.captain, { gold: gold - cost });
    _render();

    var inc = firebase.firestore.FieldValue.increment;
    Promise.all([
      T.firestore.updateFlagship(_gameId, _flagshipId, { 'hull.current': inc(pts) }),
      T.firestore.updateGame(_gameId, { 'captain.gold': inc(-cost) }),
    ])
      .then(function () {
        _busy = false;
      })
      .catch(function (err) {
        console.error('[port-visit] repair hull failed', err);
        _flagshipDoc.hull = Object.assign({}, _flagshipDoc.hull, { current: prevHull });
        _gameDoc.captain = Object.assign({}, _gameDoc.captain, { gold: prevGold });
        _busy = false;
        _render();
        _showError('Repair failed. Please try again.');
      });
  }

  function _doRepairSails(pts) {
    if (_busy) return;
    if (pts <= 0) return;

    var sails = (_flagshipDoc && _flagshipDoc.sails) || { current: 0, max: 0 };
    var gold = _gold();
    var cost = pts * REPAIR_COST_PER_POINT;

    if (sails.current + pts > sails.max) {
      _showError('Cannot repair beyond max sails (' + sails.max + ').');
      return;
    }
    if (cost > gold) {
      _showError('Not enough gold. Need ' + cost + ', have ' + gold + '.');
      return;
    }

    _busy = true;
    _clearError();

    var prevSails = sails.current;
    var prevGold = gold;
    _flagshipDoc.sails = Object.assign({}, sails, { current: sails.current + pts });
    _gameDoc.captain = Object.assign({}, _gameDoc.captain, { gold: gold - cost });
    _render();

    var inc = firebase.firestore.FieldValue.increment;
    Promise.all([
      T.firestore.updateFlagship(_gameId, _flagshipId, { 'sails.current': inc(pts) }),
      T.firestore.updateGame(_gameId, { 'captain.gold': inc(-cost) }),
    ])
      .then(function () {
        _busy = false;
      })
      .catch(function (err) {
        console.error('[port-visit] repair sails failed', err);
        _flagshipDoc.sails = Object.assign({}, _flagshipDoc.sails, { current: prevSails });
        _gameDoc.captain = Object.assign({}, _gameDoc.captain, { gold: prevGold });
        _busy = false;
        _render();
        _showError('Repair failed. Please try again.');
      });
  }

  function _doHireCrew(count) {
    if (_busy) return;
    if (count <= 0) return;

    var crew = (_flagshipDoc && _flagshipDoc.crew) || { current: 0, min: 0, max: 0 };
    var gold = _gold();
    var cost = count * CREW_HIRE_COST;

    if (crew.current + count > crew.max) {
      _showError('Cannot exceed crew capacity (' + crew.max + ').');
      return;
    }
    if (cost > gold) {
      _showError('Not enough gold. Need ' + cost + ', have ' + gold + '.');
      return;
    }

    _busy = true;
    _clearError();

    var prevCrew = crew.current;
    var prevGold = gold;
    _flagshipDoc.crew = Object.assign({}, crew, { current: crew.current + count });
    _gameDoc.captain = Object.assign({}, _gameDoc.captain, { gold: gold - cost });
    _render();

    var inc = firebase.firestore.FieldValue.increment;
    Promise.all([
      T.firestore.updateFlagship(_gameId, _flagshipId, { 'crew.current': inc(count) }),
      T.firestore.updateGame(_gameId, { 'captain.gold': inc(-cost) }),
    ])
      .then(function () {
        _busy = false;
      })
      .catch(function (err) {
        console.error('[port-visit] hire crew failed', err);
        _flagshipDoc.crew = Object.assign({}, _flagshipDoc.crew, { current: prevCrew });
        _gameDoc.captain = Object.assign({}, _gameDoc.captain, { gold: prevGold });
        _busy = false;
        _render();
        _showError('Hire failed. Please try again.');
      });
  }

  function _doBuySupply(key, qty) {
    if (_busy) return;
    if (qty <= 0) return;

    var info = SUPPLY_PRICES[key];
    if (!info) return;

    var cargo = (_flagshipDoc && _flagshipDoc.cargo) || { used: 0, capacity: 0 };
    var supplies = _supplies();
    var gold = _gold();
    var cost = qty * info.cost;
    var cargoFree = cargo.capacity - cargo.used;

    if (qty > cargoFree) {
      _showError('Not enough cargo space. ' + cargoFree + ' units free.');
      return;
    }
    if (cost > gold) {
      _showError('Not enough gold. Need ' + cost + ', have ' + gold + '.');
      return;
    }

    _busy = true;
    _clearError();

    var prevSupplyQty = supplies[key] || 0;
    var prevCargoUsed = cargo.used;
    var prevGold = gold;

    var newSupplies = Object.assign({}, supplies);
    newSupplies[key] = prevSupplyQty + qty;
    _flagshipDoc.supplies = newSupplies;
    _flagshipDoc.cargo = Object.assign({}, cargo, { used: cargo.used + qty });
    _gameDoc.captain = Object.assign({}, _gameDoc.captain, { gold: gold - cost });
    _render();

    var inc = firebase.firestore.FieldValue.increment;
    var flagshipUpdate = { 'cargo.used': inc(qty) };
    flagshipUpdate['supplies.' + key] = inc(qty);

    Promise.all([
      T.firestore.updateFlagship(_gameId, _flagshipId, flagshipUpdate),
      T.firestore.updateGame(_gameId, { 'captain.gold': inc(-cost) }),
    ])
      .then(function () {
        _busy = false;
      })
      .catch(function (err) {
        console.error('[port-visit] buy supply failed', err);
        var rollbackSupplies = Object.assign({}, _flagshipDoc.supplies);
        rollbackSupplies[key] = prevSupplyQty;
        _flagshipDoc.supplies = rollbackSupplies;
        _flagshipDoc.cargo = Object.assign({}, _flagshipDoc.cargo, { used: prevCargoUsed });
        _gameDoc.captain = Object.assign({}, _gameDoc.captain, { gold: prevGold });
        _busy = false;
        _render();
        _showError('Purchase failed. Please try again.');
      });
  }

  // ── Close ────────────────────────────────────────────────────

  function _close() {
    if (!_overlayEl) return;
    var cb = _onCloseCb;
    if (_overlayEl.parentNode) _overlayEl.parentNode.removeChild(_overlayEl);
    _overlayEl = null;
    _gameId = null;
    _flagshipId = null;
    _gameDoc = null;
    _flagshipDoc = null;
    _settlementName = '';
    _onCloseCb = null;
    _busy = false;
    if (cb) cb();
  }

  // ── Public API ───────────────────────────────────────────────

  T.portVisit = {
    open: function (
      gameId,
      flagshipId,
      gameDoc,
      flagshipDoc,
      settlementId,
      settlementName,
      apMax,
      onClose
    ) {
      if (_overlayEl) _close();

      _gameId = gameId;
      _flagshipId = flagshipId;
      _gameDoc = JSON.parse(JSON.stringify(gameDoc || {}));
      _flagshipDoc = JSON.parse(JSON.stringify(flagshipDoc || {}));
      _settlementName = settlementName || 'Unknown Port';
      _apMax = apMax || 0;
      _onCloseCb = onClose || null;
      _busy = false;

      _overlayEl = document.createElement('div');
      _overlayEl.className = 'port-modal-root';
      document.body.appendChild(_overlayEl);

      _render();

      var portTurn = (gameDoc && gameDoc.turnNumber) || 0;
      T.firestore
        .addLogEntry(gameId, {
          turn: portTurn,
          type: 'port_visit',
          summary: 'Made port at ' + (settlementName || 'Unknown Port'),
          payload: { settlementId: settlementId || null, settlementName: settlementName || '' },
        })
        .catch(function (err) {
          console.error('[port-visit] addLogEntry failed', err);
        });
    },

    close: function () {
      _close();
    },

    updateDocs: function (gameDoc, flagshipDoc) {
      if (!_overlayEl || _busy) return;
      _gameDoc = JSON.parse(JSON.stringify(gameDoc || {}));
      _flagshipDoc = JSON.parse(JSON.stringify(flagshipDoc || {}));
      _render();
    },

    isOpen: function () {
      return _overlayEl !== null;
    },
  };
})();
