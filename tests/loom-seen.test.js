'use strict';

/**
 * What a save has seen on a battle map (functions/loom-turn/seen.js; planning/
 * the-loom-movement-and-vision.md §5; L-632 / #455): squares packed one bit
 * each, a record that only grows, and what a save sees from where it stands
 * and on the way there; and what of a map the grid view is sent (functions/
 * loom-turn/map-view.js battleView; L-633 / #456): only what has been seen.
 * Pure; the emulator suite (loom-battle-maps) plays it through loomPlayTurn
 * and loomGetMap.
 *
 * Run: cd tests && npx jest loom-seen --verbose
 */

const { pack, unpack, squaresOf, inSightNow, withSquares } = require('../functions/loom-turn/seen');
const { battleView } = require('../functions/loom-turn/map-view');

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

  test('a redrawn map is forgotten: an older revision counts as nothing seen (L-641)', () => {
    const record = withSquares(null, map, keys([0, 0], [3, 2]));
    expect(squaresOf(record, map)).toEqual(keys([0, 0], [3, 2]));
    const redrawn = { ...map, revision: 1 };
    expect(squaresOf(record, redrawn)).toEqual({});
    expect(squaresOf(null, redrawn)).toEqual({});
    // The next look starts over, and is written even with nothing new in it.
    const fresh = withSquares(record, redrawn, keys([0, 0]));
    expect(fresh).toMatchObject({ revision: 1 });
    expect(unpack(fresh.squares, 4, 3)).toEqual(keys([0, 0]));
    expect(squaresOf(fresh, redrawn)).toEqual(keys([0, 0]));
    expect(withSquares(fresh, redrawn, keys([0, 0]))).toBeNull();
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

describe('what the grid view is sent (L-633)', () => {
  // A ruin of two halves, the east (x ≥ 4) walled off from the west with no
  // way through. The save stands at (2, 1) in the west; once, it saw (6, 0)
  // in the east (its record says so).
  const sq = (x, y) => ({ x, y });
  const RUIN = {
    id: 'bm_ruin',
    name: 'The ruin',
    width: 8,
    height: 4,
    image: null,
    entries: [
      { id: 'gate', x: 0, y: 1 },
      { id: 'back', x: 7, y: 1 },
    ],
    exits: [
      { id: 'gate', name: 'the gate', x: 0, y: 2, to: 'out' },
      { id: 'crack', name: 'a crack', x: 7, y: 3, to: 'out' },
    ],
    features: [
      { id: 'altar', name: 'the altar', x: 2, y: 0 },
      { id: 'urn', name: 'the urn', x: 6, y: 0 },
    ],
    walls: [
      { points: [sq(4, 0), sq(4, 4)] }, // between the halves
      { points: [sq(5, 2), sq(8, 2)] }, // in the east
      { points: [sq(0, 4), sq(8, 4)] }, // along the south edge, both halves
    ],
    doors: [
      { id: 'trap', name: 'the trapdoor', from: sq(6, 1), to: sq(7, 1) }, // below (6, 0)
      { id: 'cell', name: 'the cell door', from: sq(5, 2), to: sq(5, 3) }, // in the east
    ],
    obstacles: [
      { id: 'table', name: 'a table', kind: 'low', x: 0, y: 0, w: 2 },
      { id: 'rubble', name: 'rubble', kind: 'difficult', x: 2, y: 3, w: 4 }, // both halves
    ],
  };
  const world = {
    locations: { loc_9: { id: 'loc_9', name: 'The ruin', battleMap: { mapId: 'bm_ruin' } } },
    places: {},
    battleMaps: { bm_ruin: RUIN },
    characters: {
      chr_hermit: { id: 'chr_hermit', name: 'The hermit', locationId: 'loc_9' },
      chr_guard: { id: 'chr_guard', name: 'A guard', locationId: 'loc_9', cell: sq(1, 1) },
      chr_thief: { id: 'chr_thief', name: 'A thief', locationId: 'loc_9', cell: sq(6, 1) },
      chr_ghost: { id: 'chr_ghost', name: 'A ghost', locationId: 'loc_9', cell: sq(6, 0) },
    },
  };
  const save = { location: 'loc_9', placeId: null, mapId: 'bm_ruin', cell: sq(2, 1) };
  const record = withSquares(null, RUIN, keys([6, 0]));
  const view = battleView(world, save, record);

  test('entries, exits and features only on squares seen, then or now', () => {
    expect(view.entries).toEqual([{ id: 'gate', x: 0, y: 1 }]);
    expect(view.exits.map((e) => e.id)).toEqual(['gate']);
    expect(view.features.map((f) => f.id)).toEqual(['altar', 'urn']);
  });

  test('walls only along the sides of squares seen, cut where they pass out of it', () => {
    expect(view.walls).toEqual([
      { points: [sq(4, 0), sq(4, 4)] },
      { points: [sq(0, 4), sq(4, 4)] },
    ]);
  });

  test('a wall cut in the middle is sent as its runs, each running its way', () => {
    // A wall drawn east to west along the north edge: the west half is in
    // sight, and of the east only (6, 0) and (7, 0) were seen.
    const map = { ...RUIN, walls: [RUIN.walls[0], { points: [sq(8, 0), sq(0, 0)] }] };
    const seenEast = withSquares(null, map, keys([6, 0], [7, 0]));
    const ends = battleView({ ...world, battleMaps: { bm_ruin: map } }, save, seenEast);
    expect(ends.walls).toEqual([
      RUIN.walls[0],
      { points: [sq(8, 0), sq(6, 0)] },
      { points: [sq(4, 0), sq(0, 0)] },
    ]);
  });

  test("doors beside a square seen, in the save's state", () => {
    expect(view.doors).toEqual([
      { id: 'trap', name: 'the trapdoor', from: sq(6, 1), to: sq(7, 1), state: 'closed' },
    ]);
    const opened = battleView(world, { ...save, doors: { bm_ruin: { trap: 'open' } } }, record);
    expect(opened.doors[0].state).toBe('open');
  });

  test('obstacles cut down to the squares seen; whole where all of it is', () => {
    expect(view.obstacles).toEqual([
      { id: 'table', name: 'a table', kind: 'low', x: 0, y: 0, w: 2, h: 1 },
      { id: 'rubble', name: 'rubble', kind: 'difficult', x: 2, y: 3, w: 2, h: 1 },
    ]);
  });

  test('people on a square only while it is in sight; those with none, listed', () => {
    expect(view.people).toEqual([
      { id: 'chr_hermit', name: 'The hermit' },
      { id: 'chr_guard', name: 'A guard' },
    ]);
  });

  test('the fog: the squares seen, and those in sight now', () => {
    const seen = unpack(view.fog.seen, 8, 4);
    const inSight = unpack(view.fog.inSight, 8, 4);
    expect(Object.keys(inSight)).toHaveLength(16); // the west half
    expect(inSight['3,3']).toBe(true);
    expect(inSight['4,0']).toBeUndefined();
    expect(Object.keys(seen).sort()).toEqual(Object.keys({ ...inSight, '6,0': true }).sort());
  });

  test('with no record yet, what is in sight is what has been seen', () => {
    const fresh = battleView(world, save, null);
    expect(fresh.fog.seen).toBe(fresh.fog.inSight);
    expect(fresh.features.map((f) => f.id)).toEqual(['altar']);
    expect(fresh.doors).toEqual([]);
  });

  test('the art is sent whole, under the fog', () => {
    const art = { path: 'worlds/w/maps/bm_ruin.png', width: 800, height: 400 };
    const withArt = { ...RUIN, image: art };
    expect(battleView({ ...world, battleMaps: { bm_ruin: withArt } }, save, record).image).toEqual(
      art
    );
  });
});
