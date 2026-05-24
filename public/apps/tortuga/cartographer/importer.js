(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  /*
   * Intermediate world-data shape produced by parseGeoJSON:
   * {
   *   sourceFormat: 'azgaar-geojson',
   *   bounds:       [[minY, minX], [maxY, maxX]],  // Leaflet CRS.Simple [lat, lng] = [y, x]
   *   dimensions:   { width: number, height: number },
   *   coastlines:   [ [[y, x], ...], ... ],         // one ring per land polygon
   *   waterCells:   [ { polygon: [[y, x], ...] } ], // ocean/sea/lake areas
   *   biomes:       [ { name: string, polygon: [[y, x], ...] } ],
   *   burgs:        [ { id, name, pos: [y, x], population, stateId, isPort } ],
   *   stateBorders: [ { id, name, color, polygon: [[y, x], ...] } ],
   * }
   *
   * Azgaar GeoJSON coordinates are [x, y] (GeoJSON convention); we swap to
   * Leaflet [lat, lng] = [y, x] throughout so the shape is renderer-ready.
   */

  var OCEAN_BIOMES = ['ocean', 'sea ice'];

  function _isOceanBiome(name) {
    return OCEAN_BIOMES.indexOf((name || '').toLowerCase()) !== -1;
  }

  // GeoJSON [x, y] → Leaflet [y, x]
  function _toLeaflet(coord) {
    return [coord[1], coord[0]];
  }

  function _ringToLeaflet(ring) {
    return ring.map(_toLeaflet);
  }

  // Returns the first exterior ring of a Polygon or MultiPolygon as [[y,x],...].
  // For MultiPolygon we flatten all exterior rings.
  function _extractExteriorRings(geom) {
    if (geom.type === 'Polygon') {
      return [_ringToLeaflet(geom.coordinates[0])];
    }
    if (geom.type === 'MultiPolygon') {
      return geom.coordinates.map(function (poly) {
        return _ringToLeaflet(poly[0]);
      });
    }
    return [];
  }

  function _computeBounds(features) {
    var minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    function scanCoord(c) {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
    }

    function scanGeom(geom) {
      if (!geom) return;
      if (geom.type === 'Point') {
        scanCoord(geom.coordinates);
      } else if (geom.type === 'LineString') {
        geom.coordinates.forEach(scanCoord);
      } else if (geom.type === 'Polygon') {
        geom.coordinates.forEach(function (ring) {
          ring.forEach(scanCoord);
        });
      } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(function (poly) {
          poly.forEach(function (ring) {
            ring.forEach(scanCoord);
          });
        });
      }
    }

    features.forEach(function (f) {
      scanGeom(f.geometry);
    });

    if (!isFinite(minX))
      return [
        [0, 0],
        [1000, 1000],
      ];
    // Leaflet [lat, lng] = [y, x]
    return [
      [minY, minX],
      [maxY, maxX],
    ];
  }

  function parseGeoJSON(geojson) {
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error('Not a valid GeoJSON FeatureCollection.');
    }
    if (geojson.features.length === 0) {
      throw new Error('GeoJSON contains no features.');
    }

    var coastlines = [];
    var waterCells = [];
    var biomes = [];
    var burgs = [];
    var stateBorders = [];

    geojson.features.forEach(function (feature, idx) {
      var props = feature.properties || {};
      var geom = feature.geometry;
      if (!geom) return;

      var type = (props.type || '').toLowerCase();

      if (type === 'burg' && geom.type === 'Point') {
        burgs.push({
          id: 'burg_' + (props.i != null ? props.i : idx),
          name: props.name || 'Unknown',
          pos: _toLeaflet(geom.coordinates),
          population: props.population || 0,
          stateId: props.state != null ? props.state : null,
          isPort: !!props.port,
        });
      } else if (type === 'state' && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
        var stateRings = _extractExteriorRings(geom);
        stateRings.forEach(function (ring, ri) {
          stateBorders.push({
            id: 'state_' + (props.i != null ? props.i : idx) + '_' + ri,
            name: props.name || 'Unknown State',
            color: props.color || '#888888',
            polygon: ring,
          });
        });
      } else if (type === 'biome' && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
        var biomeName = props.name || 'Unknown';
        var biomeRings = _extractExteriorRings(geom);
        biomeRings.forEach(function (ring) {
          biomes.push({ name: biomeName, polygon: ring });
          if (_isOceanBiome(biomeName)) {
            waterCells.push({ polygon: ring });
          } else {
            coastlines.push(ring);
          }
        });
      } else if (type === 'lake' && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
        _extractExteriorRings(geom).forEach(function (ring) {
          waterCells.push({ polygon: ring });
        });
      }
    });

    if (burgs.length === 0) {
      throw new Error('No burg features found — is this an Azgaar GeoJSON export?');
    }
    if (coastlines.length === 0 && waterCells.length === 0) {
      throw new Error('Could not identify land or water features.');
    }

    var bounds = _computeBounds(geojson.features);

    return {
      sourceFormat: 'azgaar-geojson',
      bounds: bounds,
      dimensions: {
        width: bounds[1][1] - bounds[0][1],
        height: bounds[1][0] - bounds[0][0],
      },
      coastlines: coastlines,
      waterCells: waterCells,
      biomes: biomes,
      burgs: burgs,
      stateBorders: stateBorders,
    };
  }

  // Build the renderer-compatible preview world from the parsed intermediate shape.
  // Overlay generation (T-104–T-107) will replace this with richer data later.
  function _toPreviewWorld(parsed) {
    return {
      bounds: parsed.bounds,
      coastlines: parsed.coastlines,
      settlements: parsed.burgs.map(function (b) {
        return {
          id: b.id,
          name: b.name,
          pos: b.pos,
          type: b.isPort ? 'port' : 'burg',
          faction: null,
        };
      }),
      hazards: [],
      tradeRoutes: [],
      factionTerritory: parsed.stateBorders.map(function (s) {
        return {
          id: s.id,
          name: s.name,
          faction: s.name,
          color: s.color,
          polygon: s.polygon,
        };
      }),
      windCurrentZones: [],
    };
  }

  function _showError(dropZoneEl, errorEl, msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
    dropZoneEl.classList.remove('drop-zone--active');
  }

  function _clearError(errorEl) {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }

  function _processFile(file, dropZoneEl, errorEl, callbacks) {
    if (!file) return;

    var lower = file.name.toLowerCase();
    if (!lower.endsWith('.geojson') && !lower.endsWith('.json')) {
      _showError(dropZoneEl, errorEl, 'Please drop a .geojson or .json file.');
      return;
    }

    _clearError(errorEl);
    dropZoneEl.classList.add('drop-zone--loading');

    var reader = new FileReader();
    reader.onload = function (e) {
      dropZoneEl.classList.remove('drop-zone--loading');
      var geojson;
      try {
        geojson = JSON.parse(e.target.result);
      } catch (parseErr) {
        var msg = 'File is not valid JSON: ' + parseErr.message;
        _showError(dropZoneEl, errorEl, msg);
        if (callbacks.onError) callbacks.onError(msg);
        return;
      }

      var parsed;
      try {
        parsed = parseGeoJSON(geojson);
      } catch (err) {
        _showError(dropZoneEl, errorEl, err.message);
        if (callbacks.onError) callbacks.onError(err.message);
        return;
      }

      _clearError(errorEl);
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

  T.importer = {
    render: function (containerEl, callbacks) {
      containerEl.innerHTML =
        '<div class="import-panel">' +
        '<h2 class="import-panel-title">Import World</h2>' +
        '<p class="import-panel-hint">Drop an Azgaar Fantasy Map Generator <code>.geojson</code> export below.</p>' +
        '<div class="drop-zone" id="cartographer-drop-zone">' +
        '<span class="drop-zone-label">Drop .geojson here</span>' +
        '<label class="drop-zone-pick">or <span class="drop-zone-pick-link">choose a file</span>' +
        '<input type="file" accept=".geojson,.json" id="cartographer-file-input" style="display:none">' +
        '</label>' +
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
        _processFile(file, dropZoneEl, errorEl, callbacks);
      });

      dropZoneEl.addEventListener('click', function (e) {
        // Only trigger file picker when clicking the label area, not the whole zone accidentally.
        if (e.target !== fileInputEl) fileInputEl.click();
      });

      fileInputEl.addEventListener('change', function () {
        var file = fileInputEl.files && fileInputEl.files[0];
        _processFile(file, dropZoneEl, errorEl, callbacks);
        // Reset so the same file can be re-selected after an error.
        fileInputEl.value = '';
      });
    },

    parseGeoJSON: parseGeoJSON,
  };
})();
