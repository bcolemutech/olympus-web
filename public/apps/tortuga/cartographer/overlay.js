(function () {
  'use strict';

  /*
   * Tortuga overlay generator — T-104 / T-105 (hidden coves) / T-106 (faction mapping).
   *
   * Transforms the intermediate shape produced by importer.parseAzgaarJson into
   * a pirate-themed world whose settlements match the tortuga_worlds.settlements[]
   * schema from §9 of the design doc:
   *   { id, name, type, position, parentFaction, baseSize, hidden }
   *
   * Factions match the tortuga_worlds.factions[] schema from §9:
   *   { id, name, archetype, color, homeSettlementId }
   *
   * Trade routes match the tortuga_worlds.tradeRoutes[] schema from §9:
   *   { id, fromId, toId, faction }
   *
   * Settlement types: colonial_port, free_port, fort, hidden_cove, native_village, ruins
   *
   * Classification, faction mapping, and trade route generation are deterministic:
   * same parsed input + same options → same output. Branching decisions use a
   * lightweight hash of the burg ID rather than Math.random().
   *
   * applyOverlay(parsed, options) is the top-level entry point. It returns a
   * renderer-compatible world shape (same keys as importer._toPreviewWorld) but
   * with fully classified settlements and faction list. Callers should prefer applyOverlay
   * over importer.toPreviewWorld once this module is loaded.
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

  var ERA_FACTION_CATALOG = {
    caribbean_golden_age: [
      { archetype: 'spanish_crown', name: 'Spanish Crown', color: '#c8a000' },
      { archetype: 'british_crown', name: 'British Crown', color: '#8b0000' },
      { archetype: 'french_crown', name: 'French Crown', color: '#00408b' },
      { archetype: 'dutch_trading_co', name: 'Dutch Trading Co.', color: '#005e00' },
      { archetype: 'indigenous_confederacy', name: 'Indigenous Confederacy', color: '#7a5200' },
      { archetype: 'free_city', name: 'Free City', color: '#555555' },
    ],
    mediterranean_corsair: [
      { archetype: 'ottoman_regency', name: 'Ottoman Regency', color: '#8b0000' },
      { archetype: 'venetian_republic', name: 'Venetian Republic', color: '#9b6000' },
      { archetype: 'papal_states', name: 'Papal States', color: '#c8c800' },
      { archetype: 'corsair_republic', name: 'Corsair Republic', color: '#003060' },
      { archetype: 'free_city', name: 'Free City', color: '#555555' },
    ],
    indian_ocean: [
      { archetype: 'mughal_empire', name: 'Mughal Empire', color: '#8b3a00' },
      { archetype: 'portuguese_estado', name: 'Portuguese Estado', color: '#005e00' },
      { archetype: 'arab_sultanate', name: 'Arab Sultanate', color: '#c8a000' },
      { archetype: 'east_india_company', name: 'East India Company', color: '#8b0000' },
      { archetype: 'free_city', name: 'Free City', color: '#555555' },
    ],
    freeform: [
      { archetype: 'realm', name: 'Realm', color: '#556070' },
      { archetype: 'confederacy', name: 'Confederacy', color: '#705560' },
      { archetype: 'guild', name: 'Guild', color: '#607055' },
      { archetype: 'free_city', name: 'Free City', color: '#555555' },
    ],
  };

  var PIRATE_BRETHREN_ENTRY = {
    archetype: 'pirate_brethren',
    name: 'Pirate Brethren',
    color: '#222222',
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

  // Irregular closed polygon with `sides` vertices around (cy, cx).
  // Each vertex's radius is perturbed deterministically via `seed` so reefs
  // and kraken zones read as organic shapes rather than blocks.
  function _jaggedBlob(cy, cx, baseRadius, sides, seed) {
    var pts = [];
    for (var i = 0; i < sides; i++) {
      var angle = (i / sides) * Math.PI * 2;
      var r = baseRadius * (0.6 + 0.7 * _hash(seed + '_' + i));
      pts.push([cy + Math.sin(angle) * r, cx + Math.cos(angle) * r]);
    }
    return pts;
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
   * Map source states to faction archetypes for the era preset.
   * Pirate Brethren is always appended as a synthetic faction (no Azgaar state).
   *
   * @param {Array} stateBorders - from parseAzgaarJson result: [{ id, name, color, capitalBurgId }]
   * @param {Object} options     - { era: string, factionCount: number (2–8) }
   * @returns {Array}            - faction objects matching §9 schema: { id, name, archetype, color, homeSettlementId }
   */
  function generateFactions(stateBorders, options) {
    var opts = options || {};
    var era = opts.era || 'caribbean_golden_age';
    var rawCount = typeof opts.factionCount === 'number' ? opts.factionCount : 8;
    var factionCount = Math.max(2, Math.min(8, rawCount));

    var catalog = ERA_FACTION_CATALOG[era] || ERA_FACTION_CATALOG['caribbean_golden_age'];
    var stateSlots = Math.min(stateBorders.length, factionCount - 1);

    var factions = [];
    for (var i = 0; i < stateSlots; i++) {
      var state = stateBorders[i];
      var entry = catalog[i % catalog.length];
      factions.push({
        id: state.id,
        name: entry.name,
        archetype: entry.archetype,
        color: state.color || entry.color,
        homeSettlementId: state.capitalBurgId || null,
      });
    }

    factions.push({
      id: 'faction_pirate',
      name: PIRATE_BRETHREN_ENTRY.name,
      archetype: PIRATE_BRETHREN_ENTRY.archetype,
      color: PIRATE_BRETHREN_ENTRY.color,
      homeSettlementId: null,
    });

    return factions;
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
    var baseRadius = Math.min(mapH, mapW) * 0.018;

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
        polygon: _jaggedBlob(
          basePos[0] + nudgeY,
          basePos[1] + nudgeX,
          baseRadius,
          7,
          'reef_shape_' + i
        ),
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
    var baseRadius = Math.min(mapH, mapW) * 0.055;

    var zones = [];
    for (var i = 0; i < count; i++) {
      var cy = centerY + mapH * 0.3 * (_hash('kzone_y_' + i) - 0.5);
      var cx = centerX + mapW * 0.3 * (_hash('kzone_x_' + i) - 0.5);
      zones.push({
        id: 'kraken_' + i,
        type: 'kraken_zone',
        polygon: _jaggedBlob(cy, cx, baseRadius, 14, 'kzone_shape_' + i),
        severity: 'high',
      });
    }
    return zones;
  }

  /*
   * Generate trade routes between large colonial_ports of the same faction.
   * Routes are a chain (not all-to-all): ports sorted by X position are connected
   * adjacently, producing at most N-1 routes for N ports per faction.
   *
   * @param {Array} settlements - classified settlement objects (output of classifySettlements)
   * @param {Object} options    - reserved for future use
   * @returns {Array}           - trade route objects matching §9 schema: { id, fromId, toId, faction }
   */
  function generateTradeRoutes(settlements, options) {
    void options;

    var byFaction = {};
    for (var i = 0; i < settlements.length; i++) {
      var s = settlements[i];
      if (s.type !== SETTLEMENT_TYPES.COLONIAL_PORT) continue;
      if (s.baseSize !== 'large') continue;
      if (!s.parentFaction) continue;
      if (!byFaction[s.parentFaction]) byFaction[s.parentFaction] = [];
      byFaction[s.parentFaction].push(s);
    }

    var routes = [];
    var routeIdx = 0;
    var factionIds = Object.keys(byFaction).sort();

    for (var fi = 0; fi < factionIds.length; fi++) {
      var factionId = factionIds[fi];
      var ports = byFaction[factionId];
      ports.sort(function (a, b) {
        if (a.position[1] !== b.position[1]) return a.position[1] - b.position[1];
        if (a.position[0] !== b.position[0]) return a.position[0] - b.position[0];
        return a.id < b.id ? -1 : 1;
      });
      for (var pi = 0; pi < ports.length - 1; pi++) {
        routes.push({
          id: 'route_' + routeIdx,
          fromId: ports[pi].id,
          toId: ports[pi + 1].id,
          faction: factionId,
        });
        routeIdx++;
      }
    }

    return routes;
  }

  /*
   * Apply the full overlay pipeline to a parsed world, returning a renderer-
   * compatible world shape with enriched settlements.
   *
   * This is the replacement for importer._toPreviewWorld. Once T-108 wires up
   * the cartographer UI, callers should use applyOverlay instead of toPreviewWorld.
   *
   * @param {Object} parsed  - result of importer.parseAzgaarJson
   * @param {Object} options - { era, settlementDensity, hazardDensity, mythic, factionCount, density (fallback) }
   * @returns {Object}       - renderer-compatible world
   */
  function applyOverlay(parsed, options) {
    var opts = options || {};
    // settlementDensity drives hidden coves; hazardDensity drives reefs/storms/krakens.
    // Both fall back to opts.density for backward compatibility with single-density callers.
    var settlementOpts = Object.assign({}, opts, {
      density: opts.settlementDensity || opts.density || 'standard',
    });
    var hazardOpts = Object.assign({}, opts, {
      density: opts.hazardDensity || opts.density || 'standard',
    });
    var classified = classifySettlements(parsed.burgs, parsed.stateBorders, opts);
    var factions = generateFactions(parsed.stateBorders, opts);
    var coves = generateHiddenCoves(parsed.bounds, parsed.coastlines, settlementOpts);
    var reefs = generateReefs(parsed.bounds, parsed.coastlines, hazardOpts);
    var storms = generateStormBands(parsed.bounds, hazardOpts);
    var krakens = generateKrakenZones(parsed.bounds, parsed.coastlines, hazardOpts);
    var lakeHazards = parsed.lakes.map(function (l, i) {
      return { id: 'lake_' + i, name: l.name, type: 'lake', polygon: l.polygon, severity: 'low' };
    });
    var routes = generateTradeRoutes(classified, opts);

    // Route waypoints around landmasses if a pathfinder is registered.
    // Browser-only — Node tests don't load pathfinder, routes keep fromId/toId
    // and the renderer falls back to a straight line.
    var pathfinder = typeof window !== 'undefined' && window.Tortuga && window.Tortuga.pathfinder;
    if (pathfinder && routes.length > 0) {
      var posById = {};
      for (var pi = 0; pi < classified.length; pi++) {
        posById[classified[pi].id] = classified[pi].position;
      }
      var mask = pathfinder.buildLandMask(parsed.bounds, parsed.coastlines);
      for (var ri = 0; ri < routes.length; ri++) {
        var r = routes[ri];
        var from = posById[r.fromId];
        var to = posById[r.toId];
        if (!from || !to) continue;
        var pts = pathfinder.findPath(mask, from, to);
        if (pts && pts.length >= 2) r.points = pts;
      }
    }

    return {
      bounds: parsed.bounds,
      coastlines: parsed.coastlines,
      settlements: classified.concat(coves),
      hazards: lakeHazards.concat(reefs, storms, krakens),
      factions: factions,
      tradeRoutes: routes,
      factionTerritory: [],
      windCurrentZones: [],
    };
  }

  var api = {
    classifySettlements: classifySettlements,
    generateFactions: generateFactions,
    generateHiddenCoves: generateHiddenCoves,
    generateReefs: generateReefs,
    generateStormBands: generateStormBands,
    generateKrakenZones: generateKrakenZones,
    generateTradeRoutes: generateTradeRoutes,
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
