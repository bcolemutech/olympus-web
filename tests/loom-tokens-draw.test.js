'use strict';

/**
 * Tokens drawn in the grid view (planning/tokens.md §4.2, TK3, TK5;
 * planning/game-art.md §4.7; L-932 / #790), in headless Chrome on the real
 * map engine (fixtures/paint/drawers.html), with portraits from
 * fixtures/tokens/:
 *
 *   - a named portrait, six figures sharing a stat block's picture, one with
 *     its own, and one with none showing its initials;
 *   - rings for each side, and a large creature drawn larger;
 *   - someone down lying flat, greyed and crossed;
 *   - tokens standing upright in the three-quarter view's order: one behind
 *     the table drawn under it, one in front drawn over it, and one behind a
 *     wall fading the wall;
 *   - a screenshot kept with the painter's (UPDATE_PAINT=1 makes it again);
 *   - 30 tokens on the large dungeon adding no visible delay to a frame.
 *
 * It needs Playwright and its Chromium; where the browser is missing the
 * suite is skipped, with a note.
 *
 * Run: cd tests && npx jest loom-tokens-draw --verbose
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

const TURN = {
  n: 1,
  ap: 20,
  pool: 20,
  prices: { move: 1, difficult: 2, door: 2, doors: {}, actions: {}, features: {} },
  plan: null,
};

// A map as loomGetMap sends it, seen from `viewer` (in feet).
function battleData(id, geometry, width, height, viewer) {
  const map = { id, width, height, geometry, entries: [], exits: [] };
  const cell = { x: Math.floor(viewer.x / 5), y: Math.floor(viewer.y / 5) };
  const at = { cell, point: viewer };
  const inSight = sight.inSight(map, at, {});
  return {
    id,
    name: id,
    width,
    height,
    image: null,
    here: cell,
    herePoint: viewer,
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
    geometry,
    hazards: [],
    people: [],
    fog: {
      seen: seen.pack(inSight, width, height),
      inSight: seen.pack(inSight, width, height),
      view: sight.outline(map, at, {}),
    },
  };
}

const picture = (file, crop) => ({
  link: `/fixtures/tokens/${file}`,
  crop: { x: 0.5, y: 0.5, zoom: 1, ...(crop || {}) },
});
// Someone in sight at a point in feet.
const person = (id, name, x, y, more = {}) => ({
  id,
  name,
  x: Math.floor(x / 5),
  y: Math.floor(y / 5),
  point: { x, y },
  width: 2.5,
  ...more,
});

// The hall of the painter's dungeon, seen from its middle, with everyone.
function hall() {
  const data = battleData('dungeon', geo.normalize(dungeon()), 24, 16, { x: 72.5, y: 22.5 });
  // The built-in painted set (L-946), whose table stands.
  data.artSet = 'classic';
  const bandit = picture('bandit.png');
  data.people = [
    person('villain', 'Mordrake the Grey', 95, 12, {
      side: 'party',
      token: picture('villain.png', { y: 0.4, zoom: 1.3 }),
    }),
    ...[65, 70, 80, 90, 95, 100].map((x, i) =>
      person(`fig-bandits-${i + 1}`, `Bandit ${i + 1}`, x, 37, {
        side: 'hostile',
        figure: true,
        token: bandit,
      })
    ),
    person('fig-chief', 'Bandit chief', 108, 30, {
      side: 'hostile',
      figure: true,
      token: picture('chief.png', { y: 0.3 }),
    }),
    person('rat', 'Giant Rat', 110, 18, { side: 'neutral' }),
    person('guard', 'Gate Guard', 65, 10, { side: 'wary' }),
    person('ogre', 'Ogre', 103, 21, { side: 'hostile', width: 10 }),
    person('fallen', 'Fallen Bandit', 75, 31, { side: 'hostile', down: 'dead', token: bandit }),
    // Behind the table (its foot about 26.5 ft) and in front of it.
    person('behind', 'Behind', 85, 23, { side: 'hostile', token: bandit }),
    person('front', 'Front', 87, 29.5, { side: 'hostile', token: bandit }),
  ];
  return data;
}

async function page() {
  const p = await browser.newPage({ viewport: { width: 960, height: 640 } });
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto(origin + '/fixtures/paint/drawers.html');
  return p;
}
const show = (p, data) => p.evaluate(([d, t]) => window.__show(d, t), [data, TURN]);
// Every token with a picture has it drawn.
const pictured = (p, count) =>
  p.waitForFunction((n) => Loom.battle.tokens().filter((t) => t.pictured).length >= n, count, {
    timeout: 10000,
  });

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

describe('tokens in the grid view', () => {
  withBrowser(
    'pictures, shared and own, initials with none, sizes, someone down, and its screenshot',
    async () => {
      const p = await page();
      await show(p, hall());
      // The villain, six bandits, the chief, the fallen, behind and front.
      await pictured(p, 11);
      const tokens = Object.fromEntries(
        (await p.evaluate(() => Loom.battle.tokens())).map((t) => [t.id, t])
      );
      expect(tokens.villain.pictured).toBe(true);
      for (let i = 1; i <= 6; i++) expect(tokens[`fig-bandits-${i}`].pictured).toBe(true);
      expect(tokens['fig-chief'].pictured).toBe(true);
      // No picture: their initials, in the same frame.
      expect(tokens.rat.pictured).toBe(false);
      expect(tokens.guard.pictured).toBe(false);
      // Standing, all but the one down, who lies flat.
      expect(tokens.villain.standing).toBe(true);
      expect(tokens.fallen.standing).toBe(false);
      // A large creature is drawn larger: 10 ft across against 2.5 ft's least.
      expect(tokens.ogre.radius).toBeGreaterThan(tokens.rat.radius * 1.5);
      // The bandits' picture loaded once, shared.
      const loads = await p.evaluate(
        () =>
          performance
            .getEntriesByType('resource')
            .filter((r) => r.name.endsWith('/fixtures/tokens/bandit.png')).length
      );
      expect(loads).toBe(1);
      const shot = PNG.sync.read(await p.screenshot());
      matchesBaseline(shot, 'tokens-standing.png');
      expect(p.errors).toEqual([]);
      await p.close();
    }
  );

  withBrowser(
    'they stand in the depth order: behind the table under it, in front over it',
    async () => {
      const p = await page();
      await show(p, hall());
      const up = (await p.evaluate(() => Loom.mapPaint.describe('battle:dungeon'))).filter(
        (d) => d.layer === 'standing'
      );
      const order = up.map((d) => d.kind + ':' + d.id);
      const index = (k) => order.indexOf(k);
      expect(index('object:table')).toBeGreaterThan(-1);
      expect(index('token:behind')).toBeGreaterThan(-1);
      expect(index('token:behind')).toBeLessThan(index('object:table'));
      expect(index('token:front')).toBeGreaterThan(index('object:table'));
      // Each at its foot: depths in order.
      const depths = up.map((d) => d.depth).filter((d) => typeof d === 'number');
      expect(depths).toEqual([...depths].sort((a, b) => a - b));
      expect(p.errors).toEqual([]);
      await p.close();
    }
  );

  withBrowser('a token standing behind a wall fades the wall over it', async () => {
    const p = await page();
    const data = hall();
    data.people = [];
    await show(p, data);
    const settled = () => p.waitForFunction(() => Loom.mapPaint.fading('battle:dungeon') === 0);
    const southFaded = () =>
      p.evaluate(
        () =>
          Loom.mapPaint
            .describe('battle:dungeon')
            .filter((d) => d.faded && d.id === 'south' && d.kind === 'wall').length
      );
    await settled();
    expect(await southFaded()).toBe(0);
    // Just north of the hall's south wall (45 ft): its disc rises behind the wall's face.
    data.people = [
      person('gob', 'Goblin', 85, 43, { side: 'hostile', token: picture('bandit.png') }),
    ];
    await show(p, data);
    await settled();
    expect(await southFaded()).toBeGreaterThanOrEqual(1);
    // In front of the wall: back.
    data.people = [person('gob', 'Goblin', 85, 48, { side: 'hostile' })];
    await show(p, data);
    await settled();
    expect(await southFaded()).toBe(0);
    expect(p.errors).toEqual([]);
    await p.close();
  });

  withBrowser('30 tokens on the large dungeon add no visible delay to a frame', async () => {
    const p = await page();
    const data = battleData('big', geo.normalize(large()), 60, 60, { x: 152.5, y: 152.5 });
    await show(p, data);
    const frame = () =>
      p.evaluate(() => {
        const t0 = performance.now();
        for (let i = 0; i < 30; i++) Loom.engine.draw();
        return (performance.now() - t0) / 30;
      });
    await frame();
    const bare = await frame();
    const files = ['villain.png', 'bandit.png', 'chief.png'];
    data.people = Array.from({ length: 30 }, (_, i) =>
      person(`p${i}`, `Person ${i}`, 127.5 + (i % 6) * 10, 127.5 + Math.floor(i / 6) * 10, {
        side: ['hostile', 'party', 'neutral', 'wary'][i % 4],
        ...(i % 5 ? { token: picture(files[i % 3]) } : {}),
      })
    );
    await show(p, data);
    await pictured(p, 24);
    await frame();
    const busy = await frame();
    // No visible delay: under a few milliseconds more a frame.
    expect(busy - bare).toBeLessThan(4);
    expect(p.errors).toEqual([]);
    await p.close();
  });
});
