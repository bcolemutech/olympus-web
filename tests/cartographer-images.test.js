'use strict';

/**
 * The images Claude sees (functions/mcp/apps/cartographer/images.js;
 * planning/the-loom-layered-worlds.md §9; L-355 / #417): battle maps and towns
 * with their placement overlaid, on their art or a plain background, and the
 * world map, scaled down and returned as JPEG. Pure; no emulator. Pixels are
 * read back from the JPEG, so colours are checked loosely.
 *
 * Run: cd tests && npx jest cartographer-images --verbose
 */

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { PNG } = require(require.resolve('pngjs', { paths: [functionsDir] }));
const jpeg = require(require.resolve('jpeg-js', { paths: [functionsDir] }));
const images = require('../functions/mcp/apps/cartographer/images');

// A solid PNG of the given size and colour.
function png(width, height, rgb = [150, 120, 90]) {
  const img = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    img.data[i * 4] = rgb[0];
    img.data[i * 4 + 1] = rgb[1];
    img.data[i * 4 + 2] = rgb[2];
    img.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(img);
}
const decoded = (jpg) => jpeg.decode(jpg, { useTArray: true });
const pixel = (img, x, y) => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const near = (actual, expected, slack = 40) =>
  actual.every((v, i) => Math.abs(v - expected[i]) <= slack);

const TAVERN = {
  id: 'bm_tavern',
  name: 'The Gull & Anchor',
  width: 12,
  height: 8,
  entries: [{ id: 'door', x: 1, y: 4 }],
  exits: [{ id: 'front-door', name: 'the front door', x: 0, y: 4, to: 'out' }],
  features: [{ id: 'bar', name: 'the bar', x: 3, y: 2 }],
};

describe('battle maps', () => {
  test('without art: a plain grid, with numbered markers at the centres of their cells', () => {
    const { jpeg: jpg, legend } = images.renderBattleMap(TAVERN, null);
    const img = decoded(jpg);
    expect([img.width, img.height]).toEqual([legend.image.width, legend.image.height]);
    expect(img.width / img.height).toBeCloseTo(12 / 8, 2);
    expect(legend).toMatchObject({
      of: 'battleMap',
      art: false,
      grid: { width: 12, height: 8 },
      markers: [
        { n: 1, type: 'entry', id: 'door', cell: { x: 1, y: 4 } },
        { n: 2, type: 'exit', id: 'front-door', name: 'the front door', cell: { x: 0, y: 4 } },
        { n: 3, type: 'feature', id: 'bar', name: 'the bar', cell: { x: 3, y: 2 } },
      ],
    });
    const cell = legend.cellSize.width;
    const centre = (c) => [(c.x + 0.5) * cell, (c.y + 0.5) * cell];
    expect(near(pixel(img, ...centre({ x: 1, y: 4 })), [102, 187, 106])).toBe(true); // entry: green
    expect(near(pixel(img, ...centre({ x: 0, y: 4 })), [239, 83, 80])).toBe(true); // exit: red
    expect(near(pixel(img, ...centre({ x: 3, y: 2 })), [255, 183, 77])).toBe(true); // feature: amber
    expect(near(pixel(img, ...centre({ x: 8, y: 6 })), [26, 31, 44])).toBe(true); // plain ground
  });

  test('with art: stretched to the grid, scaled down to at most 1568 px', () => {
    const { jpeg: jpg, legend } = images.renderBattleMap(TAVERN, png(2000, 1400));
    const img = decoded(jpg);
    expect(legend.art).toBe(true);
    expect(Math.max(img.width, img.height)).toBe(images.MAX_SIDE);
    expect(legend.cellSize.width).toBeCloseTo(img.width / 12, 2);
    // Away from the grid lines and markers, the art shows through.
    expect(
      near(pixel(img, legend.cellSize.width * 8.3, legend.cellSize.height * 6.3), [150, 120, 90])
    ).toBe(true);
  });

  test('SVG art (L-356): drawn to the grid, one viewBox unit per cell', () => {
    // A dark red cell at (8, 6), on a brown floor.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8">' +
      '<rect width="12" height="8" fill="#6d5a45"/>' +
      '<rect x="8" y="6" width="1" height="1" fill="#a01818"/></svg>';
    const { jpeg: jpg, legend } = images.renderBattleMap(TAVERN, Buffer.from(svg));
    const img = decoded(jpg);
    expect(legend.art).toBe(true);
    expect(Math.max(img.width, img.height)).toBe(images.MAX_SIDE);
    const cell = legend.cellSize.width;
    expect(near(pixel(img, 8.5 * cell, 6.5 * cell), [160, 24, 24])).toBe(true);
    expect(near(pixel(img, 6.5 * cell, 6.5 * cell), [109, 90, 69])).toBe(true);
  });

  test('transparent art shows the plain background, not black', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8">' +
      '<rect x="0" y="0" width="6" height="8" fill="#e0e0e0"/></svg>';
    const { jpeg: jpg, legend } = images.renderBattleMap(TAVERN, Buffer.from(svg));
    const img = decoded(jpg);
    const cell = legend.cellSize.width;
    expect(near(pixel(img, 10.5 * cell, 6.5 * cell), [26, 31, 44])).toBe(true); // see-through
    expect(near(pixel(img, 4.5 * cell, 6.5 * cell), [224, 224, 224])).toBe(true);
  });

  test('a small image is not scaled up', () => {
    const { legend } = images.renderBattleMap(TAVERN, png(600, 400));
    expect(legend.image).toEqual({ width: 600, height: 400 });
  });
});

