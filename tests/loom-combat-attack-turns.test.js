'use strict';

/**
 * Attacks in play (planning/combat.md §3 AT1–AT5, DF4, EN5, §4.4; L-822 /
 * #654), through loomPlayTurn with Gemini stubbed, under both built-in
 * systems (MD2): the player attacks a foe with one of their attacks, chosen
 * on the map or typed; the roll comes back as the turn's roll card and the
 * damage is taken from the foe's health in the save (`save.figures`), with
 * no model call while the fight goes on; out of reach is refused plainly; a
 * second attack in a turn is refused; the foe falling ends the fight,
 * narrated; struck to subdue, they are knocked out, not killed; loomGetMap
 * shows them down.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-combat-attack-turns --verbose"
 */

const PROJECT = 'demo-loom-combat-attack-turns';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// A hall 8 × 5, in at the west door; Grell stands at the east end, in sight.
const mockHall = () => ({
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
});
// Each system's player hits Grell with every die a 9: the fantasy d20 beats
// Armour, the sci-fi pools outnumber Grell's.
const mockCases = {
  'd20-fantasy': {
    system: FANTASY,
    melee: 'sword',
    ranged: 'bow',
    skills: {},
    // Tough: 10 hit points.
    grell: { attributes: { STR: 10, DEX: 10, CON: 18, INT: 10, WIS: 10, CHA: 10 } },
  },
  'pool-scifi': {
    system: SCIFI,
    melee: 'knife',
    ranged: 'pistol',
    // Athletics: Grell's blows (L-824: foes fight back) are dodged.
    skills: { Melee: 2, Shooting: 2, Athletics: 2 },
    // Tough: 8 Health.
    grell: { attributes: { Body: 5, Reflex: 3, Mind: 3, Presence: 3 } },
  },
};

