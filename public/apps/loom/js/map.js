(function () {
  'use strict';

  // The map in the play view: loads what loomGetMap returns for this save,
  // and shows its levels. Each level keeps its own camera view, so switching
  // keeps your place in each.
  //
  // Maps go to any depth (L-904; planning/map-levels.md LV5, UI1, UI2): each
  // is drawn by the drawer for its kind, a region map by world.js, an area
  // map by town.js and a grid by battle.js. The trail of the maps above you
  // replaces the level switcher (bottom left): the region map you are on, the
  // town and the grid below it are its levels; a region map above is peeked
  // at, loaded from loomGetMap's `peek`; Back to you returns. Going from one
  // region map to another zooms through the place that opens the deeper one.
  //
  // - The world map is drawn by the map engine (engine.js, world.js; L-722 /
  //   #593), which also owns the camera and the input for every level.
  // - In a settlement with a town layout, the town (town.js; L-345 / #399;
  //   L-723 / #594), and on a battle map the grid (battle.js; L-354 / #403;
  //   L-724 / #595), are drawn by the engine too.

  var Loom = window.Loom;
  var state = Loom.state;
  var M = Loom.mapMath;
  var ref = Loom.getRef;
  var cam = Loom.engine.camera; // cam.view: { scale, x, y }, of the level showing

  var DEPTH = { world: 0, town: 1, battle: 2 }; // levels, outermost first
  var ZOOM = 6; // how far a level zooms in or out as it gives way to the next

  var map = {
    data: null, // loomGetMap's result
    mode: 'world', // 'world' | 'town' | 'battle': the level showing
    playerMode: 'world', // the level the player is on (another may be peeked at)
    views: { world: null, town: null, battle: null }, // each layer's view while another shows
    townId: null, // the settlement whose town is loaded
    battleId: null, // the battle map loaded
    worldUsable: false, // the world has a map with positioned places
    peek: null, // a region map above being peeked at: { mapId, data }
    trailOpen: false, // on a phone, the whole trail shown
  };

  // ── Helpers ───────────────────────────────────────

  // The coordinate space of a level (the one showing by default).
  function boundsOf(mode) {
    if (mode === 'battle') return Loom.battle.bounds();
    if (mode === 'town') return Loom.town.BOUNDS;
    // A region map above, while it is peeked at (L-904).
    return map.peek ? map.peek.data.map : map.data.map;
  }

  function bounds() {
    return boundsOf(map.mode);
  }

  function panelSize() {
    var rect = ref('loom-map-panel').getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  // ── Availability ──────────────────────────────────

  // The map only exists for worlds with coordinates (Cartographer worlds).
  function setAvailable(available) {
    Loom.store.setUi({ hasMap: Boolean(available) });
    if (!available) ref('loom-map-layers').classList.add('hidden');
    ref('loom-view-play').classList.toggle('loom-play--map', available);
    ref('loom-root').classList.toggle('loom-root--wide', available);
    ref('loom-map-pane').classList.toggle('hidden', !available);
  }

  // ── Layers: the world map, the town view, the grid view ─

  function available(mode) {
    if (mode === 'battle') return Boolean(Loom.battle.current());
    if (mode === 'town') return Boolean(Loom.town.current());
    return map.worldUsable;
  }

  // The trail (UI1): each map from the top down to the one you are on, as
  // { key, label, kind, mapId }: `key` is the level it shows ('world',
  // 'town', 'battle') or 'peek:<mapId>' for a region map above. A world from
  // before map levels, with no trail, has its levels as before.
  function trailItems() {
    var data = map.data || {};
    var trail = data.trail || [];
    var town = Loom.town.current();
    var battle = Loom.battle.current();
    var items = [];
    if (!trail.length) {
      if (available('world')) items.push({ key: 'world', label: 'World', kind: 'region' });
      if (town) items.push({ key: 'town', label: town.name, kind: 'area' });
      if (battle) {
        items.push({
          key: 'battle',
          label: battle.host ? battle.host.name : battle.name,
          kind: 'grid',
        });
      }
      return items;
    }
    var frameAt = trail.findIndex(function (t) {
      return t.mapId === data.mapId;
    });
    trail.forEach(function (t, i) {
      var item = { label: t.name, kind: t.kind, mapId: t.mapId };
      if (t.kind === 'region' && i < frameAt) item.key = 'peek:' + t.mapId;
      else if (t.kind === 'region') item.key = available('world') ? 'world' : null;
      else if (t.kind === 'area') item.key = town ? 'town' : null;
      else if (t.kind === 'grid') item.key = battle ? 'battle' : null;
      if (item.key && !items.some((x) => x.key === item.key)) items.push(item);
    });
    return items;
  }

  // The level showing, as a trail key.
  function showingKey() {
    return map.peek ? 'peek:' + map.peek.mapId : map.mode;
  }

  function updateLayerButtons() {
    var items = trailItems();
    var host = ref('loom-map-layers');
    host.classList.toggle('hidden', items.length < 2);
    host.classList.toggle('is-open', map.trailOpen);
    var showing = showingKey();
    host.innerHTML = '';
    // On a phone the trail shortens to the map you are on and its parent,
    // the rest behind a tap (…).
    var far = Math.max(0, items.length - 2);
    if (far) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'loom-map-layer loom-trail-more';
      more.textContent = '…';
      more.setAttribute('aria-label', 'Show the whole trail');
      more.setAttribute('aria-expanded', String(map.trailOpen));
      more.addEventListener('click', function () {
        map.trailOpen = !map.trailOpen;
        updateLayerButtons();
      });
      host.appendChild(more);
    }
    items.forEach(function (item, i) {
      if (i > 0) {
        var sep = document.createElement('span');
        sep.className = 'loom-trail-sep' + (i <= far ? ' loom-trail-far' : '');
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '›';
        host.appendChild(sep);
      }
      var button = document.createElement('button');
      button.type = 'button';
      button.className =
        'loom-map-layer' +
        (i < far ? ' loom-trail-far' : '') +
        (item.key === showing ? ' is-active' : '');
      button.id = 'loom-layer-' + item.key.replace(':', '-');
      button.dataset.key = item.key;
      button.dataset.kind = item.kind || '';
      button.textContent = item.label;
      button.setAttribute('aria-pressed', String(item.key === showing));
      button.addEventListener('click', function () {
        setMode(item.key);
      });
      host.appendChild(button);
    });
    // The map you are on in view, at the trail's end.
    host.scrollLeft = host.scrollWidth;
    var named = items.filter(function (x) {
      return x.key === showing;
    })[0];
    // The menu bar's Map levels (L-721) lists the same trail.
    Loom.store.setUi({
      level: showing,
      levelName: named ? named.label : null,
      playerLevel: map.playerMode,
      levels: items.map(function (item) {
        return { mode: item.key, label: item.label };
      }),
    });
  }

  // Shows another level (a peek, or back to your own): with the zoom between
  // them (L6). The player stays where they are. A key 'peek:<mapId>' peeks
  // at a region map above (L-904).
  function setMode(mode) {
    if (typeof mode === 'string' && mode.indexOf('peek:') === 0) {
      peekAt(mode.slice(5));
      return;
    }
    if (map.peek) {
      unpeek(function () {
        setMode(mode);
      });
      return;
    }
    if (!available(mode)) mode = available('town') ? 'town' : 'world';
    if (mode === map.mode) {
      updateLayerButtons();
      return;
    }
    goTo(mode);
  }

  // ── Region maps above (L-904) ─────────────────────

  // Zooms the world layer through a place, swapping what it draws on the
  // way: out (`deeper` false) leaves the map showing, small, about where
  // the map arrived at lies on it; in, the reverse. `swap()` puts the other
  // map's data in, `anchorOut` is the place on the shallower map.
  function zoomRegions(deeper, swap, anchorOn, done) {
    var size = panelSize();
    var centre = { x: size.width / 2, y: size.height / 2 };
    var finish = function () {
      render();
      if (done) done();
    };
    if (!cam.view || !size.width) {
      swap();
      map.views.world = null;
      frame();
      finish();
      return;
    }
    var half = 260;
    var first = deeper
      ? zoomedAbout(cam.view, anchorOn(cam.view) || centre, ZOOM)
      : zoomedAbout(cam.view, centre, 1 / ZOOM);
    Loom.engine.easeTo(first, {
      ms: half,
      done: function () {
        swap();
        var framed = Loom.world.frame(size);
        if (!framed) return finish();
        var a = deeper
          ? centre
          : M.toScreen(framed, (anchorOn(null) || {}).x, (anchorOn(null) || {}).y);
        var start = deeper
          ? zoomedAbout(framed, centre, 1 / ZOOM)
          : zoomedAbout(framed, isFinite(a.x) ? a : centre, ZOOM);
        cam.view = start;
        render();
        Loom.engine.easeTo(framed, { ms: half, done: finish });
      },
    });
  }

  // The point of a place on the world layer's map, by id.
  function pointOn(id) {
    return id ? Loom.world.pointOf(id) : null;
  }

  // The place the trail goes through on a map, by its id.
  function trailPlace(trail, mapId) {
    var t = (trail || []).filter(function (x) {
      return x.mapId === mapId;
    })[0];
    return t ? t.placeId : null;
  }

  /** Peeks at a region map above (UI1): loaded, then zoomed out to. */
  function peekAt(mapId) {
    if (!map.data) return;
    if (map.peek && map.peek.mapId === mapId) return;
    if (map.mode !== 'world' && !map.peek) {
      goTo('world', {
        then: function () {
          peekAt(mapId);
        },
      });
      return;
    }
    var saveId = state.saveId;
    state.functions
      .httpsCallable('loomGetMap')({ worldId: state.worldId, saveId: saveId, peek: mapId })
      .then(function (result) {
        if (saveId !== state.saveId || !map.data) return;
        var data = result.data;
        // The place on the peeked map that leads down to the one showing.
        var below = map.data.trail[map.data.trail.findIndex((t) => t.mapId === mapId) + 1];
        var through = trailPlace(map.data.trail, mapId);
        map.views.world = null;
        map.peek = { mapId: mapId, data: data };
        updateLayerButtons();
        zoomRegions(
          false,
          function () {
            Loom.world.setData(data);
          },
          function () {
            return pointOn(through) || (below && pointOn(below.placeId));
          }
        );
      })
      .catch(function (err) {
        console.error('Could not peek at that map:', err);
      });
  }

  /** Back from a peek above, to the region map the player is on. */
  function unpeek(then) {
    if (!map.peek) return then && then();
    var from = map.peek.mapId;
    var through = trailPlace(map.data.trail, from);
    map.peek = null;
    updateLayerButtons();
    zoomRegions(
      true,
      function () {
        Loom.world.setData(map.data);
      },
      function () {
        return pointOn(through);
      },
      then
    );
  }

  // ── Between levels (L6) ───────────────────────────

  // Where the deeper level lies in the one around it: the settlement (or
  // place) on the world map, the place on the town's. `worldId` names
  // another world place, for a town just left.
  function anchorIn(shallow, worldId) {
    if (shallow !== 'world') return Loom.town.herePoint();
    return (worldId && Loom.world.pointOf(worldId)) || Loom.world.herePoint();
  }

  // A view zoomed by `factor` about a screen point.
  function zoomedAbout(view, point, factor) {
    return {
      scale: view.scale * factor,
      x: point.x - (point.x - view.x) * factor,
      y: point.y - (point.y - view.y) * factor,
    };
  }

  /**
   * Moves the camera to another level, zooming between them: into a level
   * from the place it lies in on the level around it, or back out to it.
   * The level shown is `mode` from here on. `opts`: { worldId, then }: the
   * world place to zoom about, and what to do once there.
   */
  function goTo(mode, opts) {
    opts = opts || {};
    var after = function () {
      render();
      if (opts.then) opts.then();
    };
    var size = panelSize();
    var from = map.mode;
    var fromView = cam.view;
    map.views[from] = fromView;
    var toView = map.views[mode] || viewFor(mode, size);
    map.mode = mode;
    cam.view = toView;
    updateLayerButtons();
    if (!fromView || !toView || !size.width) {
      after();
      return;
    }
    var deeper = DEPTH[mode] > DEPTH[from];
    var shallow = deeper ? from : mode;
    var shallowView = deeper ? fromView : toView;
    var deepView = deeper ? toView : fromView;
    var anchor = anchorIn(shallow, opts.worldId);
    var centre = { x: size.width / 2, y: size.height / 2 };
    var a = anchor ? M.toScreen(shallowView, anchor.x, anchor.y) : centre;
    var shallowRef = anchor || M.toMap(shallowView, centre.x, centre.y);
    var deepRef = M.toMap(deepView, centre.x, centre.y);
    // The deep level, small, with its middle where it lies on the shallow one.
    var deepSmall = {
      scale: deepView.scale / ZOOM,
      x: a.x - deepRef.x * (deepView.scale / ZOOM),
      y: a.y - deepRef.y * (deepView.scale / ZOOM),
    };
    var shallowNear = zoomedAbout(shallowView, a, ZOOM);
    var shallowSide = { level: shallow, ref: shallowRef };
    var deepSide = { level: deeper ? mode : from, ref: deepRef };
    if (deeper) {
      shallowSide.v0 = shallowView;
      shallowSide.v1 = shallowNear;
      deepSide.v0 = deepSmall;
      deepSide.v1 = deepView;
    } else {
      deepSide.v0 = deepView;
      deepSide.v1 = deepSmall;
      shallowSide.v0 = shallowNear;
      shallowSide.v1 = shallowView;
    }
    Loom.engine.transition(deeper ? shallowSide : deepSide, deeper ? deepSide : shallowSide, after);
    render(); // the card and overlay for the level arrived at
  }

  // ── Loading ───────────────────────────────────────

  // A level framed: the discovered places around where the player stands,
  // the whole town, or the whole battle map.
  function viewFor(mode, size) {
    if (!size.width || !size.height) return null;
    if (mode === 'battle') return M.fit(Loom.battle.framePoints(), size, boundsOf(mode));
    if (mode === 'town') return M.fit(Loom.town.framePoints(), size, boundsOf(mode));
    return Loom.world.frame(size);
  }

  function frame() {
    var view = viewFor(map.mode, panelSize());
    if (view) cam.view = view;
  }

  // Where the player is on a level, in its own coordinates.
  function herePointIn(mode) {
    return mode === 'battle'
      ? Loom.battle.herePoint()
      : mode === 'town'
        ? Loom.town.herePoint()
        : Loom.world.herePoint();
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
        Loom.play.showTurn((data && data.turn) || null, data && data.time);
        setAvailable(usable || Boolean(townData) || Boolean(battleData));
        if (!usable && !townData && !battleData) return;
        var firstLoad = !map.data;
        var before = map.data;
        // After every turn the map returns to the player (L-725): a peek ends.
        var peeked = map.peek;
        map.peek = null;
        map.data = data;
        map.worldUsable = usable;
        Loom.world.setData(usable ? data : null);
        Loom.town.setData(townData, data.turn);
        Loom.battle.setData(battleData, data.turn);

        // Play is on the player's level: the battle map they stand on, else
        // their town, else the world. After every turn the map returns there
        // from any level peeked at (L-725), zooming into a level entered and
        // out of one left (L6).
        var townId = townData ? townData.locationId : null;
        var mapId = battleData ? battleData.id : null;
        var townLeft = map.townId;
        var enteredTown = townId !== map.townId;
        var enteredMap = mapId !== map.battleId;
        map.townId = townId;
        map.battleId = mapId;
        if (enteredTown) map.views.town = null;
        if (enteredMap) map.views.battle = null;
        var mode = battleData ? 'battle' : townData ? 'town' : usable ? 'world' : 'world';
        map.playerMode = mode;
        var size = panelSize();
        // Onto another region map (L-904): zoomed through the place that
        // opens the deeper one, in or out; a peek ended, back to the map.
        var regionChanged = !firstLoad && before && before.mapId !== data.mapId;
        if ((regionChanged || peeked) && mode === 'world' && size.width && cam.view) {
          var deeper = (data.trail || []).some(function (t) {
            return before && t.mapId === before.mapId;
          });
          var through = deeper
            ? trailPlace(data.trail, before.mapId)
            : trailPlace(before.trail, data.mapId);
          if (peeked || deeper || (before.trail || []).some((t) => t.mapId === data.mapId)) {
            Loom.world.setData(peeked && !regionChanged ? peeked.data : before);
            map.mode = 'world';
            map.views.world = null;
            updateLayerButtons();
            zoomRegions(
              peeked && !regionChanged ? true : deeper,
              function () {
                Loom.world.setData(data);
              },
              function () {
                return pointOn(
                  peeked && !regionChanged ? trailPlace(data.trail, peeked.mapId) : through
                );
              }
            );
            return;
          }
        }
        // Onto another region map with no zoom (a trip between parents): framed afresh.
        if (regionChanged) {
          map.views.world = null;
          if (mode === 'world' && map.mode === 'world' && size.width) frame();
        }
        if (firstLoad || !cam.view || !size.width) {
          map.mode = mode;
          cam.view = map.views[mode];
          updateLayerButtons();
          if (!cam.view) frame();
          render();
          return;
        }
        if (mode !== map.mode || (enteredTown && townLeft)) {
          // From one town to another: out to the world, then into the next.
          var leftTown = enteredTown && townLeft && map.worldUsable && map.mode !== 'world';
          if (leftTown && mode !== 'world') {
            goTo('world', {
              worldId: townLeft,
              then: function () {
                goTo(mode);
              },
            });
          } else if (mode !== map.mode) {
            goTo(mode, { worldId: leftTown ? townLeft : null });
          } else {
            frame();
            updateLayerButtons();
            render();
          }
          return;
        }
        if ((mode === 'town' && enteredTown) || (mode === 'battle' && enteredMap)) {
          frame();
        } else if (Loom.engine.following()) {
          // The camera eases after the player (K3), unless they moved it.
          var herePoint = herePointIn(mode);
          if (herePoint) Loom.engine.easeTo(M.reveal(cam.view, herePoint, size, bounds()));
        }
        updateLayerButtons();
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
    map.playerMode = 'world';
    map.views = { world: null, town: null, battle: null };
    map.townId = null;
    map.battleId = null;
    map.worldUsable = false;
    map.peek = null;
    map.trailOpen = false;
    Loom.world.reset();
    Loom.engine.closeMenu();
    Loom.town.reset();
    Loom.battle.reset();
    ref('loom-map-info').innerHTML = '';
    Loom.store.set({ map: null, turn: null, held: null });
    Loom.store.setUi({ level: 'world', levels: [], selection: null });
    setAvailable(false);
  }

  // ── Drawing ───────────────────────────────────────

  function render() {
    if (!map.data || !cam.view) return;
    var size = panelSize();
    if (!size.width || !size.height) return;
    cam.view = M.clamp(cam.view, size, bounds());
    Loom.store.setUi({ selection: map.mode === 'world' ? Loom.world.selected() : null });

    // Every level is drawn by the engine; the card under it is the level's.
    Loom.engine.setLevel(map.mode);
    Loom.engine.draw();
    if (Loom.overlay) Loom.overlay.drawMinimap();
    var info = ref('loom-map-info');
    if (map.mode === 'battle') Loom.battle.renderInfo(info);
    else if (map.mode === 'town') Loom.town.renderInfo(info);
    else Loom.world.renderInfo(info);
  }

  // ── Input, from the engine ────────────────────────

  // A tap on the map: the level showing works out what is there.
  function onTap(point) {
    if (!map.data || !cam.view) return;
    if (map.mode === 'battle') {
      Loom.battle.tap(point, cam.view);
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
    else Loom.battle.hover(point, cam.view);
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
    window.addEventListener('resize', render);
  }

  // The map's area changed size (the shell's panel resized or collapsed, or
  // the map shown at last): frame it if it never had a size, and redraw.
  function resize() {
    if (map.data && !cam.view) frame();
    render();
  }

  // Continue (L-613): walks the plan kept on the player's level.
  function continuePlan() {
    if (map.playerMode === 'battle') Loom.battle.continuePlan();
    else if (map.playerMode === 'town') Loom.town.continuePlan();
    else Loom.play.continuePlan();
  }

  // What the minimap shows: the level's extent, what is on it, and the view.
  function minimap() {
    if (!map.data || !cam.view) return null;
    var parts =
      map.mode === 'battle'
        ? Loom.battle.minimap()
        : map.mode === 'town'
          ? Loom.town.minimap()
          : Loom.world.minimap();
    return Object.assign({ bounds: bounds(), view: cam.view, size: panelSize() }, parts);
  }

  // Moves the view to centre on a point of the level showing (the minimap).
  function lookAt(point) {
    if (!cam.view) return;
    var size = panelSize();
    Loom.engine.userMoved();
    cam.view = {
      scale: cam.view.scale,
      x: size.width / 2 - point.x * cam.view.scale,
      y: size.height / 2 - point.y * cam.view.scale,
    };
    render();
  }

  Loom.map = {
    resize: resize,
    continuePlan: continuePlan,
    minimap: minimap,
    lookAt: lookAt,
    init: init,
    load: load,
    reset: reset,
    render: render,
    // Shows a layer: 'world', 'town' or 'battle', or 'peek:<mapId>' for a
    // region map above (the trail, the menu bar's Map levels).
    setLevel: setMode,
    peeking: function () {
      return map.peek ? map.peek.mapId : null;
    },
  };
})();
