(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  // ── View management ────────────────────────────────────────

  VO.showView = function (name) {
    VO.state.currentView = name;
    var views = ['games-list', 'game-create', 'game-active'];
    views.forEach(function (v) {
      var el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('hidden', v !== name);
    });
  };

  // ── Games list view ────────────────────────────────────────

  function renderGamesList(games) {
    var container = document.getElementById('games-list-container');
    if (!container) return;

    if (games.length === 0) {
      container.innerHTML = '<p class="games-empty">No campaigns yet. Start your first voyage!</p>';
      return;
    }

    var html = '<div class="games-grid">';
    games.forEach(function (game) {
      var updated =
        game.updatedAt && game.updatedAt.toDate ? game.updatedAt.toDate().toLocaleDateString() : '';
      html +=
        '<div class="game-card">' +
        '<div class="game-card-header">' +
        '<span class="game-card-name">' +
        _esc(game.name || 'Unnamed Campaign') +
        '</span>' +
        '<span class="game-card-status ' +
        (game.status === 'active' ? 'status-active' : 'status-ended') +
        '">' +
        (game.status === 'active' ? 'Active' : 'Ended') +
        '</span>' +
        '</div>' +
        '<div class="game-card-meta">' +
        '<span>Captain ' +
        _esc((game.player && game.player.name) || '—') +
        '</span>' +
        '<span>' +
        _esc((game.ship && game.ship.name) || '—') +
        '</span>' +
        '<span>Turn ' +
        (game.turnCount || 0) +
        '</span>' +
        (updated ? '<span>' + updated + '</span>' : '') +
        '</div>' +
        '<div class="game-card-actions">' +
        '<button type="button" class="btn btn-primary btn-sm game-continue" data-id="' +
        game.id +
        '">' +
        (game.status === 'active' ? 'Continue' : 'View') +
        '</button>' +
        '</div>' +
        '</div>';
    });
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.game-continue').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _loadActiveGame(btn.dataset.id);
      });
    });
  }

  // ── Active game view ───────────────────────────────────────

  function _loadActiveGame(gameId) {
    VO.getGame(gameId)
      .then(function (game) {
        if (!game) return;
        VO.state.currentGame = game;
        _renderActiveGame(game);
        VO.showView('game-active');
      })
      .catch(function (err) {
        console.error('Failed to load game:', err);
      });
  }

  function _renderActiveGame(game) {
    // HUD
    var hud = document.getElementById('game-hud');
    if (hud && game.ship) {
      document.getElementById('hud-ship-name').textContent = game.ship.name || '—';
      document.getElementById('hud-location').textContent = game.currentLocationName || '—';
      document.getElementById('hud-turn').textContent = 'Turn ' + (game.turnCount || 0);
      document.getElementById('hud-hull').textContent = 'Hull ' + (game.ship.hull || 0) + '%';
      document.getElementById('hud-fuel').textContent = 'Fuel ' + (game.ship.fuel || 0) + '%';
    }

    // Load last narrative entry from Firestore
    VO.state.db
      .collection('void_odyssey_games')
      .doc(game.id)
      .collection('narrative_log')
      .orderBy('turnNumber', 'desc')
      .limit(1)
      .get()
      .then(function (snapshot) {
        if (snapshot.empty) return;
        var entry = snapshot.docs[0].data();
        _renderNarrative(entry.narrative, entry.availableActions || []);
      })
      .catch(function (err) {
        console.error('Failed to load narrative:', err);
      });
  }

  function _renderNarrative(narrative, actions) {
    var panel = document.getElementById('narrative-content');
    if (panel) {
      panel.innerHTML = '<p>' + _escNarrative(narrative) + '</p>';
    }

    var actionsContainer = document.getElementById('action-buttons');
    if (actionsContainer) {
      actionsContainer.innerHTML = '';
      (actions || []).forEach(function (action) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'action-btn';
        btn.textContent = action.label;
        btn.dataset.id = action.id;
        btn.title = 'Full turn execution available in Phase 2';
        actionsContainer.appendChild(btn);
      });
    }
  }

  // ── Init ───────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    firebase.auth().onAuthStateChanged(function (user) {
      if (!user) {
        window.location.href = '/';
        return;
      }

      // Init shared services
      VO.state.db = firebase.firestore();
      VO.state.functions = firebase.functions();
      VO.state.currentUser = user;

      // Render shared header
      window.OlympusHeader.render('Void Odyssey');

      // Hide loading spinner, show app
      document.getElementById('app-loading').classList.add('hidden');
      document.getElementById('app-main').classList.remove('hidden');

      _initApp(user);
    });
  });

  function _initApp(user) {
    // Check URL hash for routing
    var hash = window.location.hash;
    if (hash === '#create') {
      _startNewGame();
      return;
    }

    var gameMatch = hash.match(/^#game\/(.+)$/);
    if (gameMatch) {
      _loadActiveGame(gameMatch[1]);
      return;
    }

    // Default: load games list
    VO.loadUserGames(user.uid)
      .then(function (games) {
        if (games.length === 0) {
          _startNewGame();
        } else {
          renderGamesList(games);
          VO.showView('games-list');
        }
      })
      .catch(function (err) {
        console.error('Failed to load games:', err);
        _startNewGame();
      });

    // "New Campaign" button
    var newBtn = document.getElementById('btn-new-campaign');
    if (newBtn) {
      newBtn.addEventListener('click', _startNewGame);
    }
  }

  function _startNewGame() {
    // Reset wizard state
    VO.state.wizardData = {
      difficulty: null,
      captainName: '',
      captainTraits: [],
      captainBackstory: '',
      shipClass: null,
      shipName: '',
    };
    VO.state.generatedGame = null;
    VO.showView('game-create');
    VO.renderWizardStep(1);
  }

  // After game creation (called from step 5 "Enter the Void")
  var _origShowView = VO.showView;
  VO.showView = function (name) {
    if (name === 'game-active' && VO.state.generatedGame) {
      var game = VO.state.generatedGame;
      VO.state.currentGame = game;
      _origShowView('game-active');

      // Populate HUD
      var hud = document.getElementById('game-hud');
      if (hud && game.ship) {
        document.getElementById('hud-ship-name').textContent = game.ship.name || '—';
        document.getElementById('hud-location').textContent = game.startingLocation || '—';
        document.getElementById('hud-turn').textContent = 'Turn 0';
        document.getElementById('hud-hull').textContent = 'Hull 100%';
        document.getElementById('hud-fuel').textContent = 'Fuel 100%';
      }

      // Render narrative from generated data
      _renderNarrative(game.narrative, game.availableActions);

      // Refresh games list in background
      if (VO.state.currentUser) {
        VO.loadUserGames(VO.state.currentUser.uid)
          .then(renderGamesList)
          .catch(function () {});
      }
    } else {
      _origShowView(name);
    }
  };

  // ── Helpers ────────────────────────────────────────────────

  function _esc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
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
      .join('</p><p>');
  }
})();
