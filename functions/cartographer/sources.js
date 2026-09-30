'use strict';

// Where descriptions came from (planning/the-loom-layered-worlds.md §4.3;
// L-321 / #390). Grading (functions/loom-canon/grading.js) counts a place as
// written up only when its `sources.description` isn't 'import'.
//
//   import   written by the Cartographer loader (functions/cartographer/load.js)
//   mcp      written through the Cartographer's MCP write tools
//   gemini   written by a Gemini building tool
//
// Worlds imported before sources existed are backfilled by
// scripts/backfill-description-sources.js, which uses the helpers below. It
// re-runs the parser and mapper on the world's original Azgaar export: a
// description that still matches the mapper's output word for word was never
// edited, so it is 'import', and anything else was written over MCP. Without
// the export, every place and realm is marked 'import'. Characters only ever
// come from MCP. Stamps already present are left alone, so the backfill is
// safe to run twice.
//
// No outside dependencies: the script (ES modules, under scripts/) and the
// tests both load this file.

const { applyBackfill } = require('./backfill');

const SOURCES = Object.freeze({ IMPORT: 'import', MCP: 'mcp', GEMINI: 'gemini' });
const BACKFILLED = ['locations', 'factions', 'characters'];

// The stamp the loader gives an imported entity that has a description.
function importStamp(entity) {
  return typeof entity.description === 'string' ? { description: SOURCES.IMPORT } : null;
}

// Refuses an export that isn't the one the world was imported from.
function checkExportMatchesWorld(meta, parsed) {
  const was = meta.source || {};
  const is = parsed.source || {};
  if (was.seed !== is.seed || was.mapName !== is.mapName) {
    throw new Error(
      `This export (${is.mapName}, seed ${is.seed}) is not the map this world was imported ` +
        `from (${was.mapName}, seed ${was.seed}).`
    );
  }
}

/**
 * Works out the stamps to add.
 * @param {{ entities: { locations, factions, characters }, mapped: object|null }} input
 *   entities: raw entity documents by collection and id; mapped: mapToCanon()
 *   output for the world's original export, or null without one.
 * @returns {{ updates: { collection, id, name, source }[], summary: object }}
 */
function planSourceBackfill({ entities, mapped }) {
  const updates = [];
  const summary = {};
  for (const collection of BACKFILLED) {
    const counts = { total: 0, import: 0, mcp: 0, alreadyStamped: 0, noDescription: 0 };
    for (const entity of Object.values(entities[collection] || {})) {
      counts.total += 1;
      if (typeof entity.description !== 'string') {
        counts.noDescription += 1;
        continue;
      }
      if ((entity.sources || {}).description) {
        counts.alreadyStamped += 1;
        continue;
      }
      let source;
      if (collection === 'characters') {
        source = SOURCES.MCP;
      } else if (!mapped || entity.description.trim() === '') {
        source = SOURCES.IMPORT;
      } else {
        // A place or realm the mapper doesn't know stays closed: 'import'.
        const original = ((mapped.canon || {})[collection] || {})[entity.id];
        source =
          original && original.description !== entity.description ? SOURCES.MCP : SOURCES.IMPORT;
      }
      counts[source] += 1;
      updates.push({ collection, id: entity.id, name: entity.name, source });
    }
    summary[collection] = counts;
  }
  return { updates, summary };
}

/**
 * Writes the planned stamps, then bumps the world's canonVersion so every
 * cached copy of it reloads (functions/cartographer/backfill.js).
 * @returns {Promise<{ written: number, canonVersion: number|null }>}
 */
function applySourceBackfill(db, worldId, plan, options) {
  return applyBackfill(db, worldId, { writes: sourceWrites(plan) }, options);
}

// The plan's stamps as backfill writes.
function sourceWrites(plan) {
  return plan.updates.map(({ collection, id, source }) => ({
    collection,
    id,
    fields: { 'sources.description': source },
  }));
}

module.exports = {
  SOURCES,
  importStamp,
  checkExportMatchesWorld,
  planSourceBackfill,
  applySourceBackfill,
  sourceWrites,
};
