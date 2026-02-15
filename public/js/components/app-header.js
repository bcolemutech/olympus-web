/**
 * Olympus – Shared App Header Component
 *
 * Renders a consistent navigation header for embedded apps.
 * Requires the Firebase compat SDK to be loaded first.
 *
 * Usage:
 *   <div id="appHeader"></div>
 *   <script src="/js/components/app-header.js"></script>
 *   <script>
 *     firebase.auth().onAuthStateChanged(function (user) {
 *       if (!user) { window.location.href = '/'; return; }
 *       window.OlympusHeader.render('My App Name');
 *     });
 *   </script>
 */
(function () {
  'use strict';

  /**
   * Render the app header into #appHeader.
   * @param {string} appName – display name shown in the header
   */
  function render(appName) {
    var container = document.getElementById('appHeader');
    if (!container) {
      console.error('OlympusHeader: #appHeader element not found');
      return;
    }

    var header = document.createElement('header');
    header.className = 'app-header';

    // ── Left side ──
    var left = document.createElement('div');
    left.className = 'app-header-left';

    var backLink = document.createElement('a');
    backLink.className = 'app-header-back';
    backLink.href = '/';
    backLink.textContent = '\u2190 The Grand Hall';

    var name = document.createElement('span');
    name.className = 'app-header-name';
    name.textContent = appName;

    left.appendChild(backLink);
    left.appendChild(name);

    // ── Right side ──
    var right = document.createElement('div');
    right.className = 'app-header-right';

    var profileLink = document.createElement('a');
    profileLink.className = 'app-header-link';
    profileLink.href = '/';
    profileLink.textContent = "The Oracle's Mirror";
    profileLink.addEventListener('click', function (e) {
      e.preventDefault();
      // Navigate to main SPA which handles profile view
      window.location.href = '/?view=profile';
    });

    var signOutBtn = document.createElement('button');
    signOutBtn.className = 'app-header-link';
    signOutBtn.type = 'button';
    signOutBtn.textContent = 'Leave Olympus';
    signOutBtn.addEventListener('click', function () {
      firebase
        .auth()
        .signOut()
        .then(function () {
          window.location.href = '/';
        })
        .catch(function (err) {
          console.error('Sign-out failed:', err);
        });
    });

    right.appendChild(profileLink);
    right.appendChild(signOutBtn);

    header.appendChild(left);
    header.appendChild(right);

    container.innerHTML = '';
    container.appendChild(header);
  }

  // Expose globally
  window.OlympusHeader = { render: render };
})();
