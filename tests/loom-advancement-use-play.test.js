'use strict';

/**
 * Improving by use in play (planning/advancement.md §4.5; L-844 / #716),
 * through loomPlayTurn with Gemini stubbed, in the dice-pool system: a lock
 * picked under fire counts toward its skill, and the same lock picked in
 * safety doesn't; an attack that hits in a fight counts toward it; a long
 * rest after the threshold raises the skill, its count reset; the d20
 * built-in, which has no use, counts nothing.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-advancement-use-play --verbose"
 */

const PROJECT = 'demo-loom-advancement-use-play';
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
  exits: mockState.exits ? [{ id: 'out', name: 'the door', x: 0, y: 2, to: 'out' }] : [],
  features: [],
  walls: [],
  // A locked cell door on the south edge of (2, 2) (L-844).
  doors: [
    {
      id: 'cell',
      name: 'the cell door',
      from: { x: 2, y: 3 },
      to: { x: 3, y: 3 },
      locked: true,
      difficulty: 10,
    },
  ],
  obstacles: [],
  hazards: [],
  figures: mockState.foes ? [group] : [],
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

const mockState = {
  id: 'd20-fantasy',
  intent: null,
  attributes: null,
  posture: 'cowardly',
  exits: true,
  off: false,
  moment: null,
  foes: true,
};
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
        rules: { ...(COAST.rules || {}), ...(mockState.off ? { advancement: false } : {}) },
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
            // With no way out, Bandit 1 stands beside the door (L-842).
            cells: mockState.exits
              ? [
                  { x: 6, y: 1 },
                  { x: 6, y: 3 },
                ]
              : [
                  { x: 2, y: 2 },
                  { x: 6, y: 3 },
                ],
          }),
        },
      };
    },
  };
});
const prompts = [];
const instructions = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return mockState.intent || { verb: 'search', targets: [], params: {} };
    }
    prompts.push(options.userMessage);
    instructions.push(options.systemInstruction);
    return {
      narration: 'Steel rings out.',
      inventedEntities: [],
      suggestedActions: [],
      ...(mockState.moment ? { moment: mockState.moment } : {}),
    };
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

const advancement = require('../functions/loom-modules/advancement');

const PICK = (stakes) => ({
  verb: 'pick_lock',
  targets: ['door:cell'],
  params: { stakes, check: { rung: 'Easy' } },
});

describe.each(Object.keys(mockCases))('use under %s', (id) => {
  const c = mockCases[id];
  const pool = id === 'pool-scifi';
  const lockSkill = c.system.checks.lock.skill;
  beforeAll(() => {
    mockState.id = id;
  });
  beforeEach(() => {
    Object.assign(mockState, { intent: null, attributes: null, posture: 'cowardly', foes: true });
    face = c.high;
  });

  async function onTheMap(saveId, { cell = { x: 1, y: 2 }, skills = {} } = {}) {
    const sheet = sheets.defaultSheet(c.system);
    sheet.skills = { ...sheet.skills, ...(c.skills || {}), [lockSkill]: 1, ...skills };
    const ref = db.collection('loom_saves').doc(`${id}-${saveId}`);
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
      cell,
    });
    return ref;
  }
  const play = (ref, data) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, ...data },
      auth: PLAYER,
    });
  const saved = async (ref) => (await ref.get()).data();

  test('a lock picked under fire counts; the same lock picked in safety doesn’t', async () => {
    // Under fire: into sight of the bandits, then the lock.
    const fire = await onTheMap('fire');
    await play(fire, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    expect((await saved(fire)).fight).toBeTruthy();
    mockState.intent = PICK(true);
    const picked = await play(fire, { actionText: 'pick the cell door’s lock' });
    expect(picked.roll).toMatchObject({ success: true, skill: lockSkill });
    const uses = (await saved(fire)).character.sheet.uses;
    if (pool) expect(uses.skills).toEqual({ [lockSkill]: 1 });
    else expect(uses).toBeUndefined();

    // In safety: no foes, nothing at stake.
    mockState.foes = false;
    const calm = await onTheMap('calm', { cell: { x: 2, y: 2 } });
    mockState.intent = PICK(false);
    const easy = await play(calm, { actionText: 'pick the cell door’s lock' });
    expect(easy.roll).toMatchObject({ success: true });
    const none = (await saved(calm)).character.sheet.uses;
    expect((none && none.skills) || {}).toEqual({});
  });

  test('an attack that hits in a fight counts', async () => {
    const ref = await onTheMap('hit');
    await play(ref, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    await play(ref, { action: { verb: 'end-turn' } });
    const blow = await play(ref, {
      action: { verb: 'attack', target: 'fig-bandits-1', attack: c.melee },
    });
    expect(blow.roll).toMatchObject({ success: true });
    const uses = (await saved(ref)).character.sheet.uses;
    if (pool) expect(uses.attacks).toEqual({ [c.melee]: 1 });
    else expect(uses).toBeUndefined();
  });

  test('a long rest after the threshold raises the skill, its count reset', async () => {
    mockState.foes = false;
    const rank = 1;
    const ref = await onTheMap('rest', { skills: { [lockSkill]: rank } });
    const threshold = advancement.thresholdFor(c.system, rank);
    if (pool) {
      await ref.update({
        'character.sheet.uses': { skills: { [lockSkill]: threshold }, attacks: { [c.melee]: 1 } },
      });
    }
    const rested = await play(ref, { action: { verb: 'rest', rest: 'long' } });
    const sheet = (await saved(ref)).character.sheet;
    if (!pool) {
      expect(threshold).toBeNull();
      expect(rested.rises).toBeUndefined();
      expect(sheet.skills[lockSkill]).toBe(rank);
      return;
    }
    expect(rested.rises).toEqual([
      { kind: 'skill', id: lockSkill, name: expect.any(String), rank: rank + 1 },
    ]);
    expect(sheet.skills[lockSkill]).toBe(rank + 1);
    // Its count reset; the attack, short of its threshold, kept its count.
    expect(sheet.uses).toEqual({ skills: { [lockSkill]: 0 }, attacks: { [c.melee]: 1 } });
    // Recorded with the turn.
    const turns = await ref.collection('loom_turns').get();
    expect(turns.docs.some((d) => (d.data().resolution.rises || []).length === 1)).toBe(true);
  });
});
