'use strict';

/**
 * Named characters' turns (planning/combat.md §3 EN3b, EN5, §4.6; L-825 /
 * #657), with the model stubbed, under both built-in systems (MD2): a named
 * character's choices are whole turns the rules list; a legal choice is
 * played; an illegal one and a failed call fall back to their role's
 * tactics; figures are never asked; ADJUDICATE asks the model once per named
 * turn and plays the turn out again with the same dice; combatNotes reach
 * the prompt.
 *
 * Run: cd tests && npx jest loom-combat-named --verbose
 */

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const combat = require('../functions/loom-modules/combat');
const { adjudicateAction, evaluate } = require('../functions/loom-turn/adjudicate');
const { promptOf } = require('../functions/loom-turn/named-turns');

const { others } = combat;
const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// Dice that roll these faces in turn, then the last one forever.
const faces = (...list) => {
  let i = 0;
  return (sides) => Math.min(sides, list[Math.min(i++, list.length - 1)]);
};

const CASES = {
  'd20-fantasy': {
    system: FANTASY,
    club: {
      id: 'club',
      name: 'Club',
      reach: 1,
      attack: '1d20 + 4',
      damage: '1d6',
      type: 'bludgeoning',
    },
    sling: {
      id: 'sling',
      name: 'Sling',
      range: { normal: 8, long: 16 },
      attack: '1d20 + 2',
      damage: '1d4',
      type: 'bludgeoning',
    },
  },
  'pool-scifi': {
    system: SCIFI,
    club: {
      id: 'club',
      name: 'Club',
      reach: 1,
      attack: 'count(4d10, >= 7)',
      damage: '1d2',
      type: 'kinetic',
    },
    sling: {
      id: 'sling',
      name: 'Sling',
      range: { normal: 8, long: 16 },
      attack: 'count(3d10, >= 7)',
      damage: '1d2',
      type: 'kinetic',
    },
  },
};

// A hall 12 × 6, the way out at the west; the player at (2, 3).
const hall = (figures = []) => ({
  id: 'bm',
  name: 'Hall',
  width: 12,
  height: 6,
  entries: [{ id: 'in', x: 1, y: 3 }],
  exits: [{ id: 'out', name: 'the door', x: 0, y: 3, to: 'out' }],
  features: [],
  walls: [],
  doors: [],
  obstacles: [],
  figures,
});