describe('battle-map layers (L-623)', () => {
  // A back room: an inner wall at x = 4 with a locked door in its gap at
  // y 2–3, a low table, a solid pillar and rubble.
  const ROOM = {
    id: 'bm_room',
    name: 'The back room',
    width: 8,
    height: 6,
    entries: [{ id: 'in', x: 1, y: 3 }],
    exits: [{ id: 'out', name: 'the hall door', x: 0, y: 3, to: 'out' }],
    features: [{ id: 'chest', name: 'the chest', x: 6, y: 1 }],
    walls: [
      {
        points: [
          { x: 4, y: 0 },
          { x: 4, y: 2 },
        ],
      },
      {
        points: [
          { x: 4, y: 3 },
          { x: 4, y: 6 },
        ],
      },
    ],
    doors: [
      {
        id: 'inner',
        name: 'the inner door',
        from: { x: 4, y: 2 },
        to: { x: 4, y: 3 },
        locked: true,
      },
    ],
    obstacles: [
      { id: 'table', name: 'a table', kind: 'low', x: 2, y: 1, w: 2 },
      { id: 'pillar', name: 'a pillar', kind: 'solid', x: 6, y: 4 },
      { id: 'rubble', name: 'rubble', kind: 'difficult', x: 1, y: 5, w: 2 },
    ],
  };
  // The share of a rectangle's pixels near a colour.
  const share = (img, x0, y0, x1, y1, rgb, slack = 45) => {
    let near_ = 0;
    let all = 0;
    for (let y = Math.ceil(y0); y < y1; y++) {
      for (let x = Math.ceil(x0); x < x1; x++) {
        all += 1;
        if (near(pixel(img, x, y), rgb, slack)) near_ += 1;
      }
    }
    return near_ / all;
  };

  test.each([
    ['plain ground', null],
    ['art', 'art'],
  ])(
    'on %s: walls white on their grid line, the door amber, obstacles shaded by kind',
    (_l, art) => {
      const { jpeg: jpg, legend } = images.renderBattleMap(ROOM, art ? png(800, 600) : null);
      const img = decoded(jpg);
      const cw = legend.cellSize.width;
      const ch = legend.cellSize.height;
      // The wall: on the line x = 4, white; a square to either side, not.
      expect(near(pixel(img, 4 * cw, 0.5 * ch), [255, 255, 255])).toBe(true);
      expect(near(pixel(img, 4 * cw, 4.5 * ch), [255, 255, 255])).toBe(true);
      expect(near(pixel(img, 3.5 * cw, 4.5 * ch), [255, 255, 255])).toBe(false);
      // The door: amber, in the wall's gap.
      expect(near(pixel(img, 4 * cw, 2.7 * ch), [255, 183, 77])).toBe(true);
      // The pillar: solid, filled dark.
      expect(share(img, 6.2 * cw, 4.2 * ch, 6.8 * cw, 4.8 * ch, [12, 14, 20], 40)).toBeGreaterThan(
        0.6
      );
      // The table: hatched, part tan and part ground.
      const hatched = share(img, 2.2 * cw, 1.2 * ch, 3.8 * cw, 1.8 * ch, [205, 170, 125], 50);
      expect(hatched).toBeGreaterThan(0.1);
      expect(hatched).toBeLessThan(0.7);
      // The rubble: dotted, mostly ground with light dots.
      const dotted = share(img, 1.2 * cw, 5.2 * ch, 2.8 * cw, 5.8 * ch, [190, 190, 190], 50);
      expect(dotted).toBeGreaterThan(0.01);
      expect(dotted).toBeLessThan(0.35);
    }
  );

  test('the legend numbers the door and each obstacle, after the rest', () => {
    const { legend } = images.renderBattleMap(ROOM, null);
    expect(legend.walls).toBe(2);
    expect(legend.markers.slice(3)).toEqual([
      {
        n: 4,
        type: 'door',
        id: 'inner',
        name: 'the inner door',
        from: { x: 4, y: 2 },
        to: { x: 4, y: 3 },
        locked: true,
      },
      {
        n: 5,
        type: 'obstacle',
        id: 'table',
        name: 'a table',
        kind: 'low',
        cells: { x: 2, y: 1, w: 2, h: 1 },
      },
      {
        n: 6,
        type: 'obstacle',
        id: 'pillar',
        name: 'a pillar',
        kind: 'solid',
        cells: { x: 6, y: 4, w: 1, h: 1 },
      },
      {
        n: 7,
        type: 'obstacle',
        id: 'rubble',
        name: 'rubble',
        kind: 'difficult',
        cells: { x: 1, y: 5, w: 2, h: 1 },
      },
    ]);
    expect(legend.reading).toMatch(/white lines are walls and amber bars doors/);
  });

  test('a map without layers draws as before, with none in the legend', () => {
    const { legend } = images.renderBattleMap(TAVERN, null);
    expect(legend.walls).toBe(0);
    expect(legend.markers.every((m) => ['entry', 'exit', 'feature'].includes(m.type))).toBe(true);
  });
});

