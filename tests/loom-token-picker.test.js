'use strict';

/**
 * The player's token picker (planning/tokens.md §4.3, TK2; L-933 / #791) in
 * headless Chrome, on the real components (fixtures/token-picker/), with the
 * callables stubbed, on a desktop and a phone:
 *
 *   - the new-game flow's Token step: the world's portraits, one picked and
 *     framed by dragging and the zoom slider, sent to loomCreateSave; an
 *     upload of their own, sent through loomUploadToken at its crop; a file
 *     that isn't a picture refused; a world with no portraits offering
 *     upload only;
 *   - the Character panel's Token: the one they have, changed to another
 *     portrait or re-framed, as a token turn, and the map reloaded.
 *
 * It needs Playwright and its Chromium; where the browser is missing the
 * suite is skipped, with a note.
 *
 * Run: cd tests && npx jest loom-token-picker --verbose
 */

const path = require('path');
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
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: devices['iPhone 13'] || { viewport: { width: 390, height: 844 }, hasTouch: true },
};

const PORTRAITS = [
  {
    id: 'img_00000000000000a1',
    link: '/fixtures/tokens/chief.png',
    crop: { x: 0.5, y: 0.3, zoom: 1 },
  },
  {
    id: 'img_00000000000000a2',
    link: '/fixtures/tokens/villain.png',
    crop: { x: 0.5, y: 0.5, zoom: 1 },
  },
];
const RULES = (portraits) => ({
  system: { id: 'd20-fantasy', name: 'd20 fantasy', words: {} },
  creation: null,
  premade: true,
  portraits,
});

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
      await page.goto(`${origin}/fixtures/token-picker/index.html`);
      await page.waitForFunction(() => Boolean(window.Loom && window.Loom.tokenPicker));
      try {
        await fn(page, screen);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    })
  );

// Shows the new-game flow for a world's rules; `onCreate` keeps what it's given.
async function showCreation(page, rules) {
  await page.evaluate((r) => {
    window.__created = null;
    Loom.creation.show(document.getElementById('create-host'), {
      worldId: 'faces',
      characterName: 'Tam',
      rules: r,
      onCreate: (choices, token) => {
        window.__created = {
          choices,
          token: token && {
            id: token.id || null,
            file: token.file ? { name: token.file.name, type: token.file.type } : null,
            crop: token.crop,
          },
          forCreate: Loom.tokenPicker.forCreate(token),
        };
        window.__token = token;
        return Promise.resolve();
      },
      onCancel: () => {},
    });
  }, rules);
  await page.waitForSelector('#loom-create-token');
}

// Drags the crop's circle by (dx, dy) screen px, with the mouse or a finger.
async function drag(page, dx, dy) {
  const frame = page.locator('#loom-create-token-frame, #loom-character-picker-frame').first();
  const box = await frame.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await frame.dispatchEvent('pointerdown', {
    pointerId: 1,
    clientX: x,
    clientY: y,
    button: 0,
    isPrimary: true,
  });
  for (let i = 1; i <= 4; i++) {
    await frame.dispatchEvent('pointermove', {
      pointerId: 1,
      clientX: x + (dx * i) / 4,
      clientY: y + (dy * i) / 4,
      isPrimary: true,
    });
  }
  await frame.dispatchEvent('pointerup', { pointerId: 1, clientX: x + dx, clientY: y + dy });
}

