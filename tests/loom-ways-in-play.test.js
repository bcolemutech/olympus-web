'use strict';

/**
 * Visits and the way in, in play (planning/journeys-and-arrivals.md §4.1,
 * §4.2; L-381 / #700), through the Loom's callables on a Nisia world in the
 * Firestore emulator (Gemini mocked). Burdendal has ground: a south gate (where
 * a new game begins), a north gate and a harbour. A new game knows only its
 * gate; leaving by sea with no harbour known is refused; walking into sight of
 * the north gate finds it. Setting out for Dunsmouth by trail arrives by its
 * west gate, the one facing Burdendal, knowing no other, and the save has
 * visited both. Coming back to either lands on its town map at the way in,
 * off the way in's battle map (L-382 / #701). A journey of three legs from
 * Dunscombe through Burdendal and Dunsmouth to Swateston is one move (L-384 /
 * #703).
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-ways-in-play --verbose"
 */

const PROJECT = 'demo-loom-ways-in-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { GATEWAY } = require('./helpers/towns');
const { loomCreateSave, loomPlayTurn, loomGetMap } = require('../functions/index');

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
const WORLD = 'nisia-w4y51n';
const worldRef = db.collection('loom_worlds').doc(WORLD);
const WRITTEN = { description: 'mcp' };

const pt = (x, y) => ({ x, y });
const rect = (x0, y0, x1, y1) => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)];
const GROUND = { buildings: [{ name: 'the market hall', points: rect(400, 600, 600, 700) }] };

const place = (locationId, id, name, position, via) => ({
  id,
  locationId,
  name,
  kind: via ? 'gate' : 'district',
  description: `${name}, as the locals know it.`,
  sources: WRITTEN,
  connections: [],
  npcIds: [],
  rules: {},
  entrance: via ? { via } : null,
  position,
  battleMap: { mapId: GATEWAY.id },
});
// Burdendal (loc_1); Dunsmouth (loc_631) lies south-east of it by trail,
// Wisin (loc_229) by sea.
const PLACES = [
  place('loc_1', 'plc_1_gate', 'The South Gate', pt(500, 950), ['road', 'trail']),
  place('loc_1', 'plc_1_harbour', 'The Harbour', pt(950, 900), ['sea']),
  place('loc_1', 'plc_1_north', 'The North Gate', pt(500, 50), ['road', 'trail']),
  place('loc_631', 'plc_631_east', 'The East Gate', pt(950, 500), ['road', 'trail']),
  place('loc_631', 'plc_631_west', 'The West Gate', pt(50, 500), ['road', 'trail']),
  place('loc_229', 'plc_229_quay', 'The Quay', pt(500, 950), ['sea']),
  // For a journey (L-384): Dunscombe (loc_120), by sea from Burdendal, and
  // Swateston (loc_184), by trail beyond Dunsmouth.
  place('loc_120', 'plc_120_quay', 'The Quay', pt(500, 950), ['sea']),
  place('loc_184', 'plc_184_gate', 'The Gate', pt(50, 500), ['road', 'trail']),
];

function narrator() {
  mockCallGemini.mockImplementation(async (options) => {
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return { verb: 'look', targets: [], params: {} };
    }
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    return { narration: 'You go on.', inventedEntities: [], suggestedActions: [] };
  });
}

const play = (saveId, action) =>
  loomPlayTurn.run({ data: { worldId: WORLD, saveId, action }, auth: PLAYER });
const mapOf = (saveId) => loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });
const saveOf = async (saveId) => (await db.collection('loom_saves').doc(saveId).get()).data();
const townPlaces = async (saveId) => (await mapOf(saveId)).town.places.map((p) => p.id).sort();
async function newGame() {
  const { saveId } = await loomCreateSave.run({
    data: { worldId: WORLD, name: 'Ways', characterName: 'Tam' },
    auth: PLAYER,
  });
  return saveId;
}
// Off the gate's map (its entry is its way out), standing at the gate.
const stepOffMap = (saveId) => play(saveId, { verb: 'move', cell: { x: 1, y: 1 } });

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
  for (const doc of PLACES) await worldRef.collection('places').doc(doc.id).set(doc);
  for (const [id, text] of [
    ['loc_1', 'A great walled port.'],
    ['loc_631', 'A market town.'],
    ['loc_229', 'A fishing village.'],
    ['loc_120', 'A harbour town.'],
    ['loc_184', 'A hill town.'],
  ]) {
    await worldRef
      .collection('locations')
      .doc(id)
      .update({ description: text, 'sources.description': 'mcp', 'town.ground': GROUND });
  }
  await worldRef.update({ canonVersion: 3 });
  narrator();
}, 60000);

afterAll(async () => {
  await functionsTest.cleanup();
});

describe('a new game knows only the gate it begins at', () => {
  let saveId;
  beforeAll(async () => {
    saveId = await newGame();
    await stepOffMap(saveId);
  });

  test('the save has visited Burdendal and knows its south gate; the town view shows no other', async () => {
    expect(await saveOf(saveId)).toMatchObject({
      visited: ['loc_1'],
      waysKnown: { loc_1: ['plc_1_gate'] },
    });
    expect(await townPlaces(saveId)).toEqual(['plc_1_gate']);
  });

  test('leaving by sea with no harbour known is refused', async () => {
    const answer = await play(saveId, { verb: 'move', target: 'loc_229' });
    expect(answer.narration).toBe('You know no way out of Burdendal by sea. Explore to find one.');
    expect((await saveOf(saveId)).location).toBe('loc_1');
  });

  test('walking into sight of the north gate finds it', async () => {
    await db
      .collection('loom_saves')
      .doc(saveId)
      .update({ placeId: null, mapId: null, cell: null, townPoint: pt(500, 130) });
    await play(saveId, { verb: 'move', point: pt(500, 80) });
    expect(await townPlaces(saveId)).toEqual(['plc_1_gate', 'plc_1_north']);
  });
});

