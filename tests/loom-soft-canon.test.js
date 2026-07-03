'use strict';

/**
 * Integration tests for functions/loom-turn/soft-canon.js (L-115).
 *
 * Runs against the Firestore emulator since quarantineEntities operates
 * inside a real Firestore transaction (reads-before-writes ordering across
 * multiple entities is part of what's under test).
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

// A plain get() immediately following a resolved transaction should always
// see that transaction's writes, but this sandbox's network proxy has shown
// occasional transient latency against the emulator under heavy parallel
// test load — so retry briefly rather than flake on an environment hiccup
// unrelated to quarantineEntities' own correctness (already covered by the
// isolated-run assertions above).
async function getDoc(name, attemptsLeft = 15) {
  const ref = db.collection('loom_softcanon').doc(softCanonDocId(WORLD_ID, normalizeEntityName(name)));
  const snap = await ref.get();
  if (snap.exists) return snap.data();
  if (attemptsLeft <= 1) return null;
  await new Promise((resolve) => setTimeout(resolve, 150));
  return getDoc(name, attemptsLeft - 1);
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
    await runQuarantine([], {});
    await runQuarantine(['   ', ''], {});
    expect(await getDoc('anything')).toBeNull();
  });

  it('creates a provisional record on first mention', async () => {
    await runQuarantine(['a barkeep named Doral'], {});

    const doc = await getDoc('a barkeep named Doral');
    expect(doc).not.toBeNull();
    expect(doc.referenceCount).toBe(1);
    expect(doc.promoted).toBe(false);
    expect(doc.worldId).toBe(WORLD_ID);
    expect(doc.name).toBe('a barkeep named Doral');
  });

  it('promotes on the second reference and flags it in worldState.globalFlags', async () => {
    await runQuarantine(['a barkeep named Doral'], {});

    const worldState = { globalFlags: {} };
    await runQuarantine(['a barkeep named Doral'], worldState);

    const doc = await getDoc('a barkeep named Doral');
    expect(doc.referenceCount).toBe(PROMOTION_REFERENCE_COUNT);
    expect(doc.promoted).toBe(true);
    expect(doc.promotedAt).not.toBeNull();

    const flagKey = 'entity_' + normalizeEntityName('a barkeep named Doral');
    expect(worldState.globalFlags[flagKey]).toBe('a barkeep named Doral');
  });

  it('does not re-promote or duplicate the flag on a third reference', async () => {
    await runQuarantine(['a barkeep named Doral'], {});
    await runQuarantine(['a barkeep named Doral'], { globalFlags: {} });

    const worldState = { globalFlags: {} };
    await runQuarantine(['a barkeep named Doral'], worldState);

    const doc = await getDoc('a barkeep named Doral');
    expect(doc.promoted).toBe(true);
    // referenceCount is left alone once promoted — no further increments.
    expect(doc.referenceCount).toBe(PROMOTION_REFERENCE_COUNT);
    // Not re-flagged on an already-promoted mention.
    expect(worldState.globalFlags).toEqual({});
  });

  it('tracks multiple distinct invented names independently in one call', async () => {
    await runQuarantine(['Doral the barkeep', 'a suspicious crate'], {});

    expect(await getDoc('Doral the barkeep')).not.toBeNull();
    expect(await getDoc('a suspicious crate')).not.toBeNull();
  });

  it('deduplicates the same name mentioned twice within one call', async () => {
    await runQuarantine(['Doral', 'Doral'], {});
    const doc = await getDoc('Doral');
    expect(doc.referenceCount).toBe(1);
  });

  it('treats case/whitespace variants of the same name as the same entity', async () => {
    await runQuarantine(['  Doral the Barkeep  '], {});
    const worldState = { globalFlags: {} };
    await runQuarantine(['doral the barkeep'], worldState);

    const doc = await getDoc('Doral the Barkeep');
    expect(doc.referenceCount).toBe(2);
    expect(doc.promoted).toBe(true);
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
