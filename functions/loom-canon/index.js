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
 * Firestore-backed worlds (the Cartographer; C-4 / #371, design
 * planning/the-cartographer-design.md §3.3, §4.2). loadWorld(worldId, { db })
 * returns a static world from WORLDS, or assembles one from `loom_worlds/
 * {worldId}` and its entity subcollections — the same CanonWorld shape,
 * extended with optional `geo` / `politics` / `regions` / `map` and the world's
 * `status` and `canonVersion`. Only `published` worlds are playable.
 *
 * Canon can be edited while a world is being played (the Cartographer's MCP
 * tools), so each call re-reads the world document — one read — and reuses a
 * per-instance cache only while `canonVersion` is unchanged. An edit therefore
 * reaches every game on its next turn.
 *
 * Retired entities (soft-removed from a published world) stay in the world so
 * a save that references one still resolves, but they are dropped from every
 * location's connections and default cast: nobody can travel to a retired
 * place or meet a retired character.
 *
 * The turn pipeline loads a world once per turn and then works on the object;
 * the object-based helpers (findEntity, entitySnippet) serve both kinds of
 * world. getWorld / getEntity / getEntitySnippet remain for static worlds.
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
 * Resolves an entity id of unknown kind against a world object's locations,
 * factions, and characters (checked in that order). Returns { type, entity }
 * or null. Works for static and Firestore-backed worlds alike.
 */
function findEntity(world, entityId) {
  if (!world) return null;
  if (world.locations[entityId]) return { type: 'location', entity: world.locations[entityId] };
  if (world.factions[entityId]) return { type: 'faction', entity: world.factions[entityId] };
  if (world.characters[entityId]) {
    return { type: 'character', entity: world.characters[entityId] };
  }
  return null;
}

/** findEntity for a static world, by id. */
function getEntity(worldId, entityId) {
  return findEntity(getWorld(worldId), entityId);
}

/**
 * Builds a denormalized text snippet for an entity — its own description plus
 * any lore entries that reference it — for the NARRATE stage (L-113 / #300)
 * and entity-keyed retrieval (L-117 / #304) to drop into prompt context.
 * Returns null if the entity does not exist in the world.
 */
function entitySnippet(world, entityId) {
  const resolved = findEntity(world, entityId);
  if (!resolved) return null;

  const lines = [resolved.entity.name + ' — ' + resolved.entity.description];

  Object.values(world.lore).forEach(function (loreEntry) {
    if (!loreEntry.retired && (loreEntry.entityRefs || []).indexOf(entityId) !== -1) {
      lines.push(loreEntry.title + ': ' + loreEntry.text);
    }
  });

  return lines.join('\n\n');
}

/** entitySnippet for a static world, by id. */
function getEntitySnippet(worldId, entityId) {
  return entitySnippet(getWorld(worldId), entityId);
}

// ── Firestore-backed worlds ──────────────────────────────────────────────

const WORLDS_COLLECTION = 'loom_worlds';
const ENTITY_COLLECTIONS = ['locations', 'factions', 'regions', 'characters', 'lore'];
const LOADABLE_STATUSES = ['draft', 'published'];

// worldId → { canonVersion, world }, per Cloud Functions instance.
const worldCache = new Map();

// Drops retired entities from every reference a player could follow, while
// keeping the entities themselves resolvable.
function toPlayView(world) {
  const live = function (collection) {
    return function (id) {
      return Boolean(collection[id]) && !collection[id].retired;
    };
  };
  const isLiveLocation = live(world.locations);
  const isLiveFaction = live(world.factions);
  const isLiveCharacter = live(world.characters);
  Object.values(world.locations).forEach(function (location) {
    location.connections = (location.connections || []).filter(isLiveLocation);
    location.factionIds = (location.factionIds || []).filter(isLiveFaction);
    location.npcIds = (location.npcIds || []).filter(isLiveCharacter);
  });
  return world;
}

async function readFirestoreWorld(db, worldId, meta) {
  const worldRef = db.collection(WORLDS_COLLECTION).doc(worldId);
  const snaps = await Promise.all(
    ENTITY_COLLECTIONS.map(function (name) {
      return worldRef.collection(name).get();
    })
  );
  const world = {
    id: worldId,
    name: meta.name,
    tagline: meta.tagline || '',
    openingHook: meta.openingHook || '',
    status: meta.status,
    canonVersion: meta.canonVersion,
    map: meta.map || null,
    rules: meta.rules || {},
  };
  ENTITY_COLLECTIONS.forEach(function (name, i) {
    world[name] = {};
    snaps[i].docs.forEach(function (doc) {
      world[name][doc.id] = doc.data();
    });
  });
  return deepFreeze(toPlayView(world));
}

/**
 * Loads a world for play — or, with playableOnly: false, for authoring tools.
 * Static worlds come from WORLDS; anything else from Firestore via `db`.
 * Returns the frozen CanonWorld, or null if it doesn't exist, isn't fully
 * loaded, or (when playableOnly) isn't published yet.
 */
async function loadWorld(worldId, { db, playableOnly = true } = {}) {
  const staticWorld = getWorld(worldId);
  if (staticWorld) return staticWorld;
  if (!db || typeof worldId !== 'string' || !worldId) return null;

  const snap = await db.collection(WORLDS_COLLECTION).doc(worldId).get();
  if (!snap.exists) return null;
  const meta = snap.data();
  if (LOADABLE_STATUSES.indexOf(meta.status) === -1) return null;
  if (playableOnly && meta.status !== 'published') return null;

  const cached = worldCache.get(worldId);
  if (cached && cached.canonVersion === meta.canonVersion && cached.world.status === meta.status) {
    return cached.world;
  }

  const world = await readFirestoreWorld(db, worldId, meta);
  worldCache.set(worldId, { canonVersion: meta.canonVersion, world: world });
  return world;
}

/** Test hook: forget every cached Firestore world. */
function clearWorldCache() {
  worldCache.clear();
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
  findEntity,
  entitySnippet,
  loadWorld,
  clearWorldCache,
  WORLDS_COLLECTION,
  ENTITY_COLLECTIONS,
};
