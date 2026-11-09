'use strict';

/**
 * Art sets (planning/game-art.md §4.3, AR3, AR7, EN1, EN2; L-944 / #798),
 * pure:
 *
 *   - every set the Loom serves has the server's copy of its manifest, with
 *     the same bytes, and each registers without problems;
 *   - a manifest is read: a material's picture, span, variants and face, an
 *     object's standing picture with its foot, from a file or an atlas
 *     frame; anything it lacks falls back to the built-in SVG;
 *   - an object's own art and its world's still come first;
 *   - a manifest that's wrong is refused, saying why;
 *   - a world's set: its own, else classic; one there isn't falls back to
 *     classic with a warning; and loomGetMap's view sends it;
 *   - classic, the first set (L-946 / #800): every material, catalog object
 *     and decor kind has its own picture there, so nothing falls back to
 *     the built-in SVG;
 *   - the size budget: every set the Loom serves is within it, the tests'
 *     fixtures too, and an oversized picture fails it; WebP and PNG sizes
 *     are read from their headers.
 *
 * Run: cd tests && npx jest loom-art-sets
 */

const fs = require('fs');
const path = require('path');
const catalog = require('../functions/loom-canon/materials');
const artSets = require('../functions/loom-canon/art-sets');
const budget = require('../scripts/art/budget.cjs');

const PUBLIC_SETS = path.join(__dirname, '../public/apps/loom/art/sets');
const SERVER_SETS = path.join(__dirname, '../functions/loom-canon/art-sets');
const FIXTURES = path.join(__dirname, 'fixtures/art-sets');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('the sets the Loom serves', () => {
  const published = fs.readdirSync(PUBLIC_SETS).filter((d) => !d.startsWith('.'));

  test('classic is there, and the default', () => {
    expect(published).toContain('classic');
    expect(catalog.DEFAULT_SET).toBe('classic');
    expect(artSets.DEFAULT_SET).toBe('classic');
  });

  test('each has the server’s copy of its manifest, byte for byte, and no other', () => {
    const copies = fs
      .readdirSync(SERVER_SETS)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
    expect(copies.sort()).toEqual(published.slice().sort());
    published.forEach((name) => {
      const own = fs.readFileSync(path.join(PUBLIC_SETS, name, 'manifest.json'));
      expect(fs.readFileSync(path.join(SERVER_SETS, `${name}.json`)).equals(own)).toBe(true);
      expect(read(path.join(PUBLIC_SETS, name, 'manifest.json')).name).toBe(name);
    });
  });

  test('each registers without problems and is within the size budget', () => {
    published.forEach((name) => {
      const manifest = read(path.join(PUBLIC_SETS, name, 'manifest.json'));
      expect(catalog.checkManifest(manifest)).toEqual([]);
      expect(budget.checkSet(path.join(PUBLIC_SETS, name)).problems).toEqual([]);
    });
    expect(Object.keys(artSets.SETS).sort()).toEqual(published.slice().sort());
  });
});

describe('classic, the first set (L-946)', () => {
  const cases = [];
  catalog.KINDS.forEach((kind) =>
    catalog.materialsOf(kind).forEach((m) => cases.push([kind, m.id]))
  );

  test('there are materials of every kind to check', () => {
    expect(cases.length).toBeGreaterThan(60);
  });

  test.each(cases)('%s %s has its own picture in classic', (kind, id) => {
    const art = catalog.materialArt(kind, id, 'classic');
    if (kind === 'door' || kind === 'window') {
      // A painted front over the leaf or the opening.
      expect(art.face).toBeTruthy();
    } else {
      expect(art.from).toBe('set');
      // A wall's face rising from its foot, as well as its top.
      if (kind === 'wall') expect(art.face).toBeTruthy();
    }
  });

  test.each(catalog.OBJECT_KINDS.map((k) => [k.id, k.decor ? 'decor' : 'object']))(
    '%s (%s) stands in classic, on its foot',
    (id) => {
      const stand = catalog.standFor({ kind: id }, null, 'classic');
      expect(stand).not.toBeNull();
      expect(stand.foot).toEqual([0.5, 1]);
      expect(stand.picture.atlas || stand.picture.url).toMatch(
        /\/apps\/loom\/art\/sets\/classic\//
      );
    }
  );
});

