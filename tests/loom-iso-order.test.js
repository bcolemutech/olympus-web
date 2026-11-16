'use strict';

/**
 * The isometric view's depth order, pure (public/apps/loom/js/iso.js;
 * planning/isometric-view.md §4.2, IS3; spike report §4.1, §4.2; L-952 /
 * #858): what stands is drawn back to front by its footprint on the floor,
 * not by one depth number, so each of these is drawn on the right side of
 * the wall beside it:
 *
 *   - a desk behind a wall near its end (the spike's desk, which one depth
 *     number put in front);
 *   - a crate in front of a wall;
 *   - a long bed beside a long wall, on either side;
 *   - a token walking past a wall's end, placed among the ordered pieces at
 *     every step;
 *   - on whole maps (the large fixture and 40 generated rooms, interiors,
 *     caves, decks and wilds), every two pieces overlapping on the screen;
 *
 * and props pick their picture by facing (front, back, mirrored, and long
 * ones mirrored to lie the other way).
 *
 * Run: cd tests && npx jest loom-iso-order --verbose
 */

const iso = require('../public/apps/loom/js/iso.js');

const RISE = 1.22; // a foot of height, up the screen (C2)
const THICK = 1.25;

// What a piece covers on the screen: its footprint from the floor to `top` ft.
function boxOf(pts, top) {
  const ps = [];
  pts.forEach((p) => {
    ps.push(iso.P(p, 0), iso.P(p, top * RISE));
  });
  return {
    x0: Math.min(...ps.map((p) => p.x)),
    x1: Math.max(...ps.map((p) => p.x)),
    y0: Math.min(...ps.map((p) => p.y)),
    y1: Math.max(...ps.map((p) => p.y)),
  };
}

const item = (name, pts, top) => ({ name, pts, box: boxOf(pts, top), depth: iso.depthOf(pts) });

// A wall from a to b, 8 ft tall, cut into pieces of at most a tile and a half, as the painter cuts it.
const PIECE = 7.5;
function wall(name, a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.ceil(len / PIECE);
  const out = [];
  for (let k = 0; k < n; k++) {
    const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
    const q = { x: a.x + ((b.x - a.x) * (k + 1)) / n, y: a.y + ((b.y - a.y) * (k + 1)) / n };
    out.push(item(`${name}-${k}`, iso.segment(p, q, THICK), 8));
  }
  return out;
}

const prop = (name, at, size, turn = 0, tall = 3) =>
  item(name, iso.rect(at, size[0], size[1], turn), tall);

// The rank of each item in the order, by name.
function ranks(items) {
  const order = iso.order(items);
  const out = {};
  order.forEach((i, r) => {
    out[items[i].name] = r;
  });
  return out;
}

