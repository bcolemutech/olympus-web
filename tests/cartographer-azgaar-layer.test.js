'use strict';

// A world's layer from its Azgaar save (planning/worlds-without-azgaar.md
// §4.7; L-717 / #822): scripts/azgaar/layer.cjs on a synthetic save.

const fs = require('fs');
const path = require('path');
const layer = require('../scripts/azgaar/layer.cjs');
const geo = require('../functions/loom-canon/map-geometry');
const { syntheticSave } = require('./fixtures/azgaar/synthetic-save');

const convert = (doc = syntheticSave(), options) => layer.convert(layer.readSave(doc), options);
const byId = (list, id) => list.find((item) => item.id === id);
const ringsOf = (shape) => geo.ringsOf(shape).rings;
const ringArea = (ring) =>
  ring.reduce((a, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return a + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
// The area a shape covers, even-odd: outer rings less their holes.
const areaOf = (shape) => Math.abs(ringsOf(shape).reduce((a, r) => a + ringArea(r), 0));
// Whether a point is inside rings, even-odd.
const inside = (p, rings) => {
  let odd = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[j];
      if (ay > p[1] !== by > p[1] && p[0] < ((bx - ax) * (p[1] - ay)) / (by - ay) + ax) odd = !odd;
    }
  }
  return odd;
};
// The topmost ground at a point, as the Loom reads it.
const groundAt = (geometry, point) => {
  const hit = geo.groundAt(geo.compile(geometry), point);
  return hit && (hit.item || hit).material;
};

describe('reading a save', () => {
  test('a full JSON export is read', () => {
    const save = layer.readSave(JSON.stringify(syntheticSave()));
    expect(save).toMatchObject({ mapName: 'Synthetic', width: 120, height: 100 });
    expect(save.cells).toHaveLength(120);
    expect(save.states.map((s) => s.name)).toEqual(['Aldmark', 'Brenn']);
    expect(save.provinces.map((p) => p.name)).toEqual(['Westfold', 'Eastreach']);
  });

  test('a .map file is refused, saying how to export the JSON', () => {
    const map = '1.153.1|File can be loaded in azgaar.github.io|1|1718|1270\r\n...';
    expect(() => layer.readSave(map)).toThrow(/\.map file.*Export to JSON → Full/);
  });

  test('an export with no cell outlines (the slimmed Nisia fixture) is refused', () => {
    const slim = fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'));
    expect(() => layer.readSave(slim)).toThrow(/no cell outlines/);
  });
});

describe('biomes', () => {
  test.each([
    ['Hot desert', 'desert'],
    ['Temperate deciduous forest', 'forest'],
    ['Tropical rainforest', 'jungle'],
    ['Taiga', 'taiga'],
    ['Wetland', 'marsh'],
    ['Glacier', 'glacier'],
    ['Pine woods', 'forest'],
    ['Steppe', 'grassland'],
    ['Crystal fields', 'farmland'],
    ['Nowhere', null],
  ])('%s becomes %s', (name, material) => {
    expect(layer.biomeMaterial(name)).toBe(material);
  });
});

