'use strict';

// Persistence for Scriptorium notes (design §9). Every operation is scoped to
// an owner uid, and a note that exists but belongs to someone else is treated
// exactly like a missing one — callers can never read, change, or even detect
// another user's notes.
//
// Interface (both implementations MUST behave identically):
//   list(ownerUid, { limit })                 -> note[] (newest update first)
//   create(ownerUid, { title, body }, nowMs)  -> note
//   update(ownerUid, id, patch, nowMs)        -> note | null  (atomic)
//   remove(ownerUid, id)                      -> boolean      (atomic)
//
// A note is { id, title, body, createdAt, updatedAt } with ISO-8601 times.
// ownerUid is stored on the document but never returned.

const COLLECTION = 'scriptorium_notes';

function toNote(id, data) {
  const iso = (t) => (t && typeof t.toDate === 'function' ? t.toDate() : new Date(t)).toISOString();
  return {
    id,
    title: data.title,
    body: data.body,
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
  };
}

// ── Firestore-backed store (production) ────────────────────────────────
// `getDb` is called lazily so the module can be registered before Firebase
// Admin is initialized.
function createFirestoreNotesStore(getDb) {
  const { Timestamp } = require('firebase-admin/firestore');
  const col = () => getDb().collection(COLLECTION);

  return {
    async list(ownerUid, { limit }) {
      const snap = await col()
        .where('ownerUid', '==', ownerUid)
        .orderBy('updatedAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((doc) => toNote(doc.id, doc.data()));
    },

    async create(ownerUid, { title, body }, nowMs) {
      const now = Timestamp.fromMillis(nowMs);
      const record = { ownerUid, title, body, createdAt: now, updatedAt: now };
      const ref = await col().add(record);
      return toNote(ref.id, record);
    },

    async update(ownerUid, id, patch, nowMs) {
      const ref = col().doc(id);
      return getDb().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().ownerUid !== ownerUid) return null;
        const changes = { ...patch, updatedAt: Timestamp.fromMillis(nowMs) };
        tx.update(ref, changes);
        return toNote(id, { ...snap.data(), ...changes });
      });
    },

    async remove(ownerUid, id) {
      const ref = col().doc(id);
      return getDb().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().ownerUid !== ownerUid) return false;
        tx.delete(ref);
        return true;
      });
    },
  };
}

// ── In-memory store (tests) ────────────────────────────────────────────
function createInMemoryNotesStore() {
  const notes = new Map();
  let seq = 0;

  return {
    async list(ownerUid, { limit }) {
      return [...notes.entries()]
        .filter(([, n]) => n.ownerUid === ownerUid)
        .sort(([, a], [, b]) => b.updatedAt - a.updatedAt || b.seq - a.seq)
        .slice(0, limit)
        .map(([id, n]) => toNote(id, n));
    },
    async create(ownerUid, { title, body }, nowMs) {
      seq += 1;
      const id = `note${String(seq).padStart(16, '0')}`;
      notes.set(id, { ownerUid, title, body, createdAt: nowMs, updatedAt: nowMs, seq });
      return toNote(id, notes.get(id));
    },
    async update(ownerUid, id, patch, nowMs) {
      const existing = notes.get(id);
      if (!existing || existing.ownerUid !== ownerUid) return null;
      seq += 1;
      const next = { ...existing, ...patch, updatedAt: nowMs, seq };
      notes.set(id, next);
      return toNote(id, next);
    },
    async remove(ownerUid, id) {
      const existing = notes.get(id);
      if (!existing || existing.ownerUid !== ownerUid) return false;
      notes.delete(id);
      return true;
    },
    // test-only introspection
    _debug: { notes },
  };
}

module.exports = { createFirestoreNotesStore, createInMemoryNotesStore, COLLECTION };
