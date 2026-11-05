'use strict';

/**
 * The map painter in headless Chrome (public/apps/loom/js/paint.js; planning/
 * maps-from-data.md §4.6, RD1, RD3, RD4, EX2, PL4; L-924 / #728), on its own
 * page (fixtures/paint/index.html) and in the Loom's grid view on the real map
 * engine (fixtures/paint/drawers.html), with PixiJS served from the tests' own
 * copy and the art from the repo:
 *
 *   - a dungeon with no image draws its materials, an angled wall, a glass
 *     door and its objects, one with no art the box with a question mark, and
 *     matches its screenshot;
 *   - a map with art draws it in place of its ground and walls, its objects
 *     on top;
 *   - the progress effect shows while it loads, then goes;
 *   - a second visit draws nothing again;
 *   - a large dungeon draws in under 2 s on a CPU slowed four times (a
 *     mid-range phone), once its textures have loaded;
 *   - the grid view draws its map with the painter, and its fog to the sight
 *     lines;
 *   - the town and world views draw their area and region maps' geometry.
 *
 * It needs Playwright and its Chromium (in the tests' dependencies; CI
 * installs the browser): where the browser is missing the suite is skipped,
 * with a note. To make the screenshot again after a deliberate change to the
 * drawing: UPDATE_PAINT=1 npx jest loom-paint.
 *
 * Run: cd tests && npx jest loom-paint --verbose
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const geo = require('../functions/loom-canon/map-geometry');
const sight = require('../functions/loom-canon/sight');
const seen = require('../functions/loom-turn/seen');
const { dungeon } = require('./fixtures/paint/dungeon');
const { large } = require('./fixtures/paint/large');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  chromium = null;
}

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(__dirname, 'fixtures/paint/dungeon.png');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.png': 'image/png',
};
const PLACE = { x: 0, y: 0, scale: 8, width: 120, height: 80 }; // 120 × 80 ft at 8 px a foot
const GRID = { tile: 5, wall: 1.5, tint: null };

jest.setTimeout(120000);

let browser = null;
let server = null;
let origin = '';
let artDelay = 0; // ms the art files are held back (for the progress effect)

beforeAll(async () => {
  if (!chromium) return;
  try {
    browser = await chromium.launch();
  } catch {
    browser = null;
    return;
  }
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file =
      url === '/pixi.min.js'
        ? path.join(__dirname, 'node_modules/pixi.js/dist/pixi.min.js')
        : url.startsWith('/fixtures/')
          ? path.join(__dirname, url)
          : path.join(ROOT, 'public', url);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const send = () => {
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      });
      res.end(fs.readFileSync(file));
    };
    if (artDelay && url.startsWith('/apps/loom/art/')) setTimeout(send, artDelay);
    else send();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

// A test that needs the browser; skipped, with a note, without one.
const withBrowser = (name, fn) =>
  test(name, async () => {
    if (!browser) {
      console.warn(`Skipped "${name}": Playwright's Chromium isn't installed here.`);
      return;
    }
    await fn();
  });

async function painterPage() {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/fixtures/paint/index.html');
  await page.evaluate(() => window.__ready);
  page.errors = errors;
  return page;
}

const draw = (page, key, geometry, options, image) =>
  page.evaluate(
    ([k, g, o, p, i]) => window.__draw(k, g, o, p, i),
    [key, geometry, options || GRID, PLACE, image || null]
  );

// The colour at a point in feet of a screenshot.
function colourAt(png, xFt, yFt) {
  const x = Math.round(xFt * PLACE.scale);
  const y = Math.round(yFt * PLACE.scale);
  const i = (y * png.width + x) * 4;
  return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] };
}

describe('the painter', () => {
  withBrowser(
    'a dungeon with no image: its materials, an angled wall, a glass door, objects and the "?" box',
    async () => {
      const page = await painterPage();
      await draw(page, 'dungeon', geo.normalize(dungeon()));
      const drawn = await page.evaluate(() => Loom.mapPaint.describe('dungeon'));
      const find = (kind, id) => drawn.find((d) => d.kind === kind && d.id === id);
      // Floors from their materials' tiles.
      expect(find('ground', 'floor')).toMatchObject({
        layer: 'ground',
        art: '/apps/loom/art/materials/ground-flagstone.svg',
      });
      expect(find('ground', 'hall').art).toBe('/apps/loom/art/materials/ground-wood.svg');
      expect(find('ground', 'pool').art).toBe('/apps/loom/art/materials/ground-water.svg');
      // The angled wall, and the walls between rooms.
      expect(find('wall', 'slant')).toMatchObject({
        art: '/apps/loom/art/materials/wall-rock.svg',
      });
      expect(find('wall', 'west').art).toBe('/apps/loom/art/materials/wall-brick.svg');
      // Doors by state; the glass one from its own art.
      expect(find('door', 'pane')).toMatchObject({
        art: '/apps/loom/art/materials/door-glass.svg',
      });
      expect(find('door', 'vault')).toMatchObject({ state: 'locked' });
      expect(find('door', 'ajar')).toMatchObject({ state: 'open' });
      expect(find('window', 'slit').art).toBe('/apps/loom/art/materials/window-glass.svg');
      // Objects with their art; one no catalog knows, the box with a question mark.
      expect(find('object', 'chest').art).toBe('/apps/loom/art/objects/chest.svg');
      expect(find('object', 'thing').art).toBe('/apps/loom/art/objects/unknown.svg');
      // Shading by height and the light, last.
      expect(drawn.some((d) => d.layer === 'shading')).toBe(true);
      expect(drawn[drawn.length - 1]).toMatchObject({ layer: 'light' });

      const shot = PNG.sync.read(await page.screenshot());
      const wood = colourAt(shot, 90, 30);
      expect(wood.r).toBeGreaterThan(wood.b + 40); // brown planks
      const pool = colourAt(shot, 25, 60);
      expect(pool.b).toBeGreaterThan(pool.r + 40); // water
      // The screenshot, against the one kept.
      if (process.env.UPDATE_PAINT || !fs.existsSync(BASELINE)) {
        fs.writeFileSync(BASELINE, PNG.sync.write(shot));
      }
      const kept = PNG.sync.read(fs.readFileSync(BASELINE));
      expect([kept.width, kept.height]).toEqual([shot.width, shot.height]);
      const diff = pixelmatch(kept.data, shot.data, null, shot.width, shot.height, {
        threshold: 0.15,
      });
      expect(diff / (shot.width * shot.height)).toBeLessThan(0.01);
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );

  withBrowser(
    'a map with art: the art in place of its ground and walls, objects on top',
    async () => {
      const page = await painterPage();
      const map = geo.normalize(dungeon());
      // A banner with art of its own, sent as its link (A5).
      map.objects.push({
        id: 'banner',
        kind: 'banner',
        at: [60, 70],
        size: [6, 4],
        art: { link: '/fixtures/paint/art.svg' },
      });
      await draw(page, 'with-art', map, { ...GRID, art: true }, '/fixtures/paint/art.svg');
      const drawn = await page.evaluate(() => Loom.mapPaint.describe('with-art'));
      expect(drawn.find((d) => d.id === 'banner').art).toBe('/fixtures/paint/art.svg');
      const layers = new Set(drawn.map((d) => d.layer));
      expect(layers.has('ground')).toBe(false);
      expect(layers.has('walls')).toBe(false);
      expect(drawn.filter((d) => d.kind === 'object')).toHaveLength(dungeon().objects.length + 1);
      // Doors over the art as lines by their state.
      expect(drawn.find((d) => d.kind === 'door' && d.id === 'vault')).toMatchObject({
        state: 'locked',
      });
      const shot = PNG.sync.read(await page.screenshot());
      const art = colourAt(shot, 10, 75); // the art's purple where nothing stands
      expect(art.b).toBeGreaterThan(art.g + 40);
      const chest = colourAt(shot, 105, 12); // the chest, over it
      expect(chest.b).toBeLessThan(chest.r);
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );

  withBrowser('a second visit draws nothing again', async () => {
    const page = await painterPage();
    const first = await draw(page, 'dungeon', geo.normalize(dungeon()));
    const elsewhere = await draw(page, 'small', {
      ground: [{ id: 'f', material: 'grass', shape: { rect: { x: 0, y: 0, w: 20, h: 20 } } }],
    });
    expect(elsewhere.built).toBe(first.built + 1);
    const again = await draw(page, 'dungeon', geo.normalize(dungeon()));
    expect(again.built).toBe(elsewhere.built);
    expect(again.kept).toBeGreaterThan(elsewhere.kept);
    // A door opened: only that door is drawn again.
    const opened = geo.normalize(dungeon());
    opened.doors = opened.doors.map((d) => (d.id === 'shut' ? { ...d, state: 'open' } : d));
    const changed = await draw(page, 'dungeon', opened);
    expect(changed.built).toBe(again.built + 1);
    expect(changed.removed).toBe(again.removed + 1);
    await page.close();
  });

  withBrowser('a large dungeon draws in under 2 s on a CPU four times slower', async () => {
    const page = await painterPage();
    const map = geo.normalize(large());
    // The textures first (loading isn't the drawing), then the drawing, slowed.
    await draw(page, 'warm', map);
    await page.evaluate(() => Loom.mapPaint.forget('warm'));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const stats = await page.evaluate(
      ([g]) => window.__draw('large', g, { tile: 5, wall: 1.5 }, { x: 0, y: 0, scale: 2 }),
      [map]
    );
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    expect(stats.drawMs).toBeLessThan(2000);
    // It came in pieces: the progress rose more than once before it was done.
    const progress = await page.evaluate(() => window.__progress);
    const rising = progress.filter((f) => typeof f === 'number' && f > 0.4 && f < 1);
    expect(rising.length).toBeGreaterThan(1);
    await page.close();
  });
});

// A battle map as loomGetMap sends it: the dungeon, seen from the wooden hall.
function battleData() {
  const g = geo.normalize(dungeon());
  const map = { id: 'dungeon', width: 24, height: 16, geometry: g, entries: [], exits: [] };
  const viewer = { cell: { x: 14, y: 4 }, point: { x: 72.5, y: 22.5 } };
  const inSight = sight.inSight(map, viewer, {});
  return {
    id: 'dungeon',
    name: 'The dungeon',
    width: 24,
    height: 16,
    image: null,
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
      seen: seen.pack(inSight, 24, 16),
      inSight: seen.pack(inSight, 24, 16),
      view: sight.outline(map, viewer, {}),
    },
  };
}
const TURN = {
  n: 1,
  ap: 20,
  pool: 20,
  prices: { move: 1, difficult: 2, door: 2, doors: {}, actions: {}, features: {} },
  plan: null,
};

describe('the grid view', () => {
  withBrowser('draws its map with the painter, and shows its progress while loading', async () => {
    artDelay = 600;
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/fixtures/paint/drawers.html');
    const showing = page.evaluate(([d, t]) => window.__show(d, t), [battleData(), TURN]);
    // While the art is held back: the progress effect, filling.
    await page.waitForSelector('.loom-map-progress:not([hidden])', { timeout: 5000 });
    const during = await page.evaluate(() => {
      const el = document.querySelector('.loom-map-progress');
      return { label: el.textContent, value: el.getAttribute('aria-valuenow') };
    });
    expect(during.label).toBe('Drawing the map…');
    expect(Number(during.value)).toBeGreaterThanOrEqual(0);
    await showing;
    artDelay = 0;
    // Done: it's gone, and the map is drawn from its data.
    expect(await page.evaluate(() => document.querySelector('.loom-map-progress').hidden)).toBe(
      true
    );
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('battle:dungeon'));
    expect(drawn.find((d) => d.kind === 'wall' && d.id === 'slant')).toBeTruthy();
    expect(drawn.find((d) => d.kind === 'object' && d.id === 'thing').art).toBe(
      '/apps/loom/art/objects/unknown.svg'
    );
    const progress = await page.evaluate(() => window.__progress);
    expect(progress[progress.length - 1]).toBeNull();
    expect(errors).toEqual([]);
    await page.close();
  });

  withBrowser(
    'the town and world views draw their area and region maps from their data',
    async () => {
      const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(origin + '/fixtures/paint/drawers.html');
      const area = geo.normalize({
        ground: [
          { id: 'yard', material: 'cobble', shape: { rect: { x: 100, y: 100, w: 800, h: 800 } } },
        ],
        walls: [
          {
            id: 'wall',
            material: 'stone',
            points: [
              [100, 100],
              [900, 100],
            ],
          },
        ],
        lines: [
          {
            id: 'street',
            material: 'street',
            points: [
              [100, 500],
              [900, 500],
            ],
            width: 20,
          },
        ],
      });
      const town = {
        locationId: 'pl_station',
        name: 'Vega Station',
        here: null,
        at: null,
        next: [],
        places: [],
        links: [],
        exits: [],
        image: null,
        geometry: area,
        space: { width: 1000, height: 1000 },
      };
      await page.evaluate(([d]) => window.__show(d, null, 'town'), [town]);
      const inTown = await page.evaluate(() => Loom.mapPaint.describe('area:pl_station'));
      expect(inTown.map((d) => d.kind).sort()).toEqual(['ground', 'line', 'wall']);
      const region = {
        mapId: 'vega',
        here: null,
        places: [],
        links: [],
        map: {
          width: 100,
          height: 100,
          image: null,
          geometry: geo.normalize({
            ground: [{ id: 'belt', material: 'rock', shape: { circle: { x: 50, y: 50, r: 30 } } }],
          }),
          space: { width: 100, height: 100 },
        },
      };
      await page.evaluate(([d]) => window.__show(d, null, 'world'), [region]);
      const onVega = await page.evaluate(() => Loom.mapPaint.describe('region:vega'));
      expect(onVega).toEqual([
        {
          layer: 'ground',
          kind: 'ground',
          id: 'belt',
          art: '/apps/loom/art/materials/ground-rock.svg',
        },
      ]);
      expect(errors).toEqual([]);
      await page.close();
    }
  );
  withBrowser('a town with ground draws from it (L-928); a town with art keeps its art', async () => {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/fixtures/paint/drawers.html');
    const ground = require('../functions/loom-canon/ground');
    const rect = (x, y, w, h) => [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    const shapes = {
      buildings: [{ name: 'the mill', points: rect(200, 200, 120, 80) }],
      water: [{ name: 'the Dal', points: rect(0, 480, 1000, 40) }],
      crossings: [{ name: 'the bridge', points: rect(480, 470, 40, 60) }],
      walls: [
        {
          name: 'the town wall',
          points: [
            { x: 100, y: 100 },
            { x: 900, y: 100 },
          ],
        },
      ],
    };
    // As loomGetMap sends a town with ground (map-view.js townDrawing).
    const town = (id, image) => ({
      locationId: id,
      name: 'Burdendal',
      here: null,
      at: null,
      next: [],
      places: [],
      links: [],
      exits: [],
      image,
      ground: shapes,
      geometry: ground.geometryOf(shapes),
      space: { width: 1000, height: 1000 },
    });
    await page.evaluate(([d]) => window.__show(d, null, 'town'), [town('loc_burden', null)]);
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('area:loc_burden'));
    expect(drawn.filter((d) => d.kind === 'ground').map((d) => [d.id, d.art])).toEqual([
      ['town-streets', '/apps/loom/art/materials/ground-cobble.svg'],
      ['town-water-0', '/apps/loom/art/materials/ground-water.svg'],
      ['town-crossing-0', '/apps/loom/art/materials/ground-wood.svg'],
      ['town-building-0', '/apps/loom/art/materials/ground-roof.svg'],
    ]);
    expect(drawn.filter((d) => d.kind === 'wall').map((d) => d.id)).toEqual(['town-wall-0']);
    // With art, the art is the town's ground and walls: nothing of them drawn.
    await page.evaluate(([d]) => window.__show(d, null, 'town'), [
      town('loc_arted', { url: '/fixtures/paint/art.svg', width: 1000, height: 1000 }),
    ]);
    const arted = await page.evaluate(() => Loom.mapPaint.describe('area:loc_arted'));
    expect(arted.filter((d) => d.kind === 'ground' || d.kind === 'wall')).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });
});
