'use strict';

const { resolveOrigin } = require('../config');
const { renderConsentPage } = require('./consent-page');
const { redirectError, oauthError, escapeHtml } = require('./respond');
const { generateAuthCode } = require('./tokens');
const { appIdFromScope, scopeForAppId, AUTH_CODE_TTL_SECONDS } = require('./config');
const { CODE_CHALLENGE_METHOD, isValidChallenge } = require('./pkce');

// Parses the OAuth request parameters we care about from query (GET) or JSON
// body (POST). Only these fields are ever echoed back to the client.
function readParams(source) {
  return {
    responseType: source.response_type,
    clientId: source.client_id,
    redirectUri: source.redirect_uri,
    scope: source.scope,
    state: source.state,
    codeChallenge: source.code_challenge,
    codeChallengeMethod: source.code_challenge_method,
    resource: source.resource,
  };
}

// The subset re-sent by the consent page on approval (everything but the
// decision/idToken). Kept minimal and re-validated server-side on POST.
function echoParams(p) {
  const out = {
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: p.scope,
    code_challenge: p.codeChallenge,
    code_challenge_method: p.codeChallengeMethod,
  };
  if (p.state !== undefined) out.state = p.state;
  if (p.resource !== undefined) out.resource = p.resource;
  return out;
}

function appNameFromId(appId) {
  return appId.charAt(0).toUpperCase() + appId.slice(1);
}

// Extracts the single mcp:<appId> scope. Returns { appId } or { error }.
// Exactly one app scope is required — one connector = one app (design §3).
function resolveAppScope(scope) {
  if (typeof scope !== 'string' || scope.trim() === '') {
    return { error: 'scope is required' };
  }
  const appIds = scope.trim().split(/\s+/).map(appIdFromScope).filter(Boolean);
  if (appIds.length !== 1) {
    return { error: 'exactly one mcp:<appId> scope is required' };
  }
  return { appId: appIds[0] };
}

function errorPage(res, status, message) {
  res
    .status(status)
    .set('Content-Type', 'text/html; charset=utf-8')
    .send(
      `<!doctype html><meta charset="utf-8"><body style="background:#0a0e1a;color:#e0e0e0;
     font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;
     justify-content:center"><div style="max-width:420px;text-align:center;padding:2rem">
     <h1 style="color:#ff8a65">Authorization error</h1><p style="color:#90a4ae">${escapeHtml(
       message
     )}</p></div></body>`
    );
}

// Validates client_id + redirect_uri against the registered client. These two
// must be validated before any redirect-based error, because we must never
// redirect to an unverified URI (RFC 6749 §4.1.2.1 / §10.6). Returns
// { client } or { fail } (fail already written as an error page).
async function validateClientAndRedirect(store, params, res) {
  if (!params.clientId) {
    errorPage(res, 400, 'Missing client_id.');
    return { fail: true };
  }
  const client = await store.getClient(params.clientId);
  if (!client) {
    errorPage(res, 400, 'Unknown client_id.');
    return { fail: true };
  }
  const registered = Array.isArray(client.redirectUris) ? client.redirectUris : [];
  if (!params.redirectUri || !registered.includes(params.redirectUri)) {
    errorPage(res, 400, 'redirect_uri does not match a registered value for this client.');
    return { fail: true };
  }
  return { client };
}

