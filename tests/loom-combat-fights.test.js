'use strict';

/**
 * Fights in play (planning/combat.md §3 CB0, TN1–TN3, SE1, SE2, SE4, §4.2;
 * L-821 / #653), through loomPlayTurn with Gemini stubbed, under both
 * built-in systems (MD2): a step into sight of a hostile starts a fight
 * (initiative and surprise by the server's dice, the player's initiative
 * the roll card); each End turn is a round, 6 s, with no model call; the
 * fight ends when the foe stands down, is talked down, or the player leaves
 * the map, and the model is called only to narrate the start and the end.
 * Attacking a neutral starts one too; resting in one is refused; loomGetMap
 * sends it.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-combat-fights --verbose"
 */

const PROJECT = 'demo-loom-combat-fights';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// A hall 8 × 5, in at the west door; Grell stands at the east end, in sight.
const mockHall = () => ({
  id: 'bm_hall',
  name: 'The hall',
  width: 8,
  height: 5,
  image: null,
  entries: [{ id: 'door', x: 1, y: 2 }],
  exits: [{ id: 'out', name: 'the door', x: 0, y: 2, to: 'out' }],
  features: [],
  walls: [],
  doors: [],
  obstacles: [],
  hazards: [],
});
const mockCases = {
  'd20-fantasy': {
    system: FANTASY,
    sneaky: {
      attributes: { STR: 10, DEX: 18, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      skills: { Stealth: 6 },
    },
    talk: 'Persuasion',
    rank: 6,
    high: 20,
  },
  'pool-scifi': {
    system: SCIFI,
    sneaky: { attributes: { Body: 3, Reflex: 5, Mind: 3, Presence: 3 }, skills: { Stealth: 3 } },
    talk: 'Persuade',
    rank: 3,
    high: 10,
  },
};

const mockState = { id: 'd20-fantasy', side: 'hostile', sheet: null, intent: null };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      const c = mockCases[mockState.id];
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
            description: 'A bandit with a notched blade.',
            locationId: 'widows-reach',
            cell: { x: 6, y: 2 },
            ...(mockState.side !== 'neutral' ? { side: mockState.side } : {}),
            ...(mockState.sheet ? { sheet: mockState.sheet } : {}),
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
      return mockState.intent || { verb: 'search', targets: [], params: {} };
    }
    prompts.push(options.userMessage);
    return { narration: 'Steel rings out.', inventedEntities: [], suggestedActions: [] };
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

