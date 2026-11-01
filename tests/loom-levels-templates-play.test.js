'use strict';

/**
 * Templates in play (planning/map-levels.md §4.6; L-906 / #724), through
 * loomPlayTurn with Gemini stubbed: an ordinary moon opens from a template
 * and plays, on its own instance; a door opened there stays open for that
 * save and that moon only.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-levels-templates-play --verbose"
 */

const PROJECT = 'demo-loom-levels-tpl';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const mockWorld = require('./fixtures/andor-world').andorWithTemplates('andor-tpl-play');

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
const clock = require('../functions/loom-canon/clock');

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const db = getFirestore();

const WORLD = mockWorld.id;
const PLAYER = { uid: 'player-levels', token: { apps: ['loom'] } };
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

const SOL_GATE = [
  { mapId: 'sector', placeId: 'pl_sol' },
  { mapId: 'sol', placeId: 'pl_sol_gate' },
];

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

test('an ordinary moon opens from a template and plays', async () => {
  await seed('io', SOL_GATE, { time: clock.START, discovered: ['pl_sol_gate', 'pl_io'] });
  const { save } = await moveTo('io', 'pl_io');
  expect(save.mapId).toBe('tpl_moon__pl_io');
  expect(save.cell).toEqual({ x: 1, y: 3 });
  expect(save.at).toEqual([
    { mapId: 'sector', placeId: 'pl_sol' },
    { mapId: 'sol', placeId: 'pl_io' },
    { mapId: 'tpl_moon__pl_io', cell: { x: 1, y: 3 } },
  ]);
  const map = await mapOf('io');
  expect(map.battleMap).toMatchObject({ id: 'tpl_moon__pl_io', name: 'The surface of Io' });
  expect(map.trail.map((t) => t.name)).toEqual(['Andor sector', 'Sol', 'The surface of Io']);
  // A step on it, as on any grid.
  const step = await play('io', { verb: 'move', cell: { x: 2, y: 3 } });
  expect(step.save.cell).toEqual({ x: 2, y: 3 });
});

test('a door opened there stays open for that save and that moon only', async () => {
  await seed(
    'io-door',
    [
      ...SOL_GATE.slice(0, 1),
      { mapId: 'sol', placeId: 'pl_io' },
      { mapId: 'tpl_moon__pl_io', cell: { x: 1, y: 3 } },
    ],
    {
      location: 'pl_io',
      mapId: 'tpl_moon__pl_io',
      cell: { x: 1, y: 3 },
      time: clock.START,
    }
  );
  await loomPlayTurn.run({
    data: {
      worldId: WORLD,
      saveId: 'io-door',
      action: { verb: 'door', door: 'hatch', open: true },
    },
    auth: PLAYER,
  });
  const opened = await saveOf('io-door');
  expect(opened.doors).toEqual({ tpl_moon__pl_io: { hatch: 'open' } });
  // Europa, from the same template, has its own hatch: shut, for this save
  // and for another.
  await seed('europa', SOL_GATE, { time: clock.START, discovered: ['pl_sol_gate', 'pl_europa'] });
  const { save } = await moveTo('europa', 'pl_europa');
  expect(save.mapId).toBe('tpl_moon__pl_europa');
  expect(save.doors || {}).toEqual({});
  const view = await mapOf('europa');
  expect(view.battleMap.doors).toEqual([expect.objectContaining({ id: 'hatch', state: 'closed' })]);
  const io = await mapOf('io-door');
  expect(io.battleMap.doors).toEqual([expect.objectContaining({ id: 'hatch', state: 'open' })]);
});
