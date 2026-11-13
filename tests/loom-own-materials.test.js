'use strict';

/**
 * A world's own ground (planning/worlds-without-azgaar.md §4.3, R2; L-713 /
 * #818), with no database: the checks on `world.materials`, a ground item
 * accepting a world's id, the flags it takes from the material it is like
 * (water), and the art it is drawn with (its own, else its `like`'s).
 */

const catalog = require('../functions/loom-canon/materials');
const geo = require('../functions/loom-canon/map-geometry');
const patcher = require('../functions/loom-canon/geometry-patch');
const look = require('../functions/loom-canon/look');

const art = { imageId: 'img_0123456789abcdef', link: 'https://images.example/ash' };
const own = [
  { id: 'ashwaste', name: 'Ashwaste', like: 'desert', art },
  { id: 'black-sea', name: 'Black sea', like: 'ocean' },
];
const rect = { rect: { x: 0, y: 0, w: 50, h: 50 } };
const bounds = { width: 100, height: 100 };

describe('checkOwn', () => {
  test('accepts a sound list, or none', () => {
    expect(catalog.checkOwn(own)).toEqual([]);
    expect(catalog.checkOwn(undefined)).toEqual([]);
    expect(catalog.checkOwn([])).toEqual([]);
  });

  test('refuses an id that clashes with a built-in ground, with its reason', () => {
    const problems = catalog.checkOwn([{ id: 'desert', name: 'Desert', like: 'sand' }]);
    expect(problems.join(' ')).toMatch(/"desert" clashes with the built-in ground/);
  });

  test('refuses a like that is no ground material (a wall, a line, nothing)', () => {
    expect(catalog.checkOwn([{ id: 'wallish', name: 'W', like: 'brick' }]).join(' ')).toMatch(
      /behaves like "brick", which is no built-in ground material/
    );
    expect(catalog.checkOwn([{ id: 'riverish', name: 'R', like: 'river' }]).join(' ')).toMatch(
      /no built-in ground/
    );
    expect(catalog.checkOwn([{ id: 'nothing', name: 'N' }]).join(' ')).toMatch(/no built-in/);
  });

  test('refuses a bad id, a missing name, a duplicate and a list that is not a list', () => {
    expect(catalog.checkOwn([{ id: 'Ash Waste', name: 'A', like: 'sand' }]).join(' ')).toMatch(
      /lower-case letters/
    );
    expect(catalog.checkOwn([{ id: 'ash', like: 'sand' }]).join(' ')).toMatch(/needs a name/);
    expect(
      catalog.checkOwn([
        { id: 'ash', name: 'A', like: 'sand' },
        { id: 'ash', name: 'B', like: 'sand' },
      ])
    ).toContain('Material "ash" is listed twice.');
    expect(catalog.checkOwn({})).toEqual(['A world’s materials are a list.']);
  });
});

describe('a ground item using a world’s material', () => {
  const ground = (material, extra = {}) =>
    geo.normalize({ ground: [{ id: 'g1', material, shape: rect, ...extra }] });

  test('is accepted with the world’s materials, and refused as unknown without', () => {
    expect(geo.check(ground('ashwaste'), bounds, own)).toEqual([]);
    const without = geo.check(ground('ashwaste'), bounds);
    expect(without.join(' ')).toMatch(/unknown material "ashwaste"/);
    // The refusal names the world’s own ids with the built-in ones.
    expect(geo.check(ground('nope'), bounds, own).join(' ')).toMatch(/ashwaste, black-sea\./);
  });

  test('takes its flags from the material it is like: water takes a depth', () => {
    expect(geo.check(ground('black-sea', { depth: 10 }), bounds, own)).toEqual([]);
    expect(geo.check(ground('ashwaste', { depth: 10 }), bounds, own).join(' ')).toMatch(
      /has a depth but isn’t water/
    );
  });

  test('is only for ground: a wall can’t be made of it', () => {
    const wall = geo.normalize({
      walls: [
        {
          id: 'w',
          material: 'ashwaste',
          points: [
            [0, 0],
            [10, 0],
          ],
        },
      ],
    });
    expect(geo.check(wall, bounds, own).join(' ')).toMatch(/walls.w has an unknown material/);
  });

  test('a patch is checked with them', () => {
    const done = patcher.patch(
      {},
      'ground',
      { set: [{ id: 'waste', material: 'ashwaste', shape: rect }] },
      bounds,
      own
    );
    expect(done.problems).toBeUndefined();
    expect(done.added).toEqual(['waste']);
    const refused = patcher.patch(
      {},
      'ground',
      { set: [{ id: 'waste', material: 'ashwaste', shape: rect }] },
      bounds
    );
    expect(refused.problems.join(' ')).toMatch(/unknown material "ashwaste"/);
  });
});

describe('materialOf and materialArt', () => {
  test('materialOf gives the world’s material with its like’s flags, or null', () => {
    expect(catalog.materialOf('ground', 'black-sea', own)).toMatchObject({
      id: 'black-sea',
      name: 'Black sea',
      like: 'ocean',
      water: true,
      own: true,
    });
    expect(catalog.materialOf('ground', 'ashwaste')).toBeNull();
    expect(catalog.materialOf('wall', 'ashwaste', own)).toBeNull();
    expect(catalog.materialOf('ground', 'desert', own).own).toBeUndefined();
  });

  test('is drawn with its own art, else as the material it is like', () => {
    expect(catalog.materialArt('ground', 'ashwaste', null, own)).toEqual({
      from: 'world',
      picture: { url: art.link },
      span: 1,
      variants: [],
    });
    // No art of its own: its like’s (the built-in desert).
    const plain = catalog.materialArt('ground', 'black-sea', null, own);
    expect(plain).toEqual(catalog.materialArt('ground', 'ocean', null));
    expect(plain.from).toBe('catalog');
  });
});

describe('the look grading', () => {
  test('reads a world’s own ground: its art, else its like’s (painted in the classic set)', () => {
    const world = { materials: own, objectKinds: {} };
    const map = {
      geometry: geo.normalize({
        ground: [
          { id: 'a', material: 'ashwaste', shape: rect },
          { id: 'b', material: 'black-sea', shape: rect },
        ],
      }),
    };
    expect(look.unpainted(world, map)).toMatchObject({ total: 2, painted: 2, materials: [] });
  });
});
