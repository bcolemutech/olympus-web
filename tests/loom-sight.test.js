'use strict';

/**
 * Line of sight on battle maps (functions/loom-canon/sight.js; planning/the-
 * loom-movement-and-vision.md §5; L-631 / #454): a square is in sight when an
 * unblocked line runs from the centre of yours to some part of it. Walls,
 * doors that aren't open and solid obstacles block; low obstacles and
 * difficult ground don't. Checked against a plain ray caster
 * (helpers/sight-reference.js) on random maps, and timed on 64 × 64 maps.
 * Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-sight --verbose
 */

const sight = require('../functions/loom-canon/sight');
const reference = require('./helpers/sight-reference');

const sq = (x, y) => ({ x, y });
const run = (a, b) => ({ points: [a, b] });

// A map's squares in sight from `from`, row by row: `@` is you, `o` in sight,
// `.` hidden.
function picture(map, from, states) {
  const seen = sight.inSight(map, from, states);
  const rows = [];
  for (let y = 0; y < map.height; y++) {
    let row = '';
    for (let x = 0; x < map.width; x++) {
      row += x === from.x && y === from.y ? '@' : seen[x + ',' + y] ? 'o' : '.';
    }
    rows.push(row);
  }
  return rows;
}

// A front room and a back room east of a wall at x = 8, through the back
// door in its gap, (8, 3)–(8, 4).
const BACK_ROOM = (door = {}) => ({
  width: 12,
  height: 8,
  walls: [run(sq(8, 0), sq(8, 3)), run(sq(8, 4), sq(8, 8))],
  doors: [{ id: 'back-door', name: 'the back door', from: sq(8, 3), to: sq(8, 4), ...door }],
});

