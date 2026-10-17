'use strict';

/**
 * Hazards in play (planning/game-systems.md §3 EF4, EF5, EF8, EF9, §4.10;
 * L-815 / #642), through loomPlayTurn with Gemini stubbed: walking into a
 * hazard on a battle map stops the walk there and rolls its save with the
 * server's dice; a failure puts its condition on, a success resists it;
 * NARRATE is told; each End turn ticks it until it wears off; a condition
 * that stops you moving or acting turns those down; loomGetMap sends the
 * hazard's squares in sight. Under both built-in systems (MD2).
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-hazards --verbose"
 */

const PROJECT = 'demo-loom-hazards';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// A hall 8 × 5, in at the west door; a gas cloud fills the east end.
const mockHall = (condition, save) => ({
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
  hazards: [
    {
      id: 'gas',
      name: 'the gas',
      description: 'a yellow fog, low to the floor',
      area: { shape: 'square', x: 4, y: 0, size: 4 },
      effect: { condition, duration: { turns: 2 }, save: { ...save, when: 'apply' } },
    },
  ],
});
const mockCases = {
  'd20-fantasy': {
    system: FANTASY,
    condition: 'poisoned',
    name: 'Poisoned',
    save: { attribute: 'CON', against: 'Moderate' },
    hurts: false,
  },
  'pool-scifi': {
    system: SCIFI,
    condition: 'bleeding',
    name: 'Bleeding',
    save: { attribute: 'Body', against: 'Moderate' },
    hurts: true,
  },
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
      return {
        ...COAST,
        system: c.system,
        locations: {
          ...COAST.locations,
          'widows-reach': { ...COAST.locations['widows-reach'], battleMap: { mapId: 'bm_hall' } },
        },
        battleMaps: { bm_hall: mockHall(c.condition, c.save) },
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
    return { narration: 'The gas rolls over you.', inventedEntities: [], suggestedActions: [] };
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

let face = 2; // every die rolls this
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

describe.each(Object.keys(mockCases))('a hazard under %s', (id) => {
  const c = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });

  async function onTheMap(saveId, conditions = []) {
    const sheet = sheets.defaultSheet(c.system);
    sheet.conditions = conditions;
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
  const sheetOf = async (ref) => (await ref.get()).data().character.sheet;

  test('walking in stops there, rolls the save, and a failure puts it on; NARRATE is told', async () => {
    face = 2;
    const ref = await onTheMap(`${id}-fail`);
    prompts.length = 0;
    const answer = await play(ref.id, { action: { verb: 'move', cell: { x: 6, y: 2 } } });
    // Stopped where it walked in: the first square of the gas.
    expect(answer.step).toMatchObject({ cell: { x: 4, y: 2 }, hazard: 'gas' });
    expect(answer.roll).toMatchObject({ against: 'save: the gas', success: false });
    expect(answer.narration).toContain('The gas rolls over you.');
    const saved = (await ref.get()).data();
    expect(saved.cell).toEqual({ x: 4, y: 2 });
    expect(saved.character.sheet.conditions).toEqual([
      expect.objectContaining({
        condition: c.condition,
        duration: { turns: 2 },
        source: { kind: 'hazard', id: 'gas', name: 'the gas' },
      }),
    ]);
    // The rest of the way is kept as the plan.
    expect(saved.turn.plan).toMatchObject({ to: { x: 6, y: 2 } });
    const turns = await ref.collection('loom_turns').get();
    expect(turns.docs[0].data().resolution.hazard).toMatchObject({
      id: 'gas',
      outcome: 'applied',
      condition: c.name,
    });
    const told = prompts[prompts.length - 1];
    expect(told).toContain(
      'HAZARD: the player walked into the gas (a yellow fog, low to the floor)'
    );
    expect(told).toContain(`it took hold: ${c.name}.`);
    expect(told).toContain(`- ${c.name}, 2 turns left`);

    // Each End turn ticks it, until it wears off.
    const full = sheets.maxima(c.system, saved.character.sheet).health;
    const first = await play(ref.id, { action: { verb: 'end-turn' } });
    let sheet = await sheetOf(ref);
    expect(sheet.conditions[0].duration).toEqual({ turns: 1 });
    expect(sheet.resources.health.current).toBe(c.hurts ? full - 1 : full);
    if (c.hurts) expect(first.narration).toContain(`${c.name}: 1 lost`);
    const second = await play(ref.id, { action: { verb: 'end-turn' } });
    sheet = await sheetOf(ref);
    expect(sheet.conditions).toEqual([]);
    expect(second.narration).toContain(`${c.name} wears off.`);

    // Walking on inside it doesn't trigger it again.
    const on = await play(ref.id, { action: { verb: 'move', cell: { x: 5, y: 2 } } });
    expect(on.roll).toBeUndefined();
    expect((await sheetOf(ref)).conditions).toEqual([]);
  });

  test('a save made resists it: nothing put on', async () => {
    face = id === 'd20-fantasy' ? 20 : 9;
    const ref = await onTheMap(`${id}-resist`);
    const answer = await play(ref.id, { action: { verb: 'move', cell: { x: 6, y: 2 } } });
    expect(answer.roll).toMatchObject({ success: true });
    expect((await sheetOf(ref)).conditions).toEqual([]);
    const turns = await ref.collection('loom_turns').get();
    expect(turns.docs[0].data().resolution.hazard.outcome).toBe('resisted');
    face = 2;
  });

  test('a typed move into it triggers it too', async () => {
    const ref = await onTheMap(`${id}-typed`);
    mockState.intent = { verb: 'move', targets: [], params: { cell: { x: 5, y: 2 } } };
    try {
      const answer = await play(ref.id, { actionText: 'walk east' });
      expect(answer.roll).toMatchObject({ against: 'save: the gas' });
    } finally {
      mockState.intent = null;
    }
    const saved = (await ref.get()).data();
    expect(saved.cell).toEqual({ x: 4, y: 2 });
    expect(saved.character.sheet.conditions).toHaveLength(1);
  });

  test('stunned: no moving and no acting', async () => {
    const ref = await onTheMap(`${id}-stunned`, [{ condition: 'stunned', duration: { turns: 1 } }]);
    const step = await play(ref.id, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    expect(step.narration).toBe("You can't move: you're Stunned.");
    expect((await ref.get()).data().cell).toEqual({ x: 1, y: 2 });
    const act = await play(ref.id, { actionText: 'search the floor' });
    expect(act).toMatchObject({ narration: "You can't act: you're Stunned.", refused: true });
    expect((await ref.collection('loom_turns').get()).size).toBe(0);
  });

  test('loomGetMap sends the hazard’s squares in sight, for the grid', async () => {
    const ref = await onTheMap(`${id}-seen`);
    const view = await loomGetMap.run({
      data: { worldId: 'shattered-coast', saveId: ref.id },
      auth: PLAYER,
    });
    const gas = view.battleMap.hazards.find((h) => h.id === 'gas');
    expect(gas).toMatchObject({ name: 'the gas', condition: c.name });
    expect(gas.squares).toHaveLength(16);
    expect(gas.squares).toContainEqual({ x: 4, y: 0 });
  });
});
