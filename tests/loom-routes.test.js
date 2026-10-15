'use strict';

/**
 * Route lengths (planning/the-loom-game-time.md §4.2, T6, T7; L-372 / #500):
 * functions/loom-canon/routes.js. Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-routes --verbose
 */

const routes = require('../functions/loom-canon/routes');

const place = (id, x, y) => ({ id, name: id, geo: x === undefined ? {} : { x, y } });
const world = (distance, ...locations) => ({
  id: 'w',
  map: distance === undefined ? { width: 1000, height: 800 } : { distance },
  locations: Object.fromEntries(locations.map((l) => [l.id, l])),
});

// Nisia's Hatham and Daldockley, at 2 mi a map unit.
const hatham = place('hatham', 153, 615.13);
const daldockley = place('daldockley', 156.55, 611.7);
const nisia = world({ unit: 'mi', perMapUnit: 2 }, hatham, daldockley);

test("Hatham to Daldockley: about 12 miles (the map's line, scaled, × 1.25 for winding)", () => {
  const miles = routes.routeMiles(nisia, hatham, daldockley);
  expect(miles).toBeCloseTo(Math.hypot(3.55, 3.43) * 2 * 1.25, 6);
  expect(miles).toBeGreaterThan(12);
  expect(miles).toBeLessThan(12.5);
  expect(routes.roundMiles(miles)).toBe(12);
});

test('by ids too, and the same both ways', () => {
  const there = routes.routeMiles(nisia, 'hatham', 'daldockley');
  expect(there).toBe(routes.routeMiles(nisia, hatham, daldockley));
  expect(routes.routeMiles(nisia, 'daldockley', 'hatham')).toBeCloseTo(there, 9);
});

test("a world with no scale takes the default, Azgaar's 3 mi a map unit", () => {
  const a = place('a', 0, 0);
  const b = place('b', 3, 4); // 5 map units
  expect(routes.DEFAULT_MILES_PER_MAP_UNIT).toBe(3);
  expect(routes.routeMiles(world(undefined, a, b), a, b)).toBeCloseTo(5 * 3 * 1.25, 9);
  expect(routes.routeMiles({ locations: {} }, a, b)).toBeCloseTo(18.75, 9);
  // A scale that can't be read is no scale.
  for (const distance of [
    { unit: 'mi', perMapUnit: 0 },
    { unit: 'mi', perMapUnit: -2 },
    { unit: 'mi' },
    { unit: 'paces', perMapUnit: 2 },
    null,
  ]) {
    expect(routes.milesPerMapUnit(world(distance, a, b))).toBe(3);
  }
});

test("a map in other units is turned into miles", () => {
  expect(routes.milesPerMapUnit(world({ unit: 'km', perMapUnit: 5 }))).toBeCloseTo(3.106855, 5);
  expect(routes.milesPerMapUnit(world({ unit: 'lg', perMapUnit: 1 }))).toBe(3);
  expect(routes.milesPerMapUnit(world({ unit: 'nmi', perMapUnit: 2 }))).toBeCloseTo(2.30156, 5);
  expect(routes.milesPerMapUnit(world({ unit: 'MI', perMapUnit: 2 }))).toBe(2);
});

test('a missing position gives no length rather than a wrong one', () => {
  const nowhere = place('nowhere');
  const half = { id: 'half', geo: { x: 10 } };
  const w = world({ unit: 'mi', perMapUnit: 2 }, hatham, nowhere, half);
  expect(routes.routeMiles(w, hatham, nowhere)).toBeNull();
  expect(routes.routeMiles(w, nowhere, hatham)).toBeNull();
  expect(routes.routeMiles(w, hatham, half)).toBeNull();
  expect(routes.routeMiles(w, hatham, 'not-a-place')).toBeNull();
  expect(routes.routeMiles(w, hatham, { id: 'x', geo: { x: NaN, y: 1 } })).toBeNull();
  expect(routes.roundMiles(null)).toBeNull();
});

test('miles for people: tenths under 10, whole miles from there', () => {
  expect(routes.roundMiles(0.04)).toBe(0);
  expect(routes.roundMiles(2.46)).toBe(2.5);
  expect(routes.roundMiles(9.94)).toBe(9.9);
  expect(routes.roundMiles(12.34)).toBe(12);
  expect(routes.roundMiles(19.5)).toBe(20);
});
