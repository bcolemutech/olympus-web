'use strict';

/**
 * Where the town view draws a town's places (public/apps/loom/js/town-layout.js;
 * planning/the-loom-layered-worlds.md §8; L-345 / #399): places keep the
 * position they were given, and the rest are placed automatically. Pure; no
 * emulator.
 *
 * Run: cd tests && npx jest loom-town-layout --verbose
 */

const { SPAN, layout } = require('../public/apps/loom/js/town-layout');

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const chain = (ids) => ids.slice(1).map((id, i) => ({ from: ids[i], to: id }));

// A Hatham-like town: a trailhead and a harbour, a market between them, and
// five more places off the market and the quay, none of them positioned.
const HATHAM = {
  places: [
    { id: 'trailhead', entranceFor: ['trail'] },
    { id: 'harbour', entranceFor: ['sea'] },
    { id: 'market' },
    { id: 'tower' },
    { id: 'tavern' },
    { id: 'chandlery' },
    { id: 'sheds' },
    { id: 'stairs' },
  ],
  links: [
    { from: 'trailhead', to: 'stairs' },
    { from: 'stairs', to: 'market' },
    { from: 'market', to: 'harbour' },
    { from: 'harbour', to: 'tower' },
    { from: 'harbour', to: 'tavern' },
    { from: 'market', to: 'chandlery' },
    { from: 'harbour', to: 'sheds' },
  ],
};

test('every place gets a position inside the town', () => {
  const positions = layout(HATHAM.places, HATHAM.links);
  expect(Object.keys(positions).sort()).toEqual(HATHAM.places.map((p) => p.id).sort());
  for (const p of Object.values(positions)) {
    expect(p.auto).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(SPAN);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(SPAN);
  }
});

test('the placement uses the town’s space, and keeps places apart', () => {
  const positions = Object.values(layout(HATHAM.places, HATHAM.links));
  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  expect(spread).toBeGreaterThan(SPAN * 0.7);
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      expect(dist(positions[i], positions[j])).toBeGreaterThan(80);
    }
  }
});

test('a small town is spread across the town too, not huddled in the middle', () => {
  const positions = Object.values(
    layout(
      [{ id: 'quay', entranceFor: ['sea'] }, { id: 'inn' }, { id: 'well' }],
      chain(['quay', 'inn', 'well'])
    )
  );
  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  expect(spread).toBeGreaterThan(SPAN * 0.7);
});

test('linked places sit nearer each other than the far ends of a street', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const positions = layout(
    ids.map((id) => ({ id })),
    chain(ids)
  );
  const step = dist(positions.a, positions.b);
  expect(dist(positions.a, positions.f)).toBeGreaterThan(step * 2.5);
});

test('given positions are kept exactly; the rest fit around them', () => {
  const places = [
    { id: 'gate', entranceFor: ['road'], position: { x: 120, y: 500 } },
    { id: 'square', position: { x: 500, y: 500 } },
    { id: 'inn' },
    { id: 'shrine' },
  ];
  const links = [
    { from: 'gate', to: 'square' },
    { from: 'square', to: 'inn' },
    { from: 'square', to: 'shrine' },
  ];
  const positions = layout(places, links);
  expect(positions.gate).toEqual({ x: 120, y: 500, auto: false });
  expect(positions.square).toEqual({ x: 500, y: 500, auto: false });
  for (const id of ['inn', 'shrine']) {
    expect(positions[id].auto).toBe(true);
    expect(dist(positions[id], positions.square)).toBeGreaterThan(80);
  }
  expect(dist(positions.inn, positions.shrine)).toBeGreaterThan(80);
});

test('the same town always draws the same way', () => {
  expect(layout(HATHAM.places, HATHAM.links)).toEqual(layout(HATHAM.places, HATHAM.links));
});

test('small and odd towns: none, one place, unlinked places, bad links', () => {
  expect(layout([], [])).toEqual({});
  expect(layout([{ id: 'only', entranceFor: ['sea'] }], [])).toEqual({
    only: { x: SPAN / 2, y: SPAN / 2, auto: true },
  });
  const loose = layout(
    [{ id: 'x' }, { id: 'y' }, { id: 'z' }],
    [
      { from: 'x', to: 'nowhere' },
      { from: 'y', to: 'y' },
    ]
  );
  expect(dist(loose.x, loose.y)).toBeGreaterThan(80);
  expect(dist(loose.y, loose.z)).toBeGreaterThan(80);
});
