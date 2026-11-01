'use strict';

/**
 * Rules at any depth (planning/map-levels.md §4.3, §5; L-903 / #721),
 * played through loomPlayTurn with Gemini stubbed, on a world three maps
 * deep (./fixtures/andor-world.js): down into a place's map at its way in,
 * and on down to a square on the station's deck, then back up; a trip
 * between parents; an exit to another map with its time; a closed place
 * refused at depth; a place with no map stood at; and loomGetMap's trail.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-levels-play --verbose"
 */

const PROJECT = 'demo-loom-levels-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const mockWorld = require('./fixtures/andor-world').andorWorld('andor-play');

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
const { loomPlayTurn, loomGetMap, loomCreateSave } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const clock = require('../functions/loom-canon/clock');
const levels = require('../functions/loom-canon/levels');

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const db = getFirestore();

const WORLD = mockWorld.id;
const PLAYER = { uid: 'player-levels', token: { apps: ['loom'] } };
const H = clock.HOUR;
const saveRef = (saveId) => db.collection('loom_saves').doc(saveId);
const saveOf = async (saveId) => (await saveRef(saveId).get()).data();
const lastResolution = async (saveId) =>
  (
    await saveRef(saveId).collection('loom_turns').orderBy('index', 'desc').limit(1).get()
  ).docs[0].data().resolution;

async function seed(saveId, at, fields = {}) {
  const save = makeSave({
    ownerUid: PLAYER.uid,
    worldId: WORLD,
    name: 'Andor',
    character: { name: 'Ash' },
    at,
    discovered: ['pl_rigel', 'pl_vega'],
    visited: [],
    waysKnown: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields,
  });
  await saveRef(saveId).set(save);
}

// The turn's rules lines (narrated turns answer with the model's words).
async function play(saveId, action) {
  await loomPlayTurn.run({ data: { worldId: WORLD, saveId, action }, auth: PLAYER });
  const lines = (await lastResolution(saveId)).constraints.join(' ');
  return { lines, save: await saveOf(saveId) };
}
const moveTo = (saveId, target) => play(saveId, { verb: 'move', target });
const mapOf = (saveId) => loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });

const RIGEL = [{ mapId: 'sector', placeId: 'pl_rigel' }];
const GATE = [
  { mapId: 'sector', placeId: 'pl_vega' },
  { mapId: 'vega', placeId: 'pl_vega_gate' },
];

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

test('a new game starts at a place in the new shape, stood at with no map (MP6)', async () => {
  const { saveId } = await loomCreateSave.run({
    data: { worldId: WORLD, name: 'Andor', characterName: 'Ash' },
    auth: PLAYER,
  });
  const save = await saveOf(saveId);
  expect(save.at).toEqual(RIGEL);
  expect(save.location).toBe('pl_rigel');
  expect(save.discovered.sort()).toEqual(['pl_rigel', 'pl_vega']);
});

