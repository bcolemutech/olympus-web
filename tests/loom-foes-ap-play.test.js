'use strict';

/**
 * Foes on AP in play (planning/action-points.md §4.7; L-836 / #686), through
 * loomPlayTurn with Gemini stubbed, under both built-in systems (MD2): the
 * player ends their turn between Grell, a skirmisher, and Bruno, a guard.
 * Grell strikes and steps back out of reach; Bruno strikes once and keeps
 * the rest of his AP. The player then walks out of Bruno's reach, and his
 * kept AP pays for the blow.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-foes-ap-play --verbose"
 */

const PROJECT = 'demo-loom-foes-ap-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// A hall 12 × 6, in at the west, the way out at the east.
const mockHall = () => ({
  id: 'bm_hall',
  name: 'The hall',
  width: 12,
  height: 6,
  image: null,
  entries: [{ id: 'west', x: 1, y: 2 }],
  exits: [{ id: 'out', name: 'the far door', x: 11, y: 2, to: 'out' }],
  features: [],
  walls: [],
  doors: [],
  obstacles: [],
  hazards: [],
});
const mockCases = {
  'd20-fantasy': { system: FANTASY, club: '1d20 + 10' },
  'pool-scifi': { system: SCIFI, club: 'count(8d10, >= 7)' },
};

const mockState = { id: 'd20-fantasy' };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      const c = mockCases[mockState.id];
      const sheetsReal = jest.requireActual('../functions/loom-canon/sheets');
      // Tough, so nobody falls: the round plays out whole.
      const fighter = (id, name, role, cell) => ({
        id,
        name,
        description: `A bandit with a club (${role}).`,
        locationId: 'widows-reach',
        cell,
        side: 'hostile',
        role,
        sheet: (() => {
          const s = sheetsReal.defaultSheet(c.system);
          for (const r of c.system.sheet.resources) s.resources[r.id] = { current: 500 };
          s.attacks = [{ id: 'club', name: 'Club', reach: 1, attack: c.club, damage: '1' }];
          return s;
        })(),
      });
      return {
        ...COAST,
        system: c.system,
        locations: {
          ...COAST.locations,
          'widows-reach': { ...COAST.locations['widows-reach'], battleMap: { mapId: 'bm_hall' } },
        },
        characters: {
          ...COAST.characters,
          grell: fighter('grell', 'Grell', 'skirmisher', { x: 6, y: 2 }),
          bruno: fighter('bruno', 'Bruno', 'guard', { x: 4, y: 2 }),
        },
        battleMaps: { bm_hall: mockHall() },
      };
    },
  };
});
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    // Named characters' turns: no answer, so they fight by their role.
    if (options.systemInstruction.includes('COMBAT TURN')) return null;
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

beforeAll(() => {
  // Every die rolls high.
  jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max - 1);
});
afterAll(async () => {
  crypto.randomInt.mockRestore();
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

const away = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

describe.each(Object.keys(mockCases))('foes on AP in play under %s', (id) => {
  const c = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });

  // The player between Grell and Bruno, in a fight, their turn spent.
  async function inTheFight(saveId) {
    const ref = db.collection('loom_saves').doc(saveId);
    const sheet = sheets.defaultSheet(c.system);
    for (const r of c.system.sheet.resources) sheet.resources[r.id] = { current: 500 };
    await ref.set({
      ...makeSave({
        ownerUid: PLAYER.uid,
        worldId: 'shattered-coast',
        name: 'Voyage',
        character: { name: 'Tam', sheet },
        location: 'widows-reach',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      mapId: 'bm_hall',
      cell: { x: 5, y: 2 },
      turn: { n: 1, ap: 0, kept: 0, plan: null },
      fight: {
        id: 'fight-1',
        mapId: 'bm_hall',
        by: 'seen',
        round: 2,
        order: ['player', 'grell', 'bruno'],
        turn: 'player',
        combatants: {
          player: { kind: 'player', side: 'party', name: 'Tam', initiative: 15, kept: 0 },
          grell: { kind: 'character', side: 'hostile', name: 'Grell', initiative: 10, kept: 0 },
          bruno: { kind: 'character', side: 'hostile', name: 'Bruno', initiative: 5, kept: 0 },
        },
      },
    });
    return ref;
  }
  const play = (ref, action) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, action },
      auth: PLAYER,
    });

  test('a round: Grell strikes and steps back; Bruno strikes once and keeps the rest', async () => {
    const ref = await inTheFight(`${id}-round`);
    const answer = await play(ref, { verb: 'end-turn' });
    const grell = answer.turns.filter((t) => t.id === 'grell');
    const bruno = answer.turns.filter((t) => t.id === 'bruno');
    // One blow each.
    expect(grell).toHaveLength(1);
    expect(grell[0].attack).toMatchObject({ target: 'player', hit: true });
    expect(bruno).toHaveLength(1);
    expect(bruno[0].attack).toMatchObject({ target: 'player', hit: true });
    const save = (await ref.get()).data();
    // Grell stands out of the player's reach; Bruno where he was.
    expect(away(save.figures.grell.cell, { x: 5, y: 2 })).toBeGreaterThan(1);
    expect((save.figures.bruno || {}).cell || { x: 4, y: 2 }).toEqual({ x: 4, y: 2 });
    // What each kept: Grell's 20 less the blow and the steps; Bruno's 10.
    const steps = grell[0].path.length;
    expect(save.fight.combatants.grell.kept).toBe(20 - 10 - steps);
    expect(save.fight.combatants.bruno.kept).toBe(10);
    expect(save.fight).toMatchObject({ round: 3, turn: 'player' });
  });

  test('Bruno’s held AP strikes the player leaving his reach', async () => {
    const ref = await inTheFight(`${id}-leave`);
    await play(ref, { verb: 'end-turn' });
    const walked = await play(ref, { verb: 'move', cell: { x: 7, y: 5 } });
    expect(walked.step.lines[0]).toBe("You leave Bruno's reach.");
    expect(walked.step.lines[1]).toMatch(/^Bruno hits you with their club/);
    const save = (await ref.get()).data();
    expect(save.fight.combatants.bruno.kept).toBe(0);
  });
});
