(function () {
  'use strict';

  var Pantheon = (window.Pantheon = window.Pantheon || {});

  Pantheon.appsTab = {
    loaded: false,

    load: function () {
      if (Pantheon.appsTab.loaded) return;

      var container = document.getElementById('apps-grid');
      var loadingMsg = document.getElementById('apps-loading');
      var errorMsg = document.getElementById('apps-error');

      if (loadingMsg) loadingMsg.classList.remove('hidden');
      if (errorMsg) errorMsg.classList.add('hidden');

      Pantheon.state.db
        .collection('apps')
        .orderBy('order')
        .get()
        .then(function (snapshot) {
          if (loadingMsg) loadingMsg.classList.add('hidden');
          Pantheon.appsTab.loaded = true;

          if (!container) return;
          container.innerHTML = '';

          if (snapshot.empty) {
            container.innerHTML = '<p class="muted">No apps registered.</p>';
            return;
          }

          snapshot.forEach(function (doc) {
            var app = doc.data();
            var card = document.createElement('div');
            card.className = 'app-card' + (app.enabled ? '' : ' app-card-disabled');

            var destination = app.type === 'redirect' ? app.url : app.path;

            card.innerHTML =
              '<div class="app-card-icon">' +
              Pantheon.appsTab.escapeHtml(app.icon || '🔹') +
              '</div>' +
              '<div class="app-card-name">' +
              Pantheon.appsTab.escapeHtml(app.name || doc.id) +
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
