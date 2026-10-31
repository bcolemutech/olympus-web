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

const { COSTS: AP_COSTS, TIERS: AP_TIERS } = require('./ap');

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
    // Action points a turn (L-831; planning/action-points.md AP1): 20,
    // more with Dexterity and training in Athletics. A square costs 1.
    ap: '20 + mod(DEX) + floor(Athletics / 2)',
    optional: ['skills', 'traits', 'conditions', 'derived'],
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
    // Parry (L-823): a reaction nobody has unless their sheet lists it.
    traits: [
      {
        id: 'parry',
        name: 'Parry',
        description: 'Turn a blade aside: once a round, +2 Armour against a melee hit.',
        reaction: { defend: '2', against: 'melee' },
      },
    ],
    // What effects can put on a character (EF3; L-815): hazards now, combat
    // and powers later.
    conditions: [
      {
        id: 'poisoned',
        name: 'Poisoned',
        description: 'Sick and shaking: −2 to every check.',
        modifiers: { checks: '-2' },
      },
      // On AP (L-834): Prone doubles moving until you stand up (its 5 AP);
      // Stunned leaves no AP; Restrained stops moving; Slowed takes 10.
      {
        id: 'prone',
        name: 'Prone',
        description: 'On the ground: −2 to every check; moving costs double until you stand up.',
        modifiers: { checks: '-2' },
        costs: { move: 'x2', difficult: 'x2' },
        standUp: true,
      },
      {
        id: 'restrained',
        name: 'Restrained',
        description: "Held fast: −2 to every check, and you can't move.",
        modifiers: { checks: '-2' },
        costs: { move: 'never', difficult: 'never' },
      },
      {
        id: 'slowed',
        name: 'Slowed',
        description: 'Sluggish: 10 fewer AP a turn.',
        modifiers: { ap: '-10' },
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
        description: "Reeling: no AP, so you can't act or move.",
        ap: 0,
      },
    ],
    // Armour (L-822): what an attack must reach to hit, 10 and Dexterity
    // until L-770's armour adds to it.
    derived: [{ id: 'Armour', name: 'Armour', formula: '10 + mod(DEX)' }],
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
  // Advancement (L-841; planning/advancement.md §4.1): experience and levels
  // only. Each level needs 50 × level × (level − 1) in all (100 for level 2,
  // 19,000 for 20); a foe is worth 25, 10 more or less for each level it is
  // above or below yours (5 at least); a skill rank every level, two
  // attribute points as well every fourth, no skill past 10.
  advancement: {
    experience: {
      curve: '50 * level * (level - 1)',
      foe: 'max(5, 25 + 10 * (foeLevel - level))',
      story: { small: 10, notable: 25, major: 50 },
      quest: 100,
      grants: {
        every: { skillRanks: 1 },
        at: {
          4: { skillRanks: 1, attributePoints: 2 },
          8: { skillRanks: 1, attributePoints: 2 },
          12: { skillRanks: 1, attributePoints: 2 },
          16: { skillRanks: 1, attributePoints: 2 },
          20: { skillRanks: 1, attributePoints: 2 },
        },
      },
      skillMax: 10,
    },
  },
  // What AP pays for (L-831; planning/action-points.md CT1): the default
  // costs and tiers, no limit on what's kept.
  ap: { costs: { ...AP_COSTS }, tiers: { ...AP_TIERS }, keepLimit: null },
  // Combat (L-821; planning/combat.md §4.1): d20 + Dexterity for initiative
  // (actions and reactions paid in AP, L-830); Stealth against Perception
  // for surprise.
  modules: {
    combat: {
      initiative: { formula: '1d20 + mod(DEX)', tieBreak: 'DEX' },
      surprise: { hide: { skill: 'Stealth' }, notice: { skill: 'Perception' } },
      // Attacks (L-822): a d20 against Armour, a critical doubling the dice;
      // a blow meant to knock out with a lethal weapon is 4 harder.
      attack: { hit: 'defence', defence: 'Armour', critical: 'doubleDice' },
      damageTypes: [
        { id: 'slashing', name: 'Slashing' },
        { id: 'piercing', name: 'Piercing' },
        { id: 'bludgeoning', name: 'Bludgeoning' },
        { id: 'fire', name: 'Fire' },
        { id: 'poison', name: 'Poison' },
      ],
      health: 'health',
      subduePenalty: '-4',
      unarmed: {
        id: 'unarmed',
        name: 'Unarmed',
        reach: 1,
        attack: '1d20 + mod(STR)',
        damage: '1 + mod(STR)',
        type: 'bludgeoning',
        lethal: false,
      },
      // Morale (L-824): Wisdom, at a rung by posture; the reckless never break.
      morale: {
        check: { attribute: 'WIS' },
        rungs: {
          cowardly: 'Hard',
          cautious: 'Moderate',
          steady: 'Easy',
          bold: 'Easy',
          reckless: null,
        },
      },
      // At 0 (L-827): dying, a Constitution save each round, three of one
      // kind; Wisdom stabilises; death on. Rests: a short one heals a die and
      // Constitution, a long one everything.
      down: {
        kind: 'dyingWithSaves',
        death: 'on',
        save: { attribute: 'CON', against: 'Easy' },
        need: 3,
        stabilise: { attribute: 'WIS', against: 'Easy' },
      },
      rests: {
        short: { hours: 1, restore: { health: 'max(1, 1d6 + mod(CON))' } },
        long: { hours: 8, restore: { health: 'full' }, clears: ['poisoned'] },
      },
      // Position (L-823): cover +2 or +5 Armour, -5 past a ranged attack's
      // normal range, Dodge +5 Armour; no flanking.
      cover: { partial: '2', heavy: '5' },
      longRange: '-5',
      dodge: '5',
      // What a new character carries until L-770's weapons.
      attacks: [
        {
          id: 'sword',
          name: 'Sword',
          reach: 1,
          attack: '1d20 + mod(STR) + 2',
          damage: '1d8 + mod(STR)',
          type: 'slashing',
        },
        {
          id: 'bow',
          name: 'Bow',
          range: { normal: 16, long: 64 },
          attack: '1d20 + mod(DEX) + 2',
          damage: '1d6 + mod(DEX)',
          type: 'piercing',
        },
      ],
    },
  },
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
    // Action points a turn (L-831; AP2): 20 at Reflex 3, two more for each
    // point of Reflex above, and one for each rank of Athletics.
    ap: '14 + 2 * Reflex + Athletics',
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
    // Combat Reflexes (L-823): a reaction nobody has unless their sheet lists it.
    traits: [
      {
        id: 'combat_reflexes',
        name: 'Combat Reflexes',
        description: 'Once a round, a success more on your defence against a hit.',
        reaction: { defend: '1', against: 'all' },
      },
    ],
    // What effects can put on a character (EF3; L-815).
    conditions: [
      {
        id: 'stunned',
        name: 'Stunned',
        description: "Knocked senseless: no AP, so you can't act or move.",
        ap: 0,
      },
      // On AP (L-834), as the fantasy system's: down flat, pinned, slowed.
      {
        id: 'prone',
        name: 'Prone',
        description: 'Down flat: moving costs double until you get up.',
        costs: { move: 'x2', difficult: 'x2' },
        standUp: true,
      },
      {
        id: 'pinned',
        name: 'Pinned',
        description: "Held or wedged in: you can't move.",
        costs: { move: 'never', difficult: 'never' },
      },
      {
        id: 'slowed',
        name: 'Slowed',
        description: 'Servos jammed or legs gone heavy: 10 fewer AP a turn.',
        modifiers: { ap: '-10' },
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
      // A lasting injury from going down (L-827), until a long rest.
      {
        id: 'wounded',
        name: 'Wounded',
        description: 'Hurt badly: one die fewer in every pool until a long rest.',
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
  // Advancement (L-841; planning/advancement.md §4.1): both parts.
  // Experience raises Rank: each needs 100 × rank × (rank − 1) in all (200
  // for Rank 2); a foe is worth 40, 20 more or less for each Rank it is above
  // or below yours (10 at least); an attribute point every third Rank.
  // Skills and attacks improve by use: 3 × (rank + 1) successes with stakes
  // to rise, skills to 5, attacks to 3.
  advancement: {
    experience: {
      curve: '100 * level * (level - 1)',
      foe: 'max(10, 40 + 20 * (foeLevel - level))',
      story: { small: 20, notable: 50, major: 100 },
      quest: 200,
      grants: {
        at: {
          3: { attributePoints: 1 },
          6: { attributePoints: 1 },
          9: { attributePoints: 1 },
        },
      },
      skillMax: 5,
    },
    use: { threshold: '3 * (rank + 1)', skills: true, attacks: true, maxRank: 3 },
  },
  // What AP pays for (L-831; planning/action-points.md CT1): the default
  // costs and tiers, no limit on what's kept.
  ap: { costs: { ...AP_COSTS }, tiers: { ...AP_TIERS }, keepLimit: null },
  // Combat (L-821; planning/combat.md §4.1): a Reflex pool for initiative,
  // ties to the higher Reflex (actions and reactions paid in AP, L-830);
  // Stealth against Notice for surprise.
  modules: {
    combat: {
      initiative: { formula: 'count((Reflex)d10, >= 7)', tieBreak: 'Reflex' },
      surprise: { hide: { skill: 'Stealth' }, notice: { skill: 'Notice' } },
      // Attacks (L-822): the attacker's pool against the target's Reflex and
      // Athletics, each success past theirs a die more of damage; striking to
      // knock out with a lethal weapon costs a success.
      attack: {
        hit: 'opposed',
        defend: 'count((Reflex + Athletics)d10, >= 7)',
        extraSuccesses: 'addDie',
      },
      damageTypes: [
        { id: 'kinetic', name: 'Kinetic' },
        { id: 'energy', name: 'Energy' },
        { id: 'fire', name: 'Fire' },
        { id: 'toxic', name: 'Toxic' },
      ],
      health: 'health',
      subduePenalty: '-1',
      unarmed: {
        id: 'unarmed',
        name: 'Unarmed',
        reach: 1,
        attack: 'count((Body + Melee)d10, >= 7)',
        damage: '1',
        type: 'kinetic',
        lethal: false,
      },
      // Morale (L-824): Command, at a rung by posture; the reckless never break.
      morale: {
        check: { skill: 'Command' },
        rungs: {
          cowardly: 'Hard',
          cautious: 'Moderate',
          steady: 'Easy',
          bold: 'Easy',
          reckless: null,
        },
      },
      // At 0 (L-827): out at once, waking with a wound; Medicine stabilises;
      // death off. Rests: a short one eases Stress, a long one heals all and
      // closes wounds.
      down: {
        kind: 'outAtOnce',
        death: 'off',
        injury: 'wounded',
        hours: 1,
        stabilise: { skill: 'Medicine', against: 'Easy' },
      },
      rests: {
        short: { hours: 1, restore: { stress: '2' } },
        long: {
          hours: 8,
          restore: { health: 'full', stress: 'full' },
          clears: ['wounded', 'bleeding'],
        },
      },
      // Position (L-823): cover a success or two more on the defence, a
      // success fewer past normal range, Dodge two more; no flanking.
      cover: { partial: '1', heavy: '2' },
      longRange: '-1',
      dodge: '2',
      // What a new character carries until L-770's weapons.
      attacks: [
        {
          id: 'knife',
          name: 'Knife',
          reach: 1,
          attack: 'count((Body + Melee)d10, >= 7)',
          damage: '1d2',
          type: 'kinetic',
        },
        {
          id: 'pistol',
          name: 'Pistol',
          range: { normal: 10, long: 30 },
          attack: 'count((Reflex + Shooting)d10, >= 7)',
          damage: '1d3',
          type: 'energy',
        },
      ],
    },
  },
  gmNotes:
    'Hard-edged science fiction: crews, ships, stations and the debts that bind them. Tech is ' +
    'everywhere and none of it is free. Call for a check when the outcome is uncertain and it ' +
    'matters. One success short still gets it done, but costs stress, time, a part, or ' +
    'attention. No successes at all goes wrong in a way the crew has to deal with. Let ' +
    'consequences carry from scene to scene.',
};

module.exports = { FANTASY, SCIFI };
