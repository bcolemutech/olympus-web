'use strict';

/**
 * Integration tests for the loomPlayTurn callable orchestrator (L-110, L-130
 * / #307).
 *
 * Runs the full §5 pipeline against the Firestore emulator with a mocked
 * functions/gemini.js — deterministic, no network calls — so tests can
 * assert on actual AI-driven behavior (not just the fallback paths a real,
 * uncredentialed callGemini would take). Server dice (functions/loom-turn/
 * adjudicate.js) are already deterministic given a fixed proposedAction, so
 * the whole pipeline is reproducible run to run.
 *
 * Run: firebase emulators:exec --only firestore --project demo-loom-test "cd tests && npx jest loom-turn --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = 'demo-loom-test';

// Mock callGemini before requiring functions/index.js (and anything that
// transitively requires functions/gemini.js) so every INTERPRET/NARRATE/
// summary-regen call in the pipeline goes through this mock, never the
// network.
const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: 'demo-loom-test' }, null);

// This test file's own firebase-admin copy (tests/node_modules) needs its own
// initialized app to read/write Firestore directly for seeding/assertions —
// requiring functions/index.js below initializes a *separate* app instance
// in its own copy (functions/node_modules), which is what loomPlayTurn uses
// internally. Both point at the same FIRESTORE_EMULATOR_HOST, so data is
// shared regardless of which copy's handle reads/writes it.
const admin = require('firebase-admin');
if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'demo-loom-test' });
}
const db = admin.firestore();

const { loomPlayTurn } = require('../functions/index');
const { makeSave: makeSaveDoc } = require('../functions/loom-models');
const loomCanon = require('../functions/loom-canon');
const { normalizeEntityName } = require('../functions/loom-turn/soft-canon');
const { makeWorld, makeSave, makePlayerAction, makeAiResponse } = require('./fixtures/loom');

const TEST_UID = 'player-001';
const WORLD_ID = 'shattered-coast';
const SAVE_ID = 'save-001';

function callTurn(data, authOverride) {
  return loomPlayTurn.run({
    data,
    auth:
      authOverride !== undefined
        ? authOverride
        : { uid: TEST_UID, token: { apps: ['loom'], admin: false } },
  });
}

async function seedSave(overrides) {
  const save = makeSaveDoc(
    Object.assign(
      {
        ownerUid: TEST_UID,
        worldId: WORLD_ID,
        name: 'Test Save',
        character: { name: 'Test Character' },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      overrides
    )
  );
  await db.collection('loom_saves').doc(SAVE_ID).set(save);
  return save;
}

async function clearAll() {
  const saveRef = db.collection('loom_saves').doc(SAVE_ID);
  const turnsSnap = await saveRef.collection('loom_turns').get();
  await Promise.all(turnsSnap.docs.map((d) => d.ref.delete()));
  await saveRef.delete().catch(() => {});
  await db
    .collection('loom_world_state')
    .doc(WORLD_ID)
    .delete()
    .catch(() => {});
}

/** Default mock: routes by system prompt content so unrelated tests don't need per-call setup. */
function defaultCallGeminiImplementation(options) {
  if (options.systemInstruction.indexOf('INTERPRET stage') !== -1) {
    return Promise.resolve(makePlayerAction());
  }
  if (options.systemInstruction.indexOf('summarizer') !== -1) {
    return Promise.resolve('A summary of recent events.');
  }
  return Promise.resolve(makeAiResponse());
}

beforeEach(async () => {
  await clearAll();
  mockCallGemini.mockReset();
  mockCallGemini.mockImplementation(defaultCallGeminiImplementation);
});

afterAll(async () => {
  await clearAll();
  functionsTest.cleanup();
});

