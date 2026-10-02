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

  test('a small image is not scaled up', () => {
    const { legend } = images.renderBattleMap(TAVERN, png(600, 400));
    expect(legend.image).toEqual({ width: 600, height: 400 });
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
