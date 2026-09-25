'use strict';

/**
 * Integration tests for per-app MCP resource servers (phase 1e, #352):
 * the §8 registry seam, /mcp/<appId> mounting, audience-bound token validation
 * (RFC 8707), the hasApp gate, and the authenticated ctx handed to handlers.
 *
 * A real MCP SDK client talks Streamable HTTP to handleAppRequest behind an
 * express server (the same req/res stack Cloud Functions uses). No emulator
 * or Firestore needed.
 *
 * Run: cd tests && npx jest mcp-resource --verbose
 */

// Signing secret must be resolvable before requiring the token modules.
process.env.MCP_JWT_SECRET = 'test-signing-secret-mcp-resource';
// Production "pinned origin" mode: audience/issuer are the canonical origin,
// never the test server's Host header.
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const express = require('express');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createRegistry, ToolError } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { protectedResourceMetadata } = require('../functions/mcp/discovery');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');

const CANONICAL = 'https://bcoletech.com';
const SECRET = process.env.MCP_JWT_SECRET;

const registry = createRegistry();
registry.registerApp('alpha', {
  tools: [
    {
      name: 'whoami',
      description: 'Returns the authenticated caller.',
      handler: async (ctx) => ({ uid: ctx.uid, appId: ctx.appId, scope: ctx.claims.scope }),
    },
    {
      name: 'echo',
      description: 'Echoes short text.',
      inputSchema: { text: z.string().max(10) },
      handler: async (ctx, { text }) => `echo:${text}`,
    },
    {
      name: 'reject',
      description: 'Fails with a user-facing message.',
      handler: async () => {
        throw new ToolError('Note not found.');
      },
    },
    {
      name: 'boom',
      description: 'Fails unexpectedly.',
      handler: async () => {
        throw new Error('firestore: PERMISSION_DENIED on projects/x/secret/path');
      },
    },
  ],
  resources: [
    {
      name: 'status',
      uri: 'alpha://status',
      read: async (ctx) => ({ owner: ctx.uid }),
    },
  ],
});
registry.registerApp('beta', {
  tools: [{ name: 'beta_only', description: 'Only on beta.', handler: async () => 'beta' }],
});

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.all('/mcp/:appId', (req, res) =>
    handleAppRequest(req, res, { registry, appId: req.params.appId })
  );
  app.get('/.well-known/oauth-protected-resource/*', (req, res) =>
    protectedResourceMetadata(req, res, registry)
  );
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

function tokenFor(appId, { uid = 'uid-alice', scope = `mcp:${appId}` } = {}) {
  return signAccessToken({
    uid,
    audience: `${CANONICAL}/mcp/${appId}`,
    scope,
    issuer: CANONICAL,
  });
}

