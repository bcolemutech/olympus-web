'use strict';

/**
 * The checks for hidden things, on a save as it stands (planning/maps-from-
 * data.md §4.5; L-927 / #731): what its map hides that is in sight from where
 * it is, rolled for by the system's noticing check (../loom-canon/hidden.js).
 * Used wherever the save may have moved or looked: ADJUDICATE after an action
 * (./adjudicate.js) and a step walked by the rules alone (./index.js).
 *
 *   passive(world, save, dice)   each thing in sight not yet checked, once
 *   search(world, save, dice)    each thing in sight not yet found (Search)
 *
 * Each returns `{ mutations, lines, found }` (../loom-canon/hidden.js
 * notice): nothing when there is nothing to roll for. Pure but for the dice.
 */

const maps = require('../loom-canon/maps');
const checks = require('../loom-canon/checks');
const hidden = require('../loom-canon/hidden');
const sight = require('../loom-canon/sight');
const { doorStatesOf } = require('./steps');

function look(world, save, dice, search) {
  const { map } = maps.positionOf(world || {}, save);
  if (!map) return { mutations: [], lines: [], found: [] };
  const doors = doorStatesOf(save, map.id);
  return hidden.notice(checks.systemOf(world), map, save, {
    dice,
    inSight: () => sight.inSight(map, maps.viewerOf(world, save), doors),
    search,
  });
}

const passive = (world, save, dice) => look(world, save, dice, false);
const search = (world, save, dice) => look(world, save, dice, true);

module.exports = { passive, search };
