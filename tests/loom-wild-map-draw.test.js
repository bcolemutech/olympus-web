'use strict';

/**
 * The map across country (planning/off-road-travel.md §4.7, TR5; L-367 /
 * #841), in headless Chrome: the world view (public/apps/loom/js/world.js and
 * wild-view.js) on the real map engine (fixtures/paint/drawers.html), given
 * a region map as loomGetMap sends it (the server's mapView, on The Weald,
 * ./fixtures/wilds-world.js).
 *
 *   - clicking a place offers "Travel across country" beside its route, and
 *     previews the way: its path is drawn, and its hours, distance and path
 *     are the server's plan's (the journey's own), with the days, ground
 *     crossed and how wild it is on the card;
 *   - clicking open ground names it, previews the way to that point, and sets
 *     out for the point;
 *   - how wild a way is: calm, wild, dangerous or deadly by its average danger;
 *   - a journey under way is drawn: its way ahead, a tent at each camp, where
 *     it heads and the marker in the wilds, again from a freshly loaded map;
 *     its card has Continue and Stop;
 *   - with off-road travel off, none of it is offered.
 *
 * It needs Playwright and its Chromium: where the browser is missing the
 * suite is skipped, with a note.
 *
 * Run: cd tests && npx jest loom-wild-map-draw --verbose
 */

const { PNG } = require('pngjs');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const { wildsWorld } = require('./fixtures/wilds-world');
const frames = require('../functions/loom-canon/frames');
const checks = require('../functions/loom-canon/checks');
const sheets = require('../functions/loom-canon/sheets');
const clock = require('../functions/loom-canon/clock');
const wildPlan = require('../functions/loom-canon/wild-plan');
const combat = require('../functions/loom-modules/combat');
const { makeSave } = require('../functions/loom-models');
const { mapView } = require('../functions/loom-turn/map-view');
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

// ── The map as loomGetMap sends it ────────────────────────────────────

const ASHBY = [{ mapId: 'weald', placeId: 'pl_ashby' }];
const CAMP = { x: 8, y: 10 };

// Ashby to Carrow, a day's travel done: the journey the turn keeps after the
// first leg (wild-journeys.js journeyOf), one camp made.
const JOURNEY = {
  mapId: 'weald',
  to: { point: { x: 22, y: 10 }, placeId: 'pl_carrow', name: 'Carrow' },
  path: [
    { x: 8, y: 10 },
    { x: 22, y: 10 },
  ],
  times: [0, 14],
  routes: [],
  hours: 14,
  done: 0,
  leg: 1,
  by: 'wild',
  distance: 14,
  camps: [CAMP],
};

// What loomGetMap returns for a save on The Weald: the server's own mapView.
function loaded({ at = ASHBY, journey = null, extra = {}, discovered } = {}) {
  const world = wildsWorld('weald', { system: BUILT_IN['d20-fantasy'], ...extra });
  const made = makeSave({
    ownerUid: 'u',
    worldId: 'weald',
    name: 'Weald',
    character: { name: 'Ash' },
    at,
    discovered: discovered || ['pl_ashby', 'pl_carrow', 'pl_dunsmouth'],
    visited: ['pl_ashby'],
    waysKnown: {},
    time: clock.START,
  });
  // The journey is kept by the turn (a mutation), not made with the save.
  const save = journey ? { ...made, journey } : made;
  const play = frames.playWorld(world);
  const framed = frames.frameOf(play, save);
  const canon = combat.figures.withFigures(framed.view, framed.save);
  const there = sheets.withAp(framed.save, checks.systemOf(canon), canon);
  return { data: { ...mapView(canon, there, null, null), mapId: 'weald' }, canon, save: there };
}

// ── The page ──────────────────────────────────────────────────────────

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.errors = errors;
  await page.goto(origin + '/fixtures/paint/drawers.html');
  // What the page asks the server to do: recorded, not sent.
  await page.evaluate(() => {
    window.__calls = [];
    Loom.play.travelAcross = (to, label) => window.__calls.push({ verb: 'across', to, label });
    Loom.play.journeyOn = () => window.__calls.push({ verb: 'on' });
    Loom.play.journeyStop = () => window.__calls.push({ verb: 'stop' });
  });
  return page;
}

async function show(page, data) {
  await page.evaluate(([d]) => window.__show(d, null, 'world'), [data]);
}

async function shot(page) {
  return PNG.sync.read(await page.locator('#panel').screenshot());
}

// Where a map point is in the panel, through the engine's camera.
const screenOf = (page, x, y) =>
  page.evaluate(([px, py]) => Loom.mapMath.toScreen(Loom.engine.camera.view, px, py), [x, y]);

