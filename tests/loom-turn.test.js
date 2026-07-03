'use strict';

/**
 * Integration tests for the loomPlayTurn callable orchestrator (L-110).
 *
 * Runs against the Firestore emulator with the real (stubbed) pipeline —
 * INTERPRET/ADJUDICATE/NARRATE are stubs until L-111/112/113 land, so these
 * tests exercise INTAKE, stage sequencing, auth/ownership enforcement, and
 * the real COMMIT write path. The fuller emulator + mocked-AI integration
 * suite (fixtures, per-stage assertions) is L-130 (#307).
 *
 * Run: firebase emulators:exec --only firestore --project demo-loom-test "cd tests && npx jest loom-turn --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = 'demo-loom-test';

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
const { makeSave } = require('../functions/loom-models');

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
  const save = makeSave(
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
  await db.collection('loom_world_state').doc(WORLD_ID).delete().catch(() => {});
}

beforeEach(async () => {
  await clearAll();
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
