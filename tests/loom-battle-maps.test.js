'use strict';

/**
 * The battle-map layer (planning/the-loom-layered-worlds.md §9; L-351 / #400):
 * arriving at a place with a map lands on it, moving on the grid (to a cell,
 * a feature, an exit), leaving by an exit (out to the town, or onto another
 * map), what the narrator and the interpreter are told, new games, and
 * grading with generic maps. Played through the Loom's callables on a Nisia
 * world in the Firestore emulator (Gemini mocked), plus pure tests.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-battle-maps --verbose"
 */

const PROJECT = 'demo-loom-battle-maps';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { layOutTowns, mapPlaces, offMap, GATEWAY } = require('./helpers/towns');
const { loomCreateSave, loomPlayTurn, loomGetMap } = require('../functions/index');
const { OUT_OF_MOVEMENT } = require('../functions/loom-turn/steps');

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
const maps = require('../functions/loom-canon/maps');
const grading = require('../functions/loom-canon/grading');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { validateSave } = require('../functions/loom-models');

const db = getFirestore();
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };
const WORLD = 'nisia-b0b0b0';
const worldRef = db.collection('loom_worlds').doc(WORLD);
const WRITTEN = { description: 'mcp' };

// Burdendal (loc_1): a gate, a market and a tavern. The tavern, the Gull &
// Anchor, has its own map, with stairs down to a cellar map; the market has a
// generic market-stall map; the gate the helpers' generic gateway (every open
// place needs a map, L-622).
const PLACES = {
  plc_1_gate: {
    name: 'The North Gate',
    kind: 'gate',
    entrance: { via: ['road', 'trail'] },
    connections: ['plc_1_market', 'plc_1_tavern'],
  },
  plc_1_market: {
    name: 'Market Square',
    kind: 'market',
    connections: ['plc_1_gate', 'plc_1_tavern'],
    battleMap: { mapId: 'bm_stall' },
  },
  plc_1_tavern: {
    name: 'The Gull & Anchor',
    kind: 'tavern',
    connections: ['plc_1_gate', 'plc_1_market'],
    battleMap: { mapId: 'bm_tavern' },
  },
};
const MAPS = {
  bm_tavern: {
    name: 'The Gull & Anchor, ground floor',
    width: 12,
    height: 8,
    image: null,
    entries: [
      { id: 'door', x: 1, y: 4 },
      { id: 'stair-top', x: 10, y: 6 },
    ],
    exits: [
      { id: 'front-door', name: 'the front door', x: 0, y: 4, to: 'out' },
      { id: 'cellar-stairs', name: 'the cellar stairs', x: 11, y: 7, to: { map: 'bm_cellar' } },
    ],
    features: [
      { id: 'bar', name: 'the bar', x: 3, y: 2 },
      { id: 'hearth', name: 'the hearth', x: 9, y: 1 },
    ],
    generic: null,
  },
  bm_cellar: {
    name: 'The cellar',
    width: 6,
    height: 6,
    image: null,
    entries: [{ id: 'stair-foot', x: 5, y: 5 }],
    exits: [
      {
        id: 'stairs-up',
        name: 'the stairs up',
        x: 5,
        y: 4,
        to: { map: 'bm_tavern', entry: 'stair-top' },
      },
    ],
    features: [{ id: 'casks', name: 'the casks', x: 1, y: 1 }],
    generic: null,
  },
  bm_stall: {
    name: 'A market stall',
    width: 8,
    height: 8,
    image: null,
    entries: [{ id: 'aisle', x: 4, y: 7 }],
    exits: [{ id: 'aisle-out', name: 'the aisle', x: 4, y: 7, to: 'out' }],
    features: [],
    generic: { kind: 'market', terrain: null },
  },
};

async function bump() {
  await worldRef.update({ canonVersion: (await worldRef.get()).data().canonVersion + 1 });
}

// Every turn is the move given: a target, a target list, or null (look).
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
// A step on the grid, as the grid view sends it: the callable's answer.
// (Steps are worked out without the GM and aren't recorded, L-613.)
async function stepTo(saveId, cell) {
  playerMovesTo(null);
  return loomPlayTurn.run({
    data: { worldId: WORLD, saveId, action: { verb: 'move', cell } },
    auth: PLAYER,
  });
}
const continueOn = (saveId) =>
  loomPlayTurn.run({
    data: { worldId: WORLD, saveId, action: { verb: 'continue' } },
    auth: PLAYER,
  });
const endTurn = (saveId) =>
  loomPlayTurn.run({
    data: { worldId: WORLD, saveId, action: { verb: 'end-turn' } },
    auth: PLAYER,
  });
const standAt = (saveId, placeId, mapId = null, cell = null) =>
  db.collection('loom_saves').doc(saveId).update({ location: 'loc_1', placeId, mapId, cell });
const where = async (saveId) => {
  const { location, placeId, mapId, cell } = await saveOf(saveId);
  return { location, placeId, mapId, cell };
};

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
  for (const [id, map] of Object.entries(MAPS)) {
    await worldRef
      .collection('battleMaps')
      .doc(id)
      .set({ id, sources: WRITTEN, ...map });
  }
  await worldRef.collection('characters').doc('chr_brannoch').set({
    id: 'chr_brannoch',
    name: 'Brannoch the Innkeeper',
    description: 'Keeps the Gull & Anchor.',
    locationId: 'loc_1',
    placeId: 'plc_1_tavern',
  });
  await worldRef
    .collection('locations')
    .doc('loc_1')
    .update({ description: 'Written up: Burdendal.', sources: WRITTEN });
  await layOutTowns(worldRef, 'loc_1');
  await mapPlaces(worldRef, 'places', 'plc_1_gate');
  await bump();
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
  functionsTest.cleanup();
});

