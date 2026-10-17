'use strict';

/**
 * NPC sheets (planning/game-systems.md §3 CS7, GR3; L-813 / #640): the stat
 * block, the short form a named character's sheet (and L-790's templates)
 * can be given in; and an opposed check through loomPlayTurn rolling the
 * other side's own sheet. Under both built-in systems (MD2). The MCP tools
 * (set_sheet, get_character, test_roll) are in cartographer-mcp-systems,
 * the grading criterion in loom-grading-score.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-npc-sheets --verbose"
 */

const PROJECT = 'demo-loom-npc-sheets';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// The guard's stat block in each system: keen-eyed, light on their feet.
const GUARD = {
  'd20-fantasy': {
    attributes: { STR: 12, DEX: 16, CON: 12, INT: 10, WIS: 14, CHA: 8 },
    skills: { Stealth: 3, Perception: 4 },
    level: 2,
  },
  'pool-scifi': {
    attributes: { Body: 3, Reflex: 4, Mind: 3, Presence: 2 },
    skills: { Stealth: 2 },
  },
};

describe.each([
  ['d20-fantasy', FANTASY],
  ['pool-scifi', SCIFI],
])('a stat block under %s', (id, system) => {
  test('stands for a full sheet: its own values, the defaults for the rest', () => {
    const block = GUARD[id];
    expect(sheets.validateStatBlock(system, block)).toEqual([]);
    const sheet = sheets.sheetFromStatBlock(system, block);
    expect(sheets.validateSheet(system, sheet)).toEqual([]);
    expect(sheet.attributes).toEqual(block.attributes);
    expect(sheet.skills).toMatchObject({ ...block.skills, Athletics: 0 });
    expect(sheet.level).toBe(block.level || 1);
    // Every resource full for these scores.
    const max = sheets.maxima(system, sheet);
    for (const [rid, r] of Object.entries(sheet.resources)) expect(r.current).toBe(max[rid]);
    expect(sheet.traits).toEqual([]);
  });

  test('every attribute is needed; anything else wrong is named', () => {
    const first = system.sheet.attributes[0];
    const missing = { ...GUARD[id].attributes };
    delete missing[first.id];
    expect(sheets.validateStatBlock(system, { attributes: missing })).toEqual([
      `${first.name} (${first.id}) has no score.`,
    ]);
    expect(
      sheets.validateStatBlock(system, { ...GUARD[id], skills: { Juggling: 1 }, level: 99 })
    ).toEqual([
      'There is no skill "Juggling" in this world\'s rules.',
      `The level is 99; it must be from 1 to ${system.sheet.level.max}.`,
    ]);
    expect(sheets.validateStatBlock(system, null)).toEqual(['The stat block must be an object.']);
  });
});

// ── An opposed check through loomPlayTurn ──────────────────────────────

const mockState = { system: FANTASY, guard: null };
jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  const { COAST } = jest.requireActual('./helpers/coast');
  return {
    ...real,
    loadWorld: async (worldId, options) =>
      worldId === COAST.id
        ? {
            ...COAST,
            system: mockState.system,
            characters: {
              ...COAST.characters,
              chr_guard: {
                id: 'chr_guard',
                name: 'The guard',
                locationId: 'widows-reach',
                ...(mockState.guard ? { sheet: mockState.guard } : {}),
              },
            },
          }
        : real.loadWorld(worldId, options),
  };
});
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return {
        verb: 'sneak',
        targets: [],
        params: { check: { skill: 'Stealth', opposedBy: 'chr_guard' } },
      };
    }
    return { narration: 'It happens.', inventedEntities: [], suggestedActions: [] };
  },
}));

describe.each([
  ['d20-fantasy', FANTASY],
  ['pool-scifi', SCIFI],
])('an opposed check against a named character under %s', (id, system) => {
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
    mockState.system = system;
    jest.spyOn(crypto, 'randomInt').mockImplementation((min) => min + 6); // every die a 7
  });
  afterAll(async () => {
    crypto.randomInt.mockRestore();
    mockState.guard = null;
    await db.recursiveDelete(db.collection('loom_saves'));
    functionsTest.cleanup();
  });

  async function sneak(saveId) {
    await db
      .collection('loom_saves')
      .doc(saveId)
      .set(
        makeSave({
          ownerUid: PLAYER.uid,
          worldId: 'shattered-coast',
          name: 'Voyage',
          character: { name: 'Tam', sheet: sheets.defaultSheet(system) },
          location: 'widows-reach',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      );
    await loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId, actionText: 'sneak past the guard' },
      auth: PLAYER,
    });
    const turns = await db.collection('loom_saves').doc(saveId).collection('loom_turns').get();
    return turns.docs[0].data().resolution;
  }

  test('the defender rolls their own sheet; without one, the defaults', async () => {
    mockState.guard = sheets.sheetFromStatBlock(system, GUARD[id]);
    const resolution = await sneak(`opposed-${id}-1`);
    expect(resolution.opposed).toMatchObject({ by: 'chr_guard', roll: { against: 'you' } });
    expect(resolution.opposed.roll.line).toBe(
      id === 'd20-fantasy'
        ? 'd20 (7) + Dexterity (3) + Stealth (3)' // DEX 16, Stealth 3
        : '(Reflex (4) + Stealth (2))d10 ≥ 7 (6)'
    );
    // The guard beats an untrained player on these dice.
    expect(resolution.outcome).toBe('failure');

    mockState.guard = null;
    const bare = await sneak(`opposed-${id}-2`);
    expect(bare.opposed.roll.line).toBe(
      id === 'd20-fantasy'
        ? 'd20 (7) + Dexterity (0) + Stealth (0)'
        : '(Reflex (3) + Stealth (0))d10 ≥ 7 (3)'
    );
  });
});
