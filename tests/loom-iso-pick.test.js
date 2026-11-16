'use strict';

/**
 * Seeing and picking in the isometric view, in headless Chrome
 * (public/apps/loom/js/battle.js and paint.js; planning/isometric-view.md
 * §4.3, IS4, IN1; L-953 / #859), on the real map engine
 * (fixtures/paint/drawers.html, isometric by default since L-953):
 *
 *   - in the test dungeon, every door (shut, ajar, locked, glazed) picked by
 *     a click on its drawn panel and on the wall over it, in both wall
 *     directions, its menu opening; a tap on a phone picks the same way;
 *   - a chest's picture opens its menu with its card; a token standing
 *     behind a low object is picked by its picture, the object where it
 *     covers the token; walls fall through to the floor;
 *   - a hover lights what a click picks, and the door it would pick doesn't
 *     fade for it while the wall in front of the floor does;
 *   - a wall in front of the player fades, judged by footprint;
 *   - walls-low drops every wall of a generated interior to a stub, so
 *     every room's floor shows, against its screenshot; remembered on the
 *     device; and raised again.
 *
 * Skipped, with a note, where Playwright's Chromium is missing. To make the
 * screenshot again after a deliberate change to the drawing:
 * UPDATE_PAINT=1 npx jest loom-iso-pick.
 *
 * Run: cd tests && npx jest loom-iso-pick --verbose
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
let devices = null;
try {
  ({ chromium, devices } = require('playwright'));
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
    objects: [],
    fog: {
      seen: seen.pack(inSight, made.width, made.height),
      inSight: seen.pack(inSight, made.width, made.height),
      view: sight.outline(map, viewer, {}),
    },
    ...extra,
  };
}

// The test dungeon, its doors named by their ids; standing in the hall.
const HALL = { cell: { x: 14, y: 4 }, point: { x: 72.5, y: 22.5 } };
function dungeonData(extra, viewer = HALL) {
  const g = dungeon();
  g.doors.forEach((d) => {
    d.name = d.id;
  });
  return battleOf('dungeon', { width: 24, height: 16, geometry: g }, viewer, extra);
}

function interiorData() {
  // Standing in its middle room (room-7: 50–80 ft by 30–60 ft).
  const made = generators.generate('interior', { seed: 'three-quarter' });
  return {
    made,
    data: battleOf('interior', made, { cell: { x: 13, y: 9 }, point: { x: 67.5, y: 47.5 } }),
  };
}

const TURN = {
  n: 1,
  ap: 20,
  pool: 20,
  prices: { move: 1, difficult: 2, door: 2, doors: {}, actions: { object: 2 }, features: {} },
  plan: null,
};

// The chest there is something to do with (L-926), as the server sends it.
const CHEST = {
  id: 'chest',
  name: 'iron-bound chest',
  state: 'closed',
  description: 'A heavy chest, bound in iron.',
  actions: [{ id: 'open', name: 'Open', cost: 2 }],
};

async function isoPage(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 960, height: 640 },
    ...options,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/fixtures/paint/drawers.html');
  page.errors = errors;
  page.done = () => context.close();
  return page;
}

const show = (page, data, turn = TURN, level = 'battle') =>
  page.evaluate(([d, t, l]) => window.__show(d, t, l), [data, turn, level]);

const frame = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// Shows a map and waits for the classic set to have painted it, then shows
// it again (drawn with the set's art).
async function shown(page, data, turn = TURN) {
  await show(page, data, turn);
  await page.waitForFunction(
    (k) => {
      const drawn = window.Loom.mapPaint.describe(k) || [];
      return (
        window.Loom.materials.setOf('classic') &&
        drawn.some((d) => typeof d.art === 'string' && d.art.includes('/art/sets/classic/'))
      );
    },
    'battle:' + data.id,
    { timeout: 15000 }
  );
  await show(page, data, turn);
  await frame(page);
}

// Where a floor point in feet, `h` feet up, is drawn on the screen.
const screenAt = (page, p, h = 0) =>
  page.evaluate(
    ([x, y, ft]) => {
      const B = window.Loom.battle;
      const a = B.mapPoint({ x: 0, y: 0 });
      const b = B.mapPoint({ x: 5, y: 0 });
      const perFoot = (b.x - a.x) / 5; // scene units a foot
      const m = B.mapPoint({ x, y });
      const s = window.Loom.mapMath.toScreen(
        window.Loom.engine.camera.view,
        m.x,
        m.y - ft * 1.22 * perFoot
      );
      return { x: Math.round(s.x), y: Math.round(s.y) };
    },
    [p.x, p.y, h]
  );

const picks = (page, s) => page.evaluate(([p]) => window.Loom.battle.picks(p), [s]);

const tap = (page, s) =>
  page.evaluate(([p]) => window.Loom.battle.tap(p, window.Loom.engine.camera.view), [s]);

const menu = (page) =>
  page.evaluate(() => {
    const m = document.querySelector('.loom-map-menu');
    return m ? m.textContent : null;
  });

const closeMenu = (page) =>
  page.evaluate(() => {
    window.Loom.engine.closeMenu();
  });

// A door's panel and the wall over it, on its face toward the camera: its
// middle, half its wall's thickness toward the camera, 3 ft and 7.5 ft up.
// The ajar one's panel is its leaf, swung 75° on its hinge.
const DOORS = [
  // id, state, the face's middle on the floor, the leaf's middle (open)
  { id: 'shut', state: 'closed', face: { x: 60.5, y: 17.5 } },
  {
    id: 'ajar',
    state: 'open',
    face: { x: 60.5, y: 32.5 },
    leaf: {
      x: 60 + 2.5 * Math.cos((165 * Math.PI) / 180),
      y: 30 + 2.5 * Math.sin((165 * Math.PI) / 180),
    },
  },
  { id: 'vault', state: 'locked', face: { x: 77.5, y: 45.5 } },
  { id: 'pane', state: 'closed', face: { x: 102.5, y: 45.5 } },
];

describe('seeing and picking in isometric (L-953)', () => {
  withBrowser(
    'every door is picked on its panel and on the wall over it, in both directions',
    async () => {
      const page = await isoPage();
      expect(await page.evaluate(() => window.Loom.battle.iso())).toBe(true);
      await shown(page, dungeonData());
      for (const door of DOORS) {
        const panel = await screenAt(page, door.leaf || door.face, 3);
        const over = await screenAt(page, door.face, 7.5);
        expect([door.id, await picks(page, panel)]).toEqual([door.id, { door: door.id }]);
        expect([door.id, await picks(page, over)]).toEqual([door.id, { door: door.id }]);
        // A click on each opens the door's menu.
        for (const at of [panel, over]) {
          await closeMenu(page);
          await tap(page, at);
          const text = await menu(page);
          expect(text).toContain(door.id.charAt(0).toUpperCase() + door.id.slice(1));
          expect(text).toContain('Door · ' + door.state);
        }
      }
      // Beside a door, on the floor in front of its wall: the square.
      const floor = await screenAt(page, { x: 67.5, y: 17.5 }, 0);
      expect(await picks(page, floor)).toEqual({ cell: { x: 13, y: 3 } });
      // The wall's face, not a door: it falls through to the floor behind it.
      const wall = await screenAt(page, { x: 60.5, y: 7.5 }, 4);
      const behind = await picks(page, wall);
      expect(behind.cell).toBeTruthy();
      expect(behind.cell.x).toBeLessThan(12); // west of the wall at 60 ft
      expect(page.errors).toEqual([]);
      await page.done();
    }
  );

  withBrowser('a real click, and a tap on a phone, pick the same door', async () => {
    const page = await isoPage();
    await shown(page, dungeonData());
    const over = await screenAt(page, DOORS[0].face, 7.5);
    await page.mouse.click(over.x, over.y);
    await page.waitForSelector('.loom-map-menu', { timeout: 3000 });
    expect(await menu(page)).toContain('Shut');
    await page.done();

    const phone = await isoPage({
      ...devices['Pixel 7'],
      viewport: { width: 960, height: 640 },
      deviceScaleFactor: 1,
    });
    await shown(phone, dungeonData());
    const panel = await screenAt(phone, DOORS[2].face, 3);
    await phone.touchscreen.tap(panel.x, panel.y);
    await phone.waitForSelector('.loom-map-menu', { timeout: 3000 });
    expect(await menu(phone)).toContain('Vault');
    expect(phone.errors).toEqual([]);
    await phone.done();
  });

  withBrowser(
    "a chest's picture opens its menu; a token behind it is picked by its picture",
    async () => {
      const page = await isoPage();
      // Someone standing just behind the chest (north-west of it, further from
      // the camera), so its picture covers their foot.
      const guard = {
        id: 'guard',
        name: 'Guard',
        x: 20,
        y: 1,
        point: { x: 104, y: 9.5 },
        side: 'neutral',
      };
      await shown(page, dungeonData({ objects: [CHEST], people: [guard] }));
      // The chest's picture: its menu, with its card.
      const chest = await screenAt(page, { x: 105, y: 12 }, 1);
      expect(await picks(page, chest)).toEqual({ object: 'chest' });
      await tap(page, chest);
      const text = await menu(page);
      expect(text).toContain('Iron-bound chest');
      expect(text).toContain('A heavy chest, bound in iron.');
      expect(text).toContain('Open');
      await closeMenu(page);
      // The guard stands behind the chest in the order.
      const order = await page.evaluate(() =>
        window.Loom.mapPaint
          .describe('battle:dungeon')
          .filter((d) => d.layer === 'standing')
          .map((d) => d.id)
      );
      expect(order.indexOf('guard')).toBeLessThan(order.indexOf('chest'));
      // Their disc, rising over the chest, picks them; their foot, which the
      // chest covers, picks the chest.
      const token = await page.evaluate(() => {
        const t = window.Loom.battle.tokens().find((x) => x.id === 'guard');
        const view = window.Loom.engine.camera.view;
        const M = window.Loom.mapMath;
        const lift = window.Loom.draw.standHeight() - 1;
        const disc = M.toScreen(view, t.x, t.y - lift * t.radius);
        const foot = M.toScreen(view, t.x, t.y - 0.1 * t.radius);
        return {
          disc: { x: Math.round(disc.x), y: Math.round(disc.y) },
          foot: { x: Math.round(foot.x), y: Math.round(foot.y) },
        };
      });
      expect(await picks(page, token.disc)).toEqual({ person: 'guard' });
      expect(await picks(page, token.foot)).toEqual({ object: 'chest' });
      // A click on the disc: the guard's square, and their menu.
      await tap(page, token.disc);
      expect(await menu(page)).toContain('Guard');
      // Your own token picks your square.
      const you = await page.evaluate(() => {
        const t = window.Loom.battle.drawn().you;
        const view = window.Loom.engine.camera.view;
        const s = window.Loom.mapMath.toScreen(view, t.x, t.y - 20);
        return { x: Math.round(s.x), y: Math.round(s.y) };
      });
      expect(await picks(page, you)).toEqual({ person: 'you' });
      expect(page.errors).toEqual([]);
      await page.done();
    }
  );

  withBrowser(
    'a hover lights what a click picks, which never fades for the pointer',
    async () => {
      const page = await isoPage();
      await shown(page, dungeonData());
      // Over the shut door's wall: the door lit, not faded.
      const over = await screenAt(page, DOORS[0].face, 7.5);
      await page.evaluate(
        ([p]) => window.Loom.battle.hover(p, window.Loom.engine.camera.view),
        [over]
      );
      await page.waitForTimeout(250);
      await frame(page);
      expect(await page.evaluate(() => window.Loom.battle.lit())).toEqual({ hit: 'door:shut' });
      const shut = await page.evaluate(() =>
        window.Loom.mapPaint
          .describe('battle:dungeon')
          .filter((d) => d.kind === 'door' && d.id === 'shut')
      );
      expect(shut.length).toBeGreaterThan(0);
      shut.forEach((d) => expect(d.faded).toBeFalsy());
      expect((await page.evaluate(() => window.Loom.battle.drawn())).lit).toBe(true);
      // Over the west wall's face away from any door: the floor behind it lit
      // (a square), and the wall piece over the pointer fades.
      const wall = await screenAt(page, { x: 60.5, y: 7.5 }, 4);
      await page.evaluate(
        ([p]) => window.Loom.battle.hover(p, window.Loom.engine.camera.view),
        [wall]
      );
      await page.waitForTimeout(250);
      const lit = await page.evaluate(() => window.Loom.battle.lit());
      expect(lit.cell).toBeTruthy();
      const west = await page.evaluate(() =>
        window.Loom.mapPaint
          .describe('battle:dungeon')
          .filter((d) => d.kind === 'wall' && d.id === 'west')
      );
      expect(west.some((d) => d.faded)).toBe(true);
      // Off the map: nothing lit, nothing faded for the pointer.
      await page.evaluate(() => window.Loom.battle.hover(null));
      await page.waitForTimeout(250);
      expect(await page.evaluate(() => window.Loom.battle.lit())).toBe(null);
      await frame(page);
      expect((await page.evaluate(() => window.Loom.battle.drawn())).lit).toBe(false);
      expect(page.errors).toEqual([]);
      await page.done();
    }
  );

  withBrowser('a wall in front of the player fades, judged by footprint', async () => {
    const page = await isoPage();
    // Standing just north of the brick wall at 45 ft, which stands between
    // you and the camera (to the south-east).
    await shown(
      page,
      dungeonData({}, { cell: { x: 17, y: 8 }, point: { x: 87.5, y: 42.5 } })
    );
    await page.waitForTimeout(250);
    const drawn = await page.evaluate(() => window.Loom.mapPaint.describe('battle:dungeon'));
    const south = drawn.filter((d) => d.kind === 'wall' && d.id === 'south');
    expect(south.some((d) => d.faded)).toBe(true);
    // Only the stretch in front of you: the rest of it, and the walls behind
    // you, stand whole.
    expect(south.some((d) => !d.faded)).toBe(true);
    const outer = drawn.filter((d) => d.kind === 'wall' && d.id === 'outer');
    expect(outer.filter((d) => d.faded).length).toBe(0);
    expect(page.errors).toEqual([]);
    await page.done();
  });

  withBrowser(
    'walls-low shows every room of a generated interior, remembered, then restores it',
    async () => {
      const { made, data } = interiorData();
      data.fog = null; // all of it seen, so every room shows
      const page = await isoPage();
      expect(await page.evaluate(() => window.Loom.battle.wallsLow())).toBe(false);
      await shown(page, data);
      // Each room's middle, as the floor is drawn, and whether a wall's drawn
      // outline covers it; and the tallest wall piece's top (feet × 1.22).
      const rooms = made.geometry.ground
        .filter((g) => g.shape && g.shape.rect && g.shape.rect.w < made.width * 5)
        .map((g) => ({
          x: g.shape.rect.x + g.shape.rect.w / 2,
          y: g.shape.rect.y + g.shape.rect.h / 2,
        }));
      expect(rooms.length).toBeGreaterThan(3);
      const look = () =>
        page.evaluate(
          ([rs]) => {
            const P = window.Loom.mapPaint;
            const walls = P.standOf('battle:interior').children.filter(
              (c) => c.__loomPainted && c.__loomPainted.kind === 'wall'
            );
            const inside = (poly, p) => {
              let hit = false;
              for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const a = poly[i];
                const b = poly[j];
                if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
                  hit = !hit;
              }
              return hit;
            };
            return {
              top: Math.max(...walls.map((w) => w.__loomRise[1])),
              hidden: rs.filter((r) => {
                const at = window.Loom.iso.P(r, 0);
                return walls.some((w) => inside(P.outlineOf(w), at));
              }).length,
            };
          },
          [rooms]
        );
      const up = await look();
      expect(up.top).toBeCloseTo(8 * 1.22, 5);
      expect(up.hidden).toBeGreaterThan(0);
      // Down: every wall a 2 ft stub, every room's middle in view.
      await page.evaluate(() => window.Loom.battle.setWallsLow(true));
      await show(page, data);
      await page.waitForFunction(
        () =>
          window.Loom.mapPaint
            .standOf('battle:interior')
            .children.filter(
              (c) =>
                c.__loomPainted &&
                ['wall', 'door', 'window'].includes(c.__loomPainted.kind) &&
                c.__loomRise
            )
            .every((w) => w.__loomRise[1] <= 2 * 1.22 + 1e-6),
        null,
        { timeout: 10000 }
      );
      await frame(page);
      const low = await look();
      expect(low.top).toBeCloseTo(2 * 1.22, 5);
      expect(low.hidden).toBe(0);
      // Doors and windows drop with their walls.
      const others = await page.evaluate(() =>
        Math.max(
          ...window.Loom.mapPaint
            .standOf('battle:interior')
            .children.filter(
              (c) =>
                c.__loomPainted && ['door', 'window'].includes(c.__loomPainted.kind) && c.__loomRise
            )
            .map((w) => w.__loomRise[1])
        )
      );
      expect(others).toBeLessThanOrEqual(2 * 1.22 + 1e-6);
      matchesBaseline(PNG.sync.read(await page.screenshot()), 'iso-walls-low.png');
      // Remembered on the device: a new visit opens with the walls low.
      expect(
        await page.evaluate(() => window.localStorage.getItem('loom.wallsLow.anyone'))
      ).toBe('1');
      await page.reload();
      expect(await page.evaluate(() => window.Loom.battle.wallsLow())).toBe(true);
      // Raised again: as they were.
      await page.evaluate(() => window.Loom.battle.setWallsLow(false));
      await shown(page, data);
      await page.waitForFunction(
        () =>
          window.Loom.mapPaint
            .standOf('battle:interior')
            .children.filter((c) => c.__loomPainted && c.__loomPainted.kind === 'wall')
            .some((w) => w.__loomRise[1] > 8),
        null,
        { timeout: 10000 }
      );
      const again = await look();
      expect(again).toEqual(up);
      expect(page.errors).toEqual([]);
      await page.done();
    }
  );
});
