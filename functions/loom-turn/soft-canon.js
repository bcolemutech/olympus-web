'use strict';

/**
 * Soft-canon quarantine (design doc §5, §11 L-115 / L-141).
 *
 * When NARRATE (L-113 / #300) names an entity absent from canon/state, COMMIT
 * hands it off here to be written to `loom_softcanon` as provisional — never
 * promoted into Canon itself (L-141 / #310, decided: promotion targets World
 * State only). This runs inside the same COMMIT transaction (functions/
 * loom-turn/commit.js) so a turn either fully commits — state, turn log, and
 * quarantined entities together — or not at all.
 *
 * STUB (L-114 / #301): the handoff point exists and is wired into COMMIT, but
 * nothing is written yet — NARRATE doesn't produce `inventedEntities` until
 * L-113 (#300) lands, so this always receives an empty list in practice.
 * Replaced by L-115 (#302) with the real quarantine write and the
 * promote-on-second-reference rule.
 *
 * @param {{
 *   transaction: FirebaseFirestore.Transaction,
 *   db: FirebaseFirestore.Firestore,
 *   worldId: string,
 *   inventedEntities: string[],
 * }} params
 */
async function quarantineEntities(params) {
  const { inventedEntities } = params;
  if (!inventedEntities || inventedEntities.length === 0) {
    return;
  }
  // L-115 (#302) will write each entry to loom_softcanon here.
}

module.exports = { quarantineEntities };
