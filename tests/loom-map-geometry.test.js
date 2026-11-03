'use strict';

/**
 * A map's geometry (planning/maps-from-data.md §4.1, GE1, GE4, GE5, DA1,
 * DA2; L-921 / #725), pure: shapes in map units read as polygons and lines
 * (points, path data, circles, rects), a wall at an angle with a door in it,
 * a point in a concave room, a gap's clearance, see-through walls, doors and
 * windows; bad shapes refused with reasons; the stored form (no arrays of
 * arrays, for Firestore); the rules reading it through frames, template
 * instances included; and the page's copy matching the server's.
 *
 * Run: cd tests && npx jest loom-map-geometry.test --verbose
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const geo = require('../functions/loom-canon/map-geometry');
const frames = require('../functions/loom-canon/frames');
const { andorWorld, andorWithTemplates } = require('./fixtures/andor-world');

const BOUNDS = { width: 60, height: 40 }; // a 12 × 8 grid, in feet

// A room 30 ft square whose north-east corner is cut by a wall at 45°,
// with a door in it.
const angled = () => ({
  walls: [
    {
      id: 'w-angle',
      material: 'stone',
      points: [
        [0, 30],
        [30, 0],
      ],
    },
  ],
  doors: [{ id: 'd-angle', material: 'wood', from: [12, 18], to: [18, 12] }],
});

describe('shapes read as polygons', () => {
  test('points, as [x, y] or { x, y }, close themselves', () => {
    expect(geo.ringsOf([[0, 0], [10, 0], { x: 10, y: 10 }]).rings).toEqual([
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    ]);
  });

  test('a circle reads as a polygon round its centre', () => {
    const { rings } = geo.ringsOf({ circle: { x: 20, y: 20, r: 10 } });
    expect(rings).toHaveLength(1);
    expect(rings[0].length).toBeGreaterThanOrEqual(16);
    for (const [x, y] of rings[0]) expect(Math.hypot(x - 20, y - 20)).toBeCloseTo(10, 6);
    expect(geo.pointInShape([20, 20], { circle: { x: 20, y: 20, r: 10 } })).toBe(true);
    expect(geo.pointInShape([27, 27], { circle: { x: 20, y: 20, r: 10 } })).toBe(true);
    expect(geo.pointInShape([28, 28], { circle: { x: 20, y: 20, r: 10 } })).toBe(false);
  });

  test('a rect reads as its four corners', () => {
    expect(geo.ringsOf({ rect: { x: 5, y: 5, w: 10, h: 5 } }).rings[0]).toEqual([
      [5, 5],
      [15, 5],
      [15, 10],
      [5, 10],
    ]);
  });

  test('path data reads as polygons: lines, relative moves, H and V', () => {
    expect(geo.ringsOf('M0 0 H10 V10 H0 Z').rings[0]).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(geo.ringsOf('m5,5 l10,0 0,10 -10,0 z').rings[0]).toEqual([
      [5, 5],
      [15, 5],
      [15, 15],
      [5, 15],
    ]);
  });

  test('path data with a curve and an arc is flattened', () => {
    // A half disc above y = 5, its arc through (5, 0).
    const half = 'M0 5 A5 5 0 0 1 10 5 Z';
    expect(geo.ringsOf(half).rings[0].length).toBeGreaterThan(4);
    expect(geo.pointInShape([5, 2], half)).toBe(true);
    expect(geo.pointInShape([5, 8], half)).toBe(false);
    const cave = 'M0 5 C10 0 20 10 30 5 L30 25 Q15 35 0 25 Z';
    expect(geo.pointInShape([15, 10], cave)).toBe(true);
    expect(geo.pointInShape([15, 31], cave)).toBe(false); // below the curve's lowest
    expect(geo.check({ ground: [{ id: 'g', material: 'rock', shape: cave }] }, BOUNDS)).toEqual([]);
  });

  test('a second subpath makes a hole', () => {
    const ring = 'M0 0H20V20H0Z M5 5H15V15H5Z';
    expect(geo.pointInShape([2, 2], ring)).toBe(true);
    expect(geo.pointInShape([10, 10], ring)).toBe(false);
  });

  test('a line takes points or open path data', () => {
    expect(geo.linesOf('M0 0 L10 10 L20 0').lines).toEqual([
      [
        [0, 0],
        [10, 10],
        [20, 0],
      ],
    ]);
  });
});

describe('a point inside a concave room', () => {
  // An L: the notch at the top right is outside.
  const room = [
    [0, 0],
    [10, 0],
    [10, 20],
    [30, 20],
    [30, 30],
    [0, 30],
  ];

  test('inside the arms, not in the notch', () => {
    expect(geo.pointInShape([5, 5], room)).toBe(true);
    expect(geo.pointInShape([25, 25], room)).toBe(true);
    expect(geo.pointInShape([25, 10], room)).toBe(false);
    expect(geo.pointInShape([40, 25], room)).toBe(false);
  });

  test('the ground under a point is the last laid that holds it', () => {
    const c = geo.compile({
      ground: [
        { id: 'floor', material: 'flagstone', shape: room },
        { id: 'rug', material: 'carpet', shape: { rect: { x: 2, y: 22, w: 6, h: 6 } } },
      ],
      zones: [{ id: 'hall', name: 'The hall', shape: room }],
    });
    expect(geo.groundAt(c, [5, 25]).id).toBe('rug');
    expect(geo.groundAt(c, [5, 5]).id).toBe('floor');
    expect(geo.groundAt(c, [25, 10])).toBeNull();
    expect(geo.zonesAt(c, [25, 25]).map((z) => z.id)).toEqual(['hall']);
  });
});

describe('a wall at an angle, and a door in it', () => {
  test('a path across the wall hits it; one beside it doesn’t', () => {
    const c = geo.compile(angled());
    const crossing = geo.hits(c, [5, 5], [25, 25], { move: true });
    // Crosses at (15, 15): in the door, which is closed.
    expect(crossing.map((h) => h.id)).toEqual(['d-angle']);
    expect(crossing[0].point[0]).toBeCloseTo(15, 9);
    // Across the wall away from the door.
    expect(geo.hits(c, [0, 20], [10, 30], { move: true }).map((h) => h.id)).toEqual(['w-angle']);
    // Alongside it, never crossing.
    expect(geo.hits(c, [0, 20], [20, 0], { move: true })).toEqual([]);
  });

  test('the door replaces the wall where it stands', () => {
    const c = geo.compile(angled());
    const walls = geo.edges(c).filter((e) => e.kind === 'wall');
    expect(walls).toHaveLength(2);
    expect(walls[0].b[0]).toBeCloseTo(12, 9);
    expect(walls[1].a[0]).toBeCloseTo(18, 9);
    // Opened (a save's state over the geometry's), the way through is clear.
    expect(geo.hits(c, [5, 5], [25, 25], { move: true, states: { 'd-angle': 'open' } })).toEqual(
      []
    );
    expect(geo.check(angled(), BOUNDS)).toEqual([]);
  });

  test('a glass wall blocks movement, not sight; a window is never walked through', () => {
    const c = geo.compile({
      walls: [
        {
          id: 'pane',
          material: 'glass',
          points: [
            [0, 10],
            [20, 10],
          ],
        },
        {
          id: 'shop',
          material: 'brick',
          points: [
            [0, 20],
            [20, 20],
          ],
        },
      ],
      windows: [{ id: 'win', material: 'glass', from: [5, 20], to: [10, 20] }],
    });
    expect(geo.hits(c, [7, 5], [7, 15], { move: true }).map((h) => h.id)).toEqual(['pane']);
    expect(geo.hits(c, [7, 5], [7, 15], { sight: true })).toEqual([]);
    expect(geo.hits(c, [7, 15], [7, 25], { move: true }).map((h) => h.id)).toEqual(['win']);
    expect(geo.hits(c, [7, 15], [7, 25], { sight: true })).toEqual([]);
    expect(geo.hits(c, [15, 15], [15, 25], { sight: true }).map((h) => h.id)).toEqual(['shop']);
  });
});

describe('a gap’s clearance', () => {
  // Two walls along y = 10 with a 3 ft gap between them, x 10 to 13.
  const c = geo.compile({
    walls: [
      {
        id: 'west',
        material: 'stone',
        points: [
          [0, 10],
          [10, 10],
        ],
      },
      {
        id: 'east',
        material: 'stone',
        points: [
          [13, 10],
          [30, 10],
        ],
      },
    ],
    objects: [{ id: 'crate', kind: 'crate', at: [20, 20], size: 4 }],
  });

  test('the middle of the gap is 1.5 ft from either wall', () => {
    expect(geo.clearance(c, [11.5, 10])).toBeCloseTo(1.5, 9);
    expect(geo.hits(c, [11.5, 5], [11.5, 15], { move: true })).toEqual([]);
  });

  test('2.5 ft wide fits through it; 5 ft wide doesn’t', () => {
    expect(geo.fits(c, [11.5, 10], 2.5)).toBe(true);
    expect(geo.fits(c, [11.5, 10], 5)).toBe(false);
  });

  test('objects and the map’s edge count; inside a solid object there’s no room', () => {
    expect(geo.clearance(c, [20, 20])).toBe(0);
    expect(geo.clearance(c, [20, 25])).toBeCloseTo(3, 9);
    expect(geo.clearance(c, [1, 30], { bounds: BOUNDS })).toBeCloseTo(1, 9);
  });
});

describe('bad shapes refused, with reasons', () => {
  const problems = (g) => geo.check(g, BOUNDS);

  test('an open polygon', () => {
    expect(
      problems({ ground: [{ id: 'g1', material: 'stone', shape: 'M0 0 L10 0 L10 10' }] })
    ).toEqual([expect.stringMatching(/^ground\.g1 is an open polygon/)]);
    expect(
      problems({
        ground: [
          {
            id: 'g2',
            material: 'stone',
            shape: [
              [0, 0],
              [10, 0],
            ],
          },
        ],
      })
    ).toEqual([expect.stringMatching(/^ground\.g2 is an open polygon: it needs 3 corners/)]);
  });

  test('a polygon crossing itself, and one running off the map', () => {
    const bowtie = [
      [0, 0],
      [10, 10],
      [10, 0],
      [0, 4],
    ];
    expect(problems({ zones: [{ id: 'z', shape: bowtie }] })).toEqual(['zones.z crosses itself.']);
    expect(
      problems({
        ground: [{ id: 'g', material: 'grass', shape: { circle: { x: 55, y: 5, r: 10 } } }],
      })
    ).toEqual([expect.stringMatching(/^ground\.g runs outside the map/)]);
  });

  test('a door off its wall', () => {
    const g = angled();
    g.doors[0] = { id: 'd-off', material: 'wood', from: [12, 12], to: [18, 18] };
    expect(problems(g)).toEqual([
      'doors.d-off isn’t in a wall: both its ends must lie on one straight run of it.',
    ]);
    const named = angled();
    named.doors[0].wall = 'w-nowhere';
    expect(problems(named)).toEqual(['doors.d-angle names a wall "w-nowhere" there isn’t.']);
  });

  test('an unknown material, naming the ones there are', () => {
    const g = angled();
    g.walls[0].material = 'cheese';
    const [reason] = problems(g);
    expect(reason).toMatch(
      /^walls\.w-angle has an unknown material "cheese": the wall materials are stone, brick/
    );
    expect(
      problems({ ground: [{ id: 'g', shape: { rect: { x: 0, y: 0, w: 5, h: 5 } } }] })
    ).toEqual(['ground.g needs a material.']);
    // A floor material isn't a wall's.
    expect(problems({ walls: [{ id: 'w', material: 'carpet', points: 'M0 0 L10 0' }] })[0]).toMatch(
      /unknown material "carpet"/
    );
  });

  test('ids, objects, spawns, hidden things and the rest', () => {
    expect(problems({ ceilings: [] })).toEqual([
      '"ceilings" is no part of a map’s geometry (ground, lines, walls, doors, windows, objects, zones, spawns, lights, notes, hidden).',
    ]);
    expect(
      problems({
        walls: [
          { id: 'a', material: 'stone', points: 'M0 0 L10 0' },
          { id: 'a', material: 'stone', points: 'M0 5 L10 5' },
        ],
        objects: [{ id: 'chest', kind: 'chest', at: [59, 20], size: [4, 2] }],
        spawns: [{ id: 's', count: 0, at: [5, 5] }],
        lights: [{ id: 'l', at: [5, 5] }],
        notes: [{ id: 'n', at: [5, 5] }],
        hidden: ['nobody'],
        ceilings: [],
      })
    ).toEqual([
      '"ceilings" is no part of a map’s geometry (ground, lines, walls, doors, windows, objects, zones, spawns, lights, notes, hidden).',
    ]);
    expect(
      problems({
        walls: [
          { id: 'a', material: 'stone', points: 'M0 0 L10 0' },
          { id: 'a', material: 'stone', points: 'M0 5 L10 5' },
        ],
        objects: [{ id: 'chest', kind: 'chest', at: [59, 20], size: [4, 2] }],
        spawns: [{ id: 's', count: 0, at: [5, 5] }],
        lights: [{ id: 'l', at: [5, 5] }],
        notes: [{ id: 'n', at: [5, 5] }],
        ground: [
          {
            id: 'puddle',
            material: 'stone',
            depth: 1,
            shape: { rect: { x: 0, y: 0, w: 1, h: 1 } },
          },
        ],
        hidden: ['nobody'],
      })
    ).toEqual([
      'ground.puddle has a depth but isn’t water.',
      'walls.a uses an id walls.a has.',
      expect.stringMatching(/^objects\.chest runs outside the map/),
      'spawns.s has a count that isn’t a whole number from 1 to 50.',
      'lights.l needs a radius above 0.',
      'notes.n needs its text.',
      'hidden names "nobody", which isn’t in the geometry.',
    ]);
  });

  test('a sound geometry has no problems, and none is fine', () => {
    expect(geo.check(undefined, BOUNDS)).toEqual([]);
    expect(
      problems({
        ...angled(),
        ground: [
          { id: 'floor', material: 'flagstone', shape: { rect: { x: 0, y: 0, w: 60, h: 40 } } },
          {
            id: 'pool',
            material: 'water',
            depth: 3,
            cost: 2,
            shape: { circle: { x: 45, y: 25, r: 5 } },
          },
          { id: 'ledge', material: 'rock', height: 10, cost: 'never', shape: 'M40 0H60V8H40Z' },
        ],
        objects: [{ id: 'chest', kind: 'chest', at: [5, 35], size: [4, 2], turn: 30, height: 3 }],
        zones: [{ id: 'nave', name: 'The nave', shape: { rect: { x: 0, y: 0, w: 30, h: 40 } } }],
        spawns: [{ id: 'bandits', at: [50, 30], count: 3, what: { statBlock: 'bandit' } }],
        lights: [
          { id: 'brazier', at: [20, 20], radius: 20, dim: 40 },
          { id: 'crypt', dark: true, shape: { rect: { x: 50, y: 30, w: 10, h: 10 } } },
        ],
        notes: [{ id: 'drip', text: 'Water drips somewhere.', sense: 'sound' }],
        hidden: [{ id: 'd-angle', dc: 15 }],
      })
    ).toEqual([]);
  });
});

describe('the stored form', () => {
  const raw = () => ({
    ...angled(),
    ground: [
      {
        material: 'stone',
        shape: [
          [0, 0],
          [60, 0],
          [60, 40],
          [0, 40],
        ],
      },
      { material: 'water', shape: { circle: { x: 45, y: 25, r: 5 } } },
    ],
    objects: [{ kind: 'barrel', at: { x: 5, y: 5 }, size: 2 }],
    hidden: ['d-angle'],
  });

  test('lists of points become path data, and items without ids get them', () => {
    const stored = geo.normalize(raw());
    expect(stored.walls[0].points).toBe('M0 30L30 0');
    expect(stored.ground[0]).toEqual({
      id: 'ground-1',
      material: 'stone',
      shape: 'M0 0L60 0L60 40L0 40Z',
    });
    expect(stored.ground[1].shape).toEqual({ circle: { x: 45, y: 25, r: 5 } });
    expect(stored.ground[1].id).toBe('ground-2');
    expect(stored.objects[0]).toEqual({ id: 'object-1', kind: 'barrel', at: [5, 5], size: [2, 2] });
    expect(stored.doors[0].from).toEqual([12, 18]);
    expect(stored.hidden).toEqual([{ id: 'd-angle' }]);
    expect(stored.zones).toBeUndefined();
  });

  test('holds no arrays of arrays (Firestore keeps none), reads the same and checks clean', () => {
    const stored = geo.normalize(raw());
    const nested = (v, inArray) =>
      Array.isArray(v)
        ? inArray || v.some((x) => nested(x, true))
        : v && typeof v === 'object'
          ? Object.values(v).some((x) => nested(x, false))
          : false;
    expect(nested(stored, false)).toBe(false);
    expect(geo.check(stored, BOUNDS)).toEqual([]);
    const a = geo.compile(raw());
    const b = geo.compile(stored);
    expect(geo.hits(b, [5, 5], [25, 25], {})).toEqual(geo.hits(a, [5, 5], [25, 25], {}));
    expect(geo.groundAt(b, [45, 25]).material).toBe('water');
  });
});

describe('bounds', () => {
  test('a grid’s are its squares at 5 ft; a region or area map’s its space', () => {
    expect(geo.boundsOf({ width: 12, height: 8 })).toEqual({ width: 60, height: 40 });
    expect(
      geo.boundsOf({ kind: 'grid', space: { width: 12, height: 8, squareSize: 1.5 } })
    ).toEqual({ width: 60, height: 40 });
    expect(geo.boundsOf({ kind: 'area', space: { width: 1000, height: 1000, size: 300 } })).toEqual(
      { width: 1000, height: 1000 }
    );
    expect(geo.boundsOf({ kind: 'region' })).toBeNull();
  });
});

describe('read through frames (GE5)', () => {
  const grid = geo.normalize(angled());
  const coast = geo.normalize({
    ground: [{ id: 'sea', material: 'ocean', shape: { rect: { x: 0, y: 0, w: 100, h: 30 } } }],
    lines: [
      {
        id: 'lane',
        material: 'road',
        points: [
          [40, 30],
          [60, 30],
        ],
        width: 2,
      },
    ],
  });
  const streets = geo.normalize({
    zones: [
      { id: 'docks', name: 'The docks', shape: { rect: { x: 400, y: 400, w: 200, h: 200 } } },
    ],
  });

  test('a grid’s from its battle map, a region map’s and an area map’s from their docs', () => {
    const w = andorWorld();
    w.battleMaps.deck = { id: 'deck', name: 'The deck', width: 12, height: 8, geometry: grid };
    w.maps.vega = { ...w.maps.vega, geometry: coast };
    w.maps.station = { ...w.maps.station, geometry: streets };
    const play = frames.playWorld(w);
    expect(frames.geometryOf(play, 'deck')).toBe(grid);
    expect(frames.geometryOf(play, 'vega')).toBe(coast);
    expect(frames.geometryOf(play, 'station')).toBe(streets);
    expect(frames.geometryOf(play, 'sol')).toBeNull();
    // The frame on Vega carries its geometry with its map; the station's town has its own.
    const view = frames.viewFor(play, 'vega');
    expect(view.map.geometry).toBe(coast);
    expect(view.map.width).toBe(100);
    expect(view.locations.pl_station.town.geometry).toBe(streets);
    expect(view.battleMaps.deck.geometry).toBe(grid);
    const c = geo.compile(frames.geometryOf(play, 'deck'));
    expect(geo.hits(c, [5, 5], [25, 25], { move: true }).map((h) => h.id)).toEqual(['d-angle']);
  });

  test('a template instance carries its template’s geometry', () => {
    const w = andorWithTemplates();
    w.maps.tpl_moon = { ...w.maps.tpl_moon, geometry: grid };
    const hamlet = geo.normalize({
      zones: [{ id: 'green', shape: { circle: { x: 500, y: 500, r: 50 } } }],
    });
    w.maps.tpl_hamlet = { ...w.maps.tpl_hamlet, geometry: hamlet };
    w.mapPlaces.pl_rigel = { ...w.mapPlaces.pl_rigel, opens: { template: 'tpl_hamlet' } };
    const play = frames.playWorld(w);
    expect(frames.geometryOf(play, 'tpl_moon__pl_io')).toEqual(grid);
    expect(frames.geometryOf(play, 'tpl_moon__pl_europa')).toEqual(grid);
    expect(frames.geometryOf(play, 'tpl_hamlet__pl_rigel')).toEqual(hamlet);
    expect(frames.viewFor(play, 'sector').locations.pl_rigel.town.geometry).toEqual(hamlet);
  });
});

describe("the browser's copy", () => {
  const served = path.join(__dirname, '../public/apps/loom/js/map-geometry.js');

  test('is identical to the server’s, and loads as Loom.mapGeometry', () => {
    expect(fs.readFileSync(served, 'utf8')).toBe(
      fs.readFileSync(path.join(__dirname, '../functions/loom-canon/map-geometry.js'), 'utf8')
    );
    // It reads its materials from the page's Loom.materials (L-925).
    const page = { window: { Loom: {} } };
    vm.runInNewContext(
      fs.readFileSync(path.join(__dirname, '../public/apps/loom/js/materials.js'), 'utf8'),
      page
    );
    vm.runInNewContext(fs.readFileSync(served, 'utf8'), page);
    expect(typeof page.window.Loom.mapGeometry.compile).toBe('function');
    const html = fs.readFileSync(path.join(__dirname, '../public/apps/loom/index.html'), 'utf8');
    expect(html).toContain('<script src="/apps/loom/js/map-geometry.js"></script>');
  });
});
