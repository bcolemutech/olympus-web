'use strict';

const versions = require('./versions');

/**
 * Versions kept by the server (planning/the-muse.md §3 VR1, VR2, MS5; M-105 /
 * #893). The Muse connector (M-106) calls `save` before every write it makes
 * to a project or an element, so what was there can be brought back (M-401).
 * The plan itself, and the limit of the last 50 of each thing, are
 * ./versions.js, which is the page's file too.
 *
 *   const store = createVersionStore({ db, FieldValue });
 *   await store.save(projectId, 'elements', elementId);   // by: 'mcp'
 *   await store.save(projectId, null, null, { name: 'Before the rewrite' });
 */

class VersionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VersionError';
  }
}

function createVersionStore({ db, FieldValue }) {
  // Does a plan's writes in a batch: NOW is the server's time.
  function apply(batch, writes) {
    writes.forEach((write) => {
      const ref = db.doc(write.path);
      if (write.op === 'delete') {
        batch.delete(ref);
        return;
      }
      const data = {};
      Object.keys(write.data).forEach((key) => {
        data[key] = versions.isNow(write.data[key])
          ? FieldValue.serverTimestamp()
          : write.data[key];
      });
      batch.set(ref, data);
    });
    return batch;
  }

  // The plan for a version of one thing: the project (no `collection`) or a
  // document of it (`collection` and `id`), as stored now, and the versions
  // of it there are. Gives null when the thing isn't there.
  async function prepare(projectId, collection, id, options = {}) {
    if (!projectId) throw new VersionError('A version needs a project.');
    if (collection && !id) throw new VersionError('A version of a document needs its id.');
    const of = versions.ofPath(projectId, collection, id);
    const thing = await db.doc(of).get();
    if (!thing.exists) return null;
    const existing = await db
      .collection(`muse_projects/${projectId}/versions`)
      .where('of', '==', of)
      .get();
    const plan = versions.planSave({
      projectId,
      id: db.collection(`muse_projects/${projectId}/versions`).doc().id,
      of,
      data: thing.data(),
      existing: existing.docs.map((doc) => ({ id: doc.id, at: doc.get('at') })),
      by: options.by || 'mcp',
      name: options.name,
    });
    if (plan.error) throw new VersionError(plan.error);
    return plan;
  }

  // Keeps a version now: { id, dropped }, or null when the thing isn't there.
  async function save(projectId, collection, id, options = {}) {
    const plan = await prepare(projectId, collection, id, options);
    if (!plan) return null;
    await apply(db.batch(), plan.writes).commit();
    return { id: plan.id, dropped: plan.dropped };
  }

  return { prepare, apply, save };
}

module.exports = { createVersionStore, VersionError };
