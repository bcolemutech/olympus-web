'use strict';

/**
 * What the map is sent for travel across country (planning/off-road-
 * travel.md §4.7, TR5; L-367 / #841), through loomPlayTurn and loomGetMap with
 * Gemini stubbed, under both built-in systems, on The Weald
 * (./fixtures/wilds-world.js) with no navigation check:
 *
 *   - loomGetMap sends the planner's inputs (`wilds`): the module's pace and
 *     day, the scale, the routes as lanes (only those between places the save
 *     has found);
 *   - a journey's camps are kept leg by leg and sent again by every reload:
 *     one after the first leg, two after the second, none once it arrives or
 *     is stopped;
 *   - a world with off-road travel off sends no `wilds` and no journey.
 *
 * (The page's preview, its drawing and its menus are tests/loom-wild-map-
 * draw.test.js.)
 *
 * Run: cd tests && firebase emulators:exec --only firestore,storage \
 *        --project demo-loom-wild-map-play "npx jest loom-wild-map-play --verbose"
 */

const PROJECT = 'demo-loom-wild-map-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const { BUILT_IN: mockSystems } = require('../functions/loom-canon/systems');
const { wildsWorld: mockWildsWorld } = require('./fixtures/wilds-world');

const mockWorlds = {};
for (const id of ['d20-fantasy', 'pool-scifi']) {
  const world = mockWildsWorld('weald-' + id, { system: mockSystems[id] });
  world.rules = { ...world.rules, wilds: { navigation: null } };
  mockWorlds[world.id] = world;
}
const offWorld = mockWildsWorld('weald-off', { system: mockSystems['d20-fantasy'] });
offWorld.rules = { ...offWorld.rules, wilds: false };
mockWorlds[offWorld.id] = offWorld;

jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  return {
    ...real,
    loadWorld: async (worldId, options) => mockWorlds[worldId] || real.loadWorld(worldId, options),
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
const clock = require('../functions/loom-canon/clock');

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const db = getFirestore();

const PLAYER = { uid: 'player-wilds-map', token: { apps: ['loom'] } };
const ASHBY = [{ mapId: 'weald', placeId: 'pl_ashby' }];
const saveRef = (saveId) => db.collection('loom_saves').doc(saveId);
const saveOf = async (saveId) => (await saveRef(saveId).get()).data();

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

async function seed(worldId, saveId, fields = {}) {
  await saveRef(saveId).set(
    makeSave({
      ownerUid: PLAYER.uid,
      worldId,
      name: 'Weald',
      character: { name: 'Ash' },
      at: ASHBY,
      discovered: ['pl_ashby', 'pl_carrow', 'pl_dunsmouth'],
      visited: ['pl_ashby'],
      waysKnown: {},
      time: clock.START,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...fields,
    })
  );
}
const act = (worldId, saveId, action) =>
  loomPlayTurn.run({ data: { worldId, saveId, action }, auth: PLAYER });
const mapOf = (worldId, saveId) =>
  loomGetMap.run({ data: { worldId, saveId }, auth: PLAYER });

describe.each(['d20-fantasy', 'pool-scifi'])('the map across country under %s', (systemId) => {
  const WORLD = 'weald-' + systemId;
  const sid = (name) => systemId + '-' + name;

  test('loomGetMap sends what the page plans with', async () => {
    await seed(WORLD, sid('plan'));
    const map = await mapOf(WORLD, sid('plan'));
    expect(map.wilds).toMatchObject({
      pace: 1.5,
      dayHours: 8,
      discover: 3,
      scale: 1,
      unit: 'miles',
      regions: {},
      zones: [],
    });
    // The road to Dunsmouth, as a lane at the road's speed (a straight route
    // winds, so it is a little slower than the road's 3).
    expect(map.wilds.lanes).toHaveLength(1);
    expect(map.wilds.lanes[0]).toMatchObject({ id: 'pl_ashby|pl_dunsmouth' });
    expect(map.wilds.lanes[0].speed).toBeGreaterThan(2);
    expect(map.wilds.lanes[0].speed).toBeLessThanOrEqual(3);
    expect(map.wilds.lanes[0].points).toEqual([
      [2, 10],
      [2, 20],
    ]);
    // The region map's ground, to plan on.
    expect(map.map.geometry.ground).toHaveLength(2);
    expect(map.journey).toBeNull();
    expect(map.wild).toBeNull();
  });

  test('a road to a place not found is not sent', async () => {
    await seed(WORLD, sid('hidden'), { discovered: ['pl_ashby', 'pl_carrow'] });
    const map = await mapOf(WORLD, sid('hidden'));
    expect(map.wilds.lanes).toEqual([]);
    expect(JSON.stringify(map)).not.toContain('pl_dunsmouth');
  });

  test('the camps are kept leg by leg, and sent again by every reload', async () => {
    const saveId = sid('camps');
    await seed(WORLD, saveId);
    await act(WORLD, saveId, { verb: 'travel', to: 'pl_carrow', offRoad: true });
    let save = await saveOf(saveId);
    expect(save.journey.camps).toEqual([save.wild]);
    let map = await mapOf(WORLD, saveId);
    expect(map.wild).toEqual(save.wild);
    expect(map.journey.camps).toEqual([save.wild]);
    const first = save.wild;
    // A reload sends the same.
    expect((await mapOf(WORLD, saveId)).journey.camps).toEqual([first]);
    // The map offers setting out from the camp, as the journey is planned from it.
    expect(map.wilds).not.toBeNull();

    await act(WORLD, saveId, { verb: 'travel', go: 'on' });
    save = await saveOf(saveId);
    expect(save.journey.camps).toEqual([first, save.wild]);
    map = await mapOf(WORLD, saveId);
    expect(map.journey.camps).toEqual([first, save.wild]);
    expect(map.journey.leg).toBe(2);

    // Arriving ends the journey, and the camps with it.
    await act(WORLD, saveId, { verb: 'travel', go: 'on' });
    map = await mapOf(WORLD, saveId);
    expect(map.journey).toBeNull();
    expect(map.wild).toBeNull();
    expect(map.here).toBe('pl_carrow');
  });

  test('stopping leaves the save in the wilds with no journey to draw', async () => {
    const saveId = sid('stop');
    await seed(WORLD, saveId);
    await act(WORLD, saveId, { verb: 'travel', to: 'pl_carrow', offRoad: true });
    const camp = (await saveOf(saveId)).wild;
    await act(WORLD, saveId, { verb: 'travel', go: 'stop' });
    const map = await mapOf(WORLD, saveId);
    expect(map.journey).toBeNull();
    expect(map.wild).toEqual(camp);
    // Still on the map that offers it: set out again from here.
    expect(map.wilds).not.toBeNull();
  });
});

test('a world with off-road travel off sends nothing of it', async () => {
  await seed('weald-off', 'off');
  const map = await mapOf('weald-off', 'off');
  expect(map.wilds).toBeNull();
  expect(map.journey).toBeNull();
  // A journey kept before it was turned off is not shown, nor offered.
  await saveRef('off-after').set({
    ...(await saveOf('off')),
    journey: {
      mapId: 'weald',
      to: { point: { x: 22, y: 10 }, placeId: 'pl_carrow', name: 'Carrow' },
      path: [
        { x: 8, y: 10 },
        { x: 22, y: 10 },
      ],
      times: [0, 14],
      routes: [],
      hours: 14,
      done: 0,
      leg: 1,
      by: 'wild',
      distance: 14,
      camps: [{ x: 8, y: 10 }],
    },
  });
  const after = await mapOf('weald-off', 'off-after');
  expect(after.journey).toBeNull();
  expect(after.wilds).toBeNull();
});
