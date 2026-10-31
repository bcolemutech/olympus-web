'use strict';

/**
 * Taking a level (planning/advancement.md §4.4, LV2–LV4; L-843 / #715): a
 * level earned is taken at the next long rest, through a guided level-up
 * like making a character. The player chooses its grants; the GM suggests.
 *
 *   offerOf(system, sheet)        the next level's grants and their limits,
 *                                 or null with none ready
 *   check(system, sheet, choices) what's wrong with the choices, each named
 *   take(system, sheet, choices)  the sheet a level up: `level` raised, the
 *                                 grants applied, resources raised by what
 *                                 their maxima rose (d20 hit points)
 *   fallback(system, sheet)       a suggestion that passes check, for when
 *                                 the GM's doesn't
 *
 * Choices: `{ attributes?: { [id]: points }, skills?: { [id]: ranks },
 * traits?: [id], attacks?: [id] }`, spending exactly what the level grants.
 * Limits are creation's (L-812): a score's range, a skill's top rank
 * (`experience.skillMax`, AR4), a trait or attack from the grant's list and
 * not already held.
 *
 * Pure.
 */

const sheets = require('../../loom-canon/sheets');
const attacks = require('../combat/attacks');
const advancement = require('./index');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (n) => Number.isInteger(n) && n >= 0;
const skillsOn = (system) => ((system.sheet || {}).optional || []).includes('skills');

// What a grant's lists hold, by id.
const traitsIn = (system, grant) =>
  grant.traits
    ? grant.traits.from.map(
        (id) => (system.sheet.traits || []).find((t) => t.id === id) || { id, name: id }
      )
    : [];
const attacksIn = (grant) => (grant.attacks ? grant.attacks.from : []);

/**
 * The next level's offer (LV2): `{ level, grants: { attributePoints,
 * skillRanks, traits: { choose, from: [{ id, name, description? }] },
 * attacks: { choose, from: [{ id, name }] } }, limits: { attributes: [{ id,
 * name, score, max }], skills: [{ id, name, rank, max }] } }`, a list left
 * out when the level grants none of it; null with no level ready.
 */
function offerOf(system, sheet, world = null) {
  if (!sheet || advancement.levelsReady(system, sheet, world) < 1) return null;
  const level = sheet.level + 1;
  const grant = advancement.grantFor(system, level);
  const { experience } = advancement.settingsOf(system);
  const held = new Set(sheet.traits || []);
  const own = new Set(attacks.attacksOf(system, sheet, { player: true }).map((a) => a.id));
  const grants = {};
  const limits = {};
  if (grant.attributePoints) {
    grants.attributePoints = grant.attributePoints;
    limits.attributes = system.sheet.attributes.map((a) => ({
      id: a.id,
      name: a.name,
      score: (sheet.attributes || {})[a.id],
      max: a.max,
    }));
  }
  if (grant.skillRanks && skillsOn(system)) {
    grants.skillRanks = grant.skillRanks;
    limits.skills = (system.sheet.skills || []).map((k) => ({
      id: k.id,
      name: k.name,
      rank: (sheet.skills || {})[k.id] || 0,
      max: experience.skillMax,
    }));
  }
  if (grant.traits) {
    const from = traitsIn(system, grant).filter((t) => !held.has(t.id));
    if (from.length) {
      grants.traits = {
        choose: Math.min(grant.traits.choose, from.length),
        from: from.map((t) => ({
          id: t.id,
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
        })),
      };
    }
  }
  if (grant.attacks) {
    const from = attacksIn(grant).filter((a) => !own.has(a.id));
    if (from.length) {
      grants.attacks = {
        choose: Math.min(grant.attacks.choose, from.length),
        from: from.map((a) => ({ id: a.id, name: a.name })),
      };
    }
  }
  return { level, grants, limits };
}

