(function () {
  'use strict';

  var currentRoot = null;
  var currentAppletId = null;

  // ── DOM refs ──

  var sidebarList = document.getElementById('jsx-sidebar-list');
  var jsxRoot = document.getElementById('jsx-root');
  var welcome = document.getElementById('jsx-welcome');

  // ── Manifest loading ──

  function loadManifest() {
    return fetch('/apps/jsx-runner/applets.yaml')
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to load applets.yaml: ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var manifest = window.jsyaml.load(text);
        return manifest && Array.isArray(manifest.applets) ? manifest.applets : [];
      });
  }

  // ── Menu rendering ──

  function renderMenu(applets) {
    sidebarList.innerHTML = '';

    applets.forEach(function (applet) {
      var item = document.createElement('div');
      item.className = 'jsx-sidebar-item';
      item.setAttribute('tabindex', '0');
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', applet.name);
      item.dataset.id = applet.id;

      var icon = document.createElement('span');
      icon.className = 'jsx-sidebar-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = applet.icon || '';

      var info = document.createElement('div');
      info.className = 'jsx-sidebar-info';

      var name = document.createElement('span');
      name.className = 'jsx-sidebar-name';
      name.textContent = applet.name;

      var desc = document.createElement('span');
      desc.className = 'jsx-sidebar-desc';
      desc.textContent = applet.description || '';

      info.appendChild(name);
      info.appendChild(desc);
      item.appendChild(icon);
      item.appendChild(info);

      var activate = function () {
        loadApplet(applet);
      };

      item.addEventListener('click', activate);
      item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });

      sidebarList.appendChild(item);
    });
  }

  // ── Sidebar active state ──

  function setActiveItem(appletId) {
    var items = sidebarList.querySelectorAll('.jsx-sidebar-item');
    items.forEach(function (item) {
      item.classList.toggle('active', item.dataset.id === appletId);
    });
  }

  // ── Applet loading ──

  function loadApplet(applet) {
    if (currentAppletId === applet.id) return;
    currentAppletId = applet.id;

    // Update sidebar highlight
    setActiveItem(applet.id);

    // Update URL hash
    window.location.hash = applet.id;

    // Hide welcome, show loading
    welcome.classList.add('hidden');
    jsxRoot.innerHTML =
      '<div class="jsx-applet-loading">' +
      '<div class="app-spinner"></div>' +
      '<span class="jsx-applet-loading-text">Loading applet\u2026</span>' +
      '</div>';

    // Unmount previous React root
    if (currentRoot) {
      try {
        currentRoot.unmount();
      } catch (e) {
        console.warn('Failed to unmount previous root:', e);
      }
      currentRoot = null;
    }

    // Fetch and run the JSX file
    fetch('/apps/jsx-runner/applets/' + applet.file)
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to load ' + applet.file + ': ' + res.status);
        return res.text();
      })
      .then(function (source) {
        // Clear any previous applet global
        delete window.__JSX_APPLET__;

        // Transpile JSX to JS
        var result = window.Babel.transform(source, {
          presets: ['react'],
          filename: applet.file,
        });

        // Execute transpiled code
        var fn = new Function(result.code);
        fn();

        // Mount the component
        var Component = window.__JSX_APPLET__;
        if (!Component) {
          throw new Error(
            'Applet did not set window.__JSX_APPLET__. ' +
              'Each .jsx file must assign a component to window.__JSX_APPLET__.'
          );
        }

        jsxRoot.innerHTML = '';
        currentRoot = ReactDOM.createRoot(jsxRoot);
        currentRoot.render(React.createElement(Component));
      })
      .catch(function (err) {
        showError(err);
      });
  }

  // ── Error display ──

  function showError(err) {
    jsxRoot.innerHTML =
      '<div class="jsx-error">' +
      '<div class="jsx-error-title">Applet Error</div>' +
      '<p>' +
      escapeHtml(err.message) +
      '</p>' +
      (err.stack ? '<pre>' + escapeHtml(err.stack) + '</pre>' : '') +
      '</div>';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Hash routing ──

  function loadFromHash(applets) {
    var hash = window.location.hash.replace('#', '');
    if (!hash) return false;

    var match = applets.find(function (a) {
      return a.id === hash;
    });
    if (match) {
      loadApplet(match);
      return true;
    }
    return false;
  }

  // ── Init ──

  document.addEventListener('DOMContentLoaded', function () {
    firebase.auth().onAuthStateChanged(function (user) {
      if (!user) {
        window.location.href = '/';
        return;
      }

      // Render the shared header
      window.OlympusHeader.render('JSX Runner');

      // Hide loading, show main content
      document.getElementById('app-loading').classList.add('hidden');
      document.getElementById('app-main').classList.remove('hidden');

      // Load manifest and build menu
      loadManifest()
        .then(function (applets) {
          renderMenu(applets);

          // Try loading from URL hash, otherwise show welcome
          if (!loadFromHash(applets)) {
            welcome.classList.remove('hidden');
          }

          // Listen for hash changes
          window.addEventListener('hashchange', function () {
            loadFromHash(applets);
          });
        })
        .catch(function (err) {
          console.error('Failed to load manifest:', err);
          showError(err);
        });
    });
  });
})();