describe('line of sight', () => {
  test('on open ground, every square is in sight, wherever you stand', () => {
    const open = { width: 12, height: 8 };
    [sq(0, 0), sq(5, 3), sq(11, 7)].forEach((from) => {
      expect(Object.keys(sight.inSight(open, from))).toHaveLength(96);
    });
  });

  test('a wall hides the room behind it, and a closed door with it', () => {
    expect(picture(BACK_ROOM(), sq(6, 3))).toEqual([
      'oooooooo....',
      'oooooooo....',
      'oooooooo....',
      'oooooo@o....',
      'oooooooo....',
      'oooooooo....',
      'oooooooo....',
      'oooooooo....',
    ]);
  });

  test('an open door shows a cone of the room beyond, turning with where you stand', () => {
    const open = { 'back-door': 'open' };
    expect(picture(BACK_ROOM(), sq(6, 3), open)).toEqual([
      'oooooooo....',
      'oooooooo...o',
      'oooooooooooo',
      'oooooo@ooooo',
      'oooooooooooo',
      'oooooooo...o',
      'oooooooo....',
      'oooooooo....',
    ]);
    expect(picture(BACK_ROOM(), sq(2, 6), open)).toEqual([
      'oooooooo...o',
      'oooooooo.ooo',
      'oooooooooooo',
      'ooooooooooo.',
      'oooooooo....',
      'oooooooo....',
      'oo@ooooo....',
      'oooooooo....',
    ]);
  });

  test("the save's door decides: open shows the room; closed and locked hide it", () => {
    const locked = BACK_ROOM({ locked: true, key: 'brass key' });
    const backRoom = (states) => Boolean(sight.inSight(locked, sq(6, 3), states)['10,3']);
    expect(backRoom()).toBe(false);
    expect(backRoom({ 'back-door': 'locked' })).toBe(false);
    expect(backRoom({ 'back-door': 'closed' })).toBe(false); // picked, still shut
    expect(backRoom({ 'back-door': 'open' })).toBe(true);
  });

  test('a solid pillar is seen, and hides a shadow behind it', () => {
    const map = {
      width: 12,
      height: 8,
      obstacles: [{ id: 'pillar', name: 'a pillar', kind: 'solid', x: 5, y: 4 }],
    };
    expect(picture(map, sq(2, 4))).toEqual([
      'oooooooooooo',
      'oooooooooooo',
      'oooooooooooo',
      'oooooooooo..',
      'oo@ooo......',
      'oooooooooo..',
      'oooooooooooo',
      'oooooooooooo',
    ]);
  });

  test('low obstacles and difficult ground hide nothing', () => {
    const map = {
      width: 12,
      height: 8,
      obstacles: [
        { id: 'bar', name: 'the bar', kind: 'low', x: 3, y: 2, w: 3, h: 4 },
        { id: 'rubble', name: 'rubble', kind: 'difficult', x: 7, y: 0, w: 2, h: 8 },
      ],
    };
    expect(Object.keys(sight.inSight(map, sq(1, 4)))).toHaveLength(96);
  });

  test("around a wall's end you see out at an angle; a line only grazing it sees nothing", () => {
    const map = { width: 12, height: 8, walls: [run(sq(0, 4), sq(6, 4))] };
    // (6, 0) lies only along the line from your centre through the wall's end
    // at (6, 4); (7, 0) is seen past it.
    expect(picture(map, sq(5, 5))).toEqual([
      '.......ooooo',
      '......oooooo',
      '......oooooo',
      '......oooooo',
      'oooooooooooo',
      'ooooo@oooooo',
      'oooooooooooo',
      'oooooooooooo',
    ]);
  });

  test('nothing is seen through the point where two walls meet', () => {
    // A corner room, x ≥ 6 and y < 4; the line from (2, 7) through its corner
    // at (6, 4) runs straight through the middle of (6, 3), (7, 2) and on.
    const map = {
      width: 12,
      height: 8,
      walls: [run(sq(6, 0), sq(6, 4)), run(sq(6, 4), sq(12, 4))],
    };
    expect(picture(map, sq(2, 7))).toEqual([
      'oooooo......',
      'oooooo......',
      'oooooo......',
      'oooooo......',
      'oooooooooooo',
      'oooooooooooo',
      'oooooooooooo',
      'oo@ooooooooo',
    ]);
  });

  test('nor between solid squares that touch at a corner', () => {
    // A slanting line of pillars, each touching the next at a corner, seals
    // off the top left.
    const map = {
      width: 10,
      height: 10,
      obstacles: [0, 1, 2, 3, 4, 5, 6].map((k) => ({
        id: 'pillar-' + k,
        name: 'a pillar',
        kind: 'solid',
        x: k,
        y: 6 - k,
      })),
    };
    expect(picture(map, sq(8, 6))).toEqual([
      '......oooo',
      '.....ooooo',
      '....oooooo',
      '...ooooooo',
      '..oooooooo',
      '.ooooooooo',
      'oooooooo@o',
      'oooooooooo',
      'oooooooooo',
      'oooooooooo',
    ]);
  });

  test('your own square is always in sight, even walled in; off the grid sees nothing', () => {
    const box = {
      width: 6,
      height: 6,
      walls: [
        {
          points: [sq(2, 2), sq(3, 2), sq(3, 3), sq(2, 3), sq(2, 2)],
        },
      ],
    };
    expect(sight.inSight(box, sq(2, 2))).toEqual({ '2,2': true });
    expect(sight.inSight(box, sq(-1, 2))).toEqual({});
    expect(sight.inSight(box, sq(6, 0))).toEqual({});
    expect(sight.inSight(box, null)).toEqual({});
  });
});

// ── Against a plain ray caster ───────────────────────

