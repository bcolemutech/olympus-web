(function () {
  'use strict';

  // The world map in the play view (planning/the-loom-layered-worlds.md §7;
  // L-332 / #394). It draws only what loomGetMap returns for this save (its
  // discovered places, the routes between them, which are open, and where it
  // stands) over the world's Azgaar image, with pan and zoom by mouse, wheel
  // and touch. Tapping a place shows a card; travelling sends a structured
  // move (Loom.play.travelTo), which the server adjudicates and gates like a
  // typed one.
  //
  // The image moves with a CSS transform; markers, routes and labels are
  // drawn in screen space on an SVG overlay, so they stay the same size at
  // every zoom. The maths lives in map-math.js.
  //
  // In a settlement with a town layout, the same panel shows the town view
  // instead (town.js; L-345 / #399), with a switch back to the world map.
  // Each layer keeps its own view, so switching keeps your place in both.

  var Loom = window.Loom;
  var state = Loom.state;
  var M = Loom.mapMath;
  var ref = Loom.getRef;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var TAP_SLOP = 6; // px a pointer may move and still count as a tap
  var HIT_RADIUS = 18; // px around a marker that selects it
  var LABEL_ALL_SCALE = 1.2; // above this zoom, every place is labelled

  var map = {
    data: null, // loomGetMap's result
    view: null, // { scale, x, y }, of the layer showing
    mode: 'world', // 'world' | 'town'
    views: { world: null, town: null }, // each layer's view while the other shows
    townId: null, // the settlement whose town is loaded
    worldUsable: false, // the world has a map with positioned places
    selected: null, // a world place id (the town keeps its own)
    imagePath: null,
    pointers: {}, // pointerId → { x, y }
    gesture: null,
  };

  // ── Helpers ───────────────────────────────────────

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      node.setAttribute(k, attrs[k]);
    });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // The coordinate space of the layer showing.
  function bounds() {
    return map.mode === 'town' ? Loom.town.BOUNDS : map.data.map;
  }

  function isPhone() {
    return window.matchMedia('(max-width: 899px)').matches;
  }

  function panelSize() {
    var rect = ref('loom-map-panel').getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function placeById(id) {
    return (
      map.data &&
      map.data.places.filter(function (p) {
        return p.id === id;
      })[0]
    );
  }

  function neighboursOfHere() {
    var here = map.data && map.data.here;
    var ids = {};
    (map.data ? map.data.links : []).forEach(function (l) {
      if (l.from === here) ids[l.to] = l.via || true;
      if (l.to === here) ids[l.from] = l.via || true;
    });
    return ids;
  }

  function positioned() {
    return map.data.places.filter(function (p) {
      return typeof p.x === 'number';
    });
  }

  // ── Availability and tabs ─────────────────────────

  // The map only exists for worlds with coordinates (Cartographer worlds).
  function setAvailable(available) {
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
      if (!map.view) frame();
      render();
    }
  }

  // ── Layers: the world map and the town view ───────

  function updateLayerButtons() {
    var current = Loom.town.current();
    var both = Boolean(current) && map.worldUsable;
    ref('loom-map-layers').classList.toggle('hidden', !both);
    if (current) ref('loom-layer-town').textContent = current.name;
    ['town', 'world'].forEach(function (mode) {
      var button = ref('loom-layer-' + mode);
      button.classList.toggle('is-active', map.mode === mode);
      button.setAttribute('aria-pressed', String(map.mode === mode));
    });
  }

  function setMode(mode) {
    if (mode === 'town' && !Loom.town.current()) mode = 'world';
    if (mode === map.mode) {
      updateLayerButtons();
      return;
    }
    map.views[map.mode] = map.view;
    map.mode = mode;
    map.view = map.views[mode];
    updateLayerButtons();
    if (!map.view) frame();
    render();
  }

  // ── Loading ───────────────────────────────────────

  function loadImage(data) {
    var image = data.map && data.map.image;
    var img = ref('loom-map-image');
    img.style.width = data.map.width + 'px';
    img.style.height = data.map.height + 'px';
    if (!image) {
      map.imagePath = null;
      img.classList.add('hidden');
      return;
    }
    if (image.path === map.imagePath) return;
    map.imagePath = image.path;
    firebase
      .storage()
      .ref(image.path)
      .getDownloadURL()
      .then(function (url) {
        img.src = url;
        img.classList.remove('hidden');
      })
      .catch(function (err) {
        console.error('Could not load the map image:', err);
        img.classList.add('hidden');
      });
  }

  // Frames the discovered places around where the player stands, or the
  // whole town.
  function frame() {
    var size = panelSize();
    if (!size.width || !size.height) return;
    if (map.mode === 'town') {
      map.view = M.fit(Loom.town.framePoints(), size, bounds());
      return;
    }
    var here = placeById(map.data.here);
    map.view = M.fit(positioned(), size, map.data.map, here && { x: here.x, y: here.y });
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
        setAvailable(usable || Boolean(townData));
        if (!usable && !townData) return;
        var firstLoad = !map.data;
        map.data = data;
        map.worldUsable = usable;
        if (usable) loadImage(data);
        Loom.town.setData(townData);

        // Entering a town shows it; leaving one goes back to the world map.
        var townId = townData ? townData.locationId : null;
        var entered = townId !== map.townId;
        map.townId = townId;
        if (entered) map.views.town = null;
        var mode = townData && (entered || !usable || map.mode === 'town') ? 'town' : 'world';
        if (mode !== map.mode) {
          map.views[map.mode] = map.view;
          map.mode = mode;
          map.view = map.views[mode];
        } else if (entered && mode === 'town') {
          map.view = null;
        }
        updateLayerButtons();

        if (firstLoad || !map.view) {
          frame();
        } else {
          var herePoint = mode === 'town' ? Loom.town.herePoint() : placeById(data.here);
          if (herePoint) map.view = M.reveal(map.view, herePoint, panelSize(), bounds());
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
    map.view = null;
    map.mode = 'world';
    map.views = { world: null, town: null };
    map.townId = null;
    map.worldUsable = false;
    map.selected = null;
    Loom.town.reset();
    ref('loom-map-overlay').innerHTML = '';
    ref('loom-map-info').innerHTML = '';
    setAvailable(false);
  }

  // ── Drawing ───────────────────────────────────────

  function render() {
    if (!map.data || !map.view) return;
    var size = panelSize();
    if (!size.width || !size.height) return;
    map.view = M.clamp(map.view, size, bounds());
    var v = map.view;

    var overlayEl = ref('loom-map-overlay');
    ref('loom-map-panel').classList.toggle('is-town', map.mode === 'town');
    if (map.mode === 'town') {
      overlayEl.setAttribute('width', size.width);
      overlayEl.setAttribute('height', size.height);
      overlayEl.innerHTML = '';
      Loom.town.draw(overlayEl, v);
      Loom.town.renderInfo(ref('loom-map-info'), act);
      return;
    }

    var img = ref('loom-map-image');
    img.style.transform = 'translate(' + v.x + 'px, ' + v.y + 'px) scale(' + v.scale + ')';

    var overlay = ref('loom-map-overlay');
    overlay.setAttribute('width', size.width);
    overlay.setAttribute('height', size.height);
    overlay.innerHTML = '';

    var byId = {};
    positioned().forEach(function (p) {
      byId[p.id] = p;
    });

    map.data.links.forEach(function (link) {
      var a = byId[link.from];
      var b = byId[link.to];
      if (!a || !b) return;
      var s = M.toScreen(v, a.x, a.y);
      var t = M.toScreen(v, b.x, b.y);
      var ends = { x1: s.x, y1: s.y, x2: t.x, y2: t.y };
      // A dark casing under each route keeps it readable over the map image.
      overlay.appendChild(svg('line', Object.assign({ class: 'loom-map-route-casing' }, ends)));
      overlay.appendChild(
        svg(
          'line',
          Object.assign({ class: 'loom-map-route loom-map-route--' + (link.via || 'road') }, ends)
        )
      );
    });

    var near = neighboursOfHere();
    positioned().forEach(function (p) {
      var s = M.toScreen(v, p.x, p.y);
      var here = p.id === map.data.here;
      var classes = ['loom-map-place', p.open ? 'is-open' : 'is-closed', 'kind-' + p.kind];
      if (here) classes.push('is-here');
      if (near[p.id]) classes.push('is-near');
      if (p.id === map.selected) classes.push('is-selected');
      var group = svg('g', {
        class: classes.join(' '),
        transform: 'translate(' + s.x + ',' + s.y + ')',
      });
      if (here) group.appendChild(svg('circle', { class: 'loom-map-ring', r: 11 }));
      var r = p.capital ? 7 : p.kind === 'settlement' ? 5 : 4;
      if (p.kind === 'poi') {
        group.appendChild(
          svg('rect', {
            class: 'loom-map-dot',
            x: -r,
            y: -r,
            width: r * 2,
            height: r * 2,
            transform: 'rotate(45)',
          })
        );
      } else {
        group.appendChild(svg('circle', { class: 'loom-map-dot', r: r }));
      }
      if (!p.open)
        group.appendChild(svg('text', { class: 'loom-map-lock', x: r + 2, y: -r - 1 }, '🔒'));
      if (here || near[p.id] || p.id === map.selected || v.scale > LABEL_ALL_SCALE) {
        group.appendChild(svg('text', { class: 'loom-map-label', x: 0, y: r + 14 }, p.name));
      }
      overlay.appendChild(group);
    });

    renderInfo(near);
  }

  // The card for the selected place, with the one action it allows.
  function renderInfo(near) {
    var info = ref('loom-map-info');
    info.innerHTML = '';
    var place = placeById(map.selected);
    if (!place) {
      info.appendChild(
        el('p', 'loom-map-hint', 'Tap a place to see it. Drag to pan, pinch or scroll to zoom.')
      );
      return;
    }
    info.appendChild(el('h3', 'loom-map-info-name', place.name));
    var facts = [];
    if (place.kind === 'settlement') {
      facts.push(place.capital ? 'Capital' : place.port ? 'Port' : 'Settlement');
      if (place.population)
        facts.push(Number(place.population).toLocaleString('en-US') + ' people');
    } else {
      facts.push('Point of interest');
    }
    var via = near[place.id];
    if (typeof via === 'string') facts.push('by ' + via);
    info.appendChild(el('p', 'loom-map-info-facts', facts.join(' · ')));

    if (place.id === map.data.here) {
      info.appendChild(el('p', 'loom-map-info-status', 'You are here.'));
    } else if (!place.open) {
      info.appendChild(
        el('p', 'loom-map-info-status is-closed', 'Not built yet. The way is closed.')
      );
    } else if (!via) {
      info.appendChild(el('p', 'loom-map-info-status', 'Not directly reachable from here.'));
    } else {
      var go = el('button', 'app-btn loom-map-travel', 'Travel here');
      go.type = 'button';
      go.disabled = state.turnInProgress;
      go.addEventListener('click', function () {
        act(place.id, place.name);
      });
      info.appendChild(go);
    }
  }

  // A move from a card: a place in town, or a world place.
  function act(id, name) {
    Loom.play.travelTo(id, name);
    // On a phone, the story is where the journey is told.
    if (isPhone()) showTab('story');
  }

  // ── Gestures ──────────────────────────────────────

  function localPoint(event) {
    var rect = ref('loom-map-panel').getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pointerList() {
    return Object.keys(map.pointers).map(function (id) {
      return map.pointers[id];
    });
  }

  // Presses on the panel's own buttons and card are theirs, not the map's:
  // captured as the start of a drag, they never reach the button (the click
  // goes to the panel), as in desktop Chrome with the Town / World switch.
  var PANEL_UI = '.loom-map-controls, .loom-map-layers, .loom-map-info';

  function onPointerDown(event) {
    if (!map.view || event.target.closest(PANEL_UI)) return;
    try {
      ref('loom-map-panel').setPointerCapture(event.pointerId);
    } catch {
      // Some pointers can't be captured; dragging still works without it.
    }
    // A first finger begins a new gesture: anything still recorded is a
    // pointer whose end the browser never reported.
    if (event.isPrimary) map.pointers = {};
    map.pointers[event.pointerId] = localPoint(event);
    var points = pointerList();
    if (points.length === 1) {
      map.gesture = { kind: 'drag', start: points[0], last: points[0], moved: 0 };
    } else if (points.length === 2) {
      // A pinch is worked out from where it started (M.pinch; #420).
      map.gesture = { kind: 'pinch', startView: map.view, start: M.spreadOf(points) };
    }
  }

  function onPointerMove(event) {
    if (!map.pointers[event.pointerId] || !map.gesture) return;
    map.pointers[event.pointerId] = localPoint(event);
    var size = panelSize();
    var points = pointerList();
    if (map.gesture.kind === 'drag' && points.length === 1) {
      var p = points[0];
      map.gesture.moved += Math.hypot(p.x - map.gesture.last.x, p.y - map.gesture.last.y);
      map.view = M.pan(
        map.view,
        p.x - map.gesture.last.x,
        p.y - map.gesture.last.y,
        size,
        bounds()
      );
      map.gesture.last = p;
      render();
    } else if (map.gesture.kind === 'pinch' && points.length === 2) {
      map.view = M.pinch(
        map.gesture.startView,
        map.gesture.start,
        M.spreadOf(points),
        size,
        bounds()
      );
      render();
    }
  }

  function onPointerUp(event) {
    if (!map.pointers[event.pointerId]) return;
    var point = localPoint(event);
    var gesture = map.gesture;
    delete map.pointers[event.pointerId];
    if (gesture && gesture.kind === 'drag' && gesture.moved <= TAP_SLOP) select(point);
    // A finger lifted from a pinch leaves a plain drag, not a tap.
    var left = pointerList();
    map.gesture =
      left.length === 1
        ? { kind: 'drag', start: left[0], last: left[0], moved: TAP_SLOP + 1 }
        : null;
  }

  // Selects the place nearest a tap, if any is close enough.
  function select(point) {
    if (map.mode === 'town') {
      Loom.town.pick(point, map.view);
      render();
      return;
    }
    var best = null;
    positioned().forEach(function (p) {
      var s = M.toScreen(map.view, p.x, p.y);
      var d = Math.hypot(s.x - point.x, s.y - point.y);
      if (d <= HIT_RADIUS && (!best || d < best.d)) best = { id: p.id, d: d };
    });
    map.selected = best ? best.id : null;
    render();
  }

  function onWheel(event) {
    if (!map.view) return;
    event.preventDefault();
    var p = localPoint(event);
    map.view = M.zoomAt(
      map.view,
      Math.exp(-event.deltaY * 0.0015),
      p.x,
      p.y,
      panelSize(),
      bounds()
    );
    render();
  }

  function zoomBy(factor) {
    if (!map.view) return;
    var size = panelSize();
    map.view = M.zoomAt(map.view, factor, size.width / 2, size.height / 2, size, bounds());
    render();
  }

  // ── Wiring ────────────────────────────────────────

  function init() {
    var panel = ref('loom-map-panel');
    panel.addEventListener('pointerdown', onPointerDown);
    panel.addEventListener('pointermove', onPointerMove);
    panel.addEventListener('pointerup', onPointerUp);
    panel.addEventListener('pointercancel', onPointerUp);
    panel.addEventListener('wheel', onWheel, { passive: false });
    // WebKit (Safari, and every browser on iPhone) has pinch gestures of its
    // own that can zoom the page along with the map, despite touch-action:
    // none (#420). Every touch on the map is the map's.
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
      panel.addEventListener(
        type,
        function (event) {
          event.preventDefault();
        },
        { passive: false }
      );
    });
    panel.addEventListener(
      'touchmove',
      function (event) {
        event.preventDefault();
      },
      { passive: false }
    );

    ref('loom-map-zoom-in').addEventListener('click', function () {
      zoomBy(1.5);
    });
    ref('loom-map-zoom-out').addEventListener('click', function () {
      zoomBy(1 / 1.5);
    });
    ref('loom-map-home').addEventListener('click', function () {
      if (!map.data) return;
      if (map.mode === 'town') Loom.town.selectHere();
      else map.selected = map.data.here;
      frame();
      render();
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

  Loom.map = { init: init, load: load, reset: reset, render: render };
})();
