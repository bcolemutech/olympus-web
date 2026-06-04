(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  var PORTRAIT_SYMBOLS = {
    anchor: '⚓',
    skull: '💀',
    compass: '🧭',
    wheel: '⚙️',
    telescope: '🔭',
    map: '🗺️',
  };

  function _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _formatDate(ts) {
    if (!ts || !ts.toDate) return '—';
    return ts.toDate().toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function _renderSkeleton(container) {
    container.innerHTML = '';
    for (var i = 0; i < 2; i++) {
      var card = document.createElement('div');
      card.className = 'game-card game-card--skeleton';

      var header = document.createElement('div');
      header.className = 'game-card-header';

      var portrait = document.createElement('div');
      portrait.className = 'skeleton-block';
      portrait.style.width = '2rem';
      portrait.style.height = '2rem';
      portrait.style.borderRadius = '4px';
      portrait.style.flexShrink = '0';
      header.appendChild(portrait);

      var titleLine = document.createElement('div');
      titleLine.className = 'skeleton-line skeleton-line--title';
      header.appendChild(titleLine);

      card.appendChild(header);

      var subLine = document.createElement('div');
      subLine.className = 'skeleton-line skeleton-line--sub';
      card.appendChild(subLine);

      container.appendChild(card);
    }
  }

  function _renderEmpty(container) {
    container.innerHTML = '';
    var msg = document.createElement('p');
    msg.className = 'game-list-empty';
    msg.textContent = 'No campaigns yet. Start a new one below.';
    container.appendChild(msg);
  }

  function _buildCard(game, onResume) {
    var card = document.createElement('div');
    card.className = 'game-card';

    var header = document.createElement('div');
    header.className = 'game-card-header';

    var portraitEl = document.createElement('span');
    portraitEl.className = 'game-card-portrait';
    portraitEl.textContent =
      PORTRAIT_SYMBOLS[(game.captain && game.captain.portrait) || ''] || '🏴‍☠️';
    header.appendChild(portraitEl);

    var captainEl = document.createElement('span');
    captainEl.className = 'game-card-captain';
    captainEl.textContent = (game.captain && game.captain.name) || 'Unknown Captain';
    header.appendChild(captainEl);

    card.appendChild(header);

    var worldEl = document.createElement('div');
    worldEl.className = 'game-card-world';
    worldEl.textContent = game.worldName || 'Unknown World';
    card.appendChild(worldEl);

    var metaEl = document.createElement('div');
    metaEl.className = 'game-card-meta';
    metaEl.innerHTML =
      '<span>Turn ' +
      _esc(game.turnNumber != null ? game.turnNumber : '0') +
      '</span>' +
      '<span>Last played: ' +
      _esc(_formatDate(game.lastPlayedAt)) +
      '</span>';
    card.appendChild(metaEl);

    var actionsEl = document.createElement('div');
    actionsEl.className = 'game-card-actions';

    var continueBtn = document.createElement('button');
    continueBtn.className = 'app-btn app-btn--sm';
    continueBtn.setAttribute('type', 'button');
    continueBtn.textContent = 'Continue';
    continueBtn.addEventListener('click', function () {
      onResume(game.id, game);
    });
    actionsEl.appendChild(continueBtn);

    card.appendChild(actionsEl);

    return card;
  }

  T.gameList = {
    _container: null,
    _onResume: null,
    _unsub: null,

    render: function (containerEl, opts) {
      this.destroy();
      this._container = containerEl;
      this._onResume = (opts && opts.onResume) || null;

      var self = this;

      _renderSkeleton(containerEl);

      this._unsub = T.firestore.listGames(function (games, err) {
        if (err) {
          console.error('[game-list] listGames error', err);
          containerEl.innerHTML = '<p class="game-list-empty">Failed to load campaigns.</p>';
          return;
        }

        if (!games.length) {
          _renderEmpty(containerEl);
          return;
        }

        games.sort(function (a, b) {
          var ta = a.lastPlayedAt && a.lastPlayedAt.toMillis ? a.lastPlayedAt.toMillis() : 0;
          var tb = b.lastPlayedAt && b.lastPlayedAt.toMillis ? b.lastPlayedAt.toMillis() : 0;
          return tb - ta;
        });

        containerEl.innerHTML = '';
        games.forEach(function (game) {
          containerEl.appendChild(
            _buildCard(game, function (id, doc) {
              if (self._onResume) self._onResume(id, doc);
            })
          );
        });
      });
    },

    destroy: function () {
      if (typeof this._unsub === 'function') {
        this._unsub();
        this._unsub = null;
      }
    },
  };
})();
