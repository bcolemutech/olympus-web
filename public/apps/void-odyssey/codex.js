(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  var ENTITY_TYPES = [
    { id: null, label: 'All' },
    { id: 'npc', label: 'People' },
    { id: 'person', label: 'People' },
    { id: 'faction', label: 'Factions' },
    { id: 'creature', label: 'Creatures' },
    { id: 'ai', label: 'AI' },
    { id: 'ship', label: 'Ships' },
    { id: 'object', label: 'Objects' },
  ];

  var FILTER_BUTTONS = [
    { id: null, label: 'All' },
    { id: 'person', label: 'People', also: ['npc'] },
    { id: 'faction', label: 'Factions' },
    { id: 'creature', label: 'Creatures' },
    { id: 'ai', label: 'AI' },
  ];

  var DISPOSITION_DOTS = {
    friendly: '#81c784',
    neutral: '#90a4ae',
    suspicious: '#ffb74d',
    hostile: '#ef5350',
  };

  /** Escape HTML. */
  function _esc(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  // Track current filter state within the codex
  var _codexFilter = { search: '', type: null };

  /**
   * Render the Codex tab — entity browser.
   */
  VO.renderCodexTab = function (container) {
    var game = VO.state.currentGame;
    if (!game) {
      container.innerHTML = '<p class="sidebar-placeholder">No game loaded.</p>';
      return;
    }

    container.innerHTML = '<p class="sidebar-placeholder">Loading codex&hellip;</p>';

    VO.loadEntities(game.id).then(function (entities) {
      _renderCodexList(container, entities);
    });
  };

  function _renderCodexList(container, entities) {
    var html = '';

    // Search input
    html +=
      '<input type="text" class="sidebar-search" id="codex-search" placeholder="Search by name or tag&hellip;" value="' +
      _esc(_codexFilter.search) +
      '" />';

    // Filter buttons
    html += '<div class="sidebar-filters" id="codex-filters">';
    for (var f = 0; f < FILTER_BUTTONS.length; f++) {
      var fb = FILTER_BUTTONS[f];
      var activeClass = _codexFilter.type === fb.id ? ' sidebar-filter-btn-active' : '';
      html +=
        '<button type="button" class="sidebar-filter-btn' +
        activeClass +
        '" data-type="' +
        (fb.id || '') +
        '">' +
        _esc(fb.label) +
        '</button>';
    }
    html += '</div>';

    // Filtered entity list
    html += '<div id="codex-results"></div>';

    container.innerHTML = html;

    // Render filtered results
    _renderFilteredEntities(entities);

    // Bind search
    var searchInput = document.getElementById('codex-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        _codexFilter.search = searchInput.value;
        _renderFilteredEntities(entities);
      });
    }

    // Bind filter buttons
    var filterBtns = document.querySelectorAll('#codex-filters .sidebar-filter-btn');
    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var type = btn.dataset.type || null;
        _codexFilter.type = type;
        // Update active states
        filterBtns.forEach(function (b) {
          b.classList.remove('sidebar-filter-btn-active');
        });
        btn.classList.add('sidebar-filter-btn-active');
        _renderFilteredEntities(entities);
      });
    });
  }

  function _renderFilteredEntities(entities) {
    var results = document.getElementById('codex-results');
    if (!results) return;

    var filtered = _filterEntities(entities, _codexFilter.search, _codexFilter.type);

    if (filtered.length === 0) {
      results.innerHTML =
        '<p class="sidebar-empty">' +
        (entities.length === 0
          ? 'No entities discovered yet. Explore the void!'
          : 'No matches found.') +
        '</p>';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var entity = filtered[i];
      var dotColor = DISPOSITION_DOTS[entity.disposition] || DISPOSITION_DOTS.neutral;
      var typeLabel = _entityTypeLabel(entity.type);

      html +=
        '<div class="sidebar-card codex-entry-card" data-entity-idx="' +
        i +
        '">' +
        '<div class="sidebar-card-name">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' +
        dotColor +
        ';margin-right:0.4rem;vertical-align:middle"></span>' +
        _esc(entity.name) +
        '</div>' +
        '<div class="sidebar-card-meta">' +
        '<span class="sidebar-badge">' +
        _esc(typeLabel) +
        '</span>';

      if (entity.shortDescription || entity.description) {
        html +=
          '<span style="color:#78909c;font-size:0.75rem">' +
          _esc((entity.shortDescription || entity.description || '').slice(0, 60)) +
          '</span>';
      }

      html += '</div></div>';
    }

    results.innerHTML = html;

    // Bind click handlers
    results.querySelectorAll('.codex-entry-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var idx = parseInt(card.dataset.entityIdx, 10);
        if (filtered[idx]) {
          var container = document.getElementById('sidebar-content');
          _renderEntityDetail(container, filtered[idx]);
        }
      });
    });
  }

  function _filterEntities(entities, searchTerm, typeFilter) {
    return entities.filter(function (e) {
      // Type filter
      if (typeFilter) {
        var matchesType = e.type === typeFilter;
        // "person" filter also matches "npc"
        if (typeFilter === 'person') matchesType = e.type === 'person' || e.type === 'npc';
        if (!matchesType) return false;
      }

      // Search filter
      if (searchTerm && searchTerm.length > 0) {
        var term = searchTerm.toLowerCase();
        var nameMatch = (e.name || '').toLowerCase().indexOf(term) !== -1;
        var tagMatch =
          Array.isArray(e.tags) &&
          e.tags.some(function (t) {
            return t.toLowerCase().indexOf(term) !== -1;
          });
        if (!nameMatch && !tagMatch) return false;
      }

      return true;
    });
  }

  function _renderEntityDetail(container, entity) {
    var dotColor = DISPOSITION_DOTS[entity.disposition] || DISPOSITION_DOTS.neutral;
    var typeLabel = _entityTypeLabel(entity.type);

    var html = '';

    // Back button
    html +=
      '<button type="button" class="sidebar-back-btn" id="codex-detail-back">&larr; Codex</button>';

    // Name
    html += '<div class="sidebar-detail-name">' + _esc(entity.name) + '</div>';

    // Type + disposition badges
    html += '<div style="margin-bottom:0.75rem">';
    html += '<span class="sidebar-badge">' + _esc(typeLabel) + '</span> ';
    html +=
      '<span style="display:inline-flex;align-items:center;gap:0.3rem;font-size:0.8rem;color:' +
      dotColor +
      '">' +
      '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' +
      dotColor +
      '"></span>' +
      _esc(entity.disposition || 'neutral') +
      '</span>';
    if (entity.species) {
      html += ' <span class="sidebar-badge">' + _esc(entity.species) + '</span>';
    }
    if (entity.role) {
      html += ' <span class="sidebar-badge">' + _esc(entity.role) + '</span>';
    }
    html += '</div>';

    // Description
    if (entity.description) {
      html += '<div class="sidebar-detail-desc">' + _esc(entity.description) + '</div>';
    }

    // Personality
    if (entity.personality && entity.personality.length > 0) {
      html += '<div class="sidebar-section-title">Personality</div>';
      html += '<div style="margin-bottom:0.5rem">';
      for (var p = 0; p < entity.personality.length; p++) {
        html += '<span class="sidebar-tag">' + _esc(entity.personality[p]) + '</span>';
      }
      html += '</div>';
    }

    // Dialogue style
    if (entity.dialogue_style) {
      html += '<div class="sidebar-section-title">Speech</div>';
      html +=
        '<div style="font-size:0.82rem;color:#90a4ae;margin-bottom:0.5rem;font-style:italic">' +
        _esc(entity.dialogue_style) +
        '</div>';
    }

    // Player reputation
    if (entity.playerReputation !== undefined && entity.playerReputation !== null) {
      var repPct = Math.round(((entity.playerReputation + 100) / 200) * 100);
      html += '<div class="sidebar-section-title">Reputation</div>';
      html +=
        '<div class="sidebar-stat-row">' +
        '<span class="sidebar-stat-label">-100</span>' +
        '<div class="sidebar-stat-bar"><div class="sidebar-stat-fill hud-bar-' +
        (repPct > 60 ? 'green' : repPct > 30 ? 'yellow' : 'red') +
        '" style="width:' +
        repPct +
        '%"></div></div>' +
        '<span class="sidebar-stat-value">+100</span>' +
        '</div>';
    }

    // Significant moments
    if (entity.significantMoments && entity.significantMoments.length > 0) {
      html += '<div class="sidebar-section-title">History</div>';
      for (var m = 0; m < entity.significantMoments.length; m++) {
        var moment = entity.significantMoments[m];
        html +=
          '<div class="sidebar-timeline-entry">' +
          '<div class="sidebar-timeline-turn">Turn ' +
          (moment.turnNumber || '?') +
          '</div>' +
          _esc(moment.summary || '') +
          '</div>';
      }
    }

    // Tags
    if (entity.tags && entity.tags.length > 0) {
      html += '<div class="sidebar-section-title">Tags</div>';
      html += '<div style="margin-bottom:0.5rem">';
      for (var t = 0; t < entity.tags.length; t++) {
        html += '<span class="sidebar-tag">' + _esc(entity.tags[t]) + '</span>';
      }
      html += '</div>';
    }

    // Footer
    if (entity.metOnTurn) {
      html +=
        '<div style="margin-top:1rem;font-size:0.75rem;color:#546e7a">First met on Turn ' +
        entity.metOnTurn +
        '</div>';
    }

    container.innerHTML = html;

    // Back handler
    var backBtn = document.getElementById('codex-detail-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        VO.renderCodexTab(container);
      });
    }
  }

  function _entityTypeLabel(type) {
    for (var i = 0; i < ENTITY_TYPES.length; i++) {
      if (ENTITY_TYPES[i].id === type) return ENTITY_TYPES[i].label;
    }
    return type || 'Unknown';
  }
})();
