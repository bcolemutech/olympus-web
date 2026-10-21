'use strict';

/**
 * The combat module's fights (planning/combat.md §3 TN1–TN3, SE2, SE4, §4.1,
 * §4.2; L-821 / #653), pure, under both built-in systems (MD2): its settings
 * checked on a system's save, initiative and its ties, surprise, the order
 * of turns across rounds, and ending.
 *
 * Run: cd tests && npx jest loom-combat.test --verbose
 */

const { validateSystem, BUILT_IN } = require('../functions/loom-canon/systems');
const combat = require('../functions/loom-modules/combat');
const { fight } = combat;

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
    quick: { attributes: { DEX: 16 } }, // +3
    slow: { attributes: { DEX: 8 } }, // -1
    sneaky: { attributes: { DEX: 18 }, skills: { Stealth: 6 } },
    initiative: '1d20 + mod(DEX)',
    tieBreak: 'DEX',
    high: 20,
  },
  'pool-scifi': {
    system: SCIFI,
    quick: { attributes: { Reflex: 5 } },
    slow: { attributes: { Reflex: 1 } },
    sneaky: { attributes: { Reflex: 5 }, skills: { Stealth: 3 } },
    initiative: 'count((Reflex)d10, >= 7)',
    tieBreak: 'Reflex',
    high: 10,
  },
};

