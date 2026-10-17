'use strict';

/**
 * The two built-in game systems (planning/game-systems.md §3 SY3, SY4, SY6,
 * §4.8; L-804 / #630), our own wording throughout. They live here, in code,
 * and read as `loom_systems` records at version 0 (./systems.js getSystem):
 * their ids are reserved, so they are never set over MCP, only copied (SY5).
 *
 *   d20-fantasy  six attributes 3–18, skills with a proficiency bonus,
 *                d20 + modifier + proficiency against a ladder of 10 to 22.
 *                Every world without a system plays by it (SY4). A lock's
 *                number is its difficulty as it is (./checks.js canonRung),
 *                and an untrained character of middling Dexterity rolls a
 *                bare d20, so locks open as they did before systems.
 *   pool-scifi   four attributes 1–5 as pool sizes, skills that add dice,
 *                d10s counting the dice that show 7 or more, against a
 *                ladder of successes needed.
 *
 * Both pass validateSystem with no warnings (tests/loom-built-in-systems).
 */

const FANTASY = {
  id: 'd20-fantasy',
  name: 'd20 Fantasy',
  credits: [{ source: 'The Loom', licence: 'Our own' }],
  words: {
    health: 'Hit points',
    level: 'Level',
    rank: 'Proficiency',
    currency: 'Gold',
  },
  sheet: {
    attributes: [
      ['STR', 'Strength'],
      ['DEX', 'Dexterity'],
      ['CON', 'Constitution'],
      ['INT', 'Intelligence'],
      ['WIS', 'Wisdom'],
      ['CHA', 'Charisma'],
    ].map(([id, name]) => ({ id, name, min: 3, max: 18, modifier: `floor((${id} - 10) / 2)` })),
    // Hit points: 6 and the Constitution modifier per level, at least 1.
    resources: [{ id: 'health', name: 'Hit points', max: 'max(1, level * (6 + mod(CON)))' }],
    level: { min: 1, max: 20 },
    // Movement a turn (L-811): 20, quicker with Dexterity and training in
    // Athletics.
    speed: '20 + mod(DEX) + floor(Athletics / 2)',
    optional: ['skills', 'traits', 'conditions'],
    // A skill's rank is its proficiency bonus: 0 untrained, 2 to 6 trained.
    skills: [
      ['Athletics', 'Athletics', 'STR'],
      ['Acrobatics', 'Acrobatics', 'DEX'],
      ['Stealth', 'Stealth', 'DEX'],
      ['Thievery', 'Thievery', 'DEX'],
      ['Endurance', 'Endurance', 'CON'],
      ['Lore', 'Lore', 'INT'],
      ['Investigation', 'Investigation', 'INT'],
      ['Perception', 'Perception', 'WIS'],
      ['Survival', 'Survival', 'WIS'],
      ['Insight', 'Insight', 'WIS'],
      ['Persuasion', 'Persuasion', 'CHA'],
      ['Deception', 'Deception', 'CHA'],
      ['Intimidation', 'Intimidation', 'CHA'],
    ].map(([id, name, attribute]) => ({ id, name, attribute })),
    // Today's abilities (swim, climb) become traits with character sheets (CS4; L-811).
    traits: [],
    // What effects can put on a character (EF3; L-815): hazards now, combat
    // and powers later.
    conditions: [
      {
        id: 'poisoned',
        name: 'Poisoned',
        description: 'Sick and shaking: −2 to every check.',
        modifiers: { checks: '-2' },
      },
      {
        id: 'prone',
        name: 'Prone',
        description: 'On the ground: −2 to every check, and 10 less movement.',
        modifiers: { checks: '-2', speed: '-10' },
      },
      {
        id: 'burning',
        name: 'Burning',
        description: 'On fire: 1d4 damage at the end of each turn.',
        each: { health: '-1d4' },
      },
      {
        id: 'stunned',
        name: 'Stunned',
        description: "Reeling: you can't act or move.",
        noAction: true,
        noMove: true,
      },
    ],
  },
  checks: {
    formula: '1d20 + modifier + rank',
    // A natural 20 or 1 decides it; reaching the difficulty by less than 2
    // is a success at a cost. Reaching it at all still succeeds, so a lock
    // opens on the rolls it always did.
    degrees: {
      criticalSuccess: 'natural = 20',
      criticalFailure: 'natural = 1',
      success: 'result >= difficulty + 2',
      successAtCost: 'result >= difficulty',
    },
    // Picking a lock (L-626 locks): Thievery, by Dexterity.
    lock: { skill: 'Thievery' },
    ladder: [
      { name: 'Easy', value: 10 },
      { name: 'Moderate', value: 13 },
      { name: 'Hard', value: 16 },
      { name: 'Very hard', value: 19 },
      { name: 'Nearly impossible', value: 22 },
    ],
  },
  // The standard array; four skills trained at +2, the starting proficiency.
  creation: {
    method: 'array',
    values: [15, 14, 13, 12, 10, 8],
    skills: { trained: 4, rank: 2 },
  },
  advancement: {},
  modules: {},
  gmNotes:
    'Heroic fantasy: swords, old roads, ruins and the people who live among them. Danger is ' +
    'real but heroes are capable. Call for a check only when failing would matter, and pick ' +
    'the rung by how hard the task is, not how dramatic. A critical success is remembered; a ' +
    'critical failure costs something real. A success at a cost works, but leaves a mark: ' +
    'noise, time, a scrape, a broken tool. Keep the pace brisk between checks.',
};

