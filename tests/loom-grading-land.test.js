'use strict';

/**
 * Grading a world's land (planning/worlds-without-azgaar.md §4.8, GR1; L-718 /
 * #823), pure: a world's brief; a region map's terrain covering its land and
 * its regions' shapes; a settlement inside a region; a realm's land; how the
 * land counts in a map's and the world's score; and the work list naming what
 * is unpainted.
 *
 * Run: cd tests && npx jest loom-grading-land --verbose
 */

const {
  CRITERIA,
  WEIGHTS,
  QUALITY,
  LAYER_CHECKS,
  gradeRegionMap,
  gradeEntity,
  gradeWorld,
  gradeMaps,
} = require('../functions/loom-canon/grading');
const land = require('../functions/loom-canon/land');
const { workList } = require('../functions/mcp/apps/cartographer/work');
const { gridMap } = require('./helpers/grid');

const WRITTEN = { description: 'mcp' };
const words = (n) => Array(n).fill('word').join(' ');
const LONG = words(QUALITY.words.lore);

const rect = (x, y, w, h) => ({ rect: { x, y, w, h } });
const ALL = rect(0, 0, 1000, 1000);
const WEST = rect(0, 0, 500, 1000);
const EAST = rect(500, 0, 500, 1000);

const criterion = (id) => CRITERIA.find((c) => c.id === id);
const layers = { ...LAYER_CHECKS, town: () => true };
const check = (id, world, entity, kind) => criterion(id).check(world, entity, { kind, layers });

const BRIEF = {
  genre: 'Dark fantasy',
  tone: 'Grim, with hope',
  era: 'A broken empire',
  artDirection: 'Ink and ash',
};

