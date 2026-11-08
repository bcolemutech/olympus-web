'use strict';

/**
 * Decor (planning/game-art.md §4.5, DR1; L-945 / #799), pure:
 *
 *   - the catalog's decor kinds, each sized, flagged and with its art;
 *   - decor blocks a walk, a square and sight only when it's big: over 2.5 ft
 *     both ways (a flat kind never), and an object's own `blocksMove` and
 *     `blocksSight` still say;
 *   - decor has no menu: nothing to use, even with a container, a lock or an
 *     action set on it;
 *   - decor is never noticed or searched, and can't be hidden;
 *   - "What's here?" says it only when it's alone on the square.
 *
 * Run: cd tests && npx jest loom-decor --verbose
 */

const fs = require('fs');
const path = require('path');
const geo = require('../functions/loom-canon/map-geometry');
const materials = require('../functions/loom-canon/materials');
const objects = require('../functions/loom-canon/objects');
const maps = require('../functions/loom-canon/maps');
const mapPaths = require('../functions/loom-canon/map-paths');
const sight = require('../functions/loom-canon/sight');
const hidden = require('../functions/loom-canon/hidden');
const sheets = require('../functions/loom-canon/sheets');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const { lookAt } = require('../functions/loom-turn/looking');
const { VAULT } = require('./helpers/vault');

const DECOR = [
  'rubble',
  'bones',
  'candles',
  'cobwebs',
  'sacks',
  'crate-pile',
  'tapestry',
  'banner',
  'plant',
  'books',
  'bottles',
  'straw',
  'puddle',
  'chains',
];

// A corridor 60 × 15 ft, 5 ft wide between two walls, with `list` in it.
const corridor = (list) => ({
  id: 'bm_hall',
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
          [0, 10],
          [60, 10],
        ],
      },
    ],
    objects: list,
  }),
});
const walk = (map) =>
  mapPaths.pathTo(mapPaths.planner(map, {}), { x: 2.5, y: 7.5 }, { x: 57.5, y: 7.5 });

describe('the catalog’s decor kinds', () => {
  test.each(DECOR)('%s is decor, sized, in the decor group, with its art', (id) => {
    const kind = materials.objectKind(id);
    expect(kind).not.toBeNull();
    expect(kind).toMatchObject({ id, group: 'decor', decor: true });
    expect(kind.size.every((ft) => ft > 0)).toBe(true);
    expect(kind.art).toBe(`objects/${id}.svg`);
    expect(fs.existsSync(path.join(__dirname, '../public/apps/loom/art', kind.art))).toBe(true);
    expect(materials.isDecor({ kind: id })).toBe(true);
  });

  test('the fourteen are the decor there is; the others are not decor', () => {
    const decor = materials.OBJECT_KINDS.filter((k) => k.decor).map((k) => k.id);
    expect(decor.sort()).toEqual(DECOR.slice().sort());
    expect(materials.isDecor({ kind: 'chest' })).toBe(false);
    expect(materials.isDecor({ kind: 'nothing' })).toBe(false);
    // An object's own decor says, either way.
    expect(materials.isDecor({ kind: 'chest', decor: true })).toBe(true);
    expect(materials.isDecor({ kind: 'bones', decor: false })).toBe(false);
  });

  test('a tapestry, a banner and chains hang on a wall; flat ones never block', () => {
    ['tapestry', 'banner', 'chains'].forEach((id) =>
      expect(materials.objectKind(id)).toMatchObject({ onWall: true, blocksMove: false })
    );
    ['rubble', 'cobwebs', 'straw', 'puddle'].forEach((id) =>
      expect(materials.objectKind(id)).toMatchObject({ blocksMove: false })
    );
  });

  test('an object may be decor in a geometry; a bad flag is refused', () => {
    const bounds = { width: 60, height: 15 };
    const item = (decor) => ({ id: 'd', kind: 'bones', at: [30, 7.5], size: [2, 2], decor });
    expect(geo.check(corridor([item(true)]).geometry, bounds)).toEqual([]);
    expect(geo.check(corridor([item('yes')]).geometry, bounds).join()).toMatch(
      /decor must be true or false/
    );
  });
});

