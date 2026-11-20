'use strict';

/**
 * The Muse's page (planning/the-muse.md §5, M-100; M-101 / #889) in headless
 * Chrome, on the real page and scripts with Firebase stubbed by an in-memory
 * Firestore: making, renaming and deleting a project, and a project's home
 * rendering its summary (sanitised Markdown), at desktop and iPad sizes; a
 * phone reads it too (MU5).
 *
 * It needs Playwright and its Chromium; where the browser is missing the
 * suite is skipped, with a note.
 *
 * Run: cd tests && npx jest muse-page --verbose
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
  iPad: devices['iPad (gen 7)'] || { viewport: { width: 810, height: 1080 }, hasTouch: true },
};
const PHONE = devices['iPhone 13'] || { viewport: { width: 390, height: 844 }, hasTouch: true };

const SUMMARY = [
  '# The Drowned Kingdom',
  '',
  'A sea that took a **crown**, and *kept* it.',
  '',
  '- Tides',
  '- Bells under water',
  '',
  'Ruled by [King Peter](muse:el/el_peter). See [the map](https://example.com/map).',
  '',
  '<script>window.__pwned = true</script><img src=x onerror="window.__pwned = true">',
  '[bad](javascript:window.__pwned=true)',
].join('\n');

// Firebase, stubbed: a signed-in user with the given apps, and an in-memory
// Firestore holding `docs` ({ 'muse_projects/p1': {...} }), with the compat
// calls the page makes.
function stub({ apps, docs }) {
  const store = new Map(Object.entries(docs));
  window.__store = store;
  let clock = 1000;
  let next = 0;
  const SERVER_TIME = { __serverTime: true };
  const stamp = (data) => {
    const out = {};
    Object.keys(data).forEach((k) => {
      const at = ++clock;
      out[k] = data[k] === SERVER_TIME ? { toMillis: () => at } : data[k];
    });
    return out;
  };
  const snap = (path) => ({
    id: path.split('/').pop(),
    exists: store.has(path),
    data: () => (store.has(path) ? { ...store.get(path) } : undefined),
    ref: ref(path),
  });
  function ref(path) {
    return {
      id: path.split('/').pop(),
      get: () => Promise.resolve(snap(path)),
      set: (data) => Promise.resolve(store.set(path, stamp(data))),
      update: (data) => {
        if (!store.has(path)) return Promise.reject(new Error('No document to update'));
        store.set(path, { ...store.get(path), ...stamp(data) });
        return Promise.resolve();
      },
      delete: () => Promise.resolve(store.delete(path)),
      collection: (name) => collection(path + '/' + name),
    };
  }
  function collection(base, filters = []) {
    return {
      doc: (id) => ref(base + '/' + (id || 'auto' + ++next)),
      where: (field, op, value) => collection(base, filters.concat([[field, value]])),
      get: () => {
        const depth = base.split('/').length + 1;
        const docs = [...store.keys()]
          .filter((p) => p.startsWith(base + '/') && p.split('/').length === depth)
          .filter((p) => filters.every(([f, v]) => store.get(p)[f] === v))
          .map(snap);
        return Promise.resolve({ empty: !docs.length, docs });
      },
    };
  }
  const user = {
    uid: 'ann',
    displayName: 'Ann',
    email: 'ann@example.com',
    getIdTokenResult: () => Promise.resolve({ claims: { apps } }),
  };
  const firestore = () => ({ collection: (name) => collection(name) });
  firestore.FieldValue = { serverTimestamp: () => SERVER_TIME };
  window.firebase = {
    auth: () => ({ onAuthStateChanged: (cb) => cb(user), signOut: () => Promise.resolve() }),
    firestore,
  };
}

const PROJECTS = {
  'muse_projects/p_old': {
    owner: 'ann',
    title: 'Older',
    short: 'Changed long ago',
    summary: '',
    cover: null,
  },
  'muse_projects/p_sea': {
    owner: 'ann',
    title: 'The Drowned Kingdom',
    short: 'A sea that took a crown',
    summary: SUMMARY,
    cover: null,
    updatedAt: 50, // a time in ms: the page reads either
  },
  'muse_projects/p_bob': { owner: 'bob', title: 'Bob’s', short: '', summary: '', cover: null },
};

async function open(options, { apps = ['muse'], hash = '' } = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // The hosted Firebase scripts don't exist here; the stub stands in.
  await page.route('**/__/firebase/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' })
  );
  await page.addInitScript(stub, { apps, docs: PROJECTS });
  await page.goto(`${origin}/apps/muse/index.html${hash}`);
  return { context, page, errors };
}

