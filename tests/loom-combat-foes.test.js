'use strict';

/**
 * Foes and allies (planning/combat.md §3 EN1–EN4, EN6, §4.6; L-824 / #656),
 * pure, under both built-in systems (MD2): figures placed from a stat block
 * and the world as a save sees them; tactics by role and posture; everyone
 * else's turns, with allies fighting by the same rules; morale breaking at
 * half a side down and at a leader's fall, by posture; the player knocked
 * out at 0 (until L-827).
 *
 * Run: cd tests && npx jest loom-combat-foes.test --verbose
 */

const { validateSystem, BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const combat = require('../functions/loom-modules/combat');

const { figures, tactics, others, play } = combat;
const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];
const copyOf = (v) => JSON.parse(JSON.stringify(v));

// Dice that roll these faces in turn, then the last one forever.
const faces = (...list) => {
  let i = 0;
  return (sides) => Math.min(sides, list[Math.min(i++, list.length - 1)]);
};

const CASES = {
  'd20-fantasy': {
    system: FANTASY,
    block: (patch = {}) => ({
      attributes: { STR: 12, DEX: 12, CON: 10, INT: 8, WIS: 8, CHA: 8 },
      attacks: [
        {
          id: 'club',
          name: 'Club',
          reach: 1,
          attack: '1d20 + mod(STR) + 2',
          damage: '1d6 + mod(STR)',
          type: 'bludgeoning',
        },
      ],
      ...patch,
    }),
    bow: {
      id: 'shortbow',
      name: 'Shortbow',
      range: { normal: 8, long: 16 },
      attack: '1d20 + mod(DEX) + 2',
      damage: '1d6',
      type: 'piercing',
    },
    fire: {
      id: 'firebomb',
      name: 'Firebomb',
      range: { normal: 6, long: 12 },
      attack: '1d20 + 2',
      damage: '1d6',
      type: 'fire',
      area: { shape: 'burst', radius: 1 },
    },
    high: 20,
    quick: { DEX: 18 },
  },
  'pool-scifi': {
    system: SCIFI,
    block: (patch = {}) => ({
      attributes: { Body: 3, Reflex: 3, Mind: 2, Presence: 2 },
      skills: { Melee: 2 },
      attacks: [
        {
          id: 'pipe',
          name: 'Pipe',
          reach: 1,
          attack: 'count((Body + Melee)d10, >= 7)',
          damage: '1d2',
          type: 'kinetic',
        },
      ],
      ...patch,
    }),
    bow: {
      id: 'carbine',
      name: 'Carbine',
      range: { normal: 8, long: 16 },
      attack: 'count((Reflex + Shooting)d10, >= 7)',
      damage: '1d3',
      type: 'energy',
    },
    fire: {
      id: 'grenade',
      name: 'Grenade',
      range: { normal: 6, long: 12 },
      attack: 'count((Reflex)d10, >= 7)',
      damage: '1d3',
      type: 'fire',
      area: { shape: 'burst', radius: 1 },
    },
    high: 10,
    quick: { Reflex: 5 },
  },
};

// A hall 10 × 6, the way out at the west; the player at (2, 3).
const hall = (groups) => ({
  id: 'bm',
  name: 'Hall',
  width: 10,
  height: 6,
  entries: [{ id: 'in', x: 1, y: 3 }],
  exits: [{ id: 'out', name: 'the door', x: 0, y: 3, to: 'out' }],
  features: [],
  walls: [],
  doors: [],
  obstacles: [],
  figures: groups,
});
const worldOf = (system, groups, characters = {}) => ({
  id: 'w',
  system,
  locations: {
    ruin: {
      id: 'ruin',
      name: 'Ruin',
      geo: { kind: 'poi', x: 1, y: 1 },
      battleMap: { mapId: 'bm' },
      connections: [],
    },
  },
  places: {},
  characters,
  battleMaps: { bm: hall(groups) },
});
const saveOf = (system, patch = {}) => ({
  location: 'ruin',
  mapId: 'bm',
  cell: { x: 2, y: 3 },
  time: 1000,
  character: { name: 'Tam', sheet: sheets.defaultSheet(system) },
  ...patch,
});

