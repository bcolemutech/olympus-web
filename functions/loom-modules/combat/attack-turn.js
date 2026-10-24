'use strict';

/**
 * The player's attack as a turn (planning/combat.md §4.4, §4.8; L-822 / #654),
 * for ADJUDICATE: which attack, at whom, whether they're in reach or range,
 * the roll and what it does (./strike.js), written to the save. An attack
 * out of a fight starts one (L-821; the player's blow opens it); a foe who
 * falls leaves it, and the fight ends when the last does.
 *
 * Reach and range (PS1): a melee attack reaches someone within its reach in
 * squares (1: beside), a ranged one someone in sight within its long range.
 * Where the two stand adds to the roll (L-823; ./position.js): long range
 * and flanking to the attack, cover and Dodge to the defence; a target with
 * a defending reaction left uses it when it turns the hit into a miss.
 * An area attack (AT5) is placed at the target's square (a burst or square)
 * or out from the player towards them (a cone or line), and everyone it
 * catches, the target among them, is rolled against; the player is left out.
 *
 * What it writes: the player's sheet (ammunition spent), each target's state
 * in `save.figures` (their sheet, and `down` at 0), the fight, and the turn's
 * action. Unless the fight starts or ends, the turn is the rules' lines and
 * the roll card, not narrated (EN5: `ruled`).
 */

const maps = require('../../loom-canon/maps');
const sight = require('../../loom-canon/sight');
const areas = require('../../loom-canon/areas');
const checks = require('../../loom-canon/checks');
const sheets = require('../../loom-canon/sheets');
const clock = require('../../loom-canon/clock');
const { attacksOf } = require('./attacks');
const { strike, spendAmmo } = require('./strike');
const fight = require('./fight');
const play = require('./play');
const position = require('./position');
const reactions = require('./reactions');

const NOBODY = "You don't see anyone like that here.";

const blocked = (line) => ({ outcome: 'blocked', mutations: [], constraints: [line] });
const setSave = (path, value) => ({ target: 'save', op: 'set-flag', path, value });
const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// The eight ways out from a square, by the direction to another.
function facingTo(from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
  const ew = dx < 0 ? 'west' : dx > 0 ? 'east' : '';
  return ns + ew || 'north';
}

// What the defence an attack must reach is called: a derived value's name
// ("Armour"), or "defence".
function defenceName(system) {
  const given = String(((system.modules || {}).combat || {}).attack?.defence || '');
  const derived = ((system.sheet || {}).derived || []).find((d) => d.id === given);
  return derived ? derived.name : 'defence';
}

/** The attack the player means: by id, or their first. */
function chosen(system, sheet, id) {
  const list = attacksOf(system, sheet, { player: true });
  if (!id) return { attack: list[0] };
  const wanted = String(id).toLowerCase();
  const attack = list.find((a) => a.id.toLowerCase() === wanted || a.name.toLowerCase() === wanted);
  return attack
    ? { attack }
    : { refused: `You have no attack called ${id} (${list.map((a) => a.name).join(', ')}).` };
}

/**
 * The player's attack at `targetId` on the battle map they stand on:
 * `params` { attack?: id, subdue?: bool }. `rolled(check, against)` makes a
 * roll card (ADJUDICATE's). Returns a resolution: `{ outcome, mutations,
 * constraints, roll?, opposed?, fight?, ruled? }`, or null when the target
 * isn't a person on this map (the caller treats the action as any other).
 */
