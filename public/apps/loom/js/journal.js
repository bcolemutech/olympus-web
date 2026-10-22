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

  // A roll from loomPlayTurn (L-726, L-805): its dice, its line with each
  // term named, and the degree in the system's words. Older rolls carry only
  // the die and its value.
  function diceOf(roll) {
    if (roll.dice && roll.dice.length) return roll.dice;
    return [{ sides: roll.die, value: roll.value, kept: true }];
  }

  function verdictOf(roll) {
    return roll.verdict || (roll.success ? 'Pass' : 'Fail');
  }

  // "d20 (14) + Dexterity (2) + Stealth (2) = 18"
  function sumOf(roll) {
    var line = roll.line || 'd' + roll.die + ' (' + roll.value + ')';
    var total = roll.total !== undefined ? roll.total : roll.value;
    return line + ' = ' + total;
  }

  // "vs Hard (16)"; a roll against nothing (initiative, L-821) just says what it was.
  function versus(roll) {
    if (roll.difficulty === null || roll.difficulty === undefined) return roll.against || '';
    return 'vs ' + (roll.rung || roll.against) + ' (' + roll.difficulty + ')';
  }

  function rollLine(roll) {
    return sumOf(roll) + ' ' + versus(roll) + ': ' + verdictOf(roll).toLowerCase();
  }

  var TUMBLE = 700; // ms the dice tumble before they land
  var TUMBLE_STEP = 70; // ms between faces as they tumble

  // One die: its face, and in a pool whether it counted; a die not kept
  // (the lower of two d20s) is dimmed.
  function Die(props) {
    var die = props.die;
    var classes = ['loom-die'];
    if (props.rolling) classes.push('is-rolling');
    else if (props.face === null) classes.push('is-waiting');
    else {
      if (die.kept === false) classes.push('is-dropped');
      if (die.counted === true) classes.push('is-counted');
      if (die.counted === false) classes.push('is-missed');
    }
    return html`<span class=${classes.join(' ')} data-sides=${die.sides}>
      <span class="loom-die-face">${props.face === null ? '?' : props.face}</span>
      <span class="loom-die-sides">d${die.sides}</span>
    </span>`;
  }

  /**
   * A roll card (DC5, DC6): the dice to tap. Tapping tumbles them and they
   * land on the server's result, fixed when the turn ran; then the line with
   * each term named, against the rung, and the degree. It collapses to one
   * line once its turn is read; a click opens or closes it. `landed` false
   * shows the dice waiting for the tap.
   */
  function RollCard(props) {
    var roll = props.roll;
    var dice = diceOf(roll);
    var pair = hooks.useState(true);
    var open = pair[0];
    var setOpen = pair[1];
    var tumble = hooks.useState(null); // the faces shown while tumbling
    var faces = tumble[0];
    var setFaces = tumble[1];
    var touched = hooks.useRef(false);

    // Collapsed to one line once read: a little after its turn is shown.
    hooks.useEffect(
      function () {
        if (!props.read || !props.landed || touched.current) return undefined;
        var timer = window.setTimeout(function () {
          setOpen(false);
        }, ROLL_READ);
        return function () {
          window.clearTimeout(timer);
        };
      },
      [props.read, props.landed]
    );

    // Tumbling: random faces, then the server's.
    hooks.useEffect(
      function () {
        if (!faces) return undefined;
        var started = Date.now();
        var timer = window.setInterval(function () {
          if (Date.now() - started >= TUMBLE) {
            window.clearInterval(timer);
            setFaces(null);
            props.onLand();
            return;
          }
          setFaces(
            dice.map(function (die) {
              return 1 + Math.floor(Math.random() * die.sides);
            })
          );
        }, TUMBLE_STEP);
        return function () {
          window.clearInterval(timer);
        };
      },
      [Boolean(faces)]
    );

    var rolling = Boolean(faces);
    var waiting = !props.landed && !rolling;
    function startRolling() {
      if (reducedMotion()) return props.onLand();
      setFaces(
        dice.map(function () {
          return '?';
        })
      );
    }

    // A foe's card rolls itself (L-828; combat UI3), after `delay` ms.
    hooks.useEffect(function () {
      if (!props.auto || props.landed) return undefined;
      var timer = window.setTimeout(startRolling, props.delay || 0);
      return function () {
        window.clearTimeout(timer);
      };
    }, []);

    var degree = roll.degree || (roll.success ? 'success' : 'failure');
    // Pass or fail shows only once the dice land.
    var classes = ['loom-roll'];
    if (props.landed) classes.push(roll.success ? 'is-pass' : 'is-fail', 'is-' + degree);
    if (open || !props.landed) classes.push('is-open');
    if (waiting) classes.push('is-waiting');
    if (rolling) classes.push('is-rolling');

    var label = waiting
      ? 'Roll the dice: ' +
        sumOf(roll)
          .split(' = ')[0]
          .replace(/ \(\d+\)/g, '') +
        ' ' +
        versus(roll)
      : rolling
        ? 'Rolling'
        : rollLine(roll);

    return html`<button
      class=${classes.join(' ')}
      type="button"
      aria-expanded=${String(open || !props.landed)}
      aria-label=${label}
      disabled=${rolling}
      onClick=${function (event) {
        event.stopPropagation();
        if (waiting) return startRolling();
        if (rolling) return;
        touched.current = true;
        setOpen(!open);
      }}
    >
      ${open || !props.landed
        ? html`<span class="loom-roll-dice" aria-hidden="true">
              ${dice.map(function (die, i) {
                return html`<${Die}
                  key=${i}
                  die=${die}
                  rolling=${rolling}
                  face=${rolling ? faces[i] : waiting ? null : die.value}
                />`;
              })}
            </span>
            <span class="loom-roll-body" aria-hidden="true">
              ${waiting
                ? html`<span class="loom-roll-tap">Tap to roll</span>
                    <span class="loom-roll-need">${versus(roll)}</span>`
                : rolling
                  ? html`<span class="loom-roll-tap">Rolling…</span>`
                  : html`<span class="loom-roll-what">${sumOf(roll)}</span>
                      <span class="loom-roll-need">
                        ${versus(roll)}${roll.rung && roll.against !== roll.rung
                          ? ' · ' + roll.against
                          : ''}
                      </span>`}
            </span>
            ${props.landed &&
            html`<span class="loom-roll-verdict" aria-hidden="true">${verdictOf(roll)}</span>`}`
        : html`<span class="loom-roll-line" aria-hidden="true">
            ${sumOf(roll)} ${versus(roll)} · ${verdictOf(roll)}
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

  var FOE_GAP = 900; // ms between foes' cards rolling themselves (L-828)

  // A foe's attack this round (L-828; combat UI3): whose and with what, and
  // its roll as a card that rolls itself, one after another; with Faster
  // (or reduced motion) it has landed already.
  function FoeCard(props) {
    var card = props.card;
    var pair = hooks.useState(!props.auto || reducedMotion());
    var landed = pair[0];
    var setLanded = pair[1];
    return html`<div class="loom-log-foe">
      <span class="loom-log-foe-name">${card.name}</span>
      <${RollCard}
        roll=${card.roll}
        landed=${landed}
        auto=${props.auto}
        delay=${props.delay}
        onLand=${function () {
          setLanded(true);
        }}
        read=${landed}
      />
    </div>`;
  }

  function Entry(props) {
    var entry = props.entry;
    var pair = hooks.useState(!props.latest);
    var read = pair[0];
    var setRead = pair[1];
    // A new turn's roll waits for the tap (DC5), and its narration with it;
    // with reduced motion, or for an older turn, it has landed already.
    var landing = hooks.useState(!entry.roll || !entry.reveal || reducedMotion());
    var landed = landing[0];
    var setLanded = landing[1];

    // Showing the rest at once (a click, Space, Escape, a new turn) lands it too.
    hooks.useEffect(
      function () {
        if (landed) return undefined;
        function land() {
          stop();
          setLanded(true);
        }
        function stop() {
          finishers = finishers.filter(function (f) {
            return f !== land;
          });
        }
        finishers.push(land);
        return stop;
      },
      [landed]
    );

    return html`<div class="loom-log-entry">
      ${entry.action && html`<p class="loom-log-action">${'> ' + entry.action}</p>`}
      ${(entry.cards || []).map(function (card, i) {
        return html`<${FoeCard}
          key=${i}
          card=${card}
          auto=${entry.reveal && !entry.faster}
          delay=${i * FOE_GAP}
        />`;
      })}
      ${entry.roll &&
      html`<${RollCard}
        roll=${entry.roll}
        landed=${landed}
        onLand=${function () {
          setLanded(true);
        }}
        read=${read || !props.latest}
      />`}
      ${landed &&
      html`<${Narration}
        text=${entry.text}
        reveal=${entry.reveal}
        onDone=${function () {
          setRead(true);
        }}
      />`}
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
    // A story that has ended (L-827: the character died) takes no more turns.
    if (props.ended) {
      return html`<p class="loom-turn-ended" id="loom-turn-ended">
        Your story has ended. Start a new character in this world: what this one changed stays.
      </p>`;
    }
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
        ${(props.fight ? 'Round ' + props.fight.round + ' · ' : '') +
        'Turn ' +
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
    var fight = ui.useStore(function (s) {
      return s.map && s.map.fight;
    });
    var ended = ui.useStore(function (s) {
      return Boolean(s.map && s.map.ended);
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
      <${TurnBox} busy=${busy} ended=${ended} />
      <${TurnBar} turn=${turn} fight=${fight} busy=${busy} />
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
    Loom.shell.raise(); // on a phone, the sheet up far enough to type
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
   * `extra.cards`: everyone else's attack cards this round (L-828).
   */
  function add(action, text, roll, extra) {
    finishReveal();
    var entry = { id: nextId++, action: action || '', text: text || '', roll: roll || null };
    entry.reveal = true;
    // Foes' attack cards this round (L-828): [{ name, roll }], and whether
    // they land at once (Faster).
    if (extra && extra.cards && extra.cards.length) {
      entry.cards = extra.cards;
      entry.faster = Boolean(extra.faster);
    }
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
