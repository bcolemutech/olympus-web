const path = require('path');
const overlay = require(path.join(
  __dirname,
  '..',
  'public',
  'apps',
  'tortuga',
  'cartographer',
  'overlay.js'
));
const { azgaarJsonSample } = require('./fixtures/azgaar-json-sample.js');
const importer = require(path.join(
  __dirname,
  '..',
  'public',
  'apps',
  'tortuga',
  'cartographer',
  'importer.js'
));

// Fixture burgs extracted from the azgaarJsonSample:
//   burg_1 — Port Royal:       isPort=true,  isCapital=true,  stateId=1, population=12.5 (large)
//   burg_2 — Highmount:        isPort=false, isCapital=false, stateId=1, population=4.3  (medium)
//   burg_3 — Smuggler's Rest:  isPort=true,  isCapital=false, stateId=0, population=0.6  (small)

const VALID_TYPES = [
  'colonial_port',
  'free_port',
  'fort',
  'hidden_cove',
  'native_village',
  'ruins',
];

describe('Tortuga overlay — classifySettlements', () => {
  let parsed;

  beforeEach(() => {
    parsed = importer.parseAzgaarJson(azgaarJsonSample());
  });

  test('excludes non-coastal burgs (isPort=false)', () => {
    const settlements = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    const ids = settlements.map((s) => s.id);
    expect(ids).not.toContain('burg_2'); // Highmount has isPort=false
  });

  test('includes all coastal burgs (isPort=true)', () => {
    const settlements = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    const ids = settlements.map((s) => s.id);
    expect(ids).toContain('burg_1'); // Port Royal
    expect(ids).toContain('burg_3'); // Smuggler's Rest
  });

  test('large state capital becomes colonial_port', () => {
    const settlements = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    const portRoyal = settlements.find((s) => s.id === 'burg_1');
    expect(portRoyal.type).toBe('colonial_port');
  });

  test('small neutral coastal burg becomes native_village', () => {
    const settlements = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    const smugglers = settlements.find((s) => s.id === 'burg_3');
    expect(smugglers.type).toBe('native_village');
  });

  test('output schema has all required §9 fields', () => {
    const settlements = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    settlements.forEach((s) => {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('type');
      expect(s).toHaveProperty('position');
      expect(s).toHaveProperty('parentFaction');
      expect(s).toHaveProperty('baseSize');
      expect(s).toHaveProperty('hidden');
    });
  });

  test('hidden is always false for classified burgs', () => {
    const settlements = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    settlements.forEach((s) => expect(s.hidden).toBe(false));
  });

  test('parentFaction is null for neutral burgs (stateId=0)', () => {
    const settlements = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    const smugglers = settlements.find((s) => s.id === 'burg_3');
    expect(smugglers.parentFaction).toBeNull();
  });

  test('parentFaction is state id string for state-owned burgs', () => {
    const settlements = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    const portRoyal = settlements.find((s) => s.id === 'burg_1');
    expect(portRoyal.parentFaction).toBe('state_1');
  });

  test('position matches the burg pos [y, x]', () => {
    const settlements = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    const portRoyal = settlements.find((s) => s.id === 'burg_1');
    expect(portRoyal.position).toEqual([150, 150]); // burg_1 has y:150, x:150
  });

  test('baseSize is large for Port Royal (population 12.5)', () => {
    const settlements = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    const portRoyal = settlements.find((s) => s.id === 'burg_1');
    expect(portRoyal.baseSize).toBe('large');
  });

  test('baseSize is small for Smuggler Rest (population 0.6)', () => {
    const settlements = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    const smugglers = settlements.find((s) => s.id === 'burg_3');
    expect(smugglers.baseSize).toBe('small');
  });

  test('all output types are valid settlement type strings', () => {
    const settlements = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    settlements.forEach((s) => expect(VALID_TYPES).toContain(s.type));
  });

  test('is deterministic — same input produces same output', () => {
    const a = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    const b = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    expect(a).toEqual(b);
  });

  test('does not produce all-colonial_port output on a diverse fixture', () => {
    // Build a larger set of burgs with variety
    const burgs = [
      { id: 'burg_a', name: 'BigPort', pos: [100, 100], population: 15, stateId: 1, isPort: true, isCapital: true },
      { id: 'burg_b', name: 'SmallHamlet', pos: [200, 200], population: 0.5, stateId: 0, isPort: true, isCapital: false },
      { id: 'burg_c', name: 'MidCove', pos: [300, 300], population: 3, stateId: 2, isPort: true, isCapital: false },
      { id: 'burg_d', name: 'TinyOutpost', pos: [400, 400], population: 0.3, stateId: 1, isPort: true, isCapital: false },
      { id: 'burg_e', name: 'FreeHarbor', pos: [500, 500], population: 5, stateId: 0, isPort: true, isCapital: false },
    ];
    const results = overlay.classifySettlements(burgs, [], {});
    const types = results.map((s) => s.type);
    const uniqueTypes = [...new Set(types)];
    expect(uniqueTypes.length).toBeGreaterThan(1);
  });
});

