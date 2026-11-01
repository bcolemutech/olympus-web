(function () {
  'use strict';

  // The Character panel and the strip (planning/game-systems.md CS8, EF9,
  // SY2, MD1b, §4.7; L-814 / #641): the player's sheet, drawn from what
  // loomGetMap sends (`character`, functions/loom-canon/sheets.js
  // characterView), in the system's own words and with every number worked
  // out on the server.
  //
  // - The panel, from the menu bar's Character button: the level, resources
  //   as tracks, attributes with their modifiers, skills with their ranks,
  //   traits, conditions with what's left, attacks (L-822), derived values
  //   and action points (L-832), experience toward the next level (L-845); a
  //   sheet that no longer fits the world's rules says what
  //   (SY2). Escape or Close shuts it.
  // - The strip, always on the map (overlay.js hosts it): each resource as a
  //   small track, as many as fit, any conditions ("Poisoned · 2 turns"), and
  //   a mark when a level is ready (L-845).
  //   A press opens the panel. On a phone it runs under the menu bar.
  //
  // The map reloads after every turn, so both follow what a turn changed.
  // L-730 later adds the portrait and token to the panel.

  var Loom = window.Loom;
  var ui = Loom.ui;
  var html = ui.html;
  var hooks = ui.hooks;
  var store = Loom.store;

  var LOW = 0.25; // a track at or under a quarter shows as low

  var root = null;

  function setOpen(open) {
    store.setUi({ character: Boolean(open) });
  }

  function close() {
    setOpen(false);
    var button = document.getElementById('loom-menu-character');
    if (button) button.focus();
  }

  function useCharacter() {
    return ui.useStore(function (s) {
      return (s.map && s.map.character) || null;
    });
  }

  function signed(n) {
    return n < 0 ? '−' + Math.abs(n) : '+' + n;
  }

  // A resource's share of its maximum, 0 to 1 (null when it can't be known).
  function shareOf(r) {
    if (r.current === null || !r.max) return null;
    return Math.max(0, Math.min(1, r.current / r.max));
  }

  function amountOf(r) {
    return (r.current === null ? '?' : r.current) + '/' + (r.max === null ? '?' : r.max);
  }

  function conditionText(c) {
    return c.left ? c.name + ' · ' + c.left : c.name;
  }

  function Track(props) {
    var r = props.resource;
    var share = shareOf(r);
    var low = share !== null && share <= LOW;
    return html`<div
      class=${'loom-track' + (low ? ' is-low' : '') + (props.small ? ' is-small' : '')}
      data-resource=${r.id}
    >
      <span class="loom-track-name">${r.name}</span>
      <span class="loom-track-bar" aria-hidden="true">
        <span class="loom-track-fill" style=${{ width: (share || 0) * 100 + '%' }}></span>
      </span>
      <span class="loom-track-amount">${amountOf(r)}</span>
    </div>`;
  }

  // Experience toward the next level (L-845; advancement UI1): a bar from
  // this level's total to the next's, in the system's word for the level.
  function Experience(props) {
    var x = props.experience;
    var word = props.word;
    var span = x.to === null ? 0 : x.to - x.from;
    var share = span > 0 ? Math.max(0, Math.min(1, (x.xp - x.from) / span)) : 1;
    return html`<div class="loom-track loom-xp" id="loom-character-xp">
      <span class="loom-track-name">${x.to === null ? word : word + ' ' + (props.level + 1)}</span>
      <span class="loom-track-bar" aria-hidden="true">
        <span class="loom-track-fill" style=${{ width: share * 100 + '%' }}></span>
      </span>
      <span class="loom-track-amount">
        ${x.to === null ? x.xp + ' · top ' + word.toLowerCase() : x.xp + '/' + x.to}
      </span>
    </div>`;
  }

  // The mark for a level ready (L-845): "Level ready", or how many.
  function readyText(c) {
    var n = c.experience && c.experience.ready;
    if (!n) return '';
    return n > 1 ? n + ' ' + c.level.name.toLowerCase() + 's ready' : c.level.name + ' ready';
  }

  // ── The strip (CS8, EF9) ──────────────────────────

  function Strip() {
    var c = useCharacter();
    if (!c) return null;
    var label =
      'Your character: ' +
      c.resources
        .map(function (r) {
          return r.name + ' ' + amountOf(r);
        })
        .concat(c.conditions.map(conditionText))
        .join(', ') +
      (readyText(c) ? '. ' + readyText(c) + ': take it at a long rest' : '') +
      (c.misfits.length ? '. The sheet no longer fits the rules' : '') +
      '. Open the Character panel';
    return html`<button
      class="loom-strip loom-map-ui"
      id="loom-strip"
      type="button"
      aria-label=${label}
      onClick=${function () {
        setOpen(true);
      }}
    >
      ${c.resources.map(function (r) {
        return html`<${Track} key=${r.id} resource=${r} small=${true} />`;
      })}
      ${c.conditions.map(function (k) {
        return html`<span key=${k.id} class="loom-strip-condition">${conditionText(k)}</span>`;
      })}
      ${readyText(c) &&
      html`<span class="loom-strip-level" id="loom-strip-level" title="Take it at a long rest"
        >${readyText(c)}</span
      >`}
      ${c.misfits.length > 0 &&
      html`<span class="loom-strip-flag" title="The sheet no longer fits the rules">!</span>`}
    </button>`;
  }

  // ── The panel (CS8) ───────────────────────────────

  function Section(props) {
    return html`<section class="loom-rules-section" id=${props.id}>
      <h3 class="loom-rules-heading">${props.title}</h3>
      ${props.children}
    </section>`;
  }

  function Character() {
    var open = ui.useStore(function (s) {
      return s.ui.character;
    });
    var c = useCharacter();
    var closeRef = hooks.useRef(null);

    hooks.useEffect(
      function () {
        if (open && closeRef.current) closeRef.current.focus();
      },
      [open]
    );

    if (!open || !c) return null;
    var trained = c.skills.filter(function (k) {
      return k.rank > 0;
    });
    return html`<div
      class="loom-rules-backdrop"
      onClick=${function (event) {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        class="loom-rules loom-character"
        id="loom-character"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loom-character-title"
        onKeyDown=${function (event) {
          if (event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
            close();
          }
        }}
      >
        <div class="loom-rules-head">
          <h2 class="loom-rules-title" id="loom-character-title">
            ${c.name || 'Your character'}
            <span class="loom-character-level"> ${' · '}${c.level.name} ${c.level.value} </span>
          </h2>
          <button class="loom-rules-close" type="button" ref=${closeRef} onClick=${close}>
            Close
          </button>
        </div>
        <div class="loom-rules-body">
          ${c.misfits.length > 0 &&
          html`<div class="loom-character-misfits" id="loom-character-misfits" role="note">
            <p>
              This sheet no longer fits ${c.system.name}'s rules. The story will set it right as you
              play.
            </p>
            <ul>
              ${c.misfits.map(function (m) {
                return html`<li key=${m}>${m}</li>`;
              })}
            </ul>
          </div>`}
          ${c.experience &&
          html`<${Section} id="loom-character-experience" title="Experience">
            <${Experience} experience=${c.experience} word=${c.level.name} level=${c.level.value} />
            ${readyText(c) &&
            html`<p class="loom-rules-note" id="loom-character-ready">
              ${readyText(c)}: take it at your next long rest.
            </p>`}
          <//>`}
          <${Section} id="loom-character-resources" title="Tracks">
            ${c.resources.map(function (r) {
              return html`<${Track} key=${r.id} resource=${r} />`;
            })}
          <//>
          ${c.conditions.length > 0 &&
          html`<${Section} id="loom-character-conditions" title="Conditions">
            <ul class="loom-rules-list">
              ${c.conditions.map(function (k) {
                // With what it does to AP (L-834): "moving costs ×2".
                return html`<li key=${k.id}>${conditionText(k) + (k.ap ? ' — ' + k.ap : '')}</li>`;
              })}
            </ul>
          <//>`}
          <${Section} id="loom-character-attributes" title="Attributes">
            <dl class="loom-character-attributes">
              ${c.attributes.map(function (a) {
                return html`<div key=${a.id} class="loom-character-attribute" data-id=${a.id}>
                  <dt>${a.name}</dt>
                  <dd>
                    <span class="loom-character-score">${a.score}</span>
                    ${a.modifier !== null &&
                    a.modifier !== a.score &&
                    html`<span class="loom-character-modifier">${signed(a.modifier)}</span>`}
                  </dd>
                </div>`;
              })}
            </dl>
          <//>
          ${c.skills.length > 0 &&
          html`<${Section} id="loom-character-skills" title="Skills">
            <table class="loom-rules-table loom-character-skills">
              <thead>
                <tr>
                  <th scope="col">Skill</th>
                  <th scope="col">Attribute</th>
                  <th scope="col">${c.rankName}</th>
                </tr>
              </thead>
              <tbody>
                ${c.skills.map(function (k) {
                  return html`<tr
                    key=${k.id}
                    data-id=${k.id}
                    class=${k.rank > 0 ? 'is-trained' : ''}
                  >
                    <th scope="row">${k.name}</th>
                    <td>${k.attribute}</td>
                    <td>${k.rank}</td>
                  </tr>`;
                })}
              </tbody>
            </table>
            ${trained.length === 0 &&
            html`<p class="loom-rules-note">No skill trained yet: each rolls untrained.</p>`}
          <//>`}
          <${Section} id="loom-character-traits" title="Traits">
            ${c.traits.length
              ? html`<ul class="loom-rules-list">
                  ${c.traits.map(function (t) {
                    return html`<li key=${t.id}>
                      ${t.name}${t.description && html`<span> · ${t.description}</span>`}
                    </li>`;
                  })}
                </ul>`
              : html`<p class="loom-rules-note">None yet.</p>`}
          <//>
          ${(c.attacks || []).length > 0 &&
          html`<${Section} id="loom-character-attacks" title="Attacks">
            <ul class="loom-rules-list">
              ${c.attacks.map(function (a) {
                var reach = a.range
                  ? 'range ' + a.range.normal + '/' + a.range.long
                  : 'reach ' + a.reach;
                var damage = a.damage + (a.type ? ' ' + a.type.toLowerCase() : '');
                return html`<li key=${a.id}>
                  ${a.name}<span>
                    ${' · ' + reach + ' · ' + damage + (a.lethal ? '' : ' · knocks out')}</span
                  >
                </li>`;
              })}
            </ul>
          <//>`}
          <${Section} id="loom-character-derived" title="Worked out">
            <dl class="loom-character-attributes">
              ${c.derived.map(function (d) {
                return html`<div key=${d.id} class="loom-character-attribute">
                  <dt>${d.name}</dt>
                  <dd><span class="loom-character-score">${d.value}</span></dd>
                </div>`;
              })}
              <div class="loom-character-attribute">
                <dt>AP</dt>
                <dd><span class="loom-character-score">${c.ap}</span></dd>
              </div>
            </dl>
          <//>
        </div>
      </div>
    </div>`;
  }

  /** Adds the Character button to the menu bar and the panel to the page, once. */
  function mount() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'loom-character-root';
    document.body.appendChild(root);
    ui.render(html`<${Character} />`, root);
    Loom.shell.addMenuButton({
      id: 'character',
      label: 'Character',
      onClick: function () {
        setOpen(!store.get().ui.character);
      },
    });
  }

  Loom.character = { mount: mount, open: setOpen, Strip: Strip };
})();