describe('a visit to the Gull & Anchor', () => {
  let saveId;
  beforeAll(async () => {
    ({ saveId } = await newGame());
  });

  test('walking into a place with a map lands on it, at its entry', async () => {
    // A new game starts on the gate's map; the player walks out of it first.
    expect(await where(saveId)).toMatchObject({ placeId: 'plc_1_gate', mapId: GATEWAY.id });
    await offMap(db, saveId);
    expect(await moveTo(saveId, 'plc_1_tavern')).toMatchObject({
      outcome: 'success',
      constraints: ['You make your way to The Gull & Anchor.'],
    });
    expect(await where(saveId)).toEqual({
      location: 'loc_1',
      placeId: 'plc_1_tavern',
      mapId: 'bm_tavern',
      cell: { x: 1, y: 4 },
    });
  });

  test('loomGetMap gives the grid view the map, where the player stands, and who is there', async () => {
    const view = await loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });
    expect(view.battleMap).toEqual({
      id: 'bm_tavern',
      name: 'The Gull & Anchor, ground floor',
      width: 12,
      height: 8,
      image: null,
      here: { x: 1, y: 4 },
      host: { id: 'plc_1_tavern', name: 'The Gull & Anchor' },
      entries: [
        { id: 'door', x: 1, y: 4 },
        { id: 'stair-top', x: 10, y: 6 },
      ],
      exits: [
        { id: 'front-door', name: 'the front door', x: 0, y: 4, to: 'out' },
        {
          id: 'cellar-stairs',
          name: 'the cellar stairs',
          x: 11,
          y: 7,
          to: { map: 'bm_cellar', name: 'The cellar' },
        },
      ],
      features: [
        { id: 'bar', name: 'the bar', x: 3, y: 2 },
        { id: 'hearth', name: 'the hearth', x: 9, y: 1 },
      ],
      // Characters have no cells yet: listed, not placed.
      walls: [],
      doors: [],
      obstacles: [],
      people: [{ id: 'chr_brannoch', name: 'Brannoch the Innkeeper' }],
    });
    expect(view.town).toMatchObject({ locationId: 'loc_1', here: 'plc_1_tavern' });
  });

  test('the narrator is told where on the map, the features, and the only ways on', async () => {
    playerMovesTo(null);
    await turn(saveId);
    const message = prompts.narrate.at(-1);
    expect(message).toContain(
      'ON THE MAP OF The Gull & Anchor (The Gull & Anchor, ground floor, 12 × 8 cells): ' +
        'the player stands at (1, 4).'
    );
    expect(message).toContain('Features: the bar (3, 2); the hearth (9, 1).');
    expect(message).toContain('- the front door (0, 4): out of The Gull & Anchor');
    expect(message).toContain('- the cellar stairs (11, 7): to The cellar');
    expect(message).not.toContain('WAYS ON FROM'); // the town's ways wait until they leave
  });

  test('the interpreter knows the features and the ways out, as targets', async () => {
    playerMovesTo(null);
    await turn(saveId);
    const prompt = prompts.interpret.at(-1);
    expect(prompt).toContain('- feature:bar (feature here): the bar');
    expect(prompt).toContain('- exit:front-door (way out of here): the front door');
  });

  test('walking to a feature, typed', async () => {
    expect(await moveTo(saveId, 'feature:bar')).toMatchObject({
      outcome: 'success',
      constraints: ['You move to the bar.'],
    });
    expect((await where(saveId)).cell).toEqual({ x: 3, y: 2 });
    // The grid view follows: the player stands at the bar now.
    const view = await loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });
    expect(view.battleMap.here).toEqual({ x: 3, y: 2 });
    expect((await moveTo(saveId, 'feature:bar')).constraints).toEqual(["You're already there."]);
    expect((await moveTo(saveId, 'feature:piano')).outcome).toBe('invalid_target');
  });

  test('stepping to a cell, from the grid; nothing blocks movement, but the edges do', async () => {
    expect((await stepTo(saveId, { x: 9, y: 1 })).step).toMatchObject({
      cell: { x: 9, y: 1 },
      lines: ["You're at the hearth."],
    });
    expect((await stepTo(saveId, { x: 6, y: 5 })).step).toMatchObject({
      cell: { x: 6, y: 5 },
      lines: [],
    });
    expect((await where(saveId)).cell).toEqual({ x: 6, y: 5 });
    expect((await stepTo(saveId, { x: 12, y: 0 })).step.lines).toEqual(["That's off the map."]);
    await endTurn(saveId);
  });

  test('anywhere else waits until they have left the map', async () => {
    expect((await moveTo(saveId, 'plc_1_market')).constraints).toEqual([
      'To leave The Gull & Anchor, go out by the front door first.',
    ]);
    expect((await moveTo(saveId, 'loc_631')).outcome).toBe('blocked');
    expect((await moveTo(saveId, 'plc_1_tavern')).constraints).toEqual(["You're already there."]);
  });

  test('stairs to another map, and back up to the entry they name', async () => {
    expect(await moveTo(saveId, 'exit:cellar-stairs')).toMatchObject({
      outcome: 'success',
      constraints: ['You go by the cellar stairs to The cellar.'],
    });
    expect(await where(saveId)).toMatchObject({
      placeId: 'plc_1_tavern',
      mapId: 'bm_cellar',
      cell: { x: 5, y: 5 },
    });
    // On the cellar, the way out of the tavern is back up the stairs.
    expect((await moveTo(saveId, 'plc_1_market')).constraints).toEqual([
      'To leave The Gull & Anchor, go out by the stairs up first.',
    ]);
    // Stepping onto an exit's cell leaves by it, too.
    await stepTo(saveId, { x: 5, y: 4 });
    expect(await where(saveId)).toMatchObject({ mapId: 'bm_tavern', cell: { x: 10, y: 6 } });
  });

  test('out by the front door: back in town, at the tavern, off its map', async () => {
    expect(await moveTo(saveId, 'exit:front-door')).toMatchObject({
      outcome: 'success',
      constraints: ['You leave The Gull & Anchor by the front door.'],
    });
    expect(await where(saveId)).toEqual({
      location: 'loc_1',
      placeId: 'plc_1_tavern',
      mapId: null,
      cell: null,
    });
    const view = await loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });
    expect(view.battleMap).toBeNull();
    playerMovesTo(null);
    await turn(saveId);
    expect(prompts.narrate.at(-1)).toContain('WAYS ON FROM The Gull & Anchor, Burdendal:');
  });

  test('going to the place again steps back onto its map', async () => {
    expect(await moveTo(saveId, 'plc_1_tavern')).toMatchObject({
      outcome: 'success',
      constraints: ['You go into The Gull & Anchor.'],
    });
    expect(await where(saveId)).toMatchObject({ mapId: 'bm_tavern', cell: { x: 1, y: 4 } });
  });

  test('a generic map works like any other', async () => {
    await standAt(saveId, 'plc_1_tavern');
    await moveTo(saveId, 'plc_1_market');
    expect(await where(saveId)).toMatchObject({ mapId: 'bm_stall', cell: { x: 4, y: 7 } });
    await moveTo(saveId, 'exit:aisle-out');
    await moveTo(saveId, 'plc_1_gate');
    expect(await where(saveId)).toEqual({
      location: 'loc_1',
      placeId: 'plc_1_gate',
      mapId: GATEWAY.id,
      cell: { x: 1, y: 1 },
    });
  });
});

