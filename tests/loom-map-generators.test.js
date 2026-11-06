'use strict';

/**
 * The seeded map generators (planning/maps-from-data.md §4.8, AU2; L-929 /
 * #733): rooms and corridors, caves, building interiors and ship decks
 * (sailing and starship).
 *
 *   - the same kind, seed, size and style give the same map, and another seed
 *     another map;
 *   - every seed in a test set, at the default size, the smallest and the
 *     largest, gives a playable map: its geometry sound as stored, its exit
 *     reached from its entry, and every room, both sides of every door and
 *     every square of floor reached, checked here with the planner play uses
 *     (map-paths.js) and not only by the generators' own `problems`;
 *   - what comes out is ordinary data: built-in materials, catalog objects,
 *     rooms as zones with no name, no hidden things or spawns;
 *   - `problems` itself finds a map that isn't playable.
 *
 * Pure.
 */

const gen = require('../functions/loom-canon/map-generators');
const geo = require('../functions/loom-canon/map-geometry');
const mapPaths = require('../functions/loom-canon/map-paths');
const materials = require('../functions/loom-canon/materials');

const KINDS = [
  ['rooms', undefined],
  ['caves', undefined],
  ['interior', undefined],
  ['deck', 'sailing'],
  ['deck', 'starship'],
];
const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);
const label = (kind, style) => (style ? `${kind} (${style})` : kind);
const NAMED = KINDS.map(([kind, style]) => [label(kind, style), kind, style]);
const CATALOG = new Set(materials.OBJECT_KINDS.map((k) => k.id));
const key = (p) => `${p.x},${p.y}`;

/** Every way the map isn't playable, checked here against the planner. */
function unplayable(made) {
  const out = [];
  const stored = geo.normalize(made.geometry);
  const bounds = { width: made.width * 5, height: made.height * 5 };
  out.push(...geo.check(stored, bounds));
  const map = { ...made, geometry: stored };
  const reached = mapPaths.squaresReached(map, map.entries);
  for (const e of map.exits) if (!reached[key(e)]) out.push(`exit ${e.id} not reached`);
  // Every room has a square reached; every square of floor that nothing
  // stands on is reached.
  const c = geo.compile(stored);
  for (const z of c.zones) {
    let any = false;
    for (let y = 0; y < map.height && !any; y++) {
      for (let x = 0; x < map.width && !any; x++) {
        if (reached[`${x},${y}`] && geo.pointInShape([x * 5 + 2.5, y * 5 + 2.5], z.item.shape)) {
          any = true;
        }
      }
    }
    if (!any) out.push(`zone ${z.item.id} not reached`);
  }
  const solid = c.objects.filter((o) => o.item.blocksMove !== false);
  for (const k of made.floor) {
    if (reached[k]) continue;
    const [x, y] = k.split(',').map(Number);
    if (solid.some((o) => geo.pointInShape([x * 5 + 2.5, y * 5 + 2.5], o.rings[0]))) continue;
    out.push(`floor ${k} not reached`);
  }
  return out;
}

describe('the same seed, the same map', () => {
  test.each(NAMED)('%s', (name, kind, style) => {
    const a = gen.generate(kind, { seed: 1234, style });
    const b = gen.generate(kind, { seed: 1234, style });
    expect(b).toEqual(a);
    expect(gen.generate(kind, { seed: 1235, style }).geometry).not.toEqual(a.geometry);
    // A word seeds it as well as a number.
    expect(gen.generate(kind, { seed: 'the-drowned-crypt', style })).toEqual(
      gen.generate(kind, { seed: 'the-drowned-crypt', style })
    );
    // And the size is part of it.
    const s = gen.SIZES[kind];
    expect(gen.generate(kind, { seed: 1234, style, width: s.width + 2 }).geometry).not.toEqual(
      a.geometry
    );
  });
});

