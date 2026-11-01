'use strict';

const { FieldValue } = require('firebase-admin/firestore');
const { makeTurn, applyStateMutations } = require('../loom-models');
const { quarantineEntities } = require('./soft-canon');
const { shouldRegenerateSummary, maybeRegenerateSummary } = require('./summary');
const { doorStatesOf } = require('./steps');
const { look } = require('./seen');
const { lookInTown } = require('./town-seen');
const visits = require('./visits');
const clock = require('../loom-canon/clock');
const frames = require('../loom-canon/frames');
const effects = require('../loom-canon/effects');
const { systemOf } = require('../loom-canon/checks');
const earning = require('../loom-modules/advancement/earn');
const advancement = require('../loom-modules/advancement');
const levelUp = require('../loom-modules/advancement/level-up');
const using = require('../loom-modules/advancement/use');

// Verbs whose rolls are not the player's own doing: saves, initiative,
// rests, the rounds of a fight.
const NOT_USES = /^(hazard|fight|end-turn|rest|wait|move)$/;

/**
 * What a turn's resolution counts toward improving by use (L-844; US2): the
 * skill of a check that succeeded with stakes (INTERPRET's flag, or in a
 * fight), and the attack that hit someone in a fight.
 */
function usesOf(proposedAction, resolution, inFight) {
  const verb = String((proposedAction && proposedAction.verb) || '');
  if (NOT_USES.test(verb)) return {};
  const stakes = inFight || Boolean((proposedAction.params || {}).stakes);
  const roll = resolution && resolution.roll;
  const attack = resolution && resolution.attack;
  const hit = attack && (attack.targets || []).some((t) => t.hit);
  return {
    skill: !attack && stakes && roll && roll.success && roll.skill ? roll.skill : null,
    attack: hit && inFight ? attack.id : null,
  };
}

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
 *   suggestedActions: [{ text, verb?, target? }],
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
    moment = null,
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
    // A save from before L-381: the towns it has records of, read now
    // (before any write), to derive where it has been (./visits.js).
    const townsRecorded = Array.isArray(save.visited)
      ? null
      : (await transaction.get(saveRef.collection('seenTowns'))).docs.map((d) => d.id);
    const before = save.location;
    const worldState = worldStateSnap.exists
      ? worldStateSnap.data()
      : { worldId, locations: {}, factions: {}, globalFlags: {}, worldClock: 0 };

    const mutations = resolution.mutations || [];
    const saveMutations = mutations.filter((m) => m.target === 'save');
    const worldMutations = mutations.filter((m) => m.target !== 'save');

    // The fight as it stood, for the foes this turn overcomes (L-842).
    const fightBefore = save.fight ? JSON.parse(JSON.stringify(save.fight)) : null;
    const mapBefore = save.mapId;
    const doorsBefore = { ...doorStatesOf(save, mapBefore) };
    applyStateMutations(save, saveMutations);
    applyStateMutations(
      save,
      discovered.map((id) => ({ op: 'add', path: 'discovered', value: id }))
    );
    applyStateMutations(worldState, worldMutations);
    // Where the save now stands, as `at` (L-903; ../loom-canon/frames.js):
    // set by the turn (a move up, down or across maps), the frame's fields
    // follow it; else it follows them. The rest of the turn's bookkeeping
    // sees the world from where it now stands.
    const here =
      canonWorld && canonWorld.frame
        ? frames.settle(
            canonWorld,
            save,
            saveMutations.some((m) => m.path === 'at')
          )
        : canonWorld;
    // Where it has been and the ways in and out it knows (L-381): derived
    // for a save from before, then where it now stands noted.
    if (townsRecorded) Object.assign(save, visits.derived(before, townsRecorded));
    if (here) visits.noteWhereItIs(here, save);
    // A use counted (L-844; ../loom-modules/advancement/use.js): a skill
    // rolled and succeeded with stakes (INTERPRET's say, or a fight on), or
    // an attack that hit in a fight.
    const usedSheet = save.character && save.character.sheet;
    if (canonWorld && usedSheet) {
      save.character.sheet = using.counted(
        systemOf(canonWorld),
        canonWorld,
        usedSheet,
        usesOf(proposedAction, resolution, Boolean(fightBefore || save.fight || resolution.fight))
      );
    }
    // Experience earned (L-842; ../loom-modules/advancement/earn.js): each
    // foe overcome, and a story moment NARRATE named, paid once.
    const earned = canonWorld
      ? earning.earn(systemOf(canonWorld), canonWorld, save, {
          foes: earning.overcomeIn(
            fightBefore,
            save.fight,
            resolution.fight && resolution.fight.overcome
          ),
          moment,
        })
      : null;
    if (earned) earning.apply(systemOf(canonWorld), save, earned);
    const awards = earned ? earned.awards : [];
    const restedLong =
      resolution.rest && resolution.rest.kind === 'long' && !resolution.rest.interrupted;
    // At a long rest, skills and attacks at their thresholds rise (L-844).
    let rises = [];
    if (canonWorld && restedLong && save.character && save.character.sheet) {
      const risen = using.rise(systemOf(canonWorld), canonWorld, save.character.sheet);
      save.character.sheet = risen.sheet;
      rises = risen.rises;
    }
    // A level ready at a long rest (L-843; advancement LV3): offered now, and
    // kept for the player's levelUp until any other turn; never in a fight.
    const rested = restedLong;
    const sheetNow = save.character && save.character.sheet;
    const offer =
      canonWorld && rested && !save.fight && sheetNow
        ? levelUp.offerOf(
            systemOf(canonWorld),
            advancement.sheetWith(systemOf(canonWorld), sheetNow, canonWorld),
            canonWorld
          )
        : null;
    if (offer) save.levelOffer = true;
    else delete save.levelOffer;
    // An older save gets its clock on its next turn (L-371): Day 1, 08:00.
    if (!clock.isTime(save.time)) save.time = clock.START;
    // Conditions whose game time has run out by now end (L-815): a journey
    // or a wait outlasts them.
    const sheet = save.character && save.character.sheet;
    if (canonWorld && sheet && (sheet.conditions || []).length) {
      save.character.sheet = effects.expire(systemOf(canonWorld), sheet, save.time).sheet;
    }

    // What the save now sees on its map, read before any write.
    const looked = saveMutations.some((m) => /^(mapId|cell|doors|at)(\.|$)/.test(m.path));
    const sameMap = save.mapId === mapBefore;
    const seen =
      here && looked
        ? await look(
            transaction,
            saveRef,
            here,
            save,
            sameMap ? resolution.walked : [],
            sameMap ? doorsBefore : undefined
          )
        : null;

    // What it sees in a town with ground, when the turn leaves it on the
    // street (L-671): along a typed walk, or from where it now stands.
    const townMoved = saveMutations.some((m) =>
      /^(townPoint|placeId|mapId|location|at)$/.test(m.path)
    );
    const townSeen =
      here && townMoved
        ? await lookInTown(transaction, saveRef, here, save, resolution.walkedTown)
        : null;

    const turnIndex = lastTurnSnap.empty ? 0 : lastTurnSnap.docs[0].data().index + 1;

    const recorded = Object.assign(
      {},
      resolution,
      awards.length ? { awards } : {},
      rises.length ? { rises } : {}
    );
    // Others' turns played out on the map (L-828) are for the answer only.
    delete recorded.playback;
    delete recorded.held;
    delete recorded.walked;
    delete recorded.walkedTown;
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
    if (townSeen) transaction.set(townSeen.ref, townSeen.value);
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
        // The die, for the panel's roll card (L-726); kept in the turn record too.
        ...(resolution.roll ? { roll: resolution.roll } : {}),
        // Everyone else's turns, to play out on the map (L-828; combat UI3).
        ...(resolution.playback ? { turns: resolution.playback } : {}),
        // A level to take, offered at a long rest (L-843; the GM's suggestion
        // is added after, ./index.js).
        ...(offer ? { levelUp: offer } : {}),
        // Skills and attacks risen by use at a long rest (L-844), for the journal.
        ...(rises.length ? { rises } : {}),
        // Experience earned, for the journal (L-842; shown by L-845).
        ...(awards.length ? { awards } : {}),
        // The AP kept for reactions and what's left of it, for the turn bar (L-837).
        ...(resolution.held ? { held: resolution.held } : {}),
        // The time once the turn is done, for the map's clock (L-376).
        time: clock.timeView(clock.timeOf(save)),
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
