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
