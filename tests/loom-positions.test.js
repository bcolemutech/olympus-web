'use strict';

/**
 * Where every character is (functions/loom-canon/positions.js; planning/
 * the-loom-movement-and-vision.md §6a; L-681 / #513): one position at the
 * most precise level that applies — a square on a battle map, a town point,
 * or a world point in the wilderness — and every way one can be wrong.
 *
 * Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-positions --verbose
 */

const { positionOf, levelFor } = require('../functions/loom-canon/positions');

const INN = {
  id: 'bm_inn',
  name: 'The Gull & Anchor',
  width: 8,
  height: 6,
  entries: [{ id: 'door', x: 1, y: 3 }],
  exits: [{ id: 'out', name: 'the front door', x: 0, y: 3, to: 'out' }],
  features: [],
  obstacles: [{ id: 'table', name: 'a table', kind: 'low', x: 4, y: 1 }],
};
const RUIN = { ...INN, id: 'bm_ruin', name: 'The ruin' };

// Burdendal (a town) with an inn (its own map) and a market (no map yet); a
// ruin with a map, a well without one; the world map 1000 × 600.
const WORLD = {
  map: { width: 1000, height: 600 },
  locations: {
    loc_1: { id: 'loc_1', name: 'Burdendal', geo: { kind: 'settlement', x: 100, y: 100 } },
    poi_ruin: {
      id: 'poi_ruin',
      name: 'The ruin',
      geo: { kind: 'poi', x: 300, y: 200 },
      battleMap: { mapId: 'bm_ruin' },
    },
    poi_well: { id: 'poi_well', name: 'The old well', geo: { kind: 'poi', x: 400, y: 250 } },
  },
  places: {
    plc_inn: {
      id: 'plc_inn',
      locationId: 'loc_1',
      name: 'The Gull & Anchor',
      battleMap: { mapId: 'bm_inn' },
    },
    plc_market: { id: 'plc_market', locationId: 'loc_1', name: 'Market Square' },
  },
  battleMaps: { bm_inn: INN, bm_ruin: RUIN },
  characters: {
    chr_mags: {
      id: 'chr_mags',
      name: 'Old Mags',
      locationId: 'loc_1',
      placeId: 'plc_inn',
      cell: { x: 3, y: 4 },
    },
  },
};
const someone = (fields) => ({ id: 'chr_new', name: 'Wim', ...fields });
const problemOf = (fields, world = WORLD) => positionOf(world, someone(fields)).problem;

describe('the level that applies', () => {
  test('a place or point of interest with a map: a square', () => {
    expect(levelFor(WORLD, someone({ locationId: 'loc_1', placeId: 'plc_inn' }))).toMatchObject({
      level: 'square',
      map: INN,
    });
    expect(levelFor(WORLD, someone({ locationId: 'poi_ruin' }))).toMatchObject({
      level: 'square',
      map: RUIN,
    });
  });

  test('about a settlement, or at a place in town with no map: a town point', () => {
    expect(levelFor(WORLD, someone({ locationId: 'loc_1' }))).toMatchObject({
      level: 'town',
      place: null,
    });
    expect(levelFor(WORLD, someone({ locationId: 'loc_1', placeId: 'plc_market' }))).toMatchObject({
      level: 'town',
      place: WORLD.places.plc_market,
    });
  });

  test('a point of interest without a map: its own position; no location: the wilderness', () => {
    expect(levelFor(WORLD, someone({ locationId: 'poi_well' }))).toMatchObject({ level: 'here' });
    expect(levelFor(WORLD, someone({}))).toEqual({ level: 'world' });
  });
});

describe('a position at each level', () => {
  test('a square on the map of their place', () => {
    expect(positionOf(WORLD, WORLD.characters.chr_mags)).toEqual({
      level: 'square',
      host: WORLD.places.plc_inn,
      map: INN,
      cell: { x: 3, y: 4 },
    });
  });

  test('a town point, about town or at a place with no map', () => {
    expect(
      positionOf(WORLD, someone({ locationId: 'loc_1', townPoint: { x: 500, y: 1000 } }))
    ).toEqual({
      level: 'town',
      settlement: WORLD.locations.loc_1,
      place: null,
      point: { x: 500, y: 1000 },
    });
    expect(
      positionOf(
        WORLD,
        someone({ locationId: 'loc_1', placeId: 'plc_market', townPoint: { x: 0, y: 12.5 } })
      )
    ).toMatchObject({ level: 'town', place: WORLD.places.plc_market, point: { x: 0, y: 12.5 } });
  });

  test('at a point of interest without a map, its own position counts: nothing to carry', () => {
    expect(positionOf(WORLD, someone({ locationId: 'poi_well' }))).toEqual({
      level: 'world',
      point: { x: 400, y: 250 },
      location: WORLD.locations.poi_well,
    });
  });

  test('a world point in the wilderness, with no location', () => {
    expect(positionOf(WORLD, someone({ worldPoint: { x: 1000, y: 0 } }))).toEqual({
      level: 'world',
      point: { x: 1000, y: 0 },
      location: null,
    });
  });
});

