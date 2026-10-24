'use strict';

/**
 * A fight (planning/combat.md §3 TN1, TN2, SE2, SE4, §4.2; L-821 / #653): who
 * is in it, the order they act in, whose turn it is and the round, by the
 * rules and the server's dice alone (CB0).
 *
 *   save.fight
 *     id, mapId, by        what started it: 'seen' (a hostile saw the player),
 *                          'attack' (the player attacked), 'gm' or 'event'
 *     round                from 1; a round is everyone taking a turn, 6 s
 *     order                combatant ids, first to act first
 *     turn                 whose turn it is
 *     combatants: { [id]: { kind: 'player' | 'character', side: 'party' |
 *                 'hostile', name, initiative, kept, surprised?,
 *                 out? } }
 *       kept               the AP they kept from their last turn, for
 *                          reactions until their next (L-833; action points
 *                          KP1, KP4); before their first turn, their whole
 *                          pool, since they've spent none
 *       out                how they left the fight: 'down', 'fled',
 *                          'surrendered', 'talkedDown', 'gone' (no longer on
 *                          the map) or 'stoodDown' (no longer hostile)
 *
 * Initiative (TN2) is the system's formula, rolled once when the fight
 * starts; ties go to the higher score in its tie-break attribute, then to
 * the player. Surprise (SE2): the ambushed side rolls to notice against the
 * ambushers' hiding (the worst hider's roll, since one is enough to give
 * them away); those who don't notice lose the first round. A fight ends
 * (SE4) when one side has nobody left in it.
 *
 * Pure: the dice come from the caller.
 */

const formula = require('../../loom-canon/formula');
const checks = require('../../loom-canon/checks');
const { settingsOf } = require('./settings');
const sheets = require('../../loom-canon/sheets');
const apRules = require('../../loom-canon/ap');

const PLAYER = 'player';
const SIDES = ['party', 'hostile'];
const OUTS = ['down', 'fled', 'surrendered', 'talkedDown', 'gone', 'stoodDown'];

const copyOf = (v) => JSON.parse(JSON.stringify(v));
const sideOf = (c) => (c.kind === PLAYER ? 'party' : c.side);

/**
 * A combatant's initiative (TN2): the system's formula on their sheet (the
 * system's defaults without one), with each term named. Returns `{ total,
 * tie, breakdown, line, formula }`, `tie` their tie-break score.
 */
function rollInitiative(system, combatant, dice) {
  const settings = settingsOf(system);
  const { values } = checks.valuesFor(system, { sheet: combatant.sheet || null }, {}, dice);
  const labels = checks.labelsFor(system, null, null);
  const result = formula.evaluate(settings.initiative.formula, { values, system, dice, labels });
  const tieBreak = settings.initiative.tieBreak;
  return {
    total: result.total,
    tie: tieBreak && Number.isFinite(values[tieBreak]) ? values[tieBreak] : 0,
    breakdown: result.breakdown,
    line: result.breakdown.named,
    formula: settings.initiative.formula,
  };
}

/** The order of turns: highest initiative first; ties by the tie-break, then the player. */
function orderOf(combatants) {
  return Object.entries(combatants)
    .sort(([aId, a], [bId, b]) => {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      if ((b.tie || 0) !== (a.tie || 0)) return (b.tie || 0) - (a.tie || 0);
      if (aId === PLAYER || bId === PLAYER) return aId === PLAYER ? -1 : 1;
      return String(a.name).localeCompare(String(b.name)) || aId.localeCompare(bId);
    })
    .map(([id]) => id);
}

// One side's roll for surprise (SE2), by the system's settings.
function surpriseCheck(system, part, sheet, dice, difficulty) {
  const rolled = settingsOf(system).surprise[part];
  return checks.rollCheck(system, {
    check: { skill: rolled.skill, attribute: rolled.attribute },
    character: { sheet: sheet || null },
    ...(difficulty ? { difficulty } : {}),
    dice,
  });
}

/**
 * Surprise (SE2): each ambusher rolls to hide; the side's hiding is its worst
 * roll; each of the ambushed rolls to notice against it, and those who fail
 * are surprised. With no surprise settings, nobody is.
 * Returns `{ surprised: [ids], hide: { id, roll } | null, notice: { [id]: roll } }`.
 */
function surprise(system, { ambushers, ambushed, dice }) {
  if (!settingsOf(system).surprise || !ambushers.length || !ambushed.length) {
    return { surprised: [], hide: null, notice: {} };
  }
  const ladder = system.checks.ladder;
  const rising = ladder[ladder.length - 1].value > ladder[0].value;
  const hides = ambushers.map((c) => ({
    id: c.id,
    roll: surpriseCheck(system, 'hide', c.sheet, dice),
  }));
  const hide = hides.reduce((worst, h) =>
    rising
      ? h.roll.total < worst.roll.total
        ? h
        : worst
      : h.roll.total > worst.roll.total
        ? h
        : worst
  );
  const difficulty = { name: 'their hiding', value: hide.roll.total };
  const notice = {};
  const surprised = [];
  for (const c of ambushed) {
    const roll = surpriseCheck(system, 'notice', c.sheet, dice, difficulty);
    // Meeting the hiders' roll is enough: noticing isn't "at a cost".
    const met = rising ? roll.total >= difficulty.value : roll.total <= difficulty.value;
    notice[c.id] = { ...roll, success: met, degree: met ? 'success' : 'failure' };
    if (!met) surprised.push(c.id);
  }
  return { surprised, hide, notice };
}

