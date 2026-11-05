'use strict';

/**
 * Today's battle maps converted (planning/maps-from-data.md §4.7, EX4;
 * L-928 / #732): the Convert Map Layers workflow's run against the
 * Firestore emulator, and a fight through loomPlayTurn (Gemini stubbed) on
 * the map it converted:
 *
 *   - a dry run reports the maps it would write and the replay, and writes
 *     nothing;
 *   - applied, each battle map with layers stores them as its geometry, its
 *     own geometry kept, and its layers are deleted, its features, hazards
 *     and figures as they were; a grid map's copies of its battle map's
 *     layers are deleted; one without layers is left alone; the world's
 *     canonVersion moves on once;
 *   - running it twice changes nothing;
 *   - a scripted fight on the hall as it played before (its layers read as
 *     geometry beside what was stored) and on its geometry alone after plays
 *     the same, line for line.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-convert-layers --verbose"
 */

const PROJECT = 'demo-loom-convert-layers';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const geo = require('../functions/loom-canon/map-geometry');
const layerGeometry = require('../functions/loom-canon/layer-geometry');
const convert = require('../functions/cartographer/convert-layers');

const FANTASY = BUILT_IN['d20-fantasy'];

// The hall as the fight is played on it: set from what's stored.
const mockState = { hall: null };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      const sheetsReal = jest.requireActual('../functions/loom-canon/sheets');
      const system = jest.requireActual('../functions/loom-canon/systems').BUILT_IN['d20-fantasy'];
      return {
        ...COAST,
        system,
        locations: {
          ...COAST.locations,
          'widows-reach': { ...COAST.locations['widows-reach'], battleMap: { mapId: 'bm_hall' } },
        },
        characters: {
          ...COAST.characters,
          grell: {
            id: 'grell',
            name: 'Grell',
            description: 'A bandit.',
            locationId: 'widows-reach',
            cell: { x: 9, y: 3 },
            side: 'hostile',
            sheet: (() => {
              const s = sheetsReal.defaultSheet(system);
              s.resources.health = { current: 30 };
              s.attacks = [{ id: 'club', name: 'Club', reach: 1, attack: '1d20 + 10', damage: '1' }];
              return s;
            })(),
          },
        },
        battleMaps: { bm_hall: mockState.hall },
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
const { loomPlayTurn } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const db = getFirestore();
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };
const WORLD = 'convert-test';
const world = () => db.collection('loom_worlds').doc(WORLD);
const mapDoc = async (id) => (await world().collection('battleMaps').doc(id).get()).data();

const sq = (x, y) => ({ x, y });

// The hall 12 × 7, in at the west, out at the east: a wall down x = 6 with
// a door in it at y 3–4, a table, a pillar and rubble by the door; a lever
// to pull, a pit and a wary pair.
const HALL = {
  name: 'The hall',
  width: 12,
  height: 7,
  image: null,
  entries: [{ id: 'west', x: 1, y: 3 }],
  exits: [{ id: 'out', name: 'the far door', x: 11, y: 3, to: 'out' }],
  features: [{ id: 'lever', name: 'the lever', x: 10, y: 0 }],
  walls: [{ points: [sq(6, 0), sq(6, 3)] }, { points: [sq(6, 4), sq(6, 7)] }],
  doors: [{ id: 'mid', name: 'the middle door', from: sq(6, 3), to: sq(6, 4) }],
  obstacles: [
    { id: 'table', name: 'a table', kind: 'low', x: 3, y: 1, w: 2 },
    { id: 'pillar', name: 'a pillar', kind: 'solid', x: 8, y: 5 },
    { id: 'rubble', name: 'rubble', kind: 'difficult', x: 7, y: 2 },
  ],
  hazards: [],
  figures: [],
};
// A generic gate with a wall and its own lamp; a cellar with no layers.
const GATE = {
  name: 'A gate',
  width: 6,
  height: 6,
  generic: { kind: 'gate', terrain: 'town' },
  entries: [{ id: 'in', x: 1, y: 3 }],
  exits: [{ id: 'out', name: 'the road', x: 0, y: 3, to: 'out' }],
  features: [],
  walls: [{ points: [sq(3, 0), sq(3, 2)] }],
  geometry: geo.normalize({ lights: [{ id: 'lamp', at: [10, 10], radius: 10 }] }),
};
const CELLAR = {
  name: 'The cellar',
  width: 6,
  height: 6,
  entries: [{ id: 'top', x: 0, y: 0 }],
  exits: [],
  features: [],
};