describe('every way a position can be wrong', () => {
  test('none at all, at each level', () => {
    expect(problemOf({ locationId: 'loc_1', placeId: 'plc_inn' })).toBe(
      'The Gull & Anchor has a battle map: they need a square (cell)'
    );
    expect(problemOf({ locationId: 'loc_1' })).toBe(
      'Burdendal is a town: they need a town point (townPoint)'
    );
    expect(problemOf({ locationId: 'loc_1', placeId: 'plc_market' })).toBe(
      'Market Square in Burdendal has no battle map: they need a town point (townPoint)'
    );
    expect(problemOf({})).toBe('they are in the wilderness: they need a world point (worldPoint)');
  });

  test('exactly one: two are refused', () => {
    expect(
      problemOf({ locationId: 'loc_1', townPoint: { x: 1, y: 1 }, worldPoint: { x: 1, y: 1 } })
    ).toBe('they have more than one (townPoint, worldPoint); keep only one');
  });

  test('the wrong level for where they are', () => {
    expect(problemOf({ locationId: 'poi_ruin', townPoint: { x: 1, y: 1 } })).toBe(
      'The ruin has a battle map, so they need a cell, not a townPoint'
    );
    expect(problemOf({ locationId: 'loc_1', cell: { x: 2, y: 2 } })).toBe(
      'Burdendal is a town, so they need a townPoint, not a cell'
    );
    expect(problemOf({ worldPoint: undefined, townPoint: { x: 1, y: 1 } })).toBe(
      'they are in the wilderness, so they need a worldPoint, not a townPoint'
    );
    expect(problemOf({ locationId: 'poi_well', worldPoint: { x: 1, y: 1 } })).toBe(
      'The old well has no battle map, so its own position counts; drop their worldPoint'
    );
  });

  test('a square off the grid, on something that blocks, on an exit, or taken', () => {
    const square = (cell) => problemOf({ locationId: 'loc_1', placeId: 'plc_inn', cell });
    expect(square({ x: 8, y: 0 })).toBe('their square won’t do: (8, 0) is off the 8 × 6 grid');
    expect(square({ x: 4, y: 1 })).toBe('their square won’t do: (4, 1) is a table (low)');
    expect(square({ x: 0, y: 3 })).toBe('their square won’t do: (0, 3) is the front door, an exit');
    expect(square({ x: 3, y: 4 })).toBe(
      'their square won’t do: Old Mags (chr_mags) already stands at (3, 4)'
    );
    // The same square on the ruin's map is another place: free.
    expect(positionOf(WORLD, someone({ locationId: 'poi_ruin', cell: { x: 3, y: 4 } })).level).toBe(
      'square'
    );
  });

  test('a town point outside the 0–1000 square, or not a point', () => {
    for (const townPoint of [
      { x: -1, y: 5 },
      { x: 5, y: 1001 },
      { x: 'a', y: 1 },
    ]) {
      expect(problemOf({ locationId: 'loc_1', townPoint })).toBe(
        'their town point must be within 0–1000 each way'
      );
    }
  });

  test('a world point off the world map, or a world without one', () => {
    expect(problemOf({ worldPoint: { x: 1001, y: 5 } })).toBe(
      'their world point (1001, 5) must be on the 1000 × 600 world map'
    );
    expect(problemOf({ worldPoint: { x: 5 } })).toBe(
      'their world point must be on the 1000 × 600 world map'
    );
    expect(problemOf({ worldPoint: { x: 5, y: 5 } }, { ...WORLD, map: null })).toBe(
      'the world has no map'
    );
  });

  test('a point of interest without coordinates; a location or place that does not exist', () => {
    const world = {
      ...WORLD,
      locations: { ...WORLD.locations, poi_well: { id: 'poi_well', name: 'The old well' } },
    };
    expect(problemOf({ locationId: 'poi_well' }, world)).toBe('The old well has no coordinates');
    expect(problemOf({ locationId: 'loc_404' })).toBe('their location "loc_404" does not exist');
    expect(problemOf({ locationId: 'loc_1', placeId: 'plc_404' })).toBe(
      'their place "plc_404" does not exist'
    );
  });
});
