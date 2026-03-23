(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  var TABS = [
    { id: 'ship', label: 'Ship', enabled: true },
    { id: 'crew', label: 'Crew', enabled: true },
    { id: 'codex', label: 'Codex', enabled: true },
    { id: 'map', label: 'Map', enabled: true },
    { id: 'quests', label: 'Quests', enabled: true },
    { id: 'log', label: 'Log', enabled: true },
  ];

  var STORAGE_KEY = 'vo_sidebar_tab';

  /**
   * Initialize the sidebar: render tabs, restore saved tab, render content.
   */
  VO.initSidebar = function () {
    var saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      void e; /* localStorage unavailable */
    }
    var validIds = TABS.filter(function (t) {
      return t.enabled;
    }).map(function (t) {
      return t.id;
    });
    VO.state.sidebarTab = validIds.indexOf(saved) !== -1 ? saved : 'ship';

    _renderTabs();
    VO.renderSidebarContent();

    // Mobile sheet toggle — use onclick to avoid duplicate listeners on re-init
    var toggle = document.getElementById('sidebar-sheet-toggle');
    if (toggle) {
      toggle.onclick = function () {
        var panel = document.getElementById('sidebar-panel');
        if (!panel) return;
        panel.classList.toggle('sidebar-sheet-open');
        toggle.setAttribute(
          'aria-expanded',
          panel.classList.contains('sidebar-sheet-open') ? 'true' : 'false'
        );
      };
    }
  };

  /**
   * Switch to a given tab.
   */
  VO.switchTab = function (tabId) {
    var tab = TABS.find(function (t) {
      return t.id === tabId;
    });
    if (!tab || !tab.enabled) return;

    VO.state.sidebarTab = tabId;
    try {
      localStorage.setItem(STORAGE_KEY, tabId);
    } catch (e) {
      void e; /* localStorage unavailable */
    }

    _highlightActiveTab();
    VO.renderSidebarContent();
  };

  /**
   * Render the content pane for the current tab by delegating to the
   * appropriate tab renderer, or showing a placeholder if unavailable.
   */
  VO.renderSidebarContent = function () {
    var container = document.getElementById('sidebar-content');
    if (!container) return;

    var tab = VO.state.sidebarTab || 'ship';

    if (tab === 'ship' && VO.renderShipTab) {
      VO.renderShipTab(container);
    } else if (tab === 'crew' && VO.renderCrewTab) {
      VO.renderCrewTab(container);
    } else if (tab === 'codex' && VO.renderCodexTab) {
      VO.renderCodexTab(container);
    } else if (tab === 'map' && VO.renderMapTab) {
      VO.renderMapTab(container);
    } else if (tab === 'quests' && VO.renderQuestsTab) {
      VO.renderQuestsTab(container);
    } else if (tab === 'log' && VO.renderLogTab) {
      VO.renderLogTab(container);
    } else {
      container.innerHTML = '<p class="sidebar-placeholder">Coming soon&hellip;</p>';
    }
  };

  /**
   * Invalidate sidebar cache (call after a turn completes).
   */
  VO.invalidateSidebarCache = function () {
    VO.state._sidebarCache = {};
  };

  // ── Ship tab ──────────────────────────────────────────────

  function _barColor(pct) {
    if (pct > 60) return 'hud-bar-green';
    if (pct > 30) return 'hud-bar-yellow';
    return 'hud-bar-red';
  }

  function _statBar(label, value, max) {
    var pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return (
      '<div class="sidebar-stat-row">' +
      '<span class="sidebar-stat-label">' +
      _esc(label) +
      '</span>' +
      '<div class="sidebar-stat-bar"><div class="sidebar-stat-fill ' +
      _barColor(pct) +
      '" style="width:' +
      pct +
      '%"></div></div>' +
      '<span class="sidebar-stat-value">' +
      pct +
      '%</span>' +
      '</div>'
    );
  }

  function _listItems(items, emptyMsg) {
    if (!items || items.length === 0) {
      return '<p class="sidebar-empty">' + _esc(emptyMsg) + '</p>';
    }
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var statusClass = item.status === 'operational' ? 'sidebar-badge-green' : 'sidebar-badge-red';
      html +=
        '<div class="sidebar-list-item">' +
        '<span>' +
        _esc(item.name) +
        '</span>' +
        '<span class="sidebar-badge ' +
        statusClass +
        '">' +
        _esc(item.status || 'unknown') +
        '</span>' +
        '</div>';
    }
    return html;
  }

  /**
   * Render the Ship tab content.
   */
  VO.renderShipTab = function (container) {
    var game = VO.state.currentGame;
    if (!game) {
      container.innerHTML = '<p class="sidebar-placeholder">No game loaded.</p>';
      return;
    }

    var ship = game.ship || {};
    var html = '';

    // Ship identity
    html += '<div class="sidebar-detail-name">' + _esc(ship.name || 'Unknown Ship') + '</div>';
    html +=
      '<span class="sidebar-badge" style="margin-bottom:0.75rem;display:inline-block">' +
      _esc(ship.class || 'Unknown Class') +
      '</span>';

    // Stats
    html += '<div class="sidebar-section-title">Systems</div>';
    html += _statBar('Hull', ship.hull || 0, ship.hullMax || 100);
    html += _statBar('Shields', ship.shields || 0, ship.shieldsMax || 100);
    html += _statBar('Fuel', ship.fuel || 0, 100);
    html += _statBar('Cargo', ship.cargo || 0, ship.cargoMax || 100);
    html +=
      '<div class="sidebar-stat-row">' +
      '<span class="sidebar-stat-label">Credits</span>' +
      '<span class="sidebar-stat-value">' +
      (ship.credits || 0) +
      '</span>' +
      '</div>';

    // Weapons
    html += '<div class="sidebar-section-title">Weapons</div>';
    html += _listItems(ship.weapons, 'No weapons installed');

    // Systems
    html += '<div class="sidebar-section-title">Ship Systems</div>';
    html += _listItems(ship.systems, 'No systems');

    // Features
    if (ship.features && ship.features.length > 0) {
      html += '<div class="sidebar-section-title">Features</div>';
      for (var i = 0; i < ship.features.length; i++) {
        html +=
          '<div class="sidebar-list-item">' +
          '<span>' +
          _esc(ship.features[i].name) +
          '</span>' +
          '</div>';
      }
    }

    // Cargo items (async load)
    html += '<div class="sidebar-section-title">Cargo Hold</div>';
    html += '<div id="sidebar-cargo-items"><p class="sidebar-empty">Loading&hellip;</p></div>';

    // Current location (async load)
    html += '<div class="sidebar-section-title">Current Location</div>';
    html += '<div id="sidebar-location-detail"><p class="sidebar-empty">Loading&hellip;</p></div>';

    container.innerHTML = html;

    // Load current location
    var locId = ship.currentLocationId;
    if (locId) {
      VO.getLocation(game.id, locId)
        .then(function (loc) {
          var locEl = document.getElementById('sidebar-location-detail');
          if (!locEl || !loc) {
            if (locEl) locEl.innerHTML = '<p class="sidebar-empty">Location data unavailable</p>';
            return;
          }
          _renderLocationDetail(locEl, loc);
        })
        .catch(function (err) {
          console.error('Failed to load current location:', err);
          var locEl = document.getElementById('sidebar-location-detail');
          if (locEl) locEl.innerHTML = '<p class="sidebar-empty">Failed to load location data</p>';
        });
    } else {
      var locPlaceholder = document.getElementById('sidebar-location-detail');
      if (locPlaceholder) {
        locPlaceholder.innerHTML = '<p class="sidebar-empty">No location data</p>';
      }
    }

    // Load cargo items
    VO.loadItems(game.id)
      .then(function (items) {
        var cargoEl = document.getElementById('sidebar-cargo-items');
        if (!cargoEl) return;

        if (!items || items.length === 0) {
          cargoEl.innerHTML = '<p class="sidebar-empty">Cargo hold is empty</p>';
          return;
        }

        var cargoHtml = '';
        for (var j = 0; j < items.length; j++) {
          var item = items[j];
          var condClass = _conditionBadgeClass(item.condition);
          var rarityClass = _rarityBadgeClass(item.rarity);
          cargoHtml +=
            '<div class="sidebar-card" role="button" tabindex="0" aria-expanded="false" data-item-id="' +
            _esc(item.id) +
            '">' +
            '<div class="sidebar-card-name">' +
            _esc(item.name) +
            (item.quantity > 1 ? ' x' + item.quantity : '') +
            '</div>' +
            '<div class="sidebar-card-meta">' +
            '<span class="sidebar-badge">' +
            _esc(item.type || 'misc') +
            '</span>' +
            '<span class="sidebar-badge ' +
            condClass +
            '">' +
            _esc(item.condition || 'good') +
            '</span>' +
            '<span class="sidebar-badge ' +
            rarityClass +
            '">' +
            _esc(item.rarity || 'common') +
            '</span>' +
            '</div>' +
            '<div class="sidebar-card-detail hidden" style="margin-top:0.4rem;font-size:0.8rem;color:#90a4ae">' +
            _esc(item.description || '') +
            '</div>' +
            '</div>';
        }
        cargoEl.innerHTML = cargoHtml;

        // Click or keyboard to expand item details
        cargoEl.querySelectorAll('.sidebar-card').forEach(function (card) {
          function toggleDetail() {
            var detail = card.querySelector('.sidebar-card-detail');
            if (!detail) return;
            var isHidden = detail.classList.toggle('hidden');
            card.setAttribute('aria-expanded', (!isHidden).toString());
          }
          card.addEventListener('click', toggleDetail);
          card.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleDetail();
            }
          });
        });
      })
      .catch(function (err) {
        console.error('Failed to load cargo items:', err);
        var cargoEl = document.getElementById('sidebar-cargo-items');
        if (cargoEl) cargoEl.innerHTML = '<p class="sidebar-empty">Unable to load cargo items.</p>';
      });
  };

  function _conditionBadgeClass(condition) {
    if (condition === 'pristine') return 'sidebar-badge-blue';
    if (condition === 'good') return 'sidebar-badge-green';
    if (condition === 'worn') return 'sidebar-badge-yellow';
    if (condition === 'damaged' || condition === 'broken') return 'sidebar-badge-red';
    return '';
  }

  function _rarityBadgeClass(rarity) {
    if (rarity === 'unique') return 'sidebar-badge-orange';
    if (rarity === 'rare') return 'sidebar-badge-purple';
    if (rarity === 'uncommon') return 'sidebar-badge-blue';
    return '';
  }

  // ── Location detail ───────────────────────────────────────

  var DANGER_BADGES = {
    safe: 'sidebar-badge-green',
    cautious: 'sidebar-badge-yellow',
    dangerous: 'sidebar-badge-orange',
    hostile: 'sidebar-badge-red',
  };

  function _renderLocationDetail(container, loc) {
    var html = '';

    // Name + type + danger
    html +=
      '<div style="margin-bottom:0.5rem">' +
      '<span style="font-weight:700;color:#e0e0e0">' +
      _esc(loc.name) +
      '</span> ' +
      '<span class="sidebar-badge">' +
      _esc(loc.type || 'unknown') +
      '</span>';
    if (loc.dangerLevel) {
      var dangerBadge = DANGER_BADGES[loc.dangerLevel] || '';
      html +=
        ' <span class="sidebar-badge ' + dangerBadge + '">' + _esc(loc.dangerLevel) + '</span>';
    }
    html += '</div>';

    // Description
    if (loc.description) {
      html +=
        '<div style="font-size:0.82rem;color:#90a4ae;line-height:1.5;margin-bottom:0.5rem">' +
        _esc(loc.description) +
        '</div>';
    }

    // Environment
    if (loc.environment) {
      var env = loc.environment;
      var envParts = [];
      if (env.gravity) envParts.push('Gravity: ' + env.gravity);
      if (env.atmosphere) envParts.push('Atmo: ' + env.atmosphere);
      if (env.temperature) envParts.push('Temp: ' + env.temperature);
      if (envParts.length > 0) {
        html += '<div style="margin-bottom:0.5rem">';
        for (var e = 0; e < envParts.length; e++) {
          html += '<span class="sidebar-tag">' + _esc(envParts[e]) + '</span>';
        }
        html += '</div>';
      }
      if (env.hazards && env.hazards.length > 0) {
        html += '<div style="margin-bottom:0.5rem">';
        for (var h = 0; h < env.hazards.length; h++) {
          html +=
            '<span class="sidebar-tag" style="color:#ef5350">' + _esc(env.hazards[h]) + '</span>';
        }
        html += '</div>';
      }
    }

    // Services
    if (loc.services && loc.services.length > 0) {
      html +=
        '<div style="font-size:0.72rem;font-weight:700;color:#90a4ae;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.3rem">Services</div>';
      html += '<div style="margin-bottom:0.5rem">';
      for (var s = 0; s < loc.services.length; s++) {
        html +=
          '<span class="sidebar-tag" style="color:#81c784">' + _esc(loc.services[s]) + '</span>';
      }
      html += '</div>';
    }

    // Points of interest
    if (loc.pointsOfInterest && loc.pointsOfInterest.length > 0) {
      html +=
        '<div style="font-size:0.72rem;font-weight:700;color:#90a4ae;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.3rem">Points of Interest</div>';
      for (var p = 0; p < loc.pointsOfInterest.length; p++) {
        var poi = loc.pointsOfInterest[p];
        html +=
          '<div class="sidebar-list-item">' +
          '<span>' +
          _esc(poi.name) +
          '</span>' +
          (poi.type ? '<span class="sidebar-badge">' + _esc(poi.type) + '</span>' : '') +
          '</div>';
      }
    }

    // Significant events
    if (loc.significantEvents && loc.significantEvents.length > 0) {
      html +=
        '<div style="font-size:0.72rem;font-weight:700;color:#90a4ae;text-transform:uppercase;letter-spacing:0.06em;margin:0.5rem 0 0.3rem">Events</div>';
      for (var ev = 0; ev < loc.significantEvents.length; ev++) {
        var event = loc.significantEvents[ev];
        html +=
          '<div class="sidebar-timeline-entry">' +
          '<div class="sidebar-timeline-turn">Turn ' +
          (Number.isFinite(Number(event.turnNumber)) ? Number(event.turnNumber) : '?') +
          '</div>' +
          _esc(event.summary || '') +
          '</div>';
      }
    }

    container.innerHTML = html;
  }

  /** Escape HTML to prevent XSS. */
  function _esc(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  // ── Internal helpers ──────────────────────────────────────

  function _renderTabs() {
    var tabBar = document.getElementById('sidebar-tabs');
    if (!tabBar) return;

    tabBar.innerHTML = '';
    TABS.forEach(function (tab) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sidebar-tab';
      btn.textContent = tab.label;
      btn.dataset.tab = tab.id;
      if (!tab.enabled) {
        btn.disabled = true;
        btn.classList.add('sidebar-tab-disabled');
      }
      btn.addEventListener('click', function () {
        VO.switchTab(tab.id);
      });
      tabBar.appendChild(btn);
    });
    _highlightActiveTab();
  }

  function _highlightActiveTab() {
    var tabBar = document.getElementById('sidebar-tabs');
    if (!tabBar) return;
    var buttons = tabBar.querySelectorAll('.sidebar-tab');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (btn.dataset.tab === VO.state.sidebarTab) {
        btn.classList.add('sidebar-tab-active');
      } else {
        btn.classList.remove('sidebar-tab-active');
      }
    }
  }
})();
