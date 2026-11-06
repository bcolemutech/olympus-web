'use strict';

/**
 * view_image's drawing of a map's geometry (planning/maps-from-data.md §4.8;
 * L-929 / #733), pure: renderBattleMap and renderMap decoded and read at
 * known points, and their legends. A crypt 12 × 8 squares (60 × 40 ft) is 576
 * × 384 pixels, 9.6 a foot.
 *
 *   - floors are filled by material, brighter the higher and darker the lower
 *     (and plain with heights off); water is darker the deeper;
 *   - walls are drawn at any angle, doors by state, windows; a hidden thing is
 *     marked, and with hidden off the map is drawn as players see it: its
 *     marks gone, a hidden door drawn as the wall it stands in;
 *   - what is numbered comes after entries, exits and features, with the id to
 *     patch it by, and no door is numbered twice;
 *   - fog from a point shades what it can't see;
 *   - a region map is drawn in its own units, on its backdrop, with its places.
 *
 * Run: cd tests && npx jest cartographer-geometry-image --verbose
 */

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const jpeg = require(require.resolve('jpeg-js', { paths: [functionsDir] }));
const geo = require('../functions/loom-canon/map-geometry');
const sight = require('../functions/loom-canon/sight');
const { renderBattleMap, renderMap } = require('../functions/mcp/apps/cartographer/images');

const K = 9.6;
const crypt = (more = {}) => ({
  id: 'bm_crypt',
  name: 'The crypt',
  width: 12,
  height: 8,
  entries: [{ id: 'in', x: 1, y: 6 }],
  exits: [{ id: 'out', name: 'the stair', x: 0, y: 4, to: 'out' }],
  features: [{ id: 'altar', name: 'the altar', x: 10, y: 1 }],
  geometry: geo.normalize({
    ground: [
      { id: 'floor', material: 'stone', shape: { rect: { x: 0, y: 0, w: 60, h: 40 } } },
      { id: 'dais', material: 'stone', height: 20, shape: { rect: { x: 40, y: 5, w: 15, h: 10 } } },
      {
        id: 'pit',
        material: 'stone',
        height: -20,
        shape: { rect: { x: 10, y: 10, w: 10, h: 10 } },
      },
      { id: 'pool', material: 'water', depth: 20, shape: { rect: { x: 40, y: 25, w: 15, h: 10 } } },
    ],
    walls: [
      {
        id: 'divide',
        material: 'stone',
        points: [
          [30, 0],
          [30, 40],
        ],
      },
      {
        id: 'diag',
        material: 'brick',
        points: [
          [0, 40],
          [30, 10],
        ],
      },
    ],
    doors: [
      {
        id: 'gate',
        material: 'wood',
        name: 'the gate',
        from: [30, 15],
        to: [30, 20],
        wall: 'divide',
        state: 'locked',
      },
      { id: 'arch', material: 'wood', from: [30, 5], to: [30, 10], wall: 'divide', state: 'open' },
      {
        id: 'secret',
        material: 'wood',
        name: 'a secret door',
        from: [30, 25],
        to: [30, 30],
        wall: 'divide',
      },
    ],
    windows: [{ id: 'slit', material: 'glass', from: [30, 32], to: [30, 35], wall: 'divide' }],
    objects: [
      {
        id: 'chest',
        kind: 'chest',
        name: 'the chest',
        at: [7.5, 32.5],
        size: [3, 2],
        container: true,
      },
      { id: 'stool', kind: 'chair', at: [20, 35], size: [2, 2] },
    ],
    zones: [
      { id: 'vestibule', name: 'the vestibule', shape: { rect: { x: 0, y: 0, w: 28, h: 8 } } },
    ],
    spawns: [{ id: 'den', at: [47, 10], what: 'goblin', count: 2 }],
    lights: [{ id: 'torch', at: [12, 20], radius: 6 }],
    notes: [{ id: 'smell', text: 'The air smells of old smoke.', at: [5, 5] }],
    hidden: [{ id: 'secret', dc: 12 }],
  }),
  ...more,
});

