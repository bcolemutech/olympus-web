(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  T.MODES = { WORLD: 'world', PLAY: 'play' };
  T.DEFAULT_MODE = 'world';
  T.LAND_HEAVY_THRESHOLD = 60;

  T.state = {
    db: null,
    currentUser: null,
    currentMode: null,
  };
})();
