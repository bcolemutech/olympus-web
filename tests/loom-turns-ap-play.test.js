'use strict';

/**
 * Turns on action points in play (planning/action-points.md §4.3, §4.10;
 * L-832 / #682), through loomPlayTurn with Gemini stubbed, under both
 * built-in systems (MD2): one turn walks over mud (double cost), opens a
 * door and attacks, each spending its AP, and a second attack it can't pay
 * for is refused; End turn refills the pool; a save from before AP, in the
 * middle of a fight, is converted (its movement left as its AP) and the
 * fight carries on, every pool full at the next turn.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-turns-ap-play --verbose"
 */

const PROJECT = 'demo-loom-turns-ap-play';
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

describe.each(Object.keys(mockCases))('turns on AP in play under %s', (id) => {
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
  const play = (ref, action) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, action },
      auth: PLAYER,
    });
  const saved = async (ref) => (await ref.get()).data();
  const viewOf = (ref) =>
    loomGetMap.run({ data: { worldId: 'shattered-coast', saveId: ref.id }, auth: PLAYER });

  test('one turn walks over mud, opens the gate and attacks, each spending its AP', async () => {
    const ref = await onTheMap(`${id}-turn`);
    expect((await viewOf(ref)).turn).toMatchObject({
      n: 1,
      ap: 20,
      pool: 20,
      kept: 0,
      prices: { move: 1, difficult: 2, door: 2, doors: { gate: 2 } },
    });
    // Over the mud (2) and on (1).
    const walked = await play(ref, { verb: 'move', cell: { x: 3, y: 2 } });
    expect(walked.step).toMatchObject({ cell: { x: 3, y: 2 }, ap: 17 });
    // The gate, by a tap: 2.
    const opened = await play(ref, { verb: 'door', door: 'gate', open: true });
    expect(opened.step).toMatchObject({ ap: 15, lines: ['You open the gate.'] });
    // Through it, to Grell's side: 4 squares.
    const there = await play(ref, { verb: 'move', cell: { x: 7, y: 2 } });
    expect(there.step).toMatchObject({ cell: { x: 7, y: 2 }, ap: 11 });
    // The attack: 10; it starts the fight.
    await play(ref, { verb: 'attack', target: 'grell' });
    let save = await saved(ref);
    expect(save.turn).toMatchObject({ n: 1, ap: 1, moved: 6 });
    // It started a fight (over at once if the blow felled him).
    expect(save.figures.grell).toBeDefined();
    // Another it can't pay for: refused, nothing spent.
    expect(await play(ref, { verb: 'attack', target: 'grell' })).toMatchObject({
      refused: true,
      narration: 'An attack costs 10 AP; you have 1.',
    });
    expect((await saved(ref)).turn.ap).toBe(1);
    // End turn: Grell's turn, and the pool full again.
    await play(ref, { verb: 'end-turn' });
    save = await saved(ref);
    expect(save.turn).toEqual({ n: 2, ap: 20, kept: 0, plan: null });
    expect((await viewOf(ref)).turn).toMatchObject({ n: 2, ap: 20, pool: 20 });
  });

  test('a save from before AP, mid-fight, is converted and the fight carries on', async () => {
    const ref = await onTheMap(`${id}-older`, {
      cell: { x: 7, y: 2 },
      doors: { bm_hall: { gate: 'open' } },
      // The turn and the sheet as they were before AP.
      turn: { n: 3, movementLeft: 3, actionUsed: true, plan: null },
      character: {
        name: 'Tam',
        inventory: [],
        goals: [],
        sheet: (() => {
          const { ap, ...rest } = sheets.defaultSheet(c.system);
          return { ...rest, speed: ap };
        })(),
      },
      fight: {
        id: 'fight-1',
        mapId: 'bm_hall',
        by: 'attack',
        round: 2,
        order: ['player', 'grell'],
        turn: 'player',
        combatants: {
          player: { kind: 'player', side: 'party', name: 'Tam', initiative: 15, reactionsLeft: 1 },
          grell: {
            kind: 'character',
            side: 'hostile',
            name: 'Grell',
            initiative: 5,
            reactionsLeft: 1,
            joined: true,
          },
        },
      },
    });
    // Its movement left is its AP; the sheet's speed is its pool.
    expect((await viewOf(ref)).turn).toMatchObject({ n: 3, ap: 3, pool: 20, kept: 0 });
    expect(await play(ref, { verb: 'attack', target: 'grell' })).toMatchObject({
      refused: true,
      narration: 'An attack costs 10 AP; you have 3.',
    });
    await play(ref, { verb: 'end-turn' });
    const save = await saved(ref);
    expect(save.fight).toMatchObject({ round: 3, turn: 'player' });
    expect(save.turn).toEqual({ n: 4, ap: 20, kept: 0, plan: null });
    // Now on AP, its next blow is paid for.
    await play(ref, { verb: 'attack', target: 'grell' });
    expect((await saved(ref)).turn.ap).toBe(10);
  });
});
