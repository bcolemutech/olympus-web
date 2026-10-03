'use strict';

const loomCanon = require('../loom-canon');
const { makeWorldState, turnStateOf } = require('../loom-models');
const { interpretAction } = require('./interpret');
const { adjudicateAction, ACTED } = require('./adjudicate');
const { narrateResolution } = require('./narrate');
const { commitTurn } = require('./commit');
const { newlyDiscovered } = require('./discovery');
const { planStep } = require('./steps');
const { FieldValue } = require('firebase-admin/firestore');

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

  // Static or Firestore-backed; only published worlds are playable. Re-checked
  // every turn so canon edits (canonVersion) reach the game on its next turn.
  const canonWorld = await loomCanon.loadWorld(worldId, { db });
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
 * A turn is either typed text, or a structured action from the world map
 * (`action: { verb: 'move', target }`; L-331 / #393) or a battle map
 * (`action: { verb: 'move', cell: { x, y } }`; L-351). A structured move needs
 * no model to interpret it, so it skips INTERPRET's Gemini call, but it is
 * adjudicated, gated and narrated exactly like a typed one.
 *
 * Ending the turn (`action: { verb: 'end-turn' }`; L-611 / #441) needs no
 * model at all: it is adjudicated (movement and the action refilled) and
 * recorded with a plain line in place of narration.
 *
 * A step on a battle map (`action: { verb: 'move', cell }`, or `{ verb:
 * 'continue' }` to walk the plan; L-613 / #443) needs no model either: it is
 * worked out by the rules (./steps.js) inside a transaction, spends movement,
 * keeps the rest of the path as the plan, and answers with plain lines and
 * `step: { cell, movementLeft, plan, lines }`. Only a step that reaches an
 * exit goes on through the pipeline, to leave by it, narrated.
 *
 * @param {{ db: FirebaseFirestore.Firestore, uid: string, worldId: string, saveId: string,
 *           actionText?: string, action?: { verb: 'move', target: string } }} params
 * @returns {Promise<{ narration: string, stateSummary: string, suggestedActions: string[] }>}
 */
async function runTurnPipeline(params) {
  const { db, uid, worldId, saveId, action } = params;

  const { save, saveRef, worldState, worldStateRef, canonWorld } = await intake({
    db,
    uid,
    worldId,
    saveId,
  });

  if (action && action.verb === 'end-turn') {
    const proposedAction = { verb: 'end-turn', targets: [], params: {} };
    const resolution = await adjudicateAction({ proposedAction, canonWorld, save, worldState });
    return commitTurn({
      db,
      saveRef,
      worldStateRef,
      worldId,
      actionText: 'end turn',
      proposedAction,
      resolution,
      narration: resolution.constraints.join(' '),
      entityRefs: [],
      inventedEntities: [],
      suggestedActions: [],
    });
  }

  if (action && (action.cell || action.verb === 'continue')) {
    const target = action.cell ? { cell: action.cell } : { plan: true };
    const step = await db.runTransaction(async (transaction) => {
      const fresh = (await transaction.get(saveRef)).data();
      const planned = planStep(canonWorld, fresh, target);
      if (planned.cell) {
        transaction.update(saveRef, {
          cell: planned.cell,
          turn: planned.turn,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return { ...planned, summary: fresh.recentSummary || '' };
    });
    if (!step.exit) {
      const lines = step.refused ? [step.refused] : step.lines;
      return {
        narration: lines.join(' '),
        stateSummary: step.summary,
        suggestedActions: [],
        step: {
          cell: step.cell || save.cell || null,
          movementLeft: (step.turn || turnStateOf(save)).movementLeft,
          plan: step.turn ? step.turn.plan : turnStateOf(save).plan,
          lines,
        },
      };
    }
    // The way out: walked there this turn, then left by, narrated (ADJUDICATE
    // spends the walk, L-614).
    return runTurnPipeline({
      ...params,
      action: { verb: 'leave', exit: step.exit.id, name: step.exit.name },
    });
  }

  let actionText = params.actionText;
  let proposedAction;
  if (action && action.verb === 'leave') {
    actionText = 'go out by ' + action.name;
    proposedAction = { verb: 'move', targets: ['exit:' + action.exit], params: { from: 'map' } };
  } else if (action) {
    const target = canonWorld.locations[action.target] || (canonWorld.places || {})[action.target];
    actionText = 'travel to ' + (target ? target.name : action.target);
    proposedAction = { verb: 'move', targets: [action.target], params: { from: 'map' } };
  } else {
    proposedAction = await interpretAction({ actionText, canonWorld, save, worldState });
  }
  const resolution = await adjudicateAction({ proposedAction, canonWorld, save, worldState });
  // A second action in a turn is turned down plainly: not narrated, not
  // recorded (L-614 / #444).
  if (resolution.outcome === 'blocked' && resolution.constraints[0] === ACTED) {
    return {
      narration: ACTED,
      stateSummary: save.recentSummary || '',
      suggestedActions: [],
      refused: true,
    };
  }
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
    discovered: newlyDiscovered(canonWorld, save, resolution),
  });
}

module.exports = { LoomTurnError, intake, runTurnPipeline };
