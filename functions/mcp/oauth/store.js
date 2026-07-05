'use strict';

const { COLLECTIONS } = require('./config');

// Persistence for the OAuth authorization server. The endpoint logic depends
// only on this interface, so it can be exercised with an in-memory store in
// tests (createInMemoryStore) and backed by Firestore in production
// (createFirestoreStore). Both implementations MUST behave identically for the
// atomic operations below.
//
// Interface:
//   getClient(clientId)                  -> client record | null
//   putClient(record)                    -> void            (DCR, phase 1d)
//   putCode(record)                      -> void            (record.code is id)
//   consumeCode(code)                    -> record | null   (atomic single-use)
//   putRefreshToken(record)              -> void            (record.tokenHash is id)
//   getRefreshToken(tokenHash)           -> record | null
//   rotateRefreshToken(oldHash, newRec)  -> { ok, reason?, old? } (atomic)
//   revokeRefreshToken(tokenHash)        -> void

// Shared rotation decision so both stores enforce the exact same rules:
// unknown token, replay of an already-rotated (revoked) token, or an expired
// token are all rejected; a live token is rotated.
function evaluateRotation(oldRecord, nowMs) {
  if (!oldRecord) return { ok: false, reason: 'not_found' };
  if (oldRecord.revoked) return { ok: false, reason: 'reuse', old: oldRecord };
  if (typeof oldRecord.expiresAtMs === 'number' && oldRecord.expiresAtMs <= nowMs) {
    return { ok: false, reason: 'expired', old: oldRecord };
  }
  return { ok: true, old: oldRecord };
}

// ── Firestore-backed store (production) ────────────────────────────────
function createFirestoreStore(db) {
  const col = (name) => db.collection(name);

  return {
    async getClient(clientId) {
      const snap = await col(COLLECTIONS.clients).doc(clientId).get();
      return snap.exists ? { clientId, ...snap.data() } : null;
    },

    async putClient(record) {
      await col(COLLECTIONS.clients).doc(record.clientId).set(record);
    },

    async putCode(record) {
      await col(COLLECTIONS.codes).doc(record.code).set(record);
    },

    async consumeCode(code) {
      const ref = col(COLLECTIONS.codes).doc(code);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        tx.delete(ref); // single-use: gone once read
        return snap.data();
      });
    },

    async putRefreshToken(record) {
      await col(COLLECTIONS.tokens).doc(record.tokenHash).set(record);
    },

    async getRefreshToken(tokenHash) {
      const snap = await col(COLLECTIONS.tokens).doc(tokenHash).get();
      return snap.exists ? snap.data() : null;
    },

    async rotateRefreshToken(oldHash, newRecord, nowMs = Date.now()) {
      const oldRef = col(COLLECTIONS.tokens).doc(oldHash);
      const newRef = col(COLLECTIONS.tokens).doc(newRecord.tokenHash);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(oldRef);
        const decision = evaluateRotation(snap.exists ? snap.data() : null, nowMs);
        if (!decision.ok) {
          // Reuse of a rotated token signals possible theft — revoke it hard.
          if (decision.reason === 'reuse') {
            tx.update(oldRef, { revoked: true });
          }
          return decision;
        }
        tx.update(oldRef, { revoked: true, rotatedTo: newRecord.tokenHash });
        tx.set(newRef, newRecord);
        return decision;
      });
    },

    async revokeRefreshToken(tokenHash) {
      await col(COLLECTIONS.tokens).doc(tokenHash).set({ revoked: true }, { merge: true });
    },
  };
}

// ── In-memory store (tests) ────────────────────────────────────────────
function createInMemoryStore() {
  const clients = new Map();
  const codes = new Map();
  const tokens = new Map();

  return {
    async getClient(clientId) {
      return clients.get(clientId) || null;
    },
    async putClient(record) {
      clients.set(record.clientId, record);
    },
    async putCode(record) {
      codes.set(record.code, record);
    },
    async consumeCode(code) {
      const record = codes.get(code) || null;
      codes.delete(code); // single-use
      return record;
    },
    async putRefreshToken(record) {
      tokens.set(record.tokenHash, record);
    },
    async getRefreshToken(tokenHash) {
      return tokens.get(tokenHash) || null;
    },
    async rotateRefreshToken(oldHash, newRecord, nowMs = Date.now()) {
      const decision = evaluateRotation(tokens.get(oldHash) || null, nowMs);
      if (!decision.ok) {
        if (decision.reason === 'reuse') {
          tokens.set(oldHash, { ...tokens.get(oldHash), revoked: true });
        }
        return decision;
      }
      tokens.set(oldHash, { ...decision.old, revoked: true, rotatedTo: newRecord.tokenHash });
      tokens.set(newRecord.tokenHash, newRecord);
      return decision;
    },
    async revokeRefreshToken(tokenHash) {
      const existing = tokens.get(tokenHash);
      if (existing) tokens.set(tokenHash, { ...existing, revoked: true });
    },
    // test-only introspection
    _debug: { clients, codes, tokens },
  };
}

module.exports = { createFirestoreStore, createInMemoryStore, evaluateRotation };
