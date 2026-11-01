'use strict';

/**
 * Map levels to any depth: the model (planning/map-levels.md §4.1, §4.2;
 * L-901 / #719), pure: a world of maps inside maps (a galaxy holding two
 * star systems, one holding a planet's port, the port holding a station's
 * deck); a place's map, the parent chain three deep, the path to a place,
 * the lowest map holding two places under different parents, a map's
 * children, the tree; maps, places and a save's path checked, one refused
 * for a step not on its parent's map; discovered places by map.
 *
 * Run: cd tests && npx jest loom-levels.test --verbose
 */

const levels = require('../functions/loom-canon/levels');
const { validateSave, makeSave } = require('../functions/loom-models');

const map = (kind, parent, space, extra = {}) => ({
  kind,
  parent,
  name: extra.name || 'a map',
  space,
  ...extra,
});
const place = (mapId, at, extra = {}) => ({ mapId, at, name: extra.name || 'a place', ...extra });

// galaxy (region)
//   vega ──opens──▶ vega-system (region)
//                     vega-iii ──opens──▶ port-ellis (area)
//                                           dock ──opens──▶ deck (grid)
//                                                            airlock (a square)
//                     vega-iv (no map below, MP6)
//   sol ───opens──▶ sol-system (region)
//                     earth
const WORLD = {
  topMapId: 'galaxy',
  maps: {
    galaxy: map(
      'region',
      null,
      { width: 1000, height: 1000, distance: { unit: 'ly', perUnit: 1 } },
      { name: 'The Andor sector' }
    ),
    'vega-system': map(
      'region',
      { mapId: 'galaxy', placeId: 'vega' },
      { width: 100, height: 100, distance: { unit: 'AU', perUnit: 0.1 } },
      { name: 'Vega' }
    ),
    'sol-system': map(
      'region',
      { mapId: 'galaxy', placeId: 'sol' },
      { width: 100, height: 100 },
      { name: 'Sol' }
    ),
    'port-ellis': map(
      'area',
      { mapId: 'vega-system', placeId: 'vega-iii' },
      { width: 1000, height: 1000, size: 800 },
      { name: 'Port Ellis' }
    ),
    deck: map(
      'grid',
      { mapId: 'port-ellis', placeId: 'dock' },
      { width: 20, height: 12, squareSize: 1.5 },
      { name: 'The station deck' }
    ),
    lost: map(
      'area',
      { mapId: 'nowhere', placeId: 'x' },
      { width: 10, height: 10 },
      { name: 'A lost map' }
    ),
  },
  places: {
    vega: place('galaxy', { x: 400, y: 300 }, { opens: { mapId: 'vega-system' } }),
    sol: place('galaxy', { x: 600, y: 700 }, { opens: { mapId: 'sol-system' } }),
    'vega-iii': place('vega-system', { x: 30, y: 40 }, { opens: { mapId: 'port-ellis' } }),
    'vega-iv': place('vega-system', { x: 60, y: 10 }),
    dock: place('port-ellis', { x: 500, y: 500 }, { opens: { mapId: 'deck' } }),
    airlock: place(
      'deck',
      { x: 3, y: 4 },
      { exits: [{ placeId: 'earth', seconds: 3600, name: 'the jump gate' }] }
    ),
    earth: place('sol-system', { x: 50, y: 50 }),
    // A town place from before the levels model: passed by.
    old_inn: { locationId: 'loc_1', name: 'The old inn', position: { x: 1, y: 1 } },
  },
};

