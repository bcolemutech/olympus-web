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
 *   attack      how an attack hits and what its degree does (L-822; AT1, AT2):
 *               { hit: 'defence', defence }  the attack's roll against the
 *                 target's `defence`, a formula of their sheet ("Armour", a
 *                 derived value), read as a check's degree; or
 *               { hit: 'opposed', defend }   against the target's own roll,
 *                 `defend`, a formula of their sheet: the higher wins, ties
 *                 to the defender (checks.ties);
 *               critical: 'doubleDice' (a critical doubles the damage dice)
 *               or 'none'; extraSuccesses: 'addDie' (each success past what
 *               was needed adds a die of damage) or 'none'. A success at a
 *               cost is a plain hit for now (decided 2026-10-21).
 *               With none: against the ladder's second rung.
 *   damageTypes [{ id, name }]          the kinds of damage (AT3); traits and
 *               conditions resist (half) or are weak to (double) them
 *   health      the resource damage comes off (default 'health', else the first)
 *   subduePenalty  a formula added to a lethal attack's roll when striking to
 *               knock out (DF4), "-4"
 *   unarmed     the attack every fighter has (./attacks.js), unless their
 *               sheet lists one of its id
 *   attacks     the attacks a player character starts with until L-770's
 *               weapons (decided 2026-10-21)
 *   morale      { check, rungs } (L-824; EN4): when half a side is down or its
 *               leader falls, each of the rest rolls `check` ({ skill } or
 *               { attribute }) at the rung for their posture (`rungs`:
 *               { cowardly, cautious, steady, bold, reckless }, each a rung's
 *               name, or null: never breaks); failing, they flee or surrender.
 *               With none, nobody breaks.
 *
 * The rest of §4.1 (cover, flanking, down, rests) is read by the stories
 * that use it (L-823, L-827): kept as given until then, with a warning.
 *
 * Pure. `formula(value, where)` is the system check's own formula collector,
 * so the formulas here are checked with the rest of the system's.
 */

const KEYS = [
  'initiative',
  'economy',
  'surprise',
  'attack',
  'damageTypes',
  'health',
  'subduePenalty',
  'unarmed',
  'attacks',
  'morale',
];
const LATER = {
  cover: 'L-823',
  flanking: 'L-823',
  down: 'L-827',
  rests: 'L-827',
};
const ECONOMY = { actions: [1, 1, 5], reactions: [1, 0, 5], quick: [0, 0, 5] };
const DEFAULT_INITIATIVE = '1d20';

const HITS = ['defence', 'opposed'];
const CRITICALS = ['doubleDice', 'none'];
const EXTRAS = ['addDie', 'none'];
const TYPE_ID = /^[a-z][a-z0-9_-]{0,31}$/;

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
    attack: attackOf(system, given.attack),
    health: healthOf(system, given.health),
    subduePenalty: given.subduePenalty === undefined ? null : given.subduePenalty,
    morale: isObject(given.morale) && isObject(given.morale.check) ? given.morale : null,
  };
}

// How attacks hit, with the defaults: against the ladder's second rung.
function attackOf(system, given) {
  const a = isObject(given) ? given : {};
  const ladder = (system && system.checks && system.checks.ladder) || [];
  const rung = ladder[Math.min(1, ladder.length - 1)];
  return {
    hit: HITS.includes(a.hit) ? a.hit : 'defence',
    defence: a.defence !== undefined ? a.defence : rung ? rung.value : 10,
    defend: a.defend || null,
    critical: CRITICALS.includes(a.critical) ? a.critical : 'none',
    extraSuccesses: EXTRAS.includes(a.extraSuccesses) ? a.extraSuccesses : 'none',
  };
}

