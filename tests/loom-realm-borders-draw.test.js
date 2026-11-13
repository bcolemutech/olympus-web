'use strict';

/**
 * Realm borders in play (planning/worlds-without-azgaar.md §4.4, R8; L-714 /
 * #819), in headless Chrome: the world view (public/apps/loom/js/world.js) on
 * the real map engine (fixtures/paint/drawers.html), given a region map as
 * loomGetMap sends it:
 *
 *   - with no image and two realms, both edges and both names are drawn: the
 *     screenshot differs from the same map without realms along the border,
 *     on its inside only, and at each name, and nowhere else;
 *   - with an image, nothing extra is drawn (the screenshot is the same with
 *     the realms and without);
 *   - the same realms sent again aren't built again; new ones are;
 *   - a realm out of the view isn't drawn, and comes back with the camera.
 *
 * It needs Playwright and its Chromium: where the browser is missing the
 * suite is skipped, with a note.
 *
 * Run: cd tests && npx jest loom-realm-borders-draw --verbose
 */

const { PNG } = require('pngjs');
const geo = require('../functions/loom-canon/map-geometry');
const { bordersOn } = require('../functions/loom-canon/realm-borders');
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

// A region map 1000 × 1000 of grassland, the Crown in the west half and the
// Free Cities (no colour of its own) in the east, as the server draws their
// borders.
const world = {
  id: 'w',
  maps: {
    top: {
      kind: 'region',
      space: { width: 1000, height: 1000 },
      geometry: geo.normalize({
        zones: [
          { id: 'west', region: 'reg_w', shape: { rect: { x: 0, y: 0, w: 500, h: 1000 } } },
          { id: 'east', region: 'reg_e', shape: { rect: { x: 500, y: 0, w: 500, h: 1000 } } },
        ],
      }),
    },
  },
  regions: {
    reg_w: { id: 'reg_w', name: 'West', factionId: 'fac_w' },
    reg_e: { id: 'reg_e', name: 'East', factionId: 'fac_e' },
  },
  factions: {
    fac_w: { id: 'fac_w', name: 'The Crown', politics: { color: '#d0543f' } },
    fac_e: { id: 'fac_e', name: 'The Free Cities' },
  },
};

function regionMap({ image = null, realms = true } = {}) {
  return {
    mapId: 'top',
    here: null,
    places: [],
    links: [],
    map: {
      width: 1000,
      height: 1000,
      image,
      backdrop: '#1c2a44',
      geometry: geo.normalize({
        ground: [
          { id: 'land', material: 'grassland', shape: { rect: { x: 0, y: 0, w: 1000, h: 1000 } } },
        ],
      }),
      space: { width: 1000, height: 1000 },
      ...(realms ? { realms: bordersOn(world, 'top') } : {}),
    },
  };
}

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.errors = errors;
  await page.goto(origin + '/fixtures/paint/drawers.html');
  return page;
}

// Shows the map, then its panel as pixels.
async function shot(page, data) {
  await page.evaluate(([d]) => window.__show(d, null, 'world'), [data]);
  return PNG.sync.read(await page.locator('#panel').screenshot());
}

// Where two screenshots differ: the least and greatest x and y, and how many
// pixels differ, in a box (the whole shot without one).
function differ(a, b, box) {
  const out = { count: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  const [bx0, by0, bx1, by1] = box || [0, 0, a.width, a.height];
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const i = (y * a.width + x) * 4;
      if (
        Math.abs(a.data[i] - b.data[i]) +
          Math.abs(a.data[i + 1] - b.data[i + 1]) +
          Math.abs(a.data[i + 2] - b.data[i + 2]) >
        6
      ) {
        out.count++;
        out.x0 = Math.min(out.x0, x);
        out.x1 = Math.max(out.x1, x);
        out.y0 = Math.min(out.y0, y);
        out.y1 = Math.max(out.y1, y);
      }
    }
  }
  return out;
}

// Waits for the engine to have drawn what was asked of it (it draws on the next frame).
const settle = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

