'use strict';

/**
 * Objects in play (planning/maps-from-data.md §4.4; L-926 / #730), through
 * loomPlayTurn and loomGetMap with Gemini stubbed, under both built-in
 * systems (MD2), on the vault (./helpers/vault.js):
 *
 *   - a closed object opened from its menu, for its own AP; a locked one
 *     unlocked with its key; opened without it, refused, nothing spent;
 *   - a locked one picked as a long action, over turns, then opened;
 *   - a lever pulled unlocks the gate and a strongbox elsewhere;
 *   - "What's here?" on an object, which spends nothing and never says what
 *     a closed one holds;
 *   - what the page is sent: state and priced actions, contents only once
 *     opened.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-objects-play --verbose"
 */

const PROJECT = 'demo-loom-objects-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const apRules = require('../functions/loom-canon/ap');

const mockCases = {
  'd20-fantasy': { system: BUILT_IN['d20-fantasy'] },
  'pool-scifi': { system: BUILT_IN['pool-scifi'] },
};
const mockState = { id: 'd20-fantasy' };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  const { VAULT } = jest.requireActual('./helpers/vault');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      return {
        ...COAST,
        system: mockCases[mockState.id].system,
        locations: {
          ...COAST.locations,
          'widows-reach': { ...COAST.locations['widows-reach'], battleMap: { mapId: 'bm_vault' } },
        },
        battleMaps: { bm_vault: VAULT() },
      };
    },
  };
});
const mockPrompts = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    mockPrompts.push(JSON.stringify(options));
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return { verb: 'look', targets: [], params: {} };
    }
    return { narration: 'You go on.', inventedEntities: [], suggestedActions: [] };
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
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