describe('Tortuga overlay — generateHiddenCoves', () => {
  let parsed;

  beforeEach(() => {
    parsed = importer.parseAzgaarJson(azgaarJsonSample());
  });

  test('returns 5 coves for sparse density', () => {
    const coves = overlay.generateHiddenCoves(parsed.bounds, parsed.coastlines, {
      density: 'sparse',
    });
    expect(coves).toHaveLength(5);
  });

  test('returns 10 coves for standard density (default)', () => {
    const coves = overlay.generateHiddenCoves(parsed.bounds, parsed.coastlines, {
      density: 'standard',
    });
    expect(coves).toHaveLength(10);
  });

  test('returns 20 coves for dense density', () => {
    const coves = overlay.generateHiddenCoves(parsed.bounds, parsed.coastlines, {
      density: 'dense',
    });
    expect(coves).toHaveLength(20);
  });

  test('defaults to standard count when no options provided', () => {
    const coves = overlay.generateHiddenCoves(parsed.bounds, parsed.coastlines, {});
    expect(coves).toHaveLength(10);
  });

  test('all coves have hidden: true', () => {
    const coves = overlay.generateHiddenCoves(parsed.bounds, parsed.coastlines, {});
    coves.forEach((c) => expect(c.hidden).toBe(true));
  });

  test('all coves have type: hidden_cove', () => {
    const coves = overlay.generateHiddenCoves(parsed.bounds, parsed.coastlines, {});
    coves.forEach((c) => expect(c.type).toBe('hidden_cove'));
  });

  test('all coves have parentFaction: null', () => {
    const coves = overlay.generateHiddenCoves(parsed.bounds, parsed.coastlines, {});
    coves.forEach((c) => expect(c.parentFaction).toBeNull());
  });

  test('all coves have baseSize: small', () => {
    const coves = overlay.generateHiddenCoves(parsed.bounds, parsed.coastlines, {});
    coves.forEach((c) => expect(c.baseSize).toBe('small'));
  });

  test('all coves have required schema fields', () => {
    const coves = overlay.generateHiddenCoves(parsed.bounds, parsed.coastlines, {});
    coves.forEach((c) => {
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('name');
      expect(c).toHaveProperty('type');
      expect(c).toHaveProperty('position');
      expect(c).toHaveProperty('parentFaction');
      expect(c).toHaveProperty('baseSize');
      expect(c).toHaveProperty('hidden');
    });
  });

  test('returns empty array when coastlines is empty', () => {
    const coves = overlay.generateHiddenCoves(parsed.bounds, [], { density: 'standard' });
    expect(coves).toHaveLength(0);
  });

  test('is deterministic — same input produces same output', () => {
    const a = overlay.generateHiddenCoves(parsed.bounds, parsed.coastlines, {
      density: 'standard',
    });
    const b = overlay.generateHiddenCoves(parsed.bounds, parsed.coastlines, {
      density: 'standard',
    });
    expect(a).toEqual(b);
  });

  test('positions are arrays of two numbers', () => {
    const coves = overlay.generateHiddenCoves(parsed.bounds, parsed.coastlines, {});
    coves.forEach((c) => {
      expect(Array.isArray(c.position)).toBe(true);
      expect(c.position).toHaveLength(2);
      expect(typeof c.position[0]).toBe('number');
      expect(typeof c.position[1]).toBe('number');
    });
  });
});

