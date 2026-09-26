'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { handleMcpRequest } = require('./transport');
const { buildHostServer } = require('./host');
const { checkDevAuth } = require('./auth');
const {
  authorizationServerMetadata,
  protectedResourceMetadata,
  WELL_KNOWN_AS,
  WELL_KNOWN_PR_PREFIX,
} = require('./discovery');
const { HOST_RESOURCE_PATH, APP_RESOURCE_PATH } = require('./config');
const { MCP_JWT_SECRET } = require('./oauth/config');
const { registry } = require('./registry');
const { handleAppRequest } = require('./app-server');
const registerApps = require('./apps');

// Populate the process-wide registry with every app's MCP module (design §8).
registerApps(registry);

// Firestore-backed services shared by the authorization server and the
// per-app resource servers: the OAuth store (clients, codes, refresh tokens,
// grants), the audit log, and the rate limiter. Built lazily on first use so
// Firebase Admin is initialized (by functions/index.js) first, and cached
// across warm invocations.
let _services;
function services() {
  if (!_services) {
    const { getFirestore } = require('firebase-admin/firestore');
    const { createFirestoreStore } = require('./oauth/store');
    const { createFirestoreAuditLog } = require('./audit');
    const { createFirestoreRateLimiter } = require('./rate-limit');
    _services = {
      store: createFirestoreStore(getFirestore()),
      audit: createFirestoreAuditLog(getFirestore),
      rateLimiter: createFirestoreRateLimiter(getFirestore),
    };
  }
  return _services;
}

// OAuth authorization-server handlers (/register, /authorize, /token,
// /revoke), built lazily on first use.
let _oauth;
function oauthHandlers() {
  if (!_oauth) {
    const { getAuth } = require('firebase-admin/auth');
    const { createAuthorizeHandler } = require('./oauth/authorize');
    const { createTokenHandler } = require('./oauth/token');
    const { createRegisterHandler } = require('./oauth/register');
    const { createRevokeHandler } = require('./oauth/revoke');

    const { store, audit, rateLimiter } = services();
    const verifyIdToken = async (idToken) => {
      const decoded = await getAuth().verifyIdToken(idToken);
      return { uid: decoded.uid, sub: decoded.sub, apps: decoded.apps };
    };
    // Current app entitlements for a uid, re-checked on refresh so a revoked
    // claim stops working within the access-token TTL.
    const getEntitlements = async (uid) => {
      const user = await getAuth().getUser(uid);
      const apps = user.customClaims && user.customClaims.apps;
      return Array.isArray(apps) ? apps : [];
    };
    _oauth = {
      authorize: createAuthorizeHandler({
        store,
        verifyIdToken,
        isKnownApp: (appId) => registry.has(appId),
        audit,
        rateLimiter,
      }),
      token: createTokenHandler({ store, getEntitlements, audit, rateLimiter }),
      register: createRegisterHandler({ store, audit, rateLimiter }),
      revoke: createRevokeHandler({ store, audit, rateLimiter }),
    };
  }
  return _oauth;
}

// CORS for browser-based MCP clients (e.g. the claude.ai web connector). The
// MCP session and protocol-version headers must be allowed on requests and
// exposed on responses. Non-browser clients (iOS, desktop, Inspector proxy)
// ignore these but they are harmless.
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.set(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID'
  );
  res.set('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
}

// Dispatches a request routed here by Hosting rewrites (/mcp/**,
// /.well-known/**). Exported for local testing; the deployed entry point is the
// `mcpServer` function below.
async function route(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const path = req.path || '/';

  // Discovery documents (RFC 8414 / RFC 9728) — unauthenticated by spec.
  if (path === WELL_KNOWN_AS) {
    authorizationServerMetadata(req, res);
    return;
  }
  if (path === WELL_KNOWN_PR_PREFIX || path.startsWith(`${WELL_KNOWN_PR_PREFIX}/`)) {
    protectedResourceMetadata(req, res);
    return;
  }

  // OAuth 2.1 authorization server (phases 1c–1d, 1h).
  if (path === '/revoke') {
    await oauthHandlers().revoke(req, res);
    return;
  }
  if (path === '/register') {
    await oauthHandlers().register(req, res);
    return;
  }
  if (path === '/authorize') {
    await oauthHandlers().authorize(req, res);
    return;
  }
  if (path === '/token') {
    await oauthHandlers().token(req, res);
    return;
  }

  // Per-app MCP resource servers (phase 1e): audience-bound token, hasApp gate,
  // authenticated ctx. See app-server.js.
  const appMatch = APP_RESOURCE_PATH.exec(path);
  if (appMatch) {
    const { store, audit, rateLimiter } = services();
    await handleAppRequest(req, res, {
      registry,
      appId: appMatch[1],
      getGrant: (grantId) => store.getGrant(grantId),
      audit,
      rateLimiter,
    });
    return;
  }

  // Host diagnostic endpoint (1a spike): dev-shim auth, emulator only. '/'
  // covers hitting the function directly on the emulator (no Hosting rewrite in
  // front).
  if (path === HOST_RESOURCE_PATH || path === '/' || path === '') {
    if (!checkDevAuth(req, res)) return;
    await handleMcpRequest(req, res, buildHostServer);
    return;
  }

  res.status(404).json({ error: 'not_found', message: 'No MCP resource at this path.' });
}

const mcpServer = onRequest(
  { region: 'us-central1', cors: false, secrets: [MCP_JWT_SECRET] },
  async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      console.error('mcpServer error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'internal', message: 'MCP server error.' });
      }
    }
  }
);

module.exports = { mcpServer, route, services };
