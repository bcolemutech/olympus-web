'use strict';

const { callGemini } = require('../gemini');

/**
 * A named character's turn in a fight (planning/combat.md §3 EN3b, §4.6;
 * L-825 / #657): one Flash call, given who they are, their play notes
 * (`character.combatNotes`, set over MCP), how the fight looks to them and
 * the whole turns the rules list (../loom-modules/combat/menu.js). The model
 * picks one by its id; the rules play it. It decides nothing else: what the
 * turn does is the rules' (CB0).
 *
 * Returns `{ option, reason }`, or null when the call fails or its answer
 * isn't shaped right (the character then fights by their role's tactics,
 * ../loom-modules/combat/others.js; so does an id not on the list).
 */

const MODEL_NAME = 'gemini-2.5-flash';
const MAX_OUTPUT_TOKENS = 200;

const SYSTEM_INSTRUCTION =
  'You are the COMBAT TURN stage of a tabletop game engine. You play one named character ' +
  "for one turn of a fight. Choose the turn they take from the numbered list: it's every " +
  'turn the rules allow them now. Choose as this character would, by who they are and their ' +
  'notes on how they fight: brave or careful, loyal or selfish, clever or rash. You decide ' +
  'nothing else; the rules roll what happens.\n\n' +
  'Respond with ONLY a JSON object: { "choice": "<the id, e.g. o2>", "reason": "<a short ' +
  'phrase in their voice or about their intent, at most 15 words>" }';

function promptOf(menu) {
  const lines = [
    `CHARACTER: ${menu.name}` + (menu.description ? ` — ${menu.description}` : ''),
    `SIDE: ${menu.side === 'hostile' ? "against the player's side" : "on the player's side"}`,
    `HOW THEY FIGHT: ${menu.combatNotes || '(no notes: as their description suggests)'}`,
    `ROUND: ${menu.round}`,
    // On AP (L-836): what the turn has to spend; each choice says its cost.
    ...(Number.isFinite(menu.ap)
      ? [`ACTION POINTS: ${menu.ap} this turn; what a turn doesn't spend is kept to react.`]
      : []),
    'WHAT THEY SEE:',
    ...(menu.situation || []).map((s) => '- ' + s.line),
    'THEIR CHOICES:',
    ...menu.choices.map((o) => `- ${o.id}: ${o.text}`),
  ];
  return lines.join('\n');
}

/** The model's choice for a named character's turn: `{ option, reason }`, or null. */
async function namedTurn(menu) {
  let raw;
  try {
    raw = await callGemini({
      modelName: MODEL_NAME,
      systemInstruction: SYSTEM_INSTRUCTION,
      userMessage: promptOf(menu),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinkingBudget: 0,
    });
  } catch (err) {
    console.error('namedTurn: callGemini failed, falling back to tactics', err);
    return null;
  }
  if (!raw || typeof raw !== 'object' || typeof raw.choice !== 'string') return null;
  return {
    option: raw.choice.trim().slice(0, 10),
    ...(typeof raw.reason === 'string' && raw.reason.trim()
      ? { reason: raw.reason.trim().slice(0, 200) }
      : {}),
  };
}

module.exports = { namedTurn, promptOf, SYSTEM_INSTRUCTION, MODEL_NAME };
