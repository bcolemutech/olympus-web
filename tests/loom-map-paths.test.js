'use strict';

/**
 * Moving off the grid (planning/maps-from-data.md §4.2, GE2, MV1, SZ1;
 * L-922 / #726), pure, in both built-in systems: a medium character passes a
 * 3 ft gap and a large one doesn't; a diagonal 15 ft path costs 3 AP;
 * difficult ground doubles the cost; and for every move in a set of
 * fixtures, the grid view's preview (map-paths.js on loomGetMap's
 * battleMap and prices, as the page reads them) is the server's charge
 * (steps.js planStep). And the planner itself: sizes, gaps off the grid
 * lines, layers read as geometry, doors opened from beside them, the
 * squares a turn reaches; and the page's copy.
 *
 * Run: cd tests && npx jest loom-map-paths --verbose
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const mp = require('../functions/loom-canon/map-paths');
const geo = require('../functions/loom-canon/map-geometry');
const { gridMap } = require('./helpers/grid');
const layerGeometry = require('../functions/loom-canon/layer-geometry');
const sheets = require('../functions/loom-canon/sheets');
const apRules = require('../functions/loom-canon/ap');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const { planStep } = require('../functions/loom-turn/steps');
const mapView = require('../functions/loom-turn/map-view');
const seen = require('../functions/loom-turn/seen');

// A hall 12 × 8 (60 × 40 ft): a stone wall across y = 20 ft with a 3 ft gap
// at x 31–34 (stored geometry, off the grid lines; its middle the middle of
// column 6) and none other, and a strip of mud
// (difficult) down column 9 from today's layers.
// Written in squares (its mud) beside its own geometry, stored as geometry
// (L-928; ./helpers/grid.js).
const RAW_HALL = {
  id: 'bm_hall',
  name: 'The hall',
  width: 12,
  height: 8,
  entries: [{ id: 'in', x: 0, y: 0 }],
  exits: [{ id: 'out', name: 'the way out', x: 0, y: 7, to: 'out' }],
  features: [],
  obstacles: [{ id: 'mud', name: 'mud', kind: 'difficult', x: 9, y: 0, h: 8 }],
  geometry: geo.normalize({
    walls: [
      {
        id: 'west',
        material: 'stone',
        points: [
          [0, 20],
          [31, 20],
        ],
      },
      {
        id: 'east',
        material: 'stone',
        points: [
          [34, 20],
          [60, 20],
        ],
      },
    ],
  }),
};

const HALL = gridMap(RAW_HALL);

const SYSTEMS = [
  ['d20-fantasy', BUILT_IN['d20-fantasy']],
  ['pool-scifi', BUILT_IN['pool-scifi']],
];

describe.each(SYSTEMS)('under %s', (_id, system) => {
  const worldOf = (map = HALL) => ({
    system,
    locations: { hall: { id: 'hall', name: 'The hall', battleMap: { mapId: map.id } } },
    battleMaps: { [map.id]: map },
    characters: {},
  });
  const standing = (cell, { ap = 40, size, gridPoint } = {}) => {
    const sheet = { ...sheets.defaultSheet(system), ...(size ? { size } : {}) };
    return {
      location: 'hall',
      mapId: 'bm_hall',
      cell,
      ...(gridPoint ? { gridPoint } : {}),
      character: { name: 'Tam', sheet, inventory: [] },
      turn: { n: 1, ap, kept: 0, plan: null },
    };
  };
  const prices = apRules.pricesOf(system, sheets.defaultSheet(system));
  const spent = (save, step) => save.turn.ap - step.turn.ap;

  test('a medium character passes a 3 ft gap; a large one doesn’t', () => {
    // From above the wall to below it, straight through the gap.
    const medium = standing({ x: 6, y: 2 });
    const through = planStep(worldOf(), medium, { cell: { x: 6, y: 5 } });
    expect(through.cell).toEqual({ x: 6, y: 5 });
    expect(through.walked).toContainEqual({ x: 6, y: 4 });
    expect(spent(medium, through)).toBe(3 * prices.move); // 15 ft, straight
    const large = standing({ x: 6, y: 2 }, { size: 'large' });
    expect(planStep(worldOf(), large, { cell: { x: 6, y: 5 } })).toEqual({
      refused: "There's no way there from here.",
    });
    // Above the wall it goes where it likes.
    expect(planStep(worldOf(), large, { cell: { x: 10, y: 2 } }).cell).toEqual({ x: 10, y: 2 });
  });

  test('a diagonal 15 ft path costs 3 AP', () => {
    // From a square's centre to a point 9 ft across and 12 ft down: 15 ft.
    const save = standing({ x: 0, y: 0 });
    const step = planStep(worldOf(), save, { point: { x: 11.5, y: 14.5 } });
    expect(step.point).toEqual({ x: 11.5, y: 14.5 });
    expect(spent(save, step)).toBe(3 * prices.move);
    // Three squares on the diagonal are 21.2 ft: 5 AP, not 3 as on squares.
    const three = planStep(worldOf(), save, { cell: { x: 3, y: 3 } });
    expect(spent(save, three)).toBe(5 * prices.move);
  });

  test('difficult ground doubles the cost', () => {
    // 15 ft along row 1, through the mud in column 9 or beside it.
    const open = standing({ x: 5, y: 1 });
    const dry = planStep(worldOf(), open, { cell: { x: 8, y: 1 } });
    const muddy = standing({ x: 8, y: 1 }, { gridPoint: { x: 42.5, y: 7.5 } });
    // All of the mud's width (5 ft) and 10 ft beyond.
    const wet = planStep(worldOf(), muddy, { cell: { x: 11, y: 1 } });
    expect(spent(open, dry)).toBe(3 * prices.move);
    expect(spent(muddy, wet)).toBe(2 * prices.move + prices.difficult);
    expect(prices.difficult).toBe(2 * prices.move);
  });

  // ── The preview is the charge ───────────────────────────────────────

  // The grid view as the page has it: loomGetMap's battleMap and the turn's
  // prices, through JSON.
  const pageOf = (world, save, record) => {
    const view = JSON.parse(JSON.stringify(mapView.battleView(world, save, record)));
    const turn = JSON.parse(JSON.stringify(mapView.turnView(save, world)));
    const known = seen.unpack(view.fog.seen, view.width, view.height);
    return { view, turn, known: (sq) => Boolean(known[sq.x + ',' + sq.y]) };
  };
  const preview = (page, cell) => {
    const plan = mp.viewPlanner(page.view, page.turn.prices, {
      goal: cell,
      known: page.known,
    });
    const people = (page.view.people || []).filter((p) => p.x !== undefined);
    return mp.moveTo(plan, page.view.herePoint, { cell }, page.turn.ap, {
      occupied: (sq) => people.some((p) => p.x === sq.x && p.y === sq.y),
    });
  };

  const DOORED = gridMap({
    ...RAW_HALL,
    id: 'bm_hall',
    walls: [
      {
        points: [
          { x: 4, y: 0 },
          { x: 4, y: 3 },
        ],
      },
      {
        points: [
          { x: 4, y: 4 },
          { x: 4, y: 8 },
        ],
      },
    ],
    doors: [{ id: 'iron', name: 'the iron door', from: { x: 4, y: 3 }, to: { x: 4, y: 4 }, ap: 5 }],
    obstacles: [
      ...RAW_HALL.obstacles,
      { id: 'pillar', name: 'a pillar', kind: 'solid', x: 2, y: 5 },
      { id: 'table', name: 'a table', kind: 'low', x: 6, y: 6, w: 2 },
    ],
  });
  const FIXTURES = [
    [
      'open ground and the gap',
      HALL,
      { x: 1, y: 1 },
      [
        { x: 6, y: 6 },
        { x: 11, y: 7 },
        { x: 3, y: 0 },
      ],
    ],
    [
      'a door with its own cost',
      DOORED,
      { x: 1, y: 3 },
      [
        { x: 7, y: 2 },
        { x: 10, y: 6 },
      ],
    ],
    [
      'round a pillar and a table',
      DOORED,
      { x: 1, y: 6 },
      [
        { x: 3, y: 6 },
        { x: 8, y: 7 },
      ],
    ],
  ];
  const record = (map, keys) => ({
    squares: seen.pack(Object.fromEntries(keys.map((k) => [k, true])), map.width, map.height),
    width: map.width,
    height: map.height,
    revision: map.revision || 0,
  });
  const everything = (map) => {
    const keys = [];
    for (let x = 0; x < map.width; x++) for (let y = 0; y < map.height; y++) keys.push(x + ',' + y);
    return keys;
  };

  test.each(FIXTURES)('the preview is the charge: %s', (_label, map, from, targets) => {
    const world = worldOf(map);
    for (const ap of [40, 7, 3]) {
      for (const cell of targets) {
        const save = standing(from, { ap });
        const rec = record(map, everything(map));
        const page = pageOf(world, save, rec);
        const shown = preview(page, cell);
        const step = planStep(world, save, { cell }, seen.knownTo(world, save, rec));
        if (step.refused) {
          expect(shown.none).toBeTruthy();
          continue;
        }
        const w = shown.walk;
        const stop = w.walked.length ? w.walked[w.walked.length - 1] : page.view.herePoint;
        const where = { cell, ap };
        expect({ ...where, spent: w.spent }).toEqual({ ...where, spent: spent(save, step) });
        if (step.exit) continue;
        expect({ ...where, x: stop.x, y: stop.y }).toEqual({ ...where, ...step.point });
        expect({ ...where, arrived: w.reached }).toEqual({ ...where, arrived: !step.turn.plan });
        // A whole move's preview is its cost.
        if (w.reached && !w.opened) expect(shown.path.ap).toBe(spent(save, step));
      }
    }
  });

  test('the preview is the charge on ground half seen, and beside someone in sight', () => {
    const map = DOORED;
    const world = {
      ...worldOf(map),
      characters: {
        wim: { id: 'wim', name: 'Wim', locationId: 'hall', cell: { x: 3, y: 1 } },
      },
    };
    // Only the west of the hall seen: columns 0–4.
    const keys = everything(map).filter((k) => Number(k.split(',')[0]) <= 4);
    for (const cell of [
      { x: 3, y: 1 },
      { x: 4, y: 7 },
      { x: 1, y: 7 },
    ]) {
      const save = standing({ x: 0, y: 2 }, { ap: 9 });
      const rec = record(map, keys);
      const page = pageOf(world, save, rec);
      const shown = preview(page, cell);
      const step = planStep(world, save, { cell }, seen.knownTo(world, save, rec));
      expect({ cell, refused: Boolean(step.refused) }).toEqual({
        cell,
        refused: Boolean(shown.none),
      });
      if (step.refused || step.exit) continue;
      expect({ cell, spent: shown.walk.spent }).toEqual({ cell, spent: spent(save, step) });
    }
  });
});

// ── The planner ──────────────────────────────────────────────────────

describe('sizes (SZ1)', () => {
  test('six classes, each a width; medium (2.5 ft) when none or an unknown one', () => {
    expect(mp.SIZES.map((s) => [s.id, s.width])).toEqual([
      ['tiny', 1],
      ['small', 1.5],
      ['medium', 2.5],
      ['large', 5],
      ['huge', 10],
      ['gargantuan', 15],
    ]);
    expect(mp.widthOf()).toBe(2.5);
    expect(mp.widthOf('vast')).toBe(2.5);
    expect(sheets.widthOf({ size: 'huge' })).toBe(10);
    expect(sheets.sizeName({ words: { 'size-huge': 'Capital ship' } }, 'huge')).toBe(
      'Capital ship'
    );
    expect(sheets.sizeName({}, 'huge')).toBe('Huge');
  });

  test('a sheet or stat block names a size; another is refused', () => {
    const system = BUILT_IN['d20-fantasy'];
    const sheet = sheets.defaultSheet(system);
    expect(sheets.validateSheet(system, { ...sheet, size: 'large' })).toEqual([]);
    expect(sheets.validateSheet(system, { ...sheet, size: 'vast' })).toEqual([
      'The size "vast" isn\'t one of tiny, small, medium, large, huge, gargantuan.',
    ]);
    const block = { attributes: sheet.attributes, size: 'small' };
    expect(sheets.sheetFromStatBlock(system, block).size).toBe('small');
    expect(sheets.validateStatBlock(system, block)).toEqual([]);
  });
});

describe('paths in feet', () => {
  const open = { id: 'o', width: 12, height: 8 };

  test('a gap or a corridor off the grid lines is passed by anyone no wider than it', () => {
    // A corridor 3 ft wide between walls at y = 18.3 and 21.3: no fine-grid
    // point lies on its middle line; the points nearest it are nudged in.
    const corridor = {
      id: 'c',
      width: 12,
      height: 8,
      geometry: {
        walls: [
          {
            id: 'a',
            material: 'stone',
            points: [
              [0, 18.3],
              [50, 18.3],
            ],
          },
          {
            id: 'b',
            material: 'stone',
            points: [
              [0, 21.3],
              [50, 21.3],
            ],
          },
        ],
      },
    };
    const medium = mp.planner(corridor, { width: 2.5 });
    const way = mp.pathTo(medium, { x: 2, y: 19.8 }, { x: 45, y: 19.8 });
    expect(way.ap).toBe(9); // 43 ft
    const small = mp.pathTo(
      mp.planner(corridor, { width: 1.5 }),
      { x: 2, y: 19.8 },
      { x: 45, y: 19.8 }
    );
    expect(small.ap).toBe(9);
    expect(
      mp.pathTo(mp.planner(corridor, { width: 3.2 }), { x: 2, y: 19.8 }, { x: 45, y: 19.8 })
    ).toBeNull();
    // A gap 2.6 ft wide between two wall ends, off the grid lines.
    const gap = {
      id: 'g',
      width: 12,
      height: 8,
      geometry: {
        walls: [
          {
            id: 'w1',
            material: 'stone',
            points: [
              [0, 20],
              [30.3, 20],
            ],
          },
          {
            id: 'w2',
            material: 'stone',
            points: [
              [32.9, 20],
              [60, 20],
            ],
          },
        ],
      },
    };
    expect(mp.pathTo(mp.planner(gap, {}), { x: 31.6, y: 10 }, { x: 31.6, y: 30 })).not.toBeNull();
    expect(
      mp.pathTo(mp.planner(gap, { width: 2.7 }), { x: 31.6, y: 10 }, { x: 31.6, y: 30 })
    ).toBeNull();
  });

  test('a path pulls straight round a corner, at any angle', () => {
    const corner = {
      id: 'k',
      width: 12,
      height: 8,
      geometry: {
        walls: [
          {
            id: 'w',
            material: 'stone',
            points: [
              [20, 0],
              [20, 25],
            ],
          },
        ],
      },
    };
    const way = mp.pathTo(mp.planner(corner, {}), { x: 10, y: 10 }, { x: 30, y: 10 });
    // Down round the wall's end, a half width (1.25 ft) clear of it, and
    // back up: the shortest way is two tangents to that circle and the arc
    // between them, 38.6 ft. The path is within 1% of it.
    const d = Math.hypot(10, 15);
    const tangent = Math.sqrt(d * d - 1.25 * 1.25);
    const arc = 2 * Math.PI - 2 * (Math.atan2(10, 15) + Math.acos(1.25 / d));
    const shortest = 2 * tangent + 1.25 * arc;
    expect(shortest).toBeCloseTo(38.6, 1);
    expect(way.feet).toBeGreaterThanOrEqual(shortest - 1e-6);
    expect(way.feet).toBeLessThan(shortest * 1.01);
    expect(way.points.every((p) => p.y < 30)).toBe(true);
  });

  test('the same way every time, and its cost rounded up once for the whole move', () => {
    const plan = mp.planner(open, {});
    const a = mp.pathTo(plan, { x: 2.5, y: 2.5 }, { x: 50, y: 33 });
    const b = mp.pathTo(mp.planner(open, {}), { x: 2.5, y: 2.5 }, { x: 50, y: 33 });
    expect(a).toEqual(b);
    expect(a.feet).toBeCloseTo(Math.hypot(47.5, 30.5), 9);
    expect(a.ap).toBe(Math.ceil(Math.hypot(47.5, 30.5) / 5));
    expect(mp.apFor(3 + 1e-12)).toBe(3); // 15 ft, however it's summed
  });

  test('a walk goes as far as its AP; a stop in the square it is going to has arrived', () => {
    const plan = mp.planner(open, {});
    const way = mp.pathTo(plan, { x: 2.5, y: 2.5 }, { x: 42.5, y: 2.5 }); // 40 ft
    const short = mp.walk(plan, way, 3);
    expect(short.spent).toBe(3);
    expect(short.walked[short.walked.length - 1]).toMatchObject({ x: 17.5, y: 2.5 });
    expect(short.reached).toBe(false);
    // 41.5 ft is 9 AP; 8 walks 40 ft, into the square it is going to.
    const near = mp.walk(plan, mp.pathTo(plan, { x: 2.5, y: 2.5 }, { x: 44, y: 2.5 }), 8, {
      arriveIn: { x: 8, y: 0 },
    });
    expect(near.reached).toBe(true);
    expect(mp.walk(plan, way, Infinity).spent).toBe(0); // AP off (L-838): free
  });

  test('a closed door on the way is opened from beside it, for its cost', () => {
    const doored = gridMap({
      id: 'd',
      width: 12,
      height: 8,
      walls: [
        {
          points: [
            { x: 4, y: 0 },
            { x: 4, y: 3 },
          ],
        },
        {
          points: [
            { x: 4, y: 4 },
            { x: 4, y: 8 },
          ],
        },
      ],
      doors: [{ id: 'iron', from: { x: 4, y: 3 }, to: { x: 4, y: 4 } }],
    });
    const plan = mp.planner(doored, { prices: { move: 1, difficult: 2, door: 3 } });
    const way = mp.pathTo(plan, { x: 2.5, y: 17.5 }, { x: 37.5, y: 17.5 });
    expect(way.doors).toEqual([{ id: 'iron', at: 0 }]);
    expect(way.ap).toBe(7 + 3); // 35 ft and the door
    const w = mp.walk(plan, way, 20);
    expect(w.opened).toBe('iron');
    // It stops 5 ft from the door: beside it, as a square's reach.
    const stop = w.walked[w.walked.length - 1];
    expect(20 - stop.x).toBeLessThanOrEqual(5);
    expect(w.spent).toBe(mp.apFor(stop.weight) + 3);
    // Opened (the save's state), it walks straight through.
    const after = mp.planner(doored, { states: { iron: 'open' } });
    expect(mp.pathTo(after, stop, { x: 37.5, y: 17.5 }).doors).toEqual([]);
    // Locked, there's no way.
    expect(
      mp.pathTo(
        mp.planner(doored, { states: { iron: 'locked' } }),
        { x: 2.5, y: 17.5 },
        { x: 37.5, y: 17.5 }
      )
    ).toBeNull();
  });

  test('the squares this turn reaches, by their centres', () => {
    const plan = mp.planner(open, {});
    const squares = mp.reachable(plan, { x: 7.5, y: 7.5 }, 2);
    const keys = squares.map((s) => s.x + ',' + s.y);
    expect(keys).toContain('3,1'); // 10 ft along the row: 2 AP
    expect(keys).toContain('2,2'); // a diagonal square: 7.1 ft, 2 AP
    expect(keys).not.toContain('3,3'); // 14.1 ft: 3 AP
    expect(squares.every((s) => s.ap <= 2)).toBe(true);
  });

  test('layers from before are stored as geometry: walls, doors in walls, obstacles', () => {
    const layered = {
      width: 8,
      height: 6,
      walls: [
        {
          points: [
            { x: 0, y: 2 },
            { x: 3, y: 2 },
          ],
        },
      ],
      doors: [
        {
          id: 'd1',
          name: 'the door',
          from: { x: 3, y: 2 },
          to: { x: 4, y: 2 },
          locked: true,
          key: 'a key',
          ap: 4,
        },
      ],
      obstacles: [
        { id: 'p', kind: 'solid', x: 5, y: 4 },
        { id: 't', kind: 'low', x: 6, y: 4 },
        { id: 'm', kind: 'difficult', x: 1, y: 4, w: 2 },
      ],
    };
    const g = geo.fromLayers(layered);
    expect(geo.check(g, geo.boundsOf(layered))).toEqual([]);
    expect(g.doors[0]).toMatchObject({
      id: 'd1',
      state: 'locked',
      unlocks: { key: 'a key' },
      ap: 4,
    });
    expect(g.walls.find((w) => w.id === 'layer-t')).toMatchObject({
      blocksSight: false,
      height: 3,
    });
    expect(g.ground[0]).toMatchObject({ cost: 2, shape: { rect: { x: 5, y: 20, w: 10, h: 5 } } });
    // Stored (L-928), a map's own geometry is kept beside them, its items
    // winning on an id; and play reads only what's stored, never the layers.
    const both = layerGeometry.converted({
      ...layered,
      geometry: { walls: [{ id: 'layer-p', material: 'brick', points: 'M0 0 L5 0' }] },
    });
    expect(both.walls.filter((w) => w.id === 'layer-p')).toEqual([
      { id: 'layer-p', material: 'brick', points: 'M0 0 L5 0' },
    ]);
    expect(mp.geometryOf(layered)).toEqual({});
  });
});

describe("the browser's copy", () => {
  const served = path.join(__dirname, '../public/apps/loom/js/map-paths.js');

  test('is identical to the server’s, and loads as Loom.mapPaths after map-geometry.js', () => {
    expect(fs.readFileSync(served, 'utf8')).toBe(
      fs.readFileSync(path.join(__dirname, '../functions/loom-canon/map-paths.js'), 'utf8')
    );
    const page = { window: { Loom: {} } };
    for (const file of ['materials.js', 'map-geometry.js', 'map-paths.js']) {
      vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '../public/apps/loom/js', file), 'utf8'),
        page
      );
    }
    expect(typeof page.window.Loom.mapPaths.moveTo).toBe('function');
    const html = fs.readFileSync(path.join(__dirname, '../public/apps/loom/index.html'), 'utf8');
    const at = (f) => html.indexOf(`<script src="/apps/loom/js/${f}"></script>`);
    expect(at('map-paths.js')).toBeGreaterThan(at('map-geometry.js'));
    expect(at('battle.js')).toBeGreaterThan(at('map-paths.js'));
  });
});
