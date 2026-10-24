'use strict';

/**
 * Action points as data (planning/action-points.md §3 AP1, AP2, CT1, CT2,
 * KP2, MG1, §4.1, §4.2, §4.10; L-831 / #681): one pool pays for moving,
 * every action and every reaction. The game system sets it:
 *
 *   sheet.ap        a formula over the sheet: the pool a turn (in place of
 *                   speed; 20 when a system gives none), plus each held
 *                   trait's and each condition's `modifiers.ap`
 *   ap.costs        what each spend costs (COSTS below), any entry changed
 *   ap.tiers        { minor, standard, major }: typed actions by tier (L-835)
 *   ap.keepLimit    the most kept off your turn (L-833), or null for none
 *
 * and anything may change a price for itself:
 *
 *   an attack's `ap`                  its cost (a dagger 7, a greataxe 14)
 *   a door's or feature's `ap`        on a battle map (a rusted portcullis 10)
 *   a trait's or condition's `costs`  { [spend]: n | 'x2' }: a set cost, or
 *                                     a multiple (Light-footed makes
 *                                     difficult ground 1; Prone doubles
 *                                     movement)
 *
 * Systems written before AP had `sheet.speed`, traits' and conditions'
 * `modifiers.speed` and combat's `economy`; `convert` turns them into AP,
 * saying what it did. Pure.
 */

const conditions = require('./conditions');

const DEFAULT_POOL = 20;
const MAX_POOL = 200;
const MAX_COST = 200;

// What each spend costs by default (CT1), the same in both built-ins.
const COSTS = Object.freeze({
  move: 1, // a square of movement, diagonals the same
  difficult: 2, // a square of difficult ground
  door: 2, // opening or closing a door
  speak: 2, // a few words, or starting a conversation
  standUp: 5, // standing up from prone
  lock: 5, // trying a lock
  object: 5, // picking up, handing over or using an object
  withdraw: 5,
  defend: 5, // a defending reaction
  dodge: 8,
  attack: 10, // unless the attack has its own
});
const SPENDS = Object.keys(COSTS);

// Typed actions by tier (CT3; L-835).
const TIERS = Object.freeze({ minor: 3, standard: 10, major: 20 });
const TIER_NAMES = Object.keys(TIERS);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (n, max = MAX_COST) => Number.isInteger(n) && n >= 0 && n <= max;
const copyOf = (value) => JSON.parse(JSON.stringify(value));

/** A system's AP settings, its own over the defaults. */
function settingsOf(system) {
  const ap = (system && isObject(system.ap) && system.ap) || {};
  return {
    costs: { ...COSTS, ...(isObject(ap.costs) ? ap.costs : {}) },
    tiers: { ...TIERS, ...(isObject(ap.tiers) ? ap.tiers : {}) },
    keepLimit: whole(ap.keepLimit, MAX_POOL) ? ap.keepLimit : null,
  };
}

// A cost override: a whole number (set), or "x2" / "×2" / "*2" (a multiple).
const MULTIPLE = /^\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i;
function overrideOk(value) {
  if (whole(value)) return true;
  const m = typeof value === 'string' && MULTIPLE.exec(value);
  return Boolean(m) && Number(m[1]) > 0 && Number(m[1]) <= 10;
}
function applyOverride(cost, value) {
  if (whole(value)) return value;
  const m = typeof value === 'string' && MULTIPLE.exec(value);
  return m ? Math.ceil(cost * Number(m[1])) : cost;
}

/**
 * Why a `costs` override (a trait's or a condition's) won't do: errors
 * pushed on `errors`, `at` naming where it is.
 */
function checkCosts(costs, at, errors) {
  if (!isObject(costs)) {
    errors.push(`${at} must map a spend to a cost or a multiple ({ move: 'x2' }).`);
    return;
  }
  for (const [spend, value] of Object.entries(costs)) {
    if (!SPENDS.includes(spend)) {
      errors.push(`${at}: "${spend}" isn't something AP pays for (${SPENDS.join(', ')}).`);
    } else if (!overrideOk(value)) {
      errors.push(
        `${at}.${spend} must be a cost (a whole number from 0 to ${MAX_COST}) or a multiple ` +
          '("x2", up to x10).'
      );
    }
  }
}

