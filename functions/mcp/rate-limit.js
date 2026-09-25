'use strict';

const crypto = require('crypto');
const logger = require('firebase-functions/logger');

// Rate limiting for the MCP layer (design §10, phase 1h). Fixed-window
// counters — one Firestore document per (bucket, key, window) — so limits hold
// across every Cloud Functions instance, not just the one serving a request.
// Counter documents expire through a TTL policy on `expireAt`.
//
// Fail-open: if the counter store is unavailable the request is allowed and
// the failure logged. The limiter guards against abuse; it must never be the
// reason a working connector goes down.
//
// Keys are hashed before use, so raw client IPs are never stored.

const RATE_LIMIT_COLLECTION = 'mcp_rate_limits';

// Budgets per bucket. Auth endpoints see very little legitimate traffic (a
// connect is one registration, one approval, one token exchange; refresh is
// roughly hourly), so these are generous for real use and tight for abuse.
// Claude's registrations arrive from Anthropic's servers, so the per-IP
// registration budget is shared by everyone connecting through Claude.
const LIMITS = {
  register_ip: { limit: 30, windowMs: 60 * 60 * 1000 },
  register_global: { limit: 1000, windowMs: 60 * 60 * 1000 },
  authorize_ip: { limit: 30, windowMs: 10 * 60 * 1000 },
  token_client: { limit: 30, windowMs: 10 * 60 * 1000 },
  revoke_client: { limit: 30, windowMs: 10 * 60 * 1000 },
  tool_call: { limit: 120, windowMs: 60 * 1000 },
};

function counterId(bucket, key, windowStart) {
  const hashed = crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 32);
  return `${bucket}_${hashed}_${windowStart}`;
}

// increment(id, expiresAtMs) -> new count for that window.
function createRateLimiter(increment, { limits = LIMITS, now = () => Date.now() } = {}) {
  return {
    // Counts one request against `bucket` for `key`. Returns
    // { allowed: true } or { allowed: false, retryAfterSec }.
    async consume(bucket, key) {
      const budget = limits[bucket];
      if (!budget) throw new Error(`Unknown rate-limit bucket "${bucket}".`);
      const nowMs = now();
      const windowStart = Math.floor(nowMs / budget.windowMs) * budget.windowMs;
      const windowEnd = windowStart + budget.windowMs;
      let count;
      try {
        count = await increment(counterId(bucket, key, windowStart), windowEnd);
      } catch (err) {
        logger.error('mcp rate limiter unavailable; allowing request', {
          bucket,
          error: err.message,
        });
        return { allowed: true };
      }
      if (count <= budget.limit) return { allowed: true };
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowEnd - nowMs) / 1000)) };
    },
  };
}

function createFirestoreRateLimiter(getDb, options) {
  const { FieldValue, Timestamp } = require('firebase-admin/firestore');
  return createRateLimiter(async (id, windowEndMs) => {
    const db = getDb();
    const ref = db.collection(RATE_LIMIT_COLLECTION).doc(id);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = (snap.exists ? snap.data().count : 0) + 1;
      if (snap.exists) {
        tx.update(ref, { count: FieldValue.increment(1) });
      } else {
        // Kept an hour past the window so a late read still sees the count.
        tx.set(ref, { count: 1, expireAt: Timestamp.fromMillis(windowEndMs + 3600 * 1000) });
      }
      return count;
    });
  }, options);
}

function createInMemoryRateLimiter(options) {
  const counts = new Map();
  const limiter = createRateLimiter(async (id) => {
    const count = (counts.get(id) || 0) + 1;
    counts.set(id, count);
    return count;
  }, options);
  limiter._debug = { counts };
  return limiter;
}

// For handlers constructed without a limiter (e.g. focused unit tests).
const unlimited = {
  async consume() {
    return { allowed: true };
  },
};

// Best-effort client IP for per-IP budgets. Behind Cloudflare the client is
// `cf-connecting-ip`; otherwise the first X-Forwarded-For hop. Both can be
// forged by a client that bypasses the proxy, which only lets it spread its
// own requests across keys — the global registration budget still binds.
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf.trim();
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.ip || 'unknown';
}

module.exports = {
  createFirestoreRateLimiter,
  createInMemoryRateLimiter,
  unlimited,
  clientIp,
  LIMITS,
  RATE_LIMIT_COLLECTION,
};
