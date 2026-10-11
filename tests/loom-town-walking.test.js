'use strict';

/**
 * Walking in a town with ground (planning/the-loom-movement-and-vision.md §8;
 * L-662 / #469): a move to a point on the street or to a place walks its
 * paths, 20 m a point, stopping when movement runs out with the plan kept;
 * Continue goes on; reaching a door goes in, onto its map; "Walk there" plays
 * out turns until it arrives; and leaving for the world map is from a way
 * out. Played through the Loom's callables on a Nisia world in the Firestore
 * emulator (Gemini mocked).
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-town-walking --verbose"
 */

const PROJECT = 'demo-loom-town-walking';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { layOutTowns, GATEWAY } = require('./helpers/towns');
const { loomCreateSave, loomPlayTurn, loomGetMap } = require('../functions/index');
const { OUT_OF_MOVEMENT } = require('../functions/loom-turn/steps');
const { validateSave } = require('../functions/loom-models');

const fs = require('fs');
const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { loadDraftWorld } = require('../functions/cartographer/load');

const db = getFirestore();
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };
const WORLD = 'nisia-t0t0t0';
const worldRef = db.collection('loom_worlds').doc(WORLD);
const WRITTEN = { description: 'mcp' };

const pt = (x, y) => ({ x, y });
const rect = (x0, y0, x1, y1) => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)];

// Burdendal (a capital great city: 2.5 km across, so 100 units is 250 m): a
// south gate, the market hall in the middle, a river with one bridge, and
// the temple and a well beyond it.
const GROUND = {
  buildings: [{ name: 'the market hall', points: rect(400, 600, 600, 700) }],
  water: [{ name: 'the Burd', points: rect(0, 450, 1000, 500) }],
  walls: [],
  crossings: [{ name: 'the Burd bridge', points: rect(780, 440, 840, 510) }],
};
const place = (id, name, position, extra = {}) => ({
  id,
  locationId: 'loc_1',
  name,
  kind: 'district',
  description: `${name}, as the locals know it.`,
  sources: WRITTEN,
  connections: [],
  npcIds: [],
  rules: {},
  entrance: null,
  position,
  battleMap: { mapId: GATEWAY.id },
  ...extra,
});
const PLACES = {
  plc_1_gate: place('plc_1_gate', 'The South Gate', pt(500, 950), {
    kind: 'gate',
    entrance: { via: ['road', 'trail', 'sea'] },
  }),
  // Linked to the gate from before the town had ground (L-665: unused).
  plc_1_quay: place('plc_1_quay', 'The Quay', pt(500, 820), { connections: ['plc_1_gate'] }),
  plc_1_temple: place('plc_1_temple', 'The Temple', pt(500, 150)),
  plc_1_well: place('plc_1_well', 'The Well', pt(820, 300)),
};

// What the interpreter makes of the next typed line (Gemini stubbed).
let typedTargets = null;
function narrator() {
  mockCallGemini.mockImplementation(async (options) => {
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return typedTargets
        ? { verb: 'move', targets: typedTargets, params: {} }
        : { verb: 'look', targets: [], params: {} };
    }
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    return { narration: 'You go on.', inventedEntities: [], suggestedActions: [] };
  });
}

// A typed line the interpreter reads as a move to these targets.
async function typed(saveId, text, targets) {
  typedTargets = targets;
  try {
    return await loomPlayTurn.run({
      data: { worldId: WORLD, saveId, actionText: text },
      auth: PLAYER,
    });
  } finally {
    typedTargets = null;
  }
}
const play = (saveId, action) =>
  loomPlayTurn.run({ data: { worldId: WORLD, saveId, action }, auth: PLAYER });
const lastResolution = async (saveId) =>
  (
    await db
      .collection('loom_saves')
      .doc(saveId)
      .collection('loom_turns')
      .orderBy('index', 'desc')
      .limit(1)
      .get()
  ).docs[0].data().resolution;
