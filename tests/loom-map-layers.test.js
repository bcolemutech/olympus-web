'use strict';

/**
 * A battle map's layers (functions/loom-canon/layers.js; planning/the-loom-
 * movement-and-vision.md §4; L-621 / #446): walls along the grid lines, doors
 * in them, obstacles on squares; what lies between two squares, whether a
 * step can be taken, and the checks that keep a map playable. Pure.
 *
 * Run: cd tests && npx jest loom-map-layers --verbose
 */

const layers = require('../functions/loom-canon/layers');

// The Gull & Anchor, walled: a back room east of a wall at x = 8, through
// the back door at its gap (8, 3)–(8, 4); a low bar, a solid pillar and
// rubble on the floor.
//
//   corners 0…12 across, 0…8 down; exits at (0, 4) and (11, 7)
const TAVERN = () => ({
  id: 'bm_tavern',
  width: 12,
  height: 8,
  entries: [
    { id: 'door', x: 1, y: 4 },
    { id: 'stair-top', x: 10, y: 6 },
  ],
  exits: [
    { id: 'front-door', name: 'the front door', x: 0, y: 4, to: 'out' },
    { id: 'cellar-stairs', name: 'the cellar stairs', x: 11, y: 7, to: 'out' },
  ],
  features: [{ id: 'bar', name: 'the bar', x: 4, y: 2 }],
  walls: [
    {
      points: [
        { x: 8, y: 0 },
        { x: 8, y: 3 },
      ],
    },
    {
      points: [
        { x: 8, y: 4 },
        { x: 8, y: 8 },
      ],
    },
  ],
  doors: [{ id: 'back-door', name: 'the back door', from: { x: 8, y: 3 }, to: { x: 8, y: 4 } }],
  obstacles: [
    { id: 'bar', name: 'the bar', kind: 'low', x: 3, y: 2, w: 3 },
    { id: 'pillar', name: 'a pillar', kind: 'solid', x: 6, y: 6 },
    { id: 'rubble', name: 'rubble', kind: 'difficult', x: 2, y: 6, w: 2 },
  ],
});
const sq = (x, y) => ({ x, y });

describe('what lies between squares, and stepping', () => {
  const map = TAVERN();

  test('a wall between two squares side by side blocks the step', () => {
    expect(layers.between(map, sq(7, 1), sq(8, 1))).toEqual({ wall: true, door: null });
    expect(layers.canStep(map, sq(7, 1), sq(8, 1))).toBe(false);
    expect(layers.canStep(map, sq(8, 1), sq(7, 1))).toBe(false);
  });

  test('a door in the gap: closed opens, locked does not (unless opened)', () => {
    expect(layers.between(map, sq(7, 3), sq(8, 3)).door).toMatchObject({ id: 'back-door' });
    expect(layers.canStep(map, sq(7, 3), sq(8, 3))).toBe(true);
    const locked = {
      ...TAVERN(),
      doors: [{ ...TAVERN().doors[0], locked: true, key: 'brass key' }],
    };
    expect(layers.canStep(locked, sq(7, 3), sq(8, 3))).toBe(false);
    expect(layers.canStep(locked, sq(7, 3), sq(8, 3), () => true)).toBe(true);
    expect(layers.canStep(map, sq(7, 3), sq(8, 3), () => false)).toBe(false);
  });

  test('a diagonal cannot squeeze past a corner a wall or door touches', () => {
    expect(layers.between(map, sq(7, 2), sq(8, 3))).toEqual({ wall: true, door: null });
    expect(layers.canStep(map, sq(7, 2), sq(8, 3))).toBe(false);
    expect(layers.canStep(map, sq(7, 4), sq(8, 3))).toBe(false); // the door's corner
    expect(layers.canStep(map, sq(2, 4), sq(3, 5))).toBe(true);
  });

  test("a door's own corners count, even with no wall beside it", () => {
    const doorOnly = { ...TAVERN(), walls: [] };
    expect(layers.canStep(doorOnly, sq(7, 2), sq(8, 3))).toBe(false); // past (8, 3)
    expect(layers.canStep(doorOnly, sq(7, 0), sq(8, 1))).toBe(true); // no wall now
  });

  test('solid and low squares are never stepped on; difficult ground is', () => {
    expect(layers.canStep(map, sq(4, 3), sq(4, 2))).toBe(false); // the bar
    expect(layers.canStep(map, sq(6, 5), sq(6, 6))).toBe(false); // the pillar
    expect(layers.canStep(map, sq(2, 5), sq(2, 6))).toBe(true); // the rubble
    expect(layers.groundAt(map, sq(4, 2))).toBe('low');
    expect(layers.groundAt(map, sq(3, 6))).toBe('difficult');
    expect(layers.groundAt(map, sq(9, 1))).toBe('open');
    expect(layers.obstacleAt(map, sq(5, 2))).toMatchObject({ id: 'bar' });
  });

  test('nor squeezed between diagonally, past a solid or low square beside', () => {
    expect(layers.canStep(map, sq(5, 6), sq(6, 7))).toBe(false); // past the pillar
    expect(layers.canStep(map, sq(5, 5), sq(6, 4))).toBe(true);
  });

  test('off the grid is no step', () => {
    expect(layers.canStep(map, sq(0, 0), sq(-1, 0))).toBe(false);
    expect(layers.canStep(map, sq(11, 7), sq(12, 7))).toBe(false);
  });

  test('a map without layers is open ground', () => {
    const open = { width: 4, height: 4, entries: [], exits: [] };
    expect(layers.hasLayers(open)).toBe(false);
    expect(layers.hasLayers(map)).toBe(true);
    expect(layers.canStep(open, sq(1, 1), sq(2, 2))).toBe(true);
    expect(layers.check(open)).toEqual([]);
  });
});

