'use strict';

// Where descriptions came from (planning/the-loom-layered-worlds.md §4.3;
// L-321 / #390). Grading (functions/loom-canon/grading.js) counts a place as
// written up only when its `sources.description` isn't 'import'.
//
//   import   written by the Cartographer loader (functions/cartographer/load.js)
//   mcp      written through the Cartographer's MCP write tools
//   gemini   reserved; nothing writes it (Gemini doesn't generate world
//            content: planning/the-loom-layered-worlds.md §2)

const SOURCES = Object.freeze({ IMPORT: 'import', MCP: 'mcp', GEMINI: 'gemini' });

// The stamp the loader gives an imported entity that has a description.
function importStamp(entity) {
  return typeof entity.description === 'string' ? { description: SOURCES.IMPORT } : null;
}

module.exports = { SOURCES, importStamp };
