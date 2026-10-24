'use strict';

/**
 * Tactics in code (planning/combat.md §3 EN3, EN6, §4.6; L-824 / #656): an
 * unnamed fighter's turn, chosen by the rules from what they can do, by their
 * role and posture. No model decides it (CB0). Allies on the player's side
 * fight by the same rules against the player's foes.
 *
 *   Role (how they fight; on AP, within their pool, L-836)
 *     brute       closes in and strikes with their best melee attack, again
 *                 while the AP lasts
 *     skirmisher  closes, strikes, and steps back out of reach with what's
 *                 left
 *     archer      keeps its distance: steps away from anyone beside it, and
 *                 shoots from where it can see its target in range; closes
 *                 only to get a shot; readies a shot with what's left
 *     guard       holds its square: strikes once at whoever it can reach
 *                 from there, keeping the rest to react
 *     caster      an area attack first, where it catches foes and no friends
 *                 and it can pay for it; otherwise as an archer, or a brute
 *                 without a ranged attack
 *     leader      fights as an archer with a ranged attack, else a brute; its
 *                 fall shakes the rest (morale, ./others.js)
 *   Posture (how much risk it takes)
 *     cowardly, cautious  goes for the weakest foe (the least health left)
 *     steady, bold        goes for the nearest
 *     reckless            goes for the player first
 *   and, by posture, when it breaks (./others.js).
 *
 * A fighter fleeing heads for the nearest way off the map. Paths are the
 * player's (grid-paths.js, the map's layers): through people but never ending
 * on one.
 *
 * Pure: planTurn says what the turn does; the caller carries it out.
 */

const gridPaths = require('../../loom-canon/grid-paths');
const layers = require('../../loom-canon/layers');
const sight = require('../../loom-canon/sight');
const areas = require('../../loom-canon/areas');
const maps = require('../../loom-canon/maps');
const apRules = require('../../loom-canon/ap');

const key = (cell) => cell.x + ',' + cell.y;
const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const sees = (map, doors, from, to) => Boolean(sight.inSight(map, from, doors)[key(to)]);

// The eight ways out, by the direction to another square (as attack-turn's).
function facingTo(from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
  const ew = dx < 0 ? 'west' : dx > 0 ? 'east' : '';
  return ns + ew || 'north';
}

/** Whether an attack reaches a target from a square: reach, or range and sight. */
function canHit(map, doors, attack, from, target) {
  const away = distance(from, target.cell);
  if (attack.range) return away <= attack.range.long && sees(map, doors, from, target.cell);
  return away <= (attack.reach || 1);
}

// The share of health a fighter has left (1 with no health).
function healthLeft(fighter, health) {
  const held = fighter.sheet && fighter.sheet.resources && fighter.sheet.resources[health];
  const max = fighter.max || 0;
  if (!held || !Number.isFinite(held.current) || !max) return 1;
  return held.current / max;
}

/** The foe a fighter goes for, by posture. */
function targetOf(me, foes, { posture, health }) {
  if (!foes.length) return null;
  const nearest = (list) =>
    list.slice().sort((a, b) => distance(me.cell, a.cell) - distance(me.cell, b.cell))[0];
  if (posture === 'reckless') return foes.find((f) => f.id === 'player') || nearest(foes);
  if (posture === 'cowardly' || posture === 'cautious') {
    return foes
      .slice()
      .sort(
        (a, b) =>
          healthLeft(a, health) - healthLeft(b, health) ||
          distance(me.cell, a.cell) - distance(me.cell, b.cell)
      )[0];
  }
  return nearest(foes);
}

/**
 * A fighter's turn: `me` { id, cell, side, role, posture, fleeing?, attacks
 * (usable now), ap? (their pool this turn, L-836), attackAp? ({ [attack id]:
 * its AP cost }), prices? (what a step costs them: move, difficult, door;
 * ../../loom-canon/ap.js pricesOf), speed (squares a turn, with AP off),
 * noMove?, noAction?, focus? (the foe to go for, L-825) }, `foes` and
 * `friends` [{ id, cell, sheet, max }] (standing, not down), `occupied` every
 * square someone stands on (the down too), `map` and its `doors`' states,
 * `health` the system's health resource.
 *
 * On AP (L-836; action points FP2), the turn fits the pool: a brute closes
 * and strikes, again while the AP lasts; a skirmisher strikes, then steps
 * back with what's left; a guard strikes once from its square and keeps the
 * rest to react; an archer shoots, then readies a shot with what's left (or
 * readies one when nobody is in its range yet); a caster throws its area
 * only when it can pay for it. What's left is kept for reactions (L-833).
 * With AP off (no `ap`, L-838) a turn is a walk of `speed` squares and one
 * attack, as before AP.
 *
 * Returns `{ path: [cell], attack: { attack, target, area? } | null, repeat
 * (strikes after the first, at the same target while it stands), back:
 * [cell], ready (an attack readied, its AP set aside) | null, fled: bool,
 * spent (the AP the plan costs; 0 with AP off) }`: the squares walked before
 * acting, the attack (the target, and an area's placing), the squares
 * stepped back after it (a skirmisher's), and whether it left the map by an
 * exit.
 */
