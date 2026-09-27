'use strict';

const loomCanon = require('../../../loom-canon');

// Reads Cartographer worlds (`loom_worlds`) for the MCP tools. Every
// `cartographer` user sees every world, as on the Cartographer page and in the
// Firestore rules.
//
//   listWorlds({ limit })  -> world document data[], newest first
//   loadWorld(worldId)     -> { meta, world } | null
//     meta   the world document (status, counts, source, warnings, times)
//     world  the assembled CanonWorld (loom-canon loadWorld, cached per
//            instance by canonVersion), or null while it is importing or
//            after its import failed

const PLAYABLE = ['draft', 'published'];

// `getDb` is called lazily so the module can be registered before Firebase
// Admin is initialized.
function createFirestoreWorldReader(getDb) {
  const worlds = () => getDb().collection(loomCanon.WORLDS_COLLECTION);

  return {
    async listWorlds({ limit }) {
      const snap = await worlds().orderBy('createdAtMs', 'desc').limit(limit).get();
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    },

    async loadWorld(worldId) {
      const snap = await worlds().doc(worldId).get();
      if (!snap.exists) return null;
      const meta = { id: snap.id, ...snap.data() };
      if (!PLAYABLE.includes(meta.status)) return { meta, world: null };
      const world = await loomCanon.loadWorld(worldId, { db: getDb(), playableOnly: false });
      return { meta, world };
    },
  };
}

module.exports = { createFirestoreWorldReader };
