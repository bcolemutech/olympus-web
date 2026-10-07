'use strict';

const { FieldValue } = require('firebase-admin/firestore');
const { makeTurn, applyStateMutations } = require('../loom-models');
const { quarantineEntities } = require('./soft-canon');
const { shouldRegenerateSummary, maybeRegenerateSummary } = require('./summary');
const { doorStatesOf } = require('./steps');
const { look } = require('./seen');

/**
 * Stage 5 — COMMIT (design doc §5, §8).
 *
 * Applies state_mutations to World/Character state, appends the turn to the
 * event log, hands off model-invented entities to soft-canon quarantine, and
 * triggers async summary regeneration past a threshold. Runs inside a
 * Firestore transaction — re-reading fresh state and retrying on conflict —
 * so a batch tick (L-201) or another turn can never tear a write.
 *
 * L-110 (#297) shipped a minimal version (mutation application + append-only
 * turn log + updatedAt bookkeeping). L-114 (#301) added the soft-canon
 * handoff and summary-regen trigger points; L-115 (#302) and L-116 (#303)
 * filled in their real bodies respectively — same signature throughout.
 *
 * Mutations may carry a `target: 'save'` field to route them to Character
 * state instead of World State; anything else (the default) applies to World
 * State. This routing is COMMIT-only bookkeeping — applyStateMutations
 * itself (functions/loom-models.js) is state-shape agnostic.
 *
 * A turn that moves the save on a battle map, puts it on one, or opens or
 * closes a door adds what it now sees to what it has seen there (./seen.js;
 * L-632 / #455): from each square a typed move walked through (the
 * resolution's `walked`, which isn't kept in the turn record), and from
 * where it stands.
 *
 * @param {{
 *   db: FirebaseFirestore.Firestore,
 *   saveRef: FirebaseFirestore.DocumentReference,
 *   worldStateRef: FirebaseFirestore.DocumentReference,
 *   worldId: string,
 *   canonWorld?: object,     — the world, for what the save sees on a map
 *   actionText: string,
 *   proposedAction: object,
 *   resolution: { outcome: string, mutations: object[], constraints: string[] },
 *   narration: string,
 *   entityRefs: string[],
 *   inventedEntities: string[],
 *   suggestedActions: string[],
 *   discovered?: string[],   — places this turn revealed (./discovery.js)
 * }} params
 * @returns {Promise<{ narration: string, stateSummary: string, suggestedActions: string[] }>}
 */
async function commitTurn(params) {
  const {
    db,
    saveRef,
    worldStateRef,
    worldId,
    canonWorld,
    actionText,
    proposedAction,
    resolution,
    narration,
    entityRefs,
    inventedEntities,
    suggestedActions,
    discovered = [],
  } = params;

  const { contractResult, nextIndex } = await db.runTransaction(async (transaction) => {
    const turnsQuery = saveRef.collection('loom_turns').orderBy('index', 'desc').limit(1);
    const [saveSnap, worldStateSnap, lastTurnSnap] = await Promise.all([
      transaction.get(saveRef),
      transaction.get(worldStateRef),
      transaction.get(turnsQuery),
    ]);

    if (!saveSnap.exists) {
      throw new Error('commitTurn: save no longer exists');
    }

    const save = saveSnap.data();
    const worldState = worldStateSnap.exists
      ? worldStateSnap.data()
      : { worldId, locations: {}, factions: {}, globalFlags: {}, worldClock: 0 };

    const mutations = resolution.mutations || [];
    const saveMutations = mutations.filter((m) => m.target === 'save');
    const worldMutations = mutations.filter((m) => m.target !== 'save');

    const mapBefore = save.mapId;
    const doorsBefore = { ...doorStatesOf(save, mapBefore) };
    applyStateMutations(save, saveMutations);
    applyStateMutations(
      save,
      discovered.map((id) => ({ op: 'add', path: 'discovered', value: id }))
    );
    applyStateMutations(worldState, worldMutations);

    // What the save now sees on its map, read before any write.
    const looked = saveMutations.some((m) => /^(mapId|cell|doors)(\.|$)/.test(m.path));
    const sameMap = save.mapId === mapBefore;
    const seen =
      canonWorld && looked
        ? await look(
            transaction,
            saveRef,
            canonWorld,
            save,
            sameMap ? resolution.walked : [],
            sameMap ? doorsBefore : undefined
          )
        : null;

    const turnIndex = lastTurnSnap.empty ? 0 : lastTurnSnap.docs[0].data().index + 1;

    const recorded = Object.assign({}, resolution);
    delete recorded.walked;
    const turn = makeTurn({
      index: turnIndex,
      actionText,
      proposedAction,
      resolution: recorded,
      narration,
      entityRefs,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Quarantine (and possibly promote into worldState.globalFlags) before the
    // final writes below, so a promotion lands in the same worldState write —
    // and before any of this transaction's own writes, per the Firestore
    // reads-before-writes rule.
    await quarantineEntities({
      transaction,
      db,
      worldId,
      inventedEntities: inventedEntities || [],
      worldState,
    });

    transaction.set(saveRef.collection('loom_turns').doc(), turn);
    transaction.set(saveRef, Object.assign({}, save, { updatedAt: FieldValue.serverTimestamp() }));
    if (seen) transaction.set(seen.ref, seen.value);
    transaction.set(
      worldStateRef,
      Object.assign({}, worldState, { updatedAt: FieldValue.serverTimestamp() })
    );

    return {
      nextIndex: turnIndex,
      contractResult: {
        narration,
        stateSummary: save.recentSummary || '',
        suggestedActions: suggestedActions || [],
      },
    };
  });

  if (shouldRegenerateSummary(nextIndex)) {
    // Fire-and-forget: summary regen must not add per-turn latency.
    maybeRegenerateSummary({ db, saveRef, worldId, turnIndex: nextIndex }).catch((err) => {
      console.error('maybeRegenerateSummary failed:', err);
    });
  }

  return contractResult;
}

module.exports = { commitTurn };
