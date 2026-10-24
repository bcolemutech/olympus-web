'use strict';

/**
 * Off your turn (planning/action-points.md §3 KP1–KP4, TO1, §4.4; L-833 /
 * #683): what a fighter doesn't spend on their turn is kept, and pays their
 * reactions until their next turn, as many as it covers; a system's
 * `ap.keepLimit` caps it; Ready sets its attack's cost aside, which a
 * readied attack fires from, or is lost at the next turn. Pure, and by the
 * two-configuration rule (MD2) under both built-in systems; the emulator
 * suite (loom-reactions-ap-play) plays it through loomPlayTurn.
 *
 * Run: cd tests && npx jest loom-reactions-ap.test --verbose
 */

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const reactions = require('../functions/loom-modules/combat/reactions');
const { keptFrom } = require('../functions/loom-modules/combat/others');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { nextTurnState } = require('../functions/loom-models');

const copyOf = (v) => JSON.parse(JSON.stringify(v));
// Every die high: every blow lands.
const high = (sides) => sides;

const ROOM = {
  id: 'bm',
  name: 'A yard',
  width: 10,
  height: 6,
  entries: [{ id: 'in', x: 0, y: 2 }],
  exits: [{ id: 'out', name: 'the gate', x: 0, y: 3, to: 'out' }],
  features: [],
};

