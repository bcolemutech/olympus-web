'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const { noopAuditLog } = require('./audit');

// Connection management for the Grand Hall (design §12, phase 1i): a signed-in
// user lists the MCP connectors they have authorized and revokes any of them.
// A "connection" is a grant (phase 1h), so revoking one kills its refresh
// family and makes /mcp/<app> refuse its access tokens on their next call.
//
// Only the caller's own grants are ever visible or revocable; someone else's
// grant id is indistinguishable from a missing one.

const GRANT_ID = /^[a-f0-9]{32}$/;
const MAX_CONNECTIONS = 100;

const iso = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString() : null);

function createConnectionsService({ store, audit = noopAuditLog, now = () => Date.now() }) {
  return {
    // Active (unrevoked, unexpired) connections, most recently used first.
    async list(uid) {
      const nowMs = now();
      const active = (await store.listGrantsForUser(uid))
        .filter((g) => !g.revoked && !(typeof g.expiresAtMs === 'number' && g.expiresAtMs <= nowMs))
        .sort(
          (a, b) => (b.lastUsedAtMs || b.createdAtMs || 0) - (a.lastUsedAtMs || a.createdAtMs || 0)
        )
        .slice(0, MAX_CONNECTIONS);

      // Grants backfilled for pre-1h connections carry no client name; look
      // it up from the registration while it still exists.
      return Promise.all(
        active.map(async (g) => {
          let clientName = g.clientName || null;
          if (!clientName && g.clientId) {
            const client = await store.getClient(g.clientId);
            clientName = (client && client.clientName) || null;
          }
          return {
            grantId: g.grantId,
            appId: g.appId,
            clientName,
            connectedAt: iso(g.createdAtMs),
            lastUsedAt: iso(g.lastUsedAtMs),
            expiresAt: iso(g.expiresAtMs),
          };
        })
      );
    },

    // Revokes one of the caller's connections. Idempotent.
    async revoke(uid, grantId) {
      if (typeof grantId !== 'string' || !GRANT_ID.test(grantId)) {
        throw new HttpsError('invalid-argument', 'A valid connection id is required.');
      }
      const grant = await store.getGrant(grantId);
      if (!grant || grant.uid !== uid) {
        throw new HttpsError('not-found', 'Connection not found.');
      }
      if (!grant.revoked) {
        await store.revokeGrant(grantId, 'user_request', now());
        await audit.record('grant_revoked', { ...grant, reason: 'user_request' });
      }
      return { revoked: true, grantId };
    },
  };
}

function requireSignedIn(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  return request.auth.uid;
}

module.exports = { createConnectionsService, requireSignedIn, GRANT_ID };
