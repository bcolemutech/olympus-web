'use strict';

/**
 * The Muse's page (planning/the-muse.md §5, M-100; M-101 / #889) in headless
 * Chrome, on the real page and scripts with Firebase stubbed by an in-memory
 * Firestore: making, renaming and deleting a project, and a project's home
 * rendering its summary (sanitised Markdown), at desktop and iPad sizes; a
 * phone reads it too (MU5). Photo libraries (M-104 / #892) go through a stubbed
 * Storage and studioUpload: a photo uploaded or picked, made primary,
 * reordered and removed, and a project's cover.
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

// The smallest PNG there is, for a file to upload.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

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
  const DELETE = { __delete: true };
  const plain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !v.toMillis;
  // set(…, { merge: true }): maps merged, lists replaced, DELETE takes a key away.
  const merge = (into, data) => {
    const out = { ...(into || {}) };
    Object.keys(data).forEach((k) => {
      if (data[k] === DELETE) delete out[k];
      else if (plain(data[k]) && plain(out[k])) out[k] = merge(out[k], data[k]);
      else if (plain(data[k])) out[k] = merge({}, data[k]);
      else out[k] = data[k];
    });
    return out;
  };
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
      set: (data, options) =>
        Promise.resolve(
          store.set(path, options && options.merge ? merge(store.get(path), stamp(data)) : stamp(data))
        ),
      update: (data) => {
        if (!store.has(path)) return Promise.reject(new Error('No document to update'));
        store.set(path, { ...store.get(path), ...stamp(data) });
        return Promise.resolve();
      },
      delete: () => Promise.resolve(store.delete(path)),
      collection: (name) => collection(path + '/' + name),
    };
  }
  const millis = (v) => (v && v.toMillis ? v.toMillis() : typeof v === 'number' ? v : 0);
  function collection(base, filters = [], max = Infinity, order = null) {
    return {
      doc: (id) => ref(base + '/' + (id || 'auto' + ++next)),
      where: (field, op, value) =>
        collection(base, filters.concat([[field, value, op]]), max, order),
      limit: (n) => collection(base, filters, n, order),
      orderBy: (field, dir) => collection(base, filters, max, [field, dir]),
      get: () => {
        const depth = base.split('/').length + 1;
        const match = (p, [f, v, op]) =>
          op === 'array-contains'
            ? Array.isArray(store.get(p)[f]) && store.get(p)[f].includes(v)
            : store.get(p)[f] === v;
        const docs = [...store.keys()]
          .filter((p) => p.startsWith(base + '/') && p.split('/').length === depth)
          .filter((p) => filters.every((filter) => match(p, filter)))
          .sort((a, b) =>
            order
              ? (millis(store.get(b)[order[0]]) - millis(store.get(a)[order[0]])) *
                (order[1] === 'asc' ? -1 : 1)
              : 0
          )
          .slice(0, max)
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
  // A batch does its writes in order once committed (all or none is not
  // needed here: the stub never refuses a write that the page checked).
  const batch = () => {
    const writes = [];
    return {
      set: (r, data, options) => writes.push(() => r.set(data, options)),
      update: (r, data) => writes.push(() => r.update(data)),
      delete: (r) => writes.push(() => r.delete()),
      commit: () => {
        window.__batches = (window.__batches || 0) + 1;
        return writes.reduce((p, w) => p.then(w), Promise.resolve());
      },
    };
  };
  const firestore = () => ({ collection: (name) => collection(name), batch });
  firestore.FieldValue = { serverTimestamp: () => SERVER_TIME, delete: () => DELETE };
  // Storage and the studioUpload callable (M-104): a file put in the upload
  // folder, then an image in the studio's library for the caller to use. As
  // the real callable does, it refuses a caller with neither claim.
  window.__puts = [];
  window.__calls = [];
  let uploaded = 0;
  const storage = () => ({
    ref: (path) => ({
      put: (file, meta) => {
        window.__puts.push({ path, type: meta && meta.contentType, name: file.name });
        return Promise.resolve({});
      },
    }),
  });
  const functions = () => ({
    httpsCallable: (name) => (data) => {
      window.__calls.push({ name, data });
      if (name !== 'studioUpload') return Promise.reject(new Error('No such callable'));
      if (!apps.includes('cartographer') && !apps.includes('muse')) {
        return Promise.reject(new Error('You do not have access to the Image Studio.'));
      }
      const put = window.__puts.find((p) => p.path.split('/')[2] === data.uploadId);
      if (!put) return Promise.reject(new Error('Upload the image first.'));
      uploaded += 1;
      const id = 'img_up' + uploaded;
      const link =
        'data:image/svg+xml,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="hsl(' +
            uploaded * 60 +
            ',60%,50%)"/></svg>'
        );
      const record = {
        id,
        title: data.title,
        kind: data.kind,
        labels: data.labels,
        link,
        createdAt: 100 + uploaded,
      };
      store.set('studio_images/' + id, record);
      return Promise.resolve({ data: { image: record } });
    },
  });
  window.firebase = {
    auth: () => ({ onAuthStateChanged: (cb) => cb(user), signOut: () => Promise.resolve() }),
    firestore,
    storage,
    functions,
  };
}

const PROJECTS = {
  // An image already in the studio's library, to pick (M-104).
  'studio_images/img_old': {
    id: 'img_old',
    title: 'Old Brass at dusk',
    kind: 'scene',
    labels: ['the court'],
    link:
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#c60"/></svg>'
      ),
    createdAt: 50,
  },
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
  // A project with a location already in it, and fields of its own (M-102).
  'muse_projects/p_isle': {
    owner: 'ann',
    title: 'The Isles',
    short: '',
    summary: '',
    cover: null,
    updatedAt: 10,
    fields: {
      character: [
        { key: 'born_ab', label: 'Born', kind: 'date' },
        { key: 'temper_cd', label: 'Temper', kind: 'choice', options: ['Calm', 'Fiery'] },
      ],
    },
  },
  'muse_projects/p_isle/elements/el_sea': {
    type: 'location',
    name: 'The Sunken City',
    aliases: ['Old Brass'],
    bio: '',
    fields: {},
    images: [],
    primary: null,
    mentions: [],
    shard: '0',
    retired: false,
  },
  'muse_projects/p_isle/index/0': {
    entries: {
      el_sea: { type: 'location', name: 'The Sunken City', aliases: ['Old Brass'], primary: null },
    },
    last: 'el_sea',
  },
  // A court of three, with a relationship and one @-link (M-103).
  'muse_projects/p_court': {
    owner: 'ann',
    title: 'The Court',
    short: '',
    summary: 'Marta keeps the court. The Widow is wise.',
    cover: null,
    updatedAt: 5,
  },
  'muse_projects/p_court/elements/el_peter': {
    type: 'character',
    name: 'King Peter',
    aliases: ['The Drowned King'],
    bio: 'King Peter rules from [Old Brass](muse:el/el_sea). Son of Marta, or the widow.',
    fields: {},
    images: [],
    primary: null,
    mentions: ['el_sea'],
    appearance: '',
    residence: null,
    shard: '0',
    retired: false,
  },
  'muse_projects/p_court/elements/el_marta': {
    type: 'character',
    name: 'Marta',
    aliases: ['The Widow'],
    bio: 'Mother of the king.',
    fields: {},
    images: [],
    primary: null,
    mentions: [],
    appearance: '',
    residence: null,
    shard: '0',
    retired: false,
  },
  'muse_projects/p_court/elements/el_sea': {
    type: 'location',
    name: 'The Sunken City',
    aliases: ['Old Brass'],
    bio: 'The Drowned King holds court here. `Marta` is code; so is\n\n```\nMarta\n```',
    fields: {},
    images: [],
    primary: null,
    mentions: [],
    shard: '0',
    retired: false,
  },
  'muse_projects/p_court/index/0': {
    entries: {
      el_peter: { type: 'character', name: 'King Peter', aliases: ['The Drowned King'], primary: null },
      el_marta: { type: 'character', name: 'Marta', aliases: ['The Widow'], primary: null },
      el_sea: { type: 'location', name: 'The Sunken City', aliases: ['Old Brass'], primary: null },
    },
    last: 'el_sea',
  },
  'muse_projects/p_court/relationships/r1': {
    a: 'el_marta',
    b: 'el_peter',
    aToB: 'mother of',
    bToA: 'son of',
    description: 'Raised him alone.',
    ends: ['el_marta', 'el_peter'],
  },
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
    expect(titles).toEqual(['The Drowned Kingdom', 'The Isles', 'The Court', 'Older']);
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
    const before = Object.keys(await stored(page)).length;
    await page.click('#muse-new-btn');
    await expect(page.locator('#muse-new-error').innerText()).resolves.toMatch(/title/);
    expect(Object.keys(await stored(page))).toHaveLength(before);
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

  each('edits its details: short description and a cover picked from the studio', async (page) => {
    await openSea(page);
    await page.click('#muse-p-head-edit');
    await page.fill('#muse-p-head-short', 'Bells under the sea');
    await page.click('#muse-p-cover-pick');
    await page.click('.muse-picker-tile[data-id="img_old"]');
    // The picker closes, and the form shows the cover it would save.
    await page.waitForSelector('#muse-p-head-cover .muse-cover-img');
    await expect(page.locator('#muse-p-cover-picker').isVisible()).resolves.toBe(false);
    await expect(page.locator('#muse-p-head-cover-remove').isVisible()).resolves.toBe(true);
    await page.click('#muse-p-head-save');
    await page.waitForSelector('#muse-p-head-form.hidden', { state: 'attached' });
    await expect(page.locator('#muse-p-short').innerText()).resolves.toBe('Bells under the sea');
    await page.waitForSelector('#muse-p-cover .muse-cover-img');
    const saved = (await stored(page))['muse_projects/p_sea'];
    expect([saved.short, saved.cover]).toEqual(['Bells under the sea', 'img_old']);
  });

  each('a cover is uploaded into the studio, and taken off again', async (page) => {
    await openSea(page);
    await page.click('#muse-p-head-edit');
    await page.setInputFiles('#muse-p-cover-file', {
      name: 'sea.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await page.waitForSelector('#muse-p-head-cover .muse-cover-img');
    // Put in the editor's upload folder, then added to the library.
    const puts = await page.evaluate(() => window.__puts);
    expect(puts).toHaveLength(1);
    expect(puts[0].path).toMatch(/^cartographer\/ann\/[A-Za-z0-9_-]{8,64}\/studio\.png$/);
    expect(puts[0].type).toBe('image/png');
    const made = (await stored(page))['studio_images/img_up1'];
    expect([made.title, made.kind, made.labels]).toEqual([
      'The Drowned Kingdom',
      'cover',
      ['the drowned kingdom'],
    ]);
    await page.click('#muse-p-head-save');
    await page.waitForSelector('#muse-p-head-form.hidden', { state: 'attached' });
    expect((await stored(page))['muse_projects/p_sea'].cover).toBe('img_up1');
    await page.waitForSelector('#muse-p-cover .muse-cover-img');

    await page.click('#muse-p-head-edit');
    await page.click('#muse-p-head-cover-remove');
    await page.click('#muse-p-head-save');
    await page.waitForSelector('#muse-p-head-form.hidden', { state: 'attached' });
    expect((await stored(page))['muse_projects/p_sea'].cover).toBe(null);
    // Taken off the project, the image stays in the studio.
    expect(Object.keys(await stored(page))).toContain('studio_images/img_up1');
    await expect(page.locator('#muse-p-cover .muse-cover-img').count()).resolves.toBe(0);
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
      'The Isles',
      'The Court',
      'Older',
    ]);
  });
});

describe('elements (M-102)', () => {
  const openIsles = async (page) => {
    await page.click('.muse-project-card[data-id="p_isle"]');
    await page.waitForSelector('#muse-project:not(.hidden)');
  };
  const elementsIn = async (page, projectId) =>
    Object.entries(await stored(page))
      .filter(([p]) => p.startsWith(`muse_projects/${projectId}/elements/`))
      .map(([p, d]) => ({ id: p.split('/').pop(), ...d }));
  const indexOf = async (page, projectId) =>
    (await stored(page))[`muse_projects/${projectId}/index/0`] || { entries: {} };

  each('a character with a residence and two custom fields, made and shown', async (page) => {
    await openIsles(page);
    // The sections open each type's list, with counts from the index.
    const tiles = await page.locator('.muse-section-tile').allInnerTexts();
    expect(tiles.map((t) => t.replace(/\s+/g, ' ').trim())).toContain('Locations 1');
    await page.click('.muse-section-tile[data-type="character"]');
    await page.waitForSelector('#muse-type:not(.hidden)');
    await expect(page.locator('#muse-t-empty').innerText()).resolves.toMatch(/No characters/);

    // New: a name, then its page.
    await page.click('#muse-t-new-open');
    await page.fill('#muse-t-new-name', '  Peter  ');
    await page.click('#muse-t-new-btn');
    await page.waitForSelector('#muse-element:not(.hidden)');
    await expect(page.locator('#muse-e-name').innerText()).resolves.toBe('Peter');
    await expect(page.locator('#muse-e-type').innerText()).resolves.toMatch(/character/i);

    // Edited: aliases, a residence, the two fields, an appearance and a bio.
    await page.click('#muse-e-edit');
    await page.fill('#muse-e-name-input', 'King Peter');
    await page.fill('#muse-e-aliases-input', 'Peter\nThe Drowned King');
    await page.selectOption('#muse-e-residence', 'el_sea');
    await page.fill('[data-field="born_ab"] .muse-date-year', '312');
    await page.fill('[data-field="born_ab"] .muse-date-month', '3');
    await page.selectOption('[data-field="temper_cd"]', 'Fiery');
    await page.fill('#muse-e-appearance-input', 'A crown of *barnacles*.');
    await page.fill('#muse-e-bio-input', '# The king\n\nHe rules the tides.');
    await page.click('#muse-e-bio-input-show');
    await expect(page.locator('#muse-e-bio-input-preview h1').innerText()).resolves.toBe('The king');
    await page.click('#muse-e-save');
    await page.waitForSelector('#muse-e-read:not(.hidden)');

    // Shown.
    await expect(page.locator('#muse-e-name').innerText()).resolves.toBe('King Peter');
    await expect(page.locator('#muse-e-aliases').innerText()).resolves.toMatch(
      /Peter · The Drowned King/
    );
    const fact = (key) => page.locator(`.muse-fact[data-key="${key}"] dd`).innerText();
    await expect(fact('residence')).resolves.toBe('The Sunken City');
    await expect(fact('born_ab')).resolves.toBe('Year 312, month 3');
    await expect(fact('temper_cd')).resolves.toBe('Fiery');
    await expect(page.locator('#muse-e-appearance em').innerText()).resolves.toBe('barnacles');
    await expect(page.locator('#muse-e-bio h1').innerText()).resolves.toBe('The king');

    // Saved, with its index line, each in one batch.
    const [peter] = (await elementsIn(page, 'p_isle')).filter((e) => e.type === 'character');
    expect(peter).toMatchObject({
      name: 'King Peter',
      aliases: ['Peter', 'The Drowned King'],
      residence: 'el_sea',
      appearance: 'A crown of *barnacles*.',
      fields: { born_ab: { year: 312, month: 3 }, temper_cd: 'Fiery' },
      shard: '0',
      retired: false,
    });
    expect((await indexOf(page, 'p_isle')).entries[peter.id]).toEqual({
      type: 'character',
      name: 'King Peter',
      aliases: ['Peter', 'The Drowned King'],
      primary: null,
    });
    await expect(page.evaluate(() => window.__batches)).resolves.toBe(2);

    // The residence opens its location's page.
    await page.click('.muse-fact[data-key="residence"] a');
    await page.waitForFunction(
      () => document.getElementById('muse-e-name').textContent === 'The Sunken City'
    );
    await expect(page.locator('#muse-e-residence').count()).resolves.toBe(0);
  });

  each('custom fields are added in the project’s settings and filled in', async (page) => {
    await openIsles(page);
    await page.click('#muse-f-types [data-type="faction"]');
    await expect(page.locator('#muse-f-empty').isVisible()).resolves.toBe(true);
    await page.fill('#muse-f-new-label', 'Motto');
    await page.selectOption('#muse-f-new-kind', 'text');
    await page.click('#muse-f-add');
    await page.fill('#muse-f-new-label', 'Founded by');
    await page.selectOption('#muse-f-new-kind', 'element');
    await page.click('#muse-f-add');
    await page.check('.muse-f-row:last-child input[value="character"]');
    await page.fill('#muse-f-new-label', 'Members');
    await page.selectOption('#muse-f-new-kind', 'number');
    await page.click('#muse-f-add');
    // Moved up, then saved.
    await page.click('.muse-f-row:last-child button[aria-label^="Move Members up"]');
    await page.click('#muse-f-save');
    await page.waitForSelector('#muse-f-done:not(.hidden)');
    const defs = (await stored(page))['muse_projects/p_isle'].fields;
    expect(defs.character.map((d) => d.key)).toEqual(['born_ab', 'temper_cd']);
    expect(defs.faction.map((d) => [d.label, d.kind, d.options])).toEqual([
      ['Motto', 'text', undefined],
      ['Members', 'number', undefined],
      ['Founded by', 'element', ['character']],
    ]);
    defs.faction.forEach((d) => expect(d.key).toMatch(/^[a-z][a-z0-9_]+$/));

    // A faction with them filled in; a bad number is refused first.
    await page.click('.muse-section-tile[data-type="faction"]');
    await page.click('#muse-t-new-open');
    await page.fill('#muse-t-new-name', 'The Tide Guild');
    await page.click('#muse-t-new-btn');
    await page.waitForSelector('#muse-element:not(.hidden)');
    await page.click('#muse-e-edit');
    const [motto, members] = defs.faction;
    await page.fill(`[data-field="${motto.key}"]`, 'We rise');
    await page.fill(`[data-field="${members.key}"]`, 'many');
    await page.click('#muse-e-save');
    await expect(page.locator('#muse-e-form-error').innerText()).resolves.toMatch(/Members/);
    await page.fill(`[data-field="${members.key}"]`, '1,200');
    await page.click('#muse-e-save');
    await page.waitForSelector('#muse-e-read:not(.hidden)');
    await expect(
      page.locator(`.muse-fact[data-key="${members.key}"] dd`).innerText()
    ).resolves.toBe((1200).toLocaleString());
    const [guild] = await elementsIn(page, 'p_isle').then((all) =>
      all.filter((e) => e.type === 'faction')
    );
    expect(guild.fields).toEqual({ [motto.key]: 'We rise', [members.key]: 1200 });
    expect(guild).not.toHaveProperty('residence');
  });

  each('a concept is made, listed by name, renamed and retired', async (page) => {
    await openIsles(page);
    await page.click('.muse-section-tile[data-type="concept"]');
    for (const name of ['Tide-magic', 'Bell-lore']) {
      await page.click('#muse-t-new-open');
      await page.fill('#muse-t-new-name', name);
      await page.click('#muse-t-new-btn');
      await page.waitForSelector('#muse-element:not(.hidden)');
      await expect(page.locator('#muse-e-type').innerText()).resolves.toMatch(/concept/i);
      await expect(page.locator('#muse-e-residence-input, #muse-e-appearance-card:not(.hidden)').count()).resolves.toBe(0);
      await page.click('#muse-e-back');
      await page.waitForSelector('#muse-type:not(.hidden)');
    }
    await expect(page.locator('.muse-el-row-name').allInnerTexts()).resolves.toEqual([
      'Bell-lore',
      'Tide-magic',
    ]);

    // Renamed, with an alias: the list follows.
    await page.click('.muse-el-row:has-text("Tide-magic")');
    await page.waitForSelector('#muse-element:not(.hidden)');
    await page.click('#muse-e-edit');
    await expect(page.locator('#muse-e-residence').count()).resolves.toBe(0);
    await page.fill('#muse-e-name-input', 'Abyssal Rite');
    await page.fill('#muse-e-aliases-input', 'Tide-magic');
    await page.click('#muse-e-save');
    await page.waitForSelector('#muse-e-read:not(.hidden)');
    await page.click('#muse-e-back');
    await page.waitForSelector('#muse-type:not(.hidden)');
    await expect(page.locator('.muse-el-row-name').allInnerTexts()).resolves.toEqual([
      'Abyssal Rite',
      'Bell-lore',
    ]);
    await expect(page.locator('.muse-el-row-aliases').allInnerTexts()).resolves.toEqual([
      'Tide-magic',
    ]);

    // Retired only once confirmed; it leaves the list and the index.
    await page.click('.muse-el-row:has-text("Bell-lore")');
    await page.waitForSelector('#muse-element:not(.hidden)');
    await page.click('#muse-e-retire');
    await page.click('#muse-e-retire-no');
    await expect(page.locator('#muse-e-retired').isVisible()).resolves.toBe(false);
    await page.click('#muse-e-retire');
    await page.click('#muse-e-retire-yes');
    await page.waitForSelector('#muse-e-retired:not(.hidden)');
    const bell = (await elementsIn(page, 'p_isle')).find((e) => e.name === 'Bell-lore');
    expect(bell.retired).toBe(true);
    expect((await indexOf(page, 'p_isle')).entries[bell.id]).toBeUndefined();
    await page.click('#muse-e-back');
    await page.waitForSelector('#muse-type:not(.hidden)');
    await expect(page.locator('.muse-el-row-name').allInnerTexts()).resolves.toEqual([
      'Abyssal Rite',
    ]);

    // Brought back from its page.
    await page.goBack();
    await page.waitForSelector('#muse-e-retired:not(.hidden)');
    await page.click('#muse-e-restore');
    await page.waitForSelector('#muse-e-retired.hidden', { state: 'attached' });
    expect((await indexOf(page, 'p_isle')).entries[bell.id].name).toBe('Bell-lore');
  });
});

describe('links, relationships and search (M-103)', () => {
  const openCourt = async (page) => {
    await page.click('.muse-project-card[data-id="p_court"]');
    await page.waitForSelector('#muse-project:not(.hidden)');
  };
  // Opens an element by its route and waits for its name.
  const openElement = async (page, id, name) => {
    await page.evaluate((hash) => (window.location.hash = hash), `#/p/p_court/e/${id}`);
    await page.waitForFunction(
      (n) =>
        !document.getElementById('muse-element').classList.contains('hidden') &&
        document.getElementById('muse-e-name').textContent === n,
      name
    );
    // Its relationships and mentions are drawn with it.
    await page.waitForFunction(
      () => !document.getElementById('muse-e-relationships').classList.contains('hidden')
    );
  };
  const inViewport = (page, selector) =>
    page.evaluate((sel) => {
      const box = document.querySelector(sel + ':not(.hidden)').getBoundingClientRect();
      return (
        box.width > 0 &&
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= window.innerWidth &&
        box.bottom <= window.innerHeight
      );
    }, selector);

  each('finds an element by an alias as you type, and opens it', async (page) => {
    // No search on the home page; it is in the header inside a project.
    await expect(page.locator('#muse-search').isVisible()).resolves.toBe(false);
    await openCourt(page);
    await expect(page.locator('.app-header #muse-search-box').isVisible()).resolves.toBe(true);

    await page.fill('#muse-search-box', 'drowned');
    const row = page.locator('.muse-suggest-row');
    await expect(row.count()).resolves.toBe(1);
    await expect(row.locator('.muse-suggest-name').innerText()).resolves.toBe('King Peter');
    await expect(row.locator('.muse-suggest-alias').innerText()).resolves.toMatch(/The Drowned King/);
    await expect(inViewport(page, '.muse-suggest')).resolves.toBe(true);

    // Names too, and each keystroke narrows it.
    await page.fill('#muse-search-box', 'm');
    await expect(page.locator('#muse-search .muse-suggest-name').allInnerTexts()).resolves.toEqual([
      'Marta',
    ]);
    await page.fill('#muse-search-box', 'old br');
    await expect(page.locator('.muse-suggest-name').allInnerTexts()).resolves.toEqual([
      'The Sunken City',
    ]);
    await page.keyboard.press('Escape');
    await expect(page.locator('.muse-suggest-row').count()).resolves.toBe(0);

    // Enter opens the best match.
    await page.fill('#muse-search-box', 'widow');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => document.getElementById('muse-e-name').textContent === 'Marta'
    );
    await expect(page.locator('#muse-search-box').inputValue()).resolves.toBe('');

    // A tap picks too.
    await page.fill('#muse-search-box', 'sunken');
    await page.click('.muse-suggest-row');
    await page.waitForFunction(
      () => document.getElementById('muse-e-name').textContent === 'The Sunken City'
    );

    // Back home, the box goes.
    await page.evaluate(() => (window.location.hash = '#/'));
    await page.waitForSelector('#muse-home:not(.hidden)');
    await expect(page.locator('#muse-search').isVisible()).resolves.toBe(false);
  });

  each('a name or alias in a text is a link, though it was not @-linked', async (page) => {
    await openCourt(page);
    // The sea's bio says "The Drowned King" without linking it; code is left alone.
    await openElement(page, 'el_sea', 'The Sunken City');
    const auto = page.locator('#muse-e-bio a.muse-auto');
    await expect(auto.allInnerTexts()).resolves.toEqual(['The Drowned King']);
    await expect(auto.getAttribute('data-el')).resolves.toBe('el_peter');
    await expect(page.locator('#muse-e-bio code').allInnerTexts()).resolves.toEqual([
      'Marta',
      'Marta',
    ]);
    await expect(page.locator('#muse-e-bio code a, #muse-e-bio pre a').count()).resolves.toBe(0);

    // On King Peter's page: his own name is plain, the alias "the widow" and
    // "Marta" link to Marta, and the @-link to the sea is the explicit kind.
    await auto.click();
    await page.waitForFunction(
      () => document.getElementById('muse-e-name').textContent === 'King Peter'
    );
    const bio = page.locator('#muse-e-bio');
    await expect(bio.locator('a.muse-auto').allInnerTexts()).resolves.toEqual(['Marta', 'the widow']);
    await expect(bio.locator('a.muse-auto').first().getAttribute('data-el')).resolves.toBe('el_marta');
    await expect(bio.locator('a:not(.muse-auto)').allInnerTexts()).resolves.toEqual(['Old Brass']);
    await expect(bio.innerText()).resolves.toMatch(/^King Peter rules/);
    // Nothing was stored for any of it.
    const peter = (await stored(page))['muse_projects/p_court/elements/el_peter'];
    expect(peter.mentions).toEqual(['el_sea']);
    expect(peter.bio).not.toMatch(/muse:el\/el_marta/);

    // The project's own summary links names too.
    await page.evaluate(() => (window.location.hash = '#/p/p_court'));
    await page.waitForSelector('#muse-project:not(.hidden)');
    await expect(page.locator('#muse-p-summary a.muse-auto').allInnerTexts()).resolves.toEqual([
      'Marta',
      'The Widow',
    ]);
  });

  each('typing @ links an element, and "Mentioned in" lists it on the target', async (page) => {
    await openCourt(page);
    // Nothing links to Peter yet.
    await openElement(page, 'el_peter', 'King Peter');
    await expect(page.locator('#muse-e-mentions').isVisible()).resolves.toBe(false);

    await openElement(page, 'el_marta', 'Marta');
    await page.click('#muse-e-edit');
    await page.fill('#muse-e-bio-input', 'Mother of ');
    await page.focus('#muse-e-bio-input');
    await page.keyboard.press('End');
    await page.keyboard.type('@pet');
    const rows = page.locator('.muse-suggest-row');
    await expect(rows.count()).resolves.toBe(1);
    await expect(rows.first().innerText()).resolves.toMatch(/King Peter/);
    // It sits on the page, under the line being written.
    await expect(inViewport(page, '.muse-suggest')).resolves.toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('#muse-e-bio-input').inputValue()).resolves.toBe(
      'Mother of [King Peter](muse:el/el_peter)'
    );
    await expect(page.locator('.muse-suggest-row').count()).resolves.toBe(0);
    // Written on, then a second link by tapping, in the appearance too.
    await page.keyboard.type(' and @the sunk');
    await page.click('.muse-suggest-row');
    await expect(page.locator('#muse-e-bio-input').inputValue()).resolves.toBe(
      'Mother of [King Peter](muse:el/el_peter) and [The Sunken City](muse:el/el_sea)'
    );
    // An @ in the middle of a word (an email) offers nothing.
    await page.keyboard.type(' write to ann@pe');
    await expect(page.locator('.muse-suggest-row').count()).resolves.toBe(0);
    await page.click('#muse-e-save');
    await page.waitForSelector('#muse-e-read:not(.hidden)');

    const marta = (await stored(page))['muse_projects/p_court/elements/el_marta'];
    expect(marta.mentions).toEqual(['el_peter', 'el_sea']);
    await expect(page.locator('#muse-e-bio a.muse-el-link:not(.muse-auto)').allInnerTexts()).resolves
      .toEqual(['King Peter', 'The Sunken City']);

    // The target lists where it is mentioned: Peter, and the sea (which
    // Peter's bio also links).
    await page.click('#muse-e-bio a[data-el="el_peter"]');
    await page.waitForFunction(
      () => document.getElementById('muse-e-name').textContent === 'King Peter'
    );
    await page.waitForSelector('#muse-e-mentions:not(.hidden)');
    await expect(page.locator('#muse-m-list .muse-el-row-name').allInnerTexts()).resolves.toEqual([
      'Marta',
    ]);
    await page.click('#muse-m-list .muse-el-row');
    await page.waitForFunction(
      () => document.getElementById('muse-e-name').textContent === 'Marta'
    );
    await openElement(page, 'el_sea', 'The Sunken City');
    await page.waitForSelector('#muse-e-mentions:not(.hidden)');
    await expect(page.locator('#muse-m-list .muse-el-row-name').allInnerTexts()).resolves.toEqual([
      'King Peter',
      'Marta',
    ]);

    // Taking the link out of Marta's bio takes her out of its list.
    await openElement(page, 'el_marta', 'Marta');
    await page.click('#muse-e-edit');
    await page.fill('#muse-e-bio-input', 'Mother of the king.');
    await page.click('#muse-e-save');
    await page.waitForSelector('#muse-e-read:not(.hidden)');
    expect((await stored(page))['muse_projects/p_court/elements/el_marta'].mentions).toEqual([]);
    await openElement(page, 'el_sea', 'The Sunken City');
    await expect(page.locator('#muse-m-list .muse-el-row-name').allInnerTexts()).resolves.toEqual([
      'King Peter',
    ]);
  });

  each('a relationship reads right from both sides, and is made, edited and removed', async (page) => {
    await openCourt(page);
    const rows = (selector = '.muse-rel') => page.locator(selector);
    const text = async () =>
      (await page.locator('.muse-rel').allInnerTexts()).map((t) =>
        t.replace(/\s+/g, ' ').trim().toLowerCase()
      );

    // The one that's there, from each end.
    await openElement(page, 'el_marta', 'Marta');
    await expect(text()).resolves.toEqual(['mother of king peter edit remove raised him alone.']);
    await openElement(page, 'el_peter', 'King Peter');
    await expect(text()).resolves.toEqual(['son of marta edit remove raised him alone.']);

    // Made from Peter's page: the other end is found by typing its alias.
    await page.click('#muse-r-add');
    await page.click('#muse-r-save');
    await expect(page.locator('#muse-r-form-error').innerText()).resolves.toMatch(/Pick/);
    await page.fill('#muse-r-other', 'old br');
    await expect(page.locator('#muse-r-form .muse-suggest-name').allInnerTexts()).resolves.toEqual([
      'The Sunken City',
    ]);
    await page.click('#muse-r-form .muse-suggest-row');
    await expect(page.locator('#muse-r-other').inputValue()).resolves.toBe('The Sunken City');
    await expect(page.locator('#muse-r-kind-label').textContent()).resolves.toBe('King Peter is…');
    await expect(page.locator('#muse-r-back-label').textContent()).resolves.toMatch(
      /^The Sunken City is/
    );
    // Words are needed.
    await page.click('#muse-r-save');
    await expect(page.locator('#muse-r-form-error').innerText()).resolves.toMatch(/what the first is/);
    await page.fill('#muse-r-kind', 'ruler of');
    await page.fill('#muse-r-back', 'ruled by');
    await page.fill('#muse-r-desc', 'Since the flood.');
    await page.click('#muse-r-save');
    await page.waitForSelector('#muse-r-form.hidden', { state: 'attached' });
    await expect(text()).resolves.toEqual([
      'son of marta edit remove raised him alone.',
      'ruler of the sunken city edit remove since the flood.',
    ]);
    const made = Object.entries(await stored(page)).filter(([p]) =>
      /relationships\/auto/.test(p)
    );
    expect(made.map(([, d]) => d)).toEqual([
      {
        a: 'el_peter',
        b: 'el_sea',
        aToB: 'ruler of',
        bToA: 'ruled by',
        description: 'Since the flood.',
        ends: ['el_peter', 'el_sea'],
      },
    ]);

    // Read from the other end, and edited from it: the sea's words are bToA.
    await openElement(page, 'el_sea', 'The Sunken City');
    await expect(text()).resolves.toEqual(['ruled by king peter edit remove since the flood.']);
    await page.click('.muse-rel .muse-btn:has-text("Edit")');
    await expect(page.locator('#muse-r-other').isVisible()).resolves.toBe(false);
    await expect(page.locator('#muse-r-fixed').innerText()).resolves.toBe('King Peter');
    await expect(page.locator('#muse-r-kind').inputValue()).resolves.toBe('ruled by');
    await expect(page.locator('#muse-r-back').inputValue()).resolves.toBe('ruler of');
    await page.fill('#muse-r-kind', 'governed by');
    await page.fill('#muse-r-back', '');
    await page.click('#muse-r-save');
    await page.waitForSelector('#muse-r-form.hidden', { state: 'attached' });
    await expect(text()).resolves.toEqual(['governed by king peter edit remove since the flood.']);
    const edited = Object.entries(await stored(page)).filter(([p]) =>
      /relationships\/auto/.test(p)
    )[0][1];
    // Blank on the other side means the same words from both.
    expect([edited.a, edited.b, edited.aToB, edited.bToA]).toEqual([
      'el_peter',
      'el_sea',
      'governed by',
      'governed by',
    ]);

    // Removed only once confirmed, and from both ends.
    await page.click('.muse-rel .muse-btn:has-text("Remove")');
    await page.click('.muse-rel-confirm .muse-btn-quiet');
    await expect(rows().count()).resolves.toBe(1);
    await page.click('.muse-rel .muse-btn:has-text("Remove")');
    await page.click('.muse-rel-confirm .muse-btn-danger');
    await page.waitForSelector('#muse-r-empty:not(.hidden)');
    await expect(
      Object.keys(await stored(page)).filter((p) => /relationships\/auto/.test(p))
    ).toEqual([]);
    await openElement(page, 'el_peter', 'King Peter');
    await expect(text()).resolves.toEqual(['son of marta edit remove raised him alone.']);
  });

  each('a relationship to a retired element is kept, and can still be removed', async (page) => {
    await openCourt(page);
    await openElement(page, 'el_marta', 'Marta');
    await page.click('#muse-e-retire');
    await page.click('#muse-e-retire-yes');
    await page.waitForSelector('#muse-e-retired:not(.hidden)');
    await openElement(page, 'el_peter', 'King Peter');
    await expect(page.locator('.muse-rel .muse-gone').innerText()).resolves.toBe(
      'A retired element'
    );
    // Not offered as a new end, by name or alias.
    await page.click('#muse-r-add');
    await page.fill('#muse-r-other', 'widow');
    await expect(page.locator('#muse-r-form .muse-suggest-row').count()).resolves.toBe(0);
    await page.click('#muse-r-cancel');
    await page.click('.muse-rel .muse-btn:has-text("Remove")');
    await page.click('.muse-rel-confirm .muse-btn-danger');
    await page.waitForSelector('#muse-r-empty:not(.hidden)');
  });
});

describe('photo libraries (M-104)', () => {
  const png = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
  const openPeter = async (page) => {
    await page.waitForSelector('#muse-home:not(.hidden)');
    await page.evaluate(() => (window.location.hash = '#/p/p_court/e/el_peter'));
    await page.waitForFunction(
      () =>
        !document.getElementById('muse-element').classList.contains('hidden') &&
        document.getElementById('muse-e-name').textContent === 'King Peter'
    );
  };
  const peter = async (page) => (await stored(page))['muse_projects/p_court/elements/el_peter'];
  const line = async (page) =>
    (await stored(page))['muse_projects/p_court/index/0'].entries.el_peter;
  const shown = (page) => page.locator('.muse-photo').evaluateAll((n) => n.map((x) => x.dataset.id));
  const tile = (id, what) => `.muse-photo[data-id="${id}"] .muse-photo-${what}`;
  const settled = (page, count) =>
    page.waitForFunction((n) => document.querySelectorAll('.muse-photo').length === n, count);

  each(
    'a photo uploaded to a character lands in the studio, is primary, and is reordered and removed',
    async (page) => {
      await openPeter(page);
      await expect(page.locator('#muse-e-photos-empty').isVisible()).resolves.toBe(true);

      // One file: into the editor's upload folder, then the studio's library,
      // titled by the element, labelled by the project.
      await page.setInputFiles('#muse-e-photo-file', png('crowned.png'));
      await settled(page, 1);
      const puts = await page.evaluate(() => window.__puts);
      expect(puts.map((p) => p.path)).toEqual([
        expect.stringMatching(/^cartographer\/ann\/[A-Za-z0-9_-]{8,64}\/studio\.png$/),
      ]);
      const first = (await stored(page))['studio_images/img_up1'];
      expect([first.title, first.kind, first.labels]).toEqual([
        'King Peter',
        'portrait',
        ['the court'],
      ]);
      // The first photo is the primary: large at the top, and in the index.
      expect((await peter(page)).images).toEqual(['img_up1']);
      expect((await peter(page)).primary).toBe('img_up1');
      expect((await line(page)).primary).toBe('img_up1');
      await page.waitForSelector('#muse-e-photo-main img');
      await expect(
        page.locator('.muse-photo-badge').evaluateAll((n) => n.map((x) => x.textContent))
      ).resolves.toEqual(['Primary']);
      await expect(page.locator('#muse-e-photos-empty').isVisible()).resolves.toBe(false);

      // Two more at once, named after their files; the primary stays.
      await page.setInputFiles('#muse-e-photo-file', [png('a.png'), png('b.png')]);
      await settled(page, 3);
      await expect(shown(page)).resolves.toEqual(['img_up1', 'img_up2', 'img_up3']);
      const titles = ['img_up2', 'img_up3'].map(async (id) => (await stored(page))['studio_images/' + id].title);
      await expect(Promise.all(titles)).resolves.toEqual(['King Peter: a', 'King Peter: b']);
      expect((await peter(page)).primary).toBe('img_up1');
      await expect(page.locator('#muse-e-photos-count').innerText()).resolves.toBe('3');

      // Another becomes the primary; the index follows.
      await page.click(tile('img_up3', 'make-primary'));
      await page.waitForSelector(`${tile('img_up3', 'make-primary')}`, { state: 'detached' });
      expect((await peter(page)).primary).toBe('img_up3');
      expect((await line(page)).primary).toBe('img_up3');
      await expect(page.locator('.muse-photo-primary').getAttribute('data-id')).resolves.toBe(
        'img_up3'
      );

      // Moved earlier twice, the ends can go no further.
      await page.click(tile('img_up3', 'earlier'));
      await page.waitForFunction(
        () => document.querySelector('.muse-photo:nth-child(2)').dataset.id === 'img_up3'
      );
      await page.click(tile('img_up3', 'earlier'));
      await page.waitForFunction(
        () => document.querySelector('.muse-photo:first-child').dataset.id === 'img_up3'
      );
      expect((await peter(page)).images).toEqual(['img_up3', 'img_up1', 'img_up2']);
      expect((await peter(page)).primary).toBe('img_up3');
      await expect(page.locator(tile('img_up3', 'earlier')).isDisabled()).resolves.toBe(true);
      await expect(page.locator(tile('img_up2', 'later')).isDisabled()).resolves.toBe(true);

      // It shows in the list, by its primary photo.
      await page.click('#muse-e-back');
      await page.waitForSelector('#muse-type:not(.hidden)');
      await page.waitForSelector('.muse-el-row[data-id="el_peter"] .muse-el-thumb-img');
      await expect(
        page.locator('.muse-el-row[data-id="el_marta"] .muse-el-thumb-img').count()
      ).resolves.toBe(0);
      await expect(
        page.locator('.muse-el-row[data-id="el_marta"] .muse-el-thumb-letter').innerText()
      ).resolves.toBe('M');
      await page.click('.muse-el-row[data-id="el_peter"]');
      await page.waitForSelector('#muse-element:not(.hidden) .muse-photo');

      // Removing the primary hands it to the next; the image stays in the studio.
      await page.click(tile('img_up3', 'remove'));
      await settled(page, 2);
      expect((await peter(page)).images).toEqual(['img_up1', 'img_up2']);
      expect((await peter(page)).primary).toBe('img_up1');
      expect((await line(page)).primary).toBe('img_up1');
      expect(Object.keys(await stored(page))).toContain('studio_images/img_up3');
      await page.click(tile('img_up1', 'remove'));
      await page.click(tile('img_up2', 'remove'));
      await settled(page, 0);
      expect((await peter(page)).images).toEqual([]);
      expect((await peter(page)).primary).toBe(null);
      expect((await line(page)).primary).toBe(null);
      await expect(page.locator('#muse-e-photos-empty').isVisible()).resolves.toBe(true);
      await expect(page.locator('#muse-e-photo-main').isVisible()).resolves.toBe(false);
      expect(
        Object.keys(await stored(page)).filter((p) => p.startsWith('studio_images/img_up'))
      ).toHaveLength(3);
    }
  );

  each('a photo is picked from the studio’s library, and searched for', async (page) => {
    await openPeter(page);
    await page.click('#muse-e-photo-pick');
    await page.waitForSelector('.muse-picker-tile[data-id="img_old"]');
    await page.fill('#muse-e-photo-search', 'nothing like it');
    await expect(page.locator('.muse-picker-tile').count()).resolves.toBe(0);
    await page.fill('#muse-e-photo-search', 'dusk');
    await page.click('.muse-picker-tile[data-id="img_old"]');
    await settled(page, 1);
    expect((await peter(page)).images).toEqual(['img_old']);
    expect((await peter(page)).primary).toBe('img_old');
    expect((await line(page)).primary).toBe('img_old');
    // Nothing was uploaded: it was already in the studio.
    await expect(page.evaluate(() => window.__puts.length)).resolves.toBe(0);
    // Picked once, it is marked and not added twice.
    await expect(
      page.locator('.muse-picker-tile[data-id="img_old"]').getAttribute('class')
    ).resolves.toMatch(/muse-picker-used/);
    await page.click('.muse-picker-tile[data-id="img_old"]');
    await settled(page, 1);
    expect((await peter(page)).images).toEqual(['img_old']);
  });

  each('a photo the studio no longer has is shown as gone, and can be taken off', async (page) => {
    await openPeter(page);
    await page.evaluate(async () => {
      // An element that kept an image id the studio has since deleted.
      const path = 'muse_projects/p_court/elements/el_peter';
      window.__store.set(path, {
        ...window.__store.get(path),
        images: ['img_gone', 'img_old'],
        primary: 'img_gone',
      });
      window.location.hash = '#/p/p_court/t/character';
    });
    await page.waitForSelector('#muse-type:not(.hidden)');
    await page.evaluate(() => (window.location.hash = '#/p/p_court/e/el_peter'));
    await settled(page, 2);
    await expect(page.locator('.muse-photo-missing').count()).resolves.toBeGreaterThan(0);
    await page.click(tile('img_gone', 'remove'));
    await settled(page, 1);
    expect((await peter(page)).images).toEqual(['img_old']);
    expect((await peter(page)).primary).toBe('img_old');
  });

  each('a file that is not an image is refused before anything is sent', async (page) => {
    await openPeter(page);
    await page.setInputFiles('#muse-e-photo-file', {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    });
    await expect(page.locator('#muse-e-photo-error').innerText()).resolves.toMatch(
      /isn’t a PNG, JPEG, WebP or SVG/
    );
    await expect(page.evaluate(() => window.__puts.length)).resolves.toBe(0);
    expect((await peter(page)).images).toEqual([]);
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

  run(
    'an element or a type that isn’t there says so',
    SCREENS.desktop,
    { hash: '#/p/p_isle/e/nope' },
    async (page) => {
      await page.waitForSelector('#muse-missing:not(.hidden)');
      await page.evaluate(() => (window.location.hash = '#/p/p_isle/t/dragon'));
      await page.waitForSelector('#muse-missing:not(.hidden)');
      await page.evaluate(() => (window.location.hash = '#/p/p_isle/e/el_sea'));
      await page.waitForSelector('#muse-element:not(.hidden)');
    }
  );

  run(
    'deleting a project deletes its elements and index',
    SCREENS.desktop,
    { hash: '#/p/p_isle' },
    async (page) => {
      await page.waitForSelector('#muse-project:not(.hidden)');
      await page.click('#muse-p-delete');
      await page.click('#muse-p-delete-yes');
      await page.waitForSelector('#muse-home:not(.hidden)');
      const left = Object.keys(await stored(page)).filter((p) => p.includes('p_isle'));
      expect(left).toEqual([]);
    }
  );

  run('a phone reads an element', PHONE, { hash: '#/p/p_isle/e/el_sea' }, async (page) => {
    await page.waitForSelector('#muse-element:not(.hidden)');
    await expect(page.locator('#muse-e-aliases').innerText()).resolves.toMatch(/Old Brass/);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  run('without the muse claim, it explains', SCREENS.desktop, { apps: ['loom'] }, async (page) => {
    await page.waitForSelector('#muse-denied:not(.hidden)');
    await expect(page.locator('#muse-home').isVisible()).resolves.toBe(false);
  });

  run(
    'a phone reads an element’s relationships, and searches',
    PHONE,
    { hash: '#/p/p_court/e/el_peter' },
    async (page) => {
      await page.waitForSelector('#muse-e-relationships:not(.hidden) .muse-rel');
      await expect(page.locator('.muse-rel').innerText()).resolves.toMatch(/son of\s+Marta/);
      await page.fill('#muse-search-box', 'widow');
      await expect(page.locator('.muse-suggest-row').count()).resolves.toBe(1);
      await page.click('#muse-r-add');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  );

  run('a phone reads and adds photos', PHONE, { hash: '#/p/p_court/e/el_peter' }, async (page) => {
    await page.waitForSelector('#muse-element:not(.hidden)');
    await page.setInputFiles('#muse-e-photo-file', {
      name: 'peter.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await page.waitForSelector('.muse-photo');
    await page.waitForSelector('#muse-e-photo-main img');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  run(
    'a refusal from the studio is shown, and nothing is saved on the element',
    SCREENS.desktop,
    { hash: '#/p/p_court/e/el_peter' },
    async (page) => {
      await page.waitForSelector('#muse-element:not(.hidden)');
      // The studio's callable refusing the caller, as it does without a claim.
      await page.evaluate(() => {
        window.firebase.functions = () => ({
          httpsCallable: () => () =>
            Promise.reject(new Error('You do not have access to the Image Studio.')),
        });
      });
      await page.setInputFiles('#muse-e-photo-file', {
        name: 'peter.png',
        mimeType: 'image/png',
        buffer: PNG,
      });
      await page.waitForSelector('#muse-e-photo-error:not(.hidden)');
      await expect(page.locator('#muse-e-photo-error').innerText()).resolves.toMatch(
        /do not have access to the Image Studio/
      );
      const saved = (await stored(page))['muse_projects/p_court/elements/el_peter'];
      expect(saved.images).toEqual([]);
    }
  );

  run('a phone reads a project and its summary', PHONE, { hash: '#/p/p_sea' }, async (page) => {
    await page.waitForSelector('#muse-project:not(.hidden)');
    await expect(page.locator('#muse-p-summary h1').isVisible()).resolves.toBe(true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
