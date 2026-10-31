'use strict';

// Persistence for Scriptorium notes (design §9). Every operation is scoped to
// an owner uid, and a note that exists but belongs to someone else is treated
// exactly like a missing one — callers can never read, change, or even detect
// another user's notes.
//
// Interface (both implementations MUST behave identically):
//   list(ownerUid, { limit })                 -> note[] (newest update first)
//   page(ownerUid, { limit, cursor })         -> { notes: summary[], nextCursor }
//                                                (newest update first, no
//                                                bodies; L-397)
//   get(ownerUid, id)                         -> note | null
//   create(ownerUid, { title, body }, nowMs)  -> note
//   update(ownerUid, id, patch, nowMs)        -> note | null  (atomic)
//   remove(ownerUid, id)                      -> boolean      (atomic)
//
// A note is { id, title, body, createdAt, updatedAt } with ISO-8601 times; a
// summary the same without its body. ownerUid is stored on the document but
// never returned. A cursor is opaque: the last summary's update time and id.

const COLLECTION = 'scriptorium_notes';

const millisOf = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : Number(t));
const summaryOf = (note) => {
  const { body, ...rest } = note;
  void body;
  return rest;
};
const encodeCursor = (t, id) => Buffer.from(JSON.stringify({ t, id })).toString('base64url');

/** A cursor read back: { t, id }, or null when it isn't one of ours. */
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const { t, id } = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    return Number.isFinite(t) && typeof id === 'string' && id ? { t, id } : null;
  } catch {
    return null;
  }
}

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
  const { Timestamp, FieldPath } = require('firebase-admin/firestore');
  const col = () => getDb().collection(COLLECTION);

  return {
    async page(ownerUid, { limit, cursor }) {
      let query = col()
        .where('ownerUid', '==', ownerUid)
        .orderBy('updatedAt', 'desc')
        .orderBy(FieldPath.documentId(), 'desc');
      const after = decodeCursor(cursor);
      if (after) query = query.startAfter(Timestamp.fromMillis(after.t), after.id);
      const snap = await query.limit(limit + 1).get();
      const docs = snap.docs.slice(0, limit);
      const last = docs[docs.length - 1];
      return {
        notes: docs.map((doc) => summaryOf(toNote(doc.id, doc.data()))),
        nextCursor:
          snap.docs.length > limit ? encodeCursor(millisOf(last.data().updatedAt), last.id) : null,
      };
    },

    async get(ownerUid, id) {
      const snap = await col().doc(id).get();
      if (!snap.exists || snap.data().ownerUid !== ownerUid) return null;
      return toNote(id, snap.data());
    },

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
    async page(ownerUid, { limit, cursor }) {
      const after = decodeCursor(cursor);
      const mine = [...notes.entries()]
        .filter(([, n]) => n.ownerUid === ownerUid)
        .sort(([aId, a], [bId, b]) => b.updatedAt - a.updatedAt || (aId < bId ? 1 : -1))
        .filter(
          ([id, n]) => !after || n.updatedAt < after.t || (n.updatedAt === after.t && id < after.id)
        );
      const shown = mine.slice(0, limit);
      const last = shown[shown.length - 1];
      return {
        notes: shown.map(([id, n]) => summaryOf(toNote(id, n))),
        nextCursor: mine.length > limit ? encodeCursor(last[1].updatedAt, last[0]) : null,
      };
    },
    async get(ownerUid, id) {
      const n = notes.get(id);
      return n && n.ownerUid === ownerUid ? toNote(id, n) : null;
    },
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

module.exports = {
  createFirestoreNotesStore,
  createInMemoryNotesStore,
  COLLECTION,
  decodeCursor,
};
