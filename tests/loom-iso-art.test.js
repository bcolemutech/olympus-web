'use strict';

/**
 * Art by view on a grid, in headless Chrome (public/apps/loom/js/battle.js,
 * paint.js, materials.js; planning/isometric-view.md §4.4, AR2, AR3, C4;
 * L-955 / #861), on the real map engine (fixtures/paint/drawers.html):
 *
 *   - a grid with a painting made for another view draws from its data
 *     alone: the painting isn't drawn, its floors are (a top-down one is
 *     artwork, shown flat since L-961: loom-artwork.test.js);
 *   - a grid with a floor painting draws it as its floor, aligned with the
 *     grid, with its floors not drawn and its walls, doors and objects still
 *     standing from the data;
 *   - a world's own picture for an object kind made for another view shows
 *     the art set's isometric one on a grid and its own where the three-
 *     quarter view draws (the same code a town map draws with); one made
 *     for the isometric view stands on the grid;
 *   - a world's own ground (a material) is laid on a grid only if marked iso
 *     or floor.
 *
 * Skipped, with a note, where Playwright's Chromium is missing.
 *
 * Run: cd tests && npx jest loom-iso-art --verbose
 */

const geo = require('../functions/loom-canon/map-geometry');
const sight = require('../functions/loom-canon/sight');
const seen = require('../functions/loom-turn/seen');
const catalog = require('../functions/loom-canon/materials');
const { dungeon } = require('./fixtures/paint/dungeon');
const { serveFixtures } = require('./helpers/fixture-server');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  chromium = null;
}

jest.setTimeout(120000);

let browser = null;
let server = null;
let origin = '';

beforeAll(async () => {
  if (!chromium) return;
  try {
    browser = await chromium.launch();
  } catch {
    browser = null;
    return;
  }
  ({ server, origin } = await serveFixtures());
});

