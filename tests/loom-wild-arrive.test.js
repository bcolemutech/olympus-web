'use strict';

/**
 * Playing an event (planning/off-road-travel.md §4.6, EV4, EV5, EV8; L-366 /
 * #840): the map an event is played on, its figures, the way in and the way
 * out (functions/loom-modules/wilds/arrive.js), and how a save keeps them
 * (functions/loom-canon/frames.js, maps.js).
 *
 * Run: cd tests && npx jest loom-wild-arrive --verbose
 */

const arrive = require('../functions/loom-modules/wilds/arrive');
const events = require('../functions/loom-modules/wilds/events');
const frames = require('../functions/loom-canon/frames');
const maps = require('../functions/loom-canon/maps');
const geo = require('../functions/loom-canon/map-geometry');
const { wildsWorld } = require('./fixtures/wilds-world');

const view = (extra = {}) => {
  const world = wildsWorld('weald', extra);
  world.statBlocks = { wolf: { name: 'Wolf' }, pedlar: { name: 'Pedlar' } };
  return frames.viewFor(frames.playWorld(world), 'weald', []);
};
const WOLVES = { kind: 'creatures', what: 'wolf', count: 3, text: 'Wolves.', narrated: false };
const CAMP = [10, 12];

describe('which events are played, and where', () => {
  test('figures to meet are played on a map; an event only told is not', () => {
    expect(arrive.playedOn(WOLVES)).toBe(true);
    expect(arrive.playedOn({ ...WOLVES, narrated: true })).toBe(false);
    expect(arrive.playedOn({ kind: 'weather', text: 'Rain.', narrated: true })).toBe(false);
    expect(arrive.playedOn(null)).toBe(false);
  });

  test('the terrain is the ground’s own, or what a world’s own ground is like', () => {
    const v = view();
    expect(arrive.terrainOf(v, 'forest')).toBe('forest');
    expect(arrive.terrainOf(v, 'swamp')).toBe('swamp');
    expect(
      arrive.terrainOf(
        { materials: [{ id: 'blackwood', name: 'Blackwood', like: 'forest' }] },
        'blackwood'
      )
    ).toBe('forest');
    // Ground the generator has no terrain for is plain grass.
    expect(arrive.terrainOf(v, 'ocean')).toBe('grass');
  });

  test('the scene is its terrain’s likeliest; travellers meet in a clearing', () => {
    expect(arrive.sceneOf('forest', WOLVES)).toBe('forest-track');
    expect(arrive.sceneOf('hills', WOLVES)).toBe('ridge');
    expect(arrive.sceneOf('swamp', WOLVES)).toBe('marsh-path');
    expect(arrive.sceneOf('grass', WOLVES)).toBe('clearing');
    expect(arrive.sceneOf('forest', { kind: 'travellers', what: 'pedlar' })).toBe('clearing');
  });
});