// Whether a combatant takes a turn this round: in the fight, and not
// surprised in the first round. The player always has their turn, even down
// (L-827: a dying save, or nothing but ending it).
const acts = (fight, id) => {
  const c = fight.combatants[id];
  return Boolean(c) && (!c.out || id === PLAYER) && !(fight.round === 1 && c.surprised);
};

/**
 * Starts a fight (TN1, TN2, SE2): `combatants` [{ id, kind, side, name,
 * sheet }] (the player's id is 'player'); `ambushers` the side that springs
 * it ('party' or 'hostile'), if anyone does. Rolls initiative for everyone
 * and surprise for the ambushed. The first turn is the first in the order
 * who acts in round 1 (with nobody, round 2's first).
 *
 * Returns `{ fight, initiative: { [id]: roll }, surprise }`.
 */
function start(system, { id, mapId, by, combatants, ambushers = null, dice }) {
  const initiative = {};
  const entries = {};
  for (const c of combatants) {
    const roll = rollInitiative(system, c, dice);
    initiative[c.id] = roll;
    entries[c.id] = {
      kind: c.kind,
      side: sideOf(c),
      name: c.name,
      initiative: roll.total,
      tie: roll.tie,
      kept: sheets.apFor(system, c.sheet || {}),
      // With AP off (L-838): reactions by the round, the module's turn rule.
      ...(apRules.isOff(system) ? { reactionsLeft: settingsOf(system).turn.reactions } : {}),
    };
  }
  const sides = (side) => combatants.filter((c) => sideOf(c) === side);
  const caught = ambushers
    ? surprise(system, {
        ambushers: sides(ambushers),
        ambushed: sides(ambushers === 'party' ? 'hostile' : 'party'),
        dice,
      })
    : { surprised: [], hide: null, notice: {} };
  for (const who of caught.surprised) entries[who].surprised = true;
  const order = orderOf(entries);
  let fight = { id, mapId, by, round: 1, order, turn: order[0], combatants: entries };
  if (!acts(fight, fight.turn)) fight = next(fight).fight;
  return { fight, initiative, surprise: caught };
}

/**
 * The next turn (TN1): the next in the order still in the fight; past the
 * last, a new round, surprise over. (Reactions are paid from kept AP, L-833:
 * nothing refreshes by the round; with AP off, L-838, `reactions` is what
 * each has again as a round starts.) Returns `{ fight, newRound }`. A fight
 * nobody can act in stays as it is.
 */
function next(fight, reactions = null) {
  const out = copyOf(fight);
  const live = out.order.filter((id) => !out.combatants[id].out);
  if (!live.length) return { fight: out, newRound: false };
  let at = out.order.indexOf(out.turn);
  let newRound = false;
  for (let i = 0; i < out.order.length * 2 + 1; i++) {
    at += 1;
    if (at >= out.order.length) {
      at = 0;
      out.round += 1;
      newRound = true;
      for (const c of Object.values(out.combatants)) {
        delete c.surprised;
        if (reactions !== null) c.reactionsLeft = reactions;
      }
    }
    if (acts(out, out.order[at])) break;
  }
  out.turn = out.order[at];
  return { fight: out, newRound };
}

/**
 * The turns after the player's, to theirs again (TN1): each other combatant
 * in order. Until foes fight back (L-824), they take their turn and pass.
 * `current`: the turn it is now is someone else's, to be taken too (as when
 * a fight starts). Returns `{ fight, rounds, passed: [ids] }`: how many
 * rounds began.
 */
function toPlayer(system, fight, { current: includeCurrent = false } = {}) {
  let current = fight;
  let rounds = 0;
  const passed = includeCurrent && fight.turn !== PLAYER ? [fight.turn] : [];
  if (includeCurrent && fight.turn === PLAYER) return { fight, rounds, passed };
  const reactions = apRules.isOff(system) ? settingsOf(system).turn.reactions : null;
  for (let i = 0; i < current.order.length * 3; i++) {
    const step = next(current, reactions);
    current = step.fight;
    if (step.newRound) rounds += 1;
    if (current.turn === PLAYER) break;
    passed.push(current.turn);
  }
  return { fight: current, rounds, passed };
}

/** Takes a combatant out of the fight (SE4): `how` one of OUTS. */
function leave(fight, id, how) {
  if (!OUTS.includes(how)) throw new Error(`fight.leave: "${how}" isn't a way out of a fight.`);
  const out = copyOf(fight);
  if (out.combatants[id]) out.combatants[id].out = how;
  return out;
}

/**
 * Whether the fight is over (SE4): `null` while both sides have someone in
 * it; otherwise `{ winner: 'party' | 'hostile' | null, how }`, `how` the
 * ways the losing side left ('fled', 'talkedDown', ...), or the player's
 * own when they are out.
 */
function endOf(fight) {
  const all = Object.values(fight.combatants);
  const standing = (side) => all.filter((c) => c.side === side && !c.out);
  const player = fight.combatants[PLAYER];
  // The player down with allies still standing: the fight goes on (L-827).
  if (player && player.out && !(player.out === 'down' && standing('party').length)) {
    return { winner: 'hostile', how: [player.out] };
  }
  if (!standing('hostile').length) {
    const how = [...new Set(all.filter((c) => c.side === 'hostile').map((c) => c.out))];
    return { winner: 'party', how };
  }
  if (!standing('party').length) return { winner: 'hostile', how: [] };
  return null;
}

module.exports = {
  PLAYER,
  SIDES,
  OUTS,
  rollInitiative,
  orderOf,
  surprise,
  start,
  next,
  toPlayer,
  leave,
  endOf,
};
