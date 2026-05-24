(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  function getMode() {
    var params = new URLSearchParams(window.location.search);
    var m = params.get('mode');
    return m === T.MODES.PLAY ? T.MODES.PLAY : T.MODES.WORLD;
  }

  T.showMode = function (mode) {
    var shells = [T.MODES.WORLD, T.MODES.PLAY];
    shells.forEach(function (m) {
      var el = document.getElementById('shell-' + m);
      if (el) el.classList.toggle('hidden', m !== mode);
    });
    T.state.currentMode = mode;
  };

  T.init = function (user) {
    T.state.currentUser = user;
    T.state.db = firebase.firestore();
    T.showMode(getMode());
  };
})();