describe.each(Object.keys(CASES))('named turns under %s', (id) => {
  const c = CASES[id];
  const system = c.system;
  const grell = (patch = {}) => ({
    id: 'grell',
    name: 'Grell',
    description: 'A bandit with a club and a sling.',
    combatNotes: 'Cowardly at heart: hits from afar, runs if cornered.',
    locationId: 'ruin',
    side: 'hostile',
    cell: { x: 9, y: 3 },
    sheet: { ...sheets.defaultSheet(system), attacks: [c.club, c.sling] },
    ...patch,
  });
  const worldOf = ({ characters = { grell: grell() }, figures = [] } = {}) => ({
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
    battleMaps: { bm: hall(figures) },
  });
  const fightOf = (ids = ['player', 'grell']) => ({
    id: 'f',
    mapId: 'bm',
    by: 'gm',
    round: 1,
    order: ids,
    turn: 'player',
    combatants: Object.fromEntries(
      ids.map((x) => [
        x,
        x === 'player'
          ? { kind: 'player', side: 'party', name: 'Tam', initiative: 20, reactionsLeft: 1 }
          : { kind: 'character', side: 'hostile', name: x, initiative: 5, reactionsLeft: 1 },
      ])
    ),
  });
  const saveOf = (fight = fightOf()) => ({
    location: 'ruin',
    mapId: 'bm',
    cell: { x: 2, y: 3 },
    time: 1000,
    turn: { n: 1, movementLeft: 6, actionUsed: false, plan: null },
    character: { name: 'Tam', sheet: sheets.defaultSheet(system) },
    fight,
  });
  const play = (choose, world = worldOf(), save = saveOf()) =>
    others.playOthers(world, save, { dice: faces(1), choose });

  test('their choices are whole turns the rules allow: strike, shoot, close, Dodge, flee', () => {
    let asked = null;
    play((key, menu) => {
      asked = { key, menu };
      return null;
    });
    expect(asked.key).toBe('1:grell');
    const texts = asked.menu.choices.map((o) => o.text);
    expect(new Set(asked.menu.choices.map((o) => o.id)).size).toBe(texts.length);
    expect(texts).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/shoot the player with your sling$/),
        expect.stringMatching(/the player/),
        'stay where you are and Dodge: harder to hit until your next turn',
        expect.stringMatching(/^run for the way out/),
      ])
    );
    expect(asked.menu).toMatchObject({
      name: 'Grell',
      side: 'hostile',
      combatNotes: 'Cowardly at heart: hits from afar, runs if cornered.',
    });
    expect(asked.menu.situation[0].line).toBe('the player (foe), 7 squares away');
  });

  test('a legal choice is played: Dodge, standing their ground', () => {
    const result = play((key, menu) => ({
      option: menu.choices.find((o) => o.text.includes('Dodge')).id,
      reason: 'Let him come to me.',
    }));
    expect(result.turns[0]).toMatchObject({ id: 'grell', path: [] });
    expect(result.turns[0].attack).toBeUndefined();
    expect(result.fight.combatants.grell.dodging).toBe(true);
    expect(result.lines).toContain('Grell keeps their guard up.');
    expect(result.named).toEqual([
      {
        id: 'grell',
        name: 'Grell',
        did: 'stay where you are and Dodge: harder to hit until your next turn',
        reason: 'Let him come to me.',
      },
    ]);
  });

  test('a legal choice is played: running for the way out', () => {
    const result = play((key, menu) => ({
      option: menu.choices.find((o) => o.text.startsWith('run for the way out')).id,
    }));
    const path = result.turns[0].path;
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1].x).toBeLessThan(9);
    expect(result.turns[0].attack).toBeUndefined();
  });

  test('an illegal answer and a failed call fall back to their role’s tactics', () => {
    const plain = play(null);
    expect(plain.named).toEqual([]);
    const illegal = play(() => ({ option: 'o99' }));
    const failed = play(() => null);
    for (const r of [illegal, failed]) {
      expect(r.turns).toEqual(plain.turns);
      expect(r.lines).toEqual(plain.lines);
    }
    expect(illegal.named).toEqual([{ id: 'grell', name: 'Grell', did: null, fallback: 'illegal' }]);
    expect(failed.named).toEqual([{ id: 'grell', name: 'Grell', did: null, fallback: 'failed' }]);
  });

  test('figures from a stat block are never asked', () => {
    const world = worldOf({
      characters: {},
      figures: [
        {
          id: 'bandits',
          name: 'Bandit',
          statBlock: { attacks: [c.club] },
          side: 'hostile',
          cells: [{ x: 9, y: 3 }],
        },
      ],
    });
    const asked = [];
    const result = others.playOthers(world, saveOf(fightOf(['player', 'fig-bandits'])), {
      dice: faces(1),
      choose: (key) => asked.push(key),
    });
    expect(asked).toEqual([]);
    expect(result.named).toEqual([]);
  });

  test('ADJUDICATE asks once per named turn, and plays the turn out with the same dice', async () => {
    let n = 0;
    const roll = (sides) => Math.min(sides, 1 + (n++ % 7));
    const menus = [];
    const resolution = await adjudicateAction(
      {
        proposedAction: { verb: 'end-turn', targets: [], params: {} },
        canonWorld: worldOf(),
        save: saveOf(),
        worldState: {},
        decide: async (menu) => {
          menus.push(menu);
          return { option: menu.choices.find((o) => o.text.includes('sling')).id };
        },
      },
      roll
    );
    expect(menus).toHaveLength(1);
    expect(resolution.named).toEqual([
      expect.objectContaining({ id: 'grell', did: expect.stringContaining('sling') }),
    ]);
    const fight = resolution.mutations.find((m) => m.path === 'fight').value;
    expect(fight).toMatchObject({ round: 2, turn: 'player' });
    // Played back, the dice came to what one straight working-out with the
    // same choice and the same dice comes to.
    let m = 0;
    const again = evaluate(
      { verb: 'end-turn', targets: [], params: {} },
      {},
      saveOf(),
      (sides) => Math.min(sides, 1 + (m++ % 7)),
      worldOf(),
      undefined,
      undefined,
      { choose: () => ({ option: menus[0].choices.find((o) => o.text.includes('sling')).id }) }
    );
    expect(resolution.mutations).toEqual(again.mutations);
    expect(resolution.constraints).toEqual(again.constraints);
    expect(m).toBe(n);
    // A decide that fails leaves Grell to his tactics.
    const failed = await adjudicateAction(
      {
        proposedAction: { verb: 'end-turn', targets: [], params: {} },
        canonWorld: worldOf(),
        save: saveOf(),
        worldState: {},
        decide: async () => {
          throw new Error('no model');
        },
      },
      faces(1)
    );
    expect(failed.named).toEqual([
      expect.objectContaining({ id: 'grell', did: null, fallback: 'failed' }),
    ]);
  });

  test('the prompt carries who they are, their notes, what they see and their choices', () => {
    let menu = null;
    play((key, m) => {
      menu = m;
      return null;
    });
    const prompt = promptOf(menu);
    expect(prompt).toContain('CHARACTER: Grell — A bandit with a club and a sling.');
    expect(prompt).toContain(
      'HOW THEY FIGHT: Cowardly at heart: hits from afar, runs if cornered.'
    );
    expect(prompt).toContain('- the player (foe), 7 squares away');
    expect(prompt).toContain('- o1: ');
  });
});
