(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  // ── Module-local state ───────────────────────────────────────

  var _lastEventTurn = -1;
  var _overlayEl = null;

  // ── Helpers ──────────────────────────────────────────────────

  function _rng(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function _esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _pickWeighted(pack) {
    var totalWeight = pack.reduce(function (sum, ev) {
      return sum + (ev.weight || 1);
    }, 0);
    var roll = Math.random() * totalWeight;
    var cumulative = 0;
    for (var i = 0; i < pack.length; i++) {
      cumulative += pack[i].weight || 1;
      if (roll < cumulative) return pack[i];
    }
    return pack[pack.length - 1];
  }

  function _typeLabel(type) {
    if (type === 'storm') return 'Storm';
    if (type === 'wreckage') return 'Wreckage';
    return 'Sighting';
  }

  // ── Outcome resolution ───────────────────────────────────────

  function _applyOutcome(outcome, ctx, doneCb, eventMeta) {
    _closeModal();

    var patch = {};
    var hasUpdate = false;

    if (outcome.hullDmg) {
      var dmg = _rng(outcome.hullDmg[0], outcome.hullDmg[1]);
      if (dmg > 0) {
        var currentHull = (ctx.flagship.hull && ctx.flagship.hull.current) || 0;
        patch['hull.current'] = Math.max(0, currentHull - dmg);
        hasUpdate = true;
      }
    }

    if (outcome.sailsDmg) {
      var sdmg = _rng(outcome.sailsDmg[0], outcome.sailsDmg[1]);
      if (sdmg > 0) {
        var currentSails = (ctx.flagship.sails && ctx.flagship.sails.current) || 0;
        patch['sails.current'] = Math.max(0, currentSails - sdmg);
        hasUpdate = true;
      }
    }

    if (outcome.supplies) {
      var supplyKeys = Object.keys(outcome.supplies);
      for (var si = 0; si < supplyKeys.length; si++) {
        var key = supplyKeys[si];
        var range = outcome.supplies[key];
        var gain = _rng(range[0], range[1]);
        if (gain > 0) {
          patch['supplies.' + key] = firebase.firestore.FieldValue.increment(gain);
          hasUpdate = true;
        }
      }
    }

    var goldGain = 0;
    if (outcome.gold) {
      goldGain = _rng(outcome.gold[0], outcome.gold[1]);
    }

    var currentTurn = (ctx.gameDoc && ctx.gameDoc.turnNumber) || 0;

    var promises = [];

    if (hasUpdate) {
      promises.push(
        T.firestore.updateFlagship(ctx.gameId, ctx.flagshipId, patch).catch(function (err) {
          console.error('[events] updateFlagship failed', err);
        })
      );
    }

    var gameUpdate = { lastEventTurn: currentTurn };
    if (goldGain > 0) {
      gameUpdate['captain.gold'] = firebase.firestore.FieldValue.increment(goldGain);
    }
    promises.push(
      T.firestore.updateGame(ctx.gameId, gameUpdate).catch(function (err) {
        console.error('[events] updateGame failed', err);
      })
    );

    if (eventMeta) {
      T.firestore
        .addLogEntry(ctx.gameId, {
          turn: currentTurn,
          type: 'event',
          summary: eventMeta.title + ': ' + eventMeta.choiceLabel,
          payload: Object.assign(
            { eventTitle: eventMeta.title, choiceLabel: eventMeta.choiceLabel },
            outcome
          ),
        })
        .catch(function (err) {
          console.error('[events] addLogEntry failed', err);
        });
    }

    Promise.all(promises).then(doneCb).catch(doneCb);
  }

  // ── Modal ────────────────────────────────────────────────────

  function _closeModal() {
    if (_overlayEl && _overlayEl.parentNode) {
      _overlayEl.parentNode.removeChild(_overlayEl);
    }
    _overlayEl = null;
  }

  function _openModal(event, narrative, ctx, doneCb) {
    if (_overlayEl) _closeModal();

    var choicesHtml = event.choices
      .map(function (choice) {
        var cls =
          'event-choice-btn' +
          (choice.primary ? ' event-choice-btn--primary' : ' event-choice-btn--secondary');
        return (
          '<button class="' +
          cls +
          '" type="button" data-choice-id="' +
          _esc(choice.id) +
          '">' +
          _esc(choice.label) +
          '</button>'
        );
      })
      .join('');

    var html =
      '<div class="event-modal-root">' +
      '<div class="port-dialog">' +
      '<div class="port-modal-header">' +
      '<span class="port-modal-title">' +
      _esc(event.title) +
      '</span>' +
      '</div>' +
      '<span class="event-type-badge event-type-badge--' +
      _esc(event.type) +
      '">' +
      _esc(_typeLabel(event.type)) +
      '</span>' +
      '<p class="event-narrative">' +
      _esc(narrative) +
      '</p>' +
      '<div class="event-choices">' +
      choicesHtml +
      '</div>' +
      '</div>' +
      '</div>';

    _overlayEl = document.createElement('div');
    _overlayEl.innerHTML = html;
    document.body.appendChild(_overlayEl);

    var choiceMap = {};
    event.choices.forEach(function (c) {
      choiceMap[c.id] = c;
    });

    _overlayEl.querySelectorAll('.event-choice-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var choiceId = btn.getAttribute('data-choice-id');
        var choice = choiceMap[choiceId];
        var meta = { title: event.title, choiceLabel: choice ? choice.label : '' };
        _applyOutcome(choice ? choice.outcome : {}, ctx, doneCb, meta);
      });
    });
  }

  // ── Public API ───────────────────────────────────────────────

  T.events = {
    // Force an exploration event drawn only from wreckage-type events.
    // Bypasses the random EVENT_CHANCE and lastEventTurn guard.
    fireExploration: function (ctx, doneCb) {
      var pack = (T.EVENT_PACKS || []).filter(function (ev) {
        return ev.type === 'wreckage';
      });
      if (!pack.length) {
        doneCb();
        return;
      }
      var event = _pickWeighted(pack);
      if (!event) {
        doneCb();
        return;
      }
      var narrative = event.narratives[_rng(0, event.narratives.length - 1)];
      _openModal(event, narrative, ctx, doneCb);
    },

    tryFire: function (ctx, doneCb) {
      var currentTurn = (ctx.gameDoc && ctx.gameDoc.turnNumber) || 0;
      var lastEventTurn = ctx.gameDoc && ctx.gameDoc.lastEventTurn;

      if (lastEventTurn != null && lastEventTurn >= currentTurn) {
        doneCb();
        return;
      }

      if (_lastEventTurn >= currentTurn) {
        doneCb();
        return;
      }

      if (Math.random() > T.EVENT_CHANCE) {
        doneCb();
        return;
      }

      var pack = T.EVENT_PACKS;
      if (!pack || !pack.length) {
        doneCb();
        return;
      }

      var event = _pickWeighted(pack);
      if (!event) {
        doneCb();
        return;
      }

      _lastEventTurn = currentTurn;

      var narrative = event.narratives[_rng(0, event.narratives.length - 1)];
      _openModal(event, narrative, ctx, doneCb);
    },
  };
})();
