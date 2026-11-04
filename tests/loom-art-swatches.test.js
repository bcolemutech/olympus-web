'use strict';

/**
 * The swatch page (planning/maps-from-data.md RD1, OB1; L-925 / #729) in
 * headless Chrome: every material and every catalog object loads from the art
 * in the repo, each at the size it is drawn, and an object with no art is the
 * box with a question mark; and a file that goes missing is reported, not
 * silently drawn blank.
 *
 * It needs Playwright (in the tests' dependencies) and its Chromium, which CI
 * installs (L-924): where the browser is missing the suite is skipped, with
 * a note.
 *
 * Run: cd tests && npx jest loom-art-swatches --verbose
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const catalog = require('../functions/loom-canon/materials');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  chromium = null;
}

const PUBLIC = path.join(__dirname, '../public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const PAGE = '/apps/loom/art/swatches.html';
const TOTAL = catalog.MATERIALS.length + catalog.OBJECT_KINDS.length + 1;

jest.setTimeout(60000);

let browser = null;
let server = null;
let origin = '';
const hidden = new Set(); // paths the server answers 404 to

beforeAll(async () => {
  if (!chromium) return;
  try {
    browser = await chromium.launch();
  } catch {
    browser = null;
    return;
  }
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(PUBLIC, url);
    if (!file.startsWith(PUBLIC) || hidden.has(url) || !fs.existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

// A page of the swatches, once it has finished loading everything.
async function swatches() {
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(origin + PAGE);
  await page.waitForSelector('html[data-ready="true"]');
  return { page, errors };
}

const run = (name, fn) =>
  test(name, async () => {
    if (!browser) {
      console.warn(`loom-art-swatches: skipped "${name}" (no Playwright or Chromium here)`);
      return;
    }
    await fn();
  });

describe('every material and catalog object, in headless Chrome', () => {
  run('all of them load, and each has a swatch', async () => {
    const { page, errors } = await swatches();
    const result = await page.evaluate(() => window.__swatches);
    expect(result).toMatchObject({ total: TOTAL, loaded: TOTAL, failed: [] });
    expect(errors).toEqual([]);
    const ids = await page.$$eval('figure[data-id]', (figs) => figs.map((f) => f.dataset.id));
    expect(ids.sort()).toEqual(
      [
        ...catalog.MATERIALS.map((m) => `${m.kind}:${m.id}`),
        ...catalog.OBJECT_KINDS.map((k) => `object:${k.id}`),
        'object:unknown',
      ].sort()
    );
    const states = await page.$$eval('figure[data-id]', (figs) => figs.map((f) => f.dataset.state));
    expect(new Set(states)).toEqual(new Set(['ready']));
    expect(await page.textContent('#summary')).toBe(`${TOTAL} of ${TOTAL} swatches loaded.`);
    await page.close();
  });

  run(
    'each is the size it is drawn: tiles 64 × 64, strips 64 × 16, objects at 16 to the foot',
    async () => {
      const { page } = await swatches();
      const sizes = await page.$$eval('figure[data-id]', (figs) =>
        Object.fromEntries(figs.map((f) => [f.dataset.id, [+f.dataset.width, +f.dataset.height]]))
      );
      for (const m of catalog.MATERIALS) {
        expect(sizes[`${m.kind}:${m.id}`]).toEqual(m.kind === 'ground' ? [64, 64] : [64, 16]);
      }
      for (const k of catalog.OBJECT_KINDS) {
        expect(sizes[`object:${k.id}`]).toEqual([
          Math.round(k.size[0] * 16),
          Math.round(k.size[1] * 16),
        ]);
      }
      await page.close();
    }
  );

  run('the box with a question mark is what an object with no art gets', async () => {
    const { page } = await swatches();
    expect(await page.evaluate(() => window.__swatches.unknownFrom)).toBe('unknown');
    const box = await page.$('figure[data-id="object:unknown"]');
    expect(await box.getAttribute('data-state')).toBe('ready');
    expect(await box.getAttribute('data-width')).toBe('48');
    const img = await box.$('img');
    expect(await img.getAttribute('src')).toBe('/apps/loom/art/objects/unknown.svg');
    // It is drawn: a picture the browser has decoded, with something in it.
    const drawn = await img.evaluate((el) => {
      const canvas = document.createElement('canvas');
      canvas.width = el.naturalWidth;
      canvas.height = el.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(el, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0;
      let opaque = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 200) opaque += 1;
        if (data[i + 3] > 200 && data[i] < 90 && data[i + 1] < 80) dark += 1; // the mark's ink
      }
      return { opaque, dark };
    });
    expect(drawn.opaque).toBeGreaterThan(1000); // the box
    expect(drawn.dark).toBeGreaterThan(80); // the ? and its dot
    await page.close();
  });

  run(
    'a ground tile fills its swatch with no gap, and a floor looks different from a wall',
    async () => {
      const { page } = await swatches();
      const fig = await page.$('figure[data-id="ground:stone"] .tile');
      const box = await fig.boundingBox();
      expect(Math.round(box.width)).toBe(128);
      const tile = await fig.screenshot();
      const wall = await (await page.$('figure[data-id="wall:stone"] .strip')).screenshot();
      expect(tile.length).toBeGreaterThan(500);
      expect(tile.equals(wall)).toBe(false);
      await page.close();
    }
  );
});

describe('art that goes missing', () => {
  run('is reported on the page, not drawn blank', async () => {
    hidden.add('/apps/loom/art/objects/chest.svg');
    hidden.add('/apps/loom/art/materials/wall-brick.svg');
    try {
      const { page } = await swatches();
      const result = await page.evaluate(() => window.__swatches);
      expect(result.total).toBe(TOTAL);
      expect(result.loaded).toBe(TOTAL - 2);
      expect(result.failed.sort()).toEqual(['object:chest', 'wall:brick']);
      expect(await page.getAttribute('figure[data-id="object:chest"]', 'data-state')).toBe(
        'missing'
      );
      expect(await page.getAttribute('figure[data-id="object:table"]', 'data-state')).toBe('ready');
      expect(await page.textContent('#summary')).toContain('missing: ');
      await page.close();
    } finally {
      hidden.clear();
    }
  });
});
