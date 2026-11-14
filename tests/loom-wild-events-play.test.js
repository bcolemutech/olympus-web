'use strict';

/**
 * Events on the way (planning/off-road-travel.md §4.5, EV1–EV3, EV7; L-364 /
 * #838), played through loomPlayTurn with Gemini stubbed, under both built-in
 * systems, on The Weald (./fixtures/wilds-world.js) with no navigation check:
 * a journey across the forest rolls after each day leg, the roll seeded by
 * the save, the leg and the hour it began, so a turn played again rolls the
 * same; at a camp in the forest the event is a row of the region's table, on
 * the grassland the world's; the roll, the chance and the event are recorded
 * on the turn, told with the leg and handed to the GM; one with figures is a
 * named creature to meet; a roll that misses brings nothing; and on a road the
 * chance is a fifth of it and the event is one for a road, not for the wilds.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-wild-events-play --verbose"
 */

const PROJECT = 'demo-loom-wild-events-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const { BUILT_IN: mockSystems } = require('../functions/loom-canon/systems');
const { wildsWorld: mockWildsWorld } = require('./fixtures/wilds-world');

const RAIN = 'A hard rain drums on the leaves, and the path turns to mud.';
const SHRINE = 'A wayside shrine stands by the track, its offerings fresh.';
const TOLL = 'A toll-keeper holds the road and waves you through for a coin.';

// The Weald with its region's danger 2 (so the forest's chance is the 95% cap),
// a region table for the forest, a world table for anywhere, and a chance:
// `hit` 95% at every camp, `quiet` none; `meet` has a row with figures.
function eventsWorld(id, systemId, kind) {
  const world = mockWildsWorld(id, { system: mockSystems[systemId] });
  world.rules = {
    ...world.rules,
    wilds: { navigation: null, eventChance: kind === 'quiet' ? 0 : 0.95 },
  };
  world.regions.reg_wood.danger = 2;
  world.statBlocks = { wolf: { name: 'Wolf' } };
  world.regions.reg_wood.encounters =
    kind === 'meet'
      ? [{ what: 'wolf', count: 2, kind: 'creatures' }]
      : [{ kind: 'weather', text: RAIN, terrain: ['forest'] }];
  world.encounters = [
    { kind: 'find', text: SHRINE, path: ['wild'] },
    { kind: 'travellers', text: TOLL, path: ['road'] },
  ];
  return world;
}
const mockWorlds = {};
for (const id of ['d20-fantasy', 'pool-scifi']) {
  for (const kind of ['hit', 'quiet', 'meet']) {
    const world = eventsWorld(`ev-${kind}-${id}`, id, kind);
    mockWorlds[world.id] = world;
  }
}

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
const { loomPlayTurn } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const clock = require('../functions/loom-canon/clock');
const events = require('../functions/loom-modules/wilds/events');

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const db = getFirestore();

const PLAYER = { uid: 'player-events', token: { apps: ['loom'] } };
const H = clock.HOUR;
const CAP = 0.95;
// The chance on a road: a fifth of the base.
const ROAD = 0.95 * 0.2;
const ASHBY = [{ mapId: 'weald', placeId: 'pl_ashby' }];
const saveRef = (saveId) => db.collection('loom_saves').doc(saveId);
const saveOf = async (saveId) => (await saveRef(saveId).get()).data();
const lastTurn = async (saveId) =>
  (
    await saveRef(saveId).collection('loom_turns').orderBy('index', 'desc').limit(1).get()
  ).docs[0].data();

// The seed of the roll after leg `leg` of a journey set out on at the start,
// camping each night: the save, the leg, and the hour it began.
const seedOf = (saveId, leg) => `${saveId}:${leg}:${clock.START + (leg - 1) * 24 * H}`;

// A save id whose rolls on each of the first `legs` legs hit (or all miss) at 95%.
function idWhere(prefix, hit, legs = 3, chance = CAP) {
  for (let n = 0; n < 500; n++) {
    const id = `${prefix}-${n}`;
    const rolls = Array.from({ length: legs }, (_, i) => events.rollOf(seedOf(id, i + 1), chance));
    if (rolls.every((r) => r.happened === hit)) return id;
  }
  throw new Error('no such save id');
}

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

