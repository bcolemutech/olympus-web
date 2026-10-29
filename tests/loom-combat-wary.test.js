'use strict';

/**
 * Wary figures and triggers (planning/builders-tools.md §4.2, BT3; L-392 /
 * #738), pure, under both built-in systems: a wary group in sight starts no
 * fight; a failed check of the kind its challenge names turns it hostile and
 * starts one, a passed one doesn't; each trigger turns it; `then: 'neutral'`
 * calms a hostile; attacking one turns its group; and with the combat
 * module's `wary` off, it fights on sight.
 *
 * Run: cd tests && npx jest loom-combat-wary --verbose
 */

const { BUILT_IN, validateSystem } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const combat = require('../functions/loom-modules/combat');
const { evaluate } = require('../functions/loom-turn/adjudicate');

const { figures, play, wary } = combat;

const CASES = {
  'd20-fantasy': {
    system: BUILT_IN['d20-fantasy'],
    bluff: 'Deception',
    block: {
      attributes: { STR: 12, DEX: 12, CON: 10, INT: 8, WIS: 8, CHA: 8 },
      attacks: [{ id: 'spear', name: 'Spear', reach: 1, attack: '1d20 + 2', damage: '1d6' }],
    },
  },
  'pool-scifi': {
    system: BUILT_IN['pool-scifi'],
    bluff: 'Persuade',
    block: {
      attributes: { Body: 3, Reflex: 3, Mind: 2, Presence: 2 },
      attacks: [
        { id: 'baton', name: 'Baton', reach: 1, attack: 'count(4d10, >= 7)', damage: '1d2' },
      ],
    },
  },
};

// The Hulks: a hold 12 × 6, in at the west. Two guards stand mid-deck; the
// hold grating (a locked door) on the deck's edge above (8, 1); a lever at (10, 5); the hold
// itself, an area, the east end.
const hulks = (group, extra = {}) => ({
  id: 'bm',
  name: 'The Hulks',
  width: 12,
  height: 6,
  entries: [{ id: 'in', x: 1, y: 3 }],
  exits: [{ id: 'out', name: 'the gangway', x: 0, y: 3, to: 'out' }],
  features: [{ id: 'lever', name: 'a lever', x: 10, y: 5 }],
  walls: [],
  doors: [
    {
      id: 'grating',
      name: 'the hold grating',
      from: { x: 8, y: 1 },
      to: { x: 9, y: 1 },
      locked: true,
    },
  ],
  obstacles: [],
  areas: [
    {
      id: 'hold',
      name: 'The hold',
      polygon: [
        { x: 9, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 6 },
        { x: 9, y: 6 },
      ],
    },
  ],
  figures: [group],
  ...extra,
});
const guards = (block, patch = {}) => ({
  id: 'guards',
  name: 'Guard',
  statBlock: block,
  side: 'wary',
  challenge: { says: 'Halt. Name your business.' },
  cells: [
    { x: 5, y: 2 },
    { x: 5, y: 4 },
  ],
  ...patch,
});
const worldOf = (system, map) => ({
  id: 'w',
  system,
  locations: {
    hulks: {
      id: 'hulks',
      name: 'The Hulks',
      geo: { kind: 'poi', x: 1, y: 1 },
      battleMap: { mapId: 'bm' },
      connections: [],
    },
  },
  places: {},
  characters: {},
  battleMaps: { bm: map },
});
// The player, tough enough that no fight here ends in its first round.
const tough = (system) => {
  const sheet = sheets.defaultSheet(system);
  for (const r of system.sheet.resources) sheet.resources[r.id] = { current: 500 };
  return sheet;
};
const saveOf = (system, patch = {}) => ({
  location: 'hulks',
  mapId: 'bm',
  cell: { x: 2, y: 3 },
  time: 1000,
  turn: { n: 1, ap: 40, kept: 0, plan: null },
  character: { name: 'Tam', sheet: tough(system) },
  ...patch,
});
const low = () => 1;
const high = (sides) => sides;
const set = (r, path) => (r.mutations.find((m) => m.path === path) || {}).value;