describe('a manifest, read', () => {
  const files = read(path.join(FIXTURES, 'files/manifest.json'));
  const atlas = read(path.join(FIXTURES, 'atlas/manifest.json'));

  beforeAll(() => {
    expect(catalog.registerSet(files)).toEqual([]);
    expect(catalog.registerSet(atlas, '/somewhere/atlas/')).toEqual([]);
  });

  test('a material’s picture and span from its set, its face; what it lacks, the SVG', () => {
    expect(catalog.materialArt('ground', 'flagstone', 'fixture-files')).toEqual({
      from: 'set',
      picture: { url: '/apps/loom/art/sets/fixture-files/ground/flagstone.webp' },
      span: 1,
      variants: [],
    });
    // The stone wall: the set paints its face, not its top.
    expect(catalog.materialArt('wall', 'stone', 'fixture-files')).toEqual({
      from: 'catalog',
      picture: { url: '/apps/loom/art/materials/wall-stone.svg' },
      span: 1,
      variants: [],
      face: { url: '/apps/loom/art/sets/fixture-files/walls/stone-face.webp' },
    });
    // A material the set doesn't name, and no set at all: the built-in SVG.
    for (const set of ['fixture-files', null, undefined, 'no-such-set']) {
      expect(catalog.materialArt('ground', 'grass', set)).toEqual({
        from: 'catalog',
        picture: { url: '/apps/loom/art/materials/ground-grass.svg' },
        span: 1,
        variants: [],
      });
    }
  });

  test('a frame of an atlas, served from the set’s folder', () => {
    const face = catalog.materialArt('wall', 'stone', 'fixture-atlas').face;
    expect(face).toEqual({ atlas: '/somewhere/atlas/atlas/sheet-0.webp', frame: [2, 2, 256, 256] });
    const up = catalog.standFor({ kind: 'pillar' }, null, 'fixture-atlas');
    expect(up.picture.atlas).toBe('/somewhere/atlas/atlas/sheet-0.webp');
    expect(up.picture.frame).toEqual([260, 2, 40, 160]);
    expect(up.foot).toEqual([0.5, 0.95]);
  });

  test('an object stands as its set says, on its foot; else it lies flat', () => {
    expect(catalog.standFor({ kind: 'chest' }, null, 'fixture-files')).toEqual({
      picture: { url: '/apps/loom/art/sets/fixture-files/objects/chest.webp' },
      foot: [0.5, 1],
    });
    expect(catalog.standFor({ kind: 'barrel' }, null, 'fixture-files')).toBeNull();
    // A kind the set has no picture for lies flat (classic has them all, L-946).
    expect(catalog.standFor({ kind: 'nothing-there' }, null, 'classic')).toBeNull();
    expect(catalog.standFor({ kind: 'nothing-there' })).toBeNull();
  });

  test('an object’s own art, and its world’s, still come first', () => {
    const own = { imageId: 'img_0123456789abcdef', link: 'https://x/own.png' };
    expect(catalog.standFor({ kind: 'chest', art: own }, null, 'fixture-files')).toBeNull();
    expect(
      catalog.standFor(
        { kind: 'chest' },
        { chest: { art: { link: 'https://x/k.png' } } },
        'fixture-files'
      )
    ).toBeNull();
    expect(catalog.artFor({ kind: 'chest', art: own }, null, 'fixture-files').from).toBe('object');
    // Seen from above the set paints no chest: the catalog's.
    expect(catalog.artFor({ kind: 'chest' }, null, 'fixture-files')).toMatchObject({
      from: 'catalog',
      file: 'objects/chest.svg',
    });
  });

  test('a set that paints an object from above draws it with that', () => {
    expect(
      catalog.registerSet({
        name: 'flat-props',
        objects: { barrel: { file: 'barrel.webp' } },
      })
    ).toEqual([]);
    expect(catalog.artFor({ kind: 'barrel' }, null, 'flat-props')).toEqual({
      from: 'set',
      picture: { url: '/apps/loom/art/sets/flat-props/barrel.webp' },
    });
  });

  test('variants are read, up to three', () => {
    expect(
      catalog.registerSet({
        name: 'varied',
        materials: {
          'ground/stone': {
            file: 'a.webp',
            span: 5,
            variants: [{ file: 'b.webp' }, { file: 'c.webp' }],
          },
        },
      })
    ).toEqual([]);
    const art = catalog.materialArt('ground', 'stone', 'varied');
    expect(art.span).toBe(5);
    expect(art.variants).toEqual([
      { url: '/apps/loom/art/sets/varied/b.webp' },
      { url: '/apps/loom/art/sets/varied/c.webp' },
    ]);
  });
});

