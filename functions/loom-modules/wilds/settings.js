'use strict';

/**
 * The wilds module's settings (planning/off-road-travel.md §4.3, MD1; L-362 /
 * #836): a system's `modules.wilds`, checked when the system is saved
 * (L-801), with a world's own over them (`world.rules.wilds`).
 *
 *   pace         map distance units an hour off the road at speed 1 (1.5:
 *                miles, on foot); a terrain's speed multiplies it (L-361)
 *   dayHours     the hours of a day's travel off the road (1–24); unset, the
 *                world's travel day (L-370, clock.timeRules: 8)
 *   eventChance  the base chance of an event each day leg (0.25), before
 *                terrain and region danger (EV7); at most 0.95
 *   routeChance  the share of the event chance a leg walked on a route keeps
 *                (0.2: a fifth as likely as off the road; 0 to 1; a leg part
 *                on a route, part off, by the hours of each; L-364)
 *   discover     how near a leg's path, in map distance units, a place is
 *                discovered (3; TR7)
 *   navigation   the check that keeps a traveller on course each day leg
 *                off the road (MD2), or null: nobody gets lost.
 *                { check, dc, harder, lost }:
 *                  check   { skill } or { attribute }: what is rolled
 *                  dc      the rung on the system's ladder it is rolled
 *                          against in terrain of danger 1
 *                  harder  how much danger above 1 makes it a rung harder
 *                          (0.5: danger 1.5 one rung, 2 two); null, never
 *                  lost    the share of the day lost by degree, from 0 to 1
 *                          (none on a success; successAtCost 0.125, an hour
 *                          of eight; failure 0.25; criticalFailure 0.5)
 *
 * Left out, a system travels off the road by the defaults with no
 * navigation check; `false`, by the system or the world, turns off-road
 * travel off. A world's `rules.wilds` changes any setting, `navigation` by
 * its own parts.
 *
 * Pure.
 */

const KEYS = ['pace', 'dayHours', 'eventChance', 'routeChance', 'discover', 'navigation'];
const NAVIGATION_KEYS = ['check', 'dc', 'harder', 'lost'];
const DEGREES = ['criticalSuccess', 'success', 'successAtCost', 'failure', 'criticalFailure'];

const DEFAULTS = Object.freeze({
  pace: 1.5,
  eventChance: 0.25,
  routeChance: 0.2,
  discover: 3,
  harder: 0.5,
  lost: Object.freeze({
    criticalSuccess: 0,
    success: 0,
    successAtCost: 0.125,
    failure: 0.25,
    criticalFailure: 0.5,
  }),
});
// The most a day leg's event chance may be (EV7).
const MAX_CHANCE = 0.95;
// The travel day when no world says (clock.js DEFAULT_RULES).
const TRAVEL_DAY = 8;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** A world's settings over a system's: each key replaced, navigation part by part. */
function merged(own, theirs) {
  const out = { ...own };
  for (const [key, value] of Object.entries(theirs || {})) {
    out[key] =
      key === 'navigation' && isObject(value) && isObject(own.navigation)
        ? { ...own.navigation, ...value }
        : value;
  }
  return out;
}

/** Whether off-road travel is off: by the system (`modules.wilds: false`) or the world. */
function isOff(system, world) {
  const own = system && system.modules && system.modules.wilds;
  const theirs = world && world.rules && world.rules.wilds;
  return own === false || theirs === false;
}

/**
 * The settings in play, with the defaults filled in: the system's
 * `modules.wilds` with the world's `rules.wilds` over it; or null when
 * off-road travel is off.
 */
function settingsOf(system, world) {
  if (isOff(system, world)) return null;
  const own = (system && system.modules && system.modules.wilds) || {};
  const theirs = (world && world.rules && world.rules.wilds) || {};
  const given = merged(isObject(own) ? own : {}, isObject(theirs) ? theirs : {});
  const positive = (n) => Number.isFinite(n) && n > 0;
  return {
    pace: positive(given.pace) ? given.pace : DEFAULTS.pace,
    dayHours: positive(given.dayHours) ? given.dayHours : travelDayOf(world),
    eventChance: Number.isFinite(given.eventChance)
      ? Math.max(0, Math.min(MAX_CHANCE, given.eventChance))
      : DEFAULTS.eventChance,
    routeChance: Number.isFinite(given.routeChance)
      ? Math.max(0, Math.min(1, given.routeChance))
      : DEFAULTS.routeChance,
    discover:
      Number.isFinite(given.discover) && given.discover >= 0 ? given.discover : DEFAULTS.discover,
    navigation: navigationOf(system, given.navigation),
  };
}

// The world's travel day (L-370), or eight hours.
function travelDayOf(world) {
  if (!world) return TRAVEL_DAY;
  try {
    return require('../../loom-canon/clock').timeRules(world).travelDayHours || TRAVEL_DAY;
  } catch {
    return TRAVEL_DAY;
  }
}

