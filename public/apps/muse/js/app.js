(function () {
  'use strict';

  // The Muse's start and its routes (M-101 / #889):
  //   #/          the home page: your projects
  //   #/p/<id>    a project's home

  var Muse = window.Muse;
  var state = Muse.state;

  function view(name) {
    Muse.show(Muse.$('muse-home'), name === 'home');
    Muse.show(Muse.$('muse-project'), name === 'project');
    Muse.show(Muse.$('muse-missing'), name === 'missing');
    window.scrollTo(0, 0);
  }

  function route() {
    var hash = window.location.hash || '#/';
    var m = /^#\/p\/([^/]+)\/?$/.exec(hash);
    if (m) {
      var id = decodeURIComponent(m[1]);
      return Muse.project.show(id).then(function (found) {
        view(found ? 'project' : 'missing');
      });
    }
    document.title = 'The Muse — Olympus';
    view('home');
    return Muse.home.show();
  }

  Muse.app = {
    route: route,

    init: function (user) {
      state.db = firebase.firestore();
      state.uid = user.uid;

      // The muse claim opens the app (MU1). The rules enforce it; the page
      // explains it.
      return user.getIdTokenResult().then(function (token) {
        var apps = Array.isArray(token.claims.apps) ? token.claims.apps : [];
        if (apps.indexOf('muse') === -1) {
          Muse.show(Muse.$('muse-denied'), true);
          return;
        }
        Muse.home.init();
        Muse.project.init();
        document.addEventListener('click', function (event) {
          // An element link in a text (muse:el/<id>); elements come in M-102.
          var a = event.target.closest && event.target.closest('a.muse-el-link');
          if (a) event.preventDefault();
        });
        window.addEventListener('hashchange', route);
        return route();
      });
    },
  };
})();
