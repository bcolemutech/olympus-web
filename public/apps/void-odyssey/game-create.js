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
    var busy = VO.state._backstoryGenerating === true;

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

    var generateLabelHtml = busy
      ? '<span class="backstory-spinner" aria-hidden="true"></span>Generating…'
      : '✨ Generate Backstory';

    html +=
      '</div></div>' +
      '<div class="form-group">' +
      '<div class="backstory-label-row">' +
      '<label class="form-label" for="captain-backstory">Backstory <span class="form-optional">(optional)</span></label>' +
      '<button type="button" class="btn btn-ghost btn-sm backstory-generate-btn" id="backstory-generate" disabled>' +
      '<span class="backstory-generate-label">' +
      generateLabelHtml +
      '</span>' +
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
    var hint = document.getElementById('backstory-hint');

    // If a previous generation finished with an error, surface it once and clear.
    if (VO.state._backstoryError) {
      _showError('wizard-body', VO.state._backstoryError);
      VO.state._backstoryError = null;
    }

    function updateNextEnabled() {
      var nameOk = nameInput.value.trim().length > 0;
      var traitsOk = d.captainTraits.length >= 2 && d.captainTraits.length <= 3;
      nextBtn.disabled = !(nameOk && traitsOk);
    }

    function updateGenerateEnabled() {
      var traitsOk = d.captainTraits.length >= 2 && d.captainTraits.length <= 3;
      var isBusy = VO.state._backstoryGenerating === true;
      generateBtn.disabled = !traitsOk || isBusy;
      if (isBusy) {
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
      VO.state._backstoryError = null;

      VO.state._backstoryGenerating = true;
      updateGenerateEnabled();
      // Swap the button label to a spinner for immediate feedback; if a
      // re-render happens later it will reconstruct the same state from
      // VO.state._backstoryGenerating.
      var labelEl = generateBtn.querySelector('.backstory-generate-label');
      if (labelEl) {
        labelEl.innerHTML = '<span class="backstory-spinner" aria-hidden="true"></span>Generating…';
      }

      var fn = VO.state.functions.httpsCallable('voidOdysseyGenerateBackstory');
      fn({
        journey: d.tone,
        captainName: nameInput.value.trim(),
        captainTraits: d.captainTraits.slice(),
      })
        .then(function (result) {
          var text = (result && result.data && result.data.backstory) || '';
          if (text) {
            // Write through state so a re-render (or revisit) picks it up.
            d.captainBackstory = text;
          }
        })
        .catch(function (err) {
          console.error('voidOdysseyGenerateBackstory error:', err);
          VO.state._backstoryError = err.message || 'Failed to generate backstory. Try again.';
        })
        .then(function () {
          VO.state._backstoryGenerating = false;
          // If the user is still on Step 2, re-render so the textarea shows
          // the generated text (or the error is surfaced) and the button
          // returns to its resting state. If they navigated away mid-request,
          // state is already updated and the fresh render on revisit picks
          // it up — do not force navigation back.
          if (VO.state.wizardStep === 2) {
            VO.renderWizardStep(2);
          }
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
        var nextDelta = level < 3 ? COSTS[level + 1] - COSTS[level] : 0;
        var canIncrease = level < 3 && nextDelta <= remaining;
        var canDecrease = level > 0;
        var nextPts = nextDelta === 1 ? ' pt' : ' pts';

        var rowClass = 'skill-row';
        if (level >= 3) {
          rowClass += ' is-maxed';
        } else if (!canIncrease) {
          rowClass += ' is-unaffordable';
        }

        var nextLabel;
        if (level >= 3) {
          nextLabel = 'Maxed';
        } else if (!canIncrease) {
          nextLabel = "Can't afford (" + nextDelta + nextPts + ')';
        } else {
          nextLabel = 'Next: ' + nextDelta + nextPts;
        }

        var incTitle =
          level < 3
            ? 'Next level: ' + nextDelta + (nextDelta === 1 ? ' point' : ' points')
            : 'Level 3 is the cap';

        var incAriaLabel;
        if (level >= 3) {
          incAriaLabel = skill.label + ' is at level 3 (maximum)';
        } else {
          incAriaLabel = 'Increase ' + skill.label + ' to level ' + (level + 1);
        }
        var decAriaLabel =
          level > 0
            ? 'Decrease ' + skill.label + ' to level ' + (level - 1)
            : skill.label + ' is at level 0';

        rows +=
          '<div class="' +
          rowClass +
          '" data-skill="' +
          skill.id +
          '">' +
          '<div class="skill-info">' +
          '<span class="skill-label">' +
          _esc(skill.label) +
          '</span>' +
          '<span class="skill-desc">' +
          _esc(skill.description || '') +
          '</span>' +
          '<span class="skill-next-cost">' +
          _esc(nextLabel) +
          '</span>' +
          '</div>' +
          '<div class="skill-controls">' +
          '<button type="button" class="skill-btn skill-dec"' +
          (canDecrease ? '' : ' disabled') +
          ' aria-label="' +
          _esc(decAriaLabel) +
          '"' +
          ' data-skill="' +
          skill.id +
          '">−</button>' +
          '<span class="skill-level" aria-hidden="true">' +
          level +
          '</span>' +
          '<button type="button" class="skill-btn skill-inc"' +
          (canIncrease ? '' : ' disabled') +
          ' title="' +
          _esc(incTitle) +
          '"' +
          ' aria-label="' +
          _esc(incAriaLabel) +
          '"' +
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
  // Stat bar normalization — computed once from VO.SHIPS at module init so the
  // bars stay in sync with ship data automatically. VO.SHIPS is an object keyed
  // by ship id, with numeric stats under ship.stats.
  function _computeStatBarMax() {
    var maxes = { hull: 0, shields: 0, fuel: 0, cargo: 0, crew: 0 };
    var ships = (VO && VO.SHIPS) || {};
    Object.keys(ships).forEach(function (id) {
      var stats = (ships[id] && ships[id].stats) || {};
      if (stats.hullMax > maxes.hull) maxes.hull = stats.hullMax;
      if (stats.shieldsMax > maxes.shields) maxes.shields = stats.shieldsMax;
      if (stats.fuel > maxes.fuel) maxes.fuel = stats.fuel;
      if (stats.cargoMax > maxes.cargo) maxes.cargo = stats.cargoMax;
      if (stats.crewCapacity > maxes.crew) maxes.crew = stats.crewCapacity;
    });
    // Floors guard against an empty VO.SHIPS during unit testing or dev reload,
    // preventing division-by-zero in the stat-bar percentage calc.
    if (!maxes.hull) maxes.hull = 200;
    if (!maxes.shields) maxes.shields = 150;
    if (!maxes.fuel) maxes.fuel = 100;
    if (!maxes.cargo) maxes.cargo = 250;
    if (!maxes.crew) maxes.crew = 200;
    return maxes;
  }

  var _STAT_BAR_MAX = _computeStatBarMax();

  // Tier labels per planning/void-odyssey-creation-amendment.md §8.3
  function _hullTier(v) {
    if (v < 70) return 'Light';
    if (v < 100) return 'Standard';
    if (v < 140) return 'Heavy';
    return 'Capital';
  }
  function _shieldTier(v) {
    if (v < 50) return 'Minimal';
    if (v < 80) return 'Standard';
    if (v < 120) return 'Military';
    return 'Capital';
  }

  function _statRow(label, value, max, tier) {
    var pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
    return (
      '<div class="ship-stat-row">' +
      '<span class="ship-stat-label">' +
      _esc(label) +
      '</span>' +
      (tier
        ? '<span class="ship-stat-tier">' + _esc(tier) + '</span>'
        : '<span class="ship-stat-tier ship-stat-tier--empty"></span>') +
      '<span class="ship-stat-value">' +
      value +
      '</span>' +
      '<span class="ship-stat-bar"><span class="ship-stat-bar-fill" style="width:' +
      pct +
      '%"></span></span>' +
      '</div>'
    );
  }

  function _loadoutSection(heading, items, formatter) {
    if (!items || items.length === 0) return '';
    var itemsHtml = items
      .map(function (item) {
        return '<li class="ship-loadout-item">' + formatter(item) + '</li>';
      })
      .join('');
    return (
      '<div class="ship-loadout-section">' +
      '<div class="ship-loadout-heading">' +
      _esc(heading) +
      '</div>' +
      '<ul class="ship-loadout-list">' +
      itemsHtml +
      '</ul>' +
      '</div>'
    );
  }

  function _renderStep4(container) {
    var d = VO.state.wizardData;

    // Guard: a journey must already be selected from Step 1
    var journey = d.tone ? VO.JOURNEYS[d.tone] : null;
    if (!journey) {
      VO.renderWizardStep(1);
      return;
    }

    var isShipsCompany = journey.id === 'ships_company';

    // Resolve the 3 ships for this journey from VO.SHIPS, sorted by order
    var ships = (journey.availableShips || [])
      .map(function (id) {
        return VO.SHIPS[id];
      })
      .filter(function (s) {
        return !!s;
      })
      .sort(function (a, b) {
        return (a.order || 0) - (b.order || 0);
      });

    var html =
      '<h2 class="wizard-step-title">Choose Your Ship</h2>' +
      '<p class="wizard-step-desc">' +
      (isShipsCompany
        ? 'Your assignment: pick a capital vessel, then choose your role aboard her.'
        : "Every captain needs a vessel. What's yours?") +
      '</p>' +
      '<div class="ship-grid">';

    ships.forEach(function (ship) {
      var selected = d.shipClass === ship.id;
      var stats = ship.stats || {};

      var statsHtml =
        '<div class="ship-stat-block">' +
        _statRow('Hull', stats.hullMax, _STAT_BAR_MAX.hull, _hullTier(stats.hullMax)) +
        _statRow(
          'Shields',
          stats.shieldsMax,
          _STAT_BAR_MAX.shields,
          _shieldTier(stats.shieldsMax)
        ) +
        _statRow('Fuel', stats.fuel, _STAT_BAR_MAX.fuel, null) +
        _statRow('Cargo Max', stats.cargoMax, _STAT_BAR_MAX.cargo, null) +
        _statRow('Crew Capacity', stats.crewCapacity, _STAT_BAR_MAX.crew, null) +
        '</div>';

      var loadoutHtml =
        '<div class="ship-loadout">' +
        _loadoutSection('Weapons', ship.startingWeapons, function (w) {
          var meta = [];
          if (w.type) meta.push(w.type);
          if (w.damage) meta.push(w.damage);
          var metaHtml = meta.length
            ? ' <span class="ship-loadout-meta">(' + _esc(meta.join(' · ')) + ')</span>'
            : '';
          return _esc(w.name || 'Unknown weapon') + metaHtml;
        }) +
        _loadoutSection('Systems', ship.startingSystems, function (s) {
          return _esc(s.name || 'Unknown system');
        }) +
        _loadoutSection('Features', ship.startingFeatures, function (f) {
          return _esc(f.name || 'Unknown feature');
        }) +
        '</div>';

      html +=
        '<button type="button" class="ship-card' +
        (selected ? ' selected' : '') +
        '" data-id="' +
        _esc(ship.id) +
        '" aria-pressed="' +
        (selected ? 'true' : 'false') +
        '">' +
        '<div class="ship-card-header">' +
        '<span class="ship-icon">' +
        _esc(ship.icon || '') +
        '</span>' +
        '<span class="ship-label">' +
        _esc(ship.className || '') +
        '</span>' +
        '</div>' +
        '<p class="ship-flavor">' +
        _esc(ship.description || '') +
        '</p>' +
        statsHtml +
        loadoutHtml +
        '</button>';
    });

    html += '</div>';

    // Details region — ship name input OR role selector, depending on journey
    if (isShipsCompany) {
      var roles = journey.roleOptions || [];
      var roleCardsHtml = roles
        .map(function (role) {
          var roleSelected = d.captainRole === role.id;
          return (
            '<button type="button" class="role-card' +
            (roleSelected ? ' selected' : '') +
            '" data-role-id="' +
            _esc(role.id) +
            '" aria-pressed="' +
            (roleSelected ? 'true' : 'false') +
            '">' +
            '<span class="role-name">' +
            _esc(role.name || '') +
            '</span>' +
            '<span class="role-focus">' +
            _esc(role.focus || '') +
            '</span>' +
            '</button>'
          );
        })
        .join('');

      html +=
        '<div class="form-group" id="role-selector-group" style="' +
        (d.shipClass ? '' : 'display:none') +
        '">' +
        '<label class="form-label">Choose Your Role</label>' +
        '<p class="form-hint">The ship already has a name and a history. You bring expertise and a chain of command.</p>' +
        '<div class="role-selector">' +
        roleCardsHtml +
        '</div>' +
        '</div>';
    } else {
      html +=
        '<div class="form-group" id="ship-name-group" style="' +
        (d.shipClass ? '' : 'display:none') +
        '">' +
        '<label class="form-label" for="ship-name">Name Your Ship</label>' +
        '<input type="text" id="ship-name" class="form-input" placeholder="e.g. The Daedalus" maxlength="60" value="' +
        _esc(d.shipName) +
        '">' +
        '</div>';
    }

    // Nav buttons
    var nextDisabled;
    if (!d.shipClass) {
      nextDisabled = true;
    } else if (isShipsCompany) {
      nextDisabled = !d.captainRole;
    } else {
      nextDisabled = !(d.shipName && d.shipName.trim());
    }

    html +=
      '<div class="wizard-nav">' +
      '<button type="button" class="btn btn-secondary" id="step4-back">← Back</button>' +
      '<button type="button" class="btn btn-primary" id="step4-next"' +
      (nextDisabled ? ' disabled' : '') +
      '>Next →</button>' +
      '</div>';

    container.innerHTML = html;

    // Wire ship card clicks — re-render so the details region and Next button
    // always reflect the latest wizardData (matches the Step 3 pattern).
    container.querySelectorAll('.ship-card').forEach(function (card) {
      card.addEventListener('click', function () {
        d.shipClass = card.dataset.id;
        _renderStep4(container);
      });
    });

    // Wire role card clicks (ships_company only)
    container.querySelectorAll('.role-card').forEach(function (card) {
      card.addEventListener('click', function () {
        d.captainRole = card.dataset.roleId;
        _renderStep4(container);
      });
    });

    // Wire ship-name input (non-ships_company only)
    var shipNameInput = document.getElementById('ship-name');
    if (shipNameInput) {
      shipNameInput.addEventListener('input', function () {
        d.shipName = shipNameInput.value;
        var nextBtn = document.getElementById('step4-next');
        if (nextBtn) nextBtn.disabled = !(d.shipClass && d.shipName.trim());
      });
    }

    document.getElementById('step4-back').addEventListener('click', function () {
      VO.renderWizardStep(3);
    });

    document.getElementById('step4-next').addEventListener('click', function () {
      if (!d.shipClass) return;

      if (isShipsCompany) {
        if (!d.captainRole) return;
        // Auto-populate shipName with the canonical class name so the existing
        // backend shipName required-field validation is satisfied. For ships_company,
        // the vessel already has a name and history — the player does not name it.
        var selectedShip = VO.SHIPS[d.shipClass];
        if (selectedShip && selectedShip.className) {
          d.shipName = selectedShip.className;
        }
      } else {
        var input = document.getElementById('ship-name');
        var name = input && input.value.trim();
        if (!name) {
          _showFieldError('ship-name', 'Please name your ship.');
          return;
        }
        d.shipName = name;
      }

      VO.renderWizardStep(5);
    });
  }

  // Step 5: Generate and review starting crew (voidOdysseyGenerateCrew — no Firestore write).
  // The game is created in Step 6 using the (possibly edited) crew.
  function _renderStep5(container) {
    var d = VO.state.wizardData;

    // If crew was already generated (e.g. user pressed Back from Step 6),
    // skip the API call and show the existing editable cards directly.
    if (VO.state.generatedCrew) {
      _renderCrewCards(container, VO.state.generatedCrew);
      return;
    }

    // Show spinner while the Cloud Function runs
    container.innerHTML =
      '<h2 class="wizard-step-title">Assembling Your Crew</h2>' +
      '<p class="wizard-step-desc">The Oracle is conjuring your starting crew&hellip;</p>' +
      '<div class="wizard-generating">' +
      '<div class="app-spinner"></div>' +
      '<p class="wizard-generating-text">Generating crew manifest&hellip;</p>' +
      '</div>';

    var fn = VO.state.functions.httpsCallable('voidOdysseyGenerateCrew');
    fn({
      journey: d.tone,
      captainName: d.captainName,
      captainTraits: d.captainTraits,
      captainSkills: d.captainSkills,
      captainBackstory: d.captainBackstory,
      shipClass: d.shipClass,
      captainRole: d.captainRole,
    })
      .then(function (result) {
        VO.state.generatedCrew = result.data.crew;
        _renderCrewCards(container, VO.state.generatedCrew);
      })
      .catch(function (err) {
        console.error('voidOdysseyGenerateCrew error:', err);
        container.innerHTML =
          '<h2 class="wizard-step-title">Something Went Wrong</h2>' +
          '<p class="wizard-error">' +
          _esc(err.message || 'Failed to generate crew. Please try again.') +
          '</p>' +
          '<div class="wizard-nav">' +
          '<button type="button" class="btn btn-secondary" id="step5-retry">&#8592; Try Again</button>' +
          '</div>';
        document.getElementById('step5-retry').addEventListener('click', function () {
          VO.state.generatedCrew = null;
          VO.state.pendingOpening = null;
          VO.renderWizardStep(5);
        });
      });
  }

  function _renderCrewCards(container, crew) {
    var html =
      '<h2 class="wizard-step-title">Meet Your Crew</h2>' +
      '<p class="wizard-step-desc">' +
      'The Oracle has assembled your starting crew. Edit names or bios before continuing.' +
      '</p>' +
      '<div class="crew-preview-list">';

    (crew || []).forEach(function (member, i) {
      html +=
        '<div class="crew-preview-card" data-crew-index="' +
        i +
        '">' +
        '<div class="crew-preview-header">' +
        '<input' +
        ' type="text"' +
        ' class="crew-preview-name-input"' +
        ' data-crew-index="' +
        i +
        '"' +
        ' maxlength="60"' +
        ' value="' +
        _esc(member.name) +
        '"' +
        ' aria-label="Crew member name"' +
        ' />' +
        '<span class="crew-preview-role">' +
        _esc(member.role) +
        '</span>' +
        '</div>' +
        '<textarea' +
        ' class="crew-preview-bio-input"' +
        ' data-crew-index="' +
        i +
        '"' +
        ' maxlength="500"' +
        ' rows="3"' +
        ' aria-label="Crew member bio"' +
        '>' +
        _esc(member.description) +
        '</textarea>' +
        '</div>';
    });

    html +=
      '</div>' +
      '<div class="wizard-nav">' +
      '<button type="button" class="btn btn-secondary" id="step5-regenerate">Regenerate</button>' +
      '<button type="button" class="btn btn-primary" id="step5-next">Continue &rarr;</button>' +
      '</div>';

    container.innerHTML = html;

    // Sync name edits back into VO.state.generatedCrew
    container.querySelectorAll('.crew-preview-name-input').forEach(function (input) {
      input.addEventListener('input', function () {
        var idx = parseInt(input.dataset.crewIndex, 10);
        if (VO.state.generatedCrew && VO.state.generatedCrew[idx] !== undefined) {
          VO.state.generatedCrew[idx].name = input.value;
        }
      });
    });

    // Sync bio edits back into VO.state.generatedCrew
    container.querySelectorAll('.crew-preview-bio-input').forEach(function (textarea) {
      textarea.addEventListener('input', function () {
        var idx = parseInt(textarea.dataset.crewIndex, 10);
        if (VO.state.generatedCrew && VO.state.generatedCrew[idx] !== undefined) {
          VO.state.generatedCrew[idx].description = textarea.value;
        }
      });
    });

    document.getElementById('step5-regenerate').addEventListener('click', function () {
      VO.state.generatedCrew = null;
      VO.state.pendingOpening = null;
      VO.renderWizardStep(5);
    });

    document.getElementById('step5-next').addEventListener('click', function () {
      VO.renderWizardStep(6);
    });
  }

  // Step 6: Two-phase game creation.
  //   Phase A: calls voidOdysseyGenerateOpening (AI only) → caches result in VO.state.pendingOpening
  //   Phase B: "Begin Your Journey" calls voidOdysseyCommitGame (Firestore write) → transitions to game
  function _renderStep6(container) {
    var d = VO.state.wizardData;

    // Guard: need generated crew from Step 5
    if (!VO.state.generatedCrew) {
      VO.renderWizardStep(5);
      return;
    }

    // Already committed — show scene with transition button only
    if (VO.state.generatedGame) {
      _renderOpeningScene(container, VO.state.pendingOpening || VO.state.generatedGame);
      return;
    }

    // Phase A already done — show cached scene again (e.g. user stepped back/forward)
    if (VO.state.pendingOpening) {
      _renderOpeningScene(container, VO.state.pendingOpening);
      return;
    }

    // Phase A: generate opening scene via AI (no Firestore write)
    container.innerHTML =
      '<h2 class="wizard-step-title">Creating Your Campaign</h2>' +
      '<p class="wizard-step-desc">Generating your opening scene&hellip;</p>' +
      '<div class="wizard-generating">' +
      '<div class="app-spinner"></div>' +
      '<p class="wizard-generating-text">The Oracle is weaving your story&hellip;</p>' +
      '</div>';

    var fn = VO.state.functions.httpsCallable('voidOdysseyGenerateOpening');
    fn({
      difficulty: d.tone,
      captainName: d.captainName,
      captainTraits: d.captainTraits,
      captainSkills: d.captainSkills,
      captainBackstory: d.captainBackstory,
      shipClass: d.shipClass,
      shipName: d.shipName,
      captainRole: d.captainRole,
      crew: VO.state.generatedCrew,
    })
      .then(function (result) {
        VO.state.pendingOpening = result.data;
        _renderOpeningScene(container, result.data);
      })
      .catch(function (err) {
        console.error('voidOdysseyGenerateOpening error:', err);
        container.innerHTML =
          '<h2 class="wizard-step-title">Something Went Wrong</h2>' +
          '<p class="wizard-step-desc">The Oracle couldn\'t generate your opening scene.</p>' +
          '<p class="wizard-error">' +
          _esc(err.message || 'Failed to generate opening scene. Please try again.') +
          '</p>' +
          '<div class="wizard-nav">' +
          '<button type="button" class="btn btn-secondary" id="step6-back">&#8592; Back to Crew</button>' +
          '</div>';
        document.getElementById('step6-back').addEventListener('click', function () {
          VO.renderWizardStep(5);
        });
      });
  }

  function _renderOpeningScene(container, opening) {
    var actions = opening.availableActions || [];
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
      _escNarrative(opening.narrative) +
      '</p>' +
      '</div>' +
      '<div class="action-panel">' +
      '<p class="action-panel-label">What do you do?</p>' +
      '<div class="action-buttons">' +
      actionsHtml +
      '</div>' +
      '<p class="action-panel-note">(Full turn actions available in the game)</p>' +
      '</div>' +
      '<div id="step6-commit-error"></div>' +
      '<div class="wizard-nav wizard-nav--center">' +
      '<button type="button" class="btn btn-primary" id="step6-enter">Begin Your Journey &rarr;</button>' +
      '</div>';

    // If already committed, the button just transitions to the active game view
    if (VO.state.generatedGame) {
      document.getElementById('step6-enter').addEventListener('click', function () {
        VO.showView('game-active');
      });
      return;
    }

    // Phase B: commit all game data to Firestore
    document.getElementById('step6-enter').addEventListener('click', function _commitGame() {
      var btn = document.getElementById('step6-enter');
      var errEl = document.getElementById('step6-commit-error');
      if (!btn) return;

      btn.disabled = true;
      btn.textContent = 'Saving your campaign\u2026';
      errEl.innerHTML = '';

      var d = VO.state.wizardData;
      var commitFn = VO.state.functions.httpsCallable('voidOdysseyCommitGame');
      commitFn({
        difficulty: d.tone,
        captainName: d.captainName,
        captainTraits: d.captainTraits,
        captainSkills: d.captainSkills,
        captainBackstory: d.captainBackstory,
        shipClass: d.shipClass,
        shipName: d.shipName,
        captainRole: d.captainRole,
        crew: VO.state.generatedCrew,
        opening: opening,
      })
        .then(function (result) {
          VO.state.generatedGame = result.data;
          VO.showView('game-active');
        })
        .catch(function (err) {
          console.error('voidOdysseyCommitGame error:', err);
          btn.disabled = false;
          btn.textContent = 'Begin Your Journey \u2192';
          errEl.innerHTML =
            '<p class="wizard-error">' +
            _esc(err.message || 'Failed to save your campaign. Please try again.') +
            '</p>' +
            '<div class="wizard-nav wizard-nav--center">' +
            '<button type="button" class="btn btn-secondary" id="step6-retry">Try Again</button>' +
            '</div>';
          document.getElementById('step6-retry').addEventListener('click', function () {
            document.getElementById('step6-enter').click();
          });
        });
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
