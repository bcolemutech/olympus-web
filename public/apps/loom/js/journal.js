(function () {
  'use strict';

  // The side panel's content (planning/the-map-first-loom.md §4.2, §4.4;
  // L-726 / #597). From top to bottom:
  //
  // - the arrival banner (A5): the place's art when the player arrives
  //   somewhere that has some;
  // - the narration, each turn's action, roll card (L4) and text. A turn
  //   arrives whole from loomPlayTurn, and the newest is revealed at reading
  //   speed (K3); a click on it, Space or Escape shows the rest at once. A
  //   live region holds the whole turn's text for screen readers;
  // - the suggested actions, numbered for the keys 1–9;
  // - the input box, always there: Enter sends, Shift+Enter is a new line.
  //
  // The keyboard (I1): Enter goes to the box, E ends the turn, C continues a
  // kept plan, 1–9 take a suggestion. None of them fire while typing. (The
  // arrows pan the map: engine.js.)
  //
  // play.js writes what to show into the store's `journal`; this file draws it.

  var Loom = window.Loom;
  var ui = Loom.ui;
  var html = ui.html;
  var hooks = ui.hooks;
  var store = Loom.store;

  var CHARS_PER_SECOND = 40; // reading speed, a little quick for a game
  var LONGEST_REVEAL = 10000; // ms: a long turn is revealed faster, in this long
  var TICK = 50; // ms between steps of the reveal
  var ROLL_READ = 2500; // ms a roll card stays open once its turn is read

  var nextId = 1;
  var finishers = []; // what shows the rest of a turn being revealed

  function reducedMotion() {
    return Boolean(
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function journal() {
    return store.get().journal;
  }

  function setJournal(patch) {
    store.set({ journal: Object.assign({}, journal(), patch) });
  }

  /** Shows the rest of the turn being revealed, at once. True if there was one. */
  function finishReveal() {
    var running = finishers.slice();
    running.forEach(function (finish) {
      finish();
    });
    return running.length > 0;
  }

  // ── What a roll says ──────────────────────────────

  function rollLine(roll) {
    return (
      'd' +
      roll.die +
      ' rolled ' +
      roll.value +
      ' against ' +
      roll.against +
      ' (' +
      roll.difficulty +
      '): ' +
      (roll.success ? 'pass' : 'fail')
    );
  }

  function RollCard(props) {
    var roll = props.roll;
    var pair = hooks.useState(true);
    var open = pair[0];
    var setOpen = pair[1];
    var touched = hooks.useRef(false);

    // Collapsed to one line once read: a little after its turn is shown.
    hooks.useEffect(
      function () {
        if (!props.read || touched.current) return undefined;
        var timer = window.setTimeout(function () {
          setOpen(false);
        }, ROLL_READ);
        return function () {
          window.clearTimeout(timer);
        };
      },
      [props.read]
    );

    var verdict = roll.success ? 'Pass' : 'Fail';
    return html`<button
      class=${'loom-roll' + (roll.success ? ' is-pass' : ' is-fail') + (open ? ' is-open' : '')}
      type="button"
      aria-expanded=${String(open)}
      aria-label=${rollLine(roll)}
      onClick=${function (event) {
        event.stopPropagation();
        touched.current = true;
        setOpen(!open);
      }}
    >
      ${open
        ? html`<span class="loom-roll-die" aria-hidden="true">${roll.value}</span>
            <span class="loom-roll-body" aria-hidden="true">
              <span class="loom-roll-what">d${roll.die} against ${roll.against}</span>
              <span class="loom-roll-need">needs ${roll.difficulty} or more</span>
            </span>
            <span class="loom-roll-verdict" aria-hidden="true">${verdict}</span>`
        : html`<span class="loom-roll-line" aria-hidden="true">
            d${roll.die} ${roll.value} vs ${roll.difficulty} · ${verdict}
          </span>`}
    </button>`;
  }

  // ── The narration ─────────────────────────────────

  // Where the reveal may stop: the end of the word at or after `n`.
  function wordEnd(text, n) {
    if (n >= text.length) return text.length;
    var space = text.indexOf(' ', n);
    return space === -1 ? text.length : space;
  }

  function Narration(props) {
    var text = props.text || '';
    var pair = hooks.useState(props.reveal && !reducedMotion() ? 0 : text.length);
    var shown = pair[0];
    var setShown = pair[1];
    var done = shown >= text.length;

    hooks.useEffect(function () {
      if (shown >= text.length) {
        props.onDone();
        return undefined;
      }
      var rate = Math.max(CHARS_PER_SECOND, (text.length * 1000) / LONGEST_REVEAL);
      var at = 0;
      var timer = window.setInterval(function () {
        at += (rate * TICK) / 1000;
        var next = wordEnd(text, Math.ceil(at));
        setShown(next);
        if (next >= text.length) stop();
      }, TICK);
      function finish() {
        stop();
        setShown(text.length);
      }
      function stop() {
        window.clearInterval(timer);
        finishers = finishers.filter(function (f) {
          return f !== finish;
        });
      }
      finishers.push(finish);
      return stop;
    }, []);

    hooks.useEffect(
      function () {
        if (done) props.onDone();
      },
      [done]
    );

    // The unshown rest keeps its room, so the panel doesn't jump as it shows.
    return html`<p
      class=${'loom-log-narration' + (done ? '' : ' is-revealing')}
      aria-hidden=${done ? undefined : 'true'}
      data-shown=${shown}
      onClick=${done ? undefined : finishReveal}
    >
      ${text.slice(0, shown)}${!done &&
      html`<span class="loom-log-unshown">${text.slice(shown)}</span>`}
    </p>`;
  }

  function Entry(props) {
    var entry = props.entry;
    var pair = hooks.useState(!props.latest);
    var read = pair[0];
    var setRead = pair[1];
    return html`<div class="loom-log-entry">
      ${entry.action && html`<p class="loom-log-action">${'> ' + entry.action}</p>`}
      ${entry.roll && html`<${RollCard} roll=${entry.roll} read=${read || !props.latest} />`}
      <${Narration}
        text=${entry.text}
        reveal=${entry.reveal}
        onDone=${function () {
          setRead(true);
        }}
      />
    </div>`;
  }

  // ── The arrival banner (A5) ───────────────────────

  function Banner(props) {
    var banner = props.banner;
    var pair = hooks.useState(null);
    var src = pair[0];
    var setSrc = pair[1];
    var key = Loom.artKey(banner.image);

    hooks.useEffect(
      function () {
        var live = true;
        setSrc(null);
        Loom.artUrl(banner.image)
          .then(function (url) {
            if (live) setSrc(url);
          })
          .catch(function () {
            // No banner this time: the art can't be read.
          });
        return function () {
          live = false;
        };
      },
      [key]
    );

    if (!src) return null;
    return html`<figure class="loom-banner" id="loom-banner">
      <img class="loom-banner-image" src=${src} alt="" />
      <figcaption class="loom-banner-name">${banner.name}</figcaption>
    </figure>`;
  }

  // ── The panel ─────────────────────────────────────

  function Suggestions(props) {
    if (!props.actions.length) return null;
    return html`<div class="loom-suggested-actions" id="loom-suggested-actions">
      ${props.actions.map(function (action, i) {
        return html`<button
          key=${i + ':' + action}
          class="loom-suggested-action-chip"
          type="button"
          disabled=${props.busy}
          onClick=${function () {
            Loom.play.submitTurn(action);
          }}
        >
          ${i < 9 && html`<span class="loom-chip-key" aria-hidden="true">${i + 1}</span>`} ${action}
        </button>`;
      })}
    </div>`;
  }

  function TurnBox(props) {
    function send(form) {
      var input = form.elements.namedItem('action');
      var text = input.value;
      input.value = '';
      Loom.play.submitTurn(text);
    }
    return html`<form
      id="loom-turn-form"
      class="loom-turn-form"
      onSubmit=${function (event) {
        event.preventDefault();
        send(event.currentTarget);
      }}
    >
      <textarea
        class="loom-turn-input"
        id="loom-turn-input"
        name="action"
        placeholder="What do you do?"
        aria-label="What do you do?"
        rows="2"
        maxlength="2000"
        disabled=${props.busy}
        onKeyDown=${function (event) {
          if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            send(event.currentTarget.form);
          } else if (event.key === 'Escape') {
            event.currentTarget.blur(); // back to the shortcuts
          }
        }}
      ></textarea>
      <button class="app-btn" id="loom-turn-submit" type="submit" disabled=${props.busy}>
        Act
      </button>
    </form>`;
  }

  // The turn under the box (L-614), for a phone or a world with no map; on a
  // wide screen with a map it is the overlay's (L-725).
  function TurnBar(props) {
    var turn = props.turn;
    if (!turn) return null;
    return html`<div class="loom-turn-bar" id="loom-turn-bar">
      <span class="loom-turn-state" id="loom-turn-state">
        ${'Turn ' +
        turn.n +
        ' · movement ' +
        turn.movementLeft +
        ' of ' +
        turn.speed +
        ' · ' +
        (turn.actionUsed ? 'you have acted' : 'your action is ready')}
      </span>
      <button
        class="app-btn loom-turn-end"
        id="loom-turn-end"
        type="button"
        disabled=${props.busy}
        onClick=${function () {
          Loom.play.endTurn();
        }}
      >
        End turn
      </button>
    </div>`;
  }

  function liveText(entry) {
    if (!entry) return '';
    return [entry.action, entry.roll && rollLine(entry.roll), entry.text]
      .filter(Boolean)
      .join('. ');
  }

  function Journal() {
    var j = ui.useStore(function (s) {
      return s.journal;
    });
    var busy = ui.useStore(function (s) {
      return s.ui.busy;
    });
    var turn = ui.useStore(function (s) {
      return s.turn;
    });
    var logRef = hooks.useRef(null);
    var last = j.entries[j.entries.length - 1];

    hooks.useEffect(
      function () {
        var log = logRef.current;
        if (log) log.scrollTop = log.scrollHeight;
      },
      [j.entries.length, j.banner]
    );

    return html`${j.banner && html`<${Banner} banner=${j.banner} />`}
      ${j.summary && html`<div class="loom-summary" id="loom-summary">${j.summary}</div>`}
      <div class="loom-narration-log" id="loom-narration-log" ref=${logRef}>
        ${j.entries.map(function (entry) {
          return html`<${Entry} key=${entry.id} entry=${entry} latest=${entry === last} />`;
        })}
      </div>
      <div
        class="loom-sr-only"
        id="loom-journal-live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        ${liveText(last)}
      </div>
      <${Suggestions} actions=${j.suggestions} busy=${busy} />
      <${TurnBox} busy=${busy} />
      <${TurnBar} turn=${turn} busy=${busy} />
      ${busy &&
      html`<div class="app-loading" id="loom-turn-loading">
        <div class="app-spinner"></div>
        <p class="app-loading-text">The Loom weaves…</p>
      </div>`}
      ${j.error && html`<p class="loom-error" id="loom-turn-error">${j.error}</p>`}`;
  }

  // ── The keyboard (I1) ─────────────────────────────

  function typing(target) {
    return Boolean(
      target &&
      target.closest &&
      target.closest('input, textarea, select, [contenteditable], [role="menu"]')
    );
  }

  function focusInput() {
    if (store.get().ui.panelCollapsed) store.setUi({ panelCollapsed: false });
    Loom.map.showStory(); // a phone's Story tab
    window.requestAnimationFrame(function () {
      var input = document.getElementById('loom-turn-input');
      if (input && !input.disabled) input.focus();
    });
  }

  function onKey(event) {
    if (!document.body.classList.contains('loom-playing')) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (event.defaultPrevented || typing(event.target)) return;
    var onButton = Boolean(event.target.closest && event.target.closest('button, a'));
    var key = event.key;

    if ((key === ' ' && !onButton) || key === 'Escape') {
      if (finishReveal()) event.preventDefault();
      return;
    }
    if (key === 'Enter') {
      if (onButton) return; // the button's own press
      event.preventDefault();
      focusInput();
      return;
    }
    if (store.get().ui.busy || event.repeat) return;
    var lower = key.toLowerCase();
    if (lower === 'e') {
      event.preventDefault();
      Loom.play.endTurn();
    } else if (lower === 'c') {
      var turn = store.get().turn;
      if (turn && turn.plan && turn.movementLeft > 0) {
        event.preventDefault();
        Loom.map.continuePlan();
      }
    } else if (/^[1-9]$/.test(key)) {
      var action = journal().suggestions[Number(key) - 1];
      if (action) {
        event.preventDefault();
        Loom.play.submitTurn(action);
      }
    }
  }

  // ── What play.js calls ────────────────────────────

  /** A new save: an empty journal with its summary. */
  function reset(summary) {
    finishReveal();
    setJournal({ entries: [], suggestions: [], summary: summary || '', error: null, banner: null });
  }

  /**
   * A turn's line: what the player did, its roll (if it was rolled), and the
   * narration, revealed as it is read. A new turn shows the last one whole.
   */
  function add(action, text, roll) {
    finishReveal();
    var entry = { id: nextId++, action: action || '', text: text || '', roll: roll || null };
    entry.reveal = true;
    setJournal({ entries: journal().entries.concat([entry]), banner: null });
    Loom.shell.newLine(text); // the collapsed panel shows it, and opens
  }

  // Where the player stands, for arriving: their town and battle map.
  function whereOf(data) {
    return {
      town: data && data.town ? data.town.locationId : null,
      battle: data && data.battleMap ? data.battleMap.id : null,
    };
  }

  /**
   * After a turn's map has loaded: a banner if the player arrived somewhere
   * with art (A5), a battle map before its town.
   */
  function arrived(before, data) {
    var was = whereOf(before);
    var now = whereOf(data);
    var banner = null;
    if (now.battle && now.battle !== was.battle && data.battleMap.image) {
      banner = { name: data.battleMap.name, image: data.battleMap.image };
    } else if (now.town && now.town !== was.town && data.town.image) {
      banner = { name: data.town.name, image: data.town.image };
    }
    if (banner) setJournal({ banner: banner });
  }

  /** Builds the panel's content in the story pane, once. */
  function mount(pane) {
    pane.textContent = '';
    ui.render(html`<${Journal} />`, pane);
    document.addEventListener('keydown', onKey);
  }

  Loom.journal = {
    mount: mount,
    reset: reset,
    add: add,
    arrived: arrived,
    finishReveal: finishReveal,
    focusInput: focusInput,
    setSuggestions: function (actions) {
      setJournal({ suggestions: (actions || []).slice() });
    },
    suggestions: function () {
      return journal().suggestions.slice();
    },
    setSummary: function (summary) {
      setJournal({ summary: summary || '' });
    },
    setError: function (message) {
      setJournal({ error: message || null });
    },
  };
})();
