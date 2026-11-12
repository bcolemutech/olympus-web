'use strict';

/**
 * The Cartographer page's New world and brief (planning/worlds-without-azgaar.md
 * §4.1; L-711 / #816) in headless Chrome, on the real page and scripts with
 * Firebase stubbed: New world is the page's first section, with the Azgaar
 * import kept beside it; it makes a world with and without a map image and
 * sends the brief; a world's card shows its brief and edits it.
 *
 * It needs Playwright and its Chromium; where the browser is missing the
 * suite is skipped, with a note.
 *
 * Run: cd tests && npx jest cartographer-brief-page --verbose
 */

const { serveFixtures } = require('./helpers/fixture-server');

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
  desktop: { viewport: { width: 1280, height: 900 } },
  phone: devices['iPhone 13'] || { viewport: { width: 390, height: 844 }, hasTouch: true },
};

const BRIEF = { genre: 'dark fantasy', tone: 'grim', artDirection: 'ink and wash' };
const WORLDS = [
  {
    id: 'ashfall-aaaaaa',
    name: 'Ashfall',
    status: 'draft',
    source: { kind: 'scratch' },
    createdAtMs: 2000,
    brief: BRIEF,
  },
  {
    id: 'plainland-bbbbbb',
    name: 'Plainland',
    status: 'draft',
    source: { kind: 'scratch' },
    createdAtMs: 1000,
  },
];
const IMAGES = [
  { id: 'img_b', title: 'The coast', kind: 'worldMap' },
  { id: 'img_a', title: 'An atlas', kind: 'worldMap' },
];

// Firebase, stubbed: a signed-in cartographer, two worlds and two map images,
// and callables that record what they are sent.
function stub({ worlds, images }) {
  const calls = [];
  window.__calls = calls;
  const docs = (list) => ({
    empty: list.length === 0,
    docs: list.map((data) => ({ id: data.id, data: () => data })),
  });
  const query = (name) => {
    const list = name === 'loom_worlds' ? worlds : name === 'studio_images' ? images : [];
    const q = { get: () => Promise.resolve(docs(list)) };
    q.orderBy = () => q;
    q.where = () => q;
    return q;
  };
  const user = {
    uid: 'builder',
    displayName: 'Builder',
    email: 'builder@example.com',
    getIdTokenResult: () => Promise.resolve({ claims: { apps: ['cartographer'] } }),
  };
  window.firebase = {
    auth: () => ({ onAuthStateChanged: (cb) => cb(user), signOut: () => Promise.resolve() }),
    firestore: () => ({ collection: query }),
    storage: () => ({}),
    functions: () => ({
      httpsCallable: (name) => (data) => {
        calls.push({ name, data });
        if (name === 'cartographerCompletion') return Promise.resolve({ data: { worlds: {} } });
        if (name === 'cartographerCreateWorld') {
          return Promise.resolve({ data: { worldId: 'new-cccccc', name: data.name } });
        }
        return Promise.resolve({ data: {} });
      },
    }),
  };
}

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
      // The hosted Firebase scripts don't exist here; the stub stands in.
      await page.route('**/__/firebase/**', (route) =>
        route.fulfill({ contentType: 'text/javascript', body: '' })
      );
      await page.addInitScript(stub, { worlds: WORLDS, images: IMAGES });
      await page.goto(`${origin}/apps/cartographer/index.html`);
      await page.waitForSelector('.carto-world-card');
      try {
        await fn(page);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    })
  );

const calls = (page, name) =>
  page.evaluate((n) => window.__calls.filter((c) => c.name === n).map((c) => c.data), name);

