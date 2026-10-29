'use strict';

/**
 * Wary figures in play (planning/builders-tools.md §4.2; L-392 / #738),
 * through loomPlayTurn with Gemini stubbed, under both built-in systems: a
 * gate guard challenges (NARRATE is told), and a failed bluff starts the
 * fight; forcing the hold grating turns a group of guards hostile; and
 * attacking a wary guard starts the fight at once.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-combat-wary-play --verbose"
 */

const PROJECT = 'demo-loom-wary-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const mockCases = {
  'd20-fantasy': {
    system: BUILT_IN['d20-fantasy'],
    bluff: 'Deception',
    block: {
      attributes: { STR: 12, DEX: 12, CON: 10, INT: 8, WIS: 8, CHA: 8 },
      attacks: [{ id: 'spear', name: 'Spear', reach: 1, attack: '1d20 + 2', damage: '1' }],
    },
  },
  'pool-scifi': {
    system: BUILT_IN['pool-scifi'],
    bluff: 'Persuade',
    block: {
      attributes: { Body: 3, Reflex: 3, Mind: 2, Presence: 2 },
      attacks: [{ id: 'baton', name: 'Baton', reach: 1, attack: 'count(4d10, >= 7)', damage: '1' }],
    },
  },
};
const mockState = { id: 'd20-fantasy', interpret: null };

// The Hulks' deck, 12 × 6: in at the west, the hold grating on the edge
// above (8, 1), two wary guards who turn if it is forced; the gate guard,
// a named character, by the gangway at (2, 2).
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      const c = mockCases[mockState.id];
      const s = jest.requireActual('../functions/loom-canon/sheets');
      const guardSheet = s.sheetFromStatBlock(c.system, c.block);
      for (const r of c.system.sheet.resources) guardSheet.resources[r.id] = { current: 500 };
      return {
        ...COAST,
        system: c.system,
        locations: {
          ...COAST.locations,
          'widows-reach': { ...COAST.locations['widows-reach'], battleMap: { mapId: 'bm_deck' } },
        },
        characters: {
          ...COAST.characters,
          sentry: {
            id: 'sentry',
            name: 'The Sentry',
            description: 'A gate guard in a salt-stained coat.',
            locationId: 'widows-reach',
            cell: { x: 2, y: 2 },
            side: 'wary',
            challenge: { says: 'Halt. Name your business.', check: { skill: c.bluff } },
            sheet: guardSheet,
          },
        },
        battleMaps: {
          bm_deck: {
            id: 'bm_deck',
            name: 'The deck',
            width: 12,
            height: 6,
            image: null,
            entries: [{ id: 'west', x: 1, y: 3 }],
            exits: [{ id: 'out', name: 'the gangway', x: 0, y: 3, to: 'out' }],
            features: [],
            walls: [],
            doors: [
              {
                id: 'grating',
                name: 'the hold grating',
                from: { x: 8, y: 1 },
                to: { x: 9, y: 1 },
                locked: true,
              },
            ],
            obstacles: [],
            hazards: [],
            figures: [
              {
                id: 'guards',
                name: 'Hulk guard',
                statBlock: c.block,
                side: 'wary',
                triggers: [{ on: 'doorForced', target: 'grating', then: 'hostile' }],
                cells: [
                  { x: 6, y: 4 },
                  { x: 7, y: 4 },
                ],
              },
            ],
          },
        },
      };
    },
  };
});
const mockPrompts = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('COMBAT TURN')) return null;
    if (options.systemInstruction.includes('INTERPRET stage')) return mockState.interpret;
    mockPrompts.push(options.userMessage);
    return { narration: 'The deck creaks.', inventedEntities: [], suggestedActions: [] };
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

let dice = 'high';
beforeAll(() => {
  jest
    .spyOn(crypto, 'randomInt')
    .mockImplementation((min, max) => (dice === 'high' ? max - 1 : min));
});
afterAll(async () => {
  crypto.randomInt.mockRestore();
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

describe.each(Object.keys(mockCases))('wary figures in play under %s', (id) => {
  const c = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });

  async function onDeck(saveId, cell) {
    const ref = db.collection('loom_saves').doc(saveId);
    const sheet = sheets.defaultSheet(c.system);
    for (const r of c.system.sheet.resources) sheet.resources[r.id] = { current: 500 };
    await ref.set({
      ...makeSave({
        ownerUid: PLAYER.uid,
        worldId: 'shattered-coast',
        name: 'Voyage',
        character: { name: 'Tam', sheet },
        location: 'widows-reach',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      mapId: 'bm_deck',
      cell,
      turn: { n: 1, ap: 40, kept: 0, plan: null },
    });
    return ref;
  }
  const play = (ref, data) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, ...data },
      auth: PLAYER,
    });

  test('the gate guard challenges; a failed bluff starts the fight', async () => {
    const ref = await onDeck(`${id}-bluff`, { x: 3, y: 2 });
    // In sight of them all, and no fight.
    mockState.interpret = { verb: 'look', targets: [], params: {} };
    dice = 'high';
    await play(ref, { actionText: 'look around' });
    expect((await ref.get()).data().fight || null).toBeNull();
    expect(mockPrompts.at(-1)).toContain(
      'The Sentry (2, 2), beside the player, wary of the player: they challenge, "Halt. Name your business."'
    );
    // The bluff fails.
    mockState.interpret = {
      verb: 'deceive',
      targets: ['sentry'],
      params: { check: { skill: c.bluff } },
    };
    dice = 'low';
    const answer = await play(ref, { actionText: "I'm the new cook" });
    expect(answer.roll.success).toBe(false);
    const save = (await ref.get()).data();
    expect(save.sides).toEqual({ sentry: 'hostile' });
    expect(save.fight).toMatchObject({ by: 'event' });
    expect(Object.keys(save.fight.combatants).sort()).toEqual(['player', 'sentry']);
  });

  test('forcing the hold grating turns the guards hostile', async () => {
    const ref = await onDeck(`${id}-grating`, { x: 8, y: 1 });
    mockState.interpret = { verb: 'force', targets: ['door:grating'], params: {} };
    dice = 'high';
    await play(ref, { actionText: 'force the grating' });
    // The fight that follows is narrated: the GM is told who turned.
    expect(mockPrompts.at(-1)).toContain('Hulk guard 1 turns on you.');
    const save = (await ref.get()).data();
    expect(save.sides).toEqual({ 'fig-guards-1': 'hostile', 'fig-guards-2': 'hostile' });
    expect(save.fight.combatants).toHaveProperty('fig-guards-1');
    expect(save.fight.combatants).toHaveProperty('fig-guards-2');
    // The sentry, wary still, stays out of it.
    expect(save.fight.combatants).not.toHaveProperty('sentry');
  });

  test('attacking a wary guard starts the fight at once, their group with them', async () => {
    const ref = await onDeck(`${id}-attack`, { x: 5, y: 4 });
    dice = 'high';
    await play(ref, { action: { verb: 'attack', target: 'fig-guards-1' } });
    const save = (await ref.get()).data();
    expect(save.sides).toMatchObject({ 'fig-guards-2': 'hostile' });
    expect(save.fight).toMatchObject({ by: 'attack' });
    expect(save.fight.combatants['fig-guards-2']).toMatchObject({ side: 'hostile' });
  });
});