describe.each(['d20-fantasy', 'pool-scifi'])('events on the way under %s', (systemId) => {
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
  async function play(worldId, saveId, data) {
    await loomPlayTurn.run({ data: { worldId, saveId, ...data }, auth: PLAYER });
    const turn = await lastTurn(saveId);
    return {
      resolution: turn.resolution,
      lines: turn.resolution.constraints.join(' '),
      save: await saveOf(saveId),
    };
  }
  const travelTo = (worldId, saveId, to) =>
    play(worldId, saveId, { action: { verb: 'travel', to, offRoad: true } });
  const goOn = (worldId, saveId) => play(worldId, saveId, { action: { verb: 'travel', go: 'on' } });
  const HIT = `ev-hit-${systemId}`;
  const QUIET = `ev-quiet-${systemId}`;
  const MEET = `ev-meet-${systemId}`;

  test('a camp in the forest brings its region’s event; the road’s end on the grass, the world’s', async () => {
    const id = idWhere(`${systemId}-hit`, true);
    await seed(HIT, id);
    let { resolution, lines } = await travelTo(HIT, id, 'pl_carrow');
    // Recorded on the turn: the roll, the chance, where, and what.
    const roll = events.rollOf(seedOf(id, 1), CAP);
    expect(resolution.event).toEqual({
      roll: roll.roll,
      chance: CAP,
      happened: true,
      danger: 2,
      material: 'forest',
      path: 'wild',
      event: { kind: 'weather', text: RAIN, source: 'region', narrated: true },
    });
    // Told with the leg, after the camp.
    expect(lines).toContain('You make camp for the night in the forest.');
    expect(lines.indexOf(RAIN)).toBeGreaterThan(lines.indexOf('You make camp'));

    // The GM is told it as given.
    const told = mockCallGemini.mock.calls
      .map(([o]) => o)
      .filter((o) => !/summarizer|INTERPRET stage/.test(o.systemInstruction))
      .pop();
    expect(told.userMessage).toContain('ON THE WAY: something happens');
    expect(told.userMessage).toContain(RAIN);

    // Leg 2, still in the forest: the same table, the roll seeded by its own leg and hour.
    ({ resolution, lines } = await goOn(HIT, id));
    expect(resolution.event.roll).toBe(events.rollOf(seedOf(id, 2), CAP).roll);
    expect(resolution.event.event).toMatchObject({ text: RAIN, source: 'region' });
    expect(lines).toContain(RAIN);

    // Leg 3 arrives at Carrow, on the grassland outside the region: its danger
    // is the ground's alone, so the chance is the base 95%, and the world's table.
    ({ resolution, lines } = await goOn(HIT, id));
    expect(lines).toContain('You arrive at Carrow.');
    expect(resolution.event).toMatchObject({
      chance: CAP,
      happened: true,
      danger: 1,
      material: 'grassland',
      event: { kind: 'find', text: SHRINE, source: 'world' },
    });
  });

  test('the same save and leg roll the same, however many times it is played', async () => {
    const id = idWhere(`${systemId}-again`, true, 1);
    await seed(HIT, id);
    const first = (await travelTo(HIT, id, 'pl_carrow')).resolution.event;
    await db.recursiveDelete(saveRef(id));
    await seed(HIT, id);
    const second = (await travelTo(HIT, id, 'pl_carrow')).resolution.event;
    expect(second).toEqual(first);
    // Another save rolls another.
    const other = idWhere(`${systemId}-other`, true, 1);
    await seed(HIT, other);
    expect((await travelTo(HIT, other, 'pl_carrow')).resolution.event.roll).not.toBe(first.roll);
  });

  test('a roll that misses brings nothing, and the miss is recorded', async () => {
    const id = idWhere(`${systemId}-miss`, false, 1);
    await seed(HIT, id);
    const { resolution, lines } = await travelTo(HIT, id, 'pl_carrow');
    expect(resolution.event).toMatchObject({ chance: CAP, happened: false, material: 'forest' });
    expect(resolution.event.roll).toBeGreaterThanOrEqual(CAP);
    expect(resolution.event.event).toBeUndefined();
    expect(lines).not.toContain(RAIN);
  });

  test('a world with no chance of one records the roll, and nothing happens', async () => {
    await seed(QUIET, `${systemId}-quiet`);
    const { resolution, lines } = await travelTo(QUIET, `${systemId}-quiet`, 'pl_carrow');
    expect(resolution.event).toMatchObject({ chance: 0, happened: false });
    expect(lines).not.toContain(RAIN);
    expect(lines).toContain('You make camp for the night in the forest.');
  });

  test('a row with figures is a creature to meet, named, and played on a map (tests/loom-wild-event-maps-play)', async () => {
    const id = idWhere(`${systemId}-meet`, true, 1);
    await seed(MEET, id);
    const { resolution, lines } = await travelTo(MEET, id, 'pl_carrow');
    expect(resolution.event.event).toEqual({
      kind: 'creatures',
      text: 'You are set upon by 2 Wolf.',
      source: 'region',
      what: 'wolf',
      count: 2,
      narrated: false,
      // Played on a map made for the forest (L-366).
      map: { id: expect.stringMatching(/^wild-/), name: 'A forest track', from: 'generated' },
    });
    expect(lines).toContain('You are set upon by 2 Wolf.');
  });

  test('on a road the chance is a fifth of it, and the event is one for a road', async () => {
    // Ashby to Dunsmouth by the road, set out across country: the planner takes it.
    const id = idWhere(`${systemId}-road`, true, 1, ROAD);
    await seed(HIT, id);
    const { resolution, lines } = await travelTo(HIT, id, 'pl_dunsmouth');
    expect(lines).toMatch(/You come to Dunsmouth, but its way is closed to you/);
    expect(resolution.event).toEqual({
      roll: events.rollOf(seedOf(id, 1), ROAD).roll,
      chance: ROAD,
      happened: true,
      danger: 1,
      material: 'grassland',
      path: 'road',
      event: { kind: 'travellers', text: TOLL, source: 'world', narrated: true },
    });
    // Told with the leg, and not the wilds' own.
    expect(lines).toContain(TOLL);
    expect(lines).not.toContain(SHRINE);
  });

  test('a roll on a road that misses brings nothing', async () => {
    const id = idWhere(`${systemId}-roadmiss`, false, 1, ROAD);
    await seed(HIT, id);
    const { resolution, lines } = await travelTo(HIT, id, 'pl_dunsmouth');
    expect(resolution.event).toMatchObject({ chance: ROAD, happened: false, path: 'road' });
    expect(resolution.event.event).toBeUndefined();
    expect(lines).not.toContain(TOLL);
  });
});
