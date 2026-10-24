'use strict';

/**
 * Named characters' turns in play (planning/combat.md §3 EN3b, EN5; L-825 /
 * #657), through loomPlayTurn with Gemini stubbed, under both built-in
 * systems (MD2): at End turn in a fight, Grell (a named character) has his
 * turn chosen by the model from the rules' list, his combatNotes in its
 * prompt; the choice is played and recorded; the round is narrated once.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-combat-named-play --verbose"
 */

const PROJECT = 'demo-loom-combat-named-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const mockCases = {
  'd20-fantasy': { system: BUILT_IN['d20-fantasy'] },
  'pool-scifi': { system: BUILT_IN['pool-scifi'] },
};
const NOTES = 'Never closes in; keeps his distance and waits for an opening.';

const mockState = { id: 'd20-fantasy', choice: null };
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
            description: 'A bandit with a notched blade.',
            combatNotes: NOTES,
            locationId: 'widows-reach',
            cell: { x: 8, y: 2 },
            side: 'hostile',
            sheet: sheetsReal.defaultSheet(c.system),
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
            walls: [],
            doors: [],
            obstacles: [],
            hazards: [],
          },
        },
      };
    },
  };
});
const turnPrompts = [];
const narrated = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('COMBAT TURN stage')) {
      turnPrompts.push(options.userMessage);
      const line = options.userMessage
        .split('\n')
        .find((l) => l.includes(mockState.choice) && /^- o\d+: /.test(l));
      return line
        ? { choice: /^- (o\d+):/.exec(line)[1], reason: 'Patience wins.' }
        : { choice: 'nonsense' };
    }
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return { verb: 'look', targets: [], params: {} };
    }
    narrated.push(options.userMessage);
    return { narration: 'Grell circles, wary.', inventedEntities: [], suggestedActions: [] };
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

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

describe.each(Object.keys(mockCases))('named turns in play under %s', (id) => {
  const c = mockCases[id];
  beforeAll(() => {
    mockState.id = id;
  });
  beforeEach(() => {
    turnPrompts.length = 0;
    narrated.length = 0;
  });

  async function inAFight(saveId) {
    await db
      .collection('loom_saves')
      .doc(saveId)
      .set({
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
        cell: { x: 2, y: 2 },
        fight: {
          id: 'fight-1',
          mapId: 'bm_hall',
          by: 'seen',
          round: 1,
          order: ['player', 'grell'],
          turn: 'player',
          combatants: {
            player: {
              kind: 'player',
              side: 'party',
              name: 'Tam',
              initiative: 15,
              reactionsLeft: 1,
            },
            grell: {
              kind: 'character',
              side: 'hostile',
              name: 'Grell',
              initiative: 5,
              reactionsLeft: 1,
            },
          },
        },
      });
    return db.collection('loom_saves').doc(saveId);
  }
  const endTurn = (ref) =>
    loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId: ref.id, action: { verb: 'end-turn' } },
      auth: PLAYER,
    });

  test('the model chooses Grell’s turn from the rules’ list, his notes in hand; one passage', async () => {
    mockState.choice = 'Dodge';
    const ref = await inAFight(`${id}-dodge`);
    const answer = await endTurn(ref);
    expect(turnPrompts).toHaveLength(1);
    expect(turnPrompts[0]).toContain(`HOW THEY FIGHT: ${NOTES}`);
    expect(turnPrompts[0]).toContain('- the player (foe), 6 squares away');
    const save = (await ref.get()).data();
    expect(save.fight.combatants.grell.dodging).toBe(true);
    expect(save.fight).toMatchObject({ round: 2, turn: 'player' });
    // Narrated once, the rules' lines first.
    expect(narrated).toHaveLength(1);
    expect(narrated[0]).toContain('NAMED CHARACTERS ACTED this round');
    expect(narrated[0]).toContain(
      '- Grell’s choice: stay where you are and Dodge: harder to hit until your next turn ' +
        '(8 AP, keeping 12 to react) ("Patience wins.").'
    );
    expect(answer.narration).toContain('Grell keeps their guard up.');
    expect(answer.narration).toMatch(/Grell circles, wary\.$/);
    const turns = await ref.collection('loom_turns').get();
    expect(turns.docs[0].data().resolution.named).toEqual([
      expect.objectContaining({ id: 'grell', reason: 'Patience wins.' }),
    ]);
  });

  test('an answer naming no choice: Grell fights by his role', async () => {
    mockState.choice = 'nothing like this';
    const ref = await inAFight(`${id}-illegal`);
    await endTurn(ref);
    const save = (await ref.get()).data();
    expect(save.fight.combatants.grell.dodging).toBeUndefined();
    // A brute closes on the player.
    expect(save.figures.grell.cell.x).toBeLessThan(8);
    const turns = await ref.collection('loom_turns').get();
    expect(turns.docs[0].data().resolution.named).toEqual([
      { id: 'grell', name: 'Grell', did: null, fallback: 'illegal' },
    ]);
  });
});