describe('Tortuga overlay — applyOverlay', () => {
  let parsed;

  beforeEach(() => {
    parsed = importer.parseAzgaarJson(azgaarJsonSample());
  });

  test('returns all required top-level keys', () => {
    const world = overlay.applyOverlay(parsed, {});
    expect(world).toHaveProperty('bounds');
    expect(world).toHaveProperty('coastlines');
    expect(world).toHaveProperty('settlements');
    expect(world).toHaveProperty('hazards');
    expect(world).toHaveProperty('factions');
    expect(world).toHaveProperty('tradeRoutes');
    expect(world).toHaveProperty('factionTerritory');
    expect(world).toHaveProperty('windCurrentZones');
  });

  test('factions is a non-empty array', () => {
    const world = overlay.applyOverlay(parsed, {});
    expect(Array.isArray(world.factions)).toBe(true);
    expect(world.factions.length).toBeGreaterThan(0);
  });

  test('settlements combines classified burgs and hidden coves', () => {
    const world = overlay.applyOverlay(parsed, { density: 'standard' });
    const classified = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    const coves = overlay.generateHiddenCoves(parsed.bounds, parsed.coastlines, {
      density: 'standard',
    });
    expect(world.settlements).toHaveLength(classified.length + coves.length);
  });

  test('hidden coves in the combined array have hidden: true', () => {
    const world = overlay.applyOverlay(parsed, {});
    const coves = world.settlements.filter((s) => s.type === 'hidden_cove');
    expect(coves.length).toBeGreaterThan(0);
    coves.forEach((c) => expect(c.hidden).toBe(true));
  });

  test('classified settlements in the combined array have hidden: false', () => {
    const world = overlay.applyOverlay(parsed, {});
    const regular = world.settlements.filter((s) => s.type !== 'hidden_cove');
    regular.forEach((s) => expect(s.hidden).toBe(false));
  });

  test('lake hazards are preserved', () => {
    const world = overlay.applyOverlay(parsed, {});
    expect(world.hazards.length).toBeGreaterThan(0);
    const lake = world.hazards.find((h) => h.type === 'lake');
    expect(lake).toBeDefined();
    expect(lake.name).toBe('Mirror Lake');
  });

  test('lakes carry severity: low', () => {
    const world = overlay.applyOverlay(parsed, {});
    const lake = world.hazards.find((h) => h.type === 'lake');
    expect(lake.severity).toBe('low');
  });

  test('hazards include reefs when coastlines are present', () => {
    const world = overlay.applyOverlay(parsed, {});
    const reefs = world.hazards.filter((h) => h.type === 'reef');
    expect(reefs.length).toBeGreaterThan(0);
  });

  test('hazards include storm bands', () => {
    const world = overlay.applyOverlay(parsed, {});
    const bands = world.hazards.filter((h) => h.type === 'storm_band');
    expect(bands.length).toBeGreaterThan(0);
  });

  test('hazards include kraken zones by default', () => {
    const world = overlay.applyOverlay(parsed, {});
    const krakens = world.hazards.filter((h) => h.type === 'kraken_zone');
    expect(krakens.length).toBeGreaterThan(0);
  });

  test('mythic: false suppresses kraken zones', () => {
    const world = overlay.applyOverlay(parsed, { mythic: false });
    const krakens = world.hazards.filter((h) => h.type === 'kraken_zone');
    expect(krakens).toHaveLength(0);
  });

  test('mythic: true includes kraken zones', () => {
    const world = overlay.applyOverlay(parsed, { mythic: true });
    const krakens = world.hazards.filter((h) => h.type === 'kraken_zone');
    expect(krakens.length).toBeGreaterThan(0);
  });

  test('density: sparse yields fewer reefs than density: dense', () => {
    const sparse = overlay.applyOverlay(parsed, { density: 'sparse' });
    const dense = overlay.applyOverlay(parsed, { density: 'dense' });
    const sparseReefs = sparse.hazards.filter((h) => h.type === 'reef').length;
    const denseReefs = dense.hazards.filter((h) => h.type === 'reef').length;
    expect(sparseReefs).toBeLessThan(denseReefs);
  });

  test('tradeRoutes, factionTerritory, and windCurrentZones are empty arrays', () => {
    const world = overlay.applyOverlay(parsed, {});
    expect(world.tradeRoutes).toEqual([]);
    expect(world.factionTerritory).toEqual([]);
    expect(world.windCurrentZones).toEqual([]);
  });

  test('bounds and coastlines are passed through unchanged', () => {
    const world = overlay.applyOverlay(parsed, {});
    expect(world.bounds).toEqual(parsed.bounds);
    expect(world.coastlines).toBe(parsed.coastlines);
  });

  test('tradeRoutes populated when multiple large colonial_ports share a faction', () => {
    // Construct a minimal parsed object with two large state-1 port burgs.
    const parsedWithPorts = {
      bounds: [[0, 0], [800, 1000]],
      coastlines: [[[0, 0], [100, 0], [100, 100], [0, 100]]],
      lakes: [],
      burgs: [
        { id: 'burg_10', name: 'Haven A', pos: [200, 100], population: 10, stateId: 1, isPort: true, isCapital: true },
        { id: 'burg_11', name: 'Haven B', pos: [200, 500], population: 10, stateId: 1, isPort: true, isCapital: false },
      ],
      stateBorders: [{ id: 'state_1', name: 'Albion', color: '#cc4400', capitalBurgId: 'burg_10' }],
    };
    const world = overlay.applyOverlay(parsedWithPorts, {});
    expect(world.tradeRoutes.length).toBeGreaterThan(0);
    world.tradeRoutes.forEach((r) => {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('fromId');
      expect(r).toHaveProperty('toId');
      expect(r).toHaveProperty('faction');
      expect(r.faction).toBe('state_1');
    });
  });
});

