'use strict';

/**
 * Patching a map's geometry by id (planning/maps-from-data.md §4.8; L-929 /
 * #733), pure (functions/loom-canon/geometry-patch.js): what a patch changes,
 * adds, removes and refuses, on a crypt's geometry.
 *
 * Run: cd tests && npx jest loom-geometry-patch --verbose
 */

const geo = require('../functions/loom-canon/map-geometry');
const { patch, patchPoints } = require('../functions/loom-canon/geometry-patch');

const BOUNDS = { width: 60, height: 40 };
const crypt = () =>
  geo.normalize({
    ground: [{ id: 'floor', material: 'stone', shape: { rect: { x: 0, y: 0, w: 60, h: 40 } } }],
    walls: [
      {
        id: 'divide',
        material: 'stone',
        points: [
          [30, 0],
          [30, 40],
        ],
        height: 9,
      },
      {
        id: 'south',
        material: 'stone',
        points: [
          [0, 40],
          [60, 40],
        ],
      },
    ],
    doors: [{ id: 'gate', material: 'wood', from: [30, 15], to: [30, 20], wall: 'divide' }],
    objects: [{ id: 'chest', kind: 'chest', at: [10, 10], size: [3, 2] }],
    hidden: [{ id: 'gate', dc: 12 }],
  });

describe('a patch of one list', () => {
  test('changes only the fields given; null takes one away', () => {
    const moved = patch(crypt(), 'walls', { set: [{ id: 'divide', material: 'brick' }] }, BOUNDS);
    expect(moved).toMatchObject({ added: [], changed: ['divide'], removed: [] });
    expect(moved.geometry.walls[0]).toEqual({
      id: 'divide',
      material: 'brick',
      points: 'M30 0L30 40',
      height: 9,
    });
    const bare = patch(moved.geometry, 'walls', { set: [{ id: 'divide', height: null }] }, BOUNDS);
    expect(bare.geometry.walls[0].height).toBeUndefined();
    // The rest of the geometry is as it was; the first is not changed in place.
    expect(bare.geometry.doors).toEqual(crypt().doors);
    expect(crypt().walls[0].height).toBe(9);
  });

  test('adds what is new, whole, and gives an id to what has none', () => {
    const done = patch(
      crypt(),
      'walls',
      {
        set: [
          {
            material: 'stone',
            points: [
              [0, 5],
              [10, 5],
            ],
          },
          {
            id: 'north',
            material: 'stone',
            points: [
              [0, 0],
              [60, 0],
            ],
          },
          {
            material: 'stone',
            points: [
              [0, 6],
              [10, 6],
            ],
          },
        ],
      },
      BOUNDS
    );
    expect(done.added).toEqual(['wall-1', 'north', 'wall-2']);
    expect(done.geometry.walls.map((w) => w.id)).toEqual([
      'divide',
      'south',
      'wall-1',
      'north',
      'wall-2',
    ]);
  });

  test('removes by id, and a thing taken away is no longer hidden', () => {
    const done = patch(crypt(), 'doors', { remove: ['gate'] }, BOUNDS);
    expect(done).toMatchObject({ removed: ['gate'], unhidden: ['gate'] });
    expect(done.geometry.doors).toBeUndefined();
    expect(done.geometry.hidden).toBeUndefined();
    // The last of a list leaves the list out, as normalize does.
    expect(Object.keys(done.geometry)).toEqual(['ground', 'walls', 'objects']);
  });

  test('hidden is patched like the rest: { id, dc }', () => {
    const done = patch(
      crypt(),
      'hidden',
      { set: [{ id: 'gate', dc: 'Hard' }, { id: 'chest' }] },
      BOUNDS
    );
    expect(done.geometry.hidden).toEqual([{ id: 'gate', dc: 'Hard' }, { id: 'chest' }]);
    expect(done.changed).toEqual(['gate']);
    expect(done.added).toEqual(['chest']);
    expect(patch(crypt(), 'hidden', { remove: ['gate'] }, BOUNDS).geometry.hidden).toBeUndefined();
  });
});

