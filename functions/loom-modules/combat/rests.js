'use strict';

/**
 * Rests (planning/combat.md §3 DF5, §4.7; L-827 / #659): a short rest and a
 * long one, by the system's `rests` settings (./settings.js). Each takes its
 * hours and restores resources by its formulas ('full': to the maximum),
 * clearing the conditions it names; a long rest once a day.
 *
 * Somewhere dangerous (a place's `danger`, L-824) each hour rolls against it,
 * low 1 in 6, high 1 in 3; a roll that comes up breaks the rest there: no
 * more time passes, nothing is restored, and hostile fighters at the place
 * come for the player, a fight starting (decided 2026-10-22; encounter
 * tables add more later).
 *
 * Pure: the dice come from the caller.
 */

const formula = require('../../loom-canon/formula');
const checks = require('../../loom-canon/checks');
const sheets = require('../../loom-canon/sheets');
const effects = require('../../loom-canon/effects');
const conditions = require('../../loom-canon/conditions');
const clock = require('../../loom-canon/clock');
const maps = require('../../loom-canon/maps');
const { settingsOf } = require('./settings');

const KINDS = ['short', 'long'];
const ODDS = { low: 1, high: 2 }; // in 6, each hour
const copyOf = (v) => JSON.parse(JSON.stringify(v));

/** How dangerous where the save stands is: 'none', 'low' or 'high'. */
function dangerAt(world, save) {
  const host = maps.hostOf(world, save) || (world.locations || {})[save.location];
  const danger = host && host.danger;
  return danger === 'low' || danger === 'high' ? danger : 'none';
}

/**
 * What resting does to a sheet: each resource restored by its formula, or
 * to full, and the conditions it clears taken off. Returns `{ sheet, lines }`.
 */
function restored(system, sheet, rest, dice) {
  const next = copyOf(sheet || {});
  const lines = [];
  const max = sheets.maxima(system, next);
  const restore =
    rest.restore || Object.fromEntries((system.sheet.resources || []).map((r) => [r.id, 'full']));
  for (const r of system.sheet.resources || []) {
    const how = restore[r.id];
    if (how === undefined) continue;
    const held = (next.resources = next.resources || {})[r.id] || {};
    const before = Number.isFinite(held.current) ? held.current : max[r.id] || 0;
    let after;
    if (how === 'full') after = max[r.id] === null ? before : max[r.id];
    else {
      const { values } = checks.valuesFor(system, { sheet: next }, {}, dice);
      const gain = Math.max(
        0,
        Math.trunc(formula.evaluate(String(how), { values, system, dice }).total)
      );
      after = Math.min(max[r.id] === null ? Infinity : max[r.id], before + gain);
    }
    next.resources[r.id] = { ...held, current: after };
    if (after !== before) lines.push(`${r.name}: ${before} → ${after}.`);
  }
  for (const id of rest.clears || []) {
    if ((next.conditions || []).some((c) => conditions.idOf(c) === id)) {
      const condition = conditions.conditionOf(system, id);
      lines.push(`${condition ? condition.name : id} fades.`);
    }
    next.conditions = (next.conditions || []).filter((c) => conditions.idOf(c) !== id);
  }
  return { sheet: next, lines };
}

/**
 * A rest (DF5): `kind` 'short' or 'long', from `save` now. Returns
 * `{ refused }`, or `{ kind, hours (as rested), to (the time it ends),
 * interrupted (the hour it broke, or null), sheet, lines, rested (the save's
 * rest record) }`.
 */
function rest(world, save, kind, { dice }) {
  if (!KINDS.includes(kind)) return { refused: 'Rest how? A short rest, or a long one.' };
  const system = checks.systemOf(world);
  const settings = settingsOf(system).rests[kind];
  const now = clock.timeOf(save);
  const record = (save && save.rested) || {};
  if (kind === 'long' && Number.isFinite(record.long) && now - record.long < clock.DAY) {
    const at = clock.timeView(record.long + clock.DAY);
    return {
      refused: `You've had your long rest today. You can rest long again from ${at.label}.`,
    };
  }
  const odds = ODDS[dangerAt(world, save)] || 0;
  let interrupted = null;
  for (let hour = 1; odds && hour <= settings.hours; hour++) {
    if (dice(6) <= odds) {
      interrupted = hour;
      break;
    }
  }
  const hours = interrupted || settings.hours;
  const to = now + hours * clock.HOUR;
  // The hours pass for conditions as for a wait (L-374).
  let sheet = sheets.sheetOf(save) || sheets.defaultSheet(system);
  const turnSeconds = clock.turnSeconds(world, false);
  const ticked = (sheet.conditions || []).length
    ? effects.overTurns(system, sheet, {
        from: now,
        to,
        turns: Math.min(100, Math.max(1, Math.floor((hours * clock.HOUR) / turnSeconds))),
        turnSeconds,
        dice,
      })
    : { sheet, lines: [] };
  sheet = ticked.sheet;
  const lines = [];
  if (interrupted) {
    lines.push(
      `Your ${kind} rest is broken ${interrupted === 1 ? 'within the hour' : 'after ' + (interrupted - 1) + (interrupted === 2 ? ' hour' : ' hours')}: something is coming.`
    );
    return {
      kind,
      hours,
      to,
      interrupted,
      sheet,
      lines: lines.concat(ticked.lines),
      rested: record,
    };
  }
  const done = restored(system, sheet, settings, dice);
  lines.push(
    kind === 'long'
      ? `You rest for ${settings.hours} hours.`
      : `You rest for ${settings.hours === 1 ? 'an hour' : settings.hours + ' hours'}.`
  );
  return {
    kind,
    hours,
    to,
    interrupted: null,
    sheet: done.sheet,
    lines: lines.concat(ticked.lines, done.lines),
    rested: kind === 'long' ? { ...record, long: to } : record,
  };
}

module.exports = { KINDS, ODDS, dangerAt, restored, rest };
