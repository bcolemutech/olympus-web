'use strict';

/**
 * Sight and heights in play (planning/maps-from-data.md §4.3, GE3, DA2;
 * L-923 / #727), through loomPlayTurn with Gemini stubbed, under both
 * built-in systems (MD2), on a hall drawn from its geometry:
 *
 *   - a hostile seen through a gate starts a fight; behind a wooden door, not;
 *   - high ground counts in an attack: the roll carries the system's term;
 *   - a fall from a ledge: the walk stops where it lands, the system's damage
 *     is taken and the player is Prone; the GM is told the fall and the
 *     heights in sight.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-sight-play --verbose"
 */

const PROJECT = 'demo-loom-sight-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const conditions = require('../functions/loom-canon/conditions');

// A hall 12 × 8: in the west a ledge 10 ft high (x 0–15 ft); a wall down
// x = 40 ft with a door in it (y 15–25 ft), a gate or a wooden door.
const mockHall = (door) => {
  const geo = jest.requireActual('../functions/loom-canon/map-geometry');
  return {
    id: 'bm_hall',
    name: 'The hall',
    width: 12,
    height: 8,
    image: null,
    entries: [{ id: 'west', x: 4, y: 4 }],
    exits: [{ id: 'out', name: 'the far stair', x: 11, y: 7, to: 'out' }],
    features: [],
    walls: [],
    doors: [],
    obstacles: [],
    hazards: [],
    geometry: geo.normalize({
      ground: [
        {
          id: 'ledge',
          material: 'stone',
          shape: { rect: { x: 0, y: 0, w: 15, h: 40 } },
          height: 10,
        },
      ],
      walls: [
        {
          id: 'wall',
          material: 'stone',
          points: [
            [40, 0],
            [40, 40],
          ],
        },
      ],
      doors: [
        {
          id: 'mid',
          material: door,
          from: [40, 15],
          to: [40, 25],
          wall: 'wall',
          state: 'closed',
        },
      ],
    }),
  };
};
const mockCases = {
  'd20-fantasy': { system: BUILT_IN['d20-fantasy'], ranged: 'bow' },
  'pool-scifi': { system: BUILT_IN['pool-scifi'], ranged: 'pistol' },
};

// Which system, which door, and where Grell stands, on which side.
const mockState = { id: 'd20-fantasy', door: 'gate', grell: { cell: { x: 10, y: 4 } } };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      const c = mockCases[mockState.id];
      const sheetsReal = jest.requireActual('../functions/loom-canon/sheets');
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
            cell: mockState.grell.cell,
            side: mockState.grell.side || 'hostile',
            sheet: (() => {
              const s = sheetsReal.defaultSheet(c.system);
              s.resources.health = { current: 30 };
              return s;
            })(),
          },
        },
        battleMaps: { bm_hall: mockHall(mockState.door) },
      };
    },
  };
});
const mockPrompts = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    mockPrompts.push(JSON.stringify(options));
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return { verb: 'look', targets: [], params: {} };
    }
    return { narration: 'You go on.', inventedEntities: [], suggestedActions: [] };
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

describe.each(Object.keys(mockCases))('sight and heights in play under %s', (id) => {
  const c = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });

  // A save standing at `cell` on the hall.
  async function standing(saveId, cell) {
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
      turn: { n: 1, ap: 20, kept: 0, plan: null },
    });
    return ref;
  }

  test('a hostile seen through a gate starts a fight; behind a wooden door, not', async () => {
    mockState.grell = { cell: { x: 10, y: 4 } };
    mockState.door = 'wood';
    const shut = await standing(`${id}-wood`, { x: 4, y: 4 });
    await play(shut, { verb: 'move', cell: { x: 5, y: 4 } });
    expect((await shut.get()).data().fight).toBeFalsy();
    mockState.door = 'gate';
    const gate = await standing(`${id}-gate`, { x: 4, y: 4 });
    await play(gate, { verb: 'move', cell: { x: 5, y: 4 } });
    const save = (await gate.get()).data();
    expect(save.fight).toMatchObject({ by: 'seen' });
    expect(Object.keys(save.fight.combatants)).toEqual(expect.arrayContaining(['player', 'grell']));
  });

  test('high ground counts in an attack: the roll carries it', async () => {
    mockState.door = 'gate';
    mockState.grell = { cell: { x: 6, y: 4 }, side: 'neutral' };
    // On the ledge, 10 ft above Grell.
    const ref = await standing(`${id}-high`, { x: 1, y: 4 });
    const shot = await play(ref, { verb: 'attack', target: 'grell', attack: c.ranged });
    expect(shot.roll.line).toContain('High ground');
    // From the floor beside him: not.
    const level = await standing(`${id}-level`, { x: 4, y: 4 });
    const again = await play(level, { verb: 'attack', target: 'grell', attack: c.ranged });
    expect(again.roll.line).not.toContain('High ground');
  });

  test('a fall from a ledge: stopped where it lands, hurt by the system, Prone', async () => {
    mockState.door = 'wood';
    mockState.grell = { cell: { x: 10, y: 6 }, side: 'neutral' };
    const ref = await standing(`${id}-fall`, { x: 1, y: 4 });
    const before = (await ref.get()).data().character.sheet.resources.health;
    mockPrompts.length = 0;
    const answer = await play(ref, { verb: 'move', cell: { x: 6, y: 4 } });
    expect(answer.step).toMatchObject({ fall: 10, cell: { x: 3, y: 4 } });
    const save = (await ref.get()).data();
    const sheet = save.character.sheet;
    const fallen = c.system.modules.combat.falls.damage === '1d6' ? 6 : 1;
    const full = Number.isFinite(before && before.current)
      ? before.current
      : sheets.maxima(c.system, sheets.defaultSheet(c.system)).health;
    expect(sheet.resources.health.current).toBe(full - fallen);
    expect(conditions.activeOn(c.system, sheet).map((a) => a.condition.id)).toContain('prone');
    // Told to the GM: the fall, and where the player stands now.
    const told = mockPrompts.join('\n');
    expect(told).toContain('FALL: the player walked off a drop and fell 10 ft');
    // The rest of the way kept for later.
    expect(save.turn.plan).toMatchObject({ to: { x: 6, y: 4 } });
  });

  test('the GM is told the heights in sight', async () => {
    mockState.door = 'gate';
    mockState.grell = { cell: { x: 6, y: 4 }, side: 'neutral' };
    const ref = await standing(`${id}-heights`, { x: 1, y: 4 });
    mockPrompts.length = 0;
    await loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, actionText: 'look around' },
      auth: PLAYER,
    });
    const told = mockPrompts.join('\n');
    expect(told).toContain('Heights: the player stands 10 ft up; Grell is 10 ft below the player.');
  });
});
