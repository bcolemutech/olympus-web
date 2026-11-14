'use strict';

/**
 * Grading the wilds (planning/off-road-travel.md §4.8, X1; the-loom-grading.md
 * §4.4; L-368 / #842), pure: a region's danger level and the events that fit
 * its ground, a generic battle map for each terrain on the world's land (a
 * bonus that never lowers a score), open country counting as drawn, and the
 * work list naming what is missing.
 *
 * Run: cd tests && npx jest loom-grading-wilds --verbose
 */

const {
  CRITERIA,
  WEIGHTS,
  QUALITY,
  LAYER_CHECKS,
  gradeEntity,
  gradeWorld,
  gradeBattleMap,
} = require('../functions/loom-canon/grading');
const geo = require('../functions/loom-canon/map-geometry');
const land = require('../functions/loom-canon/land');
const layerGeometry = require('../functions/loom-canon/layer-geometry');
const mapGenerators = require('../functions/loom-canon/map-generators');
const { workList } = require('../functions/mcp/apps/cartographer/work');
const { gridMap } = require('./helpers/grid');

const WRITTEN = { description: 'mcp' };
const words = (n) => Array(n).fill('word').join(' ');

const rect = (x, y, w, h) => ({ rect: { x, y, w, h } });
const WEST = rect(0, 0, 500, 1000);
const EAST = rect(500, 0, 500, 1000);

const criterion = (id) => CRITERIA.find((c) => c.id === id);
const layers = { ...LAYER_CHECKS, town: () => true };
const check = (id, world, entity, kind) => criterion(id).check(world, entity, { kind, layers });

// A world with one region map. Forest in the west, hills in the east, and a
// region over each; `ground` and `zones` replace them. A generic map is
// `generic(terrain)` below.
function scratch({ ground, zones, rules, system, battleMaps = {}, extra = {} } = {}) {
  return {
    id: 'scratch',
    name: 'Ashfall',
    status: 'draft',
    tagline: 'The ash remembers',
    openingHook: 'The bells are ringing.',
    cover: { imageId: 'img_00000000000000c0', link: 'https://x/c', width: 600, height: 300 },
    map: { hasImage: true },
    rules: { startingLocationId: 'ruin', ...(rules || {}) },
    systemId: 'd20-fantasy',
    system: system || require('../functions/loom-canon/systems').BUILT_IN['d20-fantasy'],
    brief: { genre: 'g', tone: 't', era: 'e', artDirection: 'a' },
    topMapId: 'map_world',
    maps: {
      map_world: {
        id: 'map_world',
        kind: 'region',
        name: 'Ashfall',
        space: { width: 1000, height: 1000 },
        geometry: {
          ground: ground || [
            { id: 'wood', material: 'forest', shape: WEST },
            { id: 'upland', material: 'hills', shape: EAST },
          ],
          zones: zones || [
            { id: 'ashen', region: 'reg_ashen', shape: WEST },
            { id: 'tide', region: 'reg_tide', shape: EAST },
          ],
        },
      },
    },
    factions: {
      fac_keld: { id: 'fac_keld', name: 'The Duchy of Keld', description: words(80) },
    },
    regions: {
      reg_ashen: {
        id: 'reg_ashen',
        name: 'The Ashen Reach',
        factionId: 'fac_keld',
        description: words(80),
        sources: WRITTEN,
      },
      reg_tide: {
        id: 'reg_tide',
        name: 'The Tide Coast',
        factionId: 'fac_keld',
        description: words(80),
        sources: WRITTEN,
      },
    },
    locations: {
      ruin: {
        id: 'ruin',
        name: 'The Ruin',
        description: words(60),
        sources: WRITTEN,
        connections: [],
        npcIds: [],
        factionIds: [],
        geo: { kind: 'poi', x: 250, y: 500 },
        battleMap: { mapId: 'bm_ruin' },
      },
    },
    battleMaps: {
      bm_ruin: gridMap({ id: 'bm_ruin', name: 'The ruin', width: 8, height: 8 }),
      ...battleMaps,
    },
    ...extra,
  };
}

const loaded = (world) => require('../functions/loom-canon/realms').resolvePlaces(world);