describe('Tortuga overlay — generateReefs', () => {
  let parsed;

  beforeEach(() => {
    parsed = importer.parseAzgaarJson(azgaarJsonSample());
  });

  test('returns 3 reefs for sparse density', () => {
    const reefs = overlay.generateReefs(parsed.bounds, parsed.coastlines, { density: 'sparse' });
    expect(reefs).toHaveLength(3);
  });

  test('returns 6 reefs for standard density', () => {
    const reefs = overlay.generateReefs(parsed.bounds, parsed.coastlines, { density: 'standard' });
    expect(reefs).toHaveLength(6);
  });

  test('returns 12 reefs for dense density', () => {
    const reefs = overlay.generateReefs(parsed.bounds, parsed.coastlines, { density: 'dense' });
    expect(reefs).toHaveLength(12);
  });

  test('defaults to standard count when no density provided', () => {
    const reefs = overlay.generateReefs(parsed.bounds, parsed.coastlines, {});
    expect(reefs).toHaveLength(6);
  });

  test('all reefs have type: reef', () => {
    const reefs = overlay.generateReefs(parsed.bounds, parsed.coastlines, {});
    reefs.forEach((r) => expect(r.type).toBe('reef'));
  });

  test('all reefs have severity: medium', () => {
    const reefs = overlay.generateReefs(parsed.bounds, parsed.coastlines, {});
    reefs.forEach((r) => expect(r.severity).toBe('medium'));
  });

  test('all reefs have required schema fields', () => {
    const reefs = overlay.generateReefs(parsed.bounds, parsed.coastlines, {});
    reefs.forEach((r) => {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('type');
      expect(r).toHaveProperty('polygon');
      expect(r).toHaveProperty('severity');
    });
  });

  test('polygon is an array of [y, x] pairs', () => {
    const reefs = overlay.generateReefs(parsed.bounds, parsed.coastlines, {});
    reefs.forEach((r) => {
      expect(Array.isArray(r.polygon)).toBe(true);
      expect(r.polygon.length).toBeGreaterThanOrEqual(3);
      r.polygon.forEach((pt) => {
        expect(Array.isArray(pt)).toBe(true);
        expect(pt).toHaveLength(2);
        expect(typeof pt[0]).toBe('number');
        expect(typeof pt[1]).toBe('number');
      });
    });
  });

  test('returns empty array when coastlines is empty', () => {
    const reefs = overlay.generateReefs(parsed.bounds, [], {});
    expect(reefs).toHaveLength(0);
  });

  test('is deterministic — same input produces same output', () => {
    const a = overlay.generateReefs(parsed.bounds, parsed.coastlines, { density: 'standard' });
    const b = overlay.generateReefs(parsed.bounds, parsed.coastlines, { density: 'standard' });
    expect(a).toEqual(b);
  });
});