const crosses = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Every wall piece `thing` overlaps on the screen is drawn after it (it's behind) or before it.
function expectSide(items, rank, thing, wallName, side) {
  const t = items.find((i) => i.name === thing);
  const pieces = items.filter((i) => i.name.startsWith(wallName + '-') && crosses(i.box, t.box));
  expect(pieces.length).toBeGreaterThan(0);
  pieces.forEach((p) => {
    if (side === 'behind') expect(rank[thing]).toBeLessThan(rank[p.name]);
    else expect(rank[thing]).toBeGreaterThan(rank[p.name]);
  });
}

describe('the depth order (L-952)', () => {
  test('a desk behind a wall near its end is drawn behind it', () => {
    // An east-west wall along y = 20 from x 0 to 20; the desk just north of it,
    // running out past the wall's end. Its middle is further down the screen
    // than the wall piece beside it, so one depth number put it in front.
    const items = [
      ...wall('wall', { x: 0, y: 20 }, { x: 20, y: 20 }),
      prop('desk', { x: 21, y: 18.5 }, [6, 1]),
    ];
    const desk = items.find((i) => i.name === 'desk');
    const beside = items.find((i) => i.name === 'wall-2'); // 13⅓–20 ft
    expect(crosses(desk.box, beside.box)).toBe(true);
    expect(desk.depth).toBeGreaterThan(beside.depth); // what misled one number
    expect(iso.front(desk, beside)).toBe(-1);
    expectSide(items, ranks(items), 'desk', 'wall', 'behind');
  });

  test('a crate in front of a wall is drawn over it', () => {
    const items = [
      ...wall('wall', { x: 0, y: 20 }, { x: 20, y: 20 }),
      prop('crate', { x: 10, y: 22 }, [2.5, 2.5]),
    ];
    expectSide(items, ranks(items), 'crate', 'wall', 'front');
  });

  test('a long bed beside a long wall: behind it on its far side, in front on its near side', () => {
    // A north-south wall along x = 20; a bed long north-south on each side.
    const items = [
      ...wall('wall', { x: 20, y: 0 }, { x: 20, y: 30 }),
      prop('far-bed', { x: 17.75, y: 15 }, [3, 7], 0, 2.5),
      prop('near-bed', { x: 22.25, y: 15 }, [3, 7], 0, 2.5),
    ];
    const rank = ranks(items);
    expectSide(items, rank, 'far-bed', 'wall', 'behind');
    expectSide(items, rank, 'near-bed', 'wall', 'front');
  });

  test('a token walking past a wall’s end is placed on the right side at every step', () => {
    const statics = [
      ...wall('wall', { x: 0, y: 20 }, { x: 20, y: 20 }),
      prop('crate', { x: 8, y: 22.5 }, [2.5, 2.5]),
      prop('desk', { x: 21, y: 18.5 }, [6, 1]),
    ];
    const order = iso.order(statics);
    const zs = [];
    order.forEach((i, r) => {
      zs[i] = r;
    });
    const idx = iso.index(statics);
    // North of the wall east along it, round its end, and back west south of it.
    const path = [];
    for (let x = 10; x <= 25; x += 0.5) path.push({ x, y: 17 });
    for (let y = 17; y <= 23; y += 0.5) path.push({ x: 25, y });
    for (let x = 25; x >= 10; x -= 0.5) path.push({ x, y: 23 });
    const r = 1;
    path.forEach((at) => {
      const token = item('token', iso.square(at, r), 5);
      const { lo, hi } = iso.slot(token, idx, zs);
      expect(lo).toBeLessThan(hi);
      statics.forEach((s, j) => {
        if (!s.name.startsWith('wall-') || !crosses(s.box, token.box)) return;
        // North of the wall: behind every piece it overlaps; south: in front.
        if (at.y + r < 20 - THICK / 2) expect(zs[j]).toBeGreaterThanOrEqual(hi);
        if (at.y - r > 20 + THICK / 2) expect(zs[j]).toBeLessThanOrEqual(lo);
      });
    });
  });

  test('front() reads a separating line, and says nothing when footprints overlap', () => {
    const a = item('a', iso.square({ x: 5, y: 5 }, 1), 1);
    const east = item('east', iso.square({ x: 10, y: 5 }, 1), 1);
    const south = item('south', iso.square({ x: 5, y: 10 }, 1), 1);
    const over = item('over', iso.square({ x: 5.5, y: 5.5 }, 1), 1);
    expect(iso.front(east, a)).toBe(1);
    expect(iso.front(a, east)).toBe(-1);
    expect(iso.front(south, a)).toBe(1);
    expect(iso.front(over, a)).toBe(0);
    // Two walls running north-east (seen edge-on), the second a little nearer
    // the camera: it is in front, by the line between them.
    const edgeOn = item('edge', iso.segment({ x: 0, y: 10 }, { x: 10, y: 0 }, 1), 8);
    const beside = item('beside', iso.segment({ x: 2, y: 10 }, { x: 12, y: 0 }, 1), 1);
    expect(iso.front(edgeOn, beside)).toBe(-1);
  });

  test('a ring of pieces is still drawn, each once', () => {
    // Three long pieces each over the next (a pinwheel): no order fits all.
    const items = [
      item('a', iso.segment({ x: 0, y: 0 }, { x: 10, y: 0 }, 1), 8),
      item('b', iso.segment({ x: 11, y: 0 }, { x: 11, y: 10 }, 1), 8),
      item('c', iso.segment({ x: 10, y: 11 }, { x: 0, y: 11 }, 1), 8),
      item('d', iso.segment({ x: -1, y: 10 }, { x: -1, y: 0 }, 1), 8),
    ];
    const order = iso.order(items);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('the depth order on whole maps', () => {
  const geo = require('../functions/loom-canon/map-geometry');
  const generators = require('../functions/loom-canon/map-generators');
  const materials = require('../functions/loom-canon/materials');
  const { large } = require('./fixtures/paint/large');

  // A map's walls (less their doorways, cut as the painter cuts them) and its
  // objects, as the painter orders them.
  function itemsOf(g) {
    const out = [];
    geo.compile(g).edges.forEach((e, i) => {
      wall(`w${i}`, { x: e.a[0], y: e.a[1] }, { x: e.b[0], y: e.b[1] }).forEach((w) => out.push(w));
    });
    (g.objects || []).forEach((o) => {
      const at = Array.isArray(o.at) ? { x: o.at[0], y: o.at[1] } : o.at;
      const size = Array.isArray(o.size) ? o.size : materials.sizeFor(o.kind) || [5, 5];
      out.push(prop(o.id, at, size, o.turn, 4));
    });
    return out;
  }

  test('every two pieces that overlap on the screen are drawn in the order their footprints say', () => {
    const maps = { large: geo.normalize(large()) };
    ['rooms', 'interior', 'caves', 'deck', 'wilds'].forEach((kind) => {
      for (let s = 0; s < 8; s++) {
        maps[`${kind}-${s}`] = geo.normalize(generators.generate(kind, { seed: `s${s}` }).geometry);
      }
    });
    let pairs = 0;
    Object.entries(maps).forEach(([name, g]) => {
      const items = itemsOf(g);
      const rank = [];
      iso.order(items).forEach((i, r) => {
        rank[i] = r;
      });
      const wrong = [];
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          if (!crosses(items[i].box, items[j].box)) continue;
          const f = iso.front(items[i], items[j]);
          if (!f) continue;
          pairs += 1;
          if (f > 0 !== rank[i] > rank[j]) wrong.push(`${items[i].name} / ${items[j].name}`);
        }
      }
      expect({ name, wrong }).toEqual({ name, wrong: [] });
    });
    expect(pairs).toBeGreaterThan(8000);
  });
});

describe('props by facing (IS3)', () => {
  test('front south, back mirrored west, back north, front mirrored east', () => {
    expect(iso.facing(0, [2, 2])).toEqual({ back: false, mirror: false });
    expect(iso.facing(90, [2, 2])).toEqual({ back: true, mirror: true });
    expect(iso.facing(180, [2, 2])).toEqual({ back: true, mirror: false });
    expect(iso.facing(270, [2, 2])).toEqual({ back: false, mirror: true });
    expect(iso.facing(-90, [2, 2])).toEqual({ back: false, mirror: true });
    expect(iso.facing(85, [2, 2])).toEqual({ back: true, mirror: true });
  });

  test('a picture painted long one way, mirrored to stand long the other', () => {
    // Painted long along y (a table along the lower-left diagonal): a table
    // long along its own x is mirrored, at any facing.
    expect(iso.facing(0, [10, 5], 'y').mirror).toBe(true);
    expect(iso.facing(0, [5, 10], 'y').mirror).toBe(false);
    expect(iso.facing(90, [10, 5], 'y').mirror).toBe(false);
    expect(iso.facing(0, [10, 5], 'x').mirror).toBe(false);
    // Square, nothing to mirror for.
    expect(iso.facing(0, [5, 5], 'y').mirror).toBe(false);
  });
});
