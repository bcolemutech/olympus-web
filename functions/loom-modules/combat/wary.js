'use strict';

/**
 * Wary figures and triggers (planning/builders-tools.md §4.2, BT3; L-392 /
 * #738): not every armed figure fights on sight.
 *
 * A `wary` side, beside party, hostile and neutral, on a named character or
 * a group of figures. In sight it starts no fight; NARRATE is told it is
 * wary and its challenge:
 *
 *   challenge  { says, check? }   what it says ("Halt. Name your business.")
 *              and the check that answers it ({ skill } or { attribute }):
 *              that check failing against it turns it hostile
 *
 * It turns hostile when the player attacks it or one of its group, when its
 * challenge's check fails against it, or when one of its triggers fires:
 *
 *   triggers   [{ on, target?, then }]
 *     on       doorOpened, doorForced (unlocked without its key), featureTouched,
 *              allyAttacked or enteredArea
 *     target   the door, feature or area; for allyAttacked, a character's or
 *              a group's id (without one: anyone else on the map attacked)
 *     then     hostile or neutral (calming a hostile)
 *
 * Any fighter can have triggers, wary or not. A side turned in a save is
 * `save.sides[id]`, which withFigures (./figures.js) puts on them, so the
 * rest of the module reads it as their side. The combat module's setting
 * `wary` (on by default) lets a system do without: with it off, wary reads
 * as hostile.
 *
 * Pure.
 */

const maps = require('../../loom-canon/maps');
const mapAreas = require('../../loom-canon/map-areas');
const { settingsOf } = require('./settings');