const SCIFI = {
  id: 'pool-scifi',
  name: 'Dice-pool Sci-fi',
  credits: [{ source: 'The Loom', licence: 'Our own' }],
  words: {
    health: 'Health',
    stress: 'Stress',
    ship: 'Hull',
    currency: 'Credits',
    level: 'Rank',
    rank: 'Training',
  },
  sheet: {
    // Attributes are pool sizes: each point is a die.
    attributes: [
      ['Body', 'Body'],
      ['Reflex', 'Reflex'],
      ['Mind', 'Mind'],
      ['Presence', 'Presence'],
    ].map(([id, name]) => ({ id, name, min: 1, max: 5, modifier: id })),
    resources: [
      { id: 'health', name: 'Health', max: '3 + Body' },
      { id: 'stress', name: 'Stress', max: '3 + Presence' },
    ],
    level: { min: 1, max: 10 },
    // Movement a turn (L-811): 20 at Reflex 3, two more for each point of
    // Reflex above, and one for each rank of Athletics.
    speed: '14 + 2 * Reflex + Athletics',
    optional: ['skills', 'traits', 'conditions'],
    // A skill's rank adds dice: 0 untrained, 1 to 3 trained.
    skills: [
      ['Athletics', 'Athletics', 'Body'],
      ['Melee', 'Melee', 'Body'],
      ['Shooting', 'Shooting', 'Reflex'],
      ['Piloting', 'Piloting', 'Reflex'],
      ['Stealth', 'Stealth', 'Reflex'],
      ['Tech', 'Tech', 'Mind'],
      ['Medicine', 'Medicine', 'Mind'],
      ['Notice', 'Notice', 'Mind'],
      ['Persuade', 'Persuade', 'Presence'],
      ['Command', 'Command', 'Presence'],
    ].map(([id, name, attribute]) => ({ id, name, attribute })),
    traits: [],
    // What effects can put on a character (EF3; L-815).
    conditions: [
      {
        id: 'stunned',
        name: 'Stunned',
        description: "Knocked senseless: you can't act or move.",
        noAction: true,
        noMove: true,
      },
      {
        id: 'bleeding',
        name: 'Bleeding',
        description: 'Losing blood: 1 Health at the end of each turn.',
        each: { health: '-1' },
      },
      {
        id: 'burning',
        name: 'Burning',
        description: 'On fire: 1 Health and 1 Stress at the end of each turn.',
        each: { health: '-1', stress: '-1' },
      },
      {
        id: 'rattled',
        name: 'Rattled',
        description: 'Shaken: one die fewer in every pool.',
        modifiers: { dice: '-1' },
      },
    ],
  },
  checks: {
    // Roll a die per point of attribute and skill; each 7 or more is a success.
    formula: 'count((attribute + rank)d10, >= 7)',
    // By margin: two over is critical; one short gets it done at a cost; no
    // successes at all goes badly wrong.
    degrees: {
      criticalSuccess: 'result >= difficulty + 2',
      criticalFailure: 'result = 0',
      successAtCost: 'result = difficulty - 1',
    },
    // Getting through a lock: Tech, by Mind.
    lock: { skill: 'Tech' },
    // Successes needed.
    ladder: [
      { name: 'Easy', value: 1 },
      { name: 'Moderate', value: 2 },
      { name: 'Hard', value: 3 },
      { name: 'Very hard', value: 4 },
      { name: 'Nearly impossible', value: 5 },
    ],
  },
  // Point buy: 8 points buys 3 in everything, or a 5 at a cost elsewhere;
  // three skills trained at 1.
  creation: {
    method: 'pointBuy',
    budget: 8,
    costs: { 1: 0, 2: 1, 3: 2, 4: 4, 5: 6 },
    skills: { trained: 3, rank: 1 },
  },
  advancement: {},
  modules: {},
  gmNotes:
    'Hard-edged science fiction: crews, ships, stations and the debts that bind them. Tech is ' +
    'everywhere and none of it is free. Call for a check when the outcome is uncertain and it ' +
    'matters. One success short still gets it done, but costs stress, time, a part, or ' +
    'attention. No successes at all goes wrong in a way the crew has to deal with. Let ' +
    'consequences carry from scene to scene.',
};

module.exports = { FANTASY, SCIFI };
