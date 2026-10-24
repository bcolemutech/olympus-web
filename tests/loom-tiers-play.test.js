'use strict';

/**
 * Typed actions by tier in play (planning/action-points.md §4.6; L-835 /
 * #685), through loomPlayTurn with Gemini stubbed, under both built-in
 * systems (MD2): INTERPRET names a tier and the rules charge it: a major
 * action 20 AP, a minor one 3; one the AP left won't pay for is refused.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-tiers-play --verbose"
 */

const PROJECT = 'demo-loom-tiers-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// A hall 12 × 5, in at the west: mud down column 2, a wall at x = 4 with
// the gate in it at y 2–3, and Grell, minding his own business, at (8, 2).
const mockHall = () => ({
  id: 'bm_hall',
  name: 'The hall',
  width: 12,
  height: 5,
  image: null,
  entries: [{ id: 'west', x: 1, y: 2 }],
  exits: [{ id: 'out', name: 'the way out', x: 0, y: 2, to: 'out' }],
  features: [],
  walls: [
    {
      points: [
        { x: 4, y: 0 },
        { x: 4, y: 2 },
      ],
    },
    {
      points: [
        { x: 4, y: 3 },
        { x: 4, y: 5 },
      ],
    },
  ],
  doors: [{ id: 'gate', name: 'the gate', from: { x: 4, y: 2 }, to: { x: 4, y: 3 } }],
  obstacles: [{ id: 'mud', name: 'mud', kind: 'difficult', x: 2, y: 0, h: 5 }],
  hazards: [],
});
const mockCases = {
  'd20-fantasy': { system: FANTASY, club: '1d20 + 10' },
  'pool-scifi': { system: SCIFI, club: 'count(8d10, >= 7)' },
};

const mockState = { id: 'd20-fantasy', intent: null };
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
            cell: { x: 8, y: 2 },
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
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) return mockState.intent;
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

beforeAll(() => {
  // Every die rolls high.
  jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max - 1);
});
afterAll(async () => {
  crypto.randomInt.mockRestore();
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

describe.each(Object.keys(mockCases))('typed actions by tier in play under %s', (id) => {
  const c = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });

  const typed = (ref, text, tier) => {
    mockState.intent = { verb: 'barricade', targets: [], params: { tier } };
    return loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, actionText: text },
      auth: PLAYER,
    });
  };
  const apOf = async (ref) => (await ref.get()).data().turn.ap;

  test('a major action spends 20 AP, a minor one 3; one too dear is refused', async () => {
    const ref = db.collection('loom_saves').doc(`${id}-tiers`);
    await ref.set({
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
      cell: { x: 1, y: 2 },
    });
    await typed(ref, 'shove the bench against the gate', 'major');
    expect(await apOf(ref)).toBe(0);
    await loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, action: { verb: 'end-turn' } },
      auth: PLAYER,
    });
    await typed(ref, 'call out a warning', 'minor');
    expect(await apOf(ref)).toBe(17);
    const refused = await typed(ref, 'shove the bench against the gate', 'major');
    expect(refused).toMatchObject({ refused: true, narration: 'That costs 20 AP; you have 17.' });
    expect(await apOf(ref)).toBe(17);
  });
});
