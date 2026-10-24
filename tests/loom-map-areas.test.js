'use strict';

/**
 * Areas on battle maps (#670), with Gemini stubbed, under both built-in
 * systems: which squares an area holds (a concave one too) and which area a
 * square is in where they overlap; outlines checked; loomGetMap sends only
 * the squares seen of an area seen, and nothing of one unseen; NARRATE is
 * told the player's area, the areas in sight and where the people in sight
 * stand, and nothing of an area out of sight; a typed "go to the taproom"
 * walks to its nearest square.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-map-areas --verbose"
 */

const PROJECT = 'demo-loom-map-areas';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const mapAreas = require('../functions/loom-canon/map-areas');

const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

// An inn 12 × 6: a wall down x = 6 with a shut door in it; west of it the
// taproom (its top two rows), the door out, and Mira; east of it the back
// room, and Grell in it.
const mockInn = () => ({
  id: 'bm_inn',
  name: 'The inn',
  width: 12,
  height: 6,
  image: null,
  entries: [{ id: 'door', x: 1, y: 3 }],
  exits: [{ id: 'out', name: 'the street door', x: 0, y: 3, to: 'out' }],
  features: [],
  walls: [
    {
      points: [
        { x: 6, y: 0 },
        { x: 6, y: 2 },
      ],
    },
    {
      points: [
        { x: 6, y: 3 },
        { x: 6, y: 6 },
      ],
    },
  ],
  doors: [{ id: 'back-door', name: 'the back door', from: { x: 6, y: 2 }, to: { x: 6, y: 3 } }],
  obstacles: [],
  hazards: [],
  areas: [
    { id: 'taproom', name: 'the taproom', polygon: rect(0, 0, 6, 2) },
    { id: 'back-room', name: 'the back room', polygon: rect(6, 0, 12, 6) },
  ],
});

const mockCases = {
  'd20-fantasy': BUILT_IN['d20-fantasy'],
  'pool-scifi': BUILT_IN['pool-scifi'],
};
const mockState = { id: 'd20-fantasy', intent: null };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      return {
        ...COAST,
        system: mockCases[mockState.id],
        locations: {
          ...COAST.locations,
          'widows-reach': { ...COAST.locations['widows-reach'], battleMap: { mapId: 'bm_inn' } },
        },
        characters: {
          ...COAST.characters,
          mira: {
            id: 'mira',
            name: 'Mira',
            description: 'The innkeeper.',
            locationId: 'widows-reach',
            cell: { x: 4, y: 1 },
          },
          grell: {
            id: 'grell',
            name: 'Grell',
            description: 'A smuggler.',
            locationId: 'widows-reach',
            cell: { x: 10, y: 4 },
          },
        },
        battleMaps: { bm_inn: mockInn() },
      };
    },
  };
});
const prompts = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) return mockState.intent;
    prompts.push(options.userMessage);
    return { narration: 'You look about.', inventedEntities: [], suggestedActions: [] };
  },
}));

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomPlayTurn, loomGetMap } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const db = getFirestore();
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

describe('which squares an area holds (pure)', () => {
  const map = { width: 10, height: 6 };
  const L = {
    id: 'hall',
    name: 'the hall',
    polygon: [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 6 },
      { x: 0, y: 6 },
    ],
  };
  const room = { id: 'nook', name: 'the nook', polygon: rect(0, 0, 2, 2) };

  test('a square is in when its centre is: a rectangle, and a concave L', () => {
    expect(mapAreas.squaresOf(map, room)).toEqual(['0,0', '1,0', '0,1', '1,1']);
    const hall = mapAreas.squaresOf(map, L);
    expect(hall).toHaveLength(20);
    expect(hall).toContain('5,1');
    expect(hall).toContain('1,5');
    // The inside corner of the L is out.
    expect(hall).not.toContain('3,3');
  });

  test('where areas overlap, a square is in the smallest; outside them all, none', () => {
    const both = { ...map, areas: [L, room] };
    expect(mapAreas.areaAt(both, { x: 1, y: 1 }).id).toBe('nook');
    expect(mapAreas.areaAt(both, { x: 4, y: 1 }).id).toBe('hall');
    expect(mapAreas.areaAt(both, { x: 8, y: 4 })).toBeNull();
  });

  test('outlines are checked: corners on the grid, not crossing, ids unique', () => {
    expect(mapAreas.validate(map, [L, room])).toEqual([]);
    expect(
      mapAreas.validate(map, [{ id: 'a', name: 'two', polygon: rect(0, 0, 1, 1).slice(0, 2) }])
    ).toEqual(['"two" needs an outline of at least 3 corners.']);
    expect(
      mapAreas.validate(map, [
        {
          id: 'bow',
          name: 'the bow',
          polygon: [
            { x: 0, y: 0 },
            { x: 4, y: 4 },
            { x: 4, y: 0 },
            { x: 0, y: 4 },
          ],
        },
      ])
    ).toEqual(['"the bow"\'s outline crosses itself: list its corners in order around it.']);
    expect(
      mapAreas.validate(map, [{ id: 'x', name: 'out', polygon: rect(8, 4, 11, 6) }])[0]
    ).toMatch(/^"out" has a corner \(11, 4\)/);
    expect(mapAreas.validate(map, [room, room])).toEqual(['Two areas have the id "nook".']);
  });

  test('a feature named like a space is a candidate to be an area', () => {
    expect(mapAreas.soundsLikeAnArea({ name: 'Behind the bar' })).toBe(true);
    expect(mapAreas.soundsLikeAnArea({ name: 'the back room' })).toBe(true);
    expect(mapAreas.soundsLikeAnArea({ name: 'the sluice lever' })).toBe(false);
  });
});

