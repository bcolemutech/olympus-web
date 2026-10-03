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
const { layOutTowns, mapPlaces, offMap, GATEWAY } = require('./helpers/towns');
const { loomCreateSave, loomPlayTurn, loomGetMap } = require('../functions/index');

const fs = require('fs');
const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore, FieldValue } = require(
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
        ? { verb: 'move', targets: Array.isArray(target) ? target : [target], params: {} }
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
// Each typed turn is a new turn of play: the action is refilled first (L-614).
const turn = async (saveId) => {
  await db.collection('loom_saves').doc(saveId).update({ 'turn.actionUsed': false });
  return loomPlayTurn.run({ data: { worldId: WORLD, saveId, actionText: 'go on' }, auth: PLAYER });
};
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
// Each move here is a walk about town: the player has walked out of the
// place's battle map first (every place has one, L-622).
async function moveTo(saveId, target) {
  await offMap(db, saveId);
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
  // Every place needs a battle map to be open (L-622): a generic one.
  await mapPlaces(worldRef, 'places', ...Object.keys(PLACES));
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
    // Arriving lands on the harbour's battle map (L-622): the narrator is told
    // the map. Walked out of it, it's told the ways on from the harbour: in
    // town, and out by sea.
    expect(prompts.narrate.at(-1)).toContain('ON THE MAP OF The Harbour');
    await offMap(db, saveId);
    playerMovesTo(null);
    await turn(saveId);
    const exits = prompts.narrate.at(-1);
    expect(exits).toContain('WAYS ON FROM The Harbour, Burdendal:');
    expect(exits).toContain('- Market Square (plc_1_market): open');
    // Every place a move can walk to (L-600), not only the next one.
    expect(exits).toContain('- The Gull & Anchor (plc_1_tavern): open');
    expect(exits).toContain('- Temple of the Tides (plc_1_temple): CLOSED');
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
        // On to the market's battle map, at its entry (L-622).
        { target: 'save', op: 'set-flag', path: 'mapId', value: GATEWAY.id },
        { target: 'save', op: 'set-flag', path: 'cell', value: { x: 1, y: 1 } },
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

  test('a place further off is walked to in one move, past the places between (L-600)', async () => {
    await standAt(saveId, 'loc_1', 'plc_1_harbour');
    expect(await moveTo(saveId, 'plc_1_tavern')).toMatchObject({
      outcome: 'success',
      constraints: ['You make your way from The Harbour past Market Square to The Gull & Anchor.'],
    });
    expect((await saveOf(saveId)).placeId).toBe('plc_1_tavern');
    // So is a way out: from the tavern to the gate, and then out of town.
    expect((await moveTo(saveId, 'plc_1_gate')).constraints).toEqual([
      'You make your way from The Gull & Anchor past Market Square to The North Gate.',
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
  await offMap(db, saveId);
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
        // A generic battle map stops it short of Rich (L-622).
        { need: 'battleMap', for: 'rich', message: 'It uses a generic battle map.' },
      ],
    });
    // Brannoch lives at the tavern, but its map is generic: Playable, not Rich.
    expect(grading.gradePlace(world, world.places.plc_1_tavern)).toEqual({
      grade: 'playable',
      checklist: [{ need: 'battleMap', for: 'rich', message: 'It uses a generic battle map.' }],
    });
    expect(grading.isPlaceOpen(world, world.places.plc_1_temple)).toBe(false);
    // Burdendal's five, and the gates of Wisin and Dunsmouth.
    expect(grading.gradeWorld(world).inTown).toEqual({
      total: 7,
      unbuilt: 0,
      stub: 1,
      playable: 6,
      rich: 0,
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
    battleMap: { mapId: GATEWAY.id }, // open places need maps (L-622)
    ...extra,
  });
  const world = (places) => ({
    ...PUBLISHED,
    locations: {
      loc_a: { id: 'loc_a', geo: { kind: 'settlement', links: { loc_b: 'sea' } } },
      loc_b: { id: 'loc_b' },
    },
    places: Object.fromEntries(places.map((p) => [p.id, p])),
    battleMaps: { [GATEWAY.id]: GATEWAY },
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

  test('a way in written up but with no battle map is not open, and the report says so', () => {
    const gate = place('p_gate', { entrance: { via: ['road'] }, battleMap: null });
    expect(town.hasTownLayout(world([gate]), { id: 'loc_a' })).toBe(false);
    expect(town.layoutReport(world([gate]), { id: 'loc_a' }).problems).toEqual([
      'No way in or out is open yet (written up, with a battle map), so nobody can enter.',
    ]);
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

describe('the town view: loomGetMap’s town (L-345)', () => {
  let saveId;
  const townOf = async () =>
    (await loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER })).town;

  beforeAll(async () => {
    ({ saveId } = await newGame());
  });

  test('a save in Burdendal sees its whole town, where it stands, and the ways out', async () => {
    const view = await townOf();
    expect(view).toMatchObject({
      locationId: 'loc_1',
      name: 'Burdendal',
      here: 'plc_1_gate',
      next: ['plc_1_market', 'plc_1_harbour', 'plc_1_tavern', 'plc_1_temple'],
      image: null, // no art yet (L-347)
    });
    expect(view.places).toEqual([
      {
        id: 'plc_1_gate',
        name: 'The North Gate',
        kind: 'gate',
        open: true,
        entranceFor: ['road', 'trail'],
      },
      {
        id: 'plc_1_harbour',
        name: 'The Harbour',
        kind: 'harbour',
        open: true,
        entranceFor: ['sea'],
      },
      { id: 'plc_1_market', name: 'Market Square', kind: 'market', open: true },
      { id: 'plc_1_tavern', name: 'The Gull & Anchor', kind: 'tavern', open: true },
      // Still import text: closed.
      { id: 'plc_1_temple', name: 'Temple of the Tides', kind: 'temple', open: false },
    ]);
    expect(view.links).toEqual([
      { from: 'plc_1_gate', to: 'plc_1_market' },
      { from: 'plc_1_harbour', to: 'plc_1_market' },
      { from: 'plc_1_market', to: 'plc_1_tavern' },
      { from: 'plc_1_market', to: 'plc_1_temple' },
    ]);
    // The routes out, each with the ways out that serve it.
    const gate = (id) => [{ id, name: 'The Town Gate' }];
    expect(view.exits).toEqual([
      {
        id: 'loc_120',
        name: 'Dunscombe',
        via: 'sea',
        open: false,
        waysOut: ['plc_1_harbour'],
        waysIn: [],
      },
      {
        id: 'loc_229',
        name: 'Wisin',
        via: 'sea',
        open: true,
        waysOut: ['plc_1_harbour'],
        waysIn: gate('plc_229_town-gate'),
      },
      {
        id: 'loc_231',
        name: 'Ashleaches',
        via: 'trail',
        open: false,
        waysOut: ['plc_1_gate'],
        waysIn: [],
      },
      {
        id: 'loc_631',
        name: 'Dunsmouth',
        via: 'trail',
        open: true,
        waysOut: ['plc_1_gate'],
        waysIn: gate('plc_631_town-gate'),
      },
    ]);
  });

  test('`next` follows the save: every place it can walk to, nearest first (L-600)', async () => {
    await standAt(saveId, 'loc_1', 'plc_1_market');
    expect((await townOf()).next).toEqual([
      'plc_1_gate',
      'plc_1_harbour',
      'plc_1_tavern',
      'plc_1_temple',
    ]);
    await standAt(saveId, 'loc_1', 'plc_1_harbour');
    expect((await townOf()).next).toEqual([
      'plc_1_market',
      'plc_1_gate',
      'plc_1_tavern',
      'plc_1_temple',
    ]);
  });

  test('positions come through when they are inside the town, and nothing else does', async () => {
    await worldRef
      .collection('places')
      .doc('plc_1_market')
      .update({ position: { x: 500, y: 450 } });
    await worldRef
      .collection('places')
      .doc('plc_1_tavern')
      .update({ position: { x: 5000, y: 1 } });
    await bump();
    const view = await townOf();
    const byId = Object.fromEntries(view.places.map((p) => [p.id, p]));
    expect(byId.plc_1_market.position).toEqual({ x: 500, y: 450 });
    expect(byId.plc_1_tavern).not.toHaveProperty('position'); // off the town's 0–1000
    for (const place of view.places) {
      expect(
        Object.keys(place).every((k) =>
          ['id', 'name', 'kind', 'open', 'entranceFor', 'position', 'retired'].includes(k)
        )
      ).toBe(true);
    }
  });

  test('a retired place stays in view while the save stands in it', async () => {
    await standAt(saveId, 'loc_1', 'plc_1_tavern');
    await worldRef.collection('places').doc('plc_1_tavern').update({ retired: true });
    await bump();
    const view = await townOf();
    expect(view.here).toBe('plc_1_tavern');
    expect(view.places.find((p) => p.id === 'plc_1_tavern')).toMatchObject({ retired: true });
    // Nobody is stranded: its own way back through the market stays, and on
    // to the rest of the town (L-600).
    expect(view.next).toEqual(['plc_1_market', 'plc_1_gate', 'plc_1_harbour', 'plc_1_temple']);
    await worldRef
      .collection('places')
      .doc('plc_1_tavern')
      .update({ retired: FieldValue.delete() });
    await bump();
  });

  test("the town's art comes with it, for the view to draw (L-347)", async () => {
    const art = { path: 'worlds/nisia-t0t0t0/town-loc_1-x.png', width: 1200, height: 900 };
    await worldRef.collection('locations').doc('loc_1').update({ 'town.image': art });
    await bump();
    expect((await townOf()).image).toEqual(art);
    await worldRef.collection('locations').doc('loc_1').update({ town: FieldValue.delete() });
    await bump();
  });

  test('the routes out name only places the save has discovered', async () => {
    await standAt(saveId, 'loc_1', 'plc_1_gate');
    await db
      .collection('loom_saves')
      .doc(saveId)
      .update({ discovered: ['loc_1', 'loc_631'] });
    expect((await townOf()).exits.map((e) => e.id)).toEqual(['loc_631']);
  });

  test('outside a town there is no town view; the world map still shows', async () => {
    await standAt(saveId, 'loc_231', null); // Ashleaches: no town
    const result = await loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });
    expect(result.town).toBeNull();
    expect(result.here).toBe('loc_231');
  });
});

describe('choosing the way in (L-346)', () => {
  // Dunsmouth (loc_631), by trail from Burdendal's North Gate, gains more
  // ways in: a west gate for the trail too, a quay for the sea only, and an
  // old gate still in import text.
  const DUNSMOUTH = {
    'plc_631_west-gate': { name: 'The West Gate', entrance: { via: ['trail'] }, sources: WRITTEN },
    plc_631_quay: { name: 'The Quay', entrance: { via: ['sea'] }, sources: WRITTEN },
    'plc_631_old-gate': {
      name: 'The Old Gate',
      entrance: { via: ['trail'] },
      sources: { description: 'import' },
    },
  };
  let saveId;
  const atTheGate = () => standAt(saveId, 'loc_1', 'plc_1_gate');

  beforeAll(async () => {
    for (const [id, place] of Object.entries(DUNSMOUTH)) {
      await worldRef
        .collection('places')
        .doc(id)
        .set({
          id,
          locationId: 'loc_631',
          kind: 'gate',
          description: `${place.name}.`,
          connections: ['plc_631_town-gate'],
          npcIds: [],
          rules: {},
          battleMap: { mapId: GATEWAY.id }, // open places need maps (L-622)
          ...place,
        });
    }
    await bump();
    ({ saveId } = await newGame());
  });

  afterAll(async () => {
    for (const id of Object.keys(DUNSMOUTH)) await worldRef.collection('places').doc(id).delete();
    await bump();
  });

  test('a move to a way into the next town travels there and arrives by it', async () => {
    await atTheGate();
    expect(await moveTo(saveId, 'plc_631_west-gate')).toMatchObject({
      outcome: 'success',
      constraints: ['You arrive at Dunsmouth, at The West Gate.'],
    });
    expect(await saveOf(saveId)).toMatchObject({
      location: 'loc_631',
      placeId: 'plc_631_west-gate',
    });
  });

  test('naming the town, then its way in, does the same', async () => {
    await atTheGate();
    await moveTo(saveId, ['loc_631', 'plc_631_west-gate']);
    expect(await saveOf(saveId)).toMatchObject({ placeId: 'plc_631_west-gate' });
  });

  test('naming only the town arrives as before: the first open way in serving the route', async () => {
    await atTheGate();
    await moveTo(saveId, 'loc_631');
    expect(await saveOf(saveId)).toMatchObject({
      location: 'loc_631',
      placeId: 'plc_631_town-gate',
    });
  });

  test('a way in that does not serve the route is refused, naming the ones that do', async () => {
    await atTheGate();
    expect((await moveTo(saveId, 'plc_631_quay')).constraints).toEqual([
      'The Quay is no way in by trail. Arrive by The Town Gate or The West Gate.',
    ]);
    expect(await saveOf(saveId)).toMatchObject({ location: 'loc_1', placeId: 'plc_1_gate' });
  });

  test('a closed way in is refused, and leaving still needs the right way out', async () => {
    await atTheGate();
    expect((await moveTo(saveId, 'plc_631_old-gate')).constraints).toEqual([
      'The way into Dunsmouth by The Old Gate is closed. Turn back.',
    ]);
    await standAt(saveId, 'loc_1', 'plc_1_market');
    expect((await moveTo(saveId, 'plc_631_west-gate')).constraints).toEqual([
      'To set out for Dunsmouth by trail, go to The North Gate first.',
    ]);
  });

  test('a place in another town that is no way in cannot be reached directly', async () => {
    await standAt(saveId, 'loc_631', 'plc_631_west-gate');
    expect((await moveTo(saveId, 'plc_1_market')).constraints).toEqual([
      "You can't get there directly from here.",
    ]);
  });

  test('the interpreter knows the ways into the towns next to here, and no others', async () => {
    await atTheGate();
    playerMovesTo(null);
    await turn(saveId);
    const prompt = prompts.interpret.at(-1);
    expect(prompt).toContain('- plc_631_west-gate (way into Dunsmouth): The West Gate');
    expect(prompt).toContain('- plc_631_quay (way into Dunsmouth): The Quay');
    expect(prompt).toContain('target that way in');
    // Burdendal's own places are plain places; nothing from towns further off.
    expect(prompt).toContain('- plc_1_market (place): Market Square');
    expect(prompt).not.toMatch(/way into Burdendal/);
  });

  test('loomGetMap offers the choice: open ways in, and those serving each route out', async () => {
    await atTheGate();
    const view = await loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });
    const dunsmouth = view.places.find((p) => p.id === 'loc_631');
    expect(dunsmouth.waysIn).toEqual([
      { id: 'plc_631_quay', name: 'The Quay', via: ['sea'] },
      { id: 'plc_631_town-gate', name: 'The Town Gate', via: ['road', 'trail', 'sea'] },
      { id: 'plc_631_west-gate', name: 'The West Gate', via: ['trail'] },
    ]);
    // Closed places offer no ways in.
    expect(view.places.find((p) => p.id === 'loc_231')).not.toHaveProperty('waysIn');
    const byTrail = view.town.exits.find((e) => e.id === 'loc_631');
    expect(byTrail.waysIn).toEqual([
      { id: 'plc_631_town-gate', name: 'The Town Gate' },
      { id: 'plc_631_west-gate', name: 'The West Gate' },
    ]);
    expect(view.town.exits.find((e) => e.id === 'loc_231').waysIn).toEqual([]);
  });
});
