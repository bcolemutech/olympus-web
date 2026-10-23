'use strict';

/**
 * "What's here?" on a battle map (#672), with Gemini stubbed, under both
 * built-in systems: the GM is given the facts of one square or door as the
 * save knows them and asked to describe only those; a square out of sight is
 * described as remembered, and nobody standing there unseen is named; an
 * empty square gets the rules' plain line with no model; a square never seen
 * is refused; nothing is spent or recorded, in a fight or out; a typed look
 * at something on the map takes the same path.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-whats-here --verbose"
 */

const PROJECT = 'demo-loom-whats-here';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const seen = require('../functions/loom-turn/seen');

const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

// An inn 12 × 6: a wall down x = 6 with a shut door in it; west of it the
// taproom with its ale tap and a table, and Mira; east of it the back room,
// and Grell.
const mockInn = () => ({
  id: 'bm_inn',
  name: 'The inn',
  width: 12,
  height: 6,
  image: null,
  entries: [{ id: 'door', x: 1, y: 3 }],
  exits: [{ id: 'out', name: 'the street door', x: 0, y: 3, to: 'out' }],
  features: [
    { id: 'tap', name: 'the ale tap', x: 2, y: 0 },
    { id: 'crates', name: 'the smuggled crates', x: 9, y: 1 },
  ],
  walls: [
    {
      points: [
        { x: 6, y: 0 },
        { x: 6, y: 2 },
      ],
    },
    {
      points: [
        { x: 6, y: 3 },
        { x: 6, y: 6 },
      ],
    },
  ],
  doors: [{ id: 'back-door', name: 'the back door', from: { x: 6, y: 2 }, to: { x: 6, y: 3 } }],
  obstacles: [{ id: 'table', name: 'a long table', kind: 'low', x: 3, y: 4, w: 2, h: 1 }],
  hazards: [],
  areas: [
    { id: 'taproom', name: 'the taproom', polygon: rect(0, 0, 6, 2) },
    { id: 'back-room', name: 'the back room', polygon: rect(6, 0, 12, 6) },
  ],
});

const mockCases = {
  'd20-fantasy': BUILT_IN['d20-fantasy'],
  'pool-scifi': BUILT_IN['pool-scifi'],
};
const mockState = { id: 'd20-fantasy', intent: null, down: false };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      return {
        ...COAST,
        system: mockCases[mockState.id],
        locations: {
          ...COAST.locations,
          'widows-reach': { ...COAST.locations['widows-reach'], battleMap: { mapId: 'bm_inn' } },
        },
        characters: {
          ...COAST.characters,
          mira: {
            id: 'mira',
            name: 'Mira',
            description: 'The innkeeper.',
            locationId: 'widows-reach',
            cell: { x: 4, y: 1 },
          },
          grell: {
            id: 'grell',
            name: 'Grell',
            description: 'A smuggler.',
            locationId: 'widows-reach',
            cell: { x: 10, y: 4 },
            side: 'hostile',
          },
        },
        battleMaps: { bm_inn: mockInn() },
      };
    },
  };
});
const prompts = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) return mockState.intent;
    if (mockState.down) throw new Error('down');
    prompts.push(options.userMessage);
    return { narration: 'Brass and old beer.', inventedEntities: [], suggestedActions: [] };
  },
}));

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomPlayTurn } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const db = getFirestore();
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