describe('every seed in the test set is playable', () => {
  for (const [kind, style] of KINDS) {
    test(`${label(kind, style)}, at its default size`, () => {
      for (const seed of SEEDS) {
        const made = gen.generate(kind, { seed, style });
        expect({ seed, problems: unplayable(made) }).toEqual({ seed, problems: [] });
        expect(gen.problems(made, { floor: made.floor })).toEqual([]);
        expect(made.removed).toEqual([]);
      }
    }, 60000);

    test(`${label(kind, style)}, at its smallest and at 64 × 64`, () => {
      const s = gen.SIZES[kind];
      for (const [width, height] of [
        [s.min.width, s.min.height],
        [64, 64],
        [64, s.min.height],
      ]) {
        for (const seed of [1, 2, 3]) {
          const made = gen.generate(kind, { seed, style, width, height });
          expect({ width, height, seed, problems: unplayable(made) }).toEqual({
            width,
            height,
            seed,
            problems: [],
          });
        }
      }
    }, 60000);
  }
});

describe('ordinary data to edit', () => {
  test.each(NAMED)(
    '%s: built-in materials, catalog objects, unnamed rooms',
    (name, kind, style) => {
      const made = gen.generate(kind, { seed: 7, style });
      const g = made.geometry;
      // One entry and one exit "out", no features; nothing hidden, no spawns.
      expect(made.entries).toHaveLength(1);
      expect(made.exits).toEqual([expect.objectContaining({ to: 'out' })]);
      expect(made.features).toEqual([]);
      expect(g.hidden).toBeUndefined();
      expect(g.spawns).toBeUndefined();
      // Floors and walls, so it is graded drawn.
      expect(g.ground.length).toBeGreaterThan(0);
      expect(g.walls.length).toBeGreaterThan(0);
      // Every object from the catalog, with its size; a light or two.
      for (const o of g.objects || []) {
        expect(CATALOG.has(o.kind)).toBe(true);
        expect(o.size).toEqual(materials.objectKind(o.kind).size);
      }
      expect((g.lights || []).length).toBeGreaterThan(0);
      // Rooms are zones with no name, for the builder to name.
      for (const z of g.zones || []) expect(z.name).toBeUndefined();
      // Ids unique across the map's shapes.
      const ids = geo.LISTS.flatMap((k) => (g[k] || []).map((i) => i.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  );

  test('each kind has what makes it that kind', () => {
    const rooms = gen.generate('rooms', { seed: 3 });
    expect(rooms.rooms).toBeGreaterThanOrEqual(2);
    expect(rooms.geometry.doors.length).toBeGreaterThan(0);
    expect(rooms.geometry.zones).toHaveLength(rooms.rooms);

    // A cave's walls run at angles, not only along the grid.
    const caves = gen.generate('caves', { seed: 3 });
    const segments = caves.geometry.walls.flatMap((w) =>
      w.points.slice(1).map((p, i) => [w.points[i], p])
    );
    expect(segments.some(([a, b]) => a[0] !== b[0] && a[1] !== b[1])).toBe(true);

    // A building: a door between rooms, a front door to the street, windows.
    const house = gen.generate('interior', { seed: 3 });
    expect(house.geometry.doors.map((d) => d.id)).toContain('front-door');
    expect(house.geometry.doors).toHaveLength(house.rooms);
    expect(house.geometry.windows.length).toBeGreaterThan(0);
    expect(house.exits[0].name).toBe('the street');

    // A sailing ship: the sea nobody walks on, low rails, masts, a cabin.
    const ship = gen.generate('deck', { seed: 3, style: 'sailing' });
    expect(ship.geometry.ground.find((g) => g.id === 'sea')).toMatchObject({
      material: 'deep-water',
      cost: 'never',
    });
    expect(ship.geometry.walls.find((w) => w.id === 'rail')).toMatchObject({ height: 3 });
    expect(ship.geometry.objects.filter((o) => /mast/.test(o.name || '')).length).toBeGreaterThan(
      1
    );
    expect(ship.geometry.zones.map((z) => z.id)).toEqual(['deck', 'cabin']);
    expect(ship.exits[0].name).toBe('the gangplank');

    // A starship: a metal hull, an airlock with two hatches, a bridge.
    const star = gen.generate('deck', { seed: 3, style: 'starship' });
    expect(star.geometry.walls.find((w) => w.id === 'hull')).toMatchObject({ material: 'metal' });
    expect(star.geometry.doors.map((d) => d.id)).toEqual(
      expect.arrayContaining(['outer-hatch', 'inner-hatch', 'bridge-door', 'engine-door'])
    );
    expect(star.geometry.zones.map((z) => z.id)).toEqual(
      expect.arrayContaining(['engine', 'corridor', 'bridge', 'airlock'])
    );
    expect(star.geometry.objects.filter((o) => o.kind === 'console').length).toBeGreaterThan(1);
  });

  test('what is walked over says so, since play reads an object’s own flag', () => {
    const ship = gen.generate('deck', { seed: 3, style: 'sailing' });
    const hatches = ship.geometry.objects.filter((o) => o.kind === 'trapdoor');
    expect(hatches.length).toBeGreaterThan(0);
    for (const h of hatches) expect(h.blocksMove).toBe(false);
  });

  test('a ship is no wider than a ship that long, on a tall map', () => {
    const made = gen.generate('deck', { seed: 1, width: 30, height: 64 });
    const ys = made.geometry.walls.find((w) => w.id === 'rail').points.map((p) => p[1]);
    expect((Math.max(...ys) - Math.min(...ys)) / 5).toBeLessThanOrEqual(12);
  });
});

describe('what it refuses', () => {
  test('a kind it has no generator for, a size too small or too big, a style that is not', () => {
    expect(() => gen.generate('castle', { seed: 1 })).toThrow(/rooms, caves, interior, deck/);
    expect(() => gen.generate('rooms', { width: 10 })).toThrow(/from 16 to 64/);
    expect(() => gen.generate('interior', { height: 65 })).toThrow(/from 10 to 64/);
    expect(() => gen.generate('caves', { width: 20.5 })).toThrow(/whole number/);
    expect(() => gen.generate('rooms', { style: 'sailing' })).toThrow(/takes no style/);
    expect(() => gen.generate('deck', { style: 'zeppelin' })).toThrow(/sailing or starship/);
  });
});

describe('problems finds a map that is not playable', () => {
  test('a room walled off, a door taken away, an exit out of reach', () => {
    const made = gen.generate('interior', { seed: 5 });
    expect(gen.problems(made, { floor: made.floor })).toEqual([]);
    // Take away the front door: the street no longer reaches the rooms.
    const shut = JSON.parse(JSON.stringify(made));
    shut.geometry.doors = shut.geometry.doors.filter((d) => d.id !== 'front-door');
    const said = gen.problems(shut, { floor: shut.floor });
    expect(said.some((p) => /No square of the zone room-/.test(p))).toBe(true);
    expect(said.some((p) => /can’t be reached/.test(p))).toBe(true);

    // Lock it instead: a locked door is not walked through either.
    const locked = JSON.parse(JSON.stringify(made));
    locked.geometry.doors.find((d) => d.id === 'front-door').state = 'locked';
    expect(gen.problems(locked, { floor: locked.floor }).length).toBeGreaterThan(0);

    // A wall across the exit's square.
    const walled = JSON.parse(JSON.stringify(made));
    const e = walled.exits[0];
    walled.geometry.walls.push({
      id: 'blocker',
      material: 'stone',
      points: [
        [0, e.y * 5],
        [walled.width * 5, e.y * 5],
      ],
    });
    expect(gen.problems(walled)).toEqual([expect.stringContaining('The exit way-out')]);

    // And a fault in the geometry is said as map-geometry.js says it.
    const bad = JSON.parse(JSON.stringify(made));
    bad.geometry.walls[0].material = 'cheese';
    expect(gen.problems(bad)[0]).toMatch(/material/);
  });
});
