'use strict';

const loomCanon = require('../loom-canon');
const { makeWorldState, turnStateOf } = require('../loom-models');
const { interpretAction } = require('./interpret');
const {
  adjudicateAction,
  setOutWalk,
  needsNoRoll,
  ACTED,
  rollDie,
  priceOf,
} = require('./adjudicate');
const { reachPlan } = require('./reach');
const { narrateResolution } = require('./narrate');
const { commitTurn } = require('./commit');
const { newlyDiscovered } = require('./discovery');
const { planStep, planDoor, doorStatesOf, OUT_OF_MOVEMENT, OUT_OF_AP } = require('./steps');
const seen = require('./seen');
const { recordOf, knownTo, added } = seen;
const { lookAt, lookTargetOf } = require('./looking');
const { planTownStep, walksTown, townPlanOf } = require('./town-steps');
const { lookInTown, townRecordOf } = require('./town-seen');
const { foundIn, knownWorld, UNKNOWN } = require('./town-found');
const clock = require('../loom-canon/clock');
const maps = require('../loom-canon/maps');
const layers = require('../loom-canon/layers');
const { systemOf } = require('../loom-canon/checks');
const { withAp } = require('../loom-canon/sheets');
const apRules = require('../loom-canon/ap');
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
  // The character's pool of action points, worked out for the world's system (L-811; L-832).
  const save = withAp(stored, systemOf(canonWorld));

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
 * `step: { cell, ap, plan, lines }` (`ap` the AP left, L-832). Only a step that reaches an
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
  // An action waiting on the player's say-so (#673): Do it plays it, and
  // anything else drops it.
  const pending = save.pending || null;
  const confirming = Boolean(action && action.verb === 'confirm');
  if (pending && !confirming) await saveRef.update({ pending: FieldValue.delete() });

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

  if (confirming) return confirmTurn(params, { save, saveRef, canonWorld }, pending);

  // "What's here?" on a battle map (#672): free, unrecorded.
  if (action && action.verb === 'look') {
    return lookTurn(params, { save, saveRef, canonWorld, known, found, worldState }, action);
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
      const fresh = withAp((await transaction.get(saveRef)).data(), systemOf(canonWorld));
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
        // Wary figures turned by the areas walked into or the door opened
        // (L-392); those turned hostile in a fight join it.
        const here = maps.positionOf(canonWorld, fresh).map;
        const doorOf = door && here && (here.doors || []).find((d) => d.id === door.doorId);
        const turned = combat.wary.react(canonWorld, { ...fresh, cell: planned.cell, doors }, [
          ...combat.wary.walkEvents(here, fresh.cell, planned.walked),
          ...(doorOf
            ? combat.wary.doorEvents(
                door.doorId,
                layers.doorState(doorOf, doorStatesOf(fresh, door.mapId)),
                door.state,
                { keyed: true }
              )
            : []),
        ]);
        const sides = Object.fromEntries(turned.map((t) => ['sides.' + t.id, t.side]));
        const sided = combat.wary.withTurned({ ...fresh, cell: planned.cell, doors }, turned);
        const joined = turned.length
          ? combat.play.joinFight(
              combat.figures.withFigures(canonWorld, sided),
              { ...sided, ...(struck.fight ? { fight: struck.fight } : {}) },
              turned.filter((t) => t.side === 'hostile').map((t) => t.id),
              { dice: rollDie }
            )
          : null;
        if (turned.length) {
          planned = {
            ...planned,
            lines: (planned.lines || [])
              .concat(combat.wary.linesOf(turned))
              .concat(joined ? joined.lines : []),
            sides: sided.sides,
          };
        }
        transaction.update(saveRef, {
          ...struck,
          ...(joined ? { fight: joined.mutations[0].value } : {}),
          ...sides,
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
            ...(planned.sides ? { sides: planned.sides } : {}),
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
          ap: step.turn.ap,
          plan: step.turn.plan,
          lines,
          hazard: step.hazard.id,
        },
      };
    }
    const spotted =
      !step.exit && !step.refused && !combat.play.fightOf(step.after)
        ? combat.play.hostilesInSight(
            combat.figures.withFigures(canonWorld, step.after),
            step.after
          )
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
          ap: step.turn.ap,
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
          ap: (step.turn || turnStateOf(save)).ap,
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
  } else if (
    action &&
    ['dash', 'dodge', 'withdraw', 'stand', 'ready', 'use'].includes(action.verb)
  ) {
    // A fight's other actions chosen in the Loom (L-823): no model reads them.
    const target = action.target && (canonWorld.characters || {})[action.target];
    const thing = action.feature && maps.positionOf(canonWorld, save).map;
    const feature = thing && (thing.features || []).find((f) => f.id === action.feature);
    actionText =
      action.verb === 'use'
        ? 'use ' + (feature ? feature.name : action.feature)
        : action.verb === 'stand'
          ? 'stand up'
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
  } else if (action && action.verb === 'suggested') {
    // One of the GM's suggestions (#673): read from its verb and target when
    // it names them and needs no roll worked out, else by INTERPRET as typed.
    actionText = action.text;
    const act = action.act || {};
    proposedAction =
      act.verb && DIRECT.test(act.verb)
        ? { verb: act.verb, targets: act.target ? [act.target] : [], params: {} }
        : await interpretAction({
            actionText,
            canonWorld: knownWorld(canonWorld, save, found),
            save,
            worldState,
            known,
            asked,
          });
  } else if (action) {
    const target = canonWorld.locations[action.target] || (canonWorld.places || {})[action.target];
    actionText = 'travel to ' + (target ? target.name : action.target);
    proposedAction = { verb: 'move', targets: [action.target], params: { from: 'map' } };
  } else if (params.proposed) {
    // Confirmed (#673): read when it was asked.
    proposedAction = params.proposed;
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
  // A typed look at something on the battle map (#672) is "What's here?";
  // at something not seen, it goes on as before ("You don't see that here.").
  const looked = lookTargetOf(canonWorld, save, proposedAction);
  const lookable =
    looked &&
    !lookAt(canonWorld, save, looked, {
      known,
      inSight: seen.inSightNow(canonWorld, save).squares,
    }).refused;
  if (lookable) {
    return lookTurn(
      params,
      { save, saveRef, canonWorld, known, found, worldState },
      looked,
      actionText
    );
  }

  // Out of reach, or one of the GM's suggestions (#673): what it would do
  // is shown first, for the player to confirm, and nothing is spent yet.
  const suggested = Boolean(action && action.verb === 'suggested');
  if (!params.confirmed && (suggested || !action)) {
    const plan = reachPlan(canonWorld, save, proposedAction, known);
    if (plan && plan.refused && suggested) return { ...refusal(save, plan.refused), refused: true };
    if (suggested || (plan && !plan.refused)) {
      return previewTurn(
        { save, saveRef, canonWorld },
        actionText,
        proposedAction,
        plan && !plan.refused ? plan : null
      );
    }
  }

  // Setting out from a town with ground, from anywhere on its streets
  // (#669): the way out is walked turn after turn, as Walk there is, and the
  // journey begins there.
  const out = action && action.enter ? null : setOutWalk(canonWorld, save, proposedAction, found);
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
  // An action the AP left won't pay for is turned down plainly: not
  // narrated, not recorded (L-614 / #444; L-832); so is one a condition
  // stops (L-815: Stunned).
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
      ap: turnStateOf(save).ap,
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
    const fresh = withAp((await transaction.get(saveRef)).data(), systemOf(canonWorld));
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
      ap: (step.turn || turnStateOf(step.before)).ap,
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

// The verbs a suggestion is taken at its word for (#673): no roll to work
// out, so no INTERPRET.
const DIRECT =
  /^(talk|speak|ask|greet|chat|examine|inspect|study|read|look|watch|move|go|travel|use)$/;
const MOVING = /^(move|go|travel|walk)$/;

// What a check would be, in the system's words, for the confirm card (#673):
// "A roll: Wisdom, Medium", "No roll", or null (a move).
function rollWords(canonWorld, proposedAction) {
  const verb = proposedAction.verb;
  if (MOVING.test(verb) || /^look/.test(verb)) return null;
  const check = (proposedAction.params || {}).check || null;
  if (needsNoRoll(verb) && (proposedAction.params || {}).plausibility !== 'improbable') {
    return 'No roll';
  }
  const system = systemOf(canonWorld);
  const sheet = system.sheet || {};
  const find = (list, id) => (list || []).find((x) => x.id === id);
  const skill = check && check.skill && find(sheet.skills, check.skill);
  const attribute = check && check.attribute && find(sheet.attributes, check.attribute);
  const named = skill ? skill.name || skill.id : attribute ? attribute.name || attribute.id : null;
  const ladder = system.checks.ladder;
  const top = ladder[ladder.length - 1].name;
  const rung =
    (proposedAction.params || {}).plausibility === 'improbable'
      ? top
      : (check && check.rung) || ladder[0].name;
  const against = check && check.opposedBy && (canonWorld.characters || {})[check.opposedBy];
  return (
    'A roll' +
    (named ? ': ' + named + ', ' : ', ') +
    rung +
    (against ? ' against ' + against.name : '')
  );
}

/**
 * The confirm card for an action (#673): the walk there, if it needs one,
 * the action, any roll and what it spends; kept on the save as `pending` for
 * Do it (`{ verb: 'confirm' }`). Nothing is spent or recorded yet.
 */
async function previewTurn({ save, saveRef, canonWorld }, actionText, proposedAction, walk) {
  const inFight = Boolean(combat.play.fightOf(save));
  const moving = MOVING.test(proposedAction.verb);
  const squares = (n) => (n === 1 ? '1 square' : n + ' squares');
  const lines = [];
  if (walk && walk.kind === 'map') {
    lines.push(
      'Walk ' +
        squares(walk.squares) +
        ' to ' +
        walk.name +
        (walk.thisTurn
          ? '.'
          : inFight
            ? ': more than this turn, so you stop partway and act next turn.'
            : ': more than this turn, so the walk goes on into the next.')
    );
  } else if (walk && walk.kind === 'town') {
    lines.push('Go to ' + walk.placeName + ', where ' + walk.name + ' is.');
  }
  const roll = rollWords(canonWorld, proposedAction);
  lines.push(
    (walk ? 'Then: ' : '') + actionText.charAt(0).toUpperCase() + actionText.slice(1) + '.'
  );
  if (roll) lines.push(roll + '.');
  // What it costs in AP where it's done (L-832): on this battle map, when
  // there's no walk to somewhere else first.
  const price =
    moving || (walk && walk.kind === 'town') ? null : priceOf(proposedAction, save, canonWorld);
  // With AP off (L-838) it is the turn's action, as before AP.
  if (!moving && apRules.isOff(systemOf(canonWorld))) lines.push('Uses your action.');
  else if (price && price.long)
    lines.push('Takes ' + price.long + ' AP, over more than one turn if need be.');
  else if (price) lines.push('Costs ' + price.cost + ' AP.');
  await saveRef.update({
    pending: {
      actionText,
      proposedAction: JSON.parse(JSON.stringify(proposedAction)),
      walk: walk || null,
    },
  });
  return {
    narration: lines.join(' '),
    stateSummary: save.recentSummary || '',
    suggestedActions: [],
    time: clock.timeView(clock.timeOf(save)),
    refused: true,
    confirm: { action: actionText, lines },
  };
}

// The most walks Do it takes to get there (#673): a town place, then its map.
const CONFIRM_HOPS = 3;
// And the most turns a walk on a map goes on into, out of a fight.
const CONFIRM_TURNS = 10;

/**
 * Do it (#673): the action kept by its confirm card, walked to and then
 * played. The walk is a move like any other (in a fight it stops at this
 * turn's movement; out of one it goes on turn after turn); if it's stopped
 * short (someone comes into view, a fight starts, a hazard, a refusal), the
 * action isn't played and the journal says why.
 */
async function confirmTurn(params, { save, saveRef, canonWorld }, pending) {
  if (!pending) return { ...refusal(save, 'There is nothing waiting to be done.'), refused: true };
  await saveRef.update({ pending: FieldValue.delete() });
  const lines = [];
  let walk = pending.walk;
  const stoppedShort = (why) => ({
    narration: lines.concat(why ? [why] : []).join(' '),
    stateSummary: save.recentSummary || '',
    suggestedActions: [],
    time: clock.timeView(clock.timeOf(save)),
  });
  for (let hop = 0; walk && hop < CONFIRM_HOPS; hop++) {
    if (walk.kind === 'map') {
      let next = { verb: 'move', cell: walk.cell };
      for (let t = 0; t < CONFIRM_TURNS; t++) {
        const step = await runTurnPipeline({ ...params, action: next });
        lines.push(
          ...((step.step && step.step.lines) || [step.narration]).filter(
            (l) => l && l !== OUT_OF_MOVEMENT && l !== OUT_OF_AP
          )
        );
        const now = (await saveRef.get()).data();
        if (now.cell && now.cell.x === walk.cell.x && now.cell.y === walk.cell.y) break;
        const plan = turnStateOf(now).plan;
        const onIt = plan && plan.layer === 'battleMap';
        const fightStarted = Boolean(now.fight) && !combat.play.fightOf(save);
        if (step.refused || !onIt || fightStarted || now.mapId !== save.mapId) {
          return stoppedShort('You stop short of ' + walk.name + '.');
        }
        if (combat.play.fightOf(save)) {
          return stoppedShort('The rest of the way to ' + walk.name + ' is kept for next turn.');
        }
        await runTurnPipeline({ ...params, action: { verb: 'end-turn' } });
        next = { verb: 'continue' };
      }
    } else {
      const fresh = (await saveRef.get()).data();
      const answer =
        canonWorld && walksTown(canonWorld, fresh)
          ? await walkThere(params, { placeId: walk.placeId })
          : await runTurnPipeline({ ...params, action: { verb: 'move', target: walk.placeId } });
      if (answer.narration) lines.push(answer.narration);
      const now = (await saveRef.get()).data();
      if (now.placeId !== walk.placeId) return stoppedShort('You stop short of ' + walk.name + '.');
    }
    // Once there, there may be a map to cross too (a place's own).
    const {
      save: now,
      canonWorld: world,
      known,
    } = await intake({
      db: params.db,
      uid: params.uid,
      worldId: params.worldId,
      saveId: params.saveId,
    });
    const after = reachPlan(world, now, pending.proposedAction, known);
    if (after && after.refused) return stoppedShort(after.refused);
    walk = after;
  }
  const acted = await runTurnPipeline({
    ...params,
    action: undefined,
    actionText: pending.actionText,
    proposed: pending.proposedAction,
    confirmed: true,
  });
  return {
    ...acted,
    narration: lines.concat([acted.narration]).filter(Boolean).join(' '),
  };
}

/**
 * "What's here?" (#672): the facts of a square or a door as the save knows
 * them (./looking.js), described by NARRATE from those alone, or, for an
 * empty square, the rules' plain line with no model. It spends nothing (no
 * action, movement or time, in a fight or out) and isn't recorded as a turn.
 */
async function lookTurn(params, context, target, typed) {
  const { save, saveRef, canonWorld, known, found } = context;
  const inSight = seen.inSightNow(canonWorld, save).squares;
  const look = lookAt(canonWorld, save, target, { known, inSight });
  if (look.refused) return { ...refusal(save, look.refused), refused: true };
  const plain = (narration) => ({
    narration,
    stateSummary: save.recentSummary || '',
    suggestedActions: [],
    time: clock.timeView(clock.timeOf(save)),
    looked: true,
  });
  if (look.empty) return plain(look.line);
  const actionText = typed || "what's here at " + look.at;
  const told = await narrateResolution({
    actionText,
    proposedAction: { verb: 'look', targets: [], params: {} },
    resolution: {
      outcome: 'success',
      mutations: [],
      // Without the model: the facts themselves, plainly (#672).
      fallback:
        (look.inSight ? '' : 'When you last saw it: ') +
        look.facts.join(' ').replace(/the player/g, 'you'),
      constraints: [
        look.inSight
          ? 'The player looks at ' + look.at + ', in sight now. What is there:'
          : 'The player thinks back to ' +
            look.at +
            ', out of sight now: describe it as remembered ("When you last saw it, …"). ' +
            'What was there:',
      ]
        .concat(look.facts)
        .concat([
          'Describe only this spot, in two or three sentences, from these facts alone: ' +
            'invent nothing there, and nothing happens. Taking a look costs no time.',
        ]),
    },
    canonWorld: knownWorld(canonWorld, save, found),
    save,
    saveRef,
    known,
  });
  return plain(told.narration);
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
    const { plan, ap } = answer.step;
    const walking = plan && plan.layer === 'town';
    if (answer.refused || answer.step.entered || answer.step.left || !walking || ap > 0) {
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
