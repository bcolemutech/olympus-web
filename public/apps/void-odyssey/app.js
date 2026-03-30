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

  /** Resolve a difficulty id to its display label. */
  function _difficultyLabel(id) {
    var d = (VO.DIFFICULTIES || []).find(function (d) {
      return d.id === id;
    });
    return d ? d.label : id || '—';
  }

  /** Resolve a ship class id to its display label. */
  function _shipClassLabel(id) {
    var s = (VO.SHIP_CLASSES || []).find(function (s) {
      return s.id === id;
    });
    return s ? s.label : id || '—';
  }

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
      var shipClass = (game.ship && game.ship.class) || '';
      var difficulty = game.difficulty || '';
      html +=
        '<div class="game-card" data-game-id="' +
        game.id +
        '">' +
        '<div class="game-card-header">' +
        '<span class="game-card-name" data-id="' +
        game.id +
        '">' +
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
        (shipClass ? ' (' + _esc(_shipClassLabel(shipClass)) + ')' : '') +
        '</span>' +
        '<span>Turn ' +
        (game.turnCount || 0) +
        '</span>' +
        (difficulty ? '<span>' + _esc(_difficultyLabel(difficulty)) + '</span>' : '') +
        (updated ? '<span>' + updated + '</span>' : '') +
        '</div>' +
        '<div class="game-card-actions">' +
        '<button type="button" class="btn btn-primary btn-sm game-continue" data-id="' +
        game.id +
        '">' +
        (game.status === 'active' ? 'Continue' : 'View') +
        '</button>' +
        '<button type="button" class="game-card-action-btn game-rename" data-id="' +
        game.id +
        '" title="Rename campaign" aria-label="Rename campaign">&#9998;</button>' +
        '<button type="button" class="game-card-action-btn game-card-delete game-delete" data-id="' +
        game.id +
        '" title="Delete campaign" aria-label="Delete campaign">&times;</button>' +
        '</div>' +
        '</div>';
    });
    html += '</div>';
    container.innerHTML = html;

    // Set data-name via DOM property to avoid HTML attribute escaping issues
    games.forEach(function (game) {
      var card = container.querySelector('.game-card[data-game-id="' + game.id + '"]');
      if (!card) return;
      var renameBtn = card.querySelector('.game-rename');
      var deleteBtn = card.querySelector('.game-delete');
      if (renameBtn) renameBtn.dataset.name = game.name || '';
      if (deleteBtn) deleteBtn.dataset.name = game.name || 'this campaign';
    });

    // Continue/view buttons
    container.querySelectorAll('.game-continue').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _loadActiveGame(btn.dataset.id);
      });
    });

    // Rename buttons
    container.querySelectorAll('.game-rename').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        _startRename(btn.dataset.id, btn.dataset.name, container);
      });
    });

    // Delete buttons
    container.querySelectorAll('.game-delete').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        _confirmDelete(btn.dataset.id, btn.dataset.name);
      });
    });
  }

  /** Inline rename: replace name span with input field. */
  function _startRename(gameId, currentName, container) {
    var nameSpan = container.querySelector('.game-card-name[data-id="' + gameId + '"]');
    if (!nameSpan) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'game-card-rename-input';
    input.value = currentName || '';
    input.maxLength = 80;
    input.setAttribute('aria-label', 'Campaign name');

    nameSpan.parentNode.replaceChild(input, nameSpan);
    input.focus();
    input.select();

    var committed = false;

    function cleanupListeners() {
      input.removeEventListener('keydown', onKeyDown);
      input.removeEventListener('blur', onBlur);
    }

    function commit() {
      if (committed) return;
      committed = true;
      cleanupListeners();

      if (!input.isConnected || !input.parentNode) return;

      var newName = input.value.trim();
      if (!newName || newName === currentName) {
        if (input.parentNode) input.parentNode.replaceChild(nameSpan, input);
        return;
      }
      input.disabled = true;
      VO.renameGame(gameId, newName)
        .then(function () {
          nameSpan.textContent = newName;
          if (input.parentNode) input.parentNode.replaceChild(nameSpan, input);
          var renameBtn = container.querySelector('.game-rename[data-id="' + gameId + '"]');
          if (renameBtn) renameBtn.dataset.name = newName;
          var deleteBtn = container.querySelector('.game-delete[data-id="' + gameId + '"]');
          if (deleteBtn) deleteBtn.dataset.name = newName;
        })
        .catch(function (err) {
          console.error('Rename failed:', err);
          if (input.parentNode) input.parentNode.replaceChild(nameSpan, input);
        });
    }

    function onKeyDown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        cleanupListeners();
        if (input.parentNode) input.parentNode.replaceChild(nameSpan, input);
      }
    }

    function onBlur() {
      commit();
    }

    input.addEventListener('keydown', onKeyDown);
    input.addEventListener('blur', onBlur);
  }

  /** Delete campaign with confirmation. */
  function _confirmDelete(gameId, gameName) {
    if (
      !window.confirm(
        'Delete campaign "' + (gameName || 'Unnamed') + '"?\n\nThis cannot be undone.'
      )
    ) {
      return;
    }

    // Remove the card immediately for responsiveness, restore on error
    var card = document.querySelector('.game-card[data-game-id="' + gameId + '"]');
    var parent = card && card.parentNode;
    var nextSibling = card && card.nextSibling;
    if (card) card.remove();

    VO.deleteGame(gameId)
      .then(function () {
        // Check if grid is now empty
        var grid = document.querySelector('.games-grid');
        if (grid && grid.children.length === 0) {
          var container = document.getElementById('games-list-container');
          if (container) {
            container.innerHTML =
              '<p class="games-empty">No campaigns yet. Start your first voyage!</p>';
          }
        }
      })
      .catch(function (err) {
        console.error('Delete failed:', err);
        // Restore the card on failure
        if (card && parent) {
          parent.insertBefore(card, nextSibling);
        }
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
    // HUD via module
    VO.renderHud(game);

    // Initialize sidebar
    if (VO.initSidebar) VO.initSidebar();

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
        VO.renderNarrativeEntry(
          entry.narrative,
          entry.availableActions || [],
          entry.mood || 'calm',
          VO.handleActionClick,
          VO.handleFreeformSubmit
        );
      })
      .catch(function (err) {
        console.error('Failed to load narrative:', err);
      });
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

      if (window.OlympusAnalytics) OlympusAnalytics.init();

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
      newBtn.addEventListener('click', function () {
        if (window.OlympusAnalytics)
          OlympusAnalytics.logEvent('void_odyssey_campaign_create_start');
        _startNewGame();
      });
    }

    // "All Campaigns" button (active game view → games list)
    var backBtn = document.getElementById('btn-back-to-campaigns');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        if (window.OlympusAnalytics) OlympusAnalytics.logEvent('void_odyssey_campaign_exit');
        VO.state.generatedGame = null;
        VO.state.currentGame = null;
        window.location.hash = '';
        VO.loadUserGames(VO.state.currentUser.uid)
          .then(function (games) {
            renderGamesList(games);
            VO.showView('games-list');
          })
          .catch(function () {
            VO.showView('games-list');
          });
      });
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
    if (window.OlympusAnalytics) OlympusAnalytics.logEvent('void_odyssey_view', { view: name });
    if (name === 'game-active' && VO.state.generatedGame) {
      var game = VO.state.generatedGame;
      VO.state.currentGame = game;
      _origShowView('game-active');

      // Populate HUD — build a game-shaped object for renderHud
      VO.renderHud({
        ship: Object.assign(
          {
            name: game.ship.name,
            class: game.ship.class,
            credits: game.ship && typeof game.ship.credits === 'number' ? game.ship.credits : 500,
          },
          VO.SHIP_CLASSES.find(function (s) {
            return s.id === game.ship.class;
          }).stats
        ),
        currentLocationName: game.startingLocation || '—',
        turnCount: 0,
        activeCrew: game.crew || [],
      });

      // Initialize sidebar
      if (VO.initSidebar) VO.initSidebar();

      // Render narrative from generated data
      VO.renderNarrativeEntry(
        game.narrative,
        game.availableActions,
        game.mood || 'calm',
        VO.handleActionClick,
        VO.handleFreeformSubmit
      );

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
})();
