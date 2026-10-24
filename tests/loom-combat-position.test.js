'use strict';

/**
 * Position and reactions (planning/combat.md §3 TN4, TN5, PS1–PS4, §4.3,
 * §4.5; L-823 / #655), pure, under both built-in systems (MD2): reach,
 * normal and long range, no line of sight refused, partial and heavy cover,
 * flanking off and on, Dodge, a defending reaction from a trait, an attack
 * drawn by leaving reach and Withdraw, and a readied attack's trigger.
 *
 * Run: cd tests && npx jest loom-combat-position --verbose
 */

const { validateSystem, BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const sight = require('../functions/loom-canon/sight');
const combat = require('../functions/loom-modules/combat');

const { position, reactions, strike, attackTurn, play, figures } = combat;
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
    // A d20 of 12 against Armour 10: cover raises it to 12 (partial, still a
    // hit) or 15 (heavy, a miss).
    shot: { attack: '1d20', face: 12 },
    defender: {},
    // Parry (+2 against melee): 11 against 10 is saved by it; 15 isn't.
    trait: 'parry',
    saved: '1d20',
    notSaved: '1d20 + 4',
    reactFace: 11,
    ranged: 'bow',
    melee: 'sword',
    long: { normal: 16, long: 64 },
    longTerm: '-5',
    dodgeTerm: '5',
    hard: '1d20 + 10',
    high: 20,
  },
  'pool-scifi': {
    system: SCIFI,
    // Four successes against two (a bar of 3): cover raises the bar to 4
    // (partial, still a hit) or 5 (heavy, a miss).
    shot: { attack: 'count(4d10, >= 7)', face: 9 },
    defender: { attributes: { Body: 2, Reflex: 2, Mind: 2, Presence: 2 } },
    // Combat Reflexes (+1 against all): three successes against two is saved
    // by it; four isn't.
    trait: 'combat_reflexes',
    saved: 'count(3d10, >= 7)',
    notSaved: 'count(4d10, >= 7)',
    reactFace: 9,
    ranged: 'pistol',
    melee: 'knife',
    long: { normal: 10, long: 30 },
    longTerm: '-1',
    dodgeTerm: '2',
    hard: 'count(6d10, >= 7)',
    high: 9,
  },
};

// A room 40 × 10, open unless given layers.
const room = (layers = {}) => ({
  id: 'bm',
  name: 'Room',
  width: 40,
  height: 10,
  entries: [{ id: 'in', x: 1, y: 5 }],
  exits: [{ id: 'out', name: 'the door', x: 0, y: 5, to: 'out' }],
  features: [],
  walls: [],
  doors: [],
  obstacles: [],
  ...layers,
});