/** What's wrong with level-up choices for this sheet, each named; empty when they're good. */
function check(system, sheet, choices, world = null) {
  const offer = offerOf(system, sheet, world);
  if (!offer) return ['No level is ready to take.'];
  if (!isObject(choices)) return ['Choose what the level gives.'];
  const errors = [];
  const { grants, limits } = offer;
  for (const key of Object.keys(choices)) {
    if (!['attributes', 'skills', 'traits', 'attacks'].includes(key)) {
      errors.push(`"${key}" isn't something a level gives.`);
    }
  }

  // Points spent on scores or ranks: exactly the grant, each within its limit.
  const spend = (given, granted, list, what, one, current) => {
    const unit = one + 's';
    const count = (n) => n + ' ' + (n === 1 ? one : unit);
    const picked = given === undefined ? {} : given;
    if (!isObject(picked)) return errors.push(`${what} must map each to its ${unit}.`);
    const byId = new Map((list || []).map((x) => [x.id, x]));
    let total = 0;
    for (const [id, n] of Object.entries(picked)) {
      const x = byId.get(id);
      if (!x) {
        errors.push(
          granted
            ? `There is no ${what.replace(/s$/, '')} "${id}" to raise.`
            : `This level gives no ${unit}.`
        );
        continue;
      }
      if (!whole(n)) {
        errors.push(`${x.name}: ${n} isn't a whole number of ${unit}.`);
        continue;
      }
      total += n;
      const now = current(x);
      if (now + n > x.max) {
        errors.push(`${x.name} would be ${now + n}; it can be at most ${x.max}.`);
      }
    }
    if (granted && total !== granted) {
      errors.push(`Spend ${count(granted)}: ${total} chosen.`);
    } else if (!granted && total) errors.push(`This level gives no ${unit}.`);
    return undefined;
  };
  spend(
    choices.attributes,
    grants.attributePoints || 0,
    limits.attributes,
    'attributes',
    'attribute point',
    (a) => a.score
  );
  spend(
    choices.skills,
    grants.skillRanks || 0,
    limits.skills,
    'skills',
    'skill rank',
    (k) => k.rank
  );

  // Picks from a list: exactly `choose`, from it, none twice.
  const pick = (given, granted, what) => {
    const picked = given === undefined ? [] : given;
    if (!Array.isArray(picked)) return errors.push(`${what} must be a list of ids.`);
    if (!granted) {
      if (picked.length) errors.push(`This level gives no ${what}.`);
      return undefined;
    }
    if (new Set(picked).size !== picked.length)
      errors.push(`A ${what.replace(/s$/, '')} is chosen twice.`);
    picked
      .filter((id) => !granted.from.some((x) => x.id === id))
      .forEach((id) => errors.push(`"${id}" isn't one of the ${what} to choose from.`));
    if (picked.length !== granted.choose) {
      errors.push(`Choose ${granted.choose} ${what}: ${picked.length} chosen.`);
    }
    return undefined;
  };
  pick(choices.traits, grants.traits, 'traits');
  pick(choices.attacks, grants.attacks, 'attacks');
  return errors;
}

/**
 * The sheet a level up (LV2, LV3): `level` raised, scores and ranks raised,
 * traits and attacks added (a player's first own attack keeps the starting
 * ones it had), and each resource raised by what its maximum rose. Returns
 * `{ sheet, errors }`; with errors, `sheet` is null.
 */
function take(system, sheet, choices, world = null) {
  const errors = check(system, sheet, choices, world);
  if (errors.length) return { sheet: null, errors };
  const grant = advancement.grantFor(system, sheet.level + 1);
  const before = sheets.maxima(system, sheet);
  const out = JSON.parse(JSON.stringify(sheet));
  delete out.levelsReady;
  out.level = sheet.level + 1;
  for (const [id, n] of Object.entries(choices.attributes || {})) {
    out.attributes[id] = (out.attributes[id] || 0) + n;
  }
  for (const [id, n] of Object.entries(choices.skills || {})) {
    out.skills[id] = (out.skills[id] || 0) + n;
  }
  if ((choices.traits || []).length) out.traits = [...(out.traits || []), ...choices.traits];
  if ((choices.attacks || []).length) {
    const unarmed = attacks.unarmedOf(system).id;
    const had = Array.isArray(out.attacks)
      ? out.attacks
      : attacks
          .attacksOf(system, sheet, { player: true })
          .filter((a) => a.id !== unarmed)
          .map(({ rank, ...a }) => (void rank, a));
    const added = choices.attacks.map((id) => attacksIn(grant).find((a) => a.id === id));
    out.attacks = [...had, ...added];
  }
  // Resources rise by what their maxima rose (d20: hit points with the level).
  const after = sheets.maxima(system, out);
  for (const r of system.sheet.resources) {
    const held = out.resources[r.id] || { current: 0 };
    const rose = Math.max(0, (after[r.id] || 0) - (before[r.id] || 0));
    out.resources[r.id] = { ...held, current: Math.min(after[r.id], held.current + rose) };
  }
  out.ap = sheets.apFor(system, out);
  return { sheet: out, errors: [] };
}

/**
 * A suggestion that passes check (LV4's fallback): points on the scores
 * already highest, ranks on the skills already highest, the first traits
 * and attacks offered. Null with no level ready.
 */
function fallback(system, sheet, world = null) {
  const offer = offerOf(system, sheet, world);
  if (!offer) return null;
  const { grants, limits } = offer;
  const choices = {};
  const fill = (points, list, current) => {
    const spent = {};
    let left = points;
    const order = [...list].sort((a, b) => current(b) - current(a));
    for (const x of order) {
      if (!left) break;
      const room = x.max - current(x);
      const n = Math.min(room, left);
      if (n > 0) {
        spent[x.id] = n;
        left -= n;
      }
    }
    return spent;
  };
  if (grants.attributePoints) {
    choices.attributes = fill(grants.attributePoints, limits.attributes, (a) => a.score);
  }
  if (grants.skillRanks) {
    choices.skills = fill(grants.skillRanks, limits.skills, (k) => k.rank);
  }
  if (grants.traits)
    choices.traits = grants.traits.from.slice(0, grants.traits.choose).map((t) => t.id);
  if (grants.attacks) {
    choices.attacks = grants.attacks.from.slice(0, grants.attacks.choose).map((a) => a.id);
  }
  return choices;
}

module.exports = { offerOf, check, take, fallback };
