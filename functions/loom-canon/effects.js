'use strict';

/**
 * The effects engine (planning/game-systems.md §3 EF3–EF6, §4.10; L-815 /
 * #642): putting a system's conditions on a character, ticking them and
 * taking them off. Hazards use it first (EF8); combat, powers, traps and
 * potions will too. What a condition does while it lasts is ./conditions.js.
 *
 *   Effect (on a sheet's `conditions`)
 *     condition  the system's condition id
 *     source     who or what put it on: { kind, id, name } (a hazard, someone)
 *     duration   one of { rounds: n }, { turns: n }, { seconds: n }, { untilSaved: true }
 *     save       { skill or attribute, difficulty: { name, value }, when: ['apply',
 *                'endOfTurn'] }: rolled by the one it is on (EF5)
 *     since      the save's time when it was put on, in seconds
 *
 * Durations (EF4): End turn ticks rounds and turns (a round is a turn until
 * combat, L-820); the save's clock ends one in game time (L-370), so a long
 * wait outlasts it; one until saved ends on a save made at the end of a
 * turn. One of each condition at a time (EF6): a new one replaces it only if
 * it lasts longer or is harder to shake off.
 *
 * A save (EF5) is an ordinary check (./checks.js) against a rung, a number on
 * the d20 scale locks use (placed on the system's ladder as a lock's is), or
 * a formula of its source's sheet (`8 + level + mod(INT)`).
 *
 * Pure: the dice come from the caller; every function returns a new sheet.
 */

const formula = require('./formula');
const checks = require('./checks');
const { maxima } = require('./sheets');
const conditions = require('./conditions');
const clock = require('./clock');

const DURATIONS = ['rounds', 'turns', 'seconds', 'untilSaved'];
const WHEN = ['apply', 'endOfTurn'];
const MAX_DURATION = { rounds: 100, turns: 100, seconds: 30 * clock.DAY };
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const copyOf = (v) => JSON.parse(JSON.stringify(v));
const whenOf = (save) =>
  !save || save.when === undefined ? [] : Array.isArray(save.when) ? save.when : [save.when];

/**
 * What's wrong with an effect as it would be written (a hazard's, set over
 * MCP): `{ condition, duration, save? }` against the system. Errors only.
 */
function validateEffect(system, effect) {
  if (!isObject(effect)) return ['An effect must be an object.'];
  const errors = [];
  if (!conditions.conditionsOn(system)) {
    errors.push("This world's rules have no conditions.");
  } else if (!conditions.conditionOf(system, effect.condition)) {
    const ids = ((system.sheet || {}).conditions || []).map((c) => c.id).join(', ');
    errors.push(`There is no condition "${effect.condition}" in this world's rules (${ids}).`);
  }
  const d = effect.duration;
  const keys = isObject(d) ? Object.keys(d) : [];
  if (keys.length !== 1 || !DURATIONS.includes(keys[0])) {
    errors.push(
      'duration must be one of { rounds }, { turns }, { seconds } or { untilSaved: true }.'
    );
  } else if (keys[0] === 'untilSaved') {
    if (d.untilSaved !== true) errors.push('duration.untilSaved must be true.');
    if (!whenOf(effect.save).includes('endOfTurn')) {
      errors.push('An effect until saved needs a save at the end of each turn (when: endOfTurn).');
    }
  } else {
    const n = d[keys[0]];
    if (!Number.isInteger(n) || n < 1 || n > MAX_DURATION[keys[0]]) {
      errors.push(`duration.${keys[0]} must be a whole number from 1 to ${MAX_DURATION[keys[0]]}.`);
    }
  }
  if (effect.save !== undefined) {
    const s = effect.save;
    if (!isObject(s)) errors.push('save must be an object.');
    else {
      const why = checks.refusal(system, { skill: s.skill, attribute: s.attribute });
      if (why) errors.push(`save: ${why}`);
      if (!s.skill && !s.attribute) errors.push('save needs a skill or attribute to roll.');
      const against = s.against;
      if (typeof against === 'string') {
        const rung = system.checks.ladder.find(
          (r) => r.name.toLowerCase() === against.toLowerCase()
        );
        if (!rung) {
          const checked = formula.check(against, { names: [], system });
          if (checked.errors.length) {
            errors.push(
              `save.against "${against}" is no rung (${system.checks.ladder.map((r) => r.name).join(', ')}) ` +
                `and no formula: ${checked.errors.join(' ')}`
            );
          }
        }
      } else if (typeof against !== 'number' || !Number.isFinite(against)) {
        errors.push('save.against must be a rung, a number or a formula.');
      }
      const when = whenOf(s);
      if (!when.length || when.some((w) => !WHEN.includes(w))) {
        errors.push('save.when must be apply, endOfTurn, or both.');
      }
    }
  }
  return errors;
}

