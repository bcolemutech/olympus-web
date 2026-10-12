(function () {
  'use strict';

  var Studio = window.Studio;
  var state = Studio.state;

  Studio.app = {
    init: function (user) {
      state.db = firebase.firestore();
      state.functions = firebase.functions();
      state.storage = firebase.storage();
      state.uid = user.uid;

      // The cartographer claim opens the studio (S1). The rules and callables
      // enforce it; the page explains it.
      user.getIdTokenResult().then(function (token) {
        var apps = Array.isArray(token.claims.apps) ? token.claims.apps : [];
        if (apps.indexOf('cartographer') === -1) {
          Studio.show('studio-denied', true);
          return;
        }
        Studio.show('studio-upload-section', true);
        Studio.show('studio-library-section', true);
        Studio.detail.init();
        Studio.upload.init();
        Studio.library.init();
      });
    },
  };
})();