describe.each(Object.keys(CASES))('wary figures under %s', (id) => {
  const c = CASES[id];
  const seen = (world, save) => figures.withFigures(world, save);

  test('the built-in system has wary on, and a system may turn it off', () => {
    expect(wary.isOn(c.system)).toBe(true);
    const off = { ...c.system, modules: { combat: { ...c.system.modules.combat, wary: false } } };
    expect(validateSystem(off).errors).toEqual([]);
    expect(wary.isOn(off)).toBe(false);
    const bad = { ...c.system, modules: { combat: { ...c.system.modules.combat, wary: 'yes' } } };
    expect(validateSystem(bad).errors.join(' ')).toMatch(/wary must be true or false/);
  });

  test('a wary group in sight starts no fight', () => {
    const world = worldOf(c.system, hulks(guards(c.block)));
    const save = saveOf(c.system);
    expect(play.hostilesInSight(seen(world, save), save)).toEqual([]);
    expect(play.begin(seen(world, save), save, { by: 'seen', dice: high })).toBeNull();
    // Walking up to them: no fight.
    const r = evaluate(
      { verb: 'move', targets: [], params: { cell: { x: 3, y: 3 } } },
      {},
      save,
      high,
      seen(world, save)
    );
    expect(r.fight).toBeUndefined();
  });

  test('with the setting off, wary reads as hostile: they fight on sight', () => {
    const system = { ...c.system, modules: { combat: { ...c.system.modules.combat, wary: false } } };
    const world = worldOf(system, hulks(guards(c.block)));
    const save = saveOf(system);
    expect(play.hostilesInSight(seen(world, save), save).map((x) => x.side)).toEqual([
      'hostile',
      'hostile',
    ]);
  });

  describe('the challenge', () => {
    const answered = (dice) => {
      const world = worldOf(
        c.system,
        hulks(guards(c.block, { challenge: { says: 'Halt.', check: { skill: c.bluff } } }))
      );
      const save = saveOf(c.system, { cell: { x: 4, y: 3 } });
      return evaluate(
        {
          verb: 'deceive',
          targets: ['fig-guards-1'],
          params: { check: { skill: c.bluff } },
        },
        {},
        save,
        dice,
        seen(world, save)
      );
    };

    test('a failed check of its kind turns the guards hostile, and the fight starts', () => {
      const r = answered(low);
      expect(r.roll.success).toBe(false);
      expect(set(r, 'sides.fig-guards-1')).toBe('hostile');
      expect(set(r, 'sides.fig-guards-2')).toBe('hostile');
      expect(r.constraints).toEqual(
        expect.arrayContaining(['Guard 1 turns on you.', 'Guard 2 turns on you.'])
      );
      expect(set(r, 'fight')).toMatchObject({ by: 'event' });
      expect(Object.keys(set(r, 'fight').combatants).sort()).toEqual([
        'fig-guards-1',
        'fig-guards-2',
        'player',
      ]);
    });

    test('a passed one turns nobody', () => {
      const r = answered(high);
      expect(r.roll.success).toBe(true);
      expect(r.mutations.some((m) => /^sides\./.test(m.path))).toBe(false);
      expect(set(r, 'fight')).toBeUndefined();
    });

    test('NARRATE is told they are wary, what they say and what answers it', () => {
      const group = guards(c.block, { challenge: { says: 'Halt.', check: { skill: c.bluff } } });
      const [one] = figures.instancesOf(c.system, group);
      expect(wary.narrateLine(c.system, one, (x) => x.skill)).toBe(
        `, wary of the player: they challenge, "Halt." (a failed ${c.bluff} check against them starts a fight)`
      );
    });
  });

  describe('triggers', () => {
    const fired = (triggers, events, side = 'wary') => {
      const world = worldOf(c.system, hulks(guards(c.block, { side, triggers })));
      const save = saveOf(c.system);
      return wary.react(seen(world, save), save, events);
    };

    test.each([
      ['doorOpened', 'grating'],
      ['doorForced', 'grating'],
      ['featureTouched', 'lever'],
      ['enteredArea', 'hold'],
    ])('%s %s turns them hostile', (on, target) => {
      const turned = fired([{ on, target, then: 'hostile' }], [{ on, target }]);
      expect(turned.map((t) => [t.id, t.side])).toEqual([
        ['fig-guards-1', 'hostile'],
        ['fig-guards-2', 'hostile'],
      ]);
      // Another door, feature or area: nothing.
      expect(fired([{ on, target, then: 'hostile' }], [{ on, target: 'elsewhere' }])).toEqual([]);
    });

    test('allyAttacked: anyone else on the map attacked, or the one named', () => {
      const world = worldOf(c.system, {
        ...hulks(guards(c.block, { triggers: [{ on: 'allyAttacked', then: 'hostile' }] })),
      });
      world.characters.mate = {
        id: 'mate',
        name: 'The Mate',
        locationId: 'hulks',
        cell: { x: 7, y: 3 },
      };
      const save = saveOf(c.system);
      const turned = wary.react(seen(world, save), save, [{ on: 'allyAttacked', target: 'mate' }]);
      expect(turned.map((t) => t.id)).toEqual(['fig-guards-1', 'fig-guards-2']);
    });

    test("then: 'neutral' calms a hostile", () => {
      const turned = fired(
        [{ on: 'featureTouched', target: 'lever', then: 'neutral' }],
        [{ on: 'featureTouched', target: 'lever' }],
        'hostile'
      );
      expect(turned.map((t) => t.side)).toEqual(['neutral', 'neutral']);
      expect(wary.linesOf(turned)).toEqual(['Guard 1 stands down.', 'Guard 2 stands down.']);
    });

    test('the events: a door forced and opened, an area walked into', () => {
      expect(wary.doorEvents('grating', 'locked', 'closed')).toEqual([
        { on: 'doorForced', target: 'grating' },
      ]);
      expect(wary.doorEvents('grating', 'locked', 'open', { keyed: true })).toEqual([
        { on: 'doorOpened', target: 'grating' },
      ]);
      const map = hulks(guards(c.block));
      expect(
        wary.walkEvents(map, { x: 8, y: 3 }, [
          { x: 9, y: 3 },
          { x: 10, y: 3 },
        ])
      ).toEqual([{ on: 'enteredArea', target: 'hold' }]);
    });

    test('forcing the grating in play turns the guards and starts the fight', () => {
      const world = worldOf(
        c.system,
        hulks(guards(c.block, { triggers: [{ on: 'doorForced', target: 'grating', then: 'hostile' }] }))
      );
      // Beside the grating, below it.
      const save = saveOf(c.system, { cell: { x: 8, y: 1 } });
      const r = evaluate(
        { verb: 'force', targets: ['door:grating'], params: {} },
        {},
        save,
        high,
        seen(world, save)
      );
      expect(r.constraints[0]).toMatch(/The lock gives way/);
      expect(set(r, 'sides.fig-guards-1')).toBe('hostile');
      expect(set(r, 'fight')).toMatchObject({ by: 'event' });
    });

    test('they are checked against the system and the map', () => {
      const map = hulks(guards(c.block));
      expect(
        wary.validateAgainst(c.system, map, {
          challenge: { says: 'Halt.', check: { skill: 'Juggling' } },
          triggers: [
            { on: 'doorForced', target: 'gate', then: 'hostile' },
            { on: 'enteredArea', then: 'angry' },
          ],
        })
      ).toEqual([
        expect.stringMatching(/triggers\[1\]\.then must be hostile or neutral/),
        expect.stringMatching(/triggers\[1\]\.target is required/),
        expect.stringMatching(/challenge\.check: the system has no skill "Juggling"/),
        expect.stringMatching(/triggers\[0\]\.target: The Hulks has no door "gate"/),
      ]);
    });
  });

  test('attacking one turns its group: they fight, and the fight starts at once', () => {
    const world = worldOf(c.system, hulks(guards(c.block)));
    const save = saveOf(c.system, { cell: { x: 4, y: 2 } });
    const r = evaluate(
      { verb: 'attack', targets: ['fig-guards-1'], params: {} },
      {},
      save,
      high,
      seen(world, save)
    );
    expect(set(r, 'sides.fig-guards-2')).toBe('hostile');
    const f = set(r, 'fight');
    expect(f).toMatchObject({ by: 'attack', turn: 'player' });
    expect(f.combatants['fig-guards-2']).toMatchObject({ side: 'hostile' });
  });

  test('those turned hostile in a fight under way join it', () => {
    const world = worldOf(
      c.system,
      hulks(guards(c.block, { triggers: [{ on: 'featureTouched', target: 'lever', then: 'hostile' }] }))
    );
    const save = saveOf(c.system, {
      cell: { x: 9, y: 5 },
      fight: {
        id: 'f',
        mapId: 'bm',
        by: 'seen',
        round: 1,
        order: ['player', 'rat'],
        turn: 'player',
        combatants: {
          player: { kind: 'player', side: 'party', name: 'Tam', initiative: 10, kept: 0 },
          rat: { kind: 'character', side: 'hostile', name: 'Rat', initiative: 5, kept: 0 },
        },
      },
    });
    const r = evaluate(
      { verb: 'use', targets: ['feature:lever'], params: {} },
      {},
      save,
      high,
      seen(world, save)
    );
    expect(r.constraints).toEqual(expect.arrayContaining(['Guard 1 joins the fight.']));
    expect(Object.keys(set(r, 'fight').combatants)).toEqual(
      expect.arrayContaining(['fig-guards-1', 'fig-guards-2'])
    );
  });
});
