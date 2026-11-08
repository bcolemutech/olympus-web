'use strict';

/**
 * Dressing a room and keeping objects to scale (planning/game-art.md §4.5,
 * §4.6, DR1, SC1; L-945 / #799), pure:
 *
 *   - dress_room's engine: the same dressing for a seed, a different one for
 *     another; more for a higher density; only the theme's decor; clear of
 *     doors, windows, entries, exits, features, walls and what is there; a
 *     tapestry hung flush on a wall; dressing again replaces the old; and the
 *     way through the room never closed, over a set of seeds, themes and
 *     densities, on generated dungeons and on a corridor a pile of crates
 *     could shut;
 *   - what it refuses, with the reason;
 *   - the scale warnings: under half or over twice a kind's usual size
 *     (the world's own kind's, too), into a wall (hung and flat decor let
 *     be), and a figure too big for where it stands.
 *
 * Run: cd tests && npx jest loom-dress --verbose
 */

const geo = require('../functions/loom-canon/map-geometry');
const materials = require('../functions/loom-canon/materials');
const generators = require('../functions/loom-canon/map-generators');
const mapPaths = require('../functions/loom-canon/map-paths');
const dress = require('../functions/loom-canon/dress');
const scale = require('../functions/loom-canon/scale');
const { VAULT } = require('./helpers/vault');

// A generated dungeon, as a battle map: its rooms are zones room-1…
const dungeon = (seed) => {
  const made = generators.generate('rooms', { seed });
  return {
    width: made.width,
    height: made.height,
    entries: made.entries,
    exits: made.exits,
    features: [],
    geometry: geo.normalize(made.geometry),
  };
};

// A map with `objects` added.
const withObjects = (map, objects) => ({
  ...map,
  geometry: geo.normalize({
    ...map.geometry,
    objects: [...(map.geometry.objects || []), ...objects],
  }),
});

const ringOf = (o) => {
  const a = ((o.turn || 0) * Math.PI) / 180 || 0;
  return [
    [-o.size[0] / 2, -o.size[1] / 2],
    [o.size[0] / 2, -o.size[1] / 2],
    [o.size[0] / 2, o.size[1] / 2],
    [-o.size[0] / 2, o.size[1] / 2],
  ].map(([x, y]) => [
    o.at[0] + x * Math.cos(a) - y * Math.sin(a),
    o.at[1] + x * Math.sin(a) + y * Math.cos(a),
  ]);
};
// How far a point is from a footprint's edge.
const nearTo = (p, o) => {
  const ring = ringOf(o);
  return Math.min(...ring.map((q, i) => geo.distanceToSegment(p, q, ring[(i + 1) % ring.length])));
};
jest.setTimeout(120000);

const THEMES = dress.themeNames();
const DENSITIES = Object.keys(dress.DENSITIES);

