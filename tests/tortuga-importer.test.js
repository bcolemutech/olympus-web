const path = require('path');
const importer = require(path.join(
  __dirname,
  '..',
  'public',
  'apps',
  'tortuga',
  'cartographer',
  'importer.js'
));
const { azgaarJsonSample } = require('./fixtures/azgaar-json-sample.js');

describe('Tortuga importer — parseAzgaarJson', () => {
  test('rejects a clearly non-Azgaar payload', () => {
    expect(() => importer.parseAzgaarJson({ type: 'FeatureCollection', features: [] })).toThrow(
      /Not an Azgaar JSON export/
    );
  });

  test('rejects Azgaar JSON missing dimensions', () => {
    const sample = azgaarJsonSample();
    sample.info.width = 0;
    expect(() => importer.parseAzgaarJson(sample)).toThrow(/missing map dimensions/);
  });

  test('rejects Azgaar JSON with no real burgs', () => {
    const sample = azgaarJsonSample();
    sample.pack.burgs = [0]; // only the blank slot
    expect(() => importer.parseAzgaarJson(sample)).toThrow(/no burgs/);
  });

  test('extracts info, bounds, and dimensions', () => {
    const result = importer.parseAzgaarJson(azgaarJsonSample());
    expect(result.sourceFormat).toBe('azgaar-json');
    expect(result.info).toMatchObject({
      name: 'TestIsle',
      seed: '12345',
      version: '1.122.7',
      width: 1000,
      height: 800,
    });
    expect(result.bounds).toEqual([
      [0, 0],
      [800, 1000],
    ]);
    expect(result.dimensions).toEqual({ width: 1000, height: 800 });
  });

  test('coastlines come from island features, dereferenced to [y, x]', () => {
    const result = importer.parseAzgaarJson(azgaarJsonSample());
    // Two islands in the fixture: continent (vertices 1,2,3) and isle (7,8,9)
    expect(result.coastlines).toHaveLength(2);
    // Continent first; verify vertex deref + [x,y] → [y,x] swap
    expect(result.coastlines[0]).toEqual([
      [100, 100], // v1 was [100, 100], swap gives [100, 100] (square coord)
      [100, 200], // v2 was [200, 100] → [100, 200]
      [200, 150], // v3 was [150, 200] → [200, 150]
    ]);
  });

  test('lakes are captured separately from coastlines, with names', () => {
    const result = importer.parseAzgaarJson(azgaarJsonSample());
    expect(result.lakes).toHaveLength(1);
    expect(result.lakes[0].name).toBe('Mirror Lake');
    expect(result.lakes[0].polygon).toEqual([
      [500, 500], // v4: [500, 500]
      [500, 600], // v5: [600, 500] → [500, 600]
      [600, 550], // v6: [550, 600] → [600, 550]
    ]);
  });

  test('burgs skip the blank slot, preserve isPort/isCapital, and use [y, x] position', () => {
    const result = importer.parseAzgaarJson(azgaarJsonSample());
    expect(result.burgs).toHaveLength(3);

    const portRoyal = result.burgs.find((b) => b.id === 'burg_1');
    expect(portRoyal).toMatchObject({
      id: 'burg_1',
      name: 'Port Royal',
      pos: [150, 150],
      stateId: 1,
      isPort: true,
      isCapital: true,
      group: 'capital',
      type: 'Naval',
    });

    const highmount = result.burgs.find((b) => b.id === 'burg_2');
    expect(highmount.isPort).toBe(false);
    expect(highmount.isCapital).toBe(false);

    const smugglers = result.burgs.find((b) => b.id === 'burg_3');
    expect(smugglers.stateId).toBe(0); // wild/neutral
    expect(smugglers.isPort).toBe(true);
  });

  test('stateBorders skip Neutrals (i=0) and handle missing capital', () => {
    const result = importer.parseAzgaarJson(azgaarJsonSample());
    expect(result.stateBorders).toHaveLength(2);

    const albion = result.stateBorders.find((s) => s.id === 'state_1');
    expect(albion).toMatchObject({
      name: 'Albion',
      fullName: 'Kingdom of Albion',
      color: '#cc4400',
      capitalBurgId: 'burg_1',
    });

    const castile = result.stateBorders.find((s) => s.id === 'state_2');
    expect(castile.capitalBurgId).toBeNull();
  });

  test('biomes catalog maps parallel name/color arrays', () => {
    const result = importer.parseAzgaarJson(azgaarJsonSample());
    expect(result.biomes).toHaveLength(4);
    expect(result.biomes[0]).toEqual({ id: 0, name: 'Marine', color: '#466eab' });
    expect(result.biomes[3]).toEqual({ id: 3, name: 'Tropical forest', color: '#b6d95d' });
  });
});