describe('Tortuga overlay — generateStormBands', () => {
  let parsed;

  beforeEach(() => {
    parsed = importer.parseAzgaarJson(azgaarJsonSample());
  });

  test('returns 1 band for sparse density', () => {
    const bands = overlay.generateStormBands(parsed.bounds, { density: 'sparse' });
    expect(bands).toHaveLength(1);
  });

  test('returns 2 bands for standard density', () => {
    const bands = overlay.generateStormBands(parsed.bounds, { density: 'standard' });
    expect(bands).toHaveLength(2);
  });

  test('returns 3 bands for dense density', () => {
    const bands = overlay.generateStormBands(parsed.bounds, { density: 'dense' });
    expect(bands).toHaveLength(3);
  });

  test('defaults to standard count when no density provided', () => {
    const bands = overlay.generateStormBands(parsed.bounds, {});
    expect(bands).toHaveLength(2);
  });

  test('all bands have type: storm_band', () => {
    const bands = overlay.generateStormBands(parsed.bounds, {});
    bands.forEach((b) => expect(b.type).toBe('storm_band'));
  });

  test('all bands have severity: high', () => {
    const bands = overlay.generateStormBands(parsed.bounds, {});
    bands.forEach((b) => expect(b.severity).toBe('high'));
  });

  test('all bands have required schema fields', () => {
    const bands = overlay.generateStormBands(parsed.bounds, {});
    bands.forEach((b) => {
      expect(b).toHaveProperty('id');
      expect(b).toHaveProperty('type');
      expect(b).toHaveProperty('polygon');
      expect(b).toHaveProperty('severity');
    });
  });

  test('band polygon spans the full map width', () => {
    const bands = overlay.generateStormBands(parsed.bounds, { density: 'standard' });
    const minX = parsed.bounds[0][1];
    const maxX = parsed.bounds[1][1];
    bands.forEach((b) => {
      const xs = b.polygon.map((pt) => pt[1]);
      expect(Math.min(...xs)).toBe(minX);
      expect(Math.max(...xs)).toBe(maxX);
    });
  });

  test('is deterministic — same input produces same output', () => {
    const a = overlay.generateStormBands(parsed.bounds, { density: 'standard' });
    const b = overlay.generateStormBands(parsed.bounds, { density: 'standard' });
    expect(a).toEqual(b);
  });
});

describe('Tortuga overlay — generateKrakenZones', () => {
  let parsed;

  beforeEach(() => {
    parsed = importer.parseAzgaarJson(azgaarJsonSample());
  });

  test('returns 0 zones when mythic: false', () => {
    const zones = overlay.generateKrakenZones(parsed.bounds, parsed.coastlines, {
      mythic: false,
    });
    expect(zones).toHaveLength(0);
  });

  test('returns 1 zone for sparse density (mythic unset)', () => {
    const zones = overlay.generateKrakenZones(parsed.bounds, parsed.coastlines, {
      density: 'sparse',
    });
    expect(zones).toHaveLength(1);
  });

  test('returns 2 zones for standard density (mythic unset)', () => {
    const zones = overlay.generateKrakenZones(parsed.bounds, parsed.coastlines, {
      density: 'standard',
    });
    expect(zones).toHaveLength(2);
  });

  test('returns 3 zones for dense density (mythic unset)', () => {
    const zones = overlay.generateKrakenZones(parsed.bounds, parsed.coastlines, {
      density: 'dense',
    });
    expect(zones).toHaveLength(3);
  });

  test('returns zones by default when no options provided', () => {
    const zones = overlay.generateKrakenZones(parsed.bounds, parsed.coastlines, {});
    expect(zones.length).toBeGreaterThan(0);
  });

  test('mythic: true includes kraken zones', () => {
    const zones = overlay.generateKrakenZones(parsed.bounds, parsed.coastlines, {
      mythic: true,
      density: 'standard',
    });
    expect(zones).toHaveLength(2);
  });

  test('all zones have type: kraken_zone', () => {
    const zones = overlay.generateKrakenZones(parsed.bounds, parsed.coastlines, {});
    zones.forEach((z) => expect(z.type).toBe('kraken_zone'));
  });

  test('all zones have severity: high', () => {
    const zones = overlay.generateKrakenZones(parsed.bounds, parsed.coastlines, {});
    zones.forEach((z) => expect(z.severity).toBe('high'));
  });

  test('all zones have required schema fields', () => {
    const zones = overlay.generateKrakenZones(parsed.bounds, parsed.coastlines, {});
    zones.forEach((z) => {
      expect(z).toHaveProperty('id');
      expect(z).toHaveProperty('type');
      expect(z).toHaveProperty('polygon');
      expect(z).toHaveProperty('severity');
    });
  });

  test('polygon is an array of [y, x] pairs', () => {
    const zones = overlay.generateKrakenZones(parsed.bounds, parsed.coastlines, {});
    zones.forEach((z) => {
      expect(Array.isArray(z.polygon)).toBe(true);
      expect(z.polygon.length).toBeGreaterThanOrEqual(3);
      z.polygon.forEach((pt) => {
        expect(Array.isArray(pt)).toBe(true);
        expect(pt).toHaveLength(2);
        expect(typeof pt[0]).toBe('number');
        expect(typeof pt[1]).toBe('number');
      });
    });
  });

  test('is deterministic — same input produces same output', () => {
    const a = overlay.generateKrakenZones(parsed.bounds, parsed.coastlines, {
      density: 'standard',
    });
    const b = overlay.generateKrakenZones(parsed.bounds, parsed.coastlines, {
      density: 'standard',
    });
    expect(a).toEqual(b);
  });
});