// The resource damage comes off.
function healthOf(system, given) {
  const resources = ((system && system.sheet) || {}).resources || [];
  if (given && resources.some((r) => r.id === given)) return given;
  if (resources.some((r) => r.id === 'health')) return 'health';
  return resources.length ? resources[0].id : null;
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

  // Attacks (L-822).
  const attack = settings.attack;
  if (attack !== undefined) {
    if (!isObject(attack)) errors.push(`${at}.attack must be { hit, defence | defend, ... }.`);
    else {
      if (!HITS.includes(attack.hit)) {
        errors.push(`${at}.attack.hit must be one of ${HITS.join(', ')}.`);
      } else if (attack.hit === 'defence') {
        if (attack.defence === undefined) {
          errors.push(`${at}.attack.defence is needed: the target's defence, a formula.`);
        } else formula(attack.defence, `${at}.attack.defence`);
      } else if (attack.defend === undefined) {
        errors.push(`${at}.attack.defend is needed: the target's roll, a formula.`);
      } else formula(attack.defend, `${at}.attack.defend`);
      if (attack.critical !== undefined && !CRITICALS.includes(attack.critical)) {
        errors.push(`${at}.attack.critical must be one of ${CRITICALS.join(', ')}.`);
      }
      if (attack.extraSuccesses !== undefined && !EXTRAS.includes(attack.extraSuccesses)) {
        errors.push(`${at}.attack.extraSuccesses must be one of ${EXTRAS.join(', ')}.`);
      }
      const extra = Object.keys(attack).filter(
        (k) => !['hit', 'defence', 'defend', 'critical', 'extraSuccesses'].includes(k)
      );
      if (extra.length) errors.push(`${at}.attack: "${extra[0]}" isn't part of how attacks hit.`);
    }
  }
  const types = settings.damageTypes;
  if (types !== undefined) {
    if (!Array.isArray(types) || types.length > 30) {
      errors.push(`${at}.damageTypes must be a list of at most 30 { id, name }.`);
    } else {
      const ids = new Set();
      types.forEach((t, i) => {
        if (!isObject(t) || typeof t.id !== 'string' || !TYPE_ID.test(t.id)) {
          errors.push(`${at}.damageTypes[${i}].id must be lowercase letters, digits, - and _.`);
        } else if (ids.has(t.id))
          errors.push(`${at}.damageTypes[${i}].id "${t.id}" is used twice.`);
        else ids.add(t.id);
        if (!isObject(t) || typeof t.name !== 'string' || !t.name.trim()) {
          errors.push(`${at}.damageTypes[${i}].name is required.`);
        }
      });
    }
  }
  const resources = new Set((sheet.resources || []).map((r) => r && r.id));
  if (settings.health !== undefined && !resources.has(settings.health)) {
    errors.push(`${at}.health "${settings.health}" isn't one of the system's resources.`);
  }
  if (settings.subduePenalty !== undefined) {
    formula(settings.subduePenalty, `${at}.subduePenalty`);
  }
  // Morale (L-824).
  const morale = settings.morale;
  if (morale !== undefined) {
    const { POSTURES } = require('./figures');
    const rungs = new Set((((system && system.checks) || {}).ladder || []).map((r) => r && r.name));
    if (!isObject(morale)) errors.push(`${at}.morale must be { check, rungs }.`);
    else {
      const c = morale.check;
      if (!isObject(c) || (!c.skill && !c.attribute)) {
        errors.push(`${at}.morale.check must be { skill } or { attribute }.`);
      } else if (c.skill !== undefined && !skills.has(c.skill)) {
        errors.push(`${at}.morale.check.skill "${c.skill}" isn't one of the system's skills.`);
      } else if (c.attribute !== undefined && !attributes.has(c.attribute)) {
        errors.push(
          `${at}.morale.check.attribute "${c.attribute}" isn't one of the system's attributes.`
        );
      }
      if (!isObject(morale.rungs)) {
        errors.push(`${at}.morale.rungs must map each posture to a rung (or null: never breaks).`);
      } else {
        for (const [posture, rung] of Object.entries(morale.rungs)) {
          if (!POSTURES.includes(posture)) {
            errors.push(
              `${at}.morale.rungs: "${posture}" isn't a posture (${POSTURES.join(', ')}).`
            );
          } else if (rung !== null && !rungs.has(rung)) {
            errors.push(`${at}.morale.rungs.${posture}: "${rung}" isn't a rung on the ladder.`);
          }
        }
      }
    }
  }
  // The attacks themselves are checked against the system once its shape is
  // known (./attacks.js; its formulas need the sheet's fields).
  const attacks = require('./attacks');
  if (settings.unarmed !== undefined) {
    if (!isObject(settings.unarmed)) errors.push(`${at}.unarmed must be an attack.`);
    else {
      const unarmed = { ...attacks.UNARMED, ...settings.unarmed };
      attacks.validateAttack(system, unarmed, `${at}.unarmed`).forEach((e) => errors.push(e));
    }
  }
  if (settings.attacks !== undefined) {
    attacks
      .validateAttacks(system, settings.attacks, `${at}.attacks`)
      .forEach((e) => errors.push(e));
  }
}

module.exports = { KEYS, LATER, HITS, DEFAULT_INITIATIVE, settingsOf, check };
