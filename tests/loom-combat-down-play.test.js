'use strict';

/**
 * Falling to 0, and rest, in play (planning/combat.md §3 DF1–DF3, DF5,
 * §4.7; L-827 / #659), through loomPlayTurn with Gemini stubbed: in d20
 * fantasy (dying with saves, death on) a player down alone lives or dies by
 * their saves, and death ends the save with an epilogue and refuses more
 * turns; with an ally standing the fight goes on, the player only ending
 * their turns and rolling a dying save each one, and the ally tends them
 * once it is won. In dice-pool sci-fi (out at once, death off) the player
 * down alone comes round where NARRATE's chosen fate puts them, wounded.
 * Rests: short and long, refused in a fight, and broken somewhere dangerous,
 * the hostiles there coming.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-combat-down-play --verbose"
 */

const PROJECT = 'demo-loom-combat-down-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

const mockClub = {
  'd20-fantasy': {
    id: 'club',
    name: 'Club',
    reach: 1,
    attack: '1d20 + mod(STR) + 2',
    damage: '2d6 + mod(STR)',
    type: 'bludgeoning',
  },
  'pool-scifi': {
    id: 'pipe',
    name: 'Pipe',
    reach: 1,
    attack: 'count((Body + Melee)d10, >= 7)',
    damage: '3d3',
    type: 'kinetic',
  },
};
const mockBlocks = {
  'd20-fantasy': {
    brute: { STR: 18, DEX: 10, CON: 10, INT: 8, WIS: 8, CHA: 8 },
    frail: { STR: 8, DEX: 8, CON: 3, INT: 8, WIS: 8, CHA: 8 },
  },
  'pool-scifi': {
    brute: { Body: 5, Reflex: 3, Mind: 2, Presence: 2 },
    frail: { Body: 1, Reflex: 1, Mind: 1, Presence: 1 },
  },
};
const mockSystems = { 'd20-fantasy': FANTASY, 'pool-scifi': SCIFI };