describe('Tortuga importer — land/water ratio', () => {
  test('ocean-dominant map has low landPercentage', () => {
    // Fixture: ocean=100 cells, islands=10+2=12 cells → ~10%
    const result = importer.parseAzgaarJson(azgaarJsonSample());
    expect(result.landPercentage).toBeLessThan(20);
  });

  test('land-heavy map has landPercentage above 60', () => {
    const sample = azgaarJsonSample();
    // Shrink ocean, grow continent island
    sample.pack.features[1].cells = 10; // ocean
    sample.pack.features[2].cells = 200; // continent island
    const result = importer.parseAzgaarJson(sample);
    expect(result.landPercentage).toBeGreaterThan(60);
  });

  test('landPercentage is 0 when no cells on any feature', () => {
    const sample = azgaarJsonSample();
    sample.pack.features.forEach((f) => {
      if (f && typeof f.cells !== 'undefined') f.cells = 0;
    });
    const result = importer.parseAzgaarJson(sample);
    expect(result.landPercentage).toBe(0);
  });
});

// Opt-in: parse a real Azgaar export when present locally (gitignored, 5MB+).
// Drop any *.json file under tests/fixtures/ to enable this branch.
describe('Tortuga importer — real Azgaar fixtures (opt-in)', () => {
  const fs = require('fs');
  const fixturesDir = path.join(__dirname, 'fixtures');
  const realFixtures = fs.existsSync(fixturesDir)
    ? fs.readdirSync(fixturesDir).filter((f) => f.toLowerCase().endsWith('.json'))
    : [];

  if (realFixtures.length === 0) {
    test.skip('no real Azgaar JSON fixtures present — skipping', () => {});
    return;
  }

  realFixtures.forEach((filename) => {
    test(`parses ${filename} without throwing and finds burgs/states/coastlines`, () => {
      const json = JSON.parse(fs.readFileSync(path.join(fixturesDir, filename), 'utf8'));
      const parsed = importer.parseAzgaarJson(json);
      expect(parsed.burgs.length).toBeGreaterThan(0);
      expect(parsed.stateBorders.length).toBeGreaterThan(0);
      expect(parsed.coastlines.length).toBeGreaterThan(0);
      const preview = importer.toPreviewWorld(parsed);
      expect(preview.settlements.length).toBe(parsed.burgs.length);
    });
  });
});

describe('Tortuga importer — toPreviewWorld', () => {
  test('builds a renderer-compatible world with settlements + lake hazards', () => {
    const parsed = importer.parseAzgaarJson(azgaarJsonSample());
    const preview = importer.toPreviewWorld(parsed);

    expect(preview.bounds).toEqual(parsed.bounds);
    expect(preview.coastlines).toBe(parsed.coastlines);
    expect(preview.settlements).toHaveLength(3);

    const portRoyal = preview.settlements.find((s) => s.id === 'burg_1');
    expect(portRoyal.type).toBe('port');
    expect(portRoyal.faction).toBe('state_1');
    expect(portRoyal.factionColor).toBe('#cc4400');

    const wildBurg = preview.settlements.find((s) => s.id === 'burg_3');
    expect(wildBurg.faction).toBeNull();
    expect(wildBurg.factionColor).toBeNull();

    expect(preview.hazards).toHaveLength(1);
    expect(preview.hazards[0]).toMatchObject({ name: 'Mirror Lake', type: 'lake' });
  });
});
