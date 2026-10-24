'use strict';

/**
 * Confirm first, walk there, then act (#673), with Gemini stubbed, under
 * both built-in systems: talking with someone or examining or using a thing
 * needs the player beside it (out of a fight); a typed action out of reach,
 * and every one of the GM's suggestions, answers with what it would do (the
 * walk, the action, any roll, its cost), spending nothing; Do it walks over
 * (on a battle map, or to the place in town) and then acts; anything else
 * drops it; an interrupted walk doesn't act; talking and looking roll
 * nothing; the GM's suggestions are checked.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-confirm --verbose"
 */

const PROJECT = 'demo-loom-confirm';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const { sanitizeSuggestions } = require('../functions/loom-turn/narrate');

// An inn 12 × 6: the ale tap on the north wall, Mira the innkeeper, the door
// out to the west.
const mockInn = () => ({
  id: 'bm_inn',
  name: 'The inn',
  width: 12,
  height: 6,
  image: null,
  entries: [{ id: 'door', x: 1, y: 3 }],
  exits: [{ id: 'out', name: 'the street door', x: 0, y: 3, to: 'out' }],
  features: [{ id: 'tap', name: 'the ale tap', x: 6, y: 0 }],
  walls: [],
  doors: [],
  obstacles: [],
  hazards: [],
});

