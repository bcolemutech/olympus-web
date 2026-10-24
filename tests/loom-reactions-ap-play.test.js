'use strict';

/**
 * Off your turn in play (planning/action-points.md §4.4; L-833 / #683),
 * through loomPlayTurn with Gemini stubbed, under both built-in systems
 * (MD2): the player ends their turn with 10 AP kept; Grell, nearly done for
 * and cowardly, breaks and runs, stepping out of the player's reach, and the
 * player's attack goes off, paid from what they kept. With too little kept,
 * it doesn't.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-reactions-ap-play --verbose"
 */

const PROJECT = 'demo-loom-reactions-ap-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// A hall 12 × 5, in at the west, the way out at the east; Grell beside the
// player, nearly done for and cowardly: he runs for the way out.
const mockHall = () => ({
  id: 'bm_hall',
  name: 'The hall',
  width: 12,
  height: 5,
  image: null,
  entries: [{ id: 'west', x: 1, y: 2 }],
  exits: [{ id: 'out', name: 'the far door', x: 11, y: 2, to: 'out' }],
  features: [],
  walls: [],
  doors: [],
  obstacles: [],
  hazards: [],
});
const mockCases = {
  'd20-fantasy': { system: FANTASY, club: '1d20 + 10' },
  'pool-scifi': { system: SCIFI, club: 'count(8d10, >= 7)' },
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
            posture: 'cowardly',
            sheet: (() => {
              const s = sheetsReal.defaultSheet(c.system);
              s.resources.health = { current: 1 };
              s.attacks = [{ id: 'club', name: 'Club', reach: 1, attack: c.club, damage: '1' }];
              return s;
            })(),
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
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return { verb: 'look', targets: [], params: {} };
    }
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

describe.each(Object.keys(mockCases))('off your turn in play under %s', (id) => {
  const c = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });

  // The player beside Grell, in a fight, their turn, `ap` left of it.
  async function inTheFight(saveId, ap) {
    const ref = db.collection('loom_saves').doc(saveId);
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
      cell: { x: 5, y: 2 },
      turn: { n: 1, ap, kept: 0, plan: null },
      fight: {
        id: 'fight-1',
        mapId: 'bm_hall',
        by: 'seen',
        round: 2,
        order: ['player', 'grell'],
        turn: 'player',
        combatants: {
          player: { kind: 'player', side: 'party', name: 'Tam', initiative: 15, kept: 0 },
          grell: { kind: 'character', side: 'hostile', name: 'Grell', initiative: 5, kept: 0 },
        },
      },
    });
    return ref;
  }
  const endTurn = (ref) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, action: { verb: 'end-turn' } },
      auth: PLAYER,
    });
  const lastLines = async (ref) => {
    const turns = await ref.collection('loom_turns').orderBy('index', 'desc').limit(1).get();
    return turns.docs[0].data().resolution.constraints;
  };

  test('10 AP kept: Grell runs, steps out of reach, and the player’s attack goes off', async () => {
    const ref = await inTheFight(`${id}-kept`, 10);
    await endTurn(ref);
    const lines = await lastLines(ref);
    expect(lines[0]).toMatch(/You keep 10 AP for reactions\.$/);
    expect(lines).toContain('Grell breaks and runs.');
    expect(lines).toContain('Grell leaves your reach.');
    // The player's attack, as it is struck.
    expect(lines[lines.indexOf('Grell leaves your reach.') + 1]).toMatch(/^You (hit|miss)/);
    const save = (await ref.get()).data();
    // The pool full again for the player's next turn, nothing kept.
    expect(save.turn).toMatchObject({ n: 2, ap: 20, kept: 0 });
  });

  test('9 kept: too little for an attack, so Grell gets away untouched', async () => {
    const ref = await inTheFight(`${id}-short`, 9);
    await endTurn(ref);
    const lines = await lastLines(ref);
    expect(lines[0]).toMatch(/You keep 9 AP for reactions\.$/);
    expect(lines).toContain('Grell breaks and runs.');
    expect(lines).not.toContain('Grell leaves your reach.');
    const save = (await ref.get()).data();
    expect((save.figures || {}).grell || {}).not.toHaveProperty('down');
  });
});
