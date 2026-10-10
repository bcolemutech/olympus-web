'use strict';

/**
 * A town's ground (functions/loom-canon/ground.js; planning/the-loom-
 * movement-and-vision.md §7; L-652 / #464): buildings, water, walls and
 * crossings in the town square, the shapes' own checks, doors on open
 * ground, and every door walkable from a way in. Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-town-ground --verbose
 */

const ground = require('../functions/loom-canon/ground');

const pt = (x, y) => ({ x, y });
const rect = (x0, y0, x1, y1) => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)];

// Burdendal: a town wall with a gate in the south side, a river across the
// middle with a bridge, the market and an inn south of it, the mill north.
const WALL = {
  name: 'the town wall',
  points: [pt(450, 900), pt(100, 900), pt(100, 100), pt(900, 100), pt(900, 900), pt(550, 900)],
};
const RIVER = { name: 'the Dal', points: rect(0, 480, 1000, 520) };
const BRIDGE = { name: 'the old bridge', points: rect(480, 470, 520, 530) };
const INN = { name: 'the Gull', points: rect(600, 600, 700, 650) };
const GROUND = { buildings: [INN], water: [RIVER], walls: [WALL], crossings: [BRIDGE] };

const place = (id, name, position, extra = {}) => ({
  id,
  locationId: 'loc_1',
  name,
  position,
  connections: [],
  ...extra,
});
function world({ groundOf = GROUND, positions = {} } = {}) {
  const places = {
    plc_gate: place('plc_gate', 'The south gate', pt(500, 900), { entrance: { via: ['road'] } }),
    plc_market: place('plc_market', 'Market Square', pt(500, 700)),
    plc_inn: place('plc_inn', 'The Gull', pt(650, 650)), // on the building's edge
    plc_mill: place('plc_mill', 'The mill', pt(300, 300)),
  };
  for (const [id, position] of Object.entries(positions)) places[id].position = position;
  const settlement = {
    id: 'loc_1',
    name: 'Burdendal',
    geo: { kind: 'settlement', x: 100, y: 100, population: 3000 },
    ...(groundOf ? { town: { ground: groundOf } } : {}),
  };
  return { world: { locations: { loc_1: settlement }, places }, settlement };
}
const problemsOf = (options) => {
  const { world: w, settlement } = world(options);
  return ground.check(w, settlement);
};

describe('a walkable town', () => {
  test('Burdendal as built passes: a gate in its wall, a bridge over the river', () => {
    expect(problemsOf()).toEqual([]);
  });

  test('a town without ground is unaffected, whatever its doors', () => {
    expect(problemsOf({ groundOf: null, positions: { plc_inn: pt(650, 625) } })).toEqual([]);
    const { settlement } = world({ groundOf: null });
    expect(ground.hasGround(settlement)).toBe(false);
    expect(ground.hasGround(world().settlement)).toBe(true);
    expect(ground.hasGround({ town: { ground: { buildings: [] } } })).toBe(false);
  });
});

describe('doors', () => {
  test('a door inside a building is refused', () => {
    expect(problemsOf({ positions: { plc_inn: pt(650, 625) } })).toEqual([
      'The Gull (plc_inn)’s door (650, 625) is inside the building 1 "the Gull".',
    ]);
  });

  test('a door in the water is refused; one on the bridge is fine', () => {
    expect(problemsOf({ positions: { plc_mill: pt(300, 500) } })).toEqual([
      'The mill (plc_mill)’s door (300, 500) is in the water 1 "the Dal".',
    ]);
    expect(problemsOf({ positions: { plc_mill: pt(500, 500) } })).toEqual([]);
  });

  test('a door on a wall is refused', () => {
    expect(problemsOf({ positions: { plc_mill: pt(100, 300) } })).toEqual([
      'The mill (plc_mill)’s door (100, 300) is on the wall 1 "the town wall".',
    ]);
  });

  test('a place with no door is named', () => {
    expect(problemsOf({ positions: { plc_mill: undefined } })).toEqual([
      'The mill (plc_mill) has no door (position) in town.',
    ]);
  });
});

describe('reachable from a way in', () => {
  test('without the bridge, the mill across the river is refused', () => {
    expect(problemsOf({ groundOf: { ...GROUND, crossings: [] } })).toEqual([
      'Can’t be walked to from a way in: The mill (plc_mill).',
    ]);
  });

  test('a ford serves as well as a bridge', () => {
    const ford = { name: 'the ford', kind: 'ford', points: rect(200, 470, 260, 530) };
    expect(problemsOf({ groundOf: { ...GROUND, crossings: [ford] } })).toEqual([]);
  });

  test('a gate is a gap in the wall: close it, and the way in is on the wall', () => {
    const closed = { points: [...WALL.points, pt(450, 900)] };
    expect(problemsOf({ groundOf: { ...GROUND, walls: [closed] } })).toEqual([
      'The south gate (plc_gate)’s door (500, 900) is on the wall 1.',
      'No way in or out has a door on open ground, so nobody can walk in.',
    ]);
  });

  test('a place walled off inside the town is refused', () => {
    const pen = { name: 'the pen', points: [...rect(250, 250, 350, 350), pt(250, 250)] };
    expect(problemsOf({ groundOf: { ...GROUND, walls: [WALL, pen] } })).toEqual([
      'Can’t be walked to from a way in: The mill (plc_mill).',
    ]);
  });

  test('a diagonal wall and a thin stream are never slipped through', () => {
    // A pen of diagonal walls round the mill, and a stream thinner than a
    // walking square.
    const diamond = {
      points: [pt(300, 200), pt(400, 300), pt(300, 400), pt(200, 300), pt(300, 200)],
    };
    expect(problemsOf({ groundOf: { ...GROUND, walls: [WALL, diamond] } })).toEqual([
      'Can’t be walked to from a way in: The mill (plc_mill).',
    ]);
    const stream = { points: rect(0, 601, 1000, 602.5) };
    const across = problemsOf({
      groundOf: { ...GROUND, water: [RIVER, stream] },
      positions: { plc_market: pt(500, 560) },
    });
    // The market and the mill are cut off from the gate; the inn's door is
    // south of the stream.
    expect(across).toEqual([
      'Can’t be walked to from a way in: Market Square (plc_market), The mill (plc_mill).',
    ]);
  });
});