/**
 * A system's `ap` block checked (on save, L-801): errors and warnings pushed.
 */
function check(system, { errors }) {
  const ap = system.ap;
  if (ap === undefined) return;
  if (!isObject(ap)) {
    errors.push('ap must be { costs?, tiers?, keepLimit? }.');
    return;
  }
  for (const key of Object.keys(ap)) {
    if (!['costs', 'tiers', 'keepLimit'].includes(key)) {
      errors.push(`ap: "${key}" isn't an AP setting (costs, tiers, keepLimit).`);
    }
  }
  if (ap.costs !== undefined) {
    if (!isObject(ap.costs)) errors.push('ap.costs must map each spend to its cost.');
    else {
      for (const [spend, value] of Object.entries(ap.costs)) {
        if (!SPENDS.includes(spend)) {
          errors.push(`ap.costs: "${spend}" isn't something AP pays for (${SPENDS.join(', ')}).`);
        } else if (!whole(value)) {
          errors.push(`ap.costs.${spend} must be a whole number from 0 to ${MAX_COST}.`);
        }
      }
    }
  }
  if (ap.tiers !== undefined) {
    if (!isObject(ap.tiers)) errors.push('ap.tiers must be { minor, standard, major }.');
    else {
      for (const [tier, value] of Object.entries(ap.tiers)) {
        if (!TIER_NAMES.includes(tier)) {
          errors.push(`ap.tiers: "${tier}" isn't a tier (${TIER_NAMES.join(', ')}).`);
        } else if (!whole(value)) {
          errors.push(`ap.tiers.${tier} must be a whole number from 0 to ${MAX_COST}.`);
        }
      }
      const t = settingsOf(system).tiers;
      if (t.minor > t.standard || t.standard > t.major) {
        errors.push('ap.tiers must rise: minor, then standard, then major.');
      }
    }
  }
  if (ap.keepLimit !== undefined && ap.keepLimit !== null && !whole(ap.keepLimit, MAX_POOL)) {
    errors.push(`ap.keepLimit must be a whole number from 0 to ${MAX_POOL}, or null for none.`);
  }
}

/** Whether an attack's, a door's or a feature's own `ap` will do. */
function ownCostOk(value) {
  return value === undefined || (Number.isInteger(value) && value >= 1 && value <= MAX_COST);
}

/**
 * A system written before AP, turned into one on AP (MG1): `sheet.speed`
 * becomes `sheet.ap`, `modifiers.speed` becomes `modifiers.ap`, and combat's
 * `economy` goes (AP pays for actions and reactions). Returns `{ system,
 * warnings }`: a copy, and what was changed, or the same one untouched.
 */
function convert(input) {
  if (!isObject(input)) return { system: input, warnings: [] };
  const warnings = [];
  let s = input;
  const touch = () => {
    if (s === input) s = copyOf(input);
    return s;
  };
  const sheet = isObject(input.sheet) ? input.sheet : null;
  if (sheet && sheet.speed !== undefined) {
    touch();
    if (s.sheet.ap === undefined) {
      s.sheet.ap = s.sheet.speed;
      warnings.push(
        'sheet.speed is now sheet.ap, the pool of action points a turn (L-830): moved there, ' +
          'at the same number. A square of movement costs 1 AP, so movement is as it was.'
      );
    } else {
      warnings.push('sheet.speed is retired (L-830): sheet.ap is the pool; speed dropped.');
    }
    delete s.sheet.speed;
  }
  for (const part of ['traits', 'conditions']) {
    ((sheet && Array.isArray(sheet[part]) && sheet[part]) || []).forEach((item, i) => {
      if (!isObject(item) || !isObject(item.modifiers) || item.modifiers.speed === undefined) {
        return;
      }
      touch();
      const mods = s.sheet[part][i].modifiers;
      if (mods.ap === undefined) mods.ap = mods.speed;
      delete mods.speed;
      warnings.push(
        `sheet.${part}[${i}] (${item.id}): modifiers.speed is now modifiers.ap, the same number ` +
          'added to the pool (L-830).'
      );
    });
  }
  const combat = isObject(input.modules) && isObject(input.modules.combat) && input.modules.combat;
  if (combat && combat.economy !== undefined) {
    touch();
    const e = combat.economy;
    delete s.modules.combat.economy;
    const unusual =
      isObject(e) &&
      ((e.actions !== undefined && e.actions !== 1) ||
        (e.reactions !== undefined && e.reactions !== 1) ||
        (e.quick !== undefined && e.quick !== 0));
    warnings.push(
      'modules.combat.economy is retired (L-830): every action and reaction is paid in AP, ' +
        'from ap.costs.' +
        (unusual
          ? " Its actions, reactions or quick actions per turn weren't one each: set ap.costs " +
            'so a turn affords what it should.'
          : '')
    );
  }
  return { system: s, warnings };
}

