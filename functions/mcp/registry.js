'use strict';

// The tool registry (design §8, phase 1e): the reusable seam every Olympus app
// plugs into. An app contributes tools and resources under its appId; the host
// mounts it at /mcp/<appId>, publishes its discovery doc, validates the
// audience-bound token, gates on hasApp(appId), and hands every handler an
// authenticated ctx. Apps never touch OAuth or transport.
//
//   registerApp('scriptorium', {
//     tools: [
//       {
//         name: 'list_notes',
//         description: 'List your notes.',
//         inputSchema: { limit: z.number().int().max(50).optional() }, // zod raw shape
//         annotations: { readOnlyHint: true },
//         handler: async (ctx, args) => ({ notes: [] }), // ctx.uid, ctx.appId, ctx.claims
//       },
//     ],
//     resources: [
//       { name: 'about', uri: 'scriptorium://about', mimeType: 'text/plain', read: async (ctx) => '…' },
//     ],
//   });
//
// The design sketch also passed a `resource` URL. It is derived instead
// (`<canonical origin>/mcp/<appId>`) so an app cannot declare an audience that
// disagrees with where it is mounted or with the tokens the AS issues for it.

const APP_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Throw from a handler to return `message` to the MCP client as a tool error.
// Any other thrown error is logged server-side and reported to the client only
// as a generic "Internal error." so internals never leak into a conversation.
class ToolError extends Error {}

function assert(condition, message) {
  if (!condition) throw new Error(`registerApp: ${message}`);
}

function validateTools(appId, tools) {
  assert(Array.isArray(tools), `${appId}: tools must be an array`);
  const seen = new Set();
  for (const tool of tools) {
    assert(tool && typeof tool === 'object', `${appId}: each tool must be an object`);
    assert(TOOL_NAME_PATTERN.test(tool.name || ''), `${appId}: invalid tool name "${tool.name}"`);
    assert(!seen.has(tool.name), `${appId}: duplicate tool "${tool.name}"`);
    seen.add(tool.name);
    assert(
      typeof tool.description === 'string' && tool.description.trim() !== '',
      `${appId}.${tool.name}: description is required`
    );
    assert(typeof tool.handler === 'function', `${appId}.${tool.name}: handler must be a function`);
    assert(
      tool.inputSchema === undefined ||
        (tool.inputSchema !== null && typeof tool.inputSchema === 'object'),
      `${appId}.${tool.name}: inputSchema must be a zod raw shape`
    );
  }
}

function validateResources(appId, resources) {
  assert(Array.isArray(resources), `${appId}: resources must be an array`);
  const seen = new Set();
  for (const resource of resources) {
    assert(resource && typeof resource === 'object', `${appId}: each resource must be an object`);
    assert(
      typeof resource.name === 'string' && resource.name !== '',
      `${appId}: resource name is required`
    );
    assert(
      typeof resource.uri === 'string' && resource.uri !== '',
      `${appId}.${resource.name}: uri is required`
    );
    assert(!seen.has(resource.uri), `${appId}: duplicate resource uri "${resource.uri}"`);
    seen.add(resource.uri);
    assert(
      typeof resource.read === 'function',
      `${appId}.${resource.name}: read must be a function`
    );
  }
}

function createRegistry() {
  const apps = new Map();

  function registerApp(appId, { tools = [], resources = [] } = {}) {
    assert(APP_ID_PATTERN.test(appId || ''), `invalid appId "${appId}"`);
    assert(!apps.has(appId), `app "${appId}" is already registered`);
    validateTools(appId, tools);
    validateResources(appId, resources);
    apps.set(appId, Object.freeze({ appId, tools: [...tools], resources: [...resources] }));
  }

  return {
    registerApp,
    getApp: (appId) => apps.get(appId) || null,
    has: (appId) => apps.has(appId),
    appIds: () => [...apps.keys()],
  };
}

// The process-wide registry used by the deployed mcpServer. App modules
// register into it from functions/mcp/apps/index.js.
const registry = createRegistry();

module.exports = { createRegistry, registry, ToolError, APP_ID_PATTERN };
