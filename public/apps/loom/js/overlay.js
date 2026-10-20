(function () {
  'use strict';

  // The light overlay on the map (planning/the-map-first-loom.md §4.2, L3;
  // L-725 / #596):
  //
  // - top left, where you are (and the time of day, once L-370 gives it),
  //   and while you peek at another level, which one and Back to you; under
  //   it, the character's strip (character.js; L-814), which on a phone runs
  //   under the menu bar;
  // - bottom centre, the turn bar: the turn, movement left and the action,
  //   Continue for a kept plan and End turn (moved here off the panel);
  // - bottom right, a minimap of the level showing, with the view on it;
  //   a click there moves the view.
  //
  // The level switcher and the zoom buttons sit bottom left (map.js owns
  // them). Every part of the overlay carries .loom-map-ui, so a press on it
  // is never taken for a press on the map.

  var Loom = window.Loom;
  var ui = Loom.ui;
  var html = ui.html;

  var MINIMAP = { width: 176, height: 120 };
  var LEVEL_NAMES = { world: 'the world map', town: 'the town', battle: 'the map here' };

  function useOverlayState() {
    return {
      map: ui.useStore(function (s) {
        return s.map;
      }),
      turn: ui.useStore(function (s) {
        return s.turn;
      }),
      ui: ui.useStore(function (s) {
        return s.ui;
      }),
    };
  }

  // Where the player is, from loomGetMap: the battle map, the place in town,
  // the town, or the world place.
  function whereYouAre(data, level) {
    if (!data) return '';
    var town = data.town;
    var townPlace =
      town &&
      town.here &&
      town.places.filter(function (p) {
        return p.id === town.here;
      })[0];
    if (level === 'battle' && data.battleMap) {
      var b = data.battleMap;
      var host = b.host && b.host.name !== b.name ? b.host.name : null;
      return [b.name, host, town && town.name].filter(Boolean).join(', ');
    }
    if (level === 'town' && town) {
      return (townPlace ? townPlace.name + ', ' : '') + town.name;
    }
    var here = (data.places || []).filter(function (p) {
      return p.id === data.here;
    })[0];
    return here ? here.name : '';
  }

  function Where() {
    var s = useOverlayState();
    var level = s.ui.level;
    var player = s.ui.playerLevel || level;
    var where = whereYouAre(s.map, player);
    if (!where) return null;
    var peeking = level !== player;
    var time = s.turn && s.turn.time ? s.turn.time : null;
    return html`<div class="loom-map-where loom-map-ui">
      ${time && html`<span class="loom-map-time">${time}</span>`}
      <span class="loom-map-here">${where}</span>
      ${peeking &&
      html`<span class="loom-map-peek">
        Looking at ${LEVEL_NAMES[level] || level}
        <button
          class="loom-map-back"
          type="button"
          onClick=${function () {
            Loom.map.setLevel(player);
          }}
        >
          Back to you
        </button>
      </span>`}
    </div>`;
  }

  function TurnBar() {
    var s = useOverlayState();
    var turn = s.turn;
    if (!turn) return null;
    var busy = s.ui.busy;
    var walkingTown =
      s.ui.playerLevel === 'town' && s.map && s.map.town && s.map.town.ground && s.map.town.walks;
    var movement =
      'movement ' +
      turn.movementLeft +
      '/' +
      turn.speed +
      (walkingTown ? ' (' + turn.movementLeft * 20 + ' m)' : '');
    var canContinue = Boolean(turn.plan) && turn.movementLeft > 0;
    // In a fight (L-821): its round, until L-828's turn-order bar.
    var fight = s.map && s.map.fight;
    return html`<div class="loom-map-turnbar loom-map-ui" role="group" aria-label="Turn">
      <span class="loom-map-turnbar-state">
        ${fight ? 'Round ' + fight.round + ' · ' : ''}Turn ${turn.n} · ${movement} ·
        ${turn.actionUsed ? 'acted' : 'action ready'}
      </span>
      ${canContinue &&
      html`<button
        class="loom-map-turnbar-btn"
        id="loom-overlay-continue"
        type="button"
        disabled=${busy}
        onClick=${function () {
          Loom.map.continuePlan();
        }}
      >
        Continue
      </button>`}
      <button
        class="loom-map-turnbar-btn is-primary"
        id="loom-overlay-end-turn"
        type="button"
        disabled=${busy}
        onClick=${function () {
          Loom.play.endTurn();
        }}
      >
        End turn
      </button>
    </div>`;
  }

  function Minimap() {
    return html`<canvas
      class="loom-map-minimap loom-map-ui"
      id="loom-map-minimap"
      aria-label="Minimap: click to move the view there"
      onClick=${function (event) {
        var at = toMapPoint(event);
        if (at) Loom.map.lookAt(at);
      }}
    ></canvas>`;
  }

  function Overlay() {
    var Strip = Loom.character && Loom.character.Strip; // L-814: health and the rest
    return html`<div class="loom-map-topleft"><${Where} />${Strip && html`<${Strip} />`}</div>
      <${TurnBar} /><${Minimap} />`;
  }

  // ── The minimap ───────────────────────────────────

  var last = null; // the minimap's last layout: { k, ox, oy }

  // How the level's rect sits in the minimap: its scale and offset.
  function layoutOf(info) {
    var r = info.rect;
    var k = Math.min((MINIMAP.width - 8) / r.width, (MINIMAP.height - 8) / r.height);
    return {
      k: k,
      ox: (MINIMAP.width - r.width * k) / 2 - r.x * k,
      oy: (MINIMAP.height - r.height * k) / 2 - r.y * k,
    };
  }

  function toMapPoint(event) {
    if (!last) return null;
    var box = event.currentTarget.getBoundingClientRect();
    var cx = ((event.clientX - box.left) / box.width) * MINIMAP.width;
    var cy = ((event.clientY - box.top) / box.height) * MINIMAP.height;
    return { x: (cx - last.ox) / last.k, y: (cy - last.oy) / last.k };
  }

  /** Redraws the minimap: the level, what is on it, and the view as a frame. */
  function drawMinimap() {
    var canvas = document.getElementById('loom-map-minimap');
    if (!canvas) return;
    var info = Loom.map.minimap();
    canvas.classList.toggle('hidden', !info);
    if (!info) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== MINIMAP.width * dpr) {
      canvas.width = MINIMAP.width * dpr;
      canvas.height = MINIMAP.height * dpr;
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MINIMAP.width, MINIMAP.height);
    var L = layoutOf(info);
    last = L;
    var r = info.rect;
    var X = function (x) {
      return L.ox + x * L.k;
    };
    var Y = function (y) {
      return L.oy + y * L.k;
    };
    ctx.fillStyle = r.fill;
    ctx.fillRect(X(r.x), Y(r.y), r.width * L.k, r.height * L.k);
    if (info.image) {
      try {
        ctx.drawImage(info.image, X(r.x), Y(r.y), r.width * L.k, r.height * L.k);
      } catch {
        // An image not ready to draw yet: the next redraw has it.
      }
    }
    info.points.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.colour;
      ctx.fill();
      if (p.ring) {
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), p.r + 2, 0, Math.PI * 2);
        ctx.strokeStyle = p.ring;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
    // The view: the part of the level the map shows now.
    var M = Loom.mapMath;
    var a = M.toMap(info.view, 0, 0);
    var b = M.toMap(info.view, info.size.width, info.size.height);
    ctx.strokeStyle = '#ffb74d';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(X(a.x), Y(a.y), (b.x - a.x) * L.k, (b.y - a.y) * L.k);
  }

  /** Builds the overlay in the map panel, once. */
  function mount(panel) {
    var host = document.createElement('div');
    host.className = 'loom-map-overlay-host';
    panel.appendChild(host);
    ui.render(html`<${Overlay} />`, host);
  }

  Loom.overlay = {
    mount: mount,
    drawMinimap: drawMinimap,
  };
})();
