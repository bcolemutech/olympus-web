'use strict';

const loomCanon = require('../../../loom-canon');
const { ToolError } = require('../../registry');

// Serialized, validated edits to one world (design planning/the-cartographer-
// design.md §4.1, §4.2; C-7 / #374).
//
// edit(worldId, uid, change) loads the world (loom-canon loadWorld, cached per
// instance by canonVersion), lets `change` validate against it and queue
// writes, then commits them in a transaction that re-reads the world document
// and only proceeds if its canonVersion is still the one validated against.
// Every committed edit bumps canonVersion, so a concurrent edit makes the
// other one reload and re-validate, and every game sees the change on its
// next turn. An edit that queues nothing commits nothing and keeps the
// version.
//
// `change({ world, meta, uid, ref, set, create, update, remove, updateWorld })`
// may only queue writes (they are applied after it returns, so every read in
// the transaction precedes every write) and returns the tool result.
//
// publish(uid, worldId) publishes a draft through the Cartographer's own
// publish, with its playability checks.

const EDITABLE = ['draft', 'published'];
const MAX_ATTEMPTS = 5;

class StaleWorld extends Error {}

function createFirestoreWorldWriter(getDb, { now = () => Date.now() } = {}) {
  const worlds = () => getDb().collection(loomCanon.WORLDS_COLLECTION);

  function refuseStatus(meta) {
    if (!meta) throw new ToolError('World not found. Use list_worlds to see world ids.');
    if (meta.status === 'importing') {
      throw new ToolError('This world is still importing. Try again in a minute.');
    }
    if (!EDITABLE.includes(meta.status)) {
      throw new ToolError(`This world can't be edited (status: ${meta.status}).`);
    }
  }

  async function attempt(worldId, uid, change) {
    const world = await loomCanon.loadWorld(worldId, { db: getDb(), playableOnly: false });
    if (!world) {
      const snap = await worlds().doc(worldId).get();
      refuseStatus(snap.exists ? snap.data() : null);
      throw new StaleWorld(); // it became editable meanwhile
    }

    const worldRef = worlds().doc(worldId);
    return getDb().runTransaction(async (tx) => {
      const snap = await tx.get(worldRef);
      const meta = snap.exists ? snap.data() : null;
      refuseStatus(meta);
      if (meta.canonVersion !== world.canonVersion || meta.status !== world.status) {
        throw new StaleWorld();
      }

      const writes = [];
      let worldChanges = null;
      const result = await change({
        world,
        meta,
        uid,
        ref: (collection, id) => worldRef.collection(collection).doc(id),
        set: (ref, data) => writes.push((t) => t.set(ref, data)),
        create: (ref, data) => writes.push((t) => t.create(ref, data)),
        update: (ref, ...args) => writes.push((t) => t.update(ref, ...args)),
        remove: (ref) => writes.push((t) => t.delete(ref)),
        updateWorld: (fields) => {
          worldChanges = { ...(worldChanges || {}), ...fields };
        },
      });

      if (!writes.length && !worldChanges) {
        return { worldId, canonVersion: meta.canonVersion, changed: false, ...result };
      }
      for (const write of writes) write(tx);
      const canonVersion = meta.canonVersion + 1;
      tx.update(worldRef, {
        ...(worldChanges || {}),
        canonVersion,
        updatedAtMs: now(),
        updatedBy: uid,
      });
      return { worldId, canonVersion, changed: true, ...result };
    });
  }

  async function edit(worldId, uid, change) {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      try {
        return await attempt(worldId, uid, change);
      } catch (err) {
        if (!(err instanceof StaleWorld)) throw err;
      }
    }
    throw new ToolError('This world is changing too quickly right now. Try again in a moment.');
  }

  // Publishing reuses the Cartographer's publish (the same checks as the
  // page's Publish button); its refusals are relayed to Claude verbatim.
  async function publish(uid, worldId) {
    const { HttpsError } = require('firebase-functions/v2/https');
    const { createCartographerService } = require('../../../cartographer/service');
    try {
      return await createCartographerService({ db: getDb(), bucket: null, now }).publishWorld(uid, {
        worldId,
      });
    } catch (err) {
      if (err instanceof HttpsError && err.code !== 'internal') throw new ToolError(err.message);
      throw err;
    }
  }

  return { edit, publish };
}

module.exports = { createFirestoreWorldWriter };
