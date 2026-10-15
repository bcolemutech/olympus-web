(function () {
  'use strict';

  // The Loom's map engine (planning/the-map-first-loom.md §4.3; L-722 / #593):
  // one PixiJS stage in the map panel, with a camera, the input that moves it,
  // a layer per level and a small menu for clicks.
  //
  // - The stage is WebGL, or canvas where WebGL isn't there (T2). It renders
  //   on demand: when the camera moves or a layer changes, not every frame.
  // - The camera is a map-math view { scale, x, y } (a map point m shows at
  //   m * scale + (x, y) in the panel), kept in bounds by map-math. Every
  //   level shares it (T3), each with its own bounds.
  // - Input (I1): drag to pan and wheel to zoom with a mouse; drag and pinch on
  //   touch; arrow keys pan. A tap (a press that hardly moved) goes to the
  //   level showing, which hit-tests it; a hover lets it show labels (A2).
  // - Layers: a level drawn by the engine registers { draw, hit } and gets
  //   its own container. A level not yet moved here (town, battle: L-723,
  //   L-724) is drawn by map.js in SVG over the panel, the stage hidden.
  // - Clicks open a small menu (I2) of what can be done there; every click,
  //   with no one-tap shortcuts (L-740, C7).

  var Loom = window.Loom;
  var M = Loom.mapMath;
  var ui = Loom.ui;
  var html = ui.html;

  var TAP_SLOP = 6; // px a pointer may move and still count as a tap
  var KEY_PAN = 80; // px an arrow key pans by
  var WHEEL_RATE = 0.0015;

  var TRANSITION_MS = 520; // the zoom between levels (L6)
  var AMBIENT_MS = 50; // a frame of the ambient touches: slow drifts need no more (K3)
  var EASE_MS = 380; // the camera easing after the player (K3)

  // Presses on the panel's own buttons, card, menu and overlay are theirs,
  // not the map's.
  var PANEL_UI =
    '.loom-map-controls, .loom-map-layers, .loom-map-info, .loom-map-menu, .loom-map-ui';

  var engine = {
    camera: { view: null },
    app: null, // the PixiJS Application, once ready
    renderer: null, // 'webgl' or 'canvas'
    panel: null,
    host: null,
    menuHost: null,
    hooks: null, // from map.js: bounds, size, onTap, onHover, onCamera
    layers: {}, // level → { container, draw, hit }
    level: null, // the engine level showing, or null
    pointers: {},
    gesture: null,
    pending: false,
    transition: null, // the zoom between levels running: see transition()
    ease: null, // the camera easing to a view: { from, to, t0, ms }
    following: true, // the camera follows the player until they move it (K3)
    ambient: null, // the ambient touches running: { last } (K3; L-727)
  };

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function now() {
    return window.performance ? window.performance.now() : Date.now();
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  // A view between two, at t (0–1): the scale goes geometrically, and the
  // map point `ref` slides straight across the screen between where each view
  // shows it, so a zoom about a point keeps that point still.
  function between(v0, v1, ref, t) {
    var scale = v0.scale * Math.pow(v1.scale / v0.scale, t);
    var p0 = M.toScreen(v0, ref.x, ref.y);
    var p1 = M.toScreen(v1, ref.x, ref.y);
    var x = p0.x + (p1.x - p0.x) * t;
    var y = p0.y + (p1.y - p0.y) * t;
    return { scale: scale, x: x - ref.x * scale, y: y - ref.y * scale };
  }

  // ── The stage ─────────────────────────────────────

  function size() {
    var rect = engine.panel.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  async function start() {
    var PIXI = window.PIXI;
    var app = new PIXI.Application();
    await app.init({
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      width: Math.max(1, size().width),
      height: Math.max(1, size().height),
      autoStart: false,
      // WebGL first, canvas without it (T2). WebGPU isn't asked for.
      preference: ['webgl', 'canvas'],
      // The engine reads pointers itself (below); Pixi's own events are off.
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    });
    app.stage.eventMode = 'none';
    app.canvas.classList.add('loom-map-canvas');
    engine.host.appendChild(app.canvas);
    engine.app = app;
    engine.renderer = app.renderer.name === 'canvas' ? 'canvas' : 'webgl';
    Object.keys(engine.layers).forEach(function (level) {
      app.stage.addChild(engine.layers[level].container);
    });
    showLevel(engine.level);
    requestDraw();
    return app;
  }

  /**
   * Registers a level drawn by the engine: { draw(container, view, size),
   * hit(point, view) }, and optionally ambient(container, seconds), its
   * ambient touches, which returns whether it has any to show. Its container
   * is shown only while it is the level.
   */
  function addLayer(level, layer) {
    var container = new window.PIXI.Container();
    container.visible = false;
    engine.layers[level] = Object.assign({ container: container }, layer);
    if (engine.app) engine.app.stage.addChild(container);
    return container;
  }

  function showLevel(level) {
    engine.level = engine.layers[level] ? level : null;
    Object.keys(engine.layers).forEach(function (name) {
      engine.layers[name].container.visible = name === engine.level;
    });
    engine.host.classList.toggle('hidden', !engine.level);
  }

  /** Shows a level drawn here (null for none). */
  function setLevel(level) {
    if (engine.transition) return; // it ends on its own level
    if (level === engine.level) return;
    closeMenu();
    showLevel(level);
    requestDraw();
  }

  // Draws the level showing, once per frame however often it is asked for.
  function requestDraw() {
    if (engine.pending) return;
    engine.pending = true;
    window.requestAnimationFrame(function () {
      engine.pending = false;
      draw();
    });
  }

  function draw() {
    var app = engine.app;
    if (!app) return;
    var s = size();
    if (!s.width || !s.height) return;
    if (
      app.renderer.width !== Math.round(s.width) ||
      app.renderer.height !== Math.round(s.height)
    ) {
      app.renderer.resize(s.width, s.height);
    }
    if (engine.transition) {
      drawTransition(s);
      app.render();
      return;
    }
    var layer = engine.layers[engine.level];
    if (!layer || !engine.camera.view) return;
    layer.draw(layer.container, engine.camera.view, s);
    app.render();
    engine.renderedAt = window.performance.now();
    startAmbient();
  }

  // ── Between levels (L6) ───────────────────────────

  // ── Ambient touches (K3; L-727) ───────────────────
  // Drifting fog and water shimmer, from the level showing: a slow loop that
  // runs only while that level has some to show, the page is visible and the
  // camera is still, and never with prefers-reduced-motion.

  function ambientWanted() {
    var layer = engine.layers[engine.level];
    return Boolean(
      engine.app &&
      layer &&
      layer.ambient &&
      engine.camera.view &&
      !engine.transition &&
      !document.hidden &&
      !reducedMotion()
    );
  }

  function startAmbient() {
    if (engine.ambient || !ambientWanted()) return;
    engine.ambient = { last: 0 };
    window.requestAnimationFrame(tickAmbient);
  }

  function tickAmbient(now) {
    if (!engine.ambient) return;
    if (!ambientWanted()) {
      engine.ambient = null;
      return;
    }
    if (now - engine.ambient.last >= AMBIENT_MS) {
      engine.ambient.last = now;
      var layer = engine.layers[engine.level];
      if (!layer.ambient(layer.container, now / 1000)) {
        engine.ambient = null; // nothing to show; the next draw looks again
        return;
      }
      // While the camera moves, its draws show the ambient touches too: no
      // second render on top of them.
      if (!engine.pending && now - (engine.renderedAt || 0) >= AMBIENT_MS) {
        engine.app.render();
        engine.renderedAt = now;
      }
    }
    window.requestAnimationFrame(tickAmbient);
  }

  // Both levels drawn as the zoom goes: the one left fading out as the
  // camera goes in (or out), the one arrived at fading in.
  function drawTransition(s) {
    var tr = engine.transition;
    var t = smooth(Math.min(1, (now() - tr.t0) / tr.ms));
    [
      [tr.from, 1 - t],
      [tr.to, t],
    ].forEach(function (pair) {
      var side = pair[0];
      var layer = engine.layers[side.level];
      if (!layer) return;
      layer.container.visible = true;
      layer.container.alpha = pair[1];
      layer.draw(layer.container, between(side.v0, side.v1, side.ref, t), s);
    });
  }

  // Ends the zoom running: both levels whole again, its own level shown.
  function finishTransition() {
    var tr = engine.transition;
    if (!tr) return;
    engine.transition = null;
    [tr.from.level, tr.to.level].forEach(function (level) {
      if (engine.layers[level]) engine.layers[level].container.alpha = 1;
    });
    showLevel(tr.to.level);
    engine.camera.view = tr.to.v1;
    tr.done();
  }

  function tickTransition(tr) {
    if (engine.transition !== tr) return; // ended, or another took its place
    if (now() - tr.t0 >= tr.ms) {
      finishTransition();
      return;
    }
    draw();
    window.requestAnimationFrame(function () {
      tickTransition(tr);
    });
  }

  /**
   * Zooms from one level into another, or back out (L6): `from` and `to`
   * are { level, v0, v1, ref }, each level's view at the start and the end
   * and the map point the zoom keeps on its way. Ends on `to`'s level with
   * its end view, then calls done(). Instant with reduced motion, or when a
   * level isn't drawn here.
   */
  function transition(from, to, done) {
    finishTransition(); // a zoom already running ends at once
    closeMenu();
    engine.ease = null;
    if (reducedMotion() || !engine.app || !engine.layers[from.level] || !engine.layers[to.level]) {
      showLevel(to.level);
      engine.camera.view = to.v1;
      done();
      return;
    }
    var tr = { from: from, to: to, t0: now(), ms: TRANSITION_MS, done: done };
    engine.transition = tr;
    engine.host.classList.remove('hidden');
    window.requestAnimationFrame(function () {
      tickTransition(tr);
    });
  }

  // ── Following the player (K3) ─────────────────────

  function tickEase() {
    var e = engine.ease;
    if (!e) return;
    var t = Math.min(1, (now() - e.t0) / e.ms);
    var ref = M.toMap(e.to, size().width / 2, size().height / 2);
    engine.camera.view = t >= 1 ? e.to : between(e.from, e.to, ref, smooth(t));
    if (t >= 1) engine.ease = null;
    engine.hooks.onCamera();
    if (engine.ease) window.requestAnimationFrame(tickEase);
  }

  /** Eases the camera to a view (or jumps, with reduced motion). */
  function easeTo(view) {
    var from = engine.camera.view;
    if (!from || reducedMotion()) {
      engine.camera.view = view;
      engine.hooks.onCamera();
      return;
    }
    engine.ease = { from: from, to: view, t0: now(), ms: EASE_MS };
    window.requestAnimationFrame(tickEase);
  }

  // The player moved the camera: it stops following them until their next move.
  function userMoved() {
    engine.following = false;
    engine.ease = null;
  }

  // ── The camera ────────────────────────────────────

  function setView(view) {
    engine.camera.view = view;
    closeMenu();
    engine.hooks.onCamera();
  }

  function panBy(dx, dy) {
    var view = engine.camera.view;
    if (!view) return;
    setView(M.pan(view, dx, dy, size(), engine.hooks.bounds()));
  }

  function zoomAt(factor, x, y) {
    var view = engine.camera.view;
    if (!view) return;
    setView(M.zoomAt(view, factor, x, y, size(), engine.hooks.bounds()));
  }

  /** Zooms about the panel's centre (the + and − buttons): the player's move. */
  function zoomBy(factor) {
    var s = size();
    userMoved();
    zoomAt(factor, s.width / 2, s.height / 2);
  }

  // ── Input ─────────────────────────────────────────

  function localPoint(event) {
    var rect = engine.panel.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pointerList() {
    return Object.keys(engine.pointers).map(function (id) {
      return engine.pointers[id];
    });
  }

  function onPointerDown(event) {
    if (engine.transition || !engine.camera.view || event.target.closest(PANEL_UI)) return;
    try {
      engine.panel.setPointerCapture(event.pointerId);
    } catch {
      // Some pointers can't be captured; dragging still works without it.
    }
    // A first finger begins a new gesture: anything still recorded is a
    // pointer whose end the browser never reported.
    if (event.isPrimary) engine.pointers = {};
    engine.pointers[event.pointerId] = localPoint(event);
    var points = pointerList();
    if (points.length === 1) {
      engine.gesture = { kind: 'drag', last: points[0], moved: 0 };
    } else if (points.length === 2) {
      // A pinch is worked out from where it started (M.pinch; #420).
      engine.gesture = { kind: 'pinch', startView: engine.camera.view, start: M.spreadOf(points) };
    }
  }

  function onPointerMove(event) {
    if (!engine.pointers[event.pointerId] || !engine.gesture) {
      // A hover, with no button down: the level may show a label (A2).
      if (event.pointerType === 'mouse' && engine.camera.view && !event.buttons) {
        var over = !event.target.closest(PANEL_UI);
        engine.hooks.onHover(over ? localPoint(event) : null);
      }
      return;
    }
    engine.pointers[event.pointerId] = localPoint(event);
    var points = pointerList();
    var gesture = engine.gesture;
    if (gesture.kind === 'drag' && points.length === 1) {
      var p = points[0];
      gesture.moved += Math.hypot(p.x - gesture.last.x, p.y - gesture.last.y);
      var dx = p.x - gesture.last.x;
      var dy = p.y - gesture.last.y;
      gesture.last = p;
      if (gesture.moved > TAP_SLOP) userMoved();
      panBy(dx, dy);
    } else if (gesture.kind === 'pinch' && points.length === 2) {
      userMoved();
      setView(
        M.pinch(gesture.startView, gesture.start, M.spreadOf(points), size(), engine.hooks.bounds())
      );
    }
  }

  function onPointerUp(event) {
    if (!engine.pointers[event.pointerId]) return;
    var point = localPoint(event);
    var gesture = engine.gesture;
    delete engine.pointers[event.pointerId];
    if (gesture && gesture.kind === 'drag' && gesture.moved <= TAP_SLOP) {
      closeMenu();
      engine.hooks.onTap(point);
    }
    // A finger lifted from a pinch leaves a plain drag, not a tap.
    var left = pointerList();
    engine.gesture =
      left.length === 1 ? { kind: 'drag', last: left[0], moved: TAP_SLOP + 1 } : null;
  }

  function onWheel(event) {
    if (engine.transition || !engine.camera.view || event.target.closest(PANEL_UI)) return;
    event.preventDefault();
    userMoved();
    var p = localPoint(event);
    zoomAt(Math.exp(-event.deltaY * WHEEL_RATE), p.x, p.y);
  }

  // Arrow keys pan the map (I1), unless typing or using a control that
  // takes them (the panel's resize handle, a menu).
  function onKey(event) {
    if (!document.body.classList.contains('loom-playing') || !engine.camera.view) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    var step = {
      ArrowLeft: [KEY_PAN, 0],
      ArrowRight: [-KEY_PAN, 0],
      ArrowUp: [0, KEY_PAN],
      ArrowDown: [0, -KEY_PAN],
    }[event.key];
    if (!step) return;
    var target = event.target;
    if (
      target &&
      target.closest &&
      target.closest(
        'input, textarea, select, [contenteditable], [role="separator"], [role="menu"]'
      )
    ) {
      return;
    }
    if (!engine.panel.getClientRects().length) return; // the map isn't showing
    event.preventDefault();
    userMoved();
    panBy(step[0], step[1]);
  }

  // ── The click menu (I2) ───────────────────────────

  function MapMenu(props) {
    return html`<div
      class="loom-map-menu"
      role="menu"
      aria-label=${props.title}
      style=${{ left: props.x + 'px', top: props.y + 'px' }}
    >
      <p class="loom-map-menu-title">${props.title}</p>
      ${props.subtitle && html`<p class="loom-map-menu-subtitle">${props.subtitle}</p>`}
      ${props.items.map(function (item, i) {
        return html`<button
          key=${i}
          class="loom-map-menu-item"
          type="button"
          role="menuitem"
          disabled=${item.disabled}
          title=${item.note || undefined}
          onClick=${function () {
            closeMenu();
            item.onSelect();
          }}
        >
          <span class="loom-map-menu-label">${item.label}</span>
          ${item.note && html`<span class="loom-map-menu-note">${item.note}</span>`}
        </button>`;
      })}
    </div>`;
  }

  /**
   * Opens the menu at a point in the panel: { title, subtitle, items: [{
   * label, onSelect, disabled, note }] }. It closes on a choice, a click
   * elsewhere, Escape, or when the camera moves.
   */
  function openMenu(point, menu) {
    var s = size();
    var x = Math.min(point.x + 10, s.width - 230);
    var y = Math.min(point.y + 10, s.height - (90 + 40 * menu.items.length));
    ui.render(
      html`<${MapMenu}
        x=${Math.max(8, x)}
        y=${Math.max(8, y)}
        title=${menu.title}
        subtitle=${menu.subtitle}
        items=${menu.items}
      />`,
      engine.menuHost
    );
    var first = engine.menuHost.querySelector('.loom-map-menu-item:not(:disabled)');
    if (first) first.focus({ preventScroll: true });
  }

  function closeMenu() {
    if (engine.menuHost && engine.menuHost.firstChild) ui.render(null, engine.menuHost);
  }

  function menuOpen() {
    return Boolean(engine.menuHost && engine.menuHost.firstChild);
  }

  // ── Wiring ────────────────────────────────────────

  /**
   * Builds the stage in the map panel and takes its input. `hooks`:
   * bounds() → the level's extent; onTap(point) and onHover(point|null) in
   * panel pixels; onCamera() after the camera moves.
   */
  function mount(panel, hooks) {
    engine.panel = panel;
    engine.hooks = hooks;
    engine.host = document.createElement('div');
    engine.host.className = 'loom-map-stage hidden';
    panel.insertBefore(engine.host, panel.firstChild);
    engine.menuHost = document.createElement('div');
    engine.menuHost.className = 'loom-map-menu-host';
    panel.appendChild(engine.menuHost);

    panel.addEventListener('pointerdown', onPointerDown);
    panel.addEventListener('pointermove', onPointerMove);
    panel.addEventListener('pointerup', onPointerUp);
    panel.addEventListener('pointercancel', onPointerUp);
    panel.addEventListener('pointerleave', function (event) {
      if (event.pointerType === 'mouse' && !event.buttons) engine.hooks.onHover(null);
    });
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
    // The ambient touches pick up again when the page shows, or motion is
    // allowed again (a draw starts them if the level has any).
    document.addEventListener('visibilitychange', requestDraw);
    if (window.matchMedia) {
      var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (motion.addEventListener) motion.addEventListener('change', requestDraw);
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menuOpen()) {
        closeMenu();
        return;
      }
      onKey(event);
    });
    document.addEventListener('pointerdown', function (event) {
      if (menuOpen() && !event.target.closest('.loom-map-menu')) closeMenu();
    });

    engine.ready = start().catch(function (err) {
      console.error('The map engine could not start:', err);
    });
    return engine.ready;
  }

  Loom.engine = {
    camera: engine.camera,
    mount: mount,
    addLayer: addLayer,
    setLevel: setLevel,
    draw: requestDraw,
    setView: setView,
    panBy: panBy,
    transition: transition,
    easeTo: easeTo,
    userMoved: userMoved,
    /** Follow the player again (their next move, K3). */
    follow: function () {
      engine.following = true;
    },
    following: function () {
      return engine.following;
    },
    transitioning: function () {
      return Boolean(engine.transition);
    },
    /** Whether the ambient touches are running (K3). */
    ambientRunning: function () {
      return Boolean(engine.ambient);
    },
    zoomBy: zoomBy,
    openMenu: openMenu,
    closeMenu: closeMenu,
    size: size,
    /** Sets the panel's cursor: 'pointer' over something to click, '' otherwise. */
    panelCursor: function (cursor) {
      if (engine.panel) engine.panel.style.cursor = cursor;
    },
    /** 'webgl' or 'canvas', once the stage is ready; null before. */
    renderer: function () {
      return engine.renderer;
    },
    ready: function () {
      return engine.ready;
    },
  };
})();