describe.each([
  ['d20-fantasy', BUILT_IN['d20-fantasy']],
  ['pool-scifi', BUILT_IN['pool-scifi']],
])('off your turn under %s', (id, system) => {
  // Tough foes, so a blow doesn't end the walk.
  const tough = () => {
    const sheet = sheets.defaultSheet(system);
    for (const r of system.sheet.resources) sheet.resources[r.id] = { current: 500 };
    return sheet;
  };
  const fightOf = (kept, more = {}) => ({
    id: 'f',
    mapId: 'bm',
    round: 2,
    order: ['player', 'a', 'b', 'c'],
    turn: 'a',
    combatants: {
      player: { kind: 'player', side: 'party', name: 'Tam', kept, ...more },
      a: { kind: 'character', side: 'hostile', name: 'Ash', kept: 0 },
      b: { kind: 'character', side: 'hostile', name: 'Bel', kept: 0 },
      c: { kind: 'character', side: 'hostile', name: 'Cor', kept: 0 },
    },
  });
  const player = { id: 'player', side: 'party', name: 'you', cell: { x: 5, y: 2 } };
  // Foe `id` steps from beside the player to two squares away.
  const stepAway = (f, foe) =>
    reactions.reactToWalk(system, {
      map: ROOM,
      doors: {},
      fight: f,
      mover: { id: foe, side: 'hostile', name: foe, sheet: tough() },
      from: { x: 6, y: 2 },
      path: [{ x: 7, y: 2 }],
      fighters: [{ ...player, sheet: sheets.defaultSheet(system) }],
      dice: high,
    });

  test('kept AP pays for two reactions when it covers them, and refuses a third', () => {
    let f = fightOf(20);
    const first = stepAway(f, 'a');
    expect(first.struck).toEqual([expect.objectContaining({ by: 'player' })]);
    expect(first.fight.combatants.player.kept).toBe(10);
    f = first.fight;
    const second = stepAway(f, 'b');
    expect(second.struck).toHaveLength(1);
    expect(second.fight.combatants.player.kept).toBe(0);
    const third = stepAway(second.fight, 'c');
    expect(third.struck).toEqual([]);
    expect(third.lines).toEqual([]);
  });

  test('an attack with its own cost costs that off your turn too', () => {
    const cheap = copyOf(system);
    cheap.modules.combat.attacks = cheap.modules.combat.attacks.map((a) => ({ ...a, ap: 7 }));
    const r = reactions.reactToWalk(cheap, {
      map: ROOM,
      doors: {},
      fight: fightOf(20),
      mover: { id: 'a', side: 'hostile', name: 'Ash', sheet: tough() },
      from: { x: 6, y: 2 },
      path: [{ x: 7, y: 2 }],
      fighters: [{ ...player, sheet: sheets.defaultSheet(cheap) }],
      dice: high,
    });
    expect(r.fight.combatants.player.kept).toBe(13);
  });

  test('a system’s keep limit caps what is kept', () => {
    expect(keptFrom(system, 15)).toBe(15);
    expect(keptFrom(system, -2)).toBe(0);
    const capped = { ...copyOf(system), ap: { ...system.ap, keepLimit: 8 } };
    expect(keptFrom(capped, 15)).toBe(8);
    // Eight kept won't pay for a 10 AP attack.
    expect(stepAway(fightOf(keptFrom(capped, 15)), 'a').struck).toEqual([]);
  });

  test('Ready sets its attack’s cost aside; the readied attack fires from it', () => {
    const world = {
      id: 'w',
      system,
      locations: { yard: { id: 'yard', name: 'The yard', battleMap: { mapId: 'bm' } } },
      battleMaps: { bm: ROOM },
      characters: {},
    };
    const sheet = sheets.defaultSheet(system);
    const save = {
      location: 'yard',
      mapId: 'bm',
      cell: { x: 5, y: 2 },
      character: { name: 'Tam', sheet },
      turn: { n: 1, ap: 20, kept: 0, plan: null },
      fight: fightOf(0, {}),
    };
    save.fight.turn = 'player';
    const readied = evaluate({ verb: 'ready', targets: [], params: {} }, {}, save, 10, world);
    const turn = readied.mutations.find((m) => m.path === 'turn').value;
    expect(turn).toMatchObject({ ap: 10, reserved: 10 });
    const f = readied.mutations.find((m) => m.path === 'fight').value;
    expect(f.combatants.player.readied).toBeDefined();
    // A foe walks into its reach: it goes off, with nothing kept besides.
    const r = reactions.reactToWalk(system, {
      map: ROOM,
      doors: {},
      fight: { ...f, turn: 'a' },
      mover: { id: 'a', side: 'hostile', name: 'Ash', sheet: tough() },
      from: { x: 8, y: 2 },
      path: [
        { x: 7, y: 2 },
        { x: 6, y: 2 },
      ],
      fighters: [{ ...player, sheet }],
      dice: high,
    });
    expect(r.struck).toEqual([expect.objectContaining({ by: 'player' })]);
    expect(r.fight.combatants.player.readied).toBeUndefined();
    expect(r.fight.combatants.player.kept).toBe(0);
  });

  test('a readied attack never triggered is lost at the next turn', () => {
    const now = {
      character: { name: 'Tam', sheet: sheets.defaultSheet(system) },
      turn: { n: 3, ap: 0, kept: 0, plan: null, reserved: 10 },
    };
    const next = nextTurnState(now);
    expect(next).toEqual({ n: 4, ap: 20, kept: 0, plan: null });
    expect(next.reserved).toBeUndefined();
  });

  test('a defending reaction needs its 5 AP kept (Defend)', () => {
    const trait = id === 'd20-fantasy' ? 'parry' : 'combat_reflexes';
    const guarded = sheets.defaultSheet(system, { traits: [trait] });
    const club = { id: 'club', name: 'Club', reach: 1, attack: '1d20', damage: '1' };
    expect(reactions.reactionCost(system, guarded, 'defend')).toBe(5);
    expect(reactions.defendingOf(system, fightOf(7), 'player', guarded, club)).toMatchObject({
      cost: 5,
      reaction: expect.objectContaining({ id: trait }),
    });
    expect(reactions.defendingOf(system, fightOf(4), 'player', guarded, club)).toBeNull();
    // No such trait, no reaction, whatever is kept.
    const plain = sheets.defaultSheet(system);
    expect(reactions.defendingOf(system, fightOf(20), 'player', plain, club)).toBeNull();
  });

  test('a fight from before AP: a fighter with no kept AP has their whole pool', () => {
    const f = fightOf(undefined);
    delete f.combatants.player.kept;
    const r = stepAway(f, 'a');
    expect(r.struck).toHaveLength(1);
    expect(r.fight.combatants.player.kept).toBe(10);
  });
});
