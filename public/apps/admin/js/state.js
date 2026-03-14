(function () {
  'use strict';

  var Pantheon = (window.Pantheon = window.Pantheon || {});

  Pantheon.state = {
    db: null,
    functions: null,
    currentUser: null,
    activeTab: 'users',

    users: {
      list: [],
      nextPageToken: null,
      loading: false,
      emailPrefix: '',
    },
  };

  Pantheon.init = function (user) {
    Pantheon.state.db = firebase.firestore();
    Pantheon.state.functions = firebase.functions();
    Pantheon.state.currentUser = user;
  };
})();
