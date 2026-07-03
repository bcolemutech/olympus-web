(function () {
  'use strict';

  var Loom = window.Loom;
  var state = Loom.state;

  Loom.app = {
    init: function (user) {
      state.db = firebase.firestore();
      state.functions = firebase.functions();
      state.uid = user.uid;
    },
  };
})();