beforeAll(async () => {
  jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max - 1);
  await db.recursiveDelete(db.collection('loom_worlds'));
  await world().set({ name: 'The Convert Test', status: 'published', canonVersion: 3 });
  for (const [id, doc] of Object.entries({ bm_hall: HALL, bm_gate: GATE, bm_cellar: CELLAR })) {
    await world()
      .collection('battleMaps')
      .doc(id)
      .set({ id, ...doc });
  }
  // The hall's grid map, with the copy of its layers L-902 left there.
  await world()
    .collection('maps')
    .doc('bm_hall')
    .set({ id: 'bm_hall', kind: 'grid', name: 'The hall', walls: HALL.walls, doors: HALL.doors });
});
afterAll(async () => {
  crypto.randomInt.mockRestore();
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

let stored; // the hall as stored before the conversion

test('a dry run reports the maps and the replay, and writes nothing', async () => {
  stored = await mapDoc('bm_hall');
  const [report] = await convert.run(db, { worldIds: [WORLD] });
  expect(report).toMatchObject({
    worldId: WORLD,
    name: 'The Convert Test',
    maps: 3,
    converted: 2,
    changed: 2,
    changedIds: ['bm_gate', 'bm_hall'],
    gridCopies: 1,
    problems: [],
    replay: { maps: 2, matched: 2, differences: [] },
    applied: false,
  });
  expect(report.replay.checks).toBeGreaterThan(10);
  expect((await mapDoc('bm_hall')).geometry).toBeUndefined();
  expect((await mapDoc('bm_gate')).geometry).toEqual(GATE.geometry);
  expect((await world().get()).data().canonVersion).toBe(3);
});

test('applied, the layers are stored as geometry and deleted, and nothing else changes', async () => {
  const [report] = await convert.run(db, { worldIds: [WORLD], apply: true });
  expect(report).toMatchObject({ changed: 2, applied: true });
  const hall = await mapDoc('bm_hall');
  expect(hall.geometry).toEqual(layerGeometry.converted(stored));
  expect(hall.geometry.doors.map((d) => d.id)).toEqual(['mid']);
  expect(hall.geometry.objects.map((o) => o.id)).toEqual(['layer-pillar']);
  expect(geo.check(hall.geometry, { width: 60, height: 35 })).toEqual([]);
  // Everything else it had, as it was; its layers gone, and read back from
  // its geometry as they were.
  const { geometry, ...rest } = hall;
  const { walls, doors, obstacles, ...others } = stored;
  expect(rest).toEqual(others);
  expect(layerGeometry.layersOf(geometry)).toEqual({ walls, doors, obstacles });
  // The grid map's copies are gone.
  const grid = (await world().collection('maps').doc('bm_hall').get()).data();
  expect(grid).toEqual({ id: 'bm_hall', kind: 'grid', name: 'The hall' });
  // The gate's own lamp is kept beside its wall.
  const gate = await mapDoc('bm_gate');
  expect(gate.geometry.lights).toEqual(GATE.geometry.lights);
  expect(gate.geometry.walls.map((w) => w.id)).toEqual(['layer-wall-0']);
  // The cellar has nothing to convert.
  expect((await mapDoc('bm_cellar')).geometry).toBeUndefined();
  expect((await world().get()).data().canonVersion).toBe(4);
});

test('running it twice changes nothing', async () => {
  const [again] = await convert.run(db, { worldIds: [WORLD], apply: true, replayIt: false });
  expect(again).toMatchObject({ changed: 0, changedIds: [], gridCopies: 0, applied: false });
  expect((await world().get()).data().canonVersion).toBe(4);
});

describe('a fight on the converted hall plays as before', () => {
  // The scripted fight: in at the west door, Grell behind the middle door
  // with a club. Walk to the door, open it (he comes into view: the fight
  // starts), on through it, end turns, strike him, back off.
  const SCRIPT = [
    { verb: 'move', cell: sq(5, 3) },
    { verb: 'door', door: 'mid', open: true },
    { verb: 'move', cell: sq(7, 4) },
    { verb: 'end-turn' },
    { verb: 'attack', target: 'grell' },
    { verb: 'end-turn' },
    { verb: 'move', cell: sq(4, 5) },
    { verb: 'end-turn' },
  ];
  // What a turn comes to, without its clock or ids.
  const outcome = (answer) => ({
    narration: answer.narration || null,
    refused: Boolean(answer.refused),
    step: answer.step
      ? {
          cell: answer.step.cell || null,
          point: answer.step.point || null,
          ap: answer.step.ap === undefined ? null : answer.step.ap,
          lines: answer.step.lines || [],
        }
      : null,
    turns: (answer.turns || []).map((t) => ({ id: t.id, path: t.path, points: t.points })),
    roll: answer.roll ? answer.roll.total : null,
  });
  const stateOf = (save) => ({
    cell: save.cell,
    gridPoint: save.gridPoint || null,
    turn: save.turn,
    doors: save.doors || null,
    figures: save.figures || null,
    sheet: save.character.sheet,
    fight: save.fight
      ? {
          round: save.fight.round,
          turn: save.fight.turn,
          order: save.fight.order,
          combatants: save.fight.combatants,
        }
      : null,
  });

  async function playThrough(label, hall) {
    mockState.hall = { id: 'bm_hall', ...hall };
    const ref = db.collection('loom_saves').doc(`fight-${label}`);
    await ref.set({
      ...makeSave({
        ownerUid: PLAYER.uid,
        worldId: 'shattered-coast',
        name: 'Voyage',
        character: { name: 'Tam', sheet: sheets.defaultSheet(FANTASY) },
        location: 'widows-reach',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      mapId: 'bm_hall',
      cell: sq(1, 3),
      turn: { n: 1, ap: 20, kept: 0, plan: null },
    });
    const answers = [];
    const states = [];
    for (const action of SCRIPT) {
      const answer = await loomPlayTurn.run({
        data: { worldId: 'shattered-coast', saveId: ref.id, action },
        auth: PLAYER,
      });
      answers.push(outcome(answer));
      states.push(stateOf((await ref.get()).data()));
    }
    return { answers, states };
  }

  test('before and after, line for line', async () => {
    // Before: its layers read as geometry beside it, as play read them.
    const before = await playThrough('before', convert.beforeOf(stored));
    const after = await playThrough('after', await mapDoc('bm_hall'));
    // It was a fight: Grell came into view, moved and struck.
    expect(before.states.some((s) => s.fight)).toBe(true);
    expect(before.answers.some((a) => a.turns.some((t) => t.id === 'grell'))).toBe(true);
    expect(before.answers.some((a) => a.roll !== null)).toBe(true);
    expect(after.answers).toEqual(before.answers);
    expect(after.states).toEqual(before.states);
  });
});