// The modifiers and cost overrides a character's held traits and current
// conditions bring: [{ ap?, costs? }].
function bringsOf(system, sheet, conditionsHeld) {
  const out = [];
  const traits = new Set((sheet && Array.isArray(sheet.traits) && sheet.traits) || []);
  for (const trait of (system && system.sheet && system.sheet.traits) || []) {
    if (traits.has(trait.id) && isObject(trait.costs)) out.push(trait.costs);
  }
  for (const condition of conditionsHeld || []) {
    if (condition && isObject(condition.costs)) out.push(condition.costs);
  }
  return out;
}

/**
 * What a spend costs a character (CT2): the system's cost (or the attack's,
 * door's or feature's own), then each held trait's and condition's override
 * for it, set costs first, then multiples. `spend` is one of SPENDS; `own`
 * the thing's own `ap`, if any; `conditionsHeld` the system's conditions on
 * the character (./conditions.js activeOn).
 */
function costOf(system, sheet, spend, { own, conditionsHeld } = {}) {
  let cost = Number.isInteger(own) ? own : settingsOf(system).costs[spend];
  if (cost === undefined) return null;
  const overrides = bringsOf(system, sheet, conditionsHeld)
    .map((costs) => costs[spend])
    .filter((v) => v !== undefined);
  overrides
    .filter((v) => whole(v))
    .forEach((v) => {
      cost = v;
    });
  overrides
    .filter((v) => !whole(v))
    .forEach((v) => {
      cost = applyOverride(cost, v);
    });
  return cost;
}

/**
 * A character's prices (L-832): `of(spend, own)` what a spend costs them,
 * with their traits and current conditions; `move`, `difficult` and
 * `door(door)` (its own `ap` first) for the paths on a battle map
 * (layers.pathOptions).
 */
function pricesOf(system, sheet) {
  const held = conditions.activeOn(system, sheet).map((a) => a.condition);
  const of = (spend, own) => costOf(system, sheet, spend, { own, conditionsHeld: held });
  return {
    of,
    move: of('move'),
    difficult: of('difficult'),
    door: (door) => of('door', door && door.ap),
  };
}

/**
 * The line for an action AP can't pay for (CT4): "An attack costs 10 AP;
 * you have 6."
 */
function shortLine(what, cost, left) {
  return `${what.charAt(0).toUpperCase() + what.slice(1)} costs ${cost} AP; you have ${left}.`;
}

/** What a typed action of a tier costs (CT3): standard for any other. */
function tierCost(system, tier) {
  const tiers = settingsOf(system).tiers;
  return tiers[TIER_NAMES.includes(tier) ? tier : 'standard'];
}

module.exports = {
  COSTS,
  SPENDS,
  TIERS,
  TIER_NAMES,
  DEFAULT_POOL,
  MAX_POOL,
  MAX_COST,
  settingsOf,
  check,
  checkCosts,
  ownCostOk,
  convert,
  costOf,
  pricesOf,
  shortLine,
  tierCost,
};
