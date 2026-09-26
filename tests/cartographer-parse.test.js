'use strict';

/**
 * Cartographer — Azgaar "Save as JSON" parser and validator (C-2 / #369).
 *
 * Runs against the committed Nisia fixture (a real Azgaar 1.153.1 export,
 * slimmed by tests/fixtures/azgaar/slim-export.js), plus variants of it with
 * specific defects. Pure unit tests: no emulators.
 *
 * Run: cd tests && npx jest cartographer-parse --verbose
 */

const fs = require('fs');
const path = require('path');
const {
  parseAzgaarExport,
  AzgaarFormatError,
  LIMITS,
  TESTED_VERSION,
} = require('../functions/cartographer/parse');

const FIXTURE_PATH = path.join(__dirname, 'fixtures/azgaar/nisia.json');
const RAW = fs.readFileSync(FIXTURE_PATH);
const nisia = () => JSON.parse(RAW.toString('utf8')); // a fresh, mutable copy

function expectFormatError(fn, code) {
  let error;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(AzgaarFormatError);
  expect(error.code).toBe(code);
  expect(error.message.length).toBeGreaterThan(10);
  return error;
}

const codes = (parsed) => parsed.warnings.map((w) => w.code);

describe('parsing the Nisia export', () => {
  const map = parseAzgaarExport(RAW);

  test('reads the source info and scale', () => {
    expect(map.source).toEqual({
      format: 'azgaar-json',
      version: '1.153.1',
      seed: '971821553',
      mapName: 'Nisia',
      exportedAt: '2026-09-26T11:54:47.532Z',
      width: 1718,
      height: 1270,
    });
    expect(map.scale).toEqual({
      populationRate: 1000,
      urbanization: 1,
      distanceUnit: 'mi',
      distanceScale: 2,
    });
  });

  test('keeps every real entity and skips Azgaar placeholders', () => {
    expect({
      settlements: map.settlements.length,
      states: map.states.length,
      provinces: map.provinces.length,
      routes: map.routes.length,
      markers: map.markers.length,
      biomes: map.biomes.length,
      features: map.features.length,
    }).toEqual({
      settlements: 663,
      states: 23,
      provinces: 145,
      routes: 530,
      markers: 56,
      biomes: 13,
      features: 7,
    });
    expect(map.settlements.some((s) => s.id === 0)).toBe(false);
    expect(map.states.some((s) => s.name === 'Neutrals')).toBe(false);
  });

  test('a clean real export produces no warnings', () => {
    expect(map.warnings).toEqual([]);
  });

  test('settlements resolve province, biome and landmass from their cell, with population in people', () => {
    expect(map.settlements[0]).toEqual({
      id: 1,
      name: 'Burdendal',
      x: 922.31,
      y: 869.84,
      cellId: 2093,
      featureId: 2,
      stateId: 1,
      provinceId: 1,
      biomeId: 8,
      population: 28473,
      port: true,
      capital: true,
      type: 'Naval',
      group: 'capital',
    });
    expect(map.settlements.filter((s) => s.port)).toHaveLength(148);
    expect(map.settlements.filter((s) => s.capital)).toHaveLength(23);
    // One settlement sits on its own one-cell island (feature 3).
    expect(map.settlements.filter((s) => s.featureId === 3)).toHaveLength(1);
  });

  test('states carry relations from the diplomacy table, without self or Neutrals', () => {
    const pendonia = map.states.find((s) => s.id === 1);
    expect(pendonia).toMatchObject({
      name: 'Pendonia',
      fullName: 'Kingdom of Pendonia',
      form: 'Monarchy',
      formName: 'Kingdom',
      capitalSettlementId: 1,
    });
    expect(pendonia.relations['2']).toBe('suspicion');
    expect(pendonia.relations['3']).toBe('unknown');
    expect(pendonia.relations).not.toHaveProperty('0');
    expect(pendonia.relations).not.toHaveProperty('1');
    expect(Object.keys(pendonia.relations)).toHaveLength(22);

    const all = map.states.flatMap((s) => Object.values(s.relations));
    expect(new Set(all)).toEqual(
      new Set([
        'ally',
        'friendly',
        'neutral',
        'suspicion',
        'enemy',
        'rival',
        'vassal',
        'suzerain',
        'unknown',
      ])
    );
  });

  test('provinces keep their state and capital settlement', () => {
    const province = map.provinces[0];
    expect(province).toMatchObject({ id: 1 });
    expect(map.states.some((s) => s.id === province.stateId)).toBe(true);
    expect(
      map.provinces.every(
        (p) =>
          p.capitalSettlementId === null ||
          map.settlements.some((s) => s.id === p.capitalSettlementId)
      )
    ).toBe(true);
  });

  test('routes become kinds plus cell paths', () => {
    const kinds = map.routes.reduce((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] || 0) + 1 }), {});
    expect(kinds).toEqual({ trail: 381, sea: 122, road: 27 });
    expect(map.routes.every((r) => r.cellIds.length >= 2)).toBe(true);
  });

  test('markers become points of interest, linked to a settlement when they sit on one', () => {
    expect(map.markers[0]).toMatchObject({
      id: 0,
      type: 'water-sources',
      icon: '💧',
      name: 'Manden Purifying Well',
      cellId: 1152,
    });
    expect(map.markers[0].note).toMatch(/^This legendary water source/);
    expect(map.markers.filter((m) => m.settlementId !== null)).toHaveLength(39);
    const waterTypes = new Set(map.features.filter((f) => f.type !== 'island').map((f) => f.id));
    expect(map.markers.filter((m) => waterTypes.has(m.featureId))).toHaveLength(4);
  });

  test('accepts a string or an already-parsed object, with identical results', () => {
    expect(parseAzgaarExport(RAW.toString('utf8'))).toEqual(map);
    expect(parseAzgaarExport(nisia())).toEqual(map);
  });

  test('never mutates its input', () => {
    const input = nisia();
    const before = JSON.stringify(input);
    parseAzgaarExport(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('rejecting what is not a usable Azgaar JSON export', () => {
  test('not JSON at all (for example an Azgaar .map file)', () => {
    const error = expectFormatError(
      () => parseAzgaarExport(Buffer.from('1.153.1|Nisia|971821553|...pipe separated...')),
      'not_json'
    );
    expect(error.message).toMatch(/Save as JSON/);
  });

  test('a GeoJSON export', () => {
    expectFormatError(
      () => parseAzgaarExport({ type: 'FeatureCollection', features: [] }),
      'geojson'
    );
  });

  test.each([
    ['an array', []],
    ['null', null],
    ['an unrelated object', { hello: 'world' }],
    ['info without a pack', { info: { width: 10, height: 10 } }],
  ])('%s', (_label, input) => {
    expectFormatError(() => parseAzgaarExport(input), 'not_azgaar');
  });

  test.each(['cells', 'burgs', 'states'])('an export missing pack.%s', (key) => {
    const doc = nisia();
    delete doc.pack[key];
    expectFormatError(() => parseAzgaarExport(doc), 'not_azgaar');
  });

  test.each([
    ['zero width', { width: 0 }],
    ['missing height', { height: undefined }],
    ['non-numeric width', { width: '1718' }],
  ])('invalid dimensions: %s', (_label, change) => {
    const doc = nisia();
    Object.assign(doc.info, change);
    expectFormatError(() => parseAzgaarExport(doc), 'invalid_dimensions');
  });

  test('a map with no real settlements', () => {
    const doc = nisia();
    doc.pack.burgs = [{}, { i: 1, name: 'Gone', removed: true, cell: 1, x: 1, y: 1 }];
    expectFormatError(() => parseAzgaarExport(doc), 'no_settlements');
  });

  test('a file over the size limit is refused before parsing', () => {
    const error = expectFormatError(() => parseAzgaarExport(RAW, { maxBytes: 1000 }), 'too_large');
    expect(error.message).toMatch(/limit/);
  });

  test('more settlements than the limit', () => {
    const doc = nisia();
    doc.pack.burgs = Array.from({ length: LIMITS.settlements + 1 }, () => null);
    expectFormatError(() => parseAzgaarExport(doc), 'too_many');
  });
});

describe('recoverable problems become warnings, with fallbacks', () => {
  test('no routes (older Azgaar) → warning; connections are left to the mapper', () => {
    const doc = nisia();
    delete doc.pack.routes;
    const map = parseAzgaarExport(doc);
    expect(map.routes).toEqual([]);
    expect(codes(map)).toContain('routes_missing');
  });

  test('biomes from an older top-level biomesData', () => {
    const doc = nisia();
    const biomes = doc.pack.biomes;
    delete doc.pack.biomes;
    doc.biomesData = { name: biomes.map((b) => b.name), color: biomes.map((b) => b.color) };
    const map = parseAzgaarExport(doc);
    expect(map.biomes).toEqual(parseAzgaarExport(RAW).biomes);
    expect(codes(map)).not.toContain('biomes_missing');
  });

  test('no biomes at all → warning and null biome ids', () => {
    const doc = nisia();
    delete doc.pack.biomes;
    const map = parseAzgaarExport(doc);
    expect(codes(map)).toContain('biomes_missing');
    expect(map.settlements.every((s) => s.biomeId === null)).toBe(true);
  });

  test('removed entities are skipped silently', () => {
    const doc = nisia();
    doc.pack.burgs[5].removed = true;
    doc.pack.states[23].removed = true;
    const map = parseAzgaarExport(doc);
    expect(map.settlements).toHaveLength(662);
    expect(map.states).toHaveLength(22);
    // Relations and settlement ownership never point at the removed state.
    expect(map.states.some((s) => '23' in s.relations)).toBe(false);
    expect(map.settlements.some((s) => s.stateId === 23)).toBe(false);
  });

  test('settlements with an invalid cell or position are skipped with one aggregated warning', () => {
    const doc = nisia();
    doc.pack.burgs[1].cell = 999999;
    doc.pack.burgs[2].x = 'nowhere';
    const map = parseAzgaarExport(doc);
    expect(map.settlements).toHaveLength(661);
    expect(map.warnings.find((w) => w.code === 'settlement_invalid').count).toBe(2);
  });

  test('an unrecognized diplomacy value is skipped with a warning', () => {
    const doc = nisia();
    doc.pack.states[1].diplomacy[2] = 'Frenemy';
    const map = parseAzgaarExport(doc);
    expect(map.states[0].relations).not.toHaveProperty('2');
    expect(codes(map)).toContain('relation_unknown');
  });

  test('a state never has a relation with itself, even if the export lists one', () => {
    const doc = nisia();
    doc.pack.states[1].diplomacy[1] = 'Ally'; // malformed: should be 'x'
    expect(parseAzgaarExport(doc).states[0].relations).not.toHaveProperty('1');
  });

  test('an unknown route type is treated as a trail', () => {
    const doc = nisia();
    doc.pack.routes[0].group = 'flyways';
    const map = parseAzgaarExport(doc);
    expect(map.routes[0].kind).toBe('trail');
    expect(codes(map)).toContain('route_kind_unknown');
  });

  test('an older Azgaar version is accepted with a warning', () => {
    const doc = nisia();
    doc.info.version = '1.99.0';
    expect(codes(parseAzgaarExport(doc))).toContain('version_untested');
    doc.info.version = `${TESTED_VERSION.join('.')}.0`;
    expect(codes(parseAzgaarExport(doc))).not.toContain('version_untested');
  });

  test('names and notes are cleaned of control characters and length-limited', () => {
    const doc = nisia();
    doc.pack.burgs[1].name = '  Bur\u0000den\u0007dal\n  ' + 'x'.repeat(200);
    doc.pack.markers[0].note = 'Line one\r\nLine two\u0000' + 'y'.repeat(3000);
    const map = parseAzgaarExport(doc);
    expect(map.settlements[0].name).toMatch(/^Bur den dal x+$/);
    expect(map.settlements[0].name.length).toBeLessThanOrEqual(100);
    expect(map.markers[0].note.startsWith('Line one\nLine two')).toBe(true);
    expect(map.markers[0].note.length).toBeLessThanOrEqual(2000);
  });

  test('a marker without a name is named after its type', () => {
    const doc = nisia();
    doc.pack.markers[0].name = '';
    expect(parseAzgaarExport(doc).markers[0].name).toBe('water sources');
  });
});
