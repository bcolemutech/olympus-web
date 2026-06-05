(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  // ── Module-local state ───────────────────────────────────────

  var _gameId = null;
  var _flagshipId = null;
  var _gameDoc = null;
  var _flagshipDoc = null;
  var _settlementName = '';
  var _settlementType = '';
  var _onCloseCb = null;
  var _overlayEl = null;

  // ── Helpers ──────────────────────────────────────────────────

  function _esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var TYPE_FLAVOUR = {
    fort: 'The fortification looms ahead — crumbling walls, rusted cannon, and the silence of abandonment. Who knows what the garrison left behind.',
    hidden_cove:
      'A sheltered cove, hidden from the main shipping lanes. The kind of place smugglers and desperate men retreat to.',
    ruin: 'Overgrown stonework juts from the jungle floor. Once a settlement of some kind — now only debris and echoes.',
  };

  function _flavourFor(type) {
    return (
      TYPE_FLAVOUR[type] || 'An uncharted site. The crew stand ready, uncertain what awaits ashore.'
    );
  }

  // ── Modal ────────────────────────────────────────────────────

  function _close() {
    if (_overlayEl && _overlayEl.parentNode) {
      _overlayEl.parentNode.removeChild(_overlayEl);
    }
    _overlayEl = null;
  }

  function _render() {
    if (!_overlayEl) return;
    var flavour = _flavourFor(_settlementType);
    _overlayEl.innerHTML =
      '<div class="event-modal-root">' +
      '<div class="port-dialog">' +
      '<div class="port-modal-header">' +
      '<span class="port-modal-title">' +
      _esc(_settlementName) +
      '</span>' +
      '</div>' +
      '<span class="event-type-badge event-type-badge--wreckage">Exploration</span>' +
      '<p class="event-narrative">' +
      _esc(flavour) +
      '</p>' +
      '<div class="event-choices">' +
      '<button class="event-choice-btn event-choice-btn--primary" id="explore-btn" type="button">Search the Site</button>' +
      '<button class="event-choice-btn event-choice-btn--secondary" id="explore-leave-btn" type="button">Leave</button>' +
      '</div>' +
      '</div>' +
      '</div>';

    _overlayEl.querySelector('#explore-btn').addEventListener('click', function () {
      _close();
      T.events.fireExploration(
        {
          gameId: _gameId,
          flagshipId: _flagshipId,
          gameDoc: _gameDoc,
          flagship: _flagshipDoc,
        },
        function () {
          if (_onCloseCb) _onCloseCb();
        }
      );
    });

    _overlayEl.querySelector('#explore-leave-btn').addEventListener('click', function () {
      _close();
      if (_onCloseCb) _onCloseCb();
    });
  }

  // ── Public API ───────────────────────────────────────────────

  T.exploreVisit = {
    open: function (
      gameId,
      flagshipId,
      gameDoc,
      flagshipDoc,
      settlementId,
      settlementName,
      settlementType,
      onClose
    ) {
      if (_overlayEl) _close();

      _gameId = gameId;
      _flagshipId = flagshipId;
      _gameDoc = JSON.parse(JSON.stringify(gameDoc || {}));
      _flagshipDoc = JSON.parse(JSON.stringify(flagshipDoc || {}));
      _settlementName = settlementName || 'Unknown Site';
      _settlementType = settlementType || '';
      _onCloseCb = onClose || null;

      _overlayEl = document.createElement('div');
      document.body.appendChild(_overlayEl);

      _render();

      var turn = (gameDoc && gameDoc.turnNumber) || 0;
      T.firestore
        .addLogEntry(gameId, {
          turn: turn,
          type: 'exploration',
          summary: 'Explored ' + (settlementName || 'Unknown Site'),
          payload: { settlementId: settlementId || null, settlementName: settlementName || '' },
        })
        .catch(function (err) {
          console.error('[explore-visit] addLogEntry failed', err);
        });
    },

    isOpen: function () {
      return _overlayEl !== null;
    },
  };
})();