const saveOf = async (saveId) => (await db.collection('loom_saves').doc(saveId).get()).data();
const where = async (saveId) => {
  const { location, placeId, mapId, townPoint } = await saveOf(saveId);
  return { location, placeId, mapId, townPoint: townPoint || null };
};
async function newGame() {
  const { saveId } = await loomCreateSave.run({
    data: { worldId: WORLD, name: 'Walk', characterName: 'Tam' },
    auth: PLAYER,
  });
  return saveId;
}
// Off the gate's map (its entry is its way out), standing at the gate.
const stepOffMap = (saveId) => play(saveId, { verb: 'move', cell: { x: 1, y: 1 } });
// On the street at a point, as if walked there.
const standOnStreet = (saveId, point) =>
  db
    .collection('loom_saves')
    .doc(saveId)
    .update({ placeId: null, mapId: null, cell: null, townPoint: point });

beforeAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db.recursiveDelete(db.collection('loom_saves'));
  const parsed = parseAzgaarExport(
    fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
  );
  await loadDraftWorld({
    db,
    mapped: mapToCanon(parsed),
    source: parsed.source,
    uploadedBy: 'builder-001',
    worldId: WORLD,
  });
  await worldRef.update({
    status: 'published',
    openingHook: 'You come to Burdendal by the south road.',
    rules: { startingLocationId: 'loc_1' },
    canonVersion: 2,
  });
  await worldRef.collection('battleMaps').doc(GATEWAY.id).set(GATEWAY);
  for (const [id, doc] of Object.entries(PLACES)) {
    await worldRef.collection('places').doc(id).set(doc);
  }
  await worldRef.collection('locations').doc('loc_1').update({
    description: 'A great walled port.',
    'sources.description': 'mcp',
    'town.ground': GROUND,
  });
  // A neighbour to travel to, open.
  await worldRef
    .collection('locations')
    .doc('loc_631')
    .update({ description: 'A market town.', 'sources.description': 'mcp' });
  await layOutTowns(worldRef, 'loc_631');
  await worldRef.update({ canonVersion: 3 });
  narrator();
}, 60000);

afterAll(async () => {
  await functionsTest.cleanup();
});

describe('a new game starts at the gate, and steps off its map there', () => {
  test('the gate keeps you, ready to leave or walk', async () => {
    const saveId = await newGame();
    expect(await where(saveId)).toMatchObject({ placeId: 'plc_1_gate', mapId: GATEWAY.id });
    await stepOffMap(saveId);
    expect(await where(saveId)).toEqual({
      location: 'loc_1',
      placeId: 'plc_1_gate',
      mapId: null,
      townPoint: null,
    });
  });
});

describe('walking to the temple: partway, Continue, arrive and go in', () => {
  let saveId;
  beforeAll(async () => {
    saveId = await newGame();
    await stepOffMap(saveId);
  });

  test('the first turn walks 400 m and stops on the street, the rest kept as the plan', async () => {
    const answer = await play(saveId, { verb: 'move', target: 'plc_1_temple' });
    expect(answer.narration).toBe('You walk 400 m. ' + OUT_OF_MOVEMENT);
    expect(answer.step).toMatchObject({
      movementLeft: 0,
      plan: { layer: 'town', locationId: 'loc_1', placeId: 'plc_1_temple', to: pt(500, 150) },
      lines: ['You walk 400 m.', OUT_OF_MOVEMENT],
    });
    const now = await where(saveId);
    expect(now).toMatchObject({ location: 'loc_1', placeId: null, mapId: null });
    expect(now.townPoint).toEqual(answer.step.townPoint);
    // 400 m is 160 units from the gate, round the market hall.
    expect(now.townPoint.y).toBeLessThan(950);
    expect(validateSave(await saveOf(saveId)).valid).toBe(true);
    // Nothing was narrated, or recorded: the one turn is stepping off the
    // gate's map.
    expect(
      (await db.collection('loom_saves').doc(saveId).collection('loom_turns').get()).size
    ).toBe(1);
  });

  test('the town view shows where on the street, the ground to walk, and the plan', async () => {
    const map = await loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });
    expect(map.town).toMatchObject({
      here: null,
      at: (await where(saveId)).townPoint,
      // For the town view's paths (L-664).
      ground: GROUND,
      size: 2500,
      walks: true,
    });
    expect(map.turn.plan).toMatchObject({ layer: 'town', placeId: 'plc_1_temple' });
    // Its links aren't drawn or walked (L-665).
    expect(map.town.links).toEqual([]);
    expect(map.town.next).toEqual([]);
  });

  test('out of movement, Continue says so; after the turn ends it walks on', async () => {
    expect((await play(saveId, { verb: 'continue' })).narration).toBe(OUT_OF_MOVEMENT);
    await play(saveId, { verb: 'end-turn' });
    const first = (await saveOf(saveId)).turn.plan.metres;
    const on = await play(saveId, { verb: 'continue' });
    expect(on.step.lines[0]).toBe('You walk 400 m.');
    expect(on.step.plan.metres).toBeCloseTo(first - 400, -1);
  });

  test('turn by turn it reaches the temple door, and goes in onto its map', async () => {
    let answer;
    for (let i = 0; i < 10; i++) {
      await play(saveId, { verb: 'end-turn' });
      answer = await play(saveId, { verb: 'continue' });
      if (answer.step.entered) break;
    }
    expect(answer.step.entered).toBe('plc_1_temple');
    expect(answer.narration).toMatch(/^You walk \d+ m\. You go on\.$/);
    expect(await where(saveId)).toEqual({
      location: 'loc_1',
      placeId: 'plc_1_temple',
      mapId: GATEWAY.id,
      townPoint: null,
    });
  });

  test('stepping off the temple’s map puts you on the street at its door', async () => {
    await stepOffMap(saveId);
    expect(await where(saveId)).toEqual({
      location: 'loc_1',
      placeId: null,
      mapId: null,
      townPoint: pt(500, 150),
    });
  });
});

