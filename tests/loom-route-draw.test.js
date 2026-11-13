'use strict';

/**
 * Routes along their waypoints in the world view (planning/worlds-without-
 * azgaar.md §4.5, PL4; L-715 / #820), in headless Chrome: the world view
 * (public/apps/loom/js/world.js) on the real map engine (fixtures/paint/
 * drawers.html), given a region map as loomGetMap sends it.
 *
 *   - a route with waypoints is drawn along them: the screenshot differs from
 *     the same map with the route straight, along the bend and not along the
 *     straight line it replaces;
 *   - the same route with the same waypoints sent from its other place is
 *     drawn the same;
 *   - the bend is a route to point at (the pointer becomes a hand), the straight
 *     line's middle, now empty, is not, and nor is the ground away from both.
 *
 * It needs Playwright and its Chromium: where the browser is missing the
 * suite is skipped, with a note.
 *
 * Run: cd tests && npx jest loom-route-draw --verbose
 */

const { PNG } = require('pngjs');
const geo = require('../functions/loom-canon/map-geometry');
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

// A region map 1000 × 1000 with two places on its top edge and a route
// between them that, with waypoints, dips to the bottom and comes back.
function regionMap({ waypoints = null, reverse = false } = {}) {
  const a = { id: 'a', name: 'Alder', kind: 'settlement', x: 200, y: 200, open: true };
  const b = { id: 'b', name: 'Birch', kind: 'settlement', x: 800, y: 200, open: true };
  const link = reverse
    ? {
        from: 'b',
        to: 'a',
        via: 'road',
        ...(waypoints ? { waypoints: [...waypoints].reverse() } : {}),
      }
    : { from: 'a', to: 'b', via: 'road', ...(waypoints ? { waypoints } : {}) };
  return {
    mapId: 'top',
    here: 'a',
    places: [a, b],
    links: [link],
    map: {
      width: 1000,
      height: 1000,
      image: null,
      backdrop: '#1c2a44',
      geometry: geo.normalize({
        ground: [
          { id: 'land', material: 'grassland', shape: { rect: { x: 0, y: 0, w: 1000, h: 1000 } } },
        ],
      }),
      space: { width: 1000, height: 1000 },
    },
  };
}

const BENT = [
  [300, 800],
  [700, 800],
];

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.errors = errors;
  await page.goto(origin + '/fixtures/paint/drawers.html');
  return page;
}

async function shot(page, data) {
  await page.evaluate(([d]) => window.__show(d, null, 'world'), [data]);
  return PNG.sync.read(await page.locator('#panel').screenshot());
}

// How many pixels differ in a box.
function differ(a, b, [x0, y0, x1, y1]) {
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      if (
        Math.abs(a.data[i] - b.data[i]) +
          Math.abs(a.data[i + 1] - b.data[i + 1]) +
          Math.abs(a.data[i + 2] - b.data[i + 2]) >
        6
      ) {
        count++;
      }
    }
  }
  return count;
}

// Where a map point is in the panel, through the engine's camera.
const screenOf = (page, x, y) =>
  page.evaluate(([px, py]) => Loom.mapMath.toScreen(Loom.engine.camera.view, px, py), [x, y]);

describe('a route along its waypoints in the world view', () => {
  withBrowser('drawn along the bend, and not along the straight line it replaces', async () => {
    const page = await newPage();
    const straight = await shot(page, regionMap());
    const bent = await shot(page, regionMap({ waypoints: BENT }));
    const at = async (x, y) => screenOf(page, x, y);

    // Around the bend's bottom, the middle of its low run: drawn only when bent.
    const low = await at(500, 800);
    const lowBox = [
      Math.round(low.x) - 20,
      Math.round(low.y) - 6,
      Math.round(low.x) + 20,
      Math.round(low.y) + 6,
    ];
    expect(differ(straight, bent, lowBox)).toBeGreaterThan(80);

    // The middle of the straight line, between the places: drawn only when straight.
    const top = await at(500, 200);
    const topBox = [
      Math.round(top.x) - 20,
      Math.round(top.y) - 6,
      Math.round(top.x) + 20,
      Math.round(top.y) + 6,
    ];
    expect(differ(straight, bent, topBox)).toBeGreaterThan(80);

    // Somewhere the route is neither: the same in both.
    const far = await at(500, 500);
    const farBox = [
      Math.round(far.x) - 20,
      Math.round(far.y) - 20,
      Math.round(far.x) + 20,
      Math.round(far.y) + 20,
    ];
    expect(differ(straight, bent, farBox)).toBe(0);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('the same route sent from its other place is drawn the same', async () => {
    const page = await newPage();
    const forward = await shot(page, regionMap({ waypoints: BENT }));
    const back = await shot(page, regionMap({ waypoints: BENT, reverse: true }));
    expect(differ(forward, back, [0, 0, forward.width, forward.height])).toBe(0);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('the bend is a route to point at; the empty straight line is not', async () => {
    const page = await newPage();
    await shot(page, regionMap({ waypoints: BENT }));
    // Hovering a route (and not a place) makes the pointer a hand.
    const pointer = (x, y) =>
      page.evaluate(
        ([px, py]) => {
          const view = Loom.engine.camera.view;
          Loom.world.hover(Loom.mapMath.toScreen(view, px, py), view);
          return document.getElementById('panel').style.cursor;
        },
        [x, y]
      );
    expect(await pointer(500, 800)).toBe('pointer');
    expect(await pointer(250, 500)).toBe('pointer');
    expect(await pointer(500, 200)).toBe('');
    expect(await pointer(500, 500)).toBe('');
    // The straight map: the line between the places is.
    await shot(page, regionMap());
    expect(await pointer(500, 200)).toBe('pointer');
    expect(await pointer(500, 800)).toBe('');
    expect(page.errors).toEqual([]);
    await page.close();
  });
});
