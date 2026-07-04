'use strict';

const { loadSdk } = require('./sdk');

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

  // Ensure per-request resources are released once the response is done.
  res.on('close', () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

module.exports = { handleMcpRequest };