describe('nobody is stranded, and the turn request is checked', () => {
  test('a retired map closes its place, but a save on it can still leave by its exits', async () => {
    const { saveId } = await newGame();
    await worldRef.collection('battleMaps').doc('bm_tavern').update({ retired: true });
    await bump();
    await standAt(saveId, 'plc_1_gate');
    expect((await moveTo(saveId, 'plc_1_tavern')).constraints).toEqual([
      'The way to The Gull & Anchor is closed. Turn back.',
    ]);
    await standAt(saveId, 'plc_1_tavern', 'bm_tavern', { x: 2, y: 2 });
    await moveTo(saveId, 'exit:front-door');
    expect(await where(saveId)).toMatchObject({ mapId: null, cell: null });
    await worldRef.collection('battleMaps').doc('bm_tavern').update({ retired: false });
    await bump();
  });

  test('a grid step off a map is refused; bad cells are refused before the turn', async () => {
    const { saveId } = await newGame();
    await offMap(db, saveId);
    expect((await stepTo(saveId, { x: 1, y: 1 })).step.lines).toEqual([
      "There's no map here to move on.",
    ]);
    for (const cell of [{ x: -1, y: 0 }, { x: 0, y: 64 }, { x: 1.5, y: 2 }, null]) {
      await expect(
        loomPlayTurn.run({
          data: { worldId: WORLD, saveId, action: { verb: 'move', cell } },
          auth: PLAYER,
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    }
  });

  test('a game that starts at a place with a map starts on it', async () => {
    await worldRef
      .collection('places')
      .doc('plc_1_gate')
      .update({ battleMap: { mapId: 'bm_stall' } });
    await bump();
    const { saveId } = await newGame();
    expect(await where(saveId)).toMatchObject({
      placeId: 'plc_1_gate',
      mapId: 'bm_stall',
      cell: { x: 4, y: 7 },
    });
    // Back to its gateway (a place with no map is closed now, L-622).
    await worldRef
      .collection('places')
      .doc('plc_1_gate')
      .update({ battleMap: { mapId: GATEWAY.id } });
    await bump();
  });
});

describe('points of interest, and the rules engine (pure)', () => {
  // A settlement and a ruin linked by a trail; the ruin has a battle map.
  const world = {
    id: 'w',
    status: 'published',
    locations: {
      town: {
        id: 'town',
        name: 'Town',
        connections: ['ruin'],
        description: 'Written.',
        sources: WRITTEN,
        geo: { kind: 'settlement', links: { ruin: 'trail' } },
      },
      ruin: {
        id: 'ruin',
        name: 'The Ruin',
        connections: ['town'],
        description: 'Broken towers.',
        sources: WRITTEN,
        geo: { kind: 'poi', links: { town: 'trail' } },
        battleMap: { mapId: 'bm_ruin' },
      },
    },
    // The town needs a layout to be open (the town requirement): one gate.
    places: {
      plc_gate: {
        id: 'plc_gate',
        locationId: 'town',
        name: 'The Gate',
        description: 'A gate.',
        sources: WRITTEN,
        entrance: { via: ['trail'] },
        connections: [],
        battleMap: { mapId: GATEWAY.id }, // open places need maps (L-622)
      },
    },
    battleMaps: {
      [GATEWAY.id]: GATEWAY,
      bm_ruin: {
        id: 'bm_ruin',
        name: 'The Ruin',
        width: 10,
        height: 10,
        entries: [{ id: 'gap', x: 0, y: 5 }],
        exits: [{ id: 'gap-out', name: 'the gap in the wall', x: 0, y: 5, to: 'out' }],
        features: [],
        generic: null,
      },
      bm_walled: {
        id: 'bm_walled',
        name: 'No way out',
        width: 4,
        height: 4,
        entries: [{ id: 'in', x: 1, y: 1 }],
        exits: [],
        features: [],
        generic: null,
      },
    },
    factions: {},
    characters: {},
  };
  const move = (save, targets, params = {}) =>
    evaluate({ verb: 'move', targets, params }, {}, save, 10, world);

  test('travelling to a point of interest with a map lands on it', () => {
    const result = move({ location: 'town' }, ['ruin']);
    expect(result.outcome).toBe('success');
    expect(result.mutations).toEqual(
      expect.arrayContaining([
        { target: 'save', op: 'set-flag', path: 'location', value: 'ruin' },
        { target: 'save', op: 'set-flag', path: 'mapId', value: 'bm_ruin' },
        { target: 'save', op: 'set-flag', path: 'cell', value: { x: 0, y: 5 } },
      ])
    );
  });

  test('leaving it by its exit is back out in the world; then travel is as before', () => {
    const left = move({ location: 'ruin', mapId: 'bm_ruin', cell: { x: 4, y: 4 } }, [
      'exit:gap-out',
    ]);
    expect(left.constraints).toEqual(['You leave The Ruin by the gap in the wall.']);
    expect(move({ location: 'ruin', mapId: null }, ['town']).outcome).toBe('success');
  });

  test('a map with no exits holds nobody: the move goes ahead, off the map', () => {
    const result = move({ location: 'ruin', mapId: 'bm_walled', cell: { x: 1, y: 1 } }, ['town']);
    expect(result.outcome).toBe('success');
    // Off the walled map, and onto the town gate's (L-622).
    expect(result.mutations).toEqual(
      expect.arrayContaining([
        { target: 'save', op: 'set-flag', path: 'location', value: 'town' },
        { target: 'save', op: 'set-flag', path: 'mapId', value: GATEWAY.id },
      ])
    );
  });

  test('saves validate their place on a map', () => {
    const save = (extra) => ({
      ownerUid: 'u',
      worldId: 'w',
      name: 'n',
      character: { name: 'c', condition: 'healthy', inventory: [], abilities: [], goals: [] },
      privateFlags: {},
      relationships: {},
      recentSummary: '',
      ...extra,
    });
    expect(validateSave(save({ mapId: 'bm_ruin', cell: { x: 0, y: 5 } })).valid).toBe(true);
    expect(validateSave(save({ mapId: null, cell: null })).valid).toBe(true);
    expect(validateSave(save({ mapId: 7 })).valid).toBe(false);
    expect(validateSave(save({ cell: { x: -1, y: 0 } })).valid).toBe(false);
  });

  test('map helpers: kind, entry, edges', () => {
    expect(maps.kindOf(world, world.locations.ruin)).toBe('own');
    expect(maps.kindOf(world, world.locations.town)).toBeNull();
    expect(maps.entryCell(world.battleMaps.bm_ruin, 'nowhere')).toEqual({ x: 0, y: 5 });
    expect(maps.inBounds(world.battleMaps.bm_ruin, { x: 10, y: 0 })).toBe(false);
  });
});

describe('grading with battle maps (on in play since L-622)', () => {
  const layers = { town: null, battleMap: maps.kindOf };
  const base = () => ({
    id: 'w',
    status: 'published',
    locations: {
      ruin: {
        id: 'ruin',
        name: 'The Ruin',
        description: 'Broken towers.',
        sources: WRITTEN,
        geo: { kind: 'poi' },
      },
    },
    places: {
      plc_inn: {
        id: 'plc_inn',
        locationId: 'loc_x',
        name: 'The Inn',
        description: 'Warm.',
        sources: WRITTEN,
        npcIds: [],
        connections: [],
      },
    },
    battleMaps: {
      bm_own: {
        id: 'bm_own',
        name: 'The Ruin',
        width: 4,
        height: 4,
        generic: null,
        walls: [
          {
            points: [
              { x: 2, y: 0 },
              { x: 2, y: 3 },
            ],
          },
        ],
      },
      bm_generic: {
        id: 'bm_generic',
        name: 'An inn',
        width: 4,
        height: 4,
        generic: { kind: 'tavern' },
      },
    },
    lore: {
      l1: { id: 'l1', title: 'Towers', text: '…', entityRefs: ['ruin', 'plc_inn'] },
    },
    characters: {},
    factions: {},
  });

  test('battle maps are required in play', () => {
    expect(grading.LAYER_CHECKS.battleMap).toEqual(expect.any(Function));
    const w = base();
    expect(grading.gradeLocation(w, w.locations.ruin).grade).toBe('unbuilt');
  });

  test('no map: Unbuilt, and closed', () => {
    const w = base();
    expect(grading.gradeLocation(w, w.locations.ruin, { layers })).toEqual({
      grade: 'unbuilt',
      checklist: [{ need: 'battleMap', for: 'playable', message: 'It has no battle map.' }],
    });
    expect(grading.gradePlace(w, w.places.plc_inn, { layers }).grade).toBe('unbuilt');
  });

  test('a generic map: Playable, but short of Rich', () => {
    const w = base();
    w.locations.ruin.battleMap = { mapId: 'bm_generic' };
    w.places.plc_inn.battleMap = { mapId: 'bm_generic' };
    const generic = { need: 'battleMap', for: 'rich', message: 'It uses a generic battle map.' };
    expect(grading.gradeLocation(w, w.locations.ruin, { layers })).toEqual({
      grade: 'playable',
      checklist: [generic],
    });
    expect(grading.gradePlace(w, w.places.plc_inn, { layers })).toEqual({
      grade: 'playable',
      checklist: [generic],
    });
  });

  test('its own map: Rich, with the rest of the bar met; a retired map counts as none', () => {
    const w = base();
    w.locations.ruin.battleMap = { mapId: 'bm_own' };
    expect(grading.gradeLocation(w, w.locations.ruin, { layers }).grade).toBe('rich');
    // Its own map needs walls, doors or obstacles (L-628).
    w.battleMaps.bm_own = { ...w.battleMaps.bm_own, walls: [] };
    expect(grading.gradeLocation(w, w.locations.ruin, { layers }).checklist).toEqual([
      { need: 'layers', for: 'rich', message: 'Its battle map has no walls or obstacles.' },
    ]);
    w.battleMaps.bm_own.retired = true;
    expect(grading.gradeLocation(w, w.locations.ruin, { layers }).grade).toBe('unbuilt');
  });
});

describe('moving without the GM (L-613)', () => {
  let saveId;
  beforeEach(async () => {
    ({ saveId } = await newGame());
    await standAt(saveId, 'plc_1_tavern', 'bm_tavern', { x: 1, y: 4 });
    mockCallGemini.mockReset();
    mockCallGemini.mockImplementation(async () => {
      throw new Error('Gemini was called');
    });
  });
  const turnOf = async () => (await saveOf(saveId)).turn;
  const recorded = async () =>
    (await db.collection('loom_saves').doc(saveId).collection('loom_turns').get()).size;

  test('a move in reach: walked, movement spent, nothing narrated or recorded', async () => {
    const before = await recorded();
    const answer = await stepTo(saveId, { x: 9, y: 1 });
    expect(answer).toEqual({
      narration: "You're at the hearth.",
      stateSummary: '',
      suggestedActions: [],
      step: {
        cell: { x: 9, y: 1 },
        movementLeft: 12,
        plan: null,
        lines: ["You're at the hearth."],
      },
    });
    expect(await where(saveId)).toMatchObject({ mapId: 'bm_tavern', cell: { x: 9, y: 1 } });
    expect(await turnOf()).toEqual({ n: 1, movementLeft: 12, actionUsed: false, plan: null });
    expect(await recorded()).toBe(before);
    expect(mockCallGemini).not.toHaveBeenCalled();
  });

  test('a move past reach stops partway and keeps the rest as the plan', async () => {
    await db
      .collection('loom_saves')
      .doc(saveId)
      .update({ turn: { n: 1, movementLeft: 3, actionUsed: false, plan: null } });
    const { step } = await stepTo(saveId, { x: 9, y: 4 });
    expect(step.cell).toEqual({ x: 4, y: 4 });
    expect(step.movementLeft).toBe(0);
    expect(step.lines).toEqual(["You're out of movement. End your turn to go on."]);
    expect(step.plan).toMatchObject({ layer: 'battleMap', mapId: 'bm_tavern', to: { x: 9, y: 4 } });
    expect(step.plan.path.map((s) => [s.x, s.cost])).toEqual([
      [5, 1],
      [6, 2],
      [7, 3],
      [8, 4],
      [9, 5],
    ]);
    // With no movement left, a move goes nowhere but is planned.
    const again = await stepTo(saveId, { x: 4, y: 1 });
    expect(again.step).toMatchObject({ cell: { x: 4, y: 4 }, movementLeft: 0 });
    expect(again.step.plan.to).toEqual({ x: 4, y: 1 });
    expect(mockCallGemini).not.toHaveBeenCalled();
  });

  test('Continue next turn walks the plan; End turn says how far you went', async () => {
    // A character with a speed of 4: the hearth (8 away) takes two turns.
    await db
      .collection('loom_saves')
      .doc(saveId)
      .update({
        'character.speed': 4,
        turn: { n: 1, movementLeft: 4, actionUsed: false, plan: null },
      });
    await stepTo(saveId, { x: 9, y: 1 });
    expect((await continueOn(saveId)).step.lines).toEqual([OUT_OF_MOVEMENT]);
    expect((await endTurn(saveId)).narration).toBe('Turn 1 ends. You moved 4 squares.');
    const { step } = await continueOn(saveId);
    expect(step).toMatchObject({ cell: { x: 9, y: 1 }, movementLeft: 0, plan: null });
    expect(step.lines).toEqual(["You're at the hearth."]);
    expect((await endTurn(saveId)).narration).toBe(
      'Turn 2 ends. You moved 4 squares, to the hearth.'
    );
    expect(await turnOf()).toEqual({ n: 3, movementLeft: 4, actionUsed: false, plan: null });
    expect((await continueOn(saveId)).step.lines).toEqual([
      'You have no way planned. Tap where to go.',
    ]);
    expect(mockCallGemini).not.toHaveBeenCalled();
  });

  test('loomGetMap shows the plan only while it is for the map you stand on', async () => {
    await db
      .collection('loom_saves')
      .doc(saveId)
      .update({ turn: { n: 1, movementLeft: 1, actionUsed: false, plan: null } });
    await stepTo(saveId, { x: 6, y: 4 });
    const view = await loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });
    expect(view.turn).toMatchObject({ movementLeft: 0, plan: { to: { x: 6, y: 4 } } });
    await standAt(saveId, 'plc_1_tavern', 'bm_cellar', { x: 5, y: 5 });
    const elsewhere = await loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });
    expect(elsewhere.turn.plan).toBeNull();
  });

  test('a path that reaches an exit leaves by it, narrated, with the movement spent', async () => {
    playerMovesTo(null);
    const answer = await stepTo(saveId, { x: 11, y: 7 });
    expect(answer.step).toBeUndefined();
    expect(answer.narration).toBe('You go on.');
    expect(await where(saveId)).toMatchObject({ mapId: 'bm_cellar', cell: { x: 5, y: 5 } });
    expect((await turnOf()).movementLeft).toBe(10);
    expect(await lastResolution(saveId)).toMatchObject({
      outcome: 'success',
      constraints: ['You go by the cellar stairs to The cellar.'],
    });
  });

  test('an exit is never on the way somewhere else', async () => {
    // Past the front door's square (0, 4), one square at a time: around it.
    await standAt(saveId, 'plc_1_tavern', 'bm_tavern', { x: 0, y: 3 });
    await db
      .collection('loom_saves')
      .doc(saveId)
      .update({ turn: { n: 1, movementLeft: 1, actionUsed: false, plan: null } });
    const { step } = await stepTo(saveId, { x: 0, y: 5 });
    expect(step.cell).toEqual({ x: 1, y: 4 });
    expect(await where(saveId)).toMatchObject({ mapId: 'bm_tavern', cell: { x: 1, y: 4 } });
  });

  test('two moves at once cannot spend the same movement', async () => {
    await db
      .collection('loom_saves')
      .doc(saveId)
      .update({ turn: { n: 1, movementLeft: 6, actionUsed: false, plan: null } });
    const [a, b] = await Promise.all([
      stepTo(saveId, { x: 6, y: 4 }),
      stepTo(saveId, { x: 1, y: 0 }),
    ]);
    // The moves cost 5 and 4. Whichever went first, the other had only what
    // was left (1 or 2) and stopped partway: all 6 spent, never 9.
    expect((await turnOf()).movementLeft).toBe(0);
    const stopped = [a, b].filter((r) => r.step.lines[0] === OUT_OF_MOVEMENT);
    expect(stopped).toHaveLength(1);
  });
});

