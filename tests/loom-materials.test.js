'use strict';

/**
 * Materials and the object catalog (planning/maps-from-data.md RD1, RD3, OB1;
 * L-925 / #729), pure: every material and catalog object has art in the repo
 * (a test fails if one is missing, and if the folder holds a file nothing
 * names), each file is plain SVG a renderer reads, an unknown material is
 * refused, an object's art comes from its own, its world's kind, the catalog
 * or a box with a question mark, in that order, and the page's copy matches
 * the server's.
 *
 * Run: cd tests && npx jest loom-materials --verbose
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const catalog = require('../functions/loom-canon/materials');
const geo = require('../functions/loom-canon/map-geometry');
const { checkSvg } = require('../functions/cartographer/svg');
const { Resvg } = require(require.resolve('@resvg/resvg-js', { paths: ['../functions'] }));

const ART = path.join(__dirname, '../public/apps/loom/art');
const read = (file) => fs.readFileSync(path.join(ART, file), 'utf8');

describe('the set', () => {
  test('materials are unique by kind and id, of known kinds, with art named by both', () => {
    const seen = new Set();
    for (const m of catalog.MATERIALS) {
      expect(catalog.KINDS).toContain(m.kind);
      const key = `${m.kind}:${m.id}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(m.id).toMatch(/^[a-z][a-z-]*$/);
      expect(m.name).toBeTruthy();
      expect(m.art).toBe(`materials/${m.kind}-${m.id}.svg`);
    }
    for (const kind of catalog.KINDS) expect(catalog.materialsOf(kind).length).toBeGreaterThan(0);
    expect(catalog.materialOf('wall', 'glass')).toMatchObject({ seeThrough: true });
    expect(catalog.materialOf('ground', 'water')).toMatchObject({ water: true });
    expect(catalog.materialOf('wall', 'carpet')).toBeNull();
  });

  test('the catalog’s objects are unique, sized above 0, with art named by their id', () => {
    const ids = new Set();
    for (const k of catalog.OBJECT_KINDS) {
      expect(ids.has(k.id)).toBe(false);
      ids.add(k.id);
      expect(k.id).toMatch(/^[a-z][a-z-]*$/);
      expect(k.size).toHaveLength(2);
      expect(k.size.every((ft) => ft > 0)).toBe(true);
      expect(k.art).toBe(`objects/${k.id}.svg`);
    }
    // What the issue names.
    for (const id of ['chest', 'table', 'chair', 'barrel', 'crate', 'bed', 'altar', 'bookshelf'])
      expect(catalog.objectKind(id)).not.toBeNull();
    for (const id of ['lever', 'statue', 'console']) expect(catalog.objectKind(id)).not.toBeNull();
    expect(catalog.objectKind('nothing')).toBeNull();
  });

  test('the walls, doors and windows the issue names are there', () => {
    const has = (kind, ...ids) =>
      ids.forEach((id) => expect(catalog.materialOf(kind, id)).toBeTruthy());
    has('ground', 'stone', 'flagstone', 'wood', 'dirt', 'grass', 'sand', 'water', 'metal');
    has('wall', 'stone', 'brick', 'wood', 'rock', 'metal', 'hedge');
    has('door', 'wood', 'iron', 'gate', 'glass');
    has('window', 'glass', 'bars', 'shutters');
  });
});

describe('the art is in the repo', () => {
  const files = catalog.artFiles();

  test('every material and catalog object has art, and the box with a question mark', () => {
    expect(files).toContain(catalog.FALLBACK_ART);
    expect(files.length).toBe(catalog.MATERIALS.length + catalog.OBJECT_KINDS.length + 1);
    const missing = files.filter((file) => !fs.existsSync(path.join(ART, file)));
    expect(missing).toEqual([]);
  });

  test('the folder holds nothing the catalog doesn’t name', () => {
    const found = [];
    for (const dir of ['materials', 'objects']) {
      for (const name of fs.readdirSync(path.join(ART, dir))) found.push(`${dir}/${name}`);
    }
    expect(found.sort()).toEqual([...files].sort());
  });

  test('each file is plain SVG, checked as set_art checks it, and a renderer reads it', () => {
    for (const file of files) {
      const text = read(file);
      expect(() => checkSvg(text)).not.toThrow();
      // resvg is strict about XML, which checkSvg isn't.
      const picture = new Resvg(text);
      expect(picture.width).toBeGreaterThan(0);
      expect(picture.height).toBeGreaterThan(0);
    }
  });

  test('tiles and strips have their shapes; an object’s is its size at 16 units to the foot', () => {
    for (const m of catalog.MATERIALS) {
      const picture = new Resvg(read(m.art));
      expect([picture.width, picture.height]).toEqual(m.kind === 'ground' ? [64, 64] : [64, 16]);
    }
    for (const k of catalog.OBJECT_KINDS) {
      const picture = new Resvg(read(k.art));
      expect([picture.width, picture.height]).toEqual([
        Math.round(k.size[0] * 16),
        Math.round(k.size[1] * 16),
      ]);
    }
  });

  test('the art draws something: no tile or picture is blank', () => {
    for (const file of files) {
      const png = new Resvg(read(file)).render();
      const pixels = png.pixels;
      let seen = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) seen += 1;
      expect({ file, drawn: seen > 20 }).toEqual({ file, drawn: true });
    }
  });

  test('ground tiles and strips are opaque or see-through as their materials say', () => {
    const opaque = (file) => {
      const pixels = new Resvg(read(file)).render().pixels;
      let clear = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) clear += 1;
      return clear / (pixels.length / 4);
    };
    // Ground is solid all over, so a floor has no holes.
    for (const m of catalog.materialsOf('ground')) expect(opaque(m.art)).toBe(0);
    // Bars let the floor show between them.
    expect(opaque(catalog.materialOf('wall', 'bars').art)).toBeGreaterThan(0.2);
    // An object is a picture with a clear edge.
    expect(opaque(catalog.objectKind('barrel').art)).toBeGreaterThan(0.1);
  });
});

describe('an unknown material is refused', () => {
  const room = { shape: { rect: { x: 0, y: 0, w: 30, h: 30 } } };

  test('map-geometry takes its materials from the set, kind by kind', () => {
    for (const kind of catalog.KINDS) {
      expect(Object.keys(geo.MATERIALS[kind])).toEqual(catalog.materialsOf(kind).map((m) => m.id));
    }
    for (const m of catalog.MATERIALS) {
      expect(!!geo.MATERIALS[m.kind][m.id].seeThrough).toBe(!!m.seeThrough);
      expect(!!geo.MATERIALS[m.kind][m.id].water).toBe(!!m.water);
    }
  });

  test('every material in the set is accepted for its kind, and none for another', () => {
    const wall = (material) => ({ walls: [{ id: 'w', material, points: 'M0 0 L10 0' }] });
    for (const m of catalog.materialsOf('wall')) expect(geo.check(wall(m.id))).toEqual([]);
    for (const m of catalog.materialsOf('ground')) {
      expect(geo.check({ ground: [{ id: 'g', material: m.id, ...room }] })).toEqual([]);
    }
    // A floor's isn't a wall's (carpet), and the reverse (brick).
    expect(geo.check(wall('carpet'))[0]).toMatch(/unknown material "carpet"/);
    expect(geo.check({ ground: [{ id: 'g', material: 'brick', ...room }] })[0]).toMatch(
      /unknown material "brick"/
    );
  });

  test('a made-up material is refused, naming the ones there are', () => {
    const [reason] = geo.check({ walls: [{ id: 'w', material: 'cheese', points: 'M0 0 L10 0' }] });
    expect(reason).toBe(
      'walls.w has an unknown material "cheese": the wall materials are ' +
        `${catalog
          .materialsOf('wall')
          .map((m) => m.id)
          .join(', ')}.`
    );
    const names = (kind) => catalog.materialsOf(kind).map((m) => m.id);
    expect(
      geo.check({ doors: [{ id: 'd', material: 'mithril', from: [0, 0], to: [4, 0] }] })[0]
    ).toContain(names('door').join(', '));
    expect(
      geo.check({ lines: [{ id: 'l', material: 'lava-flow', points: 'M0 0 L9 9' }] })[0]
    ).toContain(names('line').join(', '));
  });
});

describe('an object’s art', () => {
  const own = {
    imageId: 'img_00000000000000aa',
    link: 'https://x.test/own',
    width: 64,
    height: 64,
  };
  const kindArt = {
    imageId: 'img_00000000000000bb',
    link: 'https://x.test/kind',
    width: 64,
    height: 64,
  };

  test('the object’s own first, then its world’s for its kind, then the catalog’s', () => {
    const world = { chest: { art: kindArt }, 'ship-wheel': { art: kindArt, size: [3, 3] } };
    expect(catalog.artFor({ kind: 'chest', art: own }, world)).toEqual({
      from: 'object',
      ref: own,
    });
    expect(catalog.artFor({ kind: 'chest' }, world)).toEqual({ from: 'world', ref: kindArt });
    expect(catalog.artFor({ kind: 'chest' }, {})).toEqual({
      from: 'catalog',
      file: 'objects/chest.svg',
      url: '/apps/loom/art/objects/chest.svg',
    });
    expect(catalog.artFor({ kind: 'ship-wheel' }, world).from).toBe('world');
    // A kind with no art, in the catalog or the world, is a box with a question mark.
    expect(catalog.artFor({ kind: 'ship-wheel' }, {})).toEqual({
      from: 'unknown',
      file: 'objects/unknown.svg',
      url: '/apps/loom/art/objects/unknown.svg',
    });
    expect(catalog.artFor({ kind: 'ship-wheel' }).from).toBe('unknown');
    expect(catalog.artFor(null).from).toBe('unknown');
  });

  test('a kind’s name and size in a world with no art of its own aren’t art', () => {
    expect(
      catalog.artFor({ kind: 'chest' }, { chest: { name: 'Strongbox', size: [4, 3] } }).from
    ).toBe('catalog');
    // Art that isn't a library image reference is passed over.
    expect(catalog.artFor({ kind: 'chest', art: { link: 'x' } }, {}).from).toBe('catalog');
  });

  test('a default size is the world’s for the kind, else the catalog’s', () => {
    expect(catalog.sizeFor('chest', {})).toEqual([3, 2]);
    expect(catalog.sizeFor('chest', { chest: { size: [4, 3] } })).toEqual([4, 3]);
    expect(catalog.sizeFor('ship-wheel', { 'ship-wheel': { size: [3, 3] } })).toEqual([3, 3]);
    expect(catalog.sizeFor('ship-wheel', {})).toBeNull();
    const size = catalog.sizeFor('chest', {});
    size[0] = 99; // a copy: the catalog is not changed
    expect(catalog.sizeFor('chest', {})).toEqual([3, 2]);
  });
});

describe("the browser's copy", () => {
  const served = path.join(__dirname, '../public/apps/loom/js/materials.js');

  test('is identical to the server’s, and loads as Loom.materials', () => {
    expect(fs.readFileSync(served, 'utf8')).toBe(
      fs.readFileSync(path.join(__dirname, '../functions/loom-canon/materials.js'), 'utf8')
    );
    const page = { window: { Loom: {} } };
    vm.runInNewContext(fs.readFileSync(served, 'utf8'), page);
    expect(page.window.Loom.materials.MATERIALS).toHaveLength(catalog.MATERIALS.length);
    expect(page.window.Loom.materials.artFor({ kind: 'chest' }).from).toBe('catalog');
  });

  test('is loaded before map-geometry.js, which reads its materials from it', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/apps/loom/index.html'), 'utf8');
    const materials = html.indexOf('<script src="/apps/loom/js/materials.js"></script>');
    const geometry = html.indexOf('<script src="/apps/loom/js/map-geometry.js"></script>');
    expect(materials).toBeGreaterThan(-1);
    expect(geometry).toBeGreaterThan(materials);
  });

  test('map-geometry.js loads in the page with the materials, and not without', () => {
    const geometrySource = fs.readFileSync(
      path.join(__dirname, '../public/apps/loom/js/map-geometry.js'),
      'utf8'
    );
    const page = { window: { Loom: {} } };
    vm.runInNewContext(fs.readFileSync(served, 'utf8'), page);
    vm.runInNewContext(geometrySource, page);
    expect(Object.keys(page.window.Loom.mapGeometry.MATERIALS.wall)).toContain('brick');
    expect(() => vm.runInNewContext(geometrySource, { window: { Loom: {} } })).toThrow();
  });
});
