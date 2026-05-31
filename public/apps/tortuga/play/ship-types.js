(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  // Static ship class catalog. All stat values are on the T.STAT_SCALE (1–100) scale.
  // Base stats are denormalized onto flagship instances at new-game creation time.
  T.SHIP_TYPES = {
    sloop: {
      classId: 'sloop',
      name: 'Sloop',
      icon: '⛵',
      description:
        'A nimble single-masted raider. Fast enough to close, agile enough to disengage, ' +
        'and small enough to hide in coves no patrol dares follow.',
      baseStats: {
        hull: { current: 40, max: 40 },
        sails: { current: 35, max: 35 },
        guns: { count: 6, weight: 4 },
        crew: { current: 25, min: 8, max: 30 },
        morale: 60,
        cargo: { used: 0, capacity: 25, manifest: [] },
        upgrades: [],
        speed: 75,
        maneuverability: 80,
        draft: 20,
        damage: { hull: 0, sails: 0, guns: 0, hold: 0 },
        location: null,
        squadId: null,
      },
    },

    schooner: {
      classId: 'schooner',
      name: 'Schooner',
      icon: '🚢',
      description:
        'A two-masted workhorse that earns her keep on trade runs. Generous hold, ' +
        'good speed, and enough guns to discourage casual trouble.',
      baseStats: {
        hull: { current: 50, max: 50 },
        sails: { current: 45, max: 45 },
        guns: { count: 8, weight: 6 },
        crew: { current: 35, min: 12, max: 40 },
        morale: 60,
        cargo: { used: 0, capacity: 50, manifest: [] },
        upgrades: [],
        speed: 65,
        maneuverability: 65,
        draft: 30,
        damage: { hull: 0, sails: 0, guns: 0, hold: 0 },
        location: null,
        squadId: null,
      },
    },

    cutter: {
      classId: 'cutter',
      name: 'Cutter',
      icon: '⚔️',
      description:
        'A stout fore-and-aft rigged warship favored by privateers. She takes a punch ' +
        'better than anything her size, and her broadside makes escorts think twice.',
      baseStats: {
        hull: { current: 60, max: 60 },
        sails: { current: 40, max: 40 },
        guns: { count: 10, weight: 6 },
        crew: { current: 45, min: 15, max: 50 },
        morale: 65,
        cargo: { used: 0, capacity: 20, manifest: [] },
        upgrades: [],
        speed: 55,
        maneuverability: 60,
        draft: 35,
        damage: { hull: 0, sails: 0, guns: 0, hold: 0 },
        location: null,
        squadId: null,
      },
    },

    pinnace: {
      classId: 'pinnace',
      name: 'Pinnace',
      icon: '🛶',
      description:
        'A tiny open-decked scout. No ship in the archipelago is faster or harder to ' +
        'spot. She slips through shallows that strand heavier vessels.',
      baseStats: {
        hull: { current: 20, max: 20 },
        sails: { current: 20, max: 20 },
        guns: { count: 2, weight: 4 },
        crew: { current: 10, min: 4, max: 12 },
        morale: 70,
        cargo: { used: 0, capacity: 10, manifest: [] },
        upgrades: [],
        speed: 85,
        maneuverability: 90,
        draft: 10,
        damage: { hull: 0, sails: 0, guns: 0, hold: 0 },
        location: null,
        squadId: null,
      },
    },
  };
})();
