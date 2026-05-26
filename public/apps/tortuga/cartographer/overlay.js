(function () {
  'use strict';

  /*
   * Tortuga overlay generator — T-104 / T-105 (hidden coves).
   *
   * Transforms the intermediate shape produced by importer.parseAzgaarJson into
   * a pirate-themed world whose settlements match the tortuga_worlds.settlements[]
   * schema from §9 of the design doc:
   *   { id, name, type, position, parentFaction, baseSize, hidden }
   *
   * Settlement types: colonial_port, free_port, fort, hidden_cove, native_village, ruins
   *
   * Classification is deterministic: same parsed input + same options → same output.
   * Branching decisions use a lightweight hash of the burg ID rather than Math.random().
   *
   * applyOverlay(parsed, options) is the top-level entry point. It returns a
   * renderer-compatible world shape (same keys as importer._toPreviewWorld) but
   * with fully classified settlements. Callers should prefer applyOverlay over
   * importer.toPreviewWorld once this module is loaded.
   */

  var SETTLEMENT_TYPES = {
    COLONIAL_PORT: 'colonial_port',
    FREE_PORT: 'free_port',
    FORT: 'fort',
    HIDDEN_COVE: 'hidden_cove',
    NATIVE_VILLAGE: 'native_village',
    RUINS: 'ruins',
  };

  var DENSITY_COVE_COUNT = {
    sparse: 5,
    standard: 10,
    dense: 20,
  };

  var DENSITY_REEF_COUNT = {
    sparse: 3,
    standard: 6,
    dense: 12,
  };

  var DENSITY_STORM_COUNT = {
    sparse: 1,
    standard: 2,
    dense: 3,
  };

  var DENSITY_KRAKEN_COUNT = {
    sparse: 1,
    standard: 2,
    dense: 3,
  };

  var COVE_NAMES = [
    "The Devil's Notch",
    "Wraith's Anchorage",
    "Corsair's Inlet",
    'The Blind Eye',
    "Widow's Reach",
    'Skeleton Cove',
    "The Rat's Hole",
    'Murk Bay',
    'The Forgotten Shore',
    "Jackal's Landing",
    'Serpent Cove',
    'The Dark Passage',
  ];

  // 4-point rectangle polygon centred at (cy, cx).
  function _makeRect(cy, cx, halfH, halfW) {
    return [
      [cy - halfH, cx - halfW],
      [cy - halfH, cx + halfW],
      [cy + halfH, cx + halfW],
      [cy + halfH, cx - halfW],
    ];
  }

  // Deterministic djb2-style hash of a string → float in [0, 1).
  function _hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = (h * 33 + str.charCodeAt(i)) & 0x7fffffff;
    }
    return h / 0x7fffffff;
  }

  function _populationBand(population) {
    if (population >= 8) return 'large';
    if (population >= 2) return 'medium';
    return 'small';
  }

  /*
   * Classify a single coastal burg into a settlement type.
   * Returns null if the burg is not coastal (isPort === false).
   */
  function _classifyBurg(burg) {
    if (!burg.isPort) return null;

    var pop = _populationBand(burg.population);
    var h = _hash(burg.id);
    var type;

    if (burg.stateId === 0) {
      // Neutral / wild — no state allegiance
      if (pop === 'small') {
        type = SETTLEMENT_TYPES.NATIVE_VILLAGE;
      } else {
        type = SETTLEMENT_TYPES.FREE_PORT;
      }
    } else {
      // Belongs to a state
      if (pop === 'small' && h < 0.07) {
        // Rare ruins override for any small state burg
        type = SETTLEMENT_TYPES.RUINS;
      } else if (burg.isCapital) {
        type = pop === 'small' ? SETTLEMENT_TYPES.FORT : SETTLEMENT_TYPES.COLONIAL_PORT;
      } else {
        if (pop === 'large') {
          type = SETTLEMENT_TYPES.COLONIAL_PORT;
        } else if (pop === 'medium') {
          type = h < 0.5 ? SETTLEMENT_TYPES.COLONIAL_PORT : SETTLEMENT_TYPES.FORT;
        } else {
          // small, non-capital
          type = h < 0.55 ? SETTLEMENT_TYPES.FORT : SETTLEMENT_TYPES.RUINS;
        }
      }
    }

    return {
      id: burg.id,
      name: burg.name,
      type: type,
      position: burg.pos,
      parentFaction: burg.stateId > 0 ? 'state_' + burg.stateId : null,
      baseSize: pop,
      hidden: false,
    };
  }

  /*
   * Classify all coastal burgs from the parsed world.
   * Non-coastal burgs (isPort === false) are excluded.
   *
   * @param {Array} burgs       - from parseAzgaarJson result
   * @param {Array} stateBorders - from parseAzgaarJson result (unused here, reserved for future era logic)
   * @param {Object} options    - { density: 'sparse'|'standard'|'dense', era: string }
   * @returns {Array}           - settlement objects matching §9 schema
   */
  function classifySettlements(burgs, stateBorders, options) {
    void stateBorders; // reserved for era-based faction archetype logic (T-106)
    void options;
    var settlements = [];
    for (var i = 0; i < burgs.length; i++) {
      var s = _classifyBurg(burgs[i]);
      if (s !== null) settlements.push(s);
    }
    return settlements;
  }

  /*
   * Generate N hidden coves — small uncharted settlements not in the source data.
   * Positions are sampled deterministically along the provided coastline rings.
   *
   * @param {Array} bounds      - [[minY, minX], [maxY, maxX]]
   * @param {Array} coastlines  - array of rings, each ring is [[y, x], ...]
   * @param {Object} options    - { density: 'sparse'|'standard'|'dense' }
   * @returns {Array}           - hidden cove settlement objects
   */
  function generateHiddenCoves(bounds, coastlines, options) {
    var density = (options && options.density) || 'standard';
    var count = DENSITY_COVE_COUNT[density] || DENSITY_COVE_COUNT.standard;

    if (!coastlines || coastlines.length === 0) return [];

    var coves = [];
    for (var i = 0; i < count; i++) {
      var ringIdx = i % coastlines.length;
      var ring = coastlines[ringIdx];
      // Pick a vertex via a hash derived from the cove index
      var h = _hash('cove_' + i);
      var vertIdx = Math.floor(h * ring.length);
      var basePos = ring[vertIdx] || ring[0];

      // Deterministic nudge so coves don't stack exactly on burg positions.
      // Nudge is proportional to map height (bounds[1][0]).
      var mapHeight = bounds && bounds[1] ? bounds[1][0] : 800;
      var nudge = (mapHeight / 200) * (_hash('nudge_' + i) - 0.5);
      var position = [basePos[0] + nudge, basePos[1] + nudge];

      coves.push({
        id: 'cove_' + i,
        name: COVE_NAMES[i % COVE_NAMES.length],
        type: SETTLEMENT_TYPES.HIDDEN_COVE,
        position: position,
        parentFaction: null,
        baseSize: 'small',
        hidden: true,
      });
    }
    return coves;
  }

  /*
   * Generate reef hazard patches near coastline vertices.
   *
   * @param {Array} bounds     - [[minY, minX], [maxY, maxX]]
   * @param {Array} coastlines - array of rings, each ring is [[y, x], ...]
   * @param {Object} options   - { density: 'sparse'|'standard'|'dense' }
   * @returns {Array}          - hazard objects { id, type, polygon, severity }
   */
  function generateReefs(bounds, coastlines, options) {
    var density = (options && options.density) || 'standard';
    var count = DENSITY_REEF_COUNT[density] || DENSITY_REEF_COUNT.standard;

    if (!coastlines || coastlines.length === 0) return [];

    var mapH = bounds[1][0] - bounds[0][0];
    var mapW = bounds[1][1] - bounds[0][1];
    var halfH = mapH * 0.025;
    var halfW = mapW * 0.025;

    var reefs = [];
    for (var i = 0; i < count; i++) {
      var ringIdx = i % coastlines.length;
      var ring = coastlines[ringIdx];
      var h = _hash('reef_' + i);
      var vertIdx = Math.floor(h * ring.length);
      var basePos = ring[vertIdx] || ring[0];

      var nudgeY = mapH * 0.01 * (_hash('reef_nudge_y_' + i) - 0.5);
      var nudgeX = mapW * 0.01 * (_hash('reef_nudge_x_' + i) - 0.5);

      reefs.push({
        id: 'reef_' + i,
        type: 'reef',
        polygon: _makeRect(basePos[0] + nudgeY, basePos[1] + nudgeX, halfH, halfW),
        severity: 'medium',
      });
    }
    return reefs;
  }

  /*
   * Generate storm band hazards as wide horizontal strips across the map,
   * evenly spaced by latitude.
   *
   * @param {Array} bounds   - [[minY, minX], [maxY, maxX]]
   * @param {Object} options - { density: 'sparse'|'standard'|'dense' }
   * @returns {Array}        - hazard objects { id, type, polygon, severity }
   */
  function generateStormBands(bounds, options) {
    var density = (options && options.density) || 'standard';
    var count = DENSITY_STORM_COUNT[density] || DENSITY_STORM_COUNT.standard;

    var minY = bounds[0][0];
    var maxY = bounds[1][0];
    var minX = bounds[0][1];
    var maxX = bounds[1][1];
    var mapH = maxY - minY;
    var bandH = mapH * 0.08;

    var bands = [];
    for (var i = 0; i < count; i++) {
      var cy = minY + mapH * ((i + 1) / (count + 1));
      var y1 = cy - bandH / 2;
      var y2 = cy + bandH / 2;
      bands.push({
        id: 'storm_' + i,
        type: 'storm_band',
        polygon: [
          [y1, minX],
          [y1, maxX],
          [y2, maxX],
          [y2, minX],
        ],
        severity: 'high',
      });
    }
    return bands;
  }

  /*
   * Generate kraken zone hazards in open sea (map centre + deterministic offset).
   * Returns an empty array when options.mythic === false.
   *
   * @param {Array} bounds     - [[minY, minX], [maxY, maxX]]
   * @param {Array} coastlines - unused; reserved for future deep-water heuristic
   * @param {Object} options   - { density: 'sparse'|'standard'|'dense', mythic: bool }
   * @returns {Array}          - hazard objects { id, type, polygon, severity }
   */
  function generateKrakenZones(bounds, coastlines, options) {
    void coastlines;
    if (options && options.mythic === false) return [];

    var density = (options && options.density) || 'standard';
    var count = DENSITY_KRAKEN_COUNT[density] || DENSITY_KRAKEN_COUNT.standard;

    var minY = bounds[0][0];
    var maxY = bounds[1][0];
    var minX = bounds[0][1];
    var maxX = bounds[1][1];
    var mapH = maxY - minY;
    var mapW = maxX - minX;
    var centerY = (minY + maxY) / 2;
    var centerX = (minX + maxX) / 2;
    var halfH = mapH * 0.05;
    var halfW = mapW * 0.05;

    var zones = [];
    for (var i = 0; i < count; i++) {
      var cy = centerY + mapH * 0.3 * (_hash('kzone_y_' + i) - 0.5);
      var cx = centerX + mapW * 0.3 * (_hash('kzone_x_' + i) - 0.5);
      zones.push({
        id: 'kraken_' + i,
        type: 'kraken_zone',
        polygon: _makeRect(cy, cx, halfH, halfW),
        severity: 'high',
      });
    }
    return zones;
  }

  /*
   * Apply the full overlay pipeline to a parsed world, returning a renderer-
   * compatible world shape with enriched settlements.
   *
   * This is the replacement for importer._toPreviewWorld. Once T-108 wires up
   * the cartographer UI, callers should use applyOverlay instead of toPreviewWorld.
   *
   * @param {Object} parsed  - result of importer.parseAzgaarJson
   * @param {Object} options - { density: 'sparse'|'standard'|'dense', era: string }
   * @returns {Object}       - renderer-compatible world
   */
  function applyOverlay(parsed, options) {
    var opts = options || {};
    var classified = classifySettlements(parsed.burgs, parsed.stateBorders, opts);
    var coves = generateHiddenCoves(parsed.bounds, parsed.coastlines, opts);
    var reefs = generateReefs(parsed.bounds, parsed.coastlines, opts);
    var storms = generateStormBands(parsed.bounds, opts);
    var krakens = generateKrakenZones(parsed.bounds, parsed.coastlines, opts);
    var lakeHazards = parsed.lakes.map(function (l, i) {
      return { id: 'lake_' + i, name: l.name, type: 'lake', polygon: l.polygon, severity: 'low' };
    });

    return {
      bounds: parsed.bounds,
      coastlines: parsed.coastlines,
      settlements: classified.concat(coves),
      hazards: lakeHazards.concat(reefs, storms, krakens),
      tradeRoutes: [],
      factionTerritory: [],
      windCurrentZones: [],
    };
  }

  var api = {
    classifySettlements: classifySettlements,
    generateHiddenCoves: generateHiddenCoves,
    generateReefs: generateReefs,
    generateStormBands: generateStormBands,
    generateKrakenZones: generateKrakenZones,
    applyOverlay: applyOverlay,
  };

  if (typeof window !== 'undefined') {
    window.Tortuga = window.Tortuga || {};
    window.Tortuga.overlay = api;
  }

  // CommonJS export for Jest tests (Node-only path, ignored in the browser).
  // eslint-disable-next-line no-undef
  if (typeof module !== 'undefined' && module.exports) {
    // eslint-disable-next-line no-undef
    module.exports = api;
  }
})();