describe('loomPlayTurn — auth and input validation', () => {
  it('rejects an unauthenticated caller', async () => {
    await seedSave();
    await expect(
      callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'look around' }, null)
    ).rejects.toThrow(/signed in/i);
  });

  it('rejects a caller without the loom claim', async () => {
    await seedSave();
    await expect(
      callTurn(
        { worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'look around' },
        { uid: TEST_UID, token: { apps: ['other-app'], admin: false } }
      )
    ).rejects.toThrow(/access to the loom/i);
  });

  it('rejects a missing worldId', async () => {
    await expect(callTurn({ saveId: SAVE_ID, actionText: 'look around' })).rejects.toThrow(
      /worldId/
    );
  });

  it('rejects a missing saveId', async () => {
    await expect(callTurn({ worldId: WORLD_ID, actionText: 'look around' })).rejects.toThrow(
      /saveId/
    );
  });

  it('rejects a missing actionText', async () => {
    await expect(callTurn({ worldId: WORLD_ID, saveId: SAVE_ID })).rejects.toThrow(/actionText/);
  });

  it('rejects actionText longer than 2000 characters', async () => {
    await seedSave();
    await expect(
      callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'a'.repeat(2001) })
    ).rejects.toThrow(/2000 characters/);
  });
});

describe('loomPlayTurn — ownership and world resolution', () => {
  it('rejects a save that does not exist', async () => {
    await expect(
      callTurn({ worldId: WORLD_ID, saveId: 'nonexistent-save', actionText: 'look around' })
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a save owned by a different user', async () => {
    await seedSave({ ownerUid: 'someone-else' });
    await expect(
      callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'look around' })
    ).rejects.toThrow(/not your save/i);
  });

  it('rejects a worldId that does not match the save', async () => {
    await seedSave({ worldId: WORLD_ID });
    await expect(
      callTurn({ worldId: 'some-other-world', saveId: SAVE_ID, actionText: 'look around' })
    ).rejects.toThrow(/worldId does not match/i);
  });

  it('rejects a worldId with no canon world defined', async () => {
    await seedSave({ worldId: 'nonexistent-world' });
    await expect(
      callTurn({ worldId: 'nonexistent-world', saveId: SAVE_ID, actionText: 'look around' })
    ).rejects.toThrow(/unknown world/i);
  });
});

describe('loomPlayTurn — end-to-end happy path', () => {
  it('returns the client contract shape for a seeded world', async () => {
    await seedSave();
    const result = await callTurn({
      worldId: WORLD_ID,
      saveId: SAVE_ID,
      actionText: 'look around',
    });

    expect(typeof result.narration).toBe('string');
    expect(result.narration.length).toBeGreaterThan(0);
    expect(typeof result.stateSummary).toBe('string');
    expect(Array.isArray(result.suggestedActions)).toBe(true);
  });

  it('appends exactly one loom_turns doc with index 0 on the first turn', async () => {
    await seedSave();
    await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'look around' });

    const turnsSnap = await db.collection('loom_saves').doc(SAVE_ID).collection('loom_turns').get();
    expect(turnsSnap.size).toBe(1);
    expect(turnsSnap.docs[0].data().index).toBe(0);
    expect(turnsSnap.docs[0].data().actionText).toBe('look around');
  });

  it('increments the turn index on a second turn', async () => {
    await seedSave();
    await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'look around' });
    await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'check the hold' });

    const turnsSnap = await db
      .collection('loom_saves')
      .doc(SAVE_ID)
      .collection('loom_turns')
      .orderBy('index', 'asc')
      .get();
    expect(turnsSnap.size).toBe(2);
    expect(turnsSnap.docs.map((d) => d.data().index)).toEqual([0, 1]);
  });

  it('creates the loom_world_state doc on the first turn in a world', async () => {
    await seedSave();
    await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'look around' });

    const worldStateSnap = await db.collection('loom_world_state').doc(WORLD_ID).get();
    expect(worldStateSnap.exists).toBe(true);
    expect(worldStateSnap.data().worldId).toBe(WORLD_ID);
  });

  it('reuses an existing loom_world_state doc rather than overwriting its worldClock', async () => {
    await seedSave();
    await db.collection('loom_world_state').doc(WORLD_ID).set({
      worldId: WORLD_ID,
      locations: {},
      factions: {},
      globalFlags: {},
      worldClock: 42,
    });

    await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'look around' });

    const worldStateSnap = await db.collection('loom_world_state').doc(WORLD_ID).get();
    expect(worldStateSnap.data().worldClock).toBe(42);
  });
});