describe.each(Object.keys(mockCases))('areas in play under %s', (id) => {
  const system = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });
  beforeEach(() => {
    prompts.length = 0;
  });

  async function onTheMap(saveId, cell) {
    await db
      .collection('loom_saves')
      .doc(saveId)
      .set({
        ...makeSave({
          ownerUid: PLAYER.uid,
          worldId: 'shattered-coast',
          name: 'Voyage',
          character: { name: 'Tam', sheet: sheets.defaultSheet(system) },
          location: 'widows-reach',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        mapId: 'bm_inn',
        cell,
      });
    return db.collection('loom_saves').doc(saveId);
  }
  const type = (ref, actionText) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, actionText },
      auth: PLAYER,
    });
  const mapOf = (ref) =>
    loomGetMap.run({ data: { worldId: 'shattered-coast', saveId: ref.id }, auth: PLAYER });

  test('loomGetMap: an area seen, cut to its squares seen; one unseen, not sent', async () => {
    const ref = await onTheMap(`${id}-view`, { x: 2, y: 3 });
    const { battleMap } = await mapOf(ref);
    expect(battleMap.areas.map((a) => a.id)).toEqual(['taproom']);
    const [taproom] = battleMap.areas;
    expect(taproom).toMatchObject({ name: 'the taproom', label: expect.any(Object) });
    const seenKeys = new Set(taproom.squares.map((s) => s.x + ',' + s.y));
    // Every square sent is one of the taproom's, and none east of the wall.
    for (const s of taproom.squares) {
      expect(s.y).toBeLessThan(2);
      expect(s.x).toBeLessThan(6);
    }
    expect(seenKeys.size).toBeGreaterThan(0);
    expect(battleMap.hereArea).toBeNull();
    expect(JSON.stringify(battleMap)).not.toContain('the back room');
  });

  test('loomGetMap: standing in the back room, it is named as where you are', async () => {
    const ref = await onTheMap(`${id}-view-back`, { x: 8, y: 3 });
    const { battleMap } = await mapOf(ref);
    expect(battleMap.hereArea).toBe('the back room');
    expect(battleMap.areas.map((a) => a.id)).toEqual(['back-room']);
  });

  test('NARRATE is told the area you stand in and those in sight, nothing of the rest', async () => {
    mockState.intent = { verb: 'look', targets: [], params: {} };
    const ref = await onTheMap(`${id}-narrate`, { x: 8, y: 3 });
    await type(ref, 'look around');
    const prompt = prompts[prompts.length - 1];
    expect(prompt).toContain('the player stands at (8, 3), in the back room.');
    expect(prompt).toContain('Areas in sight: the back room.');
    expect(prompt).toMatch(/Grell \(10, 4\), in the back room/);
    // The taproom is behind the shut door: never named.
    expect(prompt).not.toContain('the taproom');
    expect(prompt).not.toContain('Mira');
  });

  test('NARRATE, from the taproom side: Mira is in the taproom', async () => {
    mockState.intent = { verb: 'look', targets: [], params: {} };
    const ref = await onTheMap(`${id}-narrate-west`, { x: 2, y: 3 });
    await type(ref, 'look around');
    const prompt = prompts[prompts.length - 1];
    expect(prompt).toContain('Areas in sight: the taproom.');
    expect(prompt).toMatch(/Mira \(4, 1\), in the taproom/);
    expect(prompt).not.toContain('the back room');
  });

  test('"go to the taproom" walks to its nearest square; in it, "you\'re in" it', async () => {
    const ref = await onTheMap(`${id}-walk`, { x: 2, y: 3 });
    mockState.intent = { verb: 'move', targets: ['area:taproom'], params: {} };
    await type(ref, 'go to the taproom');
    let save = (await ref.get()).data();
    // Straight up from (2, 3): the nearest square of the taproom.
    expect(save.cell).toEqual({ x: 2, y: 1 });
    const turn = (
      await ref.collection('loom_turns').orderBy('index', 'desc').limit(1).get()
    ).docs[0].data();
    expect(turn.resolution.constraints[0]).toBe('You move into the taproom.');
    await ref.update({ 'turn.ap': 20 });
    const again = await type(ref, 'go to the taproom');
    save = (await ref.get()).data();
    expect(save.cell).toEqual({ x: 2, y: 1 });
    expect(again.narration).toBeDefined();
  });

  test('an area not seen yet is not walked into', async () => {
    const ref = await onTheMap(`${id}-unseen`, { x: 2, y: 3 });
    mockState.intent = { verb: 'move', targets: ['area:back-room'], params: {} };
    await type(ref, 'go to the back room');
    expect((await ref.get()).data().cell).toEqual({ x: 2, y: 3 });
  });
});
