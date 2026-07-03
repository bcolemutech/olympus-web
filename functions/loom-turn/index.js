'use strict';

const loomCanon = require('../loom-canon');
const { makeWorldState } = require('../loom-models');
const { interpretAction } = require('./interpret');
const { adjudicateAction } = require('./adjudicate');
const { narrateResolution } = require('./narrate');
const { commitTurn } = require('./commit');

/**
 * Thrown by pipeline stages to signal a specific HttpsError code the
 * loomPlayTurn callable (functions/index.js) should surface to the client.
 */
class LoomTurnError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LoomTurnError';
    this.code = code;
  }
}

/**
 * Stage 1 — INTAKE (design doc §5).
 *
 * Loads the save and world state and validates ownership/world consistency.
 * Real from day one (not stubbed) — this is where "server owns truth" starts.
 *
 * @param {{ db: FirebaseFirestore.Firestore, uid: string, worldId: string, saveId: string }} params
 */
async function intake(params) {
  const { db, uid, worldId, saveId } = params;

  const saveRef = db.collection('loom_saves').doc(saveId);
  const saveSnap = await saveRef.get();
  if (!saveSnap.exists) {
    throw new LoomTurnError('not-found', 'Save not found.');
  }

  const save = saveSnap.data();
  if (save.ownerUid !== uid) {
    throw new LoomTurnError('permission-denied', 'This is not your save.');
  }
  if (save.worldId !== worldId) {
    throw new LoomTurnError('failed-precondition', 'worldId does not match this save.');
  }

  const canonWorld = loomCanon.getWorld(worldId);
  if (!canonWorld) {
    throw new LoomTurnError('not-found', 'Unknown world.');
  }

  const worldStateRef = db.collection('loom_world_state').doc(worldId);
  const worldStateSnap = await worldStateRef.get();
  const worldState = worldStateSnap.exists ? worldStateSnap.data() : makeWorldState({ worldId });

  return { save, saveRef, worldState, worldStateRef, canonWorld };
}

/**
 * Runs the full §5 pipeline — INTAKE → INTERPRET → ADJUDICATE → NARRATE →
 * COMMIT — and returns the client-facing contract. The client never sees raw
 * state authority; only { narration, stateSummary, suggestedActions }.
 *
 * @param {{ db: FirebaseFirestore.Firestore, uid: string, worldId: string, saveId: string, actionText: string }} params
 * @returns {Promise<{ narration: string, stateSummary: string, suggestedActions: string[] }>}
 */
async function runTurnPipeline(params) {
  const { db, uid, worldId, saveId, actionText } = params;

  const { save, saveRef, worldState, worldStateRef, canonWorld } = await intake({
    db,
    uid,
    worldId,
    saveId,
  });

  const proposedAction = await interpretAction({ actionText, canonWorld, save, worldState });
  const resolution = await adjudicateAction({ proposedAction, canonWorld, save, worldState });
  const { narration, entityRefs, inventedEntities, suggestedActions } = await narrateResolution({
    actionText,
    proposedAction,
    resolution,
    canonWorld,
    save,
    worldState,
    saveRef,
  });

  return commitTurn({
    db,
    saveRef,
    worldStateRef,
    worldId,
    actionText,
    proposedAction,
    resolution,
    narration,
    entityRefs,
    inventedEntities,
    suggestedActions,
  });
}

module.exports = { LoomTurnError, intake, runTurnPipeline };
