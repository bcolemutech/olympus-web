'use strict';

/**
 * The grid's isometric view in headless Chrome (public/apps/loom/js/battle.js;
 * planning/isometric-view.md §4.1, IS1, IS2, IN2, C2; L-951 / #857), on the
 * real map engine (fixtures/paint/drawers.html, opened with `?view=iso`; the
 * default since L-953, `?view=tq` the three-quarter view):
 *
 *   - the test dungeon and a generated interior drawn isometric (the floor,
 *     and since L-952 the walls, doors and objects standing on it), against
 *     their screenshots; the camera framing the whole diamond, with room
 *     above it for the walls to rise into;
 *   - a click on the floor lands within half a foot of the point in feet, as
 *     the floor is actually drawn, across the map, at two zooms, and selects
 *     the square under it; the 5 ft diamonds show only while a move or an
 *     aim is being chosen (IN2);
 *   - the path preview's cost over its square, a walk along its path, and a
 *     foe's turn with its card over its token, in place on the isometric
 *     screen;
 *   - the minimap's diamond;
 *   - zooming from a town into the grid and back, and the town drawn the
 *     same with the switch as without.
 *
 * Skipped, with a note, where Playwright's Chromium is missing. To make the
 * screenshots again after a deliberate change to the drawing:
 * UPDATE_PAINT=1 npx jest loom-iso-view.
 *
 * Run: cd tests && npx jest loom-iso-view --verbose
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
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

// A grid map as loomGetMap sends it, seen from `viewer` ({ cell, point }).
function battleOf(id, made, viewer, extra = {}) {
  const g = geo.normalize(made.geometry);
  const map = {
    id,
    width: made.width,
    height: made.height,
    geometry: g,
    entries: made.entries || [],
    exits: made.exits || [],
  };
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
    fog: {
      seen: seen.pack(inSight, made.width, made.height),
      inSight: seen.pack(inSight, made.width, made.height),
      view: sight.outline(map, viewer, {}),
    },
    ...extra,
  };
}

const dungeonData = (extra) =>
  battleOf(
    'dungeon',
    { width: 24, height: 16, geometry: dungeon() },
    { cell: { x: 14, y: 4 }, point: { x: 72.5, y: 22.5 } },
    extra
  );

function interiorData() {
  // Standing in its middle room (room-7: 50–80 ft by 30–60 ft).
  const made = generators.generate('interior', { seed: 'three-quarter' });
  return battleOf('interior', made, { cell: { x: 13, y: 9 }, point: { x: 67.5, y: 47.5 } });
}

const TURN = {
  n: 1,
  ap: 20,
  pool: 20,
  prices: { move: 1, difficult: 2, door: 2, doors: {}, actions: {}, features: {} },
  plan: null,
};

async function isoPage(query = '?view=iso') {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/fixtures/paint/drawers.html' + query);
  page.errors = errors;
  return page;
}

const show = (page, data, turn = TURN, level = 'battle') =>
  page.evaluate(([d, t, l]) => window.__show(d, t, l), [data, turn, level]);

// The classic set's manifest loaded, and the map painted with it.
const painted = (page, key) =>
  page.waitForFunction(
    (k) => {
      const drawn = window.Loom.mapPaint.describe(k) || [];
      return (
        window.Loom.materials.setOf('classic') &&
        drawn.some((d) => typeof d.art === 'string' && d.art.includes('/art/sets/classic/'))
      );
    },
    key,
    { timeout: 15000 }
  );

// Where floor points in feet are actually drawn on the screen: through the
// painter's root (its units feet) and every transform above it.
const drawnAt = (page, key, points) =>
  page.evaluate(
    ([k, ps]) => {
      // The painter's standing layer is in the grid's own, on the scene.
      const scene = window.Loom.mapPaint.standOf(k).parent.parent;
      const floor = scene.children[0];
      // The floor's painter root: the one container in it in feet (PAD, TOP, CELL / 5).
      const painted = floor.children.find((c) => c.children[0] && c.children[0].__loomPaint);
      const root = painted.children[0];
      return ps.map((p) => {
        const s = root.toGlobal({ x: p.x, y: p.y });
        return { x: s.x, y: s.y };
      });
    },
    [key, points]
  );

const screenOf = (page, p) =>
  page.evaluate(
    ([x, y]) => {
      const m = window.Loom.battle.mapPoint({ x, y });
      return window.Loom.mapMath.toScreen(window.Loom.engine.camera.view, m.x, m.y);
    },
    [p.x, p.y]
  );

describe('the isometric view (L-951)', () => {
  withBrowser('the test dungeon, isometric, against its screenshot', async () => {
    const page = await isoPage();
    expect(await page.evaluate(() => window.Loom.battle.iso())).toBe(true);
    await show(page, dungeonData());
    await painted(page, 'battle:dungeon');
    await show(page, dungeonData()); // drawn again once its set has come
    const drawn = await page.evaluate(() => window.Loom.mapPaint.describe('battle:dungeon'));
    // Walls, doors and objects stand (L-952); nothing lies flat in their place.
    const standing = drawn.filter((d) => d.layer === 'standing');
    expect(standing.some((d) => d.kind === 'wall' && d.id === 'slant')).toBe(true);
    expect(new Set(standing.filter((d) => d.kind === 'door').map((d) => d.id)).size).toBe(4);
    expect(standing.some((d) => d.kind === 'object' && d.id === 'chest')).toBe(true);
    expect(drawn.some((d) => d.layer === 'walls' || d.layer === 'openings')).toBe(false);
    // Framed whole: the diamond's four corners on the screen, with room above
    // the north one for an 8 ft wall at the true 2:1 rise (C2: 78 px at 8 px a foot).
    const frame = await page.evaluate(() => {
      const B = window.Loom.battle;
      const M = window.Loom.mapMath;
      const view = window.Loom.engine.camera.view;
      const corners = [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 80 },
        { x: 0, y: 80 },
      ].map((p) => {
        const m = B.mapPoint(p);
        return M.toScreen(view, m.x, m.y);
      });
      return { corners, north: B.mapPoint({ x: 0, y: 0 }), size: window.Loom.engine.size() };
    });
    frame.corners.forEach((c) => {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(frame.size.width);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(frame.size.height);
    });
    // North to the top right, east to the bottom right, a square twice as wide as tall.
    const [nw, ne, se, sw] = frame.corners;
    expect(nw.x).toBeGreaterThan(sw.x);
    expect(nw.y).toBeLessThan(sw.y);
    expect(ne.x).toBeGreaterThan(nw.x);
    expect(ne.y).toBeGreaterThan(nw.y);
    expect(se.y).toBeGreaterThan(Math.max(ne.y, sw.y));
    expect((ne.x - nw.x) / (ne.y - nw.y)).toBeCloseTo(2, 6);
    expect((nw.x - sw.x) / (nw.y - sw.y)).toBeCloseTo(-2, 6);
    expect(frame.north.y).toBeCloseTo(60 + 8 * 1.22 * 8, 5);
    matchesBaseline(PNG.sync.read(await page.screenshot()), 'iso-dungeon.png');
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('a generated interior, isometric, against its screenshot', async () => {
    const page = await isoPage();
    const data = interiorData();
    await show(page, data);
    await painted(page, 'battle:interior');
    await show(page, data);
    const drawn = await page.evaluate(() => window.Loom.mapPaint.describe('battle:interior'));
    expect(drawn.filter((d) => d.layer === 'standing' && d.kind === 'wall').length).toBeGreaterThan(
      0
    );
    matchesBaseline(PNG.sync.read(await page.screenshot()), 'iso-interior.png');
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser(
    'a click on the floor lands within half a foot, across the map, at two zooms',
    async () => {
      const page = await isoPage();
      await show(page, dungeonData());
      const points = [];
      for (let x = 1.5; x < 120; x += 7) for (let y = 0.5; y < 80; y += 4.5) points.push({ x, y });
      // Each point where it's drawn, to the pixel, as a click there would be,
      // worked back to the floor; the worst miss, of those on the screen.
      const check = async () => {
        const drawn = await drawnAt(page, 'battle:dungeon', points);
        const clicks = drawn.map((s) => ({ x: Math.round(s.x), y: Math.round(s.y) }));
        const back = await page.evaluate(
          ([cs]) => {
            const view = window.Loom.engine.camera.view;
            return cs.map((c) =>
              window.Loom.battle.floorPoint(window.Loom.mapMath.toMap(view, c.x, c.y))
            );
          },
          [clicks]
        );
        const on = clicks.filter((c) => c.x >= 0 && c.x < 960 && c.y >= 0 && c.y < 640);
        expect(on.length).toBeGreaterThan(8);
        return Math.max(
          ...points.map((p, i) => {
            const c = clicks[i];
            if (c.x < 0 || c.x >= 960 || c.y < 0 || c.y >= 640) return 0;
            return Math.hypot(back[i].x - p.x, back[i].y - p.y);
          })
        );
      };
      expect(await check()).toBeLessThan(0.5);
      // Zoomed in three times about the middle.
      await page.evaluate(() => {
        const e = window.Loom.engine;
        const v = e.camera.view;
        const c = { x: 480, y: 320 };
        e.setView({ scale: v.scale * 3, x: c.x - (c.x - v.x) * 3, y: c.y - (c.y - v.y) * 3 });
      });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      expect(await check()).toBeLessThan(0.5);
      // A click there selects the square under it, and the 5 ft diamonds show
      // while the move is being chosen (IN2), not before.
      expect((await page.evaluate(() => window.Loom.battle.drawn())).grid).toBe(false);
      const target = { x: 82.5, y: 27.5 };
      const [at] = await drawnAt(page, 'battle:dungeon', [target]);
      await page.evaluate(
        ([p]) => window.Loom.battle.tap(p, window.Loom.engine.camera.view),
        [{ x: Math.round(at.x), y: Math.round(at.y) }]
      );
      await page.waitForSelector('.loom-map-menu', { timeout: 3000 });
      const title = await page.evaluate(() => document.querySelector('.loom-map-menu').textContent);
      expect(title).toContain('Square (16, 5)');
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      expect((await page.evaluate(() => window.Loom.battle.drawn())).grid).toBe(true);
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );

  withBrowser(
    "the path preview, a walk, and a foe's turn with its card play out in place",
    async () => {
      const page = await isoPage();
      const goblin = {
        id: 'gob',
        name: 'Goblin',
        x: 18,
        y: 5,
        point: { x: 92.5, y: 27.5 },
        side: 'hostile',
      };
      await show(page, dungeonData({ people: [goblin] }));
      const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      // The preview to a square: its cost over the square's diamond.
      const target = { x: 82.5, y: 27.5 };
      const s = await screenOf(page, target);
      await page.evaluate(([p]) => window.Loom.battle.tap(p, window.Loom.engine.camera.view), [s]);
      await frame();
      const preview = await page.evaluate(() => window.Loom.battle.drawn());
      const cost = preview.labels.find((l) => /AP$/.test(l.text));
      const there = await page.evaluate(([p]) => window.Loom.battle.mapPoint(p), [target]);
      expect(cost).toBeTruthy();
      expect(Math.abs(cost.x - there.x)).toBeLessThan(1);
      expect(cost.y).toBeLessThan(there.y);
      expect(there.y - cost.y).toBeLessThan(60);
      // The goblin's name under its diamond.
      const name = preview.labels.find((l) => l.text === 'Goblin');
      const gob = await page.evaluate(([p]) => window.Loom.battle.mapPoint(p), [goblin.point]);
      expect(Math.abs(name.x - gob.x)).toBeLessThan(1);
      expect(name.y).toBeGreaterThan(gob.y);
      // Move there: the menu's Move here, then the map as it comes back.
      const walk = await page.evaluate(() => {
        window.__moved = null;
        window.Loom.play.moveToCell = (cell) => {
          window.__moved = cell;
        };
        const item = [...document.querySelectorAll('.loom-map-menu button')].find((b) =>
          /Move here/.test(b.textContent)
        );
        item.click();
        return window.__moved;
      });
      expect(walk).toEqual({ x: 16, y: 5 });
      const moved = dungeonData({ people: [goblin] });
      moved.here = { x: 16, y: 5 };
      moved.herePoint = target;
      const landing = show(page, moved);
      // While the token walks: its foot, worked back to the floor, on the way
      // from where it stood (72.5, 22.5) to the square (82.5, 27.5).
      const onWay = [];
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 40));
        const you = await page.evaluate(() => window.Loom.battle.drawn().you);
        onWay.push(await page.evaluate(([p]) => window.Loom.battle.floorPoint(p), [you]));
      }
      await landing;
      onWay.forEach((p) => {
        expect(p.x).toBeGreaterThan(72.5 - 0.5);
        expect(p.x).toBeLessThan(82.5 + 0.5);
        expect(p.y).toBeGreaterThan(22.5 - 0.5);
        expect(p.y).toBeLessThan(27.5 + 0.5);
      });
      await new Promise((r) => setTimeout(r, 400));
      const end = await page.evaluate(() => window.Loom.battle.drawn().you);
      const endFloor = await page.evaluate(([p]) => window.Loom.battle.floorPoint(p), [end]);
      expect(Math.hypot(endFloor.x - target.x, endFloor.y - target.y)).toBeLessThan(0.5);
      // The goblin's turn: it steps west and strikes; its card over its token.
      await page.evaluate(() =>
        window.Loom.battle.playOut([
          {
            id: 'gob',
            points: [{ x: 87.5, y: 27.5 }],
            attack: { hit: true, damage: 3, card: { total: 15, difficulty: 12 } },
          },
        ])
      );
      await page.waitForFunction(() => window.Loom.battle.drawn().cards.length > 0, null, {
        timeout: 3000,
      });
      const during = await page.evaluate(() => ({
        drawn: window.Loom.battle.drawn(),
        tokens: window.Loom.battle.tokens(),
      }));
      const card = during.drawn.cards[0];
      expect(card.text).toBe('15 vs 12 · hit 3');
      const token = during.tokens.find((t) => t.id === 'gob');
      const tokenFloor = await page.evaluate(([p]) => window.Loom.battle.floorPoint(p), [token]);
      expect(Math.hypot(tokenFloor.x - 87.5, tokenFloor.y - 27.5)).toBeLessThan(0.5);
      expect(Math.abs(card.x - token.x)).toBeLessThan(1);
      expect(card.y).toBeLessThan(token.y);
      await page.waitForFunction(() => !window.Loom.battle.playing(), null, { timeout: 5000 });
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );

  withBrowser("the minimap shows the grid's diamond, and you on it", async () => {
    const page = await isoPage();
    await show(page, dungeonData());
    const mini = await page.evaluate(() => {
      const B = window.Loom.battle;
      return {
        mini: B.minimap(),
        corners: [
          { x: 0, y: 0 },
          { x: 120, y: 0 },
          { x: 120, y: 80 },
          { x: 0, y: 80 },
        ].map(B.mapPoint),
        here: B.herePoint(),
      };
    });
    mini.corners.forEach((c, i) => {
      expect(mini.mini.rect.shape[i].x).toBeCloseTo(c.x, 6);
      expect(mini.mini.rect.shape[i].y).toBeCloseTo(c.y, 6);
    });
    const r = mini.mini.rect;
    mini.corners.forEach((c) => {
      expect(c.x).toBeGreaterThanOrEqual(r.x - 1e-6);
      expect(c.x).toBeLessThanOrEqual(r.x + r.width + 1e-6);
      expect(c.y).toBeGreaterThanOrEqual(r.y - 1e-6);
      expect(c.y).toBeLessThanOrEqual(r.y + r.height + 1e-6);
    });
    const me = mini.mini.points[mini.mini.points.length - 1];
    expect([me.x, me.y]).toEqual([mini.here.x, mini.here.y]);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('zooming from a town into the grid and back; the town unchanged', async () => {
    const town = {
      locationId: 'pl_keep',
      name: 'The Keep',
      here: null,
      at: null,
      next: [],
      places: [],
      links: [],
      exits: [],
      image: null,
      geometry: geo.normalize({
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
      }),
      space: { width: 1000, height: 1000 },
    };
    // The town drawn the same in either view (isometric the default since L-953).
    const shots = {};
    for (const query of ['?view=tq', '?view=iso']) {
      const page = await isoPage(query);
      await show(page, town, null, 'town');
      shots[query] = {
        png: PNG.sync.read(await page.screenshot()),
        drawn: await page.evaluate(() => window.Loom.mapPaint.describe('area:pl_keep')),
      };
      expect(page.errors).toEqual([]);
      await page.close();
    }
    expect(shots['?view=iso'].drawn).toEqual(shots['?view=tq'].drawn);
    const a = shots['?view=tq'].png;
    const b = shots['?view=iso'].png;
    expect(pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 })).toBe(0);

    // Into the grid from the town and back out, as map.js zooms between levels.
    const page = await isoPage();
    await show(page, town, null, 'town');
    const zoom = (into) =>
      page.evaluate(
        ([d, t, inward]) =>
          new Promise((resolve) => {
            const L = window.Loom;
            const M = L.mapMath;
            const e = L.engine;
            const size = e.size();
            const centre = { x: size.width / 2, y: size.height / 2 };
            if (inward) {
              window.__townView = e.camera.view;
              L.battle.setData(d, t);
              window.__bounds = () => L.battle.bounds();
              window.__gridView = M.fit(L.battle.framePoints(), size, L.battle.bounds());
            }
            const townView = window.__townView;
            const gridView = window.__gridView;
            const anchor = { x: 500, y: 500 };
            const a = M.toScreen(townView, anchor.x, anchor.y);
            const deepRef = M.toMap(gridView, centre.x, centre.y);
            const small = {
              scale: gridView.scale / 6,
              x: a.x - deepRef.x * (gridView.scale / 6),
              y: a.y - deepRef.y * (gridView.scale / 6),
            };
            const near = {
              scale: townView.scale * 6,
              x: a.x - (a.x - townView.x) * 6,
              y: a.y - (a.y - townView.y) * 6,
            };
            const townSide = { level: 'town', ref: anchor };
            const gridSide = { level: 'battle', ref: deepRef };
            if (inward) {
              Object.assign(townSide, { v0: townView, v1: near });
              Object.assign(gridSide, { v0: small, v1: gridView });
            } else {
              Object.assign(gridSide, { v0: gridView, v1: small });
              Object.assign(townSide, { v0: near, v1: townView });
              window.__bounds = () => L.town.BOUNDS;
            }
            e.transition(inward ? townSide : gridSide, inward ? gridSide : townSide, () => {
              window.__level = inward ? 'battle' : 'town';
              resolve();
            });
          }),
        [dungeonData(), TURN, into]
      );
    await zoom(true);
    expect(await page.evaluate(() => window.Loom.engine.transitioning())).toBe(false);
    await page.waitForFunction(
      () => (window.Loom.mapPaint.describe('battle:dungeon') || []).some((d) => d.kind === 'wall'),
      null,
      { timeout: 10000 }
    );
    // Arrived: you on the screen, in the middle of the grid's diamond.
    const you = await screenOf(page, { x: 72.5, y: 22.5 });
    expect(you.x).toBeGreaterThan(0);
    expect(you.x).toBeLessThan(960);
    expect(you.y).toBeGreaterThan(0);
    expect(you.y).toBeLessThan(640);
    await zoom(false);
    expect(await page.evaluate(() => window.Loom.engine.transitioning())).toBe(false);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('isometric by default (L-953); `?view=tq` keeps the three-quarter view', async () => {
    const plain = await isoPage('');
    expect(await plain.evaluate(() => window.Loom.battle.iso())).toBe(true);
    await plain.close();
    const page = await isoPage('?view=tq');
    expect(await page.evaluate(() => window.Loom.battle.iso())).toBe(false);
    await show(page, dungeonData());
    const drawn = await page.evaluate(() => window.Loom.mapPaint.describe('battle:dungeon'));
    expect(drawn.some((d) => d.layer === 'standing' && d.kind === 'wall')).toBe(true);
    expect(drawn.some((d) => d.layer === 'walls')).toBe(false);
    // The point in feet is where it was: on the flat grid.
    const p = await page.evaluate(() => window.Loom.battle.mapPoint({ x: 10, y: 5 }));
    expect(p.x).toBe(60 + 80);
    // And switched on in the page: drawn isometric.
    await page.evaluate(() => window.Loom.battle.setIso(true));
    await show(page, dungeonData());
    const after = await page.evaluate(() => window.Loom.mapPaint.describe('battle:dungeon'));
    // Standing in isometric (L-952): each wall piece a prism, with its cap.
    const walls = after.filter((d) => d.layer === 'standing' && d.kind === 'wall');
    expect(walls.length).toBeGreaterThan(0);
    walls.forEach((w) => expect(w.shows).toContain('cap'));
    expect(page.errors).toEqual([]);
    await page.close();
  });
});
