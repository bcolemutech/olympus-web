'use strict';

/**
 * The town layer (planning/the-loom-layered-worlds.md §8; L-342 / #396):
 * places inside settlements, arriving at the entrance that serves the route,
 * walking between places, leaving only by a way out, towns graded and gated,
 * and the Rich bar scaled to a settlement's size. Played through the Loom's
 * callables on a Nisia world in the Firestore emulator (Gemini mocked), plus
 * pure tests of the town helpers and grading.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-town --verbose"
 */

const PROJECT = 'demo-loom-town';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { layOutTowns } = require('./helpers/towns');
const { loomCreateSave, loomPlayTurn } = require('../functions/index');

const fs = require('fs');
const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { loadDraftWorld } = require('../functions/cartographer/load');
const loomCanon = require('../functions/loom-canon');
const town = require('../functions/loom-canon/town');
const grading = require('../functions/loom-canon/grading');

const db = getFirestore();
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };
const WORLD = 'nisia-t0t0t0';
const worldRef = db.collection('loom_worlds').doc(WORLD);
const WRITTEN = { description: 'mcp' };

// Burdendal (loc_1): Dunscombe loc_120 and Wisin loc_229 by sea, Ashleaches
// loc_231 and Dunsmouth loc_631 by trail. Its town: a harbour for the sea, a
// gate for the trails, a market between them, a tavern, and a temple that is
// still import text (closed).
const PLACES = {
  plc_1_gate: {
    name: 'The North Gate',
    kind: 'gate',
    entrance: { via: ['road', 'trail'] },
    connections: ['plc_1_market'],
  },
  plc_1_harbour: {
    name: 'The Harbour',
    kind: 'harbour',
    entrance: { via: ['sea'] },
    connections: ['plc_1_market'],
  },
  plc_1_market: {
    name: 'Market Square',
    kind: 'market',
    connections: ['plc_1_gate', 'plc_1_harbour', 'plc_1_tavern', 'plc_1_temple'],
  },
  plc_1_tavern: { name: 'The Gull & Anchor', kind: 'tavern', connections: ['plc_1_market'] },
  plc_1_temple: {
    name: 'Temple of the Tides',
    kind: 'temple',
    connections: ['plc_1_market'],
    sources: { description: 'import' },
  },
};

async function writeUp(collection, ...ids) {
  await Promise.all(
    ids.map((id) =>
      worldRef
        .collection(collection)
        .doc(id)
        .update({ description: `Written up: ${id}.`, sources: WRITTEN })
    )
  );
  // A settlement also needs its town; Burdendal keeps the one built above.
  if (collection === 'locations') await layOutTowns(worldRef, ...ids);
  await bump();
}
async function bump() {
  await worldRef.update({ canonVersion: (await worldRef.get()).data().canonVersion + 1 });
}

// Every turn is a move to `target`; narrator and interpreter prompts are kept.
const prompts = { interpret: [], narrate: [] };
function playerMovesTo(target) {
  mockCallGemini.mockImplementation(async (options) => {
    if (options.systemInstruction.includes('INTERPRET stage')) {
      prompts.interpret.push(options.systemInstruction);
      return target
        ? { verb: 'move', targets: [target], params: {} }
        : { verb: 'look', targets: [], params: {} };
    }
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    prompts.narrate.push(options.userMessage);
    return { narration: 'You go on.', inventedEntities: [], suggestedActions: [] };
  });
}

const newGame = () =>
  loomCreateSave.run({
    data: { worldId: WORLD, name: 'Voyage', characterName: 'Tam' },
    auth: PLAYER,
  });
const turn = (saveId) =>
  loomPlayTurn.run({ data: { worldId: WORLD, saveId, actionText: 'go on' }, auth: PLAYER });
const saveOf = async (saveId) => (await db.collection('loom_saves').doc(saveId).get()).data();
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
async function moveTo(saveId, target) {
  playerMovesTo(target);
  await turn(saveId);
  return lastResolution(saveId);
}
const standAt = (saveId, location, placeId) =>
  db.collection('loom_saves').doc(saveId).update({ location, placeId });

