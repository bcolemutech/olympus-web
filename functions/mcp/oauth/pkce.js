'use strict';

const crypto = require('crypto');

// PKCE (RFC 7636) with S256 only — "plain" is rejected everywhere (design §10).

const CODE_CHALLENGE_METHOD = 'S256';

function base64UrlSha256(input) {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

// Constant-time comparison of the expected vs. derived challenge to avoid
// leaking timing information about a code_verifier.
function verifyPkce(codeVerifier, codeChallenge) {
  if (typeof codeVerifier !== 'string' || typeof codeChallenge !== 'string') {
    return false;
  }
  const derived = base64UrlSha256(codeVerifier);
  const a = Buffer.from(derived);
  const b = Buffer.from(codeChallenge);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// A syntactically valid S256 challenge is a base64url string of the right size
// (SHA-256 → 32 bytes → 43 base64url chars, no padding).
function isValidChallenge(codeChallenge) {
  return typeof codeChallenge === 'string' && /^[A-Za-z0-9\-_]{43}$/.test(codeChallenge);
}

module.exports = { CODE_CHALLENGE_METHOD, base64UrlSha256, verifyPkce, isValidChallenge };
