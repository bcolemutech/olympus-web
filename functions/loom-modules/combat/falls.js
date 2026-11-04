'use strict';

/**
 * Falls (planning/maps-from-data.md DA2; L-923 / #727, decided 2026-11-04): a
 * drop of 10 ft or more walked off on a battle map (../../loom-canon/
 * map-paths.js FALL; the walk stops where it lands, ../../loom-turn/
 * steps.js). The system's `falls` setting (./settings.js) says what it does:
 * its `damage` rolled once for each `per` feet fallen (10), at most `max`
 * times, off the faller's health; then they are Prone, where the system has
 * it, until they stand up. With no setting, a fall hurts nothing.
 *
 *   fall(system, sheet, feet, { dice, now })  → { sheet, damage, lines, zero }
 *
 * `zero` when the fall takes their health to 0: the caller has them fall by
 * the system's down kind (./down.js). Pure.
 */

const formula = require('../../loom-canon/formula');
const checks = require('../../loom-canon/checks');
const conditions = require('../../loom-canon/conditions');
const effects = require('../../loom-canon/effects');
const { settingsOf } = require('./settings');

const copyOf = (v) => JSON.parse(JSON.stringify(v));
// Prone lasts until they stand up; this is only its outer bound.
const PRONE_FOR = { seconds: 3600 };

/** The damage of a fall of `feet` and Prone after it. */
function fall(system, sheet, feet, { dice, now = 0 } = {}) {
  const s = settingsOf(system);
  const rule = s.falls;
  let next = copyOf(sheet || {});
  const drop = Math.round(feet);
  const lines = [`You fall ${drop} ft.`];
  let damage = 0;
  let zero = false;
  if (rule && rule.damage !== null && s.health) {
    const times = Math.min(Math.floor(drop / rule.per), rule.max || Infinity);
    const { values } = checks.valuesFor(system, { sheet: next }, {}, dice);
    for (let i = 0; i < times; i++) {
      damage += Math.max(
        0,
        Math.trunc(formula.evaluate(String(rule.damage), { values, system, dice }).total)
      );
    }
    if (damage) {
      const held = (next.resources = next.resources || {})[s.health] || {};
      const before = Number.isFinite(held.current) ? held.current : 0;
      const after = Math.max(0, before - damage);
      next.resources[s.health] = { ...held, current: after };
      zero = after === 0;
      lines.push(`You take ${damage} damage.`);
    }
  }
  if (conditions.conditionOf(system, 'prone')) {
    const put = effects.apply(
      system,
      next,
      { condition: 'prone', duration: PRONE_FOR, source: { kind: 'fall' } },
      { now, dice }
    );
    if (put.outcome === 'applied' || put.outcome === 'replaced') {
      next = put.sheet;
      lines.push('You land Prone.');
    }
  }
  return { sheet: next, damage, lines, zero };
}

module.exports = { fall, PRONE_FOR };
