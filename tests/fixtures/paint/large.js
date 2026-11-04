'use strict';

/**
 * A large dungeon for the painter's timing (L-924 / #728; PL4): 60 × 60
 * squares (300 × 300 ft) in 36 rooms of 50 ft, each with a floor of its own,
 * brick walls with a door in each, a diagonal wall in every third, four
 * objects and a light; a pool, raised and sunken floors. Made by a rule, so
 * it is the same every time.
 */

const FLOORS = ['flagstone', 'wood', 'stone', 'tile', 'cobble', 'carpet', 'marble', 'dirt'];
const THINGS = ['chest', 'table', 'barrel', 'crate', 'bench', 'statue', 'brazier', 'bookshelf'];
const DOORS = ['wood', 'iron', 'glass', 'gate'];

function large() {
  const g = { ground: [], walls: [], doors: [], objects: [], lights: [], lines: [] };
  g.ground.push({
    id: 'floor',
    material: 'stone',
    shape: { rect: { x: 0, y: 0, w: 300, h: 300 } },
  });
  let k = 0;
  for (let rx = 0; rx < 6; rx++) {
    for (let ry = 0; ry < 6; ry++) {
      const x = rx * 50;
      const y = ry * 50;
      const id = `r${rx}-${ry}`;
      g.ground.push({
        id: `floor-${id}`,
        material: FLOORS[k % FLOORS.length],
        shape: { rect: { x: x + 2, y: y + 2, w: 46, h: 46 } },
        ...(k % 7 === 3 ? { height: 5 } : k % 11 === 5 ? { height: -10 } : {}),
      });
      // Its east and south walls, each with a door in the middle.
      g.walls.push({
        id: `east-${id}`,
        material: 'brick',
        points: [
          [x + 50, y],
          [x + 50, y + 50],
        ],
      });
      g.walls.push({
        id: `south-${id}`,
        material: 'brick',
        points: [
          [x, y + 50],
          [x + 50, y + 50],
        ],
      });
      g.doors.push({
        id: `east-door-${id}`,
        material: DOORS[k % DOORS.length],
        from: [x + 50, y + 22.5],
        to: [x + 50, y + 27.5],
        wall: `east-${id}`,
        state: ['closed', 'open', 'locked'][k % 3],
      });
      g.doors.push({
        id: `south-door-${id}`,
        material: DOORS[(k + 1) % DOORS.length],
        from: [x + 22.5, y + 50],
        to: [x + 27.5, y + 50],
        wall: `south-${id}`,
      });
      if (k % 3 === 0) {
        g.walls.push({
          id: `slant-${id}`,
          material: 'rock',
          points: [
            [x + 8, y + 8],
            [x + 20, y + 30],
          ],
        });
      }
      for (let t = 0; t < 4; t++) {
        g.objects.push({
          id: `thing-${id}-${t}`,
          kind: THINGS[(k + t) % THINGS.length],
          at: [x + 12 + t * 8, y + 38],
          size: [3, 3],
          turn: (t * 23) % 90,
        });
      }
      g.lights.push({
        id: `light-${id}`,
        at: [x + 25, y + 25],
        radius: 12,
        ...(k % 2 ? { dim: 20 } : {}),
      });
      k += 1;
    }
  }
  g.ground.push({ id: 'pool', material: 'water', shape: { circle: { x: 150, y: 150, r: 14 } } });
  g.lines.push({
    id: 'channel',
    material: 'canal',
    points: [
      [0, 125],
      [300, 125],
    ],
    width: 3,
  });
  return g;
}

module.exports = { large };
