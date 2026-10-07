'use strict';

/**
 * What a save has seen on a battle map (functions/loom-turn/seen.js; planning/
 * the-loom-movement-and-vision.md §5; L-632 / #455): squares packed one bit
 * each, a record that only grows, and what a save sees from where it stands
 * and on the way there. Pure; the emulator suite (loom-battle-maps) plays it
 * through loomPlayTurn.
 *
 * Run: cd tests && npx jest loom-seen --verbose
 */

const { pack, unpack, inSightNow, withSquares } = require('../functions/loom-turn/seen');

const keys = (...squares) => Object.fromEntries(squares.map(([x, y]) => [x + ',' + y, true]));

describe('packing squares', () => {
  test('one bit a square, lowest first: square (x, y) is bit y × width + x', () => {
    // (0, 0) is bit 0, (2, 0) bit 2, (1, 1) bit 4: 0b10101 in the first byte.
    const packed = pack(keys([0, 0], [2, 0], [1, 1]), 3, 3);
    expect(Buffer.from(packed, 'base64')).toEqual(Buffer.from([0b10101, 0]));
    expect(unpack(packed, 3, 3)).toEqual(keys([0, 0], [2, 0], [1, 1]));
  });

  test('a 64 × 64 map packs into 684 characters, and back', () => {
    const all = {};
    for (let x = 0; x < 64; x++) for (let y = 0; y < 64; y++) all[x + ',' + y] = true;
    const packed = pack(all, 64, 64);
    expect(packed).toHaveLength(684);
    expect(unpack(packed, 64, 64)).toEqual(all);
  });

  test('squares off the grid are left out; nothing unpacks to nothing', () => {
    expect(unpack(pack(keys([3, 0], [0, -1], [1, 1]), 3, 3), 3, 3)).toEqual(keys([1, 1]));
    expect(unpack('', 3, 3)).toEqual({});
    expect(unpack(undefined, 3, 3)).toEqual({});
  });
});

describe('the record', () => {
  const map = { id: 'bm_room', width: 4, height: 3 };

  test('a first record holds what was seen', () => {
    const record = withSquares(null, map, keys([0, 0], [3, 2]));
    expect(record).toEqual({
      mapId: 'bm_room',
      width: 4,
      height: 3,
      squares: pack(keys([0, 0], [3, 2]), 4, 3),
    });
  });

  test('it only grows; nothing new, nothing to write', () => {
    const record = withSquares(null, map, keys([0, 0], [1, 0]));
    const grown = withSquares(record, map, keys([1, 0], [2, 2]));
    expect(unpack(grown.squares, 4, 3)).toEqual(keys([0, 0], [1, 0], [2, 2]));
    expect(withSquares(grown, map, keys([0, 0], [2, 2]))).toBeNull();
  });

  test('a map whose grid changed size keeps the squares still on it', () => {
    const record = withSquares(null, map, keys([0, 0], [3, 2]));
    const smaller = { ...map, width: 3 };
    const repacked = withSquares(record, smaller, keys([0, 0]));
    expect(repacked).toMatchObject({ width: 3, height: 3 });
    expect(unpack(repacked.squares, 3, 3)).toEqual(keys([0, 0]));
  });
});

describe('what a save sees now', () => {
  // A room and a closet east of a wall at x = 3, through a door in its gap
  // at y 1–2.
  const ROOM = {
    id: 'bm_room',
    width: 6,
    height: 4,
    entries: [{ id: 'in', x: 0, y: 1 }],
    exits: [{ id: 'out', name: 'the way out', x: 0, y: 0, to: 'out' }],
    walls: [
      {
        points: [
          { x: 3, y: 0 },
          { x: 3, y: 1 },
        ],
      },
      {
        points: [
          { x: 3, y: 2 },
          { x: 3, y: 4 },
        ],
      },
    ],
    doors: [{ id: 'closet', name: 'the closet door', from: { x: 3, y: 1 }, to: { x: 3, y: 2 } }],
  };
  const world = { battleMaps: { bm_room: ROOM } };
  const save = (cell, doors) => ({ mapId: 'bm_room', cell, doors: doors && { bm_room: doors } });
  const closet = (squares) => Object.keys(squares).filter((key) => Number(key.split(',')[0]) >= 3);

  test('off a map, nothing', () => {
    expect(inSightNow(world, { mapId: null, cell: null })).toEqual({ map: null, squares: {} });
  });

  test("from where it stands, for the save's doors", () => {
    expect(closet(inSightNow(world, save({ x: 2, y: 1 })).squares)).toEqual([]);
    expect(closet(inSightNow(world, save({ x: 2, y: 1 }, { closet: 'open' })).squares)).toContain(
      '5,1'
    );
  });

  test('and from the squares walked through, with the doors as they were', () => {
    const now = save({ x: 2, y: 3 }, { closet: 'open' });
    const walked = [
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 2, y: 3 },
    ];
    // As they were: shut on the way, so only what (2, 3) sees through it.
    const shut = inSightNow(world, now, walked, {}).squares;
    expect(shut['5,1']).toBeUndefined();
    // Had it been open on the way, (2, 1) would have seen straight through.
    expect(inSightNow(world, now, walked, { closet: 'open' }).squares['5,1']).toBe(true);
  });
});