// A generic battle map for a terrain, with a way out as the game wants.
const generic = (id, terrain, over = {}) => ({
  id,
  name: id,
  width: 12,
  height: 12,
  generic: { kind: 'clearing', terrain },
  exits: [{ id: 'out', x: 0, y: 0 }],
  ...over,
});

const FOREST_ROW = { text: 'Wolves follow you.', kind: 'creatures', terrain: ['forest'] };
const HILLS_ROW = { text: 'A rockfall.', kind: 'hazard', terrain: ['hills'] };
const ANY_ROW = { text: 'You meet a tinker.', kind: 'travellers' };

const region = (world, id = 'reg_ashen') => world.regions[id];
const withRegion = (world, id, fields) => ({
  ...world,
  regions: { ...world.regions, [id]: { ...world.regions[id], ...fields } },
});
const withMap = (world, fields) => ({
  ...world,
  maps: { ...world.maps, map_world: { ...world.maps.map_world, ...fields } },
});

describe('the criteria in the registry', () => {
  test('their weights are the table’s, and they come from L-368', () => {
    for (const id of ['region.danger', 'region.encounters', 'world.wildMaps']) {
      const [table, key] = id.split('.');
      expect(criterion(id).weight).toBe(WEIGHTS[table][key]);
      expect(criterion(id).feature).toBe('L-368');
    }
    expect(WEIGHTS.region).toEqual({ danger: 5, encounters: 10 });
    expect(WEIGHTS.world.wildMaps).toBe(10);
  });

  test('the generic maps are a bonus; a region’s danger and events are not', () => {
    expect(criterion('world.wildMaps').bonus).toBe(true);
    expect(criterion('region.danger').bonus).toBeUndefined();
    expect(criterion('region.encounters').bonus).toBeUndefined();
  });

  test('they are for regions, not realms, and each names its work and its tool', () => {
    expect(criterion('region.danger').kinds).toEqual(['region']);
    expect(criterion('region.encounters').kinds).toEqual(['region']);
    expect(criterion('world.wildMaps').kinds).toEqual(['world']);
    expect(criterion('region.danger')).toMatchObject({ need: 'danger', tool: 'update_region' });
    expect(criterion('region.encounters')).toMatchObject({
      need: 'encounters',
      tool: 'set_encounters',
    });
    expect(criterion('world.wildMaps')).toMatchObject({ need: 'wildMaps', tool: 'generate_map' });
  });
});

describe('region.danger', () => {
  test('met when a danger level is set, whatever it is', () => {
    const w = scratch();
    for (const danger of [0.5, 1, 2]) {
      expect(check('region.danger', w, { ...region(w), danger }, 'region')).toEqual({
        progress: 1,
      });
    }
  });

  test('not met without one, and update_region is the tool', () => {
    const w = scratch();
    const result = check('region.danger', w, region(w), 'region');
    expect(result).toMatchObject({ progress: 0 });
    expect(result.message).toMatch(/update_region/);
    for (const danger of [null, undefined, 'high', NaN]) {
      expect(check('region.danger', w, { ...region(w), danger }, 'region').progress).toBe(0);
    }
  });

  test('is in a region’s checklist, with its weight, and out of a realm’s', () => {
    const w = scratch();
    const graded = gradeEntity(w, 'region', region(w));
    expect(graded.criteria.find((c) => c.id === 'region.danger')).toMatchObject({
      weight: 5,
      met: false,
      need: 'danger',
      tool: 'update_region',
    });
    const realm = gradeEntity(w, 'faction', w.factions.fac_keld);
    expect(realm.criteria.map((c) => c.id)).not.toContain('region.danger');
    expect(realm.criteria.map((c) => c.id)).not.toContain('region.encounters');
  });

  test('setting it raises the region’s score', () => {
    const w = scratch();
    const before = gradeEntity(w, 'region', region(w)).score;
    const after = gradeEntity(withRegion(w, 'reg_ashen', { danger: 1.5 }), 'region', {
      ...region(w),
      danger: 1.5,
    }).score;
    expect(after).toBeGreaterThan(before);
  });

  test('a world with off-road travel off is not asked for it', () => {
    for (const w of [
      scratch({ rules: { wilds: false } }),
      scratch({
        system: {
          ...require('../functions/loom-canon/systems').BUILT_IN['d20-fantasy'],
          modules: { wilds: false },
        },
      }),
    ]) {
      const ids = gradeEntity(w, 'region', region(w)).criteria.map((c) => c.id);
      expect(ids).not.toContain('region.danger');
      expect(ids).not.toContain('region.encounters');
      expect(gradeWorld(w).criteria.map((c) => c.id)).not.toContain('world.wildMaps');
    }
  });
});

