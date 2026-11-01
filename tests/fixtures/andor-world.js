'use strict';

/**
 * A world three maps deep in the levels model (planning/map-levels.md §5;
 * L-903), as loadWorld gives it: maps and places in the new shape, none of
 * today's. Published, so graded: places in the new shape open when written.
 *
 *   Andor sector (region, light-years; jump lanes at 2 ly an hour, round the clock)
 *     Vega (40, 30)    opens Vega          — jump to Sol, Rigel, Deneb
 *     Sol (60, 30)     opens Sol           — jump to Vega
 *     Rigel (40, 60)   no map below (MP6)  — jump to Vega
 *     Deneb (10, 10)   not written: closed — jump to Vega
 *   Vega (region, AU; sublight at 5 AU an hour, round the clock)
 *     Vega Gate (95, 50)   its way in and out — to the station and the outpost
 *     Vega Station (50, 50) opens the station
 *     The Outpost (50, 90)  not written: closed
 *   Vega Station (area, 300 m)
 *     The Airlock (500, 950)  its way in and out
 *     The Dock (500, 500)     opens the deck
 *   The deck (grid 12 × 8): in at (1, 4), out by the airlock door at (0, 4)
 *   Sol (region, AU; sublight at 5 AU an hour)
 *     Sol Gate (5, 50)   its way in and out
 *     Sol Port (50, 50)  no map; the old jump gate leads to Rigel in an hour (TV3)
 */

const written = (name) => ({
  description: name + ', described for play.',
  sources: { description: 'mcp' },
});

function andorWorld(id = 'andor') {
  const place = (mapId, name, at, extra = {}) => ({ mapId, name, at, ...written(name), ...extra });
  const link = (...ids) => ids.map(([placeId, kind]) => ({ placeId, kind }));
  return {
    id,
    name: 'Andor',
    tagline: '',
    openingHook: '',
    status: 'published',
    canonVersion: 1,
    map: null,
    rules: { startingLocationId: 'pl_rigel' },
    topMapId: 'sector',
    maps: {
      sector: {
        kind: 'region',
        parent: null,
        name: 'Andor sector',
        space: { width: 100, height: 100, distance: { unit: 'ly', perUnit: 1 } },
        routeKinds: { jump: { speed: 2, roundTheClock: true } },
      },
      vega: {
        kind: 'region',
        parent: { mapId: 'sector', placeId: 'pl_vega' },
        name: 'Vega',
        space: { width: 100, height: 100, distance: { unit: 'AU', perUnit: 1 } },
        routeKinds: { sublight: { speed: 5, roundTheClock: true } },
      },
      station: {
        kind: 'area',
        parent: { mapId: 'vega', placeId: 'pl_station' },
        name: 'Vega Station',
        space: { width: 1000, height: 1000, size: 300 },
      },
      deck: {
        kind: 'grid',
        parent: { mapId: 'station', placeId: 'pl_dock' },
        name: 'The deck',
        space: { width: 12, height: 8, squareSize: 1.5 },
        entries: [{ id: 'e1', name: 'The gangway', x: 1, y: 4 }],
        exits: [{ id: 'x1', name: 'The airlock door', x: 0, y: 4 }],
      },
      sol: {
        kind: 'region',
        parent: { mapId: 'sector', placeId: 'pl_sol' },
        name: 'Sol',
        space: { width: 100, height: 100, distance: { unit: 'AU', perUnit: 1 } },
        routeKinds: { sublight: { speed: 5, roundTheClock: true } },
      },
    },
    mapPlaces: {
      pl_vega: place(
        'sector',
        'Vega',
        { x: 40, y: 30 },
        {
          opens: { mapId: 'vega' },
          links: link(['pl_sol', 'jump'], ['pl_rigel', 'jump'], ['pl_deneb', 'jump']),
        }
      ),
      pl_sol: place('sector', 'Sol', { x: 60, y: 30 }, { opens: { mapId: 'sol' } }),
      pl_rigel: place('sector', 'Rigel', { x: 40, y: 60 }),
      pl_deneb: { mapId: 'sector', name: 'Deneb', at: { x: 10, y: 10 } },
      pl_vega_gate: place(
        'vega',
        'Vega Gate',
        { x: 95, y: 50 },
        { entrance: true, links: link(['pl_station', 'sublight'], ['pl_outpost', 'sublight']) }
      ),
      pl_station: place('vega', 'Vega Station', { x: 50, y: 50 }, { opens: { mapId: 'station' } }),
      pl_outpost: { mapId: 'vega', name: 'The Outpost', at: { x: 50, y: 90 } },
      pl_airlock: place(
        'station',
        'The Airlock',
        { x: 500, y: 950 },
        { entrance: { via: [] }, links: link(['pl_dock', null]) }
      ),
      pl_dock: place('station', 'The Dock', { x: 500, y: 500 }, { opens: { mapId: 'deck' } }),
      pl_sol_gate: place(
        'sol',
        'Sol Gate',
        { x: 5, y: 50 },
        { entrance: true, links: link(['pl_sol_port', 'sublight']) }
      ),
      pl_sol_port: place(
        'sol',
        'Sol Port',
        { x: 50, y: 50 },
        { exits: [{ placeId: 'pl_rigel', seconds: 3600, name: 'the old jump gate' }] }
      ),
    },
    locations: {},
    places: {},
    battleMaps: {},
    factions: {},
    characters: {},
    lore: {},
    regions: {},
    statBlocks: {},
  };
}

