'use strict';

const { FieldValue } = require('firebase-admin/firestore');

/**
 * Soft-canon quarantine (design doc §5, §11 L-115 / L-141).
 *
 * When NARRATE (L-113 / #300) names an entity absent from canon/state, COMMIT
 * hands it off here to be written to `loom_softcanon` as provisional — never
 * promoted into Canon itself (L-141 / #310, decided). This runs inside the
 * same COMMIT transaction (functions/loom-turn/commit.js), before that
 * transaction's own writes, so a turn either fully commits — state, turn
 * log, and quarantined entities together — or not at all.
 *
 * `loom_softcanon` is scoped to the *world*, not the save (design doc §4:
 * "written to a provisional pool tied to the world"), keyed by a
 * `worldId + normalized name` document id so the same invented name is
 * recognized consistently regardless of which save mentions it.
 *
 * MVP promotion rule (behind this seam for later tuning, per the issue):
 * promote on the second reference. Once promoted, the entity becomes an
 * established fact in World State (`worldState.globalFlags`) — never
 * written into Canon, which has no runtime write path at all.
 */

const PROMOTION_REFERENCE_COUNT = 2;

function normalizeEntityName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function softCanonDocId(worldId, normalizedName) {
  return worldId + '__' + normalizedName;
}

/**
 * Quarantines a batch of invented entity names inside the given transaction.
 * All Firestore reads happen before any writes (Firestore transactions
 * require reads-before-writes), so this is safe to call for any number of
 * entities in one turn.
 *
 * @param {{
 *   transaction: FirebaseFirestore.Transaction,
 *   db: FirebaseFirestore.Firestore,
 *   worldId: string,
 *   inventedEntities: string[],
 *   worldState: object,
 * }} params
 */
async function quarantineEntities(params) {
  const { transaction, db, worldId, inventedEntities, worldState } = params;

  const uniqueNames = Array.from(
    new Set((inventedEntities || []).map((name) => String(name).trim()).filter(Boolean))
  );
  if (uniqueNames.length === 0) {
    return;
  }

  const entries = uniqueNames
    .map((name) => ({ name, normalizedName: normalizeEntityName(name) }))
    .filter((entry) => entry.normalizedName.length > 0)
    .map((entry) =>
      Object.assign(entry, {
        ref: db.collection('loom_softcanon').doc(softCanonDocId(worldId, entry.normalizedName)),
      })
    );
  if (entries.length === 0) {
    return;
  }

  // All reads before any writes, per Firestore transaction rules.
  const snaps = await Promise.all(entries.map((entry) => transaction.get(entry.ref)));
  const now = FieldValue.serverTimestamp();

  entries.forEach((entry, i) => {
    const snap = snaps[i];

    if (!snap.exists) {
      transaction.set(entry.ref, {
        worldId,
        name: entry.name,
        normalizedName: entry.normalizedName,
        referenceCount: 1,
        promoted: false,
        firstMentionedAt: now,
        lastMentionedAt: now,
        promotedAt: null,
      });
      return;
    }

    const existing = snap.data();
    if (existing.promoted) {
      transaction.update(entry.ref, { lastMentionedAt: now });
      return;
    }

    const referenceCount = (existing.referenceCount || 0) + 1;
    const shouldPromote = referenceCount >= PROMOTION_REFERENCE_COUNT;

    transaction.update(entry.ref, {
      referenceCount,
      lastMentionedAt: now,
      promoted: shouldPromote,
      promotedAt: shouldPromote ? now : null,
    });

    if (shouldPromote && worldState) {
      worldState.globalFlags = worldState.globalFlags || {};
      worldState.globalFlags['entity_' + entry.normalizedName] = existing.name;
    }
  });
}

module.exports = {
  PROMOTION_REFERENCE_COUNT,
  normalizeEntityName,
  softCanonDocId,
  quarantineEntities,
};