describe.each(Object.keys(mockCases))('objects in play under %s', (id) => {
  const system = mockCases[id].system;
  const prices = apRules.pricesOf(system, sheets.defaultSheet(system));
  beforeAll(() => {
    mockState.id = id;
  });

  // The player at `cell` on the vault with `inventory`, a turn of 20 AP.
  async function standing(saveId, cell, inventory = [], fields = {}) {
    const ref = db.collection('loom_saves').doc(saveId);
    await ref.set({
      ...makeSave({
        ownerUid: PLAYER.uid,
        worldId: 'shattered-coast',
        name: 'Voyage',
        character: { name: 'Tam', inventory, sheet: sheets.defaultSheet(system) },
        location: 'widows-reach',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      mapId: 'bm_vault',
      cell,
      turn: { n: 1, ap: 20, kept: 0, plan: null },
      ...fields,
    });
    return ref;
  }
  const play = (ref, action) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, action },
      auth: PLAYER,
    });
  const saved = async (ref) => (await ref.get()).data();
  const viewOf = (ref) =>
    loomGetMap.run({ data: { worldId: 'shattered-coast', saveId: ref.id }, auth: PLAYER });
  const told = () => mockPrompts.join('\n');
  const onObject = (ref, object, act) => play(ref, { verb: 'object', object, act });

  test('a closed object opened from its menu, for its own AP; what it holds is told to the GM', async () => {
    const ref = await standing(`${id}-crate`, { x: 2, y: 1 });
    mockPrompts.length = 0;
    const answer = await onObject(ref, 'crate', 'open');
    expect(answer.narration).toBeTruthy();
    const save = await saved(ref);
    expect(save.objects).toEqual({ bm_vault: { crate: 'open' } });
    expect(save.turn.ap).toBe(20 - prices.of('object', 8));
    expect(told()).toContain('You open the crate.');
    expect(told()).toContain('It holds straw.');
    // Open: nothing more to do with it, nothing spent.
    mockPrompts.length = 0;
    await onObject(ref, 'crate', 'open');
    expect((await saved(ref)).turn.ap).toBe(20 - prices.of('object', 8));
  });

  test('a locked chest: unlocked and opened with its key; without it, refused, nothing spent', async () => {
    const without = await standing(`${id}-nokey`, { x: 2, y: 4 }, ['a lantern']);
    const refused = await onObject(without, 'chest', 'open');
    expect(refused.refused || refused.narration).toBeTruthy();
    let save = await saved(without);
    expect(save.objects).toBeUndefined();
    expect(save.turn.ap).toBe(20);

    const keyed = await standing(`${id}-key`, { x: 2, y: 4 }, ['A Brass Key']);
    mockPrompts.length = 0;
    await onObject(keyed, 'chest', 'unlock');
    save = await saved(keyed);
    expect(save.objects).toEqual({ bm_vault: { chest: 'open' } });
    expect(save.turn.ap).toBe(20 - prices.of('object'));
    expect(told()).toContain('You unlock the chest with brass key and open it.');
    expect(told()).toContain('a silver dagger and 12 gold pieces');
  });

  test('a lock picked as a long action: worked at over turns, rolled when done, then opened', async () => {
    const ref = await standing(`${id}-pick`, { x: 2, y: 4 });
    // The lock is a long action of 30 AP: this turn's 20 go in.
    const first = await onObject(ref, 'chest', 'unlock');
    expect(first.narration).toBeTruthy();
    let save = await saved(ref);
    expect(save.turn).toMatchObject({ ap: 0, long: { put: 20, need: 30 } });
    expect(save.objects).toBeUndefined();
    // The next turn, the rest (10) is put in and the lock is rolled.
    await ref.update({ 'turn.ap': 20 });
    mockPrompts.length = 0;
    const second = await onObject(ref, 'chest', 'unlock');
    expect(second.roll).toMatchObject({ against: 'the lock on the chest', success: true });
    save = await saved(ref);
    expect(save.objects).toEqual({ bm_vault: { chest: 'closed' } });
    expect(save.turn).toMatchObject({ ap: 10, long: null });
    expect(told()).toContain('The lock gives way: the chest is unlocked.');
    // Unlocked, it opens like any other.
    mockPrompts.length = 0;
    await onObject(ref, 'chest', 'open');
    expect((await saved(ref)).objects).toEqual({ bm_vault: { chest: 'open' } });
    expect(told()).toContain('a silver dagger and 12 gold pieces');
  });

  test('a lever unlocks the gate, and a strongbox behind the wall, for its own AP', async () => {
    const ref = await standing(`${id}-lever`, { x: 4, y: 1 });
    mockPrompts.length = 0;
    await onObject(ref, 'lever', 'pull');
    const save = await saved(ref);
    expect(save.doors).toEqual({ bm_vault: { gate: 'closed' } });
    expect(save.objects).toEqual({ bm_vault: { strongbox: 'closed' } });
    expect(save.turn.ap).toBe(20 - prices.of('object', 3));
    expect(told()).toContain('The lever grinds down.');
    expect(told()).toContain('The iron gate unlocks.');
  });

  test('out of reach: turned down, nothing spent', async () => {
    const ref = await standing(`${id}-far`, { x: 8, y: 6 });
    const answer = await onObject(ref, 'chest', 'unlock');
    expect(answer.refused || answer.narration).toBeTruthy();
    const save = await saved(ref);
    expect(save.turn.ap).toBe(20);
    expect(save.objects).toBeUndefined();
  });

  test('"What\'s here?" on an object: what it is and that it is locked; never what it holds; free', async () => {
    const ref = await standing(`${id}-look`, { x: 2, y: 4 });
    mockPrompts.length = 0;
    const answer = await play(ref, { verb: 'look', object: 'chest' });
    expect(answer.looked).toBe(true);
    expect(told()).toContain('An object: the chest, an iron-bound chest.');
    expect(told()).toContain('It is locked.');
    expect(told()).not.toMatch(/silver dagger|brass key|difficulty/);
    const save = await saved(ref);
    expect(save.turn.ap).toBe(20);
    expect(save.objects).toBeUndefined();
  });

  test('what the page is sent: state and priced actions; contents only once open', async () => {
    const ref = await standing(`${id}-view`, { x: 2, y: 4 }, ['brass key']);
    let { battleMap } = await viewOf(ref);
    const chest = battleMap.objects.find((o) => o.id === 'chest');
    expect(chest).toEqual({
      id: 'chest',
      name: 'the chest',
      state: 'locked',
      description: 'an iron-bound chest',
      actions: [{ id: 'unlock', name: 'Unlock', cost: prices.of('object') }],
    });
    // Its geometry for the page: no secrets.
    const sent = battleMap.geometry.objects.find((o) => o.id === 'chest');
    expect(sent.container).toBe(true);
    expect(JSON.stringify(battleMap)).not.toMatch(/silver dagger|difficulty|"unlocks"/);
    await onObject(ref, 'chest', 'unlock');
    ({ battleMap } = await viewOf(ref));
    expect(battleMap.objects.find((o) => o.id === 'chest')).toMatchObject({
      state: 'open',
      contents: 'a silver dagger and 12 gold pieces',
      actions: [],
    });
  });
});
