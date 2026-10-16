(function () {
  'use strict';

  // The rules reference (planning/game-systems.md SY7, §4.7; L-805 / #631):
  // a panel from the menu bar, made from the world's game system as
  // loomGetMap sends it (`rules`, functions/loom-canon/checks.js rulesOf),
  // in the system's own words: the check and what it reads, the difficulty
  // ladder, the degrees and when each happens, the attributes, the skills
  // and what the sheet tracks. Escape or Close shuts it.

  var Loom = window.Loom;
  var ui = Loom.ui;
  var html = ui.html;
  var hooks = ui.hooks;
  var store = Loom.store;

  var root = null;

  function setOpen(open) {
    store.setUi({ rules: Boolean(open) });
  }

  function close() {
    setOpen(false);
    var button = document.getElementById('loom-menu-rules');
    if (button) button.focus();
  }

  // What the check formula reads, in the system's words.
  function readsOf(rules) {
    var words = rules.words || {};
    var rank = words.rank || 'Rank';
    return [
      ['attribute', 'the score of the attribute the check is rolled with'],
      ['modifier', 'that attribute’s modifier'],
      ['rank', 'your ' + rank.toLowerCase() + ' in the skill (0 untrained)'],
    ].filter(function (pair) {
      return new RegExp('\\b' + pair[0] + '\\b').test(rules.check);
    });
  }

  function Section(props) {
    return html`<section class="loom-rules-section">
      <h3 class="loom-rules-heading">${props.title}</h3>
      ${props.children}
    </section>`;
  }

  function Rules() {
    var open = ui.useStore(function (s) {
      return s.ui.rules;
    });
    var rules = ui.useStore(function (s) {
      return s.map && s.map.rules;
    });
    var closeRef = hooks.useRef(null);

    hooks.useEffect(
      function () {
        if (open && closeRef.current) closeRef.current.focus();
      },
      [open]
    );

    if (!open || !rules) return null;
    var level = rules.level || {};
    return html`<div
      class="loom-rules-backdrop"
      onClick=${function (event) {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        class="loom-rules"
        id="loom-rules"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loom-rules-title"
        onKeyDown=${function (event) {
          if (event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
            close();
          }
        }}
      >
        <div class="loom-rules-head">
          <h2 class="loom-rules-title" id="loom-rules-title">Rules · ${rules.name}</h2>
          <button class="loom-rules-close" type="button" ref=${closeRef} onClick=${close}>
            Close
          </button>
        </div>
        <div class="loom-rules-body">
          <${Section} title="Checks">
            <p>
              When what you try could fail, the Loom rolls a check:
              <code class="loom-rules-formula">${rules.check}</code>
            </p>
            ${readsOf(rules).length > 0 &&
            html`<ul class="loom-rules-list">
              ${readsOf(rules).map(function (pair) {
                return html`<li key=${pair[0]}><code>${pair[0]}</code>: ${pair[1]}</li>`;
              })}
            </ul>`}
            <p>
              The result must be ${rules.reach} the difficulty. The dice are rolled when the turn
              runs; tapping the card shows them.
            </p>
          <//>
          <${Section} title="Difficulty">
            <table class="loom-rules-table" id="loom-rules-ladder">
              <tbody>
                ${rules.ladder.map(function (rung) {
                  return html`<tr key=${rung.name}>
                    <th scope="row">${rung.name}</th>
                    <td>${rung.value}</td>
                  </tr>`;
                })}
              </tbody>
            </table>
          <//>
          <${Section} title="Results">
            <dl class="loom-rules-degrees" id="loom-rules-degrees">
              ${rules.degrees.map(function (degree) {
                return html`<div key=${degree.id} class=${'loom-rules-degree is-' + degree.id}>
                  <dt>${degree.name}</dt>
                  <dd>${degree.when}</dd>
                </div>`;
              })}
            </dl>
            <p class="loom-rules-note">
              Critical results are checked first, then the others in this order.
            </p>
          <//>
          <${Section} title="Attributes">
            <ul class="loom-rules-list" id="loom-rules-attributes">
              ${rules.attributes.map(function (a) {
                return html`<li key=${a.id}>${a.name} <span>${a.min}–${a.max}</span></li>`;
              })}
            </ul>
          <//>
          ${rules.skills.length > 0 &&
          html`<${Section} title="Skills">
            <ul class="loom-rules-list loom-rules-skills" id="loom-rules-skills">
              ${rules.skills.map(function (k) {
                return html`<li key=${k.id}>${k.name} <span>${k.attribute}</span></li>`;
              })}
            </ul>
          <//>`}
          <${Section} title="Your sheet">
            <p>
              ${rules.resources
                .map(function (r) {
                  return r.name;
                })
                .join(', ')}${' · '}${level.name}
              ${level.min}–${level.max}
            </p>
          <//>
        </div>
      </div>
    </div>`;
  }

  /** Adds the Rules button to the menu bar and the panel to the page, once. */
  function mount() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'loom-rules-root';
    document.body.appendChild(root);
    ui.render(html`<${Rules} />`, root);
    Loom.shell.addMenuButton({
      id: 'rules',
      label: 'Rules',
      onClick: function () {
        setOpen(!store.get().ui.rules);
      },
    });
  }

  Loom.rules = { mount: mount, open: setOpen };
})();