// The navigation check with its defaults, or null: nobody gets lost.
function navigationOf(system, given) {
  if (!isObject(given) || !isObject(given.check)) return null;
  const ladder = (system && system.checks && system.checks.ladder) || [];
  const dc = ladder.some((r) => r.name === given.dc)
    ? given.dc
    : (ladder[Math.min(1, ladder.length - 1)] || {}).name || null;
  const lost = { ...DEFAULTS.lost };
  if (isObject(given.lost)) {
    for (const d of DEGREES) {
      if (Number.isFinite(given.lost[d])) lost[d] = Math.max(0, Math.min(1, given.lost[d]));
    }
  }
  return {
    check: given.check.skill ? { skill: given.check.skill } : { attribute: given.check.attribute },
    dc,
    harder:
      given.harder === null
        ? null
        : Number.isFinite(given.harder) && given.harder > 0
          ? given.harder
          : DEFAULTS.harder,
    lost,
  };
}

/**
 * Checks `modules.wilds` (or a world's `rules.wilds`, `at` naming it)
 * against the system: pushes onto `errors`.
 */
function check(settings, { system, errors, at = 'modules.wilds', partial = false }) {
  if (settings === false) return;
  if (!isObject(settings)) {
    errors.push(`${at} must be the wilds module's settings, or false: no off-road travel.`);
    return;
  }
  for (const key of Object.keys(settings)) {
    if (!KEYS.includes(key)) {
      errors.push(`${at}: "${key}" isn't a wilds setting (${KEYS.join(', ')}).`);
    }
  }
  const number = (key, lo, hi, what, { above = false } = {}) => {
    if (!has(settings, key)) return;
    const n = settings[key];
    if (!Number.isFinite(n) || (above ? n <= lo : n < lo) || n > hi) {
      errors.push(`${at}.${key} must be ${what}.`);
    }
  };
  number('pace', 0, 100, 'a number of distance units an hour, above 0 and at most 100', {
    above: true,
  });
  number('dayHours', 1, 24, 'a number of hours from 1 to 24');
  number('eventChance', 0, MAX_CHANCE, `a chance from 0 to ${MAX_CHANCE}`);
  number('routeChance', 0, 1, 'a share from 0 to 1 of the event chance kept on a route');
  number('discover', 0, 100, 'a distance from 0 to 100');
  if (has(settings, 'navigation')) {
    checkNavigation(settings.navigation, {
      system,
      errors,
      at: `${at}.navigation`,
      partial,
    });
  }
}

// `partial`: a world's change to its system's check, which may leave the check out.
function checkNavigation(nav, { system, errors, at, partial }) {
  if (nav === null) return;
  if (!isObject(nav)) {
    errors.push(`${at} must be { check, dc, harder?, lost? }, or null: nobody gets lost.`);
    return;
  }
  for (const key of Object.keys(nav)) {
    if (!NAVIGATION_KEYS.includes(key)) {
      errors.push(`${at}: "${key}" isn't part of the check (${NAVIGATION_KEYS.join(', ')}).`);
    }
  }
  const sheet = (system && system.sheet) || {};
  const skillsOn = (sheet.optional || []).includes('skills');
  const skills = new Set((skillsOn ? sheet.skills || [] : []).map((k) => k && k.id));
  const attributes = new Set((sheet.attributes || []).map((a) => a && a.id));
  const rungs = (((system && system.checks) || {}).ladder || []).map((r) => r && r.name);
  const c = nav.check;
  if (has(nav, 'check') || !partial) {
    if (!isObject(c) || (!c.skill && !c.attribute)) {
      errors.push(`${at}.check must be { skill } or { attribute }.`);
    } else if (c.skill !== undefined && !skills.has(c.skill)) {
      errors.push(`${at}.check.skill "${c.skill}" isn't one of the system's skills.`);
    } else if (c.skill === undefined && !attributes.has(c.attribute)) {
      errors.push(`${at}.check.attribute "${c.attribute}" isn't one of the system's attributes.`);
    }
  }
  if (has(nav, 'dc') && !rungs.includes(nav.dc)) {
    errors.push(`${at}.dc must be a rung on the ladder (${rungs.join(', ')}).`);
  }
  if (has(nav, 'harder') && nav.harder !== null) {
    if (!Number.isFinite(nav.harder) || nav.harder <= 0 || nav.harder > 1.5) {
      errors.push(
        `${at}.harder must be the danger above 1 that makes it a rung harder (above 0, ` +
          'at most 1.5), or null: never harder.'
      );
    }
  }
  if (has(nav, 'lost')) {
    if (!isObject(nav.lost)) errors.push(`${at}.lost must map degrees to a share of the day.`);
    else {
      for (const [degree, share] of Object.entries(nav.lost)) {
        if (!DEGREES.includes(degree)) {
          errors.push(`${at}.lost: "${degree}" isn't a degree (${DEGREES.join(', ')}).`);
        } else if (!Number.isFinite(share) || share < 0 || share > 1) {
          errors.push(`${at}.lost.${degree} must be a share of the day from 0 to 1.`);
        }
      }
    }
  }
}

/**
 * Checks a world's `rules.wilds` against its system: the override itself,
 * then the system's settings with it over them. Returns the errors.
 */
function checkOverride(override, system) {
  const errors = [];
  if (override === false || override === null) return errors;
  const own = system && system.modules && system.modules.wilds;
  // Changing the system's own check, the check may be left out.
  const partial = isObject(own) && isObject(own.navigation);
  check(override, { system, errors, at: 'rules.wilds', partial });
  return errors;
}

module.exports = {
  KEYS,
  NAVIGATION_KEYS,
  DEFAULTS,
  MAX_CHANCE,
  merged,
  isOff,
  settingsOf,
  check,
  checkOverride,
};
