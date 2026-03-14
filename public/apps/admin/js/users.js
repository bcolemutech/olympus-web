(function () {
  'use strict';

  var Pantheon = (window.Pantheon = window.Pantheon || {});

  Pantheon.users = {
    load: function (emailPrefix, pageToken) {
      var state = Pantheon.state.users;
      if (state.loading) return;

      state.loading = true;
      state.emailPrefix = emailPrefix || '';

      var loadMoreBtn = document.getElementById('users-load-more');
      var loadingMsg = document.getElementById('users-loading');
      var errorMsg = document.getElementById('users-error');

      if (loadingMsg) loadingMsg.classList.remove('hidden');
      if (errorMsg) errorMsg.classList.add('hidden');
      if (loadMoreBtn) loadMoreBtn.classList.add('hidden');

      var listUsers = Pantheon.state.functions.httpsCallable('listUsers');
      listUsers({ emailPrefix: state.emailPrefix, pageToken: pageToken || null })
        .then(function (result) {
          state.loading = false;
          if (loadingMsg) loadingMsg.classList.add('hidden');

          if (!pageToken) {
            state.list = result.data.users;
            Pantheon.users.renderTable(state.list);
          } else {
            state.list = state.list.concat(result.data.users);
            Pantheon.users.appendRows(result.data.users);
          }

          state.nextPageToken = result.data.nextPageToken;
          if (loadMoreBtn) {
            if (state.nextPageToken) {
              loadMoreBtn.classList.remove('hidden');
            } else {
              loadMoreBtn.classList.add('hidden');
            }
          }
        })
        .catch(function (err) {
          state.loading = false;
          if (loadingMsg) loadingMsg.classList.add('hidden');
          if (errorMsg) {
            errorMsg.textContent = 'Error loading users: ' + (err.message || 'Unknown error');
            errorMsg.classList.remove('hidden');
          }
        });
    },

    search: function (prefix) {
      Pantheon.state.users.nextPageToken = null;
      Pantheon.users.load(prefix, null);
    },

    renderTable: function (users) {
      var tbody = document.getElementById('users-tbody');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (users.length === 0) {
        var emptyRow = document.createElement('tr');
        emptyRow.innerHTML = '<td colspan="5" class="users-empty">No users found.</td>';
        tbody.appendChild(emptyRow);
        return;
      }

      users.forEach(function (user) {
        tbody.appendChild(Pantheon.users.createRow(user));
      });
    },

    appendRows: function (users) {
      var tbody = document.getElementById('users-tbody');
      if (!tbody) return;
      // Remove empty-state row if present
      var emptyRow = tbody.querySelector('.users-empty');
      if (emptyRow) emptyRow.parentNode.removeChild(emptyRow);
      users.forEach(function (user) {
        tbody.appendChild(Pantheon.users.createRow(user));
      });
    },

    createRow: function (user) {
      var tr = document.createElement('tr');
      tr.className = 'user-row';
      tr.setAttribute('data-uid', user.uid);

      var apps = Array.isArray(user.customClaims.apps) ? user.customClaims.apps : [];
      var appPills = apps
        .map(function (a) {
          return '<span class="claim-pill">' + Pantheon.users.escapeHtml(a) + '</span>';
        })
        .join('');

      var lastSignIn = user.lastSignInTime
        ? new Date(user.lastSignInTime).toLocaleDateString()
        : '—';

      tr.innerHTML =
        '<td class="user-email">' +
        Pantheon.users.escapeHtml(user.email || '—') +
        '</td>' +
        '<td class="user-verified">' +
        (user.emailVerified
          ? '<span class="badge badge-ok">Verified</span>'
          : '<span class="badge badge-warn">Unverified</span>') +
        '</td>' +
        '<td class="user-apps">' +
        (appPills || '<span class="muted">none</span>') +
        '</td>' +
        '<td class="user-signin">' +
        lastSignIn +
        '</td>' +
        '<td class="user-expand"><button class="expand-btn" type="button" aria-expanded="false">&#9656;</button></td>';

      var expandBtn = tr.querySelector('.expand-btn');
      expandBtn.addEventListener('click', function () {
        Pantheon.users.toggleDetail(tr, user);
      });

      return tr;
    },

    toggleDetail: function (tr, user) {
      var existingDetail = tr.nextSibling;
      if (existingDetail && existingDetail.classList.contains('user-detail-row')) {
        existingDetail.parentNode.removeChild(existingDetail);
        tr.querySelector('.expand-btn').setAttribute('aria-expanded', 'false');
        tr.querySelector('.expand-btn').innerHTML = '&#9656;';
        return;
      }

      tr.querySelector('.expand-btn').setAttribute('aria-expanded', 'true');
      tr.querySelector('.expand-btn').innerHTML = '&#9662;';

      var detailRow = document.createElement('tr');
      detailRow.className = 'user-detail-row';

      var createdAt = user.creationTime ? new Date(user.creationTime).toLocaleString() : '—';
      var lastSignIn = user.lastSignInTime ? new Date(user.lastSignInTime).toLocaleString() : '—';

      detailRow.innerHTML =
        '<td colspan="5">' +
        '<div class="user-detail">' +
        '<div class="detail-grid">' +
        '<div class="detail-field"><span class="detail-label">UID</span><span class="detail-value monospace">' +
        Pantheon.users.escapeHtml(user.uid) +
        '</span></div>' +
        '<div class="detail-field"><span class="detail-label">Created</span><span class="detail-value">' +
        Pantheon.users.escapeHtml(createdAt) +
        '</span></div>' +
        '<div class="detail-field"><span class="detail-label">Last Sign-In</span><span class="detail-value">' +
        Pantheon.users.escapeHtml(lastSignIn) +
        '</span></div>' +
        '<div class="detail-field"><span class="detail-label">Disabled</span><span class="detail-value">' +
        (user.disabled
          ? '<span class="badge badge-error">Yes</span>'
          : '<span class="badge badge-ok">No</span>') +
        '</span></div>' +
        '</div>' +
        '<div class="detail-field detail-claims"><span class="detail-label">Custom Claims</span>' +
        '<pre class="claims-json">' +
        Pantheon.users.escapeHtml(JSON.stringify(user.customClaims, null, 2)) +
        '</pre></div>' +
        '</div>' +
        '</td>';

      tr.parentNode.insertBefore(detailRow, tr.nextSibling);
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
