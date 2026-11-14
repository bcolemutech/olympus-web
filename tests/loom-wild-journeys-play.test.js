'use strict';

/**
 * Journeys across country (planning/off-road-travel.md §4.4, TR1, TR5–TR8;
 * L-363 / #837), played through loomPlayTurn with Gemini stubbed, under both
 * built-in systems, on The Weald (./fixtures/wilds-world.js) with no
 * navigation check (the check's own turns are ./loom-wild-journeys.test.js):
 * a three-leg journey across the forest camps twice in the wilds and
 * arrives, its time the planner's and two nights, finding Fenwick on the
 * way, with loomGetMap sending the journey and the camp; Stop leaves the
 * save in the wilds and a new destination sets out from there, typed too;
 * the road to closed Dunsmouth ends outside it, entering is refused, and a
 * journey across country sets out from there; and a world with off-road
 * travel turned off refuses it.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-wild-journeys-play --verbose"
 */

const PROJECT = 'demo-loom-wild-journeys-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const { BUILT_IN: mockSystems } = require('../functions/loom-canon/systems');
const { wildsWorld: mockWildsWorld } = require('./fixtures/wilds-world');

// No navigation check, so every leg goes as planned; and one world with
// off-road travel turned off.
const mockWorlds = {};
for (const id of ['d20-fantasy', 'pool-scifi']) {
  const world = mockWildsWorld('weald-' + id, { system: mockSystems[id] });
  world.rules = { ...world.rules, wilds: { navigation: null } };
  mockWorlds[world.id] = world;
}
const closedWorld = mockWildsWorld('weald-closed', { system: mockSystems['d20-fantasy'] });
closedWorld.rules = { ...closedWorld.rules, wilds: false };
mockWorlds[closedWorld.id] = closedWorld;

jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  return {
    ...real,
    loadWorld: async (worldId, options) => mockWorlds[worldId] || real.loadWorld(worldId, options),
  };
});
let mockInterpreted = { verb: 'look', targets: [], params: {} };
const mockCallGemini = jest.fn(async (options) => {
  if (options.systemInstruction.includes('summarizer')) return 'A summary.';
  if (options.systemInstruction.includes('INTERPRET stage')) return mockInterpreted;
  return { narration: 'You go on.', inventedEntities: [], suggestedActions: [] };
});
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomPlayTurn, loomGetMap } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const clock = require('../functions/loom-canon/clock');
const frames = require('../functions/loom-canon/frames');
const travel = require('../functions/loom-canon/travel');
const wildPlan = require('../functions/loom-canon/wild-plan');
const wildJourneys = require('../functions/loom-turn/wild-journeys');

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const db = getFirestore();

const PLAYER = { uid: 'player-wilds', token: { apps: ['loom'] } };
const H = clock.HOUR;
const ASHBY = [{ mapId: 'weald', placeId: 'pl_ashby' }];
const saveRef = (saveId) => db.collection('loom_saves').doc(saveId);
const saveOf = async (saveId) => (await saveRef(saveId).get()).data();
const lastResolution = async (saveId) =>
  (
    await saveRef(saveId).collection('loom_turns').orderBy('index', 'desc').limit(1).get()
  ).docs[0].data().resolution;

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