describe('the helpers', () => {
  test('a place’s map, and the map it opens into', () => {
    expect(levels.placeMap(WORLD, 'airlock').name).toBe('The station deck');
    expect(levels.openedBy(WORLD, 'dock').name).toBe('The station deck');
    expect(levels.openedBy(WORLD, 'vega-iv')).toBeNull();
    // A town place from before the model isn't a place in it.
    expect(levels.placeOf(WORLD, 'old_inn')).toBeNull();
    expect(levels.placeMap(WORLD, 'old_inn')).toBeNull();
  });

  test('a parent chain three deep, from the top down', () => {
    expect(levels.parentChain(WORLD, 'deck')).toEqual([
      'galaxy',
      'vega-system',
      'port-ellis',
      'deck',
    ]);
    expect(levels.parentChain(WORLD, 'galaxy')).toEqual(['galaxy']);
    expect(levels.parentChain(WORLD, 'nope')).toEqual([]);
    expect(levels.parentChain(WORLD, 'lost').broken).toBe('missing');
  });

  test('a parent loop is cut, not followed forever', () => {
    const looped = {
      ...WORLD,
      maps: {
        a: map('area', { mapId: 'b', placeId: 'p' }, { width: 1, height: 1 }),
        b: map('area', { mapId: 'a', placeId: 'q' }, { width: 1, height: 1 }),
      },
    };
    expect(levels.parentChain(looped, 'a').broken).toBe('loop');
  });

  test('the path to a place, each step the place that opens the next map', () => {
    expect(levels.pathTo(WORLD, 'airlock')).toEqual([
      { mapId: 'galaxy', placeId: 'vega' },
      { mapId: 'vega-system', placeId: 'vega-iii' },
      { mapId: 'port-ellis', placeId: 'dock' },
      { mapId: 'deck', placeId: 'airlock' },
    ]);
    expect(levels.pathTo(WORLD, 'sol')).toEqual([{ mapId: 'galaxy', placeId: 'sol' }]);
    expect(levels.pathTo(WORLD, 'old_inn')).toBeNull();
  });

  test('the lowest map holding two places (TV2)', () => {
    // Under different parents: only the galaxy holds both.
    expect(levels.lowestCommonMap(WORLD, 'airlock', 'earth')).toBe('galaxy');
    // Under the same system.
    expect(levels.lowestCommonMap(WORLD, 'vega-iv', 'dock')).toBe('vega-system');
    expect(levels.lowestCommonMap(WORLD, 'vega-iii', 'vega-iv')).toBe('vega-system');
    // One place with itself: its own map.
    expect(levels.lowestCommonMap(WORLD, 'airlock', 'airlock')).toBe('deck');
    expect(levels.lowestCommonMap(WORLD, 'airlock', 'old_inn')).toBeNull();
  });

  test('a map’s children, and the places on it', () => {
    expect(levels.childrenOf(WORLD, 'galaxy')).toEqual(['sol-system', 'vega-system']);
    expect(levels.childrenOf(WORLD, 'deck')).toEqual([]);
    expect(levels.placesOn(WORLD, 'vega-system')).toEqual(['vega-iii', 'vega-iv']);
  });

  test('the tree from the top, with maps not reached from it', () => {
    const { top, orphans } = levels.treeOf(WORLD);
    expect(top).toMatchObject({ mapId: 'galaxy', kind: 'region', name: 'The Andor sector' });
    expect(top.children.map((c) => c.mapId)).toEqual(['sol-system', 'vega-system']);
    const deck = top.children[1].children[0].children[0];
    expect(deck).toEqual({ mapId: 'deck', kind: 'grid', name: 'The station deck', children: [] });
    expect(orphans.map((o) => o.mapId)).toEqual(['lost']);
    expect(levels.treeOf({ maps: {}, places: {} })).toEqual({ top: null, orphans: [] });
  });
});

