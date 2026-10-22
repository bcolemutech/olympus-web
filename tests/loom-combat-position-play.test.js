'use strict';

/**
 * Position and reactions in play (planning/combat.md §3 TN4, TN5, PS4, §4.3;
 * L-823 / #655), through loomPlayTurn with Gemini stubbed, under both
 * built-in systems (MD2): stepping out of a foe's reach draws its attack
 * (written to the save, the walk going on), unless the player withdrew;
 * Dash, Dodge and Ready spend the action, ruled and unnarrated; Use spends
 * it on something beside the player, narrated; out of a fight, Dodge is
 * turned down plainly.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-combat-position-play --verbose"
 */

const PROJECT = 'demo-loom-combat-position-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// A hall 10 × 5, in at the west door; a winch on the north wall.
const mockHall = () => ({
  id: 'bm_hall',
  name: 'The hall',
  width: 10,
  height: 5,
  image: null,
  entries: [{ id: 'door', x: 1, y: 2 }],
  exits: [{ id: 'out', name: 'the door', x: 0, y: 2, to: 'out' }],
  features: [{ id: 'winch', name: 'the winch', x: 4, y: 0 }],
  walls: [],
  doors: [],
  // A crate just south of where Grell stands: cover from below.
  obstacles: [{ id: 'crate', name: 'a crate', kind: 'low', x: 6, y: 3 }],
  hazards: [],
});
// Grell strikes hard with a club: every die high, it hits.
const mockCases = {
  'd20-fantasy': { system: FANTASY, club: '1d20 + 10', melee: 'sword' },
  'pool-scifi': { system: SCIFI, club: 'count(8d10, >= 7)', melee: 'knife' },
};

const mockState = { id: 'd20-fantasy' };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      const c = mockCases[mockState.id];
      const sheetsReal = jest.requireActual('../functions/loom-canon/sheets');
      return {
        ...COAST,
        system: c.system,
        locations: {
          ...COAST.locations,
          'widows-reach': { ...COAST.locations['widows-reach'], battleMap: { mapId: 'bm_hall' } },
        },
        characters: {
          ...COAST.characters,
          grell: {
            id: 'grell',
            name: 'Grell',
            description: 'A bandit with a club.',
            locationId: 'widows-reach',
            cell: { x: 6, y: 2 },
            side: 'hostile',
            sheet: {
              ...sheetsReal.defaultSheet(c.system),
              attacks: [{ id: 'club', name: 'Club', reach: 1, attack: c.club, damage: '1' }],
            },
          },
        },
        battleMaps: { bm_hall: mockHall() },
      };
    },
  };
});
const prompts = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return { verb: 'look', targets: [], params: {} };
    }
    prompts.push(options.userMessage);
    return { narration: 'The winch groans.', inventedEntities: [], suggestedActions: [] };
  },
}));

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomPlayTurn, loomGetMap } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const db = getFirestore();
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };

beforeAll(() => {
  // Every die rolls high.
  jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max - 1);
});
afterAll(async () => {
  crypto.randomInt.mockRestore();
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

describe.each(Object.keys(mockCases))('position in play under %s', (id) => {
  const c = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });
  beforeEach(() => {
    prompts.length = 0;
  });

  // The player beside Grell, in a fight, their turn.
  const fight = () => ({
    id: 'fight-1',
    mapId: 'bm_hall',
    by: 'seen',
    round: 2,
    order: ['player', 'grell'],
    turn: 'player',
    combatants: {
      player: { kind: 'player', side: 'party', name: 'Tam', initiative: 15, reactionsLeft: 1 },
      grell: { kind: 'character', side: 'hostile', name: 'Grell', initiative: 5, reactionsLeft: 1 },
    },
  });
  async function onTheMap(saveId, { cell = { x: 5, y: 2 }, inFight = true } = {}) {
    await db
      .collection('loom_saves')
      .doc(saveId)
      .set({
        ...makeSave({
          ownerUid: PLAYER.uid,
          worldId: 'shattered-coast',
          name: 'Voyage',
          character: { name: 'Tam', sheet: sheets.defaultSheet(c.system) },
          location: 'widows-reach',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        mapId: 'bm_hall',
        cell,
        ...(inFight ? { fight: fight() } : {}),
      });
    return db.collection('loom_saves').doc(saveId);
  }
  const play = (saveId, data) =>
    loomPlayTurn.run({ data: { worldId: 'shattered-coast', saveId, ...data }, auth: PLAYER });
  const saved = async (ref) => (await ref.get()).data();
  const healthOf = (save) => save.character.sheet.resources.health.current;
  const full = sheets.maxima(c.system, sheets.defaultSheet(c.system)).health;

  test('stepping out of Grell’s reach draws his club; the walk goes on', async () => {
    const ref = await onTheMap(`${id}-provoked`);
    const step = await play(ref.id, { action: { verb: 'move', cell: { x: 3, y: 2 } } });
    expect(step.step.lines[0]).toBe("You leave Grell's reach.");
    const hurt = Number(/^Grell hits you with their club for (\d+)/.exec(step.step.lines[1])[1]);
    expect(step.step.cell).toEqual({ x: 3, y: 2 });
    const save = await saved(ref);
    expect(save.cell).toEqual({ x: 3, y: 2 });
    expect(healthOf(save)).toBe(Math.max(0, full - hurt));
    expect(save.fight.combatants.grell.reactionsLeft).toBe(0);
    expect(prompts).toHaveLength(0);
  });

  test('Withdraw first: stepping away draws nothing, and the action is spent', async () => {
    const ref = await onTheMap(`${id}-withdraw`);
    const withdrew = await play(ref.id, { action: { verb: 'withdraw' } });
    expect(withdrew.narration).toBe('You withdraw: moving away draws no attacks this turn.');
    const step = await play(ref.id, { action: { verb: 'move', cell: { x: 3, y: 2 } } });
    expect(step.step.lines.join(' ')).not.toContain('reach');
    const save = await saved(ref);
    expect(healthOf(save)).toBe(full);
    expect(save.turn).toMatchObject({ actionUsed: true, withdrawn: true });
    // A second action this turn is turned down.
    const again = await play(ref.id, { action: { verb: 'dodge' } });
    expect(again).toMatchObject({ refused: true });
  });

  test('Dash: movement again, the action spent, unnarrated', async () => {
    const ref = await onTheMap(`${id}-dash`);
    const before = (await saved(ref)).turn;
    const dashed = await play(ref.id, { action: { verb: 'dash' } });
    expect(dashed.narration).toMatch(/^You dash: \d+ more squares of movement this turn\.$/);
    const save = await saved(ref);
    expect(save.turn.actionUsed).toBe(true);
    expect(save.turn.movementLeft).toBeGreaterThan(before.movementLeft);
    expect(prompts).toHaveLength(0);
  });

  test('Dodge and Ready: on the fight, the action spent; Dodge out of a fight refused', async () => {
    const ref = await onTheMap(`${id}-dodge`);
    await play(ref.id, { action: { verb: 'dodge' } });
    let save = await saved(ref);
    expect(save.fight.combatants.player.dodging).toBe(true);
    expect(save.turn.actionUsed).toBe(true);

    const ready = await onTheMap(`${id}-ready`);
    const readied = await play(ready.id, {
      action: { verb: 'ready', attack: c.melee, target: 'grell' },
    });
    expect(readied.narration).toContain(`You ready your ${c.melee} for Grell`);
    save = await saved(ready);
    expect(save.fight.combatants.player.readied).toEqual({ attack: c.melee, target: 'grell' });
    expect(prompts).toHaveLength(0);

    const calm = await onTheMap(`${id}-calm`, { inFight: false, cell: { x: 2, y: 2 } });
    const dodged = await play(calm.id, { action: { verb: 'dodge' } });
    expect(dodged).toMatchObject({
      refused: true,
      narration: "That's for a fight, and you aren't in one.",
    });
    expect((await saved(calm)).turn.actionUsed).toBe(false);
  });

  test('Use: something beside you, narrated, the action spent; from afar, refused', async () => {
    const far = await onTheMap(`${id}-use-far`, { cell: { x: 4, y: 3 } });
    const refused = await play(far.id, { action: { verb: 'use', feature: 'winch' } });
    expect(refused.narration).toBe('You need to be beside the winch.');
    expect((await saved(far)).turn.actionUsed).toBe(false);

    const near = await onTheMap(`${id}-use`, { cell: { x: 4, y: 1 } });
    const used = await play(near.id, { action: { verb: 'use', feature: 'winch' } });
    expect(used.narration).toBe('The winch groans.');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('You use the winch.');
    expect((await saved(near)).turn.actionUsed).toBe(true);
  });
  test('loomGetMap: the player’s attacks, Subdue, and the cover each person has (L-828)', async () => {
    const ref = await onTheMap(`${id}-view`, { cell: { x: 6, y: 4 } });
    const view = await loomGetMap.run({
      data: { worldId: 'shattered-coast', saveId: ref.id },
      auth: PLAYER,
    });
    expect(view.combat.subdue).toBe(true);
    expect(view.combat.attacks).toContainEqual(
      expect.objectContaining({ id: c.melee, reach: 1, lethal: true })
    );
    expect(view.combat.attacks.some((a) => a.range && a.range.long > a.range.normal)).toBe(true);
    // Grell, behind the crate from below.
    expect(view.battleMap.people).toContainEqual(
      expect.objectContaining({ id: 'grell', cover: 'partial' })
    );
  });

  test('End turn answers with everyone else’s turns to play out, each attack a card (L-828)', async () => {
    const ref = await onTheMap(`${id}-playback`);
    const answer = await loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, action: { verb: 'end-turn' } },
      auth: PLAYER,
    });
    expect(answer.turns).toEqual([
      expect.objectContaining({
        id: 'grell',
        name: 'Grell',
        path: expect.any(Array),
        attack: expect.objectContaining({
          target: 'player',
          hit: true,
          card: expect.objectContaining({ against: 'you', name: 'Club', line: expect.any(String) }),
        }),
      }),
    ]);
    // Not kept in the turn's record.
    const turns = await ref.collection('loom_turns').get();
    expect(turns.docs[0].data().resolution.playback).toBeUndefined();
  });
});