const mockCases = {
  'd20-fantasy': BUILT_IN['d20-fantasy'],
  'pool-scifi': BUILT_IN['pool-scifi'],
};
const mockState = { id: 'd20-fantasy', intent: null, interprets: 0 };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  const place = (id, name, connections, extra = {}) => ({
    id,
    locationId: 'free-city-of-marabel',
    name,
    kind: 'district',
    description: name + '.',
    connections,
    npcIds: [],
    rules: {},
    entrance: null,
    ...extra,
  });
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
        places: {
          plc_gate: place('plc_gate', 'The Sea Gate', ['plc_market'], {
            entrance: { via: ['road', 'trail', 'sea'] },
          }),
          plc_market: place('plc_market', 'The Market', ['plc_gate', 'plc_tavern']),
          plc_tavern: place('plc_tavern', 'The Lantern', ['plc_market']),
        },
        characters: {
          ...COAST.characters,
          mira: {
            id: 'mira',
            name: 'Mira',
            description: 'The innkeeper.',
            locationId: 'widows-reach',
            cell: { x: 9, y: 1 },
          },
          bram: {
            id: 'bram',
            name: 'Bram',
            description: 'A lamplighter.',
            locationId: 'free-city-of-marabel',
            placeId: 'plc_tavern',
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
    if (options.systemInstruction.includes('INTERPRET stage')) {
      mockState.interprets += 1;
      return mockState.intent;
    }
    prompts.push(options.userMessage);
    return { narration: 'She looks up.', inventedEntities: [], suggestedActions: [] };
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
const beside = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

describe("the GM's suggestions, checked", () => {
  const known = [{ id: 'mira' }, { id: 'feature:tap' }];
  test('text, a one-word verb, and a target only when it is known; at most 4', () => {
    expect(
      sanitizeSuggestions(
        [
          { text: 'talk to Mira', verb: 'talk', target: 'mira' },
          { text: 'look at the ghost', verb: 'look', target: 'ghost' },
          { text: 'do it', verb: 'two words' },
          'rest a while',
          { verb: 'talk' },
          { text: 'one' },
          { text: 'two' },
        ],
        known
      )
    ).toEqual([
      { text: 'talk to Mira', verb: 'talk', target: 'mira' },
      { text: 'look at the ghost', verb: 'look' },
      { text: 'do it' },
      { text: 'rest a while' },
    ]);
  });
});

describe.each(Object.keys(mockCases))('confirm first under %s', (id) => {
  const system = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });
  beforeEach(() => {
    prompts.length = 0;
    mockState.interprets = 0;
  });

  async function onTheMap(saveId, cell, extra = {}) {
    const ref = db.collection('loom_saves').doc(saveId);
    await ref.set({
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
      ...extra,
    });
    return ref;
  }
  const play = (ref, data) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, ...data },
      auth: PLAYER,
    });
  const type = (ref, actionText) => play(ref, { actionText });
  const confirm = (ref) => play(ref, { action: { verb: 'confirm' } });
  const saved = async (ref) => (await ref.get()).data();
  const turns = async (ref) =>
    (await ref.collection('loom_turns').orderBy('index').get()).docs.map((d) => d.data());

  test('typed, out of reach: what it would do, nothing spent; Do it walks over, then talks', async () => {
    const ref = await onTheMap(`${id}-talk`, { x: 2, y: 3 });
    mockState.intent = { verb: 'talk', targets: ['mira'], params: {} };
    const before = await saved(ref);
    const asked = await type(ref, 'talk to Mira');
    expect(asked).toMatchObject({ refused: true, confirm: { action: 'talk to Mira' } });
    expect(asked.confirm.lines).toEqual([
      'Walk 6 squares to Mira.',
      'Then: Talk to Mira.',
      'No roll.',
      'Costs 2 AP.',
    ]);
    let save = await saved(ref);
    expect(save.cell).toEqual(before.cell);
    expect(save.turn).toEqual(before.turn);
    expect(save.pending).toMatchObject({ actionText: 'talk to Mira' });
    expect(await turns(ref)).toHaveLength(0);
    expect(prompts).toHaveLength(0);

    const done = await confirm(ref);
    save = await saved(ref);
    expect(beside(save.cell, { x: 9, y: 1 })).toBe(true);
    expect(save.pending).toBeUndefined();
    // The 6 squares walked and the 2 AP the words cost (L-832).
    expect(save.turn.ap).toBe(20 - 6 - 2);
    expect(done.narration).toMatch(/She looks up\.$/);
    // Talking rolls nothing, and INTERPRET was asked once, when typed.
    expect(done.roll).toBeUndefined();
    expect(mockState.interprets).toBe(1);
    const last = (await turns(ref)).pop();
    expect(last.actionText).toBe('talk to Mira');
    expect(last.resolution.roll).toBeUndefined();
  });

  test('typed, in reach: done at once, no card, no roll', async () => {
    const ref = await onTheMap(`${id}-near`, { x: 8, y: 1 });
    mockState.intent = { verb: 'talk', targets: ['mira'], params: {} };
    const answer = await type(ref, 'talk to Mira');
    expect(answer.confirm).toBeUndefined();
    expect(answer.narration).toBe('She looks up.');
    expect(answer.roll).toBeUndefined();
  });

  test('anything else drops what was waiting; Do it then has nothing to do', async () => {
    const ref = await onTheMap(`${id}-cancel`, { x: 2, y: 3 });
    mockState.intent = { verb: 'talk', targets: ['mira'], params: {} };
    await type(ref, 'talk to Mira');
    expect((await saved(ref)).pending).toBeDefined();
    await play(ref, { action: { verb: 'end-turn' } });
    expect((await saved(ref)).pending).toBeUndefined();
    const nothing = await confirm(ref);
    expect(nothing).toMatchObject({ refused: true });
    expect(nothing.narration).toBe('There is nothing waiting to be done.');
    expect((await saved(ref)).cell).toEqual({ x: 2, y: 3 });
  });

  test('a suggestion naming its verb and target: no INTERPRET, the card even in reach', async () => {
    const ref = await onTheMap(`${id}-suggest`, { x: 8, y: 1 });
    const asked = await play(ref, {
      action: { verb: 'suggested', text: 'greet Mira', act: { verb: 'greet', target: 'mira' } },
    });
    expect(mockState.interprets).toBe(0);
    expect(asked.confirm.lines).toEqual(['Greet Mira.', 'No roll.', 'Costs 2 AP.']);
    expect((await saved(ref)).turn.ap).toBe(20);
    const done = await confirm(ref);
    expect(done.narration).toBe('She looks up.');
    expect(done.roll).toBeUndefined();
    expect((await saved(ref)).turn.ap).toBe(18);
    expect(mockState.interprets).toBe(0);
  });

  test('a suggestion to examine something in sight is "What\'s here?" (#672): free, no card', async () => {
    const ref = await onTheMap(`${id}-examine`, { x: 2, y: 3 });
    const before = await saved(ref);
    const answer = await play(ref, {
      action: {
        verb: 'suggested',
        text: 'examine the ale tap',
        act: { verb: 'examine', target: 'feature:tap' },
      },
    });
    expect(answer.confirm).toBeUndefined();
    expect(answer.narration).toBe('She looks up.');
    expect((await saved(ref)).turn).toEqual(before.turn);
    expect(mockState.interprets).toBe(0);
  });

  test('a suggestion with words only is read by INTERPRET, and shows its roll', async () => {
    const ref = await onTheMap(`${id}-words`, { x: 2, y: 3 });
    const attribute = system.sheet.attributes[0];
    const rung = system.checks.ladder[1].name;
    mockState.intent = {
      verb: 'persuade',
      targets: ['mira'],
      params: { check: { attribute: attribute.id, rung } },
    };
    const asked = await play(ref, {
      action: { verb: 'suggested', text: 'talk Mira into a free room' },
    });
    expect(mockState.interprets).toBe(1);
    expect(asked.confirm.lines).toContain(
      'A roll: ' + (attribute.name || attribute.id) + ', ' + rung + '.'
    );
  });

  test('in a fight, a walk past this turn stops partway, and the action waits', async () => {
    const ref = await onTheMap(
      `${id}-fight`,
      { x: 1, y: 5 },
      {
        turn: { n: 1, ap: 2, kept: 0, plan: null },
        fight: {
          id: 'fight-1',
          mapId: 'bm_inn',
          by: 'gm',
          round: 1,
          order: ['player', 'mira'],
          turn: 'player',
          combatants: {
            player: {
              kind: 'player',
              side: 'party',
              name: 'Tam',
              initiative: 15,
              reactionsLeft: 1,
            },
            mira: {
              kind: 'character',
              side: 'hostile',
              name: 'Mira',
              initiative: 5,
              reactionsLeft: 1,
            },
          },
        },
      }
    );
    mockState.intent = { verb: 'use', targets: ['feature:tap'], params: {} };
    const asked = await type(ref, 'pull the ale tap');
    expect(asked.confirm.lines[0]).toMatch(
      /^Walk \d+ squares to the ale tap: more than this turn, so you stop partway/
    );
    const done = await confirm(ref);
    expect(done.narration).toMatch(/The rest of the way to the ale tap is kept for next turn\.$/);
    const save = await saved(ref);
    // Its 2 AP walked, the action not taken.
    expect(save.turn).toMatchObject({ ap: 0, moved: 2 });
    expect(save.cell).not.toEqual({ x: 1, y: 5 });
  });

  test('in town: someone at another place; Do it goes there, then talks', async () => {
    const ref = db.collection('loom_saves').doc(`${id}-town`);
    await ref.set({
      ...makeSave({
        ownerUid: PLAYER.uid,
        worldId: 'shattered-coast',
        name: 'Voyage',
        character: { name: 'Tam', sheet: sheets.defaultSheet(system) },
        location: 'free-city-of-marabel',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      placeId: 'plc_gate',
    });
    mockState.intent = { verb: 'talk', targets: ['bram'], params: {} };
    const asked = await type(ref, 'ask Bram about the lamps');
    expect(asked.confirm.lines.slice(0, 2)).toEqual([
      'Go to The Lantern, where Bram is.',
      'Then: Ask Bram about the lamps.',
    ]);
    const done = await confirm(ref);
    const save = await saved(ref);
    expect(save.placeId).toBe('plc_tavern');
    // The walk there and the talk, each told.
    expect(done.narration).toBe('She looks up. She looks up.');
    // In town, talking costs no AP (L-832; WH2).
    expect(save.turn.ap).toBe(20);
    expect((await turns(ref)).map((t) => t.actionText)).toEqual([
      'travel to The Lantern',
      'ask Bram about the lamps',
    ]);
    expect(done.roll).toBeUndefined();
  });
});
