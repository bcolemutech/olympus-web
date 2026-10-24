'use strict';

/**
 * AP off in play (planning/action-points.md §4.1; MD9; L-838 / #692),
 * through loomPlayTurn with Gemini stubbed, under each built-in copied with
 * `ap: false` (MD10): a turn walks across the hall in one go, acts, and is
 * refused a second action; in a fight, two foes break and run past the
 * player in one round, and only the first draws the player's attack: one
 * reaction a round.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-ap-off-play --verbose"
 */

const PROJECT = 'demo-loom-ap-off-play';
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
  features: [{ id: 'lever', name: 'the lever', x: 10, y: 1 }],
  walls: [],
  doors: [],
  obstacles: [],
  hazards: [],
});
const mockCases = {
  'd20-fantasy': { system: FANTASY, club: '1d20 + 10' },
  'pool-scifi': { system: SCIFI, club: 'count(8d10, >= 7)' },
};

const mockState = { id: 'd20-fantasy', foes: true };
// The built-in copied with AP off (L-838).
const mockOff = (system) => {
  const s = { ...JSON.parse(JSON.stringify(system)), id: 'off-copy', ap: false };
  delete s.sheet.ap;
  return s;
};
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
        system: mockOff(c.system),
        locations: {
          ...COAST.locations,
          'widows-reach': { ...COAST.locations['widows-reach'], battleMap: { mapId: 'bm_hall' } },
        },
        characters: {
          ...COAST.characters,
          ...(mockState.foes
            ? Object.fromEntries(
                [
                  ['grell', 'Grell', { x: 6, y: 2 }],
                  ['moss', 'Moss', { x: 6, y: 3 }],
                ].map(([fid, name, cell]) => {
                  const s = sheetsReal.defaultSheet(c.system);
                  s.resources.health = { current: 1 };
                  s.attacks = [{ id: 'club', name: 'Club', reach: 1, attack: c.club, damage: '1' }];
                  return [
                    fid,
                    {
                      id: fid,
                      name,
                      description: 'A bandit with a club.',
                      locationId: 'widows-reach',
                      cell,
                      side: 'hostile',
                      posture: 'cowardly',
                      sheet: s,
                    },
                  ];
                })
              )
            : {}),
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

describe.each(Object.keys(mockCases))('AP off in play, from %s', (id) => {
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
      cell: { x: 1, y: 2 },
      ...fields,
    });
    return ref;
  }
  const play = (ref, data) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, ...data },
      auth: PLAYER,
    });
  const saved = async (ref) => (await ref.get()).data();

  test('a turn walks the hall in one go, acts, and is refused a second action', async () => {
    mockState.foes = false;
    const ref = await onTheMap(`${id}-turn`);
    const view = await loomGetMap.run({
      data: { worldId: 'shattered-coast', saveId: ref.id },
      auth: PLAYER,
    });
    expect(view.turn).toMatchObject({ n: 1, apOff: true, acted: false });
    // Across the hall in one go: steps are free.
    const walked = await play(ref, { action: { verb: 'move', cell: { x: 10, y: 2 } } });
    expect(walked.step).toMatchObject({ cell: { x: 10, y: 2 } });
    expect((await saved(ref)).turn).toMatchObject({ ap: 20, moved: 9 });
    // The lever: the turn's action.
    const used = await play(ref, { action: { verb: 'use', feature: 'lever' } });
    expect(used.refused).toBeUndefined();
    expect((await saved(ref)).turn).toMatchObject({ acted: true });
    expect(await play(ref, { action: { verb: 'use', feature: 'lever' } })).toMatchObject({
      refused: true,
      narration: "You've acted this turn. End your turn first.",
    });
    // End turn gives it back.
    await play(ref, { action: { verb: 'end-turn' } });
    expect((await saved(ref)).turn).toEqual({ n: 2, ap: 20, kept: 0, plan: null });
    mockState.foes = true;
  });

  test('in a fight, one reaction a round: the first to run past is struck, the second not', async () => {
    mockState.foes = true;
    const ref = await onTheMap(`${id}-fight`, {
      cell: { x: 5, y: 2 },
      fight: {
        id: 'fight-1',
        mapId: 'bm_hall',
        by: 'seen',
        round: 2,
        order: ['player', 'grell', 'moss'],
        turn: 'player',
        combatants: {
          player: { kind: 'player', side: 'party', name: 'Tam', initiative: 15, reactionsLeft: 1 },
          grell: {
            kind: 'character',
            side: 'hostile',
            name: 'Grell',
            initiative: 9,
            reactionsLeft: 1,
          },
          moss: {
            kind: 'character',
            side: 'hostile',
            name: 'Moss',
            initiative: 5,
            reactionsLeft: 1,
          },
        },
      },
    });
    await play(ref, { action: { verb: 'end-turn' } });
    const turns = await ref.collection('loom_turns').orderBy('index', 'desc').limit(1).get();
    const lines = turns.docs[0].data().resolution.constraints;
    expect(lines).toContain('Grell breaks and runs.');
    expect(lines).toContain('Moss breaks and runs.');
    expect(lines).toContain('Grell leaves your reach.');
    expect(lines).not.toContain('Moss leaves your reach.');
    // A new round: the player's reaction is back.
    const save = await saved(ref);
    if (save.fight) expect(save.fight.combatants.player.reactionsLeft).toBe(1);
  });
});