describe('decor blocks the way only when it’s big', () => {
  const block = (item) => geo.objectBlocksMove(item);

  test('over 2.5 ft both ways: a pile of crates does, candles and bones don’t', () => {
    expect(block({ kind: 'crate-pile', size: [4, 3] })).toBe(true);
    expect(block({ kind: 'candles', size: [1, 1] })).toBe(false);
    expect(block({ kind: 'bones', size: [2, 2] })).toBe(false);
    // Exactly 2.5 is not over it; over one way only is not over it both.
    expect(block({ kind: 'sacks', size: [2.5, 2.5] })).toBe(false);
    expect(block({ kind: 'sacks', size: [6, 2.5] })).toBe(false);
    expect(block({ kind: 'sacks', size: [2.6, 2.6] })).toBe(true);
  });

  test('a flat kind never does, however big; an object’s own word wins', () => {
    expect(block({ kind: 'rubble', size: [10, 10] })).toBe(false);
    expect(block({ kind: 'puddle', size: [6, 6] })).toBe(false);
    expect(block({ kind: 'candles', size: [1, 1], blocksMove: true })).toBe(true);
    expect(block({ kind: 'crate-pile', size: [4, 3], blocksMove: false })).toBe(false);
    // Not decor: as before, it blocks unless it says it doesn't.
    expect(block({ kind: 'chest', size: [1, 1] })).toBe(true);
    expect(block({ kind: 'rug', size: [8, 6] })).toBe(true);
    expect(block({ kind: 'rug', size: [8, 6], blocksMove: false })).toBe(false);
  });

  test('a walk goes past candles, bones and rubble, and is stopped by a big pile', () => {
    const decor = (kind, size) => ({ id: 'd', kind, at: [30, 7.5], size });
    expect(walk(corridor([]))).not.toBeNull();
    expect(walk(corridor([decor('candles', [1, 1])]))).not.toBeNull();
    expect(walk(corridor([decor('bones', [2, 2])]))).not.toBeNull();
    // Rubble fills the corridor, but it's flat: it's walked over.
    expect(walk(corridor([decor('rubble', [4, 4])]))).not.toBeNull();
    // A pile of crates 3 ft deep leaves a medium character no way through
    // 5 ft between the walls; a chest of the same size does the same.
    expect(walk(corridor([decor('crate-pile', [4, 3])]))).toBeNull();
    expect(walk(corridor([decor('chest', [4, 3])]))).toBeNull();
    // An ordinary object blocks at any size (2 ft either side is too narrow
    // for a medium character): the same 1 ft as candles, which don't.
    expect(walk(corridor([decor('chest', [1, 1])]))).toBeNull();
  });

  test('a square holds a pile of crates but not candles', () => {
    const map = corridor([
      { id: 'pile', kind: 'crate-pile', at: [27.5, 7.5], size: [4, 3] },
      { id: 'light', kind: 'candles', at: [37.5, 7.5], size: [1, 1] },
    ]);
    expect(maps.blockerAt(map, { x: 5, y: 1 })).toMatchObject({ id: 'pile', kind: 'low' });
    expect(maps.blockerAt(map, { x: 7, y: 1 })).toBeNull();
  });

  test('it hides what is behind it only if it says it’s tall', () => {
    const row = (item) => ({
      width: 10,
      height: 1,
      entries: [],
      exits: [],
      features: [],
      geometry: geo.normalize({
        objects: [{ id: 'd', at: [25, 2.5], size: [3, 3], ...item }],
      }),
    });
    const viewer = { cell: { x: 0, y: 0 }, point: { x: 2.5, y: 2.5 } };
    const behind = (map) => sight.inSight(map, viewer, {})['8,0'];
    expect(behind(row({ kind: 'sacks' }))).toBe(true);
    expect(behind(row({ kind: 'crate-pile', size: [4, 3] }))).toBe(true);
    // A tall one: a plant grown to a tree, saved as tall.
    expect(behind(row({ kind: 'plant', size: [3, 3], blocksSight: true }))).toBeFalsy();
  });
});