beforeAll(async () => {
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
    openingHook: 'A storm drives your ship ashore at Burdendal.',
    rules: { startingLocationId: 'loc_1' },
    canonVersion: 2,
  });
  for (const [id, place] of Object.entries(PLACES)) {
    await worldRef
      .collection('places')
      .doc(id)
      .set({
        id,
        locationId: 'loc_1',
        description: `${place.name}, as the locals know it.`,
        sources: WRITTEN,
        npcIds: [],
        rules: {},
        entrance: null,
        ...place,
      });
  }
  await worldRef.collection('characters').doc('chr_brannoch').set({
    id: 'chr_brannoch',
    name: 'Brannoch the Innkeeper',
    description: 'Keeps the Gull & Anchor.',
    locationId: 'loc_1',
    placeId: 'plc_1_tavern',
  });
  await writeUp('locations', 'loc_1', 'loc_229', 'loc_631');
});

beforeEach(() => {
  loomCanon.clearWorldCache();
  mockCallGemini.mockReset();
  prompts.interpret.length = 0;
  prompts.narrate.length = 0;
});

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

describe('a walk through Burdendal', () => {
  let saveId;
  beforeAll(async () => {
    ({ saveId } = await newGame());
  });

  test('a new game in a town begins at its first open entrance', async () => {
    expect(await saveOf(saveId)).toMatchObject({ location: 'loc_1', placeId: 'plc_1_gate' });
  });

  test('arriving by sea lands at the harbour', async () => {
    await standAt(saveId, 'loc_229', null); // Wisin, an older save with no place
    expect(await moveTo(saveId, 'loc_1')).toMatchObject({
      outcome: 'success',
      constraints: ['You arrive at Burdendal, at The Harbour.'],
    });
    expect(await saveOf(saveId)).toMatchObject({ location: 'loc_1', placeId: 'plc_1_harbour' });
    // The narrator is told the ways on from the harbour: in town, and out by sea.
    const exits = prompts.narrate.at(-1);
    expect(exits).toContain('WAYS ON FROM The Harbour, Burdendal:');
    expect(exits).toContain('- Market Square (plc_1_market): open');
    expect(exits).toContain('- Wisin (loc_229), out of town by sea: open');
    expect(exits).toContain('- Dunscombe (loc_120), out of town by sea: CLOSED');
    expect(exits).not.toContain('Dunsmouth'); // a trail: not from the harbour
  });

  test('the interpreter knows the places of the town the player is in', async () => {
    playerMovesTo(null);
    await turn(saveId);
    expect(prompts.interpret.at(-1)).toContain('- plc_1_market (place): Market Square');
    expect(prompts.interpret.at(-1)).not.toContain('(place): Market Square (');
  });

  test('walking to the market follows the town’s links', async () => {
    expect(await moveTo(saveId, 'plc_1_market')).toMatchObject({
      outcome: 'success',
      mutations: [
        { target: 'save', op: 'set-flag', path: 'placeId', value: 'plc_1_market' },
        { op: 'increment', path: 'worldClock', value: 1 },
      ],
      constraints: ['You make your way to Market Square.'],
    });
    expect((await saveOf(saveId)).placeId).toBe('plc_1_market');
  });

  test('a closed place in town turns the player back', async () => {
    expect(await moveTo(saveId, 'plc_1_temple')).toEqual({
      outcome: 'blocked',
      mutations: [],
      constraints: ['The way to Temple of the Tides is closed. Turn back.'],
    });
    expect((await saveOf(saveId)).placeId).toBe('plc_1_market');
  });

  test('the people at a place are in the scene; others are not', async () => {
    await moveTo(saveId, 'plc_1_tavern');
    playerMovesTo(null);
    await turn(saveId);
    expect(prompts.narrate.at(-1)).toContain('Brannoch the Innkeeper');
    await moveTo(saveId, 'plc_1_market');
    playerMovesTo(null);
    await turn(saveId);
    expect(prompts.narrate.at(-1)).not.toContain('Brannoch the Innkeeper');
  });

  test('places not linked directly can’t be reached in one step', async () => {
    await standAt(saveId, 'loc_1', 'plc_1_harbour');
    expect((await moveTo(saveId, 'plc_1_tavern')).constraints).toEqual([
      "You can't get there directly from here.",
    ]);
  });

  test('leaving is only by a way out that serves the route', async () => {
    await standAt(saveId, 'loc_1', 'plc_1_market');
    expect((await moveTo(saveId, 'loc_631')).constraints).toEqual([
      'To set out for Dunsmouth by trail, go to The North Gate first.',
    ]);
    await standAt(saveId, 'loc_1', 'plc_1_gate');
    expect((await moveTo(saveId, 'loc_229')).constraints).toEqual([
      'To set out for Wisin by sea, go to The Harbour first.',
    ]);
    expect(await moveTo(saveId, 'loc_631')).toMatchObject({ outcome: 'success' });
    // Dunsmouth's own town (tests/helpers/towns.js): arrival is at its gate.
    expect(await saveOf(saveId)).toMatchObject({
      location: 'loc_631',
      placeId: 'plc_631_town-gate',
    });
  });

  test('a closed destination is reported before the way out', async () => {
    await standAt(saveId, 'loc_1', 'plc_1_market');
    expect((await moveTo(saveId, 'loc_231')).constraints).toEqual([
      'The way to Ashleaches is closed. Turn back.',
    ]);
  });

  test('a structured move from the map can walk to a place in town', async () => {
    await standAt(saveId, 'loc_1', 'plc_1_harbour');
    playerMovesTo(null);
    await loomPlayTurn.run({
      data: { worldId: WORLD, saveId, action: { verb: 'move', target: 'plc_1_market' } },
      auth: PLAYER,
    });
    expect((await saveOf(saveId)).placeId).toBe('plc_1_market');
    const turns = await db
      .collection('loom_saves')
      .doc(saveId)
      .collection('loom_turns')
      .orderBy('index', 'desc')
      .limit(1)
      .get();
    expect(turns.docs[0].data().actionText).toBe('travel to Market Square');
  });
});

