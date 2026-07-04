'use strict';

const { loadSdk } = require('./sdk');

const SERVER_INFO = { name: 'olympus-mcp', version: '0.1.0' };

// Builds the host-level diagnostic MCP server for the transport spike (phase
// 1a). It exposes a single hardcoded `ping` tool so MCP Inspector can prove the
// list + call round-trip end to end. Per-app tool modules mount their own
// servers via the registry seam later (phase 1e / design §8); nothing here is
// app-specific.
async function buildHostServer() {
  const { McpServer } = await loadSdk('server/mcp.js');
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description: 'Connectivity health check. Returns "pong" and the current server time.',
    },
    async () => ({
      content: [{ type: 'text', text: `pong @ ${new Date().toISOString()}` }],
    })
  );

  return server;
}

module.exports = { buildHostServer, SERVER_INFO };
