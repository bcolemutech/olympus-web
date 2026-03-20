(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  function _escNarrative(str) {
    if (!str) return '';
    return str
      .split('\n\n')
      .map(function (para) {
        var d = document.createElement('div');
        d.textContent = para.trim();
        return d.innerHTML;
      })
      .filter(Boolean)
      .join('</p><p class="narrative-text">');
  }

  /**
   * Renders a narrative entry with mood styling, action buttons, and freeform input.
   * @param {string} narrative
   * @param {Array} actions
   * @param {string} mood
   * @param {Function} onActionClick  — called with action object
   * @param {Function} onFreeformSubmit — called with input string
   */
  VO.renderNarrativeEntry = function (narrative, actions, mood, onActionClick, onFreeformSubmit) {
    // Narrative panel
    var panel = document.getElementById('narrative-content');
    if (panel) {
      panel.innerHTML = '<p class="narrative-text">' + _escNarrative(narrative) + '</p>';
    }

    // Mood class on the panel wrapper
    var wrapper = document.querySelector('.narrative-panel');
    if (wrapper) {
      // Remove old mood classes
      wrapper.className = wrapper.className.replace(/\bnarrative-mood-\S+/g, '').trim();
      if (mood) {
        wrapper.classList.add('narrative-mood-' + mood);
      }
      // Scroll to bottom
      wrapper.scrollTop = wrapper.scrollHeight;
    }

    // Action buttons
    var actionsContainer = document.getElementById('action-buttons');
    if (actionsContainer) {
      actionsContainer.innerHTML = '';
      (actions || []).forEach(function (action) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'action-btn';
        btn.textContent = action.label;
        btn.dataset.id = action.id;
        btn.dataset.type = action.type;
        if (onActionClick) {
          btn.addEventListener('click', function () {
            onActionClick(action);
          });
        }
        actionsContainer.appendChild(btn);
      });
    }

    // Freeform input
    var freeformRow = document.getElementById('freeform-input-row');
    if (freeformRow && onFreeformSubmit) {
      var input = freeformRow.querySelector('.freeform-input');
      var submitBtn = freeformRow.querySelector('.freeform-submit');
      freeformRow.classList.remove('hidden');

      // Remove old listeners by cloning
      var newSubmit = submitBtn.cloneNode(true);
      submitBtn.parentNode.replaceChild(newSubmit, submitBtn);

      var newInput = input.cloneNode(true);
      input.parentNode.replaceChild(newInput, input);

      function doSubmit() {
        var val = newInput.value.trim();
        if (val.length > 0) {
          onFreeformSubmit(val);
          newInput.value = '';
        }
      }

      newSubmit.addEventListener('click', doSubmit);
      newInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          doSubmit();
        }
      });
    }
  };

  /**
   * Shows a loading indicator in the narrative panel.
   */
  VO.showNarrativeLoading = function () {
    var panel = document.getElementById('narrative-content');
    if (panel) {
      panel.innerHTML =
        '<div class="narrative-loading">' +
        '<div class="app-spinner"></div>' +
        '<p class="narrative-loading-text">The Oracle is weaving your fate&hellip;</p>' +
        '</div>';
    }
  };

  /**
   * Shows a rate limit notice in the action area.
   */
  VO.showRateLimitNotice = function (message) {
    var actionsContainer = document.getElementById('action-buttons');
    if (actionsContainer) {
      actionsContainer.innerHTML =
        '<div class="rate-limit-notice">' +
        '<p>' +
        (message || 'Turn limit reached. Please wait before taking another action.') +
        '</p>' +
        '</div>';
    }
    var freeformRow = document.getElementById('freeform-input-row');
    if (freeformRow) freeformRow.classList.add('hidden');
  };

  /**
   * Shows an error message in the narrative panel with an optional retry.
   */
  VO.showNarrativeError = function (message, onRetry) {
    var panel = document.getElementById('narrative-content');
    if (!panel) return;

    var html =
      '<div class="narrative-error">' +
      '<p>' +
      (message || 'Something went wrong. Please try again.') +
      '</p>';
    if (onRetry) {
      html +=
        '<button type="button" class="btn btn-secondary btn-sm narrative-retry">Retry</button>';
    }
    html += '</div>';
    panel.innerHTML = html;

    if (onRetry) {
      var retryBtn = panel.querySelector('.narrative-retry');
      if (retryBtn) retryBtn.addEventListener('click', onRetry);
    }
  };

  /**
   * Disables or enables all action buttons and freeform input.
   */
  VO.setActionsEnabled = function (enabled) {
    var buttons = document.querySelectorAll('.action-btn');
    buttons.forEach(function (btn) {
      btn.disabled = !enabled;
    });
    var freeformRow = document.getElementById('freeform-input-row');
    if (freeformRow) {
      var input = freeformRow.querySelector('.freeform-input');
      var submitBtn = freeformRow.querySelector('.freeform-submit');
      if (input) input.disabled = !enabled;
      if (submitBtn) submitBtn.disabled = !enabled;
    }
  };
})();
