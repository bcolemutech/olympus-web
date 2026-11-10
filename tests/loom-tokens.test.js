'use strict';

/**
 * Token pictures as data (planning/tokens.md §4.1, TK1; L-931 / #789): which
 * picture a person shows (a figure group's own, a character's, else their
 * stat block's, else none), the crop's checks, and what the page is sent.
 * Pure, with both built-in systems' sheets.
 *
 * Run: cd tests && npx jest loom-tokens --verbose
 */

const tokens = require('../functions/loom-canon/tokens');
const templates = require('../functions/loom-canon/templates');
const figures = require('../functions/loom-modules/combat/figures');
const { BUILT_IN } = require('../functions/loom-canon/systems');

const pic = (n, crop) => ({
  imageId: `img_${String(n).padStart(16, '0')}`,
  link: `https://example.test/studio/${n}`,
  width: 512,
  height: 512,
  format: 'png',
  ...(crop ? { crop } : {}),
});

const d20Block = {
  attributes: { str: 12, dex: 14, con: 12, int: 10, wis: 10, cha: 8 },
};
const poolBlock = {
  attributes: { body: 3, agility: 3, mind: 2, presence: 2 },
};

function worldFor(system, block) {
  return {
    id: 'w',
    statBlocks: {
      bandit: { id: 'bandit', name: 'Bandit', statBlock: block, token: pic(1) },
      rat: { id: 'rat', name: 'Rat', statBlock: block },
    },
    characters: {
      villain: { id: 'villain', name: 'Mordrake', statBlock: 'bandit', token: pic(2) },
      captain: { id: 'captain', name: 'Captain', statBlock: 'bandit' },
      hermit: { id: 'hermit', name: 'Hermit' },
    },
    battleMaps: {
      camp: {
        id: 'camp',
        width: 10,
        height: 10,
        figures: [
          {
            id: 'bandits',
            name: 'Bandit',
            statBlock: 'bandit',
            cells: [0, 1, 2, 3, 4, 5].map((x) => ({ x, y: 0 })),
          },
          {
            id: 'chief',
            name: 'Bandit chief',
            statBlock: 'bandit',
            token: pic(3, { x: 0.4, y: 0.3, zoom: 2 }),
            cells: [{ x: 6, y: 0 }],
          },
          { id: 'rats', name: 'Rat', statBlock: 'rat', cells: [{ x: 0, y: 1 }] },
          { id: 'wolf', name: 'Wolf', statBlock: block, cells: [{ x: 1, y: 1 }] },
        ],
      },
    },
    systemId: system.id,
  };
}

describe.each([
  ['d20-fantasy', d20Block],
  ['pool-scifi', poolBlock],
])('tokenOf with %s', (systemId, block) => {
  const system = BUILT_IN[systemId];
  const world = worldFor(system, block);
  const all = world.battleMaps.camp.figures.flatMap((g) =>
    figures.instancesOf(system, g, world)
  );
  const byGroup = (id) => all.filter((f) => f.figure === id);

  test('six bandits from one stat block share its picture', () => {
    const six = byGroup('bandits');
    expect(six).toHaveLength(6);
    for (const f of six) expect(tokens.tokenOf(f, world).imageId).toBe(pic(1).imageId);
  });

  test('a seventh placed with its own token shows that one, over its stat block’s', () => {
    const [chief] = byGroup('chief');
    expect(tokens.tokenOf(chief, world).imageId).toBe(pic(3).imageId);
    expect(tokens.forPlayer(tokens.tokenOf(chief, world))).toEqual({
      link: pic(3).link,
      crop: { x: 0.4, y: 0.3, zoom: 2 },
    });
  });

  test('a named character shows their own, else their stat block’s', () => {
    expect(tokens.tokenOf(world.characters.villain, world).imageId).toBe(pic(2).imageId);
    expect(tokens.tokenOf(world.characters.captain, world).imageId).toBe(pic(1).imageId);
  });

  test('none: no picture of their own or their stat block’s', () => {
    expect(tokens.tokenOf(world.characters.hermit, world)).toBeNull();
    expect(tokens.tokenOf(byGroup('rats')[0], world)).toBeNull();
    // A stat block of their own (not named) has no picture to share.
    expect(tokens.tokenOf(byGroup('wolf')[0], world)).toBeNull();
    expect(tokens.forPlayer(null)).toBeNull();
  });

  test('a template instance’s figures use their stat block’s', () => {
    const w = {
      ...worldFor(system, block),
      maps: {
        top: { kind: 'region', parent: null, name: 'Top' },
        den: { kind: 'grid', template: true, parent: null, name: 'Den' },
      },
      mapPlaces: { cave: { id: 'cave', mapId: 'top', name: 'Cave', opens: { template: 'den' } } },
    };
    w.battleMaps = {
      ...w.battleMaps,
      den: {
        id: 'den',
        width: 5,
        height: 5,
        figures: [{ id: 'guards', name: 'Guard', statBlock: 'bandit', cells: [{ x: 1, y: 1 }] }],
      },
    };
    templates.instantiate(w);
    const copy = w.battleMaps[templates.instanceId('den', 'cave')];
    expect(copy).toBeDefined();
    const [guard] = figures.instancesOf(system, copy.figures[0], w);
    expect(tokens.tokenOf(guard, w).imageId).toBe(pic(1).imageId);
  });
});

describe('crops', () => {
  test('a good crop, and none, pass', () => {
    expect(tokens.validateCrop(undefined)).toEqual([]);
    expect(tokens.validateCrop(null)).toEqual([]);
    expect(tokens.validateCrop({ x: 0.5, y: 0.2, zoom: 1.5 })).toEqual([]);
    expect(tokens.validateCrop({ zoom: 3 })).toEqual([]);
  });

  test('a bad crop is refused with its reason', () => {
    expect(tokens.validateCrop({ x: 1.5 })[0]).toMatch(/crop\.x .* from 0 to 1/);
    expect(tokens.validateCrop({ zoom: 0.5 })[0]).toMatch(/crop\.zoom .* from 1/);
    expect(tokens.validateCrop({ zoom: 50 })[0]).toMatch(/to 10/);
    expect(tokens.validateCrop({ size: 2 })[0]).toMatch(/crop\.size isn't part of a crop/);
    expect(tokens.validateCrop('middle')[0]).toMatch(/\{ x, y, zoom \}/);
  });

  test('the default is centred and fitted', () => {
    expect(tokens.cropOf(pic(1))).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
    expect(tokens.cropOf(pic(1, { y: 0.25 }))).toEqual({ x: 0.5, y: 0.25, zoom: 1 });
  });

  test('the page is sent the link and crop only, never the record', () => {
    const sent = tokens.forPlayer(pic(4));
    expect(Object.keys(sent).sort()).toEqual(['crop', 'link']);
  });
});
