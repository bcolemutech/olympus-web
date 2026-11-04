'use strict';

/**
 * Battle maps' layers stored as geometry (planning/maps-from-data.md §4.7,
 * EX4; L-928 / #732), pure:
 *
 *   - a map's walls, doors and obstacles convert to walls, doors, pillars,
 *     low walls and rough ground, every id kept, the doors' locks, keys, AP,
 *     long actions and difficulty with them; features, entries, exits,
 *     hazards and figures are left as they are; the geometry is sound;
 *   - converting again changes nothing; a map's own geometry is kept, its
 *     own items winning on an id;
 *   - new layers given by a grid tool replace what the old ones made, and
 *     nothing else;
 *   - the map a save is sent (known-map.js) is the same before and after;
 *   - the replay: the same ways, reach and sight on the geometry alone, on
 *     the fixture and on random maps; and it catches a conversion that lost
 *     a lock or a wall.
 *
 * Run: cd tests && npx jest loom-layer-geometry
 */

const geo = require('../functions/loom-canon/map-geometry');
const layerGeometry = require('../functions/loom-canon/layer-geometry');
const convert = require('../functions/cartographer/convert-layers');
const { knownMap } = require('../functions/loom-turn/known-map');

const sq = (x, y) => ({ x, y });

// A hall 10 × 7: a wall down x = 5 with a locked door in it at y 3–4, a
// table, a pillar and rubble; an altar to use, a hazard and a wary pair.
const hall = () => ({
  id: 'bm_hall',
  name: 'The hall',
  width: 10,
  height: 7,
  entries: [{ id: 'west', x: 1, y: 3 }],
  exits: [{ id: 'out', name: 'the far door', x: 9, y: 3, to: 'out' }],
  features: [{ id: 'altar', name: 'the altar', x: 7, y: 1, ap: 3 }],
  walls: [
    { points: [sq(5, 0), sq(5, 3)] },
    { points: [sq(5, 4), sq(5, 7)] },
  ],
  doors: [
    {
      id: 'mid',
      name: 'the iron door',
      from: sq(5, 3),
      to: sq(5, 4),
      locked: true,
      key: 'iron key',
      ap: 4,
      long: { ap: 30 },
      difficulty: 18,
    },
  ],
  obstacles: [
    { id: 'table', name: 'a table', kind: 'low', x: 2, y: 1, w: 2 },
    { id: 'pillar', name: 'a pillar', kind: 'solid', x: 7, y: 5 },
    { id: 'rubble', name: 'rubble', kind: 'difficult', x: 6, y: 3 },
  ],
  hazards: [{ id: 'pit', name: 'a pit', area: { shape: 'square', x: 8, y: 1, size: 1 } }],
  figures: [{ id: 'guards', name: 'Guard', side: 'wary', cells: [sq(7, 2), sq(7, 4)] }],
});

const ids = (list) => (list || []).map((i) => i.id);

describe('converting a battle map’s layers', () => {
  test('walls, doors and obstacles become geometry, every id and setting kept', () => {
    const map = hall();
    const g = layerGeometry.converted(map);
    expect(ids(g.walls)).toEqual([
      'layer-wall-0',
      'layer-wall-1',
      'layer-doorway-mid',
      'layer-table',
    ]);
    // The walls along the same lines, in feet, stored as path data.
    expect(g.walls[0]).toEqual({ id: 'layer-wall-0', material: 'stone', points: 'M25 0L25 15' });
    // The door: its id, name, lock, key, AP, long action and difficulty.
    expect(g.doors).toEqual([
      {
        id: 'mid',
        material: 'wood',
        from: [25, 15],
        to: [25, 20],
        wall: 'layer-doorway-mid',
        state: 'locked',
        name: 'the iron door',
        unlocks: { key: 'iron key' },
        ap: 4,
        long: { ap: 30 },
        difficulty: 18,
      },
    ]);
    // The table a low wall round its squares, hiding nothing; the pillar a
    // pillar that hides; the rubble rough ground.
    expect(g.walls[3]).toMatchObject({ height: 3, blocksSight: false });
    expect(g.objects).toEqual([
      {
        id: 'layer-pillar',
        kind: 'pillar',
        at: [37.5, 27.5],
        size: [5, 5],
        blocksSight: true,
        name: 'a pillar',
      },
    ]);
    expect(g.ground).toEqual([
      {
        id: 'layer-rubble',
        material: 'gravel',
        cost: 2,
        shape: { rect: { x: 30, y: 15, w: 5, h: 5 } },
      },
    ]);
    expect(geo.check(g, { width: 50, height: 35 })).toEqual([]);
    // Features, entries, exits, hazards and figures aren't layers.
    const plan = convert.planMap(map, { replayIt: false });
    expect(plan.layers).toEqual({ walls: 2, doors: 1, obstacles: 3 });
    expect(plan.changed).toBe(true);
    expect(Object.keys(g).sort()).toEqual(['doors', 'ground', 'objects', 'walls']);
  });

  test('converting again changes nothing; a map without layers has nothing to convert', () => {
    const map = hall();
    const g = layerGeometry.converted(map);
    const stored = { ...map, geometry: JSON.parse(JSON.stringify(g)) };
    expect(layerGeometry.converted(stored)).toEqual(g);
    expect(convert.planMap(stored, { replayIt: false }).changed).toBe(false);
    expect(layerGeometry.isConverted(stored)).toBe(true);
    expect(layerGeometry.isConverted(map)).toBe(false);
    const plain = { id: 'bm_plain', width: 4, height: 4, entries: [sq(0, 0)] };
    expect(convert.planMap(plain)).toMatchObject({ geometry: null, changed: false, replay: null });
  });

  test('a map’s own geometry is kept, its own items winning on an id', () => {
    const map = hall();
    map.geometry = geo.normalize({
      windows: [{ id: 'slit', material: 'glass', from: [25, 5], to: [25, 10], wall: 'layer-wall-0' }],
      // Its own door of the same id: a gate, which wins.
      doors: [{ id: 'mid', material: 'gate', from: [25, 15], to: [25, 20], state: 'closed' }],
    });
    const g = layerGeometry.converted(map);
    expect(g.windows.map((w) => w.id)).toEqual(['slit']);
    expect(g.doors).toEqual([map.geometry.doors[0]]);
    expect(ids(g.walls)).toContain('layer-doorway-mid');
  });

  test('new layers from a grid tool replace what the old ones made, and nothing else', () => {
    const map = hall();
    map.geometry = layerGeometry.converted({
      ...map,
      geometry: geo.normalize({ lights: [{ id: 'lamp', at: [10, 10], radius: 10 }] }),
    });
    // The table moved, the rubble gone, the door unlocked.
    const next = {
      ...map,
      doors: [{ ...map.doors[0], locked: false }],
      obstacles: [
        { id: 'table', name: 'a table', kind: 'low', x: 1, y: 5, w: 2 },
        map.obstacles[1],
      ],
    };
    const g = layerGeometry.relayered(map, next);
    expect(ids(g.lights)).toEqual(['lamp']);
    expect(g.ground).toBeUndefined();
    expect(g.doors[0].state).toBe('closed');
    const table = g.walls.find((w) => w.id === 'layer-table');
    expect(table.points).toBe('M5 25L15 25L15 30L5 30L5 25');
    expect(g).toEqual(layerGeometry.converted({ ...next, geometry: { lights: g.lights } }));
    // No layers left: only its own.
    const bare = layerGeometry.relayered(map, { ...map, walls: [], doors: [], obstacles: [] });
    expect(bare).toEqual({ lights: g.lights });
  });

  test('the map a save is sent is the same before and after', () => {
    const map = hall();
    const converted = { ...map, geometry: layerGeometry.converted(map) };
    // Seen: the west half and the door.
    const on = (c) => c.x <= 5;
    const states = { mid: 'open' };
    expect(knownMap(converted, on, states)).toEqual(knownMap(map, on, states));
    const all = () => true;
    expect(knownMap(converted, all, {})).toEqual(knownMap(map, all, {}));
  });
});