describe.each(Object.keys(CASES))('combat under %s', (id) => {
  const c = CASES[id];
  const sys = c.system;
  const player = (sheet = null) => ({ id: 'player', kind: 'player', name: 'Tam', sheet });
  const foe = (fid, name, sheet = null) => ({
    id: fid,
    kind: 'character',
    side: 'hostile',
    name,
    sheet,
  });

  describe('settings', () => {
    test('the built-in system’s combat settings pass, with nothing warned', () => {
      const result = validateSystem(sys);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(combat.settings.settingsOf(sys)).toMatchObject({
        initiative: { formula: c.initiative, tieBreak: c.tieBreak },
        economy: { actions: 1, reactions: 1, quick: 0 },
        surprise: expect.objectContaining({ hide: { skill: 'Stealth' } }),
      });
    });

    test('bad settings are refused, each said', () => {
      const s = { ...copyOf(sys), id: 'my-copy' };
      s.modules.combat = {
        initiative: { formula: c.initiative, tieBreak: 'Luck' },
        economy: { actions: 0, sneezes: 1 },
        surprise: { hide: { skill: 'Juggling' }, notice: 'eyes' },
        tactics: true,
      };
      const { errors } = validateSystem(s);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('"tactics" isn\'t a combat setting'),
          expect.stringContaining('initiative.tieBreak "Luck"'),
          expect.stringContaining('economy.actions must be a whole number from 1 to 5'),
          expect.stringContaining('economy: "sneezes" isn\'t part of a turn'),
          expect.stringContaining('surprise.hide.skill "Juggling"'),
          expect.stringContaining('surprise.notice must be { skill } or { attribute }'),
        ])
      );
    });

    test('an initiative formula is checked like any other', () => {
      const s = { ...copyOf(sys), id: 'my-copy' };
      s.modules.combat.initiative.formula = '1d20 + Luck';
      expect(validateSystem(s).errors.join(' ')).toContain('modules.combat.initiative.formula');
      s.modules.combat.initiative.formula = '1d20 > 3';
      expect(validateSystem(s).errors.join(' ')).toContain('must come to a number');
    });

    test('settings for later stories are kept, with a warning', () => {
      const s = { ...copyOf(sys), id: 'my-copy' };
      s.modules.combat.cover = { partial: '-2' };
      const result = validateSystem(s);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([
        'modules.combat.cover is used from L-823; it is kept, unused.',
      ]);
    });

    test('a system with no combat settings fights by the defaults', () => {
      const s = { ...copyOf(sys), modules: {} };
      expect(combat.settings.settingsOf(s)).toEqual({
        initiative: { formula: '1d20', tieBreak: null },
        economy: { actions: 1, reactions: 1, quick: 0 },
        surprise: null,
        // Attacks against the ladder's second rung (L-822).
        attack: {
          hit: 'defence',
          defence: sys.checks.ladder[1].value,
          defend: null,
          critical: 'none',
          extraSuccesses: 'none',
        },
        health: 'health',
        subduePenalty: null,
        morale: null,
      });
    });
  });

  describe('initiative', () => {
    test('the system’s formula on the sheet, each term named', () => {
      const roll = fight.rollInitiative(sys, player(c.quick), faces(8));
      expect(roll.formula).toBe(c.initiative);
      if (id === 'd20-fantasy') {
        expect(roll.total).toBe(11);
        expect(roll.line).toBe('d20 (8) + Dexterity (3)');
      } else {
        expect(roll.total).toBe(5); // five dice of 8, each a success
        expect(roll.line).toContain('Reflex (5)');
      }
      expect(roll.tie).toBe(c.quick.attributes[c.tieBreak]);
    });

    test('highest first; ties to the higher tie-break score, then the player', () => {
      const entries = {
        player: { initiative: 10, tie: 12, name: 'Tam' },
        a: { initiative: 10, tie: 14, name: 'Ash' },
        b: { initiative: 10, tie: 12, name: 'Bo' },
        c: { initiative: 15, tie: 1, name: 'Cy' },
        d: { initiative: 3, tie: 20, name: 'Di' },
      };
      expect(fight.orderOf(entries)).toEqual(['c', 'a', 'player', 'b', 'd']);
    });
  });

  describe('a fight', () => {
    const three = (sheets = {}) => [
      player(sheets.player || null),
      foe('bandit', 'Bandit', sheets.bandit || null),
      foe('thug', 'Thug', sheets.thug || null),
    ];

    test('starts in round 1 at the first in the order, everyone rolled once', () => {
      const started = fight.start(sys, {
        id: 'f',
        mapId: 'm',
        by: 'gm',
        combatants: three({ player: c.slow, bandit: c.quick }),
        dice: faces(c.high),
      });
      const f = started.fight;
      expect(f.round).toBe(1);
      expect(f.order[0]).toBe('bandit');
      expect(f.order[f.order.length - 1]).toBe('player');
      expect(f.turn).toBe('bandit');
      expect(Object.keys(started.initiative).sort()).toEqual(['bandit', 'player', 'thug']);
      expect(f.combatants.player).toMatchObject({ side: 'party', reactionsLeft: 1 });
      expect(f.combatants.bandit).toMatchObject({ side: 'hostile', name: 'Bandit' });
    });

    test('the others’ turns, to the player’s, then round after round', () => {
      const { fight: f } = fight.start(sys, {
        id: 'f',
        mapId: 'm',
        by: 'gm',
        combatants: three({ player: c.slow, bandit: c.quick }),
        dice: faces(c.high),
      });
      const first = fight.toPlayer(sys, f, { current: true });
      expect(first.fight.turn).toBe('player');
      expect(first.fight.round).toBe(1);
      expect(first.passed).toEqual(f.order.slice(0, f.order.indexOf('player')));
      const second = fight.toPlayer(sys, first.fight);
      expect(second.fight.turn).toBe('player');
      expect(second.fight.round).toBe(2);
      expect(second.rounds).toBe(1);
      expect(second.passed).toEqual(f.order.filter((x) => x !== 'player'));
    });

    test('reactions refresh each round', () => {
      const { fight: f } = fight.start(sys, {
        id: 'f',
        mapId: 'm',
        by: 'gm',
        combatants: three(),
        dice: faces(5),
      });
      f.combatants.bandit.reactionsLeft = 0;
      const on = fight.toPlayer(sys, fight.toPlayer(sys, f, { current: true }).fight).fight;
      expect(on.combatants.bandit.reactionsLeft).toBe(1);
    });

    test('surprise: the ambushed who don’t notice the hiders lose the first round', () => {
      // The foes hide well; the player, untrained, rolls low.
      const started = fight.start(sys, {
        id: 'f',
        mapId: 'm',
        by: 'seen',
        ambushers: 'hostile',
        combatants: three({ bandit: c.sneaky, thug: c.sneaky }),
        dice: faces(c.high - 1),
      });
      expect(started.surprise.surprised).toEqual(['player']);
      expect(started.surprise.hide.roll.skillId).toBe('Stealth');
      expect(started.surprise.notice.player.success).toBe(false);
      const played = fight.toPlayer(sys, started.fight, { current: true });
      // Round 1 passes without them.
      expect(played.fight.turn).toBe('player');
      expect(played.fight.round).toBe(2);
      expect(played.fight.combatants.player.surprised).toBeUndefined();
    });

    test('surprise: noticing the worst hider is enough', () => {
      // One foe can't hide: the player meets their roll.
      const started = fight.start(sys, {
        id: 'f',
        mapId: 'm',
        by: 'seen',
        ambushers: 'hostile',
        combatants: three({ bandit: c.sneaky, thug: c.slow }),
        dice: faces(c.high - 1),
      });
      expect(started.surprise.hide.id).toBe('thug');
      expect(started.surprise.surprised).toEqual([]);
    });

    test('with no surprise settings, nobody is surprised', () => {
      const s = { ...copyOf(sys), modules: { combat: { initiative: { formula: '1d20' } } } };
      const started = fight.start(s, {
        id: 'f',
        mapId: 'm',
        by: 'seen',
        ambushers: 'hostile',
        combatants: three({ bandit: c.sneaky }),
        dice: faces(1),
      });
      expect(started.surprise.surprised).toEqual([]);
    });

    test('ends when one side has nobody left in it', () => {
      const { fight: f } = fight.start(sys, {
        id: 'f',
        mapId: 'm',
        by: 'gm',
        combatants: three(),
        dice: faces(5),
      });
      expect(fight.endOf(f)).toBeNull();
      const one = fight.leave(f, 'bandit', 'fled');
      expect(fight.endOf(one)).toBeNull();
      // Someone out takes no more turns.
      const turns = fight.toPlayer(sys, fight.toPlayer(sys, one, { current: true }).fight);
      expect(turns.passed).toEqual(['thug']);
      expect(fight.endOf(fight.leave(one, 'thug', 'talkedDown'))).toEqual({
        winner: 'party',
        how: ['fled', 'talkedDown'],
      });
      expect(fight.endOf(fight.leave(f, 'player', 'fled'))).toEqual({
        winner: 'hostile',
        how: ['fled'],
      });
      expect(() => fight.leave(f, 'thug', 'bored')).toThrow();
    });
  });
});
