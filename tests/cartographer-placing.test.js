'use strict';

/**
 * The one-time position backfill (functions/cartographer/placing.js; planning/
 * the-loom-movement-and-vision.md §6a; L-683 / #515), planned over a world
 * object: each kind of character placed, placed ones left alone, those it
 * can't place reported, and running it twice changes nothing. The emulator
 * side (writing it, and publishing) is in cartographer-app.test.js.
 *
 * Run: cd tests && npx jest cartographer-placing --verbose
 */

const { planPositionBackfill } = require('../functions/cartographer/placing');
const { positionOf } = require('../functions/loom-canon/positions');

const INN = {
  id: 'bm_inn',
  name: 'The Gull & Anchor',
  width: 8,
  height: 6,
  entries: [{ id: 'door', x: 1, y: 3 }],
  exits: [{ id: 'out', name: 'the front door', x: 0, y: 3, to: 'out' }],
  features: [],
};
const character = (id, fields) => ({ id, name: id.replace('chr_', ''), ...fields });
const WORLD = {
  map: { width: 1000, height: 600 },
  locations: {
    loc_1: { id: 'loc_1', name: 'Burdendal', geo: { kind: 'settlement', x: 100, y: 100 } },
    poi_well: { id: 'poi_well', name: 'The old well', geo: { kind: 'poi', x: 400, y: 250 } },
  },
  places: {
    plc_gate: {
      id: 'plc_gate',
      locationId: 'loc_1',
      name: 'The gate',
      entrance: { via: ['road'] },
      position: { x: 50, y: 900 },
    },
    plc_inn: {
      id: 'plc_inn',
      locationId: 'loc_1',
      name: 'The inn',
      battleMap: { mapId: 'bm_inn' },
    },
    plc_market: {
      id: 'plc_market',
      locationId: 'loc_1',
      name: 'Market Square',
      position: { x: 300, y: 200 },
    },
  },
  battleMaps: { bm_inn: INN },
  characters: {
    chr_barkeep: character('chr_barkeep', { locationId: 'loc_1', placeId: 'plc_inn' }),
    chr_potboy: character('chr_potboy', { locationId: 'loc_1', placeId: 'plc_inn' }),
    chr_seller: character('chr_seller', { locationId: 'loc_1', placeId: 'plc_market' }),
    chr_beggar: character('chr_beggar', { locationId: 'loc_1' }),
    chr_hermit: character('chr_hermit', { locationId: 'poi_well' }),
    chr_stale: character('chr_stale', { locationId: 'poi_well', townPoint: { x: 1, y: 1 } }),
    chr_placed: character('chr_placed', { locationId: 'loc_1', townPoint: { x: 7, y: 8 } }),
    chr_lost: character('chr_lost', {}),
    chr_gone: character('chr_gone', { locationId: 'loc_1', retired: true }),
  },
};
const byId = (list) => Object.fromEntries(list.map((item) => [item.id, item]));

describe('planning the backfill', () => {
  const plan = planPositionBackfill(WORLD);
  const placed = byId(plan.placed);

  test('at a map: free squares near its entry, never the same one twice', () => {
    const a = placed.chr_barkeep.fields.cell;
    const b = placed.chr_potboy.fields.cell;
    expect(a).not.toEqual(b);
    for (const cell of [a, b]) {
      expect(Math.max(Math.abs(cell.x - 1), Math.abs(cell.y - 3))).toBe(1);
    }
  });

  test("in town: their place's door, else the first way in", () => {
    expect(placed.chr_seller.fields).toEqual({ townPoint: { x: 300, y: 200 } });
    expect(placed.chr_beggar.fields).toEqual({ townPoint: { x: 50, y: 900 } });
  });

  test('at a point of interest without a map: nothing to write, or a stale position cleared', () => {
    expect(placed.chr_hermit).toBeUndefined();
    expect(placed.chr_stale.fields).toEqual({ townPoint: null });
    expect(placed.chr_stale.was).toMatch(/drop their townPoint/);
  });

  test('placed and retired characters are left alone; the wilderness is reported', () => {
    expect(placed.chr_placed).toBeUndefined();
    expect(placed.chr_gone).toBeUndefined();
    expect(plan.alreadyPlaced).toBe(2); // the hermit and chr_placed
    expect(plan.unplaceable).toEqual([
      {
        id: 'chr_lost',
        name: 'lost',
        problem: 'they are in the wilderness: they need a world point (worldPoint)',
      },
    ]);
  });

  test('writes go to the characters collection, one per character placed', () => {
    expect(plan.writes.map((w) => w.id).sort()).toEqual(
      ['chr_barkeep', 'chr_beggar', 'chr_potboy', 'chr_seller', 'chr_stale'].sort()
    );
    expect(plan.writes.every((w) => w.collection === 'characters')).toBe(true);
  });

  test('once written, everyone placed is valid, and a second run changes nothing', () => {
    const characters = { ...WORLD.characters };
    for (const { id, fields } of plan.writes) characters[id] = { ...characters[id], ...fields };
    const after = { ...WORLD, characters };
    for (const id of Object.keys(placed)) {
      expect(positionOf(after, characters[id]).problem).toBeUndefined();
    }
    const again = planPositionBackfill(after);
    expect(again.writes).toEqual([]);
    expect(again.unplaceable.map((u) => u.id)).toEqual(['chr_lost']);
  });

  test('a map with no free square: reported, not placed', () => {
    const tiny = {
      ...INN,
      width: 2,
      height: 1,
      entries: [{ id: 'door', x: 1, y: 0 }],
      exits: [{ id: 'out', name: 'out', x: 0, y: 0, to: 'out' }],
    };
    const world = {
      ...WORLD,
      battleMaps: { bm_inn: tiny },
      characters: { chr_barkeep: WORLD.characters.chr_barkeep },
    };
    expect(planPositionBackfill(world).unplaceable).toEqual([
      expect.objectContaining({ id: 'chr_barkeep' }),
    ]);
  });
});
