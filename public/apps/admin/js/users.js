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
      var emptyRow = tbody.querySelector('.users-empty');
      if (emptyRow) emptyRow.parentNode.removeChild(emptyRow);
      users.forEach(function (user) {
        tbody.appendChild(Pantheon.users.createRow(user));
      });
    },

    renderAppPills: function (apps) {
      if (!apps || apps.length === 0) return '<span class="muted">none</span>';
      return apps
        .map(function (a) {
          return '<span class="claim-pill">' + Pantheon.users.escapeHtml(a) + '</span>';
        })
        .join('');
    },

    createRow: function (user) {
      var tr = document.createElement('tr');
      tr.className = 'user-row';
      tr.setAttribute('data-uid', user.uid);

      var apps = Array.isArray(user.customClaims.apps) ? user.customClaims.apps : [];

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
        Pantheon.users.renderAppPills(apps) +
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

    updateRowAppPills: function (tr, apps) {
      var appCell = tr.querySelector('.user-apps');
      if (appCell) appCell.innerHTML = Pantheon.users.renderAppPills(apps);
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
      var safeUid = Pantheon.users.escapeHtml(user.uid);

      detailRow.innerHTML =
        '<td colspan="5">' +
        '<div class="user-detail">' +
        '<div class="detail-grid">' +
        '<div class="detail-field"><span class="detail-label">UID</span><span class="detail-value monospace">' +
        safeUid +
        '</span></div>' +
        '<div class="detail-field"><span class="detail-label">Created</span><span class="detail-value">' +
        Pantheon.users.escapeHtml(createdAt) +
        '</span></div>' +
        '<div class="detail-field"><span class="detail-label">Last Sign-In</span><span class="detail-value">' +
        Pantheon.users.escapeHtml(lastSignIn) +
        '</span></div>' +
        '<div class="detail-field">' +
        '<span class="detail-label">Status</span>' +
        '<span class="detail-value detail-disabled-badge">' +
        (user.disabled
          ? '<span class="badge badge-error">Disabled</span>'
          : '<span class="badge badge-ok">Active</span>') +
        '</span>' +
        (user.email
          ? '<button class="btn-danger detail-disable-btn" type="button">' +
            (user.disabled ? 'Enable User' : 'Disable User') +
            '</button>'
          : '<span class="muted" style="margin-left:0.6rem;font-size:0.8rem;">No email — cannot toggle</span>') +
        '<p class="panel-error hidden detail-disable-error"></p>' +
        '</div>' +
        '</div>' +
        '<div class="detail-field detail-claims"><span class="detail-label">Custom Claims</span>' +
        '<pre class="claims-json">' +
        Pantheon.users.escapeHtml(JSON.stringify(user.customClaims, null, 2)) +
        '</pre></div>' +
        '<div class="detail-access-section">' +
        '<p class="detail-label">App Access</p>' +
        (user.email
          ? '<div class="access-checkboxes"><span class="muted">Loading apps&hellip;</span></div>' +
            '<div class="access-actions">' +
            '<button class="btn-primary access-save-btn" type="button">Save</button>' +
            '<p class="access-notice muted">Changes take effect immediately on the backend. ' +
            'The user may need to sign out and back in to see updated access in their session.</p>' +
            '</div>' +
            '<div class="access-diff hidden">' +
            '<div class="diff-lines"></div>' +
            '<div class="access-diff-actions">' +
            '<button class="btn-primary access-confirm-btn" type="button">Confirm</button>' +
            '<button class="btn-secondary access-cancel-btn" type="button">Cancel</button>' +
            '</div>' +
            '</div>' +
            '<p class="panel-error hidden access-error"></p>' +
            '<p class="panel-status hidden access-success"></p>'
          : '<span class="muted">App access cannot be managed for accounts without an email address.</span>') +
        '</div>' +
        '<div class="detail-vo-cost-section">' +
        '<p class="detail-label">Void Odyssey AI Cost</p>' +
        '<div class="vo-cost-row">' +
        '<span class="vo-cost-display detail-value">Loading&hellip;</span>' +
        '<input class="vo-cost-input hidden" type="number" step="0.0001" min="0" style="width:100px" />' +
        '<button class="btn-secondary vo-cost-edit-btn" type="button" style="margin-left:0.5rem">Edit</button>' +
        '<button class="btn-primary vo-cost-save-btn hidden" type="button" style="margin-left:0.5rem">Save</button>' +
        '<button class="btn-secondary vo-cost-cancel-btn hidden" type="button" style="margin-left:0.4rem">Cancel</button>' +
        '<span class="muted vo-cost-status hidden" style="margin-left:0.6rem;font-size:0.85rem"></span>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</td>';

      tr.parentNode.insertBefore(detailRow, tr.nextSibling);

      // Load and wire Void Odyssey cost
      (function () {
        var db = Pantheon.state.db;
        var costDisplay = detailRow.querySelector('.vo-cost-display');
        var costInput = detailRow.querySelector('.vo-cost-input');
        var costEditBtn = detailRow.querySelector('.vo-cost-edit-btn');
        var costSaveBtn = detailRow.querySelector('.vo-cost-save-btn');
        var costCancelBtn = detailRow.querySelector('.vo-cost-cancel-btn');
        var costStatus = detailRow.querySelector('.vo-cost-status');

        db.collection('users')
          .doc(user.uid)
          .get()
          .then(function (snap) {
            var cost =
              snap.exists && snap.data().voidOdysseyCost != null ? snap.data().voidOdysseyCost : 0;
            costDisplay.textContent = '$' + cost.toFixed(4);
            costInput.value = cost.toFixed(4);
          })
          .catch(function () {
            costDisplay.textContent = '—';
          });

        costEditBtn.addEventListener('click', function () {
          costDisplay.classList.add('hidden');
          costEditBtn.classList.add('hidden');
          costInput.classList.remove('hidden');
          costSaveBtn.classList.remove('hidden');
          costCancelBtn.classList.remove('hidden');
          costStatus.classList.add('hidden');
        });

        costCancelBtn.addEventListener('click', function () {
          costInput.classList.add('hidden');
          costSaveBtn.classList.add('hidden');
          costCancelBtn.classList.add('hidden');
          costDisplay.classList.remove('hidden');
          costEditBtn.classList.remove('hidden');
          costStatus.classList.add('hidden');
        });

        costSaveBtn.addEventListener('click', function () {
          var val = parseFloat(costInput.value);
          if (isNaN(val) || val < 0) return;
          costSaveBtn.disabled = true;
          db.collection('users')
            .doc(user.uid)
            .set({ voidOdysseyCost: parseFloat(val.toFixed(4)) }, { merge: true })
            .then(function () {
              costDisplay.textContent = '$' + val.toFixed(4);
              costInput.classList.add('hidden');
              costSaveBtn.classList.add('hidden');
              costCancelBtn.classList.add('hidden');
              costDisplay.classList.remove('hidden');
              costEditBtn.classList.remove('hidden');
              costSaveBtn.disabled = false;
              costStatus.textContent = 'Saved';
              costStatus.classList.remove('hidden');
              setTimeout(function () {
                costStatus.classList.add('hidden');
              }, 2000);
            })
            .catch(function () {
              costSaveBtn.disabled = false;
              costStatus.textContent = 'Error saving';
              costStatus.classList.remove('hidden');
            });
        });
      })();

      if (user.email) {
        // Load apps checkboxes
        var checkboxesEl = detailRow.querySelector('.access-checkboxes');
        Pantheon.users.loadAppsForAccess(checkboxesEl, user);

        // Disable/Enable toggle
        var disableBtn = detailRow.querySelector('.detail-disable-btn');
        var disableError = detailRow.querySelector('.detail-disable-error');
        if (disableBtn) {
          disableBtn.addEventListener('click', function () {
            Pantheon.users.toggleDisabled(tr, user, detailRow, disableBtn, disableError);
          });
        }

        // Save → show diff
        var saveBtn = detailRow.querySelector('.access-save-btn');
        var diffEl = detailRow.querySelector('.access-diff');
        var diffLines = detailRow.querySelector('.diff-lines');
        saveBtn.addEventListener('click', function () {
          var currentApps = Array.isArray(user.customClaims.apps) ? user.customClaims.apps : [];
          var selected = [];
          detailRow.querySelectorAll('.access-app-checkbox:checked').forEach(function (cb) {
            selected.push(cb.value);
          });
          saveBtn.classList.add('hidden');
          Pantheon.users.showAccessDiff(diffEl, diffLines, currentApps, selected);
        });

        // Cancel diff
        var cancelBtn = detailRow.querySelector('.access-cancel-btn');
        cancelBtn.addEventListener('click', function () {
          diffEl.classList.add('hidden');
          saveBtn.classList.remove('hidden');
        });

        // Confirm → save
        var confirmBtn = detailRow.querySelector('.access-confirm-btn');
        var accessError = detailRow.querySelector('.access-error');
        var accessSuccess = detailRow.querySelector('.access-success');
        confirmBtn.addEventListener('click', function () {
          if (confirmBtn.disabled) return;
          var selected = [];
          detailRow.querySelectorAll('.access-app-checkbox:checked').forEach(function (cb) {
            selected.push(cb.value);
          });
          Pantheon.users.saveAccess(
            detailRow,
            tr,
            user,
            selected,
            saveBtn,
            diffEl,
            accessError,
            accessSuccess
          );
        });
      }
    },

    loadAppsForAccess: function (container, user) {
      var currentApps = Array.isArray(user.customClaims.apps) ? user.customClaims.apps : [];
      Pantheon.appsTab
        .fetchApps()
        .then(function (apps) {
          if (apps.length === 0) {
            container.innerHTML = '<span class="muted">No apps registered.</span>';
            return;
          }
          container.innerHTML = '';
          apps
            .slice()
            .sort(function (a, b) {
              return (a.order || 0) - (b.order || 0);
            })
            .forEach(function (app) {
              var label = document.createElement('label');
              label.className = 'access-app-option';
              var checkbox = document.createElement('input');
              checkbox.type = 'checkbox';
              checkbox.value = app.id;
              checkbox.className = 'access-app-checkbox';
              checkbox.checked = currentApps.includes(app.id);
              label.appendChild(checkbox);
              var text = document.createTextNode(
                ' ' + (app.icon ? app.icon + ' ' : '') + (app.name || app.id)
              );
              label.appendChild(text);
              container.appendChild(label);
            });
        })
        .catch(function () {
          container.innerHTML = '<span class="muted">Could not load apps.</span>';
        });
    },

    showAccessDiff: function (diffEl, diffLines, currentApps, selectedApps) {
      var added = selectedApps.filter(function (a) {
        return !currentApps.includes(a);
      });
      var removed = currentApps.filter(function (a) {
        return !selectedApps.includes(a);
      });

      var confirmBtn = diffEl.querySelector('.access-confirm-btn');
      var noChanges = added.length === 0 && removed.length === 0;

      if (noChanges) {
        diffLines.innerHTML = '<span class="muted">No changes.</span>';
        if (confirmBtn) confirmBtn.disabled = true;
      } else {
        var html = '';
        added.forEach(function (a) {
          html +=
            '<div class="diff-added"><span>+ ' + Pantheon.users.escapeHtml(a) + '</span></div>';
        });
        removed.forEach(function (a) {
          html +=
            '<div class="diff-removed"><span>&minus; ' +
            Pantheon.users.escapeHtml(a) +
            '</span></div>';
        });
        diffLines.innerHTML = html;
        if (confirmBtn) confirmBtn.disabled = false;
      }

      diffEl.classList.remove('hidden');
    },

    saveAccess: function (detailRow, tr, user, selectedApps, saveBtn, diffEl, errorEl, successEl) {
      errorEl.classList.add('hidden');
      successEl.classList.add('hidden');
      var confirmBtn = detailRow.querySelector('.access-confirm-btn');
      var cancelBtn = detailRow.querySelector('.access-cancel-btn');
      if (confirmBtn) confirmBtn.disabled = true;
      if (cancelBtn) cancelBtn.disabled = true;

      var manageAccess = Pantheon.state.functions.httpsCallable('manageAccess');
      manageAccess({ email: user.email, action: 'set', apps: selectedApps })
        .then(function (result) {
          if (confirmBtn) confirmBtn.disabled = false;
          if (cancelBtn) cancelBtn.disabled = false;
          diffEl.classList.add('hidden');
          saveBtn.classList.remove('hidden');

          // Update local user data
          user.customClaims = user.customClaims || {};
          user.customClaims.apps = result.data.apps;

          // Update claims JSON display
          var claimsEl = detailRow.querySelector('.claims-json');
          if (claimsEl) {
            claimsEl.textContent = JSON.stringify(user.customClaims, null, 2);
          }

          // Update app pills in parent row
          Pantheon.users.updateRowAppPills(tr, result.data.apps);

          // Re-check checkboxes to reflect saved state
          detailRow.querySelectorAll('.access-app-checkbox').forEach(function (cb) {
            cb.checked = result.data.apps.includes(cb.value);
          });

          successEl.textContent = 'App access updated successfully.';
          successEl.classList.remove('hidden');
        })
        .catch(function (err) {
          if (confirmBtn) confirmBtn.disabled = false;
          if (cancelBtn) cancelBtn.disabled = false;
          errorEl.textContent = err.message || 'Failed to update app access.';
          errorEl.classList.remove('hidden');
        });
    },

    toggleDisabled: function (tr, user, detailRow, btn, errorEl) {
      errorEl.classList.add('hidden');
      btn.disabled = true;

      var newDisabled = !user.disabled;
      var setUserDisabled = Pantheon.state.functions.httpsCallable('setUserDisabled');
      setUserDisabled({ email: user.email, disabled: newDisabled })
        .then(function (result) {
          btn.disabled = false;
          user.disabled = result.data.disabled;

          // Update badge in detail
          var badgeEl = detailRow.querySelector('.detail-disabled-badge');
          if (badgeEl) {
            badgeEl.innerHTML = user.disabled
              ? '<span class="badge badge-error">Disabled</span>'
              : '<span class="badge badge-ok">Active</span>';
          }

          // Update button label
          btn.textContent = user.disabled ? 'Enable User' : 'Disable User';
        })
        .catch(function (err) {
          btn.disabled = false;
          errorEl.textContent = err.message || 'Failed to update user status.';
          errorEl.classList.remove('hidden');
        });
    },

    escapeHtml: function (str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    invite: {
      showForm: function () {
        var form = document.getElementById('invite-form');
        var emailInput = document.getElementById('invite-email');
        var errorEl = document.getElementById('invite-error');
        var successEl = document.getElementById('invite-success');
        var checkboxes = document.getElementById('invite-apps-checkboxes');

        if (emailInput) emailInput.value = '';
        if (errorEl) {
          errorEl.textContent = '';
          errorEl.classList.add('hidden');
        }
        if (successEl) {
          successEl.textContent = '';
          successEl.classList.add('hidden');
        }
        if (checkboxes) checkboxes.innerHTML = '<span class="muted">Loading apps&hellip;</span>';
        if (form) form.classList.remove('hidden');

        // Load apps from YAML registry for checkboxes
        Pantheon.appsTab
          .fetchApps()
          .then(function (apps) {
            if (!checkboxes) return;
            if (apps.length === 0) {
              checkboxes.innerHTML = '<span class="muted">No apps available.</span>';
              return;
            }
            checkboxes.innerHTML = '';
            apps
              .slice()
              .sort(function (a, b) {
                return (a.order || 0) - (b.order || 0);
              })
              .forEach(function (app) {
                var label = document.createElement('label');
                label.className = 'invite-app-option';
                var checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = app.id;
                checkbox.className = 'invite-app-checkbox';
                label.appendChild(checkbox);
                var text = document.createTextNode(
                  ' ' + (app.icon ? app.icon + ' ' : '') + (app.name || app.id)
                );
                label.appendChild(text);
                checkboxes.appendChild(label);
              });
          })
          .catch(function () {
            if (checkboxes) {
              checkboxes.innerHTML = '<span class="muted">Could not load apps.</span>';
            }
          });
      },

      hideForm: function () {
        var form = document.getElementById('invite-form');
        if (form) form.classList.add('hidden');
      },

      submit: function () {
        var emailInput = document.getElementById('invite-email');
        var errorEl = document.getElementById('invite-error');
        var successEl = document.getElementById('invite-success');
        var submitBtn = document.getElementById('invite-submit');
        var checkboxes = document.querySelectorAll('.invite-app-checkbox:checked');

        if (errorEl) {
          errorEl.textContent = '';
          errorEl.classList.add('hidden');
        }
        if (successEl) {
          successEl.textContent = '';
          successEl.classList.add('hidden');
        }

        var email = emailInput ? emailInput.value.trim() : '';
        if (!email) {
          if (errorEl) {
            errorEl.textContent = 'Email address is required.';
            errorEl.classList.remove('hidden');
          }
          return;
        }

        var selectedApps = [];
        checkboxes.forEach(function (cb) {
          selectedApps.push(cb.value);
        });

        if (submitBtn) submitBtn.disabled = true;

        var inviteUser = Pantheon.state.functions.httpsCallable('inviteUser');
        inviteUser({ email: email, initialApps: selectedApps })
          .then(function (result) {
            if (submitBtn) submitBtn.disabled = false;
            if (successEl) {
              successEl.textContent =
                'Invitation sent to ' +
                Pantheon.users.escapeHtml(result.data.email) +
                ' (UID: ' +
                Pantheon.users.escapeHtml(result.data.uid) +
                ')';
              successEl.classList.remove('hidden');
            }
            // Reload user list to show the new user, preserving the active filter
            Pantheon.users.load(Pantheon.state.users.emailPrefix, null);
          })
          .catch(function (err) {
            if (submitBtn) submitBtn.disabled = false;
            if (errorEl) {
              errorEl.textContent = err.message || 'Failed to send invitation.';
              errorEl.classList.remove('hidden');
            }
          });
      },
    },
  };
})();
