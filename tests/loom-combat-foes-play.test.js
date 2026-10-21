'use strict';

/**
 * Foes and allies in play (planning/combat.md §3 EN1–EN4, §4.6; L-824 /
 * #656), through loomPlayTurn with Gemini stubbed, under both built-in
 * systems (MD2): figures placed on a battle map from a stat block start a
 * fight when the player comes into sight; on End turn they close in and
 * attack by their tactics, with no model call, their squares and the
 * player's wounds in the save; loomGetMap shows them where they stand; the
 * player can attack one; when half of them are down the rest roll morale
 * and run, and the fight ends, narrated; at 0 the player is knocked out
 * (until L-827): an hour passes, 1 health left, the fight over.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-combat-foes-play --verbose"
 */

const PROJECT = 'demo-loom-combat-foes-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// A hall 8 × 5, in at the west door; two bandits at the east end, in sight.
const mockHall = (group) => ({
  id: 'bm_hall',
  name: 'The hall',
  width: 8,
  height: 5,
  image: null,
  entries: [{ id: 'door', x: 1, y: 2 }],
  exits: [{ id: 'out', name: 'the door', x: 0, y: 2, to: 'out' }],
  features: [],
  walls: [],
  doors: [],
  obstacles: [],
  hazards: [],
  figures: [group],
});
const mockCases = {
  'd20-fantasy': {
    system: FANTASY,
    melee: 'sword',
    weak: { STR: 10, DEX: 10, CON: 3, INT: 8, WIS: 3, CHA: 8 },
    strong: { STR: 18, DEX: 10, CON: 10, INT: 8, WIS: 8, CHA: 8 },
    club: {
      id: 'club',
      name: 'Club',
      reach: 1,
      attack: '1d20 + mod(STR) + 2',
      damage: '1d6 + mod(STR)',
      type: 'bludgeoning',
    },
    high: 20,
  },
  'pool-scifi': {
    system: SCIFI,
    melee: 'knife',
    skills: { Melee: 2 },
    weak: { Body: 1, Reflex: 1, Mind: 1, Presence: 1 },
    strong: { Body: 5, Reflex: 3, Mind: 2, Presence: 2 },
    club: {
      id: 'pipe',
      name: 'Pipe',
      reach: 1,
      attack: 'count((Body + Melee)d10, >= 7)',
      damage: '1d3',
      type: 'kinetic',
    },
    high: 10,
  },
};

const mockState = { id: 'd20-fantasy', intent: null, attributes: null, posture: 'cowardly' };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      const c = mockCases[mockState.id];
      return {
        ...COAST,
        system: c.system,
        locations: {
          ...COAST.locations,
          'widows-reach': { ...COAST.locations['widows-reach'], battleMap: { mapId: 'bm_hall' } },
        },
        battleMaps: {
          bm_hall: mockHall({
            id: 'bandits',
            name: 'Bandit',
            posture: mockState.posture,
            statBlock: {
              attributes: mockState.attributes || c.weak,
              ...(c.skills ? { skills: c.skills } : {}),
              attacks: [c.club],
            },
            cells: [
              { x: 6, y: 1 },
              { x: 6, y: 3 },
            ],
          }),
        },
      };
    },
  };
});
const prompts = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return mockState.intent || { verb: 'search', targets: [], params: {} };
    }
    prompts.push(options.userMessage);
    return { narration: 'Steel rings out.', inventedEntities: [], suggestedActions: [] };
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

