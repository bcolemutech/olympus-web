(function () {
  'use strict';

  var _analytics = null;

  function init() {
    try {
      _analytics = firebase.analytics();
    } catch {
      // Analytics unavailable (e.g. emulator, ad blocker, or SDK not loaded)
    }
  }

  function logEvent(eventName, params) {
    if (!_analytics) return;
    try {
      _analytics.logEvent(eventName, params);
    } catch {
      // Silently ignore — analytics must never break the app
    }
  }

  window.OlympusAnalytics = { init: init, logEvent: logEvent };
})();
