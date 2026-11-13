'use strict';

/**
 * A small synthetic Azgaar full JSON export (L-717 / #822), the test fixture
 * for scripts/azgaar/layer.cjs: a 12 × 10 grid of square cells, 10 units
 * each, shaped like a real export (pack.cells with their outlines `v` and
 * centres `p`, pack.vertices, features, biomes, rivers, states, provinces,
 * burgs). Nisia's own save is never committed.
 *
 *   the sea      the border ring of cells (h 10, feature 1, an ocean)
 *   the land     grassland (h 30), feature 2, an island
 *   a forest     a 3 × 3 patch at columns 2–4, rows 2–4
 *   two forest   cells touching at a corner: (8, 7) and (9, 8)
 *   a mountain   one cell at (9, 2), h 75
 *   a lake       columns 7–8, rows 5–6 (h 15, feature 3, freshwater)
 *   provinces    1 Westfold (state 1 Aldmark): columns 1–5; 2 Eastreach
 *                (state 2 Brenn): columns 6–10, round the lake
 *   rivers       1 the Sil along row 7, columns 2–6; 2 a creek down column 3,
 *                rows 5–6
 *   burgs        1 Oakham at (35, 35), in the forest; 2 Fenwick at (95, 65)
 */

const COLS = 12;
const ROWS = 10;
const SIZE = 10;

const BIOMES = [
  'Marine',
  'Hot desert',
  'Cold desert',
  'Savanna',
  'Grassland',
  'Tropical seasonal forest',
  'Temperate deciduous forest',
  'Tropical rainforest',
  'Temperate rainforest',
  'Taiga',
  'Tundra',
  'Glacier',
  'Wetland',
];

function syntheticSave() {
  const vertices = [];
  const vid = (x, y) => y * (COLS + 1) + x;
  for (let y = 0; y <= ROWS; y++) {
    for (let x = 0; x <= COLS; x++) {
      vertices.push({ i: vid(x, y), p: [x * SIZE, y * SIZE], v: [], c: [] });
    }
  }
  const cid = (x, y) => y * COLS + x;
  const forest = (x, y) =>
    (x >= 2 && x <= 4 && y >= 2 && y <= 4) || (x === 8 && y === 7) || (x === 9 && y === 8);
  const lake = (x, y) => x >= 7 && x <= 8 && y >= 5 && y <= 6;
  const cells = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const sea = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
      const cell = {
        i: cid(x, y),
        // Clockwise on the screen, as Azgaar's are.
        v: [vid(x, y), vid(x + 1, y), vid(x + 1, y + 1), vid(x, y + 1)],
        p: [x * SIZE + SIZE / 2, y * SIZE + SIZE / 2],
        h: 30,
        f: 2,
        biome: 4,
        province: x <= 5 ? 1 : 2,
        state: x <= 5 ? 1 : 2,
        burg: 0,
      };
      if (sea) Object.assign(cell, { h: 10, f: 1, biome: 0, province: 0, state: 0 });
      else if (lake(x, y)) Object.assign(cell, { h: 15, f: 3, biome: 0, province: 0, state: 0 });
      else if (forest(x, y)) cell.biome = 6;
      if (x === 9 && y === 2) cell.h = 75;
      cells.push(cell);
    }
  }
  cells[cid(3, 3)].burg = 1;
  cells[cid(9, 6)].burg = 2;
  return {
    info: {
      version: '1.153.1',
      description: 'A synthetic save for tests',
      mapName: 'Synthetic',
      width: COLS * SIZE,
      height: ROWS * SIZE,
      seed: '1',
    },
    settings: { distanceUnit: 'mi', distanceScale: 2 },
    pack: {
      cells,
      vertices,
      features: [
        0,
        { i: 1, land: false, border: true, type: 'ocean', group: 'ocean' },
        { i: 2, land: true, border: false, type: 'island', group: 'continent' },
        { i: 3, land: false, border: false, type: 'lake', group: 'freshwater' },
      ],
      biomes: BIOMES.map((name, i) => ({ i, name, color: '#888888' })),
      states: [
        { i: 0, name: 'Neutrals' },
        { i: 1, name: 'Aldmark', fullName: 'Kingdom of Aldmark', color: '#aa3333' },
        { i: 2, name: 'Brenn', fullName: 'Duchy of Brenn', color: '#3333aa' },
      ],
      provinces: [
        0,
        { i: 1, name: 'Westfold', fullName: 'County of Westfold', state: 1, color: '#cc6666' },
        { i: 2, name: 'Eastreach', fullName: 'March of Eastreach', state: 2, color: '#6666cc' },
      ],
      burgs: [
        {},
        { i: 1, name: 'Oakham', x: 35, y: 35, cell: cid(3, 3), state: 1 },
        { i: 2, name: 'Fenwick', x: 95, y: 65, cell: cid(9, 6), state: 2 },
      ],
      rivers: [
        {
          i: 1,
          name: 'Sil',
          type: 'River',
          cells: [cid(2, 7), cid(3, 7), cid(4, 7), cid(5, 7), cid(6, 7)],
        },
        { i: 2, name: 'Mill', type: 'Creek', cells: [cid(3, 5), cid(3, 6)] },
      ],
    },
  };
}

module.exports = { syntheticSave, COLS, ROWS, SIZE };
