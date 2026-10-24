'use strict';

/**
 * The combat module's settings (planning/combat.md §4.1; L-821 / #653): a
 * system's `modules.combat`, checked when the system is saved (L-801).
 *
 *   initiative  { formula, tieBreak }   rolled once when a fight starts; a
 *               sheet formula ("1d20 + mod(DEX)"), ties broken by the higher
 *               score in `tieBreak` (an attribute), then the player
 *   (economy    retired with action points, L-831: actions and reactions
 *               are paid in AP, ../../loom-canon/ap.js; a system that
 *               still gives it is converted, the setting dropped.)
 *   turn        { actions, reactions }  read only with AP off (L-838;
 *               `ap: false`): the actions a turn has and the reactions a
 *               round, one each by default; with AP on, kept, unused
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
 *   down        what 0 means for the player (L-827; DF1, DF2):
 *               { kind, death, ... } with kind one of
 *                 'dyingWithSaves'  dying: a save each round (`save`: { skill
 *                                   or attribute, against: a rung }), `need`
 *                                   (3) of one kind: stable, or dead
 *                 'wounds'          a wound instead of falling, up to `wounds`
 *                                   (3); past them, out
 *                 'outAtOnce'       out at once
 *               `death`: 'on' or 'off', the default for its worlds' rules.death
 *               (no one to help: on, the character dies; off, they wake
 *               captured, robbed or rescued); `stabilise` { skill or attribute,
 *               against }: what an ally rolls to stabilise them; `injury`: a
 *               condition put on when they come round; `hours` they lie out
 *               (default 1). With none: out at once, death off.
 *   rests       { short, long } (L-827; DF5): each { hours, restore: { resource:
 *               formula or 'full' }, clears?: [condition] }; a long rest once
 *               a day. With none: a short rest an hour restoring nothing, a
 *               long one 8 hours restoring everything.
 *   cover       { partial, heavy } (L-823; PS2): formulas added to the
 *               defence (or the defender's roll) of someone behind a low
 *               obstacle or a wall's end (partial), or a wall's corner or a
 *               solid obstacle (heavy). With none, cover does nothing.
 *   longRange   a formula added to a ranged attack past its normal range
 *               (PS1), "-5". With none, nothing.
 *   dodge       a formula added to the defence of someone who took the Dodge
 *               action, until their next turn (TN5), "5". With none, nothing.
 *   flanking    a formula added to a melee attack on someone with a friend of
 *               the attacker on their far side (PS3), "2"; off (null) unless
 *               set, as in both built-in systems.
 *
 * Defending (TN4) isn't a setting: it is a reaction a trait gives
 * (`reaction: { defend, against }`, ../../loom-canon/systems.js; decided
 * 2026-10-22).
 *
 * Pure. `formula(value, where)` is the system check's own formula collector,
 * so the formulas here are checked with the rest of the system's.
 */

const KEYS = [
  'initiative',
  'surprise',
  'attack',
  'damageTypes',
  'health',
  'subduePenalty',
  'unarmed',
  'attacks',
  'morale',
  'down',
  'rests',
  'cover',
  'longRange',
  'dodge',
  'flanking',
  'turn',
];
// The turn without AP (L-838): one action a turn, one reaction a round.
const TURN = { actions: 1, reactions: 1 };
// Settings read by later stories: kept as given, with a warning.
const LATER = {};
const DEFAULT_INITIATIVE = '1d20';