function createAuthorizeHandler(deps) {
  const { store, verifyIdToken, now = () => Date.now() } = deps;

  // GET /authorize — render the consent screen after validating the request.
  async function handleGet(req, res) {
    const params = readParams(req.query || {});
    const { client, fail } = await validateClientAndRedirect(store, params, res);
    if (fail) return;

    // From here redirect_uri is trusted, so remaining errors go back to the client.
    if (params.responseType !== 'code') {
      return redirectError(
        res,
        params.redirectUri,
        'unsupported_response_type',
        null,
        params.state
      );
    }
    if (
      params.codeChallengeMethod !== CODE_CHALLENGE_METHOD ||
      !isValidChallenge(params.codeChallenge)
    ) {
      return redirectError(
        res,
        params.redirectUri,
        'invalid_request',
        'PKCE with a valid S256 code_challenge is required',
        params.state
      );
    }
    const scopeResult = resolveAppScope(params.scope);
    if (scopeResult.error) {
      return redirectError(
        res,
        params.redirectUri,
        'invalid_scope',
        scopeResult.error,
        params.state
      );
    }

    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'text/html; charset=utf-8');
    // Anti-clickjacking: the consent screen is a security-decision surface, so
    // it must never be framed and bait-overlaid to trick an approval click.
    res.set('X-Frame-Options', 'DENY');
    res.set('Content-Security-Policy', "frame-ancestors 'none'");
    res.status(200).send(
      renderConsentPage({
        appId: scopeResult.appId,
        appName: appNameFromId(scopeResult.appId),
        clientName: client.clientName,
        oauthParams: echoParams(params),
      })
    );
  }

  // POST /authorize — the consent page's approval: verify the user, confirm app
  // entitlement, and mint a single-use, PKCE-bound authorization code.
  async function handlePost(req, res) {
    const body = req.body || {};
    const params = readParams(body);

    // Re-validate everything; never trust the page.
    if (!params.clientId) return oauthError(res, 'invalid_request', 'Missing client_id.');
    const client = await store.getClient(params.clientId);
    if (!client) return oauthError(res, 'invalid_client', 'Unknown client_id.');
    const registered = Array.isArray(client.redirectUris) ? client.redirectUris : [];
    if (!params.redirectUri || !registered.includes(params.redirectUri)) {
      return oauthError(res, 'invalid_request', 'redirect_uri mismatch.');
    }
    if (
      params.codeChallengeMethod !== CODE_CHALLENGE_METHOD ||
      !isValidChallenge(params.codeChallenge)
    ) {
      return oauthError(res, 'invalid_request', 'PKCE S256 code_challenge required.');
    }
    const scopeResult = resolveAppScope(params.scope);
    if (scopeResult.error) return oauthError(res, 'invalid_scope', scopeResult.error);
    const appId = scopeResult.appId;

    // Resource indicator (RFC 8707): if supplied it must match this app's
    // endpoint; otherwise we derive it. The token's audience is bound to it.
    // origin is the pinned canonical origin in production (never the Host header).
    const origin = resolveOrigin(req);
    const audience = `${origin}/mcp/${appId}`;
    if (params.resource !== undefined && params.resource !== audience) {
      return oauthError(res, 'invalid_target', 'resource does not match the requested app.');
    }

    // Verify the Firebase ID token — this is the human login (design §6).
    let decoded;
    try {
      decoded = await verifyIdToken(body.idToken);
    } catch {
      return oauthError(res, 'access_denied', 'Sign-in required.', 401);
    }

    // Entitlement: the mcp:<appId> scope maps to hasApp(appId) (design §6).
    const apps = Array.isArray(decoded.apps) ? decoded.apps : [];
    if (!apps.includes(appId)) {
      return oauthError(
        res,
        'access_denied',
        `You do not have access to ${appNameFromId(appId)}.`,
        403
      );
    }

    const code = generateAuthCode();
    const nowMs = now();
    await store.putCode({
      code,
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      uid: decoded.uid || decoded.sub,
      appId,
      scope: scopeForAppId(appId),
      audience,
      issuer: origin,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: CODE_CHALLENGE_METHOD,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + AUTH_CODE_TTL_SECONDS * 1000,
    });

    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set('code', code);
    if (params.state !== undefined && params.state !== null && params.state !== '') {
      redirect.searchParams.set('state', params.state);
    }
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ redirect: redirect.toString() });
  }

  return async function handleAuthorize(req, res) {
    if (req.method === 'GET') return handleGet(req, res);
    if (req.method === 'POST') return handlePost(req, res);
    return oauthError(res, 'invalid_request', 'Unsupported method.', 405);
  };
}

module.exports = { createAuthorizeHandler, resolveAppScope, readParams };
