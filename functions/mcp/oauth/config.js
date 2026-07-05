'use strict';

const { defineSecret } = require('firebase-functions/params');
const { isEmulator } = require('../config');

// Symmetric signing key for MCP access-token JWTs (design §6: "Functions secret
// for MVP (symmetric)"). Must be created before this reaches production:
//   firebase functions:secrets:set MCP_JWT_SECRET
// The mcpServer function binds it via its `secrets` option so it is injected as
// an env var at runtime.
const MCP_JWT_SECRET = defineSecret('MCP_JWT_SECRET');

// Emulator-only fallback so the OAuth flow can be exercised locally without
// Secret Manager. NEVER used in a deployed environment (getSigningSecret throws
// there if the secret is unset).
const DEV_SIGNING_SECRET = 'dev-only-insecure-mcp-signing-secret-change-me';

function getSigningSecret() {
  const value = MCP_JWT_SECRET.value();
  if (value) return value;
  if (isEmulator()) return DEV_SIGNING_SECRET;
  throw new Error('MCP_JWT_SECRET is not configured.');
}

const ACCESS_TOKEN_TTL_SECONDS = 3600; // 1 hour — short-lived; clients refresh
const AUTH_CODE_TTL_SECONDS = 300; // 5 minutes, single-use (OAuth 2.1 guidance)
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, rotated on use

const COLLECTIONS = {
  clients: 'mcp_oauth_clients',
  codes: 'mcp_oauth_codes',
  tokens: 'mcp_oauth_tokens',
};

// One scope per app: mcp:<appId> maps to the hasApp(appId) requirement
// (design §6). These helpers are the single place that mapping lives.
const SCOPE_PREFIX = 'mcp:';

function appIdFromScope(scope) {
  return scope.startsWith(SCOPE_PREFIX) ? scope.slice(SCOPE_PREFIX.length) : null;
}

function scopeForAppId(appId) {
  return `${SCOPE_PREFIX}${appId}`;
}

module.exports = {
  MCP_JWT_SECRET,
  getSigningSecret,
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  COLLECTIONS,
  SCOPE_PREFIX,
  appIdFromScope,
  scopeForAppId,
};