describe('a manifest that’s wrong', () => {
  const problems = (m) => catalog.checkManifest(m);

  test('is refused, saying why', () => {
    expect(problems({ name: 'Bad Name' })).toEqual([
      'Its name is lower-case letters, digits and -, up to 40.',
    ]);
    expect(problems({ name: 'x', materials: { 'ground/velvet': { file: 'v.webp' } } })[0]).toMatch(
      /no built-in material/
    );
    expect(problems({ name: 'x', objects: { 'ship-wheel': { file: 'w.webp' } } })[0]).toMatch(
      /no built-in object/
    );
    expect(
      problems({
        name: 'x',
        objects: { chest: { stand: { atlas: 'gone', frame: [0, 0, 1, 1] } } },
      })[0]
    ).toMatch(/atlas "gone"/);
    expect(
      problems({
        name: 'x',
        atlases: { a: { file: 'a.webp', width: 100, height: 100 } },
        objects: { chest: { stand: { atlas: 'a', frame: [90, 0, 20, 20] } } },
      })[0]
    ).toMatch(/outside atlas "a"/);
    expect(
      problems({ name: 'x', objects: { chest: { stand: { file: 'c.webp', foot: [2, 1] } } } })[0]
    ).toMatch(/foot/);
    expect(
      problems({ name: 'x', materials: { 'ground/stone': { file: 'a.webp', span: 0 } } })[0]
    ).toMatch(/span/);
    expect(
      problems({
        name: 'x',
        materials: { 'ground/stone': { file: 'a.webp', variants: [1, 2, 3, 4] } },
      })[0]
    ).toMatch(/up to three/);
    expect(
      problems({ name: 'x', materials: { 'wall/stone': { face: { nothing: 1 } } } })[0]
    ).toMatch(/picture/);
    // And isn't registered.
    expect(catalog.registerSet({ name: 'broken', objects: { nope: { file: 'x' } } })).not.toEqual(
      []
    );
    expect(catalog.setOf('broken')).toBeNull();
  });
});

describe('a world’s set', () => {
  test('its own, else classic; one there isn’t falls back to classic with a warning', () => {
    expect(artSets.setFor({})).toEqual({ name: 'classic' });
    expect(artSets.setFor(null)).toEqual({ name: 'classic' });
    expect(artSets.setFor({ art: { set: 'classic' } })).toEqual({ name: 'classic' });
    const missing = artSets.setFor({ art: { set: 'velvet' } });
    expect(missing.name).toBe('classic');
    expect(missing.warning).toMatch(/"velvet".*"classic"/);
  });

  test('listSets says how much each paints', () => {
    const classic = artSets.listSets().find((s) => s.name === 'classic');
    expect(classic).toMatchObject({ name: 'classic', title: 'Classic', default: true });
    expect(artSets.countsOf(read(path.join(FIXTURES, 'atlas/manifest.json')))).toEqual({
      materials: 1,
      faces: 1,
      variants: 0,
      standing: 2,
      fromAbove: 0,
      atlases: 1,
    });
  });
});

