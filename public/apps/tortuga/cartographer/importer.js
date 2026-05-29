(function () {
  'use strict';

  /*
   * Azgaar Fantasy Map Generator "Save as JSON" full export.
   *
   * Top-level keys: info, settings, mapCoordinates, pack, grid, biomesData, notes, nameBases.
   * Tortuga's importer only reads what it needs from `info`, `pack`, and `biomesData`.
   *
   * pack.burgs[]    — settlements. burgs[0] is a blank slot, real entries have i > 0.
   * pack.states[]   — political states (faction source). states[0] is "Neutrals", skip it.
   * pack.features[] — land/water masses, each carries vertex indices into pack.vertices[].
   * pack.vertices[] — { i, p:[x,y], v:[...], c:[...] }
   * pack.cells[]    — terrain cells; `.f` points at a feature; `.v` are vertex indices; `.p` is centroid.
   *
   * Coordinates in Azgaar are pixel-space [x, y] (y increases downward).
   * We swap to Leaflet [lat, lng] = [y, x] for L.CRS.Simple. We do NOT flip y;
   * the renderer treats the map as a raster canvas where y-down is fine.
   *
   * Intermediate world-data shape produced by parseAzgaarJson:
   * {
   *   sourceFormat: 'azgaar-json',
   *   info:         { name, seed, version, width, height },
   *   bounds:       [[minY, minX], [maxY, maxX]],
   *   dimensions:   { width, height },
   *   coastlines:   [ [[y, x], ...], ... ],          // one ring per island/continent
   *   lakes:        [ { name, polygon: [[y, x], ...] } ],
   *   biomes:       [ { id, name, color } ],          // catalog only; per-cell lookup via cells[].biome
   *   burgs:        [ { id, name, pos: [y, x], population, stateId, isPort, isCapital, group } ],
   *   stateBorders: [ { id, name, color, fullName, capitalBurgId } ],
   * }
   */

  function _toLeaflet(coord) {
    return [coord[1], coord[0]];
  }

  function _dereferenceVertices(vertexIdxs, vertices) {
    var ring = [];
    for (var i = 0; i < vertexIdxs.length; i++) {
      var v = vertices[vertexIdxs[i]];
      if (v && v.p) ring.push(_toLeaflet(v.p));
    }
    return ring;
  }

  function _isAzgaarJson(json) {
    return (
      json &&
      typeof json === 'object' &&
      json.info &&
      json.pack &&
      Array.isArray(json.pack.burgs) &&
      Array.isArray(json.pack.features) &&
      Array.isArray(json.pack.vertices)
    );
  }

  function parseAzgaarJson(json) {
    if (!_isAzgaarJson(json)) {
      throw new Error(
        'Not an Azgaar JSON export. Use Azgaar\'s "Save → Save as JSON" option (not the partitioned GeoJSON exports).'
      );
    }

    var info = json.info || {};
    var pack = json.pack;
    var biomesData = json.biomesData || {};

    var width = info.width || 0;
    var height = info.height || 0;
    if (!width || !height) {
      throw new Error('Azgaar JSON is missing map dimensions in `info`.');
    }

    var coastlines = [];
    var lakes = [];
    var landCells = 0;
    var oceanCells = 0;
    pack.features.forEach(function (f) {
      if (!f) return;
      if (f.type === 'island') landCells += f.cells || 0;
      else if (f.type === 'ocean') oceanCells += f.cells || 0;
      if (!Array.isArray(f.vertices) || f.vertices.length === 0) return;
      var ring = _dereferenceVertices(f.vertices, pack.vertices);
      if (ring.length < 3) return;
      if (f.type === 'island') {
        coastlines.push(ring);
      } else if (f.type === 'lake') {
        lakes.push({ name: f.name || 'Lake', polygon: ring });
      }
    });
    var landPercentage =
      landCells + oceanCells > 0 ? Math.round((landCells / (landCells + oceanCells)) * 100) : 0;

    var burgs = [];
    pack.burgs.forEach(function (b) {
      if (!b || !b.i) return;
      burgs.push({
        id: 'burg_' + b.i,
        name: b.name || 'Unknown',
        pos: [b.y, b.x],
        population: typeof b.population === 'number' ? b.population : 0,
        stateId: b.state || 0,
        isPort: !!b.port,
        isCapital: !!b.capital,
        group: b.group || null,
        culture: b.culture || 0,
        type: b.type || null,
      });
    });

    if (burgs.length === 0) {
      throw new Error('Azgaar JSON contained no burgs (settlements).');
    }

    var stateBorders = [];
    pack.states.forEach(function (s) {
      if (!s || !s.i) return;
      stateBorders.push({
        id: 'state_' + s.i,
        name: s.name || 'Unknown State',
        fullName: s.fullName || s.name || 'Unknown State',
        color: s.color || '#888888',
        capitalBurgId: s.capital ? 'burg_' + s.capital : null,
      });
    });

    var biomes = [];
    var biomeNames = biomesData.name || [];
    var biomeColors = biomesData.color || [];
    for (var bi = 0; bi < biomeNames.length; bi++) {
      biomes.push({
        id: bi,
        name: biomeNames[bi],
        color: biomeColors[bi] || '#888888',
      });
    }

    var bounds = [
      [0, 0],
      [height, width],
    ];

    return {
      sourceFormat: 'azgaar-json',
      info: {
        name: info.mapName || 'Unnamed Map',
        seed: info.seed || null,
        version: info.version || null,
        width: width,
        height: height,
      },
      bounds: bounds,
      dimensions: { width: width, height: height },
      coastlines: coastlines,
      lakes: lakes,
      biomes: biomes,
      burgs: burgs,
      stateBorders: stateBorders,
      landPercentage: landPercentage,
    };
  }

  // Build the renderer-compatible preview world from the parsed intermediate shape.
  // Overlay generation (T-104–T-107) will replace this with richer data later.
  function _toPreviewWorld(parsed) {
    var stateColorById = {};
    parsed.stateBorders.forEach(function (s) {
      stateColorById[s.id] = s.color;
    });

    return {
      bounds: parsed.bounds,
      coastlines: parsed.coastlines,
      settlements: parsed.burgs.map(function (b) {
        var stateId = 'state_' + b.stateId;
        return {
          id: b.id,
          name: b.name,
          pos: b.pos,
          type: b.isPort ? 'port' : b.isCapital ? 'capital' : 'burg',
          faction: b.stateId ? stateId : null,
          factionColor: stateColorById[stateId] || null,
        };
      }),
      hazards: parsed.lakes.map(function (l, i) {
        return { id: 'lake_' + i, name: l.name, type: 'lake', polygon: l.polygon };
      }),
      tradeRoutes: [],
      factionTerritory: [],
      windCurrentZones: [],
    };
  }

  // ---- Browser UI bindings (skipped in Node test environments) ----

  function _showError(dropZoneEl, errorEl, msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
    dropZoneEl.classList.remove('drop-zone--active');
  }

  function _clearError(errorEl) {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }

  function _processFile(file, containerEl, callbacks) {
    if (!file) return;

    var dropZoneEl = containerEl.querySelector('#cartographer-drop-zone');
    var errorEl = containerEl.querySelector('#cartographer-import-error');

    var lower = file.name.toLowerCase();
    if (!lower.endsWith('.json')) {
      _showError(dropZoneEl, errorEl, 'Please drop an Azgaar .json export.');
      return;
    }

    _clearError(errorEl);
    dropZoneEl.classList.add('drop-zone--loading');

    var reader = new FileReader();
    reader.onload = function (e) {
      var json;
      try {
        json = JSON.parse(e.target.result);
      } catch (parseErr) {
        dropZoneEl.classList.remove('drop-zone--loading');
        var msg = 'File is not valid JSON: ' + parseErr.message;
        _showError(dropZoneEl, errorEl, msg);
        if (callbacks.onError) callbacks.onError(msg);
        return;
      }

      var parsed;
      try {
        parsed = parseAzgaarJson(json);
      } catch (err) {
        dropZoneEl.classList.remove('drop-zone--loading');
        _showError(dropZoneEl, errorEl, err.message);
        if (callbacks.onError) callbacks.onError(err.message);
        return;
      }

      // Replace drop zone with a locked "loaded" state so the user can't
      // accidentally re-upload while the overlay/pathfinder pipeline runs.
      _showLoadedState(containerEl, file.name, callbacks);

      if (callbacks.onParsed) callbacks.onParsed(parsed, _toPreviewWorld(parsed));
    };
    reader.onerror = function () {
      dropZoneEl.classList.remove('drop-zone--loading');
      var msg = 'Could not read file.';
      _showError(dropZoneEl, errorEl, msg);
      if (callbacks.onError) callbacks.onError(msg);
    };
    reader.readAsText(file);
  }

  // Replace the drop zone with a success banner. A "Choose different file" link
  // resets the panel back to the drop zone so a fresh import can be made.
  function _showLoadedState(containerEl, filename, callbacks) {
    var dropZoneEl = containerEl.querySelector('#cartographer-drop-zone');
    if (!dropZoneEl) return;

    dropZoneEl.outerHTML =
      '<div class="drop-zone-loaded" id="cartographer-drop-zone-loaded">' +
      '<span class="drop-zone-loaded-icon" aria-hidden="true">&#10003;</span>' +
      '<span class="drop-zone-loaded-name">' +
      _escText(filename) +
      '</span>' +
      '<button class="drop-zone-reload-btn" id="cartographer-reload-btn" type="button">' +
      'Choose different file' +
      '</button>' +
      '</div>';

    var reloadBtn = containerEl.querySelector('#cartographer-reload-btn');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', function () {
        render(containerEl, callbacks);
      });
    }
  }

  function _escText(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function render(containerEl, callbacks) {
    containerEl.innerHTML =
      '<div class="import-panel">' +
      '<h2 class="import-panel-title">Import World</h2>' +
      '<p class="import-panel-hint">In Azgaar Fantasy Map Generator, use ' +
      '<strong>Menu → Save → Save as JSON</strong> to export the full map, ' +
      'then drop the <code>.json</code> file here. ' +
      '(The partitioned GeoJSON exports — cells, routes, rivers, markers, zones — are not supported.)</p>' +
      '<div class="drop-zone" id="cartographer-drop-zone">' +
      '<span class="drop-zone-label">Drop Azgaar .json here, or tap to browse</span>' +
      '<input type="file" accept=".json,application/json" ' +
      'id="cartographer-file-input" class="drop-zone-file-input" ' +
      'aria-label="Choose Azgaar JSON file">' +
      '</div>' +
      '<div class="import-error hidden" id="cartographer-import-error"></div>' +
      '</div>';

    var dropZoneEl = containerEl.querySelector('#cartographer-drop-zone');
    var fileInputEl = containerEl.querySelector('#cartographer-file-input');
    var errorEl = containerEl.querySelector('#cartographer-import-error');

    dropZoneEl.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropZoneEl.classList.add('drop-zone--active');
    });

    dropZoneEl.addEventListener('dragleave', function () {
      dropZoneEl.classList.remove('drop-zone--active');
    });

    dropZoneEl.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZoneEl.classList.remove('drop-zone--active');
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      _processFile(file, containerEl, callbacks);
    });

    fileInputEl.addEventListener('change', function () {
      var file = fileInputEl.files && fileInputEl.files[0];
      fileInputEl.value = '';
      _processFile(file, containerEl, callbacks);
    });

    void errorEl; // referenced via containerEl.querySelector in _processFile
  }

  var api = {
    parseAzgaarJson: parseAzgaarJson,
    toPreviewWorld: _toPreviewWorld,
    render: render,
  };

  if (typeof window !== 'undefined') {
    window.Tortuga = window.Tortuga || {};
    window.Tortuga.importer = api;
  }

  // CommonJS export for Jest tests (Node-only path, ignored in the browser).
  // eslint-disable-next-line no-undef
  if (typeof module !== 'undefined' && module.exports) {
    // eslint-disable-next-line no-undef
    module.exports = api;
  }
})();