describe('dressing a room', () => {
  const map = dungeon(3);
  const zone = 'room-1';
  const run = (o = {}) =>
    dress.dress(map, { zone, theme: 'dungeon', density: 'lived-in', seed: 7, ...o });

  test('the same seed makes the same dressing, another a different one', () => {
    expect(run().objects).toEqual(run().objects);
    expect(run({ seed: 8 }).objects).not.toEqual(run().objects);
    // A word is a seed too.
    expect(run({ seed: 'the old cellar' }).objects).toEqual(
      run({ seed: 'the old cellar' }).objects
    );
    expect(run({ seed: 'the old cellar' }).objects).not.toEqual(run().objects);
    expect(run().seed).toBe(7);
  });

  test('its pieces are decor of the theme, sized, in the zone, with their own ids', () => {
    const made = run();
    expect(made.objects.length).toBeGreaterThan(0);
    made.objects.forEach((o, i) => {
      expect(o.id).toBe(`room-1-decor-${i + 1}`);
      expect(Object.keys(dress.THEMES.dungeon)).toContain(o.kind);
      expect(materials.isDecor(o)).toBe(true);
      expect(o).toMatchObject({ decor: true, size: materials.objectKind(o.kind).size });
    });
    // The whole of it checks out with the map.
    const bounds = { width: map.width * 5, height: map.height * 5 };
    expect(geo.check(withObjects(map, made.objects).geometry, bounds)).toEqual([]);
    const total = Object.values(made.byKind).reduce((s, n) => s + n, 0);
    expect(total).toBe(made.objects.length);
  });

  test('a theme has its own decor: a crypt isn’t a tavern', () => {
    const kinds = (theme) =>
      new Set(
        DENSITIES.flatMap((density) =>
          [1, 2].flatMap((seed) => run({ theme, density, seed }).objects.map((o) => o.kind))
        )
      );
    const crypt = kinds('crypt');
    const tavern = kinds('tavern');
    expect(crypt.has('bones')).toBe(true);
    expect(crypt.has('bottles')).toBe(false);
    expect(tavern.has('bottles')).toBe(true);
    expect(tavern.has('bones')).toBe(false);
    for (const theme of THEMES) {
      Object.keys(dress.THEMES[theme]).forEach((kind) =>
        expect(materials.isDecor({ kind })).toBe(true)
      );
    }
  });

  test('a higher density puts down more, by the zone’s area', () => {
    const wanted = DENSITIES.map((density) => run({ density }).wanted);
    expect(wanted[0]).toBeLessThan(wanted[1]);
    expect(wanted[1]).toBeLessThan(wanted[2]);
    const placed = DENSITIES.map((density) => run({ density }).objects.length);
    expect(placed[0]).toBeLessThan(placed[1]);
    expect(placed[1]).toBeLessThan(placed[2]);
    // A bigger room gets more at the same density.
    const bigger = (z) => run({ zone: z, density: 'lived-in' }).wanted;
    const areas = map.geometry.zones.map((z) => ({
      id: z.id,
      wanted: bigger(z.id),
    }));
    expect(Math.max(...areas.map((a) => a.wanted))).toBeGreaterThan(
      Math.min(...areas.map((a) => a.wanted))
    );
  });

  test('it keeps clear of doors, entries, exits, features, walls and what is there', () => {
    const vault = VAULT();
    const room = {
      ...vault,
      geometry: geo.normalize({
        ...vault.geometry,
        // One room, the west half, as a zone.
        zones: [{ id: 'west', shape: { rect: { x: 0, y: 0, w: 30, h: 40 } } }],
        windows: [{ id: 'slit', material: 'glass', from: [30, 5], to: [30, 8], wall: 'wall' }],
      }),
    };
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const made = dress.dress(room, { zone: 'west', theme: 'store', density: 'cluttered', seed });
      expect(made.objects.length).toBeGreaterThan(3);
      const there = room.geometry.objects.filter((o) => o.at[0] < 30);
      for (const o of made.objects) {
        // The gate (30, 15–20), the entry (1, 6), the exit (0, 4), the altar (10, 6).
        expect(nearTo([30, 17.5], o)).toBeGreaterThanOrEqual(3.5 + 2.5 - 0.01);
        expect(nearTo([7.5, 32.5], o)).toBeGreaterThanOrEqual(3.5 - 0.01);
        expect(nearTo([2.5, 22.5], o)).toBeGreaterThanOrEqual(3.5 - 0.01);
        expect(nearTo([52.5, 32.5], o)).toBeGreaterThanOrEqual(3 - 0.01);
        // Not on what is there already.
        for (const other of there) {
          expect(
            ringOf(other).some((p) => nearTo(p, o) < 0.5 && geo.pointInShape(p, ringOf(o)))
          ).toBe(false);
          expect(geo.pointInShape(other.at, ringOf(o))).toBe(false);
        }
        // Not on a wall (the one at x = 30 ft), but a tapestry hangs on one.
        if (!materials.objectKind(o.kind).onWall) {
          const edge = Math.max(...ringOf(o).map((p) => p[0]));
          expect(30 - edge).toBeGreaterThanOrEqual(1 - 0.01);
        }
      }
      // And not on each other.
      made.objects.forEach((a, i) =>
        made.objects.slice(i + 1).forEach((b) => {
          expect(ringOf(a).some((p) => geo.pointInShape(p, ringOf(b)))).toBe(false);
        })
      );
    }
  });

  test('a tapestry, a banner or chains hang flush on a wall, turned along it', () => {
    const found = [];
    for (let seed = 1; seed <= 40 && found.length < 3; seed++) {
      const made = dress.dress(map, { zone, theme: 'bedroom', density: 'cluttered', seed });
      made.objects.filter((o) => materials.objectKind(o.kind).onWall).forEach((o) => found.push(o));
    }
    expect(found.length).toBeGreaterThanOrEqual(3);
    const walls = geo.edges(geo.compile(map.geometry), {}).filter((e) => e.kind === 'wall');
    found.forEach((o) => {
      const d = Math.min(...walls.map((w) => geo.distanceToSegment(o.at, w.a, w.b)));
      // Its middle half its depth and half a wall from the wall's line.
      expect(d).toBeCloseTo(o.size[1] / 2 + 0.8, 0);
      expect((((o.turn || 0) % 90) + 90) % 90).toBeLessThan(1.5);
    });
  });

  test('dressing the zone again ignores the old dressing: the same seed, the same pieces', () => {
    const first = run();
    const again = dress.dress(withObjects(map, first.objects), {
      zone,
      theme: 'dungeon',
      density: 'lived-in',
      seed: 7,
    });
    expect(again.objects).toEqual(first.objects);
    expect(again.prefix).toBe('room-1-decor-');
  });

  test('what it won’t do, with the reason', () => {
    expect(() => run({ zone: 'attic' })).toThrow(/no zone "attic" \(it has room-1, room-2/);
    expect(() => run({ theme: 'swamp' })).toThrow(/No theme "swamp": dungeon, tavern/);
    expect(() => run({ density: 'packed' })).toThrow(/No density "packed": sparse, lived-in/);
  });
});