test('down into a place’s map, to a square three maps deep, and back up', async () => {
  await seed('deep', RIGEL, { time: clock.START });
  // Rigel to Vega: 30 ly by jump, then in by Vega's way in.
  let { lines, save } = await moveTo('deep', 'pl_vega');
  expect(save.at).toEqual(GATE);
  expect(save.location).toBe('pl_vega_gate');
  expect(save.time).toBe(clock.START + 15 * H);
  expect(lines).toContain('You come into Vega by Vega Gate.');
  // Its way in and what it leads to are found.
  expect(save.discovered).toEqual(expect.arrayContaining(['pl_station', 'pl_outpost']));

  // Across Vega (45 AU, 9 hours) to the station: in by its airlock.
  ({ save } = await moveTo('deep', 'pl_station'));
  expect(save.at).toEqual([
    ...GATE.slice(0, 1),
    { mapId: 'vega', placeId: 'pl_station' },
    { mapId: 'station', placeId: 'pl_airlock' },
  ]);
  expect(save.time).toBe(clock.START + 24 * H);

  // To the dock, onto the deck at its way in.
  ({ save } = await moveTo('deep', 'pl_dock'));
  const onDeck = [
    ...GATE.slice(0, 1),
    { mapId: 'vega', placeId: 'pl_station' },
    { mapId: 'station', placeId: 'pl_dock' },
    { mapId: 'deck', cell: { x: 1, y: 4 } },
  ];
  expect(save.at).toEqual(onDeck);
  expect(levels.validateAt(mockWorld, save.at)).toEqual([]);
  expect(save).toMatchObject({ location: 'pl_station', placeId: 'pl_dock', mapId: 'deck' });

  // The trail: each map above, the deck last (UI1).
  const map = await mapOf('deep');
  expect(map.mapId).toBe('vega');
  expect(map.trail.map((t) => [t.mapId, t.name, t.kind])).toEqual([
    ['sector', 'Andor sector', 'region'],
    ['vega', 'Vega', 'region'],
    ['station', 'Vega Station', 'area'],
    ['deck', 'The deck', 'grid'],
  ]);
  expect(map.battleMap).toBeTruthy();
  // The map it stands on is Vega's: its places, not the sector's.
  expect(map.places.map((p) => p.id).sort()).toEqual(['pl_outpost', 'pl_station', 'pl_vega_gate']);

  // Back up: off the deck by the airlock door, out of the station, out of Vega.
  ({ save } = await play('deep', { verb: 'move', cell: { x: 0, y: 4 } }));
  expect(save.mapId).toBeNull();
  expect(save.at).toEqual(onDeck.slice(0, 3));
  ({ save } = await moveTo('deep', 'pl_vega_gate'));
  expect(save.at).toEqual(GATE);
  ({ lines, save } = await moveTo('deep', 'pl_rigel'));
  expect(save.at).toEqual(RIGEL);
  expect(save.location).toBe('pl_rigel');
  expect(lines).toContain('You leave Vega by Vega Gate.');
});

test('a trip between parents: out of Vega, across the sector, into Sol', async () => {
  await seed('between', GATE, {
    time: clock.START,
    discovered: ['pl_vega', 'pl_sol', 'pl_rigel', 'pl_vega_gate', 'pl_sol_port'],
  });
  const { save } = await moveTo('between', 'pl_sol_port');
  // 20 ly at 2 an hour, then 45 AU at 5 an hour.
  expect(save.time).toBe(clock.START + 19 * H);
  expect(save.at).toEqual([
    { mapId: 'sector', placeId: 'pl_sol' },
    { mapId: 'sol', placeId: 'pl_sol_port' },
  ]);
  expect(save.location).toBe('pl_sol_port');
  const r = await lastResolution('between');
  expect(r.constraints).toEqual([
    'You leave Vega by Vega Gate.',
    'You come into Sol by Sol Gate.',
    'After about 19 hours in all, across Andor sector and Sol, you arrive at Sol Port.',
  ]);
  expect((await mapOf('between')).trail.map((t) => t.name)).toEqual(['Andor sector', 'Sol']);
});

test('an exit to another map takes its own time (TV3)', async () => {
  await seed(
    'exit',
    [
      { mapId: 'sector', placeId: 'pl_sol' },
      { mapId: 'sol', placeId: 'pl_sol_port' },
    ],
    { time: clock.START }
  );
  const { lines, save } = await moveTo('exit', 'pl_rigel');
  expect(save.at).toEqual(RIGEL);
  expect(save.time).toBe(clock.START + H);
  expect(lines).toContain('You go by the old jump gate to Rigel.');
});

test('a closed place is refused at depth, and the save stays put', async () => {
  await seed('closed', GATE, { time: clock.START });
  const { lines, save } = await moveTo('closed', 'pl_outpost');
  expect(lines).toContain('The way to The Outpost is closed. Turn back.');
  expect(save.at).toEqual(GATE);
  expect(save.time).toBe(clock.START);
});
