'use strict';

const logger = require('firebase-functions/logger');
const { loadSdk } = require('./sdk');

// Only well-formed identifiers are logged; anything else is replaced, so a
// diagnostic line can never carry request content.
const SAFE_METHOD = /^[A-Za-z0-9_/.-]{1,64}$/;
const SAFE_VERSION = /^[A-Za-z0-9.-]{1,32}$/;
const safe = (value, pattern) =>
  typeof value === 'string' && pattern.test(value) ? value : value == null ? null : '<invalid>';

// JSON-RPC method names in the request body (a message or a batch), sanitized.
function rpcMethods(body) {
  const messages = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : [];
  return messages
    .slice(0, 10)
    .map((m) => (m && typeof m.method === 'string' ? safe(m.method, SAFE_METHOD) : '<response>'));
}

// Logs one structured warning when the MCP transport itself rejects a request
// (unsupported protocol version, malformed JSON-RPC, …). Auth failures never
// reach the transport, so this fires only for protocol-level problems. It
// records what identifies the cause — never tokens, headers other than the
// protocol version, or message contents.
function logRejection(req, res) {
  const contentType = req.headers['content-type'];
  logger.warn('MCP transport rejected a request', {
    status: res.statusCode,
    path: req.path,
    httpMethod: req.method,
    rpcMethods: rpcMethods(req.body),
    protocolVersion: safe(req.headers['mcp-protocol-version'], SAFE_VERSION),
    bodyPresent: req.body !== undefined && req.body !== null && req.body !== '',
    contentType: contentType
      ? safe(contentType.split(';')[0].trim().toLowerCase(), /^[a-z0-9/.+-]{1,64}$/)
      : null,
  });
}

// Runs one MCP request in stateless Streamable HTTP mode: a fresh server +
// transport per request, no session state retained between requests. This is
// the correct pattern on serverless — Cloud Functions instances are ephemeral
// and fan out horizontally, so in-memory session continuity cannot be relied
// on (design §4, §7). `enableJsonResponse` returns a single JSON body instead
// of holding open an SSE stream, which suits short request/response tool calls.
async function handleMcpRequest(req, res, buildServer) {
  const { StreamableHTTPServerTransport } = await loadSdk('server/streamableHttp.js');

  const server = await buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: no session tracking
    enableJsonResponse: true,
  });

  res.on('finish', () => {
    if (res.statusCode >= 400 && res.statusCode < 500) logRejection(req, res);
  });

  // Ensure per-request resources are released once the response is done.
  res.on('close', () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

module.exports = { handleMcpRequest };
