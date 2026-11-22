'use strict';

/**
 * Artwork battle maps shown flat, in headless Chrome (public/apps/loom/js/
 * battle.js and paint.js; planning/isometric-view.md §4.7, AW1; L-961 /
 * #908), on the real map engine (fixtures/paint/drawers.html, isometric by
 * default):
 *
 *   - a grid whose own art is a whole top-down painting (marked top-down, or
 *     not marked) is drawn flat as that painting, stretched to the grid: no
 *     floors, walls, windows or objects drawn from its data, its doors as
 *     marks, your token and the fog over it;
 *   - walking from it into a map drawn in isometric and back switches the
 *     projection each time; a floor painting stays isometric; with the
 *     three-quarter view asked for, the next map that isn't artwork takes it;
 *   - a door is picked by its doorway with the hover outline, its menu opens
 *     it, and its mark changes with its state; a usable object is picked by
 *     its footprint.
 *
 * Skipped, with a note, where Playwright's Chromium is missing.
 *
 * Run: cd tests && npx jest loom-artwork --verbose
 */

const { PNG } = require('pngjs');
const geo = require('../functions/loom-canon/map-geometry');
const sight = require('../functions/loom-canon/sight');
const seen = require('../functions/loom-turn/seen');
const generators = require('../functions/loom-canon/map-generators');
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

// A grid map as loomGetMap sends it, seen from `viewer` ({ cell, point }).
function battleOf(id, made, viewer, extra = {}) {
  const g = geo.normalize(made.geometry);
  const map = { id, width: made.width, height: made.height, geometry: g, entries: [], exits: [] };
  const inSight = sight.inSight(map, viewer, {});
  return {
    id,
    name: id,
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
    objects: [],
    fog: {
      seen: seen.pack(inSight, made.width, made.height),
      inSight: seen.pack(inSight, made.width, made.height),
      view: sight.outline(map, viewer, {}),
    },
    ...extra,
  };
}

// The test dungeon, its doors named by their ids, the shut one `shut` as
// given; standing in the hall, or where `viewer` says.
const HALL = { cell: { x: 14, y: 4 }, point: { x: 72.5, y: 22.5 } };
function dungeonData(extra, { viewer = HALL, shut = 'closed' } = {}) {
  const g = dungeon();
  g.doors.forEach((d) => {
    d.name = d.id;
    if (d.id === 'shut') d.state = shut;
  });
  return battleOf('dungeon', { width: 24, height: 16, geometry: g }, viewer, extra);
}

function interiorData() {
  const made = generators.generate('interior', { seed: 'three-quarter' });
  return battleOf('interior', made, { cell: { x: 13, y: 9 }, point: { x: 67.5, y: 47.5 } });
}

// A painting the size of the dungeon (fixtures/paint/art.svg: 120 × 80, purple).
const painting = (view) => ({
  url: `${origin}/fixtures/paint/art.svg`,
  svg: true,
  width: 120,
  height: 80,
  ...(view ? { view } : {}),
});

const TURN = {
  n: 1,
  ap: 20,
  pool: 20,
  prices: { move: 1, difficult: 2, door: 2, doors: {}, actions: { object: 2 }, features: {} },
  plan: null,
};

async function gridPage(query = '') {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/fixtures/paint/drawers.html' + query);
  page.errors = errors;
  return page;
}

const show = (page, data) => page.evaluate(([d, t]) => window.__show(d, t), [data, TURN]);

const frame = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// Shown, its painting loaded and drawn.
async function shownArt(page, data) {
  await show(page, data);
  await page.waitForFunction(() => window.Loom.battle.drawn().art, null, { timeout: 15000 });
  await show(page, data);
  await frame(page);
}

const KEY = 'battle:dungeon';
const describeOf = (page, key = KEY) =>
  page.evaluate((k) => window.Loom.mapPaint.describe(k), key);
const isoOf = (page) => page.evaluate(() => window.Loom.battle.iso());

// Where a floor point in feet is drawn on the screen.
const screenAt = (page, p) =>
  page.evaluate(
    ([x, y]) => {
      const m = window.Loom.battle.mapPoint({ x, y });
      const s = window.Loom.mapMath.toScreen(window.Loom.engine.camera.view, m.x, m.y);
      return { x: Math.round(s.x), y: Math.round(s.y) };
    },
    [p.x, p.y]
  );

