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
    expect(world).toHaveProperty('tradeRoutes');
    expect(world).toHaveProperty('factionTerritory');
    expect(world).toHaveProperty('windCurrentZones');
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
});