describe('checks', () => {
  test('every map in the world is good; a bad one is refused with reasons', () => {
    for (const [id, m] of Object.entries(WORLD.maps)) expect(levels.validateMap(m, id)).toEqual([]);
    expect(
      levels.validateMap({ kind: 'cave', parent: 'x', space: { width: 0, height: 99 } }, 'm')
    ).toEqual([
      'm.kind must be one of region, area, grid.',
      'm.parent must be { mapId, placeId }, or null for the top map.',
    ]);
    expect(
      levels.validateMap({ kind: 'grid', parent: null, space: { width: 65, height: 2.5 } }, 'g')
    ).toEqual([
      'g.space.width must be a whole number from 1 to 64.',
      'g.space.height must be a whole number from 1 to 64.',
    ]);
    expect(levels.validateMap({ kind: 'region', parent: null }, 'r')).toEqual([
      'r.space is needed: its size.',
    ]);
  });

  test('every place is good; a bad one is refused with reasons', () => {
    for (const [id, p] of Object.entries(WORLD.places)) {
      if (p.mapId) expect(levels.validatePlace(WORLD, p, id)).toEqual([]);
    }
    expect(
      levels.validatePlace(
        WORLD,
        {
          mapId: 'deck',
          at: { x: 20, y: 1 },
          opens: { mapId: 'nope' },
          exits: [{ placeId: 'earth' }],
        },
        'p'
      )
    ).toEqual([
      'p.at must be a square on The station deck.',
      "p.opens must name one of the world's maps ({ mapId } or { template }).",
      'p.exits[0].seconds must be the time it takes, from 0.',
    ]);
    expect(levels.validatePlace(WORLD, { mapId: 'nope' }, 'q')).toEqual([
      'q.mapId "nope" isn\'t one of the world\'s maps.',
    ]);
  });

  test('a save’s path: each step held against canon', () => {
    const good = [
      { mapId: 'galaxy', placeId: 'vega' },
      { mapId: 'vega-system', placeId: 'vega-iii' },
      { mapId: 'port-ellis', placeId: 'dock' },
      { mapId: 'deck', cell: { x: 3, y: 4 } },
    ];
    expect(levels.validateAt(WORLD, good)).toEqual([]);
    expect(levels.mapAt(good)).toBe('deck');
    // Ending at a place, or at a point on an area map.
    expect(levels.validateAt(WORLD, levels.pathTo(WORLD, 'earth'))).toEqual([]);
    expect(
      levels.validateAt(WORLD, [
        ...good.slice(0, 2),
        { mapId: 'port-ellis', point: { x: 120, y: 900 } },
      ])
    ).toEqual([]);
    // Standing at a place with no map below (MP6).
    expect(levels.validateAt(WORLD, levels.pathTo(WORLD, 'vega-iv'))).toEqual([]);
  });

  test('a path with a step not on its parent’s map is refused', () => {
    // Sol's system under Vega's step: not the map Vega opens into.
    const wrong = [
      { mapId: 'galaxy', placeId: 'vega' },
      { mapId: 'sol-system', placeId: 'earth' },
    ];
    expect(levels.validateAt(WORLD, wrong)).toEqual([
      'at[1]: Sol isn\'t the map "vega" opens into.',
    ]);
    // A place not on the step's map.
    expect(
      levels.validateAt(WORLD, [
        { mapId: 'galaxy', placeId: 'vega' },
        { mapId: 'vega-system', placeId: 'earth' },
      ])
    ).toEqual(['at[1]: "earth" isn\'t on Vega.']);
    // Not starting on the top map.
    expect(levels.validateAt(WORLD, [{ mapId: 'vega-system', placeId: 'vega-iv' }])).toEqual([
      "at[0] must be on the world's top map.",
    ]);
    // A step above the last that names no place to open the next map.
    expect(
      levels.validateAt(WORLD, [
        { mapId: 'galaxy', point: { x: 1, y: 1 } },
        { mapId: 'vega-system', placeId: 'vega-iv' },
      ])
    ).toEqual(expect.arrayContaining(['at[0] must name the place that opens the next map.']));
  });

  test('a point on a grid, a square off it or on an area map, are refused', () => {
    const down = levels.pathTo(WORLD, 'dock').slice(0, 3);
    expect(levels.validateAt(WORLD, [...down, { mapId: 'deck', point: { x: 1, y: 1 } }])).toEqual([
      'at[3]: a grid is stood on by square (cell), not point.',
    ]);
    expect(levels.validateAt(WORLD, [...down, { mapId: 'deck', cell: { x: 20, y: 0 } }])).toEqual([
      'at[3].cell must be a square on The station deck.',
    ]);
    expect(
      levels.validateAt(WORLD, [...down.slice(0, 2), { mapId: 'port-ellis', cell: { x: 1, y: 1 } }])
    ).toEqual(['at[2]: only a grid has squares.']);
    expect(levels.validateAt(WORLD, [])).toEqual([
      'at must be a path of steps from the top map down.',
    ]);
  });
});

describe('saves', () => {
  const base = makeSave({ ownerUid: 'u', worldId: 'w', name: 'n', character: { name: 'Tam' } });
  test('a save may stand at a path, and keep what it discovered by map', () => {
    expect(validateSave({ ...base, at: levels.pathTo(WORLD, 'airlock') }).valid).toBe(true);
    expect(
      validateSave({ ...base, discovered: { galaxy: ['vega'], 'vega-system': [] } }).valid
    ).toBe(true);
    expect(validateSave({ ...base, at: 'deck' }).errors).toContain(
      'at must be a path of { mapId, placeId | point | cell } steps, or null'
    );
    expect(validateSave({ ...base, discovered: { galaxy: [3] } }).valid).toBe(false);
  });

  test('discovered places by map; a list from before reads as the top map’s', () => {
    expect(
      levels.discoveredOn(WORLD, { discovered: { 'vega-system': ['vega-iv'] } }, 'vega-system')
    ).toEqual(['vega-iv']);
    expect(levels.discoveredOn(WORLD, { discovered: ['vega'] }, 'galaxy')).toEqual(['vega']);
    expect(levels.discoveredOn(WORLD, { discovered: ['vega'] }, 'vega-system')).toEqual([]);
  });
});
