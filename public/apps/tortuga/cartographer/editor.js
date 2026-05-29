(function () {
  'use strict';

  /*
   * Tortuga Cartographer world editor — issue #194.
   *
   * Renders three panels below the map preview:
   *   Inspector  — per-settlement name / type / faction editor (shown on click)
   *   Factions   — rename + recolor each faction
   *   Hazards    — add reef / kraken zone, remove any non-lake hazard
   *
   * All mutations follow the same pattern:
   *   1. Push snapshot to undo stack
   *   2. Mutate _world in place
   *   3. Call _callbacks.onChanged(_world)
   *
   * Undo/redo max depth: 20.
   *
   * app.js drives the map interactions via setEditMode/highlightSettlement
   * callbacks; this module only concerns itself with the panel UI.
   */

  var MAX_HISTORY = 20;

  var SETTLEMENT_TYPE_LABELS = {
    colonial_port: 'Colonial Port',
    free_port: 'Free Port',
    fort: 'Fort',
    hidden_cove: 'Hidden Cove',
    native_village: 'Native Village',
    ruins: 'Ruins',
  };

  var SETTLEMENT_TYPES = Object.keys(SETTLEMENT_TYPE_LABELS);

  var PLACEABLE_HAZARD_TYPES = ['reef', 'kraken_zone'];

  var HAZARD_TYPE_LABELS = {
    reef: 'Reef',
    storm_band: 'Storm Band',
    kraken_zone: 'Kraken Zone',
    lake: 'Lake',
  };

  // ── Internal state ──────────────────────────────────────────

  var _world = null;
  var _callbacks = {};
  var _selectedId = null;
  var _history = [];
  var _historyPos = -1;
  var _addingHazardType = null;
  var _containerEl = null;
  var _rendered = false;

  // ── History ─────────────────────────────────────────────────

  function _snapshot() {
    return {
      settlements: _world.settlements.map(function (s) {
        return Object.assign({}, s);
      }),
      factions: _world.factions
        ? _world.factions.map(function (f) {
            return Object.assign({}, f);
          })
        : [],
      hazards: _world.hazards.map(function (h) {
        return Object.assign({}, h);
      }),
    };
  }

  function _pushHistory() {
    // Drop any forward history beyond current position
    _history = _history.slice(0, _historyPos + 1);
    _history.push(_snapshot());
    if (_history.length > MAX_HISTORY) _history.shift();
    _historyPos = _history.length - 1;
    _updateUndoRedoBtns();
  }

  function _restoreSnapshot(snap) {
    _world.settlements = snap.settlements.map(function (s) {
      return Object.assign({}, s);
    });
    _world.factions = snap.factions.map(function (f) {
      return Object.assign({}, f);
    });
    _world.hazards = snap.hazards.map(function (h) {
      return Object.assign({}, h);
    });
  }

  function _updateUndoRedoBtns() {
    var undoBtn = _containerEl && _containerEl.querySelector('#editor-undo-btn');
    var redoBtn = _containerEl && _containerEl.querySelector('#editor-redo-btn');
    if (undoBtn) undoBtn.disabled = _historyPos <= 0;
    if (redoBtn) redoBtn.disabled = _historyPos >= _history.length - 1;
  }

  // ── Mutation helpers ────────────────────────────────────────

  function _mutate(fn) {
    _pushHistory();
    fn();
    if (_callbacks.onChanged) _callbacks.onChanged(_world);
    _renderInspector();
    _renderFactions();
    _renderHazardList();
  }

  // ── Inspector panel ─────────────────────────────────────────

  function _renderInspector() {
    var panel = _containerEl && _containerEl.querySelector('#editor-inspector');
    if (!panel) return;
    var s = null;
    if (_selectedId && _world) {
      for (var i = 0; i < _world.settlements.length; i++) {
        if (_world.settlements[i].id === _selectedId) {
          s = _world.settlements[i];
          break;
        }
      }
    }

    if (!s) {
      panel.innerHTML = '<p class="inspector-empty">Click a settlement on the map to edit it.</p>';
      return;
    }

    var factionOptions = '<option value="">— None —</option>';
    (_world.factions || []).forEach(function (f) {
      factionOptions +=
        '<option value="' +
        _escAttr(f.id) +
        '"' +
        (s.parentFaction === f.id ? ' selected' : '') +
        '>' +
        _escText(f.name) +
        '</option>';
    });

    var typeOptions = SETTLEMENT_TYPES.map(function (t) {
      return (
        '<option value="' +
        t +
        '"' +
        (s.type === t ? ' selected' : '') +
        '>' +
        SETTLEMENT_TYPE_LABELS[t] +
        '</option>'
      );
    }).join('');

    var pos = s.position || s.pos || [0, 0];

    panel.innerHTML =
      '<div class="inspector-header">' +
      '<span class="inspector-title">' +
      _escText(s.name) +
      '</span>' +
      '<button class="inspector-deselect" id="inspector-deselect" type="button" ' +
      'aria-label="Deselect">&times;</button>' +
      '</div>' +
      '<div class="knobs-field">' +
      '<label class="knobs-label" for="inspector-name">Name</label>' +
      '<input class="knobs-input" id="inspector-name" type="text" value="' +
      _escAttr(s.name) +
      '">' +
      '</div>' +
      '<div class="knobs-field">' +
      '<label class="knobs-label" for="inspector-type">Type</label>' +
      '<select class="knobs-select" id="inspector-type">' +
      typeOptions +
      '</select>' +
      '</div>' +
      '<div class="knobs-field">' +
      '<label class="knobs-label" for="inspector-faction">Faction</label>' +
      '<select class="knobs-select" id="inspector-faction">' +
      factionOptions +
      '</select>' +
      '</div>' +
      '<p class="inspector-pos" id="inspector-pos">' +
      _formatPos(pos) +
      '</p>';

    var nameInput = panel.querySelector('#inspector-name');
    var typeSelect = panel.querySelector('#inspector-type');
    var factionSelect = panel.querySelector('#inspector-faction');
    var deselectBtn = panel.querySelector('#inspector-deselect');

    nameInput.addEventListener('change', function () {
      var val = nameInput.value.trim() || s.name;
      _mutate(function () {
        s.name = val;
      });
    });

    typeSelect.addEventListener('change', function () {
      _mutate(function () {
        s.type = typeSelect.value;
      });
    });

    factionSelect.addEventListener('change', function () {
      _mutate(function () {
        s.parentFaction = factionSelect.value || null;
      });
    });

    deselectBtn.addEventListener('click', function () {
      _selectedId = null;
      if (window.Tortuga && window.Tortuga.mapRenderer) {
        window.Tortuga.mapRenderer.clearHighlight();
      }
      _renderInspector();
    });
  }

  // ── Factions panel ──────────────────────────────────────────

  function _renderFactions() {
    var panel = _containerEl && _containerEl.querySelector('#editor-factions');
    if (!panel) return;
    var factions = (_world && _world.factions) || [];
    if (factions.length === 0) {
      panel.innerHTML = '<p class="inspector-empty">No factions.</p>';
      return;
    }

    var rows = factions
      .map(function (f, idx) {
        return (
          '<div class="faction-list-row" data-faction-idx="' +
          idx +
          '">' +
          '<input type="color" class="faction-color-input" ' +
          'id="faction-color-' +
          idx +
          '" value="' +
          _escAttr(f.color || '#888888') +
          '" title="Faction color">' +
          '<input class="knobs-input faction-name-input" ' +
          'id="faction-name-' +
          idx +
          '" type="text" value="' +
          _escAttr(f.name) +
          '">' +
          '<span class="faction-archetype-chip">' +
          _escText(f.archetype || '') +
          '</span>' +
          '</div>'
        );
      })
      .join('');

    panel.innerHTML = rows;

    factions.forEach(function (f, idx) {
      var nameInput = panel.querySelector('#faction-name-' + idx);
      var colorInput = panel.querySelector('#faction-color-' + idx);

      nameInput.addEventListener('change', function () {
        var val = nameInput.value.trim() || f.name;
        _mutate(function () {
          f.name = val;
        });
      });

      colorInput.addEventListener('input', function () {
        _mutate(function () {
          f.color = colorInput.value;
        });
      });
    });
  }

  // ── Hazards panel ───────────────────────────────────────────

  function _renderHazardList() {
    var listEl = _containerEl && _containerEl.querySelector('#editor-hazard-list');
    if (!listEl) return;
    var hazards = (_world && _world.hazards) || [];
    var editable = hazards.filter(function (h) {
      return h.type !== 'lake';
    });
    if (editable.length === 0) {
      listEl.innerHTML = '<p class="inspector-empty">No hazards yet.</p>';
      return;
    }

    listEl.innerHTML = editable
      .map(function (h) {
        return (
          '<div class="hazard-list-row" data-hazard-id="' +
          _escAttr(h.id) +
          '">' +
          '<span class="hazard-list-name">' +
          _escText(HAZARD_TYPE_LABELS[h.type] || h.type) +
          (h.name ? ' — ' + _escText(h.name) : '') +
          '</span>' +
          '<button class="hazard-delete-btn" type="button" ' +
          'data-hazard-id="' +
          _escAttr(h.id) +
          '" aria-label="Remove hazard">&times;</button>' +
          '</div>'
        );
      })
      .join('');

    listEl.querySelectorAll('.hazard-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-hazard-id');
        _mutate(function () {
          _world.hazards = _world.hazards.filter(function (h) {
            return h.id !== id;
          });
        });
      });
    });
  }

  function _setAddHazardMode(type) {
    _addingHazardType = type;
    var addBtn = _containerEl && _containerEl.querySelector('#editor-add-hazard-btn');
    var mapEl = document.getElementById('map-world');

    if (!type) {
      if (addBtn) {
        addBtn.textContent = 'Add Hazard';
        addBtn.classList.remove('app-btn--active');
      }
      if (mapEl) mapEl.classList.remove('tortuga-map--crosshair');
      if (window.Tortuga && window.Tortuga.mapRenderer) {
        window.Tortuga.mapRenderer.cancelMapClick();
      }
      return;
    }

    if (addBtn) {
      addBtn.textContent = 'Cancel Add';
      addBtn.classList.add('app-btn--active');
    }
    if (mapEl) mapEl.classList.add('tortuga-map--crosshair');

    if (window.Tortuga && window.Tortuga.mapRenderer) {
      window.Tortuga.mapRenderer.awaitMapClick(function (pos) {
        _addingHazardType = null;
        if (addBtn) {
          addBtn.textContent = 'Add Hazard';
          addBtn.classList.remove('app-btn--active');
        }
        if (mapEl) mapEl.classList.remove('tortuga-map--crosshair');
        _placeHazard(type, pos);
      });
    }
  }

  // ── Public API ───────────────────────────────────────────────

  function render(containerEl, world, callbacks) {
    destroy();
    _containerEl = containerEl;
    _world = world;
    _callbacks = callbacks || {};
    _selectedId = null;
    _history = [];
    _historyPos = -1;
    _addingHazardType = null;
    _rendered = true;

    // Push initial snapshot so undo is disabled at start
    _history.push(_snapshot());
    _historyPos = 0;

    containerEl.innerHTML =
      '<div class="editor-undo-row">' +
      '<button class="editor-undo-btn" id="editor-undo-btn" type="button" disabled>&#8592; Undo</button>' +
      '<button class="editor-undo-btn" id="editor-redo-btn" type="button" disabled>Redo &#8594;</button>' +
      '</div>' +
      '<div class="editor-panels">' +
      '<div class="inspector-panel knobs-panel">' +
      '<h2 class="knobs-panel-title">Settlement</h2>' +
      '<div id="editor-inspector"></div>' +
      '</div>' +
      '<div class="faction-panel knobs-panel">' +
      '<h2 class="knobs-panel-title">Factions</h2>' +
      '<div id="editor-factions"></div>' +
      '</div>' +
      '</div>' +
      '<div class="hazard-panel knobs-panel">' +
      '<h2 class="knobs-panel-title">Hazards</h2>' +
      '<div class="hazard-tools-row">' +
      '<div class="hazard-type-radios">' +
      PLACEABLE_HAZARD_TYPES.map(function (t) {
        return (
          '<label class="hazard-type-radio-label">' +
          '<input type="radio" name="hazard-type" value="' +
          t +
          '"' +
          (t === 'reef' ? ' checked' : '') +
          '> ' +
          (HAZARD_TYPE_LABELS[t] || t) +
          '</label>'
        );
      }).join('') +
      '</div>' +
      '<button class="app-btn app-btn--sm" id="editor-add-hazard-btn" type="button">Add Hazard</button>' +
      '</div>' +
      '<div id="editor-hazard-list"></div>' +
      '</div>';

    _renderInspector();
    _renderFactions();
    _renderHazardList();
    _updateUndoRedoBtns();

    containerEl.querySelector('#editor-undo-btn').addEventListener('click', undo);
    containerEl.querySelector('#editor-redo-btn').addEventListener('click', redo);
    containerEl.querySelector('#editor-add-hazard-btn').addEventListener('click', function () {
      if (_addingHazardType) {
        _setAddHazardMode(null);
      } else {
        var typeRadio = containerEl.querySelector('input[name="hazard-type"]:checked');
        _setAddHazardMode(typeRadio ? typeRadio.value : 'reef');
      }
    });
  }

  function destroy() {
    if (!_rendered) return;
    _setAddHazardMode(null);
    _rendered = false;
    _world = null;
    _selectedId = null;
    _history = [];
    _historyPos = -1;
    _callbacks = {};
    if (_containerEl) {
      _containerEl.innerHTML = '';
      _containerEl.classList.add('hidden');
    }
    _containerEl = null;
  }

  function selectSettlement(id) {
    _selectedId = id;
    var s = null;
    if (_world) {
      for (var i = 0; i < _world.settlements.length; i++) {
        if (_world.settlements[i].id === id) {
          s = _world.settlements[i];
          break;
        }
      }
    }
    if (s && window.Tortuga && window.Tortuga.mapRenderer) {
      window.Tortuga.mapRenderer.highlightSettlement(s.position || s.pos);
    }
    _renderInspector();
  }

  function updateSettlementPos(id, pos) {
    if (!_world) return;
    var s = null;
    for (var i = 0; i < _world.settlements.length; i++) {
      if (_world.settlements[i].id === id) {
        s = _world.settlements[i];
        break;
      }
    }
    if (!s) return;
    _mutate(function () {
      s.position = pos;
    });
    // Update position display if this settlement is currently inspected
    if (_selectedId === id) {
      var posEl = _containerEl && _containerEl.querySelector('#inspector-pos');
      if (posEl) posEl.textContent = _formatPos(pos);
    }
    // Update highlight ring to new position
    if (window.Tortuga && window.Tortuga.mapRenderer) {
      window.Tortuga.mapRenderer.highlightSettlement(pos);
    }
  }

  function placeHazardAt(pos) {
    _placeHazard(_addingHazardType, pos);
  }

  function undo() {
    if (_historyPos <= 0) return;
    _historyPos--;
    _restoreSnapshot(_history[_historyPos]);
    _selectedId = null;
    if (_callbacks.onChanged) _callbacks.onChanged(_world);
    _renderInspector();
    _renderFactions();
    _renderHazardList();
    _updateUndoRedoBtns();
  }

  function redo() {
    if (_historyPos >= _history.length - 1) return;
    _historyPos++;
    _restoreSnapshot(_history[_historyPos]);
    _selectedId = null;
    if (_callbacks.onChanged) _callbacks.onChanged(_world);
    _renderInspector();
    _renderFactions();
    _renderHazardList();
    _updateUndoRedoBtns();
  }

  // ── Private helpers ──────────────────────────────────────────

  function _placeHazard(type, pos) {
    if (!type || !pos || !_world) return;
    var bounds = _world.bounds || [
      [0, 0],
      [800, 800],
    ];
    var mapH = bounds[1][0] - bounds[0][0];
    var overlay = window.Tortuga && window.Tortuga.overlay;
    var radius = type === 'kraken_zone' ? mapH * 0.055 : mapH * 0.018;
    var sides = type === 'kraken_zone' ? 14 : 7;
    var seed = type + '_placed_' + Date.now();
    var polygon = overlay
      ? overlay.jaggedBlob(pos[0], pos[1], radius, sides, seed)
      : _simpleCircle(pos[0], pos[1], radius, sides);
    var id = type + '_placed_' + Date.now();
    var severity = type === 'kraken_zone' ? 'high' : 'medium';
    _mutate(function () {
      _world.hazards.push({ id: id, type: type, polygon: polygon, severity: severity });
    });
  }

  // Fallback polygon if overlay isn't loaded.
  function _simpleCircle(cy, cx, r, sides) {
    var pts = [];
    for (var i = 0; i < sides; i++) {
      var a = (i / sides) * Math.PI * 2;
      pts.push([cy + Math.sin(a) * r, cx + Math.cos(a) * r]);
    }
    return pts;
  }

  function _escAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
  }

  function _escText(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function _formatPos(pos) {
    if (!pos) return '';
    return '[' + Math.round(pos[0]) + ', ' + Math.round(pos[1]) + ']';
  }

  // ── Export ───────────────────────────────────────────────────

  var api = {
    render: render,
    destroy: destroy,
    selectSettlement: selectSettlement,
    updateSettlementPos: updateSettlementPos,
    placeHazardAt: placeHazardAt,
    undo: undo,
    redo: redo,
    get _selectedId() {
      return _selectedId;
    },
    get _rendered() {
      return _rendered;
    },
  };

  if (typeof window !== 'undefined') {
    window.Tortuga = window.Tortuga || {};
    window.Tortuga.editor = api;
  }

  // eslint-disable-next-line no-undef
  if (typeof module !== 'undefined' && module.exports) {
    // eslint-disable-next-line no-undef
    module.exports = api;
  }
})();
