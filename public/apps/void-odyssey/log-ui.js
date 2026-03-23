(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  var MOOD_BADGES = {
    calm: '',
    tense: 'sidebar-badge-yellow',
    danger: 'sidebar-badge-red',
    combat: 'sidebar-badge-red',
    wonder: 'sidebar-badge-green',
    wry: '',
    reverent: 'sidebar-badge-purple',
    tense_curiosity: 'sidebar-badge-yellow',
  };

  var MOOD_FILTERS = ['all', 'calm', 'tense', 'danger', 'combat', 'wonder'];

  var _logFilter = { search: '', mood: null };
  var _allEntries = [];
  var _pageSize = 20;
  var _displayedCount = 0;

  /** Escape HTML. */
  function _esc(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  /**
   * Render the Log tab — main entry point.
   */
  VO.renderLogTab = function (container) {
    var game = VO.state.currentGame;
    if (!game) {
      container.innerHTML = '<p class="sidebar-placeholder">No game loaded.</p>';
      return;
    }

    container.innerHTML = '<p class="sidebar-placeholder">Loading log&hellip;</p>';

    VO.loadNarrativeLog(game.id, { limit: 100 })
      .then(function (entries) {
        _allEntries = entries;
        _displayedCount = 0;
        _logFilter = { search: '', mood: null };
        _renderLogUI(container);
      })
      .catch(function (err) {
        console.error('Failed to load narrative log:', err);
        container.innerHTML =
          '<p class="sidebar-placeholder">Unable to load log. Please check your connection.</p>';
      });
  };

  function _renderLogUI(container) {
    var html = '';

    // Search input
    html +=
      '<div style="margin-bottom:0.5rem">' +
      '<input type="text" class="form-input log-search-input" placeholder="Search log&hellip;" ' +
      'style="width:100%;font-size:0.82rem;padding:0.4rem 0.6rem" />' +
      '</div>';

    // Mood filter buttons
    html += '<div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-bottom:0.75rem">';
    for (var i = 0; i < MOOD_FILTERS.length; i++) {
      var f = MOOD_FILTERS[i];
      var label = f.charAt(0).toUpperCase() + f.slice(1);
      html +=
        '<button type="button" class="sidebar-tag log-mood-filter" data-mood="' +
        f +
        '" style="cursor:pointer;font-size:0.72rem">' +
        _esc(label) +
        '</button>';
    }
    html += '</div>';

    // Results container
    html += '<div id="log-results"></div>';

    container.innerHTML = html;

    // Bind search
    var searchInput = container.querySelector('.log-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        _logFilter.search = searchInput.value.trim().toLowerCase();
        _displayedCount = 0;
        _renderFilteredEntries();
      });
    }

    // Bind mood filters
    container.querySelectorAll('.log-mood-filter').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mood = btn.dataset.mood;
        _logFilter.mood = mood === 'all' ? null : mood;
        _displayedCount = 0;

        // Highlight active
        container.querySelectorAll('.log-mood-filter').forEach(function (b) {
          b.style.fontWeight = b.dataset.mood === mood ? '700' : '400';
        });

        _renderFilteredEntries();
      });
    });

    // Initial render
    _renderFilteredEntries();
  }

  function _getFilteredEntries() {
    return _allEntries.filter(function (entry) {
      // Mood filter
      if (_logFilter.mood && entry.mood !== _logFilter.mood) return false;

      // Search filter
      if (_logFilter.search) {
        var q = _logFilter.search;
        var matchSummary = (entry.summary || '').toLowerCase().indexOf(q) !== -1;
        var matchTags =
          Array.isArray(entry.tags) &&
          entry.tags.some(function (t) {
            return (t || '').toLowerCase().indexOf(q) !== -1;
          });
        if (!matchSummary && !matchTags) return false;
      }
      return true;
    });
  }

  function _renderFilteredEntries() {
    var resultsEl = document.getElementById('log-results');
    if (!resultsEl) return;

    var filtered = _getFilteredEntries();
    var toShow = filtered.slice(0, _displayedCount + _pageSize);
    _displayedCount = toShow.length;

    if (toShow.length === 0) {
      resultsEl.innerHTML = '<p class="sidebar-empty">No entries found.</p>';
      return;
    }

    var html = '';
    for (var i = 0; i < toShow.length; i++) {
      var entry = toShow[i];
      var moodBadge = MOOD_BADGES[entry.mood] || '';

      html +=
        '<div class="sidebar-card log-entry-card" role="button" tabindex="0" data-log-idx="' +
        i +
        '">' +
        '<div class="log-entry-turn">Turn ' +
        (entry.turnNumber != null ? entry.turnNumber : '?') +
        '</div>' +
        '<div class="log-entry-summary">' +
        _esc(entry.summary || 'No summary') +
        '</div>' +
        '<div class="sidebar-card-meta" style="margin-top:0.3rem">' +
        '<span class="sidebar-badge ' +
        moodBadge +
        '">' +
        _esc(entry.mood || 'unknown') +
        '</span>';

      if (entry.compressed) {
        html += '<span class="sidebar-badge sidebar-badge-blue">Compressed</span>';
      }

      html += '</div></div>';
    }

    // Load more button
    if (toShow.length < filtered.length) {
      html +=
        '<button type="button" class="btn btn-secondary log-load-more" ' +
        'style="width:100%;padding:0.6rem;font-size:0.82rem;margin-top:0.5rem">' +
        'Load more (' +
        (filtered.length - toShow.length) +
        ' remaining)</button>';
    }

    resultsEl.innerHTML = html;

    // Bind card clicks
    resultsEl.querySelectorAll('.log-entry-card').forEach(function (card) {
      function activate() {
        var idx = parseInt(card.dataset.logIdx, 10);
        if (toShow[idx]) {
          _renderLogDetail(document.getElementById('sidebar-content'), toShow[idx]);
        }
      }
      card.addEventListener('click', activate);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });
    });

    // Bind load more
    var loadMoreBtn = resultsEl.querySelector('.log-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function () {
        _renderFilteredEntries();
      });
    }
  }

  function _renderLogDetail(container, entry) {
    if (!container) return;

    var moodBadge = MOOD_BADGES[entry.mood] || '';
    var html = '';

    // Back button
    html +=
      '<button type="button" class="sidebar-back-btn" id="log-detail-back">&larr; Log</button>';

    // Turn header
    html +=
      '<div class="sidebar-detail-name">Turn ' +
      (entry.turnNumber != null ? entry.turnNumber : '?') +
      '</div>';

    // Mood badge
    html +=
      '<div style="margin-bottom:0.75rem">' +
      '<span class="sidebar-badge ' +
      moodBadge +
      '">' +
      _esc(entry.mood || 'unknown') +
      '</span>';
    if (entry.compressed) {
      html += ' <span class="sidebar-badge sidebar-badge-blue">Compressed</span>';
    }
    html += '</div>';

    // Player action
    if (entry.playerAction) {
      html += '<div class="sidebar-section-title">Player Action</div>';
      html +=
        '<div style="font-size:0.82rem;color:#90a4ae;margin-bottom:0.75rem">' +
        _esc(entry.playerAction.input || entry.playerAction.type || '') +
        '</div>';
    }

    // Full narrative
    if (entry.narrative) {
      html += '<div class="sidebar-section-title">Narrative</div>';
      html += '<div class="log-entry-expanded">' + _esc(entry.narrative) + '</div>';
    }

    // Summary
    if (entry.summary) {
      html += '<div class="sidebar-section-title" style="margin-top:0.75rem">Summary</div>';
      html += '<div style="font-size:0.82rem;color:#b0bec5">' + _esc(entry.summary) + '</div>';
    }

    // Stat mutations
    if (entry.stateMutations && entry.stateMutations.length > 0) {
      html += '<div class="sidebar-section-title" style="margin-top:0.75rem">Changes</div>';
      html += '<ul style="font-size:0.78rem;color:#90a4ae;padding-left:1rem;margin:0.3rem 0">';
      for (var i = 0; i < entry.stateMutations.length; i++) {
        var mut = entry.stateMutations[i];
        var desc = mut.type;
        if (mut.reason) desc += ' — ' + mut.reason;
        else if (mut.field) desc += ': ' + mut.field + ' ' + (mut.delta > 0 ? '+' : '') + mut.delta;
        html += '<li>' + _esc(desc) + '</li>';
      }
      html += '</ul>';
    }

    container.innerHTML = html;

    // Back button handler
    var backBtn = document.getElementById('log-detail-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        VO.renderLogTab(container);
      });
    }
  }
})();
