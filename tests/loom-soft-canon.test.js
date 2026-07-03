'use strict';

/**
 * Integration tests for functions/loom-turn/soft-canon.js (L-115).
 *
 * Runs against the Firestore emulator since quarantineEntities operates
 * inside a real Firestore transaction (reads-before-writes ordering across
 * multiple entities is part of what's under test). Assertions read
 * quarantineEntities' own return value rather than a follow-up `.get()` —
 * a separate read raced against the transaction's commit under heavy
 * parallel test load in CI (confirmed flaky), where the return value never
 * can.
 *
 * Run: firebase emulators:exec --only firestore --project demo-loom-test "cd tests && npx jest loom-soft-canon --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = 'demo-loom-test';

// soft-canon.js's FieldValue.serverTimestamp() sentinels are created via
// functions/node_modules' own firebase-admin copy. Firestore rejects sentinel
// objects from a *different* firebase-admin copy than the one that created
// the transaction/db instance ("doesn't support custom prototypes"), so this
// test must use the exact same copy — hence requiring functions/index.js
// (which calls that copy's initializeApp()) and the same copy's getFirestore,
// rather than tests/node_modules' own firebase-admin.
require('../functions/index');
const path = require('path');
const functionsFirestorePath = require.resolve('firebase-admin/firestore', {
  paths: [path.resolve(__dirname, '../functions')],
});
const { getFirestore } = require(functionsFirestorePath);
const db = getFirestore();

const {
  PROMOTION_REFERENCE_COUNT,
  normalizeEntityName,
  softCanonDocId,
  quarantineEntities,
} = require('../functions/loom-turn/soft-canon');

const WORLD_ID = 'soft-canon-test-world';

function runQuarantine(inventedEntities, worldState) {
  return db.runTransaction((transaction) =>
    quarantineEntities({ transaction, db, worldId: WORLD_ID, inventedEntities, worldState })
  );
}

function findResult(results, name) {
  return results.filter((r) => r.normalizedName === normalizeEntityName(name))[0] || null;
}

async function clearSoftCanon() {
  const snap = await db.collection('loom_softcanon').where('worldId', '==', WORLD_ID).get();
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

afterEach(async () => {
  await clearSoftCanon();
});

describe('quarantineEntities', () => {
  it('does nothing for an empty or all-blank invented list', async () => {
    expect(await runQuarantine([], {})).toEqual([]);
    expect(await runQuarantine(['   ', ''], {})).toEqual([]);
  });

  it('creates a provisional record on first mention', async () => {
    const results = await runQuarantine(['a barkeep named Doral'], {});

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      name: 'a barkeep named Doral',
      normalizedName: normalizeEntityName('a barkeep named Doral'),
      referenceCount: 1,
      promoted: false,
    });
  });

  it('promotes on the second reference and flags it in worldState.globalFlags', async () => {
    await runQuarantine(['a barkeep named Doral'], {});

    const worldState = { globalFlags: {} };
    const results = await runQuarantine(['a barkeep named Doral'], worldState);

    const result = findResult(results, 'a barkeep named Doral');
    expect(result.referenceCount).toBe(PROMOTION_REFERENCE_COUNT);
    expect(result.promoted).toBe(true);

    const flagKey = 'entity_' + normalizeEntityName('a barkeep named Doral');
    expect(worldState.globalFlags[flagKey]).toBe('a barkeep named Doral');
  });

  it('does not re-promote or duplicate the flag on a third reference', async () => {
    await runQuarantine(['a barkeep named Doral'], {});
    await runQuarantine(['a barkeep named Doral'], { globalFlags: {} });

    const worldState = { globalFlags: {} };
    const results = await runQuarantine(['a barkeep named Doral'], worldState);

    const result = findResult(results, 'a barkeep named Doral');
    expect(result.promoted).toBe(true);
    // referenceCount is left alone once promoted — no further increments.
    expect(result.referenceCount).toBe(PROMOTION_REFERENCE_COUNT);
    // Not re-flagged on an already-promoted mention.
    expect(worldState.globalFlags).toEqual({});
  });

  it('tracks multiple distinct invented names independently in one call', async () => {
    const results = await runQuarantine(['Doral the barkeep', 'a suspicious crate'], {});

    expect(findResult(results, 'Doral the barkeep')).not.toBeNull();
    expect(findResult(results, 'a suspicious crate')).not.toBeNull();
  });

  it('deduplicates the same name mentioned twice within one call', async () => {
    const results = await runQuarantine(['Doral', 'Doral'], {});
    expect(results).toHaveLength(1);
    expect(results[0].referenceCount).toBe(1);
  });

  it('treats case/whitespace variants of the same name as the same entity', async () => {
    await runQuarantine(['  Doral the Barkeep  '], {});
    const worldState = { globalFlags: {} };
    const results = await runQuarantine(['doral the barkeep'], worldState);

    const result = findResult(results, 'Doral the Barkeep');
    expect(result.referenceCount).toBe(2);
    expect(result.promoted).toBe(true);
  });

  it('scopes provisional entities to the world', async () => {
    await runQuarantine(['Doral'], {});

    const otherWorldRef = db
      .collection('loom_softcanon')
      .doc(softCanonDocId('a-different-world', normalizeEntityName('Doral')));
    const otherWorldSnap = await otherWorldRef.get();
    expect(otherWorldSnap.exists).toBe(false);
  });
});