describe('typed actions and the turn (L-614)', () => {
  let saveId;
  const calls = { interpret: 0, narrate: 0 };
  // The player types something INTERPRET reads as `verb` (a move to `target`).
  function playerTypes(verb, target) {
    mockCallGemini.mockReset();
    mockCallGemini.mockImplementation(async (options) => {
      if (options.systemInstruction.includes('INTERPRET stage')) {
        calls.interpret += 1;
        return { verb, targets: target ? [target] : [], params: {} };
      }
      if (options.systemInstruction.includes('summarizer')) return 'A summary.';
      calls.narrate += 1;
      prompts.narrate.push(options.userMessage);
      return { narration: 'You go on.', inventedEntities: [], suggestedActions: ['Look around'] };
    });
  }
  const type = (text) =>
    loomPlayTurn.run({ data: { worldId: WORLD, saveId, actionText: text }, auth: PLAYER });
  const turnOf = async () => (await saveOf(saveId)).turn;
  const recorded = async () =>
    (await db.collection('loom_saves').doc(saveId).collection('loom_turns').get()).size;

  beforeEach(async () => {
    ({ saveId } = await newGame());
    await standAt(saveId, 'plc_1_tavern', 'bm_tavern', { x: 1, y: 4 });
    calls.interpret = 0;
    calls.narrate = 0;
  });

  test('acting uses the action; a second action is turned down plainly', async () => {
    playerTypes('talk', 'chr_brannoch');
    expect((await type('ask about rooms')).narration).toBe('You go on.');
    expect((await turnOf()).actionUsed).toBe(true);
    const before = await recorded();
    expect(await type('ask about the cellar')).toEqual({
      narration: "You've acted this turn. End your turn first.",
      stateSummary: '',
      suggestedActions: [],
      refused: true,
    });
    expect(calls).toEqual({ interpret: 2, narrate: 1 }); // read, but not narrated
    expect(await recorded()).toBe(before); // nor recorded
  });

  test('after acting, moving still works, and End turn gives the action back', async () => {
    playerTypes('search');
    await type('search the floor');
    playerTypes('move', 'feature:bar');
    expect((await type('go to the bar')).narration).toBe('You go on.');
    expect(await where(saveId)).toMatchObject({ cell: { x: 3, y: 2 } });
    expect(await turnOf()).toMatchObject({ actionUsed: true, movementLeft: 18 });
    await endTurn(saveId);
    playerTypes('search');
    await type('search the bar');
    expect(await turnOf()).toMatchObject({ n: 2, actionUsed: true });
    expect(calls.narrate).toBe(3); // the search, the walk, and the next turn's search
  });

  test('a typed move follows the path and spends movement, like a tap', async () => {
    playerTypes('move', 'feature:hearth');
    await type('go to the hearth');
    expect(await lastResolution(saveId)).toMatchObject({
      outcome: 'success',
      constraints: ['You move to the hearth.'],
    });
    expect(await where(saveId)).toMatchObject({ cell: { x: 9, y: 1 } });
    expect(await turnOf()).toEqual({ n: 1, movementLeft: 12, actionUsed: false, plan: null });
  });

  test('past reach, a typed move heads that way and keeps the plan', async () => {
    await db
      .collection('loom_saves')
      .doc(saveId)
      .update({ turn: { n: 1, movementLeft: 3, actionUsed: false, plan: null } });
    playerTypes('move', 'feature:hearth');
    await type('go to the hearth');
    expect((await lastResolution(saveId)).constraints).toEqual([
      'You head for the hearth.',
      OUT_OF_MOVEMENT,
    ]);
    const turn = await turnOf();
    expect(turn.movementLeft).toBe(0);
    expect(turn.plan).toMatchObject({ mapId: 'bm_tavern', to: { x: 9, y: 1 } });
  });

  test('a typed exit beyond reach is headed for; next turn, Continue leaves by it', async () => {
    await db
      .collection('loom_saves')
      .doc(saveId)
      .update({ turn: { n: 1, movementLeft: 4, actionUsed: false, plan: null } });
    playerTypes('move', 'exit:cellar-stairs');
    await type('take the cellar stairs');
    expect((await lastResolution(saveId)).constraints[0]).toBe('You head for the cellar stairs.');
    expect(await where(saveId)).toMatchObject({ mapId: 'bm_tavern' });
    await endTurn(saveId);
    playerTypes('look');
    await continueOn(saveId);
    expect(await where(saveId)).toMatchObject({ mapId: 'bm_cellar', cell: { x: 5, y: 5 } });
  });

  test('the narrator is told the turn: movement left, and whether they have acted', async () => {
    playerTypes('move', 'feature:bar');
    await type('go to the bar');
    expect(prompts.narrate.at(-1)).toContain(
      "Turn 1. Movement left: 18 of 20. The player hasn't acted yet this turn."
    );
    playerTypes('talk', 'chr_brannoch');
    await type('hail the innkeeper');
    expect(prompts.narrate.at(-1)).toContain('The player has used their action this turn.');
  });

  test('standing on an exit, leaving by it costs nothing', async () => {
    await standAt(saveId, 'plc_1_market', 'bm_stall', { x: 4, y: 7 });
    playerTypes('move', 'exit:aisle-out');
    await type('leave the stall');
    expect(await where(saveId)).toMatchObject({ placeId: 'plc_1_market', mapId: null });
    expect((await turnOf()).movementLeft).toBe(20);
  });
});

