'use strict';

/**
 * The vault the object tests use (loom-objects.test.js, loom-objects-play.
 * test.js; planning/maps-from-data.md §4.4; L-926 / #730): a battle map with
 * every sort of object.
 */

const geo = require('../../functions/loom-canon/map-geometry');

// A vault 12 × 8 (60 × 40 ft): a wall down x = 30 ft with a gate in it
// (y 15–20 ft), locked, which the lever opens; a chest by the west wall,
// locked, its key the brass key, its lock hard to pick and slow; a crate
// that opens at once; a bookshelf that is searched; a lever; and a statue
// that is only scenery.
const VAULT = () => ({
  id: 'bm_vault',
  name: 'The vault',
  width: 12,
  height: 8,
  entries: [{ id: 'in', x: 1, y: 6 }],
  exits: [{ id: 'out', name: 'the stair', x: 0, y: 4, to: 'out' }],
  features: [{ id: 'altar', name: 'the altar', x: 10, y: 6 }],
  geometry: geo.normalize({
    walls: [
      {
        id: 'wall',
        material: 'stone',
        points: [
          [30, 0],
          [30, 40],
        ],
      },
    ],
    doors: [
      {
        id: 'gate',
        material: 'gate',
        name: 'the iron gate',
        from: [30, 15],
        to: [30, 20],
        wall: 'wall',
        state: 'locked',
        unlocks: { action: 'lever.pull' },
      },
    ],
    objects: [
      {
        id: 'chest',
        kind: 'chest',
        at: [7.5, 22.5],
        size: [3, 2],
        description: 'an iron-bound chest',
        container: { contents: 'a silver dagger and 12 gold pieces' },
        locked: true,
        unlocks: { key: 'brass key' },
        difficulty: 18,
        long: { ap: 30 },
      },
      {
        id: 'crate',
        kind: 'crate',
        at: [7.5, 7.5],
        size: [3, 3],
        container: { contents: 'straw' },
        ap: 8,
      },
      {
        id: 'shelf',
        kind: 'bookshelf',
        at: [20, 37],
        size: [10, 2.5],
        container: { search: true },
      },
      {
        id: 'lever',
        kind: 'lever',
        at: [22.5, 2.5],
        size: [1, 1],
        actions: [{ id: 'pull', name: 'Pull', text: 'The lever grinds down.', ap: 3 }],
      },
      { id: 'statue', kind: 'statue', at: [50, 20], size: [3, 3], description: 'a stern king' },
      {
        id: 'strongbox',
        kind: 'chest',
        name: 'the strongbox',
        at: [45, 5],
        size: [3, 2],
        container: { contents: 'a deed' },
        locked: true,
        unlocks: { action: 'lever.pull' },
      },
    ],
  }),
});

module.exports = { VAULT };
