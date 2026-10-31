'use strict';

/**
 * The advancement module (planning/advancement.md §4.1, §4.2; L-841 / #713):
 * how characters grow, as a system's `advancement`, checked when the system
 * is saved like combat's settings. Two parts, each on when given:
 *
 *   experience   experience and levels (MX1, LV1, LV2)
 *     curve      the total needed for each level: a formula of `level`, or a
 *                table, one total per level from the lowest; it must rise
 *     foe        a foe's worth: a formula of `foeLevel` and `level` (L-842)
 *     story      { small, notable, major }: a story moment's worth by its
 *                size, each an amount or a formula of `level` (L-842)
 *     quest      a quest's worth, an amount or a formula of `level`, used
 *                once quests exist
 *     grants     what a level gives to choose (L-843):
 *                { every?: grant, at?: { [level]: grant } }, a level in `at`
 *                taking its grant's parts in place of `every`'s; a grant is
 *                { attributePoints?, skillRanks?, traits?: { from, choose },
 *                attacks?: { from, choose } }, within creation's limits
 *     skillMax   the top rank a skill reaches by grants or by use (default
 *                and at most the sheet's top rank, 20)
 *   use          improving by use (US1, US5, US6; L-844)
 *     threshold  successes a skill or attack needs to rise: a formula of
 *                `rank` (default 3 * (rank + 1))
 *     skills, attacks   what improves (true, or false: not)
 *     maxRank    an attack's top rank (default 3)
 *
 * On a sheet (§4.2): `xp` (the total earned), `levelsReady` (levels earned
 * and not yet taken: worked out from `xp` and the curve, never stored),
 * `uses` ({ skills: { [id]: n }, attacks: { [id]: n } }, successes counted
 * since each last rose) and `attackRanks` ({ [attackId]: n }, each attack's
 * rank, 0 when not listed, read as `rank` in that attack's formulas;
 * decided 2026-10-31). A save's `earned` lists the foes and moments it has
 * been paid for (XP3; L-842).
 *
 * A sheet from before advancement (SV1) has its level's total as `xp`, and
 * no uses: worked out whenever the save is loaded (sheetWith).
 *
 * A world turns it off with `rules.advancement: false` (MX2): nothing is
 * earned and no level is ready.
 *
 * Pure: formulas are checked and worked out by the formula language.
 */

const formula = require('../../loom-canon/formula');

const PARTS = ['experience', 'use'];
const EXPERIENCE_KEYS = ['curve', 'foe', 'story', 'quest', 'grants', 'skillMax'];
const USE_KEYS = ['threshold', 'skills', 'attacks', 'maxRank'];
const GRANT_KEYS = ['attributePoints', 'skillRanks', 'traits', 'attacks'];
const SIZES = ['small', 'notable', 'major'];
const DEFAULT_THRESHOLD = '3 * (rank + 1)';
const DEFAULT_ATTACK_MAX = 3;
const TOP_RANK = 20; // as ../../loom-canon/sheets.js MAX_RANK
const MAX_TABLE = 1000;
const MAX_GRANT = 10;
const MAX_XP = 1e9;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

// ── Reading the settings ──────────────────────────────────────────────

/** The world's switch (MX2): advancement is on unless `rules.advancement` is false. */
function isOn(world) {
  return !(world && world.rules && world.rules.advancement === false);
}

/**
 * The settings with their defaults filled in, or null parts: `{ experience,
 * use }`. A world with it off reads as both null.
 */
function settingsOf(system, world = null) {
  const given = (system && system.advancement) || {};
  if (!isOn(world)) return { experience: null, use: null, off: true };
  const xp = isObject(given.experience) ? given.experience : null;
  const use = isObject(given.use) ? given.use : null;
  return {
    experience: xp
      ? {
          ...xp,
          grants: isObject(xp.grants) ? xp.grants : {},
          skillMax: xp.skillMax === undefined ? TOP_RANK : xp.skillMax,
        }
      : null,
    use: use
      ? {
          threshold: use.threshold === undefined ? DEFAULT_THRESHOLD : use.threshold,
          skills: use.skills !== false,
          attacks: use.attacks !== false,
          maxRank: use.maxRank === undefined ? DEFAULT_ATTACK_MAX : use.maxRank,
        }
      : null,
    off: false,
  };
}

