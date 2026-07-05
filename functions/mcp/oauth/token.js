'use strict';

const { oauthError } = require('./respond');
const { verifyPkce } = require('./pkce');
const {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  generateFamilyId,
} = require('./tokens');
const { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } = require('./config');

function tokenResponse(res, { accessToken, refreshToken, scope }) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.status(200).json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope,
  });
}

function createTokenHandler(deps) {
  // getEntitlements(uid) -> current apps[] claim, used to re-check access on
  // refresh so a revoked app claim stops working within the access-token TTL
  // rather than lingering for the full refresh lifetime.
  const { store, getEntitlements, now = () => Date.now() } = deps;

  // Issues a fresh access token + refresh token for a validated identity/app.
  // `familyId` groups a refresh token with its rotation successors for
  // reuse-based family revocation.
  async function issueTokens(
    res,
    { uid, clientId, appId, scope, audience, issuer, familyId },
    nowMs
  ) {
    const accessToken = signAccessToken({ uid, audience, scope, issuer });
    const refreshToken = generateRefreshToken();
    await store.putRefreshToken({
      tokenHash: hashRefreshToken(refreshToken),
      uid,
      clientId,
      appId,
      scope,
      audience,
      issuer,
      familyId,
      revoked: false,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
    return tokenResponse(res, { accessToken, refreshToken, scope });
  }

  // grant_type=authorization_code — exchange a PKCE-bound, single-use code.
  async function authorizationCodeGrant(req, res, body) {
    const {
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    } = body;

    if (!code || !codeVerifier || !clientId || !redirectUri) {
      return oauthError(res, 'invalid_request', 'Missing required parameters.');
    }

    // Single-use: consuming the code removes it, so a replay finds nothing.
    const record = await store.consumeCode(code);
    if (!record) return oauthError(res, 'invalid_grant', 'Invalid or expired authorization code.');
    if (typeof record.expiresAtMs === 'number' && record.expiresAtMs <= now()) {
      return oauthError(res, 'invalid_grant', 'Authorization code expired.');
    }
    if (record.clientId !== clientId) {
      return oauthError(res, 'invalid_grant', 'client_id mismatch.');
    }
    if (record.redirectUri !== redirectUri) {
      return oauthError(res, 'invalid_grant', 'redirect_uri mismatch.');
    }
    if (!verifyPkce(codeVerifier, record.codeChallenge)) {
      return oauthError(res, 'invalid_grant', 'PKCE verification failed.');
    }

    return issueTokens(
      res,
      {
        uid: record.uid,
        clientId: record.clientId,
        appId: record.appId,
        scope: record.scope,
        audience: record.audience,
        issuer: record.issuer,
        familyId: generateFamilyId(), // new family for this authorization
      },
      now()
    );
  }

  // grant_type=refresh_token — rotate the refresh token and mint a new access
  // token. Rotation is atomic; presenting an already-rotated token is treated
  // as reuse and rejected (design §6, §10).
  async function refreshTokenGrant(req, res, body) {
    const { refresh_token: refreshToken, client_id: clientId } = body;
    if (!refreshToken || !clientId) {
      return oauthError(res, 'invalid_request', 'Missing required parameters.');
    }

    const oldHash = hashRefreshToken(refreshToken);
    const old = await store.getRefreshToken(oldHash);
    if (!old || old.clientId !== clientId) {
      return oauthError(res, 'invalid_grant', 'Invalid refresh token.');
    }

    // Re-check entitlement against the user's *current* claims. If the app was
    // revoked since consent, stop issuing tokens (and revoke the family so the
    // refresh chain is dead), rather than honoring it for the refresh lifetime.
    if (getEntitlements) {
      let apps;
      try {
        apps = await getEntitlements(old.uid);
      } catch {
        return oauthError(res, 'invalid_grant', 'Unable to verify access.');
      }
      if (!Array.isArray(apps) || !apps.includes(old.appId)) {
        if (old.familyId) await store.revokeFamily(old.familyId);
        return oauthError(res, 'invalid_grant', 'Access to this app has been revoked.');
      }
    }

    const nowMs = now();
    const newRefreshToken = generateRefreshToken();
    const newRecord = {
      tokenHash: hashRefreshToken(newRefreshToken),
      uid: old.uid,
      clientId: old.clientId,
      appId: old.appId,
      scope: old.scope,
      audience: old.audience,
      issuer: old.issuer,
      familyId: old.familyId,
      revoked: false,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + REFRESH_TOKEN_TTL_SECONDS * 1000,
      rotatedFrom: oldHash,
    };

    const result = await store.rotateRefreshToken(oldHash, newRecord, nowMs);
    if (!result.ok) {
      // Reuse of an already-rotated token signals theft — kill the whole family
      // so the attacker's live successor token is revoked too.
      if (result.reason === 'reuse' && old.familyId) {
        await store.revokeFamily(old.familyId);
      }
      return oauthError(res, 'invalid_grant', 'Refresh token is no longer valid.');
    }

    const accessToken = signAccessToken({
      uid: old.uid,
      audience: old.audience,
      scope: old.scope,
      issuer: old.issuer,
    });
    return tokenResponse(res, { accessToken, refreshToken: newRefreshToken, scope: old.scope });
  }

  return async function handleToken(req, res) {
    if (req.method !== 'POST') {
      return oauthError(res, 'invalid_request', 'The token endpoint requires POST.', 405);
    }
    const body = req.body || {};
    switch (body.grant_type) {
      case 'authorization_code':
        return authorizationCodeGrant(req, res, body);
      case 'refresh_token':
        return refreshTokenGrant(req, res, body);
      default:
        return oauthError(res, 'unsupported_grant_type', 'Unsupported grant_type.');
    }
  };
}

module.exports = { createTokenHandler };
