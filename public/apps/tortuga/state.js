(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  T.MODES = { WORLD: 'world', PLAY: 'play' };
  T.DEFAULT_MODE = 'world';
  T.LAND_HEAVY_THRESHOLD = 60;
  T.STAT_SCALE = 100;
  T.DISCOVERY_RADIUS = 30;
  T.HIDDEN_COVE_RADIUS = 12;
  T.FRIENDLY_PORT_TYPES = ['colonial_port', 'free_port'];
  T.EVENT_CHANCE = 0.25;

  T.DIFFICULTY_LEVELS = {
    easy: {
      label: 'Easy',
      description: 'Forgiving seas. Supply use halved.',
      supplyRate: 0.5,
      eventLethality: 0.5,
    },
    normal: {
      label: 'Normal',
      description: 'Balanced challenge.',
      supplyRate: 1.0,
      eventLethality: 1.0,
    },
    hard: {
      label: 'Hard',
      description: 'Every league costs you.',
      supplyRate: 1.5,
      eventLethality: 1.5,
    },
    brutal: {
      label: 'Brutal',
      description: 'The sea shows no mercy.',
      supplyRate: 2.0,
      eventLethality: 2.0,
    },
  };

  T.SUPPLY_BASE_RATES = {
    food: 0.2,
    water: 0.2,
    rum: 0.1,
  };

  T.state = {
    db: null,
    currentUser: null,
    currentMode: null,
  };
})();