describe('the synthetic save', () => {
  const result = convert();
  const { geometry } = result;

  test('the geometry passes map-geometry.js’s check, as set_ground will', () => {
    expect(result.report.problems).toEqual([]);
    expect(geo.check(geometry, result.bounds)).toEqual([]);
    expect(result.mapId).toBe('map_world');
  });

  test('the sea lies under everything', () => {
    expect(geometry.ground[0]).toEqual({
      id: 'sea',
      material: 'ocean',
      shape: { rect: { x: 0, y: 0, w: 120, h: 100 } },
    });
    expect(groundAt(geometry, [5, 5])).toBe('ocean');
  });

  test('cells of one biome merge into one polygon', () => {
    const forest = geometry.ground.filter((g) => g.material === 'forest');
    expect(forest).toHaveLength(1);
    const rings = ringsOf(forest[0].shape);
    // The 3 × 3 patch is one square ring, its inner edges and corners gone;
    // the two cells touching at a corner are two rings.
    expect(rings).toHaveLength(3);
    const patch = rings.find((r) => r.some(([x, y]) => x === 20 && y === 20));
    expect(patch).toHaveLength(4);
    expect(Math.abs(ringArea(patch))).toBe(900);
    expect(groundAt(geometry, [35, 35])).toBe('forest');
    expect(groundAt(geometry, [85, 75])).toBe('forest');
  });

  test('a lake is water inside the land', () => {
    const lake = geometry.ground.find((g) => g.material === 'lake');
    expect(lake).toBeDefined();
    expect(areaOf(lake.shape)).toBe(400);
    expect(groundAt(geometry, [80, 60])).toBe('lake');
    // The grassland around it has a hole there.
    const grass = geometry.ground.find((g) => g.material === 'grassland');
    expect(geo.pointInShape([80, 60], grass.shape)).toBe(false);
    expect(geo.pointInShape([65, 60], grass.shape)).toBe(true);
  });

  test('hills and mountains come from height', () => {
    expect(groundAt(geometry, [95, 25])).toBe('mountains');
    const flat = convert(syntheticSave(), { relief: false });
    expect(groundAt(flat.geometry, [95, 25])).toBe('grassland');
  });

  test('the land and the lake cover the island exactly, with no gap or overlap', () => {
    const land = geometry.ground.slice(1).reduce((a, g) => a + areaOf(g.shape), 0);
    expect(land).toBe(100 * 80);
  });

  test('a province becomes a zone naming its region', () => {
    expect(geometry.zones).toEqual([
      expect.objectContaining({ id: 'prov-1', name: 'Westfold', region: 'reg_1' }),
      expect.objectContaining({ id: 'prov-2', name: 'Eastreach', region: 'reg_2' }),
    ]);
    expect(areaOf(byId(geometry.zones, 'prov-1').shape)).toBe(50 * 80);
    // A lake wholly inside a province is part of it.
    expect(areaOf(byId(geometry.zones, 'prov-2').shape)).toBe(50 * 80);
    expect(geo.pointInShape([80, 60], byId(geometry.zones, 'prov-2').shape)).toBe(true);
  });

  test('a river becomes a line along its cells', () => {
    const sil = byId(geometry.lines, 'river-1');
    expect(sil.material).toBe('river');
    expect(geo.linesOf(sil.points).lines).toEqual([
      [
        [25, 75],
        [65, 75],
      ],
    ]);
    expect(byId(geometry.lines, 'river-2').material).toBe('stream');
    expect(result.rivers).toContainEqual({ id: 'river-1', name: 'Sil' });
  });

  test('every settlement falls in its province’s zone, on land', () => {
    expect(result.report.settlements).toMatchObject({
      total: 2,
      inTheirRegion: 2,
      outside: [],
      elsewhere: [],
      onWater: [],
    });
  });

  test('states are realms and provinces regions, the import’s ids assumed without the world', () => {
    expect(result.realms).toEqual([
      { state: 1, name: 'Aldmark', id: 'fac_1', how: 'assumed', colour: '#aa3333' },
      { state: 2, name: 'Brenn', id: 'fac_2', how: 'assumed', colour: '#3333aa' },
    ]);
    expect(result.regions.map((r) => [r.id, r.realmId])).toEqual([
      ['reg_1', 'fac_1'],
      ['reg_2', 'fac_2'],
    ]);
  });

  test('the calls set the ground, the lines and the zones of the top map', () => {
    expect(result.calls.map((c) => c.tool)).toEqual(['set_ground', 'set_lines', 'set_zones']);
    const [ground] = result.calls;
    expect(ground.args).toMatchObject({ worldId: '<worldId>', mapId: 'map_world' });
    expect(ground.args.set).toEqual(geometry.ground);
  });

  test('the report counts what it made', () => {
    const lines = layer.formatReport(result).join('\n');
    expect(lines).toMatch(/Cells: 120 \(76 land\); lakes 1 \(1 inside a province\)/);
    expect(lines).toMatch(/Settlements: 2 of 2/);
    expect(lines).toMatch(/passes map-geometry\.js’s check/);
    expect(result.report.areas.ocean).toBeCloseTo(33.3, 1);
  });

  test('the preview draws the terrain and the realms', () => {
    const svg = layer.previewSvg(result, layer.readSave(syntheticSave()));
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('fill="#aa3333"');
    expect(svg).toContain('<title>Oakham</title>');
  });
});

describe('matching the world’s realms and regions', () => {
  const world = {
    factions: [
      {
        id: 'fac_brenn',
        name: 'Brenn',
        regions: [{ id: 'reg_east', name: 'Eastreach' }],
      },
    ],
    regions: [{ id: 'reg_1', name: 'Westfold', factionId: null }],
  };
  const result = convert(syntheticSave(), { world, worldId: 'synthetic' });

  test('by the import’s id, else by name, else to add', () => {
    expect(result.realms.map((r) => [r.name, r.id, r.how])).toEqual([
      ['Aldmark', null, 'new'],
      ['Brenn', 'fac_brenn', 'name'],
    ]);
    expect(result.regions.map((r) => [r.name, r.id, r.how, r.realmId])).toEqual([
      ['Westfold', 'reg_1', 'id', 'new:Aldmark'],
      ['Eastreach', 'reg_east', 'name', 'fac_brenn'],
    ]);
    expect(byId(result.geometry.zones, 'prov-2').region).toBe('reg_east');
  });

  test('new realms are added first, and a region in the wrong realm is moved', () => {
    expect(result.calls[0]).toMatchObject({
      tool: 'add_realms',
      args: { worldId: 'synthetic', realms: [{ name: 'Aldmark', colour: '#aa3333' }] },
    });
    expect(result.calls[1]).toMatchObject({
      tool: 'update_region',
      args: { worldId: 'synthetic', regionId: 'reg_1', factionId: 'new:Aldmark' },
    });
    expect(result.report.realms).toEqual({
      matchedById: 0,
      matchedByName: 1,
      assumed: 0,
      toAdd: 1,
    });
  });
});