describe('walls and doors on the way (L-624)', () => {
  // The tavern gains a wall at x = 6 with the kitchen door in its gap at
  // y 3–4: the hearth (9, 1) is through it.
  const WALL = {
    walls: [
      {
        points: [
          { x: 6, y: 0 },
          { x: 6, y: 3 },
        ],
      },
      {
        points: [
          { x: 6, y: 4 },
          { x: 6, y: 8 },
        ],
      },
    ],
    doors: [
      { id: 'kitchen-door', name: 'the kitchen door', from: { x: 6, y: 3 }, to: { x: 6, y: 4 } },
    ],
  };
  const tavernRef = () => worldRef.collection('battleMaps').doc('bm_tavern');
  let saveId;
  beforeAll(async () => {
    await tavernRef().update(WALL);
    await bump();
  });
  afterAll(async () => {
    await tavernRef().update({ walls: [], doors: [] });
    await bump();
  });
  beforeEach(async () => {
    ({ saveId } = await newGame());
    await standAt(saveId, 'plc_1_tavern', 'bm_tavern', { x: 1, y: 4 });
    mockCallGemini.mockReset();
    playerMovesTo(null);
  });

  test('a step through the closed door opens it, stops there, and the save remembers', async () => {
    const { step } = await stepTo(saveId, { x: 9, y: 1 });
    expect(step.lines).toEqual(['You open the kitchen door.']);
    expect(step.cell.x).toBe(5); // stopped before the door
    expect(step.plan).toMatchObject({ to: { x: 9, y: 1 } });
    const save = await saveOf(saveId);
    expect(save.doors).toEqual({ bm_tavern: { 'kitchen-door': 'open' } });
    // 4 squares to the door, and 1 to open it.
    expect(save.turn.movementLeft).toBe(15);
    const view = await loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });
    expect(view.battleMap.doors).toEqual([
      {
        id: 'kitchen-door',
        name: 'the kitchen door',
        from: { x: 6, y: 3 },
        to: { x: 6, y: 4 },
        state: 'open',
      },
    ]);
    expect(view.battleMap.walls).toEqual(WALL.walls);
  });

  test('Continue goes on through the open door', async () => {
    await stepTo(saveId, { x: 9, y: 1 });
    const { step } = await continueOn(saveId);
    expect(step.cell).toEqual({ x: 9, y: 1 });
    expect(step.lines).toEqual(["You're at the hearth."]);
  });

  test('another save finds the door shut', async () => {
    await stepTo(saveId, { x: 9, y: 1 });
    const other = (await newGame()).saveId;
    await standAt(other, 'plc_1_tavern', 'bm_tavern', { x: 1, y: 4 });
    expect((await stepTo(other, { x: 9, y: 1 })).step.lines).toEqual([
      'You open the kitchen door.',
    ]);
    expect((await saveOf(other)).doors).toEqual({ bm_tavern: { 'kitchen-door': 'open' } });
  });

  test('a typed move opens it too, and says so', async () => {
    playerMovesTo('feature:hearth');
    await turn(saveId);
    expect((await lastResolution(saveId)).constraints).toEqual([
      'You head for the hearth.',
      'You open the kitchen door.',
    ]);
    expect((await saveOf(saveId)).doors).toEqual({ bm_tavern: { 'kitchen-door': 'open' } });
  });

  const tapDoor = (id, open, door = 'kitchen-door') =>
    loomPlayTurn.run({
      data: { worldId: WORLD, saveId: id, action: { verb: 'door', door, open } },
      auth: PLAYER,
    });

  test('a tap beside the door opens it (1 movement); the way through is then clear', async () => {
    await standAt(saveId, 'plc_1_tavern', 'bm_tavern', { x: 5, y: 3 });
    const { step } = await tapDoor(saveId, true);
    expect(step).toMatchObject({ movementLeft: 19, lines: ['You open the kitchen door.'] });
    expect((await saveOf(saveId)).doors).toEqual({ bm_tavern: { 'kitchen-door': 'open' } });
    expect((await stepTo(saveId, { x: 9, y: 1 })).step.lines).toEqual(["You're at the hearth."]);
  });

  test('a tap closes it again; a path through stops there once more', async () => {
    await standAt(saveId, 'plc_1_tavern', 'bm_tavern', { x: 5, y: 3 });
    await tapDoor(saveId, true);
    expect((await tapDoor(saveId, false)).step.lines).toEqual(['You close the kitchen door.']);
    expect((await saveOf(saveId)).doors).toEqual({ bm_tavern: { 'kitchen-door': 'closed' } });
    expect((await stepTo(saveId, { x: 9, y: 1 })).step.lines).toEqual([
      'You open the kitchen door.',
    ]);
  });

  test('a door is opened only from beside it, and only in this save', async () => {
    expect((await tapDoor(saveId, true)).step.lines).toEqual([
      'You need to be beside the kitchen door.',
    ]);
    await standAt(saveId, 'plc_1_tavern', 'bm_tavern', { x: 6, y: 3 });
    await tapDoor(saveId, true);
    const other = (await newGame()).saveId;
    await standAt(other, 'plc_1_tavern', 'bm_tavern', { x: 5, y: 3 });
    expect((await tapDoor(other, false)).step.lines).toEqual(['The kitchen door is already shut.']);
    expect((await tapDoor(saveId, true, 'vault')).step.lines).toEqual([
      "There's no such door here.",
    ]);
  });

  test('a door action is checked before the turn', async () => {
    for (const action of [
      { verb: 'door', door: 'kitchen-door' },
      { verb: 'door', door: 'Kitchen Door', open: true },
      { verb: 'door', open: true },
    ]) {
      await expect(
        loomPlayTurn.run({ data: { worldId: WORLD, saveId, action }, auth: PLAYER })
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    }
  });

  test('the wall is never walked through: no door, no way', async () => {
    await tavernRef().update({
      doors: [],
      walls: [
        {
          points: [
            { x: 6, y: 0 },
            { x: 6, y: 8 },
          ],
        },
      ],
    });
    await bump();
    expect((await stepTo(saveId, { x: 9, y: 1 })).step.lines).toEqual([
      "There's no way there from here.",
    ]);
    await tavernRef().update(WALL);
    await bump();
  });
});

