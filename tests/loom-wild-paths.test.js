'use strict';

/**
 * Terrain speed and danger, and the planner (planning/off-road-travel.md
 * §4.1, §4.2, TR2–TR4, TR8, EV6; L-361 / #835), pure: every ground material
 * has its `wild` defaults; a world's own material moves at its `like`'s
 * speed and a world's override changes it; the planner crosses forest at
 * half grassland's speed, goes round a lake (and finds no way across one
 * with no way round), takes a road when it's quicker (but not one whose
 * rule the traveller fails), crosses a river at a ford route, and joins a
 * sea route only at its ends; a 200-cell plan across Nisia's places and
 * routes, over ground at the most a map may hold, takes under 200 ms; and
 * the page's copy matches the server's.
 *
 * Run: cd tests && npx jest loom-wild-paths --verbose
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const catalog = require('../functions/loom-canon/materials');
const wildPaths = require('../functions/loom-canon/wild-paths');
const wildPlan = require('../functions/loom-canon/wild-plan');
const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');

const BOUNDS = { width: 100, height: 100 };
const rect = (x, y, w, h) => ({ rect: { x, y, w, h } });
const ground = (material, shape, extra = {}) => ({
  id: `${material}-${Math.round(Math.random() * 1e9)}`,
  material,
  shape,
  ...extra,
});
const all = (material) => ({ ground: [ground(material, rect(0, 0, 100, 100))] });
const plan = (geometry, extra = {}) =>
  wildPaths.plan({
    geometry,
    bounds: BOUNDS,
    cells: 100,
    pace: 1,
    from: [5, 50],
    to: [95, 50],
    ...extra,
  });
// Whether a path passes through a box, sampled along each step.
function crosses(p, box) {
  for (let i = 1; i < p.path.length; i++) {
    const [a, b] = [p.path[i - 1], p.path[i]];
    for (let t = 0; t <= 1; t += 0.01) {
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return true;
    }
  }
  return false;
}

describe('terrain speed and danger', () => {
  test('every ground material has its wild defaults; danger is 1 unless set', () => {
    const groundList = catalog.materialsOf('ground');
    for (const m of groundList) {
      expect(m.wild).toEqual(expect.objectContaining({ danger: 1 }));
      expect(m.wild.speed >= 0 && m.wild.speed <= 1).toBe(true);
    }
    const speed = (id) => catalog.wildOf(id).speed;
    expect(speed('grassland')).toBe(1);
    expect(speed('farmland')).toBe(0.9);
    expect(speed('savanna')).toBe(0.9);
    expect([speed('desert'), speed('hills'), speed('tundra')]).toEqual([0.6, 0.6, 0.6]);
    expect([speed('forest'), speed('taiga')]).toEqual([0.5, 0.5]);
    expect([speed('jungle'), speed('swamp'), speed('marsh')]).toEqual([0.4, 0.4, 0.4]);
    expect(speed('mountains')).toBe(0.3);
    expect(speed('glacier')).toBe(0.2);
    for (const id of ['ocean', 'lake', 'deep-water']) {
      expect(catalog.wildOf(id)).toEqual({ speed: 0, danger: 1, impassable: true });
    }
    // None or an unknown one crosses as open ground.
    expect(catalog.wildOf(null)).toEqual({ speed: 1, danger: 1 });
  });

  test('a world’s own material takes its like’s values, and the world’s overrides', () => {
    const own = [{ id: 'deadwood', name: 'Deadwood', like: 'forest' }];
    expect(catalog.wildOf('deadwood', own)).toEqual({ speed: 0.5, danger: 1 });
    // A change to its like reaches it, and one of its own wins over that.
    expect(catalog.wildOf('deadwood', own, { materials: { forest: { danger: 1.5 } } })).toEqual({
      speed: 0.5,
      danger: 1.5,
    });
    expect(
      catalog.wildOf('deadwood', own, {
        materials: { forest: { danger: 1.5 }, deadwood: { speed: 0.25, danger: 2 } },
      })
    ).toEqual({ speed: 0.25, danger: 2 });
    // Marked impassable, or opened.
    expect(
      catalog.wildOf('mountains', [], { materials: { mountains: { impassable: true } } })
    ).toEqual({ speed: 0, danger: 1, impassable: true });
    expect(catalog.wildOf('lake', [], { materials: { lake: { impassable: false } } })).toEqual({
      speed: 1,
      danger: 1,
    });
  });

  test('checkWilds refuses an unknown material, a speed or danger out of range, an unknown key', () => {
    const own = [{ id: 'deadwood', name: 'Deadwood', like: 'forest' }];
    expect(catalog.checkWilds({ forest: { speed: 0.4 }, deadwood: { danger: 2 } }, own)).toEqual(
      []
    );
    expect(catalog.checkWilds({ plasma: { speed: 1 } }, own).join(' ')).toMatch(
      /"plasma" is no ground material/
    );
    expect(catalog.checkWilds({ forest: { speed: 3 } }).join(' ')).toMatch(/speed is above 0/);
    expect(catalog.checkWilds({ forest: { speed: 0 } }).join(' ')).toMatch(/speed is above 0/);
    expect(catalog.checkWilds({ forest: { danger: 0.2 } }).join(' ')).toMatch(/danger is from/);
    expect(catalog.checkWilds({ forest: { impassable: 'yes' } }).join(' ')).toMatch(
      /impassable is true or false/
    );
    expect(catalog.checkWilds({ forest: { cost: 2 } }).join(' ')).toMatch(/only speed, danger/);
  });
});

describe('the planner', () => {
  test('forest is crossed at half the speed of grassland', () => {
    const open = plan(all('grassland'));
    const woods = plan(all('forest'));
    expect(woods.hours).toBeCloseTo(open.hours * 2, 9);
    expect(open.distance).toBeCloseTo(woods.distance, 9);
    expect(open.terrain).toEqual([{ material: 'grassland', distance: expect.any(Number) }]);
    expect(woods.terrain[0].material).toBe('forest');
    expect(open.legs).toEqual([expect.objectContaining({ by: 'wild' })]);
    // The scale and pace: 2 miles a map unit at 1.5 mph.
    const scaled = plan(all('grassland'), { scale: 2, pace: 1.5 });
    expect(scaled.distance).toBeCloseTo(open.length * 2, 9);
    expect(scaled.hours).toBeCloseTo((open.length * 2) / 1.5, 9);
  });

  test('a ground item’s own cost slows it, and cost "never" closes it', () => {
    const open = plan(all('grassland'));
    const heavy = plan({ ground: [ground('grassland', rect(0, 0, 100, 100), { cost: 2 })] });
    expect(heavy.hours).toBeCloseTo(open.hours * 2, 9);
    const wall = {
      ground: [
        ground('grassland', rect(0, 0, 100, 100)),
        ground('grassland', rect(45, 0, 10, 100), { cost: 'never' }),
      ],
    };
    expect(plan(wall)).toBeNull();
  });

  test('a lake forces a detour, and a lake with no way round gives no path', () => {
    const open = plan(all('grassland'));
    const box = { x: 40, y: 20, w: 20, h: 60 };
    const lake = {
      ground: [ground('grassland', rect(0, 0, 100, 100)), ground('lake', rect(40, 20, 20, 60))],
    };
    const round = plan(lake);
    expect(round.hours).toBeGreaterThan(open.hours * 1.2);
    expect(crosses(round, { x: 41, y: 21, w: 18, h: 58 })).toBe(false);
    expect(crosses(open, box)).toBe(true);
    const band = {
      ground: [ground('grassland', rect(0, 0, 100, 100)), ground('lake', rect(40, 0, 20, 100))],
    };
    expect(plan(band)).toBeNull();
    // Off the land altogether: the goal in the middle of the lake.
    expect(plan(lake, { to: [50, 50] })).toBeNull();
  });

  test('a road cuts the time, joined and left along its line', () => {
    const open = plan(all('forest'));
    const road = {
      id: 'r',
      points: [
        [20, 60],
        [80, 60],
      ],
      speed: 3,
    };
    const quick = plan(all('forest'), { routes: [road] });
    expect(quick.hours).toBeLessThan(open.hours);
    expect(quick.legs.map((l) => l.by)).toEqual(['wild', 'route', 'wild']);
    expect(quick.legs[1]).toMatchObject({ route: 'r' });
    // A road that goes the wrong way isn't worth taking.
    const away = {
      id: 'away',
      points: [
        [5, 50],
        [5, 0],
        [95, 0],
        [95, 50],
      ],
      speed: 1.2,
    };
    expect(plan(all('grassland'), { routes: [away] }).legs.map((l) => l.by)).toEqual(['wild']);
  });

  test('a road whose rule the traveller fails isn’t used (lanesOf)', () => {
    const view = {
      map: {
        width: 100,
        height: 100,
        distance: { unit: 'mi', perMapUnit: 1 },
        geometry: all('forest'),
      },
      materials: [],
      wilds: {},
      regions: {},
      locations: {
        a: {
          id: 'a',
          geo: {
            x: 5,
            y: 50,
            links: { b: 'road' },
            routes: { b: { rules: { requiresAbility: 'swimmer' } } },
          },
        },
        b: { id: 'b', geo: { x: 95, y: 50, links: { a: 'road' } } },
      },
    };
    const traveller = (abilities) => ({ character: { name: 'Tam', abilities } });
    expect(wildPlan.lanesOf(view, traveller([]))).toEqual([]);
    const lanes = wildPlan.lanesOf(view, traveller(['swimmer']));
    // A straight road winds as its trip does: 3 mph over 1.25 the line.
    expect(lanes).toEqual([
      expect.objectContaining({ from: 'a', to: 'b', kind: 'road', speed: 3 / 1.25 }),
    ]);
    const without = wildPlan.planOn(view, 'a', 'b', { state: traveller([]), cells: 100 });
    const withIt = wildPlan.planOn(view, 'a', 'b', { state: traveller(['swimmer']), cells: 100 });
    expect(without.legs.map((l) => l.by)).toEqual(['wild']);
    expect(withIt.legs.map((l) => l.by)).toEqual(['route']);
    expect(withIt.hours).toBeCloseTo((90 * 1.25) / 3, 9);
    expect(withIt.hours).toBeLessThan(without.hours);
  });

  test('a world’s own material moves at its like’s speed, and a world override changes it', () => {
    const own = [{ id: 'deadwood', name: 'Deadwood', like: 'forest' }];
    const woods = plan(all('forest'));
    const dead = plan(all('deadwood'), { own });
    expect(dead.hours).toBeCloseTo(woods.hours, 9);
    expect(dead.terrain[0].material).toBe('deadwood');
    const faster = plan(all('deadwood'), { own, wilds: { materials: { deadwood: { speed: 1 } } } });
    expect(faster.hours).toBeCloseTo(woods.hours / 2, 9);
    const forestFaster = plan(all('forest'), { wilds: { materials: { forest: { speed: 1 } } } });
    expect(forestFaster.hours).toBeCloseTo(woods.hours / 2, 9);
  });

  test('a river is crossed at a ford route, and slowly elsewhere', () => {
    const river = {
      id: 'river',
      material: 'river',
      points: [
        [50, 0],
        [50, 100],
      ],
    };
    const geometry = { ground: [ground('grassland', rect(0, 0, 100, 100))], lines: [river] };
    const open = plan(all('grassland'));
    const wading = plan(geometry);
    expect(wading.hours).toBeGreaterThan(open.hours);
    const ford = {
      id: 'ford',
      points: [
        [46, 53],
        [54, 53],
      ],
      speed: 1,
    };
    const forded = plan(geometry, { routes: [ford] });
    expect(forded.hours).toBeLessThan(wading.hours);
    expect(crosses(forded, { x: 49, y: 52, w: 2, h: 2 })).toBe(true);
  });

  test('a sea route is joined and left only at its ends', () => {
    const coast = {
      ground: [ground('grassland', rect(0, 0, 100, 100)), ground('ocean', rect(0, 0, 100, 40))],
    };
    const sea = {
      id: 'sea',
      points: [
        [10, 42],
        [10, 10],
        [90, 10],
        [90, 42],
      ],
      speed: 5,
      ends: true,
    };
    const sailed = plan(coast, { routes: [sea], from: [10, 45], to: [90, 45] });
    expect(sailed.legs.map((l) => l.by)).toEqual(['wild', 'route', 'wild']);
    // From mid-coast the ship is no use: it can't be boarded at sea.
    const walked = plan(coast, { routes: [sea], from: [50, 45], to: [90, 45] });
    expect(walked.legs.map((l) => l.by)).toEqual(['wild']);
  });

  test('the danger along the way: material danger × region danger, by distance', () => {
    const geometry = {
      ground: [ground('grassland', rect(0, 0, 100, 100))],
      zones: [{ id: 'z', region: 'reg_dark', shape: rect(50, 0, 50, 100) }],
    };
    const calm = plan(geometry);
    expect(calm.danger).toBeCloseTo(1, 9);
    const half = plan(geometry, { regions: { reg_dark: 2 } });
    expect(half.danger).toBeGreaterThan(1.4);
    expect(half.danger).toBeLessThan(1.6);
    const worse = plan(geometry, {
      regions: { reg_dark: 2 },
      wilds: { materials: { grassland: { danger: 2 } } },
    });
    expect(worse.danger).toBeCloseTo(half.danger * 2, 9);
  });

  test('without ground or a point it plans nothing', () => {
    expect(wildPaths.plan({ bounds: BOUNDS, from: [1, 1], to: [2, 2] })).toBeNull();
    expect(wildPaths.plan({ geometry: all('grassland'), bounds: BOUNDS, from: [1, 1] })).toBeNull();
    expect(wildPlan.planOn({ map: { width: 10, height: 10 } }, [1, 1], [2, 2])).toBeNull();
  });
});

describe('Nisia', () => {
  // Nisia's places and routes, from its Azgaar export, over ground at the
  // most a map may hold (500 items, 20,000 points): an ocean, the land, and
  // 498 patches of terrain, with 146 rivers. Harder than Nisia's own ground.
  const { canon } = mapToCanon(
    parseAzgaarExport(fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json')))
  );
  const { width, height } = canon.map;
  const KINDS = ['forest', 'hills', 'marsh', 'farmland', 'mountains', 'lake', 'desert', 'taiga'];
  // A seeded wobble, so the ground is the same every run.
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  function blob(cx, cy, r, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.7 + 0.3 * rand());
      pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`);
    }
    return `M${pts.join(' L')} Z`;
  }
  function geometry() {
    seed = 7;
    const items = [
      { id: 'sea', material: 'ocean', shape: rect(0, 0, width, height) },
      { id: 'land', material: 'grassland', shape: blob(width / 2, height / 2, 700, 40) },
    ];
    for (let i = 0; i < 498; i++) {
      items.push({
        id: `t${i}`,
        material: KINDS[i % KINDS.length],
        shape: blob(
          200 + rand() * (width - 400),
          150 + rand() * (height - 300),
          10 + rand() * 30,
          40
        ),
      });
    }
    const lines = [];
    for (let i = 0; i < 146; i++) {
      let x = 300 + rand() * (width - 600);
      let y = 250 + rand() * (height - 500);
      const pts = [[x, y]];
      for (let k = 0; k < 9; k++) {
        x += (rand() - 0.5) * 40;
        y += (rand() - 0.5) * 40;
        pts.push([x, y]);
      }
      lines.push({ id: `river-${i}`, material: 'river', points: pts });
    }
    return { ground: items, lines };
  }

  test('a 200-cell plan of its top map finishes in under 200 ms', () => {
    const view = { ...canon, map: { ...canon.map } };
    const lanes = wildPlan.lanesOf(view, {});
    expect(lanes.length).toBeGreaterThan(800);
    // Two settlements far apart on the land.
    const inland = Object.values(canon.locations).filter((l) => {
      const dx = l.geo.x - width / 2;
      const dy = l.geo.y - height / 2;
      return Math.hypot(dx, dy) < 450;
    });
    const west = inland.reduce((a, b) => (b.geo.x < a.geo.x ? b : a));
    const east = inland.reduce((a, b) => (b.geo.x > a.geo.x ? b : a));
    const times = [];
    let result;
    for (let run = 0; run < 3; run++) {
      // A fresh geometry each run, so the grid is laid each time, as on a
      // turn with a cold cache.
      view.map = { ...canon.map, geometry: geometry() };
      const t0 = process.hrtime.bigint();
      result = wildPlan.planOn(view, west.id, east.id, { cells: 200 });
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    times.sort((a, b) => a - b);
    console.log(`Nisia plans: ${times.map((t) => t.toFixed(0)).join(', ')} ms`);
    expect(result).not.toBeNull();
    expect(result.distance).toBeGreaterThan(Math.abs(east.geo.x - west.geo.x) * 2 * 0.9);
    expect(times[1]).toBeLessThan(200);
  });
});

describe("the browser's copy", () => {
  const served = path.join(__dirname, '../public/apps/loom/js/wild-paths.js');

  test('is identical to the server’s, and loads as Loom.wildPaths after its helpers', () => {
    const source = fs.readFileSync(served, 'utf8');
    expect(source).toBe(
      fs.readFileSync(path.join(__dirname, '../functions/loom-canon/wild-paths.js'), 'utf8')
    );
    const page = { window: { Loom: {} } };
    page.Math = Math;
    vm.createContext(page);
    for (const file of ['materials.js', 'map-geometry.js', 'wild-paths.js']) {
      vm.runInContext(
        fs.readFileSync(path.join(__dirname, '../public/apps/loom/js', file), 'utf8'),
        page
      );
    }
    const inPage = page.window.Loom.wildPaths.plan({
      geometry: all('forest'),
      bounds: BOUNDS,
      cells: 100,
      pace: 1,
      from: [5, 50],
      to: [95, 50],
    });
    expect(inPage.hours).toBeCloseTo(plan(all('forest')).hours, 9);
  });

  test('the Loom page loads it after map-geometry.js', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/apps/loom/index.html'), 'utf8');
    const at = (file) => html.indexOf(`/apps/loom/js/${file}`);
    expect(at('wild-paths.js')).toBeGreaterThan(at('map-geometry.js'));
    expect(at('map-geometry.js')).toBeGreaterThan(at('materials.js'));
  });
});
