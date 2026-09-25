'use strict';

// App modules register their MCP tools and resources here, through the §8
// registry seam. Each one is mounted at /mcp/<appId> with its own discovery doc
// and audience. Scriptorium, the proof-of-concept app, lands in phase 1f
// (#353):
//
//   require('./scriptorium')(registry);

// eslint-disable-next-line no-unused-vars
module.exports = function registerApps(registry) {};
