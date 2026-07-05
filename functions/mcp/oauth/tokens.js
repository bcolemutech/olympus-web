'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getSigningSecret, TOKEN_ISSUER, ACCESS_TOKEN_TTL_SECONDS } = require('./config');

// ── Access tokens (self-validating JWT, HS256) ─────────────────────────
//
// The resource server (phase 1e) verifies these locally with the shared secret
// and the expected audience — no datastore read on the hot path (design §6).

function signAccessToken({ uid, audience, scope, secret = getSigningSecret() }) {
  return jwt.sign({ scope }, secret, {
    algorithm: 'HS256',
    issuer: TOKEN_ISSUER,
    subject: uid,
    audience,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

// Verifies signature, issuer, expiry, and — when provided — the audience. Audience
// binding (RFC 8707) is what stops a token minted for app A being replayed at
// app B (enforced by the resource server in phase 1e). Returns the decoded
// payload or throws.
function verifyAccessToken(token, { audience, secret = getSigningSecret() } = {}) {
  return jwt.verify(token, secret, {
    algorithms: ['HS256'],
    issuer: TOKEN_ISSUER,
    ...(audience ? { audience } : {}),
  });
}

// ── Refresh tokens (opaque, hashed at rest, rotated on use) ────────────

function generateRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Refresh tokens are stored only as SHA-256 hashes so a datastore leak does not
// expose usable tokens (design §10). The hash also serves as the document id.
function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── Authorization codes (opaque, single-use, short TTL) ────────────────

function generateAuthCode() {
  return crypto.randomBytes(32).toString('base64url');
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  generateAuthCode,
};