// A formula's value, its dice at 1 (the formulas here roll none).
function valueOf(text, values, system) {
  if (typeof text === 'number') return text;
  return formula.evaluate(String(text), { values, system, dice: () => 1 }).total;
}

function levelsOf(system) {
  const level = (system && system.sheet && system.sheet.level) || { min: 1, max: 1 };
  return { min: level.min, max: level.max };
}

/**
 * The experience a level needs, by the curve: 0 for the lowest level when
 * the curve says nothing, and null with experience off.
 */
function totalFor(system, level) {
  const { experience } = settingsOf(system);
  if (!experience || experience.curve === undefined) return null;
  const { min } = levelsOf(system);
  const curve = experience.curve;
  if (Array.isArray(curve)) {
    const i = Math.max(0, Math.min(curve.length - 1, level - min));
    return curve[i];
  }
  return valueOf(curve, { level }, system);
}

/**
 * Levels earned and not yet taken (LV3): how many levels past the sheet's
 * the experience reaches, up to the top. 0 with experience off.
 */
function levelsReady(system, sheet, world = null) {
  const { experience } = settingsOf(system, world);
  if (!experience || !sheet || !Number.isFinite(sheet.xp)) return 0;
  const { max } = levelsOf(system);
  let n = 0;
  for (let level = sheet.level + 1; level <= max; level += 1) {
    if (sheet.xp < totalFor(system, level)) break;
    n += 1;
  }
  return n;
}

/** The successes a rank needs to rise (US5): the threshold at that rank. */
function thresholdFor(system, rank) {
  const { use } = settingsOf(system);
  if (!use) return null;
  return Math.max(1, Math.ceil(valueOf(use.threshold, { rank }, system)));
}

/** The grant a level gives (LV2): `every`'s parts, with `at`'s for that level in their place. */
function grantFor(system, level) {
  const { experience } = settingsOf(system);
  if (!experience) return {};
  const { every, at } = experience.grants;
  return { ...(isObject(every) ? every : {}), ...((isObject(at) && at[String(level)]) || {}) };
}

/**
 * A sheet with what the module keeps on it (§4.2, SV1): `xp` at its level's
 * total when it has none (a sheet from before advancement), `uses` empty
 * when missing, and `levelsReady` worked out. A system without experience
 * leaves `xp` and `levelsReady` off, one without use `uses`; `attackRanks`
 * is kept only once an attack has risen (attackRankOf reads 0 without).
 */
function sheetWith(system, sheet, world = null) {
  if (!sheet) return sheet;
  const out = { ...sheet };
  const s = settingsOf(system);
  if (s.experience && !Number.isFinite(out.xp)) {
    const total = totalFor(system, out.level);
    out.xp = Number.isFinite(total) ? total : 0;
  }
  if (s.use || isObject(out.uses)) {
    const uses = isObject(out.uses) ? out.uses : {};
    out.uses = {
      skills: isObject(uses.skills) ? { ...uses.skills } : {},
      attacks: isObject(uses.attacks) ? { ...uses.attacks } : {},
    };
  }
  if (s.experience) out.levelsReady = levelsReady(system, out, world);
  else delete out.levelsReady;
  return out;
}

/** An attack's rank on a sheet (0 when not listed). */
function attackRankOf(sheet, attackId) {
  const ranks = (sheet && sheet.attackRanks) || {};
  return Number.isInteger(ranks[attackId]) ? ranks[attackId] : 0;
}

/** The settings for the rules reference (L-845): what earns, the curve, what improves. */
function rulesView(system, world = null) {
  const s = settingsOf(system, world);
  if (s.off) return { off: true };
  const { min, max } = levelsOf(system);
  const out = {};
  if (s.experience) {
    const curve = [];
    for (let level = min; level <= max && curve.length < 100; level += 1) {
      curve.push({ level, xp: totalFor(system, level) });
    }
    out.experience = {
      curve,
      story: s.experience.story ? { ...s.experience.story } : null,
    };
  }
  if (s.use) {
    out.use = { skills: s.use.skills, attacks: s.use.attacks, maxRank: s.use.maxRank };
  }
  return out;
}

// ── Checking the settings ─────────────────────────────────────────────

// Whether a formula rolls dice: worked out with every die low and high.
function rolls(text, values, system) {
  if (typeof text === 'number') return false;
  const at = (dice) => formula.evaluate(String(text), { values, system, dice }).total;
  return at(() => 1) !== at((sides) => sides);
}