describe('the map', () => {
  test('with no generic map for the ground, one is made, the same for the same seed', () => {
    const v = view();
    const a = arrive.mapFor(v, { material: 'forest', event: WOLVES, seed: 'save:1:100' });
    const b = arrive.mapFor(v, { material: 'forest', event: WOLVES, seed: 'save:1:100' });
    const other = arrive.mapFor(v, { material: 'forest', event: WOLVES, seed: 'save:2:100' });
    expect(a.from).toBe('generated');
    expect(a.map).toEqual(b.map);
    expect(a.map.id).not.toBe(other.map.id);
    expect(a.map).toMatchObject({
      wild: true,
      name: 'A forest track',
      generic: { kind: 'forest-track', terrain: 'forest' },
    });
    expect(a.map.entries.length).toBeGreaterThan(1);
    expect(a.map.exits.every((e) => e.to === 'out')).toBe(true);
    // Not the world's: nothing is added to it.
    expect(v.battleMaps).toEqual({});
  });

  test('an own world’s ground is played on the terrain it is like', () => {
    const v = view();
    v.materials = [{ id: 'blackwood', name: 'Blackwood', like: 'forest' }];
    const made = arrive.mapFor(v, { material: 'blackwood', event: WOLVES, seed: 's' });
    expect(made.map.generic).toEqual({ kind: 'forest-track', terrain: 'forest' });
  });

  describe('the world’s own generic maps', () => {
    const wood = (id, kind, extra = {}) => ({
      id,
      name: id,
      width: 12,
      height: 12,
      entries: [{ id: 'in', x: 1, y: 6 }],
      exits: [{ id: 'out', name: 'the way out', x: 2, y: 6, to: 'out' }],
      features: [],
      generic: { kind, terrain: 'forest' },
      figures: [{ id: 'guard', name: 'Guard', statBlock: 'wolf', cells: [{ x: 5, y: 5 }] }],
      geometry: geo.normalize({}),
      ...extra,
    });
    const withMaps = (list) => {
      const v = view();
      v.battleMaps = Object.fromEntries(list.map((m) => [m.id, m]));
      return v;
    };

    test('one tagged for the terrain is used, copied under an id of its own, without its figures', () => {
      const v = withMaps([wood('bm_a', 'forest-clearing')]);
      const made = arrive.mapFor(v, { material: 'forest', event: WOLVES, seed: 's' });
      expect(made.from).toBe('world');
      expect(made.map).toMatchObject({
        name: 'bm_a',
        wild: true,
        figures: [],
        sources: { from: 'bm_a' },
      });
      expect(made.map.id).toMatch(/^wild-/);
      // The world's own is untouched.
      expect(v.battleMaps.bm_a.wild).toBeUndefined();
      expect(v.battleMaps.bm_a.figures).toHaveLength(1);
    });

    test('those of the scene come first, and the same seed chooses the same', () => {
      const v = withMaps([
        wood('bm_a', 'forest-clearing'),
        wood('bm_b', 'forest-track'),
        wood('bm_c', 'forest-track'),
      ]);
      const picks = new Set();
      for (let n = 0; n < 20; n++) {
        const made = arrive.mapFor(v, { material: 'forest', event: WOLVES, seed: 's' + n });
        picks.add(made.map.sources.from);
        expect(
          arrive.mapFor(v, { material: 'forest', event: WOLVES, seed: 's' + n }).map.sources.from
        ).toBe(made.map.sources.from);
      }
      expect([...picks].sort()).toEqual(['bm_b', 'bm_c']);
    });

    test('maps for other ground, retired ones, and ones with no way out are not used', () => {
      const v = withMaps([
        wood('bm_hills', 'ridge', { generic: { kind: 'ridge', terrain: 'hills' } }),
        wood('bm_gone', 'forest-track', { retired: true }),
        wood('bm_shut', 'forest-track', { exits: [] }),
        wood('bm_place', 'forest-track', { generic: null }),
      ]);
      expect(arrive.mapFor(v, { material: 'forest', event: WOLVES, seed: 's' }).from).toBe(
        'generated'
      );
    });
  });
});

describe('the way in', () => {
  const map = {
    width: 30,
    height: 30,
    entries: [
      { id: 'north', x: 15, y: 1 },
      { id: 'west', x: 1, y: 15 },
      { id: 'south', x: 15, y: 28 },
    ],
  };

  test('the traveller comes in on the side they came from', () => {
    expect(arrive.entryOf(map, [0, 12], [10, 12]).id).toBe('west');
    expect(arrive.entryOf(map, [10, 0], [10, 12]).id).toBe('north');
    expect(arrive.entryOf(map, [10, 30], [10, 12]).id).toBe('south');
  });

  test('with no side to come from, the first', () => {
    expect(arrive.entryOf(map, null, [10, 12]).id).toBe('north');
    expect(arrive.entryOf({ ...map, entries: [] }, null, [10, 12])).toBeNull();
  });
});