describe('the size budget', () => {
  test('a picture’s size is read from its header, WebP or PNG', () => {
    expect(budget.sizeOf(path.join(FIXTURES, 'files/objects/chest.webp'))).toEqual({
      format: 'webp',
      width: 96,
      height: 80,
    });
    expect(budget.sizeOf(path.join(FIXTURES, 'atlas/atlas/sheet-0.webp'))).toMatchObject({
      format: 'webp',
      width: 400,
      height: 260,
    });
    expect(budget.sizeOf(path.join(__dirname, 'fixtures/paint/dungeon.png'))).toMatchObject({
      format: 'png',
    });
  });

  test('each role’s limits', () => {
    expect(budget.roleLimits('ground', { span: 5 })).toMatchObject({ width: 1024, height: 1024 });
    expect(budget.roleLimits('ground', { span: 1 }).width).toBe(205);
    expect(budget.roleLimits('object', { size: [3, 2] }).width).toBe(192); // 64 px a foot
    expect(budget.roleLimits('face')).toMatchObject({ height: 512 });
    expect(budget.roleLimits('atlas')).toMatchObject({ width: 2048, height: 2048 });
  });

  test('the fixtures’ sets are within it', () => {
    expect(budget.checkSet(path.join(FIXTURES, 'files')).problems).toEqual([]);
    expect(budget.checkSet(path.join(FIXTURES, 'atlas')).problems).toEqual([]);
  });

  test('an oversized picture fails it', () => {
    const result = budget.checkSet(path.join(FIXTURES, 'oversized'));
    expect(result.problems).toEqual([
      'materials "ground/flagstone" (ground/flagstone.webp) is 2048 × 2048 px, over its 1024 × 1024 px.',
    ]);
  });

  test('a picture that isn’t there, or isn’t WebP, fails it', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'art-set-'));
    fs.copyFileSync(
      path.join(__dirname, 'fixtures/paint/dungeon.png'),
      path.join(dir, 'floor.png')
    );
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        name: 'png-set',
        materials: {
          'ground/stone': { file: 'floor.png', span: 5 },
          'ground/dirt': { file: 'gone.webp', span: 5 },
        },
      })
    );
    const { problems } = budget.checkSet(dir);
    expect(problems.some((p) => /floor\.png isn't WebP/.test(p))).toBe(true);
    expect(problems.some((p) => /gone\.webp isn't there/.test(p))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('loomGetMap', () => {
  const { mapView } = require('../functions/loom-turn/map-view');
  const { COAST } = require('./helpers/coast');
  const { BUILT_IN } = require('../functions/loom-canon/systems');
  const sheets = require('../functions/loom-canon/sheets');
  const system = BUILT_IN['d20-fantasy'];
  const save = {
    location: 'widows-reach',
    character: { name: 'Tam', sheet: sheets.defaultSheet(system) },
  };

  test('sends the world’s set, classic unless it names one there is', () => {
    const view = (art) => mapView({ ...COAST, system, ...(art ? { art } : {}) }, save, null, null);
    expect(view(null).artSet).toBe('classic');
    expect(view({ set: 'velvet' }).artSet).toBe('classic');
    const fixture = read(path.join(FIXTURES, 'files/manifest.json'));
    artSets.SETS[fixture.name] = fixture;
    try {
      const own = view({ set: 'fixture-files' });
      expect(own.artSet).toBe('fixture-files');
      // On each level's data the drawers read.
      if (own.town) expect(own.town.artSet).toBe('fixture-files');
      if (own.battleMap) expect(own.battleMap.artSet).toBe('fixture-files');
    } finally {
      delete artSets.SETS[fixture.name];
    }
  });
});
