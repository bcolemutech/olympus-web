'use strict';

/**
 * A dungeon drawn from its data alone (planning/maps-from-data.md §4.6; L-924
 * / #728), for the painter's headless tests (../../loom-paint.test.js): 24 ×
 * 16 squares (120 × 80 ft) of stone and wood floors, a pool, a raised dais and
 * a pit; stone walls round it, an angled wall, brick walls between rooms with
 * a wooden door, an open one, a locked iron one and a glass one; a window;
 * a chest, a table, barrels, a pillar, a statue and something no catalog
 * knows (drawn as the box with a question mark); a brazier's light and a
 * dark corner.
 */

const dungeon = () => ({
  ground: [
    { id: 'floor', material: 'flagstone', shape: { rect: { x: 0, y: 0, w: 120, h: 80 } } },
    { id: 'hall', material: 'wood', shape: { rect: { x: 60, y: 5, w: 55, h: 35 } } },
    { id: 'pool', material: 'water', shape: { circle: { x: 25, y: 60, r: 9 } }, depth: 4 },
    {
      id: 'dais',
      material: 'marble',
      shape: { rect: { x: 85, y: 50, w: 25, h: 20 } },
      height: 5,
    },
    { id: 'pit', material: 'rock', shape: { rect: { x: 45, y: 55, w: 10, h: 15 } }, height: -15 },
  ],
  lines: [
    {
      id: 'runnel',
      material: 'stream',
      points: [
        [5, 72],
        [16, 63],
      ],
      width: 2,
    },
  ],
  walls: [
    {
      id: 'outer',
      material: 'stone',
      points: [
        [0, 0],
        [120, 0],
        [120, 80],
        [0, 80],
        [0, 0],
      ],
    },
    {
      id: 'slant',
      material: 'rock',
      points: [
        [20, 10],
        [40, 35],
      ],
    },
    {
      id: 'west',
      material: 'brick',
      points: [
        [60, 0],
        [60, 45],
      ],
    },
    {
      id: 'south',
      material: 'brick',
      points: [
        [60, 45],
        [120, 45],
      ],
    },
  ],
  doors: [
    { id: 'shut', material: 'wood', from: [60, 15], to: [60, 20], wall: 'west', state: 'closed' },
    { id: 'ajar', material: 'wood', from: [60, 30], to: [60, 35], wall: 'west', state: 'open' },
    { id: 'vault', material: 'iron', from: [75, 45], to: [80, 45], wall: 'south', state: 'locked' },
    { id: 'pane', material: 'glass', from: [100, 45], to: [105, 45], wall: 'south' },
  ],
  windows: [{ id: 'slit', material: 'glass', from: [120, 20], to: [120, 25], wall: 'outer' }],
  objects: [
    { id: 'chest', kind: 'chest', at: [105, 12], size: [3, 2] },
    { id: 'table', kind: 'table', at: [85, 25], size: [5, 3], turn: 15 },
    { id: 'barrel-1', kind: 'barrel', at: [8, 8], size: [2.5, 2.5] },
    { id: 'barrel-2', kind: 'barrel', at: [11, 8], size: [2.5, 2.5] },
    { id: 'pillar', kind: 'pillar', at: [40, 50], size: [2, 2] },
    { id: 'statue', kind: 'statue', at: [97, 60], size: [3, 3] },
    { id: 'thing', kind: 'mystery-engine', at: [30, 30], size: [4, 4] },
  ],
  lights: [
    { id: 'brazier', at: [97, 55], radius: 15 },
    { id: 'gloom', dark: true, shape: { rect: { x: 0, y: 40, w: 20, h: 40 } } },
  ],
});

module.exports = { dungeon };
