'use strict';

const { loadSdk } = require('./sdk');
const { handleMcpRequest } = require('./transport');
const { resolveOrigin } = require('./config');
const { verifyAccessToken } = require('./oauth/tokens');
const { scopeForAppId } = require('./oauth/config');
const { ToolError } = require('./registry');

// Per-app MCP resource servers mounted at /mcp/<appId> (design §5.3, §8,
// phase 1e). Every request is authenticated before any app code runs:
//
//   1. Bearer token required (RFC 6750).
//   2. Signature, issuer, expiry, and audience are verified locally — no
//      datastore read. The audience must be exactly this app's resource
//      (RFC 8707), so a token minted for app A is rejected at app B.
//   3. hasApp(appId) gate: the token must carry the mcp:<appId> scope. The AS
//      only issues that scope after checking hasApp(appId) against the user's
//      live claims — at consent and again on every refresh — so a revoked app
//      claim stops working within the access-token TTL without a per-request
//      Auth lookup (design §6: self-validating tokens on the hot path).
//
// Handlers then receive ctx = { uid, appId, claims } where claims is the
// verified token payload.

const SERVER_VERSION = '0.1.0';

function appResource(origin, appId) {
  return `${origin}/mcp/${appId}`;
}

function bearerFrom(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return match ? match[1].trim() : null;
}

// RFC 6750 §3 / RFC 9728 §5.1 challenge. With no token at all the challenge
// carries no error code, just where to discover the authorization server.
function challenge(res, { origin, appId, status, error, description, scope }) {
  const parts = [`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp/${appId}"`];
  if (error) parts.push(`error="${error}"`);
  if (error && description) parts.push(`error_description="${description}"`);
  if (scope) parts.push(`scope="${scope}"`);
  res.set('WWW-Authenticate', `Bearer ${parts.join(', ')}`);
  res
    .status(status)
    .json({ error: error || 'unauthorized', message: description || 'Sign-in required.' });
}

// Returns the authenticated ctx, or null after writing a 401/403 challenge.
function authenticate(req, res, appId) {
  const origin = resolveOrigin(req);
  const token = bearerFrom(req);
  if (!token) {
    challenge(res, { origin, appId, status: 401, description: 'Missing bearer token.' });
    return null;
  }

  let claims;
  try {
    claims = verifyAccessToken(token, {
      audience: appResource(origin, appId),
      issuer: origin,
    });
  } catch {
    // One message for bad signature, wrong issuer, expiry, and wrong audience:
    // the client's remedy is the same (re-authorize) and detail aids no one.
    challenge(res, {
      origin,
      appId,
      status: 401,
      error: 'invalid_token',
      description: 'The access token is invalid, expired, or not for this connector.',
    });
    return null;
  }

  const requiredScope = scopeForAppId(appId);
  const scopes = typeof claims.scope === 'string' ? claims.scope.split(/\s+/) : [];
  if (!scopes.includes(requiredScope)) {
    challenge(res, {
      origin,
      appId,
      status: 403,
      error: 'insufficient_scope',
      description: `This connector requires the ${requiredScope} scope.`,
      scope: requiredScope,
    });
    return null;
  }

  return Object.freeze({ uid: claims.sub, appId, claims: Object.freeze({ ...claims }) });
}

// Handlers may return a full CallToolResult ({ content: [...] }), a string, or
// any JSON-serializable value (sent as text plus structuredContent for objects).
function toToolResult(value) {
  if (value && typeof value === 'object' && Array.isArray(value.content)) return value;
  if (typeof value === 'string') return { content: [{ type: 'text', text: value }] };
  const text = JSON.stringify(value === undefined ? null : value, null, 2);
  const result = { content: [{ type: 'text', text }] };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    result.structuredContent = value;
  }
  return result;
}

function wrapToolHandler(app, tool, ctx) {
  const run = async (args, extra) => {
    try {
      return toToolResult(await tool.handler(ctx, args || {}, extra));
    } catch (err) {
      if (err instanceof ToolError) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
      console.error(`mcp ${app.appId}.${tool.name} failed for uid ${ctx.uid}:`, err);
      return { isError: true, content: [{ type: 'text', text: 'Internal error.' }] };
    }
  };
  // The SDK calls (args, extra) when a tool has an input schema, (extra) otherwise.
  return tool.inputSchema ? run : (extra) => run({}, extra);
}

function toResourceContents(uri, resource, value) {
  if (value && typeof value === 'object' && Array.isArray(value.contents)) return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const mimeType =
    resource.mimeType || (typeof value === 'string' ? 'text/plain' : 'application/json');
  return { contents: [{ uri: uri.href, mimeType, text }] };
}

// Builds a fresh McpServer exposing exactly one app's tools and resources, each
// bound to the authenticated ctx. Built per request (stateless transport).
async function buildAppServer(app, ctx) {
  const { McpServer } = await loadSdk('server/mcp.js');
  const server = new McpServer({ name: `olympus-${app.appId}`, version: SERVER_VERSION });

  for (const tool of app.tools) {
    const config = { description: tool.description };
    if (tool.title) config.title = tool.title;
    if (tool.inputSchema) config.inputSchema = tool.inputSchema;
    if (tool.annotations) config.annotations = tool.annotations;
    server.registerTool(tool.name, config, wrapToolHandler(app, tool, ctx));
  }

  for (const resource of app.resources) {
    const metadata = {};
    if (resource.title) metadata.title = resource.title;
    if (resource.description) metadata.description = resource.description;
    if (resource.mimeType) metadata.mimeType = resource.mimeType;
    server.registerResource(resource.name, resource.uri, metadata, async (uri) =>
      toResourceContents(uri, resource, await resource.read(ctx, uri))
    );
  }

  return server;
}

// Handles a request routed to /mcp/<appId>. Unknown apps 404 without any auth
// work (discovery already publishes which apps exist).
async function handleAppRequest(req, res, { registry, appId }) {
  const app = registry.getApp(appId);
  if (!app) {
    res.status(404).json({ error: 'not_found', message: 'No MCP resource at this path.' });
    return;
  }
  const ctx = authenticate(req, res, appId);
  if (!ctx) return;
  await handleMcpRequest(req, res, () => buildAppServer(app, ctx));
}

module.exports = { handleAppRequest, authenticate, buildAppServer, appResource };