describe('region.encounters', () => {
  const ashen = (rows, over) => {
    const w = scratch(over);
    return withRegion(w, 'reg_ashen', rows ? { encounters: rows } : {});
  };

  test('not met with no table, and set_encounters is the tool', () => {
    const w = ashen();
    const result = check('region.encounters', w, region(w), 'region');
    expect(result.progress).toBe(0);
    expect(result.message).toMatch(/set_encounters/);
    const empty = ashen([]);
    expect(check('region.encounters', empty, region(empty), 'region').progress).toBe(0);
  });

  test('met when a row fits the ground under it', () => {
    const w = ashen([FOREST_ROW]);
    expect(check('region.encounters', w, region(w), 'region')).toEqual({ progress: 1 });
  });

  test('a row with no terrain fits any ground', () => {
    const w = ashen([ANY_ROW]);
    expect(check('region.encounters', w, region(w), 'region')).toEqual({ progress: 1 });
  });

  test('a row for other ground does not fit, and the ground is named', () => {
    const w = ashen([{ ...FOREST_ROW, terrain: ['desert'] }]);
    expect(check('region.encounters', w, region(w), 'region')).toMatchObject({
      progress: 0,
      have: 0,
      want: 1,
      lacking: ['forest'],
    });
  });

  test('partial progress for each ground that has a row', () => {
    // The Ashen Reach over forest and hills in equal parts.
    const w = ashen([FOREST_ROW], {
      zones: [{ id: 'ashen', region: 'reg_ashen', shape: rect(0, 0, 1000, 1000) }],
    });
    expect(land.regionGrounds(w, 'reg_ashen')).toEqual({ forest: 0.5, hills: 0.5 });
    expect(check('region.encounters', w, region(w), 'region')).toMatchObject({
      progress: 0.5,
      have: 1,
      want: 2,
      lacking: ['hills'],
    });
    const both = withRegion(w, 'reg_ashen', { encounters: [FOREST_ROW, HILLS_ROW] });
    expect(check('region.encounters', both, region(both), 'region')).toEqual({ progress: 1 });
  });

  test('a sliver of ground is not one its events must name', () => {
    // 5% hills: below the share a ground needs to count.
    const w = ashen([FOREST_ROW], {
      ground: [
        { id: 'wood', material: 'forest', shape: rect(0, 0, 1000, 1000) },
        { id: 'knoll', material: 'hills', shape: rect(0, 0, 1000, 50) },
      ],
      zones: [{ id: 'ashen', region: 'reg_ashen', shape: rect(0, 0, 1000, 1000) }],
    });
    expect(land.regionGrounds(w, 'reg_ashen').hills).toBeLessThan(QUALITY.wildsTerrainShare);
    expect(check('region.encounters', w, region(w), 'region')).toEqual({ progress: 1 });
  });

  test('water and impassable ground are not camped on, so need no row', () => {
    const w = ashen([FOREST_ROW], {
      ground: [
        { id: 'wood', material: 'forest', shape: rect(0, 0, 500, 1000) },
        { id: 'sea', material: 'ocean', shape: rect(500, 0, 500, 1000) },
      ],
      zones: [{ id: 'ashen', region: 'reg_ashen', shape: rect(0, 0, 1000, 1000) }],
    });
    expect(land.regionGrounds(w, 'reg_ashen').ocean).toBeCloseTo(0.5);
    expect(check('region.encounters', w, region(w), 'region')).toEqual({ progress: 1 });
  });

  test('a ground the world marks impassable needs no row either', () => {
    const w = ashen([FOREST_ROW], {
      extra: { wilds: { materials: { hills: { impassable: true } } } },
      zones: [{ id: 'ashen', region: 'reg_ashen', shape: rect(0, 0, 1000, 1000) }],
    });
    expect(check('region.encounters', w, region(w), 'region')).toEqual({ progress: 1 });
  });

  test('the region’s map’s table counts, and the world’s does not', () => {
    const none = ashen();
    const onMap = withMap(none, { encounters: [FOREST_ROW] });
    expect(check('region.encounters', onMap, region(onMap), 'region')).toEqual({ progress: 1 });
    // The world’s table is the fallback the game picks from, not the region’s.
    const world = { ...none, encounters: [FOREST_ROW] };
    expect(check('region.encounters', world, region(world), 'region').progress).toBe(0);
  });

  test('the region’s and its map’s tables add up', () => {
    const w = withMap(
      ashen([FOREST_ROW], {
        zones: [{ id: 'ashen', region: 'reg_ashen', shape: rect(0, 0, 1000, 1000) }],
      }),
      { encounters: [HILLS_ROW] }
    );
    expect(check('region.encounters', w, region(w), 'region')).toEqual({ progress: 1 });
  });

  test('a row that says nothing can happen does not count', () => {
    const w = ashen([{ kind: 'find', terrain: ['forest'] }, { weight: 3 }, null, 'rain']);
    expect(check('region.encounters', w, region(w), 'region').progress).toBe(0);
    // A stat block to meet is enough.
    const figures = ashen([{ what: 'wolf', terrain: ['forest'] }]);
    expect(check('region.encounters', figures, region(figures), 'region')).toEqual({
      progress: 1,
    });
  });

  test('a region with no shape has no ground to disagree with: any row counts', () => {
    const w = ashen([HILLS_ROW], { zones: [] });
    expect(land.regionGrounds(w, 'reg_ashen')).toEqual({});
    expect(check('region.encounters', w, region(w), 'region')).toEqual({ progress: 1 });
  });

  test('a world’s own ground is named by its own id, as the game matches it', () => {
    const own = [{ id: 'blackwood', name: 'Blackwood', like: 'forest' }];
    const w = ashen([FOREST_ROW], {
      ground: [{ id: 'dark', material: 'blackwood', shape: rect(0, 0, 1000, 1000) }],
      zones: [{ id: 'ashen', region: 'reg_ashen', shape: rect(0, 0, 1000, 1000) }],
      extra: { materials: own },
    });
    // `forest` isn't `blackwood` to a row (wild events `fits`).
    expect(check('region.encounters', w, region(w), 'region')).toMatchObject({
      progress: 0,
      lacking: ['blackwood'],
    });
    const named = withRegion(w, 'reg_ashen', {
      encounters: [{ ...FOREST_ROW, terrain: ['blackwood'] }],
    });
    expect(check('region.encounters', named, region(named), 'region')).toEqual({ progress: 1 });
  });

  test('its ground is sampled in its own zones, and where another zone lies over it', () => {
    // A small region on top of a larger one takes its ground out of it.
    const w = scratch({
      zones: [
        { id: 'ashen', region: 'reg_ashen', shape: rect(0, 0, 1000, 1000) },
        { id: 'inner', region: 'reg_tide', shape: rect(600, 600, 100, 100) },
      ],
    });
    expect(land.regionGrounds(w, 'reg_tide')).toEqual({ hills: 1 });
    const outer = land.regionGrounds(w, 'reg_ashen');
    expect(outer.forest).toBeGreaterThan(0.49);
    expect(outer.hills).toBeLessThan(0.51);
    expect(land.regionMapIds(w, 'reg_tide')).toEqual(['map_world']);
  });

  test('the checklist asks for it, weighted, with the ground it lacks', () => {
    const w = ashen([FOREST_ROW], {
      zones: [{ id: 'ashen', region: 'reg_ashen', shape: rect(0, 0, 1000, 1000) }],
    });
    const graded = gradeEntity(w, 'region', region(w));
    expect(graded.criteria.find((c) => c.id === 'region.encounters')).toMatchObject({
      weight: 10,
      met: false,
      progress: 0.5,
      lacking: ['hills'],
      tool: 'set_encounters',
    });
    expect(graded.checklist.find((i) => i.criterion === 'region.encounters')).toMatchObject({
      need: 'encounters',
      gain: 5,
    });
  });
});