async function setZoom(page, selector, value) {
  await page.locator(selector).evaluate((input, v) => {
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

// The picture's place in the crop's circle.
const pictureIn = (page, frame) =>
  page.locator(`${frame} img`).evaluate((img) => ({
    width: parseFloat(img.style.width),
    left: parseFloat(img.style.left),
    top: parseFloat(img.style.top),
  }));

// Nothing wider than the screen.
const fits = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

each('a portrait picked at creation, framed by dragging and zoom', async (page) => {
  await showCreation(page, RULES(PORTRAITS));
  const choices = page.locator('#loom-create-token [data-portrait]');
  expect(await choices.count()).toBe(2);
  expect(await page.locator('#loom-create-token-crop').count()).toBe(0);
  // Begin with none: no token.
  expect(await page.locator('#loom-create-begin').isVisible()).toBe(true);

  await choices.nth(0).click();
  expect(await choices.nth(0).getAttribute('aria-pressed')).toBe('true');
  await page.waitForSelector('#loom-create-token-frame img');
  const before = await pictureIn(page, '#loom-create-token-frame');

  await setZoom(page, '#loom-create-token-zoom', 2);
  const zoomed = await pictureIn(page, '#loom-create-token-frame');
  expect(zoomed.width).toBeCloseTo(before.width * 2, 0);

  // Dragged up and left: the circle moves down and right on the picture.
  await drag(page, -20, -30);
  const dragged = await pictureIn(page, '#loom-create-token-frame');
  expect(dragged.left).toBeLessThan(zoomed.left);
  expect(dragged.top).toBeLessThan(zoomed.top);
  expect(await fits(page)).toBe(true);

  await page.click('#loom-create-begin');
  const created = await page.evaluate(() => window.__created);
  expect(created.choices).toBeNull();
  expect(created.token.id).toBe(PORTRAITS[0].id);
  expect(created.forCreate.image).toBe(PORTRAITS[0].id);
  expect(created.forCreate.crop.zoom).toBeCloseTo(2, 3);
  expect(created.forCreate.crop.x).toBeGreaterThan(0.5);
  expect(created.forCreate.crop.y).toBeGreaterThan(0.3);
  // The circle stays on the picture.
  const side = Math.min(128, 192) / 2;
  expect(created.forCreate.crop.x).toBeLessThanOrEqual(1 - side / 2 / 128 + 1e-6);
});

each('an upload of their own, framed and sent through loomUploadToken', async (page) => {
  await showCreation(page, RULES(PORTRAITS));
  await page.setInputFiles(
    '#loom-create-token-file',
    path.join(__dirname, 'fixtures/tokens/chief.png')
  );
  await page.waitForSelector('#loom-create-token-frame img');
  await setZoom(page, '#loom-create-token-zoom', 1.5);
  await page.click('#loom-create-begin');
  const created = await page.evaluate(() => window.__created);
  expect(created.token.file).toEqual({ name: 'chief.png', type: 'image/png' });
  expect(created.forCreate).toBeNull(); // the upload goes once the save exists

  await page.evaluate(() => {
    window.__answers.loomUploadToken = {
      token: { file: 'loom_tokens/u/save-1.webp', version: 1, crop: { x: 0.5, y: 0.5, zoom: 1 } },
    };
    return Loom.tokenPicker.send('faces', 'save-1', window.__token);
  });
  const sent = await page.evaluate(() =>
    window.__calls.filter((c) => c.name === 'loomUploadToken').map((c) => c.data)
  );
  expect(sent).toHaveLength(1);
  expect(sent[0].saveId).toBe('save-1');
  expect(sent[0].crop.zoom).toBeCloseTo(1.5, 3);
  // The file's own bytes, base64: a PNG.
  expect(Buffer.from(sent[0].image, 'base64').subarray(1, 4).toString()).toBe('PNG');
});

each('a file that isn’t a picture is refused; no portraits offers upload only', async (page) => {
  await showCreation(page, RULES([]));
  expect(await page.locator('#loom-create-token [data-portrait]').count()).toBe(0);
  expect(await page.textContent('#loom-create-token')).toMatch(/offers no portraits/);
  await page.setInputFiles('#loom-create-token-file', {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a picture'),
  });
  expect(await page.textContent('#loom-create-token-error')).toMatch(/isn’t a picture/);
  expect(await page.locator('#loom-create-token-crop').count()).toBe(0);
  await page.setInputFiles('#loom-create-token-file', {
    name: 'huge.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  expect(await page.textContent('#loom-create-token-error')).toMatch(/larger than 5 MB/);
});

each('the Character panel changes the token as a token turn', async (page) => {
  await page.evaluate((portraits) => {
    window.__answers.loomCreationRules = {
      system: { id: 'd20-fantasy', name: 'd20 fantasy', words: {} },
      premade: true,
      portraits,
    };
    window.__answers.loomPlayTurn = (data) => ({ narration: 'Your token is set.', token: data });
    Loom.store.set({
      map: {
        token: { link: portraits[1].link, crop: { x: 0.5, y: 0.5, zoom: 1 } },
        character: {
          name: 'Tam Reed',
          level: { name: 'Level', value: 1 },
          misfits: [],
          resources: [],
          conditions: [],
          attributes: [],
          skills: [],
          traits: [],
          attacks: [],
          derived: [],
          ap: 20,
          rankName: 'Rank',
          system: { name: 'd20 fantasy' },
        },
      },
    });
    Loom.character.mount();
    Loom.character.open(true);
  }, PORTRAITS);
  await page.waitForSelector('#loom-character-token');
  await page.waitForSelector('#loom-character-token .loom-token-circle img');

  // Re-framing the one they have.
  await page.click('#loom-character-token-change');
  await page.waitForSelector('#loom-character-picker [data-portrait]');
  await page.waitForSelector('#loom-character-picker-frame img');
  await setZoom(page, '#loom-character-picker-zoom', 1.8);
  expect(await fits(page)).toBe(true);
  await page.click('#loom-character-token-save');
  await page.waitForFunction(() => window.__reloads === 1);
  let turns = await page.evaluate(() =>
    window.__calls.filter((c) => c.name === 'loomPlayTurn').map((c) => c.data)
  );
  expect(turns[0]).toMatchObject({ worldId: 'faces', saveId: 'save-1' });
  expect(turns[0].action.verb).toBe('token');
  expect(Object.keys(turns[0].action.token)).toEqual(['crop']);
  expect(turns[0].action.token.crop.zoom).toBeCloseTo(1.8, 3);

  // Another portrait.
  await page.click('#loom-character-token-change');
  await page.click(`#loom-character-picker [data-portrait="${PORTRAITS[0].id}"]`);
  await page.click('#loom-character-token-save');
  await page.waitForFunction(() => window.__reloads === 2);
  turns = await page.evaluate(() =>
    window.__calls.filter((c) => c.name === 'loomPlayTurn').map((c) => c.data)
  );
  expect(turns[1].action.token.image).toBe(PORTRAITS[0].id);

  // None.
  await page.click('#loom-character-token-change');
  await page.click('#loom-character-token-remove');
  await page.waitForFunction(() => window.__reloads === 3);
  turns = await page.evaluate(() =>
    window.__calls.filter((c) => c.name === 'loomPlayTurn').map((c) => c.data)
  );
  expect(turns[2].action.token).toBeNull();
  // The portraits were asked for once.
  const asked = await page.evaluate(
    () => window.__calls.filter((c) => c.name === 'loomCreationRules').length
  );
  expect(asked).toBe(1);
});
