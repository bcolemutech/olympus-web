'use strict';

const { isEmulator, originFromRequest } = require('./config');

// TEMPORARY dev/testing shim — NOT a product auth path.
//
// Inbound auth for MCP is the OAuth 2.1 authorization server built in phases
// 1c–1e. Until that exists, the MCP endpoint is reachable only under the
// emulator, so the transport can be exercised with MCP Inspector without wiring
// up a full OAuth flow first:
//   - In the emulator: if MCP_DEV_TOKEN is set, the request's bearer token must
//     match it; if unset, calls are allowed so Inspector works with zero config.
//   - In any deployed environment: always deny, with an RFC 9728 pointer to the
//     protected-resource metadata so a compliant client knows where to look.
//
// Returns true when the request may proceed; otherwise writes a 401 and returns
// false.
function checkDevAuth(req, res) {
  if (!isEmulator()) {
    denyUnauthorized(req, res, 'MCP is not yet enabled in this environment.');
    return false;
  }

  const expected = process.env.MCP_DEV_TOKEN;
  if (!expected) return true; // open in the emulator for Inspector convenience

  if (bearerFrom(req) === expected) return true;

  denyUnauthorized(req, res, 'Invalid or missing dev bearer token.');
  return false;
}

function bearerFrom(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

function denyUnauthorized(req, res, message) {
  const origin = originFromRequest(req);
  // RFC 9728: point the client at this resource's protected-resource metadata.
  const resourceMetadata = `${origin}/.well-known/oauth-protected-resource${req.path}`;
  res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadata}"`);
  res.status(401).json({ error: 'unauthorized', message });
}

module.exports = { checkDevAuth };
