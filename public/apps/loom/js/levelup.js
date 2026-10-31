(function () {
  'use strict';

  // The level-up form (planning/advancement.md §4.4, §4.6, LV3, LV4; L-845 /
  // #717): a level earned and offered at a long rest (loomPlayTurn's
  // `levelUp`, or loomGetMap's after a reload; functions/loom-modules/
  // advancement/level-up.js), taken here. Like the new-game form
  // (creation.js): the level's grants and their limits, the GM's suggestion
  // filled in so one tap takes it, and every change checked before Take
  // (the server checks again). Take sends { verb: 'levelUp', choices }.
  //
  // It sits in the journal, so on a phone it is in the bottom sheet.

  var Loom = window.Loom;
  var ui = Loom.ui;
  var html = ui.html;
  var hooks = ui.hooks;

  function copyOf(choices) {
    var c = choices || {};
    return {
      attributes: Object.assign({}, c.attributes || {}),
      skills: Object.assign({}, c.skills || {}),
      traits: (c.traits || []).slice(),
      attacks: (c.attacks || []).slice(),
    };
  }

  function sum(map) {
    return Object.keys(map).reduce(function (n, k) {
      return n + (map[k] || 0);
    }, 0);
  }

  /** What's wrong with the choices, as the player reads it: [] when they can be taken. */
  function problems(offer, choices) {
    var out = [];
    var g = offer.grants;
    var l = offer.limits || {};
    if (g.attributePoints && sum(choices.attributes) !== g.attributePoints) {
      out.push(
        'Spend ' + g.attributePoints + ' attribute point' + (g.attributePoints > 1 ? 's' : '') + '.'
      );
    }
    if (g.skillRanks && sum(choices.skills) !== g.skillRanks) {
      out.push('Spend ' + g.skillRanks + ' skill rank' + (g.skillRanks > 1 ? 's' : '') + '.');
    }
    (l.attributes || []).forEach(function (a) {
      if (a.score + (choices.attributes[a.id] || 0) > a.max)
        out.push(a.name + ' can be at most ' + a.max + '.');
    });
    (l.skills || []).forEach(function (k) {
      if (k.rank + (choices.skills[k.id] || 0) > k.max)
        out.push(k.name + ' can be at most ' + k.max + '.');
    });
    if (g.traits && choices.traits.length !== g.traits.choose) {
      out.push('Choose ' + g.traits.choose + ' trait' + (g.traits.choose > 1 ? 's' : '') + '.');
    }
    if (g.attacks && choices.attacks.length !== g.attacks.choose) {
      out.push('Choose ' + g.attacks.choose + ' attack' + (g.attacks.choose > 1 ? 's' : '') + '.');
    }
    return out;
  }

  /** The choices as the server takes them: only what the level gives. */
  function sent(offer, choices) {
    var out = {};
    var g = offer.grants;
    var pick = function (map) {
      var o = {};
      Object.keys(map).forEach(function (k) {
        if (map[k]) o[k] = map[k];
      });
      return o;
    };
    if (g.attributePoints) out.attributes = pick(choices.attributes);
    if (g.skillRanks) out.skills = pick(choices.skills);
    if (g.traits) out.traits = choices.traits.slice();
    if (g.attacks) out.attacks = choices.attacks.slice();
    return out;
  }

  // A row of points to spend: each item with − and + within its limit.
  function Spend(props) {
    var left = props.points - sum(props.spent);
    return html`<fieldset class="loom-levelup-spend" id=${props.id}>
      <legend>${props.title} <span class="loom-levelup-left">${left} left</span></legend>
      ${props.items.map(function (x) {
        var n = props.spent[x.id] || 0;
        var now = props.current(x);
        return html`<div class="loom-levelup-row" key=${x.id} data-id=${x.id}>
          <span class="loom-levelup-name">${x.name}</span>
          <span class="loom-levelup-value">${now + n}${n ? html` <em>(+${n})</em>` : ''}</span>
          <button
            type="button"
            class="loom-levelup-step"
            aria-label=${'One less ' + x.name}
            disabled=${n <= 0}
            onClick=${function () {
              props.onChange(x.id, n - 1);
            }}
          >
            −
          </button>
          <button
            type="button"
            class="loom-levelup-step"
            aria-label=${'One more ' + x.name}
            disabled=${left <= 0 || now + n >= x.max}
            onClick=${function () {
              props.onChange(x.id, n + 1);
            }}
          >
            +
          </button>
        </div>`;
      })}
    </fieldset>`;
  }

  // A list to choose from: `choose` of them.
  function Pick(props) {
    return html`<fieldset class="loom-levelup-pick" id=${props.id}>
      <legend>${props.title} <span class="loom-levelup-left">choose ${props.choose}</span></legend>
      ${props.from.map(function (x) {
        var on = props.picked.indexOf(x.id) !== -1;
        return html`<label class="loom-levelup-option" key=${x.id} data-id=${x.id}>
          <input
            type="checkbox"
            checked=${on}
            disabled=${!on && props.picked.length >= props.choose}
            onChange=${function () {
              props.onChange(
                on
                  ? props.picked.filter(function (id) {
                      return id !== x.id;
                    })
                  : props.picked.concat([x.id])
              );
            }}
          />
          ${x.name}${x.description &&
          html`<span class="loom-levelup-note"> · ${x.description}</span>`}
        </label>`;
      })}
    </fieldset>`;
  }

  function Form() {
    var offer = ui.useStore(function (s) {
      return s.levelUp || (s.map && s.map.levelUp) || null;
    });
    var busy = ui.useStore(function (s) {
      return s.ui.busy;
    });
    var word = ui.useStore(function (s) {
      var c = s.map && s.map.character;
      return (c && c.level && c.level.name) || 'Level';
    });
    var suggested = offer && offer.suggestion ? offer.suggestion.choices : null;
    var pair = hooks.useState(copyOf(suggested));
    var choices = pair[0];
    var setChoices = pair[1];
    var key = offer ? offer.level + ':' + JSON.stringify(suggested) : '';
    // A new offer starts from its suggestion.
    hooks.useEffect(
      function () {
        setChoices(copyOf(suggested));
      },
      [key]
    );
    if (!offer) return null;
    var g = offer.grants;
    var l = offer.limits || {};
    var wrong = problems(offer, choices);
    var nothing = !Object.keys(g).length;
    var change = function (part, value) {
      var next = copyOf(choices);
      next[part] = value;
      setChoices(next);
    };
    var spendOn = function (part) {
      return function (id, n) {
        var map = Object.assign({}, choices[part]);
        map[id] = n;
        change(part, map);
      };
    };
    var isSuggestion =
      JSON.stringify(sent(offer, choices)) === JSON.stringify(sent(offer, copyOf(suggested)));
    return html`<div
      class="loom-levelup"
      id="loom-levelup"
      role="group"
      aria-labelledby="loom-levelup-title"
    >
      <p class="loom-levelup-title" id="loom-levelup-title">${word} ${offer.level} is ready.</p>
      ${nothing &&
      html`<p class="loom-levelup-note">This ${word.toLowerCase()} gives nothing to choose.</p>`}
      ${offer.suggestion &&
      offer.suggestion.reason &&
      html`<p class="loom-levelup-reason" id="loom-levelup-reason">
        The GM suggests: ${offer.suggestion.reason}
      </p>`}
      ${g.attributePoints &&
      html`<${Spend}
        id="loom-levelup-attributes"
        title="Attribute points"
        points=${g.attributePoints}
        items=${l.attributes || []}
        spent=${choices.attributes}
        current=${function (a) {
          return a.score;
        }}
        onChange=${spendOn('attributes')}
      />`}
      ${g.skillRanks &&
      html`<${Spend}
        id="loom-levelup-skills"
        title="Skill ranks"
        points=${g.skillRanks}
        items=${l.skills || []}
        spent=${choices.skills}
        current=${function (k) {
          return k.rank;
        }}
        onChange=${spendOn('skills')}
      />`}
      ${g.traits &&
      html`<${Pick}
        id="loom-levelup-traits"
        title="Traits"
        choose=${g.traits.choose}
        from=${g.traits.from}
        picked=${choices.traits}
        onChange=${function (v) {
          change('traits', v);
        }}
      />`}
      ${g.attacks &&
      html`<${Pick}
        id="loom-levelup-attacks"
        title="Attacks"
        choose=${g.attacks.choose}
        from=${g.attacks.from}
        picked=${choices.attacks}
        onChange=${function (v) {
          change('attacks', v);
        }}
      />`}
      ${wrong.length > 0 &&
      html`<ul class="loom-levelup-problems" id="loom-levelup-problems">
        ${wrong.map(function (w) {
          return html`<li key=${w}>${w}</li>`;
        })}
      </ul>`}
      <div class="loom-confirm-actions">
        <button
          class="app-btn"
          id="loom-levelup-take"
          type="button"
          disabled=${busy || wrong.length > 0}
          onClick=${function () {
            Loom.play.levelUp(offer.level, sent(offer, choices));
          }}
        >
          ${isSuggestion && !nothing
            ? 'Take the suggestion'
            : 'Take ' + word.toLowerCase() + ' ' + offer.level}
        </button>
        ${!isSuggestion &&
        suggested &&
        html`<button
          class="app-btn loom-confirm-cancel"
          id="loom-levelup-reset"
          type="button"
          disabled=${busy}
          onClick=${function () {
            setChoices(copyOf(suggested));
          }}
        >
          Back to the suggestion
        </button>`}
      </div>
    </div>`;
  }

  Loom.levelUp = { Form: Form, problems: problems, sent: sent };
})();