describe('Tortuga overlay — generateTradeRoutes', () => {
  function makePort(id, faction, x, y) {
    return {
      id,
      name: id,
      type: 'colonial_port',
      position: [y !== undefined ? y : 100, x],
      parentFaction: faction,
      baseSize: 'large',
      hidden: false,
    };
  }

  test('returns empty array for empty settlements', () => {
    expect(overlay.generateTradeRoutes([], {})).toEqual([]);
  });

  test('returns empty array when no colonial_ports exist', () => {
    const settlements = [
      { id: 'a', type: 'free_port', position: [100, 100], parentFaction: 'state_1', baseSize: 'large', hidden: false },
      { id: 'b', type: 'fort', position: [100, 200], parentFaction: 'state_1', baseSize: 'large', hidden: false },
    ];
    expect(overlay.generateTradeRoutes(settlements, {})).toEqual([]);
  });

  test('returns empty array when large colonial_ports have no parentFaction', () => {
    const settlements = [makePort('a', null, 100), makePort('b', null, 200)];
    // override parentFaction to null
    settlements[0].parentFaction = null;
    settlements[1].parentFaction = null;
    expect(overlay.generateTradeRoutes(settlements, {})).toEqual([]);
  });

  test('returns empty array when only one large colonial_port per faction', () => {
    expect(overlay.generateTradeRoutes([makePort('a', 'state_1', 100)], {})).toEqual([]);
  });

  test('two large colonial_ports of same faction produce 1 route', () => {
    const routes = overlay.generateTradeRoutes(
      [makePort('a', 'state_1', 100), makePort('b', 'state_1', 200)],
      {}
    );
    expect(routes).toHaveLength(1);
  });

  test('three large colonial_ports of same faction produce 2 routes (not 3)', () => {
    const routes = overlay.generateTradeRoutes(
      [makePort('a', 'state_1', 100), makePort('b', 'state_1', 200), makePort('c', 'state_1', 300)],
      {}
    );
    expect(routes).toHaveLength(2);
  });

  test('two factions with 2 ports each produce 2 routes total', () => {
    const settlements = [
      makePort('a', 'state_1', 100),
      makePort('b', 'state_1', 200),
      makePort('c', 'state_2', 300),
      makePort('d', 'state_2', 400),
    ];
    expect(overlay.generateTradeRoutes(settlements, {})).toHaveLength(2);
  });

  test('routes never connect ports of different factions', () => {
    const settlements = [
      makePort('a', 'state_1', 100),
      makePort('b', 'state_1', 200),
      makePort('c', 'state_2', 150),
      makePort('d', 'state_2', 350),
    ];
    const routes = overlay.generateTradeRoutes(settlements, {});
    routes.forEach((r) => {
      const from = settlements.find((s) => s.id === r.fromId);
      const to = settlements.find((s) => s.id === r.toId);
      expect(from.parentFaction).toBe(to.parentFaction);
      expect(r.faction).toBe(from.parentFaction);
    });
  });

  test('route schema has all §9 required fields: id, fromId, toId, faction', () => {
    const routes = overlay.generateTradeRoutes(
      [makePort('a', 'state_1', 100), makePort('b', 'state_1', 200)],
      {}
    );
    routes.forEach((r) => {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('fromId');
      expect(r).toHaveProperty('toId');
      expect(r).toHaveProperty('faction');
    });
  });

  test('route id starts with "route_"', () => {
    const routes = overlay.generateTradeRoutes(
      [makePort('a', 'state_1', 100), makePort('b', 'state_1', 200)],
      {}
    );
    routes.forEach((r) => expect(r.id).toMatch(/^route_\d+$/));
  });

  test('fromId and toId reference valid settlement ids', () => {
    const settlements = [
      makePort('a', 'state_1', 100),
      makePort('b', 'state_1', 200),
      makePort('c', 'state_1', 300),
    ];
    const ids = settlements.map((s) => s.id);
    const routes = overlay.generateTradeRoutes(settlements, {});
    routes.forEach((r) => {
      expect(ids).toContain(r.fromId);
      expect(ids).toContain(r.toId);
    });
  });

  test('medium colonial_ports are excluded from routes', () => {
    const settlements = [
      makePort('large_a', 'state_1', 100),
      makePort('large_b', 'state_1', 200),
      { id: 'medium_c', name: 'medium_c', type: 'colonial_port', position: [100, 150], parentFaction: 'state_1', baseSize: 'medium', hidden: false },
    ];
    const routes = overlay.generateTradeRoutes(settlements, {});
    // Only 2 large ports → 1 route; medium is not in any route endpoint
    expect(routes).toHaveLength(1);
    routes.forEach((r) => {
      expect(r.fromId).not.toBe('medium_c');
      expect(r.toId).not.toBe('medium_c');
    });
  });

  test('non-colonial_port settlement types are excluded', () => {
    const settlements = [
      { id: 'fp1', type: 'free_port', position: [100, 100], parentFaction: 'state_1', baseSize: 'large', hidden: false },
      { id: 'ft1', type: 'fort', position: [100, 200], parentFaction: 'state_1', baseSize: 'large', hidden: false },
      { id: 'hc1', type: 'hidden_cove', position: [100, 300], parentFaction: 'state_1', baseSize: 'large', hidden: true },
    ];
    expect(overlay.generateTradeRoutes(settlements, {})).toHaveLength(0);
  });

  test('is deterministic — same input produces same output', () => {
    const settlements = [
      makePort('a', 'state_1', 100),
      makePort('b', 'state_1', 200),
      makePort('c', 'state_2', 300),
      makePort('d', 'state_2', 400),
    ];
    const a = overlay.generateTradeRoutes(settlements, {});
    const b = overlay.generateTradeRoutes(settlements, {});
    expect(a).toEqual(b);
  });
});

