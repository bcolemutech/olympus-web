'use strict';

/**
 * Realms, regions and terrain (planning/worlds-without-azgaar.md §4.2; L-712 /
 * #817), pure: a place's region from overlapping zones (the topmost wins), a
 * place set by hand keeping its own, a realm's land from two regions, a point
 * outside every zone, what lies at a point, and zones naming regions checked.
 *
 * Run: cd tests && npx jest loom-realms --verbose
 */

const realms = require('../functions/loom-canon/realms');
const geo = require('../functions/loom-canon/map-geometry');

// A world map 1000 × 1000: grassland under all of it, a forest in the west,
// the region of the Westmark over the west half, the Marches over the middle
// (lying over the Westmark where they meet: the topmost wins), and Eastholm
// in the east on a second map too. The Westmark and the Marches belong to
// the Crown, Eastholm to the Free Cities.
function world() {
  return {
    id: 'w',
    topMapId: 'map_world',
    maps: {
      map_world: {
        kind: 'region',
        parent: null,
        name: 'The world',
        space: { width: 1000, height: 1000 },
        geometry: {
          ground: [
            {
              id: 'land',
              material: 'grassland',
              shape: { rect: { x: 0, y: 0, w: 1000, h: 1000 } },
            },
            { id: 'woods', material: 'forest', shape: { rect: { x: 0, y: 0, w: 300, h: 1000 } } },
          ],
          zones: [
            { id: 'west', region: 'reg_west', shape: { rect: { x: 0, y: 0, w: 500, h: 1000 } } },
            {
              id: 'march',
              region: 'reg_march',
              shape: { rect: { x: 400, y: 0, w: 200, h: 1000 } },
            },
            { id: 'east', region: 'reg_east', shape: { rect: { x: 700, y: 0, w: 300, h: 1000 } } },
            { id: 'marsh', name: 'The Fens', shape: { circle: { x: 450, y: 500, r: 30 } } },
          ],
        },
      },
      map_isles: {
        kind: 'region',
        parent: { mapId: 'map_world', placeId: 'loc_port' },
        name: 'The isles',
        space: { width: 100, height: 100 },
        geometry: {
          zones: [
            { id: 'isle', region: 'reg_east', shape: { rect: { x: 10, y: 10, w: 20, h: 20 } } },
          ],
        },
      },
    },
    regions: {
      reg_west: { id: 'reg_west', name: 'The Westmark', factionId: 'fac_crown' },
      reg_march: { id: 'reg_march', name: 'The Marches', factionId: 'fac_crown' },
      reg_east: { id: 'reg_east', name: 'Eastholm', factionId: 'fac_free' },
      reg_old: { id: 'reg_old', name: 'The Old Shire', factionId: 'fac_crown', retired: true },
    },
    factions: {
      fac_crown: { id: 'fac_crown', name: 'The Crown', politics: { color: '#AA3311' } },
      fac_free: { id: 'fac_free', name: 'The Free Cities' },
    },
    locations: {
      loc_mill: { id: 'loc_mill', name: 'Mill', factionIds: [], geo: { x: 100, y: 100 } },
      loc_ford: { id: 'loc_ford', name: 'Ford', factionIds: [], geo: { x: 450, y: 200 } },
      loc_port: {
        id: 'loc_port',
        name: 'Port',
        factionIds: ['fac_crown'],
        geo: { x: 800, y: 100, regionId: 'reg_west' },
      },
      loc_gap: { id: 'loc_gap', name: 'Gap', factionIds: [], geo: { x: 650, y: 500 } },
      loc_east: { id: 'loc_east', name: 'Eastgate', factionIds: [], geo: { x: 900, y: 900 } },
    },
    mapPlaces: {
      pl_cove: { mapId: 'map_isles', name: 'Cove', at: { x: 15, y: 15 } },
      pl_reef: { mapId: 'map_isles', name: 'Reef', at: { x: 80, y: 80 } },
    },
  };
}

describe('the region at a point', () => {
  test('overlapping zones: the topmost (the later) wins', () => {
    const w = world();
    expect(realms.regionAt(w, 'map_world', [450, 200]).region.id).toBe('reg_march');
    expect(realms.regionAt(w, 'map_world', [450, 200]).zone.id).toBe('march');
    expect(realms.regionAt(w, 'map_world', [100, 200]).region.id).toBe('reg_west');
    // An unnamed zone on top doesn't hide the region under it.
    expect(realms.regionAt(w, 'map_world', [450, 500]).region.id).toBe('reg_march');
  });

  test('a point outside every zone is in no region', () => {
    const w = world();
    expect(realms.regionAt(w, 'map_world', [650, 500])).toBeNull();
    const there = realms.whereOn(w, 'map_world', [650, 500]);
    expect(there.region).toBeNull();
    expect(there.realm).toBeNull();
    expect(there.zones).toEqual([]);
  });

  test('a zone naming a retired region is passed by', () => {
    const w = world();
    w.maps.map_world.geometry.zones.push({
      id: 'old',
      region: 'reg_old',
      shape: { rect: { x: 0, y: 0, w: 50, h: 50 } },
    });
    expect(realms.regionAt(w, 'map_world', [10, 10]).region.id).toBe('reg_west');
  });

  test('what lies at a point: terrain, region, realm and zones', () => {
    const w = world();
    expect(realms.whereOn(w, 'map_world', [100, 100])).toEqual({
      terrain: { id: 'woods', material: 'forest', name: 'Forest' },
      region: { id: 'reg_west', name: 'The Westmark', zone: 'west' },
      realm: { id: 'fac_crown', name: 'The Crown' },
      zones: [{ id: 'west', region: 'reg_west' }],
    });
    const fens = realms.whereOn(w, 'map_world', [450, 500]);
    expect(fens.terrain).toMatchObject({ id: 'land', material: 'grassland' });
    expect(fens.zones.map((z) => z.id)).toEqual(['west', 'march', 'marsh']);
    expect(fens.zones[2]).toEqual({ id: 'marsh', name: 'The Fens' });
  });
});