describe('the shapes themselves', () => {
  const shapes = (g) => ground.shapeProblems(g);

  test('fine shapes have no problems; a closing point may repeat the first', () => {
    expect(shapes(GROUND)).toEqual([]);
    expect(shapes({ buildings: [{ points: [...rect(10, 10, 20, 20), pt(10, 10)] }] })).toEqual([]);
  });

  test('a polygon needs 3 corners and some area, and must not cross itself', () => {
    expect(shapes({ buildings: [{ points: [pt(1, 1), pt(5, 5)] }] })).toEqual([
      'The building 1 needs at least 3 corners.',
    ]);
    expect(shapes({ buildings: [{ points: [pt(1, 1), pt(5, 5), pt(9, 9)] }] })).toEqual([
      'The building 1 has no area: its corners are in a line.',
    ]);
    const bowtie = [pt(0, 0), pt(10, 10), pt(10, 0), pt(0, 10)];
    expect(shapes({ water: [{ name: 'pond', points: bowtie }] })).toEqual([
      'The water 1 "pond" crosses itself: go round its edge once.',
    ]);
  });

  test('points stay on the town square', () => {
    expect(shapes({ walls: [{ points: [pt(10, 10), pt(1001, 10)] }] })).toEqual([
      'The wall 1 has a point (1001, 10) off the town square (0–1000 each way).',
    ]);
    expect(shapes({ walls: [{ points: [pt(10, 10), { x: 'a', y: 2 }] }] })).toEqual([
      'The wall 1 has a point off the town square (0–1000 each way).',
    ]);
  });

  test('a wall needs 2 points, without repeats in a row', () => {
    expect(shapes({ walls: [{ points: [pt(10, 10)] }] })).toEqual([
      'The wall 1 needs at least 2 points.',
    ]);
    expect(shapes({ walls: [{ points: [pt(10, 10), pt(10, 10), pt(20, 10)] }] })).toEqual([
      'The wall 1 has two points in a row at the same spot.',
    ]);
  });

  test('a crossing is over water, and a bridge or a ford', () => {
    const dry = { points: rect(10, 10, 20, 20) };
    expect(shapes({ water: [RIVER], crossings: [dry] })).toEqual([
      'The crossing 1 is over no water.',
    ]);
    expect(shapes({ water: [RIVER], crossings: [{ ...BRIDGE, kind: 'ferry' }] })).toEqual([
      'The crossing 1 "the old bridge" must be a bridge or a ford.',
    ]);
  });

  test('limits on how many, and unknown kinds of ground', () => {
    const many = Array.from({ length: ground.LIMITS.buildings + 1 }, (_, i) => ({
      points: rect(i % 100, 0, (i % 100) + 1, 1),
    }));
    expect(shapes({ buildings: many })).toEqual([
      `Too many buildings: ${many.length} (at most ${ground.LIMITS.buildings}).`,
    ]);
    const long = Array.from({ length: ground.LIMITS.points + 1 }, (_, i) => pt(i, i % 2));
    expect(shapes({ walls: [{ points: long }] })).toEqual([
      `The wall 1 has ${long.length} points (at most ${ground.LIMITS.points}).`,
    ]);
    expect(shapes({ roads: [] })).toEqual([
      'Unknown ground "roads": use buildings, water, walls or crossings.',
    ]);
    expect(shapes([])).toEqual([
      'The ground must be an object of buildings, water, walls and crossings.',
    ]);
  });

  test('check reports the shapes’ problems before the doors', () => {
    const { world: w, settlement } = world();
    expect(ground.check(w, settlement, { walls: [{ points: [pt(1, 1)] }] })).toEqual([
      'The wall 1 needs at least 2 points.',
    ]);
  });
});

describe('the walking grid', () => {
  test('blockedAt names what is at a point; edges are open', () => {
    expect(ground.blockedAt(GROUND, pt(650, 625))).toEqual({
      kind: 'building',
      name: 'building 1 "the Gull"',
    });
    expect(ground.blockedAt(GROUND, pt(650, 650))).toBeNull();
    expect(ground.blockedAt(GROUND, pt(500, 500))).toBeNull(); // on the bridge
    expect(ground.blockedAt(GROUND, pt(10, 500))).toMatchObject({ kind: 'water' });
  });

  test('a square is blocked exactly when its centre is in a building', () => {
    const shapes = {
      buildings: [
        { points: [pt(100, 100), pt(400, 180), pt(220, 420)] },
        { points: [pt(600, 600), pt(900, 610), pt(880, 900), pt(750, 700), pt(610, 880)] },
      ],
    };
    const { blocked, n, cell } = ground.compile(shapes);
    let mismatches = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const centre = pt((x + 0.5) * cell, (y + 0.5) * cell);
        if (Boolean(blocked[y * n + x]) !== Boolean(ground.blockedAt(shapes, centre))) {
          mismatches++;
        }
      }
    }
    expect(mismatches).toBe(0);
  });

  test('compiled once per ground', () => {
    expect(ground.compile(GROUND)).toBe(ground.compile(GROUND));
    expect(ground.compile(GROUND).blocked.length).toBe((1000 / ground.CELL) ** 2);
  });
});
