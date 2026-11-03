'use strict';

/**
 * Moving off the grid in play (planning/maps-from-data.md §4.2; L-922 /
 * #726), through loomPlayTurn with Gemini stubbed, on the station's deck in
 * the Andor world (./fixtures/andor-world.js), a grid four maps down: a wall
 * across the deck with a 3 ft gap in it. A medium character walks through
 * the gap, paying 1 AP per 5 ft, and stands at a point in feet, kept in
 * `gridPoint` and at the end of `at`; loomGetMap gives the point, the
 * character's size and the geometry for the grid view; Continue walks the
 * rest of a plan; a large character finds no way through.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-map-paths-play --verbose"
 */

const PROJECT = 'demo-loom-map-paths-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const mockWorld = (() => {
  const geo = require('../functions/loom-canon/map-geometry');
  const w = require('./fixtures/andor-world').andorWorld('andor-gap');
  // The deck is 12 × 8 squares (60 × 40 ft): a bulkhead across it at x = 30
  // ft, with a 3 ft gap at y 21–24, around row 4's middle.
  w.maps.deck = {
    ...w.maps.deck,
    geometry: geo.normalize({
      walls: [
        {
          id: 'north',
          material: 'metal',
          points: [
            [30, 0],
            [30, 21],
          ],
        },
        {
          id: 'south',
          material: 'metal',
          points: [
            [30, 24],
            [30, 40],
          ],
        },
      ],
    }),
  };
  return w;
})();

jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  return {
    ...real,
    loadWorld: async (worldId, options) =>
      worldId === mockWorld.id ? mockWorld : real.loadWorld(worldId, options),
  };
});
const mockCallGemini = jest.fn(async (options) => {
  if (options.systemInstruction.includes('summarizer')) return 'A summary.';
  if (options.systemInstruction.includes('INTERPRET stage')) {
    return { verb: 'look', targets: [], params: {} };
  }
  return { narration: 'You go on.', inventedEntities: [], suggestedActions: [] };
});
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomPlayTurn, loomGetMap } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const frames = require('../functions/loom-canon/frames');

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const db = getFirestore();

const WORLD = mockWorld.id;
const PLAYER = { uid: 'player-paths', token: { apps: ['loom'] } };
const saveRef = (saveId) => db.collection('loom_saves').doc(saveId);
const saveOf = async (saveId) => (await saveRef(saveId).get()).data();

// Down the station to the dock, and onto the deck at `cell`.
const deckAt = (cell) => [
  { mapId: 'sector', placeId: 'pl_vega' },
  { mapId: 'vega', placeId: 'pl_station' },
  { mapId: 'station', placeId: 'pl_dock' },
  { mapId: 'deck', cell },
];

async function seed(saveId, cell, { size, ap = 20 } = {}) {
  const sheet = { ...sheets.defaultSheet(BUILT_IN['d20-fantasy']), ...(size ? { size } : {}) };
  // The frame's fields beside `at`, as every write keeps them (L-903).
  const { fields } = frames.legacyOf(frames.playWorld(mockWorld), deckAt(cell));
  const save = makeSave({
    ownerUid: PLAYER.uid,
    worldId: WORLD,
    name: 'Andor',
    character: { name: 'Ash', sheet },
    at: deckAt(cell),
    discovered: ['pl_rigel', 'pl_vega', 'pl_station', 'pl_dock'],
    visited: [],
    waysKnown: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await saveRef(saveId).set({ ...save, ...fields, turn: { n: 1, ap, kept: 0, plan: null } });
}

const play = (saveId, action) =>
  loomPlayTurn.run({ data: { worldId: WORLD, saveId, action }, auth: PLAYER });
const mapOf = (saveId) => loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

describe('a move through a narrow gap, four maps down', () => {
  test('a medium character walks through the 3 ft gap, 1 AP per 5 ft', async () => {
    await seed('medium', { x: 2, y: 4 });
    const answer = await play('medium', { verb: 'move', cell: { x: 9, y: 4 } });
    // Straight along row 4's middle, through the gap: 35 ft, 7 AP.
    expect(answer.step).toMatchObject({
      cell: { x: 9, y: 4 },
      point: { x: 47.5, y: 22.5 },
      ap: 13,
      plan: null,
    });
    const save = await saveOf('medium');
    expect(save.cell).toEqual({ x: 9, y: 4 });
    expect(save.gridPoint).toEqual({ x: 47.5, y: 22.5 });
    expect(save.mapId).toBe('deck');
    // Where it stands at depth: a point in feet on the deck.
    expect(save.at).toEqual([
      ...deckAt({ x: 9, y: 4 }).slice(0, 3),
      { mapId: 'deck', point: { x: 47.5, y: 22.5 } },
    ]);
    expect(save.turn.ap).toBe(13);
  });

  test('loomGetMap gives the grid view its point, the character’s size and the geometry', async () => {
    const view = await mapOf('medium');
    expect(view.battleMap).toMatchObject({
      id: 'deck',
      here: { x: 9, y: 4 },
      herePoint: { x: 47.5, y: 22.5 },
      size: { id: 'medium', width: 2.5 },
    });
    // The bulkhead, as far as it's been seen.
    expect((view.battleMap.geometry.walls || []).map((w) => w.id).sort()).toEqual([
      'north',
      'south',
    ]);
    expect(view.turn.prices).toMatchObject({ move: 1, difficult: 2 });
  });

  test('short of AP, it stops partway at a point; Continue walks the rest', async () => {
    await seed('partway', { x: 2, y: 4 }, { ap: 4 });
    const first = await play('partway', { verb: 'move', cell: { x: 9, y: 4 } });
    // 4 AP is 20 ft: to x 32.5, through the gap.
    expect(first.step.point).toEqual({ x: 32.5, y: 22.5 });
    expect(first.step.plan).toMatchObject({ to: { x: 9, y: 4 }, point: { x: 47.5, y: 22.5 } });
    let save = await saveOf('partway');
    expect(save.gridPoint).toEqual({ x: 32.5, y: 22.5 });
    expect(save.turn.ap).toBe(0);
    // The next turn: the plan's point, 15 ft on.
    await saveRef('partway').update({ 'turn.ap': 20 });
    const on = await play('partway', { verb: 'continue' });
    expect(on.step).toMatchObject({ cell: { x: 9, y: 4 }, point: { x: 47.5, y: 22.5 }, ap: 17 });
    save = await saveOf('partway');
    expect(save.turn.plan).toBeNull();
  });

  test('a point in feet can be walked to, not only a square', async () => {
    await seed('point', { x: 2, y: 4 });
    const answer = await play('point', { verb: 'move', point: { x: 40, y: 30 } });
    expect(answer.step.point).toEqual({ x: 40, y: 30 });
    expect(answer.step.cell).toEqual({ x: 8, y: 6 });
    const save = await saveOf('point');
    expect(save.gridPoint).toEqual({ x: 40, y: 30 });
  });

  test('a large character finds no way through the gap', async () => {
    await seed('large', { x: 2, y: 4 }, { size: 'large' });
    const answer = await play('large', { verb: 'move', cell: { x: 9, y: 4 } });
    expect(answer.narration).toBe("There's no way there from here.");
    const save = await saveOf('large');
    expect(save.cell).toEqual({ x: 2, y: 4 });
    expect(save.turn.ap).toBe(20);
    // On its own side it moves as freely as anyone.
    const near = await play('large', { verb: 'move', cell: { x: 4, y: 4 } });
    expect(near.step).toMatchObject({ cell: { x: 4, y: 4 }, ap: 18 });
  });
});