describe('the checks', () => {
  const problemsWith = (change) => layers.check({ ...TAVERN(), ...change(TAVERN()) });

  test('the walled tavern passes', () => {
    expect(layers.check(TAVERN())).toEqual([]);
  });

  test.each([
    [
      'a wall with one point',
      (m) => ({ walls: [{ points: [sq(1, 1)] }] }),
      /Wall 1 needs at least two points/,
    ],
    [
      'a wall off the grid',
      (m) => ({ walls: [{ points: [sq(1, 1), sq(13, 1)] }] }),
      /Wall 1: every point must be a whole-number corner/,
    ],
    [
      'a wall between corners',
      (m) => ({ walls: [{ points: [sq(1, 1), sq(1.5, 1)] }] }),
      /whole-number corner/,
    ],
    [
      'a slanting wall',
      (m) => ({ walls: [{ points: [sq(1, 1), sq(3, 2)] }] }),
      /must run along the grid lines.*from \(1, 1\) to \(3, 2\)/,
    ],
    [
      'a door two squares long',
      (m) => ({ doors: [{ ...m.doors[0], to: sq(8, 5) }] }),
      /one square long/,
    ],
    [
      'a door off the grid',
      (m) => ({ doors: [{ ...m.doors[0], from: sq(13, 3), to: sq(13, 4) }] }),
      /whole-number corners/,
    ],
    [
      'a door on a wall',
      (m) => ({ doors: [{ ...m.doors[0], from: sq(8, 1), to: sq(8, 2) }] }),
      /sits on a wall: leave a gap/,
    ],
    [
      'two doors in one place',
      (m) => ({ doors: [m.doors[0], { ...m.doors[0], id: 'other' }] }),
      /"back-door" and "other" are in the same place/,
    ],
    [
      'a door and an obstacle sharing an id',
      (m) => ({ obstacles: [{ ...m.obstacles[0], id: 'back-door' }] }),
      /Two doors or obstacles are "back-door"/,
    ],
    [
      'an obstacle of no kind',
      (m) => ({ obstacles: [{ ...m.obstacles[0], kind: 'wet' }] }),
      /must be solid, low or difficult/,
    ],
    [
      'an obstacle off the grid',
      (m) => ({ obstacles: [{ ...m.obstacles[0], x: 11, w: 3 }] }),
      /must lie on the 12 × 8 grid/,
    ],
    [
      'an obstacle of no size',
      (m) => ({ obstacles: [{ ...m.obstacles[0], w: 0 }] }),
      /at least a square/,
    ],
    [
      'overlapping obstacles',
      (m) => ({ obstacles: [m.obstacles[0], { ...m.obstacles[1], x: 5, y: 2 }] }),
      /"bar" and "pillar" overlap at \(5, 2\)/,
    ],
    [
      'an obstacle on an entry',
      (m) => ({ obstacles: [{ id: 'crate', kind: 'solid', x: 1, y: 4 }] }),
      /"crate" covers the entry "door" at \(1, 4\)/,
    ],
    [
      'an obstacle on an exit',
      (m) => ({ obstacles: [{ id: 'cask', kind: 'low', x: 11, y: 7 }] }),
      /"cask" covers the exit "cellar-stairs"/,
    ],
  ])('refuses %s', (_label, change, message) => {
    const problems = problemsWith(change);
    expect(problems.join('\n')).toMatch(message);
  });

  test('difficult ground may lie on an entry or exit', () => {
    expect(
      problemsWith(() => ({ obstacles: [{ id: 'mud', kind: 'difficult', x: 1, y: 4 }] }))
    ).toEqual([]);
  });

  test('a feature may sit on an obstacle (the bar)', () => {
    expect(layers.check(TAVERN())).toEqual([]); // the bar's feature is on the low bar
  });

  test('an entry walled in is refused; nobody is stranded', () => {
    // Walls all round the stair-top (10, 6): from corner (10, 6) round to (11, 7).
    const boxed = problemsWith(() => ({
      walls: [
        ...TAVERN().walls,
        { points: [sq(10, 6), sq(11, 6), sq(11, 7), sq(10, 7), sq(10, 6)] },
      ],
    }));
    expect(boxed).toEqual([
      'The entry "stair-top" at (10, 6) can\'t reach any exit without passing a locked door or a wall.',
    ]);
  });

  test('a locked door that strands an entry is refused; unlocked, it passes', () => {
    // The back room's only way out is the back door: the stair-top is in it,
    // and the cellar stairs are too, so move that exit out front.
    const backRoom = (locked) =>
      problemsWith((m) => ({
        exits: [m.exits[0], { ...m.exits[1], x: 6, y: 7 }],
        doors: [{ ...m.doors[0], locked }],
      }));
    expect(backRoom(true).join('\n')).toMatch(/"stair-top" .* can't reach any exit/);
    expect(backRoom(false)).toEqual([]);
  });

  test('an entry that is its own exit (a market stall) is never stranded', () => {
    const stall = {
      width: 3,
      height: 3,
      entries: [{ id: 'aisle', x: 1, y: 2 }],
      exits: [{ id: 'aisle-out', x: 1, y: 2, to: 'out' }],
      walls: [{ points: [sq(0, 0), sq(3, 0), sq(3, 3), sq(0, 3), sq(0, 0)] }],
    };
    expect(layers.check(stall)).toEqual([]);
  });
});
