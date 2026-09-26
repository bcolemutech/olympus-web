'use strict';

const crypto = require('crypto');
const loomCanon = require('../loom-canon');

// Loader — step 3 of the Cartographer's programmatic load (design
// planning/the-cartographer-design.md §3.3; C-4 / #371).
//
// loadDraftWorld({ db, mapped, uploadedBy }) writes the mapper's output
// (functions/cartographer/map.js) to Firestore as a new **draft** world:
//
//   loom_worlds/{worldId}                       world document
//     { id, name, tagline, openingHook, rules, map, status, canonVersion,
//       source, counts, warnings, createdAtMs, updatedAtMs }
//   loom_worlds/{worldId}/locations|factions|regions/{entityId}
//
// Status goes `importing` → `draft`. Entities are written in batches while the
// world is `importing`, so the Loom (loom-canon loadWorld) never sees a
// half-written world. On failure the world is marked `failed` with the error,
// and its partial entities are deleted. A re-import always creates a new world.

const BATCH_SIZE = 400; // under Firestore's 500 writes per batch
const WRITTEN_COLLECTIONS = ['locations', 'factions', 'regions'];

function slugify(name) {
  const slug = String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'world';
}

// Readable, unique, and never a static world's id: "nisia-3f9a2c".
function newWorldId(name, random = () => crypto.randomBytes(3).toString('hex')) {
  let id;
  do {
    id = `${slugify(name)}-${random()}`;
  } while (loomCanon.getWorld(id));
  return id;
}

async function writeEntities(worldRef, canon) {
  const writes = [];
  for (const collection of WRITTEN_COLLECTIONS) {
    for (const entity of Object.values(canon[collection] || {})) {
      writes.push([worldRef.collection(collection).doc(entity.id), entity]);
    }
  }
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = worldRef.firestore.batch();
    for (const [ref, data] of writes.slice(i, i + BATCH_SIZE)) batch.set(ref, data);
    await batch.commit();
  }
  return writes.length;
}

async function deleteEntities(worldRef) {
  const db = worldRef.firestore;
  await Promise.all(
    WRITTEN_COLLECTIONS.map((name) => db.recursiveDelete(worldRef.collection(name)))
  );
}

/**
 * @param {{ db, mapped: { canon, stats, warnings }, source: object, uploadedBy: string,
 *           now?: () => number, worldId?: string }} params
 * @returns {Promise<{ worldId: string, counts: object, warnings: object[] }>}
 */
async function loadDraftWorld({ db, mapped, source, uploadedBy, now = () => Date.now(), worldId }) {
  const { canon, stats, warnings } = mapped;
  const id = worldId || newWorldId(canon.name);
  const worldRef = db.collection(loomCanon.WORLDS_COLLECTION).doc(id);
  const startedAtMs = now();

  // create() fails if the id is somehow taken, so an import never overwrites.
  await worldRef.create({
    id,
    name: canon.name,
    tagline: canon.tagline || '',
    openingHook: canon.openingHook || '',
    rules: canon.rules || {},
    map: canon.map || null,
    status: 'importing',
    canonVersion: 0,
    source: { ...source, uploadedBy: uploadedBy || null, uploadedAtMs: startedAtMs },
    counts: stats,
    warnings: warnings || [],
    createdAtMs: startedAtMs,
    updatedAtMs: startedAtMs,
  });

  try {
    await writeEntities(worldRef, canon);
    await worldRef.update({ status: 'draft', canonVersion: 1, updatedAtMs: now() });
  } catch (err) {
    await worldRef
      .update({
        status: 'failed',
        error: String(err.message || err).slice(0, 500),
        updatedAtMs: now(),
      })
      .catch(() => {});
    await deleteEntities(worldRef).catch(() => {});
    throw err;
  }

  return { worldId: id, counts: stats, warnings: warnings || [] };
}

module.exports = { loadDraftWorld, newWorldId, slugify };
