'use strict';

/**
 * Foes and named characters on AP (planning/action-points.md §3 FP2, §4.7;
 * L-836 / #686): tactics plan a turn that fits the pool, by role: a brute
 * closes and strikes, again while the AP lasts; a skirmisher strikes and
 * steps away with what's left; a guard strikes once and keeps the rest to
 * react; an archer shoots and readies a shot; a caster throws its area only
 * when it can pay for it; fleeing spends AP on its steps. A named
 * character's choices are only turns that fit, each with its cost. Pure,
 * under both built-in systems (MD2); the emulator suite (loom-foes-ap-play)
 * plays a round through loomPlayTurn.
 *
 * Run: cd tests && npx jest loom-foes-ap.test --verbose
 */

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const apRules = require('../functions/loom-canon/ap');
const combat = require('../functions/loom-modules/combat');
const tactics = require('../functions/loom-modules/combat/tactics');
const menu = require('../functions/loom-modules/combat/menu');
const reactions = require('../functions/loom-modules/combat/reactions');

const { others } = combat;
const copyOf = (v) => JSON.parse(JSON.stringify(v));
// Every die high: every blow lands.
const high = (sides) => sides;

const CASES = {
  'd20-fantasy': {
    system: BUILT_IN['d20-fantasy'],
    club: { id: 'club', name: 'Club', reach: 1, attack: '1d20 + 4', damage: '1d6', type: 'bludgeoning' },
    sling: {
      id: 'sling',
      name: 'Sling',
      range: { normal: 8, long: 16 },
      attack: '1d20 + 2',
      damage: '1d4',
      type: 'bludgeoning',
    },
    fire: {
      id: 'firebomb',
      name: 'Firebomb',
      range: { normal: 6, long: 12 },
      attack: '1d20 + 2',
      damage: '1d6',
      type: 'fire',
      area: { shape: 'burst', radius: 1 },
      ap: 15,
    },
  },
  'pool-scifi': {
    system: BUILT_IN['pool-scifi'],
    club: { id: 'club', name: 'Club', reach: 1, attack: 'count(4d10, >= 7)', damage: '1d2', type: 'kinetic' },
    sling: {
      id: 'sling',
      name: 'Sling',
      range: { normal: 8, long: 16 },
      attack: 'count(3d10, >= 7)',
      damage: '1d2',
      type: 'kinetic',
    },
    fire: {
      id: 'grenade',
      name: 'Grenade',
      range: { normal: 6, long: 12 },
      attack: 'count(3d10, >= 7)',
      damage: '1d3',
      type: 'fire',
      area: { shape: 'burst', radius: 1 },
      ap: 15,
    },
  },
};

// A hall, the way out at the west; the player at (2, 3).
const hall = (width = 12) => ({
  id: 'bm',
  name: 'Hall',
  width,
  height: 6,
  entries: [{ id: 'in', x: 1, y: 3 }],
  exits: [{ id: 'out', name: 'the door', x: 0, y: 3, to: 'out' }],
  features: [],
  walls: [],
  doors: [],
  obstacles: [],
});
const PLAYER_CELL = { x: 2, y: 3 };
const key = (cell) => cell.x + ',' + cell.y;
const away = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

