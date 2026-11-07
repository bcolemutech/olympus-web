'use strict';

/**
 * An object's click menu and card in headless Chrome (public/apps/loom/js/
 * battle.js, engine.js; planning/maps-from-data.md §4.4; L-926 / #730), on
 * the Loom's grid view on the real map engine (fixtures/paint/drawers.html),
 * drawing the vault (./helpers/vault.js) as loomGetMap sends it (the server's
 * own battleView and turnView, no Firestore), under both built-in systems
 * (MD2), clicked with a real mouse:
 *
 *   - a click on an object opens its menu with its card across the top: its
 *     art, name, description and state, and below, each action at its AP
 *     cost; "What's here?" last;
 *   - what is shown follows what the server sent: the key makes it Unlock,
 *     without it the lock is picked (a long action); once open, what it
 *     holds is on the card and nothing is left to do;
 *   - an action out of reach, with too few AP left, or while a turn is under
 *     way, is greyed out with the reason;
 *   - choosing sends that object action, or the look; a lever is clicked
 *     where it stands, its square; scenery gets the ordinary square menu;
 *   - the card's picture is the object's `cardArt`, else its own art;
 *   - the object clicked is selected, and the info card says so;
 *   - your own square offers Search (L-927), at the standard AP price;
 *   - a click on a standing chest's picture, above its footprint, opens its
 *     menu (L-941); without a standing picture the same point is a square.
 *
 * It needs Playwright and its Chromium (in the tests' dependencies; CI
 * installs the browser): where the browser is missing the suite is skipped,
 * with a note.
 *
 * Run: cd tests && npx jest loom-objects-menu --verbose
 */

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const apRules = require('../functions/loom-canon/ap');
const { battleView, turnView } = require('../functions/loom-turn/map-view');
const { VAULT } = require('./helpers/vault');
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

// A test that needs the browser; skipped, with a note, without one.
const withBrowser = (name, fn) =>
  test(name, async () => {
    if (!browser) {
      console.warn(`Skipped "${name}": Playwright's Chromium isn't installed here.`);
      return;
    }
    await fn();
  });

// The vault as the server sends it to a player at `cell` (and the turn): the
// page's `data` and `turn`, as JSON as they arrive.
function sentTo(system, cell, { inventory = [], objects, ap = 20, vault = VAULT() } = {}) {
  const world = {
    system,
    battleMaps: { bm_vault: vault },
    characters: {},
    locations: {},
    places: {},
    factions: {},
    regions: {},
    lore: {},
  };
  const save = {
    mapId: 'bm_vault',
    cell,
    location: 'x',
    character: { name: 'Tam', inventory, sheet: sheets.defaultSheet(system) },
    turn: { n: 1, ap, kept: 0, plan: null },
    ...(objects ? { objects } : {}),
  };
  return JSON.parse(
    JSON.stringify({ data: battleView(world, save, null), turn: turnView(save, world) })
  );
}

// The page with the vault shown and the play actions recorded; `prepare`, run
// on the page first.
async function shown(sent, prepare) {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/fixtures/paint/drawers.html');
  await page.evaluate(() => {
    window.__calls = [];
    const record = (name) =>
      function () {
        window.__calls.push([name].concat(Array.from(arguments)));
      };
    Loom.play.objectAction = record('object');
    Loom.play.lookAt = record('look');
    Loom.play.tactic = record('tactic');
  });
  if (prepare) await page.evaluate(prepare);
  await page.evaluate(([d, t]) => window.__show(d, t), [sent.data, sent.turn]);
  page.errors = errors;
  return page;
}

// A real click on a point in feet of the map.
async function clickAt(page, feet) {
  const at = await page.evaluate((f) => {
    const m = Loom.battle.mapPoint({ x: f[0], y: f[1] });
    return Loom.mapMath.toScreen(Loom.engine.camera.view, m.x, m.y);
  }, feet);
  await page.mouse.click(at.x, at.y);
}

