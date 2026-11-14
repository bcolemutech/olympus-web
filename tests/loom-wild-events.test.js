'use strict';

/**
 * Events on the way (planning/off-road-travel.md §4.5, EV1–EV3, EV7; L-364 /
 * #838), the pure rules (functions/loom-modules/wilds/events.js), under both
 * built-in systems' settings (the d20 and the dice-pool): the chance from the
 * camp's danger, capped; the same seed rolling the same; a forest row picked
 * in a forest and not on a plain; the region's table before the map's before
 * the world's; the built-ins when nothing fits; the roll at a camp on The
 * Weald, its region's danger raising it; and what a table may hold.
 *
 * Run: cd tests && npx jest loom-wild-events --verbose
 */

const { BUILT_IN } = require('../functions/loom-canon/systems');
const frames = require('../functions/loom-canon/frames');
const settingsOf = require('../functions/loom-modules/wilds/settings').settingsOf;
const events = require('../functions/loom-modules/wilds/events');
const { wildsWorld } = require('./fixtures/wilds-world');

const SYSTEMS = ['d20-fantasy', 'pool-scifi'];

// A world as the rules see it, with the three tables.
function viewWith({ region = [], map = [], world = [], statBlocks = {} } = {}) {
  return {
    regions: { reg: { id: 'reg', encounters: region } },
    maps: { m: { id: 'm', encounters: map } },
    statBlocks,
    encounters: world,
  };
}
const AT = { material: 'forest', mapId: 'm', regionId: 'reg' };
const always = () => 1;

describe.each(SYSTEMS)('the chance of an event under %s', (systemId) => {
  const settings = settingsOf(BUILT_IN[systemId], {});

  test('is the base chance times the camp’s danger', () => {
    expect(events.chanceOf(settings, 1)).toBeCloseTo(settings.eventChance, 10);
    expect(events.chanceOf(settings, 2)).toBeCloseTo(settings.eventChance * 2, 10);
    expect(events.chanceOf(settings, 0.5)).toBeCloseTo(settings.eventChance / 2, 10);
  });

  test('is capped at 95%, and none with no base chance', () => {
    expect(events.chanceOf({ ...settings, eventChance: 0.95 }, 2)).toBe(0.95);
    expect(events.chanceOf({ ...settings, eventChance: 0.6 }, 2)).toBe(0.95);
    expect(events.chanceOf({ ...settings, eventChance: 0 }, 2)).toBe(0);
  });
});

describe('the roll', () => {
  test('the same seed rolls the same, and another seed another', () => {
    const a = events.rollOf('save-1:1:28800', 0.25);
    expect(events.rollOf('save-1:1:28800', 0.25)).toEqual(a);
    expect(events.rollOf('save-1:2:28800', 0.25).roll).not.toBe(a.roll);
    expect(events.rollOf('save-2:1:28800', 0.25).roll).not.toBe(a.roll);
  });

  test('is from 0 up to 1, an event when it is under the chance, recorded with it', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const r = events.rollOf(seed, 0.5);
      expect(r.roll).toBeGreaterThanOrEqual(0);
      expect(r.roll).toBeLessThan(1);
      expect(r.chance).toBe(0.5);
      expect(r.happened).toBe(r.roll < 0.5);
    }
  });

  test('over many seeds, events come about as often as the chance', () => {
    const hits = (chance) =>
      Array.from({ length: 2000 }, (_, i) => events.rollOf('s' + i, chance)).filter(
        (r) => r.happened
      ).length;
    expect(hits(0.25) / 2000).toBeGreaterThan(0.21);
    expect(hits(0.25) / 2000).toBeLessThan(0.29);
    expect(hits(0)).toBe(0);
    expect(hits(0.95) / 2000).toBeGreaterThan(0.92);
  });

  test('dice from a seed are the same series each time, and in range', () => {
    const one = events.dice('seed');
    const two = events.dice('seed');
    const faces = Array.from({ length: 30 }, () => one(6));
    expect(Array.from({ length: 30 }, () => two(6))).toEqual(faces);
    expect(Math.min(...faces)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...faces)).toBeLessThanOrEqual(6);
    expect(new Set(faces).size).toBeGreaterThan(3);
    expect(events.dice('x')(1)).toBe(1);
  });
});

