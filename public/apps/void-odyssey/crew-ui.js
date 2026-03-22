(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  var MORALE_STYLES = {
    content: { color: '#81c784', label: 'Content', badge: 'sidebar-badge-green' },
    uneasy: { color: '#ffb74d', label: 'Uneasy', badge: 'sidebar-badge-yellow' },
    anxious: { color: '#ffb74d', label: 'Anxious', badge: 'sidebar-badge-yellow' },
    fearful: { color: '#ef5350', label: 'Fearful', badge: 'sidebar-badge-red' },
    angry: { color: '#ef5350', label: 'Angry', badge: 'sidebar-badge-red' },
    broken: { color: '#ef5350', label: 'Broken', badge: 'sidebar-badge-red' },
    inspired: { color: '#64b5f6', label: 'Inspired', badge: 'sidebar-badge-blue' },
    defiant: { color: '#ff8a65', label: 'Defiant', badge: 'sidebar-badge-orange' },
  };

  var HEALTH_STYLES = {
    healthy: { badge: 'sidebar-badge-green', label: 'Healthy' },
    minor_injury: { badge: 'sidebar-badge-yellow', label: 'Minor Injury' },
    serious_injury: { badge: 'sidebar-badge-orange', label: 'Serious Injury' },
    critical: { badge: 'sidebar-badge-red', label: 'Critical' },
  };

  /** Escape HTML. */
  function _esc(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  /**
   * Render the Crew tab — roster view.
   */
  VO.renderCrewTab = function (container) {
    var game = VO.state.currentGame;
    if (!game) {
      container.innerHTML = '<p class="sidebar-placeholder">No game loaded.</p>';
      return;
    }

    container.innerHTML = '<p class="sidebar-placeholder">Loading crew&hellip;</p>';

    VO.loadCrew(game.id).then(function (crew) {
      if (!crew || crew.length === 0) {
        container.innerHTML = '<p class="sidebar-empty">No crew members found.</p>';
        return;
      }

      var html = '';
      for (var i = 0; i < crew.length; i++) {
        var member = crew[i];
        var moraleStyle = MORALE_STYLES[member.morale] || MORALE_STYLES.content;
        var healthStyle = HEALTH_STYLES[member.healthStatus] || HEALTH_STYLES.healthy;

        html +=
          '<div class="sidebar-card crew-roster-card" data-crew-idx="' +
          i +
          '">' +
          '<div class="sidebar-card-name">' +
          _esc(member.name) +
          '</div>' +
          '<div class="sidebar-card-meta">' +
          '<span class="sidebar-badge">' +
          _esc(member.role || 'crew') +
          '</span>' +
          '<span class="sidebar-badge ' +
          moraleStyle.badge +
          '">' +
          _esc(moraleStyle.label) +
          '</span>' +
          '<span class="sidebar-badge ' +
          healthStyle.badge +
          '">' +
          _esc(healthStyle.label) +
          '</span>';

        if (member.species && member.species !== 'human') {
          html += '<span class="sidebar-badge">' + _esc(member.species) + '</span>';
        }

        if (member.currentAssignment) {
          html +=
            '<span class="sidebar-badge sidebar-badge-blue">' +
            _esc(member.currentAssignment) +
            '</span>';
        }

        html += '</div></div>';
      }

      container.innerHTML = html;

      // Bind click handlers
      container.querySelectorAll('.crew-roster-card').forEach(function (card) {
        card.addEventListener('click', function () {
          var idx = parseInt(card.dataset.crewIdx, 10);
          if (crew[idx]) _renderCrewDetail(container, crew[idx], crew);
        });
      });
    });
  };

  /**
   * Render a single crew member detail view.
   */
  function _renderCrewDetail(container, member, allCrew) {
    var moraleStyle = MORALE_STYLES[member.morale] || MORALE_STYLES.content;
    var healthStyle = HEALTH_STYLES[member.healthStatus] || HEALTH_STYLES.healthy;

    var html = '';

    // Back button
    html +=
      '<button type="button" class="sidebar-back-btn" id="crew-detail-back">&larr; Crew Roster</button>';

    // Name and role
    html += '<div class="sidebar-detail-name">' + _esc(member.name) + '</div>';
    html += '<div style="margin-bottom:0.75rem">';
    html += '<span class="sidebar-badge">' + _esc(member.role || 'crew') + '</span> ';
    html += '<span class="sidebar-badge">' + _esc(member.species || 'human') + '</span> ';
    html +=
      '<span class="sidebar-badge ' +
      moraleStyle.badge +
      '">' +
      _esc(moraleStyle.label) +
      '</span> ';
    html +=
      '<span class="sidebar-badge ' +
      healthStyle.badge +
      '">' +
      _esc(healthStyle.label) +
      '</span>';
    html += '</div>';

    // Backstory
    if (member.backstory) {
      html += '<div class="sidebar-section-title">Backstory</div>';
      html += '<div class="sidebar-detail-desc">' + _esc(member.backstory) + '</div>';
    }

    // Personality traits
    if (member.personality && member.personality.length > 0) {
      html += '<div class="sidebar-section-title">Personality</div>';
      html += '<div style="margin-bottom:0.5rem">';
      for (var p = 0; p < member.personality.length; p++) {
        html += '<span class="sidebar-tag">' + _esc(member.personality[p]) + '</span>';
      }
      html += '</div>';
    }

    // Skills
    if (member.skills && member.skills.length > 0) {
      html += '<div class="sidebar-section-title">Skills</div>';
      html += '<div style="margin-bottom:0.5rem">';
      for (var s = 0; s < member.skills.length; s++) {
        html += '<span class="sidebar-tag">' + _esc(member.skills[s]) + '</span>';
      }
      html += '</div>';
    }

    // Quirks
    if (member.quirks && member.quirks.length > 0) {
      html += '<div class="sidebar-section-title">Quirks</div>';
      html += '<div style="margin-bottom:0.5rem">';
      for (var q = 0; q < member.quirks.length; q++) {
        html += '<span class="sidebar-tag">' + _esc(member.quirks[q]) + '</span>';
      }
      html += '</div>';
    }

    // Loyalty
    if (member.loyalty !== undefined && member.loyalty !== null) {
      var loyaltyPct = Math.round(((member.loyalty + 100) / 200) * 100);
      html += '<div class="sidebar-section-title">Loyalty</div>';
      html +=
        '<div class="sidebar-stat-row">' +
        '<span class="sidebar-stat-label">-100</span>' +
        '<div class="sidebar-stat-bar"><div class="sidebar-stat-fill hud-bar-' +
        (loyaltyPct > 60 ? 'green' : loyaltyPct > 30 ? 'yellow' : 'red') +
        '" style="width:' +
        loyaltyPct +
        '%"></div></div>' +
        '<span class="sidebar-stat-value">+100</span>' +
        '</div>';
    }

    // Relationships
    if (member.relationships && Object.keys(member.relationships).length > 0) {
      html += '<div class="sidebar-section-title">Relationships</div>';
      var relKeys = Object.keys(member.relationships);
      for (var r = 0; r < relKeys.length; r++) {
        var relId = relKeys[r];
        var rel = member.relationships[relId];
        var relName = _findCrewName(allCrew, relId) || relId;
        html +=
          '<div class="sidebar-list-item">' +
          '<span>' +
          _esc(relName) +
          '</span>' +
          '<span class="sidebar-badge">' +
          _esc(rel.disposition || 'neutral') +
          '</span>' +
          '</div>';
      }
    }

    // Significant moments
    if (member.significantMoments && member.significantMoments.length > 0) {
      html += '<div class="sidebar-section-title">Significant Moments</div>';
      for (var m = 0; m < member.significantMoments.length; m++) {
        var moment = member.significantMoments[m];
        html +=
          '<div class="sidebar-timeline-entry">' +
          '<div class="sidebar-timeline-turn">Turn ' +
          (moment.turnNumber || '?') +
          '</div>' +
          _esc(moment.summary || '') +
          '</div>';
      }
    }

    // Footer
    if (member.joinedTurn) {
      html +=
        '<div style="margin-top:1rem;font-size:0.75rem;color:#546e7a">Joined on Turn ' +
        member.joinedTurn +
        '</div>';
    }

    container.innerHTML = html;

    // Back button handler
    var backBtn = document.getElementById('crew-detail-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        VO.renderCrewTab(container);
      });
    }
  }

  function _findCrewName(crew, crewId) {
    for (var i = 0; i < crew.length; i++) {
      if (crew[i].id === crewId) return crew[i].name;
    }
    return null;
  }
})();
