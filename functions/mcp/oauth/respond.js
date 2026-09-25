'use strict';

// OAuth 2.0 response helpers (RFC 6749).

// Token / registration endpoint errors: JSON body per RFC 6749 §5.2. Default
// 400; 401 for invalid_client per spec.
function oauthError(res, error, description, status) {
  const code = status || (error === 'invalid_client' ? 401 : 400);
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.status(code).json({ error, ...(description ? { error_description: description } : {}) });
}

// Rate-limited OAuth endpoint (phase 1h): 429 with Retry-After.
function rateLimited(res, retryAfterSec) {
  res.set('Retry-After', String(retryAfterSec));
  oauthError(res, 'rate_limited', `Too many requests. Try again in ${retryAfterSec} seconds.`, 429);
}

// Authorization endpoint errors, once client_id + redirect_uri are validated:
// redirect back to the client with error params (RFC 6749 §4.1.2.1),
// preserving state.
function redirectError(res, redirectUri, error, description, state) {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (description) url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  res.redirect(302, url.toString());
}

// HTML-escape reflected values before embedding them in the consent page.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { oauthError, rateLimited, redirectError, escapeHtml };