describe('world.wildMaps', () => {
  const bonus = (w) => gradeWorld(w).criteria.find((c) => c.id === 'world.wildMaps');

  test('is a bonus: not part of the total, up to its weight over it', () => {
    const without = scratch();
    const withAll = scratch({
      battleMaps: { bm_forest: generic('bm_forest', 'forest'), bm_hills: generic('bm_hills', 'hills') },
    });
    expect(bonus(without)).toMatchObject({ bonus: true, weight: 10, met: false, progress: 0 });
    expect(bonus(withAll)).toMatchObject({ bonus: true, met: true });
    expect(gradeWorld(withAll).ownScore - gradeWorld(without).ownScore).toBeCloseTo(10, 1);
  });

  test('missing never lowers a score', () => {
    // The same world with the criterion off scores what it does with none.
    const missing = scratch();
    const off = scratch({ rules: { wilds: false } });
    expect(gradeWorld(missing).ownScore).toBe(gradeWorld(off).ownScore);
    expect(gradeWorld(missing).score).toBe(gradeWorld(off).score);
    // Nor does it change a band.
    expect(gradeWorld(missing).band).toBe(gradeWorld(off).band);
    // A map for one of two terrains raises it, none lowers it.
    const one = scratch({ battleMaps: { bm_forest: generic('bm_forest', 'forest') } });
    expect(gradeWorld(one).score).toBeGreaterThanOrEqual(gradeWorld(missing).score);
  });

  test('partial progress by the terrains that have a map, naming the rest', () => {
    const w = scratch({ battleMaps: { bm_forest: generic('bm_forest', 'forest') } });
    expect(criterion('world.wildMaps').check(w, w)).toMatchObject({
      progress: 0.5,
      have: 1,
      want: 2,
      lacking: ['hills'],
    });
  });

  test('a terrain’s map is one tagged for it, with a way out, in the world', () => {
    const map = (over) => scratch({ battleMaps: { bm_forest: generic('bm_forest', 'forest', over) } });
    const lacks = (w) => criterion('world.wildMaps').check(w, w).lacking;
    expect(lacks(map({}))).toEqual(['hills']);
    // No exit: the game would not play an event on it.
    expect(lacks(map({ exits: [] }))).toEqual(['forest', 'hills']);
    // One a save made on the spot, or retired, is not the world’s.
    expect(lacks(map({ wild: true }))).toEqual(['forest', 'hills']);
    expect(lacks(map({ retired: true }))).toEqual(['forest', 'hills']);
    // Not tagged for a terrain.
    expect(lacks(map({ generic: { kind: 'clearing' } }))).toEqual(['forest', 'hills']);
    expect(lacks(map({ generic: undefined }))).toEqual(['forest', 'hills']);
  });

  test('a world’s own ground is the terrain it is like, and a map for either serves it', () => {
    const own = [{ id: 'blackwood', name: 'Blackwood', like: 'forest' }];
    const base = {
      ground: [{ id: 'dark', material: 'blackwood', shape: rect(0, 0, 1000, 1000) }],
      zones: [],
      extra: { materials: own },
    };
    const lacks = (w) => criterion('world.wildMaps').check(w, w);
    expect(lacks(scratch(base))).toMatchObject({ progress: 0, lacking: ['forest'] });
    // Tagged for the terrain it is like.
    const like = scratch({ ...base, battleMaps: { bm: generic('bm', 'forest') } });
    expect(lacks(like)).toEqual({ progress: 1 });
    // Or for the ground by its own id.
    const named = scratch({ ...base, battleMaps: { bm: generic('bm', 'blackwood') } });
    expect(lacks(named)).toEqual({ progress: 1 });
  });

  test('two grounds of one terrain are one terrain', () => {
    const own = [{ id: 'blackwood', name: 'Blackwood', like: 'forest' }];
    const w = scratch({
      ground: [
        { id: 'dark', material: 'blackwood', shape: WEST },
        { id: 'wood', material: 'forest', shape: EAST },
      ],
      zones: [],
      extra: { materials: own },
      battleMaps: { bm: generic('bm', 'forest') },
    });
    expect(criterion('world.wildMaps').check(w, w)).toEqual({ progress: 1 });
  });

  test('water and impassable ground are not terrains to play on', () => {
    const w = scratch({
      ground: [
        { id: 'wood', material: 'forest', shape: WEST },
        { id: 'sea', material: 'ocean', shape: EAST },
      ],
      zones: [],
    });
    expect(land.landGrounds(w)).toEqual(['forest']);
    expect(criterion('world.wildMaps').check(w, w).lacking).toEqual(['forest']);
  });

  test('a world with no land is not graded on it', () => {
    const w = scratch({ ground: [], zones: [] });
    expect(criterion('world.wildMaps').applies(w)).toBe(false);
    expect(gradeWorld(w).criteria.map((c) => c.id)).not.toContain('world.wildMaps');
  });

  test('is on a world’s checklist as work, with the terrains it lacks', () => {
    const graded = gradeWorld(scratch());
    expect(graded.checklist.find((i) => i.criterion === 'world.wildMaps')).toMatchObject({
      need: 'wildMaps',
      tool: 'generate_map',
      lacking: ['forest', 'hills'],
    });
  });
});

