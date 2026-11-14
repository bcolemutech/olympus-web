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
const scale = require('../functions/loom-canon/scale');

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

// ── The wilds (planning/off-road-travel.md §4.6, EV5; L-365 / #839) ──────

describe('the wilds: every scene in three terrains (L-365)', () => {
  // A wooded terrain, a dry one and a wet one: they differ in what stands in
  // them and in their ground.
  const TERRAINS = ['forest', 'desert', 'swamp'];
  const CASES = gen.SCENES.flatMap((scene) => TERRAINS.map((terrain) => [scene, terrain]));
  const SEEDS_W = [1, 2, 3];
  const edgeOf = (map, e) =>
    e.x === 0 ? 'west' : e.x === map.width - 1 ? 'east' : e.y === 0 ? 'north' : 'south';

  test.each(CASES)(
    '%s in %s: the same seed, the same map; another seed, another',
    (scene, terrain) => {
      const a = gen.generate('wilds', { seed: 41, terrain, scene });
      expect(gen.generate('wilds', { seed: 41, terrain, scene })).toEqual(a);
      expect(gen.generate('wilds', { seed: 42, terrain, scene }).geometry).not.toEqual(a.geometry);
      expect(a).toMatchObject({ kind: 'wilds', terrain, scene, width: 30, height: 30 });
    }
  );

  test.each(CASES)(
    '%s in %s: every entry reaches every other, nothing blocks one, and it is playable',
    (scene, terrain) => {
      for (const seed of SEEDS_W) {
        const made = gen.generate('wilds', { seed, terrain, scene });
        const stored = geo.normalize(made.geometry);
        const map = { ...made, geometry: stored };
        expect({ seed, problems: unplayable(made) }).toEqual({ seed, problems: [] });
        expect(made.removed).toEqual([]);
        // Entries on at least two edges, each by its exit on the edge.
        expect(made.entries.length).toBeGreaterThanOrEqual(2);
        expect(made.exits).toHaveLength(made.entries.length);
        expect(new Set(made.exits.map((e) => edgeOf(made, e))).size).toBe(made.entries.length);
        made.exits.forEach((e, i) => {
          expect(e.to).toBe('out');
          expect(edgeOf(made, e)).toBe(made.entries[i].id);
        });
        // Every entry reaches every other, for a medium walker.
        for (const from of made.entries) {
          const reached = mapPaths.squaresReached(map, [from], { width: 2.5 });
          for (const to of made.entries)
            expect({ seed, from: from.id, to: to.id, ok: Boolean(reached[key(to)]) }).toEqual({
              seed,
              from: from.id,
              to: to.id,
              ok: true,
            });
        }
        // Nothing blocks an entry or its exit: a medium walker stands in
        // the middle of each, on ground anyone crosses.
        const c = geo.compile(stored);
        for (const sq of [...made.entries, ...made.exits]) {
          const p = [sq.x * 5 + 2.5, sq.y * 5 + 2.5];
          expect({ seed, at: sq.id, fits: geo.fits(c, p, 2.5) }).toEqual({
            seed,
            at: sq.id,
            fits: true,
          });
          const g = geo.groundAt(c, p);
          expect(g && g.cost).not.toBe('never');
        }
        // Spawn areas, three squares across, every square of them reached.
        const spawns = stored.spawns || [];
        expect(spawns.length).toBeGreaterThanOrEqual(2);
        const reached = mapPaths.squaresReached(map, made.entries);
        for (const s of spawns) {
          const { rect } = made.geometry.spawns.find((x) => x.id === s.id).shape;
          expect([rect.w, rect.h]).toEqual([15, 15]);
          for (let y = rect.y / 5; y < (rect.y + rect.h) / 5; y++)
            for (let x = rect.x / 5; x < (rect.x + rect.w) / 5; x++)
              expect({ seed, spawn: s.id, x, y, ok: Boolean(reached[`${x},${y}`]) }).toEqual({
                seed,
                spawn: s.id,
                x,
                y,
                ok: true,
              });
        }
        // Catalog objects, to scale; its ground the terrain's own.
        for (const o of stored.objects || []) expect(CATALOG.has(o.kind)).toBe(true);
        expect(scale.warnings(stored)).toEqual([]);
        expect(made.geometry.ground[0]).toMatchObject({ id: 'floor', material: terrain });
      }
    },
    60000
  );
});

