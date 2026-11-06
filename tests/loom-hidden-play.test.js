'use strict';

/**
 * Hidden things and spawns in play (planning/maps-from-data.md §4.5; L-927 /
 * #731), through loomPlayTurn and loomGetMap with Gemini stubbed, under both
 * built-in systems (MD2), on the crypt (./helpers/crypt.js):
 *
 *   - a hidden trap triggers when walked into, which finds it;
 *   - a passive check after an action finds what is in sight, or misses it,
 *     once; the GM is told what is found and never what isn't;
 *   - Search (the menu's `{ verb: 'search' }`, or typed) rolls for everything
 *     in sight at the standard AP price, and says the same when it finds
 *     nothing;
 *   - what the page is sent leaves out what is not found, and shows it once
 *     it is;
 *   - a broken rest fills the map's spawns, and starts the fight;
 *   - the same generic map gets different figures from two events.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-hidden-play --verbose"
 */

const PROJECT = 'demo-loom-hidden-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const apRules = require('../functions/loom-canon/ap');

const CLUB = {
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
const FRAIL = {
  'd20-fantasy': { STR: 8, DEX: 8, CON: 3, INT: 8, WIS: 8, CHA: 8 },
  'pool-scifi': { Body: 1, Reflex: 1, Mind: 1, Presence: 1 },
};
const mockCases = {
  'd20-fantasy': {
    system: BUILT_IN['d20-fantasy'],
    trap: { condition: 'poisoned', save: { attribute: 'CON', against: 'Moderate' } },
  },
  'pool-scifi': {
    system: BUILT_IN['pool-scifi'],
    trap: { condition: 'bleeding', save: { attribute: 'Body', against: 'Moderate' } },
  },
};
const mockState = { id: 'd20-fantasy', rows: undefined, intent: null };
const block = (id, name) => ({
  id: name.toLowerCase(),
  name,
  statBlock: {
    attributes: FRAIL[id],
    ...(id === 'pool-scifi' ? { skills: { Melee: 3 } } : {}),
    attacks: [CLUB[id]],
  },
});
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  const { CRYPT } = jest.requireActual('./helpers/crypt');
  return {
    ...real,
    loadWorld: async (worldId, options) => {
      if (worldId !== COAST.id) return real.loadWorld(worldId, options);
      const c = mockCases[mockState.id];
      const blocks = ['Goblin', 'Wolf', 'Bandit'].map((n) => block(mockState.id, n));
      return {
        ...COAST,
        system: c.system,
        locations: {
          ...COAST.locations,
          'widows-reach': {
            ...COAST.locations['widows-reach'],
            battleMap: { mapId: 'bm_crypt' },
            danger: 'high',
            ...(mockState.rows ? { encounters: mockState.rows } : {}),
          },
        },
        battleMaps: { bm_crypt: CRYPT(c.trap) },
        statBlocks: Object.fromEntries(blocks.map((b) => [b.id, b])),
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
      return mockState.intent || { verb: 'look', targets: [], params: {} };
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
const { loomPlayTurn, loomGetMap } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const db = getFirestore();
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };

let face = 2; // every die rolls this (the most it can, if it has fewer sides)
beforeAll(() => {
  jest
    .spyOn(crypto, 'randomInt')
    .mockImplementation((min, max) => Math.min(max - 1, min + face - 1));
});
afterAll(async () => {
  crypto.randomInt.mockRestore();
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

describe.each(Object.keys(mockCases))('hidden things and spawns in play under %s', (id) => {
  const system = mockCases[id].system;
  const standard = apRules.tierCost(system, 'standard');
  const AP = 40;
  beforeAll(() => {
    mockState.id = id;
  });
  beforeEach(() => {
    mockState.rows = undefined;
    mockState.intent = null;
  });

  // A save on the crypt at `cell`, a turn of AP (40: room to walk and search twice).
  async function standing(saveId, cell = { x: 1, y: 6 }) {
    const ref = db.collection('loom_saves').doc(saveId);
    await ref.set({
      ...makeSave({
        ownerUid: PLAYER.uid,
        worldId: 'shattered-coast',
        name: 'Voyage',
        character: { name: 'Tam', inventory: [], sheet: sheets.defaultSheet(system) },
        location: 'widows-reach',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      mapId: 'bm_crypt',
      cell,
      turn: { n: 1, ap: AP, kept: 0, plan: null },
    });
    return ref;
  }
  const play = (ref, data) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, ...data },
      auth: PLAYER,
    });
  const saved = async (ref) => (await ref.get()).data();
  const viewOf = async (ref) =>
    (await loomGetMap.run({ data: { worldId: 'shattered-coast', saveId: ref.id }, auth: PLAYER }))
      .battleMap;
  const told = () => mockPrompts.join('\n');
  // One step along the vestibule's floor, away from everything hidden.
  const step = (ref) => play(ref, { action: { verb: 'move', cell: { x: 2, y: 6 } } });

  test('a hidden trap springs when walked into, and that finds it', async () => {
    face = 2;
    const ref = await standing(`${id}-trap`, { x: 2, y: 4 });
    // Not in the page's view: nothing hidden is sent.
    const before = await viewOf(ref);
    expect(before.hazards || []).toEqual([]);
    expect(JSON.stringify(before)).not.toMatch(/pit|secret|cache/);
    mockPrompts.length = 0;
    const answer = await play(ref, { action: { verb: 'move', cell: { x: 4, y: 4 } } });
    // It stopped where it walked in, and its save was rolled and failed.
    expect(answer.step).toMatchObject({ cell: { x: 3, y: 4 }, hazard: 'pit' });
    expect(answer.roll).toMatchObject({ against: 'save: the pit trap', success: false });
    const save = await saved(ref);
    expect(save.cell).toEqual({ x: 3, y: 4 });
    expect(save.character.sheet.conditions).toEqual([
      expect.objectContaining({ condition: mockCases[id].trap.condition }),
    ]);
    expect(save.secrets.bm_crypt['hazard:pit']).toBe('found');
    expect(told()).toContain('HAZARD: the player walked into the pit trap');
    // Found: drawn, from then on, with the squares it covers.
    const after = await viewOf(ref);
    expect(after.hazards.map((h) => h.id)).toEqual(['pit']);
    expect(after.hazards[0].squares).toHaveLength(4);
  });

  test('a passive check after an action finds what is in sight: told to the GM, drawn, usable', async () => {
    face = 20;
    const ref = await standing(`${id}-passive`);
    mockPrompts.length = 0;
    const answer = await step(ref);
    const save = await saved(ref);
    expect(save.secrets.bm_crypt).toEqual({
      secret: 'found',
      cache: 'found',
      'hazard:pit': 'found',
    });
    // A step is the rules' alone, so what it finds is its own narration.
    expect(answer.narration).toContain('You notice a secret door.');
    expect(answer.narration).toContain('You notice a cache.');
    expect(answer.step.lines).toContain('You notice the pit trap.');
    const view = await viewOf(ref);
    expect(view.geometry.doors.map((d) => d.id)).toEqual(['secret']);
    expect(view.objects.map((o) => o.id)).toEqual(['cache']);
    expect(view.hazards.map((h) => h.id)).toEqual(['pit']);
    // The door was always a wall to walk into; found, it is a door.
    expect(JSON.stringify(view)).not.toMatch(/"dc"/);
  });

  test('a miss is said nothing of, and not rolled again by a passive check', async () => {
    face = 1;
    const ref = await standing(`${id}-miss`);
    mockPrompts.length = 0;
    const answer = await step(ref);
    expect((await saved(ref)).secrets.bm_crypt).toEqual({
      secret: 'missed',
      cache: 'missed',
      'hazard:pit': 'missed',
    });
    expect(`${answer.narration} ${told()}`).not.toMatch(/You notice|secret door|cache|pit trap/);
    expect(JSON.stringify(await viewOf(ref))).not.toMatch(/secret|cache|pit/);
    // However well it would roll now, a miss stays a miss until Search.
    face = 20;
    await play(ref, { action: { verb: 'move', cell: { x: 1, y: 6 } } });
    expect((await saved(ref)).secrets.bm_crypt.secret).toBe('missed');
  });

  test('Search rolls for everything in sight at the standard price, and finds what was missed', async () => {
    face = 1;
    const ref = await standing(`${id}-search`);
    await step(ref);
    expect((await saved(ref)).turn.ap).toBe(AP - 1);
    face = 20;
    mockPrompts.length = 0;
    const answer = await play(ref, { action: { verb: 'search' } });
    expect(answer.narration).toBeTruthy();
    const save = await saved(ref);
    expect(save.secrets.bm_crypt).toEqual({
      secret: 'found',
      cache: 'found',
      'hazard:pit': 'found',
    });
    expect(save.turn.ap).toBe(AP - 1 - standard);
    expect(told()).toContain('You find a secret door.');
    expect(told()).toContain('You find the pit trap.');
    // Nothing left: it says so plainly, and still costs the same.
    mockPrompts.length = 0;
    await play(ref, { action: { verb: 'search' } });
    expect(told()).toContain('You search the area carefully and find nothing new.');
    expect((await saved(ref)).turn.ap).toBe(AP - 1 - standard * 2);
  });

  test('a search where nothing was ever hidden says the same, and costs the same', async () => {
    face = 20;
    const ref = await standing(`${id}-nothing`);
    // Found it all, then searched with nothing left; against a fresh save on a
    // map with nothing found yet that finds nothing (a miss): both read alike.
    face = 1;
    mockPrompts.length = 0;
    await play(ref, { action: { verb: 'search' } });
    expect(told()).toContain('You search the area carefully and find nothing new.');
    expect((await saved(ref)).turn.ap).toBe(AP - standard);
  });

  test('typed, a search of the room is the same action', async () => {
    face = 20;
    const ref = await standing(`${id}-typed`);
    mockState.intent = { verb: 'search', targets: [], params: {} };
    mockPrompts.length = 0;
    await play(ref, { actionText: 'search the room' });
    const save = await saved(ref);
    expect(save.secrets.bm_crypt.secret).toBe('found');
    expect(save.turn.ap).toBe(AP - standard);
    expect(told()).toContain('You find a secret door.');
  });

  test('found for this save only: another save of the world sees none of it', async () => {
    face = 20;
    const mine = await standing(`${id}-mine`);
    await step(mine);
    const other = await standing(`${id}-other`);
    expect((await viewOf(mine)).geometry.doors.map((d) => d.id)).toEqual(['secret']);
    const view = await viewOf(other);
    expect((view.geometry.doors || []).map((d) => d.id)).toEqual([]);
    expect(view.hazards || []).toEqual([]);
    expect((await saved(other)).secrets).toBeUndefined();
  });

  test('a rest broken fills the map’s spawns, and the fight starts with them', async () => {
    face = 1; // the first hour's roll breaks it
    mockState.rows = [{ what: 'wolf', count: 2, weight: 1 }];
    const ref = await standing(`${id}-rest`);
    mockPrompts.length = 0;
    await play(ref, { action: { verb: 'rest', rest: 'long' } });
    const save = await saved(ref);
    expect(save.fight).toMatchObject({ by: 'event' });
    const groups = save.spawned.bm_crypt;
    // The den names its goblins; the generic corner took a row of the place's table.
    expect(groups.map((g) => [g.spawn, g.statBlock, g.cells.length])).toEqual([
      ['den', 'goblin', 2],
      ['corner', 'wolf', 2],
    ]);
    const fighters = Object.keys(save.fight.combatants);
    expect(fighters).toEqual(
      expect.arrayContaining([
        'fig-spawn-den-1-1',
        'fig-spawn-den-1-2',
        'fig-spawn-corner-1-1',
        'fig-spawn-corner-1-2',
      ])
    );
    // They are on the map the page is sent, by name.
    const names = (await viewOf(ref)).people.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Wolf 1', 'Wolf 2']));
    // Another save of the same world has none of them.
    expect((await saved(await standing(`${id}-rest-other`))).spawned).toBeUndefined();
  });

  test('the same generic map brings different figures to two events', async () => {
    mockState.rows = [
      { what: 'wolf', count: 2, weight: 1 },
      { what: 'bandit', weight: 3 },
    ];
    const first = await standing(`${id}-event-1`);
    face = 1; // breaks the rest; the table's roll is its first row
    await play(first, { action: { verb: 'rest', rest: 'long' } });
    const second = await standing(`${id}-event-2`);
    face = 2; // breaks the rest; the table's roll reaches its second row
    await play(second, { action: { verb: 'rest', rest: 'long' } });
    const corner = async (ref) =>
      (await saved(ref)).spawned.bm_crypt.find((g) => g.spawn === 'corner');
    expect(await corner(first)).toMatchObject({ statBlock: 'wolf', name: 'Wolf' });
    expect((await corner(first)).cells).toHaveLength(2);
    expect(await corner(second)).toMatchObject({ statBlock: 'bandit', name: 'Bandit' });
    expect((await corner(second)).cells).toHaveLength(1);
  });

  test('a rest that holds fills nothing', async () => {
    face = 6; // the hour's roll doesn't break it
    mockState.rows = [{ what: 'wolf' }];
    const ref = await standing(`${id}-calm`);
    await play(ref, { action: { verb: 'rest', rest: 'short' } });
    const save = await saved(ref);
    expect(save.fight).toBeUndefined();
    expect(save.spawned).toBeUndefined();
  });
});