describe.each(Object.keys(CASES))('foes on AP under %s', (id) => {
  const c = CASES[id];
  const system = c.system;
  const tough = () => {
    const sheet = sheets.defaultSheet(system);
    for (const r of system.sheet.resources) sheet.resources[r.id] = { current: 500 };
    return sheet;
  };
  const armed = () => ({ ...sheets.defaultSheet(system), attacks: [c.club, c.sling] });
  const player = () => ({ id: 'player', name: 'you', side: 'party', cell: PLAYER_CELL, sheet: tough(), max: 500 });

  // A fighter's turn as tactics plan it, with their pool and prices as
  // others.js gives them.
  const meOf = (patch = {}, sheet = sheets.defaultSheet(system)) => {
    const attacks = patch.attacks || [c.club];
    return {
      id: 'grell',
      side: 'hostile',
      role: 'brute',
      posture: 'steady',
      cell: { x: 3, y: 3 },
      ...others.apInputOf(system, sheet, attacks),
      speed: sheets.apFor(system, sheet),
      ...patch,
      attacks,
    };
  };
  const plan = (me, { foes = [player()], friends = [], map = hall() } = {}) =>
    tactics.planTurn({
      me,
      foes,
      friends,
      occupied: new Set(foes.concat(friends).map((f) => key(f.cell))),
      map,
      doors: {},
    });

  // A fight with Grell, a named character of the given role, beside the
  // player or away, the player's turn just ended.
  const worldOf = (grell, map = hall()) => ({
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
        cell: { x: 3, y: 3 },
        sheet: armed(),
        ...grell,
      },
    },
    battleMaps: { bm: map },
  });
  const saveOf = () => ({
    location: 'ruin',
    mapId: 'bm',
    cell: PLAYER_CELL,
    time: 1000,
    turn: { n: 1, ap: 0, kept: 0, plan: null },
    character: { name: 'Tam', sheet: tough() },
    fight: {
      id: 'f',
      mapId: 'bm',
      by: 'gm',
      round: 1,
      order: ['player', 'grell'],
      turn: 'player',
      combatants: {
        player: { kind: 'player', side: 'party', name: 'Tam', initiative: 20, kept: 0 },
        grell: { kind: 'character', side: 'hostile', name: 'Grell', initiative: 5, kept: 0 },
      },
    },
  });
  const playRound = (grell, map) =>
    others.playOthers(worldOf(grell, map), saveOf(), { dice: high, now: 1000 });

  test('each role’s turn stays within its AP, wherever it stands', () => {
    const cells = [
      { x: 3, y: 3 },
      { x: 6, y: 1 },
      { x: 9, y: 3 },
      { x: 11, y: 5 },
    ];
    for (const role of ['brute', 'skirmisher', 'archer', 'guard', 'caster']) {
      for (const cell of cells) {
        for (const pool of [20, 12, 6]) {
          const me = meOf({ role, cell, ap: pool, attacks: [c.club, c.sling, c.fire] });
          const p = plan(me);
          expect(p.spent).toBeGreaterThanOrEqual(0);
          expect(p.spent).toBeLessThanOrEqual(pool);
          // What it adds up to: its steps, its blows, its readied shot.
          const blows = p.attack ? (1 + p.repeat) * me.attackAp[p.attack.attack.id] : 0;
          const ready = p.ready ? me.attackAp[p.ready.id] : 0;
          expect(p.path.length + p.back.length + blows + ready).toBe(p.spent);
        }
      }
    }
  });

  test('a brute with AP for two blows strikes twice; one that must walk strikes once', () => {
    const beside = plan(meOf());
    expect(beside).toMatchObject({ path: [], repeat: 1, spent: 20 });
    expect(beside.attack).toMatchObject({ attack: { id: 'club' }, target: { id: 'player' } });
    const far = plan(meOf({ cell: { x: 8, y: 3 } }));
    expect(far.path).toHaveLength(5);
    expect(far).toMatchObject({ repeat: 0, spent: 15 });
    // An attack of its own cost: four blows of 5.
    const quick = { ...c.club, ap: 5 };
    expect(plan(meOf({ attacks: [quick], attackAp: { club: 5 } })).repeat).toBe(3);
    // Played: two blows, each its own card, nothing kept.
    const round = playRound({ role: 'brute' });
    const blows = round.turns.filter((t) => t.id === 'grell' && t.attack);
    expect(blows).toHaveLength(2);
    expect(blows[1].path).toEqual([]);
    expect(round.fight.combatants.grell.kept).toBe(0);
  });

  test('a skirmisher strikes, then steps out of reach with what’s left', () => {
    const p = plan(meOf({ role: 'skirmisher' }));
    expect(p.attack).not.toBeNull();
    expect(p.repeat).toBe(0);
    expect(p.back.length).toBeGreaterThan(0);
    expect(away(p.back[p.back.length - 1], PLAYER_CELL)).toBeGreaterThan(1);
    expect(p.spent).toBe(10 + p.back.length);
  });

  test('a guard strikes once and keeps the rest; its kept AP strikes the player leaving its reach', () => {
    expect(plan(meOf({ role: 'guard' }))).toMatchObject({ repeat: 0, spent: 10 });
    expect(plan(meOf({ role: 'guard', cell: { x: 8, y: 3 } }))).toMatchObject({
      path: [],
      attack: null,
      spent: 0,
    });
    const round = playRound({ role: 'guard' });
    expect(round.turns.filter((t) => t.attack)).toHaveLength(1);
    expect(round.fight.combatants.grell.kept).toBe(10);
    // The player steps away: the guard's kept 10 pays for its blow.
    const r = reactions.reactToWalk(system, {
      map: hall(),
      doors: {},
      fight: { ...round.fight, turn: 'player' },
      mover: { id: 'player', side: 'party', name: 'Tam', you: true, sheet: tough() },
      from: PLAYER_CELL,
      path: [{ x: 1, y: 3 }],
      fighters: [{ id: 'grell', side: 'hostile', name: 'Grell', cell: { x: 3, y: 3 }, sheet: armed() }],
      dice: high,
    });
    expect(r.struck).toEqual([expect.objectContaining({ by: 'grell', attack: 'club' })]);
    expect(r.fight.combatants.grell.kept).toBe(0);
  });

  test('an archer shoots and readies a shot with the rest; it fires at the first foe into its range', () => {
    const me = meOf({ role: 'archer', cell: { x: 8, y: 3 }, attacks: [c.club, c.sling] });
    const p = plan(me);
    expect(p).toMatchObject({ path: [], attack: { attack: { id: 'sling' } }, spent: 20 });
    expect(p.ready).toMatchObject({ id: 'sling' });
    // Short of AP for both: the shot only.
    expect(plan({ ...me, ap: 15 })).toMatchObject({ ready: null, spent: 10 });
    // Played: the sling readied, its AP set aside, nothing kept.
    const round = playRound({ role: 'archer', cell: { x: 8, y: 3 } });
    expect(round.fight.combatants.grell).toMatchObject({ readied: { attack: 'sling' }, kept: 0 });
    // The player comes into its range from beyond it: the readied shot goes off.
    const wide = hall(30);
    const r = reactions.reactToWalk(system, {
      map: wide,
      doors: {},
      fight: { ...round.fight, turn: 'player' },
      mover: { id: 'player', side: 'party', name: 'Tam', you: true, sheet: tough() },
      from: { x: 25, y: 3 },
      path: [{ x: 24, y: 3 }],
      fighters: [{ id: 'grell', side: 'hostile', name: 'Grell', cell: { x: 8, y: 3 }, sheet: armed() }],
      dice: high,
    });
    expect(r.struck).toEqual([expect.objectContaining({ by: 'grell', attack: 'sling' })]);
    expect(r.fight.combatants.grell.readied).toBeUndefined();
  });

  test('a readied shot never fired is lost when their turn comes round', () => {
    const round = playRound({ role: 'archer', cell: { x: 8, y: 3 } });
    expect(round.fight.combatants.grell.readied).toBeDefined();
    // Its next turn, standing guard out of reach: nothing struck, nothing
    // readied, the whole pool kept.
    const again = others.playOthers(
      worldOf({ role: 'guard', cell: { x: 8, y: 3 }, sheet: { ...armed(), attacks: [c.club] } }),
      { ...saveOf(), fight: { ...round.fight, turn: 'player' } },
      { dice: high, now: 1006 }
    );
    expect(again.fight.combatants.grell.readied).toBeUndefined();
    expect(again.fight.combatants.grell.kept).toBe(20);
  });

  test('a caster throws its area only when it can pay for it', () => {
    const me = meOf({
      role: 'caster',
      cell: { x: 7, y: 3 },
      attacks: [c.fire, c.club],
    });
    const foes = [player(), { ...player(), id: 'ally', cell: { x: 2, y: 2 } }];
    expect(plan(me, { foes })).toMatchObject({ attack: { attack: { id: c.fire.id } }, spent: 15 });
    expect(plan({ ...me, ap: 14 }, { foes }).attack).not.toMatchObject({
      attack: { id: c.fire.id },
    });
  });

  test('fleeing spends AP on its steps: twice as dear, half as far', () => {
    const me = meOf({ fleeing: true, cell: { x: 11, y: 3 } });
    const free = plan(me, { foes: [] });
    expect(free.path).toHaveLength(11);
    expect(free).toMatchObject({ fled: true, spent: 11 });
    const prone = plan({ ...me, prices: { move: 2, difficult: 4 } }, { foes: [] });
    expect(prone.path).toHaveLength(10);
    expect(prone.fled).toBe(false);
    expect(prone.spent).toBe(20);
  });

  test('a named character’s choices all fit their AP, each with its cost', () => {
    const input = (ap) => ({
      me: meOf({ cell: { x: 6, y: 3 }, attacks: [c.club, c.sling], ap }),
      foes: [player()],
      friends: [],
      occupied: new Set([key(PLAYER_CELL)]),
      map: hall(),
      doors: {},
    });
    for (const pool of [20, 9, 5]) {
      const choices = menu.choicesFor(input(pool));
      expect(choices.length).toBeGreaterThan(0);
      for (const o of choices) {
        expect(o.ap).toBeLessThanOrEqual(pool);
        expect(o.text).toMatch(/\(\d+ AP(, keeping \d+ to react)?\)$/);
      }
    }
    const full = menu.choicesFor(input(20)).map((o) => o.text);
    expect(full).toEqual(
      expect.arrayContaining([
        'move 3 squares and strike the player with your club (13 AP, keeping 7 to react)',
        'stay where you are and Dodge: harder to hit until your next turn (8 AP, keeping 12 to react)',
        'stay where you are (0 AP, keeping 20 to react)',
      ])
    );
    // Too little for a blow: no strikes or shots; too little for Dodge: none.
    const nine = menu.choicesFor(input(9)).map((o) => o.text);
    expect(nine.some((t) => /strike|shoot/.test(t))).toBe(false);
    expect(nine.some((t) => t.includes('Dodge'))).toBe(true);
    expect(menu.choicesFor(input(5)).some((o) => o.text.includes('Dodge'))).toBe(false);
  });

  test('with AP off (L-838), a turn is a walk and one attack, as before', () => {
    const off = { ...copyOf(system), id: 'my-copy', ap: false };
    expect(apRules.isOff(off)).toBe(true);
    const sheet = sheets.defaultSheet(off);
    expect(others.apInputOf(off, sheet, [c.club])).toEqual({});
    const p = plan({ ...meOf({}, sheet), ...{ ap: undefined, attackAp: undefined, prices: undefined }, speed: 6 });
    expect(p).toMatchObject({ repeat: 0, ready: null, spent: 0 });
    expect(p.attack).not.toBeNull();
  });
});