describe('control invariants — the model proposes, the server disposes', () => {
  it('rejects an illegal move even when narration falsely claims success', async () => {
    await seedSave({ location: 'widows-reach' });

    // widows-reach has no direct connection to fort-augustine.
    mockCallGemini
      .mockImplementationOnce(() => makePlayerAction({ verb: 'move', targets: ['fort-augustine'] }))
      .mockImplementationOnce(() =>
        makeAiResponse({ narration: 'You arrive at Fort Augustine triumphantly!' })
      );

    const result = await callTurn({
      worldId: WORLD_ID,
      saveId: SAVE_ID,
      actionText: 'sail straight to fort augustine',
    });

    // The model's prose is whatever it said — that's just flavor text.
    expect(result.narration).toContain('Fort Augustine');

    // But the persisted hard state must NOT reflect the model's claim.
    const saveSnap = await db.collection('loom_saves').doc(SAVE_ID).get();
    expect(saveSnap.data().location).toBe('widows-reach');
  });

  it('rejects a move requiring an ability the character lacks', async () => {
    await seedSave({ location: 'widows-reach', character: { name: 'Test', abilities: [] } });

    mockCallGemini.mockImplementationOnce(() =>
      makePlayerAction({ verb: 'move', targets: ['the-drowned-shoals'] })
    );

    await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'row into the shoals' });

    const saveSnap = await db.collection('loom_saves').doc(SAVE_ID).get();
    expect(saveSnap.data().location).toBe('widows-reach');
  });

  it('applies the correct mutation for a legal move', async () => {
    await seedSave({ location: 'widows-reach' });

    mockCallGemini.mockImplementationOnce(() =>
      makePlayerAction({ verb: 'move', targets: ['skeleton-cove'] })
    );

    await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'row to skeleton cove' });

    const saveSnap = await db.collection('loom_saves').doc(SAVE_ID).get();
    expect(saveSnap.data().location).toBe('skeleton-cove');

    const worldStateSnap = await db.collection('loom_world_state').doc(WORLD_ID).get();
    expect(worldStateSnap.data().worldClock).toBe(1);
  });

  it('never lets INTERPRET or NARRATE output smuggle in a state_mutations-shaped field', async () => {
    await seedSave({ location: 'widows-reach' });

    mockCallGemini
      .mockImplementationOnce(() =>
        Object.assign(makePlayerAction({ verb: 'look' }), {
          outcome: 'success',
          mutations: [{ op: 'set-flag', path: 'location', value: 'fort-augustine' }],
        })
      )
      .mockImplementationOnce(() => makeAiResponse());

    await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'look around' });

    const saveSnap = await db.collection('loom_saves').doc(SAVE_ID).get();
    expect(saveSnap.data().location).toBe('widows-reach');
  });
});

describe('soft-canon quarantine — end-to-end', () => {
  it('promotes an invented entity into World State on the second mention', async () => {
    await seedSave();

    mockCallGemini
      .mockImplementationOnce(() => makePlayerAction({ verb: 'look' }))
      .mockImplementationOnce(() =>
        makeAiResponse({
          narration: 'A barkeep named Doral greets you.',
          inventedEntities: ['Doral'],
        })
      );
    await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'look around' });

    let worldStateSnap = await db.collection('loom_world_state').doc(WORLD_ID).get();
    const flagKey = 'entity_' + normalizeEntityName('Doral');
    expect(worldStateSnap.data().globalFlags[flagKey]).toBeUndefined();

    mockCallGemini
      .mockImplementationOnce(() => makePlayerAction({ verb: 'talk', targets: ['Doral'] }))
      .mockImplementationOnce(() =>
        makeAiResponse({ narration: 'Doral nods at you again.', inventedEntities: ['Doral'] })
      );
    await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'greet doral again' });

    worldStateSnap = await db.collection('loom_world_state').doc(WORLD_ID).get();
    expect(worldStateSnap.data().globalFlags[flagKey]).toBe('Doral');
  });
});