describe('decor has no menu, and is never noticed', () => {
  const withDecor = () => {
    const map = VAULT();
    map.geometry = geo.normalize({
      ...map.geometry,
      objects: [
        ...map.geometry.objects,
        // Decor with things that would make an object usable.
        {
          id: 'sack-pile',
          kind: 'sacks',
          at: [17.5, 22.5],
          size: [2, 2],
          container: { contents: 'grain' },
          locked: true,
          actions: [{ id: 'poke', name: 'Poke' }],
        },
        { id: 'bones-1', kind: 'bones', at: [17.5, 7.5], size: [2, 2] },
        { id: 'candle-1', kind: 'candles', at: [7.5, 22.5], size: [1, 1] },
      ],
    });
    return map;
  };

  test('nothing to use: it is left out of what there is to do', () => {
    const map = withDecor();
    const usable = objects.usableOf(map).map((o) => o.id);
    expect(usable).toEqual(expect.arrayContaining(['chest', 'crate', 'lever']));
    expect(usable).not.toContain('sack-pile');
    expect(usable).not.toContain('bones-1');
    expect(objects.isUsable({ kind: 'sacks', container: true })).toBe(false);
    expect(objects.isUsable({ kind: 'chest', container: true })).toBe(true);
    // It is still an object of the map, there to be drawn and looked at.
    expect(objects.allOf(map).map((o) => o.id)).toContain('bones-1');
  });

  test('never noticed or searched, and can’t be hidden', () => {
    const map = withDecor();
    const geometry = { ...map.geometry, hidden: [{ id: 'bones-1' }, { id: 'statue' }] };
    expect(geo.check(geometry, { width: 60, height: 40 }).join()).toMatch(
      /"bones-1", which is decor: decor is never hidden/
    );
    // A map that has it anyway (stored before) still never gives it to a roll.
    const things = hidden.thingsOf({ ...map, geometry }).map((t) => t.id);
    expect(things).toContain('statue');
    expect(things).not.toContain('bones-1');
  });
});

describe('"What’s here?" says decor only when it’s alone', () => {
  const system = BUILT_IN['d20-fantasy'];
  const world = () => {
    const map = VAULT();
    map.geometry = geo.normalize({
      ...map.geometry,
      objects: [
        ...map.geometry.objects,
        { id: 'bones-1', kind: 'bones', at: [17.5, 22.5], size: [2, 2] },
        { id: 'candle-1', kind: 'candles', at: [7.5, 22.5], size: [1, 1] },
      ],
    });
    return {
      system,
      battleMaps: { bm_vault: map },
      characters: {},
      locations: {},
      places: {},
      factions: {},
      regions: {},
      lore: {},
    };
  };
  const save = () => ({
    mapId: 'bm_vault',
    cell: { x: 2, y: 4 },
    location: 'x',
    character: { name: 'Tam', inventory: [], sheet: sheets.defaultSheet(system) },
    turn: { n: 1, ap: 20, kept: 0, plan: null },
  });

  test('beside the chest, the candle isn’t said', () => {
    const look = lookAt(world(), save(), { cell: { x: 1, y: 4 } });
    expect(look.facts.join(' ')).toMatch(/An object: the chest/);
    expect(look.facts.join(' ')).not.toMatch(/candle|Dressing/i);
  });

  test('alone on its square, it is the square’s facts; on bare floor, nothing is', () => {
    const alone = lookAt(world(), save(), { cell: { x: 3, y: 4 } });
    expect(alone.empty).toBe(false);
    expect(alone.facts[0]).toBe('Dressing: the bones.');
    const bare = lookAt(world(), save(), { cell: { x: 5, y: 5 } });
    expect(bare.empty).toBe(true);
  });
});
