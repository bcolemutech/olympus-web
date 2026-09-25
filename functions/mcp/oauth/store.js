'use strict';

const { Timestamp } = require('firebase-admin/firestore');
const { COLLECTIONS } = require('./config');

// Adds a Firestore Timestamp mirror of expiresAtMs so a Firestore TTL policy
// (configured on the `expireAt` field of mcp_oauth_codes / mcp_oauth_tokens)
// can auto-delete expired docs — abandoned auth codes and revoked/expired
// refresh tokens otherwise accumulate unbounded. Revoked-but-unexpired tokens
// are retained until natural expiry so reuse detection still works.
function withExpireAt(record) {
  return typeof record.expiresAtMs === 'number'
    ? { ...record, expireAt: Timestamp.fromMillis(record.expiresAtMs) }
    : record;
}

// Persistence for the OAuth authorization server. The endpoint logic depends
// only on this interface, so it can be exercised with an in-memory store in
// tests (createInMemoryStore) and backed by Firestore in production
// (createFirestoreStore). Both implementations MUST behave identically for the
// atomic operations below.
//
// Interface:
//   getClient(clientId)                  -> client record | null
//   putClient(record)                    -> void            (DCR, phase 1d)
//   touchClient(clientId, expiresAtMs)   -> void            (extend client TTL)
//   putGrant(record)                     -> void            (record.grantId is id)
//   getGrant(grantId)                    -> grant | null
//   touchGrant(grantId, nowMs, expiresAtMs) -> void         (on refresh)
//   revokeGrant(grantId, reason, nowMs)  -> grant | null    (grant + its refresh family)
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
      await col(COLLECTIONS.clients).doc(record.clientId).set(withExpireAt(record));
    },

    async touchClient(clientId, expiresAtMs) {
      await col(COLLECTIONS.clients)
        .doc(clientId)
        .set(withExpireAt({ expiresAtMs }), { merge: true });
    },

    async putGrant(record) {
      await col(COLLECTIONS.grants).doc(record.grantId).set(withExpireAt(record));
    },

    async getGrant(grantId) {
      const snap = await col(COLLECTIONS.grants).doc(grantId).get();
      return snap.exists ? snap.data() : null;
    },

    async touchGrant(grantId, nowMs, expiresAtMs) {
      await col(COLLECTIONS.grants)
        .doc(grantId)
        .set(withExpireAt({ lastUsedAtMs: nowMs, expiresAtMs }), { merge: true });
    },

    // Marks the grant revoked and kills its refresh-token family. Returns the
    // grant as it was, or null if unknown. Idempotent.
    async revokeGrant(grantId, reason, nowMs) {
      const ref = col(COLLECTIONS.grants).doc(grantId);
      const grant = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        if (!snap.data().revoked) {
          tx.update(ref, { revoked: true, revokedAtMs: nowMs, revokedReason: reason });
        }
        return snap.data();
      });
      await this.revokeFamily(grantId);
      return grant;
    },

    async putCode(record) {
      await col(COLLECTIONS.codes).doc(record.code).set(withExpireAt(record));
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
      await col(COLLECTIONS.tokens).doc(record.tokenHash).set(withExpireAt(record));
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
        if (!decision.ok) return decision; // caller handles reuse (family revocation)
        tx.update(oldRef, { revoked: true, rotatedTo: newRecord.tokenHash });
        tx.set(newRef, withExpireAt(newRecord));
        return decision;
      });
    },

    async revokeRefreshToken(tokenHash) {
      await col(COLLECTIONS.tokens).doc(tokenHash).set({ revoked: true }, { merge: true });
    },

    // Revokes every refresh token in a rotation family (theft response).
    async revokeFamily(familyId) {
      const snap = await col(COLLECTIONS.tokens).where('familyId', '==', familyId).get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.update(doc.ref, { revoked: true }));
      await batch.commit();
    },
  };
}

// ── In-memory store (tests) ────────────────────────────────────────────
function createInMemoryStore() {
  const clients = new Map();
  const codes = new Map();
  const tokens = new Map();
  const grants = new Map();

  return {
    async getClient(clientId) {
      return clients.get(clientId) || null;
    },
    async putClient(record) {
      clients.set(record.clientId, record);
    },
    async touchClient(clientId, expiresAtMs) {
      const existing = clients.get(clientId);
      if (existing) clients.set(clientId, { ...existing, expiresAtMs });
    },
    async putGrant(record) {
      grants.set(record.grantId, record);
    },
    async getGrant(grantId) {
      return grants.get(grantId) || null;
    },
    async touchGrant(grantId, nowMs, expiresAtMs) {
      const existing = grants.get(grantId);
      if (existing) grants.set(grantId, { ...existing, lastUsedAtMs: nowMs, expiresAtMs });
    },
    async revokeGrant(grantId, reason, nowMs) {
      const grant = grants.get(grantId) || null;
      if (grant && !grant.revoked) {
        grants.set(grantId, { ...grant, revoked: true, revokedAtMs: nowMs, revokedReason: reason });
      }
      await this.revokeFamily(grantId);
      return grant;
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
      if (!decision.ok) return decision; // caller handles reuse (family revocation)
      tokens.set(oldHash, { ...decision.old, revoked: true, rotatedTo: newRecord.tokenHash });
      tokens.set(newRecord.tokenHash, newRecord);
      return decision;
    },
    async revokeRefreshToken(tokenHash) {
      const existing = tokens.get(tokenHash);
      if (existing) tokens.set(tokenHash, { ...existing, revoked: true });
    },
    async revokeFamily(familyId) {
      for (const [hash, record] of tokens) {
        if (record.familyId === familyId) tokens.set(hash, { ...record, revoked: true });
      }
    },
    // test-only introspection
    _debug: { clients, codes, tokens, grants },
  };
}

module.exports = { createFirestoreStore, createInMemoryStore, evaluateRotation };