// A click on the map at a map point, as the engine sends it.
async function tapAt(page, x, y) {
  await page.evaluate(
    ([px, py]) => {
      const view = Loom.engine.camera.view;
      Loom.world.tap(Loom.mapMath.toScreen(view, px, py), view);
    },
    [x, y]
  );
}

// The menu open now: its title, subtitle and items, or null.
const menuOf = (page) =>
  page.evaluate(() => {
    const menu = document.querySelector('.loom-map-menu');
    if (!menu) return null;
    const text = (sel) => (menu.querySelector(sel) || {}).textContent || '';
    return {
      title: text('.loom-map-menu-title'),
      subtitle: text('.loom-map-menu-subtitle'),
      items: Array.from(menu.querySelectorAll('.loom-map-menu-item')).map((b) => ({
        label: b.querySelector('.loom-map-menu-label').textContent,
        disabled: b.disabled,
      })),
    };
  });

const choose = (page, label) =>
  page.evaluate((text) => {
    const item = Array.from(document.querySelectorAll('.loom-map-menu-item')).find((b) =>
      b.textContent.startsWith(text)
    );
    item.click();
  }, label);

// The world card as the page draws it.
const cardOf = (page) =>
  page.evaluate(() => {
    const info = document.createElement('div');
    Loom.world.renderInfo(info);
    return {
      text: info.textContent,
      buttons: Array.from(info.querySelectorAll('button')).map((b) => ({
        id: b.id,
        label: b.textContent,
        disabled: b.disabled,
      })),
    };
  });

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

const boxAround = (p, w, h) => [
  Math.round(p.x) - w,
  Math.round(p.y) - h,
  Math.round(p.x) + w,
  Math.round(p.y) + h,
];

// ── The preview ───────────────────────────────────────────────────────

