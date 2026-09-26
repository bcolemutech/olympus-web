(function () {
  'use strict';

  var Cartographer = window.Cartographer;
  var state = Cartographer.state;

  Cartographer.app = {
    init: function (user) {
      state.db = firebase.firestore();
      state.functions = firebase.functions();
      state.storage = firebase.storage();
      state.uid = user.uid;

      // The claim gates everything server-side; the page just explains it.
      user.getIdTokenResult().then(function (token) {
        var apps = Array.isArray(token.claims.apps) ? token.claims.apps : [];
        if (apps.indexOf('cartographer') === -1) {
          Cartographer.show('carto-denied', true);
          Cartographer.show('carto-upload-section', false);
          Cartographer.show('carto-worlds-section', false);
          return;
        }
        Cartographer.upload.init();
        Cartographer.worlds.loadWorlds();
      });
    },
  };
})();