// Plays a fight to its end, or `rounds` rounds: each round the player waits.
// `before(save)` changes the fight once it has begun (someone falls).
function fightOut(world, save, dice, rounds = 10, before = null) {
  const apply = (muts) => {
    for (const m of muts) {
      if (m.path === 'fight') save.fight = m.value;
      else if (m.path === 'figures') save.figures = m.value;
      else if (m.path === 'character.sheet') save.character.sheet = m.value;
    }
  };
  const lines = [];
  const begun = play.begin(figures.withFigures(world, save), save, {
    by: 'seen',
    dice,
  });
  apply(begun.mutations);
  lines.push(...begun.lines);
  if (before && save.fight) before(save);
  let last = begun;
  for (let r = 0; r < rounds && save.fight; r++) {
    last = play.afterTurn(figures.withFigures(world, save), save, { dice });
    apply(last.mutations);
    lines.push(...last.lines);
  }
  return { lines, last, save };
}

// Someone falls once the fight has begun (the player's blow, say).
const fell =
  (...ids) =>
  (save) => {
    for (const id of ids) {
      save.fight = combat.fight.leave(save.fight, id, 'down');
      save.figures = {
        ...(save.figures || {}),
        [id]: { ...(save.figures || {})[id], down: 'dead' },
      };
    }
  };