// What the open menu says.
const menuOf = (page) =>
  page.evaluate(() => {
    const menu = document.querySelector('.loom-map-menu');
    if (!menu) return null;
    const text = (el, sel) => {
      const found = el.querySelector(sel);
      return found ? found.textContent : null;
    };
    const art = menu.querySelector('.loom-map-menu-card-art');
    return {
      title: text(menu, '.loom-map-menu-title'),
      subtitle: text(menu, '.loom-map-menu-subtitle'),
      card: menu.querySelector('.loom-map-menu-card')
        ? {
            art: art ? art.getAttribute('src') : null,
            text: text(menu, '.loom-map-menu-card-desc'),
            lines: Array.from(menu.querySelectorAll('.loom-map-menu-card-line')).map(
              (p) => p.textContent
            ),
          }
        : null,
      items: Array.from(menu.querySelectorAll('.loom-map-menu-item')).map((b) => ({
        label: b.querySelector('.loom-map-menu-label').textContent,
        note: (b.querySelector('.loom-map-menu-note') || {}).textContent || '',
        disabled: b.disabled,
      })),
    };
  });
const callsOf = (page) => page.evaluate(() => window.__calls);

// Feet of the vault's objects' middles (./helpers/vault.js).
const CHEST = [7.5, 22.5];
const CRATE = [7.5, 7.5];
const LEVER = [22.5, 2.5];
const STATUE = [50, 20];

