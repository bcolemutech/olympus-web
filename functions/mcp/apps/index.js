'use strict';

// App modules register their MCP tools and resources here, through the §8
// registry seam. Each one is mounted at /mcp/<appId> with its own discovery doc
// and audience, and must also be listed in public/apps.yaml so its claim is
// grantable in The Pantheon.
module.exports = function registerApps(registry) {
  require('./scriptorium').register(registry);
};