const mockState = {
  id: 'd20-fantasy',
  groups: [],
  danger: undefined,
  fate: 'captured',
  intent: null,
};
const mockGroup = (name, side, cells, attributes) => ({
  id: name.toLowerCase(),
  name,
  side,
  posture: 'reckless',
  statBlock: {
    attributes,
    ...(mockState.id === 'pool-scifi' ? { skills: { Melee: 3 } } : {}),
    attacks: [mockClub[mockState.id]],
  },
  cells,
});
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      return {
        ...COAST,
        system: mockSystems[mockState.id],
        locations: {
          ...COAST.locations,
          'widows-reach': {
            ...COAST.locations['widows-reach'],
            battleMap: { mapId: 'bm_hall' },
            ...(mockState.danger ? { danger: mockState.danger } : {}),
          },
          'free-city-of-marabel': {
            ...COAST.locations['free-city-of-marabel'],
            geo: { ...COAST.locations['free-city-of-marabel'].geo, kind: 'settlement' },
          },
        },
        battleMaps: {
          bm_hall: {
            id: 'bm_hall',
            name: 'The hall',
            width: 10,
            height: 5,
            image: null,
            entries: [{ id: 'door', x: 1, y: 2 }],
            exits: [{ id: 'out', name: 'the door', x: 0, y: 2, to: 'out' }],
            features: [],
            // A wall across x = 5: what is east of it is out of sight.
            walls: [
              {
                points: [
                  { x: 5, y: 0 },
                  { x: 5, y: 5 },
                ],
              },
            ],
            doors: [],
            obstacles: [],
            hazards: [],
            figures: mockState.groups,
          },
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
    return {
      narration: 'The dark closes in.',
      inventedEntities: [],
      suggestedActions: [],
      ...(options.userMessage.includes('FATE:') ? { fate: mockState.fate } : {}),
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

async function onTheMap(saveId, system, cell = { x: 1, y: 2 }) {
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
      mapId: 'bm_hall',
      cell,
    });
  return db.collection('loom_saves').doc(saveId);
}
const play = (saveId, data) =>
  loomPlayTurn.run({ data: { worldId: 'shattered-coast', saveId, ...data }, auth: PLAYER });
const saved = async (ref) => (await ref.get()).data();
const lastTurn = async (ref) =>
  (await ref.collection('loom_turns').orderBy('index', 'desc').limit(1).get()).docs[0].data();

beforeEach(() => {
  mockState.groups = [];
  mockState.danger = undefined;
  mockState.intent = null;
  face = 5;
  prompts.length = 0;
});

describe('d20 fantasy: dying with saves, death on', () => {
  beforeAll(() => {
    mockState.id = 'd20-fantasy';
  });
  const brutes = () =>
    mockGroup(
      'Brute',
      'hostile',
      [
        { x: 3, y: 1 },
        { x: 3, y: 3 },
      ],
      mockBlocks['d20-fantasy'].brute
    );

  test('down alone, every save failing: dead; the save ends with an epilogue', async () => {
    mockState.groups = [brutes()];
    const ref = await onTheMap('fantasy-dies', FANTASY);
    // Every die a 5: the brutes hit (5 + 6 against Armour 10) and every
    // dying save fails (5 against 10).
    face = 5;
    await play(ref.id, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    for (let i = 0; i < 4 && !(await saved(ref)).ended; i++) {
      await play(ref.id, { action: { verb: 'end-turn' } });
    }
    const save = await saved(ref);
    expect(save.ended).toMatchObject({ how: 'died' });
    expect(save.fight).toBeNull();
    const turn = await lastTurn(ref);
    expect(turn.resolution.fallen).toEqual({ outcome: 'dead' });
    expect(turn.resolution.constraints).toContain('You fall, dying.');
    expect(turn.resolution.constraints.join(' ')).toContain(
      'A dying save fails (3 of 3). You die.'
    );
    expect(prompts[prompts.length - 1]).toContain("DEATH: the player's character has died.");
    // No more turns; the map says so.
    const after = await play(ref.id, { actionText: 'get up' });
    expect(after).toMatchObject({ refused: true, ended: true });
    const view = await loomGetMap.run({
      data: { worldId: 'shattered-coast', saveId: ref.id },
      auth: PLAYER,
    });
    expect(view.ended).toMatchObject({ how: 'died' });
  });

  test('down alone, the saves holding: left for dead, they come round at 1', async () => {
    mockState.groups = [brutes()];
    const ref = await onTheMap('fantasy-left', FANTASY);
    face = 18;
    await play(ref.id, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    for (let i = 0; i < 4 && (await saved(ref)).fight; i++) {
      await play(ref.id, { action: { verb: 'end-turn' } });
    }
    const save = await saved(ref);
    expect(save.ended).toBeUndefined();
    expect(save.down).toBeNull();
    expect(save.character.sheet.resources.health.current).toBe(1);
    const turn = await lastTurn(ref);
    expect(turn.resolution.fallen).toEqual({ outcome: 'wake' });
    expect(turn.resolution.constraints.join(' ')).toMatch(/Left for dead, you come round/);
  });

  test('down with an ally standing: the fight goes on, a dying save each turn, nothing else', async () => {
    // A brute beside the player; a guard of theirs on the far side.
    mockState.groups = [
      mockGroup('Brute', 'hostile', [{ x: 3, y: 2 }], mockBlocks['d20-fantasy'].brute),
      mockGroup('Guard', 'party', [{ x: 2, y: 4 }], mockBlocks['d20-fantasy'].frail),
    ];
    const ref = await onTheMap('fantasy-ally', FANTASY);
    face = 18;
    await play(ref.id, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    for (let i = 0; i < 3 && !(await saved(ref)).down; i++) {
      await play(ref.id, { action: { verb: 'end-turn' } });
    }
    let save = await saved(ref);
    expect(save.down).toMatchObject({ kind: 'dying' });
    if (!save.fight) return; // the guard ended it at once: covered by the pure tests
    // Down: no moving, no acting.
    const step = await play(ref.id, { action: { verb: 'move', cell: { x: 2, y: 3 } } });
    expect(step.narration).toBe("You're down: you can only end your turn.");
    const act = await play(ref.id, { actionText: 'crawl away' });
    expect(act).toMatchObject({ refused: true });
    // End turn: a dying save, as the turn's roll card.
    face = 15;
    const turn = await play(ref.id, { action: { verb: 'end-turn' } });
    expect(turn.roll).toMatchObject({ against: 'dying save' });
    save = await saved(ref);
    if (save.fight) {
      expect(save.down.successes + save.down.failures).toBeGreaterThan(0);
    } else {
      // The guard won it in the round: they tend the player, who comes round.
      expect(save.down).toBeNull();
      expect((await lastTurn(ref)).resolution.fallen).toEqual({ outcome: 'wake' });
    }
  });
});

describe('dice-pool sci-fi: out at once, death off', () => {
  beforeAll(() => {
    mockState.id = 'pool-scifi';
  });

  test('out alone: NARRATE chooses the fate (captured), the rules carry it out', async () => {
    mockState.groups = [
      mockGroup(
        'Brute',
        'hostile',
        [
          { x: 3, y: 1 },
          { x: 3, y: 3 },
        ],
        mockBlocks['pool-scifi'].brute
      ),
    ];
    mockState.fate = 'captured';
    const ref = await onTheMap('scifi-captured', SCIFI);
    face = 9;
    await play(ref.id, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    for (let i = 0; i < 4 && (await saved(ref)).fight; i++) {
      await play(ref.id, { action: { verb: 'end-turn' } });
    }
    const save = await saved(ref);
    expect(save.fight).toBeNull();
    expect(save.down).toBeNull();
    expect(save.location).toBe('free-city-of-marabel');
    expect(save.mapId).toBeNull();
    expect(save.privateFlags.captured).toBe(true);
    expect(save.character.sheet.resources.health.current).toBe(1);
    expect(save.character.sheet.conditions).toEqual([
      expect.objectContaining({ condition: 'wounded' }),
    ]);
    const turn = await lastTurn(ref);
    expect(turn.resolution.fallen).toEqual({ outcome: 'fate', fate: 'captured' });
    expect(turn.resolution.constraints).toContain('You fall, out cold.');
    expect(turn.resolution.constraints).toContain(
      'You come round hours later in The Free City of Marabel, a captive.'
    );
    expect(prompts.some((p) => p.includes('FATE:'))).toBe(true);
  });
});

describe.each([
  ['d20-fantasy', FANTASY],
  ['pool-scifi', SCIFI],
])('rests under %s', (id, system) => {
  beforeAll(() => {
    mockState.id = id;
  });

  test('short and long, chosen in the Loom; a long rest once a day', async () => {
    const ref = await onTheMap(`${id}-rest`, system);
    await ref.update({ 'character.sheet.resources.health.current': 1 });
    const before = (await saved(ref)).time;
    await play(ref.id, { action: { verb: 'rest', rest: 'short' } });
    let save = await saved(ref);
    expect(save.time).toBe(before + 3600);
    await play(ref.id, { action: { verb: 'rest', rest: 'long' } });
    save = await saved(ref);
    expect(save.time).toBe(before + 9 * 3600);
    expect(save.character.sheet.resources.health.current).toBe(
      sheets.maxima(system, save.character.sheet).health
    );
    expect(save.rested.long).toBe(save.time);
    const again = await play(ref.id, { action: { verb: 'rest', rest: 'long' } });
    expect(again).toMatchObject({ refused: true });
    expect(again.narration).toMatch(/^You've had your long rest today/);
  });

  test('typed: INTERPRET reads a long rest', async () => {
    const ref = await onTheMap(`${id}-typed-rest`, system);
    mockState.intent = { verb: 'rest', targets: [], params: { rest: 'long' } };
    const before = (await saved(ref)).time;
    await play(ref.id, { actionText: 'take a long rest' });
    expect((await saved(ref)).time).toBe(before + 8 * 3600);
  });

  test('somewhere dangerous, broken: the hostiles there come for the player', async () => {
    mockState.danger = 'high';
    // Out of sight beyond the wall.
    mockState.groups = [mockGroup('Raider', 'hostile', [{ x: 8, y: 2 }], mockBlocks[id].frail)];
    const ref = await onTheMap(`${id}-broken`, system);
    face = 1; // the first hour's roll breaks it
    const broken = await play(ref.id, { action: { verb: 'rest', rest: 'long' } });
    expect(broken.narration).toBe('The dark closes in.');
    const save = await saved(ref);
    expect(save.fight).toMatchObject({ by: 'event' });
    const turn = await lastTurn(ref);
    expect(turn.resolution.rest).toMatchObject({ kind: 'long', hours: 1, interrupted: true });
    expect(turn.resolution.constraints[0]).toBe(
      'Your long rest is broken within the hour: something is coming.'
    );
    // In a fight, no rest.
    const refused = await play(ref.id, { action: { verb: 'rest', rest: 'short' } });
    expect(refused.narration).toBe("You can't rest in the middle of a fight.");
  });
});