function planTurn({ me, foes, friends = [], occupied, map, doors = {}, health = 'health' }) {
  const onAp = Number.isFinite(me.ap);
  const pool = onAp ? Math.max(0, Math.floor(me.ap)) : 0;
  const rules = layers.pathOptions(map, doors, onAp ? me.prices : undefined);
  const free = (cell) => maps.sameCell(cell, me.cell) || !occupied.has(key(cell));
  // What an attack costs (nothing with AP off: one a turn).
  const costOf = (attack) => {
    if (!onAp || !attack) return 0;
    const own = me.attackAp && me.attackAp[attack.id];
    return Number.isFinite(own) ? own : attack.ap || apRules.COSTS.attack;
  };
  const affords = (attack, left) => !onAp || costOf(attack) <= left;
  // The squares a walk may cost, keeping `reserve` AP back (with AP off,
  // their speed).
  const budgetOf = (reserve = 0) => {
    if (me.noMove) return 0;
    return onAp ? Math.max(0, pool - reserve) : me.speed;
  };
  const plan = { path: [], attack: null, repeat: 0, back: [], ready: null, fled: false, spent: 0 };
  const costTo = (walked) => (walked.length ? walked[walked.length - 1].cost : 0);
  const cells = (walked) => walked.map((s) => ({ x: s.x, y: s.y }));
  const done = (spent) => {
    plan.spent = onAp ? spent : 0;
    return plan;
  };

  // Walking a path as far as `budget` goes, stopping where `enough` holds,
  // never ending on someone.
  const walkTo = (to, budget, enough) => {
    if (!budget) return [];
    const found = gridPaths.pathTo(map, me.cell, to, rules);
    if (!found) return [];
    return gridPaths.walk(found.path, budget, {
      stop: (step) => Boolean(enough && enough(step) && free(step)),
      stand: free,
    }).walked;
  };

  // Closing on a target: the cheapest way to a free square from which `ok`
  // holds (in reach, or in range and sight), within `radius` of it, walked as
  // far as `budget` goes; around whoever stands in the way.
  const approach = (target, radius, ok, budget) => {
    if (!budget) return [];
    let best = null;
    for (let y = target.cell.y - radius; y <= target.cell.y + radius; y++) {
      for (let x = target.cell.x - radius; x <= target.cell.x + radius; x++) {
        const cell = { x, y };
        if (!maps.inBounds(map, cell) || !free(cell) || maps.at(map, cell).exit) continue;
        if (!ok(cell)) continue;
        const found = maps.sameCell(cell, me.cell)
          ? { path: [], cost: 0 }
          : gridPaths.pathTo(map, me.cell, cell, rules);
        if (found && (!best || found.cost < best.cost)) best = found;
      }
    }
    if (!best) return walkTo(target.cell, budget, ok);
    return gridPaths.walk(best.path, budget, { stand: free }).walked;
  };

  // Stepping from `from` to a square out of every foe's reach, as far as
  // `budget` goes, where `ok` holds.
  const stepAway = (from, budget, ok = () => true) => {
    if (!budget) return [];
    const spot = gridPaths
      .reach(map, from, budget, rules)
      .filter(
        (s) =>
          free(s) && !maps.at(map, s).exit && foes.every((f) => distance(s, f.cell) > 1) && ok(s)
      )[0];
    if (!spot) return [];
    const found = gridPaths.pathTo(map, from, spot, rules);
    return found ? gridPaths.walk(found.path, budget, { stand: free }).walked : [];
  };

  // Fleeing: to the nearest exit, with all they have.
  if (me.fleeing) {
    const budget = budgetOf();
    const exits = (map.exits || [])
      .map((e) => ({ e, found: gridPaths.pathTo(map, me.cell, e, rules) }))
      .filter((x) => x.found)
      .sort((a, b) => a.found.cost - b.found.cost);
    if (!exits.length || !budget) return plan;
    const { walked } = gridPaths.walk(exits[0].found.path, budget, {
      stand: (step) => free(step) || maps.sameCell(step, exits[0].e),
    });
    plan.path = cells(walked);
    const last = plan.path[plan.path.length - 1];
    plan.fled = Boolean(last && maps.sameCell(last, exits[0].e));
    return done(costTo(walked));
  }

  // A foe chosen for them (L-825: a named character's menu), else by posture.
  const target =
    (me.focus && foes.find((f) => f.id === me.focus)) ||
    targetOf(me, foes, { posture: me.posture, health });
  if (!target || me.noAction) return plan;
  // Only a caster throws an area, where it hits no friend; the rest use
  // their single attacks.
  const melee = me.attacks.filter((a) => !a.range && !a.area);
  const ranged = me.attacks.filter((a) => a.range && !a.area);
  const best = (list) => list.find((a) => a.id !== 'unarmed') || list[0] || null;
  const at = (path) => (path.length ? path[path.length - 1] : me.cell);
  let role = me.role;
  if ((role === 'archer' || role === 'leader' || role === 'caster') && !ranged.length) {
    role = role === 'caster' && me.attacks.some((a) => a.area) ? 'caster' : 'brute';
  }
  if (role === 'leader') role = 'archer';

  // A caster's area: where it catches the most foes and none of its friends,
  // if it can pay for it.
  if (role === 'caster') {
    const blast = me.attacks.find((a) => a.area);
    let pick = null;
    for (const foe of foes) {
      if (!blast || !affords(blast, pool) || !canHit(map, doors, blast, me.cell, foe)) continue;
      const placed =
        blast.area.shape === 'cone' || blast.area.shape === 'line'
          ? { ...blast.area, x: me.cell.x, y: me.cell.y, facing: facingTo(me.cell, foe.cell) }
          : { ...blast.area, x: foe.cell.x, y: foe.cell.y };
      const squares = areas.squaresOf(map, placed, { states: doors });
      const caught = foes.filter((f) => squares[key(f.cell)]).length;
      const harm = friends.concat([me]).some((f) => squares[key(f.cell)]);
      if (!harm && caught && (!pick || caught > pick.caught)) pick = { foe, caught };
    }
    if (pick) {
      plan.attack = { attack: blast, target: pick.foe };
      return done(costOf(blast));
    }
    role = ranged.length ? 'archer' : 'brute';
  }

  // A guard: one strike at whoever it can reach from its square; the rest
  // kept to react.
  if (role === 'guard') {
    const can = (a, f) => affords(a, pool) && canHit(map, doors, a, me.cell, f);
    const attack = me.attacks.find((a) => !a.area && can(a, target));
    const other = attack ? null : foes.find((f) => me.attacks.some((a) => !a.area && can(a, f)));
    if (attack) plan.attack = { attack, target };
    else if (other) {
      plan.attack = { attack: me.attacks.find((a) => !a.area && can(a, other)), target: other };
    }
    return done(plan.attack ? costOf(plan.attack.attack) : 0);
  }

  if (role === 'archer') {
    const bow = best(ranged);
    const shot = costOf(bow);
    let walked = [];
    // Beside a foe, it steps away first (the reckless stand their ground),
    // keeping AP for the shot.
    const beside = foes.some((f) => distance(me.cell, f.cell) <= 1);
    if (beside && me.posture !== 'reckless') {
      walked = stepAway(me.cell, budgetOf(shot), (s) => canHit(map, doors, bow, s, target));
    }
    if (!canHit(map, doors, bow, at(walked), target) && !walked.length) {
      walked = approach(
        target,
        Math.min(bow.range.normal, Math.max(map.width, map.height)),
        (cell) => sees(map, doors, cell, target.cell),
        budgetOf(shot)
      );
    }
    let left = pool - costTo(walked);
    plan.path = cells(walked);
    if (affords(bow, left) && canHit(map, doors, bow, at(plan.path), target)) {
      plan.attack = { attack: bow, target };
      left -= shot;
    } else {
      const blade = best(melee);
      if (blade && affords(blade, left) && canHit(map, doors, blade, at(plan.path), target)) {
        plan.attack = { attack: blade, target };
        left -= costOf(blade);
      }
    }
    // What's left readies a shot, for whoever comes into its range next.
    if (onAp && left >= shot) {
      plan.ready = bow;
      left -= shot;
    }
    return done(pool - left);
  }

  // A brute or a skirmisher: close in and strike.
  const blade = best(melee) || best(ranged);
  const blow = costOf(blade);
  const reaches = (cell) => canHit(map, doors, blade, cell, target);
  const closeIn = (budget) =>
    blade.range
      ? approach(target, blade.range.normal, (cell) => sees(map, doors, cell, target.cell), budget)
      : approach(target, blade.reach || 1, () => true, budget);
  let walked = [];
  if (!reaches(me.cell)) {
    // Closing in keeping AP for a blow; too far for that, as far as they can.
    walked = closeIn(budgetOf(blow));
    if (!reaches(at(walked)) || !affords(blade, pool - costTo(walked))) {
      walked = closeIn(budgetOf());
    }
  }
  plan.path = cells(walked);
  let left = onAp ? pool - costTo(walked) : 0;
  if (reaches(at(plan.path)) && affords(blade, onAp ? left : 0)) {
    plan.attack = { attack: blade, target };
    left -= blow;
    if (role === 'skirmisher') {
      // It steps back out of reach with what's left (its movement, with AP
      // off).
      const back = stepAway(at(plan.path), onAp ? left : me.noMove ? 0 : me.speed - costTo(walked));
      plan.back = cells(back);
      left -= onAp ? costTo(back) : 0;
    } else if (onAp && blow > 0) {
      // A brute strikes again while its AP lasts.
      plan.repeat = Math.floor(left / blow);
      left -= plan.repeat * blow;
    }
  }
  return done(pool - left);
}

module.exports = { planTurn, targetOf, canHit, facingTo };
