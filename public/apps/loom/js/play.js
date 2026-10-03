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

  var suggestions = []; // the suggestions showing, kept across steps (L-613)

  function renderSuggestedActions(actions) {
    suggestions = actions || [];
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
   * Plays a turn via the loomPlayTurn callable: typed text, or a structured
   * move from the world map. The client only ever receives { narration,
   * stateSummary, suggestedActions } — no raw state authority, per the
   * design doc's turn pipeline contract. The map reloads after every turn.
   *
   * A step on a battle map (L-613 / #443) answers with `step` and no
   * narration: only its plain lines ("You're out of movement…") join the
   * story, and the suggestions stay. `options.fromMap` shows the story on a
   * phone when a move from the map is narrated (an arrival); `options.keep`
   * keeps the suggestions when none come back (ending the turn).
   */
  function playTurn(turn, label, options) {
    if (state.turnInProgress) return;
    options = options || {};
    var kept = suggestions.slice();

    state.turnInProgress = true;
    setLoading(true);
    showError(null);
    renderSuggestedActions([]);
    Loom.map.render(); // the Travel button disables while a turn runs

    var loomPlayTurn = state.functions.httpsCallable('loomPlayTurn');
    var request = Object.assign({ worldId: state.worldId, saveId: state.saveId }, turn);
    loomPlayTurn(request)
      .then(function (result) {
        state.turnInProgress = false;
        setLoading(false);
        var data = result.data;
        var keep = options.keep && !(data.suggestedActions || []).length;
        if (data.step) {
          if (data.step.lines.length) appendNarration(label, data.step.lines.join(' '));
          renderSuggestedActions(kept);
        } else {
          appendNarration(label, data.narration);
          renderSuggestedActions(keep ? kept : data.suggestedActions);
          if (options.fromMap) Loom.map.showStory();
        }
        renderSummary(data.stateSummary);
        Loom.map.load();
      })
      .catch(function (err) {
        state.turnInProgress = false;
        setLoading(false);
        Loom.map.render();
        showError('The Loom faltered: ' + (err.message || 'Unknown error'));
      });
  }

  function submitTurn(actionText) {
    var trimmed = (actionText || '').trim();
    if (!trimmed) return;
    playTurn({ actionText: trimmed }, trimmed);
  }

  /** Travels to a place chosen on the world map (L-332 / #394). */
  function travelTo(locationId, name) {
    playTurn({ action: { verb: 'move', target: locationId } }, 'travel to ' + name);
  }

  /**
   * Steps to a cell on a battle map, from the grid view (L-354 / #403): as far
   * as this turn's movement goes, keeping the rest as the plan (L-613).
   */
  function moveToCell(cell, label) {
    playTurn({ action: { verb: 'move', cell: { x: cell.x, y: cell.y } } }, label, {
      fromMap: true,
    });
  }

  /** Walks the plan kept from an earlier move (L-613 / #443). */
  function continuePlan() {
    playTurn({ action: { verb: 'continue' } }, 'continue', { fromMap: true });
  }

  /** Ends the turn: movement and the action refilled (L-611 / #441). */
  function endTurn() {
    playTurn({ action: { verb: 'end-turn' } }, 'end turn', { keep: true });
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

    Loom.map.reset();
    Loom.map.load();
  }

  Loom.play = {
    init: init,
    submitTurn: submitTurn,
    travelTo: travelTo,
    moveToCell: moveToCell,
    continuePlan: continuePlan,
    endTurn: endTurn,
  };
})();