describe.each(Object.keys(CASES))('position under %s', (id) => {
  const c = CASES[id];
  const system = c.system;
  const sheetWith = (patch = {}) => {
    const sheet = sheets.defaultSheet(system);
    return {
      ...sheet,
      ...patch,
      attributes: { ...sheet.attributes, ...(patch.attributes || {}) },
    };
  };

  test('the built-in settings: cover, long range and Dodge; no flanking', () => {
    expect(validateSystem(system).errors).toEqual([]);
    expect(combat.settings.settingsOf(system)).toMatchObject({
      longRange: c.longTerm,
      dodge: c.dodgeTerm,
      flanking: null,
    });
    expect(system.sheet.traits.find((t) => t.id === c.trait).reaction).toBeDefined();
  });

  describe('reach and range (PS1)', () => {
    test('melee within its reach; ranged normal, then long, then out', () => {
      const sword = { reach: 1 };
      const pike = { reach: 2 };
      const at = (x) => ({ x, y: 5 });
      expect(position.bandOf(sword, at(2), at(3))).toBe('reach');
      expect(position.bandOf(sword, at(2), at(4))).toBeNull();
      expect(position.bandOf(pike, at(2), at(4))).toBe('reach');
      const gun = { range: c.long };
      expect(position.bandOf(gun, at(0), at(c.long.normal))).toBe('normal');
      expect(position.bandOf(gun, at(0), at(c.long.normal + 1))).toBe('long');
      expect(position.bandOf(gun, at(0), { x: 0, y: 5 + c.long.long + 1 })).toBeNull();
      // Long range costs the system's term on the roll.
      const terms = position.termsFor(system, {
        map: room(),
        attack: gun,
        from: at(0),
        to: at(c.long.normal + 1),
      });
      expect(terms.bonus).toEqual([{ name: 'Long range', value: c.longTerm }]);
    });
  });

  describe('cover (PS2)', () => {
    test('through a low obstacle partial, a solid one heavy; open ground none', () => {
      const from = { x: 1, y: 5 };
      const to = { x: 7, y: 5 };
      expect(position.coverOf(room(), {}, from, to)).toBeNull();
      const low = room({ obstacles: [{ id: 'table', name: 'Table', kind: 'low', x: 4, y: 5 }] });
      expect(position.coverOf(low, {}, from, to)).toBe('partial');
      const solid = room({
        obstacles: [{ id: 'pillar', name: 'Pillar', kind: 'solid', x: 4, y: 5 }],
      });
      expect(position.coverOf(solid, {}, from, to)).toBe('heavy');
    });

    test('round a wall’s corner heavy, past its end partial', () => {
      // A wall down x = 4 from the top to y = 4.
      const map = room({
        walls: [
          {
            points: [
              { x: 4, y: 0 },
              { x: 4, y: 4 },
            ],
          },
        ],
      });
      const from = { x: 1, y: 2 };
      // Seen past the corner, but the line between centres crosses the wall.
      const round = { x: 7, y: 5 };
      expect(sight.inSight(map, from, {})['7,5']).toBe(true);
      expect(position.coverOf(map, {}, from, round)).toBe('heavy');
      // The line between centres grazes the wall's end.
      expect(position.coverOf(map, {}, { x: 1, y: 1 }, { x: 5, y: 5 })).toBe('partial');
      // Clear of it.
      expect(position.coverOf(map, {}, from, { x: 2, y: 8 })).toBeNull();
    });

    test('cover raises the defence: partial still hit, heavy a miss', () => {
      const attacker = { name: 'You', sheet: sheetWith() };
      const attack = { id: 'shot', name: 'Shot', range: { normal: 20, long: 40 }, ...c.shot };
      attack.damage = '1';
      const target = (guard) => ({ id: 'g', name: 'Grell', sheet: sheetWith(c.defender), guard });
      const read = (guard) =>
        strike.strike(system, {
          attacker,
          attack,
          targets: [target(guard)],
          dice: faces(c.shot.face),
        }).results[0];
      const settings = combat.settings.settingsOf(system);
      const none = read([]);
      const partial = read([{ name: 'Partial cover', value: settings.cover.partial }]);
      const heavy = read([{ name: 'Heavy cover', value: settings.cover.heavy }]);
      expect(none.hit).toBe(true);
      expect(partial.hit).toBe(true);
      expect(heavy.hit).toBe(false);
      expect(partial.difficulty).toBeGreaterThan(none.difficulty);
      expect(heavy.difficulty).toBeGreaterThan(partial.difficulty);
      // Named where the defence is shown.
      const shown = heavy.defenceLine || heavy.opposed.line;
      expect(shown).toContain('Heavy cover');
    });
  });

  describe('flanking (PS3)', () => {
    const from = { x: 4, y: 5 };
    const to = { x: 5, y: 5 };
    const friend = { x: 6, y: 5 };
    test('off in the built-in system: a friend opposite adds nothing', () => {
      const terms = position.termsFor(system, {
        map: room(),
        attack: { reach: 1 },
        from,
        to,
        friends: [friend],
      });
      expect(terms.flanked).toBe(false);
      expect(terms.bonus).toEqual([]);
    });
    test('on in a copy: a friend on the far side adds its term; beside, not', () => {
      const copy = copyOf(system);
      copy.id = 'my-copy';
      copy.modules.combat.flanking = '2';
      expect(validateSystem(copy).errors).toEqual([]);
      const terms = (friends) =>
        position.termsFor(copy, { map: room(), attack: { reach: 1 }, from, to, friends });
      expect(terms([friend]).bonus).toEqual([{ name: 'Flanking', value: '2' }]);
      expect(terms([{ x: 5, y: 6 }]).bonus).toEqual([]);
      // Never for a ranged attack.
      expect(
        position.termsFor(copy, {
          map: room(),
          attack: { range: { normal: 5, long: 10 } },
          from,
          to,
          friends: [friend],
        }).flanked
      ).toBe(false);
    });
  });

  describe('defending and Dodge (TN4, TN5)', () => {
    const attackOf = (formula, range) => ({
      id: 'a',
      name: 'Blow',
      ...(range ? { range: { normal: 10, long: 20 } } : { reach: 1 }),
      attack: formula,
      damage: '1',
    });
    const hitWith = (formula, { range = false, traits = [], guard = [] } = {}) => {
      const sheet = sheetWith({ ...c.defender, traits });
      const attack = attackOf(formula, range);
      const defend = position.defendOf(system, sheet, attack);
      return strike.strike(system, {
        attacker: { name: 'Grell', sheet: sheetWith() },
        attack,
        targets: [
          {
            id: 'player',
            name: 'you',
            sheet,
            guard,
            ...(defend ? { reaction: defend } : {}),
          },
        ],
        dice: faces(c.reactFace),
      }).results[0];
    };

    test('nobody has a reaction without a trait that gives one', () => {
      expect(position.defendOf(system, sheetWith(), attackOf(c.saved))).toBeNull();
      expect(hitWith(c.saved).hit).toBe(true);
    });

    test('a trait’s reaction turns a hit into a miss, and is used only then', () => {
      const saved = hitWith(c.saved, { traits: [c.trait] });
      expect(saved.hit).toBe(false);
      expect(saved.reacted).toMatchObject({ id: c.trait });
      expect(saved.lines[0]).toMatch(/^You use .+: Grell's blow misses\.$/);
      const notSaved = hitWith(c.notSaved, { traits: [c.trait] });
      expect(notSaved.hit).toBe(true);
      expect(notSaved.reacted).toBeUndefined();
    });

    test('against what the trait says: melee, ranged or all', () => {
      const sheet = sheetWith({ traits: [c.trait] });
      const ranged = position.defendOf(system, sheet, attackOf(c.saved, true));
      if (c.trait === 'parry') expect(ranged).toBeNull();
      else expect(ranged).toMatchObject({ id: c.trait });
    });

    test('Dodge adds the system’s term to the defence', () => {
      const terms = position.termsFor(system, {
        map: room(),
        attack: { reach: 1 },
        from: { x: 1, y: 1 },
        to: { x: 2, y: 1 },
        dodging: true,
      });
      expect(terms.guard).toEqual([{ name: 'Dodging', value: c.dodgeTerm }]);
      expect(hitWith(c.saved, { guard: terms.guard }).hit).toBe(false);
    });
  });

  describe('the player’s attack (attack-turn)', () => {
    const worldOf = (map, grell) => ({
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
      characters: {
        grell: {
          id: 'grell',
          name: 'Grell',
          locationId: 'ruin',
          side: 'hostile',
          sheet: sheetWith(c.defender),
          ...grell,
        },
      },
      battleMaps: { bm: map },
    });
    const save = {
      location: 'ruin',
      mapId: 'bm',
      cell: { x: 2, y: 5 },
      time: 0,
      character: { name: 'Tam', sheet: sheetWith() },
    };
    const turn = (world, params) =>
      attackTurn.attackTurn(figures.withFigures(world, save), save, {
        targetId: 'grell',
        params,
        dice: faces(c.high),
        rolled: (check, against) => ({ ...check, against }),
      });

    test('no line of sight: refused, nothing spent', () => {
      const walled = room({
        walls: [
          {
            points: [
              { x: 5, y: 0 },
              { x: 5, y: 10 },
            ],
          },
        ],
      });
      const shot = turn(worldOf(walled, { cell: { x: 8, y: 5 } }), { attack: c.ranged });
      expect(shot).toMatchObject({
        outcome: 'blocked',
        mutations: [],
        constraints: ["You don't see anyone like that here."],
      });
    });

    test('long range on the roll; cover on the defence', () => {
      const far = 2 + c.long.normal + 2;
      const map = room({ obstacles: [{ id: 'crate', name: 'Crate', kind: 'low', x: 4, y: 5 }] });
      const shot = turn(worldOf(map, { cell: { x: far, y: 5 } }), { attack: c.ranged });
      expect(shot.attack).toMatchObject({ long: true, cover: 'partial' });
      expect(shot.roll.line).toContain('Long range');
      const defence = shot.roll.rung || shot.opposed.roll.line;
      expect(defence).toContain('Partial cover');
    });
  });

  describe('reactions (PS4, TN4)', () => {
    const grellAttack = { id: 'club', name: 'Club', reach: 1, attack: c.hard, damage: '1' };
    const fightOf = (patch = {}) => ({
      id: 'f',
      mapId: 'bm',
      round: 2,
      order: ['player', 'grell'],
      turn: 'player',
      combatants: {
        // The AP each kept from their last turn, for reactions (L-833).
        player: { kind: 'player', side: 'party', name: 'Tam', kept: 20, ...patch.player },
        grell: {
          kind: 'character',
          side: 'hostile',
          name: 'Grell',
          kept: 20,
          ...patch.grell,
        },
      },
    });
    const grell = (cell) => ({
      id: 'grell',
      side: 'hostile',
      name: 'Grell',
      cell,
      sheet: sheetWith({ attacks: [grellAttack] }),
    });
    const you = (sheet = sheetWith()) => ({
      id: 'player',
      side: 'party',
      name: 'you',
      you: true,
      sheet,
    });
    const walk = (patch) =>
      reactions.reactToWalk(system, {
        map: room(),
        doors: {},
        fight: fightOf(),
        mover: you(),
        from: { x: 4, y: 5 },
        path: [
          { x: 3, y: 5 },
          { x: 2, y: 5 },
        ],
        fighters: [grell({ x: 5, y: 5 })],
        dice: faces(c.high),
        ...patch,
      });

    test('stepping out of a foe’s reach draws its attack, once, paid from what it kept', () => {
      const r = walk();
      expect(r.struck).toEqual([expect.objectContaining({ by: 'grell', attack: 'club' })]);
      expect(r.lines[0]).toBe("You leave Grell's reach.");
      // An attack's 10 AP (L-833).
      expect(r.fight.combatants.grell.kept).toBe(10);
      expect(r.reached).toBe(2);
      // Staying in reach draws nothing.
      expect(walk({ path: [{ x: 4, y: 6 }] }).struck).toEqual([]);
      // Nor does a foe who kept too little to pay for it.
      expect(walk({ fight: fightOf({ grell: { kept: 9 } }) }).struck).toEqual([]);
    });

    test('Withdraw: stepping away draws nothing', () => {
      expect(walk({ withdrawn: true }).struck).toEqual([]);
    });

    test('struck down leaving reach, they stop where they were struck', () => {
      const weak = sheetWith();
      weak.resources = { ...weak.resources, health: { current: 1 } };
      const r = walk({ mover: you(weak) });
      expect(r.down).toBeTruthy();
      expect(r.reached).toBe(0);
    });

    test('a readied attack goes off as a foe comes into its reach, from its reserved AP', () => {
      const ready = (target) =>
        fightOf({ player: { readied: { attack: c.melee, ...(target ? { target } : {}) } } });
      const r = reactions.reactToWalk(system, {
        map: room(),
        doors: {},
        fight: ready(),
        mover: { id: 'grell', side: 'hostile', name: 'Grell', sheet: sheetWith(c.defender) },
        from: { x: 6, y: 5 },
        path: [
          { x: 5, y: 5 },
          { x: 4, y: 5 },
          { x: 3, y: 5 },
        ],
        fighters: [
          { id: 'player', side: 'party', name: 'you', cell: { x: 2, y: 5 }, sheet: sheetWith() },
        ],
        dice: faces(c.high),
      });
      expect(r.struck).toEqual([expect.objectContaining({ by: 'player', attack: c.melee })]);
      expect(r.lines[0]).toBe(`Grell comes into your readied ${c.melee}.`);
      expect(r.fight.combatants.player.readied).toBeUndefined();
      // Paid when readied (L-833; KP3): what the player kept is untouched.
      expect(r.fight.combatants.player.kept).toBe(20);
      // Readied for someone else: Grell walks in untouched.
      const other = reactions.reactToWalk(system, {
        map: room(),
        doors: {},
        fight: ready('bandit'),
        mover: { id: 'grell', side: 'hostile', name: 'Grell', sheet: sheetWith(c.defender) },
        from: { x: 6, y: 5 },
        path: [
          { x: 5, y: 5 },
          { x: 4, y: 5 },
          { x: 3, y: 5 },
        ],
        fighters: [
          { id: 'player', side: 'party', name: 'you', cell: { x: 2, y: 5 }, sheet: sheetWith() },
        ],
        dice: faces(c.high),
      });
      expect(other.struck).toEqual([]);
    });

    test('the player’s Dodge and readied attack end when their turn comes round', () => {
      const world = {
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
        characters: {
          grell: {
            id: 'grell',
            name: 'Grell',
            locationId: 'ruin',
            side: 'hostile',
            cell: { x: 30, y: 5 },
            sheet: sheetWith({ attacks: [grellAttack] }),
          },
        },
        battleMaps: { bm: room() },
      };
      const save = {
        location: 'ruin',
        mapId: 'bm',
        cell: { x: 2, y: 5 },
        time: 0,
        character: { name: 'Tam', sheet: sheetWith() },
        fight: fightOf({ player: { dodging: true, readied: { attack: c.melee } } }),
      };
      const after = play.afterTurn(world, save, { dice: faces(1) });
      const f = after.mutations.find((m) => m.path === 'fight').value;
      expect(f.turn).toBe('player');
      expect(f.combatants.player.dodging).toBeUndefined();
      expect(f.combatants.player.readied).toBeUndefined();
    });
  });
});
