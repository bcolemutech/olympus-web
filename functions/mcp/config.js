'use strict';

// Shared configuration for the inbound MCP layer (Initiative 1). See
// planning/initiative-1-mcp-foundation.md §5 (architecture) and §6 (OAuth).

// The single canonical origin all issued tokens and discovery docs are pinned
// to in production. It is NEVER derived from the request Host header: mcpServer
// is directly invocable at its *.run.app / cloudfunctions.net URL where the
// caller controls Host, so reflecting it would let an attacker mint tokens
// whose RFC 8707 audience points at their own host and publish discovery docs
// pointing at it — defeating the cross-app confinement audience binding exists
// to provide. Override via OLYMPUS_ORIGIN for a different canonical domain.
const PRIMARY_ORIGIN = process.env.OLYMPUS_ORIGIN || 'https://bcoletech.com';

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

// Derives the origin from the request Host header. Used ONLY under the emulator
// (via resolveOrigin), where the request host is trusted and must be honored so
// local discovery URLs and audiences are actually reachable (localhost). Never
// used to build tokens/metadata in a deployed environment.
function originFromRequest(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0]
    .trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return PRIMARY_ORIGIN;
  return `${proto}://${host}`;
}

// The origin used to build discovery docs, token issuers, and token audiences.
// In production this is the fixed canonical origin (Host header ignored); under
// the emulator it is the request origin so local dev works end to end.
function resolveOrigin(req) {
  return isEmulator() ? originFromRequest(req) : PRIMARY_ORIGIN;
}

module.exports = {
  PRIMARY_ORIGIN,
  HOST_RESOURCE_PATH,
  KNOWN_RESOURCE_PATHS,
  isEmulator,
  originFromRequest,
  resolveOrigin,
};