const picks = (page, s) => page.evaluate(([p]) => window.Loom.battle.picks(p), [s]);

// The colour of the pixel at a screen point.
async function pixelAt(page, s) {
  const shot = PNG.sync.read(await page.screenshot({ clip: { x: s.x, y: s.y, width: 1, height: 1 } }));
  return [shot.data[0], shot.data[1], shot.data[2]];
}

describe('a grid’s artwork, shown flat (AW1)', () => {
  withBrowser(
    'drawn flat as its painting: no walls, windows or objects, its doors marked, you and the fog over it',
    async () => {
      const page = await gridPage();
      for (const view of ['top-down', null]) {
        await shownArt(page, dungeonData({ image: painting(view) }));
        expect([view, await isoOf(page)]).toEqual([view, false]);
        const drawn = await page.evaluate(() => window.Loom.battle.drawn());
        // Stretched to the grid: 24 × 16 squares, 120 × 80 ft.
        expect(Math.abs(drawn.art.x0)).toBeLessThan(1);
        expect(Math.abs(drawn.art.y0)).toBeLessThan(1);
        expect(Math.abs(drawn.art.x1 - 120)).toBeLessThan(1);
        expect(Math.abs(drawn.art.y1 - 80)).toBeLessThan(1);
        // Nothing of the map stands or lies over it from its data but its doors' marks.
        const painted = await describeOf(page);
        for (const kind of ['ground', 'line', 'wall', 'window', 'object', 'shadow']) {
          expect([kind, painted.some((d) => d.kind === kind)]).toEqual([kind, false]);
        }
        const doors = painted.filter((d) => d.kind === 'door');
        expect(doors.map((d) => d.id).sort()).toEqual(['ajar', 'pane', 'shut', 'vault']);
        doors.forEach((d) => expect(d.layer).toBe('standing'));
        // Your token on it, the fog over it (the dungeon's far rooms unseen).
        expect(drawn.fog).toEqual({ dark: true, dim: true });
        const you = await screenAt(page, HALL.point);
        expect(you.x).toBeGreaterThan(0);
        expect(you.x).toBeLessThan(960);
        expect(you.y).toBeGreaterThan(0);
        expect(you.y).toBeLessThan(640);
        // The flat grid: a point in feet where the three-quarter view has it.
        const p = await page.evaluate(() => window.Loom.battle.mapPoint({ x: 10, y: 5 }));
        expect(p).toEqual({ x: 60 + 80, y: 60 + 40 });
        // The grid's squares show only while a move or an aim is being chosen.
        expect(drawn.grid).toBe(false);
      }
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );
});

describe('the projection, map by map', () => {
  withBrowser('walking into an isometric map and back switches it each time', async () => {
    const page = await gridPage();
    const artwork = dungeonData({ image: painting('top-down') });
    await shownArt(page, artwork);
    expect(await isoOf(page)).toBe(false);
    // Through a door into a map drawn from its data: isometric again.
    await show(page, interiorData());
    expect(await isoOf(page)).toBe(true);
    await page.waitForFunction(
      () =>
        (window.Loom.mapPaint.describe('battle:interior') || []).some(
          (d) => d.layer === 'standing' && d.kind === 'wall'
        ),
      null,
      { timeout: 15000 }
    );
    // And back: flat, its walls not drawn.
    await shownArt(page, artwork);
    expect(await isoOf(page)).toBe(false);
    expect((await describeOf(page)).some((d) => d.kind === 'wall')).toBe(false);
    // A floor painting stays isometric, what stands drawn over it (C4).
    await shownArt(page, dungeonData({ image: painting('floor') }));
    expect(await isoOf(page)).toBe(true);
    expect((await describeOf(page)).some((d) => d.layer === 'standing' && d.kind === 'wall')).toBe(
      true
    );
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('with the three-quarter view asked for, the next plain map takes it', async () => {
    const page = await gridPage();
    await shownArt(page, dungeonData({ image: painting('top-down') }));
    await page.evaluate(() => window.Loom.battle.setIso(false));
    expect(await isoOf(page)).toBe(false);
    // Asked for isometric again while on artwork: it stays flat ...
    await page.evaluate(() => window.Loom.battle.setIso(true));
    expect(await isoOf(page)).toBe(false);
    // ... and the next map that isn't artwork is isometric.
    await show(page, interiorData());
    expect(await isoOf(page)).toBe(true);
    await page.evaluate(() => window.Loom.battle.setIso(false));
    await show(page, interiorData());
    expect(await isoOf(page)).toBe(false);
    expect(page.errors).toEqual([]);
    await page.close();
  });
});

describe('doors and objects on artwork', () => {
  // Beside the shut door (in the west wall, x = 60 ft from y = 15 to 20 ft).
  const BESIDE = { cell: { x: 12, y: 3 }, point: { x: 62.5, y: 17.5 } };

  withBrowser('a door is picked by its doorway, opened, and its mark changes', async () => {
    const page = await gridPage();
    await page.evaluate(() => {
      window.__doors = [];
      window.Loom.play.doorAction = (id, open, label) => window.__doors.push({ id, open, label });
    });
    const closed = dungeonData({ image: painting('top-down') }, { viewer: BESIDE });
    await shownArt(page, closed);
    // A foot and a fifth from its line, beyond where a door drawn from data is
    // picked, but in its doorway; a foot and four fifths off, the floor.
    const inDoorway = await screenAt(page, { x: 61.2, y: 17.5 });
    expect(await picks(page, inDoorway)).toEqual({ door: 'shut' });
    const past = await screenAt(page, { x: 61.8, y: 17.5 });
    expect(await picks(page, past)).toEqual({ cell: { x: 12, y: 3 } });
    // A hover lights it.
    await page.evaluate(
      ([p]) => window.Loom.battle.hover(p, window.Loom.engine.camera.view),
      [inDoorway]
    );
    await frame(page);
    expect(await page.evaluate(() => window.Loom.battle.lit())).toEqual({ hit: 'door:shut' });
    expect((await page.evaluate(() => window.Loom.battle.drawn())).lit).toBe(true);
    await page.evaluate(() => window.Loom.battle.hover(null));
    // Its mark: a full amber disc, shut.
    const mark = await screenAt(page, { x: 60, y: 17.5 });
    const shut = await pixelAt(page, mark);
    expect(shut[0]).toBeGreaterThan(200);
    expect(shut[1]).toBeGreaterThan(140);
    expect(shut[2]).toBeLessThan(130);
    // Its menu opens it.
    await page.evaluate(
      ([p]) => window.Loom.battle.tap(p, window.Loom.engine.camera.view),
      [inDoorway]
    );
    await page.waitForSelector('.loom-map-menu', { timeout: 3000 });
    await page.click('.loom-map-menu-item:has-text("Open shut")');
    expect(await page.evaluate(() => window.__doors)).toEqual([
      { id: 'shut', open: true, label: 'open shut' },
    ]);
    // The turn comes back with it open: its mark a ring, the middle dark.
    await show(page, dungeonData({ image: painting('top-down') }, { viewer: BESIDE, shut: 'open' }));
    await frame(page);
    const door = (await describeOf(page)).find((d) => d.kind === 'door' && d.id === 'shut');
    expect(door.state).toBe('open');
    const open = await pixelAt(page, mark);
    expect(open[0]).toBeLessThan(120);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('a usable object is picked by its footprint, with the hover outline', async () => {
    const page = await gridPage();
    const chest = {
      id: 'chest',
      name: 'iron-bound chest',
      state: 'closed',
      description: 'A heavy chest.',
      actions: [{ id: 'open', name: 'Open', cost: 2 }],
    };
    await shownArt(page, dungeonData({ image: painting('top-down'), objects: [chest] }));
    // Not drawn, but there to pick (at 105, 12 ft; 3 × 2 ft, its box a square at least).
    expect((await describeOf(page)).some((d) => d.kind === 'object')).toBe(false);
    const on = await screenAt(page, { x: 106, y: 12 });
    expect(await picks(page, on)).toEqual({ object: 'chest' });
    await page.evaluate(([p]) => window.Loom.battle.hover(p, window.Loom.engine.camera.view), [on]);
    await frame(page);
    expect(await page.evaluate(() => window.Loom.battle.lit())).toEqual({ hit: 'chest' });
    expect((await page.evaluate(() => window.Loom.battle.drawn())).lit).toBe(true);
    expect(page.errors).toEqual([]);
    await page.close();
  });
});
