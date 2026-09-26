'use strict';

/**
 * Cartographer — Azgaar → Loom canon mapper (C-3 / #370).
 *
 * Maps the parsed Nisia fixture (a real Azgaar 1.153.1 export) and small
 * hand-built maps into a draft Loom world, and checks the result works with the
 * Loom's own movement rules. Pure unit tests: no emulators.
 *
 * Run: cd tests && npx jest cartographer-map --verbose
 */

const fs = require('fs');
const path = require('path');
const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { evaluate } = require('../functions/loom-turn/adjudicate');

const RAW = fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'));
const parsedNisia = () => parseAzgaarExport(RAW);

const RELATIONS = [
  'ally',
  'friendly',
  'neutral',
  'suspicion',
  'enemy',
  'rival',
  'vassal',
  'suzerain',
  'unknown',
];

// Every location id reachable from `start` over connections.
function reachable(locations, start) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const next of locations[queue.shift()].connections) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

// A minimal ParsedMap for hand-built scenarios.
function parsedMap({
  settlements,
  routes = [],
  markers = [],
  features,
  states = [],
  provinces = [],
}) {
  return {
    source: {
      format: 'azgaar-json',
      version: '1.153.1',
      seed: '1',
      mapName: 'Test',
      exportedAt: null,
      width: 100,
      height: 100,
    },
    scale: { populationRate: 1000, urbanization: 1, distanceUnit: 'mi', distanceScale: 1 },
    biomes: [{ id: 1, name: 'Grassland', color: '#0f0' }],
    features: features || [
      { id: 1, type: 'ocean', cells: 10 },
      { id: 2, type: 'island', cells: 10 },
      { id: 3, type: 'island', cells: 10 },
    ],
    settlements: settlements.map((s) => ({
      stateId: 0,
      provinceId: 0,
      biomeId: 1,
      population: 1000,
      port: false,
      capital: false,
      type: 'Generic',
      group: 'town',
      featureId: 2,
      ...s,
    })),
    states,
    provinces,
    routes,
    markers: markers.map((m) => ({
      type: 'ruins',
      icon: null,
      note: '',
      settlementId: null,
      ...m,
    })),
    warnings: [],
  };
}