describe('the way through the room is never closed', () => {
  // The squares a walk from the entries reaches, and whether the exits are among them.
  const reaches = (map) => {
    const reached = mapPaths.squaresReached(map, map.entries);
    return map.exits.every((e) => reached[`${e.x},${e.y}`]);
  };
  const dressed = (map, o) => {
    const made = dress.dress(map, o);
    return { made, map: withObjects(map, made.objects) };
  };

  test('generated dungeons, every theme and density, a set of seeds: entry reaches exit', () => {
    let pieces = 0;
    let blocking = 0;
    for (const seed of [4]) {
      const base = dungeon(seed);
      expect(reaches(base)).toBe(true);
      const zones = base.geometry.zones.map((z) => z.id).slice(0, 2);
      for (const theme of THEMES) {
        for (const density of DENSITIES) {
          let map = base;
          for (const zone of zones) {
            const done = dressed(map, { zone, theme, density, seed: `${seed}-${theme}` });
            map = done.map;
            pieces += done.made.objects.length;
            blocking += done.made.objects.filter((o) => geo.objectBlocksMove(o)).length;
          }
          expect(reaches(map)).toBe(true);
        }
      }
    }
    // It put down a lot, some of it blocking, and still no way was closed.
    expect(pieces).toBeGreaterThan(80);
    expect(blocking).toBeGreaterThan(0);
  });

  test('a corridor 8 ft wide: crates go by a wall, never across it, over a set of seeds', () => {
    const hall = {
      width: 12,
      height: 3,
      entries: [{ id: 'in', x: 0, y: 1 }],
      exits: [{ id: 'out', name: 'the end', x: 11, y: 1, to: 'out' }],
      features: [],
      geometry: geo.normalize({
        walls: [
          {
            id: 'north',
            material: 'stone',
            points: [
              [0, 5],
              [60, 5],
            ],
          },
          {
            id: 'south',
            material: 'stone',
            points: [
              [0, 13],
              [60, 13],
            ],
          },
        ],
        zones: [{ id: 'hall', shape: { rect: { x: 0, y: 5, w: 60, h: 8 } } }],
      }),
    };
    const walk = (m) =>
      mapPaths.pathTo(mapPaths.planner(m, {}), { x: 2.5, y: 9 }, { x: 57.5, y: 9 });
    expect(walk(hall)).not.toBeNull();
    let crates = 0;
    let skippedAny = false;
    for (let seed = 1; seed <= 30; seed++) {
      const done = dressed(hall, { zone: 'hall', theme: 'store', density: 'cluttered', seed });
      expect(walk(done.map)).not.toBeNull();
      crates += done.made.objects.filter((o) => o.kind === 'crate-pile').length;
      skippedAny = skippedAny || done.made.skipped > 0;
    }
    // Crates went in where they leave room; where they'd shut it, they didn't.
    expect(crates).toBeGreaterThan(0);
    expect(skippedAny).toBe(true);
  });
});

