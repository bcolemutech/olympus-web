(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  // ── Module-local state ──────────────────────────────────────

  var _parsedData = null; // intermediate shape from importer.parseAzgaarJson
  var _generatedWorld = null; // last result of T.overlay.applyOverlay
  var _generating = false; // guard against concurrent regenerations
  var _mapInitialised = false; // track first T.mapRenderer.init call

  // ── Mode routing ────────────────────────────────────────────

  function getMode() {
    var params = new URLSearchParams(window.location.search);
    var m = params.get('mode');
    return m === T.MODES.PLAY ? T.MODES.PLAY : T.MODES.WORLD;
  }

  T.showMode = function (mode) {
    var shells = [T.MODES.WORLD, T.MODES.PLAY];
    shells.forEach(function (m) {
      var el = document.getElementById('shell-' + m);
      if (el) el.classList.toggle('hidden', m !== mode);
    });
    T.state.currentMode = mode;
  };

  T._openWorldEditor = function (_worldId, _worldData) {
    // TODO (T-110): load worldData from Firestore and render it.
    var mapEl = document.getElementById('map-world');
    if (mapEl) {
      mapEl.classList.remove('hidden');
      T.mapRenderer.init(mapEl, T.mapRenderer.PLACEHOLDER_WORLD);
    }
  };

  T._startNewGame = function () {
    var mapEl = document.getElementById('map-play');
    if (mapEl) {
      mapEl.classList.remove('hidden');
      T.mapRenderer.init(mapEl, T.mapRenderer.PLACEHOLDER_WORLD);
    }
  };

  // ── Knobs helpers ────────────────────────────────────────────

  function _escapeAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
  }

  function _showKnobs(defaultName) {
    var el = document.getElementById('cartographer-knobs');
    if (!el) return;

    el.innerHTML =
      '<div class="knobs-panel">' +
      '<h2 class="knobs-panel-title">Configure World</h2>' +
      '<div class="knobs-field world-name-field">' +
      '<label class="knobs-label" for="knob-name">World Name</label>' +
      '<input class="knobs-input world-name-input" id="knob-name" type="text"' +
      ' value="' +
      _escapeAttr(defaultName) +
      '" placeholder="Unnamed World">' +
      '</div>' +
      '<div class="knobs-grid">' +
      '<div class="knobs-field">' +
      '<label class="knobs-label" for="knob-era">Era Preset</label>' +
      '<select class="knobs-select" id="knob-era">' +
      '<option value="caribbean_golden_age" selected>Caribbean Golden Age</option>' +
      '<option value="mediterranean_corsair">Mediterranean Corsair</option>' +
      '<option value="indian_ocean">Indian Ocean</option>' +
      '<option value="freeform">Freeform</option>' +
      '</select>' +
      '</div>' +
      '<div class="knobs-field">' +
      '<label class="knobs-label" for="knob-factions">Faction Count</label>' +
      '<select class="knobs-select" id="knob-factions">' +
      '<option value="2">2</option>' +
      '<option value="3">3</option>' +
      '<option value="4">4</option>' +
      '<option value="5">5</option>' +
      '<option value="6">6</option>' +
      '<option value="7">7</option>' +
      '<option value="8" selected>8</option>' +
      '</select>' +
      '</div>' +
      '<div class="knobs-field">' +
      '<label class="knobs-label" for="knob-settlement-density">Settlement Density</label>' +
      '<select class="knobs-select" id="knob-settlement-density">' +
      '<option value="sparse">Sparse</option>' +
      '<option value="standard" selected>Standard</option>' +
      '<option value="dense">Dense</option>' +
      '</select>' +
      '</div>' +
      '<div class="knobs-field">' +
      '<label class="knobs-label" for="knob-hazard-density">Hazard Density</label>' +
      '<select class="knobs-select" id="knob-hazard-density">' +
      '<option value="sparse">Sparse</option>' +
      '<option value="standard" selected>Standard</option>' +
      '<option value="dense">Dense</option>' +
      '</select>' +
      '</div>' +
      '<div class="knobs-field">' +
      '<label class="knobs-label" id="knob-mythic-label">Mythic Creatures</label>' +
      '<div class="knobs-checkbox-row">' +
      '<input class="knobs-checkbox" id="knob-mythic" type="checkbox" checked' +
      ' aria-labelledby="knob-mythic-label">' +
      '<label class="knobs-checkbox-label" for="knob-mythic">Enable krakens &amp; sea monsters</label>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="knobs-save-row">' +
      '<button class="app-btn app-btn--sm" id="knobs-save-btn" type="button" disabled>' +
      'Save World' +
      '</button>' +
      '<span class="save-status" id="knobs-save-status"></span>' +
      '</div>' +
      '</div>';

    el.classList.remove('hidden');

    var knobIds = [
      'knob-era',
      'knob-factions',
      'knob-settlement-density',
      'knob-hazard-density',
      'knob-mythic',
    ];
    knobIds.forEach(function (id) {
      var ctrl = document.getElementById(id);
      if (ctrl) ctrl.addEventListener('change', _generateAndPreview);
    });
  }

  function _readKnobs() {
    var era = (document.getElementById('knob-era') || {}).value || 'caribbean_golden_age';
    var factionCount = parseInt((document.getElementById('knob-factions') || {}).value, 10) || 8;
    var settlementDensity =
      (document.getElementById('knob-settlement-density') || {}).value || 'standard';
    var hazardDensity = (document.getElementById('knob-hazard-density') || {}).value || 'standard';
    var mythicEl = document.getElementById('knob-mythic');
    var mythic = mythicEl ? mythicEl.checked : true;
    return {
      era: era,
      factionCount: factionCount,
      settlementDensity: settlementDensity,
      hazardDensity: hazardDensity,
      mythic: mythic,
    };
  }

  // ── Generation ───────────────────────────────────────────────

  function _generateAndPreview() {
    if (!_parsedData || _generating) return;
    _generating = true;

    var saveBtn = document.getElementById('knobs-save-btn');
    var statusEl = document.getElementById('knobs-save-status');

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Generating…';
    }
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.className = 'save-status';
    }

    var opts = _readKnobs();

    // Yield to the browser so the "Generating…" state paints before the
    // synchronous applyOverlay call blocks the thread.
    setTimeout(function () {
      try {
        _generatedWorld = T.overlay.applyOverlay(_parsedData, opts);
      } catch (err) {
        _generating = false;
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Save World';
        }
        if (statusEl) {
          statusEl.textContent = 'Generation error: ' + err.message;
          statusEl.className = 'save-status save-status--error';
        }
        return;
      }

      _generating = false;

      var mapEl = document.getElementById('map-world');
      if (mapEl) {
        mapEl.classList.remove('hidden');
        if (!_mapInitialised) {
          T.mapRenderer.init(mapEl, _generatedWorld);
          _mapInitialised = true;
        } else {
          T.mapRenderer.setWorld(_generatedWorld);
        }
      }

      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save World';
      }
    }, 0);
  }

  // ── Save handler ─────────────────────────────────────────────

  function _onSaveClick() {
    if (!_generatedWorld) return;

    var saveBtn = document.getElementById('knobs-save-btn');
    var statusEl = document.getElementById('knobs-save-status');
    var nameInput = document.getElementById('knob-name');
    var eraEl = document.getElementById('knob-era');
    var worldName = (nameInput && nameInput.value.trim()) || 'Unnamed World';

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
    }
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.className = 'save-status';
    }

    var payload = Object.assign({}, _generatedWorld, {
      name: worldName,
      era: (eraEl && eraEl.value) || 'caribbean_golden_age',
      shared: false,
    });

    T.firestore
      .createWorld(payload)
      .then(function () {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save World';
        }
        if (statusEl) {
          statusEl.textContent = 'World saved!';
          statusEl.className = 'save-status save-status--success';
        }
      })
      .catch(function (err) {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save World';
        }
        if (statusEl) {
          statusEl.textContent = 'Save failed: ' + err.message;
          statusEl.className = 'save-status save-status--error';
        }
      });
  }

  // ── Init ─────────────────────────────────────────────────────

  T.init = function (user) {
    T.state.currentUser = user;
    T.state.db = firebase.firestore();
    var mode = getMode();
    T.showMode(mode);

    if (mode === T.MODES.WORLD) {
      var importEl = document.getElementById('cartographer-import');
      if (importEl) {
        T.importer.render(importEl, {
          onParsed: function (parsed) {
            _parsedData = parsed;
            _generatedWorld = null;
            _mapInitialised = false;

            var warningEl = document.getElementById('land-heavy-warning');
            if (parsed.landPercentage > T.LAND_HEAVY_THRESHOLD && warningEl) {
              warningEl.classList.remove('hidden');
              document.getElementById('land-heavy-continue').onclick = function () {
                warningEl.classList.add('hidden');
                _showKnobs(parsed.info.name);
                _generateAndPreview();
              };
              document.getElementById('land-heavy-cancel').onclick = function () {
                warningEl.classList.add('hidden');
                _parsedData = null;
              };
            } else {
              _showKnobs(parsed.info.name);
              _generateAndPreview();
            }
          },
        });
      }

      // Delegated save handler — #knobs-save-btn is injected dynamically by _showKnobs
      var shellEl = document.getElementById('shell-world');
      if (shellEl) {
        shellEl.addEventListener('click', function (e) {
          if (e.target && e.target.id === 'knobs-save-btn') {
            _onSaveClick();
          }
        });
      }
    }

    var listId = mode === T.MODES.PLAY ? 'world-list-play' : 'world-list-world';
    var listEl = document.getElementById(listId);
    if (listEl) {
      T.worldList.render(listEl, {
        onSelect: function (worldId, worldData) {
          if (mode === T.MODES.PLAY) {
            T._startNewGame(worldId, worldData);
          } else {
            T._openWorldEditor(worldId, worldData);
          }
        },
      });
    }
  };
})();