describe('entity-keyed retrieval — end-to-end', () => {
  it("surfaces an NPC's prior turn narration to NARRATE when they re-enter a scene", async () => {
    await seedSave({ location: 'widows-reach' });

    mockCallGemini
      .mockImplementationOnce(() =>
        makePlayerAction({ verb: 'talk', targets: ['captain-orla-vance'] })
      )
      .mockImplementationOnce(() =>
        makeAiResponse({ narration: 'Captain Orla Vance warns you about the patrol.' })
      );
    await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'talk to the captain' });

    let secondNarrateSawHistory = false;
    mockCallGemini
      .mockImplementationOnce(() =>
        makePlayerAction({ verb: 'talk', targets: ['captain-orla-vance'] })
      )
      .mockImplementationOnce((options) => {
        secondNarrateSawHistory = options.userMessage.indexOf('warns you about the patrol') !== -1;
        return makeAiResponse({ narration: 'She nods again.' });
      });
    await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'talk to her again' });

    expect(secondNarrateSawHistory).toBe(true);
  });
});

describe('rolling summary regeneration — end-to-end', () => {
  it('regenerates recentSummary once the turn count crosses the threshold', async () => {
    await seedSave();

    // SUMMARY_REGEN_THRESHOLD is 10 — the 10th turn (index 9) crosses it.
    for (let i = 0; i < 10; i++) {
      await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'wait quietly turn ' + i });
    }

    // Summary regen is fire-and-forget (COMMIT does not await it) — give it a
    // moment to land before asserting.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const saveSnap = await db.collection('loom_saves').doc(SAVE_ID).get();
    expect(saveSnap.data().recentSummary).toBe('A summary of recent events.');
  });
});

describe('hard state persistence', () => {
  it('never truncates or overwrites earlier turns as new ones are appended', async () => {
    await seedSave();

    for (let i = 0; i < 5; i++) {
      await callTurn({ worldId: WORLD_ID, saveId: SAVE_ID, actionText: 'action number ' + i });
    }

    const turnsSnap = await db
      .collection('loom_saves')
      .doc(SAVE_ID)
      .collection('loom_turns')
      .orderBy('index', 'asc')
      .get();

    expect(turnsSnap.size).toBe(5);
    turnsSnap.docs.forEach((doc, i) => {
      expect(doc.data().index).toBe(i);
      expect(doc.data().actionText).toBe('action number ' + i);
    });
  });
});

describe('loomPlayTurn — works against a fully synthetic world', () => {
  const FIXTURE_WORLD_ID = 'test-world';
  const FIXTURE_SAVE_ID = 'fixture-save-001';

  afterEach(async () => {
    const saveRef = db.collection('loom_saves').doc(FIXTURE_SAVE_ID);
    await saveRef.delete().catch(() => {});
    await db
      .collection('loom_world_state')
      .doc(FIXTURE_WORLD_ID)
      .delete()
      .catch(() => {});
  });

  it('completes a turn end-to-end against a minimal fixture world (not just shattered-coast)', async () => {
    jest.spyOn(loomCanon, 'getWorld').mockReturnValueOnce(makeWorld());

    const save = makeSaveDoc(
      makeSave({
        ownerUid: TEST_UID,
        worldId: FIXTURE_WORLD_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    );
    await db.collection('loom_saves').doc(FIXTURE_SAVE_ID).set(save);

    const result = await callTurn({
      worldId: FIXTURE_WORLD_ID,
      saveId: FIXTURE_SAVE_ID,
      actionText: 'look around',
    });

    expect(typeof result.narration).toBe('string');
    expect(result.narration.length).toBeGreaterThan(0);

    const worldStateSnap = await db.collection('loom_world_state').doc(FIXTURE_WORLD_ID).get();
    expect(worldStateSnap.exists).toBe(true);
  });
});