// A world from scratch: a top region map, two realms' worth of regions, and
// two places. `painted` gives the map its terrain and every region its shape;
// `brief` the world its brief.
function scratch({ painted = true, brief = true } = {}) {
  const geometry = painted
    ? {
        ground: [
          { id: 'ashlands', material: 'desert', shape: WEST },
          { id: 'inland-sea', material: 'ocean', shape: EAST },
        ],
        zones: [
          { id: 'ashen', region: 'reg_ashen', shape: WEST },
          { id: 'tide', region: 'reg_tide', shape: EAST },
        ],
      }
    : {};
  return {
    id: 'scratch',
    name: 'Ashfall',
    status: 'draft',
    tagline: 'The ash remembers',
    openingHook: 'The bells are ringing.',
    cover: { imageId: 'img_00000000000000c0', link: 'https://x/c', width: 600, height: 300 },
    map: { hasImage: true },
    rules: { startingLocationId: 'ruin' },
    systemId: 'd20-fantasy',
    system: require('../functions/loom-canon/systems').BUILT_IN['d20-fantasy'],
    ...(brief ? { brief: BRIEF } : {}),
    topMapId: 'map_world',
    maps: {
      map_world: {
        id: 'map_world',
        kind: 'region',
        name: 'Ashfall',
        space: { width: 1000, height: 1000 },
        geometry,
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
      keld: {
        id: 'keld',
        name: 'Keld',
        description: words(60),
        sources: WRITTEN,
        connections: ['ruin'],
        npcIds: [],
        factionIds: [],
        geo: { kind: 'settlement', population: 500, x: 700, y: 500 },
        town: { ground: { buildings: [] } },
      },
    },
    battleMaps: {
      bm_ruin: gridMap({ id: 'bm_ruin', name: 'The ruin', width: 8, height: 8 }),
    },
  };
}

// The world with the land and the places' links resolved the way the loader
// does it (realms.resolvePlaces), so a place sits in the region over it.
function loaded(world) {
  return require('../functions/loom-canon/realms').resolvePlaces(world);
}

describe('terrain cover', () => {
  const map = (geometry, space = { width: 1000, height: 1000 }) => ({
    maps: { m: { id: 'm', kind: 'region', space, geometry } },
  });

  test('the share of the map under ground', () => {
    expect(
      land.terrainCover(map({ ground: [{ id: 'a', material: 'forest', shape: ALL }] }), 'm')
    ).toBe(1);
    expect(
      land.terrainCover(map({ ground: [{ id: 'a', material: 'forest', shape: WEST }] }), 'm')
    ).toBeCloseTo(0.5, 1);
    expect(
      land.terrainCover(
        map({ ground: [{ id: 'a', material: 'forest', shape: rect(0, 0, 250, 1000) }] }),
        'm'
      )
    ).toBeCloseTo(0.25, 1);
  });

  test('water is ground, and a later item over an earlier one adds nothing', () => {
    const w = map({
      ground: [
        { id: 'sea', material: 'ocean', shape: EAST },
        { id: 'lake', material: 'lake', shape: rect(600, 100, 200, 200) },
        { id: 'land', material: 'grassland', shape: WEST },
      ],
    });
    expect(land.terrainCover(w, 'm')).toBeCloseTo(1, 1);
  });

  test('a world’s own terrain is ground too', () => {
    const w = {
      materials: [{ id: 'ashwaste', name: 'Ashwaste', like: 'desert' }],
      ...map({ ground: [{ id: 'ash', material: 'ashwaste', shape: ALL }] }),
    };
    expect(land.terrainCover(w, 'm')).toBe(1);
  });

  test('none for a map with no ground, no geometry, no size, or not a map', () => {
    expect(land.terrainCover(map({ zones: [{ id: 'z', shape: ALL }] }), 'm')).toBe(0);
    expect(land.terrainCover(map(undefined), 'm')).toBe(0);
    expect(
      land.terrainCover(map({ ground: [{ id: 'a', material: 'forest', shape: ALL }] }, {}), 'm')
    ).toBe(0);
    expect(land.terrainCover(map({}), 'gone')).toBe(0);
    expect(land.terrainCover({}, 'm')).toBe(0);
  });

  test('a long thin map is sampled across its whole length', () => {
    const w = map(
      { ground: [{ id: 'a', material: 'forest', shape: rect(0, 0, 2000, 100) }] },
      { width: 4000, height: 100 }
    );
    expect(land.terrainCover(w, 'm')).toBeCloseTo(0.5, 1);
  });
});

describe('the criteria in the registry', () => {
  test('a settlement’s region is a bonus, over the rest', () => {
    expect(criterion('settlement.region').bonus).toBe(true);
    const w = loaded(scratch());
    const painted = gradeEntity(w, 'location', w.locations.keld, { layers });
    const bare = scratch({ painted: false });
    bare.locations.keld.geo.regionId = 'reg_tide';
    const without = gradeEntity(bare, 'location', bare.locations.keld, { layers });
    expect(painted.criteria.find((c) => c.id === 'settlement.region')).toMatchObject({
      bonus: true,
      met: true,
    });
    expect(painted.ownScore - without.ownScore).toBeCloseTo(5, 1);
  });

  test('their weights are the table’s, and a region map’s come to 100', () => {
    for (const id of [
      'settlement.region',
      'realm.land',
      'regionMap.terrain',
      'regionMap.regions',
      'world.brief',
    ]) {
      const [table, key] = id.split('.');
      expect(criterion(id).weight).toBe(WEIGHTS[table][key]);
      expect(criterion(id).feature).toBe('L-718');
    }
    const maps = CRITERIA.filter((c) => c.kinds.includes('regionMap'));
    expect(maps.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
    const realm = CRITERIA.filter((c) => c.kinds.includes('realm'));
    expect(realm.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
  });
});

describe('world.brief', () => {
  test('met when genre, tone, era and art direction are all written', () => {
    expect(check('world.brief', scratch(), scratch())).toEqual({ progress: 1 });
  });

  test('partial progress for the fields written, naming the rest', () => {
    const w = { ...scratch(), brief: { genre: 'Dark fantasy', tone: 'Grim' } };
    expect(check('world.brief', w, w)).toEqual({
      progress: 0.5,
      have: 2,
      want: 4,
      message: 'Its brief lacks era, art direction.',
    });
  });

  test('nothing for a world with no brief, and update_world is the tool', () => {
    const w = scratch({ brief: false });
    const got = check('world.brief', w, w);
    expect(got.progress).toBe(0);
    expect(got.message).toMatch(/no brief/);
    expect(criterion('world.brief').tool).toBe('update_world');
  });
});

describe('regionMap.terrain', () => {
  const map = (w) => ({ ...w.maps.map_world });

  test('met once the ground covers the land', () => {
    const w = scratch();
    expect(check('regionMap.terrain', w, map(w))).toEqual({ progress: 1 });
  });

  test('partial progress for the share painted, with what is bare', () => {
    const w = scratch();
    w.maps.map_world.geometry.ground = [{ id: 'ashlands', material: 'desert', shape: WEST }];
    const got = check('regionMap.terrain', w, map(w));
    expect(got.progress).toBeCloseTo(0.5 / QUALITY.landCover, 1);
    expect(got).toMatchObject({ have: 50, want: 95 });
    expect(got.message).toMatch(/covers 50% of it/);
    expect(got.message).toMatch(/set_ground/);
  });

  test('a few points short of whole still counts', () => {
    const w = scratch();
    w.maps.map_world.geometry.ground = [
      { id: 'all', material: 'desert', shape: rect(0, 0, 1000, 970) },
    ];
    expect(check('regionMap.terrain', w, map(w))).toEqual({ progress: 1 });
  });

  test('nothing painted: no progress, and set_ground is the tool', () => {
    const w = scratch({ painted: false });
    const got = check('regionMap.terrain', w, map(w));
    expect(got.progress).toBe(0);
    expect(got.message).toMatch(/no terrain/);
    expect(criterion('regionMap.terrain').tool).toBe('set_ground');
  });
});

describe('regionMap.regions', () => {
  const map = (w) => ({ ...w.maps.map_world });
  const applies = (w) => criterion('regionMap.regions').applies(w, map(w));

  test('met when every region on the map has a shape', () => {
    const w = loaded(scratch());
    expect(land.regionsOnMap(w, 'map_world')).toEqual(['reg_ashen', 'reg_tide']);
    expect(check('regionMap.regions', w, map(w))).toEqual({ progress: 1 });
  });

  test('partial, naming the regions with no shape', () => {
    const w = scratch();
    w.maps.map_world.geometry.zones = [{ id: 'ashen', region: 'reg_ashen', shape: WEST }];
    expect(check('regionMap.regions', w, map(w))).toEqual({
      progress: 0.5,
      have: 1,
      want: 2,
      lacking: ['The Tide Coast'],
      message:
        '1 of the 2 regions on it have no shape: The Tide Coast. Give each a zone naming it (set_zones with region).',
    });
  });

  test('a region nothing has placed belongs on the top map; a retired one nowhere', () => {
    const w = scratch({ painted: false });
    w.regions.reg_old = { id: 'reg_old', name: 'Old', factionId: 'fac_keld', retired: true };
    expect(land.regionsOnMap(w, 'map_world')).toEqual(['reg_ashen', 'reg_tide']);
    expect(check('regionMap.regions', w, map(w)).progress).toBe(0);
  });

  test('a region belongs where its places are, and where its zones are', () => {
    const w = scratch({ painted: false });
    w.maps.map_isles = {
      id: 'map_isles',
      kind: 'region',
      parent: { mapId: 'map_world', placeId: 'keld' },
      space: { width: 100, height: 100 },
      geometry: {},
    };
    w.regionLocations = {
      map_world: { keld: { id: 'keld', geo: { regionId: 'reg_ashen' } } },
      map_isles: { port: { id: 'port', geo: { regionId: 'reg_tide' } } },
    };
    expect(land.regionsOnMap(w, 'map_world')).toEqual(['reg_ashen']);
    expect(land.regionsOnMap(w, 'map_isles')).toEqual(['reg_tide']);
    // A shape on any map is a shape: the isles' region painted on the world map.
    w.maps.map_world.geometry = { zones: [{ id: 'tide', region: 'reg_tide', shape: EAST }] };
    expect(land.regionsOnMap(w, 'map_world')).toEqual(['reg_ashen', 'reg_tide']);
    expect(land.regionHasShape(w, 'reg_tide')).toBe(true);
    expect(land.regionHasShape(w, 'reg_ashen')).toBe(false);
  });

  test('a map with no regions on it is not graded on it', () => {
    const w = scratch();
    w.regions = {};
    expect(applies(w)).toBe(false);
    expect(gradeRegionMap(w, map(w)).criteria.map((c) => c.id)).toEqual(['regionMap.terrain']);
  });
});

describe('realm.land', () => {
  const realm = (w) => w.factions.fac_keld;

  test('met when one of its regions has a shape', () => {
    const w = scratch();
    expect(check('realm.land', w, realm(w), 'realm')).toEqual({ progress: 1 });
    w.maps.map_world.geometry.zones = [{ id: 'tide', region: 'reg_tide', shape: EAST }];
    expect(check('realm.land', w, realm(w), 'realm')).toEqual({ progress: 1 });
  });

  test('not met when its regions have none, and set_zones is the tool', () => {
    const w = scratch({ painted: false });
    const got = check('realm.land', w, realm(w), 'realm');
    expect(got.progress).toBe(0);
    expect(got.message).toMatch(/None of its 2 regions has a shape/);
    expect(got.tool).toBeUndefined();
    expect(criterion('realm.land').tool).toBe('set_zones');
  });

  test('not met with no regions at all: add_regions is the tool', () => {
    const w = scratch();
    w.regions = {};
    const got = check('realm.land', w, realm(w), 'realm');
    expect(got.progress).toBe(0);
    expect(got.tool).toBe('add_regions');
  });

  test('a retired region has no land', () => {
    const w = scratch();
    w.regions.reg_ashen.retired = true;
    w.regions.reg_tide.retired = true;
    expect(check('realm.land', w, realm(w), 'realm').progress).toBe(0);
  });

  test('counts in the realm’s score, and not in a region’s', () => {
    const painted = scratch();
    const bare = scratch({ painted: false });
    const withLand = gradeEntity(painted, 'faction', painted.factions.fac_keld);
    const without = gradeEntity(bare, 'faction', bare.factions.fac_keld);
    expect(withLand.criteria.find((c) => c.id === 'realm.land').met).toBe(true);
    expect(without.criteria.find((c) => c.id === 'realm.land').met).toBe(false);
    expect(without.ownScore).toBeLessThan(withLand.ownScore);
    const region = gradeEntity(bare, 'region', bare.regions.reg_ashen);
    expect(region.criteria.map((c) => c.id)).not.toContain('realm.land');
  });
});

describe('settlement.region', () => {
  test('met when it is in a painted region, taken from its zone or set by hand', () => {
    const w = loaded(scratch());
    expect(w.locations.keld.geo.regionId).toBe('reg_tide');
    expect(check('settlement.region', w, w.locations.keld, 'settlement')).toEqual({ progress: 1 });
    const hand = scratch();
    hand.locations.keld.geo.regionId = 'reg_ashen';
    expect(check('settlement.region', hand, hand.locations.keld, 'settlement')).toEqual({
      progress: 1,
    });
  });

  test('not met in no region, and says how', () => {
    const w = scratch({ painted: false });
    const got = check('settlement.region', w, w.locations.keld, 'settlement');
    expect(got.progress).toBe(0);
    expect(got.message).toMatch(/no region/);
    expect(got.message).toMatch(/set_zones/);
  });

  test('not met in a region with no shape: a name only', () => {
    const w = scratch({ painted: false });
    w.locations.keld.geo.regionId = 'reg_tide';
    const got = check('settlement.region', w, w.locations.keld, 'settlement');
    expect(got).toMatchObject({ progress: 0, tool: 'set_zones' });
    expect(got.message).toMatch(/The Tide Coast, has no shape/);
  });

  test('not met in a region that is retired', () => {
    const gone = scratch();
    gone.locations.keld.geo.regionId = 'reg_tide';
    gone.regions.reg_tide.retired = true;
    expect(check('settlement.region', gone, gone.locations.keld, 'settlement').progress).toBe(0);
  });
});

describe('a region map’s grade', () => {
  test('its land scores 60 for terrain and 40 for shaped regions', () => {
    const w = scratch();
    w.maps.map_world.geometry.zones = [{ id: 'ashen', region: 'reg_ashen', shape: WEST }];
    const graded = gradeRegionMap(w, w.maps.map_world);
    expect(graded.score).toBe(80);
    expect(graded.criteria.map((c) => [c.id, c.met])).toEqual([
      ['regionMap.terrain', true],
      ['regionMap.regions', false],
    ]);
    expect(graded.checklist[0]).toMatchObject({
      need: 'shapes',
      tool: 'set_zones',
      criterion: 'regionMap.regions',
      lacking: ['The Tide Coast'],
    });
  });

  test('a bare map scores nothing for its land', () => {
    const w = scratch({ painted: false });
    expect(gradeRegionMap(w, w.maps.map_world).score).toBe(0);
  });

  test('a world that is not graded is exempt', () => {
    const w = scratch();
    delete w.status;
    expect(gradeRegionMap(w, w.maps.map_world).exempt).toBe(true);
  });

  test('the maps tree shows what the land lacks, and its score includes the land', () => {
    const bare = scratch({ painted: false });
    const painted = scratch();
    const treeBare = gradeMaps(bare, { layers });
    const treePainted = gradeMaps(painted, { layers });
    expect(treeBare.lacks.some((l) => /no terrain/.test(l))).toBe(true);
    expect(treeBare.lacks.some((l) => /regions on it have no shape/.test(l))).toBe(true);
    expect(treePainted.lacks.some((l) => /terrain|no shape/.test(l))).toBe(false);
    // 80% its places and 20% the land: a painted map earns the 20.
    expect(treePainted.score - treeBare.score).toBeCloseTo(QUALITY.regionMap.own * 100, 1);
  });
});

describe('a world’s score counts the brief and the land', () => {
  const score = (w) => gradeWorld(loaded(w), { layers });

  test('a world with a brief and its land painted scores higher than the same without', () => {
    const bare = score(scratch({ painted: false, brief: false }));
    const full = score(scratch());
    expect(full.score).toBeGreaterThan(bare.score);
    expect(full.ownScore).toBeGreaterThan(bare.ownScore);
    expect(full.placesScore).toBeGreaterThan(bare.placesScore);
    // Either alone helps too.
    expect(score(scratch({ painted: false })).score).toBeGreaterThan(bare.score);
    expect(score(scratch({ brief: false })).score).toBeGreaterThan(bare.score);
  });

  test('its checklist asks for the brief, and the land', () => {
    const bare = score(scratch({ painted: false, brief: false }));
    expect(bare.checklist.map((i) => i.criterion)).toContain('world.brief');
    expect(bare.criteria.find((c) => c.id === 'world.brief').met).toBe(false);
    expect(score(scratch()).criteria.find((c) => c.id === 'world.brief').met).toBe(true);
  });

  test('a world with one region map and no region maps below scores its places with the land', () => {
    const w = loaded(scratch());
    const summary = gradeWorld(w, { layers });
    const tree = gradeMaps(w, { layers });
    expect(summary.placesScore).toBeCloseTo(tree.score, 1);
  });
});

describe('the work list names what is unpainted', () => {
  const work = (w) => workList(loaded(w), { limit: 100, offset: 0 });
  const group = (items, id) => items.find((i) => i.criterion === id);

  test('the unpainted map, its regions and their realm', () => {
    const { items } = work(scratch({ painted: false, brief: false }));

    const terrain = group(items, 'regionMap.terrain');
    expect(terrain).toMatchObject({ need: 'terrain', tool: 'set_ground', count: 1 });
    expect(terrain.entities[0]).toMatchObject({ kind: 'map', id: 'map_world', name: 'Ashfall' });

    const shapes = group(items, 'regionMap.regions');
    expect(shapes).toMatchObject({ need: 'shapes', tool: 'set_zones' });
    expect(shapes.entities[0].lacking).toEqual(['The Ashen Reach', 'The Tide Coast']);
    expect(shapes.summary).toMatch(/region map/);

    expect(group(items, 'realm.land')).toMatchObject({ need: 'land', tool: 'set_zones' });
    expect(group(items, 'realm.land').entities.map((e) => e.name)).toEqual(['The Duchy of Keld']);
    expect(group(items, 'world.brief')).toMatchObject({ need: 'brief', tool: 'update_world' });
  });

  test('painted, the land asks for nothing more', () => {
    const { items, howTo } = work(scratch());
    for (const id of [
      'regionMap.terrain',
      'regionMap.regions',
      'realm.land',
      'world.brief',
      'settlement.region',
    ]) {
      expect(group(items, id)).toBeUndefined();
    }
    expect(howTo.terrain).toBeUndefined();
  });

  test('explains each piece of work once', () => {
    const { howTo } = work(scratch({ painted: false, brief: false }));
    for (const need of ['terrain', 'shapes', 'land', 'brief']) {
      expect(howTo[need]).toMatch(/\w/);
      expect(howTo[need]).not.toBe(need);
    }
  });

  test('kind map covers the region maps’ score work', () => {
    const { items } = workList(loaded(scratch({ painted: false })), {
      kind: 'map',
      limit: 100,
      offset: 0,
    });
    expect(items.map((i) => i.criterion)).toEqual(
      expect.arrayContaining(['regionMap.terrain', 'regionMap.regions'])
    );
  });
});
