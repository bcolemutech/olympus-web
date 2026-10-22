'use strict';

/**
 * Falling to 0 (planning/combat.md §3 DF1–DF3, §4.7; L-827 / #659): what 0
 * means for the player, by the system's `down` kind, and what comes after,
 * by the world's death setting. Replaces L-824's stand-in (knocked out).
 *
 *   At 0 (DF1)       dyingWithSaves: dying; a save each round, `need` of one
 *                    kind: stable, or dead. wounds: a wound instead of falling,
 *                    up to `wounds`; past them, out. outAtOnce: out.
 *   save.down        { kind: 'dying' | 'stable' | 'out', successes, failures }
 *                    while the player is down
 *   Help             an ally on the player's side rolls the system's
 *                    `stabilise` to stabilise someone dying (once the fight is
 *                    won, each round until it works)
 *   No one helps (DF2)  the fight lost: death on, someone dying rolls their
 *                    saves alone (three successes: left for dead, they come
 *                    round 1d4 hours later, decided 2026-10-22), and someone
 *                    out dies; death off, they come round captured, robbed or
 *                    rescued, NARRATE choosing which (decided 2026-10-22) and
 *                    the rules applying it
 *   Death (DF3)      the save ends (`save.ended`), with NARRATE's epilogue
 *   Coming round     1 health, the system's `injury` put on, hours later
 *
 * The world's `rules.death` ('on' or 'off') wins over the system's default.
 *
 * Pure: the dice come from the caller.
 */

const checks = require('../../loom-canon/checks');
const effects = require('../../loom-canon/effects');
const clock = require('../../loom-canon/clock');
const town = require('../../loom-canon/town');
const maps = require('../../loom-canon/maps');
const { settingsOf } = require('./settings');

const FATES = ['captured', 'robbed', 'rescued'];
const FATE_HOURS = 4;
const INJURY_DAYS = 7;
const MAX_ROLLS = 30;
const copyOf = (v) => JSON.parse(JSON.stringify(v));
const setSave = (path, value) => ({ target: 'save', op: 'set-flag', path, value });

/** The world's death setting: its own `rules.death`, else its system's default. */
function deathOf(world) {
  const own = world && world.rules && world.rules.death;
  if (own === 'on' || own === 'off') return own;
  return settingsOf(checks.systemOf(world)).down.death;
}

// A sheet's health set to `value`.
function withHealth(system, sheet, value) {
  const health = settingsOf(system).health;
  const next = copyOf(sheet || {});
  if (!health) return next;
  next.resources = next.resources || {};
  next.resources[health] = { ...(next.resources[health] || {}), current: value };
  return next;
}

/**
 * The player at 0 (DF1): `{ sheet, down, lines }`, `down` the state they are
 * in (null when a wound keeps them standing, at 1).
 */
function fall(system, sheet) {
  const d = settingsOf(system).down;
  if (d.kind === 'wounds') {
    const wounds = ((sheet && sheet.wounds) || 0) + 1;
    if (wounds <= d.wounds) {
      const next = withHealth(system, sheet, 1);
      next.wounds = wounds;
      return {
        sheet: next,
        down: null,
        lines: [`You take a wound (${wounds} of ${d.wounds}) and stay on your feet.`],
      };
    }
    return { sheet, down: { kind: 'out' }, lines: ['You fall, out cold.'] };
  }
  if (d.kind === 'dyingWithSaves') {
    return {
      sheet,
      down: { kind: 'dying', successes: 0, failures: 0 },
      lines: ['You fall, dying.'],
    };
  }
  return { sheet, down: { kind: 'out' }, lines: ['You fall, out cold.'] };
}

// A check by a sheet against a rung: { skill or attribute, against }.
function rollAgainst(system, rolled, sheet, dice) {
  const rung =
    system.checks.ladder.find((r) => r.name === rolled.against) || system.checks.ladder[0];
  return checks.rollCheck(system, {
    check: { skill: rolled.skill, attribute: rolled.attribute },
    character: { sheet: sheet || null },
    difficulty: rung,
    dice,
  });
}

/**
 * A dying save (DF1): `{ down, roll, line, outcome: 'stable' | 'dead' | null }`.
 */
function deathSave(system, sheet, down, dice) {
  const d = settingsOf(system).down;
  const roll = rollAgainst(
    system,
    d.save || { against: system.checks.ladder[0].name },
    sheet,
    dice
  );
  const next = { ...down };
  if (roll.success) next.successes = (next.successes || 0) + 1;
  else next.failures = (next.failures || 0) + 1;
  const outcome = next.successes >= d.need ? 'stable' : next.failures >= d.need ? 'dead' : null;
  if (outcome === 'stable') next.kind = 'stable';
  const line = roll.success
    ? `A dying save holds (${next.successes} of ${d.need}).`
    : `A dying save fails (${next.failures} of ${d.need}).`;
  return {
    down: next,
    roll,
    line:
      outcome === 'stable'
        ? line + ' You are stable.'
        : outcome === 'dead'
          ? line + ' You die.'
          : line,
    outcome,
  };
}

/**
 * After a fight with the player down (DF1, DF2): whether they come round,
 * die, or need their fate chosen. `winner` the fight's ('party' when allies
 * won it), `allies` the sheets of those on their side still standing.
 *
 * Returns `{ outcome: 'wake' | 'dead' | 'fate', lines, hours, rolls }`.
 */