// A bigger save with jittered cells and patchy biomes: what a real export's
// irregular cells ask of the tracing and the shared simplifying.
function jitteredSave() {
  const COLS = 40;
  const ROWS = 30;
  const SIZE = 10;
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const vid = (x, y) => y * (COLS + 1) + x;
  const vertices = [];
  for (let y = 0; y <= ROWS; y++) {
    for (let x = 0; x <= COLS; x++) {
      const edge = x === 0 || y === 0 || x === COLS || y === ROWS;
      const jx = edge ? 0 : (rand() - 0.5) * 6;
      const jy = edge ? 0 : (rand() - 0.5) * 6;
      vertices.push({ i: vid(x, y), p: [x * SIZE + jx, y * SIZE + jy] });
    }
  }
  const blob = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
  const cells = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const land = blob(x, y, 20, 15, 13) || blob(x, y, 33, 6, 4);
      let biome = 4;
      if (blob(x, y, 14, 12, 5) || (rand() < 0.08 && land)) biome = 6;
      if (blob(x, y, 25, 19, 4)) biome = 1;
      const lake = blob(x, y, 21, 9, 2);
      cells.push({
        i: y * COLS + x,
        v: [vid(x, y), vid(x + 1, y), vid(x + 1, y + 1), vid(x, y + 1)],
        p: [x * SIZE + 5, y * SIZE + 5],
        h: !land ? 5 : lake ? 12 : blob(x, y, 18, 18, 2) ? 80 : 30,
        f: !land ? 1 : lake ? 3 : 2,
        biome: land && !lake ? biome : 0,
        province: land && !lake ? 1 + (x >= 20 ? 1 : 0) + (y >= 15 ? 2 : 0) : 0,
        state: land && !lake ? (x >= 20 ? 2 : 1) : 0,
      });
    }
  }
  const doc = syntheticSave();
  doc.info = { ...doc.info, width: COLS * SIZE, height: ROWS * SIZE };
  doc.pack = {
    ...doc.pack,
    cells,
    vertices,
    burgs: [],
    rivers: [],
    provinces: [
      0,
      { i: 1, name: 'North West', state: 1 },
      { i: 2, name: 'North East', state: 2 },
      { i: 3, name: 'South West', state: 1 },
      { i: 4, name: 'South East', state: 2 },
    ],
  };
  return { doc, cells };
}

describe('irregular cells', () => {
  const { doc, cells } = jitteredSave();

  test.each([1, 4])(
    'at a tolerance of %s the map is seamless and passes the check',
    (tolerance) => {
      const result = convert(doc, { tolerance });
      expect(result.report.problems).toEqual([]);
      const { geometry } = result;
      // Neighbours share their simplified borders, so no two grounds (or two
      // zones) cover one point: sampled at every unit's middle, off the borders.
      const overlaps = (items) => {
        const shapes = items.map((item) => ringsOf(item.shape));
        let twice = 0;
        for (let y = 0.5; y < 300; y += 2) {
          for (let x = 0.5; x < 400; x += 2) {
            const n = shapes.filter((rings) => inside([x, y], rings)).length;
            if (n > 1) twice += 1;
          }
        }
        return twice;
      };
      expect(overlaps(geometry.ground.slice(1))).toBe(0);
      expect(overlaps(geometry.zones)).toBe(0);
      // Each land cell's centre reads its own ground, but for a few at the
      // simplified borders.
      const save = layer.readSave(doc);
      let wrong = 0;
      let land_ = 0;
      for (const cell of save.cells) {
        if (cell.h < 20) continue;
        land_ += 1;
        const want =
          cell.h > 70
            ? 'mountains'
            : cell.biome === 6
              ? 'forest'
              : cell.biome === 1
                ? 'desert'
                : 'grassland';
        if (groundAt(geometry, cell.p) !== want) wrong += 1;
      }
      expect(wrong / land_).toBeLessThan(0.02);
      expect(cells.length).toBe(1200);
    }
  );

  test('a small budget simplifies more until it fits', () => {
    const result = convert(doc, { budget: 600 });
    expect(result.report.problems).toEqual([]);
    expect(result.report.counts.points.total).toBeLessThanOrEqual(600);
    expect(result.report.tolerance).toBeGreaterThan(1);
    expect(result.report.warnings.map((w) => w.code)).toContain('tolerance');
  });
});