const picture = (rendered) => jpeg.decode(Buffer.from(rendered.jpeg), { useTArray: true });
const at = (img, ftX, ftY) => {
  const i = (Math.round(ftY * K) * img.width + Math.round(ftX * K)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const near = (got, want, slack = 28) =>
  got.every((v, i) => Math.abs(v - want[i]) <= slack) ||
  (() => {
    throw new Error(`colour ${got} isn't within ${slack} of ${want}`);
  })();
const luma = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;
const magenta = (img) => {
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i] > 200 && img.data[i + 1] < 110 && img.data[i + 2] > 160) n++;
  }
  return n;
};

describe('a battle map drawn from its geometry', () => {
  test('floors by material, brighter higher and darker lower; plain with heights off', () => {
    const rendered = renderBattleMap(crypt(), null, [], {});
    const img = picture(rendered);
    // A floor a stone grey; the dais (+20 ft) brighter, the pit (-20 ft) darker.
    near(at(img, 36, 31), [110, 112, 120]);
    expect(luma(at(img, 52, 13))).toBeGreaterThan(luma(at(img, 36, 31)) + 20);
    expect(luma(at(img, 18, 12))).toBeLessThan(luma(at(img, 36, 31)) - 15);
    expect(rendered.legend.heights).toEqual([
      { id: 'dais', height: 20 },
      { id: 'pit', height: -20 },
    ]);
    const flat = picture(renderBattleMap(crypt(), null, [], { heights: false }));
    near(at(flat, 52, 13), at(flat, 36, 31), 12);
    near(at(flat, 18, 12), at(flat, 36, 31), 12);
    // Water is darker the deeper.
    expect(luma(at(img, 47, 31))).toBeLessThan(luma([40, 100, 190]) - 10);
  });

  test('walls at any angle, doors by state, windows', () => {
    const img = picture(renderBattleMap(crypt(), null, [], {}));
    // The brick wall runs on the diagonal from (0, 40) to (30, 10): its middle is brick-red.
    near(at(img, 15, 25), [200, 115, 95], 40);
    // The straight wall's stone white, a locked gate red, an open arch fainter, a window cyan.
    near(at(img, 30, 2), [225, 225, 230], 35);
    near(at(img, 30, 17.5), [225, 95, 75], 40);
    near(at(img, 30, 7.5), at(img, 30, 7.5), 0);
    expect(luma(at(img, 30, 7.5))).toBeLessThan(luma(at(img, 30, 17.5)) + 120);
    near(at(img, 30, 33.5), [150, 215, 240], 45);
  });

  test('what is hidden is marked; with hidden off the map is as players see it', () => {
    const shown = picture(renderBattleMap(crypt(), null, [], {}));
    const plain = renderBattleMap(crypt(), null, [], { hidden: false });
    const players = picture(plain);
    expect(magenta(shown)).toBeGreaterThan(40);
    expect(magenta(players)).toBe(0);
    // The secret door (30, 25–30) is a wall to them, not a door: stone white, no gap.
    near(at(players, 30, 27.5), [225, 225, 230], 35);
    expect(plain.legend.markers.some((m) => m.id === 'secret')).toBe(false);
    expect(plain.legend.options).toEqual({ heights: true, hidden: false });
  });

  test('numbered after the entries, exits and features, each with its id to patch it by', () => {
    const { legend } = renderBattleMap(crypt(), null, [], {});
    expect(legend.markers.map((m) => [m.n, m.type, m.id])).toEqual([
      [1, 'entry', 'in'],
      [2, 'exit', 'out'],
      [3, 'feature', 'altar'],
      [4, 'zone', 'vestibule'],
      [5, 'object', 'chest'],
      [6, 'light', 'torch'],
      [7, 'door', 'gate'],
      [8, 'door', 'arch'],
      [9, 'door', 'secret'],
      [10, 'spawn', 'den'],
      [11, 'note', 'smell'],
      [12, 'hidden', 'secret'],
    ]);
    // Scenery with no name or setting (the stool) isn't numbered.
    expect(legend.markers.find((m) => m.id === 'stool')).toBeUndefined();
    expect(legend.markers.find((m) => m.id === 'den')).toMatchObject({ what: 'goblin', count: 2 });
    expect(legend.markers.find((m) => m.n === 12)).toMatchObject({ of: 'doors', dc: 12 });
    expect(legend.geometry).toMatchObject({
      ground: 4,
      walls: 2,
      doors: 3,
      windows: 1,
      objects: 2,
    });
  });

  test('a door the grid tools number is not numbered twice', () => {
    const { legend } = renderBattleMap(
      crypt({
        doors: [{ id: 'gate', name: 'the gate', from: { x: 6, y: 3 }, to: { x: 6, y: 4 } }],
      }),
      null,
      [],
      {}
    );
    expect(legend.markers.filter((m) => m.type === 'door' && m.id === 'gate')).toHaveLength(1);
  });

  test('fog from a point shades what it can not see', () => {
    const map = crypt();
    const seen = sight.inSight(map, { cell: { x: 1, y: 6 }, point: { x: 7.5, y: 32.5 } }, {});
    const fogged = picture(
      renderBattleMap(map, null, [], { sight: { from: '7.5, 32.5 ft', seen } })
    );
    const clear = picture(renderBattleMap(map, null, [], {}));
    // Behind the divide, not in sight, is darker than without the fog.
    expect(Object.keys(seen).length).toBeLessThan(96);
    expect(luma(at(fogged, 51, 38))).toBeLessThan(luma(at(clear, 51, 38)) - 20);
    expect(luma(at(fogged, 7.5, 32.5))).toBeGreaterThan(luma(at(fogged, 51, 38)));
  });
});

