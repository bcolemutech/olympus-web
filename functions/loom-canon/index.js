'use strict';

/**
 * The Loom — Canon layer (design doc §4, §7, §8; L-103 / #296).
 *
 * Canon is read-only at play time: places, factions, characters, and lore for
 * a hand-authored world, expressed as static JS config. There is no runtime
 * write path into canon, client or server (L-141 / #310) — world content
 * changes only through an authoring commit.
 *
 * Schema (one entry per world, keyed by world id):
 *
 *   CanonWorld
 *     id, name, tagline, openingHook
 *     locations:  { [locationId]:  CanonLocation  }
 *     factions:   { [factionId]:   CanonFaction   }
 *     characters: { [characterId]: CanonCharacter }
 *     lore:       { [loreId]:      CanonLoreEntry }
 *     rules:      { ...small world-level rule-set hooks, data only }
 *
 *   CanonLocation
 *     id, name, description
 *     connections: string[]   — ids of directly reachable locations
 *     factionIds:  string[]   — factions with a default presence here
 *     npcIds:      string[]   — characters found here by default
 *     rules:       object     — rule-set hooks (e.g. { requiresAbility, hostileToFactionId })
 *
 *   CanonFaction
 *     id, name, description
 *     disposition: 'friendly' | 'neutral' | 'hostile'  — default stance toward the player
 *
 *   CanonCharacter
 *     id, name, description
 *     factionId:  string | undefined  — faction this character belongs to
 *     locationId: string              — default/home location
 *
 *   CanonLoreEntry
 *     id, title, text
 *     entityRefs: string[]  — location/faction/character ids this lore concerns
 *
 * Rule-set hooks are plain data consumed by the deterministic rules engine
 * (§5 ADJUDICATE, L-112 / #299) once it exists — this module does not
 * interpret them.
 *
 * Firestore-backed canon seam (Phase 3, L-300 / #314): a future
 * getWorld(worldId) can check a `loom_worlds` Firestore doc first and fall
 * back to WORLDS below, as long as it returns the same CanonWorld shape.
 * Nothing here forecloses that — callers only depend on getWorld/getEntity/
 * getEntitySnippet, not on the static-config storage detail.
 */

const WORLDS = {
  'shattered-coast': require('./worlds/shattered-coast'),
};

/** Recursively freezes an object graph so canon can never be mutated at play time. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

Object.keys(WORLDS).forEach(function (worldId) {
  deepFreeze(WORLDS[worldId]);
});

/** Returns the ids of all statically-defined worlds. */
function listWorldIds() {
  return Object.keys(WORLDS);
}

/** Returns the full CanonWorld for worldId, or null if unknown. Read-only (frozen). */
function getWorld(worldId) {
  return WORLDS[worldId] || null;
}

function getLocation(worldId, locationId) {
  const world = getWorld(worldId);
  if (!world) return null;
  return world.locations[locationId] || null;
}

function getFaction(worldId, factionId) {
  const world = getWorld(worldId);
  if (!world) return null;
  return world.factions[factionId] || null;
}

function getCharacter(worldId, characterId) {
  const world = getWorld(worldId);
  if (!world) return null;
  return world.characters[characterId] || null;
}

function getLoreEntry(worldId, loreId) {
  const world = getWorld(worldId);
  if (!world) return null;
  return world.lore[loreId] || null;
}

/**
 * Resolves an entity id of unknown kind against a world's locations, factions,
 * and characters (checked in that order). Returns { type, entity } or null.
 */
function getEntity(worldId, entityId) {
  const world = getWorld(worldId);
  if (!world) return null;

  if (world.locations[entityId]) return { type: 'location', entity: world.locations[entityId] };
  if (world.factions[entityId]) return { type: 'faction', entity: world.factions[entityId] };
  if (world.characters[entityId]) {
    return { type: 'character', entity: world.characters[entityId] };
  }
  return null;
}

/**
 * Builds a denormalized text snippet for an entity — its own description plus
 * any lore entries that reference it — for the NARRATE stage (L-113 / #300)
 * and entity-keyed retrieval (L-117 / #304) to drop into prompt context.
 * Returns null if the entity does not exist in the world.
 */
function getEntitySnippet(worldId, entityId) {
  const world = getWorld(worldId);
  if (!world) return null;

  const resolved = getEntity(worldId, entityId);
  if (!resolved) return null;

  const lines = [resolved.entity.name + ' — ' + resolved.entity.description];

  Object.values(world.lore).forEach(function (loreEntry) {
    if (loreEntry.entityRefs.indexOf(entityId) !== -1) {
      lines.push(loreEntry.title + ': ' + loreEntry.text);
    }
  });

  return lines.join('\n\n');
}

module.exports = {
  listWorldIds,
  getWorld,
  getLocation,
  getFaction,
  getCharacter,
  getLoreEntry,
  getEntity,
  getEntitySnippet,
};
