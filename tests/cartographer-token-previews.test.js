'use strict';

/**
 * The Cartographer page's token previews (planning/tokens.md §4.4; L-934 /
 * #792) in headless Chrome, on the real script (fixtures/cartographer-tokens/),
 * on a desktop and a phone: each named character's and stat block's token in
 * its circle at its crop with the ring coloured by side, and those without a
 * picture listed.
 *
 * It needs Playwright and its Chromium; where the browser is missing the
 * suite is skipped, with a note.
 *
 * Run: cd tests && npx jest cartographer-token-previews --verbose
 */

const { serveFixtures } = require('./helpers/fixture-server');
const { previewsOf } = require('../functions/loom-canon/tokens');

let chromium = null;
let devices = {};
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

const SCREENS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: devices['iPhone 13'] || { viewport: { width: 390, height: 844 }, hasTouch: true },
};

const pic = (n, name, crop) => ({
  imageId: `img_${String(n).padStart(16, '0')}`,
  link: `/fixtures/tokens/${name}.png`,
  width: 256,
  height: 256,
  format: 'png',
  ...(crop ? { crop } : {}),
});
const WORLD = {
  characters: {
    mordrake: {
      id: 'mordrake',
      name: 'Mordrake',
      side: 'hostile',
      token: pic(1, 'villain', { x: 0.5, y: 0.3, zoom: 2 }),
    },
    chief: { id: 'chief', name: 'The chief', side: 'party', token: pic(2, 'chief') },
    captain: { id: 'captain', name: 'Captain', side: 'wary', statBlock: 'bandit' },
    hermit: { id: 'hermit', name: 'Hermit', side: 'neutral' },
    ghost: { id: 'ghost', name: 'Ghost', retired: true },
  },
  statBlocks: {
    bandit: { id: 'bandit', name: 'Bandit', token: pic(3, 'bandit') },
    rat: { id: 'rat', name: 'Rat' },
  },
};

const each = (name, fn) =>
  Object.entries(SCREENS).forEach(([screen, options]) =>
    test(`${name} (${screen})`, async () => {
      if (!browser) {
        console.warn(`Skipped "${name}": Playwright's Chromium isn't installed here.`);
        return;
      }
      const context = await browser.newContext(options);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(`${origin}/fixtures/cartographer-tokens/index.html`);
      await page.waitForFunction(() => Boolean(window.Cartographer && Cartographer.worlds));
      try {
        await fn(page, screen);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    })
  );

async function show(page, tokens) {
  await page.evaluate((t) => {
    const node = document.getElementById('carto-completion');
    Cartographer.worlds.renderCompletion(node, {
      total: 1,
      playable: 1,
      rich: 0,
      share: 1,
      counts: {},
      gaps: [],
      tokens: t,
    });
  }, tokens);
}

describe('what the server sends', () => {
  test('a character shows their own picture, else their stat block’s; the rest are listed', () => {
    const tokens = previewsOf(WORLD);
    expect(tokens.characters.total).toBe(4);
    expect(tokens.characters.with.map((c) => c.id)).toEqual(['captain', 'mordrake', 'chief']);
    expect(tokens.characters.without).toEqual([{ id: 'hermit', name: 'Hermit', side: 'neutral' }]);
    expect(tokens.statBlocks.with.map((b) => b.id)).toEqual(['bandit']);
    expect(tokens.statBlocks.without.map((b) => b.id)).toEqual(['rat']);
    // The page is sent the link and the crop only.
    expect(Object.keys(tokens.characters.with[0]).sort()).toEqual(
      ['crop', 'id', 'link', 'name', 'side'].sort()
    );
  });

  test('long lists are cut, with the count kept', () => {
    const many = {};
    for (let i = 0; i < 30; i++) many[`c${i}`] = { id: `c${i}`, name: `Person ${i}` };
    const tokens = previewsOf({ characters: many }, 5);
    expect(tokens.characters.without).toHaveLength(5);
    expect(tokens.characters.withoutCount).toBe(30);
  });
});

describe('the page', () => {
  each('draws each token in its circle, the ring by side, and lists who has none', async (page) => {
    await show(page, previewsOf(WORLD));
    const details = page.locator('details.carto-tokens');
    await expect(details.count()).resolves.toBe(1);
    await details.locator('summary').click();
    // Three characters and a stat block with pictures.
    await expect(page.locator('.carto-token').count()).resolves.toBe(4);
    const ring = (side) => page.locator(`.carto-portrait--${side}`);
    await expect(ring('hostile').count()).resolves.toBe(1);
    await expect(ring('party').count()).resolves.toBe(1);
    await expect(ring('wary').count()).resolves.toBe(1);
    const colours = await page.evaluate(() =>
      ['hostile', 'party', 'wary'].map(
        (s) => getComputedStyle(document.querySelector('.carto-portrait--' + s)).borderTopColor
      )
    );
    expect(new Set(colours).size).toBe(3);
    // Round, and the picture framed on the crop: zoom 2 is twice as close as
    // the fit, so the picture is twice the circle across.
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.carto-portrait img')].every((i) => i.style.width)
    );
    const villain = await page.evaluate(() => {
      const circle = document.querySelector('.carto-portrait--hostile');
      const img = circle.querySelector('img');
      return {
        radius: getComputedStyle(circle).borderTopLeftRadius,
        circle: circle.getBoundingClientRect().width,
        img: parseFloat(img.style.width),
      };
    });
    expect(villain.radius).toMatch(/50%|px/);
    expect(villain.img).toBeCloseTo(villain.circle * 2 - 4, -1);
    const text = await page.locator('details.carto-tokens').innerText();
    expect(text).toMatch(/Characters: 3 of 4 have a token picture/);
    expect(text).toMatch(/No picture: Hermit\./);
    expect(text).toMatch(/Stat blocks: 1 of 2 have a token picture/);
    expect(text).toMatch(/No picture: Rat\./);
  });

  each('a world with no people or stat blocks shows no Tokens section', async (page) => {
    await show(page, previewsOf({}));
    await expect(page.locator('details.carto-tokens').count()).resolves.toBe(0);
  });

  each('nothing runs off the page on a phone', async (page) => {
    await show(page, previewsOf(WORLD));
    await page.locator('details.carto-tokens summary').click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