let face = 5; // every die rolls this
beforeAll(() => {
  jest
    .spyOn(crypto, 'randomInt')
    .mockImplementation((min, max) => Math.min(max - 1, min + face - 1));
});
afterAll(async () => {
  crypto.randomInt.mockRestore();
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

describe.each(Object.keys(mockCases))('fights under %s', (id) => {
  const c = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });
  beforeEach(() => {
    mockState.side = 'hostile';
    mockState.sheet = null;
    mockState.intent = null;
    face = 5;
    prompts.length = 0;
  });

  async function onTheMap(saveId, skills = {}) {
    const sheet = sheets.defaultSheet(c.system);
    sheet.skills = { ...sheet.skills, ...skills };
    await db
      .collection('loom_saves')
      .doc(saveId)
      .set({
        ...makeSave({
          ownerUid: PLAYER.uid,
          worldId: 'shattered-coast',
          name: 'Voyage',
          character: { name: 'Tam', sheet },
          location: 'widows-reach',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        mapId: 'bm_hall',
        cell: { x: 1, y: 2 },
      });
    return db.collection('loom_saves').doc(saveId);
  }
  const play = (saveId, data) =>
    loomPlayTurn.run({ data: { worldId: 'shattered-coast', saveId, ...data }, auth: PLAYER });
  const saved = async (ref) => (await ref.get()).data();

  async function fightStarted(ref) {
    const answer = await play(ref.id, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    expect(answer.step).toMatchObject({ cell: { x: 2, y: 2 }, fight: true });
    return answer;
  }

  test('a step into sight of a hostile starts a fight, narrated; rounds run by the rules alone', async () => {
    const ref = await onTheMap(`${id}-seen`);
    const before = (await saved(ref)).time;
    const answer = await fightStarted(ref);
    // The player's initiative is the turn's roll card.
    expect(answer.roll).toMatchObject({ against: 'initiative', difficulty: null });
    expect(answer.roll.verdict).toMatch(/^(1st|2nd) of 2$/);
    // Narrated: the passage; the rules' lines are the GM's hard facts.
    expect(answer.narration).toBe('Steel rings out.');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('- A fight breaks out. In order:');
    expect(prompts[0]).toContain('FIGHT STARTS: a fight breaks out as the player comes into sight');
    let save = await saved(ref);
    expect(save.cell).toEqual({ x: 2, y: 2 });
    expect(save.fight).toMatchObject({
      mapId: 'bm_hall',
      by: 'seen',
      round: 1,
      turn: 'player',
      combatants: {
        player: { kind: 'player', side: 'party' },
        grell: { kind: 'character', side: 'hostile', name: 'Grell' },
      },
    });
    expect(save.fight.order.sort()).toEqual(['grell', 'player']);
    expect(save.time).toBe(before); // nobody surprised: no round lost
    const turns = await ref.collection('loom_turns').get();
    expect(turns.docs[0].data().resolution.fight).toMatchObject({ started: true, by: 'seen' });

    // Each End turn is a round: Grell's turn, then the player's again, 6 s,
    // and no model call.
    const round = await play(ref.id, { action: { verb: 'end-turn' } });
    // Grell takes their turn: by their tactics, at the player (L-824).
    expect(round.narration).toMatch(/Grell (misses|hits) you/);
    expect(round.narration).toContain('Round 2.');
    save = await saved(ref);
    expect(save.fight).toMatchObject({ round: 2, turn: 'player' });
    expect(save.time).toBe(before + 6);
    await play(ref.id, { action: { verb: 'end-turn' } });
    save = await saved(ref);
    expect(save.fight.round).toBe(3);
    expect(save.time).toBe(before + 12);
    expect(prompts).toHaveLength(1);

    // loomGetMap sends it, for the turn bar.
    const view = await loomGetMap.run({
      data: { worldId: 'shattered-coast', saveId: ref.id },
      auth: PLAYER,
    });
    expect(view.fight).toMatchObject({ round: 3, turn: 'player' });
    expect(view.fight.order).toContainEqual(
      expect.objectContaining({ id: 'player', you: true, side: 'party' })
    );
    expect(view.fight.order).toContainEqual(
      expect.objectContaining({ id: 'grell', name: 'Grell', side: 'hostile' })
    );

    // Resting is refused while it lasts.
    mockState.intent = { verb: 'rest', targets: [], params: { minutes: 10 } };
    const rest = await play(ref.id, { actionText: 'rest a while' });
    expect(rest).toMatchObject({
      narration: "You can't rest in the middle of a fight.",
      refused: true,
    });
    expect((await saved(ref)).time).toBe(before + 12);

    // The GM stands Grell down: at the next End turn the fight ends, narrated.
    mockState.side = 'neutral';
    prompts.length = 0;
    const end = await play(ref.id, { action: { verb: 'end-turn' } });
    // End turn's lines, then the passage.
    expect(end.narration).toContain('The fight is over: your foes stood down.');
    expect(end.narration).toMatch(/Steel rings out\.$/);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('FIGHT ENDS after 3 rounds');
    expect((await saved(ref)).fight).toBeNull();

    // Out of a fight, End turn is plain again.
    prompts.length = 0;
    await play(ref.id, { action: { verb: 'end-turn' } });
    expect(prompts).toHaveLength(0);
  });

  test('a foe hidden well catches the player off guard: the first round is lost', async () => {
    mockState.sheet = c.sneaky;
    face = c.high - 1;
    const ref = await onTheMap(`${id}-surprised`);
    const before = (await saved(ref)).time;
    const answer = await fightStarted(ref);
    expect(prompts[0]).toContain("- You're caught off guard: you lose the first round.");
    const save = await saved(ref);
    expect(save.fight).toMatchObject({ round: 2, turn: 'player' });
    expect(save.time).toBe(before + 6);
    expect(prompts[0]).toContain('Caught off guard: you.');
  });

  test('leaving the map gets away: the fight ends, narrated', async () => {
    const ref = await onTheMap(`${id}-fled`);
    await fightStarted(ref);
    prompts.length = 0;
    const away = await play(ref.id, { action: { verb: 'move', cell: { x: 0, y: 2 } } });
    expect(away.narration).toBe('Steel rings out.');
    expect(prompts[0]).toContain('- You get away: the fight is over.');
    const save = await saved(ref);
    expect(save.fight).toBeNull();
    expect(save.mapId).toBeNull();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('FIGHT ENDS after 1 round: the player got away');
  });

  test('a foe talked down by a social check against them: the fight ends', async () => {
    // A practised talker, against Grell untrained.
    const ref = await onTheMap(`${id}-talked`, { [c.talk]: c.rank });
    await fightStarted(ref);
    face = c.high;
    mockState.intent = {
      verb: 'persuade',
      targets: ['grell'],
      params: { check: { skill: c.talk, rung: 'Easy', opposedBy: 'grell' } },
    };
    const talk = await play(ref.id, { actionText: 'tell Grell this isn’t worth dying for' });
    expect(talk.roll).toMatchObject({ success: true });
    expect(talk.narration).toBe('Steel rings out.');
    const turns = await ref.collection('loom_turns').orderBy('index', 'desc').get();
    const last = turns.docs[0].data().resolution;
    expect(last.constraints).toContain('The fight is over: your foes were talked down.');
    expect(last.fight).toMatchObject({ ended: true, winner: 'party', how: ['talkedDown'] });
    expect((await saved(ref)).fight).toBeNull();
  });

  test('attacking a neutral starts a fight: the player’s blow opens it', async () => {
    mockState.side = 'neutral';
    const ref = await onTheMap(`${id}-attack`);
    // Neutral: walking up to them starts nothing.
    const walk = await play(ref.id, { action: { verb: 'move', cell: { x: 5, y: 2 } } });
    expect(walk.step.fight).toBeUndefined();
    expect((await saved(ref)).fight).toBeUndefined();
    mockState.intent = { verb: 'attack', targets: ['grell'], params: {} };
    const hit = await play(ref.id, { actionText: 'attack Grell' });
    expect(hit.narration).toBe('Steel rings out.');
    const save = await saved(ref);
    expect(save.fight).toMatchObject({
      by: 'attack',
      round: 1,
      turn: 'player',
      combatants: { grell: { side: 'hostile', joined: true } },
    });
    expect(save.turn.actionUsed).toBe(true);
    expect(prompts[prompts.length - 1]).toContain(
      'FIGHT STARTS: a fight breaks out as the player attacks'
    );
    // Still neutral in canon, they stay in it.
    const round = await play(ref.id, { action: { verb: 'end-turn' } });
    // Grell takes their turn: by their tactics, at the player (L-824).
    expect(round.narration).toMatch(/Grell (misses|hits) you/);
    expect((await saved(ref)).fight.round).toBe(2);
  });
});
