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
 *   - the town and world views draw their area and region maps' geometry;
 *   - the three-quarter view (planning/game-art.md §4.1; L-941 / #795): the
 *     dungeon and a generated interior with walls standing, an angled wall's
 *     slanted face, a door closed, open and locked, and a prop in front of a
 *     wall drawn over it and one behind drawn under it, each against its
 *     screenshot; describe() in the depth order; tokens stand in the order
 *     with the walls; the grid view's top margin;
 *   - art sets (planning/game-art.md §4.3; L-944 / #798): a map drawn from
 *     an atlas matches the same map drawn from single files, the atlas loaded
 *     once; a set not yet loaded is fetched by its name, and one that isn't
 *     there leaves the built-in art;
 *   - the painter's finish (planning/game-art.md §4.2; L-943 / #797):
 *     contact shadows under props standing and along walls' feet; a soft
 *     edge where one floor lies over another, and none over nothing; two
 *     rooms of one floor drawing different variants, by their ids; culling,
 *     describe() saying what's culled at a view and panning bringing it
 *     back; the large dungeon zoomed in drawing faster culled than not;
 *   - seeing behind walls (planning/game-art.md §4.1, TV1; L-942 / #796): a
 *     token behind a wall fades the pieces over it and stepping out brings
 *     them back; it takes about 150 ms; the cursor behind a tall bookshelf
 *     fades it, behind a chest nothing; a path preview fades the pieces it
 *     passes behind; describe() reports what's faded; checking costs next to
 *     nothing on the large dungeon; and in the grid view the same from its
 *     tokens, the pointer and the preview;
 *   - the wilds (L-365): a generated forest track and a ford in the classic
 *     set, against their screenshots.
 *
 * It needs Playwright and its Chromium (in the tests' dependencies; CI
 * installs the browser): where the browser is missing the suite is skipped,
 * with a note. To make the screenshot again after a deliberate change to the
 * drawing: UPDATE_PAINT=1 npx jest loom-paint.
 *
 * Run: cd tests && npx jest loom-paint --verbose
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const geo = require('../functions/loom-canon/map-geometry');
const sight = require('../functions/loom-canon/sight');
const seen = require('../functions/loom-turn/seen');
const { dungeon } = require('./fixtures/paint/dungeon');
const { large } = require('./fixtures/paint/large');
const { serveFixtures } = require('./helpers/fixture-server');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  chromium = null;
}

const BASELINE = path.join(__dirname, 'fixtures/paint/dungeon.png');
const generators = require('../functions/loom-canon/map-generators');
// 120 × 80 ft at 7 px a foot, with room above for walls standing on its top edge.
const PLACE = { x: 0, y: 48, scale: 7, width: 120, height: 80 };
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
  ({ server, origin } = await serveFixtures({ artDelay: () => artDelay }));
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

// A screenshot against the one kept as `name` (made again with UPDATE_PAINT=1).
function matchesBaseline(shot, name) {
  const file = path.join(__dirname, 'fixtures/paint', name);
  if (process.env.UPDATE_PAINT || !fs.existsSync(file)) {
    fs.writeFileSync(file, PNG.sync.write(shot));
  }
  const kept = PNG.sync.read(fs.readFileSync(file));
  expect([kept.width, kept.height]).toEqual([shot.width, shot.height]);
  const diff = pixelmatch(kept.data, shot.data, null, shot.width, shot.height, {
    threshold: 0.15,
  });
  expect(diff / (shot.width * shot.height)).toBeLessThan(0.01);
}

// Standing pictures for the chest and the pillar (L-941), in a set of the
// tests' own (L-944): the built-in set has none yet (L-946 paints them).
const STANDING = { ...GRID, set: 'test-stand' };
const standing = (page) =>
  page.evaluate(() =>
    Loom.materials.registerSet(
      {
        name: 'test-stand',
        objects: {
          chest: { stand: { file: 'chest-stand.svg' } },
          pillar: { stand: { file: 'pillar-stand.svg' } },
          bookshelf: { stand: { file: 'bookshelf-stand.svg' } },
        },
      },
      '/fixtures/paint/'
    )
  );

// The colour at a point in feet of a screenshot.
function colourAt(png, xFt, yFt) {
  const x = Math.round(PLACE.x + xFt * PLACE.scale);
  const y = Math.round(PLACE.y + yFt * PLACE.scale);
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
      matchesBaseline(shot, path.basename(BASELINE));
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
    // A door opened: only that door is drawn again, and the shadow at its
    // foot goes, since it no longer stands across the doorway (L-943).
    const opened = geo.normalize(dungeon());
    opened.doors = opened.doors.map((d) => (d.id === 'shut' ? { ...d, state: 'open' } : d));
    const changed = await draw(page, 'dungeon', opened);
    expect(changed.built).toBe(again.built + 1);
    expect(changed.removed).toBe(again.removed + 2);
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

// Draws a map in the painter's page at `scale` px a foot, `top` px down.
const drawAt = (page, key, geometry, place, options) =>
  page.evaluate(
    ([k, g, o, p]) => window.__draw(k, g, o, p, null),
    [key, geometry, options || GRID, { x: 0, ...place }]
  );

// The colour at a point in feet, for a map drawn at `place`.
function colourIn(png, place, xFt, yFt) {
  const x = Math.round((place.x || 0) + xFt * place.scale);
  const y = Math.round(place.y + yFt * place.scale);
  const i = (y * png.width + x) * 4;
  return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] };
}
const brightness = (c) => (c.r + c.g + c.b) / 3;

// The mean colour over a patch a foot across, so a tile's grout doesn't decide.
function patchIn(png, place, xFt, yFt) {
  const sum = { r: 0, g: 0, b: 0 };
  let n = 0;
  for (let dx = -0.4; dx <= 0.41; dx += 0.2) {
    for (let dy = -0.4; dy <= 0.41; dy += 0.2) {
      const c = colourIn(png, place, xFt + dx, yFt + dy);
      sum.r += c.r;
      sum.g += c.g;
      sum.b += c.b;
      n += 1;
    }
  }
  return { r: sum.r / n, g: sum.g / n, b: sum.b / n };
}

// What's standing, in the order drawn.
const standingOf = (drawn) => drawn.filter((d) => d.layer === 'standing');
const inDepthOrder = (list) => list.every((d, i) => i === 0 || list[i - 1].depth <= d.depth + 1e-9);

describe('the three-quarter view (L-941)', () => {
  withBrowser(
    'the dungeon stands: walls, doors and windows standing, props on their feet',
    async () => {
      const page = await painterPage();
      await standing(page);
      await draw(page, 'tq-dungeon', geo.normalize(dungeon()), STANDING);
      const drawn = await page.evaluate(() => Loom.mapPaint.describe('tq-dungeon'));
      const up = standingOf(drawn);
      // Walls, doors, windows and the props with standing pictures stand; the
      // rest lie flat, as before (TV5).
      for (const kind of ['wall', 'door', 'window']) {
        expect(drawn.filter((d) => d.kind === kind).every((d) => d.layer === 'standing')).toBe(
          true
        );
      }
      expect(up.find((d) => d.id === 'chest').art).toMatch(/chest-stand\.svg$/);
      expect(up.find((d) => d.id === 'pillar').art).toMatch(/pillar-stand\.svg$/);
      expect(drawn.find((d) => d.id === 'table')).toMatchObject({ layer: 'objects' });
      // describe() lists the standing layer in its depth order, by each foot.
      expect(inDepthOrder(up)).toBe(true);
      expect(up.find((d) => d.id === 'chest').depth).toBe(13); // its footprint's south edge
      // Under the light, as before.
      expect(drawn[drawn.length - 1]).toMatchObject({ layer: 'light' });
      const shot = PNG.sync.read(await page.screenshot());
      // The north wall's face rises above the map, into the margin.
      const face = colourAt(shot, 30, -2);
      expect(brightness(face)).toBeGreaterThan(30);
      matchesBaseline(shot, 'dungeon-standing.png');
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );

  withBrowser('a generated interior stands', async () => {
    const page = await painterPage();
    await standing(page);
    const map = generators.generate('interior', { seed: 'three-quarter' });
    const scale = Math.min(900 / (map.width * 5), 560 / (map.height * 5));
    await drawAt(page, 'tq-interior', map.geometry, { y: 60, scale }, STANDING);
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('tq-interior'));
    const up = standingOf(drawn);
    expect(up.filter((d) => d.kind === 'wall').length).toBeGreaterThan(4);
    expect(up.some((d) => d.kind === 'door')).toBe(true);
    expect(inDepthOrder(up)).toBe(true);
    matchesBaseline(PNG.sync.read(await page.screenshot()), 'interior-standing.png');
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('an angled wall stands with a slanted face, in pieces down the screen', async () => {
    const page = await painterPage();
    const place = { y: 80, scale: 12 };
    await drawAt(
      page,
      'tq-angled',
      geo.normalize({
        ground: [{ id: 'f', material: 'flagstone', shape: { rect: { x: 0, y: 0, w: 60, h: 40 } } }],
        walls: [
          {
            id: 'slant',
            material: 'rock',
            points: [
              [10, 30],
              [50, 10],
            ],
          },
        ],
      }),
      place
    );
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('tq-angled'));
    const pieces = drawn.filter((d) => d.id === 'slant' && d.kind === 'wall');
    expect(pieces.length).toBe(4); // 20 ft down the screen, a piece each 5 ft
    expect(inDepthOrder(pieces)).toBe(true);
    const shot = PNG.sync.read(await page.screenshot());
    // Over the wall's middle, its face (darker than the floor beside it);
    // the face slants: over a point further east, it stands higher.
    const floor = brightness(patchIn(shot, place, 30, 32));
    expect(brightness(patchIn(shot, place, 30, 18.5))).toBeLessThan(floor - 25);
    expect(brightness(patchIn(shot, place, 45, 10.5))).toBeLessThan(floor - 25);
    expect(brightness(patchIn(shot, place, 15, 18.5))).toBeGreaterThan(floor - 25);
    matchesBaseline(shot, 'angled-standing.png');
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('a door closed, open and locked', async () => {
    const page = await painterPage();
    const place = { y: 80, scale: 12 };
    await drawAt(
      page,
      'tq-doors',
      geo.normalize({
        ground: [{ id: 'f', material: 'flagstone', shape: { rect: { x: 0, y: 0, w: 60, h: 40 } } }],
        walls: [
          {
            id: 'w',
            material: 'stone',
            points: [
              [0, 20],
              [60, 20],
            ],
          },
        ],
        doors: [
          {
            id: 'shut',
            material: 'wood',
            from: [10, 20],
            to: [15, 20],
            wall: 'w',
            state: 'closed',
          },
          { id: 'ajar', material: 'wood', from: [25, 20], to: [30, 20], wall: 'w', state: 'open' },
          {
            id: 'vault',
            material: 'iron',
            from: [45, 20],
            to: [50, 20],
            wall: 'w',
            state: 'locked',
          },
        ],
      }),
      place
    );
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('tq-doors'));
    const state = (id) => drawn.find((d) => d.id === id).state;
    expect([state('shut'), state('ajar'), state('vault')]).toEqual(['closed', 'open', 'locked']);
    const shot = PNG.sync.read(await page.screenshot());
    const wall = brightness(patchIn(shot, place, 20, 18.5));
    // Closed: a wooden panel standing in the wall.
    const shut = colourIn(shot, place, 12.5, 18.5);
    expect(shut.r).toBeGreaterThan(shut.b + 30);
    // Locked: tinted red.
    const vault = colourIn(shot, place, 47.5, 18.5);
    expect(vault.r).toBeGreaterThan(vault.g + 15);
    // Open: the doorway shows the floor beyond, lighter than the wall's face,
    // the leaf swung into the room standing on its hinge.
    expect(brightness(patchIn(shot, place, 28.5, 18.5))).toBeGreaterThan(wall + 25);
    expect(drawn.filter((d) => d.id === 'ajar').length).toBeGreaterThan(1); // the leaf and the wall over the doorway
    matchesBaseline(shot, 'doors-standing.png');
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('a prop in front of a wall is drawn over it, one behind under it', async () => {
    const page = await painterPage();
    await standing(page);
    const place = { y: 80, scale: 12 };
    await drawAt(
      page,
      'tq-props',
      geo.normalize({
        ground: [{ id: 'f', material: 'flagstone', shape: { rect: { x: 0, y: 0, w: 60, h: 40 } } }],
        walls: [
          {
            id: 'w',
            material: 'stone',
            points: [
              [10, 20],
              [50, 20],
            ],
          },
        ],
        objects: [
          { id: 'front', kind: 'chest', at: [20, 23], size: [6, 2] },
          { id: 'behind', kind: 'chest', at: [40, 18], size: [8, 2] },
        ],
      }),
      place,
      STANDING
    );
    const drawn = standingOf(await page.evaluate(() => Loom.mapPaint.describe('tq-props')));
    expect(drawn.map((d) => d.id)).toEqual(['behind', 'w', 'front']);
    const shot = PNG.sync.read(await page.screenshot());
    // In front: the chest over the wall's face. Behind: the face over the
    // chest, whose lid still shows above the wall.
    const front = colourIn(shot, place, 20, 19.8);
    expect(front.r).toBeGreaterThan(front.b + 40);
    const hidden = colourIn(shot, place, 40, 17.5);
    expect(Math.abs(hidden.r - hidden.b)).toBeLessThan(30);
    const lid = colourIn(shot, place, 40, 13.5);
    expect(lid.r).toBeGreaterThan(lid.b + 40);
    // A click on a standing picture finds its object; elsewhere nothing.
    const at = await page.evaluate(() => [
      Loom.mapPaint.standingAt('tq-props', 20, 20),
      Loom.mapPaint.standingAt('tq-props', 40, 13.5),
      Loom.mapPaint.standingAt('tq-props', 5, 5),
    ]);
    expect(at).toEqual(['front', 'behind', null]);
    matchesBaseline(shot, 'props-standing.png');
    expect(page.errors).toEqual([]);
    await page.close();
  });
});

describe('art sets (L-944)', () => {
  // The tests' two sets, the same pictures as files and in an atlas
  // (fixtures/art-sets/, made by the pipeline: webp, then atlas).
  const register = (page) =>
    page.evaluate(async () => {
      for (const dir of ['files', 'atlas']) {
        const base = '/fixtures/art-sets/' + dir + '/';
        const manifest = await (await fetch(base + 'manifest.json')).json();
        const problems = Loom.materials.registerSet(manifest, base);
        if (problems.length) throw new Error(problems.join(' '));
      }
    });
  const room = () =>
    geo.normalize({
      ground: [{ id: 'f', material: 'flagstone', shape: { rect: { x: 0, y: 0, w: 60, h: 40 } } }],
      walls: [
        {
          id: 'w',
          material: 'stone',
          points: [
            [5, 15],
            [55, 15],
          ],
        },
      ],
      doors: [{ id: 'd', material: 'wood', from: [30, 15], to: [35, 15], wall: 'w' }],
      objects: [
        { id: 'chest', kind: 'chest', at: [15, 25], size: [6, 4] },
        { id: 'pillar', kind: 'pillar', at: [45, 12], size: [3, 3] },
        { id: 'barrel', kind: 'barrel', at: [25, 32], size: [2.5, 2.5] },
      ],
    });
  const place = { y: 80, scale: 12 };

  withBrowser(
    'a map drawn from an atlas matches the same map drawn from single files',
    async () => {
      const page = await painterPage();
      const fetched = [];
      page.on('request', (r) => fetched.push(r.url()));
      await register(page);
      await drawAt(page, 'set-files', room(), place, { ...GRID, set: 'fixture-files' });
      const files = PNG.sync.read(await page.screenshot());
      const fromFiles = await page.evaluate(() => Loom.mapPaint.describe('set-files'));
      await page.evaluate(() => Loom.mapPaint.forget('set-files'));
      await drawAt(page, 'set-atlas', room(), place, { ...GRID, set: 'fixture-atlas' });
      const atlas = PNG.sync.read(await page.screenshot());
      const fromAtlas = await page.evaluate(() => Loom.mapPaint.describe('set-atlas'));
      // The set's pictures: the floor a file in both; the face and the props
      // files in one, frames of the atlas in the other; the barrel, which
      // neither set paints, the built-in art lying flat.
      const art = (drawn, kind, id) => drawn.find((d) => d.kind === kind && d.id === id).art;
      expect(art(fromFiles, 'ground', 'f')).toBe('/fixtures/art-sets/files/ground/flagstone.webp');
      expect(art(fromFiles, 'object', 'chest')).toBe('/fixtures/art-sets/files/objects/chest.webp');
      expect(art(fromAtlas, 'object', 'chest')).toMatch(
        /^\/fixtures\/art-sets\/atlas\/atlas\/sheet-0\.webp#\d+,\d+,96,80$/
      );
      // The wall's top is the built-in one (the set paints only its face).
      expect(art(fromAtlas, 'wall', 'w')).toBe('/apps/loom/art/materials/wall-stone.svg');
      expect(art(fromAtlas, 'object', 'barrel')).toBe('/apps/loom/art/objects/barrel.svg');
      const objectOf = (id) => fromAtlas.find((d) => d.id === id && d.kind === 'object');
      expect(objectOf('barrel').layer).toBe('objects');
      // The pillar stands on its foot, 0.95 down its picture.
      expect(objectOf('pillar').layer).toBe('standing');
      // The same drawing either way.
      const diff = pixelmatch(files.data, atlas.data, null, files.width, files.height, {
        threshold: 0.1,
      });
      expect(diff / (files.width * files.height)).toBeLessThan(0.002);
      // And the set's art is there at all: the face is the fixture's red brick.
      const face = patchIn(atlas, place, 15, 13);
      expect(face.r).toBeGreaterThan(face.g + 20);
      matchesBaseline(atlas, 'set-atlas.png');
      // An atlas is loaded once for all its frames.
      expect(fetched.filter((u) => u.endsWith('/atlas/sheet-0.webp'))).toHaveLength(1);
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );

  withBrowser('a set not yet loaded is fetched by its name, then the map is drawn', async () => {
    const page = await painterPage();
    expect(await page.evaluate(() => Loom.materials.setOf('classic'))).toBeNull();
    await drawAt(page, 'set-classic', room(), place, { ...GRID, set: 'classic' });
    expect(await page.evaluate(() => Loom.materials.setOf('classic').name)).toBe('classic');
    // The classic set paints everything (L-946): its floor a file, the chest
    // standing, a frame of one of its atlases.
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('set-classic'));
    const art = (kind, id) => drawn.find((d) => d.kind === kind && d.id === id).art;
    expect(art('ground', 'f')).toBe('/apps/loom/art/sets/classic/ground/flagstone.webp');
    expect(art('object', 'chest')).toMatch(
      /^\/apps\/loom\/art\/sets\/classic\/atlas\/sheet-\d+\.webp#\d+,\d+,\d+,\d+$/
    );
    // A set that isn't there leaves the built-in art too.
    await drawAt(page, 'set-none', room(), place, { ...GRID, set: 'no-such-set' });
    const none = await page.evaluate(() => Loom.mapPaint.describe('set-none'));
    expect(none.find((d) => d.id === 'f').art).toBe(
      '/apps/loom/art/materials/ground-flagstone.svg'
    );
    expect(page.errors).toEqual([]);
    await page.close();
  });
});

describe("the painter's finish (L-943)", () => {
  const brightnessIn = (png, place, x, y) => brightness(patchIn(png, place, x, y));

  withBrowser('contact shadows: under the props standing and along the foot of walls', async () => {
    const page = await painterPage();
    await standing(page);
    const place = { y: 120, scale: 12 };
    const room = geo.normalize({
      ground: [{ id: 'f', material: 'flagstone', shape: { rect: { x: 0, y: 0, w: 60, h: 40 } } }],
      walls: [
        {
          id: 'w',
          material: 'stone',
          points: [
            [5, 10],
            [55, 10],
          ],
        },
        {
          id: 'ns',
          material: 'stone',
          points: [
            [50, 12],
            [50, 38],
          ],
        },
      ],
      objects: [
        { id: 'chest', kind: 'chest', at: [15, 25], size: [6, 4] },
        { id: 'pillar', kind: 'pillar', at: [32, 28], size: [3, 3] },
        { id: 'table', kind: 'table', at: [40, 20], size: [5, 3] },
      ],
    });
    await drawAt(page, 'finish-shadows', room, place, STANDING);
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('finish-shadows'));
    // A shadow for each wall and each prop standing, on the floor under the
    // standing layer; none for the table, which lies flat.
    const shadows = drawn.filter((d) => d.kind === 'shadow');
    expect(shadows.map((d) => d.id).sort()).toEqual(['chest', 'ns', 'pillar', 'w']);
    expect(shadows.every((d) => d.layer === 'shadows')).toBe(true);
    const firstStanding = drawn.findIndex((d) => d.layer === 'standing');
    expect(drawn.findIndex((d) => d.kind === 'shadow')).toBeLessThan(firstStanding);
    const shot = PNG.sync.read(await page.screenshot());
    // The floor just past the wall's foot is darker than a few feet on.
    expect(brightnessIn(shot, place, 25, 11.6)).toBeLessThan(brightnessIn(shot, place, 25, 15) - 8);
    // Beside the chest's foot, darker than the open floor.
    expect(brightnessIn(shot, place, 15, 28)).toBeLessThan(brightnessIn(shot, place, 15, 34) - 8);
    // A wall running down the screen has a fainter one on both sides.
    expect(brightnessIn(shot, place, 51.2, 30)).toBeLessThan(brightnessIn(shot, place, 54, 30) - 4);
    expect(brightnessIn(shot, place, 48.8, 30)).toBeLessThan(brightnessIn(shot, place, 46, 30) - 4);
    matchesBaseline(shot, 'finish-shadows.png');
    expect(page.errors).toEqual([]);
    await page.close();
  });

  // Flagstone with a different floor laid over it: fixtures/paint/floor-*.svg.
  const variants = (page) =>
    page.evaluate(() =>
      Loom.materials.registerSet(
        {
          name: 'test-variants',
          materials: {
            'ground/flagstone': {
              file: 'floor-base.svg',
              variants: [{ file: 'floor-a.svg' }, { file: 'floor-b.svg' }],
            },
          },
        },
        '/fixtures/paint/'
      )
    );

  withBrowser('a soft edge where one floor lies over another, and none over nothing', async () => {
    const page = await painterPage();
    const place = { y: 40, scale: 12 };
    const map = geo.normalize({
      ground: [
        { id: 'stone', material: 'stone', shape: { rect: { x: 0, y: 0, w: 40, h: 40 } } },
        // Dirt over the stone, its east edge at x 30; and running off it, its
        // south edge over nothing at y 40.
        { id: 'dirt', material: 'dirt', shape: { rect: { x: 10, y: 10, w: 20, h: 30 } } },
        { id: 'grass', material: 'grass', shape: { rect: { x: 45, y: 10, w: 15, h: 15 } } },
      ],
    });
    await drawAt(page, 'finish-edges', map, place, GRID);
    const shot = PNG.sync.read(await page.screenshot());
    // A column's brightness at x, over a foot down from y 19.5: a fade is
    // across x, the textures' grain along it averages out.
    const column = (x) => {
      let sum = 0;
      for (let y = 19.5; y <= 20.5; y += 1 / place.scale)
        sum += brightness(colourIn(shot, place, x, y));
      return sum / (place.scale + 1);
    };
    const dirt = column(28);
    const stone = column(33);
    expect(stone - dirt).toBeGreaterThan(20);
    // Half a foot past the dirt's edge: neither the dirt nor the stone, the
    // dirt fading over the stone; two feet out, the stone again.
    const edge = column(30.5);
    expect(edge).toBeGreaterThan(dirt + 4);
    expect(edge).toBeLessThan(stone - 4);
    expect(Math.abs(column(32.2) - stone)).toBeLessThan(12);
    // Past the dirt's south edge there's no floor under it: nothing spills.
    const below = colourIn(shot, place, 20, 40.4);
    expect(brightness(below)).toBeLessThan(40);
    // The grass lies on nothing at all: no soft edge.
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('finish-edges'));
    expect(drawn.filter((d) => d.layer === 'ground').map((d) => d.id)).toEqual([
      'stone',
      'dirt',
      'grass',
    ]);
    const past = colourIn(shot, place, 60.4, 15);
    expect(brightness(past)).toBeLessThan(40);
    matchesBaseline(shot, 'finish-edges.png');
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('two rooms of one floor draw different variants, picked by their ids', async () => {
    const page = await painterPage();
    await variants(page);
    // Two ids whose pick differs (the pick is the painter's, by the id).
    const picks = await page.evaluate(() =>
      ['hall', 'vault', 'cellar', 'crypt', 'study', 'library'].map((id) => [
        id,
        Loom.mapPaint.variantOf(id, 3),
      ])
    );
    const [a, b] = picks.filter((p, i) => picks.findIndex((q) => q[1] === p[1]) === i);
    expect(a && b).toBeTruthy();
    const room = (id, x) => ({
      id,
      material: 'flagstone',
      shape: { rect: { x, y: 0, w: 25, h: 25 } },
    });
    const map = geo.normalize({ ground: [room(a[0], 0), room(b[0], 30)] });
    const place = { y: 40, scale: 12 };
    const opts = { ...GRID, set: 'test-variants' };
    await drawAt(page, 'finish-variants', map, place, opts);
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('finish-variants'));
    const files = ['floor-base.svg', 'floor-a.svg', 'floor-b.svg'];
    const artOf = (id) => drawn.find((d) => d.id === id).art;
    expect(artOf(a[0])).toBe('/fixtures/paint/' + files[a[1]]);
    expect(artOf(b[0])).toBe('/fixtures/paint/' + files[b[1]]);
    const shot = PNG.sync.read(await page.screenshot());
    const left = patchIn(shot, place, 12, 12);
    const right = patchIn(shot, place, 42, 12);
    expect(
      Math.abs(left.r - right.r) + Math.abs(left.g - right.g) + Math.abs(left.b - right.b)
    ).toBeGreaterThan(30);
    // The same rooms drawn again pick the same.
    await page.evaluate(() => Loom.mapPaint.forget('finish-variants'));
    await drawAt(page, 'finish-variants', map, place, opts);
    const again = await page.evaluate(() => Loom.mapPaint.describe('finish-variants'));
    expect(again.find((d) => d.id === a[0]).art).toBe(artOf(a[0]));
    matchesBaseline(shot, 'finish-variants.png');
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser("describe() says what's culled at a view; panning brings it back", async () => {
    const page = await painterPage();
    const map = geo.normalize(large());
    // 14 px a foot, the screen over the dungeon's north-west rooms.
    await page.evaluate(
      ([g]) => window.__draw('finish-cull', g, { tile: 5, wall: 1.5 }, { x: 0, y: 0, scale: 14 }),
      [map]
    );
    const at = (rect) =>
      page.evaluate(
        ([r]) => {
          const culled = Loom.mapPaint.view('finish-cull', r);
          const drawn = Loom.mapPaint.describe('finish-cull');
          const shown = (kind, id) =>
            drawn.filter((d) => d.kind === kind && d.id === id).some((d) => !d.culled);
          return { culled, total: drawn.length, drawn, shown };
        },
        [rect]
      );
    // All of it, with no view.
    const all = await at(null);
    expect(all.culled).toBe(0);
    expect(all.drawn.some((d) => d.culled)).toBe(false);
    // The screen's view of it: 960 × 640 px at 14 px a foot.
    const culled = await page.evaluate(() => Loom.mapPaint.cull('finish-cull', 960, 640));
    expect(culled).toBeGreaterThan(all.total * 0.6);
    const near = await at({ x0: 0, y0: 0, x1: 960 / 14, y1: 640 / 14 });
    const isCulled = (drawn, kind, id) =>
      drawn.filter((d) => d.kind === kind && d.id === id).every((d) => d.culled);
    expect(near.culled).toBe(culled);
    // A room in view is drawn; one across the dungeon isn't, but is still built.
    expect(isCulled(near.drawn, 'wall', 'east-r0-0')).toBe(false);
    expect(isCulled(near.drawn, 'wall', 'east-r5-5')).toBe(true);
    expect(isCulled(near.drawn, 'ground', 'floor-r5-5')).toBe(true);
    // The floor under it all stays: it reaches the view.
    expect(isCulled(near.drawn, 'ground', 'floor')).toBe(false);
    // Panned to the far corner: those come back, built before, nothing new.
    const before = await page.evaluate(() => Loom.mapPaint.stats().built);
    const far = await at({ x0: 230, y0: 250, x1: 300, y1: 300 });
    expect(isCulled(far.drawn, 'wall', 'east-r5-5')).toBe(false);
    expect(isCulled(far.drawn, 'ground', 'floor-r5-5')).toBe(false);
    expect(isCulled(far.drawn, 'wall', 'east-r0-0')).toBe(true);
    expect(await page.evaluate(() => Loom.mapPaint.stats().built)).toBe(before);
    expect(page.errors).toEqual([]);
    await page.close();
  });
});

describe('painted fronts (L-946)', () => {
  const place = { y: 120, scale: 12 };
  const room = () =>
    geo.normalize({
      ground: [{ id: 'f', material: 'flagstone', shape: { rect: { x: 0, y: 0, w: 60, h: 40 } } }],
      walls: [
        {
          id: 'w',
          material: 'stone',
          points: [
            [5, 15],
            [55, 15],
          ],
        },
      ],
      doors: [{ id: 'd', material: 'wood', from: [30, 15], to: [35, 15], wall: 'w' }],
      windows: [{ id: 'win', material: 'glass', from: [40, 15], to: [45, 15], wall: 'w' }],
    });

  withBrowser(
    'a door and a window with a painted front are drawn from it, over the wall',
    async () => {
      const page = await painterPage();
      await page.evaluate(() =>
        Loom.materials.registerSet(
          {
            name: 'test-fronts',
            materials: {
              'door/wood': { face: { file: 'door-front.svg' } },
              'window/glass': { face: { file: 'window-pane.svg' } },
            },
          },
          '/fixtures/paint/'
        )
      );
      await drawAt(page, 'fronts', room(), place, { ...GRID, set: 'test-fronts' });
      const drawn = await page.evaluate(() => Loom.mapPaint.describe('fronts'));
      const doorArt = drawn.filter((d) => d.id === 'd' && d.kind === 'door').map((d) => d.art);
      expect(doorArt.some((a) => /door-front\.svg$/.test(a))).toBe(true);
      const paneArt = drawn.filter((d) => d.id === 'win' && d.kind === 'window').map((d) => d.art);
      expect(paneArt.some((a) => /window-pane\.svg$/.test(a))).toBe(true);
      const shot = PNG.sync.read(await page.screenshot());
      // The door's face fills its doorway, a teal; the window's pane, a yellow.
      const door = patchIn(shot, place, 32.5, 12.5);
      expect(door.g).toBeGreaterThan(door.r + 40);
      expect(door.b).toBeGreaterThan(door.r + 30);
      const pane = patchIn(shot, place, 42.5, 12.3);
      expect(pane.r).toBeGreaterThan(pane.b + 80);
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );
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

describe('seeing behind walls (L-942)', () => {
  // As the grid view draws: long walls cut along their length, so one fades alone.
  const FADING = { ...STANDING, fades: true };
  const place = { y: 120, scale: 12 };
  const room = () =>
    geo.normalize({
      ground: [{ id: 'f', material: 'flagstone', shape: { rect: { x: 0, y: 0, w: 60, h: 40 } } }],
      walls: [
        {
          id: 'w',
          material: 'stone',
          points: [
            [5, 15],
            [55, 15],
          ],
        },
      ],
      objects: [
        { id: 'chest', kind: 'chest', at: [15, 32], size: [6, 4] },
        { id: 'shelf', kind: 'bookshelf', at: [40, 32], size: [5, 2] },
      ],
    });
  // What's to be seen: a token's disc (its foot's y the depth), or a floor point.
  const disc = (x, y, r = 1.2) => ({
    box: { x0: x - r, y0: y - r, x1: x + r, y1: y + r },
    depth: y + r,
  });
  const point = (x, y) => ({ box: { x0: x, y0: y, x1: x, y1: y }, depth: y });
  const drawnRoom = async (page, key = 'see') => {
    await standing(page);
    await drawAt(page, key, room(), place, FADING);
  };
  const fadeTo = (page, targets, key = 'see') =>
    page.evaluate(([k, t]) => Loom.mapPaint.fade(k, t), [key, targets]);
  const settle = (page, key = 'see') =>
    page.waitForFunction((k) => Loom.mapPaint.fading(k) === 0, key);
  const fadedOf = async (page, key = 'see') =>
    (await page.evaluate((k) => Loom.mapPaint.describe(k), key)).filter((d) => d.faded);

  withBrowser(
    'a token behind a wall fades the pieces over it, and stepping out brings them back',
    async () => {
      const page = await painterPage();
      await drawnRoom(page);
      const before = PNG.sync.read(await page.screenshot());
      const pieces = (await page.evaluate(() => Loom.mapPaint.describe('see'))).filter(
        (d) => d.kind === 'wall'
      );
      expect(pieces).toHaveLength(5); // 50 ft, none over 10 ft
      expect(pieces.some((d) => d.faded)).toBe(false);
      // A token north of the wall, in the middle of it: only the piece over it.
      await fadeTo(page, [disc(30, 11)]);
      await settle(page);
      const faded = await fadedOf(page);
      expect(faded.map((d) => d.kind + ':' + d.id)).toEqual(['wall:w']);
      const shot = PNG.sync.read(await page.screenshot());
      // The face over the token shows the floor through it now, lighter ...
      expect(brightness(patchIn(shot, place, 30, 13))).toBeGreaterThan(
        brightness(patchIn(before, place, 30, 13)) + 15
      );
      // ... and the rest of the wall is as it was.
      expect(brightness(patchIn(shot, place, 10, 13))).toBeCloseTo(
        brightness(patchIn(before, place, 10, 13)),
        0
      );
      // In front of the wall (south of it) it's not covered: nothing fades.
      await fadeTo(page, [disc(30, 19)]);
      await settle(page);
      expect(await fadedOf(page)).toEqual([]);
      const after = PNG.sync.read(await page.screenshot());
      expect(brightness(patchIn(after, place, 30, 13))).toBeCloseTo(
        brightness(patchIn(before, place, 30, 13)),
        0
      );
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );

  withBrowser('the fade takes about 150 ms, there and back', async () => {
    const page = await painterPage();
    await drawnRoom(page);
    const took = (targets) =>
      page.evaluate(
        ([t]) =>
          new Promise((resolve) => {
            const t0 = performance.now();
            Loom.mapPaint.fade('see', t);
            const tick = () =>
              Loom.mapPaint.fading('see') === 0
                ? resolve(performance.now() - t0)
                : requestAnimationFrame(tick);
            requestAnimationFrame(tick);
          }),
        [targets]
      );
    const out = await took([disc(30, 11)]);
    const back = await took([]);
    for (const ms of [out, back]) {
      expect(ms).toBeGreaterThan(100);
      expect(ms).toBeLessThan(400);
    }
    // Part way it's neither: a frame in, the piece is still on its way.
    const mid = await page.evaluate(
      () =>
        new Promise((resolve) => {
          Loom.mapPaint.fade('see', [
            { box: { x0: 28.8, y0: 9.8, x1: 31.2, y1: 12.2 }, depth: 12.2 },
          ]);
          setTimeout(() => resolve(Loom.mapPaint.fading('see')), 40);
        })
    );
    expect(mid).toBeGreaterThan(0);
    await page.close();
  });

  withBrowser('the cursor behind a tall bookshelf fades it, and a chest it does not', async () => {
    const page = await painterPage();
    await drawnRoom(page);
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('see'));
    expect(drawn.find((d) => d.id === 'shelf' && d.kind === 'object').layer).toBe('standing');
    // The bookshelf's foot is at y 33 and it's 5 ft wide and 8 ft tall; a point
    // north of it, in its picture's reach.
    await fadeTo(page, [point(40, 28)]);
    await settle(page);
    expect((await fadedOf(page)).map((d) => d.id)).toEqual(['shelf']);
    // In front of it, or off to the side, nothing fades.
    await fadeTo(page, [point(40, 36)]);
    await settle(page);
    expect(await fadedOf(page)).toEqual([]);
    await fadeTo(page, [point(48, 28)]);
    await settle(page);
    expect(await fadedOf(page)).toEqual([]);
    // The chest is low: behind it nothing fades.
    await fadeTo(page, [point(15, 29)]);
    await settle(page);
    expect(await fadedOf(page)).toEqual([]);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('a path preview behind a wall fades the pieces it passes behind', async () => {
    const page = await painterPage();
    await drawnRoom(page);
    // A path along the wall's north side, from x 8 to x 33: its points every 2.5 ft.
    const points = [];
    for (let x = 8; x <= 33; x += 2.5) points.push(point(x, 12));
    await fadeTo(page, points);
    await settle(page);
    const faded = await page.evaluate(() =>
      Loom.mapPaint
        .describe('see')
        .filter((d) => d.kind === 'wall')
        .map((d) => Boolean(d.faded))
    );
    // Pieces of 10 ft from x 5: those over x 8 to 33, the first three; not the others.
    expect(faded).toEqual([true, true, true, false, false]);
    // The path gone, they come back.
    await fadeTo(page, []);
    await settle(page);
    expect(await fadedOf(page)).toEqual([]);
    await page.close();
  });

  withBrowser('a piece built while something is behind it is faded at once', async () => {
    const page = await painterPage();
    await drawnRoom(page);
    await fadeTo(page, [disc(30, 11)]);
    await settle(page);
    // The wall drawn again with a door opened in it: its pieces are new.
    const changed = room();
    changed.doors = [{ id: 'd', material: 'wood', from: [30, 15], to: [35, 15], wall: 'w' }];
    await drawAt(page, 'see', changed, place, FADING);
    const faded = await fadedOf(page);
    expect(faded.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => Loom.mapPaint.fading('see'))).toBe(0);
    await page.close();
  });

  withBrowser('on the large dungeon, checking what fades costs next to nothing', async () => {
    const page = await painterPage();
    await page.evaluate(
      ([g]) =>
        window.__draw('big', g, { tile: 5, wall: 1.5, fades: true }, { x: 0, y: 0, scale: 2 }),
      [geo.normalize(large())]
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // 30 tokens, the cursor and a 300 ft path of 120 points, changed each time.
    const ms = await page.evaluate(() => {
      const times = [];
      for (let round = 0; round < 20; round++) {
        const targets = [];
        for (let i = 0; i < 31; i++) {
          const x = 20 + ((i * 37 + round) % 260);
          const y = 20 + ((i * 53 + round * 2) % 260);
          targets.push({ box: { x0: x - 1, y0: y - 1, x1: x + 1, y1: y + 1 }, depth: y + 1 });
        }
        for (let i = 0; i < 120; i++) {
          const y = 10 + i * 2.4 + round;
          targets.push({ box: { x0: 100, y0: y, x1: 100, y1: y }, depth: y });
        }
        const t0 = performance.now();
        Loom.mapPaint.fade('big', targets);
        times.push(performance.now() - t0);
      }
      return times;
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const worst = Math.max(...ms);
    console.log(`fade() on the large dungeon, 4× slower CPU: worst ${worst.toFixed(1)} ms`);
    expect(worst).toBeLessThan(25);
    // The same targets again do nothing at all.
    const again = await page.evaluate(() => {
      const t = [{ box: { x0: 5, y0: 5, x1: 6, y1: 6 }, depth: 6 }];
      Loom.mapPaint.fade('big', t);
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) Loom.mapPaint.fade('big', t);
      return performance.now() - t0;
    });
    expect(again).toBeLessThan(5);
    await page.close();
  });

  withBrowser(
    'in the grid view: tokens, the pointer and the path preview fade the wall over them',
    async () => {
      const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(origin + '/fixtures/paint/drawers.html');
      const data = battleData();
      const shown = (d) => page.evaluate(([x, t]) => window.__show(x, t), [d, TURN]);
      const settled = () =>
        page.waitForFunction(() => Loom.mapPaint.fading('battle:dungeon') === 0);
      // The hall's south wall (y 45 ft, x 60 to 120), a piece each 10 ft along it.
      const southFaded = () =>
        page.evaluate(
          () =>
            Loom.mapPaint
              .describe('battle:dungeon')
              .filter((d) => d.faded && d.id === 'south' && d.kind === 'wall').length
        );
      const anyFaded = () =>
        page.evaluate(() => Loom.mapPaint.describe('battle:dungeon').filter((d) => d.faded).length);
      await shown(data);
      await settled();
      expect(await anyFaded()).toBe(0);
      // A goblin standing behind the south wall's face, at x 85 (the piece from 80 to 90).
      const withGoblin = {
        ...data,
        people: [
          { id: 'gob', name: 'Goblin', x: 18, y: 8, point: { x: 85, y: 42 }, side: 'hostile' },
        ],
      };
      await shown(withGoblin);
      await settled();
      expect(await southFaded()).toBe(1);
      // It steps out in front of the wall: the wall is back.
      await shown({
        ...data,
        people: [
          { id: 'gob', name: 'Goblin', x: 18, y: 9, point: { x: 85, y: 47 }, side: 'hostile' },
        ],
      });
      await settled();
      expect(await anyFaded()).toBe(0);
      // The pointer behind the wall, at x 115 (the piece from 110 to 120).
      const screenAt = (xFt, yFt) =>
        page.evaluate(
          ([x, y]) => {
            const m = Loom.battle.mapPoint({ x, y });
            return Loom.mapMath.toScreen(Loom.engine.camera.view, m.x, m.y);
          },
          [xFt, yFt]
        );
      const over = await screenAt(115, 42);
      await page.evaluate(([p]) => Loom.battle.hover(p, Loom.engine.camera.view), [over]);
      await page.waitForFunction(
        () => Loom.mapPaint.describe('battle:dungeon').some((d) => d.faded),
        null,
        { timeout: 3000 }
      );
      await settled();
      expect(await southFaded()).toBe(1);
      // It leaves the map: back.
      await page.evaluate(() => Loom.battle.hover(null, Loom.engine.camera.view));
      await page.waitForFunction(
        () => !Loom.mapPaint.describe('battle:dungeon').some((d) => d.faded),
        null,
        { timeout: 3000 }
      );
      // The path preview: a square just north of the south wall, a walk of 20
      // ft along which the last of it is behind the wall's face.
      const target = await screenAt(72.5, 42.5);
      await page.evaluate(([p]) => Loom.battle.tap(p, Loom.engine.camera.view), [target]);
      await page.waitForFunction(
        () => Loom.mapPaint.describe('battle:dungeon').some((d) => d.faded),
        null,
        { timeout: 3000 }
      );
      await settled();
      expect(await southFaded()).toBe(1);
      // Selecting a square away from every wall: nothing is covered.
      const clear = await screenAt(72.5, 27.5);
      await page.evaluate(([p]) => Loom.battle.tap(p, Loom.engine.camera.view), [clear]);
      await page.waitForFunction(
        () => !Loom.mapPaint.describe('battle:dungeon').some((d) => d.faded),
        null,
        { timeout: 3000 }
      );
      expect(errors).toEqual([]);
      await page.close();
    }
  );
});

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

  withBrowser('tokens stand with the walls (L-941), and the map has room above it', async () => {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/fixtures/paint/drawers.html');
    const data = battleData();
    // Someone in the hall, north of its south wall; you stand further north.
    data.people = [
      { id: 'gob', name: 'Goblin', x: 20, y: 7, point: { x: 102.5, y: 37.5 }, side: 'hostile' },
    ];
    // Its outer wall 20 ft high: 12 ft up the screen, 96 px at 8 px a foot.
    data.geometry.walls = data.geometry.walls.map((w) =>
      w.id === 'outer' ? { ...w, height: 20 } : w
    );
    await page.evaluate(([d, t]) => window.__show(d, t), [data, TURN]);
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('battle:dungeon'));
    const up = drawn.filter((d) => d.layer === 'standing');
    expect(inDepthOrder(up)).toBe(true);
    const order = up.map((d) => d.kind + ':' + d.id);
    const index = (k) => order.indexOf(k);
    // You (feet at 22.5 ft and your token's radius), then the goblin
    // (37.5 ft), then the hall's south wall's doors (45 ft) in front of both.
    expect(index('token:you')).toBeGreaterThan(-1);
    expect(index('token:you')).toBeLessThan(index('token:gob'));
    expect(index('token:gob')).toBeLessThan(index('door:vault'));
    // Room above the grid for the walls on its top edge to rise into (TV4).
    const room = await page.evaluate(() => ({
      bounds: Loom.battle.bounds(),
      top: Loom.battle.mapPoint({ x: 0, y: 0 }).y,
    }));
    expect(room.top).toBe(96 + 24);
    expect(room.bounds.height).toBe(16 * 40 + room.top + 60);
    // Framed with the wall's top in view.
    const framed = await page.evaluate(() => {
      const view = Loom.engine.camera.view;
      return Loom.mapMath.toScreen(view, 0, Loom.battle.framePoints()[0].y).y;
    });
    expect(framed).toBeGreaterThanOrEqual(0);
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
      // Its wall with its shadow at its foot (L-943).
      expect(inTown.map((d) => d.kind).sort()).toEqual(['ground', 'line', 'shadow', 'wall']);
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
  withBrowser(
    'a town with ground draws from it (L-928); a town with art keeps its art',
    async () => {
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
      await page.evaluate(
        ([d]) => window.__show(d, null, 'town'),
        [town('loc_arted', { url: '/fixtures/paint/art.svg', width: 1000, height: 1000 })]
      );
      const arted = await page.evaluate(() => Loom.mapPaint.describe('area:loc_arted'));
      expect(arted.filter((d) => d.kind === 'ground' || d.kind === 'wall')).toEqual([]);
      expect(errors).toEqual([]);
      await page.close();
    }
  );
});

// Last, so a stall of the browser's GPU it may cause touches no other test.
describe("the painter's finish (L-943): speed", () => {
  withBrowser('the large dungeon zoomed in draws faster culled than not', async () => {
    const page = await painterPage();
    const map = geo.normalize(large());
    await page.evaluate(
      ([g]) =>
        window.__draw('finish-fast', g, { tile: 5, wall: 1.5 }, { x: -1400, y: -1400, scale: 14 }),
      [map]
    );
    // On a CPU four times slower (a mid-range phone), panning, frame by frame, alternating culled and not: each frame's work
    // on the page's own thread (building what the GPU is sent, where culling
    // saves), the GPU let finish between frames, outside the timing; each
    // mode's median, so a stall of the browser's GPU doesn't count.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const times = await page.evaluate(() => {
      const app = window.__app;
      const gl = app.renderer.gl;
      const root = app.stage.children[1].children[0];
      const out = { all: [], culled: [] };
      // In blocks of 20 frames, the first two of each left out (the frames
      // after a switch rebuild what's drawn).
      for (let i = 0; i < 160; i++) {
        const culled = Math.floor(i / 20) % 2 === 1;
        root.position.set(-1400 - i, -1400 - i / 2);
        const t = performance.now();
        if (culled) Loom.mapPaint.cull('finish-fast', 960, 640);
        else Loom.mapPaint.view('finish-fast', null);
        app.render();
        if (i % 20 >= 2) (culled ? out.culled : out.all).push(performance.now() - t);
        gl.finish();
      }
      return out;
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const median = (list) => list.slice().sort((x, y) => x - y)[Math.floor(list.length / 2)];
    console.log(`frame, unculled ${median(times.all)} ms, culled ${median(times.culled)} ms`);
    expect(median(times.culled)).toBeLessThan(median(times.all) * 0.9);
    expect(page.errors).toEqual([]);
    await page.close();
  });
});

describe('the classic set, painted (L-946)', () => {
  const CLASSIC = { ...GRID, set: 'classic' };
  // Built-in SVG art, which a set's picture replaces; the "?" box stays for a
  // kind no catalog knows.
  const builtIn = (drawn) =>
    drawn.filter(
      (d) =>
        typeof d.art === 'string' &&
        /\/apps\/loom\/art\/(materials|objects)\//.test(d.art) &&
        !/objects\/unknown\.svg$/.test(d.art)
    );
  const fromClassic = (drawn) =>
    drawn.filter((d) => typeof d.art === 'string' && d.art.includes('/art/sets/classic/'));
  const loaded = (page) =>
    page.waitForFunction(() => window.Loom.materials.setOf('classic'), null, { timeout: 15000 });

  withBrowser('the test dungeon, with nothing falling back to the built-in art', async () => {
    const page = await painterPage();
    await draw(page, 'classic-dungeon', geo.normalize(dungeon()), CLASSIC);
    await loaded(page);
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('classic-dungeon'));
    expect(builtIn(drawn)).toEqual([]);
    expect(fromClassic(drawn).length).toBeGreaterThan(20);
    // Props stand on their feet, the chest and the barrels among them.
    const up = standingOf(drawn);
    ['chest', 'barrel-1', 'pillar', 'statue', 'table'].forEach((id) =>
      expect(up.some((d) => d.kind === 'object' && d.id === id)).toBe(true)
    );
    matchesBaseline(PNG.sync.read(await page.screenshot()), 'classic-dungeon.png');
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('a generated interior, the same', async () => {
    const page = await painterPage();
    const map = generators.generate('interior', { seed: 'three-quarter' });
    const scale = Math.min(900 / (map.width * 5), 560 / (map.height * 5));
    await drawAt(page, 'classic-interior', map.geometry, { y: 60, scale }, CLASSIC);
    await loaded(page);
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('classic-interior'));
    expect(builtIn(drawn)).toEqual([]);
    expect(fromClassic(drawn).some((d) => d.kind === 'wall')).toBe(true);
    matchesBaseline(PNG.sync.read(await page.screenshot()), 'classic-interior.png');
    expect(page.errors).toEqual([]);
    await page.close();
  });

  // The wilds (L-365): a generated forest track and a ford, their trees,
  // bushes, logs and water in the set's pictures.
  test.each([
    ['forest-track', 'forest', 'wilds-track'],
    ['ford', 'grass', 'wilds-ford'],
  ])('a %s in the %s, generated', async (scene, terrain, key) => {
    if (!browser) {
      console.warn(`Skipped "${key}": Playwright's Chromium isn't installed here.`);
      return;
    }
    const page = await painterPage();
    const map = generators.generate('wilds', { seed: key, terrain, scene });
    const scale = Math.min(900 / (map.width * 5), 560 / (map.height * 5));
    await drawAt(page, key, geo.normalize(map.geometry), { y: 60, scale }, CLASSIC);
    await loaded(page);
    const drawn = await page.evaluate((k) => Loom.mapPaint.describe(k), key);
    expect(builtIn(drawn)).toEqual([]);
    const kinds = new Set(standingOf(drawn).map((d) => d.kind === 'object' && d.art));
    expect([...kinds].some((a) => typeof a === 'string' && a.includes('sheet-5'))).toBe(true);
    if (scene === 'ford') {
      const art = (id) => drawn.find((d) => d.kind === 'ground' && d.id === id).art;
      expect(art('river')).toMatch(/deep-water\.webp$/);
      expect(art('ford-water')).toMatch(/\/water\.webp$/);
    }
    matchesBaseline(PNG.sync.read(await page.screenshot()), `classic-${key}.png`);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('a dressed room: every decor piece standing in its picture', async () => {
    const page = await painterPage();
    const dress = require('../functions/loom-canon/dress');
    const made = generators.generate('rooms', { seed: 'dressed' });
    const map = {
      width: made.width,
      height: made.height,
      entries: made.entries,
      exits: made.exits,
      features: [],
      geometry: geo.normalize(made.geometry),
    };
    const zone = map.geometry.zones[0].id;
    const dressed = dress.dress(map, { zone, theme: 'crypt', density: 'cluttered', seed: 3 });
    expect(dressed.objects.length).toBeGreaterThan(3);
    const geometry = geo.normalize({
      ...map.geometry,
      objects: [...(map.geometry.objects || []), ...dressed.objects],
    });
    const scale = Math.min(900 / (map.width * 5), 560 / (map.height * 5));
    await drawAt(page, 'classic-dressed', geometry, { y: 60, scale }, CLASSIC);
    await loaded(page);
    const drawn = await page.evaluate(() => Loom.mapPaint.describe('classic-dressed'));
    expect(builtIn(drawn)).toEqual([]);
    const pieces = drawn.filter(
      (d) => d.kind === 'object' && dressed.objects.some((o) => o.id === d.id)
    );
    expect(pieces.length).toBe(dressed.objects.length);
    pieces.forEach((d) => expect(d.art).toContain('/art/sets/classic/'));
    matchesBaseline(PNG.sync.read(await page.screenshot()), 'classic-dressed.png');
    expect(page.errors).toEqual([]);
    await page.close();
  });
});
