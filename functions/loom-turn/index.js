'use strict';

const loomCanon = require('../loom-canon');
const { makeWorldState, turnStateOf } = require('../loom-models');
const { interpretAction } = require('./interpret');
const { adjudicateAction, setOutWalk, ACTED, rollDie } = require('./adjudicate');
const { narrateResolution } = require('./narrate');
const { commitTurn } = require('./commit');
const { newlyDiscovered } = require('./discovery');
const { planStep, planDoor, doorStatesOf, OUT_OF_MOVEMENT } = require('./steps');
const { recordOf, knownTo, added } = require('./seen');
const { planTownStep, walksTown, townPlanOf } = require('./town-steps');
const { lookInTown, townRecordOf } = require('./town-seen');
const { foundIn, knownWorld, UNKNOWN } = require('./town-found');
const clock = require('../loom-canon/clock');
const maps = require('../loom-canon/maps');
const { systemOf } = require('../loom-canon/checks');
const { withSpeed } = require('../loom-canon/sheets');
const combat = require('../loom-modules/combat');
const { FieldValue } = require('firebase-admin/firestore');

/**
 * Thrown by pipeline stages to signal a specific HttpsError code the
 * loomPlayTurn callable (functions/index.js) should surface to the client.
 */
const ENDED =
  'Your story has ended. Start a new character in this world: what this one changed stays.';

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

  const stored = saveSnap.data();
  if (stored.ownerUid !== uid) {
    throw new LoomTurnError('permission-denied', 'This is not your save.');
  }
  if (stored.worldId !== worldId) {
    throw new LoomTurnError('failed-precondition', 'worldId does not match this save.');
  }

  // Static or Firestore-backed; only published worlds are playable. Re-checked
  // every turn so canon edits (canonVersion) reach the game on its next turn.
  const loaded = await loomCanon.loadWorld(worldId, { db });
  if (!loaded) {
    throw new LoomTurnError('not-found', 'Unknown world.');
  }
  // The world as this save sees it (L-824): its map's figures among the
  // characters, and everyone where the save has them.
  const canonWorld = combat.figures.withFigures(loaded, stored);
  // The character's speed, worked out for the world's system (L-811).
  const save = withSpeed(stored, systemOf(canonWorld));

  const worldStateRef = db.collection('loom_world_state').doc(worldId);
  const worldStateSnap = await worldStateRef.get();
  const worldState = worldStateSnap.exists ? worldStateSnap.data() : makeWorldState({ worldId });

  // On a battle map, the ground the save knows (./seen.js; L-635): typed
  // moves go only there, and the GM is told only what's on it (L-636).
  const known = save.mapId
    ? knownTo(canonWorld, save, (await recordOf(null, saveRef, save.mapId)).record)
    : null;

  // In a town with ground, the places the save has found there (L-673):
  // the GM knows only those, and moves go only to them.
  const found = save.location
    ? foundIn(canonWorld, save, (await townRecordOf(null, saveRef, save.location)).record)
    : null;

  return { save, saveRef, worldState, worldStateRef, canonWorld, known, found };
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
 * exit goes on through the pipeline, to leave by it, narrated, and so does
 * one that walks into a hazard (L-815): stopped there, it is triggered and
 * narrated (`action: { verb: 'hazard', hazard }`), the step's lines first.
 * An attack chosen on the map (`action: { verb: 'attack', target, attack?,
 * subdue? }`; L-822) needs no model to read it; an attack in a fight that
 * neither starts nor ends it is the rules' lines and roll card, unnarrated.
 * A step that ends in sight of a hostile, out of a fight, starts one, narrated
 * (`action: { verb: 'fight' }`; L-821), the step's lines first; an End turn
 * that ends a fight is narrated too. Opening or
 * closing a door beside the player (`{ verb: 'door', door, open }`; L-625 /
 * #450) is answered the same way. A step goes only to and over ground the
 * save knows (L-635 / #458). What it sees on the way, and from where it
 * stops, is added to what it has seen on the map (./seen.js; L-632 / #455),
 * in the same transaction.
 *
 * @param {{ db: FirebaseFirestore.Firestore, uid: string, worldId: string, saveId: string,
 *           actionText?: string, action?: { verb: 'move', target: string } }} params
 * @returns {Promise<{ narration: string, stateSummary: string, suggestedActions: string[] }>}
 */
async function runTurnPipeline(params) {
  const { db, uid, worldId, saveId, action } = params;

  const { save, saveRef, worldState, worldStateRef, canonWorld, known, found } = await intake({
    db,
    uid,
    worldId,
    saveId,
  });
  // A question asked of a complicated action last turn (L-826; CB1): what the
  // player types next is read as the answer; anything they do drops it.
  const asked = save.asked || null;
  if (asked) await saveRef.update({ asked: FieldValue.delete() });

  // A story that has ended (L-827: the character died) takes no more turns.
  if (save.ended) {
    return {
      narration: ENDED,
      stateSummary: save.recentSummary || '',
      suggestedActions: [],
      time: clock.timeView(clock.timeOf(save)),
      refused: true,
      ended: true,
    };
  }

  if (action && action.verb === 'end-turn') {
    const proposedAction = { verb: 'end-turn', targets: [], params: {} };
    const resolution = await adjudicateAction({ proposedAction, canonWorld, save, worldState });
    // A fight that ends with this turn is narrated (L-821; EN5); any other
    // End turn, rounds of a fight included, is plain lines.
    let resolution2 = resolution;
    // So is a round in which a named character acted (L-825; EN5): one
    // passage for it.
    const told =
      (resolution.fight && resolution.fight.ended) || (resolution.named || []).length
        ? await narrateResolution({
            actionText: 'end turn',
            proposedAction,
            resolution,
            canonWorld: knownWorld(canonWorld, save, found),
            save,
            worldState,
            saveRef,
            known,
          })
        : null;
    resolution2 = withFate(canonWorld, save, resolution, told);
    return commitTurn({
      db,
      saveRef,
      worldStateRef,
      worldId,
      canonWorld,
      actionText: 'end turn',
      proposedAction,
      resolution: resolution2,
      narration: [resolution2.constraints.join(' '), told && told.narration]
        .filter(Boolean)
        .join(' '),
      entityRefs: told ? told.entityRefs : [],
      inventedEntities: told ? told.inventedEntities : [],
      suggestedActions: told ? told.suggestedActions : [],
    });
  }

  // Walking in a town with ground (L-662): to a point on the street, to a
  // place's door, or on along the plan, by the rules alone; reaching a door
  // goes in, narrated. "Walk there" plays out turns until it arrives.
  if (action && !action.enter && walksTown(canonWorld, save)) {
    const target = townTargetOf(action, canonWorld, save);
    if (target && target.placeId && found && !found.has(target.placeId)) {
      return refusal(save, UNKNOWN);
    }
    if (target && action.verb === 'walk-there') return walkThere(params, target);
    if (target) return townStep(params, target);
  }
  if (action && action.verb === 'walk-there') {
    return refusal(save, 'There are no streets to walk here.');
  }

  if (action && (action.cell || action.verb === 'continue' || action.verb === 'door')) {
    const target = action.cell ? { cell: action.cell } : { plan: true };
    const step = await db.runTransaction(async (transaction) => {
      const fresh = withSpeed((await transaction.get(saveRef)).data(), systemOf(canonWorld));
      // What the save has seen on its map: the ground it may walk (L-635),
      // and the record its new sight is added to (L-632).
      const found = fresh.mapId ? await recordOf(transaction, saveRef, fresh.mapId) : null;
      let planned =
        action.verb === 'door'
          ? planDoor(canonWorld, fresh, action.door, action.open)
          : planStep(canonWorld, fresh, target, found && knownTo(canonWorld, fresh, found.record));
      // In a fight, stepping out of a foe's reach draws its attack (L-823;
      // PS4); struck down, the walk stops there.
      const reacted =
        planned.walked && (planned.cell || planned.exit)
          ? combat.play.walkReactions(canonWorld, fresh, planned.walked, { dice: rollDie })
          : null;
      const struck = reacted
        ? {
            fight: reacted.fight,
            figures: reacted.figures,
            'character.sheet': reacted.sheet,
            ...(reacted.down ? { down: reacted.down } : {}),
          }
        : {};
      if (reacted) {
        if (reacted.reached < planned.walked.length) {
          const walked = planned.walked.slice(0, reacted.reached);
          planned = {
            cell: walked.length ? walked[walked.length - 1] : fresh.cell,
            turn: { ...planned.turn, plan: null },
            lines: reacted.lines,
            walked,
          };
        } else if (planned.cell) {
          planned = { ...planned, lines: reacted.lines.concat(planned.lines) };
        } else {
          // On to the way out: the blows written now, the leaving after.
          transaction.update(saveRef, struck);
          planned = { ...planned, reactionLines: reacted.lines };
        }
      }
      // A door opened on the way (L-624), or opened or closed by a tap
      // (L-625), stays so for this save.
      const door = planned.door || (planned.opened && { ...planned.opened, state: 'open' });
      if (planned.cell) {
        const doors = door
          ? {
              ...fresh.doors,
              [door.mapId]: { ...doorStatesOf(fresh, door.mapId), [door.doorId]: door.state },
            }
          : fresh.doors;
        const seen = added(
          found,
          canonWorld,
          { ...fresh, cell: planned.cell, doors },
          planned.walked,
          doorStatesOf(fresh, fresh.mapId)
        );
        transaction.update(saveRef, {
          ...struck,
          cell: planned.cell,
          turn: planned.turn,
          ...(door ? { [`doors.${door.mapId}.${door.doorId}`]: door.state } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
        if (seen) transaction.set(seen.ref, seen.value);
      }
      // Where it now stands, for a fight it walked into sight of (L-821).
      const after = planned.cell
        ? {
            ...fresh,
            cell: planned.cell,
            turn: planned.turn,
            ...(door
              ? {
                  doors: {
                    ...fresh.doors,
                    [door.mapId]: { ...doorStatesOf(fresh, door.mapId), [door.doorId]: door.state },
                  },
                }
              : {}),
          }
        : fresh;
      return { ...planned, summary: fresh.recentSummary || '', after };
    });
    if (step.hazard) {
      // Walked into a hazard (L-815): it triggers, narrated.
      const struck = await runTurnPipeline({
        ...params,
        action: { verb: 'hazard', hazard: step.hazard.id, name: step.hazard.name },
      });
      const lines = step.lines || [];
      return {
        ...struck,
        narration: [lines.join(' '), struck.narration].filter(Boolean).join(' '),
        step: {
          cell: step.cell,
          movementLeft: step.turn.movementLeft,
          plan: step.turn.plan,
          lines,
          hazard: step.hazard.id,
        },
      };
    }
    const spotted =
      !step.exit && !step.refused && !combat.play.fightOf(step.after)
        ? combat.play.hostilesInSight(canonWorld, step.after)
        : [];
    if (spotted.length) {
      // In sight of a hostile (L-821; SE1): a fight starts, narrated.
      const fought = await runTurnPipeline({
        ...params,
        action: { verb: 'fight', names: spotted.map((c) => c.name) },
      });
      const lines = step.lines || [];
      return {
        ...fought,
        narration: [lines.join(' '), fought.narration].filter(Boolean).join(' '),
        step: {
          cell: step.cell,
          movementLeft: step.turn.movementLeft,
          plan: step.turn.plan,
          lines,
          fight: true,
        },
      };
    }
    if (!step.exit) {
      const lines = step.refused ? [step.refused] : step.lines;
      return {
        narration: lines.join(' '),
        stateSummary: step.summary,
        suggestedActions: [],
        // A step takes no time of its own: End turn charges it (L-371).
        time: clock.timeView(clock.timeOf(save)),
        step: {
          cell: step.cell || save.cell || null,
          movementLeft: (step.turn || turnStateOf(save)).movementLeft,
          plan: step.turn ? step.turn.plan : turnStateOf(save).plan,
          lines,
        },
      };
    }
    // The way out: walked there this turn, then left by, narrated (ADJUDICATE
    // spends the walk, L-614); the blows it drew on the way first (L-823).
    const left = await runTurnPipeline({
      ...params,
      action: { verb: 'leave', exit: step.exit.id, name: step.exit.name },
    });
    if (!step.reactionLines) return left;
    return {
      ...left,
      narration: [step.reactionLines.join(' '), left.narration].filter(Boolean).join(' '),
    };
  }

  let actionText = params.actionText;
  let proposedAction;
  if (action && action.verb === 'leave') {
    actionText = 'go out by ' + action.name;
    proposedAction = { verb: 'move', targets: ['exit:' + action.exit], params: { from: 'map' } };
  } else if (action && action.verb === 'rest') {
    // A short or long rest chosen in the Loom (L-827): no model reads it.
    actionText = 'take a ' + action.rest + ' rest';
    proposedAction = { verb: 'rest', targets: [], params: { rest: action.rest } };
  } else if (action && ['dash', 'dodge', 'withdraw', 'ready', 'use'].includes(action.verb)) {
    // A fight's other actions chosen in the Loom (L-823): no model reads them.
    const target = action.target && (canonWorld.characters || {})[action.target];
    const thing = action.feature && maps.positionOf(canonWorld, save).map;
    const feature = thing && (thing.features || []).find((f) => f.id === action.feature);
    actionText =
      action.verb === 'use'
        ? 'use ' + (feature ? feature.name : action.feature)
        : action.verb + (target ? ' for ' + target.name : '');
    proposedAction = {
      verb: action.verb,
      targets: action.feature
        ? ['feature:' + action.feature]
        : action.target
          ? [String(action.target)]
          : [],
      params: action.attack ? { attack: String(action.attack) } : {},
    };
  } else if (action && action.verb === 'attack') {
    // An attack chosen on the map (L-822): no model reads it.
    const target = (canonWorld.characters || {})[action.target];
    actionText = 'attack ' + (target ? target.name : action.target);
    proposedAction = {
      verb: 'attack',
      targets: [String(action.target || '')],
      params: {
        ...(action.attack ? { attack: String(action.attack) } : {}),
        ...(action.subdue ? { subdue: true } : {}),
      },
    };
  } else if (action && action.verb === 'fight') {
    actionText = 'come into sight of ' + (action.names || []).join(' and ');
    proposedAction = { verb: 'fight', targets: [], params: { by: 'seen' } };
  } else if (action && action.verb === 'hazard') {
    actionText = 'walk into ' + action.name;
    proposedAction = { verb: 'hazard', targets: ['hazard:' + action.hazard], params: {} };
  } else if (action) {
    const target = canonWorld.locations[action.target] || (canonWorld.places || {})[action.target];
    actionText = 'travel to ' + (target ? target.name : action.target);
    proposedAction = { verb: 'move', targets: [action.target], params: { from: 'map' } };
  } else {
    proposedAction = await interpretAction({
      actionText,
      canonWorld: knownWorld(canonWorld, save, found),
      save,
      worldState,
      known,
      asked,
    });
  }
  // Setting out from a town with ground, from anywhere on its streets
  // (#669): the way out is walked turn after turn, as Walk there is, and the
  // journey begins there.
  const out = action && action.enter ? null : setOutWalk(canonWorld, save, proposedAction);
  if (out && out.refused) return refusal(save, out.refused);
  if (out) {
    const walked = await walkThere(params, out.target);
    if (!walked.step || !walked.step.left) return walked;
    return {
      ...walked,
      narration: ['You make your way to ' + out.way.name + '.', walked.step.setOut]
        .filter(Boolean)
        .join(' '),
    };
  }

  const resolution = await adjudicateAction({
    proposedAction,
    canonWorld,
    save,
    worldState,
    known,
    found,
  });
  // A second action in a turn is turned down plainly: not narrated, not
  // recorded (L-614 / #444); so is one a condition stops (L-815: Stunned).
  if (
    resolution.outcome === 'blocked' &&
    (resolution.constraints[0] === ACTED || resolution.plain)
  ) {
    // A complicated action (L-826): its question, kept for the answer. Like
    // a refusal, it spends nothing: no action, no time.
    if (resolution.ask) {
      await saveRef.update({ asked: { action: actionText, question: resolution.ask } });
    }
    return {
      ...(resolution.ask ? { asked: resolution.ask } : {}),
      narration: resolution.constraints[0],
      stateSummary: save.recentSummary || '',
      suggestedActions: [],
      time: clock.timeView(clock.timeOf(save)),
      refused: true,
    };
  }
  // A turn the rules wrote whole (L-822: an attack in a fight that neither
  // starts nor ends it; EN5): its lines and roll card, not narrated.
  if (resolution.ruled) {
    return commitTurn({
      db,
      saveRef,
      worldStateRef,
      worldId,
      canonWorld,
      actionText,
      proposedAction,
      resolution,
      narration: resolution.constraints.join(' '),
      entityRefs: [],
      inventedEntities: [],
      suggestedActions: [],
    });
  }
  const told = await narrateResolution({
    actionText,
    proposedAction,
    resolution,
    canonWorld: knownWorld(canonWorld, save, found),
    save,
    worldState,
    saveRef,
    known,
  });
  const { narration, entityRefs, inventedEntities, suggestedActions } = told;

  return commitTurn({
    db,
    saveRef,
    worldStateRef,
    worldId,
    canonWorld,
    actionText,
    proposedAction,
    resolution: withFate(canonWorld, save, resolution, told),
    narration,
    entityRefs,
    inventedEntities,
    suggestedActions,
    discovered: newlyDiscovered(canonWorld, save, resolution),
  });
}

/**
 * The player's fate, when they fell with no one to help and death is off
 * (L-827; DF2): NARRATE chose captured, robbed or rescued (decided
 * 2026-10-22), and the rules apply it (../loom-modules/combat/down.js). Any
 * other resolution comes back as it is; the record keeps the fate, not the
 * sheet it was worked from.
 */
function withFate(canonWorld, save, resolution, told) {
  const fallen = resolution && resolution.fallen;
  if (!fallen || fallen.outcome !== 'fate') return resolution;
  const fate = combat.down.fateMutations(canonWorld, save, told && told.fate, {
    sheet: fallen.sheet,
    hours: fallen.hours,
  });
  return {
    ...resolution,
    mutations: resolution.mutations.concat(fate.mutations),
    constraints: resolution.constraints.concat([fate.line]),
    fallen: { outcome: 'fate', fate: fate.fate },
  };
}

// What a town move heads for (L-662): a point, a place in this town, or the
// plan; null when the action isn't a walk in town.
function townTargetOf(action, canonWorld, save) {
  if (action.point) return { point: action.point };
  if (action.verb === 'continue') return townPlanOf(save) ? { plan: true } : null;
  const place = action.target && (canonWorld.places || {})[action.target];
  if (place && place.locationId === save.location) return { placeId: place.id };
  return null;
}

// A plain answer that changes nothing.
function refusal(save, line) {
  return {
    narration: line,
    stateSummary: save.recentSummary || '',
    suggestedActions: [],
    time: clock.timeView(clock.timeOf(save)),
    step: {
      townPoint: save.townPoint || null,
      movementLeft: turnStateOf(save).movementLeft,
      plan: turnStateOf(save).plan,
      lines: [line],
    },
  };
}

// One walk in town (./town-steps.js), written in a transaction so two moves
// can't spend the same movement. Reaching a place's door goes in, narrated.
async function townStep(params, target) {
  const { db, uid, worldId, saveId } = params;
  const { saveRef, canonWorld } = await intake({ db, uid, worldId, saveId });
  const step = await db.runTransaction(async (transaction) => {
    const fresh = withSpeed((await transaction.get(saveRef)).data(), systemOf(canonWorld));
    const planned = planTownStep(canonWorld, fresh, target);
    // What it sees along the way, added to what it has seen of the town
    // (L-671), read before the transaction's writes.
    const seen = planned.point
      ? await lookInTown(
          transaction,
          saveRef,
          canonWorld,
          { ...fresh, townPoint: planned.point, placeId: null },
          planned.walked
        )
      : null;
    if (planned.point) {
      if (seen) transaction.set(seen.ref, seen.value);
      transaction.update(saveRef, {
        townPoint: planned.point,
        placeId: null,
        turn: planned.turn,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return { ...planned, before: fresh };
  });
  const lines = step.refused ? [step.refused] : step.lines;
  const answer = {
    narration: lines.join(' '),
    stateSummary: step.before.recentSummary || '',
    suggestedActions: [],
    time: clock.timeView(clock.timeOf(step.before)),
    step: {
      townPoint: step.point || step.before.townPoint || null,
      movementLeft: (step.turn || turnStateOf(step.before)).movementLeft,
      plan: step.turn ? step.turn.plan : turnStateOf(step.before).plan,
      lines,
    },
    ...(step.refused ? { refused: true } : {}),
  };
  if (step.leave) {
    // At the way out of a walk to leave town (L-663): set out.
    const left = await runTurnPipeline({
      ...params,
      action: { verb: 'move', target: step.leave, enter: true },
    });
    return {
      ...left,
      narration: [lines.join(' '), left.narration].filter(Boolean).join(' '),
      // The setting out's own account, for a walk out told whole (#669).
      step: { ...answer.step, townPoint: null, left: step.leave, setOut: left.narration },
    };
  }
  if (!step.enter) return answer;
  // At the door: in you go, onto its battle map if it has one.
  const entered = await runTurnPipeline({
    ...params,
    action: { verb: 'move', target: step.enter.id, enter: true },
  });
  return {
    ...entered,
    narration: [lines.join(' '), entered.narration].filter(Boolean).join(' '),
    step: { ...answer.step, townPoint: null, entered: step.enter.id },
  };
}

// The most turns "Walk there" plays out in one request: far more than the
// widest great city needs (2.5 km across is about 7 turns at 400 m).
const WALK_THERE_TURNS = 20;

/**
 * "Walk there" (L-662): walks, ends the turn, and walks on, until it
 * arrives (going in at a door), or something stops it: a refusal, or a
 * walk that ends with movement left but no arrival. With no movement left
 * this turn, it starts from the next (#671).
 */
async function walkThere(params, target) {
  const lines = [];
  let turns = 0;
  let answer = null;
  let next = target;
  for (; turns < WALK_THERE_TURNS; turns++) {
    answer = await townStep(params, next);
    if (answer.refused && turns === 0 && answer.step.lines[0] === OUT_OF_MOVEMENT) {
      await runTurnPipeline({ ...params, action: { verb: 'end-turn' } });
      continue;
    }
    lines.push(...answer.step.lines.filter((line) => line !== OUT_OF_MOVEMENT));
    const { plan, movementLeft } = answer.step;
    const walking = plan && plan.layer === 'town';
    if (answer.refused || answer.step.entered || answer.step.left || !walking || movementLeft > 0) {
      break;
    }
    await runTurnPipeline({ ...params, action: { verb: 'end-turn' } });
    next = { plan: true };
  }
  return {
    ...answer,
    narration:
      answer.step.entered || answer.step.left
        ? answer.narration
        : lines.join(' ') || answer.narration,
    step: { ...answer.step, turns: turns + 1 },
  };
}

module.exports = { LoomTurnError, intake, runTurnPipeline };
