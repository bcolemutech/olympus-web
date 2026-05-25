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

    return {
      bounds: parsed.bounds,
      coastlines: parsed.coastlines,
      settlements: classified.concat(coves),
      hazards: parsed.lakes.map(function (l, i) {
        return { id: 'lake_' + i, name: l.name, type: 'lake', polygon: l.polygon };
      }),
      tradeRoutes: [],
      factionTerritory: [],
      windCurrentZones: [],
    };
  }

  var api = {
    classifySettlements: classifySettlements,
    generateHiddenCoves: generateHiddenCoves,
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