describe('Tortuga overlay — generateFactions', () => {
  // Fixture states from azgaarJsonSample:
  //   state_1 — Albion:  color '#cc4400', capitalBurgId 'burg_1'
  //   state_2 — Castile: color '#ddaa00', capitalBurgId null
  let parsed;

  beforeEach(() => {
    parsed = importer.parseAzgaarJson(azgaarJsonSample());
  });

  test('every faction has all required §9 schema fields', () => {
    const factions = overlay.generateFactions(parsed.stateBorders, {});
    factions.forEach((f) => {
      expect(f).toHaveProperty('id');
      expect(f).toHaveProperty('name');
      expect(f).toHaveProperty('archetype');
      expect(f).toHaveProperty('color');
      expect(f).toHaveProperty('homeSettlementId');
    });
  });

  test('archetype is a non-empty string on every faction', () => {
    const factions = overlay.generateFactions(parsed.stateBorders, {});
    factions.forEach((f) => {
      expect(typeof f.archetype).toBe('string');
      expect(f.archetype.length).toBeGreaterThan(0);
    });
  });

  test('era preset influences faction archetypes — caribbean_golden_age vs mediterranean_corsair', () => {
    const caribbean = overlay.generateFactions(parsed.stateBorders, {
      era: 'caribbean_golden_age',
    });
    const mediterranean = overlay.generateFactions(parsed.stateBorders, {
      era: 'mediterranean_corsair',
    });
    const firstCaribbean = caribbean.find((f) => f.id === 'state_1');
    const firstMediterranean = mediterranean.find((f) => f.id === 'state_1');
    expect(firstCaribbean.archetype).not.toBe(firstMediterranean.archetype);
  });

  test('factionCount: 2 limits output to at most 2 factions', () => {
    const factions = overlay.generateFactions(parsed.stateBorders, { factionCount: 2 });
    expect(factions.length).toBeLessThanOrEqual(2);
  });

  test('output never exceeds factionCount', () => {
    [2, 3, 8].forEach((count) => {
      const factions = overlay.generateFactions(parsed.stateBorders, { factionCount: count });
      expect(factions.length).toBeLessThanOrEqual(count);
    });
  });

  test('Pirate Brethren faction is always present', () => {
    const factions = overlay.generateFactions(parsed.stateBorders, {});
    const pirate = factions.find((f) => f.archetype === 'pirate_brethren');
    expect(pirate).toBeDefined();
  });

  test('homeSettlementId for state_1 is burg_1 (capitalBurgId from fixture)', () => {
    const factions = overlay.generateFactions(parsed.stateBorders, {});
    const state1 = factions.find((f) => f.id === 'state_1');
    expect(state1.homeSettlementId).toBe('burg_1');
  });

  test('homeSettlementId for state_2 is null (no capital in fixture)', () => {
    const factions = overlay.generateFactions(parsed.stateBorders, {});
    const state2 = factions.find((f) => f.id === 'state_2');
    expect(state2.homeSettlementId).toBeNull();
  });

  test('state faction id matches parentFaction on classified settlements', () => {
    const factions = overlay.generateFactions(parsed.stateBorders, {});
    const settlements = overlay.classifySettlements(parsed.burgs, parsed.stateBorders, {});
    const factionIds = factions.map((f) => f.id);
    settlements
      .filter((s) => s.parentFaction !== null)
      .forEach((s) => {
        expect(factionIds).toContain(s.parentFaction);
      });
  });

  test('is deterministic — same input produces same output', () => {
    const a = overlay.generateFactions(parsed.stateBorders, { era: 'caribbean_golden_age' });
    const b = overlay.generateFactions(parsed.stateBorders, { era: 'caribbean_golden_age' });
    expect(a).toEqual(b);
  });

  test('unknown era slug falls back gracefully — no throw, pirate brethren present', () => {
    let factions;
    expect(() => {
      factions = overlay.generateFactions(parsed.stateBorders, { era: 'totally_unknown_era' });
    }).not.toThrow();
    expect(factions.find((f) => f.archetype === 'pirate_brethren')).toBeDefined();
  });
});

