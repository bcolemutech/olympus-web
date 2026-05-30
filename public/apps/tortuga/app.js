(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  // ── Module-local state ──────────────────────────────────────

  var _parsedData = null; // intermediate shape from importer.parseAzgaarJson
  var _generatedWorld = null; // last result of T.overlay.applyOverlay
  var _generating = false; // guard against concurrent regenerations
  var _mapInitialised = false; // track first T.mapRenderer.init call
  var _keydownHandler = null; // Ctrl+Z / Ctrl+Y listener

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

      _initEditor();
    }, 0);
  }

  // ── Editor integration ───────────────────────────────────────

  function _mapEditCallbacks() {
    return {
      onSettlementClick: function (id) {
        if (T.editor) T.editor.selectSettlement(id);
      },
      onSettlementDrag: function (id, pos) {
        if (T.editor) T.editor.updateSettlementPos(id, pos);
      },
    };
  }

  function _onWorldEdited(world) {
    _generatedWorld = world;
    T.mapRenderer.setWorld(world);
    T.mapRenderer.setEditMode(world, _mapEditCallbacks());
    var sel = T.editor && T.editor._selectedId;
    if (sel) {
      for (var i = 0; i < world.settlements.length; i++) {
        if (world.settlements[i].id === sel) {
          T.mapRenderer.highlightSettlement(
            world.settlements[i].position || world.settlements[i].pos
          );
          break;
        }
      }
    }
  }

  function _initEditor() {
    var editorEl = document.getElementById('cartographer-editor');
    if (!editorEl) return;
    if (T.editor && T.editor._rendered) T.editor.destroy();
    T.editor.render(editorEl, _generatedWorld, { onChanged: _onWorldEdited });
    editorEl.classList.remove('hidden');
    T.mapRenderer.setEditMode(_generatedWorld, _mapEditCallbacks());

    if (!_keydownHandler) {
      _keydownHandler = function (e) {
        if (!T.editor || !T.editor._rendered) return;
        if (e.ctrlKey || e.metaKey) {
          if (!e.shiftKey && e.key === 'z') {
            e.preventDefault();
            T.editor.undo();
          } else if (e.key === 'y' || (e.shiftKey && e.key === 'z')) {
            e.preventDefault();
            T.editor.redo();
          }
        }
      };
      document.addEventListener('keydown', _keydownHandler);
    }
  }

  // ── Save handler ─────────────────────────────────────────────

  function _onSaveClick() {
    if (!_generatedWorld) return;
    _showSaveDialog();
  }

  function _showSaveDialog() {
    var currentName =
      (document.getElementById('knob-name') || {}).value ||
      (_generatedWorld && _generatedWorld.name) ||
      'Unnamed World';
    var currentEra = (document.getElementById('knob-era') || {}).value || 'caribbean_golden_age';

    var overlay = document.createElement('div');
    overlay.className = 'save-dialog-overlay';
    overlay.id = 'save-dialog-overlay';

    overlay.innerHTML =
      '<div class="save-dialog" role="dialog" aria-modal="true" aria-labelledby="save-dialog-heading">' +
      '<h2 class="save-dialog-title" id="save-dialog-heading">Save World</h2>' +
      '<div class="save-dialog-field">' +
      '<label class="save-dialog-label" for="save-dialog-name">World Name</label>' +
      '<input class="knobs-input" id="save-dialog-name" type="text" value="' +
      _escapeAttr(currentName) +
      '" placeholder="Unnamed World">' +
      '</div>' +
      '<div class="save-dialog-field">' +
      '<label class="save-dialog-label" for="save-dialog-description">Description</label>' +
      '<textarea class="knobs-input save-dialog-textarea" id="save-dialog-description"' +
      ' rows="3" placeholder="Describe this world…"></textarea>' +
      '</div>' +
      '<div class="save-dialog-field">' +
      '<label class="save-dialog-label" for="save-dialog-era">Era</label>' +
      '<select class="knobs-select" id="save-dialog-era">' +
      '<option value="caribbean_golden_age"' +
      (currentEra === 'caribbean_golden_age' ? ' selected' : '') +
      '>Caribbean Golden Age</option>' +
      '<option value="mediterranean_corsair"' +
      (currentEra === 'mediterranean_corsair' ? ' selected' : '') +
      '>Mediterranean Corsair</option>' +
      '<option value="indian_ocean"' +
      (currentEra === 'indian_ocean' ? ' selected' : '') +
      '>Indian Ocean</option>' +
      '<option value="freeform"' +
      (currentEra === 'freeform' ? ' selected' : '') +
      '>Freeform</option>' +
      '</select>' +
      '</div>' +
      '<div class="save-dialog-field">' +
      '<div class="save-dialog-shared-row">' +
      '<input class="knobs-checkbox" id="save-dialog-shared" type="checkbox" checked>' +
      '<label class="knobs-checkbox-label" for="save-dialog-shared">' +
      'Share — other players can use this world for campaigns' +
      '</label>' +
      '</div>' +
      '</div>' +
      '<p class="save-dialog-error hidden" id="save-dialog-error"></p>' +
      '<div class="save-dialog-actions">' +
      '<button class="btn-cancel" id="save-dialog-cancel" type="button">Cancel</button>' +
      '<button class="app-btn app-btn--sm" id="save-dialog-confirm" type="button">Save</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _closeSaveDialog();
    });

    overlay.querySelector('#save-dialog-cancel').addEventListener('click', _closeSaveDialog);

    overlay.querySelector('#save-dialog-confirm').addEventListener('click', function () {
      var name = overlay.querySelector('#save-dialog-name').value.trim() || 'Unnamed World';
      var description = overlay.querySelector('#save-dialog-description').value.trim();
      var era = overlay.querySelector('#save-dialog-era').value;
      var shared = overlay.querySelector('#save-dialog-shared').checked;
      _doSave(name, description, era, shared, overlay);
    });
  }

  function _closeSaveDialog() {
    var overlay = document.getElementById('save-dialog-overlay');
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function _doSave(name, description, era, shared, dialogEl) {
    var confirmBtn = dialogEl.querySelector('#save-dialog-confirm');
    var cancelBtn = dialogEl.querySelector('#save-dialog-cancel');
    var errorEl = dialogEl.querySelector('#save-dialog-error');

    if (confirmBtn) confirmBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (errorEl) errorEl.classList.add('hidden');

    var payload = _buildWorldPayload(name, description, era, shared);

    T.firestore
      .createWorld(payload)
      .then(function () {
        _closeSaveDialog();
        var statusEl = document.getElementById('knobs-save-status');
        if (statusEl) {
          statusEl.textContent = 'World saved!';
          statusEl.className = 'save-status save-status--success';
        }
      })
      .catch(function (err) {
        if (confirmBtn) confirmBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (errorEl) {
          errorEl.textContent = 'Save failed: ' + err.message;
          errorEl.classList.remove('hidden');
        }
      });
  }

  // §9 size caveat: Firestore docs are capped at 1 MB.
  // For typical Azgaar maps (1000×600, ~50 coastline polygons, ~200 pts each),
  // coastlines are ~50 KB; full payload is usually well under 200 KB.
  // If Phase 2 maps grow larger, move coastlines to a subcollection.
  //
  // Firestore forbids nested arrays (array-in-array). All [y, x] coordinate
  // pairs are stored as {y, x} objects. Coastlines (array of rings) are stored
  // as [{pts: [{y,x},...]}]. Decode with _decodeWorldPayload when loading.
  function _ptsToObjs(ring) {
    return (ring || []).map(function (pt) {
      return { y: pt[0], x: pt[1] };
    });
  }

  function _buildWorldPayload(name, description, era, shared) {
    var w = _generatedWorld;
    var b = w.bounds || [];
    return {
      name: name,
      description: description || '',
      era: era,
      shared: !!shared,
      sourceFormat: w.sourceFormat || 'azgaar-json',
      dimensions: w.dimensions || {},
      bounds: {
        minY: (b[0] && b[0][0]) || 0,
        minX: (b[0] && b[0][1]) || 0,
        maxY: (b[1] && b[1][0]) || 0,
        maxX: (b[1] && b[1][1]) || 0,
      },
      coastlines: (w.coastlines || []).map(function (ring) {
        return { pts: _ptsToObjs(ring) };
      }),
      settlements: (w.settlements || []).map(function (s) {
        var pos = s.position || s.pos;
        return {
          id: s.id,
          name: s.name,
          type: s.type || null,
          position: pos ? { y: pos[0], x: pos[1] } : null,
          parentFaction: s.parentFaction || s.faction || null,
          baseSize: s.baseSize || null,
          hidden: !!s.hidden,
        };
      }),
      hazards: (w.hazards || []).map(function (h) {
        return {
          id: h.id,
          type: h.type,
          polygon: _ptsToObjs(h.polygon),
          severity: h.severity || null,
          name: h.name || null,
        };
      }),
      factions: (w.factions || []).map(function (f) {
        return {
          id: f.id,
          name: f.name,
          archetype: f.archetype || null,
          color: f.color || null,
          homeSettlementId: f.homeSettlementId || null,
        };
      }),
      tradeRoutes: (w.tradeRoutes || []).map(function (r) {
        return { id: r.id, fromId: r.fromId, toId: r.toId, faction: r.faction || null };
      }),
      windCurrentZones: (w.windCurrentZones || []).map(function (wz) {
        return {
          id: wz.id,
          name: wz.name || null,
          direction: wz.direction || null,
          strength: wz.strength || null,
          bounds: _ptsToObjs(wz.bounds),
        };
      }),
      factionTerritory: (w.factionTerritory || []).map(function (ft) {
        return {
          id: ft.id,
          name: ft.name || null,
          faction: ft.faction || null,
          color: ft.color || null,
          polygon: _ptsToObjs(ft.polygon),
        };
      }),
    };
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
            if (T.editor && T.editor._rendered) T.editor.destroy();

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