/**
 * Checks a system's `advancement` (§4.1): pushes what's wrong to `errors`
 * and what's doubtful to `warnings`. A missing or empty one is off.
 */
function check(settings, { system, errors, warnings }) {
  const at = 'advancement';
  if (settings === undefined) return;
  if (!isObject(settings)) {
    errors.push(`${at} must be { experience?, use? }: each part on when given.`);
    return;
  }
  for (const key of Object.keys(settings)) {
    if (!PARTS.includes(key)) {
      errors.push(`${at}: "${key}" isn't part of advancement (${PARTS.join(', ')}).`);
    }
  }
  if (settings.experience !== undefined) {
    checkExperience(settings.experience, { system, errors, warnings, at: `${at}.experience` });
  }
  if (settings.use !== undefined) {
    checkUse(settings.use, { system, errors, at: `${at}.use` });
  }
}

// A formula over the given names only (`allowed`), coming to a number and
// rolling no dice. Returns whether it passed.
function plainFormula(value, where, { system, errors, allowed, sample }) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(`${where} must be a number or a formula.`);
    return Number.isFinite(value);
  }
  if (typeof value !== 'string' || !value.trim() || value.length > 300) {
    errors.push(`${where} must be a number or a formula (at most 300 characters).`);
    return false;
  }
  const checked = formula.check(value, { system, names: allowed });
  if (checked.errors.length) {
    checked.errors.forEach((e) => errors.push(`${where}: ${e}`));
    return false;
  }
  const others = checked.names.filter((n) => !allowed.includes(n));
  if (others.length) {
    errors.push(
      `${where} must be a formula of ${allowed.join(' and ')} only; it reads ${others.join(', ')}.`
    );
    return false;
  }
  if (checked.type === 'bool') {
    errors.push(`${where} must come to a number, not a comparison.`);
    return false;
  }
  try {
    if (rolls(value, sample, system)) {
      errors.push(`${where} mustn't roll dice: the same deed earns the same.`);
      return false;
    }
  } catch (err) {
    errors.push(`${where}: ${err.message}`);
    return false;
  }
  return true;
}

