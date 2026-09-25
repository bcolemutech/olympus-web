'use strict';

const { oauthError, rateLimited } = require('./respond');
const { verifyPkce } = require('./pkce');
const {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  generateFamilyId,
} = require('./tokens');
const { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } = require('./config');
const { noopAuditLog } = require('../audit');
const { unlimited } = require('../rate-limit');

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
  const {
    store,
    getEntitlements,
    audit = noopAuditLog,
    rateLimiter = unlimited,
    now = () => Date.now(),
  } = deps;

  // Issues a fresh access token + refresh token for a validated grant, and
  // keeps the grant and its client alive for the refresh-token lifetime.
  async function issueTokens(res, grant, nowMs) {
    const { grantId, uid, clientId, appId, scope, audience, issuer } = grant;
    const accessToken = signAccessToken({ uid, audience, scope, issuer, grantId });
    const refreshToken = generateRefreshToken();
    const expiresAtMs = nowMs + REFRESH_TOKEN_TTL_SECONDS * 1000;
    await store.putRefreshToken({
      tokenHash: hashRefreshToken(refreshToken),
      uid,
      clientId,
      appId,
      scope,
      audience,
      issuer,
      familyId: grantId,
      revoked: false,
      createdAtMs: nowMs,
      expiresAtMs,
    });
    await store.touchClient(clientId, expiresAtMs);
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

    // Each successful code exchange starts a new grant: one authorization of
    // one client for one app, revocable as a unit.
    const nowMs = now();
    const client = await store.getClient(record.clientId);
    const grant = {
      grantId: generateFamilyId(),
      uid: record.uid,
      clientId: record.clientId,
      appId: record.appId,
      scope: record.scope,
      audience: record.audience,
      issuer: record.issuer,
      revoked: false,
      createdAtMs: nowMs,
      lastUsedAtMs: nowMs,
      expiresAtMs: nowMs + REFRESH_TOKEN_TTL_SECONDS * 1000,
      ...(client && client.clientName ? { clientName: client.clientName } : {}),
    };
    await store.putGrant(grant);
    await audit.record('token_issued', grant);
    return issueTokens(res, grant, nowMs);
  }

  // Revokes the grant (and with it the whole refresh family) for `reason`.
  async function revokeGrant(old, reason, nowMs) {
    if (!old.familyId) return;
    const grant = await store.revokeGrant(old.familyId, reason, nowMs);
    // No grant doc means a pre-1h family: its refresh tokens are still revoked.
    if (!grant || !grant.revoked) {
      await audit.record('grant_revoked', { ...(grant || old), grantId: old.familyId, reason });
    }
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
      await audit.record('refresh_rejected', { clientId, reason: 'not_found' });
      return oauthError(res, 'invalid_grant', 'Invalid refresh token.');
    }
    const nowMs = now();

    // A revoked grant ends the refresh chain, whatever state its tokens are in.
    let grant = old.familyId ? await store.getGrant(old.familyId) : null;
    if (grant && grant.revoked) {
      await audit.record('refresh_rejected', {
        ...old,
        grantId: old.familyId,
        reason: 'grant_revoked',
      });
      return oauthError(res, 'invalid_grant', 'This authorization has been revoked.');
    }

    // Re-check entitlement against the user's *current* claims. If the app was
    // revoked since consent, stop issuing tokens (and revoke the grant so the
    // refresh chain is dead), rather than honoring it for the refresh lifetime.
    if (getEntitlements) {
      let apps;
      try {
        apps = await getEntitlements(old.uid);
      } catch {
        return oauthError(res, 'invalid_grant', 'Unable to verify access.');
      }
      if (!Array.isArray(apps) || !apps.includes(old.appId)) {
        await revokeGrant(old, 'entitlement_revoked', nowMs);
        await audit.record('refresh_rejected', {
          ...old,
          grantId: old.familyId,
          reason: 'entitlement_revoked',
        });
        return oauthError(res, 'invalid_grant', 'Access to this app has been revoked.');
      }
    }

    const newRefreshToken = generateRefreshToken();
    const expiresAtMs = nowMs + REFRESH_TOKEN_TTL_SECONDS * 1000;
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
      expiresAtMs,
      rotatedFrom: oldHash,
    };

    const result = await store.rotateRefreshToken(oldHash, newRecord, nowMs);
    if (!result.ok) {
      // Reuse of an already-rotated token signals theft — revoke the grant so
      // the attacker's live successor token (and access tokens) die too.
      if (result.reason === 'reuse') await revokeGrant(old, 'reuse', nowMs);
      await audit.record('refresh_rejected', {
        ...old,
        grantId: old.familyId,
        reason: result.reason,
      });
      return oauthError(res, 'invalid_grant', 'Refresh token is no longer valid.');
    }

    // Grants began with phase 1h: a refresh family from before then has none,
    // so create it now. Its next access token carries the grant id.
    if (!grant) {
      grant = {
        grantId: old.familyId,
        uid: old.uid,
        clientId: old.clientId,
        appId: old.appId,
        scope: old.scope,
        audience: old.audience,
        issuer: old.issuer,
        revoked: false,
        createdAtMs: old.createdAtMs || nowMs,
        lastUsedAtMs: nowMs,
        expiresAtMs,
      };
      await store.putGrant(grant);
    } else {
      await store.touchGrant(grant.grantId, nowMs, expiresAtMs);
    }
    await store.touchClient(old.clientId, expiresAtMs);
    await audit.record('token_refreshed', { ...old, grantId: old.familyId });

    const accessToken = signAccessToken({
      uid: old.uid,
      audience: old.audience,
      scope: old.scope,
      issuer: old.issuer,
      grantId: old.familyId,
    });
    return tokenResponse(res, { accessToken, refreshToken: newRefreshToken, scope: old.scope });
  }

  return async function handleToken(req, res) {
    if (req.method !== 'POST') {
      return oauthError(res, 'invalid_request', 'The token endpoint requires POST.', 405);
    }
    const body = req.body || {};
    const limit = await rateLimiter.consume('token_client', body.client_id || 'missing');
    if (!limit.allowed) {
      await audit.record('rate_limited', { bucket: 'token_client', clientId: body.client_id });
      return rateLimited(res, limit.retryAfterSec);
    }
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
