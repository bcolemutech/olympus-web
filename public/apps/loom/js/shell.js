(function () {
  'use strict';

  // The play view's frame (planning/the-map-first-loom.md §4.2; L-721 / #592):
  // a map that fills the window, the side panel on the right (L1, L2) and the
  // menu bar along the top (L8). Today's views are hosted in it unchanged
  // (T4): the map pane (map.js, town.js, battle.js) fills the map area, and
  // the story pane (play.js) is the panel's body, until their own stories
  // rebuild them.
  //
  // On a phone (under 900px wide) the panes stack under the Story / Map tabs
  // as before, below the menu bar, until L-728 brings the bottom sheet.

  var Loom = window.Loom;
  var ui = Loom.ui;
  var html = ui.html;
  var hooks = ui.hooks;
  var store = Loom.store;
  var Host = ui.Host;

  var MIN_WIDTH = 280; // px, the panel at its narrowest
  var MAX_WIDTH = 720; // px, at its widest
  var MAP_MIN = 320; // px of map always left beside it
  var KEY_STEP = 24; // px an arrow key resizes by

  var nodes = null; // the hosted views: { tabs, map, story }

  function clampWidth(width) {
    var max = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - MAP_MIN));
    return Math.round(Math.min(max, Math.max(MIN_WIDTH, width)));
  }

  function openPanel(focusInput) {
    store.setUi({ panelCollapsed: false });
    if (focusInput) {
      var input = Loom.getRef('loom-turn-input');
      if (input && !input.disabled) input.focus();
    }
  }

  function signOut() {
    firebase
      .auth()
      .signOut()
      .then(function () {
        window.location.href = '/';
      })
      .catch(function (err) {
        console.error('Sign-out failed:', err);
      });
  }

  // ── The menu bar (L8) ─────────────────────────────

  function MenuItem(props) {
    return html`<button
      class="loom-menu-item"
      type="button"
      role=${props.checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked=${props.checked === undefined ? undefined : String(props.checked)}
      onClick=${function () {
        store.setUi({ menu: null });
        props.onSelect();
      }}
    >
      ${props.label}
    </button>`;
  }

  function MenuButton(props) {
    var open = props.open;
    return html`<div class="loom-menubar-item">
      <button
        class=${'loom-menubar-btn' + (props.active ? ' is-active' : '')}
        id=${'loom-menu-' + props.id}
        type="button"
        disabled=${props.disabled}
        aria-haspopup=${props.items ? 'menu' : undefined}
        aria-expanded=${props.items ? String(open) : undefined}
        aria-pressed=${props.pressed === undefined ? undefined : String(props.pressed)}
        onClick=${function () {
          if (!props.items) {
            store.setUi({ menu: null });
            props.onClick();
            return;
          }
          store.setUi({ menu: open ? null : props.id });
        }}
      >
        ${props.label}
      </button>
      ${open &&
      props.items &&
      html`<div class="loom-menu" role="menu" aria-labelledby=${'loom-menu-' + props.id}>
        ${props.items}
      </div>`}
    </div>`;
  }

  function MenuBar() {
    var state = ui.useStore(function (s) {
      return s.ui;
    });
    var save = ui.useStore(function (s) {
      return s.save;
    });

    // An open menu closes on a click elsewhere or Escape.
    hooks.useEffect(
      function () {
        if (!state.menu) return undefined;
        function away(event) {
          if (!event.target.closest || !event.target.closest('.loom-menubar-item')) {
            store.setUi({ menu: null });
          }
        }
        function escape(event) {
          if (event.key === 'Escape') store.setUi({ menu: null });
        }
        document.addEventListener('pointerdown', away);
        document.addEventListener('keydown', escape);
        return function () {
          document.removeEventListener('pointerdown', away);
          document.removeEventListener('keydown', escape);
        };
      },
      [state.menu]
    );

    var mainItems = [
      html`<${MenuItem}
        key="saves"
        label="Saves"
        onSelect=${function () {
          var world = save && save.worldName;
          Loom.app.showSaves(Loom.state.worldId, world || '');
        }}
      />`,
      html`<${MenuItem} key="worlds" label="Worlds" onSelect=${Loom.app.showWorlds} />`,
      html`<${MenuItem} key="sign-out" label="Sign out" onSelect=${signOut} />`,
    ];
    var levelItems = state.levels.map(function (level) {
      return html`<${MenuItem}
        key=${level.mode}
        label=${level.label}
        checked=${level.mode === state.level}
        onSelect=${function () {
          Loom.map.setLevel(level.mode);
        }}
      />`;
    });
    var extra = state.menuButtons.map(function (button) {
      return html`<${MenuButton}
        key=${button.id}
        id=${button.id}
        label=${button.label}
        onClick=${button.onClick}
      />`;
    });

    return html`<nav class="loom-menubar" aria-label="The Loom">
      <${MenuButton} id="main" label="Main menu" open=${state.menu === 'main'} items=${mainItems} />
      <${MenuButton}
        id="levels"
        label="Map levels"
        open=${state.menu === 'levels'}
        disabled=${state.levels.length < 2}
        items=${levelItems}
      />
      <${MenuButton}
        id="journal"
        label="Journal"
        pressed=${!state.panelCollapsed}
        active=${!state.panelCollapsed}
        onClick=${function () {
          if (store.get().ui.panelCollapsed) openPanel(true);
          else store.setUi({ panelCollapsed: true });
        }}
      />
      ${extra}
      <span class="loom-menubar-title">${save ? save.worldName : ''}</span>
    </nav>`;
  }

  // ── The side panel (L1, L2) ───────────────────────

  function Panel() {
    var state = ui.useStore(function (s) {
      return s.ui;
    });
    var collapsed = state.panelCollapsed;

    function resizeFrom(event) {
      if (event.button !== 0) return;
      var handle = event.currentTarget;
      var right = handle.closest('.loom-shell-body').getBoundingClientRect().right;
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
      function move(e) {
        store.setUi({ panelWidth: clampWidth(right - e.clientX) });
      }
      function end() {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    }

    function resizeByKey(event) {
      var step = { ArrowLeft: KEY_STEP, ArrowRight: -KEY_STEP }[event.key];
      if (event.key === 'Home') step = MAX_WIDTH;
      if (event.key === 'End') step = -MAX_WIDTH;
      if (!step) return;
      event.preventDefault();
      store.setUi({ panelWidth: clampWidth(store.get().ui.panelWidth + step) });
    }

    return html`<aside
      class=${'loom-shell-panel' + (collapsed ? ' is-collapsed' : '')}
      aria-label="Journal"
    >
      ${!collapsed &&
      html`<div
        class="loom-panel-handle"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        aria-label="Resize the journal"
        aria-valuemin=${MIN_WIDTH}
        aria-valuemax=${MAX_WIDTH}
        aria-valuenow=${state.panelWidth}
        onPointerDown=${resizeFrom}
        onKeyDown=${resizeByKey}
      ></div>`}
      ${collapsed &&
      html`<button
        class="loom-panel-strip"
        type="button"
        aria-label="Open the journal"
        title=${state.latestLine || 'Open the journal'}
        onClick=${function () {
          openPanel(true);
        }}
      >
        <span class="loom-panel-strip-icon" aria-hidden="true">‹</span>
        <span class="loom-panel-strip-line">${state.latestLine}</span>
      </button>`}
      <div class="loom-panel-head">
        <h2 class="loom-panel-title">Journal</h2>
        <button
          class="loom-panel-collapse"
          type="button"
          aria-label="Collapse the journal"
          onClick=${function () {
            store.setUi({ panelCollapsed: true });
          }}
        >
          ›
        </button>
      </div>
      <${Host} class="loom-panel-body" node=${nodes.story} />
    </aside>`;
  }

  // ── The frame ─────────────────────────────────────

  function Shell() {
    var state = ui.useStore(function (s) {
      return s.ui;
    });
    var mapRef = hooks.useRef(null);

    // The map redraws whenever its area changes size: the panel resized or
    // collapsed, as well as the window.
    hooks.useEffect(function () {
      if (!window.ResizeObserver || !mapRef.current) return undefined;
      var frame = 0;
      var observer = new window.ResizeObserver(function () {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(function () {
          Loom.map.resize();
        });
      });
      observer.observe(mapRef.current);
      return function () {
        observer.disconnect();
      };
    }, []);

    var classes = ['loom-shell'];
    if (state.panelCollapsed) classes.push('is-collapsed');
    if (!state.hasMap) classes.push('no-map');
    return html`<div
      class=${classes.join(' ')}
      style=${{ '--loom-panel-width': clampWidth(state.panelWidth) + 'px' }}
    >
      <${MenuBar} />
      <div class="loom-shell-body">
        <${Host} class="loom-shell-tabs" node=${nodes.tabs} />
        <div class="loom-shell-map" ref=${mapRef}>
          <${Host} class="loom-shell-map-host" node=${nodes.map} />
        </div>
        <${Panel} />
      </div>
    </div>`;
  }

  /**
   * Builds the frame around today's views, once, before they are first used:
   * it takes their nodes out of the page and hosts them.
   */
  function mount() {
    if (nodes) return;
    nodes = {
      tabs: Loom.getRef('loom-play-tabs'),
      map: Loom.getRef('loom-map-pane'),
      story: Loom.getRef('loom-story-pane'),
    };
    var root = Loom.getRef('loom-play-shell');
    Object.keys(nodes).forEach(function (key) {
      nodes[key].remove();
    });
    ui.render(html`<${Shell} />`, root);
  }

  /** A new line of narration: the collapsed panel shows it, and opens (L2). */
  function newLine(text) {
    store.setUi({ latestLine: text || '' });
    if (store.get().ui.panelCollapsed) openPanel(false);
  }

  /**
   * Adds a button to the menu bar (L8), for the panels later epics bring
   * (Inventory, Character, People): { id, label, onClick }.
   */
  function addMenuButton(button) {
    var buttons = store.get().ui.menuButtons.filter(function (b) {
      return b.id !== button.id;
    });
    store.setUi({ menuButtons: buttons.concat([button]) });
  }

  Loom.shell = {
    mount: mount,
    newLine: newLine,
    addMenuButton: addMenuButton,
  };
})();