const WARY = 'wary';
const EVENTS = ['doorOpened', 'doorForced', 'featureTouched', 'allyAttacked', 'enteredArea'];
const THEN = ['hostile', 'neutral'];
const MAX_TRIGGERS = 10;
const MAX_SAYS = 300;
const TARGET = /^[A-Za-z0-9_:-]{1,80}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Whether the system has wary figures (the combat module's `wary`, on by default). */
function isOn(system) {
  return settingsOf(system).wary !== false;
}

/** Someone's side in a save: turned there, else their own; wary reads as hostile with it off. */
function sideIn(system, character, sides) {
  const side = ((sides || {})[character.id] || character.side) ?? null;
  return side === WARY && !isOn(system) ? 'hostile' : side;
}

/** What's wrong with a challenge and triggers, each named. Errors only. */
function validate({ challenge, triggers } = {}, where = '') {
  const errors = [];
  const at = (k) => (where ? where + '.' : '') + k;
  if (challenge !== undefined && challenge !== null) {
    if (!isObject(challenge)) errors.push(`${at('challenge')} must be { says, check? }.`);
    else {
      if (typeof challenge.says !== 'string' || !challenge.says.trim()) {
        errors.push(`${at('challenge.says')} is required: what they say.`);
      } else if (challenge.says.length > MAX_SAYS) {
        errors.push(`${at('challenge.says')} must be ${MAX_SAYS} characters or fewer.`);
      }
      const c = challenge.check;
      if (c !== undefined && c !== null) {
        const keys = isObject(c) ? Object.keys(c) : [];
        if (keys.length !== 1 || !['skill', 'attribute'].includes(keys[0])) {
          errors.push(`${at('challenge.check')} must be { skill } or { attribute }.`);
        }
      }
      for (const k of Object.keys(challenge)) {
        if (!['says', 'check'].includes(k)) errors.push(`${at('challenge')}: unknown "${k}".`);
      }
    }
  }
  if (triggers !== undefined && triggers !== null) {
    if (!Array.isArray(triggers)) errors.push(`${at('triggers')} must be a list.`);
    else {
      if (triggers.length > MAX_TRIGGERS) {
        errors.push(`${at('triggers')}: at most ${MAX_TRIGGERS}.`);
      }
      triggers.forEach((t, i) => {
        const here = `${at('triggers')}[${i}]`;
        if (!isObject(t)) return errors.push(`${here} must be { on, target?, then }.`);
        if (!EVENTS.includes(t.on)) errors.push(`${here}.on must be one of ${EVENTS.join(', ')}.`);
        if (!THEN.includes(t.then)) errors.push(`${here}.then must be hostile or neutral.`);
        if (t.target !== undefined && (typeof t.target !== 'string' || !TARGET.test(t.target))) {
          errors.push(`${here}.target must be an id.`);
        }
        if (
          !t.target &&
          ['doorOpened', 'doorForced', 'featureTouched', 'enteredArea'].includes(t.on)
        ) {
          errors.push(`${here}.target is required: the door, feature or area.`);
        }
        for (const k of Object.keys(t)) {
          if (!['on', 'target', 'then'].includes(k)) errors.push(`${here}: unknown "${k}".`);
        }
      });
    }
  }
  return errors;
}

/**
 * What's wrong with a challenge and triggers against the world's system and
 * the map they stand on (null: none yet): the check's skill or attribute is
 * the system's, each door, feature or area is the map's. Errors only.
 */
function validateAgainst(system, map, { challenge, triggers } = {}, where = '') {
  const errors = validate({ challenge, triggers }, where);
  const at = (k) => (where ? where + '.' : '') + k;
  const check = challenge && challenge.check;
  if (check && (check.skill || check.attribute)) {
    const list = check.skill
      ? (system.sheet && system.sheet.skills) || []
      : (system.sheet && system.sheet.attributes) || [];
    const id = check.skill || check.attribute;
    if (!list.some((x) => x.id === id)) {
      errors.push(
        `${at('challenge.check')}: the system has no ${check.skill ? 'skill' : 'attribute'} ` +
          `"${id}" (${list.map((x) => x.id).join(', ')}).`
      );
    }
  }
  if (map && Array.isArray(triggers)) {
    const ids = {
      doorOpened: (map.doors || []).map((d) => d.id),
      doorForced: (map.doors || []).map((d) => d.id),
      featureTouched: (map.features || []).map((f) => f.id),
      enteredArea: (map.areas || []).map((a) => a.id),
    };
    triggers.forEach((t, i) => {
      const list = t && ids[t.on];
      if (list && t.target && !list.includes(t.target)) {
        errors.push(
          `${at('triggers')}[${i}].target: ${map.name} has no ${t.on.replace(/[A-Z].*/, '')} ` +
            `"${t.target}"` +
            (list.length ? ` (${list.join(', ')}).` : '.')
        );
      }
    });
  }
  return errors;
}

/** Whether `check` is the one someone's challenge names. */
function answers(challenge, check) {
  const want = challenge && challenge.check;
  if (!want || !check) return false;
  return want.skill ? want.skill === check.skill : want.attribute === check.attribute;
}

/**
 * Who `events` turn, among those standing on the save's map (in `world` as
 * withFigures gives it, sides applied), not down. Each event is `{ on,
 * target }`, as a trigger's, or `{ on: 'challengeFailed', target }`, or for
 * an attack `{ on: 'allyAttacked', target, group? }`. Returns `[{ id, name,
 * side, was }]`, each once, with the side they turn to.
 */
function react(world, save, events) {
  if (!events.length) return [];
  const host = maps.hostOf(world, save);
  if (!host) return [];
  const down = (save && save.figures) || {};
  const here = maps.standingAt(world, host).filter((c) => !(down[c.id] && down[c.id].down));
  const byId = new Map(here.map((c) => [c.id, c]));
  const turned = new Map();
  const turn = (c, side) => {
    if ((c.side || 'neutral') === side || turned.has(c.id)) return;
    turned.set(c.id, { id: c.id, name: c.name, side, was: c.side || 'neutral' });
  };
  // Those wary with them: their group (figures) when one of it turns.
  const group = (c) => here.filter((o) => c.figure && o.figure === c.figure && o.side === WARY);
  for (const e of events) {
    const target = byId.get(e.target);
    if (e.on === 'challengeFailed') {
      if (target && target.side === WARY && answers(target.challenge, e.check)) {
        [target, ...group(target)].forEach((c) => turn(c, 'hostile'));
      }
      continue;
    }
    // Attacked: they and the wary of their group turn on the player.
    if (e.on === 'allyAttacked' && target) {
      if (target.side === WARY) turn(target, 'hostile');
      group(target).forEach((c) => turn(c, 'hostile'));
    }
    for (const c of here) {
      for (const t of c.triggers || []) {
        if (t.on !== e.on) continue;
        if (e.on === 'allyAttacked') {
          if (c.id === e.target) continue;
          const groupOf = target && target.figure;
          if (t.target && t.target !== e.target && t.target !== groupOf) continue;
        } else if (t.target !== e.target) continue;
        turn(c, t.then);
      }
    }
  }
  return [...turned.values()];
}

/** The events a walk makes: the areas it comes into (enteredArea). */
function walkEvents(map, from, walked) {
  if (!map || !(map.areas || []).length) return [];
  const start = mapAreas.areaAt(map, from);
  const seen = new Set(start ? [start.id] : []);
  const events = [];
  for (const cell of walked || []) {
    const a = mapAreas.areaAt(map, cell);
    if (a && !seen.has(a.id)) {
      seen.add(a.id);
      events.push({ on: 'enteredArea', target: a.id });
    }
  }
  return events;
}

/** The events a door's change makes: opened, forced (unlocked without its key). */
function doorEvents(doorId, before, after, { keyed = false } = {}) {
  const events = [];
  if (before === 'locked' && after !== 'locked' && !keyed) {
    events.push({ on: 'doorForced', target: doorId });
  }
  if (after === 'open' && before !== 'open') events.push({ on: 'doorOpened', target: doorId });
  return events;
}

/** The save's mutations for those turned: `sides.{id}`. */
function mutationsOf(turned) {
  return turned.map((t) => ({
    target: 'save',
    op: 'set-flag',
    path: 'sides.' + t.id,
    value: t.side,
  }));
}

/** A line for each turned. */
function linesOf(turned) {
  return turned.map((t) =>
    t.side === 'hostile'
      ? `${t.name} turns on you.`
      : t.side === 'neutral'
        ? `${t.name} stands down.`
        : `${t.name} is wary of you.`
  );
}

/** The save with those turned put on it (`sides`), for what follows in the same turn. */
function withTurned(save, turned) {
  if (!turned.length) return save;
  const sides = { ...((save && save.sides) || {}) };
  for (const t of turned) sides[t.id] = t.side;
  return { ...save, sides };
}

/** What NARRATE is told of a wary person in sight, or ''. */
function narrateLine(system, character, nameOfCheck = (c) => c.skill || c.attribute) {
  if (character.side !== WARY) return '';
  const ch = character.challenge;
  if (!ch) return ', wary of the player (they challenge first; an attack starts a fight)';
  return (
    ', wary of the player: they challenge, "' +
    ch.says +
    '"' +
    (ch.check ? ' (a failed ' + nameOfCheck(ch.check) + ' check against them starts a fight)' : '')
  );
}

module.exports = {
  WARY,
  EVENTS,
  THEN,
  MAX_TRIGGERS,
  isOn,
  sideIn,
  validate,
  validateAgainst,
  answers,
  react,
  walkEvents,
  doorEvents,
  mutationsOf,
  linesOf,
  withTurned,
  narrateLine,
};
