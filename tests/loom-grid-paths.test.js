'use strict';

/**
 * Grid paths (functions/loom-canon/grid-paths.js; planning/the-loom-movement-
 * and-vision.md §3; L-612 / #442): the cheapest path on a battle map's grid,
 * the squares in reach of a budget, and how far a budget walks a path; the
 * diagonal rule, the edges, the cost hook, the tie-breaks, and the browser's
 * copy. Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-grid-paths --verbose
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const paths = require('../functions/loom-canon/grid-paths');

const TAVERN = { width: 12, height: 8 };
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const squares = (list) => list.map((s) => [s.x, s.y]);
// Blocks the squares listed, as walls and obstacles will (L-624).
const blocking = (...blocked) => ({
  cost: (from, to) => (blocked.some(([x, y]) => to.x === x && to.y === y) ? Infinity : 1),
});

describe('pathTo', () => {
  test('on open ground, the cost is the larger of the two distances: diagonals cost 1', () => {
    for (let x = 0; x < 6; x++) {
      for (let y = 0; y < 5; y++) {
        const to = { x, y };
        expect(paths.pathTo(TAVERN, { x: 2, y: 1 }, to).cost).toBe(chebyshev({ x: 2, y: 1 }, to));
      }
    }
    expect(paths.pathTo(TAVERN, { x: 0, y: 0 }, { x: 3, y: 3 })).toEqual({
      path: [
        { x: 1, y: 1, cost: 1 },
        { x: 2, y: 2, cost: 2 },
        { x: 3, y: 3, cost: 3 },
      ],
      cost: 3,
    });
  });

  test('each step is to a square next to the last, and costs run up one a step', () => {
    const { path: walk } = paths.pathTo(TAVERN, { x: 0, y: 7 }, { x: 11, y: 0 });
    let at = { x: 0, y: 7 };
    walk.forEach((step, i) => {
      expect(chebyshev(at, step)).toBe(1);
      expect(step.cost).toBe(i + 1);
      at = step;
    });
    expect(at).toMatchObject({ x: 11, y: 0 });
  });

  test('straight steps over diagonals where they cost the same', () => {
    expect(squares(paths.pathTo(TAVERN, { x: 1, y: 4 }, { x: 6, y: 4 }).path)).toEqual([
      [2, 4],
      [3, 4],
      [4, 4],
      [5, 4],
      [6, 4],
    ]);
  });

  test('of the cheapest, it keeps closest to the straight line', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 11, y: 7 };
    const { path: walk } = paths.pathTo(TAVERN, from, to);
    const stray = (s) => Math.abs(11 * s.y - 7 * s.x) / Math.hypot(11, 7);
    expect(Math.max(...walk.map(stray))).toBeLessThan(1);
    expect(squares(walk)).toEqual([
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 3],
      [6, 4],
      [7, 4],
      [8, 5],
      [9, 6],
      [10, 6],
      [11, 7],
    ]);
  });

  test('the same path every time', () => {
    const once = paths.pathTo(TAVERN, { x: 1, y: 6 }, { x: 10, y: 2 });
    for (let i = 0; i < 5; i++) {
      expect(paths.pathTo(TAVERN, { x: 1, y: 6 }, { x: 10, y: 2 })).toEqual(once);
    }
  });

  test('standing on it, the path is empty', () => {
    expect(paths.pathTo(TAVERN, { x: 4, y: 4 }, { x: 4, y: 4 })).toEqual({ path: [], cost: 0 });
  });

  test('off the grid, there is no path', () => {
    expect(paths.pathTo(TAVERN, { x: 0, y: 0 }, { x: 12, y: 0 })).toBeNull();
    expect(paths.pathTo(TAVERN, { x: 0, y: 0 }, { x: 0, y: -1 })).toBeNull();
    expect(paths.pathTo(TAVERN, { x: -1, y: 0 }, { x: 3, y: 3 })).toBeNull();
  });

  test('the cost hook: blocked squares are gone around, and through a gap', () => {
    // A wall of blocked squares down column 5, with a gap at (5, 6).
    const wall = blocking([5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 5], [5, 7]);
    const found = paths.pathTo(TAVERN, { x: 2, y: 2 }, { x: 8, y: 2 }, wall);
    expect(squares(found.path)).toContainEqual([5, 6]);
    expect(found.path.some((s) => s.x === 5 && s.y !== 6)).toBe(false);
    expect(found.cost).toBe(8);
  });

  test('a square no way leads to has no path', () => {
    const boxed = blocking([7, 3], [8, 3], [9, 3], [7, 4], [9, 4], [7, 5], [8, 5], [9, 5]);
    expect(paths.pathTo(TAVERN, { x: 1, y: 1 }, { x: 8, y: 4 }, boxed)).toBeNull();
  });

  test('a dearer square is gone around when that costs less, and crossed when not', () => {
    const mud = (x, y) => ({ cost: (from, to) => (to.x === x && to.y === y ? 2 : 1) });
    expect(
      squares(paths.pathTo(TAVERN, { x: 1, y: 4 }, { x: 3, y: 4 }, mud(2, 4)).path)
    ).not.toContainEqual([2, 4]);
    // In a corridor one square wide, the mud must be crossed.
    const corridor = {
      cost: (from, to) => (to.y !== 0 ? Infinity : to.x === 2 ? 2 : 1),
    };
    expect(paths.pathTo(TAVERN, { x: 0, y: 0 }, { x: 4, y: 0 }, corridor).cost).toBe(5);
  });

  test('a cost hook that answers nonsense blocks the step', () => {
    for (const bad of [0, -1, NaN, '1', null, undefined]) {
      const hook = { cost: (from, to) => (to.x === 1 && to.y === 0 ? bad : 1) };
      const found = paths.pathTo({ width: 3, height: 1 }, { x: 0, y: 0 }, { x: 2, y: 0 }, hook);
      expect(found).toBeNull();
    }
  });
});

describe('reach', () => {
  test('every square within the budget, with its cost, cheapest first', () => {
    const within = paths.reach(TAVERN, { x: 5, y: 4 }, 2);
    expect(within).toHaveLength(24); // a 5 × 5 square, less where you stand
    within.forEach((s) => expect(s.cost).toBe(chebyshev({ x: 5, y: 4 }, s)));
    expect(within.slice(0, 3)).toEqual([
      { x: 4, y: 3, cost: 1 },
      { x: 5, y: 3, cost: 1 },
      { x: 6, y: 3, cost: 1 },
    ]);
    const costs = within.map((s) => s.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  test('the edges cut it short', () => {
    expect(squares(paths.reach(TAVERN, { x: 0, y: 0 }, 1))).toEqual([
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(paths.reach(TAVERN, { x: 0, y: 0 }, 20)).toHaveLength(12 * 8 - 1);
  });

  test('nothing within a budget of 0, and nothing from off the grid', () => {
    expect(paths.reach(TAVERN, { x: 3, y: 3 }, 0)).toEqual([]);
    expect(paths.reach(TAVERN, { x: 30, y: 3 }, 5)).toEqual([]);
  });

  test('blocked squares, and what lies only beyond them, are out of reach', () => {
    // A box around (8, 4): out of reach however large the budget.
    const boxed = blocking([7, 3], [8, 3], [9, 3], [7, 4], [9, 4], [7, 5], [8, 5], [9, 5]);
    const within = squares(paths.reach(TAVERN, { x: 1, y: 1 }, 20, boxed));
    expect(within).not.toContainEqual([8, 4]);
    expect(within).not.toContainEqual([7, 3]);
  });

  test('a dearer square uses more of the budget', () => {
    const mud = { cost: (from, to) => (to.x === 1 ? 2 : 1) };
    const corridor = { width: 4, height: 1 };
    expect(paths.reach(corridor, { x: 0, y: 0 }, 2, mud)).toEqual([{ x: 1, y: 0, cost: 2 }]);
  });
});

describe('avoid: squares stepped onto, never through (exits; L-615)', () => {
  // A corridor of 5 with an exit in the middle, at (2, 0).
  const corridor = { width: 5, height: 1 };
  const exit = { avoid: [{ x: 2, y: 0 }] };

  test('a path can end on one', () => {
    expect(paths.pathTo(corridor, { x: 0, y: 0 }, { x: 2, y: 0 }, exit).cost).toBe(2);
  });

  test('but never goes through one', () => {
    expect(paths.pathTo(corridor, { x: 0, y: 0 }, { x: 4, y: 0 }, exit)).toBeNull();
    // With room around it, the path goes around.
    const room = paths.pathTo(TAVERN, { x: 0, y: 3 }, { x: 0, y: 5 }, { avoid: [{ x: 0, y: 4 }] });
    expect(squares(room.path)).toEqual([
      [1, 4],
      [0, 5],
    ]);
  });

  test('reach includes it, and nothing beyond', () => {
    expect(squares(paths.reach(corridor, { x: 0, y: 0 }, 4, exit))).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });

  test('standing on one, you can set out from it', () => {
    expect(paths.pathTo(corridor, { x: 2, y: 0 }, { x: 4, y: 0 }, exit).cost).toBe(2);
  });
});

describe('walk', () => {
  const { path: line } = paths.pathTo(TAVERN, { x: 0, y: 4 }, { x: 11, y: 4 });

  test('a budget that covers the path walks all of it', () => {
    expect(paths.walk(line, 20)).toEqual({ walked: line, spent: 11, rest: [] });
  });

  test('a short budget stops partway; the rest is a fresh plan for next turn', () => {
    const { walked, spent, rest } = paths.walk(line, 4);
    expect(squares(walked)).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
    expect(spent).toBe(4);
    expect(rest[0]).toEqual({ x: 5, y: 4, cost: 1 });
    expect(rest.at(-1)).toEqual({ x: 11, y: 4, cost: 7 });
  });

  test('no budget, no step', () => {
    expect(paths.walk(line, 0)).toEqual({ walked: [], spent: 0, rest: line });
  });

  test('a step dearer than what is left waits for the next turn', () => {
    const mud = { cost: (from, to) => (to.x === 3 ? 2 : 1) };
    const corridor = { width: 6, height: 1 };
    const { path: walk } = paths.pathTo(corridor, { x: 0, y: 0 }, { x: 5, y: 0 }, mud);
    const { walked, spent, rest } = paths.walk(walk, 3);
    expect(squares(walked)).toEqual([
      [1, 0],
      [2, 0],
    ]);
    expect(spent).toBe(2);
    expect(rest[0]).toEqual({ x: 3, y: 0, cost: 2 });
  });

  test('stop ends the walk on the step it names (L-642)', () => {
    const { walked, spent, rest } = paths.walk(line, 20, { stop: (step) => step.x === 3 });
    expect(squares(walked)).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
    ]);
    expect(spent).toBe(3);
    expect(rest[0]).toEqual({ x: 4, y: 4, cost: 1 });
  });

  test('a walk never ends where it may not stand: it backs off (L-642)', () => {
    const { walked, spent, rest } = paths.walk(line, 4, {
      stand: (step) => step.x !== 4 && step.x !== 3,
    });
    expect(squares(walked)).toEqual([
      [1, 4],
      [2, 4],
    ]);
    expect(spent).toBe(2);
    expect(rest[0]).toEqual({ x: 3, y: 4, cost: 1 });
    // Passing through such squares is fine.
    expect(paths.walk(line, 20, { stand: (step) => step.x !== 4 }).walked).toEqual(line);
  });
});

describe("the browser's copy", () => {
  const served = path.join(__dirname, '../public/apps/loom/js/grid-paths.js');

  test('is identical to the server’s', () => {
    expect(fs.readFileSync(served, 'utf8')).toBe(
      fs.readFileSync(path.join(__dirname, '../functions/loom-canon/grid-paths.js'), 'utf8')
    );
  });

  test('loads in a page as Loom.gridPaths, and finds the same paths', () => {
    const page = { window: {} };
    page.window.Loom = { state: {} };
    vm.runInNewContext(fs.readFileSync(served, 'utf8'), page);
    const browser = page.window.Loom.gridPaths;
    expect(Object.keys(browser)).toEqual(['pathTo', 'reach', 'walk']);
    expect(browser.pathTo(TAVERN, { x: 1, y: 6 }, { x: 10, y: 2 })).toEqual(
      paths.pathTo(TAVERN, { x: 1, y: 6 }, { x: 10, y: 2 })
    );
    expect(page.window.Loom.state).toEqual({}); // the namespace is kept
  });

  test('the Loom page loads it', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/apps/loom/index.html'), 'utf8');
    expect(html).toContain('<script src="/apps/loom/js/grid-paths.js"></script>');
  });
});
