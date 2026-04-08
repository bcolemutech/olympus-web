(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  // ── Step rendering ─────────────────────────────────────────

  VO.renderWizardStep = function (step) {
    VO.state.wizardStep = step;
    var container = VO.getRef('wizard-body');
    if (!container) return;

    // Update progress indicator
    var steps = document.querySelectorAll('.wizard-step-dot');
    steps.forEach(function (dot, i) {
      dot.classList.toggle('active', i + 1 === step);
      dot.classList.toggle('done', i + 1 < step);
    });

    switch (step) {
      case 1:
        _renderStep1(container);
        break;
      case 2:
        _renderStep2(container);
        break;
      case 3:
        _renderStep3(container);
        break;
      case 4:
        _renderStep4(container);
        break;
      case 5:
        _renderStep5(container);
        break;
      case 6:
        _renderStep6(container);
        break;
    }
  };

  // Step 1: Choose journey
  function _renderStep1(container) {
    var d = VO.state.wizardData;

    // Sort journey entries by order, exclude custom (order 8)
    var journeys = Object.keys(VO.JOURNEYS)
      .map(function (key) {
        return VO.JOURNEYS[key];
      })
      .filter(function (j) {
        return j.order !== 8;
      })
      .sort(function (a, b) {
        return a.order - b.order;
      });

    var html =
      '<h2 class="wizard-step-title">Choose Your Journey</h2>' +
      '<p class="wizard-step-desc">What kind of story do you want to tell?</p>' +
      '<div class="difficulty-grid">';

    journeys.forEach(function (journey) {
      var selected = d.tone === journey.id;
      var danger = _formatDanger(journey.dangerLevel);
      var shipNames = _formatShipNames(journey.availableShips || []);

      var themeTags = journey.themes
        .map(function (t) {
          return '<span class="journey-theme-tag">' + _esc(t.replace(/_/g, ' ')) + '</span>';
        })
        .join('');

      html +=
        '<button type="button" class="difficulty-card' +
        (selected ? ' selected' : '') +
        '" data-id="' +
        journey.id +
        '">' +
        '<div class="journey-card-header">' +
        '<span class="difficulty-icon">' +
        journey.icon +
        '</span>' +
        '<span class="journey-danger ' +
        danger.cssClass +
        '">' +
        danger.text +
        '</span>' +
        '</div>' +
        '<span class="journey-card-name">' +
        _esc(journey.name) +
        '</span>' +
        '<span class="journey-tagline">' +
        _esc(journey.tagline) +
        '</span>' +
        '<div class="journey-themes">' +
        themeTags +
        '</div>' +
        '<div class="journey-detail">' +
        '<p class="journey-detail-desc">' +
        _esc(journey.description) +
        '</p>' +
        (shipNames
          ? '<p class="journey-ships"><span class="journey-ships-label">Available ships: </span>' +
            _esc(shipNames) +
            '</p>'
          : '') +
        '</div>' +
        '</button>';
    });

    html += '</div><div class="wizard-nav">';
    html +=
      '<button type="button" class="btn btn-primary wizard-next" id="step1-next" ' +
      (d.tone ? '' : 'disabled') +
      '>Next \u2192</button>';
    html += '</div>';

    container.innerHTML = html;

    container.querySelectorAll('.difficulty-card').forEach(function (card) {
      card.addEventListener('click', function () {
        d.tone = card.dataset.id;
        container.querySelectorAll('.difficulty-card').forEach(function (c) {
          c.classList.toggle('selected', c.dataset.id === d.tone);
        });
        document.getElementById('step1-next').disabled = false;
      });
    });

    var nextBtn = document.getElementById('step1-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (!d.tone) return;
        VO.renderWizardStep(2);
      });
    }
  }

  // Step 2: Name your captain, pick traits, write or generate a backstory
  function _renderStep2(container) {
    var d = VO.state.wizardData;

    var html =
      '<h2 class="wizard-step-title">Name Your Captain</h2>' +
      '<p class="wizard-step-desc">Who are you out here in the void?</p>' +
      '<div class="form-group">' +
      '<label class="form-label" for="captain-name">Captain\'s Name</label>' +
      '<input type="text" id="captain-name" class="form-input" placeholder="e.g. Mara Solano" maxlength="60" value="' +
      _esc(d.captainName) +
      '">' +
      '</div>' +
      '<div class="form-group">' +
      '<label class="form-label">Pick 2–3 Traits</label>' +
      '<div class="trait-grid">';

    VO.CAPTAIN_TRAITS.forEach(function (trait) {
      var pressed = d.captainTraits.indexOf(trait.id) !== -1;
      html +=
        '<button type="button" class="trait-chip' +
        (pressed ? ' selected' : '') +
        '" data-id="' +
        trait.id +
        '" aria-pressed="' +
        (pressed ? 'true' : 'false') +
        '">' +
        trait.label +
        '</button>';
    });

    html +=
      '</div></div>' +
      '<div class="form-group">' +
      '<div class="backstory-label-row">' +
      '<label class="form-label" for="captain-backstory">Backstory <span class="form-optional">(optional)</span></label>' +
      '<button type="button" class="btn btn-ghost btn-sm backstory-generate-btn" id="backstory-generate" disabled>' +
      '<span class="backstory-generate-label">✨ Generate Backstory</span>' +
      '</button>' +
      '</div>' +
      '<textarea id="captain-backstory" class="form-textarea" placeholder="A few sentences about your past — or select 2–3 traits and let the Oracle write one for you." maxlength="400">' +
      _esc(d.captainBackstory) +
      '</textarea>' +
      '<p class="backstory-hint" id="backstory-hint">Pick 2–3 traits to unlock the Oracle.</p>' +
      '</div>' +
      '<div class="wizard-nav">' +
      '<button type="button" class="btn btn-secondary wizard-back" id="step2-back">← Back</button>' +
      '<button type="button" class="btn btn-primary wizard-next" id="step2-next" disabled>Next →</button>' +
      '</div>';

    container.innerHTML = html;

    var nameInput = document.getElementById('captain-name');
    var backstoryInput = document.getElementById('captain-backstory');
    var nextBtn = document.getElementById('step2-next');
    var generateBtn = document.getElementById('backstory-generate');
    var generateLabel = generateBtn.querySelector('.backstory-generate-label');
    var hint = document.getElementById('backstory-hint');

    function updateNextEnabled() {
      var nameOk = nameInput.value.trim().length > 0;
      var traitsOk = d.captainTraits.length >= 2 && d.captainTraits.length <= 3;
      nextBtn.disabled = !(nameOk && traitsOk);
    }

    function updateGenerateEnabled() {
      var traitsOk = d.captainTraits.length >= 2 && d.captainTraits.length <= 3;
      var busy = VO.state._backstoryGenerating === true;
      generateBtn.disabled = !traitsOk || busy;
      if (busy) {
        hint.textContent = 'The Oracle is dreaming up your past…';
      } else if (traitsOk) {
        hint.textContent = 'Let the Oracle draft one — you can edit it after.';
      } else {
        hint.textContent = 'Pick 2–3 traits to unlock the Oracle.';
      }
    }

    // Sync name input
    nameInput.addEventListener('input', function () {
      d.captainName = nameInput.value;
      updateNextEnabled();
    });

    // Sync backstory textarea
    backstoryInput.addEventListener('input', function () {
      d.captainBackstory = backstoryInput.value;
    });

    // Trait buttons — enforce 2-3 limit
    var traitBtns = container.querySelectorAll('.trait-chip');
    traitBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.id;
        var idx = d.captainTraits.indexOf(id);
        if (idx !== -1) {
          // Deselect
          d.captainTraits.splice(idx, 1);
          btn.classList.remove('selected');
          btn.setAttribute('aria-pressed', 'false');
        } else {
          if (d.captainTraits.length >= 3) return; // Enforce max 3
          d.captainTraits.push(id);
          btn.classList.add('selected');
          btn.setAttribute('aria-pressed', 'true');
        }
        updateNextEnabled();
        updateGenerateEnabled();
      });
    });

    generateBtn.addEventListener('click', function () {
      if (generateBtn.disabled) return;
      // Clear any previous inline error
      var existing = container.querySelector('.wizard-inline-error');
      if (existing) existing.remove();

      VO.state._backstoryGenerating = true;
      generateLabel.innerHTML =
        '<span class="backstory-spinner" aria-hidden="true"></span>Generating…';
      updateGenerateEnabled();

      var fn = VO.state.functions.httpsCallable('voidOdysseyGenerateBackstory');
      fn({
        journey: d.tone,
        captainName: nameInput.value.trim(),
        captainTraits: d.captainTraits.slice(),
      })
        .then(function (result) {
          var text = (result && result.data && result.data.backstory) || '';
          if (text) {
            backstoryInput.value = text;
            d.captainBackstory = text;
          }
        })
        .catch(function (err) {
          console.error('voidOdysseyGenerateBackstory error:', err);
          _showError('wizard-body', err.message || 'Failed to generate backstory. Try again.');
        })
        .then(function () {
          VO.state._backstoryGenerating = false;
          generateLabel.textContent = '✨ Generate Backstory';
          updateGenerateEnabled();
        });
    });

    document.getElementById('step2-back').addEventListener('click', function () {
      VO.renderWizardStep(1);
    });

    nextBtn.addEventListener('click', function () {
      if (nextBtn.disabled) return;
      var name = nameInput.value.trim();
      if (!name) {
        _showFieldError('captain-name', "Please enter your captain's name.");
        return;
      }
      if (d.captainTraits.length < 2 || d.captainTraits.length > 3) {
        _showError('wizard-body', 'Please select 2 or 3 traits.');
        return;
      }
      d.captainName = name;
      d.captainBackstory = backstoryInput.value;
      VO.renderWizardStep(3);
    });

    updateNextEnabled();
    updateGenerateEnabled();
  }

  // Step 3: Allocate skills
  function _renderStep3(container) {
    var d = VO.state.wizardData;
    var COSTS = VO.SKILL_POINT_COSTS; // [0, 1, 3, 6]
    var BUDGET = VO.SKILL_POINT_BUDGET; // 10

    function pointsSpent() {
      return Object.keys(d.captainSkills).reduce(function (sum, id) {
        return sum + (COSTS[d.captainSkills[id]] || 0);
      }, 0);
    }

    function renderSkillRows() {
      var spent = pointsSpent();
      var remaining = BUDGET - spent;
      var rows = '';

      VO.SKILLS.forEach(function (skill) {
        var level = d.captainSkills[skill.id] || 0;
        var canIncrease = level < 3 && COSTS[level + 1] - COSTS[level] <= remaining;
        var canDecrease = level > 0;

        rows +=
          '<div class="skill-row" data-skill="' +
          skill.id +
          '">' +
          '<span class="skill-label">' +
          _esc(skill.label) +
          '</span>' +
          '<div class="skill-controls">' +
          '<button type="button" class="skill-btn skill-dec"' +
          (canDecrease ? '' : ' disabled') +
          ' data-skill="' +
          skill.id +
          '">−</button>' +
          '<span class="skill-level">' +
          level +
          '</span>' +
          '<button type="button" class="skill-btn skill-inc"' +
          (canIncrease ? '' : ' disabled') +
          ' data-skill="' +
          skill.id +
          '">+</button>' +
          '</div>' +
          '</div>';
      });

      return rows;
    }

    function buildHtml() {
      var spent = pointsSpent();
      var remaining = BUDGET - spent;
      return (
        '<h2 class="wizard-step-title">Allocate Your Skills</h2>' +
        '<p class="wizard-step-desc">Spend exactly ' +
        BUDGET +
        ' points. Each level costs more: Lv 1 = 1pt, Lv 2 = 3pt, Lv 3 = 6pt.</p>' +
        '<div class="skill-budget">' +
        '<span class="skill-budget-label">Points remaining:</span> ' +
        '<span class="skill-budget-count' +
        (remaining === 0 ? ' skill-budget-done' : '') +
        '" id="skill-remaining">' +
        remaining +
        '</span>' +
        '</div>' +
        '<div class="skill-list" id="skill-list">' +
        renderSkillRows() +
        '</div>' +
        '<div class="wizard-nav">' +
        '<button type="button" class="btn btn-secondary" id="step3-back">← Back</button>' +
        '<button type="button" class="btn btn-primary" id="step3-next"' +
        (remaining === 0 ? '' : ' disabled') +
        '>Next →</button>' +
        '</div>'
      );
    }

    container.innerHTML = buildHtml();

    function refresh() {
      var spent = pointsSpent();
      var remaining = BUDGET - spent;

      // Update remaining counter
      var counter = document.getElementById('skill-remaining');
      if (counter) {
        counter.textContent = remaining;
        counter.classList.toggle('skill-budget-done', remaining === 0);
      }

      // Enable/disable next button
      var nextBtn = document.getElementById('step3-next');
      if (nextBtn) nextBtn.disabled = remaining !== 0;

      // Re-render skill rows in place
      var skillList = document.getElementById('skill-list');
      if (skillList) {
        skillList.innerHTML = renderSkillRows();
        attachSkillHandlers();
      }
    }

    function attachSkillHandlers() {
      container.querySelectorAll('.skill-dec').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.dataset.skill;
          var level = d.captainSkills[id] || 0;
          if (level <= 0) return;
          if (level === 1) {
            delete d.captainSkills[id];
          } else {
            d.captainSkills[id] = level - 1;
          }
          refresh();
        });
      });

      container.querySelectorAll('.skill-inc').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.dataset.skill;
          var level = d.captainSkills[id] || 0;
          if (level >= 3) return;
          var costIncrease = COSTS[level + 1] - COSTS[level];
          if (costIncrease > BUDGET - pointsSpent()) return;
          d.captainSkills[id] = level + 1;
          refresh();
        });
      });
    }

    attachSkillHandlers();

    document.getElementById('step3-back').addEventListener('click', function () {
      VO.renderWizardStep(2);
    });

    document.getElementById('step3-next').addEventListener('click', function () {
      if (pointsSpent() !== BUDGET) return;
      VO.renderWizardStep(4);
    });
  }

  // Step 4: Choose your ship
  function _renderStep4(container) {
    var d = VO.state.wizardData;

    var html =
      '<h2 class="wizard-step-title">Choose Your Ship</h2>' +
      '<p class="wizard-step-desc">Every captain needs a vessel. What\'s yours?</p>' +
      '<div class="ship-grid">';

    VO.SHIP_CLASSES.forEach(function (ship) {
      var selected = d.shipClass === ship.id;
      html +=
        '<button type="button" class="ship-card' +
        (selected ? ' selected' : '') +
        '" data-id="' +
        ship.id +
        '">' +
        '<span class="ship-icon">' +
        ship.icon +
        '</span>' +
        '<span class="ship-label">' +
        ship.label +
        '</span>' +
        '<span class="ship-flavor">' +
        ship.flavor +
        '</span>' +
        '<div class="ship-stats">' +
        '<span class="ship-stat">Hull ' +
        ship.stats.hullMax +
        '</span>' +
        '<span class="ship-stat">Cargo ' +
        ship.stats.cargoMax +
        '</span>' +
        '<span class="ship-stat">Shields ' +
        ship.stats.shieldsMax +
        '</span>' +
        '</div>' +
        '</button>';
    });

    html +=
      '</div>' +
      '<div class="form-group" id="ship-name-group" style="' +
      (d.shipClass ? '' : 'display:none') +
      '">' +
      '<label class="form-label" for="ship-name">Name Your Ship</label>' +
      '<input type="text" id="ship-name" class="form-input" placeholder="e.g. The Daedalus" maxlength="60" value="' +
      _esc(d.shipName) +
      '">' +
      '</div>' +
      '<div class="wizard-nav">' +
      '<button type="button" class="btn btn-secondary" id="step4-back">← Back</button>' +
      '<button type="button" class="btn btn-primary" id="step4-next"' +
      (d.shipClass ? '' : ' disabled') +
      '>Next →</button>' +
      '</div>';

    container.innerHTML = html;

    container.querySelectorAll('.ship-card').forEach(function (card) {
      card.addEventListener('click', function () {
        d.shipClass = card.dataset.id;
        container.querySelectorAll('.ship-card').forEach(function (c) {
          c.classList.toggle('selected', c.dataset.id === d.shipClass);
        });
        document.getElementById('ship-name-group').style.display = '';
        document.getElementById('step4-next').disabled = false;
      });
    });

    var shipNameInput = document.getElementById('ship-name');
    if (shipNameInput) {
      shipNameInput.addEventListener('input', function () {
        d.shipName = shipNameInput.value;
      });
    }

    document.getElementById('step4-back').addEventListener('click', function () {
      VO.renderWizardStep(3);
    });

    document.getElementById('step4-next').addEventListener('click', function () {
      if (!d.shipClass) return;
      var name =
        document.getElementById('ship-name') && document.getElementById('ship-name').value.trim();
      if (!name) {
        _showFieldError('ship-name', 'Please name your ship.');
        return;
      }
      d.shipName = name;
      VO.renderWizardStep(5);
    });
  }

  // Step 5: Generate and review starting crew (Cloud Function call + Firestore write)
  function _renderStep5(container) {
    var d = VO.state.wizardData;

    // Show spinner while we call the Cloud Function
    container.innerHTML =
      '<h2 class="wizard-step-title">Assembling Your Crew</h2>' +
      '<p class="wizard-step-desc">The Oracle is conjuring your starting crew&hellip;</p>' +
      '<div class="wizard-generating">' +
      '<div class="app-spinner"></div>' +
      '<p class="wizard-generating-text">Generating crew manifest&hellip;</p>' +
      '</div>';

    // Call the Cloud Function (generates crew + opening scene in one shot, writes game to Firestore)
    var fn = VO.state.functions.httpsCallable('voidOdysseyNewGame');
    fn({
      // Legacy field name; carries narrative tone / journey ID
      difficulty: d.tone,
      captainName: d.captainName,
      captainTraits: d.captainTraits,
      captainSkills: d.captainSkills,
      captainBackstory: d.captainBackstory,
      shipClass: d.shipClass,
      shipName: d.shipName,
    })
      .then(function (result) {
        VO.state.generatedGame = result.data;
        _renderCrewReview(container, result.data.crew);
      })
      .catch(function (err) {
        console.error('voidOdysseyNewGame error:', err);
        container.innerHTML =
          '<h2 class="wizard-step-title">Something Went Wrong</h2>' +
          '<p class="wizard-error">' +
          _esc(err.message || 'Failed to generate game. Please try again.') +
          '</p>' +
          '<div class="wizard-nav">' +
          '<button type="button" class="btn btn-secondary" id="step5-retry">← Try Again</button>' +
          '</div>';
        document.getElementById('step5-retry').addEventListener('click', function () {
          VO.renderWizardStep(5);
        });
      });
  }

  function _renderCrewReview(container, crew) {
    var html =
      '<h2 class="wizard-step-title">Meet Your Crew</h2>' +
      '<p class="wizard-step-desc">The Oracle has assembled your starting crew. Review them before launch.</p>' +
      '<div class="crew-preview-list">';

    (crew || []).forEach(function (member) {
      html +=
        '<div class="crew-preview-card">' +
        '<div class="crew-preview-header">' +
        '<span class="crew-preview-name">' +
        _esc(member.name) +
        '</span>' +
        '<span class="crew-preview-role">' +
        _esc(member.role) +
        '</span>' +
        '</div>' +
        '<p class="crew-preview-bio">' +
        _esc(member.backstory) +
        '</p>' +
        '</div>';
    });

    html +=
      '</div>' +
      '<div class="wizard-nav">' +
      '<button type="button" class="btn btn-secondary" id="step5-back">← Reroll</button>' +
      '<button type="button" class="btn btn-primary" id="step5-next">Launch Campaign →</button>' +
      '</div>';

    container.innerHTML = html;

    document.getElementById('step5-back').addEventListener('click', function () {
      VO.state.generatedGame = null;
      VO.renderWizardStep(5);
    });

    document.getElementById('step5-next').addEventListener('click', function () {
      VO.renderWizardStep(6);
    });
  }

  // Step 6: Display opening scene
  function _renderStep6(container) {
    var game = VO.state.generatedGame;
    if (!game) {
      VO.renderWizardStep(5);
      return;
    }

    var actions = game.availableActions || [];
    var actionsHtml = actions
      .map(function (a) {
        return (
          '<button type="button" class="action-btn" data-id="' +
          _esc(a.id) +
          '">' +
          _esc(a.label) +
          '</button>'
        );
      })
      .join('');

    container.innerHTML =
      '<h2 class="wizard-step-title">Your Story Begins</h2>' +
      '<div class="narrative-panel">' +
      '<p class="narrative-text">' +
      _escNarrative(game.narrative) +
      '</p>' +
      '</div>' +
      '<div class="action-panel">' +
      '<p class="action-panel-label">What do you do?</p>' +
      '<div class="action-buttons">' +
      actionsHtml +
      '</div>' +
      '<p class="action-panel-note">(Full turn actions available in Phase 2)</p>' +
      '</div>' +
      '<div class="wizard-nav wizard-nav--center">' +
      '<button type="button" class="btn btn-primary" id="step6-enter">Enter the Void →</button>' +
      '</div>';

    document.getElementById('step6-enter').addEventListener('click', function () {
      VO.showView('game-active');
    });
  }

  // ── Helpers ────────────────────────────────────────────────

  function _esc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  // Escapes for display but preserves paragraph breaks in narrative
  function _escNarrative(str) {
    if (!str) return '';
    return str
      .split('\n\n')
      .map(function (para) {
        var d = document.createElement('div');
        d.textContent = para.trim();
        return d.innerHTML;
      })
      .filter(Boolean)
      .join('</p><p class="narrative-text">');
  }

  function _showError(containerId, msg) {
    var el = VO.getRef(containerId) || document.getElementById(containerId);
    var existing = el && el.querySelector('.wizard-inline-error');
    if (existing) existing.remove();
    if (!el) return;
    var err = document.createElement('p');
    err.className = 'wizard-inline-error';
    err.textContent = msg;
    el.insertBefore(err, el.querySelector('.wizard-nav'));
  }

  function _showFieldError(fieldId, msg) {
    var field = document.getElementById(fieldId);
    if (!field) return;
    var existing = field.parentNode.querySelector('.field-error');
    if (existing) existing.remove();
    var err = document.createElement('p');
    err.className = 'field-error';
    err.textContent = msg;
    field.parentNode.appendChild(err);
    field.focus();
  }

  // Maps a dangerLevel string to display text and a CSS modifier class
  function _formatDanger(dangerLevel) {
    var map = {
      low_moderate: { text: 'Low\u2013Moderate', cssClass: 'journey-danger--low-moderate' },
      moderate: { text: 'Moderate', cssClass: 'journey-danger--moderate' },
      high: { text: 'High', cssClass: 'journey-danger--high' },
      moderate_high: { text: 'Moderate\u2013High', cssClass: 'journey-danger--moderate-high' },
      low_combat_high_stakes: {
        text: 'Low Combat / High Stakes',
        cssClass: 'journey-danger--low-combat-high-stakes',
      },
      variable: { text: 'Variable', cssClass: 'journey-danger--variable' },
      high_scoped: { text: 'High (Scoped)', cssClass: 'journey-danger--high-scoped' },
    };
    return map[dangerLevel] || { text: dangerLevel, cssClass: 'journey-danger--variable' };
  }

  // Converts an array of snake_case ship IDs to Title Case and joins with ", "
  function _formatShipNames(ships) {
    return ships
      .map(function (id) {
        return id
          .split('_')
          .map(function (word) {
            return word.charAt(0).toUpperCase() + word.slice(1);
          })
          .join(' ');
      })
      .join(', ');
  }
})();