async function connect(appId, token) {
  const client = new Client({ name: 'mcp-resource-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp/${appId}`), {
    requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
  await client.connect(transport);
  return client;
}

// A bare MCP initialize POST, for asserting status codes and challenge headers.
function rawInitialize(appId, token) {
  return fetch(`${base}/mcp/${appId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'raw', version: '0' },
      },
    }),
  });
}

describe('per-app MCP endpoint — authorized access', () => {
  let client;
  beforeAll(async () => {
    client = await connect('alpha', tokenFor('alpha'));
  });
  afterAll(() => client.close());

  test("a valid token connects and lists only that app's tools", async () => {
    expect(client.getServerVersion().name).toBe('olympus-alpha');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['boom', 'echo', 'reject', 'whoami']);
  });

  test('handlers receive the authenticated ctx from the verified token', async () => {
    const result = await client.callTool({ name: 'whoami', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      uid: 'uid-alice',
      appId: 'alpha',
      scope: 'mcp:alpha',
    });
  });

  test('input schemas are enforced before the handler runs', async () => {
    const ok = await client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    expect(ok.content[0].text).toBe('echo:hi');
    const tooLong = await client.callTool({ name: 'echo', arguments: { text: 'x'.repeat(11) } });
    expect(tooLong.isError).toBe(true);
  });

  test('ToolError messages reach the client', async () => {
    const result = await client.callTool({ name: 'reject', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Note not found.');
  });

  test('unexpected errors are logged, not leaked to the client', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await client.callTool({ name: 'boom', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Internal error.');
    expect(JSON.stringify(result)).not.toMatch(/PERMISSION_DENIED|secret/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('resources are listed and read with the authenticated ctx', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(['alpha://status']);
    const read = await client.readResource({ uri: 'alpha://status' });
    expect(JSON.parse(read.contents[0].text)).toEqual({ owner: 'uid-alice' });
  });
});

describe('per-app MCP endpoint — token and access enforcement', () => {
  test('exit criterion: a token minted for app A is rejected by app B', async () => {
    const res = await rawInitialize('beta', tokenFor('alpha'));
    expect(res.status).toBe(401);
    const header = res.headers.get('www-authenticate');
    expect(header).toMatch(/error="invalid_token"/);
    expect(header).toMatch(
      `resource_metadata="${CANONICAL}/.well-known/oauth-protected-resource/mcp/beta"`
    );
    await expect(connect('beta', tokenFor('alpha'))).rejects.toThrow();
  });

  test('the matching token works at app B, and sees only B’s tools', async () => {
    const client = await connect('beta', tokenFor('beta'));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['beta_only']);
    await client.close();
  });

  test('no token → 401 challenge that points at discovery, without an error code', async () => {
    const res = await rawInitialize('alpha');
    expect(res.status).toBe(401);
    const header = res.headers.get('www-authenticate');
    expect(header).toMatch(
      `resource_metadata="${CANONICAL}/.well-known/oauth-protected-resource/mcp/alpha"`
    );
    expect(header).not.toMatch(/error/);
  });

  test.each([
    [
      'expired',
      jwt.sign({ scope: 'mcp:alpha', exp: Math.floor(Date.now() / 1000) - 60 }, SECRET, {
        algorithm: 'HS256',
        issuer: CANONICAL,
        subject: 'uid-alice',
        audience: `${CANONICAL}/mcp/alpha`,
      }),
    ],
    [
      'signed with another key',
      jwt.sign({ scope: 'mcp:alpha' }, 'not-the-secret', {
        algorithm: 'HS256',
        issuer: CANONICAL,
        subject: 'uid-alice',
        audience: `${CANONICAL}/mcp/alpha`,
        expiresIn: 300,
      }),
    ],
    [
      'from another issuer',
      jwt.sign({ scope: 'mcp:alpha' }, SECRET, {
        algorithm: 'HS256',
        issuer: 'https://evil.example',
        subject: 'uid-alice',
        audience: `${CANONICAL}/mcp/alpha`,
        expiresIn: 300,
      }),
    ],
    [
      'bound to a Host-header origin instead of the canonical one',
      signAccessToken({
        uid: 'uid-alice',
        audience: 'https://olympus-dfa00.web.app/mcp/alpha',
        scope: 'mcp:alpha',
        issuer: CANONICAL,
      }),
    ],
    ['not a JWT', 'opaque-garbage-token'],
  ])('a token %s → 401 invalid_token', async (_label, token) => {
    const res = await rawInitialize('alpha', token);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/error="invalid_token"/);
  });

  test('hasApp gate: right audience but no mcp:<appId> scope → 403 insufficient_scope', async () => {
    const res = await rawInitialize('alpha', tokenFor('alpha', { scope: 'mcp:beta' }));
    expect(res.status).toBe(403);
    const header = res.headers.get('www-authenticate');
    expect(header).toMatch(/error="insufficient_scope"/);
    expect(header).toMatch(/scope="mcp:alpha"/);
  });

  test('an app that is not registered → 404', async () => {
    const res = await rawInitialize('gamma', tokenFor('gamma'));
    expect(res.status).toBe(404);
  });
});

describe('per-app discovery (RFC 9728)', () => {
  test('each registered app publishes its own protected-resource metadata', async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp/alpha`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resource: `${CANONICAL}/mcp/alpha`,
      authorization_servers: [CANONICAL],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp:alpha'],
    });
  });

  test('no metadata for an app that is not registered', async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp/gamma`);
    expect(res.status).toBe(404);
  });
});

describe('registry validation', () => {
  const tool = { name: 'ok', description: 'Fine.', handler: async () => 'ok' };

  test.each([
    ['an invalid appId', 'Bad App', {}],
    ['an empty appId', '', {}],
    ['a duplicate tool name', 'app-a', { tools: [tool, tool] }],
    ['a tool without a description', 'app-b', { tools: [{ ...tool, description: '' }] }],
    ['a tool without a handler', 'app-c', { tools: [{ ...tool, handler: undefined }] }],
    ['an invalid tool name', 'app-d', { tools: [{ ...tool, name: 'has space' }] }],
    ['a non-object inputSchema', 'app-e', { tools: [{ ...tool, inputSchema: 'x' }] }],
    ['a resource without read()', 'app-f', { resources: [{ name: 'r', uri: 'x://r' }] }],
  ])('rejects %s', (_label, appId, definition) => {
    expect(() => createRegistry().registerApp(appId, definition)).toThrow(/registerApp/);
  });

  test('rejects registering the same app twice', () => {
    const r = createRegistry();
    r.registerApp('once', { tools: [tool] });
    expect(() => r.registerApp('once', { tools: [tool] })).toThrow(/already registered/);
  });
});
