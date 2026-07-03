(function () {
  'use strict';

  var Loom = window.Loom;
  var state = Loom.state;

  function appendNarration(actionText, narration) {
    var log = Loom.getRef('loom-narration-log');

    if (actionText) {
      var actionEl = document.createElement('p');
      actionEl.className = 'loom-log-action';
      actionEl.textContent = '> ' + actionText;
      log.appendChild(actionEl);
    }

    var narrationEl = document.createElement('p');
    narrationEl.className = 'loom-log-narration';
    narrationEl.textContent = narration;
    log.appendChild(narrationEl);

    log.scrollTop = log.scrollHeight;
  }

  function renderSummary(summary) {
    var el = Loom.getRef('loom-summary');
    if (summary) {
      el.textContent = summary;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function renderSuggestedActions(actions) {
    var container = Loom.getRef('loom-suggested-actions');
    container.innerHTML = '';

    (actions || []).forEach(function (action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'loom-suggested-action-chip';
      btn.textContent = action;
      btn.addEventListener('click', function () {
        submitTurn(action);
      });
      container.appendChild(btn);
    });
  }

  function setLoading(isLoading) {
    Loom.getRef('loom-turn-loading').classList.toggle('hidden', !isLoading);
    Loom.getRef('loom-turn-submit').disabled = isLoading;
    Loom.getRef('loom-turn-input').disabled = isLoading;
  }

  function showError(message) {
    var errorEl = Loom.getRef('loom-turn-error');
    if (message) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    } else {
      errorEl.classList.add('hidden');
    }
  }

  /**
   * Submits a turn via the loomPlayTurn callable. The client only ever
   * receives { narration, stateSummary, suggestedActions } — no raw state
   * authority, per the design doc's turn pipeline contract.
   */
  function submitTurn(actionText) {
    var trimmed = (actionText || '').trim();
    if (!trimmed || state.turnInProgress) return;

    state.turnInProgress = true;
    setLoading(true);
    showError(null);
    renderSuggestedActions([]);

    var loomPlayTurn = state.functions.httpsCallable('loomPlayTurn');
    loomPlayTurn({ worldId: state.worldId, saveId: state.saveId, actionText: trimmed })
      .then(function (result) {
        state.turnInProgress = false;
        setLoading(false);
        appendNarration(trimmed, result.data.narration);
        renderSummary(result.data.stateSummary);
        renderSuggestedActions(result.data.suggestedActions);
      })
      .catch(function (err) {
        state.turnInProgress = false;
        setLoading(false);
        showError('The Loom faltered: ' + (err.message || 'Unknown error'));
      });
  }

  /** Resets the play view for a newly-selected save. */
  function init(saveId, save) {
    state.saveId = saveId;

    Loom.getRef('loom-narration-log').innerHTML = '';
    renderSummary(save.recentSummary || '');
    renderSuggestedActions([]);
    showError(null);
    setLoading(false);

    var inputEl = Loom.getRef('loom-turn-input');
    inputEl.value = '';
  }

  Loom.play = { init: init, submitTurn: submitTurn };
})();
