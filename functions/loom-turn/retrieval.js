'use strict';

/**
 * Entity-keyed retrieval from the event log (design doc §4, §8; L-117 / #304).
 *
 * The differentiator vs. keyword Story Cards: because turns store structured
 * `entityRefs[]`, retrieval is keyed on the actual entities in play. When an
 * NPC re-enters a scene, their full history and disposition is pulled
 * deterministically via a Firestore `array-contains` query — not hoped for
 * via keyword matching.
 *
 * Feeds NARRATE's context assembly (L-113 / #300): given the entities
 * relevant to the current proposed action/scene, returns each entity's
 * recent turn history plus its current disposition from Character state.
 * Bounded per entity (default 5 most-recent turns) so context stays small.
 *
 * Requires the composite index on `loom_turns` (entityRefs array-contains +
 * index desc) declared in firestore.indexes.json (coordinated with L-101 /
 * #294).
 */

const DEFAULT_LIMIT_PER_ENTITY = 5;

/**
 * Fetches the most recent turns referencing a given entity, oldest first.
 *
 * @param {{ saveRef: FirebaseFirestore.DocumentReference, entityId: string, limit?: number }} params
 * @returns {Promise<object[]>}
 */
async function getEntityHistory(params) {
  const { saveRef, entityId, limit = DEFAULT_LIMIT_PER_ENTITY } = params;

  const snap = await saveRef
    .collection('loom_turns')
    .where('entityRefs', 'array-contains', entityId)
    .orderBy('index', 'desc')
    .limit(limit)
    .get();

  return snap.docs.map((doc) => doc.data()).reverse();
}

/** Reads an entity's current disposition from Character state (§8 loom_saves.relationships), or null. */
function getEntityDisposition(save, entityId) {
  return (save && save.relationships && save.relationships[entityId]) || null;
}

/**
 * Retrieves history + disposition for a single entity.
 *
 * @param {{
 *   saveRef: FirebaseFirestore.DocumentReference,
 *   save: object,
 *   entityId: string,
 *   limit?: number,
 * }} params
 * @returns {Promise<{ entityId: string, turns: object[], disposition: string|null }>}
 */
async function retrieveEntityContext(params) {
  const { saveRef, save, entityId, limit } = params;
  const turns = await getEntityHistory({ saveRef, entityId, limit });
  return { entityId, turns, disposition: getEntityDisposition(save, entityId) };
}

/**
 * Retrieves history + disposition for a set of entities (e.g. the current
 * proposed action's targets and/or the current location's presentEntities).
 * Deduplicates ids and skips falsy entries so callers can pass raw lists
 * without pre-filtering.
 *
 * @param {{
 *   saveRef: FirebaseFirestore.DocumentReference,
 *   save: object,
 *   entityIds: string[],
 *   limit?: number,
 * }} params
 * @returns {Promise<{ entityId: string, turns: object[], disposition: string|null }[]>}
 */
async function retrieveContextForEntities(params) {
  const { saveRef, save, entityIds, limit } = params;
  const uniqueIds = Array.from(new Set((entityIds || []).filter(Boolean)));

  return Promise.all(
    uniqueIds.map((entityId) => retrieveEntityContext({ saveRef, save, entityId, limit }))
  );
}

module.exports = {
  DEFAULT_LIMIT_PER_ENTITY,
  getEntityHistory,
  getEntityDisposition,
  retrieveEntityContext,
  retrieveContextForEntities,
};