function checkExperience(xp, { system, errors, warnings, at }) {
  if (!isObject(xp)) {
    errors.push(`${at} must be { curve, foe?, story?, quest?, grants?, skillMax? }.`);
    return;
  }
  for (const key of Object.keys(xp)) {
    if (!EXPERIENCE_KEYS.includes(key)) {
      errors.push(`${at}: "${key}" isn't part of experience (${EXPERIENCE_KEYS.join(', ')}).`);
    }
  }
  const { min, max } = levelsOf(system);

  // The curve (LV1): a total per level, rising.
  if (xp.curve === undefined) errors.push(`${at}.curve is needed: the total each level takes.`);
  else if (Array.isArray(xp.curve)) {
    const want = max - min + 1;
    if (xp.curve.length !== want || want > MAX_TABLE) {
      errors.push(
        `${at}.curve as a table needs one total per level, ${min} to ${max} (${want}); it has ` +
          `${xp.curve.length}.`
      );
    } else if (!xp.curve.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
      errors.push(`${at}.curve's totals must be numbers from 0.`);
    } else checkRising(xp.curve, min, at, errors);
  } else if (
    plainFormula(xp.curve, `${at}.curve`, {
      system,
      errors,
      allowed: ['level'],
      sample: { level: min },
    })
  ) {
    const totals = [];
    for (let level = min; level <= Math.min(max, min + MAX_TABLE); level += 1) {
      totals.push(valueOf(xp.curve, { level }, system));
    }
    if (totals.some((n) => !Number.isFinite(n) || n < 0 || n > MAX_XP)) {
      errors.push(`${at}.curve must come to a total from 0 at every level.`);
    } else checkRising(totals, min, at, errors);
  }

  if (xp.foe !== undefined) {
    plainFormula(xp.foe, `${at}.foe`, {
      system,
      errors,
      allowed: ['foeLevel', 'level'],
      sample: { foeLevel: min, level: min },
    });
  } else warnings.push(`${at}.foe isn't set: overcoming foes earns nothing.`);

  if (xp.story !== undefined) {
    if (!isObject(xp.story)) errors.push(`${at}.story must be { small, notable, major }.`);
    else {
      for (const key of Object.keys(xp.story)) {
        if (!SIZES.includes(key)) {
          errors.push(`${at}.story: "${key}" isn't a moment's size (${SIZES.join(', ')}).`);
        }
      }
      for (const size of SIZES) {
        if (xp.story[size] === undefined) {
          errors.push(`${at}.story.${size} is needed.`);
          continue;
        }
        plainFormula(xp.story[size], `${at}.story.${size}`, {
          system,
          errors,
          allowed: ['level'],
          sample: { level: min },
        });
      }
    }
  }
  if (xp.quest !== undefined) {
    plainFormula(xp.quest, `${at}.quest`, {
      system,
      errors,
      allowed: ['level'],
      sample: { level: min },
    });
  }

  // A skill's top rank, by grants or by use (US6).
  const startRank = (system.creation && system.creation.skills && system.creation.skills.rank) || 0;
  const skillMax = xp.skillMax === undefined ? TOP_RANK : xp.skillMax;
  if (!whole(skillMax, Math.max(1, startRank), TOP_RANK)) {
    errors.push(
      `${at}.skillMax must be a whole number from ${Math.max(1, startRank)} (creation's starting ` +
        `rank) to ${TOP_RANK} (a sheet's top rank).`
    );
  }

  // Grants (LV2).
  if (xp.grants !== undefined) {
    if (!isObject(xp.grants)) errors.push(`${at}.grants must be { every?, at? }.`);
    else {
      for (const key of Object.keys(xp.grants)) {
        if (key !== 'every' && key !== 'at') {
          errors.push(`${at}.grants: "${key}" isn't every or at.`);
        }
      }
      if (xp.grants.every !== undefined) {
        checkGrant(xp.grants.every, `${at}.grants.every`, { system, errors, skillMax });
      }
      if (xp.grants.at !== undefined) {
        if (!isObject(xp.grants.at)) {
          errors.push(`${at}.grants.at must map levels to their grants.`);
        } else {
          for (const [level, grant] of Object.entries(xp.grants.at)) {
            const n = Number(level);
            if (!whole(n, min + 1, max)) {
              errors.push(
                `${at}.grants.at: ${level} isn't a level that can be reached (${min + 1}–${max}).`
              );
            } else checkGrant(grant, `${at}.grants.at.${level}`, { system, errors, skillMax });
          }
        }
      }
    }
  } else warnings.push(`${at}.grants isn't set: a level gives nothing to choose.`);
}

function checkRising(totals, min, at, errors) {
  for (let i = 1; i < totals.length; i += 1) {
    if (!(totals[i] > totals[i - 1])) {
      errors.push(
        `${at}.curve must rise: level ${min + i} needs ${totals[i]}, no more than level ` +
          `${min + i - 1}'s ${totals[i - 1]}.`
      );
      return;
    }
  }
}

function checkGrant(grant, where, { system, errors, skillMax }) {
  if (!isObject(grant)) {
    errors.push(`${where} must be { attributePoints?, skillRanks?, traits?, attacks? }.`);
    return;
  }
  for (const key of Object.keys(grant)) {
    if (!GRANT_KEYS.includes(key)) {
      errors.push(`${where}: "${key}" isn't something a level grants (${GRANT_KEYS.join(', ')}).`);
    }
  }
  const sheet = system.sheet || {};
  const optional = new Set(sheet.optional || []);
  if (grant.attributePoints !== undefined && !whole(grant.attributePoints, 0, MAX_GRANT)) {
    errors.push(`${where}.attributePoints must be a whole number from 0 to ${MAX_GRANT}.`);
  }
  if (grant.skillRanks !== undefined) {
    if (!optional.has('skills')) errors.push(`${where}.skillRanks: this system has no skills.`);
    else if (!whole(grant.skillRanks, 0, MAX_GRANT)) {
      errors.push(`${where}.skillRanks must be a whole number from 0 to ${MAX_GRANT}.`);
    } else if (Number.isInteger(skillMax) && grant.skillRanks > skillMax) {
      errors.push(
        `${where}.skillRanks is ${grant.skillRanks}, past a skill's top rank (${skillMax}).`
      );
    }
  }
  if (grant.traits !== undefined) {
    const known = new Set(optional.has('traits') ? (sheet.traits || []).map((t) => t.id) : []);
    const t = grant.traits;
    if (!isObject(t) || !Array.isArray(t.from) || !t.from.length) {
      errors.push(`${where}.traits must be { from: [trait id], choose }.`);
    } else {
      t.from
        .filter((id) => !known.has(id))
        .forEach((id) =>
          errors.push(`${where}.traits.from: "${id}" isn't one of the system's traits.`)
        );
      if (!whole(t.choose, 1, t.from.length)) {
        errors.push(`${where}.traits.choose must be a whole number from 1 to ${t.from.length}.`);
      }
    }
  }
  if (grant.attacks !== undefined) {
    const a = grant.attacks;
    if (!isObject(a) || !Array.isArray(a.from) || !a.from.length) {
      errors.push(`${where}.attacks must be { from: [attack], choose }.`);
    } else {
      const attacks = require('../combat/attacks');
      attacks
        .validateAttacks(system, a.from, `${where}.attacks.from`)
        .forEach((e) => errors.push(e));
      if (!whole(a.choose, 1, a.from.length)) {
        errors.push(`${where}.attacks.choose must be a whole number from 1 to ${a.from.length}.`);
      }
    }
  }
}

