'use strict';

/**
 * Ways in for particular places (planning/builders-tools.md §4.5; L-395 /
 * #741): Helsterton's West Gate serves the trail only to and from Poncewen;
 * the East Gate serves every trail. Arriving from Poncewen uses the West
 * Gate though Poncewen lies to the north-east; arriving from Brorough, to
 * the west, uses the East Gate. Leaving for Brorough from the West Gate
 * walks to the East Gate first; the town checks see a trail no way serves.
 * Pure, then through loomPlayTurn with Gemini stubbed.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-ways-to --verbose"
 */

const PROJECT = 'demo-loom-ways-to';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const mockWorld = (() => {
  const settlement = (id, name, x, y, links) => ({
    id,
    name,
    description: name + ', a town on the moor.',
    geo: { kind: 'settlement', x, y, links },
    connections: Object.keys(links),
    factionIds: [],
    npcIds: [],
    rules: {},
  });
  const gate = (id, name, x, entrance, connections) => ({
    id,
    locationId: 'helsterton',
    name,
    kind: 'gate',
    description: name + ', a gap in the town wall.',
    connections,
    entrance,
    npcIds: [],
    rules: {},
    position: { x, y: 500 },
    battleMap: { mapId: 'bm_test-gateway' },
  });
  // As in Nisia: Poncewen north-east, Horningtle east, Brorough west.
  return {
    id: 'helsterton-test',
    name: 'Helsterton',
    locations: {
      helsterton: settlement('helsterton', 'Helsterton', 196.66, 654.24, {
        poncewen: 'trail',
        horningtle: 'trail',
        brorough: 'trail',
      }),
      poncewen: settlement('poncewen', 'Poncewen', 202.46, 645.45, { helsterton: 'trail' }),
      horningtle: settlement('horningtle', 'Horningtle', 239.19, 676.41, {
        helsterton: 'trail',
      }),
      brorough: settlement('brorough', 'Brorough', 152.8, 632.7, { helsterton: 'trail' }),
    },
    places: {
      west: gate('west', 'The West Gate', 40, { via: ['trail'], to: ['poncewen'] }, ['east']),
      east: gate('east', 'The East Gate', 960, { via: ['trail'] }, ['west']),
    },
    factions: {},
    regions: {},
    characters: {},
    lore: {},
    rules: { startingLocationId: 'poncewen' },
    battleMaps: {
      'bm_test-gateway': {
        id: 'bm_test-gateway',
        name: 'A gateway',
        width: 3,
        height: 3,
        entries: [{ id: 'in', x: 1, y: 1 }],
        exits: [{ id: 'way-out', name: 'the way out', x: 1, y: 1, to: 'out' }],
        features: [],
      },
    },
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
const mockState = { interpret: null };
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) return mockState.interpret;
    return { narration: 'The moor rolls on.', inventedEntities: [], suggestedActions: [] };
  },
}));

const town = require('../functions/loom-canon/town');
const { evaluate } = require('../functions/loom-turn/adjudicate');

describe('a way in for particular places (pure)', () => {
  test('arriving: the gate set aside for where you came from; others any serving the route', () => {
    expect(town.arrivalPlace(mockWorld, 'helsterton', 'trail', 'poncewen').id).toBe('west');
    expect(town.arrivalPlace(mockWorld, 'helsterton', 'trail', 'brorough').id).toBe('east');
    expect(town.arrivalPlace(mockWorld, 'helsterton', 'trail', 'horningtle').id).toBe('east');
  });

  test('serves: a way with destinations serves only them; without, any', () => {
    const { west, east } = mockWorld.places;
    expect(town.serves(west, 'trail', 'poncewen')).toBe(true);
    expect(town.serves(west, 'trail', 'brorough')).toBe(false);
    expect(town.serves(west, 'trail')).toBe(true);
    expect(town.serves(east, 'trail', 'brorough')).toBe(true);
    expect(town.waysFor([west, east], 'trail', 'poncewen').map((p) => p.id)).toEqual(['west']);
    expect(town.waysFor([west, east], 'trail', 'brorough').map((p) => p.id)).toEqual(['east']);
  });

  test('leaving for Brorough from the West Gate walks to the East Gate first', () => {
    const save = {
      location: 'helsterton',
      placeId: 'west',
      character: { name: 'Tam', inventory: [] },
    };
    const r = evaluate(
      { verb: 'move', targets: ['brorough'], params: {} },
      {},
      save,
      10,
      mockWorld
    );
    expect(r.outcome).not.toBe('blocked');
    expect(r.constraints.join(' ')).toContain('The East Gate');
    const set = (path) => (r.mutations.find((m) => m.path === path) || {}).value;
    expect(set('location')).toBe('brorough');
  });

  test('the town checks see a trail that only a set-aside gate would serve', () => {
    const only = {
      ...mockWorld,
      places: { west: mockWorld.places.west },
    };
    expect(town.layoutReport(only, only.locations.helsterton).warnings).toEqual([
      'No way out serves the trail to Horningtle.',
      'No way out serves the trail to Brorough.',
    ]);
  });
});

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

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

describe('a way in for particular places, in play', () => {
  const arriveFrom = async (from) => {
    const ref = db.collection('loom_saves').doc('from-' + from);
    await ref.set(
      makeSave({
        ownerUid: PLAYER.uid,
        worldId: mockWorld.id,
        name: 'Moor walk',
        character: { name: 'Tam' },
        location: from,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    );
    mockState.interpret = { verb: 'move', targets: ['helsterton'], params: {} };
    await loomPlayTurn.run({
      data: { worldId: mockWorld.id, saveId: ref.id, actionText: 'walk to Helsterton' },
      auth: PLAYER,
    });
    return (await ref.get()).data();
  };

  test('from Poncewen, the West Gate set aside for it', async () => {
    expect(await arriveFrom('poncewen')).toMatchObject({
      location: 'helsterton',
      placeId: 'west',
    });
  });

  test('from Brorough, by another trail, the East Gate', async () => {
    expect(await arriveFrom('brorough')).toMatchObject({
      location: 'helsterton',
      placeId: 'east',
    });
  });
});