describe('choosing an event', () => {
  const forest = { kind: 'weather', text: 'Rain in the trees.', terrain: ['forest'] };
  const plain = { kind: 'find', text: 'A lone standing stone.', terrain: ['grassland'] };
  const anywhere = { kind: 'travellers', text: 'A pedlar passes.' };

  test('a forest row is picked in a forest and not on a plain', () => {
    const view = viewWith({ world: [forest, plain] });
    expect(events.choose(view, { ...AT, material: 'forest' }, always).text).toBe(forest.text);
    expect(events.choose(view, { ...AT, material: 'grassland' }, always).text).toBe(plain.text);
    for (let n = 1; n <= 2; n++) {
      expect(events.choose(view, { ...AT, material: 'grassland' }, () => n).text).toBe(plain.text);
    }
    // A row with no terrain fits any.
    const any = viewWith({ world: [forest, anywhere] });
    expect(events.choose(any, { ...AT, material: 'desert' }, always).text).toBe(anywhere.text);
  });

  test('the region’s table comes before the map’s, and the map’s before the world’s', () => {
    const view = viewWith({
      region: [{ kind: 'find', text: 'From the region.' }],
      map: [{ kind: 'find', text: 'From the map.' }],
      world: [{ kind: 'find', text: 'From the world.' }],
    });
    const at = (extra) => events.choose(view, { ...AT, ...extra }, always);
    expect(at({})).toMatchObject({ text: 'From the region.', source: 'region' });
    expect(at({ regionId: 'elsewhere' })).toMatchObject({ text: 'From the map.', source: 'map' });
    expect(at({ regionId: undefined, mapId: 'nowhere' })).toMatchObject({
      text: 'From the world.',
      source: 'world',
    });
  });

  test('a table with nothing that fits the ground gives way to the next', () => {
    const view = viewWith({
      region: [{ kind: 'find', text: 'Swamp only.', terrain: ['swamp'] }],
      world: [{ kind: 'find', text: 'The world’s.' }],
    });
    expect(events.choose(view, AT, always)).toMatchObject({ text: 'The world’s.', source: 'world' });
    expect(events.choose(view, { ...AT, material: 'swamp' }, always)).toMatchObject({
      text: 'Swamp only.',
      source: 'region',
    });
  });

  test('the built-ins are used when nothing fits, of every kind, each narrated', () => {
    const view = viewWith({ region: [{ kind: 'find', text: 'Swamp.', terrain: ['swamp'] }] });
    const seen = new Set();
    for (let n = 1; n <= events.BUILT_INS.length; n++) {
      const event = events.choose(view, AT, () => n);
      expect(event).toMatchObject({ source: 'built-in', narrated: true });
      expect(event.text.length).toBeGreaterThan(10);
      expect(events.KINDS).toContain(event.kind);
      seen.add(event.kind);
    }
    expect([...seen].sort()).toEqual([...events.KINDS].sort());
    // And with no tables at all.
    expect(events.choose({}, {}, always).source).toBe('built-in');
  });

  test('rows are picked by weight', () => {
    const view = viewWith({
      world: [
        { kind: 'find', text: 'Rare.', weight: 1 },
        { kind: 'find', text: 'Common.', weight: 9 },
      ],
    });
    const picks = Array.from({ length: 10 }, (_, i) => events.choose(view, AT, () => i + 1).text);
    expect(picks.filter((t) => t === 'Rare.')).toHaveLength(1);
    expect(picks.filter((t) => t === 'Common.')).toHaveLength(9);
  });

  test('a row with figures is an event to meet them, named; one with words is told as given', () => {
    const view = viewWith({
      world: [{ what: 'wolf', count: 3 }],
      statBlocks: { wolf: { name: 'Grey wolves' } },
    });
    expect(events.choose(view, AT, always)).toEqual({
      kind: 'creatures',
      text: 'You are set upon by 3 Grey wolves.',
      source: 'world',
      what: 'wolf',
      count: 3,
      narrated: false,
    });
    const told = viewWith({ world: [{ what: 'wolf', text: 'Wolves ring the camp.', narrated: true }] });
    expect(events.choose(told, AT, always)).toMatchObject({
      text: 'Wolves ring the camp.',
      what: 'wolf',
      narrated: true,
    });
    // Words alone are narrated.
    expect(events.choose(viewWith({ world: [anywhere] }), AT, always)).toMatchObject({
      kind: 'travellers',
      narrated: true,
    });
  });
});

