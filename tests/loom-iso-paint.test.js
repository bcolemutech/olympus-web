'use strict';

/**
 * The painter in isometric, in headless Chrome (public/apps/loom/js/paint.js,
 * iso.js; planning/isometric-view.md §4.2, IS3, IS5, AR1, AR2; L-952 / #858),
 * on the real map engine (fixtures/paint/drawers.html with `?view=iso`) and
 * on the painter's own page (fixtures/paint/index.html):
 *
 *   - a generated forest track against its screenshot (the test dungeon and
 *     a generated interior are tests/loom-iso-view.test.js's);
 *   - walls show their face toward the camera running either way, a wall at
 *     45° (seen edge-on) its cap, and doors stand in walls both ways;
 *   - props stand by facing from their set's isometric pictures, mirrored
 *     for two of the four, a long one mirrored to lie the other way, and as
 *     their three-quarter picture where the set has no isometric one;
 *   - in the grid view, a desk behind a wall near its end is drawn behind
 *     it, a crate in front over it, and your token behind the wall or in
 *     front of it as it stands (the order's pure tests are
 *     tests/loom-iso-order.test.js);
 *   - what stands out of sight dimmed by the fog, what's in sight not;
 *   - culled on the isometric screen as the camera zooms, and back;
 *   - the large fixture drawn in no more than 1.2× the three-quarter view's
 *     time, with the CPU slowed four times.
 *
 * Skipped, with a note, where Playwright's Chromium is missing. To make the
 * screenshot again after a deliberate change: UPDATE_PAINT=1 npx jest loom-iso-paint.
 *
 * Run: cd tests && npx jest loom-iso-paint --verbose
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const geo = require('../functions/loom-canon/map-geometry');
const sight = require('../functions/loom-canon/sight');
const seen = require('../functions/loom-turn/seen');
const generators = require('../functions/loom-canon/map-generators');
const { dungeon } = require('./fixtures/paint/dungeon');
const { large } = require('./fixtures/paint/large');
const { serveFixtures } = require('./helpers/fixture-server');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  chromium = null;
}

jest.setTimeout(240000);

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

// A grid map as loomGetMap sends it, seen from `viewer` ({ cell, point });
// `seenAll`: every square seen before, only those in sight in sight now.
function battleOf(id, made, viewer, extra = {}, seenAll = false) {
  const g = geo.normalize(made.geometry);
  const map = { id, width: made.width, height: made.height, geometry: g, entries: [], exits: [] };
  const inSight = sight.inSight(map, viewer, {});
  const every = {};
  for (let x = 0; x < made.width; x++)
    for (let y = 0; y < made.height; y++) every[`${x},${y}`] = true;
  return {
    id,
    name: id,
    width: made.width,
    height: made.height,
    image: null,
    artSet: 'classic',
    here: viewer.cell,
    herePoint: viewer.point,
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
    geometry: g,
    hazards: [],
    people: [],
    fog: {
      seen: seen.pack(seenAll ? every : inSight, made.width, made.height),
      inSight: seen.pack(inSight, made.width, made.height),
      view: sight.outline(map, viewer, {}),
    },
    ...extra,
  };
}

const TURN = {
  n: 1,
  ap: 20,
  pool: 20,
  prices: { move: 1, difficult: 2, door: 2, doors: {}, actions: {}, features: {} },
  plan: null,
};

async function isoPage() {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/fixtures/paint/drawers.html?view=iso');
  page.errors = errors;
  return page;
}

const show = (page, data, turn = TURN) =>
  page.evaluate(([d, t]) => window.__show(d, t, 'battle'), [data, turn]);

// Shown twice: once its set's manifest has come, drawn with it.
async function shown(page, data) {
  await show(page, data);
  await page.waitForFunction(
    (set) => !set || set.startsWith('test-') || window.Loom.materials.setOf(set),
    data.artSet,
    { timeout: 15000 }
  );
  await show(page, data);
  return page.evaluate((k) => window.Loom.mapPaint.describe(k), 'battle:' + data.id);
}

// A test set (L-944) with isometric pictures (fixtures/paint/*.svg).
const testSet = (page) =>
  page.evaluate(() =>
    window.Loom.materials.registerSet(
      {
        name: 'test-iso',
        objects: {
          chest: {
            iso: { facings: [{ file: 'chest-stand.svg' }, { file: 'bookshelf-stand.svg' }] },
          },
          table: {
            iso: {
              facings: [{ file: 'pillar-stand.svg' }, { file: 'pillar-stand.svg' }],
              long: 'y',
            },
          },
          crate: { stand: { file: 'chest-stand.svg' } },
        },
      },
      '/fixtures/paint/'
    )
  );

const floor = (w, h) => [
  { id: 'floor', material: 'flagstone', shape: { rect: { x: 0, y: 0, w, h } } },
];

describe('the painter in isometric (L-952)', () => {
  withBrowser('a generated forest track, isometric, against its screenshot', async () => {
    const page = await isoPage();
    const made = generators.generate('wilds', {
      seed: 'wilds-track',
      terrain: 'forest',
      scene: 'forest-track',
    });
    const c = { x: Math.floor(made.width / 2), y: Math.floor(made.height / 2) };
    const data = battleOf('wilds', made, {
      cell: c,
      point: { x: c.x * 5 + 2.5, y: c.y * 5 + 2.5 },
    });
    const drawn = await shown(page, data);
    const props = drawn.filter((d) => d.layer === 'standing' && d.kind === 'object');
    expect(props.length).toBeGreaterThan(10);
    matchesBaseline(PNG.sync.read(await page.screenshot()), 'iso-wilds.png');
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser(
    'walls show their faces running either way, a 45° wall its cap, and doors stand in both',
    async () => {
      const page = await isoPage();
      const geometry = {
        ground: floor(60, 60),
        walls: [
          {
            id: 'north',
            material: 'stone',
            points: [
              [0, 0],
              [60, 0],
            ],
          },
          {
            id: 'west',
            material: 'brick',
            points: [
              [0, 0],
              [0, 60],
            ],
          },
          // Running north-west to south-east: seen edge-on, a vertical line.
          {
            id: 'edge-on',
            material: 'stone',
            points: [
              [20, 20],
              [40, 40],
            ],
          },
          // Running north-east: its face full on.
          {
            id: 'facing',
            material: 'wood',
            points: [
              [10, 50],
              [25, 35],
            ],
          },
        ],
        doors: [
          { id: 'n-door', material: 'wood', from: [25, 0], to: [30, 0], wall: 'north' },
          {
            id: 'w-door',
            material: 'iron',
            from: [0, 25],
            to: [0, 30],
            wall: 'west',
            state: 'locked',
          },
        ],
      };
      const data = battleOf(
        'walls',
        { width: 12, height: 12, geometry },
        {
          cell: { x: 6, y: 2 },
          point: { x: 32.5, y: 12.5 },
        }
      );
      const drawn = await shown(page, data);
      const parts = (id) => drawn.filter((d) => d.layer === 'standing' && d.id === id);
      ['north', 'west', 'facing'].forEach((id) => {
        expect(parts(id).length).toBeGreaterThan(1);
        parts(id).forEach((p) => expect(p.shows).toEqual(expect.arrayContaining(['face', 'cap'])));
      });
      // Cut into pieces of at most a tile and a half: the north wall's 25 ft
      // and 30 ft either side of its door, in 4 each.
      expect(parts('north').length).toBe(8);
      // The 45° wall: its cap on each piece, no face (it's seen edge-on); its
      // end toward the camera, at its south-east end.
      expect(parts('edge-on').length).toBeGreaterThan(1);
      parts('edge-on').forEach((p) => {
        expect(p.shows).toContain('cap');
        expect(p.shows).not.toContain('face');
      });
      // Each door a panel facing the camera, in its wall either way, and the wall over it.
      ['n-door', 'w-door'].forEach((id) => {
        const door = parts(id);
        expect(door.length).toBe(2);
        door.forEach((p) => expect(p.shows).toContain('face'));
      });
      expect(parts('w-door')[0].state).toBe('locked');
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );

  withBrowser(
    "props stand by facing from their set's isometric pictures, or as their three-quarter one",
    async () => {
      const page = await isoPage();
      await testSet(page);
      const chest = (turn) => ({
        id: `chest-${turn}`,
        kind: 'chest',
        at: [10 + turn / 10, 10],
        turn,
      });
      const geometry = {
        ground: floor(60, 40),
        objects: [
          chest(0),
          chest(90),
          chest(180),
          chest(270),
          // A table long along its own x, its pictures painted long along y.
          { id: 'table', kind: 'table', at: [30, 30], size: [10, 5] },
          { id: 'table-turned', kind: 'table', at: [45, 30], size: [10, 5], turn: 90 },
          { id: 'crate', kind: 'crate', at: [10, 30] },
          { id: 'barrel', kind: 'barrel', at: [20, 30] },
        ],
      };
      const data = battleOf(
        'props',
        { width: 12, height: 8, geometry },
        { cell: { x: 6, y: 4 }, point: { x: 32.5, y: 22.5 } },
        { artSet: 'test-iso' }
      );
      const drawn = await shown(page, data);
      const one = (id) => drawn.find((d) => d.layer === 'standing' && d.id === id);
      const front = '/fixtures/paint/chest-stand.svg';
      const back = '/fixtures/paint/bookshelf-stand.svg';
      expect(one('chest-0')).toMatchObject({ facing: 'front', mirror: false, art: front });
      expect(one('chest-90')).toMatchObject({ facing: 'back', mirror: true, art: back });
      expect(one('chest-180')).toMatchObject({ facing: 'back', mirror: false, art: back });
      expect(one('chest-270')).toMatchObject({ facing: 'front', mirror: true, art: front });
      expect(one('table')).toMatchObject({ facing: 'front', mirror: true });
      expect(one('table-turned')).toMatchObject({ facing: 'back', mirror: false });
      // No isometric picture: its three-quarter one, standing.
      expect(one('crate')).toMatchObject({ facing: 'front', art: front });
      // Neither: it lies on the floor, seen from above, as before.
      expect(one('barrel')).toBeUndefined();
      expect(drawn.some((d) => d.layer === 'objects' && d.id === 'barrel')).toBe(true);
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );

  withBrowser(
    'in the grid view: a desk behind a wall near its end, a crate in front, and you either side',
    async () => {
      const page = await isoPage();
      await testSet(page);
      await page.evaluate(() =>
        window.Loom.materials.registerSet(
          {
            name: 'test-iso-order',
            objects: {
              desk: { stand: { file: 'bookshelf-stand.svg' } },
              crate: { stand: { file: 'chest-stand.svg' } },
            },
          },
          '/fixtures/paint/'
        )
      );
      const geometry = {
        ground: floor(40, 40),
        walls: [
          {
            id: 'wall',
            material: 'stone',
            points: [
              [0, 20],
              [20, 20],
            ],
          },
        ],
        objects: [
          // North of the wall, running past its end: its middle further down
          // the screen than the wall's last piece, behind it all the same.
          { id: 'desk', kind: 'desk', at: [21, 18.5], size: [6, 1] },
          { id: 'crate', kind: 'crate', at: [10, 22.5], size: [2.5, 2.5] },
        ],
      };
      const at = (point) =>
        battleOf(
          'order',
          { width: 8, height: 8, geometry },
          { cell: { x: Math.floor(point.x / 5), y: Math.floor(point.y / 5) }, point },
          { artSet: 'test-iso-order' }
        );
      const rank = (drawn) => {
        const standing = drawn.filter((d) => d.layer === 'standing');
        return (kind, id, part = 0) =>
          standing.findIndex((d) => d.kind === kind && d.id === id && (d.part || 0) === part);
      };
      // You north of the wall, behind it.
      let drawn = await shown(page, at({ x: 12.5, y: 17.5 }));
      let r = rank(drawn);
      const pieces = drawn.filter((d) => d.layer === 'standing' && d.kind === 'wall');
      expect(pieces.length).toBe(3);
      const last = pieces.reduce((a, b) => (b.depth > a.depth ? b : a)); // 13⅓–20 ft
      const desk = drawn.find((d) => d.layer === 'standing' && d.id === 'desk');
      expect(desk.depth).toBeGreaterThan(last.depth);
      expect(r('object', 'desk')).toBeLessThan(r('wall', 'wall', last.part || 0));
      // The crate (8.75–11.25 ft across) in front of the pieces it overlaps on the screen.
      pieces
        .filter((p) => p !== last)
        .forEach((p) =>
          expect(r('object', 'crate')).toBeGreaterThan(r('wall', 'wall', p.part || 0))
        );
      const middle = pieces.find((p) => Math.abs(p.depth - 15) < 0.01); // 6⅔–13⅓ ft
      expect(r('token', 'you')).toBeLessThan(r('wall', 'wall', middle.part || 0));
      // Stepped round to the south of it: in front.
      drawn = await shown(page, at({ x: 12.5, y: 22.5 }));
      r = rank(drawn);
      expect(r('token', 'you')).toBeGreaterThan(r('wall', 'wall', middle.part || 0));
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );

  withBrowser(
    'props and you touching a wall order by its line, not its drawn thickness (L-958)',
    async () => {
      const page = await isoPage();
      await page.evaluate(() =>
        window.Loom.materials.registerSet(
          {
            name: 'test-iso-touch',
            objects: {
              barrel: { stand: { file: 'pillar-stand.svg' } },
              crate: { stand: { file: 'chest-stand.svg' } },
            },
          },
          '/fixtures/paint/'
        )
      );
      // A wall along y = 20, drawn about a foot thick (19.25–20.75 ft): a barrel
      // against it from the north reaches 19.9 ft, into its drawn thickness, and
      // a crate against it from the south reaches back to 20.2 ft.
      const geometry = {
        ground: floor(40, 40),
        walls: [
          {
            id: 'wall',
            material: 'brick',
            points: [
              [0, 20],
              [40, 20],
            ],
          },
        ],
        objects: [
          { id: 'barrel', kind: 'barrel', at: [12.5, 18.65], size: [2.5, 2.5] },
          { id: 'crate', kind: 'crate', at: [27.5, 21.7], size: [3, 3] },
        ],
      };
      const at = (point) =>
        battleOf(
          'touch',
          { width: 8, height: 8, geometry },
          { cell: { x: Math.floor(point.x / 5), y: Math.floor(point.y / 5) }, point },
          { artSet: 'test-iso-touch' }
        );
      const order = (drawn) => drawn.filter((d) => d.layer === 'standing');
      // You against the wall's north side, inside its drawn thickness too.
      let standing = order(await shown(page, at({ x: 20, y: 19.5 })));
      const rank = (kind, id) => standing.findIndex((d) => d.kind === kind && d.id === id);
      const walls = standing.filter((d) => d.kind === 'wall');
      expect(walls.length).toBeGreaterThan(1);
      // Every wall piece is drawn after the barrel behind it and before the crate in front.
      const firstWall = standing.findIndex((d) => d.kind === 'wall');
      const lastWall =
        standing.length - 1 - [...standing].reverse().findIndex((d) => d.kind === 'wall');
      expect(rank('object', 'barrel')).toBeLessThan(firstWall);
      expect(rank('object', 'crate')).toBeGreaterThan(lastWall);
      expect(rank('token', 'you')).toBeLessThan(lastWall);
      // Against its south side: in front.
      standing = order(await shown(page, at({ x: 20, y: 20.5 })));
      expect(standing.findIndex((d) => d.kind === 'token' && d.id === 'you')).toBeGreaterThan(
        standing.findIndex((d) => d.kind === 'wall')
      );
      expect(page.errors).toEqual([]);
      await page.close();
    }
  );

  withBrowser('what stands out of sight is dimmed by the fog, what is in sight not', async () => {
    const page = await isoPage();
    const data = battleOf(
      'dungeon',
      { width: 24, height: 16, geometry: dungeon() },
      { cell: { x: 14, y: 4 }, point: { x: 72.5, y: 22.5 } },
      {},
      true
    );
    const drawn = await shown(page, data);
    const walls = drawn.filter((d) => d.layer === 'standing' && d.kind === 'wall');
    expect(walls.some((d) => d.dimmed)).toBe(true);
    expect(walls.some((d) => !d.dimmed)).toBe(true);
    // The brick room you stand in: its west wall in sight.
    expect(walls.filter((d) => d.id === 'west').every((d) => !d.dimmed)).toBe(true);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser('culled on the isometric screen as the camera zooms in, and back', async () => {
    const page = await isoPage();
    const data = battleOf(
      'dungeon',
      { width: 24, height: 16, geometry: dungeon() },
      { cell: { x: 14, y: 4 }, point: { x: 72.5, y: 22.5 } }
    );
    await shown(page, data);
    const culled = () =>
      page.evaluate(() =>
        window.Loom.mapPaint
          .describe('battle:dungeon')
          .filter((d) => d.layer === 'standing' && d.culled)
          .map((d) => d.kind)
      );
    expect(await culled()).toEqual([]);
    const framed = await page.evaluate(() => ({ ...window.Loom.engine.camera.view }));
    const zoom = (k) =>
      page.evaluate((z) => {
        const e = window.Loom.engine;
        const v = e.camera.view;
        const c = { x: 960, y: 640 }; // about the bottom right
        e.setView({ scale: v.scale * z, x: c.x - (c.x - v.x) * z, y: c.y - (c.y - v.y) * z });
        e.draw();
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, k);
    await zoom(5);
    const out = await culled();
    expect(out.length).toBeGreaterThan(10);
    expect(out).toContain('wall');
    // What's on the screen isn't culled: you, and the walls near the bottom right corner.
    const shownNow = await page.evaluate(() =>
      window.Loom.mapPaint
        .describe('battle:dungeon')
        .filter((d) => d.layer === 'standing' && !d.culled)
    );
    expect(shownNow.length).toBeGreaterThan(0);
    // Back to the whole map, as framed.
    await page.evaluate((v) => {
      window.Loom.engine.setView(v);
      window.Loom.engine.draw();
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, framed);
    expect(await culled()).toEqual([]);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  withBrowser(
    'the large fixture draws in no more than 1.2× the three-quarter time on a CPU four times slower',
    async () => {
      const map = geo.normalize(large());
      const views = {
        three: {
          options: { tile: 5, wall: 1.5, fades: true, set: 'classic' },
          place: { x: 0, y: 0, scale: 2 },
        },
        iso: {
          options: { tile: 5, wall: 1.5, fades: true, set: 'classic', iso: { rise: 1.22 } },
          place: { x: 480, y: 40, scale: 1 },
        },
      };
      // Each time on a page of its own: the textures and the set first
      // (loading isn't the drawing), then the drawing, slowed.
      const timeOne = async (v) => {
        const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
        await page.goto(origin + '/fixtures/paint/index.html');
        await page.evaluate(() => window.__ready);
        await page.evaluate(
          ([g, o, p]) => window.__draw('warm', g, o, p),
          [map, v.options, v.place]
        );
        await page.evaluate(() => Loom.mapPaint.forget('warm'));
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        const stats = await page.evaluate(
          ([g, o, p]) => window.__draw('large', g, o, p),
          [map, v.options, v.place]
        );
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await page.close();
        return stats.drawMs;
      };
      const times = { three: [], iso: [] };
      // Turn about, five times each (the times here vary run to run): the middle of each.
      for (let run = 0; run < 5; run++) {
        for (const [name, v] of Object.entries(views)) times[name].push(await timeOne(v));
      }
      const middle = (list) => list.slice().sort((a, b) => a - b)[2];
      console.log(
        `The large fixture, 4× slower CPU: three-quarter ${times.three.map(Math.round)} ms, ` +
          `isometric ${times.iso.map(Math.round)} ms`
      );
      expect(middle(times.iso)).toBeLessThanOrEqual(middle(times.three) * 1.2);
    }
  );
});
