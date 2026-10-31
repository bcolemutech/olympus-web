'use strict';

/**
 * Earning experience (planning/advancement.md §4.3, XP1–XP3, NP2, NP3;
 * L-842 / #714): paid by the system's formulas, never by the GM's say.
 *
 *   foes     each foe overcome, by any means (down, fled, surrendered,
 *            talked down), pays `experience.foe` for its level against the
 *            player's, once per save; allies take no share
 *   moments  a story moment NARRATE names, `{ id, size }` (small, notable or
 *            major), pays `experience.story[size]` once: at most one a turn,
 *            its id normalised (lower case, dashes; decided 2026-10-31, AR2)
 *   quests   awardQuest, a hook for when quests exist
 *
 * What has been paid is the save's `earned`: ids, `foe:<id>`, `moment:<id>`,
 * `quest:<id>`. Nothing is taken back (NP3). A world with advancement off,
 * or a system without experience, pays nothing.
 *
 * Each award, `{ kind, id, name, xp, size? }`, is in the turn's answer for
 * the journal (`awards`; L-845 shows it).
 *
 * Pure: earn() returns what changes, apply() writes it on a save.
 */

const formula = require('../../loom-canon/formula');
const sheets = require('../../loom-canon/sheets');
const advancement = require('./index');

// The ways out of a fight that overcome a foe (XP1): not gone or stood down.
const OVERCOME = ['down', 'fled', 'surrendered', 'talkedDown'];
const MAX_ID = 60;
const MAX_EARNED = 2000;

const valueOf = (text, values, system) =>
  typeof text === 'number'
    ? text
    : formula.evaluate(String(text), { values, system, dice: () => 1 }).total;
const whole = (n) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

/** A story moment's id as kept (AR2): lower case, words joined by dashes. */
function momentId(id) {
  return String(id || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID);
}

/** A foe's worth (XP2): `experience.foe` for its level against the player's; 0 without. */
function foeWorth(system, level, foeLevel, world = null) {
  const { experience } = advancement.settingsOf(system, world);
  if (!experience || experience.foe === undefined) return 0;
  return whole(valueOf(experience.foe, { level, foeLevel }, system));
}

/** A story moment's worth by its size (XP2); 0 for a size the system doesn't know. */
function momentWorth(system, size, level, world = null) {
  const { experience } = advancement.settingsOf(system, world);
  const story = experience && experience.story;
  if (!story || story[size] === undefined) return 0;
  return whole(valueOf(story[size], { level }, system));
}

/** A quest's worth: `experience.quest`; 0 without. */
function questWorth(system, level, world = null) {
  const { experience } = advancement.settingsOf(system, world);
  if (!experience || experience.quest === undefined) return 0;
  return whole(valueOf(experience.quest, { level }, system));
}

// A sheet's level, or the system's lowest.
function levelOf(system, sheet) {
  const min = (system && system.sheet && system.sheet.level && system.sheet.level.min) || 1;
  return sheet && Number.isInteger(sheet.level) ? sheet.level : min;
}

/** A foe's level (NP2): its sheet as this save has it, or as canon has it. */
function foeLevelOf(system, world, save, id) {
  const fought = save && save.figures && save.figures[id] && save.figures[id].sheet;
  const character = ((world && world.characters) || {})[id];
  return levelOf(system, fought || sheets.sheetOf(character));
}

/**
 * The foes overcome this turn (XP1): hostiles out of the fight by an
 * overcoming way now that weren't before, in the fight as it stands after
 * the turn, and those a fight that ended named (`ended`: [{ id, name }],
 * its `overcome`; ../combat/play.js ending).
 */
function overcomeIn(before, after, ended = []) {
  const was = (before && before.combatants) || {};
  const out = new Map();
  for (const [id, c] of Object.entries((after && after.combatants) || {})) {
    if (c.side !== 'hostile' || !OVERCOME.includes(c.out)) continue;
    if (was[id] && was[id].out) continue;
    out.set(id, { id, name: c.name || id });
  }
  for (const foe of ended || []) {
    if (foe && foe.id && !(was[foe.id] && was[foe.id].out)) out.set(foe.id, foe);
  }
  return [...out.values()];
}

