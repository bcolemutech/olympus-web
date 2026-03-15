(function () {
  'use strict';

  var Pantheon = (window.Pantheon = window.Pantheon || {});

  Pantheon.appsTab = {
    loaded: false,
    _cache: null,

    /**
     * Fetch and parse the YAML app registry. Result is cached for the session.
     * @returns {Promise<Array>} array of app objects
     */
    fetchApps: function () {
      if (Pantheon.appsTab._cache) {
        return Promise.resolve(Pantheon.appsTab._cache);
      }
      return fetch('/apps.yaml')
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to load apps.yaml: ' + res.status);
          return res.text();
        })
        .then(function (text) {
          var manifest = window.jsyaml.load(text);
          var apps = manifest && Array.isArray(manifest.apps) ? manifest.apps : [];
          Pantheon.appsTab._cache = apps;
          return apps;
        });
    },

    load: function () {
      if (Pantheon.appsTab.loaded) return;

      var container = document.getElementById('apps-grid');
      var loadingMsg = document.getElementById('apps-loading');
      var errorMsg = document.getElementById('apps-error');

      if (loadingMsg) loadingMsg.classList.remove('hidden');
      if (errorMsg) errorMsg.classList.add('hidden');

      Pantheon.appsTab
        .fetchApps()
        .then(function (apps) {
          if (loadingMsg) loadingMsg.classList.add('hidden');
          Pantheon.appsTab.loaded = true;

          if (!container) return;
          container.innerHTML = '';

          if (apps.length === 0) {
            container.innerHTML = '<p class="muted">No apps registered.</p>';
            return;
          }

          apps
            .slice()
            .sort(function (a, b) {
              return (a.order || 0) - (b.order || 0);
            })
            .forEach(function (app) {
              var card = document.createElement('div');
              card.className = 'app-card' + (app.enabled ? '' : ' app-card-disabled');

              var destination =
                app.type === 'redirect' ? app.url : app.type === 'jsx' ? app.file : app.path;

              card.innerHTML =
                '<div class="app-card-icon">' +
                Pantheon.appsTab.escapeHtml(app.icon || '🔹') +
                '</div>' +
                '<div class="app-card-name">' +
                Pantheon.appsTab.escapeHtml(app.name || app.id) +
                '</div>' +
                '<div class="app-card-desc">' +
                Pantheon.appsTab.escapeHtml(app.description || '') +
                '</div>' +
                '<div class="app-card-meta">' +
                '<span class="meta-tag">' +
                Pantheon.appsTab.escapeHtml(app.type || '') +
                '</span>' +
                (app.enabled
                  ? '<span class="badge badge-ok">Enabled</span>'
                  : '<span class="badge badge-warn">Disabled</span>') +
                '</div>' +
                '<div class="app-card-path monospace">' +
                Pantheon.appsTab.escapeHtml(destination || '') +
                '</div>';

              container.appendChild(card);
            });
        })
        .catch(function (err) {
          if (loadingMsg) loadingMsg.classList.add('hidden');
          if (errorMsg) {
            errorMsg.textContent = 'Error loading apps: ' + (err.message || 'Unknown error');
            errorMsg.classList.remove('hidden');
          }
        });
    },

    escapeHtml: function (str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },
  };
})();