describe('walking to a point', () => {
  test('a point on open ground is walked to; a building or the river is refused', async () => {
    const saveId = await newGame();
    await stepOffMap(saveId);
    // 112 units from the gate: 280 m, inside a turn's 400.
    const near = await play(saveId, { verb: 'move', point: pt(400, 900) });
    expect(near.step).toMatchObject({ townPoint: pt(400, 900), plan: null, movementLeft: 6 });
    expect((await play(saveId, { verb: 'move', point: pt(500, 650) })).narration).toBe(
      "You can't stand there."
    );
    expect((await play(saveId, { verb: 'move', point: pt(300, 470) })).narration).toBe(
      "You can't stand there."
    );
    expect(await where(saveId)).toMatchObject({ townPoint: pt(400, 900) });
  });
});

describe('"Walk there"', () => {
  test('across the city in one request: several turns, then in at the door', async () => {
    const saveId = await newGame();
    await stepOffMap(saveId);
    const before = (await saveOf(saveId)).turn.n;
    const answer = await play(saveId, { verb: 'walk-there', target: 'plc_1_well' });
    expect(answer.step.entered).toBe('plc_1_well');
    expect(answer.step.turns).toBeGreaterThan(2);
    expect((await saveOf(saveId)).turn.n).toBe(before + answer.step.turns - 1);
    expect(await where(saveId)).toMatchObject({ placeId: 'plc_1_well', mapId: GATEWAY.id });
    // Recorded: stepping off the gate's map, each turn it ended, and going
    // in; the walking itself isn't narrated.
    const turns = await db.collection('loom_saves').doc(saveId).collection('loom_turns').get();
    expect(turns.size).toBe(1 + (answer.step.turns - 1) + 1);
  });

  test('to a point: stops there, over as many turns as it takes', async () => {
    const saveId = await newGame();
    await stepOffMap(saveId);
    // About 910 m: three turns of 400.
    const answer = await play(saveId, { verb: 'walk-there', point: pt(150, 850) });
    expect(answer.step).toMatchObject({ townPoint: pt(150, 850), plan: null, turns: 3 });
    expect(answer.narration).toMatch(/^You walk 400 m\. You walk 400 m\. You walk 1[01]\d m\.$/);
  });

  test('a refusal stops it at once', async () => {
    const saveId = await newGame();
    await stepOffMap(saveId);
    const answer = await play(saveId, { verb: 'walk-there', point: pt(500, 650) });
    expect(answer).toMatchObject({ narration: "You can't stand there.", refused: true });
  });
});

describe('leaving for the world map', () => {
  test('from the gate, off its map: you travel', async () => {
    const saveId = await newGame();
    await stepOffMap(saveId);
    await play(saveId, { verb: 'move', target: 'loc_631' });
    expect(await where(saveId)).toMatchObject({ location: 'loc_631', townPoint: null });
  });

  test('from the street at a way out’s door: you travel', async () => {
    const saveId = await newGame();
    await standOnStreet(saveId, pt(500, 950));
    await play(saveId, { verb: 'move', target: 'loc_631' });
    expect(await where(saveId)).toMatchObject({ location: 'loc_631', townPoint: null });
  });
});

