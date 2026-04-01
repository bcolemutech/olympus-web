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
    }
  };

  // Step 1: Choose narrative tone
  function _renderStep1(container) {
    var d = VO.state.wizardData;
    var html =
      '<h2 class="wizard-step-title">Choose Your Journey</h2>' +
      '<p class="wizard-step-desc">What kind of story do you want to tell?</p>' +
      '<div class="difficulty-grid">';

    VO.TONES.forEach(function (tone) {
      var selected = d.tone === tone.id;
      html +=
        '<button type="button" class="difficulty-card' +
        (selected ? ' selected' : '') +
        '" data-id="' +
        tone.id +
        '">' +
        '<span class="difficulty-icon">' +
        tone.icon +
        '</span>' +
        '<span class="difficulty-label">' +
        tone.label +
        '</span>' +
        '<span class="difficulty-desc">' +
        tone.description +
        '</span>' +
        '</button>';
    });

    html += '</div><div class="wizard-nav">';
    html +=
      '<button type="button" class="btn btn-primary wizard-next" id="step1-next" ' +
      (d.tone ? '' : 'disabled') +
      '>Next →</button>';
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

  // Step 2: Name your captain
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
      '<label class="form-label" for="captain-backstory">Backstory <span class="form-optional">(optional — or let Claude invent one)</span></label>' +
      '<textarea id="captain-backstory" class="form-textarea" placeholder="A few sentences about your past..." maxlength="400">' +
      _esc(d.captainBackstory) +
      '</textarea>' +
      '</div>' +
      '<div class="wizard-nav">' +
      '<button type="button" class="btn btn-secondary wizard-back" id="step2-back">← Back</button>' +
      '<button type="button" class="btn btn-primary wizard-next" id="step2-next">Next →</button>' +
      '</div>';

    container.innerHTML = html;

    // Sync name input
    var nameInput = document.getElementById('captain-name');
    nameInput.addEventListener('input', function () {
      d.captainName = nameInput.value;
    });

    // Sync backstory
    var backstoryInput = document.getElementById('captain-backstory');
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
      });
    });

    document.getElementById('step2-back').addEventListener('click', function () {
      VO.renderWizardStep(1);
    });

    document.getElementById('step2-next').addEventListener('click', function () {
      var name = document.getElementById('captain-name').value.trim();
      if (!name) {
        _showFieldError('captain-name', "Please enter your captain's name.");
        return;
      }
      if (d.captainTraits.length < 2) {
        _showError('wizard-body', 'Please select at least 2 traits.');
        return;
      }
      d.captainName = name;
      VO.renderWizardStep(3);
    });
  }

  // Step 3: Choose your ship
  function _renderStep3(container) {
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
      '<button type="button" class="btn btn-secondary" id="step3-back">← Back</button>' +
      '<button type="button" class="btn btn-primary" id="step3-next"' +
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
        document.getElementById('step3-next').disabled = false;
      });
    });

    var shipNameInput = document.getElementById('ship-name');
    if (shipNameInput) {
      shipNameInput.addEventListener('input', function () {
        d.shipName = shipNameInput.value;
      });
    }

    document.getElementById('step3-back').addEventListener('click', function () {
      VO.renderWizardStep(2);
    });

    document.getElementById('step3-next').addEventListener('click', function () {
      if (!d.shipClass) return;
      var name =
        document.getElementById('ship-name') && document.getElementById('ship-name').value.trim();
      if (!name) {
        _showFieldError('ship-name', 'Please name your ship.');
        return;
      }
      d.shipName = name;
      VO.renderWizardStep(4);
    });
  }

  // Step 4: Generate and review starting crew
  function _renderStep4(container) {
    var d = VO.state.wizardData;

    // Show spinner while we call the Cloud Function
    container.innerHTML =
      '<h2 class="wizard-step-title">Assembling Your Crew</h2>' +
      '<p class="wizard-step-desc">The Oracle is conjuring your starting crew&hellip;</p>' +
      '<div class="wizard-generating">' +
      '<div class="app-spinner"></div>' +
      '<p class="wizard-generating-text">Generating crew manifest&hellip;</p>' +
      '</div>';

    // Call the Cloud Function (generates crew + opening scene in one shot)
    var fn = VO.state.functions.httpsCallable('voidOdysseyNewGame');
    fn({
      // Legacy field name kept for backend compatibility; carries narrative tone
      difficulty: d.tone,
      captainName: d.captainName,
      captainTraits: d.captainTraits,
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
          '<button type="button" class="btn btn-secondary" id="step4-retry">← Try Again</button>' +
          '</div>';
        document.getElementById('step4-retry').addEventListener('click', function () {
          VO.renderWizardStep(4);
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
      '<button type="button" class="btn btn-secondary" id="step4-back">← Reroll</button>' +
      '<button type="button" class="btn btn-primary" id="step4-next">Launch Campaign →</button>' +
      '</div>';

    container.innerHTML = html;

    document.getElementById('step4-back').addEventListener('click', function () {
      VO.state.generatedGame = null;
      VO.renderWizardStep(4);
    });

    document.getElementById('step4-next').addEventListener('click', function () {
      VO.renderWizardStep(5);
    });
  }

  // Step 5: Display opening scene
  function _renderStep5(container) {
    var game = VO.state.generatedGame;
    if (!game) {
      VO.renderWizardStep(4);
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
      '<button type="button" class="btn btn-primary" id="step5-enter">Enter the Void →</button>' +
      '</div>';

    document.getElementById('step5-enter').addEventListener('click', function () {
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
})();
