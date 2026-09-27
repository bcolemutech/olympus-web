(function () {
  'use strict';

  var Cartographer = window.Cartographer;
  var state = Cartographer.state;

  // Shows the connector URL and copies it, with a short confirmation.
  function initConnector() {
    var url = Cartographer.CONNECTOR_URL;
    var status = Cartographer.getRef('carto-connector-status');
    Cartographer.getRef('carto-connector-url').textContent = url;

    function say(message) {
      status.textContent = message;
      Cartographer.show('carto-connector-status', true);
      window.clearTimeout(status._hideTimer);
      status._hideTimer = window.setTimeout(function () {
        Cartographer.show('carto-connector-status', false);
      }, 4000);
    }

    Cartographer.getRef('carto-connector-copy').addEventListener('click', function () {
      var manual = 'Copy the URL above, then add it in Claude under Settings → Connectors.';
      var clipboard = window.navigator.clipboard;
      if (!clipboard || !clipboard.writeText) return say(manual);
      clipboard.writeText(url).then(
        function () {
          say('Copied! In Claude, add it under Settings → Connectors.');
        },
        function () {
          say(manual);
        }
      );
    });
  }

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
          Cartographer.show('carto-claude-section', false);
          Cartographer.show('carto-worlds-section', false);
          return;
        }
        Cartographer.upload.init();
        initConnector();
        Cartographer.worlds.loadWorlds();
      });
    },
  };
})();