describe('typed moves follow the streets (L-663)', () => {
  test('"go to the temple": the first turn walks 400 m, narrated, the rest kept as the plan', async () => {
    const saveId = await newGame();
    await stepOffMap(saveId);
    await typed(saveId, 'go to the temple', ['plc_1_temple']);
    const resolution = await lastResolution(saveId);
    expect(resolution.outcome).toBe('success');
    expect(resolution.constraints).toEqual([
      'You head for The Temple.',
      'You walk 400 m.',
      OUT_OF_MOVEMENT,
    ]);
    const save = await saveOf(saveId);
    expect(save).toMatchObject({ placeId: null, mapId: null });
    expect(save.townPoint.y).toBeLessThan(950);
    expect(save.turn).toMatchObject({
      movementLeft: 0,
      plan: { layer: 'town', placeId: 'plc_1_temple', to: pt(500, 150) },
    });
    // Continue picks it up, as from a tap.
    await play(saveId, { verb: 'end-turn' });
    expect((await play(saveId, { verb: 'continue' })).step.lines[0]).toBe('You walk 400 m.');
  });

  test('a place within reach: walked to and gone into in one turn, movement spent', async () => {
    const saveId = await newGame();
    await stepOffMap(saveId);
    // The quay is 130 units (325 m) up the street from the gate.
    await typed(saveId, 'go to the quay', ['plc_1_quay']);
    expect((await lastResolution(saveId)).constraints).toEqual(['You make your way to The Quay.']);
    expect(await where(saveId)).toMatchObject({
      placeId: 'plc_1_quay',
      mapId: GATEWAY.id,
      townPoint: null,
    });
    expect((await saveOf(saveId)).turn.movementLeft).toBe(20 - 17); // 325 m: 17 points of 20 m
  });

  test('a place across the river with no way over is refused', async () => {
    const saveId = await newGame();
    await stepOffMap(saveId);
    await worldRef
      .collection('locations')
      .doc('loc_1')
      .update({ 'town.ground': { ...GROUND, crossings: [] } });
    await worldRef.update({ canonVersion: (await worldRef.get()).data().canonVersion + 1 });
    try {
      await typed(saveId, 'go to the temple', ['plc_1_temple']);
      expect((await lastResolution(saveId)).constraints).toEqual([
        "There's no way there from here.",
      ]);
    } finally {
      await worldRef.collection('locations').doc('loc_1').update({ 'town.ground': GROUND });
      await worldRef.update({ canonVersion: (await worldRef.get()).data().canonVersion + 1 });
    }
  });

  test('"leave for the market town" from near the gate: walks to it and sets out', async () => {
    const saveId = await newGame();
    await standOnStreet(saveId, pt(400, 900));
    await typed(saveId, 'set out for the market town', ['loc_631']);
    const resolution = await lastResolution(saveId);
    expect(resolution.constraints[0]).toBe('You make your way to The South Gate.');
    expect(resolution.constraints[1]).toMatch(/^You arrive at /);
    expect(await where(saveId)).toMatchObject({ location: 'loc_631', townPoint: null });
  });

  test('from across town: walks toward the gate, and Continue sets out on arrival', async () => {
    const saveId = await newGame();
    await standOnStreet(saveId, pt(500, 150));
    await typed(saveId, 'set out for the market town', ['loc_631']);
    expect((await lastResolution(saveId)).constraints[0]).toMatch(
      /^You head for The South Gate, on your way to /
    );
    expect((await saveOf(saveId)).turn.plan).toMatchObject({
      layer: 'town',
      leaveFor: 'loc_631',
      to: pt(500, 950),
    });
    // "Walk there" along the plan: turn by turn to the gate, then out.
    let answer;
    for (let i = 0; i < 10; i++) {
      await play(saveId, { verb: 'end-turn' });
      answer = await play(saveId, { verb: 'continue' });
      if (answer.step.left) break;
    }
    expect(answer.step.left).toBe('loc_631');
    expect(await where(saveId)).toMatchObject({ location: 'loc_631', townPoint: null });
  });
});