describe('mapping Nisia', () => {
  const { canon, stats, warnings } = mapToCanon(parsedNisia());
  const locations = Object.values(canon.locations);

  test('produces a complete draft world', () => {
    expect(stats).toEqual({
      settlements: 663,
      pointsOfInterest: 56,
      factions: 23,
      regions: 145,
      links: { road: 155, trail: 680, sea: 59 },
    });
    expect(canon).toMatchObject({
      name: 'Nisia',
      tagline: '',
      openingHook: '',
      map: { width: 1718, height: 1270, imagePath: null },
      characters: {},
      lore: {},
      rules: {},
    });
    expect(locations).toHaveLength(719);
  });

  test('reports only the expected warnings, with counts', () => {
    expect(warnings.map((w) => [w.code, w.count])).toEqual([
      ['names_qualified', 54],
      ['isolated_linked', 1],
    ]);
  });

  test('every location is reachable from every other', () => {
    expect(reachable(canon.locations, 'loc_1').size).toBe(719);
  });

  test('connections are symmetric, mirror geo.links, and never point at themselves or nowhere', () => {
    for (const location of locations) {
      expect(location.connections).toEqual(Object.keys(location.geo.links).sort());
      for (const other of location.connections) {
        expect(other).not.toBe(location.id);
        expect(canon.locations[other].geo.links[location.id]).toBe(location.geo.links[other]);
      }
    }
  });

  test('every location has the fields the Loom reads', () => {
    for (const l of locations) {
      expect(typeof l.name).toBe('string');
      expect(l.name.length).toBeGreaterThan(0);
      expect(Array.isArray(l.connections)).toBe(true);
      expect(Array.isArray(l.factionIds)).toBe(true);
      expect(l.npcIds).toEqual([]);
      expect(l.rules).toEqual({});
    }
  });

  test('a settlement: factual description, faction, and geography', () => {
    expect(canon.locations.loc_1).toMatchObject({
      id: 'loc_1',
      name: 'Burdendal',
      description:
        'Port city of about 28,500, capital of the Kingdom of Pendonia; temperate rainforest.',
      factionIds: ['fac_1'],
      geo: {
        kind: 'settlement',
        x: 922.31,
        y: 869.84,
        population: 28473,
        port: true,
        capital: true,
        biome: 'Temperate rainforest',
        regionId: 'reg_1',
      },
    });
    const descriptions = locations
      .filter((l) => l.geo.kind === 'settlement')
      .map((l) => l.description);
    expect(descriptions.every((d) => /^[A-Z].*\.$/.test(d))).toBe(true);
    expect(descriptions.some((d) => /^Riverside town of about/.test(d))).toBe(true);
    expect(descriptions.some((d) => /^Village of about \d/.test(d))).toBe(true);
  });

  test('a faction: politics and relations from diplomacy', () => {
    const pendonia = canon.factions.fac_1;
    expect(pendonia).toMatchObject({
      id: 'fac_1',
      name: 'Kingdom of Pendonia',
      description: 'A monarchy of 63 settlements with its capital at Burdendal.',
      disposition: 'neutral',
      politics: {
        form: 'Monarchy',
        formName: 'Kingdom',
        color: '#66c2a5',
        capitalLocationId: 'loc_1',
      },
    });
    expect(Object.keys(pendonia.politics.relations)).toHaveLength(22);
    expect(pendonia.politics.relations.fac_2).toBe('suspicion');
    for (const faction of Object.values(canon.factions)) {
      for (const [other, relation] of Object.entries(faction.politics.relations)) {
        expect(canon.factions[other]).toBeDefined();
        expect(RELATIONS).toContain(relation);
      }
    }
  });

  test('regions: provinces with their faction, capital and settlements', () => {
    expect(canon.regions.reg_1).toMatchObject({
      id: 'reg_1',
      name: 'Burdendal County',
      formName: 'County',
      factionId: 'fac_1',
      capitalLocationId: 'loc_1',
    });
    expect(canon.regions.reg_1.locationIds).toContain('loc_1');
    const assigned = Object.values(canon.regions).flatMap((r) => r.locationIds);
    expect(new Set(assigned).size).toBe(assigned.length); // each settlement in at most one region
    for (const id of assigned) expect(canon.locations[id].geo.regionId).toMatch(/^reg_/);
  });

  test('points of interest: described by their marker note and linked in', () => {
    const pois = locations.filter((l) => l.geo.kind === 'poi');
    expect(pois).toHaveLength(56);
    expect(canon.locations.poi_0).toMatchObject({
      name: 'Manden Purifying Well',
      geo: { kind: 'poi', markerType: 'water-sources', icon: '💧' },
    });
    expect(canon.locations.poi_0.description).toMatch(/^This legendary water source/);
    for (const poi of pois) expect(poi.connections.length).toBeGreaterThan(0);
    // The lighthouse sits in Coliverlis, so it links to it by trail.
    const lighthouse = pois.find((p) => p.name === 'Coliverlis Lighthouse');
    expect(Object.entries(lighthouse.geo.links)).toEqual([['loc_455', 'trail']]);
  });

  test('points of interest on water reach land by sea', () => {
    const water = locations.filter(
      (l) => l.geo.kind === 'poi' && Object.values(l.geo.links).every((k) => k === 'sea')
    );
    expect(water).toHaveLength(4);
  });

  test('the settlement on its own one-cell island is linked to a port by sea', () => {
    const coliverlis = canon.locations.loc_455;
    expect(coliverlis.name).toBe('Coliverlis');
    const seaLinks = Object.entries(coliverlis.geo.links).filter(([, k]) => k === 'sea');
    expect(
      seaLinks.some(
        ([id]) => canon.locations[id].geo.kind === 'settlement' && canon.locations[id].geo.port
      )
    ).toBe(true);
  });

  test('names are unique across locations and factions, qualified meaningfully', () => {
    const names = [...locations, ...Object.values(canon.factions)].map((x) => x.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);

    const all = locations.map((l) => l.name);
    // Shared settlement names are all qualified — no bare "Skipton" left.
    expect(all).not.toContain('Skipton');
    expect(all.filter((n) => n.startsWith('Skipton ('))).toHaveLength(4);
    // A province named after its own town isn't used as the qualifier.
    expect(all.some((n) => /^(.+) \(\1\)/.test(n))).toBe(false);
    expect(all).toContain('Bramburgh (Torkland)');
    // Shared marker names get their nearest settlement.
    expect(all.filter((n) => n.startsWith('Random encounter near '))).toHaveLength(4);
    // A number only when province and name both collide.
    expect(all.filter((n) => / \(\d+\)$/.test(n))).toEqual(['Bhegh (Zradrer) (2)']);
  });

  test('is deterministic', () => {
    expect(JSON.stringify(mapToCanon(parsedNisia()))).toBe(
      JSON.stringify(mapToCanon(parsedNisia()))
    );
  });

  test('takes an explicit world name', () => {
    expect(mapToCanon(parsedNisia(), { name: '  The Nisian Reaches ' }).canon.name).toBe(
      'The Nisian Reaches'
    );
  });

  test("works with the Loom's movement rules", () => {
    const target = canon.locations.loc_1.connections[0];
    const notConnected = Object.keys(canon.locations).find(
      (id) => id !== 'loc_1' && !canon.locations.loc_1.connections.includes(id)
    );
    const move = (to) =>
      evaluate({ verb: 'move', targets: [to], params: {} }, {}, { location: 'loc_1' }, 10, canon);

    const ok = move(target);
    expect(ok.outcome).toBe('success');
    expect(ok.constraints[0]).toBe(`You arrive at ${canon.locations[target].name}.`);
    expect(move(notConnected).outcome).toBe('blocked');
  });
});

