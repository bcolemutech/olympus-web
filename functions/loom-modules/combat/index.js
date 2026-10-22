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
 *   ./figures.js   figures placed from stat blocks, roles and postures, and
 *                  the world as a save sees it (withFigures)
 *   ./tactics.js   an unnamed fighter's turn by role and posture (pure)
 *   ./others.js    everyone else's turns, morale, the player falling
 *   ./down.js      what 0 means: dying saves, wounds, out; coming round,
 *                  death, fates
 *   ./rests.js     short and long rests, and what can interrupt them
 *   ./position.js  reach and range, cover, flanking, Dodge, defending
 *                  reactions (pure)
 *   ./reactions.js what a walk draws: leaving reach, a readied attack (pure)
 */

module.exports = {
  settings: require('./settings'),
  fight: require('./fight'),
  play: require('./play'),
  attacks: require('./attacks'),
  strike: require('./strike'),
  attackTurn: require('./attack-turn'),
  figures: require('./figures'),
  tactics: require('./tactics'),
  others: require('./others'),
  down: require('./down'),
  rests: require('./rests'),
  position: require('./position'),
  reactions: require('./reactions'),
};