describe('arriving', () => {
  const dice = (seed) => events.dice(seed);

  test('puts the save on the map at an entry, in the wilds, with the figures standing on a spawn area', () => {
    const v = view();
    const out = arrive.arrive(
      v,
      {},
      { at: CAMP, event: WOLVES, from: [0, 12], seed: 's', dice: dice('s') }
    );
    const set = Object.fromEntries(out.mutations.map((m) => [m.path, m.value]));
    expect(out.line).toBe('You come to a track through the trees.');
    expect(set.mapId).toBe(out.map.id);
    expect(set.location).toBeNull();
    expect(set.wild).toEqual({ x: 10, y: 12 });
    expect(Object.keys(set.wildMaps)).toEqual([out.map.id]);
    expect(set.wildEvent).toMatchObject({
      mapId: out.map.id,
      what: 'wolf',
      count: 3,
      kind: 'creatures',
    });
    const entry = out.map.entries.find((e) => e.x === set.cell.x && e.y === set.cell.y);
    expect(entry).toEqual(arrive.entryOf(out.map, [0, 12], CAMP));
    // Three wolves in one group, each on its own open square of one spawn area.
    const [group] = set[`spawned.${out.map.id}`];
    expect(group).toMatchObject({ statBlock: 'wolf', name: 'Wolf', side: 'hostile' });
    expect(group.spawn).toMatch(/^spawn-/);
    expect(group.cells).toHaveLength(3);
    expect(new Set(group.cells.map((c) => c.x + ',' + c.y)).size).toBe(3);
    const world = { ...v, battleMaps: { [out.map.id]: out.map } };
    group.cells.forEach((c) => {
      expect(
        maps.squareProblem(world, out.map, maps.wildHost(world, out.map.id), c, null)
      ).toBeNull();
    });
    // The same dice, the same place.
    const again = arrive.arrive(
      v,
      {},
      { at: CAMP, event: WOLVES, from: [0, 12], seed: 's', dice: dice('s') }
    );
    expect(again.mutations).toEqual(out.mutations);
  });

  test('travellers are neutral', () => {
    const out = arrive.arrive(
      view(),
      {},
      {
        at: CAMP,
        event: { kind: 'travellers', what: 'pedlar', count: 1 },
        seed: 's',
        dice: dice('s'),
      }
    );
    const spawned = out.mutations.find((m) => /^spawned\./.test(m.path)).value;
    expect(spawned[0]).toMatchObject({ statBlock: 'pedlar', side: 'neutral' });
    expect(out.line).toBe('You come to a clearing.');
  });

  test('a map with no spawn areas puts them far from its entries', () => {
    const v = view();
    v.battleMaps = {
      bm_open: {
        id: 'bm_open',
        name: 'Open wood',
        width: 20,
        height: 12,
        entries: [{ id: 'in', x: 0, y: 6 }],
        exits: [{ id: 'out', name: 'the way out', x: 0, y: 7, to: 'out' }],
        features: [],
        generic: { kind: 'forest-clearing', terrain: 'forest' },
        geometry: geo.normalize({}),
      },
    };
    const out = arrive.arrive(v, {}, { at: CAMP, event: WOLVES, seed: 's', dice: dice('s') });
    const [group] = out.mutations.find((m) => /^spawned\./.test(m.path)).value;
    expect(group.spawn).toBe('scatter');
    expect(group.cells).toHaveLength(3);
    group.cells.forEach((c) => expect(Math.hypot(c.x - 0, c.y - 6)).toBeGreaterThanOrEqual(8));
  });

  test('nothing is played for a stat block the world has not, or an event only told', () => {
    const v = view();
    const go = (event) => arrive.arrive(v, {}, { at: CAMP, event, seed: 's', dice: dice('s') });
    expect(go({ ...WOLVES, what: 'dragon' })).toBeNull();
    expect(go({ ...WOLVES, narrated: true })).toBeNull();
    expect(go({ kind: 'weather', text: 'Rain.', narrated: true })).toBeNull();
  });
});

