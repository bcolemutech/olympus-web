'use strict';

/**
 * The navigation check (planning/off-road-travel.md §4.3, MD2; L-362 / #836):
 * each day leg off the road, the traveller rolls the system's check to keep
 * on course, against its rung (`navigation.dc`) made harder by the danger of
 * the terrain (`navigation.harder`: a rung for each that much above 1). A
 * success keeps the day; a worse degree loses more of it (`navigation.lost`).
 *
 *   harderBy(danger, harder)   the rungs danger adds: 0 at 1 or below
 *   rungFor(system, nav, danger)  the rung it is rolled against
 *   navigate(sheet, system, danger, dice, settings?)
 *     → { roll, degree, success, lost, rung, harder } or null when nobody
 *       can get lost (off-road travel off, or no navigation check).
 *       `roll` is the check as ../../loom-canon/checks.js rolls it, for the
 *       roll card; `lost` the share of the day lost (0–1). `dice(sides)` is
 *       the caller's: seeded like every other roll (formula.seeded), so the
 *       same leg rolls the same.
 *
 * Pure.
 */

const checks = require('../../loom-canon/checks');
const { settingsOf } = require('./settings');

// Room for a danger that is a whole number of steps but not quite in floating point.
const EPSILON = 1e-9;

function harderBy(danger, harder) {
  if (!(harder > 0) || !Number.isFinite(danger) || danger <= 1) return 0;
  return Math.floor((danger - 1) / harder + EPSILON);
}

function rungFor(system, nav, danger) {
  const ladder = system.checks.ladder;
  const base = Math.max(
    0,
    ladder.findIndex((r) => r.name === nav.dc)
  );
  return ladder[Math.min(ladder.length - 1, base + harderBy(danger, nav.harder))];
}

function navigate(sheet, system, danger, dice, settings = settingsOf(system)) {
  const nav = settings && settings.navigation;
  if (!nav) return null;
  const rung = rungFor(system, nav, danger);
  const roll = checks.rollCheck(system, {
    check: nav.check,
    character: { sheet: sheet || null },
    difficulty: rung,
    dice,
  });
  return {
    roll,
    degree: roll.degree,
    success: roll.success,
    lost: nav.lost[roll.degree] || 0,
    rung: rung.name,
    harder: harderBy(danger, nav.harder),
  };
}

module.exports = { harderBy, rungFor, navigate };
