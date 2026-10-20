'use strict';

/**
 * The combat module's settings (planning/combat.md §4.1; L-821 / #653): a
 * system's `modules.combat`, checked when the system is saved (L-801).
 *
 *   initiative  { formula, tieBreak }   rolled once when a fight starts; a
 *               sheet formula ("1d20 + mod(DEX)"), ties broken by the higher
 *               score in `tieBreak` (an attribute), then the player
 *   economy     { actions, reactions, quick? }  per turn: actions (default 1),
 *               reactions per round (default 1), quick actions (default 0)
 *   surprise    { hide, notice }        each { skill } or { attribute }: an
 *               ambushed side rolls `notice` against the ambushers' `hide`;
 *               with none, nobody is surprised
 *
 * The rest of §4.1 (attack, damageTypes, cover, flanking, subduePenalty,
 * down, rests, morale) is read by the stories that use it (L-822 to L-827):
 * kept as given until then, with a warning.
 *
 * Pure. `formula(value, where)` is the system check's own formula collector,
 * so the formulas here are checked with the rest of the system's.
 */

const KEYS = ['initiative', 'economy', 'surprise'];
const LATER = {
  attack: 'L-822',
  damageTypes: 'L-822',
  subduePenalty: 'L-822',
  cover: 'L-823',
  flanking: 'L-823',
  morale: 'L-824',
  down: 'L-827',
  rests: 'L-827',
};
const ECONOMY = { actions: [1, 1, 5], reactions: [1, 0, 5], quick: [0, 0, 5] };
const DEFAULT_INITIATIVE = '1d20';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The settings with their defaults filled in (none set: a d20, one action, one reaction). */
function settingsOf(system) {
  const given = (system && system.modules && system.modules.combat) || {};
  const economy = {};
  for (const [key, [fallback]] of Object.entries(ECONOMY)) {
    economy[key] = Number.isInteger((given.economy || {})[key]) ? given.economy[key] : fallback;
  }
  return {
    initiative: {
      formula: (given.initiative && given.initiative.formula) || DEFAULT_INITIATIVE,
      tieBreak: (given.initiative && given.initiative.tieBreak) || null,
    },
    economy,
    surprise: isObject(given.surprise) ? given.surprise : null,
  };
}

/**
 * Checks `modules.combat` against the system: pushes onto `errors` and
 * `warnings`, and hands each formula to `formula(value, where)`.
 */
function check(settings, { system, errors, warnings, formula }) {
  const at = 'modules.combat';
  if (!isObject(settings)) {
    errors.push(`${at} must be an object of the combat module's settings.`);
    return;
  }
  const sheet = (system && system.sheet) || {};
  const attributes = new Set((sheet.attributes || []).map((a) => a && a.id));
  const skills = new Set(
    ((sheet.optional || []).includes('skills') ? sheet.skills || [] : []).map((k) => k && k.id)
  );
  for (const key of Object.keys(settings)) {
    if (LATER[key]) {
      warnings.push(`${at}.${key} is used from ${LATER[key]}; it is kept, unused.`);
    } else if (!KEYS.includes(key)) {
      errors.push(
        `${at}: "${key}" isn't a combat setting (${KEYS.concat(Object.keys(LATER)).join(', ')}).`
      );
    }
  }

  const initiative = settings.initiative;
  if (initiative !== undefined) {
    if (!isObject(initiative)) {
      errors.push(`${at}.initiative must be { formula, tieBreak? }.`);
    } else {
      formula(initiative.formula, `${at}.initiative.formula`);
      if (initiative.tieBreak !== undefined && !attributes.has(initiative.tieBreak)) {
        errors.push(
          `${at}.initiative.tieBreak "${initiative.tieBreak}" isn't one of the system's attributes.`
        );
      }
    }
  }

  const economy = settings.economy;
  if (economy !== undefined) {
    if (!isObject(economy)) errors.push(`${at}.economy must be { actions, reactions, quick? }.`);
    else {
      for (const key of Object.keys(economy)) {
        const range = ECONOMY[key];
        if (!range) {
          errors.push(`${at}.economy: "${key}" isn't part of a turn (actions, reactions, quick).`);
        } else if (
          !Number.isInteger(economy[key]) ||
          economy[key] < range[1] ||
          economy[key] > range[2]
        ) {
          errors.push(
            `${at}.economy.${key} must be a whole number from ${range[1]} to ${range[2]}.`
          );
        }
      }
    }
  }

  const surprise = settings.surprise;
  if (surprise !== undefined) {
    if (!isObject(surprise)) errors.push(`${at}.surprise must be { hide, notice }.`);
    else {
      for (const side of ['hide', 'notice']) {
        const rolled = surprise[side];
        const where = `${at}.surprise.${side}`;
        if (!isObject(rolled) || (!rolled.skill && !rolled.attribute)) {
          errors.push(`${where} must be { skill } or { attribute }.`);
        } else if (rolled.skill !== undefined && !skills.has(rolled.skill)) {
          errors.push(`${where}.skill "${rolled.skill}" isn't one of the system's skills.`);
        } else if (rolled.attribute !== undefined && !attributes.has(rolled.attribute)) {
          errors.push(
            `${where}.attribute "${rolled.attribute}" isn't one of the system's attributes.`
          );
        }
      }
    }
  }
}

module.exports = { KEYS, LATER, DEFAULT_INITIATIVE, settingsOf, check };
