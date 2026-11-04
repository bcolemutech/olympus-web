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
 * player's (../../loom-canon/map-paths.js; L-922), at the fighter's width, in
 * feet: through people but never ending on one, and never through a closed
 * door (figures don't open them). Distances are in feet: reach and range
 * edge to edge (position.js bandOf), the nearest foe by where each stands,
 * beside within 5 ft.
 *
 * Pure: planTurn says what the turn does; the caller carries it out.
 */

const mapPaths = require('../../loom-canon/map-paths');
const sight = require('../../loom-canon/sight');
const areas = require('../../loom-canon/areas');
const maps = require('../../loom-canon/maps');
const apRules = require('../../loom-canon/ap');

const key = (cell) => cell.x + ',' + cell.y;
const sees = (map, doors, from, to) => Boolean(sight.inSight(map, from, doors)[key(to)]);
// A person's square: a fighter's `cell`, or a square given as it is.
const cellOf = (v) => (v && v.cell ? v.cell : v);
// How far apart two people are, centre to centre, in feet (L-922).
const feet = (a, b) => mapPaths.feetBetween(a, b);
const BESIDE = mapPaths.FEET; // within 5 ft, edge to edge

// The eight ways out, by the direction to another square (as attack-turn's).
function facingTo(from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
  const ew = dx < 0 ? 'west' : dx > 0 ? 'east' : '';
  return ns + ew || 'north';
}

/**
 * Whether an attack reaches a target from where someone stands (a fighter's
 * spot, or a square): reach, or range and sight. In feet (L-922).
 */
function canHit(map, doors, attack, from, target) {
  const band = mapPaths.bandOf(attack, from, target);
  if (attack.range) return Boolean(band) && sees(map, doors, cellOf(from), cellOf(target));
  return Boolean(band);
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
  const nearest = (list) => list.slice().sort((a, b) => feet(me, a) - feet(me, b))[0];
  if (posture === 'reckless') return foes.find((f) => f.id === 'player') || nearest(foes);
  if (posture === 'cowardly' || posture === 'cautious') {
    return foes
      .slice()
      .sort(
        (a, b) => healthLeft(a, health) - healthLeft(b, health) || feet(me, a) - feet(me, b)
      )[0];
  }
  return nearest(foes);
}

/**
 * A fighter's turn: `me` { id, cell, point?, width?, side, role, posture, fleeing?, attacks
 * (usable now), ap? (their pool this turn, L-836), attackAp? ({ [attack id]:
 * its AP cost }), prices? (what a step costs them: move, difficult, door;
 * ../../loom-canon/ap.js pricesOf), speed (squares a turn, with AP off),
 * noMove?, noAction?, focus? (the foe to go for, L-825) }, `foes` and
 * `friends` [{ id, cell, point?, width?, sheet, max }] (standing, not down), `occupied` every
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
 * Returns `{ path: [station], attack: { attack, target, area? } | null,
 * repeat (strikes after the first, at the same target while it stands),
 * back: [station], ready (an attack readied, its AP set aside) | null, fled:
 * bool, spent (the AP the plan costs; 0 with AP off) }`: the walk before
 * acting, as the stations it passes ({ x, y, square, weight }, in feet;
 * map-paths.js walk), the attack (the target, and an area's placing), the
 * walk back after it (a skirmisher's), and whether it left the map by an
 * exit.
 */
function planTurn({ me, foes, friends = [], occupied, map, doors = {}, health = 'health' }) {
  const onAp = Number.isFinite(me.ap);
  const pool = onAp ? Math.max(0, Math.floor(me.ap)) : 0;
  const free = (cell) => maps.sameCell(cell, me.cell) || !occupied.has(key(cell));
  const width = me.width > 0 ? me.width : mapPaths.widthOf();
  const meSpot = { cell: me.cell, point: mapPaths.spotOf(me).point, width };
  // Where the fighter would be at a station of a walk, or at a square's spot.
  const here = (st) => ({ cell: st.square, point: { x: st.x, y: st.y }, width });
  // What an attack costs (nothing with AP off: one a turn).
  const costOf = (attack) => {
    if (!onAp || !attack) return 0;
    const own = me.attackAp && me.attackAp[attack.id];
    return Number.isFinite(own) ? own : attack.ap || apRules.COSTS.attack;
  };
  const affords = (attack, left) => !onAp || costOf(attack) <= left;
  // The AP a walk may cost, keeping `reserve` back (with AP off, their
  // speed: squares of 5 ft at a move's price, 1).
  const budgetOf = (reserve = 0) => {
    if (me.noMove) return 0;
    return onAp ? Math.max(0, pool - reserve) : me.speed;
  };
  const plan = { path: [], attack: null, repeat: 0, back: [], ready: null, fled: false, spent: 0 };
  const costTo = (walked) => (walked.length ? mapPaths.apFor(walked[walked.length - 1].weight) : 0);
  const done = (spent) => {
    plan.spent = onAp ? spent : 0;
    return plan;
  };

  // The map as this fighter moves on it (L-922): at its width and prices; a
  // closed door bars the way (figures don't open doors); an exit is never on
  // the way, but the one at `goal` (all of them, `goal` true: fleeing).
  const shut = {};
  for (const door of (mapPaths.geometryOf(map).doors || []).concat(map.doors || [])) {
    shut[door.id] = doors[door.id] === 'open' ? 'open' : 'locked';
  }
  const exitAt = (sq) => (map.exits || []).some((e) => maps.sameCell(e, sq));
  const plannerFor = (goal) =>
    mapPaths.planner(map, {
      width,
      states: shut,
      prices: onAp ? me.prices : undefined,
      ...(goal === true
        ? {}
        : { blocked: (sq) => exitAt(sq) && !(goal && maps.sameCell(goal, sq)) }),
    });
  // The cheapest way to each square within `budget` (a weight in AP; with
  // AP off, squares), for choosing where to go this turn.
  const costsWithin = (from, budget) => mapPaths.costsFrom(ways, from, budget + 1e-6);
  const ways = plannerFor(null);

  // Walking from `from` (a spot) to a square as far as `budget` goes,
  // stopping where `enough` holds, never ending on someone.
  // The ways found, kept: a turn may try the same one with two budgets.
  const found = new Map();
  const wayTo = (planner, from, to) => {
    const k = [from.x, from.y, to.x, to.y].join(',');
    if (planner !== ways) return mapPaths.pathTo(planner, from, to);
    if (!found.has(k)) found.set(k, mapPaths.pathTo(planner, from, to));
    return found.get(k);
  };
  const walkFrom = (from, toCell, budget, enough, planner = ways) => {
    if (!budget) return [];
    const spot = mapPaths.spotIn(planner, toCell);
    const way = spot && wayTo(planner, from.point, spot);
    if (!way) return [];
    return mapPaths.walk(planner, way, budget, {
      stop: (st) => Boolean(enough && enough(here(st)) && free(st.square)),
      stand: (st) => free(st.square),
    }).walked;
  };
  const walkTo = (toCell, budget, enough) => walkFrom(meSpot, toCell, budget, enough);

  // Closing on a target: the cheapest way to a free square from which `ok`
  // holds (in reach, or in range and sight), within `radius` squares of it,
  // that `budget` reaches; else as far towards it as `budget` goes. Around
  // whoever stands in the way.
  const approach = (target, radius, ok, budget) => {
    if (!budget) return [];
    const costs = costsWithin(meSpot.point, budget);
    let best = null;
    for (let y = target.cell.y - radius; y <= target.cell.y + radius; y++) {
      for (let x = target.cell.x - radius; x <= target.cell.x + radius; x++) {
        const cell = { x, y };
        if (!maps.inBounds(map, cell) || !free(cell) || exitAt(cell)) continue;
        const c = costs(cell);
        if (!c || !ok({ cell, point: c.spot, width })) continue;
        if (!best || c.weight < best.weight - 1e-9) best = { cell, ...c };
      }
    }
    if (!best) return walkTo(target.cell, budget, ok);
    if (!best.weight) return [];
    const way = wayTo(ways, meSpot.point, best.spot);
    return way ? mapPaths.walk(ways, way, budget, { stand: (st) => free(st.square) }).walked : [];
  };

  // Stepping from `from` (a spot) to a square out of every foe's reach (more
  // than 5 ft from them), as far as `budget` goes, where `ok` holds.
  const stepAway = (from, budget, ok = () => true) => {
    if (!budget) return [];
    const costs = costsWithin(from.point, budget);
    const r = Math.ceil(budget) + 1;
    const c0 = from.cell;
    let best = null;
    for (let y = c0.y - r; y <= c0.y + r; y++) {
      for (let x = c0.x - r; x <= c0.x + r; x++) {
        const cell = { x, y };
        if (!maps.inBounds(map, cell) || !free(cell) || exitAt(cell)) continue;
        const c = costs(cell);
        if (!c || mapPaths.apFor(c.weight) > budget) continue;
        const spot = { cell, point: c.spot, width };
        if (!foes.every((f) => mapPaths.gapBetween(spot, f) > BESIDE)) continue;
        if (!ok(spot)) continue;
        if (!best || c.weight < best.weight - 1e-9) best = { cell, ...c };
      }
    }
    if (!best || !best.weight) return [];
    const way = wayTo(ways, from.point, best.spot);
    return way ? mapPaths.walk(ways, way, budget, { stand: (st) => free(st.square) }).walked : [];
  };

  // Fleeing: to the nearest exit, with all they have.
  if (me.fleeing) {
    const budget = budgetOf();
    const out = plannerFor(true);
    const costs = mapPaths.costsFrom(out, meSpot.point);
    const exits = (map.exits || [])
      .map((e) => ({ e, c: costs({ x: e.x, y: e.y }) }))
      .filter((x) => x.c)
      .sort((a, b) => a.c.weight - b.c.weight);
    if (!exits.length || !budget) return plan;
    const exit = exits[0].e;
    const found = mapPaths.pathTo(out, meSpot.point, exits[0].c.spot);
    if (!found) return plan;
    const { walked } = mapPaths.walk(out, found, budget, {
      stand: (st) => free(st.square) || maps.sameCell(st.square, exit),
      arriveIn: { x: exit.x, y: exit.y },
    });
    plan.path = walked;
    const last = walked[walked.length - 1];
    plan.fled = Boolean(last && maps.sameCell(last.square, exit));
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
  // Where the fighter stands after a walk: its last station, or where it is.
  const at = (path) => (path.length ? here(path[path.length - 1]) : meSpot);
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
      if (!blast || !affords(blast, pool) || !canHit(map, doors, blast, meSpot, foe)) continue;
      const placed =
        blast.area.shape === 'cone' || blast.area.shape === 'line'
          ? { ...blast.area, x: me.cell.x, y: me.cell.y, facing: facingTo(me.cell, foe.cell) }
          : { ...blast.area, x: foe.cell.x, y: foe.cell.y };
      // Who it catches, by where they stand (L-922).
      const caught = areas.catches(map, placed, foes, { states: doors }).length;
      const harm =
        areas.catches(map, placed, friends.concat([{ ...me, ...meSpot }]), {
          states: doors,
          includeSource: true,
        }).length > 0;
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
    const can = (a, f) => affords(a, pool) && canHit(map, doors, a, meSpot, f);
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
    const beside = foes.some((f) => mapPaths.gapBetween(meSpot, f) <= BESIDE);
    if (beside && me.posture !== 'reckless') {
      walked = stepAway(meSpot, budgetOf(shot), (s) => canHit(map, doors, bow, s, target));
    }
    if (!canHit(map, doors, bow, at(walked), target) && !walked.length) {
      walked = approach(
        target,
        Math.min(bow.range.normal, Math.max(map.width, map.height)),
        // In range (in feet, L-922) and sight.
        (spot) => canHit(map, doors, bow, spot, target),
        budgetOf(shot)
      );
    }
    let left = pool - costTo(walked);
    plan.path = walked;
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
  const reaches = (spot) => canHit(map, doors, blade, spot, target);
  const closeIn = (budget) =>
    blade.range
      ? approach(
          target,
          blade.range.normal,
          (spot) => reaches(spot) && sees(map, doors, spot.cell, target.cell),
          budget
        )
      : approach(
          target,
          (blade.reach || 1) + Math.ceil(((target.width || 0) - 2.5) / 5),
          reaches,
          budget
        );
  let walked = [];
  if (!reaches(meSpot)) {
    // Closing in keeping AP for a blow; too far for that, as far as they can.
    walked = closeIn(budgetOf(blow));
    if (!reaches(at(walked)) || !affords(blade, pool - costTo(walked))) {
      walked = closeIn(budgetOf());
    }
  }
  plan.path = walked;
  let left = onAp ? pool - costTo(walked) : 0;
  if (reaches(at(plan.path)) && affords(blade, onAp ? left : 0)) {
    plan.attack = { attack: blade, target };
    left -= blow;
    if (role === 'skirmisher') {
      // It steps back out of reach with what's left (its movement, with AP
      // off).
      const back = stepAway(at(plan.path), onAp ? left : me.noMove ? 0 : me.speed - costTo(walked));
      plan.back = back;
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