/**
 * What a turn earns (§4.3): `{ awards, xp, earned }` for the save as it
 * stands, `foes` ([{ id, name }]) overcome, `moment` ({ id, size, name? })
 * named, `quests` ([{ id, name }]) finished. Each pays once; `earned` is the
 * save's list with the new ids. Nothing with advancement off.
 */
function earn(system, world, save, { foes = [], moment = null, quests = [] } = {}) {
  const none = { awards: [], xp: 0, earned: (save && save.earned) || [] };
  const { experience } = advancement.settingsOf(system, world);
  if (!experience) return none;
  const level = levelOf(system, sheets.sheetOf(save));
  const paid = new Set(none.earned);
  const awards = [];
  const pay = (key, award) => {
    if (paid.has(key) || award.xp <= 0) return;
    paid.add(key);
    awards.push(award);
  };
  for (const foe of foes) {
    const foeLevel = foeLevelOf(system, world, save, foe.id);
    pay('foe:' + foe.id, {
      kind: 'foe',
      id: foe.id,
      name: foe.name || foe.id,
      xp: foeWorth(system, level, foeLevel, world),
    });
  }
  const id = moment && momentId(moment.id);
  if (id && advancement.SIZES.includes(moment.size)) {
    pay('moment:' + id, {
      kind: 'moment',
      id,
      name: typeof moment.name === 'string' && moment.name.trim() ? moment.name.trim() : id,
      size: moment.size,
      xp: momentWorth(system, moment.size, level, world),
    });
  }
  for (const quest of quests) {
    pay('quest:' + quest.id, {
      kind: 'quest',
      id: quest.id,
      name: quest.name || quest.id,
      xp: questWorth(system, level, world),
    });
  }
  return {
    awards,
    xp: awards.reduce((n, a) => n + a.xp, 0),
    earned: [...paid].slice(-MAX_EARNED),
  };
}

/** The quest hook: what finishing a quest earns, as earn() returns it. */
function awardQuest(system, world, save, quest) {
  return earn(system, world, save, { quests: [quest] });
}

/**
 * Writes what was earned on a save (in place): the sheet's `xp` (from its
 * level's total on a sheet from before, SV1) and `earned`. Returns the save.
 */
function apply(system, save, result) {
  if (!result || !result.awards.length) return save;
  const sheet = sheets.sheetOf(save);
  if (sheet) {
    const was = Number.isFinite(sheet.xp) ? sheet.xp : advancement.sheetWith(system, sheet).xp || 0;
    sheet.xp = was + result.xp;
    delete sheet.levelsReady; // worked out on load
  }
  save.earned = result.earned;
  return save;
}

/** The journal's line for an award: "+25 experience: the bandit chief." */
function lineOf(award) {
  return '+' + award.xp + ' experience: ' + award.name + '.';
}

/**
 * What NARRATE is told of levels (NP2): the player's against each foe's in
 * sight, so a deadly fight reads as one; null with experience off or no foe.
 */
function levelsLine(system, world, save, foes) {
  if (!advancement.settingsOf(system, world).experience || !foes.length) return null;
  const word = (system.words && system.words.level) || 'level';
  const mine = levelOf(system, sheets.sheetOf(save));
  return (
    'LEVELS: the player is ' +
    word +
    ' ' +
    mine +
    '; ' +
    foes
      .map((f) => {
        const theirs = foeLevelOf(system, world, save, f.id);
        const gap =
          theirs > mine ? ', above them' : theirs < mine ? ', below them' : ', their equal';
        return f.name + ' is ' + word + ' ' + theirs + gap;
      })
      .join('; ') +
    '. Let the danger read true to it.'
  );
}

module.exports = {
  OVERCOME,
  momentId,
  foeWorth,
  momentWorth,
  questWorth,
  overcomeIn,
  earn,
  awardQuest,
  apply,
  lineOf,
  levelsLine,
};
