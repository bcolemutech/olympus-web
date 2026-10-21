'use strict';

/**
 * Tactics in code (planning/combat.md §3 EN3, EN6, §4.6; L-824 / #656): an
 * unnamed fighter's turn, chosen by the rules from what they can do, by their
 * role and posture. No model decides it (CB0). Allies on the player's side
 * fight by the same rules against the player's foes.
 *
 *   Role (how they fight)
 *     brute       closes in and strikes with their best melee attack
 *     skirmisher  closes, strikes, and steps back out of reach
 *     archer      keeps its distance: steps away from anyone beside it, and
 *                 shoots from where it can see its target in range; closes
 *                 only to get a shot
 *     guard       holds its square: strikes whoever it can reach from there
 *     caster      an area attack first, where it catches foes and no friends;
 *                 otherwise as an archer, or a brute without a ranged attack
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
 * (usable now), speed, noMove?, noAction? }, `foes` and `friends` [{ id,
 * cell, sheet, max }] (standing, not down), `occupied` every square someone
 * stands on (the down too), `map` and its `doors`' states, `health` the
 * system's health resource.
 *
 * Returns `{ path: [cell], attack: { attack, target, area? } | null, back:
 * [cell], fled: bool }`: the squares walked before acting, the attack (the
 * target, and an area's placing), the squares stepped back after it (a
 * skirmisher's), and whether it left the map by an exit.
 */
function planTurn({ me, foes, friends = [], occupied, map, doors = {}, health = 'health' }) {
  const rules = layers.pathOptions(map, doors);
  const free = (cell) => maps.sameCell(cell, me.cell) || !occupied.has(key(cell));
  const budget = me.noMove ? 0 : me.speed;
  const plan = { path: [], attack: null, back: [], fled: false };

  // Walking a path as far as movement goes, stopping where `enough` holds,
  // never ending on someone.
  const walkTo = (to, enough) => {
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
  // far as movement goes; around whoever stands in the way.
  const approach = (target, radius, ok) => {
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
    if (!best) return walkTo(target.cell, ok);
    return gridPaths.walk(best.path, budget, { stand: free }).walked;
  };

  // Fleeing: to the nearest exit.
  if (me.fleeing) {
    const exits = (map.exits || [])
      .map((e) => ({ e, found: gridPaths.pathTo(map, me.cell, e, rules) }))
      .filter((x) => x.found)
      .sort((a, b) => a.found.cost - b.found.cost);
    if (!exits.length || !budget) return plan;
    const { walked } = gridPaths.walk(exits[0].found.path, budget, {
      stand: (step) => free(step) || maps.sameCell(step, exits[0].e),
    });
    plan.path = walked.map((s) => ({ x: s.x, y: s.y }));
    const last = plan.path[plan.path.length - 1];
    plan.fled = Boolean(last && maps.sameCell(last, exits[0].e));
    return plan;
  }

  const target = targetOf(me, foes, { posture: me.posture, health });
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

  // A caster's area: where it catches the most foes and none of its friends.
  if (role === 'caster') {
    const blast = me.attacks.find((a) => a.area);
    let pick = null;
    for (const foe of foes) {
      if (!blast || !canHit(map, doors, blast, me.cell, foe)) continue;
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
      return plan;
    }
    role = ranged.length ? 'archer' : 'brute';
  }

  if (role === 'guard') {
    const attack = me.attacks.find((a) => canHit(map, doors, a, me.cell, target));
    const other = attack
      ? null
      : foes.find((f) => me.attacks.some((a) => canHit(map, doors, a, me.cell, f)));
    if (attack) plan.attack = { attack, target };
    else if (other) {
      plan.attack = {
        attack: me.attacks.find((a) => canHit(map, doors, a, me.cell, other)),
        target: other,
      };
    }
    return plan;
  }

  if (role === 'archer') {
    const bow = best(ranged);
    // Beside a foe, it steps away first (the reckless stand their ground).
    const beside = foes.some((f) => distance(me.cell, f.cell) <= 1);
    if (beside && me.posture !== 'reckless' && budget) {
      const spots = gridPaths
        .reach(map, me.cell, budget, rules)
        .filter((s) => free(s) && !maps.at(map, s).exit)
        .filter((s) => foes.every((f) => distance(s, f.cell) > 1))
        .filter((s) => canHit(map, doors, bow, s, target));
      if (spots.length) {
        const to = spots[0];
        const found = gridPaths.pathTo(map, me.cell, to, rules);
        if (found) plan.path = gridPaths.walk(found.path, budget, { stand: free }).walked;
      }
    }
    if (!canHit(map, doors, bow, at(plan.path), target) && !plan.path.length) {
      plan.path = approach(
        target,
        Math.min(bow.range.normal, Math.max(map.width, map.height)),
        (cell) => sees(map, doors, cell, target.cell)
      );
    }
    plan.path = plan.path.map((s) => ({ x: s.x, y: s.y }));
    if (canHit(map, doors, bow, at(plan.path), target)) plan.attack = { attack: bow, target };
    else {
      const blade = best(melee);
      if (blade && canHit(map, doors, blade, at(plan.path), target)) {
        plan.attack = { attack: blade, target };
      }
    }
    return plan;
  }

  // A brute or a skirmisher: close in and strike.
  const blade = best(melee) || best(ranged);
  const walked = canHit(map, doors, blade, me.cell, target)
    ? []
    : blade.range
      ? approach(target, blade.range.normal, (cell) => sees(map, doors, cell, target.cell))
      : approach(target, blade.reach || 1, () => true);
  const spent = walked.length ? walked[walked.length - 1].cost : 0;
  plan.path = walked.map((s) => ({ x: s.x, y: s.y }));
  if (canHit(map, doors, blade, at(plan.path), target)) {
    plan.attack = { attack: blade, target };
    // A skirmisher steps back out of reach with what movement is left.
    if (role === 'skirmisher') {
      const left = budget - spent;
      const from = at(plan.path);
      if (left > 0) {
        const spot = gridPaths
          .reach(map, from, left, rules)
          .filter(
            (s) => free(s) && !maps.at(map, s).exit && foes.every((f) => distance(s, f.cell) > 1)
          )[0];
        if (spot) {
          const found = gridPaths.pathTo(map, from, spot, rules);
          if (found) {
            plan.back = gridPaths
              .walk(found.path, left, { stand: free })
              .walked.map((s) => ({ x: s.x, y: s.y }));
          }
        }
      }
    }
  }
  return plan;
}

module.exports = { planTurn, targetOf, canHit, facingTo };
