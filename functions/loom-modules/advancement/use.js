'use strict';

/**
 * Improving by use (planning/advancement.md §4.5, US1–US6; L-844 / #716):
 * successes with real stakes count toward the skill or attack used; at a
 * long rest, each whose count reached its threshold (`use.threshold`, a
 * formula of its rank) rises one rank, up to the top, and its count resets.
 * Never attributes, never the level (US3, US4).
 *
 *   counted(system, world, sheet, { skill?, attack? })  the sheet with the
 *       use counted (in `uses`), or the same sheet when it doesn't count
 *   rise(system, world, sheet)  `{ sheet, rises: [{ kind, id, name, rank }] }`
 *       at a long rest
 *
 * The top: a skill's is `experience.skillMax` (AR4; a sheet's 20 without
 * experience), an attack's `use.maxRank`. Only where the system has `use`
 * and the world has advancement on.
 *
 * Pure.
 */

const advancement = require('./index');
const attacks = require('../combat/attacks');

// What use raises, for a sheet: its skills and attacks with their ranks and
// tops, under the system's settings; null without `use`.
function settings(system, world) {
  const s = advancement.settingsOf(system, world);
  if (!s.use) return null;
  return {
    use: s.use,
    skillTop: s.experience ? s.experience.skillMax : advancement.TOP_RANK,
  };
}

const copy = (v) => JSON.parse(JSON.stringify(v));

/**
 * A use counted (US1, US2): one for the skill rolled, or the attack that
 * hit, when the system improves it and it isn't at its top already.
 */
function counted(system, world, sheet, { skill = null, attack = null } = {}) {
  const s = settings(system, world);
  if (!s || !sheet) return sheet;
  const out = copy(sheet);
  out.uses = {
    skills: { ...((sheet.uses && sheet.uses.skills) || {}) },
    attacks: { ...((sheet.uses && sheet.uses.attacks) || {}) },
  };
  let changed = false;
  const skills = system.sheet.skills || [];
  if (skill && s.use.skills && skills.some((k) => k.id === skill)) {
    if (((sheet.skills || {})[skill] || 0) < s.skillTop) {
      out.uses.skills[skill] = (out.uses.skills[skill] || 0) + 1;
      changed = true;
    }
  }
  if (attack && s.use.attacks && advancement.attackRankOf(sheet, attack) < s.use.maxRank) {
    out.uses.attacks[attack] = (out.uses.attacks[attack] || 0) + 1;
    changed = true;
  }
  return changed ? out : sheet;
}

/**
 * At a long rest (US5): each skill and attack whose count reached its
 * threshold rises one rank, up to its top, and its count resets.
 */
function rise(system, world, sheet) {
  const s = settings(system, world);
  if (!s || !sheet || !sheet.uses) return { sheet, rises: [] };
  const out = copy(sheet);
  const rises = [];
  const uses = out.uses;
  for (const [id, n] of Object.entries(uses.skills || {})) {
    const skill = (system.sheet.skills || []).find((k) => k.id === id);
    const rank = (out.skills || {})[id] || 0;
    if (!skill || rank >= s.skillTop || n < advancement.thresholdFor(system, rank)) continue;
    out.skills[id] = rank + 1;
    uses.skills[id] = 0;
    rises.push({ kind: 'skill', id, name: skill.name, rank: rank + 1 });
  }
  const known = attacks.attacksOf(system, sheet, { player: true });
  for (const [id, n] of Object.entries(uses.attacks || {})) {
    const rank = advancement.attackRankOf(out, id);
    if (rank >= s.use.maxRank || n < advancement.thresholdFor(system, rank)) continue;
    out.attackRanks = { ...(out.attackRanks || {}), [id]: rank + 1 };
    uses.attacks[id] = 0;
    const a = known.find((x) => x.id === id);
    rises.push({ kind: 'attack', id, name: a ? a.name : id, rank: rank + 1 });
  }
  return rises.length ? { sheet: out, rises } : { sheet, rises };
}

/** The journal's line for a rise: "Your Tech rises to 2." */
function lineOf(rise) {
  return `Your ${rise.name} rises to ${rise.rank}.`;
}

module.exports = { counted, rise, lineOf };
