'use strict';

const { resolveOrigin, HOST_RESOURCE_PATH, APP_RESOURCE_PATH } = require('./config');
const { registry: defaultRegistry } = require('./registry');

const WELL_KNOWN_AS = '/.well-known/oauth-authorization-server';
const WELL_KNOWN_PR_PREFIX = '/.well-known/oauth-protected-resource';

// RFC 8414 — OAuth 2.0 Authorization Server Metadata.
//
// One shared authorization server backs every Olympus MCP connector. The
// endpoints are advertised now; they are implemented in later phases —
// /authorize and /token in 1c, /register (Dynamic Client Registration, RFC
// 7591) in 1d. PKCE with S256 is mandatory and public clients (auth method
// "none") are the only supported client type (design §6, §10).
function authorizationServerMetadata(req, res) {
  const origin = resolveOrigin(req);
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    revocation_endpoint: `${origin}/revoke`,
    revocation_endpoint_auth_methods_supported: ['none'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
  });
}

// RFC 9728 — OAuth 2.0 Protected Resource Metadata (path-based).
//
// The protected resource is the MCP endpoint URL itself (.../mcp, or
// .../mcp/<appId>). The doc names the shared authorization server and the
// scope required for that resource. It is served only for resources that
// actually exist — the host endpoint plus every app in the registry — so we
// never advertise a phantom connector; per-app resources light up
// automatically as they register (design §5.3).
function isKnownResource(resourcePath, registry) {
  if (resourcePath === HOST_RESOURCE_PATH) return true;
  const match = APP_RESOURCE_PATH.exec(resourcePath);
  return Boolean(match) && registry.has(match[1]);
}

function protectedResourceMetadata(req, res, registry = defaultRegistry) {
  const resourcePath = req.path.slice(WELL_KNOWN_PR_PREFIX.length) || '/';
  if (!isKnownResource(resourcePath, registry)) {
    res.status(404).json({ error: 'not_found', message: 'Unknown MCP resource.' });
    return;
  }
  const origin = resolveOrigin(req);
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    resource: `${origin}${resourcePath}`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: scopesForResource(resourcePath),
  });
}

// One scope per app: /mcp/<appId> requires scope mcp:<appId> (design §6). The
// host diagnostic resource (/mcp) carries no app scope.
function scopesForResource(resourcePath) {
  const parts = resourcePath.split('/').filter(Boolean); // ['mcp'] or ['mcp', appId]
  return parts.length >= 2 ? [`mcp:${parts[1]}`] : [];
}

module.exports = {
  authorizationServerMetadata,
  protectedResourceMetadata,
  WELL_KNOWN_AS,
  WELL_KNOWN_PR_PREFIX,
};
