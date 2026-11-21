(function () {
  'use strict';

  // The Muse's start and its routes (M-101 / #889; M-102 / #890):
  //   #/                  the home page: your projects
  //   #/p/<id>            a project's home
  //   #/p/<id>/t/<type>   a list of one type's elements
  //   #/p/<id>/e/<el>     an element's page
  //   #/p/<id>/s/<words>  every element whose text holds the words (M-106)
  // and, inside a project, the search box in the header (M-103).

  var Muse = window.Muse;
  var state = Muse.state;
  var VIEWS = ['home', 'project', 'type', 'element', 'text', 'missing'];

  function view(name) {
    VIEWS.forEach(function (v) {
      Muse.show(Muse.$('muse-' + v), v === name);
    });
    window.scrollTo(0, 0);
  }

  // Routes run one after another, so one finishing late never draws over
  // (or swaps the open project or element under) the one after it.
  var routing = Promise.resolve();

  function route() {
    routing = routing.then(go, go);
    return routing;
  }

  function go() {
    var hash = window.location.hash || '#/';
    var m = /^#\/p\/([^/]+)(?:\/(t|e|s)\/([^/]+))?\/?$/.exec(hash);
    if (m) {
      var id = decodeURIComponent(m[1]);
      var shown =
        m[2] === 't'
          ? Muse.typeList.show(id, decodeURIComponent(m[3])).then(function (ok) {
              return ok && 'type';
            })
          : m[2] === 'e'
            ? Muse.element.show(id, decodeURIComponent(m[3])).then(function (ok) {
                return ok && 'element';
              })
            : m[2] === 's'
              ? Muse.textSearch.show(id, decodeURIComponent(m[3])).then(function (ok) {
                  return ok && 'text';
                })
              : Muse.project.show(id).then(function (ok) {
                  return ok && 'project';
                });
      return shown.then(function (name) {
        view(name || 'missing');
        Muse.search.sync(!!name);
      });
    }
    document.title = 'The Muse — Olympus';
    view('home');
    Muse.search.sync(false);
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
        Muse.fieldEditor.init();
        Muse.typeList.init();
        Muse.gallery.init();
        Muse.element.init();
        Muse.relationships.init();
        Muse.search.init();
        Muse.textSearch.init();
        document.addEventListener('click', function (event) {
          // An element link in a text (muse:el/<id>) opens its page.
          var a = event.target.closest && event.target.closest('a.muse-el-link');
          if (a) {
            event.preventDefault();
            if (state.project && a.dataset.el) {
              Muse.go(
                '#/p/' +
                  encodeURIComponent(state.project.id) +
                  '/e/' +
                  encodeURIComponent(a.dataset.el)
              );
            }
          }
        });
        window.addEventListener('hashchange', route);
        return route();
      });
    },
  };
})();