describe('a save on the map', () => {
  const v = view();
  const out = arrive.arrive(v, {}, { at: CAMP, event: WOLVES, seed: 's', dice: events.dice('s') });
  const fields = Object.fromEntries(out.mutations.map((m) => [m.path, m.value]));
  const stored = () => ({
    ...fields,
    at: [{ mapId: 'weald', point: { x: 10, y: 12 } }],
    spawned: { [out.map.id]: fields[`spawned.${out.map.id}`] },
    journey: {
      path: [
        { x: 10, y: 12 },
        { x: 20, y: 12 },
      ],
      times: [0, 6],
      hours: 6,
      done: 2,
    },
  });
  const world = frames.playWorld(wildsWorld('weald', {}));

  test('the frame has the map, and keeps its square while at stays at the camp', () => {
    const framed = frames.frameOf(world, stored());
    expect(framed.save).toMatchObject({
      location: null,
      wild: { x: 10, y: 12 },
      mapId: out.map.id,
      cell: fields.cell,
    });
    expect(framed.view.battleMaps[out.map.id]).toMatchObject({ wild: true });
    // The world's own play world isn't changed.
    expect(world.battleMaps[out.map.id]).toBeUndefined();
    expect(maps.positionOf(framed.view, framed.save).map.id).toBe(out.map.id);
    expect(maps.hostOf(framed.view, framed.save)).toEqual({
      id: `wild:${out.map.id}`,
      name: 'A forest track',
      battleMap: { mapId: out.map.id },
      wild: true,
    });
  });

  test('without the event the map is gone, as the fields of at say', () => {
    const framed = frames.frameOf(world, { ...stored(), wildEvent: null, wildMaps: null });
    expect(framed.save.mapId).toBeNull();
    expect(maps.hostOf(framed.view, framed.save)).toBeNull();
  });

  test('settling keeps the map after at is set, and drops it when the event is', () => {
    const save = { ...stored(), at: [{ mapId: 'weald', point: { x: 11, y: 12 } }] };
    const framed = frames.frameOf(world, stored());
    frames.settle(framed.view, save, true);
    expect(save).toMatchObject({ mapId: out.map.id, wild: { x: 11, y: 12 } });
    const left = { ...save, wildEvent: null, wildMaps: null, mapId: null, cell: null };
    frames.settle(framed.view, left, true);
    expect(left.mapId).toBeNull();
  });

  test('its figures stand there, and leaving drops the map and them', () => {
    const framed = frames.frameOf(world, stored());
    const seen = arrive.worldFor(framed.view, framed.save);
    const standing = maps.standingAt(seen, maps.hostOf(seen, framed.save));
    expect(standing.map((c) => c.name).sort()).toEqual(['Wolf 1', 'Wolf 2', 'Wolf 3']);

    const save = {
      ...framed.save,
      sides: { 'fig-event-x-1': 'hostile', player: 'x' },
      figures: { [standing[0].id]: { down: true }, 'fig-other': { down: true } },
      doors: { [out.map.id]: { d: 'open' }, other: { d: 'open' } },
    };
    const left = arrive.leave(save, { name: 'the way west' });
    const after = Object.fromEntries(left.mutations.map((m) => [m.path, m.value]));
    expect(after).toMatchObject({
      mapId: null,
      cell: null,
      gridPoint: null,
      wildEvent: null,
      wildMaps: null,
      spawned: {},
      figures: { 'fig-other': { down: true } },
      doors: { other: { d: 'open' } },
    });
    expect(left.lines.join(' ')).toBe(
      'You leave by the way west, back to the way you were going. You can go on, turn back or head somewhere else.'
    );
    // The camp and the journey are not touched.
    expect(Object.keys(after)).not.toEqual(expect.arrayContaining(['wild', 'at', 'journey']));
  });
});
