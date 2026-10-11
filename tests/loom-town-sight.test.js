'use strict';

/**
 * Sight and memory in town (planning/the-loom-movement-and-vision.md §9;
 * L-671 / #473): what can be seen from a point on a town's street (town-
 * paths.js inSight: about 100 m, buildings and walls block, water doesn't),
 * and what a save remembers of a town (functions/loom-turn/town-seen.js).
 * Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-town-sight --verbose
 */

const paths = require('../functions/loom-canon/town-paths');
const seen = require('../functions/loom-turn/town-seen');

const pt = (x, y) => ({ x, y });
const rect = (x0, y0, x1, y1) => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)];
const at = (grid, p) => grid[Math.floor(p.y / paths.CELL) * 200 + Math.floor(p.x / paths.CELL)];
const count = (grid) => grid.reduce((n, v) => n + v, 0);

const GROUND = {
  buildings: [{ name: 'the hall', points: rect(400, 400, 600, 600) }],
  water: [{ name: 'the river', points: rect(0, 700, 1000, 750) }],
  walls: [{ name: 'the wall', points: [pt(100, 0), pt(100, 450)] }],
  crossings: [],
};

describe('sight', () => {
  test('about 100 m: the radius in town units comes from the town’s size', () => {
    expect(paths.sightRadius(1000)).toBe(100);
    expect(paths.sightRadius(600)).toBeCloseTo(166.67, 2);
    expect(paths.sightRadius(2500)).toBe(40);
    expect(seen.radiusIn({ geo: { kind: 'settlement', population: 5000 } })).toBeCloseTo(166.67, 2);
  });

  test('on open ground, a disc of that radius', () => {
    const grid = paths.inSight(null, pt(500, 200), 100);
    expect(at(grid, pt(500, 200))).toBe(1);
    expect(at(grid, pt(590, 200))).toBe(1);
    expect(at(grid, pt(500, 112))).toBe(1);
    expect(at(grid, pt(615, 200))).toBe(0);
    expect(at(grid, pt(570, 270))).toBe(0); // 99 units away on the diagonal: just past
    // About π r² of 5-unit squares.
    expect(count(grid)).toBeGreaterThan(1150);
    expect(count(grid)).toBeLessThan(1350);
  });

  test('a building blocks what is behind it, but its front is seen', () => {
    const grid = paths.inSight(GROUND, pt(500, 300), 333);
    expect(at(grid, pt(500, 402))).toBe(1); // its front
    expect(at(grid, pt(500, 500))).toBe(0); // inside
    expect(at(grid, pt(500, 620))).toBe(0); // behind it
    expect(at(grid, pt(250, 450))).toBe(1); // off to its side, in clear line
  });

  test('a wall blocks; past its end, sight goes on', () => {
    const grid = paths.inSight(GROUND, pt(200, 300), 400);
    expect(at(grid, pt(50, 300))).toBe(0);
    expect(at(grid, pt(50, 600))).toBe(1); // in line below the wall's end
  });

  test('water doesn’t block sight', () => {
    const grid = paths.inSight(GROUND, pt(800, 680), 333);
    expect(at(grid, pt(800, 725))).toBe(1);
    expect(at(grid, pt(800, 800))).toBe(1);
  });

  test('a look is quick', () => {
    const started = Date.now();
    for (let i = 0; i < 10; i++) paths.inSight(GROUND, pt(300 + i * 10, 300), 333);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('memory', () => {
  test('packs a town’s squares compactly, and back', () => {
    const grid = paths.inSight(GROUND, pt(500, 300), 333);
    const packed = seen.pack(grid);
    expect(packed.length).toBe(6668);
    expect(Array.from(seen.unpack(packed))).toEqual(Array.from(grid));
  });

  test('along a walk: seen from its points and between them', () => {
    const radius = 100;
    const along = seen.sightAlong(null, [pt(100, 100), pt(900, 100)], radius);
    for (let x = 100; x <= 900; x += 50) expect(at(along, pt(x, 150))).toBe(1);
    expect(at(along, pt(500, 230))).toBe(0);
  });

  test('a record without the right grid counts as nothing seen', () => {
    expect(count(seen.squaresOf(null))).toBe(0);
    expect(count(seen.squaresOf({ side: 100, squares: 'AAAA' }))).toBe(0);
  });
});