afterAll(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

const withBrowser = (name, fn) =>
  test(name, async () => {
    if (!browser) {
      console.warn(`Skipped "${name}": Playwright's Chromium isn't installed here.`);
      return;
    }
    await fn();
  });

const KEY = 'battle:dungeon';

// The test dungeon as loomGetMap sends it, with `extra` on it.
function dungeonData(extra = {}) {
  const made = { width: 24, height: 16, geometry: dungeon() };
  const viewer = { cell: { x: 14, y: 4 }, point: { x: 72.5, y: 22.5 } };
  const g = geo.normalize(made.geometry);
  const map = { id: 'dungeon', ...made, geometry: g, entries: [], exits: [] };
  const inSight = sight.inSight(map, viewer, {});
  return {
    id: 'dungeon',
    name: 'dungeon',
    width: made.width,
    height: made.height,
    image: null,
    artSet: 'classic',
    here: viewer.cell,
    herePoint: viewer.point,
    size: { id: 'medium', width: 2.5 },
    host: null,
    entries: [],
    exits: [],
    features: [],
    areas: [],
    hereArea: null,
    walls: [],
    doors: [],
    obstacles: [],
    geometry: g,
    hazards: [],
    people: [],
    fog: {
      seen: seen.pack(inSight, made.width, made.height),
      inSight: seen.pack(inSight, made.width, made.height),
      view: sight.outline(map, viewer, {}),
    },
    ...extra,
  };
}

const TURN = {
  n: 1,
  ap: 20,
  pool: 20,
  prices: { move: 1, difficult: 2, door: 2, doors: {}, actions: {}, features: {} },
  plan: null,
};

async function gridPage(query = '?view=iso') {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/fixtures/paint/drawers.html' + query);
  page.errors = errors;
  return page;
}

const show = (page, data) => page.evaluate(([d, t]) => window.__show(d, t), [data, TURN]);

// Shown, and drawn again once the set's manifest has come.
async function shown(page, data) {
  await show(page, data);
  await page.waitForFunction(() => Boolean(window.Loom.materials.setOf('classic')), null, {
    timeout: 15000,
  });
  await show(page, data);
  await page.waitForTimeout(400);
}

const describeOf = (page) => page.evaluate((k) => window.Loom.mapPaint.describe(k), KEY);
const chestOf = async (page) =>
  (await describeOf(page)).find((d) => d.kind === 'object' && d.id === 'chest');

const painting = (view) => ({
  url: `${origin}/fixtures/paint/art.svg`,
  svg: true,
  width: 120,
  height: 80,
  ...(view ? { view } : {}),
});

describe('a grid’s own painting (AR2, C4)', () => {
  withBrowser('a painting made for another view isn’t drawn: the map draws from its data', async () => {
    const page = await gridPage();
    for (const view of ['three-quarter', 'iso']) {
      await shown(page, dungeonData({ image: painting(view) }));
      expect(await page.evaluate(() => window.Loom.battle.iso())).toBe(true);
      expect(await page.evaluate(() => window.Loom.battle.drawn().art)).toBeNull();
      const drawn = await describeOf(page);
      expect(drawn.some((d) => d.kind === 'ground')).toBe(true);
      expect(drawn.some((d) => d.kind === 'wall')).toBe(true);
    }
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser(
    'a floor painting is the floor, within a foot of the grid, under what stands',
    async () => {
      const page = await gridPage();
      await shown(page, dungeonData({ image: painting('floor') }));
      await page.waitForFunction(() => window.Loom.battle.drawn().art, null, { timeout: 15000 });
      const art = await page.evaluate(() => window.Loom.battle.drawn().art);
      // The grid is 24 × 16 squares, 120 × 80 ft: the painting covers it.
      expect(Math.abs(art.x0)).toBeLessThan(1);
      expect(Math.abs(art.y0)).toBeLessThan(1);
      expect(Math.abs(art.x1 - 120)).toBeLessThan(1);
      expect(Math.abs(art.y1 - 80)).toBeLessThan(1);
      const drawn = await describeOf(page);
      // Its floors aren't drawn: the painting is them. What stands is.
      expect(drawn.some((d) => d.kind === 'ground' || d.kind === 'line')).toBe(false);
      expect(drawn.some((d) => d.layer === 'standing' && d.kind === 'wall')).toBe(true);
      expect(drawn.some((d) => d.layer === 'standing' && d.kind === 'door')).toBe(true);
      expect(await chestOf(page)).toBeTruthy();
      // The same map without it draws its floors again.
      await shown(page, dungeonData());
      expect((await describeOf(page)).some((d) => d.kind === 'ground')).toBe(true);
      expect(await page.evaluate(() => window.Loom.battle.drawn().art)).toBeNull();
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );
});

describe('a world’s own art for an object kind (AR3)', () => {
  const kinds = (view) => ({
    chest: { art: { link: `${origin}/fixtures/paint/chest-stand.svg`, ...(view ? { view } : {}) } },
  });

  withBrowser('made for another view: the set’s isometric picture on a grid', async () => {
    const page = await gridPage();
    for (const view of [null, 'three-quarter', 'top-down']) {
      await shown(page, dungeonData({ objectKinds: kinds(view) }));
      const chest = await chestOf(page);
      expect(chest.art).toContain('/art/sets/classic/');
      expect(chest.art).not.toContain('chest-stand.svg');
    }
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('made for the isometric view: it stands on the grid', async () => {
    const page = await gridPage();
    await shown(page, dungeonData({ objectKinds: kinds('iso') }));
    const chest = await chestOf(page);
    expect(chest.layer).toBe('standing');
    expect(chest.art).toContain('chest-stand.svg');
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('where the three-quarter view draws, its own art is drawn as before', async () => {
    // The same code a town map is drawn with: no isometric projection.
    const page = await gridPage('?view=tq');
    await shown(page, dungeonData({ objectKinds: kinds(null) }));
    const chest = await chestOf(page);
    expect(chest.art).toContain('chest-stand.svg');
    expect(page.errors).toEqual([]);
    await page.close();
  });
});

describe('the helpers (materials.js, shared with the server)', () => {
  const link = 'https://example.test/own.png';
  const chest = { id: 'c', kind: 'chest', at: [10, 10], size: [3, 2] };

  test('only art made for the isometric view stands, from the object or its kind', () => {
    const own = (view) => ({
      chest: { art: { imageId: 'img_1', link, ...(view ? { view } : {}) } },
    });
    expect(catalog.isoFor(chest, own('iso'), null)).toMatchObject({
      own: true,
      facings: [{ url: link }, { url: link }],
      // Its foot across the footprint's diamond: w / (w + d), on the front corner.
      foot: [3 / 5, 1],
    });
    for (const view of [null, 'three-quarter', 'top-down', 'floor']) {
      expect(catalog.isoFor(chest, own(view), null)).toBeNull();
    }
    const single = { ...chest, art: { link, view: 'iso' } };
    expect(catalog.isoFor(single, null, null)).toMatchObject({ own: true });
    expect(catalog.gridArt({ link, view: 'iso' })).toBe(true);
    expect(catalog.gridArt({ link, view: 'floor' })).toBe(false);
    expect(catalog.gridArt({ link, view: 'floor' }, true)).toBe(true);
    expect(catalog.gridArt(null)).toBe(false);
  });

  test('a world’s own ground is laid on a grid only if iso or floor, its like otherwise', () => {
    const own = (view) => [
      { id: 'moss', like: 'grass', art: { imageId: 'img_2', link, ...(view ? { view } : {}) } },
    ];
    // Where it was always drawn (a town, the three-quarter view): its art.
    expect(catalog.materialArt('ground', 'moss', null, own(null)).from).toBe('world');
    // On a grid: not unless marked, then the ground it is like.
    expect(catalog.materialArt('ground', 'moss', null, own(null), true).from).not.toBe('world');
    expect(catalog.materialArt('ground', 'moss', null, own('top-down'), true).from).not.toBe(
      'world'
    );
    for (const view of ['iso', 'floor']) {
      expect(catalog.materialArt('ground', 'moss', null, own(view), true)).toMatchObject({
        from: 'world',
        picture: { url: link },
      });
    }
  });
});