test('an older save in a town (no place) stands at its default entrance and still plays', async () => {
  const { saveId } = await newGame();
  await db.collection('loom_saves').doc(saveId).update({ placeId: null });
  playerMovesTo(null);
  await expect(turn(saveId)).resolves.toMatchObject({ narration: 'You go on.' });
  expect(prompts.narrate.at(-1)).toContain('WAYS ON FROM The North Gate, Burdendal:');
  expect(await moveTo(saveId, 'loc_631')).toMatchObject({ outcome: 'success' });
});

describe('towns in grading', () => {
  let world;
  beforeAll(async () => {
    loomCanon.clearWorldCache();
    world = await loomCanon.loadWorld(WORLD, { db });
  });

  test('places are graded: written up is playable; a resident or lore makes one rich', () => {
    expect(grading.gradePlace(world, world.places.plc_1_temple).grade).toBe('stub');
    expect(grading.gradePlace(world, world.places.plc_1_market)).toEqual({
      grade: 'playable',
      checklist: [
        {
          need: 'residents',
          for: 'rich',
          message: 'Nobody is found here and there is no lore about it: add either.',
        },
      ],
    });
    expect(grading.gradePlace(world, world.places.plc_1_tavern).grade).toBe('rich');
    expect(grading.isPlaceOpen(world, world.places.plc_1_temple)).toBe(false);
    // Burdendal's five, and the gates of Wisin and Dunsmouth.
    expect(grading.gradeWorld(world).inTown).toEqual({
      total: 7,
      unbuilt: 0,
      stub: 1,
      playable: 5,
      rich: 1,
    });
  });

  test('residents anywhere in town count toward the settlement', () => {
    const graded = grading.gradeLocation(world, world.locations.loc_1);
    expect(graded.checklist).toContainEqual({
      need: 'residents',
      for: 'rich',
      message: 'A great city needs 6 residents (it has 1).',
    });
  });

  test('the town requirement is on: a written-up settlement needs a working layout', () => {
    expect(grading.gradeLocation(world, world.locations.loc_1).grade).toBe('playable');
    expect(grading.gradeLocation(world, world.locations.loc_631).grade).toBe('playable');
    // Without its town, written-up Dunsmouth is Unbuilt, and closed.
    const places = { ...world.places };
    delete places['plc_631_town-gate'];
    const unbuilt = { ...world, places };
    const dunsmouth = grading.gradeLocation(unbuilt, unbuilt.locations.loc_631);
    expect(grading.isPlayable(unbuilt, unbuilt.locations.loc_631)).toBe(false);
    expect(dunsmouth.grade).toBe('unbuilt');
    expect(dunsmouth.checklist[0]).toEqual({
      need: 'town',
      for: 'playable',
      message: 'It has no town layout.',
    });
  });
});