function attackTurn(world, save, { targetId, params = {}, dice, rolled }) {
  const { map, cell } = maps.positionOf(world || {}, save);
  if (!map || !cell) return null;
  const person = (world.characters || {})[targetId];
  if (!person || person.retired || !person.cell) return null;
  const host = maps.hostOf(world, save);
  if (!maps.standingAt(world, host).some((c) => c.id === person.id)) return null;
  const doors = ((save && save.doors) || {})[map.id] || {};
  const seen = sight.inSight(map, cell, doors);
  if (!seen[person.cell.x + ',' + person.cell.y]) return blocked(NOBODY);
  const down = play.downOf(save, person.id);
  if (down) return blocked(`${person.name} is already down.`);

  const system = checks.systemOf(world);
  const mine = sheets.sheetOf(save) || sheets.defaultSheet(system);
  const pick = chosen(system, mine, params.attack);
  if (pick.refused) return blocked(pick.refused);
  const attack = pick.attack;
  const away = distance(cell, person.cell);
  if (attack.range) {
    if (away > attack.range.long) {
      return blocked(`${person.name} is out of range of your ${attack.name.toLowerCase()}.`);
    }
  } else if (away > (attack.reach || 1)) {
    return blocked(
      `${person.name} is out of reach of your ${attack.name.toLowerCase()}: get closer.`
    );
  }
  const ammo = spendAmmo(system, mine, attack);
  if (ammo.refused) return blocked(ammo.refused);
  const subdue = Boolean(params.subdue);

  // Who it is aimed at: the target, or everyone the area catches.
  const standing = play.standingHere(world, save);
  let targets = [person];
  if (attack.area) {
    const placed =
      attack.area.shape === 'cone' || attack.area.shape === 'line'
        ? { ...attack.area, x: cell.x, y: cell.y, facing: facingTo(cell, person.cell) }
        : { ...attack.area, x: person.cell.x, y: person.cell.y };
    const squares = areas.squaresOf(map, placed, { states: doors });
    targets = areas.caught(squares, standing);
    if (!targets.some((t) => t.id === person.id)) targets.unshift(person);
  }

  // Out of a fight, the attack starts one: the player's blow opens it.
  const lines = [];
  const mutations = [];
  let f = play.fightOf(save);
  let started = null;
  if (!f) {
    const begun = play.begin(world, save, {
      by: 'attack',
      ambushers: 'party',
      joining: targets.map((t) => t.id),
      first: true,
      dice,
    });
    if (begun) {
      f = begun.mutations[0].value;
      started = begun.fight;
      lines.push(...begun.lines);
    }
  }

  // Where they stand (L-823): long range and flanking on the roll; cover
  // and Dodge on the target's defence (not an area's: it fills the squares);
  // each target's defending reaction, if they have one left.
  const friends = standing.filter((c) => play.sideOf(c) === 'party').map((c) => c.cell);
  const terms = position.termsFor(system, {
    map,
    doors,
    attack,
    from: cell,
    to: person.cell,
    friends,
    dodging: Boolean(f && f.combatants[person.id] && f.combatants[person.id].dodging),
  });
  const costs = {};
  const struck = strike(system, {
    attacker: { name: 'You', sheet: ammo.sheet },
    attack,
    subdue,
    bonus: terms.bonus,
    targets: targets.map((t) => {
      const sheet = play.sheetFor(world, save, t);
      const theirs = (f && f.combatants[t.id]) || {};
      // Their defending reaction, paid from the AP they kept (L-833).
      const defend = f ? reactions.defendingOf(system, f, t.id, sheet, attack) : null;
      const guard = attack.area
        ? position.termsFor(system, {
            map,
            doors,
            attack,
            from: t.cell,
            to: t.cell,
            dodging: Boolean(theirs.dodging),
          }).guard
        : terms.guard;
      if (defend) costs[t.id] = { cost: defend.cost, sheet };
      return {
        id: t.id,
        name: t.name,
        sheet,
        guard,
        ...(defend ? { reaction: defend.reaction } : {}),
      };
    }),
    now: clock.timeOf(save),
    dice,
  });
  if (ammo.sheet !== mine) mutations.push(setSave('character.sheet', ammo.sheet));
  for (const r of struck.results) {
    if (r.reacted && f && f.combatants[r.id]) {
      f = JSON.parse(JSON.stringify(f));
      const paid = costs[r.id] || { cost: 0, sheet: null };
      f.combatants[r.id].kept = reactions.keptOf(f, r.id, system, paid.sheet) - paid.cost;
    }
    lines.push(...r.lines);
    mutations.push(
      setSave('figures.' + r.id, { sheet: r.sheet, ...(r.down ? { down: r.down } : {}) })
    );
    if (r.down && f && f.combatants[r.id]) f = fight.leave(f, r.id, 'down');
  }

  // The fight: on, or over when the last foe falls.
  let fought = started;
  const over = f && fight.endOf(f);
  if (over) {
    const end = play.ending(f, over);
    mutations.push(...end.mutations);
    lines.push(...end.lines);
    fought = { ...end.fight, ...(started ? { startedNow: true, by: 'attack' } : {}) };
  } else if (f) mutations.push(setSave('fight', f));

  const first = struck.results[0];
  const card = rolled(
    {
      ...struck.roll,
      difficulty: first.difficulty,
      rung: first.opposed
        ? null
        : terms.guard.length && !attack.area
          ? first.defenceLine
          : defenceName(system),
      degree: first.degree,
      success: first.hit,
    },
    first.name
  );
  const ruled = !fought;
  return {
    outcome: struck.results.some((r) => r.hit) ? 'success' : 'failure',
    mutations,
    constraints: lines,
    roll: card,
    ...(first.opposed
      ? {
          opposed: {
            by: first.id,
            roll: rolled(
              {
                ...first.opposed,
                difficulty: null,
                rung: null,
                degree: first.hit ? 'failure' : 'success',
                success: !first.hit,
              },
              'you'
            ),
          },
        }
      : {}),
    ...(fought ? { fight: fought } : {}),
    ...(ruled ? { ruled: true } : {}),
    attack: {
      id: attack.id,
      name: attack.name,
      subdue,
      ...(terms.band === 'long' ? { long: true } : {}),
      ...(terms.cover ? { cover: terms.cover } : {}),
      targets: struck.results.map((r) => ({
        id: r.id,
        hit: r.hit,
        ...(r.damage ? { damage: r.damage.total } : {}),
        ...(r.down ? { down: r.down } : {}),
      })),
    },
  };
}

module.exports = { attackTurn, facingTo, chosen };
