'use strict';

/**
 * The crypt the hidden-things and spawn tests use (loom-hidden.test.js,
 * loom-hidden-play.test.js; planning/maps-from-data.md §4.5; L-927 / #731): a
 * battle map with a secret door, a hidden cache, a hidden trap and spawns.
 */

const geo = require('../../functions/loom-canon/map-geometry');

// A crypt 12 × 8 squares (60 × 40 ft): a wall down x = 30 ft with a secret
// door in it (y 15–20 ft, an easy 8 to notice, closed) between the vestibule
// (west, where the player arrives) and the vault (east); a cache in the
// vestibule's corner (a Hard 16 to notice) that opens like any container; a
// pit trap hidden in the vestibule (squares (3, 4) and (3, 5): it springs on
// whoever walks into it); a den spawn in the vault that names its goblins and
// a generic spawn in the vestibule's far corner that names no one.
// `trap`: what the pit puts on whoever walks into it, by the system's own
// condition and save (the built-in systems differ).
const CRYPT = (trap = { condition: 'poisoned', save: { attribute: 'CON', against: 'Easy' } }) => ({
  id: 'bm_crypt',
  name: 'The crypt',
  width: 12,
  height: 8,
  entries: [{ id: 'in', x: 1, y: 6 }],
  exits: [{ id: 'out', name: 'the stair', x: 0, y: 4, to: 'out' }],
  features: [],
  hazards: [
    {
      id: 'pit',
      name: 'the pit trap',
      hidden: { dc: 10 },
      area: { shape: 'square', x: 3, y: 4, size: 2 },
      effect: {
        condition: trap.condition,
        duration: { turns: 2 },
        save: { ...trap.save, when: 'apply' },
      },
    },
  ],
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
        id: 'secret',
        material: 'wood',
        name: 'a secret door',
        from: [30, 15],
        to: [30, 20],
        wall: 'wall',
        state: 'closed',
      },
    ],
    objects: [
      {
        id: 'cache',
        kind: 'chest',
        name: 'a cache',
        at: [7.5, 7.5],
        size: [3, 2],
        container: { contents: 'a pouch of coins' },
      },
    ],
    spawns: [
      {
        id: 'den',
        name: 'the den',
        shape: { rect: { x: 40, y: 5, w: 15, h: 15 } },
        what: 'goblin',
        count: 2,
      },
      { id: 'corner', shape: { rect: { x: 5, y: 30, w: 15, h: 10 } } },
    ],
    hidden: [
      { id: 'secret', dc: 8 },
      { id: 'cache', dc: 'Hard' },
    ],
  }),
});

module.exports = { CRYPT };