describe('the way across country, previewed', () => {
  withBrowser(
    "a place's menu offers it beside the route; its path is drawn and is the server's plan",
    async () => {
      const { data, canon, save } = loaded();
      const page = await newPage();
      await show(page, data);
      const before = await shot(page);
      expect(await page.evaluate(() => Loom.world.wildOn())).toBe(true);

      await tapAt(page, 22, 10); // Carrow
      const menu = await menuOf(page);
      expect(menu.title).toBe('Carrow');
      // Not a neighbour: no route to take, so the way across country only
      // (and Look); the label has the time and how wild.
      const across = menu.items.find((i) => i.label.startsWith('Travel across country'));
      expect(across.label).toMatch(/^Travel across country · 3 days, (calm|wild|dangerous|deadly)$/);
      expect(across.disabled).toBe(false);

      // The path drawn is the plan the turn makes (wild-plan.js planOn).
      const plan = wildPlan.planOn(canon, [2, 10], 'pl_carrow', { state: save, pace: 1.5 });
      const shown = await page.evaluate(() => Loom.world.previewed());
      expect(shown.hours).toBeCloseTo(plan.hours, 9);
      expect(shown.distance).toBeCloseTo(plan.distance, 9);
      expect(shown.days).toBe(Math.ceil(plan.hours / 8));
      expect(shown.path).toHaveLength(plan.path.length);
      shown.path.forEach((p, i) => {
        expect(p[0]).toBeCloseTo(plan.path[i][0], 9);
        expect(p[1]).toBeCloseTo(plan.path[i][1], 9);
      });
      expect(shown.line).toMatch(/^about 20 miles · 3 days · forest and grassland · /);
      // ...and it is drawn: along every point of it, ending at Carrow.
      expect(shown.drawn.path).toHaveLength(plan.path.length);
      const carrow = await screenOf(page, 22, 10);
      expect(shown.drawn.goal.x).toBeCloseTo(carrow.x, 3);
      const after = await shot(page);
      const mid = await screenOf(page, 12, 10);
      expect(differ(before, after, boxAround(mid, 30, 6))).toBeGreaterThan(80);
      // Ground away from the way is the same.
      const far = await screenOf(page, 12, 3);
      expect(differ(before, after, boxAround(far, 20, 6))).toBe(0);

      // The card says it too, with the button to set out.
      const card = await cardOf(page);
      expect(card.text).toMatch(/Across country: about 20 miles · 3 days · forest and grassland/);
      expect(card.buttons.find((b) => b.id === 'loom-wild-set-out').disabled).toBe(false);

      // Choosing it sets out for the place.
      await choose(page, 'Travel across country');
      expect(await page.evaluate(() => window.__calls)).toEqual([
        { verb: 'across', to: 'pl_carrow', label: 'set out across country for Carrow' },
      ]);
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );

  withBrowser('its figures are the journey the turn then keeps', async () => {
    // The turn plans with the same inputs, so the plan the page showed is the
    // one setOut keeps as the journey (wild-journeys.js journeyOf: path, hours,
    // distance of the plan).
    const wildJourneys = require('../functions/loom-turn/wild-journeys');
    const { data, canon, save } = loaded();
    const page = await newPage();
    await show(page, data);
    await tapAt(page, 22, 10);
    const shown = await page.evaluate(() => Loom.world.previewed());
    const goal = { point: [22, 10], placeId: 'pl_carrow', name: 'Carrow' };
    const plan = wildPlan.planOn(canon, [2, 10], goal.point, {
      state: save,
      pace: wildJourneys.settingsFor(canon).pace,
    });
    const journey = wildJourneys.journeyOf(canon, plan, goal);
    expect(shown.hours).toBeCloseTo(journey.hours, 9);
    expect(shown.distance).toBeCloseTo(journey.distance, 9);
    expect(shown.path).toHaveLength(journey.path.length);
    await page.close();
  });

  withBrowser('open ground is named, previewed and set out for as a point', async () => {
    const { data } = loaded();
    const page = await newPage();
    await show(page, data);
    await tapAt(page, 10, 5); // in the forest
    const menu = await menuOf(page);
    expect(menu.title).toBe('Forest');
    expect(menu.subtitle).toMatch(/^about \d+(\.\d)? miles · /);
    expect(menu.items).toHaveLength(1);
    expect(menu.items[0].label).toMatch(/^Travel across country · /);
    const card = await cardOf(page);
    expect(card.text).toContain('Forest');
    expect(card.buttons.map((b) => b.id)).toEqual(['loom-wild-set-out']);

    await choose(page, 'Travel across country');
    const [call] = await page.evaluate(() => window.__calls);
    expect(call.verb).toBe('across');
    expect(call.to.point.x).toBeCloseTo(10, 1);
    expect(call.to.point.y).toBeCloseTo(5, 1);
    expect(call.label).toBe('set out across country');

    // Off the map there is nothing to offer.
    await page.evaluate(() => Loom.engine.closeMenu());
    await page.evaluate(() => {
      const view = Loom.engine.camera.view;
      Loom.world.tap({ x: 2, y: 2 }, view);
    });
    expect(await menuOf(page)).toBeNull();
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('a world with its own ground speeds and a region danger is planned as the turn does', async () => {
    const extra = {
      wilds: { materials: { forest: { speed: 0.3, danger: 1.5 } } },
      regions: {
        reg_wood: { id: 'reg_wood', name: 'The Greenwood', description: 'Old oaks.', danger: 1.5 },
      },
    };
    const { data, canon, save } = loaded({ extra });
    expect(data.wilds.overrides).toEqual({ materials: { forest: { speed: 0.3, danger: 1.5 } } });
    expect(data.wilds.zones.map((z) => z.region)).toEqual(['reg_wood']);
    const page = await newPage();
    await show(page, data);
    await tapAt(page, 22, 10);
    const shown = await page.evaluate(() => Loom.world.previewed());
    const plan = wildPlan.planOn(canon, [2, 10], [22, 10], { state: save, pace: 1.5 });
    expect(shown.hours).toBeCloseTo(plan.hours, 9);
    // Slower than the plain forest's 22 hours, and rated by its danger: the
    // forest's 1.5 over the region's 1.5 for most of the way.
    expect(shown.hours).toBeGreaterThan(30);
    expect(plan.danger).toBeGreaterThan(1.8);
    expect(shown.ratingId).toBe('deadly');
    await page.close();
  });

  withBrowser('only the routes the save has found are planned with', async () => {
    const known = loaded();
    expect(known.data.wilds.lanes.map((l) => l.id)).toEqual(['pl_ashby|pl_dunsmouth']);
    const unknown = loaded({ discovered: ['pl_ashby', 'pl_carrow'] });
    expect(unknown.data.wilds.lanes).toEqual([]);
    expect(JSON.stringify(unknown.data)).not.toContain('pl_dunsmouth');
  });
});

describe('how wild a way is', () => {
  withBrowser('calm, wild, dangerous or deadly by the average danger', async () => {
    const page = await newPage();
    const rated = await page.evaluate(() =>
      [0.5, 0.79, 0.8, 1, 1.29, 1.3, 1.5, 1.79, 1.8, 2, 3, null].map((d) => Loom.wildView.rate(d).id)
    );
    expect(rated).toEqual([
      'calm',
      'calm',
      'wild',
      'wild',
      'wild',
      'dangerous',
      'dangerous',
      'dangerous',
      'deadly',
      'deadly',
      'deadly',
      'wild',
    ]);
    await page.close();
  });
});

// ── The journey ───────────────────────────────────────────────────────

describe('a journey under way', () => {
  const camped = () => loaded({ at: [{ mapId: 'weald', point: CAMP }], journey: JOURNEY });

  withBrowser('its way ahead, camp, goal and marker are drawn, and again after a reload', async () => {
    const page = await newPage();
    const idle = loaded({ at: [{ mapId: 'weald', point: CAMP }] });
    await show(page, idle.data);
    const bare = await shot(page);
    expect(await page.evaluate(() => Loom.world.trekDrawn().journey)).toBeNull();

    const { data } = camped();
    expect(data.wild).toEqual(CAMP);
    expect(data.here).toBeNull();
    expect(data.journey.camps).toEqual([CAMP]);
    await show(page, data);
    const drawn = await page.evaluate(() => Loom.world.trekDrawn());
    const camp = await screenOf(page, 8, 10);
    const carrow = await screenOf(page, 22, 10);
    expect(drawn.marker.x).toBeCloseTo(camp.x, 3);
    expect(drawn.marker.y).toBeCloseTo(camp.y, 3);
    expect(drawn.journey.camps).toHaveLength(1);
    expect(drawn.journey.camps[0].x).toBeCloseTo(camp.x, 3);
    expect(drawn.journey.goal.x).toBeCloseTo(carrow.x, 3);
    // The way ahead runs from the marker to the goal.
    expect(drawn.journey.path[0].x).toBeCloseTo(camp.x, 3);
    expect(drawn.journey.path[drawn.journey.path.length - 1].x).toBeCloseTo(carrow.x, 3);
    const first = await shot(page);
    const mid = await screenOf(page, 15, 10);
    expect(differ(bare, first, boxAround(mid, 30, 6))).toBeGreaterThan(60);
    expect(differ(bare, first, boxAround(camp, 14, 14))).toBeGreaterThan(40);

    // A reload: the map comes again from the server, a new object, nothing in
    // the page remembering the last: the same is drawn.
    await show(page, JSON.parse(JSON.stringify(camped().data)));
    const again = await page.evaluate(() => Loom.world.trekDrawn());
    expect(again).toEqual(drawn);
    expect(differ(first, await shot(page), [0, 0, 960, 640])).toBe(0);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('its card says where, how long and how many camps, with Continue and Stop', async () => {
    const page = await newPage();
    await show(page, camped().data);
    let card = await cardOf(page);
    expect(card.text).toContain('You are in the wilds, in the forest.');
    expect(card.text).toContain('On the way to Carrow · about 14 hours of travel left · 1 camp made');
    expect(card.buttons.map((b) => b.id)).toEqual(['loom-journey-continue', 'loom-journey-stop']);
    expect(card.buttons.every((b) => !b.disabled)).toBe(true);

    // The buttons are the card's own: pressed, they ask for the next leg or stop.
    await page.evaluate(() => {
      const info = document.createElement('div');
      Loom.world.renderInfo(info);
      info.querySelector('#loom-journey-continue').click();
      info.querySelector('#loom-journey-stop').click();
    });
    expect(await page.evaluate(() => window.__calls)).toEqual([{ verb: 'on' }, { verb: 'stop' }]);

    // While a turn runs they wait.
    await page.evaluate(() => {
      Loom.state.turnInProgress = true;
    });
    card = await cardOf(page);
    expect(card.buttons.every((b) => b.disabled)).toBe(true);
    await page.close();
  });

  withBrowser('in the wilds a place offers the way across country, not a route', async () => {
    const page = await newPage();
    await show(page, camped().data);
    await tapAt(page, 22, 10);
    const menu = await menuOf(page);
    expect(menu.items.map((i) => i.label.split(' · ')[0])).toEqual([
      'Travel across country',
      'Look',
    ]);
    // The preview starts from the camp, not the town left behind.
    const shown = await page.evaluate(() => Loom.world.previewed());
    expect(shown.path[0][0]).toBeCloseTo(8, 6);
    expect(shown.path[0][1]).toBeCloseTo(10, 6);
    await page.close();
  });
});

// ── Off ───────────────────────────────────────────────────────────────

describe('with off-road travel off', () => {
  const off = () => loaded({ extra: { rules: { startingLocationId: 'pl_ashby', wilds: false } } });

  withBrowser('nothing is offered, previewed or sent', async () => {
    const { data } = off();
    expect(data.wilds).toBeNull();
    expect(data.journey).toBeNull();
    const page = await newPage();
    await show(page, data);
    expect(await page.evaluate(() => Loom.world.wildOn())).toBe(false);
    await tapAt(page, 10, 5);
    expect(await menuOf(page)).toBeNull();
    expect(await page.evaluate(() => Loom.world.previewed())).toBeNull();
    // A place's menu has no way across country.
    await tapAt(page, 22, 10);
    const menu = await menuOf(page);
    expect(menu.items.some((i) => i.label.startsWith('Travel across country'))).toBe(false);
    const card = await cardOf(page);
    expect(card.text).not.toContain('country');
    expect(page.errors).toEqual([]);
    await page.close();
  });
});