describe('towns', () => {
  const PLACES = [
    {
      id: 'plc_gate',
      name: 'The Trailhead',
      entrance: { via: ['trail'] },
      position: { x: 900, y: 100 },
      connections: ['plc_market'],
    },
    {
      id: 'plc_market',
      name: 'Fish Market',
      position: { x: 500, y: 500 },
      connections: ['plc_gate'],
    },
    { id: 'plc_tower', name: 'The Tower' },
  ];

  test('markers at the places’ positions on the 0–1000 square; the unplaced are listed', () => {
    const { jpeg: jpg, legend } = images.renderTown(
      {},
      { id: 'loc_450', name: 'Hatham' },
      PLACES,
      null
    );
    const img = decoded(jpg);
    const k = img.width / 1000;
    expect(legend).toMatchObject({
      of: 'town',
      art: false,
      markers: [
        { n: 1, id: 'plc_gate', name: 'The Trailhead', wayIn: true, position: { x: 900, y: 100 } },
        { n: 2, id: 'plc_market', name: 'Fish Market', wayIn: false, position: { x: 500, y: 500 } },
      ],
      notPositioned: [{ id: 'plc_tower', name: 'The Tower' }],
    });
    expect(near(pixel(img, 900 * k, 100 * k), [128, 203, 196])).toBe(true); // a way in
    expect(near(pixel(img, 500 * k, 500 * k), [129, 212, 250])).toBe(true); // a place
    // The link between them.
    expect(near(pixel(img, 750 * k, 250 * k), [240, 240, 240], 40)).toBe(true); // a bright line
  });

  test('art is fitted inside the square, centred, as the town view draws it', () => {
    const { jpeg: jpg, legend } = images.renderTown(
      {},
      { id: 'loc_450', name: 'Hatham' },
      [],
      png(1600, 800, [200, 60, 60])
    );
    const img = decoded(jpg);
    expect(legend.image).toEqual({ width: 1568, height: 1568 });
    expect(near(pixel(img, 800, 834), [200, 60, 60])).toBe(true); // inside the art, off the grid
    expect(near(pixel(img, 784 + 30, 120), [26, 31, 44])).toBe(true); // the band above it
  });
});

test('on art, a place still sits at its position, scaled to the image', () => {
  const places = [
    { id: 'plc_well', name: 'The Well', position: { x: 250, y: 600 }, connections: [] },
  ];
  const { jpeg: jpg, legend } = images.renderTown(
    {},
    { id: 'loc_450', name: 'Hatham' },
    places,
    png(1600, 1600, [90, 90, 90])
  );
  const img = decoded(jpg);
  const k = legend.image.width / 1000;
  expect(k).toBeCloseTo(1.568, 3);
  expect(near(pixel(img, 250 * k, 600 * k), [129, 212, 250])).toBe(true);
});

