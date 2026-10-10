'use strict';

/**
 * A town's real size (planning/the-loom-movement-and-vision.md §7; L-651 /
 * #463): the metres a settlement's 0–1000 town square spans, by default from
 * its size (population, a capital one size larger) or as Claude set it, and
 * distances between town points in metres. Pure; no emulator (setting it over
 * MCP is in cartographer-mcp-town.test.js).
 *
 * Run: cd tests && npx jest loom-town-size --verbose
 */

const { townSize, townMetres, TOWN_SIZES } = require('../functions/loom-canon/town');

const settlement = (geo, town) => ({
  id: 'loc_1',
  name: 'Burdendal',
  geo: { kind: 'settlement', x: 100, y: 100, ...geo },
  ...(town ? { town } : {}),
});

describe('the default size, by population', () => {
  test.each([
    [0, 'village', 300],
    [999, 'village', 300],
    [1000, 'town', 600],
    [9999, 'town', 600],
    [10000, 'city', 1200],
    [30000, 'great city', 2500],
    [250000, 'great city', 2500],
  ])('population %i: a %s, %i m across', (population, tier, metres) => {
    expect(TOWN_SIZES[tier]).toBe(metres);
    expect(townSize(settlement({ population }))).toEqual({ metres, set: false });
  });

  test('no population counts as a village', () => {
    expect(townSize(settlement({}))).toEqual({ metres: 300, set: false });
  });
});

describe('a capital is one size larger', () => {
  test.each([
    [500, 600],
    [5000, 1200],
    [20000, 2500],
    [50000, 2500], // no size above a great city
  ])('a capital of %i: %i m', (population, metres) => {
    expect(townSize(settlement({ population, capital: true }))).toEqual({ metres, set: false });
  });
});

describe('a size Claude set', () => {
  test('wins over the default', () => {
    expect(townSize(settlement({ population: 5000 }, { size: 900 }))).toEqual({
      metres: 900,
      set: true,
    });
  });

  test('a missing or nonsense size falls back to the default', () => {
    for (const size of [undefined, null, 0, -5, 'big', NaN]) {
      expect(townSize(settlement({ population: 5000 }, { size }))).toEqual({
        metres: 600,
        set: false,
      });
    }
  });
});

describe('distances in metres', () => {
  test('half the square across a town is 300 m', () => {
    const s = settlement({ population: 5000 });
    expect(townMetres(s, { x: 0, y: 500 }, { x: 500, y: 500 })).toBe(300);
  });

  test('diagonals and set sizes', () => {
    const s = settlement({ population: 5000 }, { size: 1000 });
    expect(townMetres(s, { x: 0, y: 0 }, { x: 300, y: 400 })).toBe(500);
    expect(townMetres(s, { x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });

  test('the same points are further apart in a bigger place', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 900, y: 100 };
    const village = townMetres(settlement({ population: 200 }), a, b);
    const city = townMetres(settlement({ population: 20000 }), a, b);
    expect(village).toBe(240);
    expect(city).toBe(960);
  });
});