describe.each(['d20-fantasy', 'pool-scifi'])('an object’s menu and card under %s', (id) => {
  const system = BUILT_IN[id];
  const prices = apRules.pricesOf(system, sheets.defaultSheet(system));
  const stand = { x: 2, y: 4 }; // beside the chest

  withBrowser('a locked chest, with its key: its card, and Unlock at its cost', async () => {
    const page = await shown(sentTo(system, stand, { inventory: ['brass key'] }));
    await clickAt(page, CHEST);
    await page.waitForSelector('.loom-map-menu');
    const menu = await menuOf(page);
    expect(menu).toMatchObject({
      title: 'The chest',
      subtitle: 'Object · locked',
      card: { text: 'an iron-bound chest', lines: ['Locked.'] },
    });
    // The picture on its card is the painter's art for it.
    expect(menu.card.art).toMatch(/chest\.svg$/);
    expect(menu.items).toEqual([
      { label: 'Unlock', note: `${prices.of('object')} AP`, disabled: false },
      { label: "What's here?", note: 'Free', disabled: false },
    ]);
    // Never what it holds, nor what unlocks it, nor how hard the lock is.
    const html = await page.evaluate(() => document.querySelector('.loom-map-menu').innerHTML);
    expect(html).not.toMatch(/dagger|brass|difficulty/i);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('choosing Unlock sends that object action; the menu closes', async () => {
    const page = await shown(sentTo(system, stand, { inventory: ['brass key'] }));
    await clickAt(page, CHEST);
    await page.click('.loom-map-menu-item:has-text("Unlock")');
    expect(await callsOf(page)).toEqual([['object', 'chest', 'unlock', 'unlock the chest']]);
    expect(await menuOf(page)).toBeNull();
    await page.close();
  });

  withBrowser('without the key the lock is picked: a long action, over turns', async () => {
    const page = await shown(sentTo(system, stand));
    await clickAt(page, CHEST);
    await page.waitForSelector('.loom-map-menu');
    const menu = await menuOf(page);
    expect(menu.items[0]).toEqual({
      label: 'Pick the lock',
      note: '30 AP of work, over turns',
      disabled: false,
    });
    await page.click('.loom-map-menu-item:has-text("Pick the lock")');
    expect(await callsOf(page)).toEqual([['object', 'chest', 'unlock', 'pick the lock the chest']]);
    await page.close();
  });

  withBrowser('once open: what it holds is on its card, and nothing is left to do', async () => {
    const opened = sentTo(system, stand, { objects: { bm_vault: { chest: 'open' } } });
    const page = await shown(opened);
    await clickAt(page, CHEST);
    await page.waitForSelector('.loom-map-menu');
    const menu = await menuOf(page);
    expect(menu.subtitle).toBe('Object · open');
    expect(menu.card.lines).toEqual(['Open.', 'It holds a silver dagger and 12 gold pieces.']);
    expect(menu.items.map((i) => i.label)).toEqual(["What's here?"]);
    await page.close();
  });

  withBrowser('a crate opens at its own cost, and says it is closed', async () => {
    const page = await shown(sentTo(system, { x: 2, y: 1 }));
    await clickAt(page, CRATE);
    await page.waitForSelector('.loom-map-menu');
    const crate = await menuOf(page);
    expect(crate.title).toBe('The crate');
    expect(crate.items[0]).toEqual({
      label: 'Open',
      note: `${prices.of('object', 8)} AP`,
      disabled: false,
    });
    expect(crate.card.lines).toEqual(['Closed.']);
    await page.close();
  });

  withBrowser('out of reach: greyed out, with the reason', async () => {
    // Where it can be seen but not touched.
    const page = await shown(sentTo(system, { x: 4, y: 6 }, { inventory: ['brass key'] }));
    await clickAt(page, CHEST);
    await page.waitForSelector('.loom-map-menu');
    const menu = await menuOf(page);
    expect(menu.items[0]).toEqual({
      label: 'Unlock',
      note: 'Walk beside it to unlock.',
      disabled: true,
    });
    expect(await callsOf(page)).toEqual([]);
    await page.close();
  });

  withBrowser('too few AP left: greyed out, with what it costs and what is left', async () => {
    const page = await shown(sentTo(system, stand, { inventory: ['brass key'], ap: 1 }));
    await clickAt(page, CHEST);
    await page.waitForSelector('.loom-map-menu');
    const menu = await menuOf(page);
    expect(menu.items[0]).toEqual({
      label: 'Unlock',
      note: `Costs ${prices.of('object')} AP; you have 1.`,
      disabled: true,
    });
    await page.close();
  });

  withBrowser('a turn under way: nothing can be chosen', async () => {
    const page = await shown(sentTo(system, stand, { inventory: ['brass key'] }));
    await page.evaluate(() => {
      Loom.state.turnInProgress = true;
    });
    await clickAt(page, CHEST);
    await page.waitForSelector('.loom-map-menu');
    const menu = await menuOf(page);
    expect(menu.items).toEqual([
      { label: 'Unlock', note: 'A turn is under way.', disabled: true },
      { label: "What's here?", note: 'A turn is under way.', disabled: true },
    ]);
    await page.close();
  });

  withBrowser('"What\'s here?" looks at the object, for nothing', async () => {
    const page = await shown(sentTo(system, stand, { inventory: ['brass key'] }));
    await clickAt(page, CHEST);
    await page.click('.loom-map-menu-item:has-text("What\'s here?")');
    expect(await callsOf(page)).toEqual([['look', { object: 'chest' }, 'look at the chest']]);
    await page.close();
  });

  withBrowser('a lever is clicked where it stands, and pulled for its own AP', async () => {
    const page = await shown(sentTo(system, { x: 4, y: 1 }));
    await clickAt(page, LEVER);
    await page.waitForSelector('.loom-map-menu');
    const menu = await menuOf(page);
    expect(menu).toMatchObject({ title: 'The lever', subtitle: 'Object', card: { lines: [] } });
    expect(menu.items[0]).toEqual({
      label: 'Pull',
      note: `${prices.of('object', 3)} AP`,
      disabled: false,
    });
    await page.click('.loom-map-menu-item:has-text("Pull")');
    expect(await callsOf(page)).toEqual([['object', 'lever', 'pull', 'pull the lever']]);
    await page.close();
  });

  withBrowser('scenery has no object menu: the square’s own', async () => {
    const page = await shown(sentTo(system, { x: 8, y: 4 }));
    await clickAt(page, STATUE);
    await page.waitForSelector('.loom-map-menu');
    const menu = await menuOf(page);
    expect(menu.title).not.toBe('The statue');
    expect(menu.card).toBeNull();
    await page.close();
  });

  withBrowser('the object clicked is selected, and the info card says so', async () => {
    const page = await shown(sentTo(system, stand, { inventory: ['brass key'] }));
    await clickAt(page, CHEST);
    await page.waitForSelector('.loom-map-menu');
    const info = await page.evaluate(() => {
      const el = document.createElement('div');
      Loom.battle.renderInfo(el);
      return el.textContent;
    });
    expect(info).toContain('The chest');
    expect(info).toContain('Object · locked');
    // Clicking a square clears it.
    await clickAt(page, [27.5, 7.5]);
    const after = await page.evaluate(() => {
      const el = document.createElement('div');
      Loom.battle.renderInfo(el);
      return el.textContent;
    });
    expect(after).not.toContain('Object ·');
    await page.close();
  });

  withBrowser(
    'your own square offers Search at its cost; choosing it sends the search',
    async () => {
      // L-927: the rules roll the noticing check over everything in sight.
      const page = await shown(sentTo(system, stand, { inventory: ['brass key'] }));
      await clickAt(page, [12.5, 22.5]);
      await page.waitForSelector('.loom-map-menu');
      const menu = await menuOf(page);
      const search = menu.items.find((i) => i.label === 'Search');
      expect(search).toEqual({
        label: 'Search',
        note: `${apRules.tierCost(system, 'standard')} AP · for what is hidden in sight`,
        disabled: false,
      });
      await page.click('.loom-map-menu-item:has-text("Search")');
      expect(await callsOf(page)).toEqual([['tactic', 'search', null, 'search the area']]);
      await page.close();
    }
  );

  withBrowser('a click on a standing chest’s picture opens its menu (L-941)', async () => {
    // A tall standing picture, so it rises well above the chest's footprint
    // (21.5–23.5 ft down): 3 ft wide and, by the picture's shape, 12 ft tall.
    // In an art set of the test's own (L-944).
    const tall = () => {
      Loom.materials.registerSet(
        { name: 'test-tall', objects: { chest: { stand: { file: 'pillar-stand.svg' } } } },
        '/fixtures/paint/'
      );
    };
    const above = [7.5, 18.5];
    const sent = sentTo(system, stand, { inventory: ['brass key'] });
    sent.data.artSet = 'test-tall';
    const page = await shown(sent, tall);
    await clickAt(page, above);
    await page.waitForSelector('.loom-map-menu');
    expect(await menuOf(page)).toMatchObject({ title: 'The chest', subtitle: 'Object · locked' });
    expect(page.errors).toEqual([]);
    await page.close();
    // Lying flat (no standing picture), the same point is only its square.
    const flat = await shown(sentTo(system, stand, { inventory: ['brass key'] }));
    await clickAt(flat, above);
    await flat.waitForSelector('.loom-map-menu');
    expect((await menuOf(flat)).title).not.toBe('The chest');
    await flat.close();
  });

  withBrowser('its card shows its own card art, else its map art', async () => {
    const vault = VAULT();
    const chest = vault.geometry.objects.find((o) => o.id === 'chest');
    chest.cardArt = {
      imageId: 'img-chest-card',
      link: '/fixtures/paint/art.svg',
      width: 64,
      height: 64,
    };
    const page = await shown(sentTo(system, stand, { inventory: ['brass key'], vault }));
    await clickAt(page, CHEST);
    await page.waitForSelector('.loom-map-menu');
    expect((await menuOf(page)).card.art).toBe('/fixtures/paint/art.svg');
    await page.close();
  });
});