describe('the world view with realms', () => {
  withBrowser('a map with no image: both edges and both names are drawn', async () => {
    const page = await newPage();
    const without = await shot(page, regionMap({ realms: false }));
    expect(await page.evaluate(() => Loom.world.realmsDrawn())).toEqual([]);
    const withRealms = await shot(page, regionMap());

    const drawn = await page.evaluate(() => Loom.world.realmsDrawn());
    expect(drawn.map((r) => [r.id, r.name, r.shown])).toEqual([
      ['fac_e', 'THE FREE CITIES', true],
      ['fac_w', 'THE CROWN', true],
    ]);

    // The border between them is at the middle of the panel; a soft edge lies
    // on each side of it, and only there and at the names.
    const middle = withRealms.width / 2;
    const near = differ(without, withRealms, [
      Math.round(middle) - 40,
      0,
      Math.round(middle) + 40,
      without.height,
    ]);
    expect(near.count).toBeGreaterThan(500);
    // Both sides: the west's edge inside the west, the east's inside the east.
    const west = differ(without, withRealms, [Math.round(middle) - 40, 0, Math.round(middle), 640]);
    const east = differ(without, withRealms, [Math.round(middle), 0, Math.round(middle) + 40, 640]);
    expect(west.count).toBeGreaterThan(200);
    expect(east.count).toBeGreaterThan(200);

    // The edge is soft, from the border in, and the colour of its realm: the
    // west is redder at the border, then no more beyond the edge's reach.
    const at = (png, x, y) => {
      const i = (y * png.width + x) * 4;
      return [png.data[i], png.data[i + 1], png.data[i + 2]];
    };
    const y = 120;
    const borderNear = at(withRealms, Math.round(middle) - 2, y);
    const borderBase = at(without, Math.round(middle) - 2, y);
    expect(borderNear[0] - borderBase[0]).toBeGreaterThan(10);
    const farther = at(withRealms, Math.round(middle) - 25, y);
    const fartherBase = at(without, Math.round(middle) - 25, y);
    expect(borderNear[0] - borderBase[0]).toBeGreaterThan(farther[0] - fartherBase[0]);

    // Nowhere else but each name: the centres of the two halves (names), the
    // border, the panel's outer edges (the west's and east's own edges). The
    // middle of each half, away from its name, is as it was.
    const clear = differ(without, withRealms, [
      Math.round(middle) - 250,
      Math.round(640 * 0.2),
      Math.round(middle) - 60,
      Math.round(640 * 0.4),
    ]);
    expect(clear.count).toBe(0);

    // A name at the centre of each realm's land: in the half it names.
    const [east1, west1] = drawn;
    expect(west1.x).toBeLessThan(middle);
    expect(east1.x).toBeGreaterThan(middle);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('a map with an image: nothing extra is drawn', async () => {
    const page = await newPage();
    const image = { url: '/fixtures/paint/art.svg', width: 64, height: 64 };
    const without = await shot(page, regionMap({ image, realms: false }));
    const withRealms = await shot(page, regionMap({ image }));
    expect(await page.evaluate(() => Loom.world.realmsDrawn())).toEqual([]);
    expect(differ(without, withRealms).count).toBe(0);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('the realms sent again aren’t built again; others are', async () => {
    const page = await newPage();
    await shot(page, regionMap());
    const built = await page.evaluate(() => Loom.world.realmBuilds());
    expect(built).toBe(1);
    // The same realms in a new result (every turn sends one): not built again.
    await page.evaluate(([d]) => Loom.world.setData(d), [regionMap()]);
    await page.evaluate(() => Loom.engine.draw());
    await settle(page);
    expect(await page.evaluate(() => Loom.world.realmBuilds())).toBe(1);
    expect(await page.evaluate(() => Loom.world.realmsDrawn().length)).toBe(2);

    // A realm taken away is no longer drawn.
    const one = regionMap();
    one.map.realms = one.map.realms.filter((r) => r.id === 'fac_w');
    await page.evaluate(([d]) => Loom.world.setData(d), [one]);
    await page.evaluate(() => Loom.engine.draw());
    await settle(page);
    expect(await page.evaluate(() => Loom.world.realmsDrawn().map((r) => r.id))).toEqual(['fac_w']);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('a realm out of the view isn’t drawn, and comes back with the camera', async () => {
    const page = await newPage();
    await shot(page, regionMap());
    // Zoomed on the far east corner: the Crown, in the west, is out of view.
    await page.evaluate(() => {
      // 220 units of the far east corner across the panel.
      const size = Loom.engine.size();
      const scale = size.width / 220;
      Loom.engine.setView({ x: -780 * scale, y: -600 * scale, scale });
      Loom.engine.draw();
    });
    await settle(page);
    const away = await page.evaluate(() =>
      Object.fromEntries(Loom.world.realmsDrawn().map((r) => [r.id, r.shown]))
    );
    expect(away).toEqual({ fac_e: true, fac_w: false });
    await page.evaluate(() => {
      const size = Loom.engine.size();
      Loom.engine.setView(
        Loom.mapMath.fit(
          [
            { x: 0, y: 0 },
            { x: 1000, y: 1000 },
          ],
          size,
          { width: 1000, height: 1000 }
        )
      );
      Loom.engine.draw();
    });
    await settle(page);
    const back = await page.evaluate(() =>
      Object.fromEntries(Loom.world.realmsDrawn().map((r) => [r.id, r.shown]))
    );
    expect(back).toEqual({ fac_e: true, fac_w: true });
    expect(page.errors).toEqual([]);
    await page.close();
  });
});