describe('the wilds: what makes each scene', () => {
  const water = (made, id) => made.geometry.ground.find((g) => g.id === id);

  test('a ford: its water is crossed, the river nowhere else', () => {
    for (const terrain of ['grass', 'forest', 'desert']) {
      for (const seed of [1, 2, 3]) {
        const made = gen.generate('wilds', { seed, terrain, scene: 'ford' });
        expect(water(made, 'ford-water')).toMatchObject({ material: 'water', cost: 2 });
        expect(water(made, 'river')).toMatchObject({ material: 'deep-water', cost: 'never' });
        const map = { ...made, geometry: geo.normalize(made.geometry) };
        const [west, east] = made.entries;
        expect(mapPaths.squaresReached(map, [west])[key(east)]).toBe(true);
        // The way across goes through the ford.
        const plan = mapPaths.planner(map);
        const path = mapPaths.pathTo(plan, mapPaths.centreOf(west), mapPaths.centreOf(east));
        const c = geo.compile(map.geometry);
        expect(
          path.points.some((p) => (geo.groundAt(c, [p.x, p.y]) || {}).id === 'ford-water')
        ).toBe(true);
        // Without the ford the river is crossed nowhere.
        const dry = JSON.parse(JSON.stringify(made));
        water(dry, 'ford-water').cost = 'never';
        const noFord = { ...dry, geometry: geo.normalize(dry.geometry) };
        expect(mapPaths.squaresReached(noFord, [west])[key(east)]).toBeUndefined();
      }
    }
  });

  test('a ridge: its slope walked up, a cliff down its other side, its top and foot as zones', () => {
    const made = gen.generate('wilds', { seed: 4, terrain: 'hills', scene: 'ridge' });
    const levels = made.geometry.ground.filter((g) => /^ridge-/.test(g.id));
    expect(levels.length).toBeGreaterThanOrEqual(3);
    levels.forEach((g, i) => expect(g.height).toBe((i + 1) * 2));
    expect(Math.max(...levels.map((g) => g.height))).toBeGreaterThanOrEqual(mapPaths.FALL);
    expect(made.geometry.zones.map((z) => z.id)).toEqual(['ridge', 'cliff-foot']);
    // Its top is reached, by its slope.
    const map = { ...made, geometry: geo.normalize(made.geometry) };
    const c = geo.compile(map.geometry);
    const reached = mapPaths.squaresReached(map, made.entries);
    const top = Object.keys(reached).filter((k) => {
      const [x, y] = k.split(',').map(Number);
      return mapPaths.floorAt(map, { x: x * 5 + 2.5, y: y * 5 + 2.5 }) === levels.length * 2;
    });
    expect(top.length).toBeGreaterThan(0);
    // Its cliff is a drop of a fall or more.
    expect(c.ground.some((g) => g.item.height >= mapPaths.FALL)).toBe(true);
  });

  test('ruins: broken stone walls the way runs through; a clearing, a track and a marsh', () => {
    const ruins = gen.generate('wilds', { seed: 2, terrain: 'grassland', scene: 'ruins' });
    expect(ruins.geometry.walls.length).toBeGreaterThan(1);
    ruins.geometry.walls.forEach((w) => expect(w.material).toBe('stone'));
    expect(ruins.geometry.zones.map((z) => z.id)).toContain('ruins');
    expect(ruins.geometry.objects.some((o) => o.kind === 'pillar')).toBe(true);

    const clearing = gen.generate('wilds', { seed: 2, terrain: 'forest', scene: 'clearing' });
    expect(clearing.geometry.zones.map((z) => z.id)).toContain('clearing');
    // No tree stands in the clearing.
    const glade = clearing.geometry.zones.find((z) => z.id === 'clearing');
    for (const o of clearing.geometry.objects.filter((x) => x.kind === 'tree')) {
      expect(geo.pointInShape(o.at, glade.shape)).toBe(false);
    }

    const track = gen.generate('wilds', { seed: 2, terrain: 'forest', scene: 'forest-track' });
    expect(track.geometry.lines.find((l) => l.id === 'way')).toMatchObject({ material: 'track' });
    expect(track.geometry.objects.filter((o) => o.kind === 'tree').length).toBeGreaterThan(30);
    expect(track.geometry.objects.some((o) => o.kind === 'log')).toBe(true);

    const marsh = gen.generate('wilds', { seed: 2, terrain: 'marsh', scene: 'marsh-path' });
    expect(water(marsh, 'pools')).toMatchObject({ material: 'water', cost: 2 });
    expect(marsh.geometry.zones.map((z) => z.id)).toContain('causeway');
  });

  test('trees and bushes grow to their own sizes; a bush is pushed through, a log climbed round', () => {
    const made = gen.generate('wilds', { seed: 5, terrain: 'forest', scene: 'forest-track' });
    const sizes = new Set(
      made.geometry.objects.filter((o) => o.kind === 'tree').map((o) => o.size[0])
    );
    expect(sizes.size).toBeGreaterThan(3);
    expect(materials.objectKind('bush')).toMatchObject({ blocksSight: true, blocksMove: false });
    expect(materials.objectKind('log').blocksMove).toBeUndefined();
    for (const o of made.geometry.objects.filter((x) => x.kind === 'bush')) {
      expect(o.blocksMove).toBe(false);
    }
  });

  test('every terrain makes every scene, at its smallest', () => {
    for (const terrain of gen.TERRAINS) {
      for (const scene of gen.SCENES) {
        const made = gen.generate('wilds', { seed: 7, terrain, scene, width: 16, height: 16 });
        expect({ terrain, scene, problems: unplayable(made) }).toEqual({
          terrain,
          scene,
          problems: [],
        });
      }
    }
  }, 60000);

  test('a terrain’s own scene by default; what it refuses', () => {
    expect(gen.generate('wilds', { terrain: 'forest' }).scene).toBe('forest-track');
    expect(gen.generate('wilds', { terrain: 'swamp' }).scene).toBe('marsh-path');
    expect(gen.generate('wilds', {})).toMatchObject({ terrain: 'grass', scene: 'clearing' });
    expect(() => gen.generate('wilds', { terrain: 'ocean' })).toThrow(/terrain is one of/);
    expect(() => gen.generate('wilds', { scene: 'volcano' })).toThrow(/scene is one of/);
    expect(() => gen.generate('rooms', { terrain: 'forest' })).toThrow(/takes no terrain/);
    expect(() => gen.generate('wilds', { style: 'sailing' })).toThrow(/takes no style/);
  });
});
