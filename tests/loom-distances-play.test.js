'use strict';

/**
 * Distances in feet in play (planning/maps-from-data.md §3 DS1, §4.2; L-922 /
 * #726), through loomPlayTurn with Gemini stubbed, under both built-in
 * systems (MD2):
 *
 *   - an opportunity attack by distance: Grell's pike reaches 10 ft, edge to
 *     edge. Stepping two squares straight away from him leaves the player in
 *     reach (7.5 ft apart); two squares diagonally, which counted as in reach
 *     when reach was counted in squares, is 11.6 ft and out of it, and draws
 *     his attack;
 *   - a fight on a converted map plays as before: the same scripted fight on
 *     a hall with walls, a door and obstacles as layers, read as geometry
 *     beside it as before L-928, and on the hall with those layers stored as
 *     its geometry and dropped (as L-928 stores them; EX4), ends the same,
 *     line for line.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-distances-play --verbose"
 */

const PROJECT = 'demo-loom-distances-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// A hall 12 × 7, in at the west, the way out at the east: a wall down x = 6
// with a door in it at y 3–4, a table and a pillar, rubble by the door.
const mockHall = () => ({
  id: 'bm_hall',
  name: 'The hall',
  width: 12,
  height: 7,
  image: null,
  entries: [{ id: 'west', x: 1, y: 3 }],
  exits: [{ id: 'out', name: 'the far door', x: 11, y: 3, to: 'out' }],
  features: [],
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
        { x: 6, y: 7 },
      ],
    },
  ],
  doors: [{ id: 'mid', name: 'the middle door', from: { x: 6, y: 3 }, to: { x: 6, y: 4 } }],
  obstacles: [
    { id: 'table', name: 'a table', kind: 'low', x: 3, y: 1, w: 2 },
    { id: 'pillar', name: 'a pillar', kind: 'solid', x: 8, y: 5 },
    { id: 'rubble', name: 'rubble', kind: 'difficult', x: 7, y: 2 },
  ],
  hazards: [],
});
// The hall as it played before L-928: its layers read as geometry beside it
// (they are ignored now, and its geometry is what they made); and converted,
// its layers stored as geometry and dropped (./helpers/grid.js), as the
// Convert Map Layers workflow does.
const mockLayered = () => {
  const layerGeometry = jest.requireActual('../functions/loom-canon/layer-geometry');
  const hall = mockHall();
  return { ...hall, geometry: layerGeometry.converted(hall) };
};
const mockConverted = () => jest.requireActual('./helpers/grid').gridMap(mockHall());
const mockCases = {
  'd20-fantasy': { system: FANTASY, hit: '1d20 + 10' },
  'pool-scifi': { system: SCIFI, hit: 'count(8d10, >= 7)' },
};

// Which system, which hall, and where Grell stands with what.
const mockState = { id: 'd20-fantasy', hall: 'layers', grell: null };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      const c = mockCases[mockState.id];
      const sheetsReal = jest.requireActual('../functions/loom-canon/sheets');
      const g = mockState.grell;
      return {
        ...COAST,
        system: c.system,
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
            cell: g.cell,
            side: 'hostile',
            sheet: (() => {
              const s = sheetsReal.defaultSheet(c.system);
              s.resources.health = { current: g.health || 20 };
              s.attacks = [{ ...g.attack, attack: c.hit, damage: '1' }];
              return s;
            })(),
          },
        },
        battleMaps: { bm_hall: mockState.hall === 'converted' ? mockConverted() : mockLayered() },
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
const PIKE = { id: 'pike', name: 'Pike', reach: 2 };
const CLUB = { id: 'club', name: 'Club', reach: 1 };