describe('a region map drawn in its own units', () => {
  const region = {
    id: 'map_world',
    kind: 'region',
    name: 'The Reach',
    space: { width: 1000, height: 800 },
    backdrop: { colour: '#101828' },
    geometry: geo.normalize({
      ground: [
        { id: 'plain', material: 'grass', shape: { rect: { x: 0, y: 0, w: 500, h: 400 } } },
        { id: 'sea', material: 'ocean', shape: { rect: { x: 500, y: 0, w: 500, h: 400 } } },
      ],
      lines: [
        {
          id: 'river',
          material: 'river',
          points: [
            [0, 250],
            [500, 250],
          ],
        },
      ],
      zones: [
        { id: 'march', name: 'the March', shape: { rect: { x: 0, y: 400, w: 300, h: 200 } } },
      ],
    }),
  };
  const places = [
    { id: 'plc_vega', name: 'Vega', kind: 'star', at: { x: 250, y: 100 } },
    { id: 'plc_nowhere', name: 'Nowhere', kind: 'star' },
  ];

  test('terrain by material on the backdrop, a grid in its units, places and zones numbered', () => {
    const rendered = renderMap(region, places, {});
    const img = picture(rendered);
    expect(img.width).toBe(1200);
    expect(img.height).toBe(960);
    const px = (x, y) => {
      const i = (Math.round(y * 1.2) * img.width + Math.round(x * 1.2)) * 4;
      return [img.data[i], img.data[i + 1], img.data[i + 2]];
    };
    near(px(120, 40), [76, 130, 62], 30);
    near(px(750, 40), [28, 70, 150], 30);
    near(px(850, 650), [16, 24, 40], 18);
    near(px(380, 250), [60, 130, 220], 40);
    expect(rendered.legend).toMatchObject({
      of: 'map',
      kind: 'region',
      space: { width: 1000, height: 800 },
      scale: 1.2,
      gridStep: 100,
      geometry: { ground: 2, lines: 1, zones: 1 },
    });
    // Places first (a place with no position isn't drawn), then what the geometry holds.
    expect(rendered.legend.markers.map((m) => [m.n, m.type, m.id])).toEqual([
      [1, 'place', 'plc_vega'],
      [2, 'zone', 'march'],
    ]);
  });
});