// A small seeded generator (mulberry32), so the random maps are the same on
// every run.
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A random map of 6–12 squares a side: straight wall runs, doors in random
// states, and solid, low and difficult squares; and the squares to stand on.
function randomMap(random) {
  const int = (n) => Math.floor(random() * n);
  const width = 6 + int(7);
  const height = 6 + int(7);
  const map = { width, height, walls: [], doors: [], obstacles: [] };
  const states = {};
  for (let k = int(6); k > 0; k--) {
    const from = sq(int(width), int(height));
    const length = 1 + int(5);
    map.walls.push(
      random() < 0.5
        ? run(from, sq(Math.min(width, from.x + length), from.y))
        : run(from, sq(from.x, Math.min(height, from.y + length)))
    );
  }
  for (let k = int(4); k > 0; k--) {
    const from = sq(int(width), int(height));
    const id = 'door-' + k;
    map.doors.push({
      id,
      from,
      to: random() < 0.5 ? sq(from.x + 1, from.y) : sq(from.x, from.y + 1),
    });
    states[id] = ['open', 'closed', 'locked'][int(3)];
  }
  const taken = {};
  for (let k = int(10); k > 0; k--) {
    const at = sq(int(width), int(height));
    if (taken[at.x + ',' + at.y]) continue;
    taken[at.x + ',' + at.y] = true;
    map.obstacles.push({
      id: 'o-' + k,
      kind: ['solid', 'solid', 'low', 'difficult'][int(4)],
      ...at,
    });
  }
  const stands = [];
  for (let k = 0; k < 3; k++) {
    const at = sq(int(width), int(height));
    if (!taken[at.x + ',' + at.y]) stands.push(at);
  }
  return { map, states, stands };
}

describe('against a plain ray caster', () => {
  test('agrees, square for square, on 80 random maps', () => {
    const random = seeded(631);
    const disagreements = [];
    let squares = 0;
    for (let m = 0; m < 80; m++) {
      const { map, states, stands } = randomMap(random);
      stands.forEach((from) => {
        const seen = sight.inSight(map, from, states);
        for (let x = 0; x < map.width; x++) {
          for (let y = 0; y < map.height; y++) {
            squares++;
            const fast = Boolean(seen[x + ',' + y]);
            // A square seen only through a narrow gap needs more lines to be
            // found; ask again before calling it hidden.
            const slow =
              reference.sees(map, from, sq(x, y), states) ||
              (fast && reference.sees(map, from, sq(x, y), states, 4000));
            if (fast !== slow) disagreements.push({ map, states, from, square: sq(x, y), fast });
          }
        }
      });
    }
    expect(squares).toBeGreaterThan(10000);
    expect(disagreements.slice(0, 3)).toEqual([]);
  });
});

// ── Speed ────────────────────────────────────────────

describe('on a 64 × 64 map, every step', () => {
  const open = { width: 64, height: 64 };
  // A hall of pillars, every third square each way.
  const hall = { width: 64, height: 64, obstacles: [] };
  for (let x = 1; x < 64; x += 3) {
    for (let y = 1; y < 64; y += 3) {
      hall.obstacles.push({ id: `pillar-${x}-${y}`, name: 'a pillar', kind: 'solid', x, y });
    }
  }
  // Rooms of 8 × 8, each wall with a door in it, all open.
  const rooms = { width: 64, height: 64, walls: [], doors: [] };
  const states = {};
  for (let k = 8; k < 64; k += 8) {
    for (let s = 0; s < 64; s += 8) {
      rooms.walls.push(
        run(sq(k, s), sq(k, s + 3)),
        run(sq(k, s + 4), sq(k, s + 8)),
        run(sq(s, k), sq(s + 3, k)),
        run(sq(s + 4, k), sq(s + 8, k))
      );
      rooms.doors.push(
        { id: `east-${k}-${s}`, from: sq(k, s + 3), to: sq(k, s + 4) },
        { id: `south-${k}-${s}`, from: sq(s + 3, k), to: sq(s + 4, k) }
      );
      states[`east-${k}-${s}`] = 'open';
      states[`south-${k}-${s}`] = 'open';
    }
  }

  test.each([
    ['open ground', open, undefined],
    ['a hall of pillars', hall, undefined],
    ['rooms with their doors open', rooms, states],
  ])('%s: well within 25 ms a look', (name, map, doorStates) => {
    const stands = [sq(0, 0), sq(32, 32), sq(5, 60), sq(63, 20)];
    stands.forEach((from) => sight.inSight(map, from, doorStates)); // warm up
    const started = process.hrtime.bigint();
    const looks = 40;
    for (let n = 0; n < looks; n++) sight.inSight(map, stands[n % stands.length], doorStates);
    const each = Number(process.hrtime.bigint() - started) / 1e6 / looks;
    expect(each).toBeLessThan(25);
  });
});