describe('open country counts as drawn (§4.8)', () => {
  const floor = { id: 'floor', material: 'grass', shape: rect(0, 0, 100, 100) };
  const wall = {
    id: 'wall',
    material: 'stone',
    points: [
      [0, 0],
      [60, 0],
    ],
  };
  const path = {
    id: 'path',
    material: 'dirt',
    points: [
      [0, 50],
      [100, 50],
    ],
  };
  const tree = { id: 'tree', kind: 'tree', at: [20, 20], size: [8, 8] };
  const given = (shapes) => ({ id: 'm', kind: 'grid', geometry: geo.normalize(shapes) });

  test('floors with lines or objects, and no walls, are drawn', () => {
    expect(layerGeometry.drawnOf(given({ ground: [floor], lines: [path] }))).toBe('full');
    expect(layerGeometry.drawnOf(given({ ground: [floor], objects: [tree] }))).toBe('full');
    expect(layerGeometry.drawnOf(given({ ground: [floor], lines: [path], objects: [tree] }))).toBe(
      'full'
    );
  });

  test('floors and walls are drawn, as before', () => {
    expect(layerGeometry.drawnOf(given({ ground: [floor], walls: [wall] }))).toBe('full');
  });

  test('floors alone, or walls alone, are still half', () => {
    expect(layerGeometry.drawnOf(given({ ground: [floor] }))).toBe('part');
    expect(layerGeometry.drawnOf(given({ walls: [wall] }))).toBe('part');
    expect(layerGeometry.drawnOf(given({ walls: [wall], lines: [path], objects: [tree] }))).toBe(
      'part'
    );
  });

  test('lines and objects over no floors are nothing', () => {
    expect(layerGeometry.drawnOf(given({ lines: [path], objects: [tree] }))).toBe('none');
    expect(layerGeometry.drawnOf(given({}))).toBe('none');
    expect(layerGeometry.drawnOf(null)).toBe('none');
  });

  test('the battle map’s drawn criterion is met with no walls and is not told to add them', () => {
    const w = scratch();
    const open = given({ ground: [floor], lines: [path] });
    expect(check('battleMap.drawn', w, open)).toEqual({ progress: 1 });
    // Floors alone: half, and it says open country can have lines or objects.
    const half = check('battleMap.drawn', w, given({ ground: [floor] }));
    expect(half).toMatchObject({ progress: 0.5, tool: 'set_walls' });
    expect(half.message).toMatch(/open country/);
  });

  test('a map the wilds generator makes is fully drawn, for every terrain and scene', () => {
    for (const terrain of ['forest', 'hills', 'marsh', 'desert']) {
      const made = mapGenerators.generate('wilds', { terrain, seed: 'l-368' });
      expect(made.geometry.walls || []).toEqual(expect.any(Array));
      const map = { id: 'wild', kind: 'grid', ...made };
      const w = scratch();
      expect(layerGeometry.drawnOf(map)).toBe('full');
      expect(check('battleMap.drawn', w, map)).toEqual({ progress: 1 });
      // And it is not told to add walls.
      const checklist = gradeBattleMap(w, map).checklist;
      expect(checklist.find((i) => i.need === 'drawn')).toBeUndefined();
    }
  });
});

