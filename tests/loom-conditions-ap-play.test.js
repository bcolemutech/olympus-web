'use strict';

/**
 * Conditions on AP in play (planning/action-points.md §4.5; L-834 / #684),
 * through loomPlayTurn with Gemini stubbed, under both built-in systems
 * (MD2): Grell, stunned for a round, takes no turn that round and strikes the
 * next; a prone player's walk costs double, and standing up costs its 5.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-conditions-ap-play --verbose"
 */

const PROJECT = 'demo-loom-conditions-ap-play';
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
            sheet: (() => {
              const s = sheetsReal.defaultSheet(c.system);
              s.attacks = [{ id: 'club', name: 'Club', reach: 1, attack: c.club, damage: '1' }];
              // Stunned for a round (L-834): no AP, so no turn.
              s.conditions = [{ condition: 'stunned', duration: { rounds: 1 } }];
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

describe.each(Object.keys(mockCases))('conditions on AP in play under %s', (id) => {
  const c = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });

  async function onTheMap(saveId, fields = {}) {
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
  const lastLines = async (ref) => {
    const turns = await ref.collection('loom_turns').orderBy('index', 'desc').limit(1).get();
    return turns.docs[0].data().resolution.constraints.join(' ');
  };
  const fight = () => ({
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
  });

  test('Grell, stunned for a round, takes no turn that round, and strikes the next', async () => {
    const ref = await onTheMap(`${id}-stunned`, { fight: fight() });
    await play(ref, { verb: 'end-turn' });
    expect(await lastLines(ref)).not.toMatch(/Grell (hits|misses) you/);
    await play(ref, { verb: 'end-turn' });
    expect(await lastLines(ref)).toMatch(/Grell (hits|misses) you/);
  });

  test('a prone player’s walk costs double; standing up costs its 5', async () => {
    const sheet = sheets.defaultSheet(c.system);
    sheet.conditions = [{ condition: 'prone', duration: { turns: 5 } }];
    const ref = await onTheMap(`${id}-prone`, {
      cell: { x: 1, y: 2 },
      character: { name: 'Tam', inventory: [], goals: [], sheet },
    });
    // Grell is out of this one: the walk stays clear of him (and he's stunned).
    const walked = await play(ref, { verb: 'move', cell: { x: 3, y: 2 } });
    expect(walked.step).toMatchObject({ cell: { x: 3, y: 2 }, ap: 20 - 2 * 2 });
    const stood = await play(ref, { verb: 'stand' });
    expect(stood.narration).toBe('You stand up.');
    const save = await saved(ref);
    expect(save.turn.ap).toBe(16 - 5);
    expect(save.character.sheet.conditions).toEqual([]);
    // On their feet, a square costs 1.
    const on = await play(ref, { verb: 'move', cell: { x: 4, y: 2 } });
    expect(on.step).toMatchObject({ ap: 10 });
  });
});