const each = (name, fn) =>
  Object.entries(SCREENS).forEach(([screen, options]) =>
    test(`${name} (${screen})`, async () => {
      if (!browser) {
        console.warn(`Skipped "${name}": Playwright's Chromium isn't installed here.`);
        return;
      }
      const { context, page, errors } = await open(options);
      try {
        await page.waitForSelector('#muse-home:not(.hidden)');
        await fn(page);
        expect(errors).toEqual([]);
        // Nothing runs off the page's width.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow).toBeLessThanOrEqual(0);
      } finally {
        await context.close();
      }
    })
  );

const stored = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...window.__store.entries()].map(([p, d]) => [
        p,
        Object.fromEntries(
          Object.entries(d).filter(([k]) => k !== 'createdAt' && k !== 'updatedAt')
        ),
      ])
    )
  );

describe('the home page', () => {
  each('lists your projects only, last changed first, as cards', async (page) => {
    await page.waitForSelector('.muse-project-card');
    const titles = await page.locator('.muse-project-card-title').allInnerTexts();
    expect(titles).toEqual(['The Drowned Kingdom', 'Older']);
    await expect(page.locator('.muse-project-card-short').first().innerText()).resolves.toBe(
      'A sea that took a crown'
    );
    // No cover yet: the title's first letter stands in.
    await expect(page.locator('.muse-cover-letter').first().innerText()).resolves.toMatch(/T/i);
  });

  each('makes a project and opens its home', async (page) => {
    await page.click('#muse-new-open');
    await page.fill('#muse-new-title', '  Brassgate  ');
    await page.fill('#muse-new-short', 'A city of gears');
    await page.click('#muse-new-btn');
    await page.waitForSelector('#muse-project:not(.hidden)');
    await expect(page.locator('#muse-p-title').innerText()).resolves.toBe('Brassgate');
    await expect(page.locator('#muse-p-short').innerText()).resolves.toBe('A city of gears');
    const made = Object.entries(await stored(page)).filter(([p]) => /auto/.test(p));
    expect(made.map(([, d]) => d)).toEqual([
      { owner: 'ann', title: 'Brassgate', short: 'A city of gears', summary: '', cover: null },
    ]);
    // Its sections: one per element type, with counts.
    const tiles = await page.locator('.muse-section-tile').allInnerTexts();
    expect(tiles.map((t) => t.replace(/\s+/g, ' ').trim())).toEqual([
      'Characters 0',
      'Factions 0',
      'Locations 0',
      'Objects 0',
      'Concepts 0',
    ]);
    // Back home, it is listed first.
    await page.click('.muse-back');
    await page.waitForSelector('#muse-home:not(.hidden) .muse-project-card');
    await expect(page.locator('.muse-project-card-title').first().innerText()).resolves.toBe(
      'Brassgate'
    );
  });

  each('asks for a title before making anything', async (page) => {
    await page.click('#muse-new-open');
    await page.click('#muse-new-btn');
    await expect(page.locator('#muse-new-error').innerText()).resolves.toMatch(/title/);
    expect(Object.keys(await stored(page))).toHaveLength(3);
  });
});