beforeAll(() => {
  // Every die rolls high.
  jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max - 1);
});
afterAll(async () => {
  crypto.randomInt.mockRestore();
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

const play = (ref, action) =>
  loomPlayTurn.run({
    data: { worldId: 'shattered-coast', saveId: ref.id, action },
    auth: PLAYER,
  });

describe.each(Object.keys(mockCases))('distances in feet in play under %s', (id) => {
  const c = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });

  // The player at `cell`, in a fight with Grell (his pike's reach 10 ft, a
  // full turn's AP kept to react), their turn.
  async function besideGrell(saveId, cell) {
    mockState.hall = 'layers';
    mockState.grell = { cell: { x: 9, y: 3 }, attack: PIKE };
    const ref = db.collection('loom_saves').doc(saveId);
    await ref.set({
      ...makeSave({
        ownerUid: PLAYER.uid,
        worldId: 'shattered-coast',
        name: 'Voyage',
        character: { name: 'Tam', sheet: sheets.defaultSheet(c.system) },
        location: 'widows-reach',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      mapId: 'bm_hall',
      cell,
      doors: { bm_hall: { mid: 'open' } },
      turn: { n: 1, ap: 20, kept: 0, plan: null },
      fight: {
        id: 'fight-1',
        mapId: 'bm_hall',
        by: 'seen',
        round: 2,
        order: ['player', 'grell'],
        turn: 'player',
        combatants: {
          player: { kind: 'player', side: 'party', name: 'Tam', initiative: 15, kept: 0 },
          grell: { kind: 'character', side: 'hostile', name: 'Grell', initiative: 5, kept: 20 },
        },
      },
    });
    return ref;
  }

  describe('an opportunity attack by distance', () => {
    test('two squares straight away: still within his 10 ft, nothing drawn', async () => {
      const ref = await besideGrell(`${id}-straight`, { x: 8, y: 3 });
      const answer = await play(ref, { verb: 'move', cell: { x: 7, y: 3 } });
      // 10 ft between middles, 7.5 ft edge to edge.
      expect(answer.step.cell).toEqual({ x: 7, y: 3 });
      expect((answer.step.lines || []).join(' ')).not.toContain('reach');
      const save = (await ref.get()).data();
      expect(save.fight.combatants.grell.kept).toBe(20);
    });

    test('two squares diagonally: 11.6 ft, out of reach, and his pike strikes', async () => {
      const ref = await besideGrell(`${id}-diagonal`, { x: 8, y: 3 });
      // Two squares away by the old count (in reach); in feet, out of it.
      const answer = await play(ref, { verb: 'move', cell: { x: 7, y: 1 } });
      expect(answer.step.lines[0]).toBe("You leave Grell's reach.");
      expect(answer.step.lines[1]).toMatch(/^Grell hits you with their pike/);
      // The walk goes on to where it was going.
      expect(answer.step.cell).toEqual({ x: 7, y: 1 });
      const save = (await ref.get()).data();
      expect(save.fight.combatants.grell.kept).toBe(10);
      expect(save.gridPoint).toEqual({ x: 37.5, y: 7.5 });
    });
  });

  describe('a fight on a converted map plays as before', () => {
    // The scripted fight: in at the west door, Grell behind the middle
    // door with a club. Walk to the door, open it (he comes into view: the
    // fight starts), on through it, end turns, strike him, back off.
    const SCRIPT = [
      { verb: 'move', cell: { x: 5, y: 3 } },
      { verb: 'door', door: 'mid', open: true },
      { verb: 'move', cell: { x: 7, y: 4 } },
      { verb: 'end-turn' },
      { verb: 'attack', target: 'grell' },
      { verb: 'end-turn' },
      { verb: 'move', cell: { x: 4, y: 5 } },
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

    async function playThrough(hall) {
      mockState.hall = hall;
      mockState.grell = { cell: { x: 9, y: 3 }, attack: CLUB, health: 30 };
      const ref = db.collection('loom_saves').doc(`${id}-${hall}`);
      await ref.set({
        ...makeSave({
          ownerUid: PLAYER.uid,
          worldId: 'shattered-coast',
          name: 'Voyage',
          character: { name: 'Tam', sheet: sheets.defaultSheet(c.system) },
          location: 'widows-reach',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        mapId: 'bm_hall',
        cell: { x: 1, y: 3 },
        turn: { n: 1, ap: 20, kept: 0, plan: null },
      });
      const answers = [];
      const states = [];
      for (const action of SCRIPT) {
        answers.push(outcome(await play(ref, action)));
        states.push(stateOf((await ref.get()).data()));
      }
      return { answers, states };
    }

    test('layers alone, and the layers stored as geometry: the same fight', async () => {
      const before = await playThrough('layers');
      const after = await playThrough('converted');
      // It was a fight: Grell came into view, moved and struck.
      expect(before.states.some((s) => s.fight)).toBe(true);
      expect(before.answers.some((a) => a.turns.some((t) => t.id === 'grell'))).toBe(true);
      // Struck, he stays where he had moved to, in feet.
      const struck = SCRIPT.findIndex((a) => a.verb === 'attack');
      expect(before.states[struck].figures.grell).toMatchObject({
        cell: before.states[struck - 1].figures.grell.cell,
        point: before.states[struck - 1].figures.grell.point,
      });
      expect(after.answers).toEqual(before.answers);
      expect(after.states).toEqual(before.states);
    });
  });
});