describe('the replay', () => {
  test('the hall plays the same on its geometry alone', () => {
    const plan = convert.planMap(hall());
    expect(plan.replay.differences).toEqual([]);
    // Ways from the entry, exit, altar and both guards for two sizes; reach
    // twice; sight from each.
    expect(plan.replay.checks).toBe(5 * 2 + 2 + 5);
  });

  test('a conversion that lost a lock or a wall is caught', () => {
    const map = hall();
    const g = layerGeometry.converted(map);
    const unlocked = { ...g, doors: [{ ...g.doors[0], state: 'closed' }] };
    const lost = convert.replay(map, convert.afterOf(map, unlocked));
    expect(lost.differences.map((d) => d.check)).toContain('reach');
    const holed = { ...g, walls: g.walls.filter((w) => w.id !== 'layer-wall-0') };
    const seen = convert.replay(map, convert.afterOf(map, holed));
    expect(seen.differences.map((d) => d.check)).toEqual(expect.arrayContaining(['way', 'sight']));
  });

  // A small seeded generator (mulberry32), so the random maps are the same on
  // every run.
  function seeded(seed) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A random map of 6–9 squares a side: wall runs, doors locked or not, and
  // solid, low and difficult squares; in at the top left, out at the bottom
  // right.
  function randomMap(random) {
    const int = (n) => Math.floor(random() * n);
    const width = 6 + int(4);
    const height = 6 + int(4);
    const map = {
      id: 'random',
      width,
      height,
      entries: [{ id: 'in', x: 0, y: 0 }],
      exits: [{ id: 'out', x: width - 1, y: height - 1, to: 'out' }],
      walls: [],
      doors: [],
      obstacles: [],
    };
    for (let k = 3 + int(5); k > 0; k--) {
      const from = sq(int(width), int(height));
      const length = 1 + int(4);
      map.walls.push({
        points:
          random() < 0.5
            ? [from, sq(Math.min(width, from.x + length), from.y)]
            : [from, sq(from.x, Math.min(height, from.y + length))],
      });
    }
    for (let k = int(3); k > 0; k--) {
      const from = sq(1 + int(width - 2), 1 + int(height - 2));
      map.doors.push({
        id: 'door-' + k,
        from,
        to: random() < 0.5 ? sq(from.x + 1, from.y) : sq(from.x, from.y + 1),
        locked: random() < 0.3,
      });
    }
    const taken = { '0,0': true, [`${width - 1},${height - 1}`]: true };
    for (let k = int(8); k > 0; k--) {
      const at = sq(int(width), int(height));
      if (taken[at.x + ',' + at.y]) continue;
      taken[at.x + ',' + at.y] = true;
      map.obstacles.push({ id: 'o-' + k, kind: ['solid', 'low', 'difficult'][int(3)], ...at });
    }
    return map;
  }

  test('random maps play the same on their geometry alone', () => {
    const random = seeded(928);
    for (let i = 0; i < 6; i++) {
      const map = randomMap(random);
      const plan = convert.planMap(map);
      expect({ i, problems: plan.problems, differences: plan.replay.differences }).toEqual({
        i,
        problems: [],
        differences: [],
      });
    }
  });
});