describe('a patch refused', () => {
  const problems = (list, change) => patch(crypt(), list, change, BOUNDS).problems;

  test('names what is wrong, and returns nothing changed', () => {
    const refused = patch(
      crypt(),
      'walls',
      {
        set: [
          {
            id: 'bad',
            material: 'zzz',
            points: [
              [0, 0],
              [99, 0],
            ],
          },
        ],
      },
      BOUNDS
    );
    expect(refused.geometry).toBeUndefined();
    expect(refused.problems.join(' ')).toMatch(/walls\.bad has an unknown material "zzz"/);
    expect(refused.problems.join(' ')).toMatch(/runs outside the map \(99, 0\)/);
  });

  test('an id belongs to one shape across the map', () => {
    expect(
      problems('walls', {
        set: [
          {
            id: 'chest',
            material: 'stone',
            points: [
              [0, 1],
              [5, 1],
            ],
          },
        ],
      })
    ).toEqual([
      '"chest" is already an object: ids are unique across a map\'s shapes, so name this one differently.',
    ]);
    expect(problems('objects', { set: [{ id: 'gate' }] })[0]).toMatch(/"gate" is already a door/);
  });

  test('removing what is not there, and setting and removing one id', () => {
    expect(problems('walls', { remove: ['ghost'] })).toEqual([
      "\"ghost\" isn't one of the map's walls, so it can't be removed.",
    ]);
    expect(problems('walls', { set: [{ id: 'south' }, { id: 'south' }] })).toEqual([
      '"south" is set twice.',
    ]);
    expect(problems('walls', { set: [{ id: 'south' }], remove: ['south'] })).toEqual([
      '"south" is both set and removed.',
    ]);
  });

  test('a wall can’t go while the door in it does', () => {
    expect(problems('walls', { remove: ['divide'] }).join(' ')).toMatch(/gate/);
  });

  test('only what the patch makes wrong is reported: an old fault doesn’t block an edit', () => {
    const faulty = crypt();
    faulty.hidden.push({ id: 'ghost' });
    expect(geo.check(faulty, BOUNDS).join(' ')).toMatch(/hidden names "ghost"/);
    const done = patch(faulty, 'walls', { set: [{ id: 'south', height: 3 }] }, BOUNDS);
    expect(done.problems).toBeUndefined();
    expect(done.geometry.walls[1].height).toBe(3);
    // What the patch adds to it is reported.
    expect(
      patch(
        faulty,
        'walls',
        {
          set: [
            {
              id: 'x',
              material: 'zzz',
              points: [
                [0, 1],
                [5, 1],
              ],
            },
          ],
        },
        BOUNDS
      ).problems
    ).toHaveLength(1);
  });

  test('an unknown list', () => {
    expect(patch(crypt(), 'floors', { set: [] }, BOUNDS).problems).toEqual([
      '"floors" is no part of a map\'s geometry.',
    ]);
  });
});

describe('patching a grid’s features, entries and exits', () => {
  const exits = [{ id: 'out', name: 'the stair', x: 0, y: 4, to: 'out' }];

  test('changes the fields given, adds whole, removes by id', () => {
    const done = patchPoints(
      exits,
      {
        set: [
          { id: 'out', y: 5 },
          { id: 'up', name: 'up', x: 11, y: 0, to: 'out' },
        ],
      },
      'exit'
    );
    expect(done.changed).toEqual(['out']);
    expect(done.added).toEqual(['up']);
    expect(done.items[0]).toEqual({ id: 'out', name: 'the stair', x: 0, y: 5, to: 'out' });
    expect(patchPoints(done.items, { remove: ['up'] }, 'exit').items).toEqual([done.items[0]]);
  });

  test('a new one needs an id; the rest are the same as for shapes', () => {
    expect(patchPoints(exits, { set: [{ name: 'no id' }] }, 'exit').problems[0]).toMatch(
      /A exit to add needs an id/
    );
    expect(patchPoints(exits, { remove: ['ghost'] }, 'exit').problems).toEqual([
      "\"ghost\" isn't one of the map's exits, so it can't be removed.",
    ]);
  });
});