describe('a project’s home', () => {
  const openSea = async (page) => {
    await page.click('.muse-project-card[data-id="p_sea"]');
    await page.waitForSelector('#muse-project:not(.hidden)');
  };

  each('renders its summary as Markdown, safely', async (page) => {
    await openSea(page);
    const view = page.locator('#muse-p-summary');
    await expect(view.locator('h1').innerText()).resolves.toBe('The Drowned Kingdom');
    await expect(view.locator('strong').innerText()).resolves.toBe('crown');
    await expect(view.locator('em').innerText()).resolves.toBe('kept');
    await expect(view.locator('li').allInnerTexts()).resolves.toEqual([
      'Tides',
      'Bells under water',
    ]);
    // An element link, and a web link that opens apart.
    await expect(view.locator('a.muse-el-link').getAttribute('data-el')).resolves.toBe('el_peter');
    const web = view.locator('a[href="https://example.com/map"]');
    await expect(web.getAttribute('rel')).resolves.toBe('noopener noreferrer');
    // Markup and script links are shown as text, never run.
    await expect(view.locator('script, img').count()).resolves.toBe(0);
    await expect(view.locator('a[href^="javascript"]').count()).resolves.toBe(0);
    await expect(view.innerText()).resolves.toMatch(/<script>/);
    await expect(page.evaluate(() => window.__pwned)).resolves.toBeUndefined();
    // It reads at a comfortable width, whatever the window.
    const width = await view.evaluate((n) => n.getBoundingClientRect().width);
    expect(width).toBeLessThanOrEqual(1000);
  });

  each('edits its summary, with a preview, and saves it', async (page) => {
    await page.click('.muse-project-card[data-id="p_old"]');
    await page.waitForSelector('#muse-project:not(.hidden)');
    await expect(page.locator('#muse-p-summary-empty').isVisible()).resolves.toBe(true);
    await page.click('#muse-p-summary-edit');
    await page.fill('#muse-p-summary-text', '## Ages\n\nThe *first* age.');
    await page.click('#muse-p-summary-show');
    await expect(page.locator('#muse-p-summary-preview h2').innerText()).resolves.toBe('Ages');
    await page.click('#muse-p-summary-save');
    await page.waitForSelector('#muse-p-summary-read:not(.hidden)');
    await expect(page.locator('#muse-p-summary em').innerText()).resolves.toBe('first');
    expect((await stored(page))['muse_projects/p_old'].summary).toBe('## Ages\n\nThe *first* age.');
  });

  each('edits its details: short description and cover id', async (page) => {
    await openSea(page);
    await page.click('#muse-p-head-edit');
    await page.fill('#muse-p-head-short', 'Bells under the sea');
    await page.fill('#muse-p-head-cover', 'img_sea');
    await page.click('#muse-p-head-save');
    await page.waitForSelector('#muse-p-head-form.hidden', { state: 'attached' });
    await expect(page.locator('#muse-p-short').innerText()).resolves.toBe('Bells under the sea');
    const saved = (await stored(page))['muse_projects/p_sea'];
    expect([saved.short, saved.cover]).toEqual(['Bells under the sea', 'img_sea']);
  });

  each('is renamed in its settings', async (page) => {
    await openSea(page);
    await page.fill('#muse-p-rename-title', 'The Sunken Crown');
    await page.click('#muse-p-rename-btn');
    await page.waitForSelector('#muse-p-rename-done:not(.hidden)');
    await expect(page.locator('#muse-p-title').innerText()).resolves.toBe('The Sunken Crown');
    expect((await stored(page))['muse_projects/p_sea'].title).toBe('The Sunken Crown');
    // An empty name is refused before anything is sent.
    await page.fill('#muse-p-rename-title', '   ');
    await page.click('#muse-p-rename-btn');
    await expect(page.locator('#muse-p-rename-error').innerText()).resolves.toMatch(/title/);
    expect((await stored(page))['muse_projects/p_sea'].title).toBe('The Sunken Crown');
  });

  each('is deleted only once confirmed', async (page) => {
    await openSea(page);
    await page.click('#muse-p-delete');
    await expect(page.locator('#muse-p-delete-name').innerText()).resolves.toBe(
      'The Drowned Kingdom'
    );
    await page.click('#muse-p-delete-no');
    expect(Object.keys(await stored(page))).toContain('muse_projects/p_sea');
    await page.click('#muse-p-delete');
    await page.click('#muse-p-delete-yes');
    await page.waitForSelector('#muse-home:not(.hidden)');
    expect(Object.keys(await stored(page))).not.toContain('muse_projects/p_sea');
    await expect(page.locator('.muse-project-card-title').allInnerTexts()).resolves.toEqual([
      'Older',
    ]);
  });
});

describe('around the edges', () => {
  const run = (name, options, setup, fn) =>
    test(name, async () => {
      if (!browser) {
        console.warn(`Skipped "${name}": Playwright's Chromium isn't installed here.`);
        return;
      }
      const { context, page, errors } = await open(options, setup);
      try {
        await fn(page);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });

  run('a project that isn’t there says so', SCREENS.desktop, { hash: '#/p/nope' }, async (page) => {
    await page.waitForSelector('#muse-missing:not(.hidden)');
  });

  run('without the muse claim, it explains', SCREENS.desktop, { apps: ['loom'] }, async (page) => {
    await page.waitForSelector('#muse-denied:not(.hidden)');
    await expect(page.locator('#muse-home').isVisible()).resolves.toBe(false);
  });

  run('a phone reads a project and its summary', PHONE, { hash: '#/p/p_sea' }, async (page) => {
    await page.waitForSelector('#muse-project:not(.hidden)');
    await expect(page.locator('#muse-p-summary h1').isVisible()).resolves.toBe(true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
