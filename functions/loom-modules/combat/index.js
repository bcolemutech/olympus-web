'use strict';

/**
 * The combat module (planning/combat.md; L-820 / #651): fights on battle maps
 * in rounds, run by the rules and the server's dice (CB0), configured by each
 * system's `modules.combat` (MD1–MD3).
 *
 *   ./settings.js  the system's settings, checked on save, and their defaults
 *   ./fight.js     a fight: initiative, surprise, turns and rounds, ending (pure)
 *   ./play.js      fights on a save, for ADJUDICATE: sides, starting, the
 *                  rounds after each of the player's turns, ending
 *   ./attacks.js   attacks on sheets: their shape, checks, and whose are whose
 *   ./strike.js    an attack rolled: hitting, damage by degree and type,
 *                  effects on a hit, ammunition (pure)
 *   ./attack-turn.js  the player's attack as a turn, for ADJUDICATE
 */

module.exports = {
  settings: require('./settings'),
  fight: require('./fight'),
  play: require('./play'),
  attacks: require('./attacks'),
  strike: require('./strike'),
  attackTurn: require('./attack-turn'),
};