describe.each(Object.keys(mockCases))("what's here under %s", (id) => {
  const system = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });
  beforeEach(() => {
    prompts.length = 0;
  });

  const fight = () => ({
    id: 'fight-1',
    mapId: 'bm_inn',
    by: 'seen',
    round: 2,
    order: ['player', 'grell'],
    turn: 'player',
    combatants: {
      player: { kind: 'player', side: 'party', name: 'Tam', initiative: 15, reactionsLeft: 1 },
      grell: { kind: 'character', side: 'hostile', name: 'Grell', initiative: 5, reactionsLeft: 1 },
    },
  });
  async function onTheMap(saveId, cell, { inFight = false, seenAll = false } = {}) {
    const ref = db.collection('loom_saves').doc(saveId);
    await ref.set({
      ...makeSave({
        ownerUid: PLAYER.uid,
        worldId: 'shattered-coast',
        name: 'Voyage',
        character: { name: 'Tam', sheet: sheets.defaultSheet(system) },
        location: 'widows-reach',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      mapId: 'bm_inn',
      cell,
      ...(inFight ? { fight: fight() } : {}),
    });
    if (seenAll) {
      // The whole inn seen before: the back room remembered from the taproom.
      const all = {};
      for (let y = 0; y < 6; y++) for (let x = 0; x < 12; x++) all[x + ',' + y] = true;
      await ref
        .collection('seen')
        .doc('bm_inn')
        .set({ mapId: 'bm_inn', width: 12, height: 6, squares: seen.pack(all, 12, 6) });
    }
    return ref;
  }
  const look = (ref, target) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, action: { verb: 'look', ...target } },
      auth: PLAYER,
    });
  const saved = async (ref) => (await ref.get()).data();
  const turns = async (ref) => (await ref.collection('loom_turns').get()).size;

  test('a square in sight: the GM is given its facts alone; nothing spent or recorded', async () => {
    const ref = await onTheMap(`${id}-tap`, { x: 2, y: 3 });
    const before = await saved(ref);
    const answer = await look(ref, { cell: { x: 2, y: 0 } });
    expect(answer.narration).toBe('Brass and old beer.');
    expect(prompts).toHaveLength(1);
    const prompt = prompts[0];
    expect(prompt).toContain('The player looks at (2, 0), in sight now.');
    expect(prompt).toContain('- A feature: the ale tap.');
    expect(prompt).toContain('- It is in the taproom.');
    expect(prompt).toContain('- It is 3 squares from the player.');
    expect(prompt).toContain('Describe only this spot');
    // Nothing behind the shut door reaches the GM.
    expect(prompt).not.toContain('Grell');
    expect(prompt).not.toContain('the back room');
    const after = await saved(ref);
    expect(after.turn).toEqual(before.turn);
    expect(after.time).toEqual(before.time);
    expect(await turns(ref)).toBe(0);
  });

  test('someone there, an obstacle there, and a door', async () => {
    const ref = await onTheMap(`${id}-mira`, { x: 2, y: 3 });
    await look(ref, { cell: { x: 4, y: 1 } });
    expect(prompts[0]).toContain('- Someone there: Mira, The innkeeper..');
    await look(ref, { cell: { x: 3, y: 4 } });
    expect(prompts[1]).toContain('- An obstacle: a long table (low: it blocks the way).');
    const door = await look(ref, { door: 'back-door' });
    expect(door.narration).toBe('Brass and old beer.');
    expect(prompts[2]).toContain('- A door: the back door, closed.');
  });

  test('an empty square: the rules’ plain line, no model', async () => {
    const ref = await onTheMap(`${id}-empty`, { x: 2, y: 3 });
    expect((await look(ref, { cell: { x: 5, y: 1 } })).narration).toBe(
      'Bare floor, in the taproom.'
    );
    expect((await look(ref, { cell: { x: 4, y: 5 } })).narration).toBe('Bare floor.');
    expect(prompts).toHaveLength(0);
  });

  test('without the model, the facts plainly, never the words for it', async () => {
    mockState.down = true;
    const ref = await onTheMap(`${id}-fallback`, { x: 2, y: 3 });
    const answer = await look(ref, { cell: { x: 2, y: 0 } });
    expect(answer.narration).toBe(
      'A feature: the ale tap. It is in the taproom. It is 3 squares from you.'
    );
    mockState.down = false;
  });

  test('a square never seen is refused, with no model', async () => {
    const ref = await onTheMap(`${id}-unseen`, { x: 2, y: 3 });
    const answer = await look(ref, { cell: { x: 10, y: 4 } });
    expect(answer).toMatchObject({ refused: true, narration: "You haven't seen that spot." });
    expect(prompts).toHaveLength(0);
  });

  test('a square out of sight now is described as remembered, nobody named there', async () => {
    const ref = await onTheMap(`${id}-remembered`, { x: 2, y: 3 }, { seenAll: true });
    await look(ref, { cell: { x: 9, y: 1 } });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('The player thinks back to (9, 1), out of sight now');
    expect(prompts[0]).toContain('- A feature: the smuggled crates.');
    expect(prompts[0]).toContain('- It is in the back room.');
    // Grell stands in there, out of sight: never named. An empty square he
    // stands on is bare floor, as remembered, with no model.
    expect(prompts[0]).not.toContain('Grell');
    expect((await look(ref, { cell: { x: 10, y: 4 } })).narration).toBe(
      'When you last saw it: bare floor, in the back room.'
    );
    expect(prompts).toHaveLength(1);
  });

  test('in a fight: free, the turn order and the action as they were', async () => {
    const ref = await onTheMap(`${id}-fight`, { x: 8, y: 3 }, { inFight: true });
    const before = await saved(ref);
    await look(ref, { cell: { x: 10, y: 4 } });
    expect(prompts[0]).toContain('- Someone there: Grell, A smuggler..');
    const after = await saved(ref);
    expect(after.fight).toEqual(before.fight);
    expect(after.turn).toEqual(before.turn);
    expect(await turns(ref)).toBe(0);
  });

  test('a typed look at something on the map takes the same path', async () => {
    const ref = await onTheMap(`${id}-typed`, { x: 2, y: 3 });
    mockState.intent = { verb: 'examine', targets: ['feature:tap'], params: {} };
    const before = await saved(ref);
    const answer = await loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, actionText: 'look at the ale tap' },
      auth: PLAYER,
    });
    expect(answer.narration).toBe('Brass and old beer.');
    expect(prompts[0]).toContain('PLAYER ACTION:\nlook at the ale tap');
    expect(prompts[0]).toContain('- A feature: the ale tap.');
    expect((await saved(ref)).turn).toEqual(before.turn);
    expect(await turns(ref)).toBe(0);
  });
});
