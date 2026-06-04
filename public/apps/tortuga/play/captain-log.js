(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  var TYPE_FILTERS = ['all', 'move', 'discovery', 'port_visit', 'event'];

  var TYPE_LABELS = {
    all: 'All',
    move: 'Move',
    discovery: 'Discovery',
    port_visit: 'Port',
    event: 'Event',
  };

  var TYPE_BADGE_CLASSES = {
    move: '',
    discovery: 'log-badge--discovery',
    port_visit: 'log-badge--port',
    event: 'log-badge--event',
  };

  var _overlayEl = null;
  var _allEntries = [];
  var _filter = { search: '', type: null };
  var _pageSize = 20;
  var _displayedCount = 0;

  function _esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _getFiltered() {
    return _allEntries.filter(function (entry) {
      if (_filter.type && entry.type !== _filter.type) return false;
      if (_filter.search) {
        var q = _filter.search;
        if ((entry.summary || '').toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function _renderEntries() {
    var resultsEl = _overlayEl && _overlayEl.querySelector('#log-results');
    if (!resultsEl) return;

    var filtered = _getFiltered();
    var toShow = filtered.slice(0, _displayedCount + _pageSize);
    _displayedCount = toShow.length;

    if (toShow.length === 0) {
      resultsEl.innerHTML = '<p class="captain-log-empty">No entries found.</p>';
      return;
    }

    var html = '';
    for (var i = 0; i < toShow.length; i++) {
      var entry = toShow[i];
      var badgeCls = TYPE_BADGE_CLASSES[entry.type] || '';
      html +=
        '<div class="captain-log-entry">' +
        '<div class="captain-log-entry-meta">' +
        '<span class="captain-log-badge ' +
        badgeCls +
        '">' +
        _esc(TYPE_LABELS[entry.type] || entry.type || '?') +
        '</span>' +
        '<span class="captain-log-turn">Turn ' +
        (entry.turn != null ? entry.turn : '?') +
        '</span>' +
        '</div>' +
        '<div class="captain-log-summary">' +
        _esc(entry.summary || '') +
        '</div>' +
        '</div>';
    }

    if (toShow.length < filtered.length) {
      html +=
        '<button type="button" class="btn btn-secondary captain-log-load-more">' +
        'Load more (' +
        (filtered.length - toShow.length) +
        ' remaining)</button>';
    }

    resultsEl.innerHTML = html;

    var loadMore = resultsEl.querySelector('.captain-log-load-more');
    if (loadMore) {
      loadMore.addEventListener('click', function () {
        _renderEntries();
      });
    }
  }

  function _renderUI(container, gameId) {
    var html =
      '<div class="captain-log-dialog">' +
      '<div class="captain-log-header">' +
      '<span class="captain-log-title">Captain\'s Log</span>' +
      '<button type="button" class="captain-log-close" id="captain-log-close-btn" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div style="margin-bottom:0.5rem">' +
      '<input type="text" class="form-input captain-log-search" placeholder="Search log&hellip;" />' +
      '</div>' +
      '<div class="captain-log-filters">';
    for (var i = 0; i < TYPE_FILTERS.length; i++) {
      var f = TYPE_FILTERS[i];
      html +=
        '<button type="button" class="captain-log-filter-btn" data-type="' +
        f +
        '">' +
        _esc(TYPE_LABELS[f]) +
        '</button>';
    }
    html +=
      '</div>' +
      '<div id="log-results" class="captain-log-results">' +
      '<p class="captain-log-empty">Loading&hellip;</p>' +
      '</div>' +
      '</div>';

    container.innerHTML = html;

    container.querySelector('#captain-log-close-btn').addEventListener('click', function () {
      T.captainLog.close();
    });

    var searchInput = container.querySelector('.captain-log-search');
    searchInput.addEventListener('input', function () {
      _filter.search = searchInput.value.trim().toLowerCase();
      _displayedCount = 0;
      _renderEntries();
    });

    container.querySelectorAll('.captain-log-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var type = btn.dataset.type;
        _filter.type = type === 'all' ? null : type;
        _displayedCount = 0;
        container.querySelectorAll('.captain-log-filter-btn').forEach(function (b) {
          b.classList.toggle('captain-log-filter-btn--active', b.dataset.type === type);
        });
        _renderEntries();
      });
    });

    // Default "All" active
    var allBtn = container.querySelector('.captain-log-filter-btn[data-type="all"]');
    if (allBtn) allBtn.classList.add('captain-log-filter-btn--active');

    T.firestore
      .loadLogEntries(gameId, { limit: 100 })
      .then(function (entries) {
        _allEntries = entries;
        _displayedCount = 0;
        _renderEntries();
      })
      .catch(function (err) {
        console.error('[captain-log] load failed', err);
        var resultsEl = container.querySelector('#log-results');
        if (resultsEl) resultsEl.innerHTML = '<p class="captain-log-empty">Failed to load log.</p>';
      });
  }

  T.captainLog = {
    open: function (gameId) {
      if (_overlayEl) T.captainLog.close();

      _allEntries = [];
      _filter = { search: '', type: null };
      _displayedCount = 0;

      _overlayEl = document.createElement('div');
      _overlayEl.className = 'captain-log-root';
      document.body.appendChild(_overlayEl);

      _renderUI(_overlayEl, gameId);
    },

    close: function () {
      if (_overlayEl && _overlayEl.parentNode) {
        _overlayEl.parentNode.removeChild(_overlayEl);
      }
      _overlayEl = null;
    },
  };
})();