describe('arriving somewhere new by the way in facing where you came from', () => {
  let saveId;
  beforeAll(async () => {
    saveId = await newGame();
    await stepOffMap(saveId);
    await play(saveId, { verb: 'move', target: 'loc_631' });
  });

  test('Dunsmouth is reached by its west gate, which faces Burdendal', async () => {
    expect(await saveOf(saveId)).toMatchObject({
      location: 'loc_631',
      placeId: 'plc_631_west',
      visited: ['loc_1', 'loc_631'],
      waysKnown: { loc_1: ['plc_1_gate'], loc_631: ['plc_631_west'] },
    });
  });

  test('its town view shows only the way you came by', async () => {
    await stepOffMap(saveId);
    expect(await townPlaces(saveId)).toEqual(['plc_631_west']);
  });
});

describe('a save from before L-381', () => {
  test('its next turn takes it to have visited where it was, knowing every way there', async () => {
    const saveId = await newGame();
    // As it was before L-381: no visits, no ways known.
    const data = await saveOf(saveId);
    delete data.visited;
    delete data.waysKnown;
    await db.collection('loom_saves').doc(saveId).set(data);
    // Before its next turn, it knows every way, as it did.
    expect(await townPlaces(saveId)).toEqual(['plc_1_gate', 'plc_1_harbour', 'plc_1_north']);
    await stepOffMap(saveId);
    expect(await saveOf(saveId)).toMatchObject({
      visited: ['loc_1'],
      waysKnown: { loc_1: 'all' },
    });
    expect(await townPlaces(saveId)).toEqual(['plc_1_gate', 'plc_1_harbour', 'plc_1_north']);
  });
});

describe('coming back lands on the town map (L-382)', () => {
  let saveId;
  beforeAll(async () => {
    saveId = await newGame();
    await stepOffMap(saveId);
    // To Dunsmouth: a first visit, on its west gate's map.
    await play(saveId, { verb: 'move', target: 'loc_631' });
  });

  test("a first visit lands on the way in's battle map", async () => {
    expect(await saveOf(saveId)).toMatchObject({
      location: 'loc_631',
      placeId: 'plc_631_west',
      mapId: GATEWAY.id,
    });
  });

  test('back to Burdendal, and on to Dunsmouth again: each lands in town, off the map', async () => {
    await stepOffMap(saveId);
    await play(saveId, { verb: 'move', target: 'loc_1' });
    expect(await saveOf(saveId)).toMatchObject({
      location: 'loc_1',
      placeId: 'plc_1_gate',
      mapId: null,
      cell: null,
    });
    await play(saveId, { verb: 'move', target: 'loc_631' });
    expect(await saveOf(saveId)).toMatchObject({
      location: 'loc_631',
      placeId: 'plc_631_west',
      mapId: null,
    });
    // What was found there the first time is known still.
    expect(await townPlaces(saveId)).toEqual(['plc_631_west']);
    const map = await mapOf(saveId);
    expect(map.battleMap).toBeFalsy();
    expect(map.town.here).toBe('plc_631_west');
  });
});

describe('a journey of three legs, through towns visited (L-384)', () => {
  let saveId;
  beforeAll(async () => {
    saveId = await newGame();
    // At Dunscombe's quay, having been to all four.
    await db
      .collection('loom_saves')
      .doc(saveId)
      .update({
        location: 'loc_120',
        placeId: 'plc_120_quay',
        mapId: null,
        cell: null,
        visited: ['loc_1', 'loc_631', 'loc_184', 'loc_120'],
        waysKnown: { loc_120: ['plc_120_quay'] },
        discovered: ['loc_1', 'loc_631', 'loc_184', 'loc_120'],
      });
  });

  test('the world map offers the journey to Swateston, with its time and the towns passed', async () => {
    const swateston = (await mapOf(saveId)).places.find((p) => p.id === 'loc_184');
    expect(swateston.journey).toMatchObject({
      through: ['Burdendal', 'Dunsmouth'],
      vias: ['sea', 'trail'],
    });
  });

  test('one move: by sea and trail, through Burdendal and Dunsmouth, landing on the town map', async () => {
    await play(saveId, { verb: 'move', target: 'loc_184' });
    const save = await saveOf(saveId);
    expect(save).toMatchObject({
      location: 'loc_184',
      placeId: 'plc_184_gate',
      mapId: null,
    });
    const turns = await db
      .collection('loom_saves')
      .doc(saveId)
      .collection('loom_turns')
      .orderBy('index', 'desc')
      .limit(1)
      .get();
    const { constraints, journey } = turns.docs[0].data().resolution;
    expect(constraints[constraints.length - 1]).toMatch(
      /^You journey about \d+½? days by sea and trail, through Burdendal and Dunsmouth, and arrive at Swateston, at The Gate\.$/
    );
    expect(journey.stops).toEqual(['loc_120', 'loc_1', 'loc_631', 'loc_184']);
    // Days on the way.
    expect(save.time - 8 * 3600).toBeGreaterThan(2 * 24 * 3600);
    // Crossing Burdendal and Dunsmouth found the ways used there.
    expect(save.waysKnown.loc_1).toEqual(['plc_1_harbour', 'plc_1_gate']);
    expect(save.waysKnown.loc_631).toEqual(['plc_631_west', 'plc_631_east']);
  });
});