describe('town helpers', () => {
  const PUBLISHED = { status: 'published' };
  const place = (id, extra) => ({
    id,
    locationId: 'loc_a',
    name: id,
    description: 'Written.',
    sources: WRITTEN,
    connections: [],
    ...extra,
  });
  const world = (places) => ({
    ...PUBLISHED,
    locations: {
      loc_a: { id: 'loc_a', geo: { kind: 'settlement', links: { loc_b: 'sea' } } },
      loc_b: { id: 'loc_b' },
    },
    places: Object.fromEntries(places.map((p) => [p.id, p])),
    characters: {},
    lore: {},
  });

  test('a valid layout needs an open entrance and every place reachable from it', () => {
    const gate = place('p_gate', { entrance: { via: ['road'] }, connections: ['p_square'] });
    const square = place('p_square', { connections: ['p_gate'] });
    const island = place('p_island');
    expect(town.hasTownLayout(world([gate, square]), { id: 'loc_a' })).toBe(true);
    expect(town.hasTownLayout(world([gate, square, island]), { id: 'loc_a' })).toBe(false);
    const closedGate = { ...gate, sources: { description: 'import' } };
    expect(town.hasTownLayout(world([closedGate, square]), { id: 'loc_a' })).toBe(false);
    expect(town.hasTownLayout(world([square]), { id: 'loc_a' })).toBe(false);
  });

  test('arrival picks an open entrance serving the route, then any open one', () => {
    const gate = place('p_gate', { entrance: { via: ['road'] } });
    const quay = place('p_quay', { entrance: { via: ['sea'] } });
    expect(town.arrivalPlace(world([gate, quay]), 'loc_a', 'sea').id).toBe('p_quay');
    expect(town.arrivalPlace(world([gate]), 'loc_a', 'sea').id).toBe('p_gate');
    expect(town.arrivalPlace(world([]), 'loc_a', 'sea')).toBeNull();
    const shut = { ...quay, sources: { description: 'import' } };
    expect(town.arrivalPlace(world([gate, shut]), 'loc_a', 'sea').id).toBe('p_gate');
  });

  test('a recorded place is kept, even retired, so nobody is stranded', () => {
    const gate = place('p_gate', { entrance: {} });
    const ruin = place('p_ruin', { retired: true });
    const w = world([gate, ruin]);
    expect(town.positionOf(w, { location: 'loc_a', placeId: 'p_ruin' }).place.id).toBe('p_ruin');
    expect(town.positionOf(w, { location: 'loc_a' }).place.id).toBe('p_gate');
    expect(town.positionOf(w, { location: 'loc_b' }).place).toBeNull();
  });
});

describe('the Rich bar scales with a settlement', () => {
  const settlement = (population, capital = false) => ({
    geo: { kind: 'settlement', population, capital },
  });

  test('from village to great city, a capital one size up', () => {
    expect(grading.sizeTier(settlement(400)).name).toBe('village');
    expect(grading.sizeTier(settlement(8552)).name).toBe('town');
    expect(grading.sizeTier(settlement(12000)).name).toBe('city');
    expect(grading.sizeTier(settlement(45000)).name).toBe('great city');
    expect(grading.sizeTier(settlement(8552, true)).name).toBe('city');
    expect(grading.sizeTier(settlement(45000, true)).name).toBe('great city');
  });
});
