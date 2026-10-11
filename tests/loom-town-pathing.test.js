'use strict';

/**
 * Paths in town (functions/loom-canon/town-paths.js; planning/the-loom-
 * movement-and-vision.md §8; L-661 / #468): a walking grid over a town's
 * ground, a search, then smoothing into straight runs, lengths in metres
 * from the town's size, and walk(path, metres). Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-town-pathing --verbose
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const paths = require('../functions/loom-canon/town-paths');

const pt = (x, y) => ({ x, y });
const rect = (x0, y0, x1, y1) => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)];

// Burdendal: a town wall with a gate in the south side, a river across the
// middle with a bridge, an inn south of it.
const WALL = {
  name: 'the town wall',
  points: [pt(450, 900), pt(100, 900), pt(100, 100), pt(900, 100), pt(900, 900), pt(550, 900)],
};
const RIVER = { name: 'the Dal', points: rect(0, 480, 1000, 520) };
const BRIDGE = { name: 'the old bridge', points: rect(480, 470, 520, 530) };
const INN = { name: 'the Gull', points: rect(600, 600, 700, 650) };
const GROUND = { buildings: [INN], water: [RIVER], walls: [WALL], crossings: [BRIDGE] };

// Every point along a path, a unit apart.
function along(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let s = 0; s <= steps; s++) {
      out.push(pt(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps));
    }
  }
  return out;
}

// The path stays on open squares (but its ends' own), and crosses no wall.
function staysOnOpenGround(ground, route) {
  const { blocked, n } = paths.compile(ground);
  const ends = [route.points[0], route.points[route.points.length - 1]].map((p) => {
    const s = paths.squareAt(p);
    return s.y * n + s.x;
  });
  for (const p of along(route.points)) {
    const s = paths.squareAt(p);
    const i = s.y * n + s.x;
    if (blocked[i] && !ends.includes(i)) return false;
  }
  const { edges, segmentsMeet } = paths.geometry;
  for (const [a, b] of edges(route.points, false)) {
    for (const wall of ground.walls || []) {
      for (const [c, d] of edges(wall.points, false)) if (segmentsMeet(a, b, c, d)) return false;
    }
  }
  return true;
}

describe('paths go around what blocks', () => {
  test('around a building, on open ground, in a few straight runs', () => {
    const route = paths.pathTo(GROUND, pt(650, 580), pt(650, 680));
    expect(route).not.toBeNull();
    expect(staysOnOpenGround(GROUND, route)).toBe(true);
    expect(route.units).toBeGreaterThan(100); // longer than straight through
    expect(route.units).toBeLessThan(220); // but round the near corner
    expect(route.points.length).toBeLessThanOrEqual(5);
    expect(route.points[0]).toEqual(pt(650, 580));
    expect(route.points[route.points.length - 1]).toEqual(pt(650, 680));
  });

  test('over the bridge, never through the river', () => {
    const route = paths.pathTo(GROUND, pt(300, 700), pt(300, 300));
    expect(staysOnOpenGround(GROUND, route)).toBe(true);
    // Where it is level with the river, it is on the bridge.
    for (const p of along(route.points).filter((q) => q.y > 482 && q.y < 518)) {
      expect(p.x).toBeGreaterThanOrEqual(480);
      expect(p.x).toBeLessThanOrEqual(520);
    }
  });

  test('in through the gate, never over the wall', () => {
    const route = paths.pathTo(GROUND, pt(200, 960), pt(200, 800));
    expect(staysOnOpenGround(GROUND, route)).toBe(true);
    const atWall = along(route.points).filter((q) => Math.abs(q.y - 900) < 1);
    expect(atWall.length).toBeGreaterThan(0);
    for (const p of atWall) {
      expect(p.x).toBeGreaterThan(450);
      expect(p.x).toBeLessThan(550);
    }
  });

  test('no bridge, no way across; no gate, no way in', () => {
    expect(paths.pathTo({ ...GROUND, crossings: [] }, pt(300, 700), pt(300, 300))).toBeNull();
    const closed = { points: [...WALL.points, pt(450, 900)] };
    expect(paths.pathTo({ ...GROUND, walls: [closed] }, pt(200, 960), pt(200, 800))).toBeNull();
  });

  test('an end inside a building or in the water has no path', () => {
    expect(paths.pathTo(GROUND, pt(650, 625), pt(300, 700))).toBeNull();
    expect(paths.pathTo(GROUND, pt(300, 700), pt(300, 500))).toBeNull();
  });

  test('a door on a building’s edge walks from the street beside it', () => {
    const route = paths.pathTo(GROUND, pt(650, 650), pt(650, 700));
    expect(route.points).toEqual([pt(650, 650), pt(650, 700)]);
  });
});

describe('smoothed runs and lengths', () => {
  test('on open ground a path is one straight line', () => {
    const route = paths.pathTo(GROUND, pt(150, 150), pt(400, 400));
    expect(route.points).toEqual([pt(150, 150), pt(400, 400)]);
    expect(route.units).toBeCloseTo(Math.hypot(250, 250), 6);
  });

  test('a town without ground is open ground everywhere', () => {
    expect(paths.pathTo(null, pt(0, 0), pt(300, 400))).toEqual({
      points: [pt(0, 0), pt(300, 400)],
      units: 500,
      metres: 500,
    });
  });

  test('metres come from the town’s size', () => {
    const units = paths.pathTo(GROUND, pt(150, 150), pt(400, 400)).units;
    expect(paths.pathTo(GROUND, pt(150, 150), pt(400, 400), { size: 600 }).metres).toBeCloseTo(
      units * 0.6,
      6
    );
    expect(paths.pathTo(GROUND, pt(150, 150), pt(400, 400), { size: 2500 }).metres).toBeCloseTo(
      units * 2.5,
      6
    );
  });

  test('the same path every time', () => {
    const a = paths.pathTo(GROUND, pt(300, 700), pt(700, 300), { size: 600 });
    const b = paths.pathTo(GROUND, pt(300, 700), pt(700, 300), { size: 600 });
    expect(b).toEqual(a);
  });
});

describe('walk(path, metres)', () => {
  const route = paths.pathTo(null, pt(0, 500), pt(1000, 500), { size: 600 }); // 600 m

  test('a budget short of the end stops partway, and keeps the rest', () => {
    const step = paths.walk(route, 400);
    expect(step.arrived).toBe(false);
    expect(step.walked).toBe(400);
    expect(step.to.x).toBeCloseTo(666.667, 2);
    expect(step.to.y).toBe(500);
    expect(step.rest.metres).toBeCloseTo(200, 6);
    expect(step.rest.points[0]).toEqual(step.to);
    // The rest walks on to the end.
    expect(paths.walk(step.rest, 400)).toMatchObject({ arrived: true, rest: null });
  });

  test('a budget past the end arrives, using only what it needs', () => {
    expect(paths.walk(route, 1000)).toEqual({
      to: pt(1000, 500),
      walked: 600,
      arrived: true,
      rest: null,
    });
  });

  test('round a corner, the walk follows the runs', () => {
    const bend = paths.pathTo(GROUND, pt(650, 580), pt(650, 680), { size: 1000 });
    const half = paths.walk(bend, bend.metres / 2);
    expect(half.rest.metres).toBeCloseTo(bend.metres / 2, 6);
    // It stops on the path, and the rest goes on from there along it.
    const { edges, distanceToSegment } = paths.geometry;
    const off = Math.min(
      ...edges(bend.points, false).map(([a, b]) => distanceToSegment(half.to, a, b))
    );
    expect(off).toBeLessThan(1e-6);
    expect(half.rest.points[0]).toEqual(half.to);
    expect(half.rest.points[half.rest.points.length - 1]).toEqual(pt(650, 680));
  });
});

test('a time budget: a long way round a crowded town is found quickly', () => {
  // A great city's worth of blocks, with lanes between, and a river.
  const buildings = [];
  for (let x = 20; x < 980; x += 60) {
    for (let y = 20; y < 980; y += 60) {
      if (y > 440 && y < 560) continue;
      buildings.push({ points: rect(x, y, x + 45, y + 45) });
    }
  }
  const crowded = {
    buildings,
    water: [{ points: rect(0, 480, 1000, 520) }],
    walls: [],
    crossings: [{ points: rect(950, 470, 990, 530) }],
  };
  // About 35 ms each in Node, as the server runs; Jest's sandbox is slower.
  const started = Date.now();
  const route = paths.pathTo(crowded, pt(10, 10), pt(10, 990), { size: 2500 });
  expect(Date.now() - started).toBeLessThan(500);
  expect(route).not.toBeNull();
  expect(staysOnOpenGround(crowded, route)).toBe(true);
  // Around through the far bridge: well over the straight 980 units.
  expect(route.units).toBeGreaterThan(2000);
  const again = Date.now();
  expect(paths.pathTo(crowded, pt(990, 10), pt(10, 990), { size: 2500 })).not.toBeNull();
  expect(Date.now() - again).toBeLessThan(500);
});

describe("the browser's copy", () => {
  const served = path.join(__dirname, '../public/apps/loom/js/town-paths.js');

  test('is identical to the server’s', () => {
    expect(fs.readFileSync(served, 'utf8')).toBe(
      fs.readFileSync(path.join(__dirname, '../functions/loom-canon/town-paths.js'), 'utf8')
    );
  });

  test('loads in a page as Loom.townPaths, and finds the same paths', () => {
    const page = { window: {} };
    page.window.Loom = { state: {} };
    vm.runInNewContext(fs.readFileSync(served, 'utf8'), page);
    const browser = page.window.Loom.townPaths;
    expect(Object.keys(browser)).toEqual(Object.keys(paths));
    // JSON: the page's objects come from another realm.
    expect(JSON.parse(JSON.stringify(browser.pathTo(GROUND, pt(300, 700), pt(700, 300))))).toEqual(
      paths.pathTo(GROUND, pt(300, 700), pt(700, 300))
    );
    expect(page.window.Loom.state).toEqual({}); // the namespace is kept
  });

  test('the Loom page loads it', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/apps/loom/index.html'), 'utf8');
    expect(html).toContain('<script src="/apps/loom/js/town-paths.js"></script>');
  });
});