describe('locked doors (L-626)', () => {
  // The kitchen door, locked: the pantry key opens it.
  const LOCKED = {
    walls: [
      {
        points: [
          { x: 6, y: 0 },
          { x: 6, y: 3 },
        ],
      },
      {
        points: [
          { x: 6, y: 4 },
          { x: 6, y: 8 },
        ],
      },
    ],
    doors: [
      {
        id: 'kitchen-door',
        name: 'the kitchen door',
        from: { x: 6, y: 3 },
        to: { x: 6, y: 4 },
        locked: true,
        key: 'the pantry key',
      },
    ],
  };
  const tavernRef = () => worldRef.collection('battleMaps').doc('bm_tavern');
  const tap = (id) =>
    loomPlayTurn.run({
      data: {
        worldId: WORLD,
        saveId: id,
        action: { verb: 'door', door: 'kitchen-door', open: true },
      },
      auth: PLAYER,
    });
  const besideTheDoor = async (inventory) => {
    const { saveId } = await newGame();
    await standAt(saveId, 'plc_1_tavern', 'bm_tavern', { x: 5, y: 3 });
    await db.collection('loom_saves').doc(saveId).update({ 'character.inventory': inventory });
    return saveId;
  };
  beforeAll(async () => {
    await tavernRef().update(LOCKED);
    await bump();
  });
  afterAll(async () => {
    await tavernRef().update({ walls: [], doors: [] });
    await bump();
  });
  beforeEach(() => {
    mockCallGemini.mockReset();
    playerMovesTo(null);
  });

  test('the key opens it, for this save only; without it, it stays locked and blocks the way', async () => {
    const withKey = await besideTheDoor(['pantry key']);
    expect((await tap(withKey)).step.lines).toEqual([
      'You unlock the kitchen door with the pantry key and open it.',
    ]);
    expect((await saveOf(withKey)).doors).toEqual({ bm_tavern: { 'kitchen-door': 'open' } });
    const without = await besideTheDoor([]);
    expect((await tap(without)).step.lines).toEqual(['The kitchen door is locked.']);
    expect((await stepTo(without, { x: 9, y: 1 })).step.lines).toEqual([
      "There's no way there from here.",
    ]);
  });

  test('a typed attempt targets the door, and the GM is told the doors as they stand', async () => {
    const saveId = await besideTheDoor(['pantry key']);
    mockCallGemini.mockImplementation(async (options) => {
      if (options.systemInstruction.includes('INTERPRET stage')) {
        prompts.interpret.push(options.systemInstruction);
        return { verb: 'unlock', targets: ['door:kitchen-door'], params: {} };
      }
      prompts.narrate.push(options.userMessage);
      return { narration: 'The key turns.', inventedEntities: [], suggestedActions: [] };
    });
    await loomPlayTurn.run({
      data: { worldId: WORLD, saveId, actionText: 'unlock the kitchen door' },
      auth: PLAYER,
    });
    expect(prompts.interpret.at(-1)).toContain('- door:kitchen-door (door here): the kitchen door');
    expect(await lastResolution(saveId)).toMatchObject({
      outcome: 'success',
      constraints: ['You unlock the kitchen door with the pantry key and open it.'],
    });
    expect(prompts.narrate.at(-1)).toContain('Doors: the kitchen door (open).');
    expect((await saveOf(saveId)).turn.actionUsed).toBe(true);
  });
});
