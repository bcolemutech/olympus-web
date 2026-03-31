(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  /**
   * Submits a player turn to the Cloud Function and updates the UI.
   * @param {{ type: string, actionId: string|null, input: string }} playerAction
   */
  VO.submitTurn = function (playerAction) {
    if (VO.state._turnInProgress) return;
    if (!VO.state.currentGame || !VO.state.currentGame.id) return;

    VO.state._turnInProgress = true;
    VO.setActionsEnabled(false);
    VO.showNarrativeLoading();

    // Store action for potential retry
    var lastAction = playerAction;

    var fn = VO.state.functions.httpsCallable('voidOdysseyTurn');
    fn({
      gameId: VO.state.currentGame.id,
      playerAction: playerAction,
    })
      .then(function (result) {
        var data = result.data;

        // Rate limit hard block
        if (data.limitReached) {
          VO.showNarrativeError(data.message || 'Turn limit reached.', null);
          VO.showRateLimitNotice(data.message);
          VO.setActionsEnabled(false);
          VO.state._turnInProgress = false;
          return;
        }

        // Render narrative, actions, and HUD
        VO.renderNarrativeEntry(
          data.narrative,
          data.availableActions,
          data.mood,
          VO.handleActionClick,
          VO.handleFreeformSubmit,
          data.rollInterpretation
        );

        VO.updateHud({
          shipStatus: data.shipStatus,
          turnCount: data.turnCount,
          locationName: data.locationName,
          crewCount: data.crewCount,
        });

        // Update local state
        VO.state.currentGame.turnCount = data.turnCount;
        if (data.shipStatus) {
          VO.state.currentGame.ship = VO.state.currentGame.ship || {};
          VO.state.currentGame.ship.hull = data.shipStatus.hull;
          VO.state.currentGame.ship.hullMax = data.shipStatus.hullMax;
          VO.state.currentGame.ship.shields = data.shipStatus.shields;
          VO.state.currentGame.ship.shieldsMax = data.shipStatus.shieldsMax;
          VO.state.currentGame.ship.fuel = data.shipStatus.fuel;
          VO.state.currentGame.ship.credits = data.shipStatus.credits;
        }
        if (data.combatActive !== undefined) {
          VO.state.currentGame.combatActive = data.combatActive;
        }
        if (data.currentSystemId) {
          VO.state.currentGame.ship.currentSystemId = data.currentSystemId;
        }
        if (data.locationName) {
          VO.state.currentGame.currentLocationName = data.locationName;
        }

        // Refresh sidebar with new data
        if (VO.invalidateSidebarCache) VO.invalidateSidebarCache();
        if (VO.renderSidebarContent) VO.renderSidebarContent();

        // Soft rate limit warning
        if (data.rateLimitWarning) {
          _showToast(data.rateLimitWarning);
        }

        VO.state._turnInProgress = false;
      })
      .catch(function (err) {
        console.error('Turn error:', err);

        var message = 'Something went wrong. Please try again.';
        if (err.code === 'unauthenticated') {
          message = 'Your session expired. Please refresh and sign in again.';
        } else if (err.code === 'resource-exhausted') {
          var rateLimitMessage = 'Turn limit reached. Please wait before trying again.';
          VO.showRateLimitNotice(rateLimitMessage);
          VO.showNarrativeError(rateLimitMessage, function () {
            VO.state._turnInProgress = false;
          });
          VO.setActionsEnabled(false);
          VO.state._turnInProgress = false;
          return;
        }

        VO.showNarrativeError(message, function () {
          VO.state._turnInProgress = false;
          VO.submitTurn(lastAction);
        });

        VO.setActionsEnabled(true);
        VO.state._turnInProgress = false;
      });
  };

  /**
   * Handles an action button click.
   * @param {{ id: string, label: string, type: string }} action
   */
  VO.handleActionClick = function (action) {
    VO.submitTurn({
      type: action.type,
      actionId: action.id,
      input: action.label,
    });
  };

  /**
   * Handles freeform text submission.
   * @param {string} inputText
   */
  VO.handleFreeformSubmit = function (inputText) {
    VO.submitTurn({
      type: 'freeform',
      actionId: null,
      input: inputText,
    });
  };

  /**
   * Shows a temporary toast notification.
   */
  function _showToast(message) {
    var existing = document.querySelector('.vo-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'vo-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    window.setTimeout(function () {
      toast.classList.add('vo-toast-fade');
      window.setTimeout(function () {
        if (toast.parentNode) toast.remove();
      }, 400);
    }, 4000);
  }
})();
