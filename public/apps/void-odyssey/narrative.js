(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  /** Ambient flavor text per mood — shown on mood transitions. */
  var MOOD_AMBIENT = {
    danger: 'The bridge lights cycle to emergency red.',
    combat: 'Klaxons wail. The deck shudders beneath your boots.',
    tense: 'The air on the bridge feels electric.',
    wonder: 'A hush falls over the crew as they stare at the viewscreen.',
    reverent: 'Something ancient and vast brushes against your consciousness.',
    tense_curiosity: 'Your sensors chirp with unidentified readings.',
  };

  /** Escapes a string for safe insertion into innerHTML. */
  function _escHtml(str) {
    if (!str) return '';
    var d = document.createElement('span');
    d.textContent = String(str);
    return d.innerHTML;
  }

  /**
   * Renders a dice roll result panel from the server rollInterpretation data.
   * Returns an HTML string, or empty string if no roll data.
   */
  function _renderDiceRoll(ri) {
    if (!ri) return '';
    if (ri.skipRoll) return '';

    var critClass = '';
    var critLabel = '';
    if (ri.isCritical && ri.criticalType === 'success') {
      critClass = ' dice-roll--critical-success';
      critLabel = '<span class="dice-crit-label">CRITICAL SUCCESS!</span>';
    } else if (ri.isCritical && ri.criticalType === 'failure') {
      critClass = ' dice-roll--critical-failure';
      critLabel = '<span class="dice-crit-label">CRITICAL FAILURE!</span>';
    }

    var outcomeClass = ri.success ? 'dice-outcome--success' : 'dice-outcome--failure';
    var outcomeText = ri.success ? 'Success' : 'Failure';

    var html = '<div class="dice-roll-panel' + critClass + '">';
    html += '<div class="dice-roll-header">';
    html += '<span class="dice-d20-icon">d20</span>';
    html += '<span class="dice-d20-value">' + ri.naturalRoll + '</span>';
    html += critLabel;
    html += '</div>';

    // Formula: d20(X) +modifiers +difficulty = Y vs DC Z
    html += '<div class="dice-roll-formula">';
    html += 'd20(' + ri.naturalRoll + ')';
    if (ri.modifierFormula) {
      html += ' ' + _escHtml(ri.modifierFormula);
    }
    if (ri.difficultyModifier) {
      html +=
        ' ' + (ri.difficultyModifier > 0 ? '+' : '') + ri.difficultyModifier + ' (difficulty)';
    }
    html += ' = <strong>' + ri.finalResult + '</strong> vs DC ' + ri.difficultyClass;
    html += '</div>';

    html += '<div class="dice-roll-outcome ' + outcomeClass + '">' + outcomeText + '</div>';

    // Saving throw (if applicable)
    if (ri.savingThrow && ri.savingThrow.applicable) {
      var st = ri.savingThrow;
      var stOutcome = st.savingResult ? 'Saved' : 'Failed';
      var stClass = st.savingResult ? 'dice-outcome--success' : 'dice-outcome--failure';
      html += '<div class="dice-saving-throw">';
      html +=
        '<span class="dice-st-label">Saving throw (' +
        _escHtml(st.targetName || 'Target') +
        '):</span> ';
      html += 'd20(' + st.savingRoll + ')';
      if (st.savingModifiers) {
        html += ' ' + _escHtml(st.savingModifiers);
      }
      html += ' vs DC ' + st.savingDC;
      html += ' — <span class="' + stClass + '">' + stOutcome + '</span>';
      html += '</div>';
    }

    // Narrative summary
    if (ri.narrativeSummary) {
      var summaryDiv = document.createElement('div');
      summaryDiv.textContent = ri.narrativeSummary;
      html += '<div class="dice-roll-summary">' + summaryDiv.innerHTML + '</div>';
    }

    html += '</div>';
    return html;
  }

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
  VO.renderNarrativeEntry = function (
    narrative,
    actions,
    mood,
    onActionClick,
    onFreeformSubmit,
    rollInterpretation
  ) {
    // Narrative panel
    var panel = document.getElementById('narrative-content');
    if (panel) {
      var ambientHtml = '';
      var ambientText = MOOD_AMBIENT[mood];
      if (ambientText && mood !== VO.state._lastNarrativeMood) {
        ambientHtml = '<p class="narrative-ambient">' + ambientText + '</p>';
      }
      VO.state._lastNarrativeMood = mood || null;
      var diceHtml = _renderDiceRoll(rollInterpretation);
      panel.innerHTML =
        ambientHtml + diceHtml + '<p class="narrative-text">' + _escNarrative(narrative) + '</p>';
    }

    // Mood class on the panel wrapper
    var wrapper = document.querySelector('.narrative-panel');
    if (wrapper) {
      // Remove old mood classes
      wrapper.className = wrapper.className.replace(/\bnarrative-mood-\S+/g, '').trim();
      if (mood) {
        var safeMood = String(mood)
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '');
        if (safeMood) {
          wrapper.classList.add('narrative-mood-' + safeMood);
        }
      }
      // Scroll to bottom
      wrapper.scrollTop = wrapper.scrollHeight;
    }

    var selectedAction = null;
    var newInput = null;
    var newSubmit = null;

    // Set up freeform row first so action buttons can reference newInput/newSubmit
    var freeformRow = document.getElementById('freeform-input-row');
    if (freeformRow && onFreeformSubmit) {
      var input = freeformRow.querySelector('.freeform-input');
      var submitBtn = freeformRow.querySelector('.freeform-submit');
      freeformRow.classList.remove('hidden');

      // Remove old listeners by cloning; explicitly clear disabled state
      newSubmit = submitBtn.cloneNode(true);
      newSubmit.disabled = true; // disabled until user selects or types
      submitBtn.parentNode.replaceChild(newSubmit, submitBtn);

      newInput = input.cloneNode(true);
      newInput.disabled = false; // always re-enable after clone
      newInput.value = '';
      input.parentNode.replaceChild(newInput, input);
    }

    function updateGoButton() {
      if (!newSubmit) return;
      var hasText = newInput && newInput.value.trim().length > 0;
      newSubmit.disabled = !hasText && !selectedAction;
    }

    function doSubmit() {
      var val = newInput ? newInput.value.trim() : '';
      if (val.length > 0 && onFreeformSubmit) {
        onFreeformSubmit(val);
        newInput.value = '';
        selectedAction = null;
      } else if (selectedAction && onActionClick) {
        onActionClick(selectedAction);
        selectedAction = null;
      }
    }

    // Action buttons — filter out freeform-type actions (handled by the text input)
    var actionsContainer = document.getElementById('action-buttons');
    if (actionsContainer) {
      actionsContainer.innerHTML = '';
      (actions || [])
        .filter(function (action) {
          return action.type !== 'freeform';
        })
        .forEach(function (action) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'action-btn';
          btn.textContent = action.label;
          btn.dataset.id = action.id;
          btn.dataset.type = action.type;
          btn.setAttribute('aria-pressed', 'false');
          btn.addEventListener('click', function () {
            // Select this button; deselect others
            actionsContainer.querySelectorAll('.action-btn').forEach(function (b) {
              b.classList.remove('action-btn--selected');
              b.setAttribute('aria-pressed', 'false');
            });
            btn.classList.add('action-btn--selected');
            btn.setAttribute('aria-pressed', 'true');
            selectedAction = action;
            // Clear freeform text so it doesn't override the selection
            if (newInput) newInput.value = '';
            updateGoButton();
          });
          actionsContainer.appendChild(btn);
        });
    }

    // Wire Go button and input events
    if (freeformRow && newSubmit && newInput) {
      newSubmit.addEventListener('click', doSubmit);

      newInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          doSubmit();
        }
      });

      newInput.addEventListener('input', function () {
        // Typing deselects any highlighted action button
        if (newInput.value.trim().length > 0 && actionsContainer) {
          actionsContainer.querySelectorAll('.action-btn').forEach(function (b) {
            b.classList.remove('action-btn--selected');
            b.setAttribute('aria-pressed', 'false');
          });
          selectedAction = null;
        }
        updateGoButton();
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