/**
 * A save as it is kept on the effect (EF5): its skill or attribute, its
 * difficulty worked out now (a rung, a number placed on the ladder, or a
 * formula of `source`'s sheet), and when it is rolled.
 */
function resolveSave(system, save, { source = null } = {}) {
  if (!save) return null;
  let difficulty;
  const against = save.against !== undefined ? save.against : save.difficulty;
  if (isObject(against)) difficulty = against;
  else if (typeof against === 'number') difficulty = checks.canonRung(system, against);
  else {
    const rung = system.checks.ladder.find(
      (r) => r.name.toLowerCase() === String(against).toLowerCase()
    );
    if (rung) difficulty = { name: rung.name, value: rung.value };
    else {
      const { values } = checks.valuesFor(system, source, {}, () => 1);
      const value = formula.evaluate(String(against), { values, system, dice: () => 1 }).total;
      difficulty = { name: String(value), value };
    }
  }
  return {
    ...(save.skill ? { skill: save.skill } : {}),
    ...(save.attribute ? { attribute: save.attribute } : {}),
    difficulty: { name: difficulty.name, value: difficulty.value },
    when: whenOf(save),
  };
}

/** How long an effect has left, in game seconds (Infinity until saved). */
function remainingOf(effect, now, turnSeconds) {
  const d = (effect && effect.duration) || {};
  if (Number.isFinite(d.rounds)) return d.rounds * turnSeconds;
  if (Number.isFinite(d.turns)) return d.turns * turnSeconds;
  if (Number.isFinite(d.seconds)) {
    const since = Number.isFinite(effect.since) ? effect.since : now;
    return since + d.seconds - now;
  }
  return d.untilSaved ? Infinity : 0;
}

// Whether a save is harder to make than another, on the system's ladder.
function harder(system, a, b) {
  const ladder = system.checks.ladder;
  const rising = ladder[ladder.length - 1].value > ladder[0].value;
  const va = a && a.difficulty ? a.difficulty.value : null;
  const vb = b && b.difficulty ? b.difficulty.value : null;
  if (va === null) return false;
  if (vb === null) return true;
  return rising ? va > vb : va < vb;
}

// A save rolled by the character the effect is on.
function rollSave(system, save, sheet, dice) {
  return checks.rollCheck(system, {
    check: { skill: save.skill, attribute: save.attribute },
    character: { sheet },
    difficulty: save.difficulty,
    dice,
  });
}

// Every resource no more than its maximum now (a condition may lower one).
function clamp(system, sheet) {
  const max = maxima(system, sheet);
  for (const r of system.sheet.resources || []) {
    const held = sheet.resources && sheet.resources[r.id];
    if (held && Number.isFinite(held.current) && max[r.id] !== null && held.current > max[r.id]) {
      held.current = max[r.id];
    }
  }
  return sheet;
}

/** "2 turns", "about an hour", "until saved": what an effect has left, in words. */
function leftWords(effect, now) {
  const d = (effect && effect.duration) || {};
  const count = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  if (Number.isFinite(d.rounds)) return count(d.rounds, 'round');
  if (Number.isFinite(d.turns)) return count(d.turns, 'turn');
  if (Number.isFinite(d.seconds)) return clock.duration(remainingOf(effect, now, 0));
  return 'until saved';
}

/**
 * Puts an effect on a sheet (EF4–EF6): `effect` { condition, duration,
 * save?, source? }. A save made when it lands (when: apply) resists it. The
 * same condition already on stays unless the new one lasts longer or is
 * harder to shake off, which replaces it.
 *
 * Returns `{ sheet, outcome, roll?, line, name }`: outcome 'applied',
 * 'replaced', 'kept' (already on, and the new one is no worse) or 'resisted'.
 */
function apply(system, sheet, effect, { now = 0, dice, source = null, turnSeconds = 6 } = {}) {
  const condition = conditions.conditionOf(system, effect.condition);
  if (!condition) throw new Error(`effects.apply: no condition "${effect.condition}".`);
  const next = copyOf(sheet || {});
  next.conditions = Array.isArray(next.conditions) ? next.conditions : [];
  const save = resolveSave(system, effect.save, { source });
  let roll = null;
  if (save && save.when.includes('apply')) {
    roll = rollSave(system, save, next, dice);
    if (roll.success) {
      return {
        sheet: next,
        outcome: 'resisted',
        roll,
        line: `You resist: not ${condition.name}.`,
        name: condition.name,
      };
    }
  }
  const entry = {
    condition: condition.id,
    ...(effect.source ? { source: effect.source } : {}),
    duration: { ...effect.duration },
    ...(save ? { save } : {}),
    since: now,
  };
  const at = next.conditions.findIndex((e) => conditions.idOf(e) === condition.id);
  let outcome = 'applied';
  if (at >= 0) {
    const old = next.conditions[at];
    const longer = remainingOf(entry, now, turnSeconds) > remainingOf(old, now, turnSeconds);
    if (!longer && !harder(system, save, old.save)) {
      return {
        sheet: next,
        outcome: 'kept',
        ...(roll ? { roll } : {}),
        line: `You're already ${condition.name} (${leftWords(old, now)}).`,
        name: condition.name,
      };
    }
    next.conditions[at] = entry;
    outcome = 'replaced';
  } else next.conditions.push(entry);
  clamp(system, next);
  return {
    sheet: next,
    outcome,
    ...(roll ? { roll } : {}),
    line: `You're ${condition.name} (${leftWords(entry, now)}).`,
    name: condition.name,
  };
}