describe('connectivity fallbacks', () => {
  test('no routes at all: settlements link to nearest neighbours and ports by sea, all reachable', () => {
    const parsed = parsedNisia();
    parsed.routes = [];
    const { canon, warnings, stats } = mapToCanon(parsed);
    expect(reachable(canon.locations, 'loc_1').size).toBe(719);
    expect(stats.links.road).toBe(0);
    expect(stats.links.trail).toBeGreaterThan(663);
    for (const l of Object.values(canon.locations)) expect(l.connections.length).toBeGreaterThan(0);
    // Nearest-neighbour clusters are almost fully connected on their own; the
    // bridging safety net joins what's left (one link for Nisia).
    const bridged = warnings.find((w) => w.code === 'groups_bridged');
    expect(bridged ? bridged.count : 0).toBeLessThanOrEqual(3);
  });

  test('two islands with no link between them are bridged by sea at their closest ports', () => {
    const { canon, warnings } = mapToCanon(
      parsedMap({
        settlements: [
          { id: 1, name: 'West Keep', x: 10, y: 50, cellId: 1, featureId: 2 },
          { id: 2, name: 'West Harbor', x: 40, y: 50, cellId: 2, featureId: 2, port: true },
          { id: 3, name: 'East Harbor', x: 60, y: 50, cellId: 3, featureId: 3, port: true },
          { id: 4, name: 'East Keep', x: 90, y: 50, cellId: 4, featureId: 3 },
        ],
        routes: [
          { id: 1, kind: 'road', name: '', cellIds: [1, 2] },
          { id: 2, kind: 'road', name: '', cellIds: [3, 4] },
        ],
      })
    );
    expect(canon.locations.loc_2.geo.links).toEqual({ loc_1: 'road', loc_3: 'sea' });
    expect(reachable(canon.locations, 'loc_1').size).toBe(4);
    expect(warnings).toEqual([expect.objectContaining({ code: 'groups_bridged', count: 1 })]);
  });

  test('a point of interest on open water links to the nearest port by sea', () => {
    const { canon } = mapToCanon(
      parsedMap({
        settlements: [
          { id: 1, name: 'Inland', x: 50, y: 50, cellId: 1 },
          { id: 2, name: 'Harbor', x: 80, y: 50, cellId: 2, port: true },
        ],
        routes: [{ id: 1, kind: 'road', name: '', cellIds: [1, 2] }],
        markers: [
          {
            id: 0,
            type: 'sea-monsters',
            name: 'The Kraken',
            x: 55,
            y: 90,
            cellId: 9,
            featureId: 1,
          },
        ],
      })
    );
    // Inland is closer, but a monster at sea is reached from a port.
    expect(canon.locations.poi_0.geo.links).toEqual({ loc_2: 'sea' });
  });

  test('a point of interest on land with no host links to the nearest settlement on its landmass', () => {
    const { canon } = mapToCanon(
      parsedMap({
        settlements: [
          { id: 1, name: 'Near', x: 50, y: 50, cellId: 1 },
          { id: 2, name: 'Far', x: 90, y: 90, cellId: 2 },
        ],
        routes: [{ id: 1, kind: 'trail', name: '', cellIds: [1, 2] }],
        markers: [{ id: 0, name: 'Old Ruins', x: 55, y: 52, cellId: 7, featureId: 2 }],
      })
    );
    expect(canon.locations.poi_0.geo.links).toEqual({ loc_1: 'trail' });
  });

  test('the better link kind wins when routes overlap (road > trail > sea)', () => {
    const { canon } = mapToCanon(
      parsedMap({
        settlements: [
          { id: 1, name: 'A', x: 10, y: 10, cellId: 1 },
          { id: 2, name: 'B', x: 20, y: 10, cellId: 2 },
        ],
        routes: [
          { id: 1, kind: 'sea', name: '', cellIds: [1, 2] },
          { id: 2, kind: 'road', name: '', cellIds: [2, 1] },
          { id: 3, kind: 'trail', name: '', cellIds: [1, 5, 2] },
        ],
      })
    );
    expect(canon.locations.loc_1.geo.links).toEqual({ loc_2: 'road' });
  });
});