describe('the work list names the wilds work', () => {
  const work = (w, options = {}) => workList(loaded(w), { limit: 100, offset: 0, ...options });
  const group = (items, id) => items.find((i) => i.criterion === id);

  test('regions with no danger level, and the generic maps the land lacks', () => {
    const { items } = work(scratch());
    const danger = group(items, 'region.danger');
    expect(danger).toMatchObject({ need: 'danger', tool: 'update_region', count: 2 });
    expect(danger.entities.map((e) => e.name).sort()).toEqual([
      'The Ashen Reach',
      'The Tide Coast',
    ]);
    expect(danger.summary).toMatch(/region/);
    const maps = group(items, 'world.wildMaps');
    expect(maps).toMatchObject({ need: 'wildMaps', tool: 'generate_map', count: 1 });
    expect(maps.entities[0].lacking).toEqual(['forest', 'hills']);
  });

  test('regions with no fitting table, naming the ground', () => {
    const w = withRegion(scratch(), 'reg_ashen', { encounters: [FOREST_ROW], danger: 1 });
    const { items } = work(w);
    const table = group(items, 'region.encounters');
    expect(table).toMatchObject({ need: 'encounters', tool: 'set_encounters', count: 1 });
    // The Tide Coast has none; the Ashen Reach has danger and a row that fits.
    expect(table.entities.map((e) => e.name)).toEqual(['The Tide Coast']);
    expect(table.entities[0].message).toMatch(/set_encounters/);
    expect(group(items, 'region.danger').entities.map((e) => e.name)).toEqual(['The Tide Coast']);
  });

  test('a region whose rows fit only some of its ground is named with what lacks', () => {
    const w = withRegion(
      scratch({ zones: [{ id: 'ashen', region: 'reg_ashen', shape: rect(0, 0, 1000, 1000) }] }),
      'reg_ashen',
      { encounters: [FOREST_ROW] }
    );
    const table = group(work(w).items, 'region.encounters');
    const ashen = table.entities.find((e) => e.name === 'The Ashen Reach');
    expect(ashen).toMatchObject({ have: 1, want: 2, lacking: ['hills'] });
  });

  test('done, they ask for nothing more', () => {
    let w = scratch({
      battleMaps: { bm_forest: generic('bm_forest', 'forest'), bm_hills: generic('bm_hills', 'hills') },
    });
    for (const id of ['reg_ashen', 'reg_tide']) {
      w = withRegion(w, id, { danger: 1, encounters: [FOREST_ROW, HILLS_ROW] });
    }
    const { items, howTo } = work(w);
    for (const id of ['region.danger', 'region.encounters', 'world.wildMaps']) {
      expect(group(items, id)).toBeUndefined();
    }
    expect(howTo.danger).toBeUndefined();
  });

  test('a world with off-road travel off is not asked', () => {
    const { items } = work(scratch({ rules: { wilds: false } }));
    for (const id of ['region.danger', 'region.encounters', 'world.wildMaps']) {
      expect(group(items, id)).toBeUndefined();
    }
  });

  test('explains each piece of work once', () => {
    const { howTo } = work(scratch());
    for (const need of ['danger', 'encounters', 'wildMaps']) {
      expect(howTo[need]).toMatch(/\w/);
      expect(howTo[need]).not.toBe(need);
    }
    expect(howTo.encounters).toMatch(/set_encounters/);
    expect(howTo.wildMaps).toMatch(/generate_map/);
  });

  test('kind region covers a region’s wilds work', () => {
    const { items } = work(scratch(), { kind: 'region' });
    expect(items.map((i) => i.criterion)).toEqual(
      expect.arrayContaining(['region.danger', 'region.encounters'])
    );
  });
});
