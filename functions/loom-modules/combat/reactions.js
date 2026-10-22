'use strict';

/**
 * Reactions (planning/combat.md §3 TN4, PS4, §4.3; L-823 / #655): what
 * fighters do out of turn while someone else moves, by the rules alone
 * (CB0). Each takes one of the fighter's reactions this round (the system's
 * `economy.reactions`, refreshed each round: ./fight.js).
 *
 *   Leaving reach (PS4)  someone who steps from within a foe's melee reach
 *                  to outside it is struck by that foe first, where they
 *                  stand, with its best melee attack; unless they withdrew
 *                  (the Withdraw action), and anyone may do this
 *   Ready (TN4)    the player's readied attack (the Ready action: an attack,
 *                  and perhaps whom) goes off at the first foe who comes into
 *                  its reach, or its range in sight, before their next turn
 *                  (decided 2026-10-22), on the square they step onto
 *   Defending      a trait's reaction (./position.js defendOf), in ./strike.js
 *
 * A mover struck down stops where they were struck.
 *
 * Pure: the dice come from the caller; the fight is copied.
 */

const conditions = require('../../loom-canon/conditions');
const { attacksOf } = require('./attacks');
const { strike, spendAmmo } = require('./strike');
const position = require('./position');

const PLAYER = 'player';
const copyOf = (v) => JSON.parse(JSON.stringify(v));
const { distance } = position;

/** Whether two sides are against each other: the hostile against everyone else. */
function opposed(a, b) {
  return (a === 'hostile') !== (b === 'hostile');
}

/** A fighter's best melee attack: the first that isn't unarmed, else unarmed. */
function meleeOf(system, sheet, player) {
  const melee = attacksOf(system, sheet, { player }).filter((a) => !a.range && !a.area);
  return melee.find((a) => a.id !== 'unarmed') || melee[0] || null;
}

// Whether a fighter can react now: in the fight, standing, a reaction left,
// not caught off guard in the first round, and free to act.
function canReact(system, f, fighter) {
  const c = f.combatants[fighter.id];
  if (!c || c.out || !(c.reactionsLeft > 0)) return false;
  if (f.round === 1 && c.surprised) return false;
  return !conditions.flagsOf(system, fighter.sheet).noAction.length;
}

/**
 * Reactions to someone walking `path` (squares, in order) from `from`, in
 * fight `f`. `mover` { id, side, name, sheet, you? }; `fighters` everyone
 * else standing on the map in the fight, [{ id, side, name, cell, sheet }];
 * `withdrawn` the mover took the Withdraw action. `map`, `doors` for sight
 * and cover; `now` the time, for effects.
 *
 * Returns `{ fight, sheet (the mover's), down (null, 'dead' or 'out'),
 * reached (how many squares of the path they walked), lines, struck:
 * [{ by, attack, hit, damage? }], sheets: { [id]: sheet } (the reactors'
 * sheets that changed: ammunition) }`.
 */
function reactToWalk(
  system,
  { map, doors, fight: f0, mover, from, path, fighters, withdrawn = false, now = 0, dice }
) {
  let f = copyOf(f0);
  let sheet = mover.sheet;
  let down = null;
  const lines = [];
  const struck = [];
  const sheets = {};
  const mine = f.combatants[mover.id] || {};
  const name = mover.you ? 'You' : mover.name;
  const watchers = fighters.filter((w) => w.id !== mover.id && opposed(w.side, mover.side));

  // One reactor's attack at the mover standing on `at`.
  const fire = (w, attack, at, line) => {
    const c = f.combatants[w.id];
    const own = sheets[w.id] || w.sheet;
    const spent = spendAmmo(system, own, attack);
    if (spent.refused) return false;
    if (spent.sheet !== own) sheets[w.id] = spent.sheet;
    c.reactionsLeft -= 1;
    const friends = fighters
      .filter((x) => x.id !== w.id && !opposed(x.side, w.side) && x.cell)
      .map((x) => x.cell);
    const terms = position.termsFor(system, {
      map,
      doors,
      attack,
      from: w.cell,
      to: at,
      friends,
      dodging: Boolean(mine.dodging),
    });
    const defend =
      (f.combatants[mover.id] || {}).reactionsLeft > 0
        ? position.defendOf(system, sheet, attack)
        : null;
    const result = strike(system, {
      attacker: { name: w.id === PLAYER ? 'You' : w.name, sheet: spent.sheet },
      attack,
      bonus: terms.bonus,
      targets: [
        {
          id: mover.id,
          name: mover.you ? 'you' : mover.name,
          sheet,
          guard: terms.guard,
          ...(defend ? { reaction: defend } : {}),
        },
      ],
      now,
      dice,
    });
    const r = result.results[0];
    if (r.reacted && f.combatants[mover.id]) f.combatants[mover.id].reactionsLeft -= 1;
    lines.push(line, ...r.lines);
    struck.push({
      by: w.id,
      attack: attack.id,
      hit: r.hit,
      ...(r.damage ? { damage: r.damage.total } : {}),
      roll: result.roll.total,
    });
    sheet = r.sheet;
    if (r.down) down = r.down;
    return true;
  };

  let prev = from;
  let reached = 0;
  for (let k = 0; k < path.length && !down; k++) {
    const cur = path[k];
    // Leaving someone's reach (PS4): struck where they stand, before the step.
    if (!withdrawn) {
      for (const w of watchers) {
        if (down || !canReact(system, f, w)) continue;
        const attack = meleeOf(system, w.sheet, w.id === PLAYER);
        if (!attack) continue;
        const reach = attack.reach || 1;
        if (distance(prev, w.cell) > reach || distance(cur, w.cell) <= reach) continue;
        const whose = w.id === PLAYER ? 'your' : w.name + "'s";
        fire(w, attack, prev, `${name} ${mover.you ? 'leave' : 'leaves'} ${whose} reach.`);
      }
      if (down) break;
    }
    reached = k + 1;
    // A readied attack: the first foe to come into its reach or range.
    for (const w of watchers) {
      const c = f.combatants[w.id];
      if (down || !c || !c.readied || !canReact(system, f, w)) continue;
      if (c.readied.target && c.readied.target !== mover.id) continue;
      const attack =
        attacksOf(system, w.sheet, { player: w.id === PLAYER }).find(
          (a) => a.id === c.readied.attack
        ) || null;
      if (!attack) continue;
      const was = position.bandOf(attack, w.cell, prev);
      const now2 = position.bandOf(attack, w.cell, cur);
      const seen = !attack.range || position.sees(map, doors, w.cell, cur);
      if (!now2 || !seen || (was && (!attack.range || position.sees(map, doors, w.cell, prev)))) {
        continue;
      }
      delete c.readied;
      const whose = w.id === PLAYER ? 'your' : w.name + "'s";
      fire(
        w,
        attack,
        cur,
        `${name} ${mover.you ? 'come' : 'comes'} into ${whose} readied ${attack.name.toLowerCase()}.`
      );
    }
    prev = cur;
  }
  return { fight: f, sheet, down, reached, lines, struck, sheets };
}

module.exports = { reactToWalk, opposed, meleeOf, canReact };
