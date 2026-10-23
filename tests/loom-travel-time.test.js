'use strict';

/**
 * Travel takes time (planning/the-loom-game-time.md §3 T8–T11, T14, R3,
 * §4.2; L-373 / #501): world trips by route and speed, nights on the road,
 * ships through the night, walks across a town without ground by distance,
 * no time for a refused move, and loomGetMap's estimate equal to what the
 * trip then takes; and the GM knows the time (§3 T14, §4.4; L-375 / #503):
 * INTERPRET and NARRATE get a TIME line. Played through loomPlayTurn with
 * Gemini stubbed, on a small world built from Nisia's Hatham and Daldockley
 * (positions 153, 615.13 and 156.55, 611.7 at 2 mi a map unit).
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-travel-time --verbose"
 */

const PROJECT = 'demo-loom-travel-time';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const WORLD = 'travel-coast';

// The world: Hatham (a town with a gate, a market and a harbour, 600 m
// across, no ground), Daldockley about 12 mi by trail, Midhurstle 20 mi on
// by trail, and Skerry Isle 50 mi from Hatham by sea. A world object with no
// status isn't graded, so every place is open.
const mockWorld = (() => {
  const place = (id, name, x, y, links, extra = {}) => ({
    id,
    name,
    description: name + '.',
    geo: { kind: 'settlement', population: 2000, x, y, links },
    connections: Object.keys(links),
    factionIds: [],
    npcIds: [],
    rules: {},
    ...extra,
  });
  const inTown = (id, name, x, y, connections, via) => ({
    id,
    locationId: 'hatham',
    name,
    kind: via ? 'gate' : 'market',
    description: name + '.',
    position: { x, y },
    connections,
    entrance: via ? { via } : null,
    npcIds: [],
    rules: {},
  });
  return {
    id: 'travel-coast',
    name: 'The Travel Coast',
    tagline: '',
    openingHook: '',
    map: { width: 1718, height: 1270, distance: { unit: 'mi', perMapUnit: 2 } },
    rules: { startingLocationId: 'hatham' },
    locations: {
      hatham: place(
        'hatham',
        'Hatham',
        153,
        615.13,
        { daldockley: 'trail', skerry: 'sea' },
        { town: { size: 600 } }
      ),
      daldockley: place('daldockley', 'Daldockley', 156.55, 611.7, {
        hatham: 'trail',
        midhurstle: 'trail',
      }),
      // 8 map units on: 8 × 2 mi × 1.25 = 20 mi.
      midhurstle: place('midhurstle', 'Midhurstle', 164.55, 611.7, { daldockley: 'trail' }),
      // 20 map units out to sea: 50 mi.
      skerry: place('skerry', 'Skerry Isle', 153, 635.13, { hatham: 'sea' }),
      // Not linked to Hatham.
      faraway: place('faraway', 'Faraway', 900, 900, {}),
    },
    places: {
      plc_gate: inTown('plc_gate', 'The Trailhead', 500, 900, ['plc_market'], ['trail', 'road']),
      plc_market: inTown('plc_market', 'Market Square', 500, 500, ['plc_gate', 'plc_harbour']),
      plc_harbour: inTown('plc_harbour', 'The Harbour', 900, 500, ['plc_market'], ['sea']),
    },
    factions: {},
    characters: {},
    lore: {},
  };
})();

jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  return {
    ...real,
    loadWorld: async (worldId, options) =>
      worldId === mockWorld.id ? mockWorld : real.loadWorld(worldId, options),
  };
});
// What a typed action is read as (INTERPRET), and every prompt (L-375).
const mockIntent = { verb: 'look', targets: [], params: {} };
const prompts = { interpret: [], narrate: [] };
const mockCallGemini = jest.fn(async (options) => {
  if (options.systemInstruction.includes('summarizer')) return 'A summary.';
  if (options.systemInstruction.includes('INTERPRET stage')) {
    prompts.interpret.push(options.systemInstruction);
    return mockIntent;
  }
  prompts.narrate.push(options);
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

const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };
const at = (day, hour, minute = 0) => (day - 1) * clock.DAY + hour * clock.HOUR + minute * 60;

const saveRef = (saveId) => db.collection('loom_saves').doc(saveId);
const saveOf = async (saveId) => (await saveRef(saveId).get()).data();
const lastResolution = async (saveId) =>
  (
    await saveRef(saveId).collection('loom_turns').orderBy('index', 'desc').limit(1).get()
  ).docs[0].data().resolution;

async function seed(saveId, fields) {
  const save = makeSave({
    ownerUid: PLAYER.uid,
    worldId: WORLD,
    name: 'Voyage',
    character: { name: 'Tam' },
    location: 'hatham',
    discovered: ['hatham', 'daldockley', 'midhurstle', 'skerry'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields,
  });
  await saveRef(saveId).set(save);
  return save;
}

// A move made on the map: the action, fresh each time (L-614).
async function moveTo(saveId, target) {
  await saveRef(saveId).update({ 'turn.actionUsed': false });
  await loomPlayTurn.run({
    data: { worldId: WORLD, saveId, action: { verb: 'move', target } },
    auth: PLAYER,
  });
  return lastResolution(saveId);
}

const mapOf = (saveId) => loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

describe('world travel by route and speed', () => {
  test('Hatham to Daldockley by trail: about 6 hours, morning to afternoon', async () => {
    await seed('save-trail', { placeId: 'plc_gate', time: at(1, 8) });
    const resolution = await moveTo('save-trail', 'daldockley');
    const save = await saveOf('save-trail');
    expect(save.location).toBe('daldockley');
    const hours = (save.time - at(1, 8)) / clock.HOUR;
    expect(hours).toBeGreaterThan(6);
    expect(hours).toBeLessThan(6.25); // about 12.3 mi at 2 mph
    expect(clock.label(save.time)).toBe('Day 1, afternoon');
    expect(resolution.constraints).toEqual([
      'After about 6 hours on the trail, you arrive at Daldockley.',
    ]);
    // For the GM (L-375): how long, and nothing crossed.
    expect(resolution.time).toEqual({
      from: at(1, 8),
      to: save.time,
      seconds: save.time - at(1, 8),
      crossed: [],
    });
  });

  test('20 miles by trail set out in the evening: a night camped, and Day 2', async () => {
    await seed('save-night', { location: 'daldockley', time: at(1, 18) });
    const resolution = await moveTo('save-night', 'midhurstle');
    const save = await saveOf('save-night');
    // 10 hours on the trail is two travel days: 10 h + a night of 16 h.
    expect(save.time - at(1, 18)).toBe(26 * clock.HOUR);
    expect(clock.partOf(save.time).day).toBe(2);
    expect(resolution.constraints).toEqual([
      'Night falls on the trail.',
      'You make camp for the night on the trail.',
      'After about a day on the trail, you arrive at Midhurstle.',
    ]);
    expect(resolution.time.crossed.map((c) => c.event + ' ' + c.day)).toEqual([
      'dusk 1',
      'dawn 2',
      'dusk 2',
    ]);
  });

  test('a sea route sails through the night with no stop', async () => {
    await seed('save-sea', { placeId: 'plc_harbour', time: at(1, 14) });
    const resolution = await moveTo('save-sea', 'skerry');
    const save = await saveOf('save-sea');
    // 50 mi at 5 mph: 10 hours, and no night camped at sea.
    expect(save.time - at(1, 14)).toBe(10 * clock.HOUR);
    expect(clock.label(save.time)).toBe('Day 2, night');
    expect(resolution.constraints).toEqual([
      'Night falls at sea.',
      'After about 10 hours at sea, you arrive at Skerry Isle.',
    ]);
  });

  test('a refused move adds no time', async () => {
    await seed('save-refused', { placeId: 'plc_gate', time: at(1, 9) });
    const notLinked = await moveTo('save-refused', 'faraway');
    expect(notLinked.outcome).toBe('blocked');
    expect(notLinked.mutations.some((m) => m.path === 'time')).toBe(false);
    expect(notLinked.time).toBeUndefined();
    expect((await saveOf('save-refused')).time).toBe(at(1, 9));
  });

  test('leaving from the wrong way out walks to the right one first, its minutes first (#669)', async () => {
    // From the harbour by the trail: through the market to the Trailhead
    // (800 units, 6 minutes), then the trip as from the Trailhead then.
    await seed('save-wrong-way', { placeId: 'plc_harbour', time: at(1, 8) });
    const resolution = await moveTo('save-wrong-way', 'daldockley');
    expect(resolution.outcome).toBe('success');
    expect(resolution.constraints[0]).toBe(
      'You make your way from The Harbour past Market Square to The Trailhead.'
    );
    await seed('save-right-way', { placeId: 'plc_gate', time: at(1, 8, 6) });
    await moveTo('save-right-way', 'daldockley');
    const wrong = await saveOf('save-wrong-way');
    expect(wrong.location).toBe('daldockley');
    expect(wrong.time).toBe((await saveOf('save-right-way')).time);
    expect(resolution.time).toMatchObject({ from: at(1, 8), to: wrong.time });
  });
});

describe('a walk across a town without ground', () => {
  test('takes minutes by distance: 400 of 1000 across 600 m is 240 m, 3 minutes', async () => {
    await seed('save-walk', { placeId: 'plc_gate', time: at(1, 8) });
    const toMarket = await moveTo('save-walk', 'plc_market');
    expect(toMarket.outcome).toBe('success');
    expect((await saveOf('save-walk')).time).toBe(at(1, 8, 3));
    expect(toMarket.time).toMatchObject({ seconds: 180, crossed: [] });
    // Through the market to the harbour: 400 + 400 units, 6 minutes.
    await saveRef('save-walk').update({ placeId: 'plc_gate' });
    await moveTo('save-walk', 'plc_harbour');
    expect((await saveOf('save-walk')).time).toBe(at(1, 8, 9));
  });
});

describe("loomGetMap's estimates", () => {
  test('each route out of here says how long it takes, and that is what it takes', async () => {
    await seed('save-estimate', { placeId: 'plc_gate', time: at(1, 8) });
    const map = await mapOf('save-estimate');
    const exits = Object.fromEntries(map.town.exits.map((e) => [e.id, e.travel]));
    expect(exits.daldockley).toMatchObject({
      label: 'about 6 hours by trail',
      arrives: 'Day 1, afternoon',
    });
    expect(exits.daldockley.miles).toBeCloseTo(12.34, 2);
    expect(exits.skerry).toMatchObject({
      label: 'about 10 hours by sea',
      arrives: 'Day 1, evening',
    });
    // The world map's links out of here carry the same.
    const link = map.links.find((l) => [l.from, l.to].sort().join() === 'daldockley,hatham');
    expect(link.travel).toEqual(exits.daldockley);

    await moveTo('save-estimate', 'daldockley');
    expect((await saveOf('save-estimate')).time - at(1, 8)).toBe(exits.daldockley.seconds);
  });

  test('arrives says the part of the day on arrival only when it differs', async () => {
    // From Daldockley at midday, Hatham is 6 hours: into the evening.
    await seed('save-noon', { location: 'daldockley', time: at(1, 12) });
    const links = (await mapOf('save-noon')).links.filter((l) => l.travel);
    const toHatham = links.find((l) => [l.from, l.to].includes('hatham')).travel;
    expect(toHatham.arrives).toBe('Day 1, evening');
    // Half an hour on the trail at 01:00 stays in the night: nothing to say.
    const clockOnly = require('../functions/loom-canon/travel').trip(
      {
        map: { distance: { unit: 'mi', perMapUnit: 1 } },
        locations: {
          a: { id: 'a', geo: { x: 0, y: 0, links: { b: 'trail' } }, connections: ['b'] },
          b: { id: 'b', geo: { x: 0.8, y: 0, links: { a: 'trail' } }, connections: ['a'] },
        },
      },
      'a',
      'b',
      at(1, 1)
    );
    expect(clockOnly).toMatchObject({ seconds: 1800, arrives: null, nights: 0 });
  });
});

describe('the GM knows the time (L-375)', () => {
  // A typed action: INTERPRET reads it, then NARRATE tells it.
  async function typed(saveId, actionText, intent) {
    Object.assign(mockIntent, intent);
    prompts.interpret.length = 0;
    prompts.narrate.length = 0;
    await saveRef(saveId).update({ 'turn.actionUsed': false });
    await loomPlayTurn.run({ data: { worldId: WORLD, saveId, actionText }, auth: PLAYER });
  }
  const timeIn = (message) => (message.match(/TIME \(final\):\n(.*)/) || [])[1];

  test('both prompts carry the TIME line', async () => {
    await seed('save-gm-look', { placeId: 'plc_market', time: at(1, 18, 30) });
    await typed('save-gm-look', 'look around', { verb: 'look', targets: [], params: {} });
    expect(prompts.interpret).toHaveLength(1);
    expect(prompts.interpret[0]).toContain('TIME: Day 1, evening.');
    expect(prompts.narrate).toHaveLength(1);
    // Looking takes no time of its own (T5): it says so, inventing none.
    expect(timeIn(prompts.narrate[0].userMessage)).toBe('Day 1, evening. No time passed.');
    // The narrator is told how to use it.
    expect(prompts.narrate[0].systemInstruction).toMatch(/TIME line/);
    expect(prompts.narrate[0].systemInstruction).toMatch(/Never state a different time of day/);
  });

  test('a trip that crosses dusk puts "dusk fell" in NARRATE\'s prompt', async () => {
    await seed('save-gm-dusk', { location: 'daldockley', time: at(1, 16) });
    await typed('save-gm-dusk', 'walk to Hatham', {
      verb: 'move',
      targets: ['hatham'],
      params: {},
    });
    expect(prompts.interpret[0]).toContain('TIME: Day 1, afternoon.');
    const line = timeIn(prompts.narrate[0].userMessage);
    // About 6 hours from 16:00: night by 22:00, dusk at 20:00 on the way.
    expect(line).toBe('Day 1, night. About 6 hours passed; dusk fell on the way.');
    expect(prompts.narrate[0].userMessage).toContain('- Night falls on the trail.');
  });

  test('a trip of days says how many dusks and dawns, and which came last', async () => {
    await seed('save-gm-days', { placeId: 'plc_gate', time: at(1, 8) });
    await saveRef('save-gm-days').update({ location: 'daldockley', placeId: null });
    await typed('save-gm-days', 'on to Midhurstle', {
      verb: 'move',
      targets: ['midhurstle'],
      params: {},
    });
    // 10 hours on the trail with a night camped: 26 hours, to Day 2 at 10:00.
    expect(timeIn(prompts.narrate[0].userMessage)).toBe(
      'Day 2, morning. About a day passed; dusk fell and dawn broke on the way.'
    );
  });

  test('a walk across town: its minutes', async () => {
    await seed('save-gm-walk', { placeId: 'plc_gate', time: at(1, 8) });
    await typed('save-gm-walk', 'go to the market', {
      verb: 'move',
      targets: ['plc_market'],
      params: {},
    });
    expect(timeIn(prompts.narrate[0].userMessage)).toBe('Day 1, morning. About 3 minutes passed.');
  });

  test('a refused move: no time passed', async () => {
    await seed('save-gm-refused', { placeId: 'plc_gate', time: at(1, 21) });
    await typed('save-gm-refused', 'go to Faraway', {
      verb: 'move',
      targets: ['faraway'],
      params: {},
    });
    expect(timeIn(prompts.narrate[0].userMessage)).toBe('Day 1, night. No time passed.');
  });
});

describe('the time in every answer (L-376)', () => {
  const play = (saveId, data) =>
    loomPlayTurn.run({ data: { worldId: WORLD, saveId, ...data }, auth: PLAYER });

  test('loomGetMap, a move, a refusal and End turn each carry it', async () => {
    await seed('save-answers', { placeId: 'plc_gate', time: at(1, 8) });
    expect((await mapOf('save-answers')).time).toEqual({
      seconds: at(1, 8),
      label: 'Day 1, morning',
    });
    await saveRef('save-answers').update({ 'turn.actionUsed': false });
    const moved = await play('save-answers', { action: { verb: 'move', target: 'daldockley' } });
    const after = (await saveOf('save-answers')).time;
    expect(moved.time).toEqual({ seconds: after, label: 'Day 1, afternoon' });
    // A refusal that changes nothing: the time as it stands.
    const refused = await play('save-answers', {
      action: { verb: 'walk-there', target: 'plc_market' },
    });
    expect(refused).toMatchObject({
      narration: 'There are no streets to walk here.',
      time: { seconds: after, label: 'Day 1, afternoon' },
    });
    const ended = await play('save-answers', { action: { verb: 'end-turn' } });
    expect(ended.time).toEqual({ seconds: after + 300, label: 'Day 1, afternoon' });
    // Each route out of here says whether night falls or day breaks on the way.
    const links = (await mapOf('save-answers')).links.filter((l) => l.travel);
    expect(links.every((l) => typeof l.travel.crossesDuskOrDawn === 'boolean')).toBe(true);
  });
});
