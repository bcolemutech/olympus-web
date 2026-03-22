(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  var TABS = [
    { id: 'ship', label: 'Ship', enabled: true },
    { id: 'crew', label: 'Crew', enabled: true },
    { id: 'codex', label: 'Codex', enabled: true },
    { id: 'map', label: 'Map', enabled: false },
    { id: 'quests', label: 'Quests', enabled: false },
    { id: 'log', label: 'Log', enabled: false },
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

    // Mobile sheet toggle
    var toggle = document.getElementById('sidebar-sheet-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var panel = document.getElementById('sidebar-panel');
        if (panel) panel.classList.toggle('sidebar-sheet-open');
      });
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
   * Render the content pane for the current tab.
   * Clears the sidebar cache first so data is refreshed.
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

    container.innerHTML = html;

    // Load cargo items
    VO.loadItems(game.id).then(function (items) {
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
          '<div class="sidebar-card" data-item-id="' +
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

      // Click to expand item details
      cargoEl.querySelectorAll('.sidebar-card').forEach(function (card) {
        card.addEventListener('click', function () {
          var detail = card.querySelector('.sidebar-card-detail');
          if (detail) detail.classList.toggle('hidden');
        });
      });
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
