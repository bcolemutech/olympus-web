'use strict';

// The one-time backfill that gives every character made before positions
// were required a position (planning/the-loom-movement-and-vision.md §6a;
// L-683 / #515), planned over a loaded world and written with
// applyBackfill (./backfill.js) by scripts/backfill-character-positions.js.
//
// Each live character without a valid position is given the default where
// they are found (loom-canon/positions.js defaultPosition): at a place or
// point of interest with a map, the free square nearest its entry; in a
// settlement, their place's door, else a way in, else the middle of the
// town; at a point of interest without a map, none (its own position
// counts). The other position fields are set to null, which counts as none.
// Characters are placed one after another, so two never share a square.
// Those already placed are left alone, so it is safe to run twice; those it
// can't place (the wilderness has no default; a map with no free square) are
// reported for Claude to place over MCP.

const positions = require('../loom-canon/positions');

const { FIELDS } = positions;

/**
 * plan  { writes: [{ collection, id, fields }], placed: [{ id, name, fields, was }],
 *         unplaceable: [{ id, name, problem }], alreadyPlaced: number }
 * `was` is the problem the character had: none, or an invalid position.
 */
function planPositionBackfill(world) {
  const working = { ...world, characters: { ...(world.characters || {}) } };
  const plan = { writes: [], placed: [], unplaceable: [], alreadyPlaced: 0 };
  const live = Object.values(world.characters || {})
    .filter((character) => !character.retired)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const character of live) {
    const problem = positions.positionOf(working, character).problem;
    if (!problem) {
      plan.alreadyPlaced += 1;
      continue;
    }
    const bare = { ...character };
    for (const field of FIELDS) delete bare[field];
    const fallback = positions.defaultPosition(working, bare);
    if (!fallback) {
      plan.unplaceable.push({ id: character.id, name: character.name, problem });
      continue;
    }
    const fields = {};
    for (const field of FIELDS) {
      if (fallback[field]) fields[field] = fallback[field];
      else if (character[field] != null) fields[field] = null;
    }
    working.characters[character.id] = { ...bare, ...fallback };
    plan.placed.push({ id: character.id, name: character.name, fields, was: problem });
    if (Object.keys(fields).length)
      plan.writes.push({ collection: 'characters', id: character.id, fields });
  }
  return plan;
}

module.exports = { planPositionBackfill };
