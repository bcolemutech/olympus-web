'use strict';

/**
 * Taking a level in play (planning/advancement.md §4.4, LV3, LV4; L-843 /
 * #715): the GM's suggestion for a level-up, from one Flash call over the
 * character so far, checked like the player's own choices; and the offer as
 * the turn's answer carries it.
 *
 * The rules are ../loom-modules/advancement/level-up.js.
 */

const { callGemini } = require('../gemini');
const levelUp = require('../loom-modules/advancement/level-up');

const MODEL_NAME = 'gemini-2.5-flash';
const MAX_OUTPUT_TOKENS = 400;
const SYSTEM_INSTRUCTION =
  'You are the GM of a tabletop roleplaying game, suggesting how a player character grows ' +
  'as they take a level. Suggest choices that fit who they have been in the story so far ' +
  '(their strengths, what they do most). Spend exactly what the level gives, within each ' +
  'limit. Respond with ONLY a JSON object: { "attributes"?: { [id]: points }, "skills"?: ' +
  '{ [id]: ranks }, "traits"?: [id], "attacks"?: [id], "reason": a short sentence saying why, ' +
  'to the player }.';

/** The prompt: the character, what they've done, the level's grants and limits. */
function promptOf(save, offer) {
  const character = (save && save.character) || {};
  const sheet = character.sheet || {};
  const { grants, limits } = offer;
  const lines = [
    `CHARACTER: ${character.name || 'the player'}, taking level ${offer.level}.`,
    `THE STORY SO FAR: ${(save && save.recentSummary) || '(just begun)'}`,
    `TRAITS HELD: ${(sheet.traits || []).join(', ') || 'none'}`,
  ];
  if (grants.attributePoints) {
    lines.push(`ATTRIBUTE POINTS TO SPEND: ${grants.attributePoints}`);
    for (const a of limits.attributes)
      lines.push(`- ${a.id} (${a.name}): ${a.score}, at most ${a.max}`);
  }
  if (grants.skillRanks) {
    lines.push(`SKILL RANKS TO SPEND: ${grants.skillRanks}`);
    for (const k of limits.skills) lines.push(`- ${k.id} (${k.name}): ${k.rank}, at most ${k.max}`);
  }
  if (grants.traits) {
    lines.push(`TRAITS: choose ${grants.traits.choose}`);
    for (const t of grants.traits.from) {
      lines.push(`- ${t.id} (${t.name})${t.description ? ': ' + t.description : ''}`);
    }
  }
  if (grants.attacks) {
    lines.push(`ATTACKS: choose ${grants.attacks.choose}`);
    for (const a of grants.attacks.from) lines.push(`- ${a.id} (${a.name})`);
  }
  return lines.join('\n');
}

const pickOf = (raw) =>
  Object.fromEntries(
    ['attributes', 'skills', 'traits', 'attacks']
      .filter((k) => raw[k] !== undefined)
      .map((k) => [k, raw[k]])
  );

/**
 * The GM's suggestion (LV4): `{ choices, reason? }`, choices that pass the
 * level-up's checks: the model's, or, when its fail or it can't be reached,
 * the rules' own (fallback). Null with no level ready. A level that grants
 * nothing to choose asks no model.
 */
async function suggest(system, world, save, offer) {
  const sheet = save && save.character && save.character.sheet;
  if (!offer || !sheet) return null;
  const fallback = { choices: levelUp.fallback(system, sheet, world) };
  if (!Object.keys(offer.grants).length) return fallback;
  let raw;
  try {
    raw = await callGemini({
      modelName: MODEL_NAME,
      systemInstruction: SYSTEM_INSTRUCTION,
      userMessage: promptOf(save, offer),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      jsonMode: true,
      thinkingBudget: 0,
    });
  } catch (err) {
    console.error('levelUp suggest: callGemini failed, falling back to the rules', err);
    return fallback;
  }
  if (!raw || typeof raw !== 'object') return fallback;
  const choices = pickOf(raw);
  if (levelUp.check(system, sheet, choices, world).length) return fallback;
  return {
    choices,
    ...(typeof raw.reason === 'string' && raw.reason.trim()
      ? { reason: raw.reason.trim().slice(0, 200) }
      : {}),
  };
}

/** The offer with the GM's suggestion, for the turn's answer. */
async function offerWithSuggestion(system, world, save) {
  const sheet = save && save.character && save.character.sheet;
  const offer = levelUp.offerOf(system, sheet, world);
  if (!offer) return null;
  return { ...offer, suggestion: await suggest(system, world, save, offer) };
}

module.exports = { suggest, offerWithSuggestion, promptOf, SYSTEM_INSTRUCTION, MODEL_NAME };
