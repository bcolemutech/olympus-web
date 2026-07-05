'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { PRIMARY_ORIGIN } = require('../config');
const { getSigningSecret, ACCESS_TOKEN_TTL_SECONDS } = require('./config');

// ── Access tokens (self-validating JWT, HS256) ─────────────────────────
//
// The resource server (phase 1e) verifies these locally with the shared secret
// and the expected audience — no datastore read on the hot path (design §6).
//
// Both `audience` and `issuer` are required on sign, and `audience` is required
// on verify: audience binding (RFC 8707) is what stops a token minted for app A
// being replayed at app B, so the check must never be silently skippable by
// omitting the argument.

function signAccessToken({ uid, audience, scope, issuer, secret = getSigningSecret() }) {
  if (!audience) throw new Error('signAccessToken requires an audience.');
  if (!issuer) throw new Error('signAccessToken requires an issuer.');
  return jwt.sign({ scope }, secret, {
    algorithm: 'HS256',
    issuer,
    subject: uid,
    audience,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

// Verifies signature, issuer, expiry, and audience. Throws if `audience` is
// absent so a resource-server handler cannot accept cross-app tokens by
// forgetting to pass its own audience. `issuer` defaults to the canonical
// origin; the resource server passes its resolved origin explicitly.
function verifyAccessToken(
  token,
  { audience, issuer = PRIMARY_ORIGIN, secret = getSigningSecret() } = {}
) {
  if (!audience) throw new Error('verifyAccessToken requires an audience.');
  return jwt.verify(token, secret, {
    algorithms: ['HS256'],
    issuer,
    audience,
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

// Groups a refresh token and all its rotation successors into one "family".
// On detected reuse the whole family is revoked (OAuth 2.1 / RFC 6819).
function generateFamilyId() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  generateAuthCode,
  generateFamilyId,
};