/**
 * Andor with templates (L-906): two moons of Sol, Io and Europa, each using
 * the template "a barren moon" (a grid: land at (1, 3), a hatch above it, a
 * lift out), and a template hamlet (an area map) whose market rolls its stall.
 */
function andorWithTemplates(id = 'andor-templates') {
  const w = andorWorld(id);
  w.maps.tpl_moon = {
    kind: 'grid',
    template: true,
    parent: null,
    name: 'The surface of {place}',
    space: { width: 8, height: 6, squareSize: 1.5 },
    entries: [{ id: 'land', x: 1, y: 3 }],
    exits: [{ id: 'lift', name: 'the lift', x: 0, y: 3 }],
    doors: [{ id: 'hatch', name: 'the hatch', from: { x: 1, y: 3 }, to: { x: 2, y: 3 } }],
    features: [{ id: 'beacon', name: 'the beacon', x: 5, y: 2 }],
  };
  w.maps.tpl_hamlet = {
    kind: 'area',
    template: true,
    parent: null,
    name: '{place}',
    space: { width: 1000, height: 1000, size: 200 },
  };
  w.mapPlaces.tpl_hamlet_gate = {
    mapId: 'tpl_hamlet',
    name: 'The gate of {place}',
    kind: 'gate',
    at: { x: 500, y: 950 },
    entrance: { via: [] },
    description: 'The way into {place}.',
    links: [{ placeId: 'tpl_hamlet_market' }],
  };
  w.mapPlaces.tpl_hamlet_market = {
    mapId: 'tpl_hamlet',
    name: 'The market',
    kind: 'market',
    at: { x: 500, y: 500 },
    description: 'In {place}, {stall} keeps the square.',
    fill: { stall: ['a smithy', 'a chandler', 'a bakery', 'a cooper', 'a tannery', 'a weaver'] },
    links: [{ placeId: 'tpl_hamlet_gate' }],
  };
  const moon = (name, at) => ({
    mapId: 'sol',
    name,
    kind: 'moon',
    at,
    opens: { template: 'tpl_moon' },
    links: [{ placeId: 'pl_sol_gate', kind: 'sublight' }],
  });
  w.mapPlaces.pl_io = moon('Io', { x: 10, y: 20 });
  w.mapPlaces.pl_europa = moon('Europa', { x: 10, y: 80 });
  return w;
}

module.exports = { andorWorld, andorWithTemplates };
