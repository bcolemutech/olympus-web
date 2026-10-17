(function () {
  'use strict';

  // Making a character (planning/game-systems.md CS5, §4.5; L-812 / #639):
  // after the new game's names, a guided flow by the world's system's own
  // method, from loomCreationRules:
  //
  // 1. Attributes: an array's scores assigned one to each attribute; points
  //    spent on each within the budget; or scores rolled by the server
  //    (loomRollCharacter, shown as dice) and then assigned. Each score shows
  //    the modifier it gives (the server works it out; the page never runs a
  //    formula).
  // 2. Skills to train and traits to take, as many as the system allows.
  // 3. A review of the sheet, then Begin, which sends the choices to
  //    loomCreateSave. The server checks them again and says what's wrong.
  //
  // A world with a premade character, or a system with no method, skips it.

  var Loom = window.Loom;
  var ui = Loom.ui;
  var html = ui.html;
  var hooks = ui.hooks;
  var state = Loom.state;

  var root = null;

  function signed(n) {
    return n > 0 ? '+' + n : String(n);
  }

  function modifierOf(attribute, score) {
    var m = attribute.modifiers && attribute.modifiers[score];
    return m === undefined ? '' : signed(m);
  }

  // ── Attributes ────────────────────────────────────

  // Assigning a list of scores (an array, or the rolled ones): each attribute
  // takes one, and each score is used once.
  function Assign(props) {
    var c = props.creation;
    var pool = props.values;
    var chosen = props.attributes;
    var used = Object.keys(chosen).map(function (id) {
      return chosen[id];
    });
    function left(except) {
      var rest = pool.slice();
      used.forEach(function (v, i) {
        if (Object.keys(chosen)[i] === except) return;
        var at = rest.indexOf(v);
        if (at !== -1) rest.splice(at, 1);
      });
      return rest;
    }
    return html`<div class="loom-create-attrs" id="loom-create-attrs">
      ${c.attributes.map(function (a) {
        var score = chosen[a.id];
        var options = left(a.id).filter(function (v, i, all) {
          return all.indexOf(v) === i;
        });
        return html`<label class="loom-create-attr" key=${a.id}>
          <span class="loom-create-attr-name">${a.name}</span>
          <select
            class="loom-form-input loom-create-select"
            data-attr=${a.id}
            value=${score === undefined ? '' : String(score)}
            onChange=${function (event) {
              var next = Object.assign({}, chosen);
              if (event.currentTarget.value === '') delete next[a.id];
              else next[a.id] = Number(event.currentTarget.value);
              props.onChange(next);
            }}
          >
            <option value="">—</option>
            ${options
              .slice()
              .sort(function (x, y) {
                return y - x;
              })
              .map(function (v) {
                return html`<option key=${v} value=${String(v)}>${v}</option>`;
              })}
          </select>
          <span class="loom-create-mod">${score === undefined ? '' : modifierOf(a, score)}</span>
        </label>`;
      })}
    </div>`;
  }

  // Buying scores: each attribute steps through the scores that can be
  // bought, and the points left show as you go.
  function Buy(props) {
    var c = props.creation;
    var chosen = props.attributes;
    var scores = Object.keys(c.costs)
      .map(Number)
      .sort(function (x, y) {
        return x - y;
      });
    var spent = c.attributes.reduce(function (sum, a) {
      return sum + (c.costs[chosen[a.id]] || 0);
    }, 0);
    function step(a, by) {
      var at = scores.indexOf(chosen[a.id]) + by;
      if (at < 0 || at >= scores.length) return;
      var next = Object.assign({}, chosen);
      next[a.id] = scores[at];
      props.onChange(next);
    }
    return html`<div class="loom-create-attrs" id="loom-create-attrs">
      <p class="loom-create-points" id="loom-create-points">
        ${c.budget - spent} of ${c.budget} points left
      </p>
      ${c.attributes.map(function (a) {
        var score = chosen[a.id];
        var nextCost = c.costs[scores[scores.indexOf(score) + 1]];
        var tooDear = nextCost === undefined || spent - c.costs[score] + nextCost > c.budget;
        return html`<div class="loom-create-attr" key=${a.id} data-attr=${a.id}>
          <span class="loom-create-attr-name">${a.name}</span>
          <button
            class="loom-create-step"
            type="button"
            aria-label=${'Lower ' + a.name}
            disabled=${scores.indexOf(score) <= 0}
            onClick=${function () {
              step(a, -1);
            }}
          >
            −
          </button>
          <span class="loom-create-score">${score}</span>
          <button
            class="loom-create-step"
            type="button"
            aria-label=${'Raise ' + a.name}
            disabled=${tooDear}
            onClick=${function () {
              step(a, 1);
            }}
          >
            +
          </button>
          <span class="loom-create-mod">${modifierOf(a, score)}</span>
        </div>`;
      })}
    </div>`;
  }

  // The rolled scores, as dice: each die, the ones dropped dimmed.
  function Rolls(props) {
    return html`<div class="loom-create-rolls" id="loom-create-rolls">
      ${props.rolls.map(function (roll, i) {
        return html`<div class="loom-roll is-open loom-create-roll" key=${i}>
          <span class="loom-roll-dice" aria-hidden="true">
            ${roll.dice.map(function (die, j) {
              return html`<span
                key=${j}
                class=${'loom-die' + (die.kept === false ? ' is-dropped' : '')}
              >
                <span class="loom-die-face">${die.value}</span>
                <span class="loom-die-sides">d${die.sides}</span>
              </span>`;
            })}
          </span>
          <span class="loom-roll-body">
            <span class="loom-roll-what">${roll.line + ' = ' + roll.total}</span>
          </span>
        </div>`;
      })}
    </div>`;
  }

  // ── Skills and traits ─────────────────────────────

  function Choose(props) {
    var chosen = props.chosen;
    return html`<fieldset class="loom-create-choose" id=${props.id}>
      <legend class="loom-form-label">${props.title} (${chosen.length} of ${props.max})</legend>
      ${props.options.map(function (o) {
        var on = chosen.indexOf(o.id) !== -1;
        return html`<label class="loom-create-option" key=${o.id}>
          <input
            type="checkbox"
            value=${o.id}
            checked=${on}
            disabled=${!on && chosen.length >= props.max}
            onChange=${function () {
              props.onChange(
                on
                  ? chosen.filter(function (id) {
                      return id !== o.id;
                    })
                  : chosen.concat([o.id])
              );
            }}
          />
          ${o.name}${o.attribute
            ? html` <span class="loom-create-dim">(${o.attribute})</span>`
            : ''}
        </label>`;
      })}
    </fieldset>`;
  }

  // ── The flow ──────────────────────────────────────

  function startingAttributes(c) {
    if (c.method !== 'pointBuy') return {};
    // The cheapest score in every attribute, to buy up from.
    var cheapest = Object.keys(c.costs)
      .map(Number)
      .sort(function (x, y) {
        return c.costs[x] - c.costs[y] || x - y;
      })[0];
    var out = {};
    c.attributes.forEach(function (a) {
      out[a.id] = cheapest;
    });
    return out;
  }

  function Creation(props) {
    var c = props.rules.creation;
    var words = props.rules.system.words || {};
    var s = hooks.useState('attributes');
    var stepName = s[0];
    var setStep = s[1];
    var a = hooks.useState(startingAttributes(c));
    var attributes = a[0];
    var setAttributes = a[1];
    var k = hooks.useState([]);
    var skills = k[0];
    var setSkills = k[1];
    var t = hooks.useState([]);
    var traits = t[0];
    var setTraits = t[1];
    var r = hooks.useState(null); // { rollId, rolls }
    var rolled = r[0];
    var setRolled = r[1];
    var b = hooks.useState(false);
    var busy = b[0];
    var setBusy = b[1];
    var e = hooks.useState(null);
    var error = e[0];
    var setError = e[1];

    var allChosen = c.attributes.every(function (attr) {
      return attributes[attr.id] !== undefined;
    });
    var hasChoices = (c.skills.length && c.skillsToTrain) || (c.traits.length && c.traitsToPick);

    function roll() {
      setBusy(true);
      setError(null);
      state.functions
        .httpsCallable('loomRollCharacter')({ worldId: props.worldId })
        .then(function (result) {
          setBusy(false);
          setRolled(result.data);
          setAttributes({});
        })
        .catch(function (err) {
          setBusy(false);
          setError(err.message || 'The dice would not roll.');
        });
    }

    function begin() {
      setBusy(true);
      setError(null);
      var choices = { attributes: attributes, skills: skills, traits: traits };
      if (rolled) choices.rollId = rolled.rollId;
      props.onCreate(choices).catch(function (err) {
        setBusy(false);
        setError(err.message || 'The character could not be made.');
      });
    }

    var body;
    if (stepName === 'attributes') {
      body = html`<p class="loom-create-help">
          ${c.method === 'array'
            ? 'Give each attribute one of these scores: ' + c.values.join(', ') + '.'
            : c.method === 'pointBuy'
              ? 'Spend your points on your attributes.'
              : 'Roll ' +
                c.formula +
                ' for each attribute, then give each attribute one of the scores.'}
        </p>
        ${c.method === 'rolling' &&
        html`<button
          class="app-btn"
          id="loom-create-roll"
          type="button"
          disabled=${busy}
          onClick=${roll}
        >
          ${rolled ? 'Roll again' : 'Roll'}
        </button>`}
        ${rolled && html`<${Rolls} rolls=${rolled.rolls} />`}
        ${c.method === 'pointBuy'
          ? html`<${Buy} creation=${c} attributes=${attributes} onChange=${setAttributes} />`
          : (c.method === 'array' || rolled) &&
            html`<${Assign}
              creation=${c}
              values=${c.method === 'array'
                ? c.values
                : rolled.rolls.map(function (x) {
                    return x.total;
                  })}
              attributes=${attributes}
              onChange=${setAttributes}
            />`}
        <div class="loom-form-actions">
          <button
            class="app-btn"
            id="loom-create-next"
            type="button"
            disabled=${!allChosen}
            onClick=${function () {
              setStep(hasChoices ? 'choices' : 'review');
            }}
          >
            Next
          </button>
          <button class="loom-back-link" type="button" onClick=${props.onCancel}>Back</button>
        </div>`;
    } else if (stepName === 'choices') {
      body = html`${c.skills.length > 0 &&
        c.skillsToTrain > 0 &&
        html`<${Choose}
          id="loom-create-skills"
          title=${'Skills to train, at ' + signed(c.skillRank)}
          options=${c.skills}
          chosen=${skills}
          max=${c.skillsToTrain}
          onChange=${setSkills}
        />`}
        ${c.traits.length > 0 &&
        c.traitsToPick > 0 &&
        html`<${Choose}
          id="loom-create-traits"
          title="Traits"
          options=${c.traits}
          chosen=${traits}
          max=${c.traitsToPick}
          onChange=${setTraits}
        />`}
        <div class="loom-form-actions">
          <button
            class="app-btn"
            id="loom-create-next"
            type="button"
            onClick=${function () {
              setStep('review');
            }}
          >
            Next
          </button>
          <button
            class="loom-back-link"
            type="button"
            onClick=${function () {
              setStep('attributes');
            }}
          >
            Back
          </button>
        </div>`;
    } else {
      var nameOf = function (list, id) {
        var found = list.filter(function (x) {
          return x.id === id;
        })[0];
        return found ? found.name : id;
      };
      body = html`<dl class="loom-create-review" id="loom-create-review">
          ${c.attributes.map(function (attr) {
            return html`<div key=${attr.id} class="loom-create-review-row">
              <dt>${attr.name}</dt>
              <dd>${attributes[attr.id]} (${modifierOf(attr, attributes[attr.id])})</dd>
            </div>`;
          })}
          ${skills.length > 0 &&
          html`<div class="loom-create-review-row">
            <dt>${words.rank || 'Trained'}</dt>
            <dd>
              ${skills
                .map(function (id) {
                  return nameOf(c.skills, id) + ' ' + signed(c.skillRank);
                })
                .join(', ')}
            </dd>
          </div>`}
          ${traits.length > 0 &&
          html`<div class="loom-create-review-row">
            <dt>Traits</dt>
            <dd>
              ${traits
                .map(function (id) {
                  return nameOf(c.traits, id);
                })
                .join(', ')}
            </dd>
          </div>`}
        </dl>
        <div class="loom-form-actions">
          <button
            class="app-btn"
            id="loom-create-begin"
            type="button"
            disabled=${busy}
            onClick=${begin}
          >
            Begin
          </button>
          <button
            class="loom-back-link"
            type="button"
            onClick=${function () {
              setStep(hasChoices ? 'choices' : 'attributes');
            }}
          >
            Back
          </button>
        </div>`;
    }

    var titles = { attributes: 'Attributes', choices: 'Skills and traits', review: 'Review' };
    return html`<section class="loom-create" id="loom-create" aria-labelledby="loom-create-title">
      <h3 class="loom-create-title" id="loom-create-title">
        ${props.characterName}: ${titles[stepName]}
      </h3>
      <p class="loom-create-dim">${props.rules.system.name}</p>
      ${body} ${error && html`<p class="loom-error" id="loom-create-error">${error}</p>`}
    </section>`;
  }

  /**
   * After the new game's names: the world's rules for making a character,
   * then the flow, or straight on when there's nothing to choose. Resolves
   * with the choices to send to loomCreateSave (or null for none), or
   * rejects if the player goes back.
   */
  function rulesFor(worldId) {
    return state.functions
      .httpsCallable('loomCreationRules')({ worldId: worldId })
      .then(function (result) {
        return result.data;
      });
  }

  /**
   * Shows the flow in `host`. `onCreate(choices)` makes the save (a promise);
   * `onCancel` goes back to the names.
   */
  function show(host, props) {
    root = host;
    root.classList.remove('hidden');
    ui.render(html`<${Creation} ...${props} />`, root);
  }

  function hide() {
    if (!root) return;
    ui.render(null, root);
    root.classList.add('hidden');
  }

  /** Whether a world's rules leave the player something to choose. */
  function needsChoices(rules) {
    return Boolean(rules && !rules.premade && rules.creation && rules.creation.method);
  }

  Loom.creation = { rulesFor: rulesFor, show: show, hide: hide, needsChoices: needsChoices };
})();
