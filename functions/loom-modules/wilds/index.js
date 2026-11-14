'use strict';

/**
 * The wilds module (planning/off-road-travel.md §4.3, MD1, MD2; L-362 /
 * #836): off-road travel's numbers, set by each system's `modules.wilds`
 * and changed by a world's `rules.wilds` (or turned off by `false`).
 *
 *   ./settings.js  the settings, checked on save, their defaults, and a
 *                  world's over its system's
 *   ./navigate.js  the navigation check each day leg off the road: its
 *                  rung by danger, the roll, and the share of the day lost
 */

module.exports = {
  settings: require('./settings'),
  navigate: require('./navigate'),
};
