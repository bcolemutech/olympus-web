(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  var LAYERS = {
    BASE: 'base',
    SETTLEMENTS: 'settlements',
    HAZARDS: 'hazards',
    TRADE_ROUTES: 'tradeRoutes',
    FACTION_TERRITORY: 'factionTerritory',
    WIND_CURRENTS: 'windCurrents',
  };

  var _map = null;
  var _layers = {};
  var _visibility = {};

  function _clearLayers() {
    Object.keys(_layers).forEach(function (k) {
      _layers[k].clearLayers();
    });
  }

  function _renderBase(world) {
    if (!world || !world.coastlines) return;
    world.coastlines.forEach(function (polygon) {
      L.polygon(polygon, {
        color: '#4a7c59',
        fillColor: '#2d5a3d',
        fillOpacity: 0.6,
        weight: 2,
      }).addTo(_layers[LAYERS.BASE]);
    });
  }

  function _renderSettlements(world) {
    if (!world || !world.settlements) return;
    world.settlements.forEach(function (s) {
      var factionLabel = s.parentFaction || s.faction || null;
      L.marker(s.position || s.pos, { title: s.name })
        .bindPopup(
          '<strong>' +
            s.name +
            '</strong><br>' +
            (s.type || '') +
            (factionLabel ? '<br>' + factionLabel : '')
        )
        .addTo(_layers[LAYERS.SETTLEMENTS]);
    });
  }

  var HAZARD_STYLES = {
    reef: { color: '#7a4a1c', fillColor: '#b07a3a', fillOpacity: 0.55, weight: 1 },
    storm_band: {
      color: '#506878',
      fillColor: '#8aa8b8',
      fillOpacity: 0.22,
      weight: 1,
      dashArray: '4 6',
    },
    kraken_zone: { color: '#2a1a3a', fillColor: '#4a2a5a', fillOpacity: 0.4, weight: 1 },
    lake: { color: '#2a6a8a', fillColor: '#4a8aaa', fillOpacity: 0.55, weight: 1 },
  };

  var DEFAULT_HAZARD_STYLE = {
    color: '#cc4444',
    fillColor: '#ff0000',
    fillOpacity: 0.25,
    weight: 1,
  };

  var HAZARD_LABELS = {
    reef: 'Reef',
    storm_band: 'Storm Band',
    kraken_zone: 'Kraken Waters',
    lake: 'Lake',
  };

  function _renderHazards(world) {
    if (!world || !world.hazards) return;
    world.hazards.forEach(function (h) {
      var style = HAZARD_STYLES[h.type] || DEFAULT_HAZARD_STYLE;
      var label = h.name || HAZARD_LABELS[h.type] || 'Hazard';
      var popup =
        '<strong>' + label + '</strong>' + (h.severity ? '<br>Severity: ' + h.severity : '');
      var polygon = L.polygon(h.polygon, style).bindPopup(popup);
      if (h.type === 'kraken_zone') {
        polygon.bindTooltip('Kraken Waters', {
          permanent: true,
          direction: 'center',
          className: 'tortuga-hazard-label',
        });
      }
      polygon.addTo(_layers[LAYERS.HAZARDS]);
    });
  }

  function _renderTradeRoutes(world) {
    if (!world || !world.tradeRoutes) return;
    var posById = {};
    if (world.settlements) {
      world.settlements.forEach(function (s) {
        posById[s.id] = s.position || s.pos;
      });
    }
    world.tradeRoutes.forEach(function (r) {
      var points = r.points;
      if (!points && r.fromId && r.toId) {
        var from = posById[r.fromId];
        var to = posById[r.toId];
        if (from && to) points = [from, to];
      }
      if (!points || points.length < 2) return;
      L.polyline(points, {
        color: '#c8a84b',
        weight: 2,
        dashArray: '6 4',
        opacity: 0.85,
      })
        .bindPopup(r.name || 'Trade route')
        .addTo(_layers[LAYERS.TRADE_ROUTES]);
    });
  }

  function _renderFactionTerritory(world) {
    if (!world || !world.factionTerritory) return;
    world.factionTerritory.forEach(function (ft) {
      L.polygon(ft.polygon, {
        color: ft.color || '#888888',
        fillColor: ft.color || '#888888',
        fillOpacity: 0.2,
        weight: 1,
      })
        .bindPopup('<strong>' + (ft.name || 'Territory') + '</strong><br>' + (ft.faction || ''))
        .addTo(_layers[LAYERS.FACTION_TERRITORY]);
    });
  }

  // Wind/current zones rendered as styled polygons with direction in tooltip.
  // Full SVG arrow overlays are a Phase 2 enhancement.
  function _renderWindCurrents(world) {
    if (!world || !world.windCurrentZones) return;
    world.windCurrentZones.forEach(function (wz) {
      L.polygon(wz.bounds, {
        color: '#6699cc',
        fillColor: '#99bbdd',
        fillOpacity: 0.15,
        weight: 1,
        dashArray: '4 4',
      })
        .bindPopup(
          '<strong>' +
            (wz.name || 'Wind zone') +
            '</strong><br>' +
            (wz.direction || '') +
            (wz.strength ? ' &mdash; ' + wz.strength : '')
        )
        .addTo(_layers[LAYERS.WIND_CURRENTS]);
    });
  }

  T.mapRenderer = {
    LAYERS: LAYERS,

    PLACEHOLDER_WORLD: {
      bounds: [
        [0, 0],
        [600, 800],
      ],
      coastlines: [
        [
          [100, 150],
          [80, 300],
          [120, 450],
          [200, 500],
          [300, 520],
          [380, 480],
          [420, 350],
          [400, 200],
          [300, 120],
          [200, 100],
        ],
        [
          [200, 600],
          [180, 650],
          [220, 680],
          [260, 660],
          [270, 620],
          [240, 595],
        ],
      ],
      settlements: [
        {
          id: 's1',
          name: 'Port Royal',
          pos: [200, 200],
          type: 'colonial_port',
          faction: 'British Crown',
        },
        {
          id: 's2',
          name: 'Tortuga',
          pos: [300, 400],
          type: 'free_port',
          faction: 'Pirate Brethren',
        },
        {
          id: 's3',
          name: 'Havana',
          pos: [150, 380],
          type: 'colonial_port',
          faction: 'Spanish Crown',
        },
        { id: 's4', name: 'Nassau', pos: [350, 500], type: 'fort', faction: 'British Crown' },
        { id: 's5', name: 'Hidden Cove', pos: [230, 630], type: 'hidden_cove', faction: null },
      ],
      hazards: [
        {
          id: 'h1',
          name: "Devil's Reef",
          polygon: [
            [50, 100],
            [70, 130],
            [60, 160],
            [40, 150],
            [30, 120],
          ],
          type: 'reef',
        },
        {
          id: 'h2',
          name: 'Storm Band',
          polygon: [
            [500, 0],
            [550, 100],
            [560, 250],
            [510, 350],
            [480, 250],
            [490, 100],
          ],
          type: 'storm',
        },
      ],
      tradeRoutes: [
        {
          id: 'tr1',
          name: 'Royal Trade Route',
          points: [
            [200, 200],
            [150, 380],
            [300, 400],
          ],
        },
        {
          id: 'tr2',
          name: 'Caribbean Run',
          points: [
            [300, 400],
            [350, 500],
            [230, 630],
          ],
        },
      ],
      factionTerritory: [
        {
          id: 'ft1',
          name: 'British Waters',
          faction: 'British Crown',
          color: '#cc4400',
          polygon: [
            [80, 100],
            [80, 350],
            [250, 380],
            [260, 200],
            [180, 80],
          ],
        },
        {
          id: 'ft2',
          name: 'Spanish Domain',
          faction: 'Spanish Crown',
          color: '#ddaa00',
          polygon: [
            [100, 350],
            [100, 520],
            [280, 540],
            [300, 420],
            [250, 380],
          ],
        },
      ],
      windCurrentZones: [
        {
          id: 'wz1',
          name: 'Trade Winds',
          direction: 'E → W',
          bounds: [
            [400, 0],
            [500, 0],
            [500, 800],
            [400, 800],
          ],
          strength: 'moderate',
        },
        {
          id: 'wz2',
          name: 'Gulf Current',
          direction: 'S → N',
          bounds: [
            [0, 700],
            [300, 700],
            [300, 800],
            [0, 800],
          ],
          strength: 'strong',
        },
      ],
    },

    init: function (containerEl, world) {
      if (_map) this.destroy();

      _map = L.map(containerEl, {
        crs: L.CRS.Simple,
        minZoom: -2,
        maxZoom: 4,
        zoomControl: true,
      });

      _layers[LAYERS.BASE] = L.layerGroup();
      _layers[LAYERS.SETTLEMENTS] = L.markerClusterGroup();
      _layers[LAYERS.HAZARDS] = L.layerGroup();
      _layers[LAYERS.TRADE_ROUTES] = L.layerGroup();
      _layers[LAYERS.FACTION_TERRITORY] = L.layerGroup();
      _layers[LAYERS.WIND_CURRENTS] = L.layerGroup();

      Object.keys(_layers).forEach(function (k) {
        _layers[k].addTo(_map);
        _visibility[k] = true;
      });

      if (world) this.setWorld(world);
    },

    destroy: function () {
      if (_map) {
        _map.remove();
        _map = null;
        _layers = {};
        _visibility = {};
      }
    },

    setWorld: function (world) {
      if (!_map) return;
      _clearLayers();
      _renderBase(world);
      _renderSettlements(world);
      _renderHazards(world);
      _renderTradeRoutes(world);
      _renderFactionTerritory(world);
      _renderWindCurrents(world);
      this.fitBounds(world);
    },

    fitBounds: function (world) {
      if (!_map || !world || !world.bounds) return;
      _map.fitBounds(world.bounds);
    },

    showLayer: function (name) {
      if (!_map || !_layers[name]) return;
      _layers[name].addTo(_map);
      _visibility[name] = true;
    },

    hideLayer: function (name) {
      if (!_map || !_layers[name]) return;
      _map.removeLayer(_layers[name]);
      _visibility[name] = false;
    },

    toggleLayer: function (name) {
      if (_visibility[name]) this.hideLayer(name);
      else this.showLayer(name);
    },

    isLayerVisible: function (name) {
      return !!_visibility[name];
    },

    // Phase 2 hook: register and display a caller-supplied Leaflet layer (e.g. playerFleet).
    addExternalLayer: function (name, leafletLayer) {
      if (!_map) return;
      _layers[name] = leafletLayer;
      _visibility[name] = true;
      leafletLayer.addTo(_map);
    },
  };
})();