describe('older saves in a town with ground (L-665)', () => {
  test('one with no place and no point stands at the way in’s door, and walks from there', async () => {
    const saveId = await newGame();
    await db
      .collection('loom_saves')
      .doc(saveId)
      .update({ placeId: null, mapId: null, cell: null, turn: null });
    const answer = await play(saveId, { verb: 'move', point: pt(400, 900) });
    // 112 units from the gate's door: 280 m.
    expect(answer.narration).toBe('You walk 280 m.');
    expect(answer.step.townPoint).toEqual(pt(400, 900));
  });

  test('one at a place, off its map, stands at its door', async () => {
    const saveId = await newGame();
    await db
      .collection('loom_saves')
      .doc(saveId)
      .update({ placeId: 'plc_1_quay', mapId: null, cell: null });
    const map = await loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });
    expect(map.town).toMatchObject({ here: 'plc_1_quay', at: null, walks: true });
    const answer = await play(saveId, { verb: 'move', point: pt(500, 900) });
    // From the quay's door, 80 units: 200 m.
    expect(answer.narration).toBe('You walk 200 m.');
  });

  test('a move to a place goes by the streets, not the old link', async () => {
    const saveId = await newGame();
    await stepOffMap(saveId);
    // The gate is linked to the quay only; the temple is walked to anyway.
    const answer = await play(saveId, { verb: 'move', target: 'plc_1_temple' });
    expect(answer.step.plan).toMatchObject({ layer: 'town', placeId: 'plc_1_temple' });
  });
});

describe('what a save has seen of the town (L-671)', () => {
  const { unpack } = require('../functions/loom-turn/town-seen');
  const square = (grid, p) => grid[Math.floor(p.y / 5) * 200 + Math.floor(p.x / 5)];
  const record = async (saveId) =>
    (
      await db.collection('loom_saves').doc(saveId).collection('seenTowns').doc('loc_1').get()
    ).data();

  test('a walk records what it saw along the way; a second walk adds to it, and it keeps', async () => {
    const saveId = await newGame();
    await stepOffMap(saveId);
    // In a 2.5 km city, 100 m of sight is 40 units.
    await play(saveId, { verb: 'move', point: pt(400, 900) });
    const first = await record(saveId);
    expect(first).toMatchObject({ locationId: 'loc_1', side: 200 });
    const after1 = unpack(first.squares);
    expect(square(after1, pt(450, 925))).toBe(1); // on the way
    expect(square(after1, pt(400, 860))).toBe(1); // 40 units from where it stands
    expect(square(after1, pt(400, 820))).toBe(0); // beyond sight
    expect(square(after1, pt(500, 150))).toBe(0); // the temple, far off

    await play(saveId, { verb: 'end-turn' });
    await play(saveId, { verb: 'move', point: pt(300, 850) });
    const after2 = unpack((await record(saveId)).squares);
    expect(square(after2, pt(300, 830))).toBe(1); // newly seen
    for (let i = 0; i < after1.length; i++) if (after1[i]) expect(after2[i]).toBe(1);

    // A fresh read, as on the next session: the same record.
    const reloaded = await db
      .collection('loom_saves')
      .doc(saveId)
      .collection('seenTowns')
      .doc('loc_1')
      .get();
    expect(reloaded.data().squares).toBe((await record(saveId)).squares);
  });

  test('standing at a door off its map looks from there; so does stepping out of a place', async () => {
    const saveId = await newGame();
    await stepOffMap(saveId); // at the gate, off its map: looks from its door
    const atGate = unpack((await record(saveId)).squares);
    expect(square(atGate, pt(500, 930))).toBe(1);
    expect(square(atGate, pt(500, 820))).toBe(0); // the quay, 130 units off
    await play(saveId, { verb: 'move', target: 'plc_1_quay' }); // in, onto its map
    await db.collection('loom_saves').doc(saveId).collection('seenTowns').doc('loc_1').delete();
    await stepOffMap(saveId); // out of the quay, onto the street at its door
    const atQuay = unpack((await record(saveId)).squares);
    expect(square(atQuay, pt(500, 800))).toBe(1);
    expect(square(atQuay, pt(500, 950))).toBe(0);
  });

  test('a typed walk records the way it went', async () => {
    const saveId = await newGame();
    await standOnStreet(saveId, pt(500, 150));
    await typed(saveId, 'go to the well', ['plc_1_well']);
    const way = unpack((await record(saveId)).squares);
    expect(square(way, pt(520, 160))).toBe(1); // where it set out
    const save = await saveOf(saveId);
    expect(square(way, save.townPoint)).toBe(1); // where it stopped
  });
});