test('the world map: scaled down, with how map coordinates fall on the image', () => {
  const { legend } = images.renderWorld(
    { name: 'Nisia', map: { width: 1718, height: 1270 } },
    png(2062, 1524)
  );
  expect(legend.image).toEqual({ width: 1568, height: 1159 });
  expect(legend.mapCoordinates).toEqual({ width: 1718, height: 1270 });
  expect(legend.reading).toMatch(/× 0\.913/);
});

test('what is not a PNG, or too large to decode, is refused', () => {
  expect(() => images.renderBattleMap(TAVERN, Buffer.from('not a png, just words'))).toThrow(
    /not a PNG/
  );
  const huge = Buffer.from(png(4, 4));
  huge.writeUInt32BE(9000, 16); // IHDR width
  huge.writeUInt32BE(9000, 20); // IHDR height
  expect(() => images.renderBattleMap(TAVERN, huge)).toThrow(/too large to view \(9000 × 9000\)/);
});

describe('people (L-684): teal diamonds, numbered in the legend', () => {
  const TEAL = [77, 182, 172];

  test('on a battle map: at the centre of their square, with the place they stand at', () => {
    const { jpeg: jpg, legend } = images.renderBattleMap(TAVERN, null, [
      { id: 'chr_mags', name: 'Old Mags', x: 7, y: 5, at: { id: 'plc_inn', name: 'The inn' } },
    ]);
    const img = decoded(jpg);
    expect(legend.markers.at(-1)).toEqual({
      n: 4,
      type: 'person',
      id: 'chr_mags',
      name: 'Old Mags',
      cell: { x: 7, y: 5 },
      at: { id: 'plc_inn', name: 'The inn' },
    });
    const cell = legend.cellSize.width;
    expect(near(pixel(img, 7.5 * cell, 5.5 * cell), TEAL)).toBe(true);
    // A diamond: its corners are bare ground.
    expect(near(pixel(img, 7.5 * cell + cell / 3, 5.5 * cell + cell / 3), TEAL)).toBe(false);
    expect(legend.reading).toMatch(/teal diamonds people/);
  });

  test('in a town: at their town points, after the places', () => {
    const { jpeg: jpg, legend } = images.renderTown(
      {},
      { id: 'loc_450', name: 'Hatham' },
      [{ id: 'plc_gate', name: 'The gate', entrance: {}, position: { x: 900, y: 100 } }],
      null,
      [
        { id: 'chr_ada', name: 'Ada Brine', x: 300, y: 700 },
        {
          id: 'chr_wim',
          name: 'Wim',
          x: 600,
          y: 200,
          place: { id: 'plc_market', name: 'Market Square' },
        },
      ]
    );
    const img = decoded(jpg);
    const k = img.width / 1000;
    expect(legend.markers.slice(1)).toEqual([
      { n: 2, type: 'person', id: 'chr_ada', name: 'Ada Brine', position: { x: 300, y: 700 } },
      {
        n: 3,
        type: 'person',
        id: 'chr_wim',
        name: 'Wim',
        position: { x: 600, y: 200 },
        place: { id: 'plc_market', name: 'Market Square' },
      },
    ]);
    expect(near(pixel(img, 300 * k, 700 * k), TEAL)).toBe(true);
    expect(near(pixel(img, 600 * k, 200 * k), TEAL)).toBe(true);
    expect(legend.reading).toMatch(/Teal diamonds are people about town/);
  });

  test('on the world map: the wilderness, at their world points scaled to the image', () => {
    const { jpeg: jpg, legend } = images.renderWorld(
      { name: 'Nisia', map: { width: 1718, height: 1270 } },
      png(1718, 1270, [60, 60, 60]),
      [{ id: 'chr_wanderer', name: 'Wanderer', x: 812, y: 400 }]
    );
    const img = decoded(jpg);
    const k = img.width / 1718;
    expect(legend.markers).toEqual([
      { n: 1, type: 'person', id: 'chr_wanderer', name: 'Wanderer', position: { x: 812, y: 400 } },
    ]);
    expect(near(pixel(img, 812 * k, 400 * k), TEAL)).toBe(true);
    expect(legend.reading).toMatch(/people in the wilderness/);
    // Nobody in the wilderness: no markers.
    expect(
      images.renderWorld({ name: 'Nisia', map: { width: 1718, height: 1270 } }, png(20, 15)).legend
        .markers
    ).toBeUndefined();
  });
});
