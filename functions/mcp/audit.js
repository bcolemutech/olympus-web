'use strict';

const logger = require('firebase-functions/logger');

// Audit log for the MCP layer (design §10, phase 1h): auth events and tool
// calls, stored in `mcp_audit` and kept for AUDIT_RETENTION_DAYS via a
// Firestore TTL policy on `expireAt`.
//
// Only the fields below are ever written — identifiers and outcomes, never
// tokens, tool arguments, or results. Recording is best-effort: a failed audit
// write is logged and swallowed so it can never fail the request it describes.
//
// Events:
//   client_registered     clientId
//   authorization_granted uid, clientId, appId            (code issued)
//   authorization_denied  clientId, appId, reason, uid?   (no_entitlement | sign_in_failed)
//   token_issued          uid, clientId, appId, grantId   (code exchange)
//   token_refreshed       uid, clientId, appId, grantId
//   refresh_rejected      clientId, reason, grantId?      (reuse | expired | not_found | grant_revoked | entitlement_revoked)
//   grant_revoked         uid, clientId, appId, grantId, reason
//   access_rejected       appId, reason, uid?, grantId?   (invalid_token | grant_revoked | insufficient_scope)
//   tool_call             uid, appId, grantId, tool, outcome, durationMs
//   rate_limited          bucket, uid?, clientId?, appId?

const AUDIT_COLLECTION = 'mcp_audit';
const AUDIT_RETENTION_DAYS = 90;
const FIELDS = [
  'uid',
  'clientId',
  'appId',
  'grantId',
  'tool',
  'outcome',
  'reason',
  'bucket',
  'durationMs',
];

function pick(fields) {
  const out = {};
  for (const key of FIELDS) {
    const value = fields[key];
    if (value === undefined || value === null) continue;
    out[key] = typeof value === 'string' ? value.slice(0, 128) : value;
  }
  return out;
}

function createAuditLog(write, { now = () => Date.now() } = {}) {
  return {
    async record(event, fields = {}) {
      const entry = { event, atMs: now(), ...pick(fields) };
      try {
        await write(entry);
      } catch (err) {
        logger.error('mcp audit write failed', { event, error: err.message });
      }
    },
  };
}

// Production: one document per event in mcp_audit.
function createFirestoreAuditLog(getDb, options) {
  const { Timestamp } = require('firebase-admin/firestore');
  return createAuditLog(async (entry) => {
    await getDb()
      .collection(AUDIT_COLLECTION)
      .add({
        ...entry,
        at: Timestamp.fromMillis(entry.atMs),
        expireAt: Timestamp.fromMillis(entry.atMs + AUDIT_RETENTION_DAYS * 86400 * 1000),
      });
  }, options);
}

// Tests: entries collected in memory, in order.
function createInMemoryAuditLog(options) {
  const entries = [];
  const log = createAuditLog(async (entry) => {
    entries.push(entry);
  }, options);
  log.entries = entries;
  log.events = (name) => entries.filter((e) => e.event === name);
  return log;
}

// For handlers constructed without an audit log (e.g. focused unit tests).
const noopAuditLog = { async record() {} };

module.exports = {
  createFirestoreAuditLog,
  createInMemoryAuditLog,
  noopAuditLog,
  AUDIT_COLLECTION,
  AUDIT_RETENTION_DAYS,
};
