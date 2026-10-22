'use strict';

/**
 * A named character's choices (planning/combat.md §3 EN3b, §4.6; L-825 /
 * #657): the whole turns the rules say they can take now, each worked out
 * by tactics (./tactics.js), for a model to choose one of (decided
 * 2026-10-22: a menu of whole turns). Whatever is chosen is legal, since the
 * rules wrote it; an answer naming none of them falls back to their role's
 * tactics.
 *
 *   For each foe and each attack   close on them (as far as movement goes)
 *                    and strike, or shoot from where they can see them; if
 *                    they can't reach this turn, close on them
 *   Hold             stay put and strike whoever is in reach or range
 *   Dodge            stay put, harder to hit until their next turn
 *   Flee             run for the nearest way out
 *
 * Each choice is `{ id ('o1', 'o2', ...), text, plan, dodge? }`, `plan` as
 * tactics.planTurn returns it. Choices that come to the same thing are
 * listed once.
 *
 * Pure.
 */

const tactics = require('./tactics');

const MAX_CHOICES = 24;
const squares = (n) => (n === 1 ? '1 square' : n + ' squares');

// What a plan comes to: where it ends, what it strikes, where it steps back to.
function signature(plan, dodge) {
  const end = (path) => (path.length ? path[path.length - 1] : null);
  return JSON.stringify([
    end(plan.path),
    plan.attack ? [plan.attack.attack.id, plan.attack.target.id] : null,
    end(plan.back),
    plan.fled,
    Boolean(dodge),
  ]);
}

/**
 * The whole turns a fighter can take: `input` is tactics.planTurn's (`me`,
 * `foes`, `friends`, `occupied`, `map`, `doors`, `health`). Returns
 * [{ id, text, plan, dodge? }].
 */
function choicesFor(input) {
  const { me, foes } = input;
  const out = [];
  const seen = new Set();
  const add = (text, plan, dodge = false) => {
    const key = signature(plan, dodge);
    if (seen.has(key) || out.length >= MAX_CHOICES) return;
    seen.add(key);
    out.push({ id: 'o' + (out.length + 1), text, plan, ...(dodge ? { dodge: true } : {}) });
  };
  const planned = (patch) =>
    tactics.planTurn({ ...input, me: { ...me, fleeing: false, ...patch } });
  const moved = (plan) => (plan.path.length ? `move ${squares(plan.path.length)} and ` : '');

  if (!me.noAction) {
    for (const foe of foes) {
      for (const attack of me.attacks) {
        if (attack.area) continue;
        const plan = planned({
          role: attack.range ? 'archer' : 'brute',
          focus: foe.id,
          attacks: [attack],
        });
        const who = foe.id === 'player' ? 'the player' : foe.name;
        const using =
          attack.id === 'unarmed' ? ' unarmed' : ` with your ${attack.name.toLowerCase()}`;
        if (plan.attack) {
          add(`${moved(plan)}${attack.range ? 'shoot' : 'strike'} ${who}${using}`, plan);
        } else if (plan.path.length) {
          add(`close on ${who} (${squares(plan.path.length)}), out of reach this turn`, {
            ...plan,
            attack: null,
          });
        }
      }
    }
    // An area attack where it catches foes and no friends (a caster's way).
    if (me.attacks.some((a) => a.area)) {
      const plan = planned({ role: 'caster', attacks: me.attacks.filter((a) => a.area) });
      if (plan.attack && plan.attack.attack.area) {
        const at = plan.attack.target;
        add(
          `throw your ${plan.attack.attack.name.toLowerCase()} at ` +
            `${at.id === 'player' ? 'the player' : at.name} and those around them`,
          plan
        );
      }
    }
    const hold = planned({ role: 'guard' });
    if (hold.attack) {
      const at = hold.attack.target;
      const a = hold.attack.attack;
      add(
        `stay where you are and strike ${at.id === 'player' ? 'the player' : at.name}` +
          (a.id === 'unarmed' ? ' unarmed' : ` with your ${a.name.toLowerCase()}`),
        hold
      );
    }
    add('stay where you are and Dodge: harder to hit until your next turn', emptyPlan(), true);
  }
  if ((input.map.exits || []).length && !me.noMove) {
    const flight = tactics.planTurn({ ...input, me: { ...me, fleeing: true } });
    if (flight.path.length) {
      add(flight.fled ? 'run for the way out and get away' : 'run for the way out', flight);
    }
  }
  if (!out.length) add('stay where you are', emptyPlan());
  return out;
}

const emptyPlan = () => ({ path: [], attack: null, back: [], fled: false });

module.exports = { choicesFor, MAX_CHOICES };