/** Takes a condition off a sheet: a new sheet without it. */
function remove(sheet, conditionId) {
  const next = copyOf(sheet || {});
  next.conditions = (next.conditions || []).filter((e) => conditions.idOf(e) !== conditionId);
  return next;
}

/**
 * Ends what has run out of game time by `now` (EF4): `{ sheet, lines }`,
 * a line for each condition that wore off.
 */
function expire(system, sheet, now) {
  const next = copyOf(sheet || {});
  const lines = [];
  next.conditions = (next.conditions || []).filter((e) => {
    const d = (e && e.duration) || {};
    if (!Number.isFinite(d.seconds) || remainingOf(e, now, 0) > 0) return true;
    const condition = conditions.conditionOf(system, conditions.idOf(e));
    lines.push(`${condition ? condition.name : conditions.idOf(e)} wears off.`);
    return false;
  });
  return { sheet: next, lines };
}

/**
 * The end of a turn for a character's effects (EF3–EF5): each condition's
 * damage or healing (`each`), then its save to shake it off (when:
 * endOfTurn), then a turn off its rounds or turns; those run out end. Then
 * game time's end, at `now` (the time the turn ends).
 *
 * Returns `{ sheet, lines, rolls }`: a line for each thing that happened,
 * and each save rolled, `{ name, roll }`.
 */
function endOfTurn(system, sheet, { now = 0, dice } = {}) {
  let next = copyOf(sheet || {});
  const lines = [];
  const rolls = [];
  const kept = [];
  for (const effect of next.conditions || []) {
    const condition = conditions.conditionOf(system, conditions.idOf(effect));
    if (!condition) {
      kept.push(effect); // a misfit (SY2): left for the GM to repair
      continue;
    }
    // Damage or healing, rolled with the server's dice.
    for (const [resource, text] of Object.entries(condition.each || {})) {
      const r = (system.sheet.resources || []).find((x) => x.id === resource);
      if (!r) continue;
      const { values } = checks.valuesFor(system, { sheet: next }, {}, dice);
      const amount = Math.trunc(formula.evaluate(String(text), { values, system, dice }).total);
      if (!amount) continue;
      const max = maxima(system, next)[resource];
      const held = (next.resources = next.resources || {})[resource] || { current: 0 };
      const before = Number.isFinite(held.current) ? held.current : 0;
      const after = Math.max(0, Math.min(max === null ? Infinity : max, before + amount));
      next.resources[resource] = { ...held, current: after };
      if (after !== before) {
        lines.push(
          `${condition.name}: ${Math.abs(after - before)} ${after < before ? 'lost' : 'back'} ` +
            `(${r.name} ${after}${max === null ? '' : '/' + max}).`
        );
      }
    }
    // The save to shake it off.
    if (effect.save && whenOf(effect.save).includes('endOfTurn')) {
      const roll = rollSave(system, effect.save, next, dice);
      rolls.push({ name: condition.name, roll });
      if (roll.success) {
        lines.push(`You shake off ${condition.name}.`);
        continue;
      }
    }
    // A turn off its count.
    const d = effect.duration || {};
    const unit = Number.isFinite(d.rounds) ? 'rounds' : Number.isFinite(d.turns) ? 'turns' : null;
    if (unit) {
      const left = d[unit] - 1;
      if (left <= 0) {
        lines.push(`${condition.name} wears off.`);
        continue;
      }
      kept.push({ ...effect, duration: { [unit]: left } });
    } else kept.push(effect);
  }
  next.conditions = kept;
  const timed = expire(system, next, now);
  next = clamp(system, timed.sheet);
  return { sheet: next, lines: lines.concat(timed.lines), rolls };
}

module.exports = {
  DURATIONS,
  WHEN,
  validateEffect,
  resolveSave,
  remainingOf,
  leftWords,
  apply,
  remove,
  expire,
  endOfTurn,
};