describe('applyOverlay — split density keys', () => {
  let parsed;

  beforeEach(() => {
    parsed = importer.parseAzgaarJson(azgaarJsonSample());
  });

  test('settlementDensity controls hidden cove count independently of hazardDensity', () => {
    const sparse = overlay.applyOverlay(parsed, { settlementDensity: 'sparse', hazardDensity: 'dense' });
    const dense = overlay.applyOverlay(parsed, { settlementDensity: 'dense', hazardDensity: 'dense' });
    const sparseCoves = sparse.settlements.filter((s) => s.type === 'hidden_cove').length;
    const denseCoves = dense.settlements.filter((s) => s.type === 'hidden_cove').length;
    expect(sparseCoves).toBeLessThan(denseCoves);
  });

  test('hazardDensity controls reef count independently of settlementDensity', () => {
    const sparse = overlay.applyOverlay(parsed, { settlementDensity: 'dense', hazardDensity: 'sparse' });
    const dense = overlay.applyOverlay(parsed, { settlementDensity: 'dense', hazardDensity: 'dense' });
    const sparseReefs = sparse.hazards.filter((h) => h.type === 'reef').length;
    const denseReefs = dense.hazards.filter((h) => h.type === 'reef').length;
    expect(sparseReefs).toBeLessThan(denseReefs);
  });

  test('dense settlementDensity + sparse hazardDensity gives more coves than reefs', () => {
    const world = overlay.applyOverlay(parsed, { settlementDensity: 'dense', hazardDensity: 'sparse' });
    const coves = world.settlements.filter((s) => s.type === 'hidden_cove').length;
    const reefs = world.hazards.filter((h) => h.type === 'reef').length;
    expect(coves).toBeGreaterThan(reefs);
  });

  test('falls back to opts.density when split keys are absent', () => {
    const sparse = overlay.applyOverlay(parsed, { density: 'sparse' });
    const dense = overlay.applyOverlay(parsed, { density: 'dense' });
    const sparseCoves = sparse.settlements.filter((s) => s.type === 'hidden_cove').length;
    const denseCoves = dense.settlements.filter((s) => s.type === 'hidden_cove').length;
    expect(sparseCoves).toBeLessThan(denseCoves);
  });
});