describe('New world', () => {
  each('is the first section, with the Azgaar import kept as the second', async (page) => {
    const titles = await page.locator('.carto-section-title').allInnerTexts();
    expect(titles.slice(0, 2)).toEqual(['New world', 'Import an Azgaar map']);
    // The import form is still there.
    await expect(page.locator('#carto-upload-form #carto-json').count()).resolves.toBe(1);
    await expect(page.locator('#carto-upload-btn').isVisible()).resolves.toBe(true);
  });

  each('lists the library’s map images and offers a plain backdrop', async (page) => {
    const options = await page.locator('#carto-new-image option').allInnerTexts();
    expect(options).toEqual(['None — a plain backdrop', 'An atlas', 'The coast']);
    await expect(page.locator('#carto-new-scale').inputValue()).resolves.toBe('3');
  });

  each('makes a world with no image: a name, the scale and a brief', async (page) => {
    await page.fill('#carto-new-name', '  Brassgate ');
    await page.fill('#carto-new-scale', '0.5');
    await page.fill('#carto-new-brief-genre', 'steampunk');
    await page.fill('#carto-new-brief-artDirection', 'brass and ink');
    await page.click('#carto-new-btn');
    await page.waitForSelector('#carto-new-status:not(.hidden)');
    expect(await calls(page, 'cartographerCreateWorld')).toEqual([
      {
        name: 'Brassgate',
        milesPerUnit: 0.5,
        brief: { genre: 'steampunk', artDirection: 'brass and ink' },
      },
    ]);
    await expect(page.locator('#carto-new-status').innerText()).resolves.toMatch(
      /"Brassgate" is a draft/
    );
    // The form is cleared for the next one, and the worlds are loaded again.
    await expect(page.locator('#carto-new-name').inputValue()).resolves.toBe('');
    await expect(page.locator('#carto-new-scale').inputValue()).resolves.toBe('3');
  });

  each('makes a world with a map image, and none of a brief left empty', async (page) => {
    await page.fill('#carto-new-name', 'Pictured');
    await page.selectOption('#carto-new-image', 'img_b');
    await page.click('#carto-new-btn');
    await page.waitForSelector('#carto-new-status:not(.hidden)');
    expect(await calls(page, 'cartographerCreateWorld')).toEqual([
      { name: 'Pictured', milesPerUnit: 3, imageId: 'img_b' },
    ]);
  });

  each('asks for a name and a sensible scale before sending anything', async (page) => {
    await page.fill('#carto-new-scale', '0');
    // The browser's own checks would stop these first; the script checks them too.
    await page.evaluate(() => {
      document.getElementById('carto-new-form').noValidate = true;
    });
    await page.click('#carto-new-btn');
    await expect(page.locator('#carto-new-error').innerText()).resolves.toMatch(/name/);
    await page.fill('#carto-new-name', 'X');
    await page.click('#carto-new-btn');
    await expect(page.locator('#carto-new-error').innerText()).resolves.toMatch(/scale/);
    expect(await calls(page, 'cartographerCreateWorld')).toEqual([]);
  });

  each('nothing runs off the page on a phone', async (page) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

describe('a world’s brief on its card', () => {
  const card = (page, name) => page.locator('.carto-world-card', { hasText: name });

  each('shows the brief, or invites one', async (page) => {
    await expect(card(page, 'Ashfall').locator('.carto-brief-text').innerText()).resolves.toBe(
      'Brief — genre: dark fantasy · tone: grim · art direction: ink and wash'
    );
    await expect(card(page, 'Plainland').locator('.carto-brief-text').innerText()).resolves.toMatch(
      /No brief yet/
    );
    await expect(card(page, 'Plainland').locator('.carto-brief-edit').innerText()).resolves.toBe(
      'Add a brief…'
    );
  });

  each('edits it: the fields shown, all four sent, an emptied one clearing', async (page) => {
    const ashfall = card(page, 'Ashfall');
    await ashfall.locator('.carto-brief-edit').click();
    const form = ashfall.locator('.carto-brief-form');
    await expect(
      form.locator('input, textarea').evaluateAll((n) => n.map((e) => e.value))
    ).resolves.toEqual(['dark fantasy', 'grim', '', 'ink and wash']);
    await form.locator('input').nth(1).fill('hopeful');
    await form.locator('input').nth(0).fill('');
    await form.locator('button[type=submit]').click();
    await page.waitForFunction(() => window.__calls.some((c) => c.name === 'cartographerSetBrief'));
    expect(await calls(page, 'cartographerSetBrief')).toEqual([
      {
        worldId: 'ashfall-aaaaaa',
        brief: { genre: '', tone: 'hopeful', era: '', artDirection: 'ink and wash' },
      },
    ]);
  });

  each('Cancel closes the form and sends nothing', async (page) => {
    const plain = card(page, 'Plainland');
    await plain.locator('.carto-brief-edit').click();
    await expect(plain.locator('.carto-brief-form').count()).resolves.toBe(1);
    await plain.locator('.carto-brief-form .carto-link').click();
    await expect(plain.locator('.carto-brief-form').count()).resolves.toBe(0);
    await expect(plain.locator('.carto-brief-edit').isEnabled()).resolves.toBe(true);
    expect(await calls(page, 'cartographerSetBrief')).toEqual([]);
  });

  each('nothing runs off the page with the form open', async (page) => {
    await card(page, 'Ashfall').locator('.carto-brief-edit').click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