describe.each(Object.keys(CASES))('foes under %s', (id) => {
  const c = CASES[id];
  const system = c.system;

  describe('figures', () => {
    test('placed from a stat block, numbered, standing at the place as characters do', () => {
      const group = {
        id: 'bandits',
        name: 'Bandit',
        statBlock: c.block(),
        cells: [
          { x: 8, y: 2 },
          { x: 8, y: 4 },
        ],
      };
      const world = worldOf(system, [group]);
      expect(figures.validateFigures(world, system, world.battleMaps.bm, [group])).toEqual([]);
      const seen = figures.withFigures(world, saveOf(system));
      expect(seen.characters['fig-bandits-1']).toMatchObject({
        name: 'Bandit 1',
        cell: { x: 8, y: 2 },
        side: 'hostile',
        locationId: 'ruin',
        figure: 'bandits',
      });
      expect(seen.characters['fig-bandits-2'].sheet.attacks[0].id).toBe(c.block().attacks[0].id);
      // One alone keeps its name.
      const one = figures.withFigures(
        worldOf(system, [{ ...group, cells: [{ x: 8, y: 2 }] }]),
        saveOf(system)
      );
      expect(one.characters['fig-bandits']).toMatchObject({ name: 'Bandit' });
      // Not on another map: nothing added.
      expect(figures.withFigures(world, saveOf(system, { mapId: null })).characters).toEqual({});
    });

    test('a save has them where they moved, and not once they’ve fled', () => {
      const group = {
        id: 'bandits',
        name: 'Bandit',
        statBlock: c.block(),
        cells: [
          { x: 8, y: 2 },
          { x: 8, y: 4 },
        ],
      };
      const world = worldOf(system, [group], {
        grell: { id: 'grell', name: 'Grell', locationId: 'ruin', cell: { x: 5, y: 5 } },
      });
      const seen = figures.withFigures(
        world,
        saveOf(system, {
          figures: {
            'fig-bandits-1': { cell: { x: 4, y: 2 } },
            'fig-bandits-2': { gone: 'fled' },
            grell: { cell: { x: 6, y: 5 } },
          },
        })
      );
      expect(seen.characters['fig-bandits-1'].cell).toEqual({ x: 4, y: 2 });
      expect(seen.characters['fig-bandits-2']).toMatchObject({ retired: true, gone: 'fled' });
      expect(seen.characters.grell.cell).toEqual({ x: 6, y: 5 });
      expect(world.characters.grell.cell).toEqual({ x: 5, y: 5 }); // canon untouched
    });

    test('refused: each problem said', () => {
      const world = worldOf(system, [], {
        grell: { id: 'grell', name: 'Grell', locationId: 'ruin', cell: { x: 5, y: 5 } },
      });
      const bad = [
        {
          id: 'Bandits',
          name: 'Bandit',
          statBlock: { attributes: {} },
          cells: [{ x: 0, y: 3 }],
          role: 'ninja',
        },
        {
          id: 'b',
          name: 'B',
          statBlock: c.block(),
          side: 'grumpy',
          cells: [
            { x: 5, y: 5 },
            { x: 1, y: 3 },
            { x: 12, y: 0 },
          ],
        },
        { id: 'c', name: 'C', statBlock: c.block(), cells: [{ x: 4, y: 4 }] },
        { id: 'd', name: 'D', statBlock: c.block(), cells: [{ x: 4, y: 4 }], posture: 'sleepy' },
      ];
      const errors = figures.validateFigures(world, system, world.battleMaps.bm, bad);
      expect(errors).toEqual(
        expect.arrayContaining([
          'figures[0].id must be lowercase letters, digits and dashes.',
          expect.stringMatching(/^figures\[0\]\.role must be one of brute/),
          expect.stringMatching(/^figures\[0\]\.statBlock: /),
          'figures[0].cells[0] (0, 3) is an exit.',
          'figures[1].side must be one of party, hostile, neutral.',
          'figures[1].cells[0] (5, 5): Grell stands there.',
          'figures[1].cells[1] (1, 3) is an entry, where players arrive.',
          'figures[1].cells[2] must be a square on the 10 × 6 grid.',
          'figures[3].cells[0] (4, 4): C stands there.',
          expect.stringMatching(/^figures\[3\]\.posture must be one of cowardly/),
        ])
      );
    });

    test('roles and postures by default: archer with a ranged attack, else brute; steady', () => {
      const brute = { sheet: sheets.sheetFromStatBlock(system, c.block()) };
      const archer = { sheet: sheets.sheetFromStatBlock(system, c.block({ attacks: [c.bow] })) };
      expect(figures.roleOf(system, brute)).toBe('brute');
      expect(figures.roleOf(system, archer)).toBe('archer');
      expect(figures.roleOf(system, { ...archer, role: 'guard' })).toBe('guard');
      expect(figures.postureOf({})).toBe('steady');
    });
  });

  describe('morale settings', () => {
    test('the built-in’s pass; bad ones are refused', () => {
      expect(validateSystem(system)).toMatchObject({ errors: [], warnings: [] });
      const s = { ...copyOf(system), id: 'my-copy' };
      s.modules.combat.morale = {
        check: { skill: 'Juggling' },
        rungs: { sleepy: 'Easy', steady: 'Trivial' },
      };
      expect(validateSystem(s).errors).toEqual([
        'modules.combat.morale.check.skill "Juggling" isn\'t one of the system\'s skills.',
        expect.stringMatching(/^modules\.combat\.morale\.rungs: "sleepy" isn't a posture/),
        'modules.combat.morale.rungs.steady: "Trivial" isn\'t a rung on the ladder.',
      ]);
    });
  });

  describe('tactics', () => {
    const map = hall([]);
    const fighter = (patch) => ({
      id: 'me',
      cell: { x: 8, y: 3 },
      side: 'hostile',
      role: 'brute',
      posture: 'steady',
      attacks: [c.block().attacks[0], c.bow].map((a) => ({ ...a, lethal: true })),
      speed: 6,
      ...patch,
    });
    const foe = (id, cell, current = 6) => ({
      id,
      cell,
      max: 6,
      sheet: { resources: { health: { current } } },
    });
    const occupied = (...cells) => new Set(cells.map((cell) => cell.x + ',' + cell.y));
    const plan = (me, foes, extra = {}) =>
      tactics.planTurn({
        me,
        foes,
        occupied: occupied(...foes.map((f) => f.cell), ...(extra.blocked || [])),
        map,
        ...extra,
      });

    test('a brute closes in and strikes with its melee attack', () => {
      const p = plan(fighter({ attacks: [c.block().attacks[0]] }), [foe('player', { x: 2, y: 3 })]);
      const end = p.path[p.path.length - 1];
      expect(Math.max(Math.abs(end.x - 2), Math.abs(end.y - 3))).toBe(1);
      expect(p.attack).toMatchObject({
        attack: { id: c.block().attacks[0].id },
        target: { id: 'player' },
      });
    });

    test('around whoever stands in the way', () => {
      const p = plan(
        fighter({ attacks: [c.block().attacks[0]] }),
        [foe('player', { x: 2, y: 3 })],
        {
          blocked: [{ x: 3, y: 3 }],
        }
      );
      const end = p.path[p.path.length - 1];
      expect(Math.max(Math.abs(end.x - 2), Math.abs(end.y - 3))).toBe(1);
      expect(end).not.toEqual({ x: 3, y: 3 });
      expect(p.attack).not.toBeNull();
    });

    test('a skirmisher strikes and steps back out of reach', () => {
      const p = plan(fighter({ role: 'skirmisher', attacks: [c.block().attacks[0]] }), [
        foe('player', { x: 2, y: 3 }),
      ]);
      expect(p.attack).not.toBeNull();
      expect(p.back.length).toBeGreaterThan(0);
      const end = p.back[p.back.length - 1];
      expect(Math.max(Math.abs(end.x - 2), Math.abs(end.y - 3))).toBeGreaterThan(1);
    });

    test('an archer shoots from where it stands; beside a foe it steps away first', () => {
      const far = plan(fighter({ role: 'archer' }), [foe('player', { x: 2, y: 3 })]);
      expect(far.path).toEqual([]);
      expect(far.attack).toMatchObject({ attack: { id: c.bow.id } });
      const near = plan(fighter({ role: 'archer', cell: { x: 3, y: 3 } }), [
        foe('player', { x: 2, y: 3 }),
      ]);
      const end = near.path[near.path.length - 1];
      expect(Math.max(Math.abs(end.x - 2), Math.abs(end.y - 3))).toBeGreaterThan(1);
      expect(near.attack).toMatchObject({ attack: { id: c.bow.id } });
    });

    test('a guard holds its square', () => {
      const p = plan(fighter({ role: 'guard', attacks: [c.block().attacks[0]] }), [
        foe('player', { x: 2, y: 3 }),
      ]);
      expect(p).toMatchObject({ path: [], attack: null });
      const reach = plan(
        fighter({ role: 'guard', cell: { x: 3, y: 3 }, attacks: [c.block().attacks[0]] }),
        [foe('player', { x: 2, y: 3 })]
      );
      expect(reach.attack).not.toBeNull();
    });

    test('a caster throws its area where it catches foes and no friends', () => {
      const me = fighter({
        role: 'caster',
        attacks: [c.fire, c.block().attacks[0]].map((a) => ({ ...a, lethal: true })),
      });
      const p = plan(me, [foe('player', { x: 3, y: 3 }), foe('ally', { x: 3, y: 2 })]);
      expect(p.attack).toMatchObject({ attack: { id: c.fire.id } });
      // A friend in the blast: no area.
      const careful = tactics.planTurn({
        me,
        foes: [foe('player', { x: 3, y: 3 })],
        friends: [{ id: 'pal', cell: { x: 3, y: 4 } }],
        occupied: occupied({ x: 3, y: 3 }, { x: 3, y: 4 }),
        map,
      });
      expect(careful.attack && careful.attack.attack.id).not.toBe(c.fire.id);
    });

    test('posture picks the target: the cowardly the weakest, the reckless the player', () => {
      const foes = [foe('player', { x: 2, y: 3 }), foe('ally', { x: 7, y: 1 }, 1)];
      expect(plan(fighter({ posture: 'cowardly' }), foes).attack.target.id).toBe('ally');
      expect(plan(fighter({ posture: 'steady' }), foes).attack.target.id).toBe('ally'); // nearest
      expect(plan(fighter({ posture: 'reckless' }), foes).attack.target.id).toBe('player');
    });

    test('fleeing: for the way out, and off the map when it gets there', () => {
      const p = plan(fighter({ fleeing: true, cell: { x: 3, y: 3 } }), [
        foe('player', { x: 5, y: 5 }),
      ]);
      expect(p.fled).toBe(true);
      expect(p.path[p.path.length - 1]).toEqual({ x: 0, y: 3 });
    });
  });

  describe('everyone else’s turns', () => {
    test('foes close in and attack the player, in order, each round', () => {
      const group = {
        id: 'bandits',
        name: 'Bandit',
        statBlock: c.block(),
        cells: [
          { x: 8, y: 2 },
          { x: 8, y: 4 },
        ],
      };
      const world = worldOf(system, [group]);
      const { lines, save } = fightOut(world, saveOf(system), faces(5), 1);
      expect(lines.join(' ')).toMatch(/Bandit [12] (misses|hits) you/);
      // They moved up to the player, in the save.
      for (const fid of ['fig-bandits-1', 'fig-bandits-2']) {
        const cell = save.figures[fid].cell;
        expect(Math.max(Math.abs(cell.x - 2), Math.abs(cell.y - 3))).toBe(1);
      }
    });

    test('allies fight the player’s foes by the same rules', () => {
      const world = worldOf(system, [
        { id: 'bandit', name: 'Bandit', statBlock: c.block(), cells: [{ x: 8, y: 3 }] },
        // Quicker than the bandit, so it acts first.
        {
          id: 'pals',
          name: 'Guard',
          side: 'party',
          statBlock: c.block({ attributes: { ...c.block().attributes, ...c.quick } }),
          cells: [{ x: 6, y: 1 }],
        },
      ]);
      const { lines } = fightOut(world, saveOf(system), faces(c.high), 1);
      expect(lines.join(' ')).toMatch(/Guard hits Bandit with their/);
    });

    test('the player at 0 falls by the system’s down kind; the fight ends, foes the winners', () => {
      const world = worldOf(system, [
        {
          id: 'brutes',
          name: 'Brute',
          statBlock: c.block(),
          cells: [
            { x: 3, y: 3 },
            { x: 3, y: 2 },
            { x: 3, y: 4 },
          ],
        },
      ]);
      const { lines, last, save } = fightOut(world, saveOf(system), faces(c.high), 6);
      expect(save.fight).toBeNull();
      expect(last.fight).toMatchObject({ ended: true, winner: 'hostile' });
      if (id === 'd20-fantasy') {
        // Dying, death on: every save a 20 holds; left for dead, they come round.
        expect(lines).toContain('You fall, dying.');
        expect(lines).toContain('A dying save holds (3 of 3). You are stable.');
        expect(last.fallen).toEqual({ outcome: 'wake' });
      } else {
        // Out at once, death off: a fate for NARRATE to choose.
        expect(lines).toContain('You fall, out cold.');
        expect(last.fallen).toMatchObject({ outcome: 'fate', hours: 4 });
      }
    });

    test('morale: with half their side down, the rest roll; failing, they run', () => {
      const world = worldOf(system, [
        {
          id: 'bandits',
          name: 'Bandit',
          posture: 'cowardly',
          statBlock: c.block(),
          cells: [
            { x: 8, y: 2 },
            { x: 8, y: 4 },
          ],
        },
      ]);
      // Every die a 1: the morale roll fails.
      const { lines, save: after } = fightOut(
        world,
        saveOf(system),
        faces(1),
        6,
        fell('fig-bandits-1')
      );
      expect(lines).toContain('Bandit 2 breaks and runs.');
      expect(lines).toContain('Bandit 2 flees.');
      expect(after.figures['fig-bandits-2']).toMatchObject({ gone: 'fled' });
      expect(after.fight).toBeNull();
    });

    test('morale: the reckless never break; a leader’s fall shakes the rest', () => {
      const reckless = worldOf(system, [
        {
          id: 'bandits',
          name: 'Bandit',
          posture: 'reckless',
          statBlock: c.block(),
          cells: [
            { x: 8, y: 2 },
            { x: 8, y: 4 },
          ],
        },
      ]);
      const held = fightOut(reckless, saveOf(system), faces(1), 2, fell('fig-bandits-1'));
      expect(held.lines.join(' ')).not.toMatch(/breaks and runs|throws down/);
      const led = worldOf(system, [
        { id: 'boss', name: 'Chief', leader: true, statBlock: c.block(), cells: [{ x: 9, y: 0 }] },
        {
          id: 'bandits',
          name: 'Bandit',
          posture: 'cautious',
          statBlock: c.block(),
          cells: [
            { x: 8, y: 2 },
            { x: 8, y: 4 },
            { x: 9, y: 5 },
          ],
        },
      ]);
      const shaken = fightOut(led, saveOf(system), faces(1), 1, fell('fig-boss'));
      expect(shaken.lines.filter((l) => / breaks and runs\.$/.test(l)).length).toBe(3);
    });

    test('with no way off the map, a broken foe surrenders', () => {
      const world = worldOf(system, [
        {
          id: 'bandits',
          name: 'Bandit',
          posture: 'cowardly',
          statBlock: c.block(),
          cells: [
            { x: 8, y: 2 },
            { x: 8, y: 4 },
          ],
        },
      ]);
      world.battleMaps.bm.exits = [];
      const { lines, save } = fightOut(world, saveOf(system), faces(1), 2, fell('fig-bandits-1'));
      expect(lines).toContain('Bandit 2 throws down their weapons.');
      expect(lines).toContain('The fight is over: your foes fell or surrendered.');
      expect(save.fight).toBeNull();
    });

    test('a cowardly fighter nearly done for runs without a roll', () => {
      const hurt = sheets.sheetFromStatBlock(system, c.block());
      hurt.resources.health.current = 1;
      const world = worldOf(system, [
        {
          id: 'bandit',
          name: 'Bandit',
          posture: 'cowardly',
          statBlock: c.block(),
          cells: [{ x: 8, y: 3 }],
        },
      ]);
      const { lines } = fightOut(
        world,
        saveOf(system, { figures: { 'fig-bandit': { sheet: hurt } } }),
        faces(c.high),
        1
      );
      expect(lines).toContain('Bandit breaks and runs.');
    });
  });
});
