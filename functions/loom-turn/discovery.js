'use strict';

/**
 * Discovery (planning/the-loom-layered-worlds.md §7; L-331 / #393).
 *
 * A save discovers the places it visits and their neighbours, and only those
 * appear on its world map (loomGetMap). The rules engine decides whether a
 * move happens; this works out what the player newly sees because of it, and
 * COMMIT records it as `add` deltas on `save.discovered`, like other save
 * state.
 *
 * Saves from before discovery have no `discovered`; they are treated as having
 * discovered where they stand and its neighbours, and the next turn records
 * that.
 */

/** A place and the places it connects to (retired links are already gone). */
function withNeighbours(canonWorld, locationId) {
  const place = locationId && canonWorld.locations[locationId];
  if (!place) return [];
  return [place.id].concat((place.connections || []).filter((id) => canonWorld.locations[id]));
}

/** What a save has discovered: recorded, or (older saves) where it stands and around. */
function discoveredBy(canonWorld, save) {
  return Array.isArray(save.discovered)
    ? save.discovered
    : withNeighbours(canonWorld, save.location);
}

/**
 * The places this turn newly reveals: the destination of a successful move
 * and its neighbours, plus, for an older save, what it had already seen.
 * @returns {string[]} location ids not yet in save.discovered
 */
function newlyDiscovered(canonWorld, save, resolution) {
  const move = (resolution.mutations || []).find(
    (m) => m.target === 'save' && m.path === 'location'
  );
  const seen = new Set(Array.isArray(save.discovered) ? save.discovered : []);
  const found = [];
  const reveal = (ids) => {
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        found.push(id);
      }
    }
  };
  if (!Array.isArray(save.discovered)) reveal(withNeighbours(canonWorld, save.location));
  if (move) reveal(withNeighbours(canonWorld, move.value));
  return found;
}

module.exports = { withNeighbours, discoveredBy, newlyDiscovered };
