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
 */

module.exports = {
  settings: require('./settings'),
  fight: require('./fight'),
  play: require('./play'),
};
