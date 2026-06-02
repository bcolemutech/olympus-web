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

  T.state = {
    db: null,
    currentUser: null,
    currentMode: null,
  };
})();
