(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  var QUEST_TYPE_BADGES = {
    main: { label: 'Main', cls: 'sidebar-badge-purple' },
    side: { label: 'Side', cls: 'sidebar-badge-blue' },
    crew_personal: { label: 'Crew', cls: 'sidebar-badge-green' },
    faction: { label: 'Faction', cls: 'sidebar-badge-orange' },
    discovery: { label: 'Discovery', cls: 'sidebar-badge-yellow' },
  };

  var STATUS_BADGES = {
    active: { label: 'Active', cls: 'sidebar-badge-green' },
    completed: { label: 'Completed', cls: 'sidebar-badge-blue' },
    failed: { label: 'Failed', cls: 'sidebar-badge-red' },
    abandoned: { label: 'Abandoned', cls: 'sidebar-badge' },
  };

  var FILTER_BUTTONS = [
    { id: 'active', label: 'Active' },
    { id: 'completed', label: 'Completed' },
    { id: 'all', label: 'All' },
  ];

  var _questFilter = 'active';

  /** Escape HTML. */
  function _esc(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  /**
   * Render the Quests tab — quest log.
   */
  VO.renderQuestsTab = function (container) {
    var game = VO.state.currentGame;
    if (!game) {
      container.innerHTML = '<p class="sidebar-placeholder">No game loaded.</p>';
      return;
    }

    container.innerHTML = '<p class="sidebar-placeholder">Loading quests&hellip;</p>';

    VO.loadQuests(game.id)
      .then(function (quests) {
        _renderQuestList(container, quests);
      })
      .catch(function (err) {
        console.error('Failed to load quests:', err);
        container.innerHTML =
          '<p class="sidebar-placeholder">Unable to load quests. You may be offline or lack permission.</p>';
      });
  };

  function _renderQuestList(container, quests) {
    var html = '';

    // Filter buttons
    html += '<div class="sidebar-filters" id="quest-filters">';
    for (var f = 0; f < FILTER_BUTTONS.length; f++) {
      var fb = FILTER_BUTTONS[f];
      var activeClass = _questFilter === fb.id ? ' sidebar-filter-btn-active' : '';
      html +=
        '<button type="button" class="sidebar-filter-btn' +
        activeClass +
        '" data-filter="' +
        fb.id +
        '">' +
        _esc(fb.label) +
        '</button>';
    }
    html += '</div>';

    // Quest list
    html += '<div id="quest-results"></div>';

    container.innerHTML = html;

    _renderFilteredQuests(quests);

    // Bind filter buttons
    var filterBtns = document.querySelectorAll('#quest-filters .sidebar-filter-btn');
    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        _questFilter = btn.dataset.filter || 'active';
        filterBtns.forEach(function (b) {
          b.classList.remove('sidebar-filter-btn-active');
        });
        btn.classList.add('sidebar-filter-btn-active');
        _renderFilteredQuests(quests);
      });
    });
  }

  function _renderFilteredQuests(quests) {
    var results = document.getElementById('quest-results');
    if (!results) return;

    var filtered = quests.filter(function (q) {
      if (_questFilter === 'all') return true;
      return (q.status || 'active') === _questFilter;
    });

    if (filtered.length === 0) {
      results.innerHTML =
        '<p class="sidebar-empty">' +
        (quests.length === 0
          ? 'No quests yet &mdash; explore to discover storylines.'
          : 'No ' + _questFilter + ' quests.') +
        '</p>';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var quest = filtered[i];
      var typeBadge = QUEST_TYPE_BADGES[quest.type] || QUEST_TYPE_BADGES.side;
      var statusBadge = STATUS_BADGES[quest.status] || STATUS_BADGES.active;
      var currentObj = _getCurrentObjective(quest);

      html +=
        '<div class="sidebar-card quest-card" role="button" tabindex="0" data-quest-idx="' +
        i +
        '">' +
        '<div class="sidebar-card-name">' +
        _esc(quest.name || quest.title || 'Unnamed Quest') +
        '</div>' +
        '<div class="sidebar-card-meta">' +
        '<span class="sidebar-badge ' +
        typeBadge.cls +
        '">' +
        _esc(typeBadge.label) +
        '</span>' +
        '<span class="sidebar-badge ' +
        statusBadge.cls +
        '">' +
        _esc(statusBadge.label) +
        '</span>' +
        '</div>';

      if (currentObj) {
        html +=
          '<div class="quest-current-objective">' +
          '<span class="quest-obj-icon">&#9673;</span> ' +
          _esc(currentObj.description) +
          '</div>';
      }

      html += '</div>';
    }

    results.innerHTML = html;

    // Bind click and keyboard handlers
    results.querySelectorAll('.quest-card').forEach(function (card) {
      function activate() {
        var idx = parseInt(card.dataset.questIdx, 10);
        if (filtered[idx]) {
          var container = document.getElementById('sidebar-content');
          _renderQuestDetail(container, filtered[idx]);
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
  }

  function _renderQuestDetail(container, quest) {
    var typeBadge = QUEST_TYPE_BADGES[quest.type] || QUEST_TYPE_BADGES.side;
    var statusBadge = STATUS_BADGES[quest.status] || STATUS_BADGES.active;

    var html = '';

    // Back button
    html +=
      '<button type="button" class="sidebar-back-btn" id="quest-detail-back">&larr; Quests</button>';

    // Name
    html +=
      '<div class="sidebar-detail-name">' +
      _esc(quest.name || quest.title || 'Unnamed Quest') +
      '</div>';

    // Badges
    html += '<div style="margin-bottom:0.75rem">';
    html +=
      '<span class="sidebar-badge ' + typeBadge.cls + '">' + _esc(typeBadge.label) + '</span> ';
    html +=
      '<span class="sidebar-badge ' + statusBadge.cls + '">' + _esc(statusBadge.label) + '</span>';
    if (quest.givenBy) {
      html +=
        ' <span style="font-size:0.78rem;color:#78909c">from ' + _esc(quest.givenBy) + '</span>';
    }
    html += '</div>';

    // Description
    if (quest.description) {
      html += '<div class="sidebar-detail-desc">' + _esc(quest.description) + '</div>';
    }

    // Objectives
    var objectives = quest.objectives || [];
    if (objectives.length > 0) {
      html += '<div class="sidebar-section-title">Objectives</div>';
      html += '<div class="quest-objectives">';
      for (var o = 0; o < objectives.length; o++) {
        var obj = objectives[o];
        var objStatus = obj.status || 'active';
        var iconClass = 'quest-obj-active';
        var icon = '&#9673;'; // circle
        if (objStatus === 'completed') {
          iconClass = 'quest-obj-done';
          icon = '&#10003;'; // checkmark
        } else if (objStatus === 'failed') {
          iconClass = 'quest-obj-failed';
          icon = '&#10007;'; // x
        }
        html +=
          '<div class="quest-objective ' +
          iconClass +
          '">' +
          '<span class="quest-obj-icon">' +
          icon +
          '</span> ' +
          _esc(obj.description) +
          '</div>';
      }
      html += '</div>';
    }

    // Hooks (narrative hints)
    if (quest.hooks && quest.hooks.length > 0) {
      html += '<div class="sidebar-section-title">Leads</div>';
      for (var h = 0; h < quest.hooks.length; h++) {
        html +=
          '<div style="font-size:0.82rem;color:#90a4ae;margin-bottom:0.3rem;font-style:italic">&ldquo;' +
          _esc(quest.hooks[h]) +
          '&rdquo;</div>';
      }
    }

    // Last note
    if (quest.lastNote) {
      html += '<div class="sidebar-section-title">Latest Update</div>';
      html +=
        '<div style="font-size:0.82rem;color:#b0bec5;margin-bottom:0.5rem">' +
        _esc(quest.lastNote) +
        '</div>';
    }

    // Tags
    if (quest.tags && quest.tags.length > 0) {
      html += '<div class="sidebar-section-title">Tags</div>';
      html += '<div style="margin-bottom:0.5rem">';
      for (var t = 0; t < quest.tags.length; t++) {
        html += '<span class="sidebar-tag">' + _esc(quest.tags[t]) + '</span>';
      }
      html += '</div>';
    }

    // Footer
    if (quest.givenOnTurn !== undefined && quest.givenOnTurn !== null) {
      html +=
        '<div style="margin-top:1rem;font-size:0.75rem;color:#546e7a">Started on Turn ' +
        quest.givenOnTurn +
        '</div>';
    }
    if (quest.completedOnTurn !== undefined && quest.completedOnTurn !== null) {
      html +=
        '<div style="font-size:0.75rem;color:#546e7a">' +
        (quest.status === 'failed' ? 'Failed' : 'Completed') +
        ' on Turn ' +
        quest.completedOnTurn +
        '</div>';
    }

    container.innerHTML = html;

    // Back handler
    var backBtn = document.getElementById('quest-detail-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        VO.renderQuestsTab(container);
      });
    }
  }

  function _getCurrentObjective(quest) {
    var objectives = quest.objectives || [];
    if (quest.currentObjectiveId) {
      var found = objectives.find(function (o) {
        return o.id === quest.currentObjectiveId;
      });
      if (found) return found;
    }
    // Fallback: first active objective
    return (
      objectives.find(function (o) {
        return (o.status || 'active') === 'active';
      }) || null
    );
  }
})();
