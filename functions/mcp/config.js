'use strict';

// Shared configuration for the inbound MCP layer (Initiative 1). See
// planning/initiative-1-mcp-foundation.md §5 (architecture) and §6 (OAuth).

// Fallback origin when the request carries no usable Host header. Discovery
// docs and token audiences must be origin-matching, so we prefer the live
// request origin (originFromRequest) and only fall back to this.
const PRIMARY_ORIGIN = 'https://olympus-dfa00.web.app';

// The host-level diagnostic MCP endpoint used by the 1a transport spike.
// Per-app resource servers mount at /mcp/<appId> later (phases 1e–1f).
const HOST_RESOURCE_PATH = '/mcp';

// Resources that currently exist as reachable MCP endpoints. Per-app resource
// servers register here as they land; discovery docs (RFC 9728) are served
// only for known resources so we never advertise a connector that 404s.
const KNOWN_RESOURCE_PATHS = new Set([HOST_RESOURCE_PATH]);

// True when running under the Firebase emulator suite. The 1a dev bearer shim
// only relaxes auth in this mode; deployed environments stay closed until the
// OAuth 2.1 authorization server lands (phases 1c–1e).
function isEmulator() {
  return process.env.FUNCTIONS_EMULATOR === 'true';
}

// Derives the request's own origin so discovery URLs and audiences match the
// host the client actually reached (web.app, firebaseapp.com, a custom domain,
// or the local emulator). Behind Hosting rewrites the original Host header is
// preserved.
function originFromRequest(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0]
    .trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return PRIMARY_ORIGIN;
  return `${proto}://${host}`;
}

module.exports = {
  PRIMARY_ORIGIN,
  HOST_RESOURCE_PATH,
  KNOWN_RESOURCE_PATHS,
  isEmulator,
  originFromRequest,
};
