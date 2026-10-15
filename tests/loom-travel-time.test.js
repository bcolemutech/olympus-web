'use strict';

/**
 * Travel takes time (planning/the-loom-game-time.md §3 T8–T11, T14, R3,
 * §4.2; L-373 / #501): world trips by route and speed, nights on the road,
 * ships through the night, walks across a town without ground by distance,
 * no time for a refused move, and loomGetMap's estimate equal to what the
 * trip then takes. Played through loomPlayTurn with Gemini stubbed, on a
 * small world built from Nisia's Hatham and Daldockley (positions 153,
 * 615.13 and 156.55, 611.7 at 2 mi a map unit).
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
const mockCallGemini = jest.fn(async (options) => {
  if (options.systemInstruction.includes('summarizer')) return 'A summary.';
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

const mapOf = (saveId) =>
  loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });

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
    // Leaving by the trail from the harbour: the wrong way out.
    await saveRef('save-refused').update({ placeId: 'plc_harbour' });
    const wrongWay = await moveTo('save-refused', 'daldockley');
    expect(wrongWay.outcome).toBe('blocked');
    for (const r of [notLinked, wrongWay]) {
      expect(r.mutations.some((m) => m.path === 'time')).toBe(false);
      expect(r.time).toBeUndefined();
    }
    expect((await saveOf('save-refused')).time).toBe(at(1, 9));
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
    expect(exits.skerry).toMatchObject({ label: 'about 10 hours by sea', arrives: 'Day 1, evening' });
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
