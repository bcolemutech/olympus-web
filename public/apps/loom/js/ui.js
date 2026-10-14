(function () {
  'use strict';

  // The Loom's UI toolkit (planning/the-map-first-loom.md §4.1; L-721 / #592):
  // Preact and htm from the CDN, no build step (T1), and one small store.
  //
  // Components are plain functions returning html`…` templates. The store
  // holds the save, the map, the turn and the UI state; components read it
  // with useStore and re-render when what they read changes. The views not
  // yet rebuilt (map.js, town.js, battle.js, play.js) keep their own DOM, and
  // the shell hosts their nodes unchanged (Host); they write what the new
  // components need into the store.

  var Loom = window.Loom;
  var preact = window.preact;
  var hooks = window.preactHooks;
  var html = window.htm.bind(preact.h);

  // ── The store ─────────────────────────────────────

  var PANEL_KEY = 'loom.panel'; // the panel's width and collapsed, per browser
  var PANEL_WIDTH = 400;

  function readPanel() {
    try {
      var saved = JSON.parse(localStorage.getItem(PANEL_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        return {
          panelWidth: typeof saved.width === 'number' ? saved.width : PANEL_WIDTH,
          panelCollapsed: saved.collapsed === true,
        };
      }
    } catch {
      // Storage blocked or unreadable: the defaults.
    }
    return { panelWidth: PANEL_WIDTH, panelCollapsed: false };
  }

  function savePanel(ui) {
    try {
      localStorage.setItem(
        PANEL_KEY,
        JSON.stringify({ width: ui.panelWidth, collapsed: ui.panelCollapsed })
      );
    } catch {
      // Not remembered this time; nothing else depends on it.
    }
  }

  function createStore(initial) {
    var current = initial;
    var listeners = [];
    function notify() {
      listeners.slice().forEach(function (listener) {
        listener(current);
      });
    }
    // Merges `patch` into `part` (or the top level); listeners hear of it
    // only when a value changed.
    function merge(part, patch) {
      var from = part ? current[part] : current;
      var changed = Object.keys(patch).some(function (key) {
        return !Object.is(from[key], patch[key]);
      });
      if (!changed) return;
      var next = Object.assign({}, from, patch);
      current = part ? Object.assign({}, current, { [part]: next }) : next;
      notify();
    }
    return {
      get: function () {
        return current;
      },
      set: function (patch) {
        merge(null, patch);
      },
      setUi: function (patch) {
        merge('ui', patch);
        if ('panelWidth' in patch || 'panelCollapsed' in patch) savePanel(current.ui);
      },
      subscribe: function (listener) {
        listeners.push(listener);
        return function () {
          listeners = listeners.filter(function (l) {
            return l !== listener;
          });
        };
      },
    };
  }

  var store = createStore({
    save: null, // { id, worldId, worldName }
    map: null, // loomGetMap's result
    turn: null, // its `turn`
    ui: Object.assign(readPanel(), {
      hasMap: false, // the save has a map to show
      level: 'world', // 'world' | 'town' | 'battle'
      levels: [], // [{ mode, label }], the levels there are
      selection: null, // what is selected on the map
      latestLine: '', // the latest narration, for the collapsed panel
      menu: null, // the menu bar's open menu
      menuButtons: [], // buttons later epics add to the menu bar
    }),
  });

  /** What `select` picks from the store, re-rendering when it changes. */
  function useStore(select) {
    var pair = hooks.useState(function () {
      return select(store.get());
    });
    var setValue = pair[1];
    hooks.useEffect(function () {
      function check() {
        setValue(function () {
          return select(store.get());
        });
      }
      check();
      return store.subscribe(check);
    }, []);
    return pair[0];
  }

  // ── Hosting today's views ──────────────────────────

  /**
   * Hosts a DOM node the new components don't own (today's map, town and
   * battle views and the story pane), moved in once and never re-rendered,
   * so the code that draws it keeps working unchanged (T4).
   */
  function Host(props) {
    preact.Component.call(this, props);
  }
  Host.prototype = Object.create(preact.Component.prototype);
  Host.prototype.constructor = Host;
  Host.prototype.shouldComponentUpdate = function () {
    return false;
  };
  Host.prototype.render = function (props) {
    var node = props.node;
    return html`<div
      class=${props.class}
      ref=${function (el) {
        if (el && node && node.parentNode !== el) el.appendChild(node);
      }}
    ></div>`;
  };

  Loom.ui = {
    h: preact.h,
    html: html,
    render: preact.render,
    hooks: hooks,
    Host: Host,
    useStore: useStore,
    createStore: createStore,
  };
  Loom.store = store;
})();
