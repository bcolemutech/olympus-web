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
  // - top right on a battle map, the turn-order bar (L-828): who is here,
  //   or in a fight everyone in order, whose turn and the round, with the
  //   Subdue and Faster toggles; a red frame round the map in a fight;
  // - bottom right, a minimap of the level showing, with the view on it;
  //   a click there moves the view.
  //
  // The trail (was the level switcher, L-904) and the zoom buttons sit bottom left (map.js owns
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
      held: ui.useStore(function (s) {
        return s.held;
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
    // A region map above, by its name (L-904); a level, as before.
    var looking = (level.indexOf('peek:') === 0 && s.ui.levelName) || LEVEL_NAMES[level] || level;
    var time = s.turn && s.turn.time ? s.turn.time : null;
    return html`<div class="loom-map-where loom-map-ui">
      ${time && html`<span class="loom-map-time">${time}</span>`}
      <span class="loom-map-here">${where}</span>
      ${peeking &&
      html`<span class="loom-map-peek">
        Looking at ${looking}
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

  /**
   * The AP bar (L-837; action points UI1): what's left of the pool, any set
   * aside for a readied attack, and after End turn in a fight the AP kept
   * for reactions, shown as held, with what the others' turns left of it.
   * `town`, a town walk's metres.
   */
  function ApMeter(props) {
    var turn = props.turn;
    var pool = Math.max(1, turn.pool || 0);
    var left = Math.max(0, Math.min(pool, turn.ap || 0));
    var set = Math.max(0, Math.min(pool - left, turn.reserved || 0));
    var held = props.held;
    var heldText = held
      ? held.kept +
        ' AP held' +
        (held.left < held.kept ? ', ' + (held.kept - held.left) + ' spent reacting' : '')
      : null;
    var apText =
      left +
      ' / ' +
      turn.pool +
      ' AP' +
      (set ? ' · ' + set + ' readied' : '') +
      (props.town ? ' (' + props.town + ')' : '');
    var pct = function (n) {
      return (n / pool) * 100 + '%';
    };
    return html`<span class="loom-ap" id=${props.id}>
      <span
        class="loom-ap-bar"
        role="meter"
        aria-label="Action points"
        aria-valuemin="0"
        aria-valuemax=${pool}
        aria-valuenow=${left}
        aria-valuetext=${left + ' of ' + pool + ' AP left'}
      >
        <span class="loom-ap-fill" style=${'width:' + pct(left)}></span>
        ${set > 0 &&
        html`<span
          class="loom-ap-set"
          style=${'left:' + pct(left) + ';width:' + pct(set)}
          title=${set + ' AP set aside for a readied attack'}
        ></span>`}
      </span>
      <span class="loom-ap-text">${apText}</span>
      ${heldText &&
      html`<span class="loom-ap-held" title="Kept for reactions in the last round"
        >${heldText}</span
      >`}
    </span>`;
  }

  function TurnBar() {
    var s = useOverlayState();
    var turn = s.turn;
    if (!turn) return null;
    var busy = s.ui.busy;
    var walkingTown =
      s.ui.playerLevel === 'town' && s.map && s.map.town && s.map.town.ground && s.map.town.walks;
    // Action points left of the pool, as a bar (L-832, L-837); in town, a
    // point walks 20 m. With AP off (L-838): whether the turn's action is
    // used.
    var movement = turn.apOff
      ? (turn.acted ? 'acted' : 'action ready') +
        (walkingTown ? ' (' + turn.ap * 20 + ' m to walk)' : '')
      : null;
    var canContinue = Boolean(turn.plan) && (turn.apOff || turn.ap > 0);
    // In a fight (L-821): its round (the order bar has the rest, L-828).
    var fight = s.map && s.map.fight;
    var state =
      (fight ? 'Round ' + fight.round + ' · ' : '') +
      'Turn ' +
      turn.n +
      (movement ? ' · ' + movement : '');
    return html`<div class="loom-map-turnbar loom-map-ui" role="group" aria-label="Turn">
      <span class="loom-map-turnbar-state">${state}</span>
      ${!movement &&
      html`<${ApMeter}
        turn=${turn}
        held=${s.held}
        id="loom-overlay-ap"
        town=${walkingTown ? turn.ap * 20 + ' m' : null}
      />`}
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

  // A name's initials, for its chip in the order bar: "Grell" → "G",
  // "Bandit 2" → "B2".
  function initials(name) {
    var words = String(name || '?')
      .split(/\s+/)
      .filter(Boolean);
    return words
      .slice(0, 2)
      .map(function (w) {
        return /^\d+$/.test(w) ? w : w.charAt(0).toUpperCase();
      })
      .join('');
  }

  /**
   * The turn-order bar across the top of the map (L-828; combat UI1). In a
   * fight: everyone in it in order, whose turn it is, the round, with a
   * plain combat look (a red frame, "Round 2"); those out of it greyed. Out
   * of one, on a battle map: who is here in sight. Its toggles: Subdue
   * (attacks strike to knock out, when the system has it) and Faster (foes'
   * turns aren't played out).
   */
  function OrderBar() {
    var s = useOverlayState();
    var data = s.map;
    var fight = data && data.fight;
    var b = data && data.battleMap;
    if (!b || s.ui.playerLevel !== 'battle') return null;
    var save = Loom.store.get().save;
    var you = (save && save.characterName) || 'You';
    var chips = fight
      ? fight.order.map(function (c) {
          return {
            id: c.id,
            name: c.you ? you : c.name,
            side: c.you ? 'you' : c.side,
            now: fight.turn === c.id,
            out: c.out || null,
          };
        })
      : [{ id: 'player', name: you, side: 'you' }].concat(
          (b.people || [])
            .filter(function (p) {
              return p.x !== undefined;
            })
            .map(function (p) {
              return { id: p.id, name: p.name, side: p.side || 'neutral', out: p.down || null };
            })
        );
    var combat = data.combat || {};
    return html`<div
      class=${'loom-map-order loom-map-ui' + (fight ? ' is-combat' : '')}
      id="loom-order-bar"
      role="group"
      aria-label=${fight ? 'Turn order, round ' + fight.round : 'Who is here'}
    >
      <span class="loom-map-order-round">${fight ? 'Round ' + fight.round : 'Here'}</span>
      <ol class="loom-map-order-list">
        ${chips.map(function (c) {
          return html`<li
            key=${c.id}
            class=${'loom-map-order-chip is-' +
            c.side +
            (c.now ? ' is-now' : '') +
            (c.out ? ' is-out' : '')}
            title=${c.name + (c.out ? ' (' + c.out + ')' : c.now ? ' (their turn)' : '')}
            data-id=${c.id}
          >
            <span class="loom-map-order-token" aria-hidden="true">${initials(c.name)}</span>
            <span class="loom-map-order-name">${c.name}</span>
          </li>`;
        })}
      </ol>
      ${combat.subdue &&
      html`<label class="loom-map-order-toggle" title="Strike to knock out, not to kill">
        <input
          type="checkbox"
          id="loom-toggle-subdue"
          checked=${Boolean(s.ui.subdue)}
          onChange=${function (event) {
            Loom.store.setUi({ subdue: event.currentTarget.checked });
          }}
        />
        Subdue
      </label>`}
      <label class="loom-map-order-toggle" title="Don't play out everyone else's turns">
        <input
          type="checkbox"
          id="loom-toggle-faster"
          checked=${Boolean(s.ui.faster)}
          onChange=${function (event) {
            Loom.store.setUi({ faster: event.currentTarget.checked });
          }}
        />
        Faster
      </label>
    </div>`;
  }

  // The combat look (L-828; UI1): a red frame round the map in a fight.
  function CombatFrame() {
    var fight = ui.useStore(function (st) {
      return Boolean(st.map && st.map.fight) && st.ui.playerLevel === 'battle';
    });
    return fight ? html`<div class="loom-map-combat-frame" aria-hidden="true"></div>` : null;
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
    return html`<${CombatFrame} />
      <div class="loom-map-topleft"><${Where} />${Strip && html`<${Strip} />`}</div>
      <${OrderBar} /><${TurnBar} /><${Minimap} />`;
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
    ApMeter: ApMeter,
    drawMinimap: drawMinimap,
  };
})();