describe('names and descriptions', () => {
  test('a settlement with no state is in unclaimed lands; an empty name gets a fallback', () => {
    const { canon } = mapToCanon(
      parsedMap({
        settlements: [
          { id: 1, name: '', x: 10, y: 10, cellId: 1, group: 'village', population: 432 },
          { id: 2, name: 'Other', x: 20, y: 10, cellId: 2 },
        ],
        routes: [{ id: 1, kind: 'trail', name: '', cellIds: [1, 2] }],
      })
    );
    expect(canon.locations.loc_1).toMatchObject({
      name: 'Settlement 1',
      description: 'Village of about 430 in unclaimed lands; grassland.',
      factionIds: [],
    });
  });

  test('a faction never takes a settlement’s name', () => {
    const { canon } = mapToCanon(
      parsedMap({
        settlements: [{ id: 1, name: 'Vasa', x: 10, y: 10, cellId: 1, stateId: 1 }],
        states: [
          {
            id: 1,
            name: 'Vasa',
            fullName: 'Vasa',
            form: 'Republic',
            formName: 'Republic',
            color: null,
            capitalSettlementId: 1,
            relations: {},
          },
        ],
      })
    );
    expect(canon.locations.loc_1.name).toBe('Vasa');
    expect(canon.factions.fac_1.name).toBe('Vasa (2)');
    expect(canon.factions.fac_1.description).toBe(
      'A republic of 1 settlement with its capital at Vasa.'
    );
  });
});