describe.each(SYSTEMS)('the roll at a camp on The Weald under %s', (systemId) => {
  function view(change = () => {}) {
    const world = wildsWorld('weald-' + systemId, { system: BUILT_IN[systemId] });
    change(world);
    return frames.viewFor(frames.playWorld(world), 'weald');
  }
  const FOREST = [10, 10];
  const GRASS = [30, 10];

  test('is the chance for the camp’s ground, the region’s danger raising it', () => {
    const settings = settingsOf(BUILT_IN[systemId], {});
    const calm = events.happen(view(), { settings, point: FOREST, seed: 's' });
    expect(calm).toMatchObject({ material: 'forest', danger: 1 });
    expect(calm.chance).toBeCloseTo(settings.eventChance, 4);
    const deadly = events.happen(
      view((w) => {
        w.regions.reg_wood.danger = 2;
      }),
      { settings, point: FOREST, seed: 's' }
    );
    expect(deadly.danger).toBe(2);
    expect(deadly.chance).toBeCloseTo(settings.eventChance * 2, 4);
    // The same camp on the grassland outside the region has no such danger.
    const plain = events.happen(
      view((w) => {
        w.regions.reg_wood.danger = 2;
      }),
      { settings, point: GRASS, seed: 's' }
    );
    expect(plain).toMatchObject({ material: 'grassland', danger: 1 });
  });

  test('picks from the region’s table in its land, and the world’s outside it', () => {
    const settings = { ...settingsOf(BUILT_IN[systemId], {}), eventChance: 0.95 };
    const v = view((w) => {
      w.regions.reg_wood.danger = 2;
      w.regions.reg_wood.encounters = [{ kind: 'weather', text: 'Rain.', terrain: ['forest'] }];
      w.encounters = [{ kind: 'find', text: 'The world’s.' }];
    });
    const hit = (point) => {
      for (let i = 0; i < 40; i++) {
        const r = events.happen(v, { settings, point, seed: 'try-' + i });
        if (r.happened) return r;
      }
      throw new Error('no event in 40 tries at 95%');
    };
    expect(hit(FOREST).event).toMatchObject({ text: 'Rain.', source: 'region', kind: 'weather' });
    expect(hit(GRASS).event).toMatchObject({ text: 'The world’s.', source: 'world' });
    // A miss has no event.
    const none = events.happen(v, { settings: { ...settings, eventChance: 0 }, point: FOREST, seed: 'x' });
    expect(none.happened).toBe(false);
    expect(none.event).toBeUndefined();
  });
});

describe('what a table may hold', () => {
  const world = { statBlocks: { wolf: { name: 'Wolf' } }, materials: [{ id: 'deadwood', like: 'forest' }] };
  const check = (rows) => events.validateRows(world, rows);

  test('rows with figures, words or both, with ground, kind and weight', () => {
    expect(
      check([
        { what: 'wolf', count: 2, weight: 5, terrain: ['forest', 'deadwood'] },
        { text: 'A peddler.', kind: 'travellers' },
        { what: 'wolf', text: 'Wolves.', kind: 'creatures', narrated: true },
      ])
    ).toEqual([]);
    expect(check([])).toEqual([]);
  });

  test('refuses what isn’t a table, and rows that say nothing', () => {
    expect(check('x')).toEqual(['encounters must be a list.']);
    expect(check([{}])[0]).toMatch(/needs a `what`.*or a `text`/);
    expect(check([{ weight: 2 }])[0]).toMatch(/needs a `what`/);
    expect(check([{ what: 'bear' }]).join(' ')).toMatch(/isn't one of the world's stat blocks/);
    expect(check(Array.from({ length: 21 }, () => ({ what: 'wolf' })))[0]).toMatch(/at most 20/);
  });

  test('refuses a bad kind, words with no kind, a long text and an unknown field', () => {
    expect(check([{ text: 'x', kind: 'doom' }]).join(' ')).toMatch(/kind must be one of/);
    expect(check([{ text: 'Something.' }]).join(' ')).toMatch(/kind is needed/);
    expect(check([{ text: 'x'.repeat(401), kind: 'find' }]).join(' ')).toMatch(/at most 400/);
    expect(check([{ what: 'wolf', mood: 'grim' }]).join(' ')).toMatch(/mood isn't a field/);
    expect(check([{ what: 'wolf', narrated: 'yes' }]).join(' ')).toMatch(/narrated must be/);
  });

  test('checks the ground, built-in or the world’s own', () => {
    expect(check([{ what: 'wolf', terrain: ['plasma'] }]).join(' ')).toMatch(
      /"plasma" is no ground material/
    );
    expect(check([{ what: 'wolf', terrain: [] }]).join(' ')).toMatch(/terrain must list/);
    expect(check([{ what: 'wolf', terrain: ['deadwood'] }])).toEqual([]);
  });

  test('a place’s own table is checked as it was: a stat block each', () => {
    const spawns = require('../functions/loom-modules/combat/spawns');
    expect(spawns.validateEncounters(world, [{ what: 'wolf' }])).toEqual([]);
    expect(spawns.validateEncounters(world, [{ text: 'x', kind: 'find' }]).length).toBeGreaterThan(0);
  });
});