function aftermath(world, { sheet, down, winner, allies = [], dice }) {
  const system = checks.systemOf(world);
  const d = settingsOf(system).down;
  const lines = [];
  const rolls = [];
  let state = { ...down };
  const helped = winner === 'party' && allies.length;
  // Someone dying: helped, an ally stabilises them; alone, their saves decide.
  if (state.kind === 'dying') {
    if (!helped && deathOf(world) === 'off')
      return { outcome: 'fate', lines, hours: FATE_HOURS, rolls };
    for (let i = 0; i < MAX_ROLLS && state.kind === 'dying'; i++) {
      if (helped && d.stabilise) {
        const tended = rollAgainst(system, d.stabilise, allies[i % allies.length], dice);
        rolls.push(tended);
        if (tended.success) {
          state.kind = 'stable';
          lines.push('Your allies stabilise you.');
          break;
        }
      }
      const saved = deathSave(system, sheet, state, dice);
      rolls.push(saved.roll);
      lines.push(saved.line);
      state = saved.down;
      if (saved.outcome === 'dead') return { outcome: 'dead', lines, hours: 0, rolls };
    }
    if (state.kind !== 'stable') return { outcome: 'dead', lines, hours: 0, rolls };
    const hours = dice(4);
    lines.push(
      helped
        ? `You come round ${hours === 1 ? 'an hour' : hours + ' hours'} later.`
        : `Left for dead, you come round ${hours === 1 ? 'an hour' : hours + ' hours'} later.`
    );
    return { outcome: 'wake', lines, hours, rolls };
  }
  // Stable, or out.
  if (helped || state.kind === 'stable') {
    lines.push(`You come round ${d.hours === 1 ? 'an hour' : d.hours + ' hours'} later.`);
    return { outcome: 'wake', lines, hours: d.hours, rolls };
  }
  if (deathOf(world) === 'on') {
    lines.push('No one comes. You die where you fell.');
    return { outcome: 'dead', lines, hours: 0, rolls };
  }
  return { outcome: 'fate', lines, hours: FATE_HOURS, rolls };
}

/** Coming round: 1 health, the system's injury on, `down` cleared. Mutations. */
function wakeMutations(world, save, { sheet, hours }) {
  const system = checks.systemOf(world);
  const d = settingsOf(system).down;
  const now = clock.timeOf(save) + Math.round(hours * clock.HOUR);
  let next = withHealth(system, sheet, 1);
  if (d.injury) {
    next = effects.apply(
      system,
      next,
      {
        condition: d.injury,
        duration: { seconds: INJURY_DAYS * clock.DAY },
        source: { kind: 'down', id: 'down', name: 'going down' },
      },
      { now, dice: () => 1 }
    ).sheet;
  }
  return [setSave('character.sheet', next), setSave('down', null), setSave('time', now)];
}

/** Death (DF3): the save ends. Mutations. */
function deathMutations(save) {
  return [
    setSave('down', null),
    setSave('fight', null),
    setSave('ended', { how: 'died', at: clock.timeOf(save) }),
  ];
}

// The settlement nearest where the save is (its own, in one).
function nearestSettlement(world, save) {
  const here = (world.locations || {})[save.location];
  if (here && (here.geo || {}).kind === 'settlement') return here;
  const from = here && here.geo;
  const settlements = Object.values(world.locations || {}).filter(
    (l) => !l.retired && (l.geo || {}).kind === 'settlement'
  );
  if (!settlements.length) return null;
  if (!from || !Number.isFinite(from.x)) return settlements[0];
  const d = (l) => Math.hypot(l.geo.x - from.x, l.geo.y - from.y);
  return settlements.slice().sort((a, b) => d(a) - d(b))[0];
}

/**
 * What a fate does (DF2; decided 2026-10-22: NARRATE chose it, the rules
 * apply it), with coming round: rescued or captured, they wake in the
 * nearest settlement (captured marked so for the story); robbed, where they
 * fell, their belongings gone. Returns `{ mutations, line }`.
 */
function fateMutations(world, save, fate, { sheet, hours = FATE_HOURS }) {
  const which = FATES.includes(fate) ? fate : 'rescued';
  const mutations = wakeMutations(world, save, { sheet, hours });
  let line;
  if (which === 'robbed') {
    mutations.push(setSave('character.inventory', []));
    line = 'You come round where you fell, hours later: everything you carried is gone.';
  } else {
    const settlement = nearestSettlement(world, save);
    if (settlement) {
      const arrival = town.arrivalPlace(world, settlement.id, null);
      mutations.push(
        setSave('location', settlement.id),
        setSave('townPoint', null),
        setSave('placeId', arrival ? arrival.id : null),
        ...maps.arrivalMutations(world, arrival || settlement, save)
      );
      if (!maps.mapOf(world, arrival || settlement)) {
        mutations.push(setSave('mapId', null), setSave('cell', null));
      }
    }
    if (which === 'captured') mutations.push(setSave('privateFlags.captured', true));
    line =
      which === 'captured'
        ? `You come round hours later in ${settlement ? settlement.name : 'a cell'}, a captive.`
        : `You come round hours later in ${settlement ? settlement.name : 'safety'}: someone carried you there.`;
  }
  return { mutations, line, fate: which };
}

module.exports = {
  FATES,
  FATE_HOURS,
  deathOf,
  fall,
  deathSave,
  aftermath,
  wakeMutations,
  deathMutations,
  fateMutations,
  nearestSettlement,
};