describe('places take their region and realm from where they sit', () => {
  test('a location on the top map, from the topmost zone, and its region’s realm', () => {
    const w = realms.resolvePlaces(world());
    expect(w.locations.loc_mill.geo).toMatchObject({
      regionId: 'reg_west',
      regionFrom: 'position',
      realmFrom: 'region',
    });
    expect(w.locations.loc_mill.factionIds).toEqual(['fac_crown']);
    expect(w.locations.loc_ford.geo.regionId).toBe('reg_march');
    expect(w.locations.loc_east.factionIds).toEqual(['fac_free']);
  });

  test('a place set by hand keeps its own region and realms', () => {
    const w = realms.resolvePlaces(world());
    // Port sits in Eastholm's zone but was set to the Westmark and the Crown.
    expect(w.locations.loc_port.geo.regionId).toBe('reg_west');
    expect(w.locations.loc_port.geo.regionFrom).toBeUndefined();
    expect(w.locations.loc_port.factionIds).toEqual(['fac_crown']);
    expect(w.locations.loc_port.geo.realmFrom).toBeUndefined();
  });

  test('a region set by hand still gives its realm when none is set', () => {
    const base = world();
    base.locations.loc_gap.geo.regionId = 'reg_east';
    const w = realms.resolvePlaces(base);
    expect(w.locations.loc_gap.geo.regionFrom).toBeUndefined();
    expect(w.locations.loc_gap.factionIds).toEqual(['fac_free']);
    expect(w.locations.loc_gap.geo.realmFrom).toBe('region');
  });

  test('a place outside every zone is left as it was', () => {
    const w = realms.resolvePlaces(world());
    expect(w.locations.loc_gap.geo).toEqual({ x: 650, y: 500 });
    expect(w.locations.loc_gap.factionIds).toEqual([]);
  });

  test('a place in the new shape on another region map', () => {
    const w = realms.resolvePlaces(world());
    expect(w.mapPlaces.pl_cove.geo).toMatchObject({ regionId: 'reg_east', regionFrom: 'position' });
    expect(w.mapPlaces.pl_cove.factionIds).toEqual(['fac_free']);
    expect(w.mapPlaces.pl_reef.geo).toBeUndefined();
  });

  test('a world with no zones is left alone', () => {
    const base = world();
    delete base.maps.map_world.geometry.zones;
    const w = realms.resolvePlaces(base);
    expect(w.locations.loc_mill.geo).toEqual({ x: 100, y: 100 });
  });
});

describe('land', () => {
  test('a region’s land is its zones, on any map', () => {
    expect(realms.regionLand(world(), 'reg_east')).toEqual([
      { mapId: 'map_isles', zones: ['isle'] },
      { mapId: 'map_world', zones: ['east'] },
    ]);
    expect(realms.regionLand(world(), 'reg_nowhere')).toEqual([]);
  });

  test('a realm’s land is its regions’ land: two regions', () => {
    expect(realms.realmLand(world(), 'fac_crown')).toEqual({
      regions: ['reg_march', 'reg_west'],
      land: [
        { mapId: 'map_world', regionId: 'reg_march', zones: ['march'] },
        { mapId: 'map_world', regionId: 'reg_west', zones: ['west'] },
      ],
    });
    expect(realms.realmLand(world(), 'fac_none')).toEqual({ regions: [], land: [] });
  });

  test('a realm’s colour: its own, else one picked from its id, the same each time', () => {
    const w = world();
    expect(realms.colourOf(w.factions.fac_crown)).toBe('#aa3311');
    const picked = realms.colourOf(w.factions.fac_free);
    expect(realms.PALETTE).toContain(picked);
    expect(realms.colourOf({ id: 'fac_free' })).toBe(picked);
  });
});

describe('zones naming regions are checked', () => {
  test('a zone naming an unknown region is refused with its reason', () => {
    const problems = realms.zoneProblems(world(), [
      { id: 'a', region: 'reg_west', shape: [] },
      { id: 'b', region: 'reg_atlantis', shape: [] },
      { id: 'c', region: 'reg_old', shape: [] },
      { id: 'd', shape: [] },
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/zones\.b names a region "reg_atlantis" the world hasn’t/);
    expect(problems[1]).toMatch(/The Old Shire.*retired/);
  });

  test('the geometry takes a region only as an id', () => {
    const bounds = { width: 100, height: 100 };
    const shape = { rect: { x: 0, y: 0, w: 10, h: 10 } };
    expect(geo.check({ zones: [{ id: 'z', region: 'reg_a', shape }] }, bounds)).toEqual([]);
    expect(geo.check({ zones: [{ id: 'z', region: 7, shape }] }, bounds)).toEqual([
      expect.stringMatching(/region that isn’t a region’s id/),
    ]);
  });
});