const mockState = { id: 'd20-fantasy', side: 'hostile', intent: null };
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
        characters: {
          ...COAST.characters,
          grell: {
            id: 'grell',
            name: 'Grell',
            description: 'A bandit with a notched blade.',
            locationId: 'widows-reach',
            cell: { x: 6, y: 2 },
            sheet: jest
              .requireActual('../functions/loom-canon/sheets')
              .sheetFromStatBlock(c.system, c.grell),
            ...(mockState.side !== 'neutral' ? { side: mockState.side } : {}),
          },
        },
        battleMaps: { bm_hall: mockHall() },
      };
    },
  };
});
const prompts = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) {
      prompts.push({ interpret: options.systemInstruction });
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

let face = 9; // every die rolls this
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

describe.each(Object.keys(mockCases))('attacks under %s', (id) => {
  const c = mockCases[id];
  const narrated = () => prompts.filter((p) => typeof p === 'string');
  beforeAll(() => {
    mockState.id = id;
  });
  beforeEach(() => {
    mockState.side = 'hostile';
    mockState.intent = null;
    face = 9;
    prompts.length = 0;
  });

  async function onTheMap(saveId) {
    const sheet = sheets.defaultSheet(c.system);
    sheet.skills = { ...sheet.skills, ...c.skills };
    sheet.attributes = { ...sheet.attributes, ...(c.attributes || {}) };
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
  const attack = (ref, extra = {}) =>
    play(ref.id, { action: { verb: 'attack', target: 'grell', ...extra } });
  const healthOf = (save) => save.figures.grell.sheet.resources.health.current;
  const grellsFull = () =>
    sheets.maxima(c.system, sheets.sheetFromStatBlock(c.system, c.grell)).health;

  test('chosen on the map: rolled and ruled, the damage in the save, until Grell falls', async () => {
    const ref = await onTheMap(`${id}-ranged`);
    const step = await play(ref.id, { action: { verb: 'move', cell: { x: 2, y: 2 } } });
    expect(step.step.fight).toBe(true);
    prompts.length = 0;

    // Out of reach: refused plainly, nothing spent.
    const far = await attack(ref, { attack: c.melee });
    expect(far).toMatchObject({ refused: true });
    expect(far.narration).toMatch(/^Grell is out of reach of your \w+: get closer\.$/);
    expect((await saved(ref)).turn.actionUsed).toBe(false);

    // From here, the ranged attack: its roll is the card, the damage in the save.
    const full = grellsFull();
    const shot = await attack(ref, { attack: c.ranged });
    expect(shot.roll).toMatchObject({ against: 'Grell', success: true });
    expect(shot.narration).toMatch(/^You hit Grell with your \w+ for \d+ \w+/);
    let save = await saved(ref);
    expect(healthOf(save)).toBeLessThan(full);
    expect(save.turn.actionUsed).toBe(true);
    const turns = await ref.collection('loom_turns').orderBy('index', 'desc').get();
    expect(turns.docs[0].data().resolution).toMatchObject({
      ruled: true,
      attack: { id: c.ranged, targets: [expect.objectContaining({ id: 'grell', hit: true })] },
    });

    // A second attack this turn is refused.
    const again = await attack(ref, { attack: c.ranged });
    expect(again).toMatchObject({
      refused: true,
      narration: "You've acted this turn. End your turn first.",
    });

    // Round after round until Grell falls: no model call until the fight ends.
    for (let round = 0; round < 6 && (await saved(ref)).fight; round++) {
      await play(ref.id, { action: { verb: 'end-turn' } });
      await attack(ref, { attack: c.ranged });
    }
    save = await saved(ref);
    expect(save.fight).toBeNull();
    expect(save.figures.grell).toMatchObject({ down: 'dead' });
    expect(healthOf(save)).toBe(0);
    expect(narrated()).toHaveLength(1);
    expect(narrated()[0]).toContain('FIGHT ENDS');
    expect(narrated()[0]).toContain('Grell falls, dead.');

    // The map shows them down; attacking them again is refused.
    const view = await loomGetMap.run({
      data: { worldId: 'shattered-coast', saveId: ref.id },
      auth: PLAYER,
    });
    expect(view.battleMap.people).toContainEqual(
      expect.objectContaining({ id: 'grell', down: 'dead' })
    );
    await play(ref.id, { action: { verb: 'end-turn' } });
    const dead = await attack(ref, {});
    expect(dead).toMatchObject({ refused: true, narration: 'Grell is already down.' });
  });

  test('typed, at a neutral, to subdue: it starts a fight, and Grell is knocked out', async () => {
    mockState.side = 'neutral';
    face = 15; // past Subdue's penalty
    const ref = await onTheMap(`${id}-subdue`);
    await play(ref.id, { action: { verb: 'move', cell: { x: 5, y: 2 } } });
    mockState.intent = {
      verb: 'attack',
      targets: ['grell'],
      params: { attack: c.melee, subdue: true },
    };
    const first = await play(ref.id, { actionText: 'knock Grell out' });
    expect(first.roll).toMatchObject({ against: 'Grell' });
    // INTERPRET was told the player's attacks.
    const told = prompts.find((p) => p.interpret).interpret;
    expect(told).toContain(`${c.melee} (`);
    expect(told).toContain('params.subdue: true');
    let save = await saved(ref);
    // The first blow lands but doesn't drop Grell: the fight is on.
    expect(narrated()[0]).toContain('FIGHT STARTS: a fight breaks out as the player attacks');
    expect(save.fight.combatants.grell).toMatchObject({ side: 'hostile', joined: true });
    for (let round = 0; round < 8 && (await saved(ref)).fight; round++) {
      await play(ref.id, { action: { verb: 'end-turn' } });
      await attack(ref, { attack: c.melee, subdue: true });
    }
    save = await saved(ref);
    expect(save.fight).toBeNull();
    expect(save.figures.grell).toMatchObject({ down: 'out' });
    const turns = await ref.collection('loom_turns').orderBy('index', 'desc').limit(1).get();
    expect(turns.docs[0].data().resolution.constraints).toContain('Grell falls, knocked out.');
  });

  test('a miss is a roll card too, and does nothing', async () => {
    face = 1;
    const ref = await onTheMap(`${id}-miss`);
    await play(ref.id, { action: { verb: 'move', cell: { x: 5, y: 2 } } });
    prompts.length = 0;
    const swing = await attack(ref, { attack: c.melee });
    expect(swing.roll).toMatchObject({ against: 'Grell', success: false });
    expect(swing.narration).toBe('You miss Grell.');
    const save = await saved(ref);
    expect(healthOf(save)).toBe(grellsFull());
    expect(narrated()).toHaveLength(0);
  });
});
