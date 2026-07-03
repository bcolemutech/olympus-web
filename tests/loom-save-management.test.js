'use strict';

/**
 * Integration tests for the loomCreateSave / loomDeleteSave callables (L-121).
 *
 * Runs against the Firestore emulator + firebase-functions-test, mirroring
 * tests/loom-turn.test.js's pattern.
 *
 * Run: firebase emulators:exec --only firestore --project demo-loom-test "cd tests && npx jest loom-save-management --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = 'demo-loom-test';

const functionsTest = require('firebase-functions-test')({ projectId: 'demo-loom-test' }, null);

// Requiring functions/index.js triggers its single initializeApp() call.
const { loomCreateSave, loomDeleteSave } = require('../functions/index');
const path = require('path');
const functionsFirestorePath = require.resolve('firebase-admin/firestore', {
  paths: [path.resolve(__dirname, '../functions')],
});
const { getFirestore } = require(functionsFirestorePath);
const db = getFirestore();

const TEST_UID = 'player-001';
const WORLD_ID = 'shattered-coast';

function callCreate(data, authOverride) {
  return loomCreateSave.run({
    data,
    auth:
      authOverride !== undefined
        ? authOverride
        : { uid: TEST_UID, token: { apps: ['loom'], admin: false } },
  });
}

function callDelete(data, authOverride) {
  return loomDeleteSave.run({
    data,
    auth:
      authOverride !== undefined
        ? authOverride
        : { uid: TEST_UID, token: { apps: ['loom'], admin: false } },
  });
}

async function clearCreatedSaves() {
  const snap = await db.collection('loom_saves').where('worldId', '==', WORLD_ID).get();
  for (const doc of snap.docs) {
    const turnsSnap = await doc.ref.collection('loom_turns').get();
    const batch = db.batch();
    turnsSnap.docs.forEach((turnDoc) => batch.delete(turnDoc.ref));
    batch.delete(doc.ref);
    await batch.commit();
  }
}

afterEach(async () => {
  await clearCreatedSaves();
});

afterAll(async () => {
  functionsTest.cleanup();
});

describe('loomCreateSave', () => {
  it('rejects an unauthenticated caller', async () => {
    await expect(
      callCreate({ worldId: WORLD_ID, name: 'My Save', characterName: 'Ishmael' }, null)
    ).rejects.toThrow(/signed in/i);
  });

  it('rejects a caller without the loom claim', async () => {
    await expect(
      callCreate(
        { worldId: WORLD_ID, name: 'My Save', characterName: 'Ishmael' },
        { uid: TEST_UID, token: { apps: ['other-app'], admin: false } }
      )
    ).rejects.toThrow(/access to the loom/i);
  });

  it('rejects a missing worldId', async () => {
    await expect(callCreate({ name: 'My Save', characterName: 'Ishmael' })).rejects.toThrow(
      /worldId/
    );
  });

  it('rejects a missing name', async () => {
    await expect(
      callCreate({ worldId: WORLD_ID, characterName: 'Ishmael' })
    ).rejects.toThrow(/name/);
  });

  it('rejects a missing characterName', async () => {
    await expect(callCreate({ worldId: WORLD_ID, name: 'My Save' })).rejects.toThrow(
      /characterName/
    );
  });

  it('rejects an unknown world', async () => {
    await expect(
      callCreate({ worldId: 'nonexistent-world', name: 'My Save', characterName: 'Ishmael' })
    ).rejects.toThrow(/unknown world/i);
  });

  it('creates a save initialized from canon defaults', async () => {
    const result = await callCreate({
      worldId: WORLD_ID,
      name: 'My Save',
      characterName: 'Ishmael',
    });

    expect(typeof result.saveId).toBe('string');
    expect(result.saveId.length).toBeGreaterThan(0);

    const snap = await db.collection('loom_saves').doc(result.saveId).get();
    expect(snap.exists).toBe(true);

    const save = snap.data();
    expect(save.ownerUid).toBe(TEST_UID);
    expect(save.worldId).toBe(WORLD_ID);
    expect(save.name).toBe('My Save');
    expect(save.character.name).toBe('Ishmael');
    expect(save.character.condition).toBe('healthy');
    expect(save.character.abilities).toEqual(['seaworthy-vessel']);
    expect(save.location).toBe('widows-reach');
    expect(save.recentSummary).toBe('');
  });
});

describe('loomDeleteSave', () => {
  async function seedSave() {
    const result = await callCreate({
      worldId: WORLD_ID,
      name: 'Save To Delete',
      characterName: 'Ishmael',
    });
    return result.saveId;
  }

  it('rejects an unauthenticated caller', async () => {
    const saveId = await seedSave();
    await expect(callDelete({ saveId }, null)).rejects.toThrow(/signed in/i);
  });

  it('rejects a missing saveId', async () => {
    await expect(callDelete({})).rejects.toThrow(/saveId/);
  });

  it('rejects deleting a save that does not exist', async () => {
    await expect(callDelete({ saveId: 'nonexistent-save' })).rejects.toThrow(/not found/i);
  });

  it('rejects deleting a save owned by a different user', async () => {
    const saveId = await seedSave();
    await expect(
      callDelete({ saveId }, { uid: 'someone-else', token: { apps: ['loom'], admin: false } })
    ).rejects.toThrow(/not your save/i);

    const snap = await db.collection('loom_saves').doc(saveId).get();
    expect(snap.exists).toBe(true);
  });

  it('deletes the save and its turn log', async () => {
    const saveId = await seedSave();
    await db.collection('loom_saves').doc(saveId).collection('loom_turns').doc('turn-0').set({
      index: 0,
      actionText: 'look around',
    });

    const result = await callDelete({ saveId });
    expect(result).toEqual({ success: true });

    const saveSnap = await db.collection('loom_saves').doc(saveId).get();
    expect(saveSnap.exists).toBe(false);

    const turnsSnap = await db
      .collection('loom_saves')
      .doc(saveId)
      .collection('loom_turns')
      .get();
    expect(turnsSnap.empty).toBe(true);
  });
});
