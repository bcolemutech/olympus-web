(function () {
  'use strict';

  // The map in the play view: loads what loomGetMap returns for this save,
  // and shows its levels with a switch between those there are. Each level
  // keeps its own camera view, so switching keeps your place in each.
  //
  // - The world map is drawn by the map engine (engine.js, world.js; L-722 /
  //   #593), which also owns the camera and the input for every level.
  // - In a settlement with a town layout, the town (town.js; L-345 / #399)
  //   is drawn by the engine too (L-723 / #594).
  // - On a battle map the grid view (battle.js; L-354 / #403) is still drawn
  //   in SVG over the panel, until L-724 moves it to the engine.

  var Loom = window.Loom;
  var state = Loom.state;
  var M = Loom.mapMath;
  var ref = Loom.getRef;
  var cam = Loom.engine.camera; // cam.view: { scale, x, y }, of the level showing

  var map = {
    data: null, // loomGetMap's result
    mode: 'world', // 'world' | 'town' | 'battle'
    views: { world: null, town: null, battle: null }, // each layer's view while another shows
    townId: null, // the settlement whose town is loaded
    battleId: null, // the battle map loaded
    worldUsable: false, // the world has a map with positioned places
  };

  // ── Helpers ───────────────────────────────────────

  // The coordinate space of the layer showing.
  function bounds() {
    if (map.mode === 'battle') return Loom.battle.bounds();
    return map.mode === 'town' ? Loom.town.BOUNDS : map.data.map;
  }

  function isPhone() {
    return window.matchMedia('(max-width: 899px)').matches;
  }

  function panelSize() {
    var rect = ref('loom-map-panel').getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  // ── Availability and tabs ─────────────────────────

  // The map only exists for worlds with coordinates (Cartographer worlds).
  function setAvailable(available) {
    Loom.store.setUi({ hasMap: Boolean(available) });
    if (!available) ref('loom-map-layers').classList.add('hidden');
    ref('loom-view-play').classList.toggle('loom-play--map', available);
    ref('loom-root').classList.toggle('loom-root--wide', available);
    ref('loom-play-tabs').classList.toggle('hidden', !available);
    ref('loom-map-pane').classList.toggle('hidden', !available);
    if (!available) showTab('story');
  }

  function showTab(tab) {
    ref('loom-view-play').setAttribute('data-tab', tab);
    ['story', 'map'].forEach(function (name) {
      var button = ref('loom-tab-' + name);
      button.classList.toggle('is-active', name === tab);
      button.setAttribute('aria-selected', String(name === tab));
    });
    if (tab === 'map' && map.data) {
      // On a phone, bring the tabs to the top so the whole map is in view.
      if (isPhone()) {
        ref('loom-play-tabs').scrollIntoView({ block: 'start' });
      }
      // The panel had no size while hidden: frame it now it's visible.
      if (!cam.view) frame();
      render();
    }
  }

  // ── Layers: the world map, the town view, the grid view ─

  function available(mode) {
    if (mode === 'battle') return Boolean(Loom.battle.current());
    if (mode === 'town') return Boolean(Loom.town.current());
    return map.worldUsable;
  }

  function updateLayerButtons() {
    var town = Loom.town.current();
    var battle = Loom.battle.current();
    var layers = ['battle', 'town', 'world'].filter(available);
    ref('loom-map-layers').classList.toggle('hidden', layers.length < 2);
    if (town) ref('loom-layer-town').textContent = town.name;
    if (battle) {
      ref('loom-layer-battle').textContent = battle.host ? battle.host.name : battle.name;
    }
    // The menu bar's Map levels (L-721) lists the same layers.
    Loom.store.setUi({
      level: map.mode,
      levels: layers.map(function (mode) {
        return { mode: mode, label: ref('loom-layer-' + mode).textContent.trim() };
      }),
    });
    ['battle', 'town', 'world'].forEach(function (mode) {
      var button = ref('loom-layer-' + mode);
      button.classList.toggle('hidden', !available(mode));
      button.classList.toggle('is-active', map.mode === mode);
      button.setAttribute('aria-pressed', String(map.mode === mode));
    });
  }

  function setMode(mode) {
    if (!available(mode)) mode = available('town') ? 'town' : 'world';
    if (mode === map.mode) {
      updateLayerButtons();
      return;
    }
    cam.views[map.mode] = cam.view;
    map.mode = mode;
    cam.view = cam.views[mode];
    updateLayerButtons();
    if (!cam.view) frame();
    render();
  }

  // ── Loading ───────────────────────────────────────

  // Frames the discovered places around where the player stands, or the
  // whole town.
  function frame() {
    var size = panelSize();
    if (!size.width || !size.height) return;
    if (map.mode === 'battle') {
      cam.view = M.fit(Loom.battle.framePoints(), size, bounds());
      return;
    }
    if (map.mode === 'town') {
      cam.view = M.fit(Loom.town.framePoints(), size, bounds());
      return;
    }
    cam.view = Loom.world.frame(size);
  }

  /** Loads (or reloads, after a turn) this save's map. */
  function load() {
    if (!state.worldId || !state.saveId) return Promise.resolve();
    var saveId = state.saveId;
    return state.functions
      .httpsCallable('loomGetMap')({ worldId: state.worldId, saveId: saveId })
      .then(function (result) {
        if (saveId !== state.saveId) return; // the player moved on meanwhile
        var data = result.data;
        var usable = Boolean(
          data &&
          data.map &&
          data.places.some(function (p) {
            return typeof p.x === 'number';
          })
        );
        var townData = (data && data.town) || null;
        var battleData = (data && data.battleMap) || null;
        Loom.store.set({ map: data || null });
        Loom.play.showTurn((data && data.turn) || null);
        setAvailable(usable || Boolean(townData) || Boolean(battleData));
        if (!usable && !townData && !battleData) return;
        var firstLoad = !map.data;
        map.data = data;
        map.worldUsable = usable;
        Loom.world.setData(usable ? data : null);
        Loom.town.setData(townData, data.turn);
        Loom.battle.setData(battleData, data.turn);

        // Entering a battle map or a town shows it; leaving one goes back to
        // the layer above. Otherwise the layer the player chose stays.
        var townId = townData ? townData.locationId : null;
        var mapId = battleData ? battleData.id : null;
        var enteredTown = townId !== map.townId;
        var enteredMap = mapId !== map.battleId;
        map.townId = townId;
        map.battleId = mapId;
        if (enteredTown) cam.views.town = null;
        if (enteredMap) cam.views.battle = null;
        var mode;
        if (battleData && (enteredMap || map.mode === 'battle')) mode = 'battle';
        else if (townData && (enteredTown || map.mode !== 'world' || !usable)) mode = 'town';
        else if (battleData && !usable && !townData) mode = 'battle';
        else mode = usable ? 'world' : townData ? 'town' : 'battle';
        if (mode !== map.mode) {
          cam.views[map.mode] = cam.view;
          map.mode = mode;
          cam.view = cam.views[mode];
        } else if ((mode === 'town' && enteredTown) || (mode === 'battle' && enteredMap)) {
          cam.view = null;
        }
        updateLayerButtons();

        if (firstLoad || !cam.view) {
          frame();
        } else {
          var herePoint =
            mode === 'battle'
              ? Loom.battle.herePoint()
              : mode === 'town'
                ? Loom.town.herePoint()
                : Loom.world.herePoint();
          if (herePoint) cam.view = M.reveal(cam.view, herePoint, panelSize(), bounds());
        }
        render();
      })
      .catch(function (err) {
        console.error('Could not load the map:', err);
        setAvailable(false);
      });
  }

  /** Forgets the previous save's map, for a newly selected save. */
  function reset() {
    map.data = null;
    cam.view = null;
    map.mode = 'world';
    cam.views = { world: null, town: null, battle: null };
    map.townId = null;
    map.battleId = null;
    map.worldUsable = false;
    Loom.world.reset();
    Loom.engine.closeMenu();
    Loom.town.reset();
    Loom.battle.reset();
    ref('loom-map-overlay').innerHTML = '';
    ref('loom-map-info').innerHTML = '';
    Loom.store.set({ map: null, turn: null });
    Loom.store.setUi({ level: 'world', levels: [], selection: null });
    setAvailable(false);
  }

  // ── Drawing ───────────────────────────────────────

  function render() {
    if (!map.data || !cam.view) return;
    var size = panelSize();
    if (!size.width || !size.height) return;
    cam.view = M.clamp(cam.view, size, bounds());
    var v = cam.view;
    Loom.store.setUi({ selection: map.mode === 'world' ? Loom.world.selected() : null });

    var overlayEl = ref('loom-map-overlay');
    ref('loom-map-panel').classList.toggle('is-town', map.mode !== 'world');
    // Battle is still SVG over the panel; the engine's stage hides.
    if (map.mode === 'battle') Loom.engine.setLevel(null);
    if (map.mode === 'battle') {
      overlayEl.setAttribute('width', size.width);
      overlayEl.setAttribute('height', size.height);
      overlayEl.innerHTML = '';
      Loom.battle.draw(overlayEl, v);
      Loom.battle.renderInfo(ref('loom-map-info'), actCell);
      return;
    }
    // The world map and the town: drawn by the engine.
    overlayEl.innerHTML = '';
    Loom.engine.setLevel(map.mode);
    Loom.engine.draw();
    if (map.mode === 'town') Loom.town.renderInfo(ref('loom-map-info'));
    else Loom.world.renderInfo(ref('loom-map-info'));
  }

  // A step on a battle map, from the grid view's card.
  // A step stays on the map; an arrival it leads to is narrated, and play.js
  // shows the story then (showStory).
  function actCell(cell, label) {
    Loom.play.moveToCell(cell, label);
  }

  // ── Input, from the engine ────────────────────────

  // A tap on the map: the level showing works out what is there.
  function onTap(point) {
    if (!map.data || !cam.view) return;
    if (map.mode === 'battle') {
      Loom.battle.pick(point, cam.view);
      render();
      return;
    }
    if (map.mode === 'town') {
      Loom.town.tap(point, cam.view);
      return;
    }
    Loom.world.tap(point, cam.view);
  }

  function onHover(point) {
    if (!map.data || !cam.view) return;
    if (map.mode === 'world') Loom.world.hover(point, cam.view);
    else if (map.mode === 'town') Loom.town.hover(point, cam.view);
    else Loom.engine.panelCursor('');
  }

  // ── Wiring ────────────────────────────────────────

  function init() {
    Loom.engine.mount(ref('loom-map-panel'), {
      bounds: function () {
        return bounds();
      },
      onTap: onTap,
      onHover: onHover,
      onCamera: render,
    });

    ref('loom-map-zoom-in').addEventListener('click', function () {
      Loom.engine.zoomBy(1.5);
    });
    ref('loom-map-zoom-out').addEventListener('click', function () {
      Loom.engine.zoomBy(1 / 1.5);
    });
    ref('loom-map-home').addEventListener('click', function () {
      if (!map.data) return;
      if (map.mode === 'battle') Loom.battle.selectHere();
      else if (map.mode === 'town') Loom.town.selectHere();
      else Loom.world.selectHere();
      frame();
      render();
    });
    ref('loom-layer-battle').addEventListener('click', function () {
      setMode('battle');
    });
    ref('loom-layer-town').addEventListener('click', function () {
      setMode('town');
    });
    ref('loom-layer-world').addEventListener('click', function () {
      setMode('world');
    });
    ref('loom-tab-story').addEventListener('click', function () {
      showTab('story');
    });
    ref('loom-tab-map').addEventListener('click', function () {
      showTab('map');
    });
    window.addEventListener('resize', render);
    showTab('story');
  }

  // Redraws only the overlay, for the token's walk on a battle map (L-615):
  // the card stays as it is.
  function redrawOverlay() {
    if (map.mode !== 'battle' || !map.data || !cam.view) return;
    var overlayEl = ref('loom-map-overlay');
    overlayEl.innerHTML = '';
    Loom.battle.draw(overlayEl, cam.view);
  }

  // The map's area changed size (the shell's panel resized or collapsed, or
  // the map shown at last): frame it if it never had a size, and redraw.
  function resize() {
    if (map.data && !cam.view) frame();
    render();
  }

  Loom.map = {
    resize: resize,
    init: init,
    load: load,
    reset: reset,
    render: render,
    redrawOverlay: redrawOverlay,
    // Shows a layer: 'world', 'town' or 'battle' (the menu bar's Map levels).
    setLevel: setMode,
    // On a phone, switches to the story (after a narrated move from the map).
    showStory: function () {
      if (isPhone()) showTab('story');
    },
  };
})();