let face = 5; // every die rolls this
beforeAll(() => {
  jest
    .spyOn(crypto, 'randomInt')
    .mockImplementation((min, max) => Math.min(max - 1, min + face - 1));
});
afterAll(async () => {
  crypto.randomInt.mockRestore();
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

describe.each(Object.keys(mockCases))('foes under %s', (id) => {
  const c = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });
  beforeEach(() => {
    mockState.intent = null;
    mockState.attributes = null;
    mockState.posture = 'cowardly';
    face = 5;
    prompts.length = 0;
  });

  async function onTheMap(saveId) {
    const sheet = sheets.defaultSheet(c.system);
    sheet.skills = { ...sheet.skills, ...(c.skills || {}) };
    await db
      .collection('loom_saves')
      .doc(saveId)
      .set({
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
        cell: { x: 1, y: 2 },
      });
    return db.collection('loom_saves').doc(saveId);
  }
  const play = (saveId, data) =>
    loomPlayTurn.run({ data: { worldId: 'shattered-coast', saveId, ...data }, auth: PLAYER });
  const saved = async (ref) => (await ref.get()).data();
  const view = (ref) =>
    loomGetMap.run({ data: { worldId: 'shattered-coast', saveId: ref.id }, auth: PLAYER });
  const near = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;

  test('they start a fight on sight, close in and attack on End turn, by the rules alone', async () => {
    const ref = await onTheMap(`${id}-close`);
    const step = await play(ref.id, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    expect(step.step.fight).toBe(true);
    let save = await saved(ref);
    expect(Object.keys(save.fight.combatants).sort()).toEqual([
      'fig-bandits-1',
      'fig-bandits-2',
      'player',
    ]);
    // The map shows them, numbered, on their side.
    let map = await view(ref);
    expect(map.battleMap.people).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fig-bandits-1',
          name: 'Bandit 1',
          side: 'hostile',
          figure: true,
        }),
        expect.objectContaining({
          id: 'fig-bandits-2',
          name: 'Bandit 2',
          side: 'hostile',
          figure: true,
        }),
      ])
    );

    prompts.length = 0;
    const round = await play(ref.id, { action: { verb: 'end-turn' } });
    expect(round.narration).toMatch(/Bandit 1 (misses|hits) you/);
    expect(round.narration).toMatch(/Bandit 2 (misses|hits) you/);
    expect(prompts).toHaveLength(0);
    save = await saved(ref);
    for (const fid of ['fig-bandits-1', 'fig-bandits-2']) {
      expect(near(save.figures[fid].cell, { x: 2, y: 2 })).toBe(true);
    }
    // Where they moved to, on the map.
    map = await view(ref);
    const one = map.battleMap.people.find((p) => p.id === 'fig-bandits-1');
    expect({ x: one.x, y: one.y }).toEqual(save.figures['fig-bandits-1'].cell);
  });

  test('half of them down, the rest break and run: the fight ends, narrated', async () => {
    const ref = await onTheMap(`${id}-morale`);
    await play(ref.id, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    await play(ref.id, { action: { verb: 'end-turn' } });
    // A blow drops Bandit 1 (frail); then every die a 1: morale fails.
    face = c.high;
    const blow = await play(ref.id, {
      action: { verb: 'attack', target: 'fig-bandits-1', attack: c.melee },
    });
    expect(blow.narration).toContain('Bandit 1 falls, dead.');
    face = 1;
    prompts.length = 0;
    let round = await play(ref.id, { action: { verb: 'end-turn' } });
    expect(round.narration).toContain('Bandit 2 breaks and runs.');
    for (let i = 0; i < 4 && (await saved(ref)).fight; i++) {
      round = await play(ref.id, { action: { verb: 'end-turn' } });
    }
    const save = await saved(ref);
    expect(save.fight).toBeNull();
    expect(save.figures['fig-bandits-2']).toMatchObject({ gone: 'fled' });
    expect(round.narration).toContain('Bandit 2 flees.');
    expect(round.narration).toContain('The fight is over: your foes fell or fled.');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('FIGHT ENDS');
    // Gone from the map.
    const map = await view(ref);
    expect(map.battleMap.people.find((p) => p.id === 'fig-bandits-2')).toBeUndefined();
  });

  test('at 0 the player is knocked out: an hour passes, 1 health left, the fight over', async () => {
    mockState.attributes = c.strong;
    mockState.posture = 'reckless';
    face = c.high;
    const ref = await onTheMap(`${id}-out`);
    await play(ref.id, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    for (let i = 0; i < 6 && (await saved(ref)).fight; i++) {
      await play(ref.id, { action: { verb: 'end-turn' } });
    }
    const save = await saved(ref);
    expect(save.fight).toBeNull();
    expect(save.character.sheet.resources.health.current).toBe(1);
    const turns = await ref.collection('loom_turns').orderBy('index', 'desc').limit(1).get();
    const last = turns.docs[0].data();
    expect(last.resolution.constraints).toContain(
      'You fall, knocked out. You come round an hour later, battered.'
    );
    expect(last.resolution.fight).toMatchObject({
      ended: true,
      winner: 'hostile',
      knockedOut: true,
    });
    expect(save.time).toBeGreaterThanOrEqual(8 * 3600 + 3600);
  });
});