function checkUse(use, { system, errors, at }) {
  if (!isObject(use)) {
    errors.push(`${at} must be { threshold?, skills?, attacks?, maxRank? }.`);
    return;
  }
  for (const key of Object.keys(use)) {
    if (!USE_KEYS.includes(key)) {
      errors.push(`${at}: "${key}" isn't part of improving by use (${USE_KEYS.join(', ')}).`);
    }
  }
  if (use.threshold !== undefined) {
    const ok = plainFormula(use.threshold, `${at}.threshold`, {
      system,
      errors,
      allowed: ['rank'],
      sample: { rank: 0 },
    });
    if (ok && typeof use.threshold === 'string') {
      const names = formula.check(use.threshold, { system, names: ['rank'] }).names;
      if (!names.includes('rank')) {
        errors.push(`${at}.threshold must be a formula of rank, so each step takes longer.`);
      } else if (valueOf(use.threshold, { rank: 0 }, system) < 1) {
        errors.push(`${at}.threshold must need at least one success at rank 0.`);
      }
    } else if (ok && use.threshold < 1) {
      errors.push(`${at}.threshold must need at least one success.`);
    }
  }
  for (const key of ['skills', 'attacks']) {
    if (use[key] !== undefined && typeof use[key] !== 'boolean') {
      errors.push(`${at}.${key} must be true or false.`);
    }
  }
  const optional = new Set((system.sheet || {}).optional || []);
  if (use.skills !== false && !optional.has('skills')) {
    errors.push(`${at}.skills: this system has no skills to improve (set skills: false).`);
  }
  if (use.maxRank !== undefined && !whole(use.maxRank, 1, TOP_RANK)) {
    errors.push(`${at}.maxRank must be a whole number from 1 to ${TOP_RANK}.`);
  }
}

/** What's wrong with a sheet's advancement fields, each named (§4.2). */
function validateSheetFields(system, sheet) {
  const errors = [];
  if (
    sheet.xp !== undefined &&
    !(Number.isFinite(sheet.xp) && sheet.xp >= 0 && sheet.xp <= MAX_XP)
  ) {
    errors.push('xp must be a number from 0.');
  }
  const counts = (map, where) => {
    if (map === undefined) return;
    if (!isObject(map)) return errors.push(`${where} must map each to a whole number.`);
    for (const [id, n] of Object.entries(map)) {
      if (!whole(n, 0, 1e6)) errors.push(`${where}.${id} must be a whole number from 0.`);
    }
  };
  if (sheet.uses !== undefined) {
    if (!isObject(sheet.uses)) errors.push('uses must be { skills, attacks }.');
    else {
      counts(sheet.uses.skills, 'uses.skills');
      counts(sheet.uses.attacks, 'uses.attacks');
    }
  }
  counts(sheet.attackRanks, 'attackRanks');
  void system;
  return errors;
}

module.exports = {
  PARTS,
  SIZES,
  DEFAULT_THRESHOLD,
  DEFAULT_ATTACK_MAX,
  TOP_RANK,
  isOn,
  settingsOf,
  totalFor,
  levelsReady,
  thresholdFor,
  grantFor,
  sheetWith,
  attackRankOf,
  rulesView,
  check,
  validateSheetFields,
};
