'use strict';

const jwt = require('jsonwebtoken');
const { oauthError, rateLimited } = require('./respond');
const { hashRefreshToken } = require('./tokens');
const { getSigningSecret } = require('./config');
const { resolveOrigin } = require('../config');
const { noopAuditLog } = require('../audit');
const { unlimited } = require('../rate-limit');

// Token revocation (RFC 7009), phase 1h. Public clients identify themselves by
// client_id. Either token type may be presented; both revoke the whole grant —
// the refresh-token family and, through the grant id every access token
// carries, all outstanding access tokens, which the resource server refuses
// on their next use.
//
// Per RFC 7009 §2.2 the response is 200 whether or not the token was valid,
// so the endpoint cannot be used to probe for live tokens. A token issued to a
// different client is treated the same as an unknown one.

function revokedResponse(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.status(200).json({});
}

// Returns the grant id an access token belongs to, or null. The signature and
// issuer must verify, and the audience must be one of this origin's MCP
// resources. An expired token is still accepted here: revoking its grant is
// how a client says "forget this connection".
function grantIdFromAccessToken(token, origin) {
  const escapedOrigin = origin.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  try {
    const claims = jwt.verify(token, getSigningSecret(), {
      algorithms: ['HS256'],
      issuer: origin,
      audience: new RegExp(`^${escapedOrigin}/mcp/[a-z0-9-]+$`),
      ignoreExpiration: true,
    });
    return typeof claims.gid === 'string' ? claims.gid : null;
  } catch {
    return null;
  }
}

function createRevokeHandler(deps) {
  const { store, audit = noopAuditLog, rateLimiter = unlimited, now = () => Date.now() } = deps;

  return async function handleRevoke(req, res) {
    if (req.method !== 'POST') {
      return oauthError(res, 'invalid_request', 'The revocation endpoint requires POST.', 405);
    }
    const body = req.body || {};
    const { token, client_id: clientId } = body;
    if (!token || typeof token !== 'string' || !clientId || typeof clientId !== 'string') {
      return oauthError(res, 'invalid_request', 'token and client_id are required.');
    }

    const limit = await rateLimiter.consume('revoke_client', clientId);
    if (!limit.allowed) {
      await audit.record('rate_limited', { bucket: 'revoke_client', clientId });
      return rateLimited(res, limit.retryAfterSec);
    }

    // token_type_hint is only a lookup hint (RFC 7009 §2.1); try both types.
    let grantId = null;
    const refresh = await store.getRefreshToken(hashRefreshToken(token));
    if (refresh && refresh.clientId === clientId) {
      grantId = refresh.familyId || null;
      if (!grantId) await store.revokeRefreshToken(hashRefreshToken(token));
    } else if (!refresh) {
      const candidate = grantIdFromAccessToken(token, resolveOrigin(req));
      const grant = candidate ? await store.getGrant(candidate) : null;
      if (grant && grant.clientId === clientId) grantId = candidate;
    }

    if (grantId) {
      const grant = await store.revokeGrant(grantId, 'client_request', now());
      if (!grant || !grant.revoked) {
        await audit.record('grant_revoked', {
          ...(grant || refresh || {}),
          grantId,
          clientId,
          reason: 'client_request',
        });
      }
    }
    return revokedResponse(res);
  };
}

module.exports = { createRevokeHandler };