const HITS = ['defence', 'opposed'];
const CRITICALS = ['doubleDice', 'none'];
const EXTRAS = ['addDie', 'none'];
const TYPE_ID = /^[a-z][a-z0-9_-]{0,31}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The settings with their defaults filled in (none set: a d20). Actions and reactions are paid in AP (L-832, L-833). */
function settingsOf(system) {
  const given = (system && system.modules && system.modules.combat) || {};
  return {
    initiative: {
      formula: (given.initiative && given.initiative.formula) || DEFAULT_INITIATIVE,
      tieBreak: (given.initiative && given.initiative.tieBreak) || null,
    },
    surprise: isObject(given.surprise) ? given.surprise : null,
    attack: attackOf(system, given.attack),
    health: healthOf(system, given.health),
    subduePenalty: given.subduePenalty === undefined ? null : given.subduePenalty,
    morale: isObject(given.morale) && isObject(given.morale.check) ? given.morale : null,
    down: downOf(given.down),
    rests: restsOf(given.rests),
    cover: isObject(given.cover)
      ? { partial: given.cover.partial ?? null, heavy: given.cover.heavy ?? null }
      : { partial: null, heavy: null },
    longRange: given.longRange ?? null,
    dodge: given.dodge ?? null,
    flanking: given.flanking ?? null,
    turn: {
      actions: isObject(given.turn) && given.turn.actions !== undefined ? given.turn.actions : 1,
      reactions:
        isObject(given.turn) && given.turn.reactions !== undefined ? given.turn.reactions : 1,
    },
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

// What 0 means (L-827), with the defaults: out at once, death off.
const DOWN_KINDS = ['dyingWithSaves', 'wounds', 'outAtOnce'];
function downOf(given) {
  const d = isObject(given) ? given : {};
  return {
    kind: DOWN_KINDS.includes(d.kind) ? d.kind : 'outAtOnce',
    death: d.death === 'on' ? 'on' : 'off',
    save: isObject(d.save) ? d.save : null,
    need: Number.isInteger(d.need) ? d.need : 3,
    wounds: Number.isInteger(d.wounds) ? d.wounds : 3,
    stabilise: isObject(d.stabilise) ? d.stabilise : null,
    injury: typeof d.injury === 'string' ? d.injury : null,
    hours: Number.isFinite(d.hours) ? d.hours : 1,
  };
}

// Rests (L-827), with the defaults.
function restsOf(given) {
  const r = isObject(given) ? given : {};
  const one = (x, hours, restore) => ({
    hours: isObject(x) && Number.isFinite(x.hours) ? x.hours : hours,
    restore: isObject(x) && isObject(x.restore) ? x.restore : restore,
    clears: isObject(x) && Array.isArray(x.clears) ? x.clears : [],
  });
  return { short: one(r.short, 1, {}), long: one(r.long, 8, null) };
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
    } else if (!KEYS.includes(key) && key !== 'economy') {
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

  // Retired with action points (L-831): converted away before the check
  // (../../loom-canon/ap.js convert); given here directly, it is dropped.
  if (settings.economy !== undefined) {
    warnings.push(
      `${at}.economy is retired (L-830): every action and reaction is paid in AP, from ap.costs.`
    );
  }

  // The turn without AP (L-838).
  const turn = settings.turn;
  if (turn !== undefined) {
    if (!isObject(turn)) errors.push(`${at}.turn must be { actions?, reactions? }.`);
    else {
      for (const key of Object.keys(turn)) {
        if (!Object.keys(TURN).includes(key)) {
          errors.push(`${at}.turn: "${key}" isn't part of a turn (actions, reactions).`);
        }
      }
      const whole = (n, lo) => Number.isInteger(n) && n >= lo && n <= 5;
      if (turn.actions !== undefined && !whole(turn.actions, 1)) {
        errors.push(`${at}.turn.actions must be a whole number from 1 to 5.`);
      }
      if (turn.reactions !== undefined && !whole(turn.reactions, 0)) {
        errors.push(`${at}.turn.reactions must be a whole number from 0 to 5.`);
      }
      if (!(system && system.ap === false)) {
        warnings.push(`${at}.turn is read only with AP off (ap: false); it is kept, unused.`);
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
  // What a check is rolled with: { skill } or { attribute }, and a rung.
  const rungNames = new Set(
    (((system && system.checks) || {}).ladder || []).map((r) => r && r.name)
  );
  const rolled = (c, where, { rung = true } = {}) => {
    if (!isObject(c) || (!c.skill && !c.attribute)) {
      return errors.push(`${where} must be { skill or attribute${rung ? ', against' : ''} }.`);
    }
    if (c.skill !== undefined && !skills.has(c.skill)) {
      errors.push(`${where}.skill "${c.skill}" isn't one of the system's skills.`);
    } else if (c.attribute !== undefined && !attributes.has(c.attribute)) {
      errors.push(`${where}.attribute "${c.attribute}" isn't one of the system's attributes.`);
    }
    if (rung && !rungNames.has(c.against)) {
      errors.push(`${where}.against must be a rung on the ladder.`);
    }
    return null;
  };
  const conditionIds = new Set(
    ((sheet.optional || []).includes('conditions') ? sheet.conditions || [] : []).map(
      (c) => c && c.id
    )
  );
  // What 0 means (L-827).
  const down = settings.down;
  if (down !== undefined) {
    if (!isObject(down)) errors.push(`${at}.down must be { kind, death, ... }.`);
    else {
      if (!DOWN_KINDS.includes(down.kind)) {
        errors.push(`${at}.down.kind must be one of ${DOWN_KINDS.join(', ')}.`);
      }
      if (down.death !== undefined && !['on', 'off'].includes(down.death)) {
        errors.push(`${at}.down.death must be on or off.`);
      }
      if (down.kind === 'dyingWithSaves') {
        if (down.save === undefined) errors.push(`${at}.down.save is needed to roll each round.`);
        else rolled(down.save, `${at}.down.save`);
      }
      if (down.stabilise !== undefined) rolled(down.stabilise, `${at}.down.stabilise`);
      for (const n of ['need', 'wounds', 'hours']) {
        if (
          down[n] !== undefined &&
          !(Number.isInteger(down[n]) && down[n] >= 1 && down[n] <= 24)
        ) {
          errors.push(`${at}.down.${n} must be a whole number from 1 to 24.`);
        }
      }
      if (down.injury !== undefined && !conditionIds.has(down.injury)) {
        errors.push(`${at}.down.injury "${down.injury}" isn't one of the system's conditions.`);
      }
    }
  }
  // Rests (L-827).
  const rests = settings.rests;
  if (rests !== undefined) {
    if (!isObject(rests)) errors.push(`${at}.rests must be { short, long }.`);
    else {
      for (const [name, r] of Object.entries(rests)) {
        const where = `${at}.rests.${name}`;
        if (!['short', 'long'].includes(name)) {
          errors.push(`${at}.rests: "${name}" isn't a rest (short, long).`);
          continue;
        }
        if (!isObject(r)) {
          errors.push(`${where} must be { hours, restore, clears? }.`);
          continue;
        }
        if (!(Number.isInteger(r.hours) && r.hours >= 1 && r.hours <= 24)) {
          errors.push(`${where}.hours must be a whole number from 1 to 24.`);
        }
        if (!isObject(r.restore)) errors.push(`${where}.restore must map resources to formulas.`);
        else {
          for (const [id, value] of Object.entries(r.restore)) {
            if (!resources.has(id)) {
              errors.push(`${where}.restore: "${id}" isn't one of the system's resources.`);
            } else if (value !== 'full') formula(value, `${where}.restore.${id}`);
          }
        }
        if (r.clears !== undefined) {
          if (!Array.isArray(r.clears))
            errors.push(`${where}.clears must be a list of conditions.`);
          else {
            r.clears
              .filter((c) => !conditionIds.has(c))
              .forEach((c) =>
                errors.push(`${where}.clears: "${c}" isn't one of the system's conditions.`)
              );
          }
        }
      }
    }
  }
  // Position (L-823): terms, each a formula.
  const cover = settings.cover;
  if (cover !== undefined) {
    if (!isObject(cover)) errors.push(`${at}.cover must be { partial, heavy }.`);
    else {
      for (const key of Object.keys(cover)) {
        if (!['partial', 'heavy'].includes(key)) {
          errors.push(`${at}.cover: "${key}" isn't a kind of cover (partial, heavy).`);
        } else formula(cover[key], `${at}.cover.${key}`);
      }
    }
  }
  for (const key of ['longRange', 'dodge', 'flanking']) {
    if (settings[key] !== undefined && settings[key] !== null) {
      formula(settings[key], `${at}.${key}`);
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

module.exports = { KEYS, LATER, HITS, DOWN_KINDS, DEFAULT_INITIATIVE, settingsOf, check };