describe('scale warnings', () => {
  const room = (objects) => ({
    ...VAULT(),
    geometry: geo.normalize({ ...VAULT().geometry, objects }),
  });
  const warn = (objects, o) => scale.warnings(room(objects).geometry, o);
  const chest = (size, extra = {}) => ({ id: 'c', kind: 'chest', at: [10, 10], size, ...extra });

  test('a chest is 3 × 2 ft: over twice or under half either way is said, with its usual size', () => {
    expect(warn([chest([3, 2])])).toEqual([]);
    expect(warn([chest([4, 3])])).toEqual([]);
    expect(warn([chest([12, 8])]).join()).toBe(
      'chest "c" is 12 × 8 ft, over twice the usual 3 × 2 ft of a chest.'
    );
    expect(warn([chest([1, 0.5])]).join()).toMatch(/under half the usual 3 × 2 ft of a chest/);
    // Only one way: a long chest.
    expect(warn([chest([3, 7])]).join()).toMatch(/over twice/);
    // Twice exactly is not over it.
    expect(warn([chest([3, 6])])).toEqual([]);
    // A bed is 3 × 6, or 6 × 3 turned: the same bed.
    expect(warn([{ id: 'b', kind: 'bed', at: [10, 10], size: [6, 3] }])).toEqual([]);
    expect(warn([{ id: 'b', kind: 'bed', at: [10, 10], size: [3, 6] }])).toEqual([]);
  });

  test('the world’s own kind sets what is usual; an unknown kind has none', () => {
    const worldKinds = { chest: { size: [12, 8] } };
    expect(warn([chest([12, 8])], { worldKinds })).toEqual([]);
    expect(warn([chest([3, 2])], { worldKinds }).join()).toMatch(/under half the usual 12 × 8/);
    expect(warn([{ id: 'x', kind: 'mystery-engine', at: [10, 10], size: [40, 40] }])).toEqual([]);
  });

  test('into a wall is said; flush against it, or hung on it, is not', () => {
    // The vault's wall runs down x = 30 ft.
    expect(warn([chest([3, 2], { at: [30, 30] })]).join()).toBe(
      'chest "c" overlaps the wall "wall": move it clear of it.'
    );
    expect(warn([chest([3, 2], { at: [28.5, 30] })])).toEqual([]);
    expect(warn([chest([3, 2], { at: [29, 30] })]).join()).toMatch(/overlaps the wall/);
    // A pile of crates is decor, but not flat or hung: it may not go into one.
    expect(warn([{ id: 'p', kind: 'crate-pile', at: [30, 30], size: [4, 3] }]).join()).toMatch(
      /pile of crates "p" overlaps the wall/
    );
    // Hung and flat decor is let be.
    expect(warn([{ id: 't', kind: 'tapestry', at: [30, 30], size: [1, 4] }])).toEqual([]);
    expect(warn([{ id: 'r', kind: 'rubble', at: [30, 30], size: [4, 4] }])).toEqual([]);
  });

  test('only what was just set, and no more than twelve sentences', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `big-${i}`,
      kind: 'chest',
      at: [5 + (i % 5), 5 + Math.floor(i / 5) * 2],
      size: [12, 8],
    }));
    const all = warn(many);
    expect(all).toHaveLength(13);
    expect(all[12]).toBe('…and 8 more odd objects.');
    expect(warn(many, { only: ['big-3'] })).toHaveLength(1);
  });

  test('a figure too big for where it stands is said', () => {
    const map = VAULT();
    // The vault's wall is at x = 30: a medium figure in the square beside it fits, a huge one doesn't.
    const fighter = (name, cell, size) => ({ name, cell, sheet: { size } });
    expect(scale.figureWarnings(map, [fighter('Goblin', { x: 5, y: 1 }, 'medium')])).toEqual([]);
    expect(scale.figureWarnings(map, [fighter('Ogre', { x: 5, y: 1 }, 'large')])).toEqual([]);
    const said = scale.figureWarnings(map, [fighter('Giant', { x: 5, y: 1 }, 'huge')]);
    expect(said.join()).toBe(
      "Giant is 10 ft across and doesn't fit at (5, 1): something there is in the way. Place them where there is room."
    );
  });
});
