(function () {
  'use strict';

  var Pantheon = (window.Pantheon = window.Pantheon || {});

  var TABS = ['users', 'apps'];
  var searchDebounce = null; // holds window.setTimeout handle

  Pantheon.switchTab = function (tabName) {
    if (TABS.indexOf(tabName) === -1) return;
    Pantheon.state.activeTab = tabName;

    TABS.forEach(function (t) {
      var btn = document.getElementById('tab-' + t);
      var panel = document.getElementById('panel-' + t);
      if (btn) {
        btn.classList.toggle('active', t === tabName);
        btn.setAttribute('aria-selected', String(t === tabName));
      }
      if (panel) {
        panel.classList.toggle('hidden', t !== tabName);
      }
    });

    if (tabName === 'apps') {
      Pantheon.appsTab.load();
    }
  };

  Pantheon.start = function (user) {
    Pantheon.init(user);
    window.OlympusHeader.render('The Pantheon');

    document.getElementById('app-loading').classList.add('hidden');
    document.getElementById('app-main').classList.remove('hidden');

    // Wire up tab buttons
    TABS.forEach(function (t) {
      var btn = document.getElementById('tab-' + t);
      if (btn) {
        btn.addEventListener('click', function () {
          Pantheon.switchTab(t);
        });
      }
    });

    // Wire up search input with debounce
    var searchInput = document.getElementById('users-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        window.clearTimeout(searchDebounce);
        var prefix = searchInput.value;
        searchDebounce = window.setTimeout(function () {
          Pantheon.users.search(prefix);
        }, 350);
      });
    }

    // Wire up "Load More" button
    var loadMoreBtn = document.getElementById('users-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function () {
        Pantheon.users.load(Pantheon.state.users.emailPrefix, Pantheon.state.users.nextPageToken);
      });
    }

    // Wire up invite user controls
    var inviteBtn = document.getElementById('invite-user-btn');
    if (inviteBtn) {
      inviteBtn.addEventListener('click', function () {
        Pantheon.users.invite.showForm();
      });
    }

    var inviteCancelBtn = document.getElementById('invite-cancel');
    if (inviteCancelBtn) {
      inviteCancelBtn.addEventListener('click', function () {
        Pantheon.users.invite.hideForm();
      });
    }

    var inviteSubmitBtn = document.getElementById('invite-submit');
    if (inviteSubmitBtn) {
      inviteSubmitBtn.addEventListener('click', function () {
        Pantheon.users.invite.submit();
      });
    }

    // Initial load
    Pantheon.switchTab('users');
    Pantheon.users.load('', null);
  };

  document.addEventListener('DOMContentLoaded', function () {
    firebase.auth().onAuthStateChanged(function (user) {
      if (!user) {
        window.location.href = '/';
        return;
      }

      user
        .getIdTokenResult(true)
        .then(function (tokenResult) {
          if (!tokenResult.claims.admin) {
            window.location.href = '/';
            return;
          }
          Pantheon.start(user);
        })
        .catch(function () {
          window.location.href = '/';
        });
    });
  });
})();
