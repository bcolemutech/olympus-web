'use strict';

// Applies a backfill to an already-imported world: field updates to its
// entity documents, in batches, then one canonVersion bump (with any
// world-level fields) so every cached copy of the world reloads. Used by
// scripts/backfill-description-sources.js through sources.js (L-321) and
// seeds.js (L-341). No dependencies, so the ES-module script can load it.
//
//   plan  { writes: [{ collection, id, fields }], worldFields?: { [path]: value } }

const BATCH_SIZE = 400;

async function applyBackfill(db, worldId, plan, { now = () => Date.now() } = {}) {
  const writes = plan.writes || [];
  const worldFields = plan.worldFields || {};
  const worldRef = db.collection('loom_worlds').doc(worldId);
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { collection, id, fields } of writes.slice(i, i + BATCH_SIZE)) {
      batch.update(worldRef.collection(collection).doc(id), fields);
    }
    await batch.commit();
  }
  if (!writes.length && !Object.keys(worldFields).length) {
    return { written: 0, canonVersion: null };
  }
  const canonVersion = await db.runTransaction(async (tx) => {
    const snap = await tx.get(worldRef);
    const next = (snap.data().canonVersion || 0) + 1;
    tx.update(worldRef, { ...worldFields, canonVersion: next, updatedAtMs: now() });
    return next;
  });
  return { written: writes.length, canonVersion };
}

module.exports = { applyBackfill };