describe.each(['d20-fantasy', 'pool-scifi'])('across country under %s', (systemId) => {
  const WORLD = 'weald-' + systemId;
  const sid = (name) => systemId + '-' + name;

  async function seed(saveId, fields = {}) {
    await saveRef(saveId).set(
      makeSave({
        ownerUid: PLAYER.uid,
        worldId: WORLD,
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
  async function play(saveId, data) {
    await loomPlayTurn.run({ data: { worldId: WORLD, saveId, ...data }, auth: PLAYER });
    const resolution = await lastResolution(saveId);
    return { resolution, lines: resolution.constraints.join(' '), save: await saveOf(saveId) };
  }
  const travelTo = (saveId, to) => play(saveId, { action: { verb: 'travel', to, offRoad: true } });
  const goOn = (saveId) => play(saveId, { action: { verb: 'travel', go: 'on' } });
  const stop = (saveId) => play(saveId, { action: { verb: 'travel', go: 'stop' } });
  const mapOf = (saveId) => loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });

  // The planner's hours from Ashby to Carrow, as the turn plans them.
  function plannedHours(from, to) {
    const view = frames.viewFor(frames.playWorld(mockWorlds[WORLD]), 'weald');
    const settings = wildJourneys.settingsFor(view);
    return wildPlan.planOn(view, from, to, { pace: settings.pace }).hours;
  }

  test('three legs across the forest: two camps in the wilds, then Carrow', async () => {
    await seed(sid('three'));
    let { lines, save, resolution } = await travelTo(sid('three'), 'pl_carrow');
    expect(lines).toMatch(/^You set out across country for Carrow: about 20 miles, some 3 days/);
    expect(lines).toContain('You make camp for the night in the forest.');
    // Camped in the wilds: a point on the Weald, a day's travel and a night on.
    expect(save.at).toHaveLength(1);
    expect(save.at[0]).toMatchObject({ mapId: 'weald', point: expect.any(Object) });
    expect(save.location).toBeNull();
    expect(save.wild).toEqual(save.at[0].point);
    expect(save.time).toBe(clock.START + 24 * H);
    expect(save.journey).toMatchObject({ mapId: 'weald', leg: 1, by: 'wild', done: 8 });
    expect(resolution.journey).toMatchObject({ offRoad: true, leg: 1, camp: true });
    expect(resolution.time.seconds).toBe(24 * H);

    // The map: where the save camps, and the way ahead.
    const map = await mapOf(sid('three'));
    expect(map.here).toBeNull();
    expect(map.wild).toEqual(save.wild);
    expect(map.journey).toMatchObject({
      mapId: 'weald',
      to: { placeId: 'pl_carrow', name: 'Carrow' },
      leg: 1,
    });
    expect(map.journey.path[0].x).toBeCloseTo(save.wild.x, 6);
    expect(map.journey.path[map.journey.path.length - 1]).toEqual({ x: 22, y: 10 });

    ({ lines, save } = await goOn(sid('three')));
    expect(lines).toContain('You make camp for the night in the forest.');
    expect(lines).toContain('On the way you find Fenwick.');
    expect(save.discovered).toContain('pl_fenwick');
    // Gorse, eight miles off the way, isn't found.
    expect(save.discovered).not.toContain('pl_gorse');
    expect(save.journey).toMatchObject({ leg: 2, done: 16 });

    ({ lines, save } = await goOn(sid('three')));
    expect(lines).toContain('You arrive at Carrow.');
    expect(save.at).toEqual([{ mapId: 'weald', placeId: 'pl_carrow' }]);
    expect(save.location).toBe('pl_carrow');
    expect(save.wild).toBeNull();
    expect(save.journey).toBeNull();
    // The time the planner gives, and two nights camped.
    const hours = plannedHours([2, 10], [22, 10]);
    expect(hours).toBeGreaterThan(16);
    expect(hours).toBeLessThan(24);
    expect(Math.abs(save.time - (clock.START + (hours + 32) * H))).toBeLessThanOrEqual(2);
    // Nothing left to go on with.
    ({ lines } = await goOn(sid('three')));
    expect(lines).toBe("You aren't on a journey. Choose where to head.");
  });

  test('Stop leaves the save in the wilds; a new destination sets out from there', async () => {
    await seed(sid('stop'));
    await travelTo(sid('stop'), 'pl_carrow');
    const camp = (await saveOf(sid('stop'))).wild;
    let { lines, save } = await stop(sid('stop'));
    expect(lines).toBe('You stop where you are, in the wilds, and put off the journey.');
    expect(save.journey).toBeNull();
    expect(save.wild).toEqual(camp);
    expect(save.time).toBe(clock.START + 24 * H);

    // Back toward Ashby, from the camp: a point on the map, by the turn's action.
    ({ lines, save } = await travelTo(sid('stop'), { mapId: 'weald', point: { x: 3, y: 10 } }));
    expect(lines).toMatch(/^You set out across country: about \d+(\.\d)? miles, a day/);
    expect(lines).toContain('You reach the place you were heading for');
    expect(save.wild).toEqual({ x: 3, y: 10 });
    expect(save.location).toBeNull();
    const hours = plannedHours([camp.x, camp.y], [3, 10]);
    expect(Math.abs(save.time - (clock.START + (24 + hours) * H))).toBeLessThanOrEqual(1);

    // Typed: a move to a place, read in the wilds as setting out for it.
    mockInterpreted = { verb: 'move', targets: ['pl_ashby'], params: {} };
    ({ lines, save } = await play(sid('stop'), { actionText: 'walk back to Ashby' }));
    mockInterpreted = { verb: 'look', targets: [], params: {} };
    expect(lines).toContain('You arrive at Ashby.');
    expect(save.location).toBe('pl_ashby');
  });

  test('the road to a closed town ends outside it; from there, across country', async () => {
    await seed(sid('closed'));
    let { lines, save } = await play(sid('closed'), {
      action: { verb: 'move', target: 'pl_dunsmouth' },
    });
    expect(lines).toMatch(/you come to Dunsmouth, but its way is closed to you/);
    expect(save.location).toBeNull();
    expect(save.wild.x).toBeCloseTo(2, 6);
    expect(save.wild.y).toBeLessThan(20);
    expect(save.wild.y).toBeGreaterThan(19);
    // The road's time, as any trip by road takes it.
    const view = frames.viewFor(frames.playWorld(mockWorlds[WORLD]), 'weald');
    expect(save.time).toBe(travel.trip(view, 'pl_ashby', 'pl_dunsmouth', clock.START).to);
    const outside = save.wild;

    // Entering is refused, and nothing passes.
    ({ lines, save } = await play(sid('closed'), {
      action: { verb: 'move', target: 'pl_dunsmouth' },
    }));
    expect(lines).toBe('Dunsmouth is closed to you: you can go no further in.');
    expect(save.wild).toEqual(outside);

    // Across country from outside its gates, to Carrow.
    ({ lines, save } = await travelTo(sid('closed'), 'pl_carrow'));
    expect(lines).toMatch(/^You set out across country for Carrow/);
    expect(save.journey).toMatchObject({ to: { placeId: 'pl_carrow' }, leg: 1 });
  });
});

test('a world with off-road travel turned off refuses it, with its reason', async () => {
  await saveRef('off').set(
    makeSave({
      ownerUid: PLAYER.uid,
      worldId: 'weald-closed',
      name: 'Weald',
      character: { name: 'Ash' },
      at: ASHBY,
      discovered: ['pl_ashby', 'pl_carrow'],
      visited: ['pl_ashby'],
      waysKnown: {},
      time: clock.START,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  );
  await loomPlayTurn.run({
    data: {
      worldId: 'weald-closed',
      saveId: 'off',
      action: { verb: 'travel', to: 'pl_carrow', offRoad: true },
    },
    auth: PLAYER,
  });
  const turns = await saveRef('off').collection('loom_turns').get();
  expect(turns.docs[0].data().resolution).toEqual({
    outcome: 'blocked',
    mutations: [],
    constraints: [wildJourneys.OFF],
  });
  const save = await saveOf('off');
  expect(save.at).toEqual(ASHBY);
  expect(save.time).toBe(clock.START);
});
