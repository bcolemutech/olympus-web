(function () {
  'use strict';

  var Symposium = window.Symposium;
  var state = Symposium.state;

  // ── Module-level private state for selectors ───────────────────────────
  // Each ingredient entry: { id, name, amount, unit, optional }
  // Each equipment entry: { id, name }
  var _selectedIngredients = [];
  var _selectedEquipment = [];

  // ── Altar of Creation — private resolution state ────────────────────────
  // _altarRecipeId : Firestore ID of the recipe being resolved
  // _altarItems    : flat array of { type, index, name, amount?, unit?, optional? }
  // _altarTotal    : total count of items when altar was opened (for progress display)
  // _altarCursor   : index into _altarItems of the currently displayed step
  // _altarDupeTarget: { id, collection } when user picks "link to existing"
  var _altarRecipeId = null;
  var _altarItems = [];
  var _altarTotal = 0;
  var _altarCursor = 0;
  var _altarDupeTarget = null;

  // ── Stock lookup map (id → inStock) ────────────────────────────────────
  // Rebuilt once per render via _rebuildStockMap() to avoid O(n²) lookups.
  var _stockMap = null;

  function _rebuildStockMap() {
    _stockMap = {};
    state.allIngredients.forEach(function (i) {
      _stockMap[i.id] = i.inStock;
    });
  }

  // ── canMake computation ────────────────────────────────────────────────
  function _computeCanMake(recipeIngredients) {
    return recipeIngredients.every(function (ri) {
      if (ri.optional) return true;
      if (ri.pending) return true; // Pending ingredients not yet in cellar; don't block canMake
      return !!_stockMap[ri.id];
    });
  }

  // ── Three-state availability computation ───────────────────────────────
  // Returns 'green' (all in stock), 'amber' (all required in stock, some optional
  // missing), 'red' (at least one required ingredient out of stock), or
  // 'unknown' when ingredient data has not yet loaded.
  function _getAvailabilityStatus(recipeIngredients) {
    if (!state.ingredientsLoaded) return 'unknown';
    var linked = recipeIngredients.filter(function (ri) {
      return !ri.pending;
    });
    var hasRequiredMissing = linked.some(function (ri) {
      if (ri.optional) return false;
      return !_stockMap[ri.id];
    });
    if (hasRequiredMissing) return 'red';
    var hasOptionalMissing = linked.some(function (ri) {
      if (!ri.optional) return false;
      return !_stockMap[ri.id];
    });
    return hasOptionalMissing ? 'amber' : 'green';
  }

  // ── Ingredient selector helpers ────────────────────────────────────────
  function _filterIngredientSearch(query) {
    if (!query) return [];
    var q = query.toLowerCase();
    var alreadySelected = _selectedIngredients
      .filter(function (s) {
        return !s.pending;
      })
      .map(function (s) {
        return s.id;
      });
    return state.allIngredients
      .filter(function (ing) {
        if (alreadySelected.indexOf(ing.id) !== -1) return false;
        var catName = (
          state.categoryMap[ing.category] ? state.categoryMap[ing.category].name : ''
        ).toLowerCase();
        return ing.name.toLowerCase().indexOf(q) !== -1 || catName.indexOf(q) !== -1;
      })
      .slice(0, 10);
  }

  // ── Fuzzy-match helpers for duplicate detection ────────────────────────
  function _editDistance(a, b, maxDist) {
    var m = a.length,
      n = b.length;
    // Use two rolling arrays instead of a full matrix, and bail out early when
    // the minimum value in a row already exceeds maxDist (the distance can only
    // increase from that point on).
    var prev = [];
    var curr = [];
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      curr[0] = i;
      var rowMin = i;
      for (var j = 1; j <= n; j++) {
        curr[j] =
          a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
        if (curr[j] < rowMin) rowMin = curr[j];
      }
      if (maxDist !== undefined && rowMin > maxDist) return rowMin;
      var tmp = prev;
      prev = curr;
      curr = tmp;
    }
    return prev[n];
  }

  function _findCloseIngredientMatch(query) {
    var q = query.toLowerCase().trim();
    if (q.length < 3) return null;
    var alreadyLinkedIds = _selectedIngredients
      .filter(function (s) {
        return !s.pending;
      })
      .map(function (s) {
        return s.id;
      });
    return (
      state.allIngredients.find(function (ing) {
        if (alreadyLinkedIds.indexOf(ing.id) !== -1) return false;
        var name = ing.name.toLowerCase();
        if (name.indexOf(q) !== -1 || q.indexOf(name) !== -1) return true;
        if (Math.abs(name.length - q.length) > 5) return false;
        return _editDistance(name, q, 2) <= 2;
      }) || null
    );
  }

  function _renderIngredientDropdown(results, query) {
    var dropdown = Symposium.getRef('rec-ing-dropdown');
    dropdown.innerHTML = '';
    if (results.length === 0 && !query) {
      dropdown.classList.add('hidden');
      return;
    }
    if (results.length === 0 && query && !state.ingredientsLoaded) {
      // Ingredients haven't arrived from Firestore yet — don't offer pending entry
      var loadingEl = document.createElement('div');
      loadingEl.className = 'selector-dropdown-loading';
      loadingEl.textContent = 'Loading ingredients\u2026';
      dropdown.appendChild(loadingEl);
      dropdown.classList.remove('hidden');
      return;
    }
    if (results.length === 0 && query) {
      // Show "Summon from the Cornucopia" option
      var addItem = document.createElement('button');
      addItem.type = 'button';
      addItem.className = 'selector-dropdown-item selector-dropdown-add-new';
      addItem.textContent = '+ Summon from the Cornucopia: \u201c' + query + '\u201d';
      (function (q) {
        addItem.addEventListener('click', function () {
          _addPendingIngredient(q);
          Symposium.getRef('rec-ing-search').value = '';
          dropdown.classList.add('hidden');
          Symposium.getRef('rec-ing-search').focus();
        });
      })(query);
      dropdown.appendChild(addItem);

      // Fuzzy duplicate warning
      var closeMatch = _findCloseIngredientMatch(query);
      if (closeMatch) {
        var warnEl = document.createElement('div');
        warnEl.className = 'selector-dropdown-warning';
        warnEl.textContent = '\u26a0 Similar ingredient exists: ' + closeMatch.name;
        dropdown.appendChild(warnEl);
      }

      dropdown.classList.remove('hidden');
      return;
    }
    results.forEach(function (ing) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'selector-dropdown-item';
      var catName = state.categoryMap[ing.category]
        ? state.categoryMap[ing.category].name
        : ing.category;
      var nameSpan = document.createElement('span');
      nameSpan.className = 'selector-item-name';
      nameSpan.textContent = ing.name;
      var catBadge = document.createElement('span');
      catBadge.className = 'badge badge-category';
      catBadge.textContent = catName;
      item.appendChild(nameSpan);
      item.appendChild(catBadge);
      item.addEventListener('click', function () {
        _addIngredientToSelection(ing);
        Symposium.getRef('rec-ing-search').value = '';
        dropdown.classList.add('hidden');
        Symposium.getRef('rec-ing-search').focus();
      });
      dropdown.appendChild(item);
    });
    dropdown.classList.remove('hidden');
  }

  function _addIngredientToSelection(ing) {
    _selectedIngredients.push({
      id: ing.id,
      name: ing.name,
      amount: '',
      unit: ing.unit || 'oz',
      optional: false,
    });
    _renderSelectedIngredients();
    Symposium.recipes._setError('ingredients', '');
  }

  function _addPendingIngredient(name) {
    _selectedIngredients.push({
      name: name.trim(),
      amount: '',
      unit: 'oz',
      optional: false,
      pending: true,
    });
    _renderSelectedIngredients();
    Symposium.recipes._setError('ingredients', '');
  }

  function _renderSelectedIngredients() {
    var container = Symposium.getRef('rec-selected-ingredients');
    container.innerHTML = '';

    _selectedIngredients.forEach(function (sel, index) {
      var row = document.createElement('div');
      row.className = 'selected-item-row';

      var nameBadge = document.createElement('span');
      nameBadge.className = 'selected-item-name';
      nameBadge.textContent = sel.name;

      if (sel.pending) {
        var pendingBadge = document.createElement('span');
        pendingBadge.className = 'badge badge-pending';
        pendingBadge.textContent = 'Unnamed Offering';
        row.appendChild(nameBadge);
        row.appendChild(pendingBadge);
      } else {
        row.appendChild(nameBadge);
      }

      var amountInput = document.createElement('input');
      amountInput.type = 'text';
      amountInput.className = 'form-input selected-item-amount';
      amountInput.value = sel.amount;
      amountInput.placeholder = 'Amt';
      amountInput.setAttribute('aria-label', 'Amount for ' + sel.name);
      (function (i) {
        amountInput.addEventListener('input', function () {
          _selectedIngredients[i].amount = amountInput.value.trim();
        });
      })(index);

      var unitSelect = document.createElement('select');
      unitSelect.className = 'form-select selected-item-unit';
      unitSelect.setAttribute('aria-label', 'Unit for ' + sel.name);
      var units = [
        'oz',
        'ml',
        'dash',
        'each',
        'splash',
        'tsp',
        'tbsp',
        'barspoon',
        'rinse',
        'float',
      ];
      units.forEach(function (u) {
        var opt = document.createElement('option');
        opt.value = u;
        opt.textContent = u;
        if (u === sel.unit) opt.selected = true;
        unitSelect.appendChild(opt);
      });
      (function (i) {
        unitSelect.addEventListener('change', function () {
          _selectedIngredients[i].unit = unitSelect.value;
        });
      })(index);

      var optLabel = document.createElement('label');
      optLabel.className = 'selected-item-optional-label';
      var optCheck = document.createElement('input');
      optCheck.type = 'checkbox';
      optCheck.className = 'form-checkbox';
      optCheck.checked = sel.optional;
      optCheck.setAttribute('aria-label', 'Mark ' + sel.name + ' as optional');
      (function (i) {
        optCheck.addEventListener('change', function () {
          _selectedIngredients[i].optional = optCheck.checked;
        });
      })(index);
      optLabel.appendChild(optCheck);
      optLabel.appendChild(document.createTextNode('\u00a0Optional'));

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-icon btn-remove-item';
      removeBtn.textContent = '\u2715';
      removeBtn.setAttribute('aria-label', 'Remove ' + sel.name);
      (function (i) {
        removeBtn.addEventListener('click', function () {
          _selectedIngredients.splice(i, 1);
          _renderSelectedIngredients();
        });
      })(index);

      row.appendChild(amountInput);
      row.appendChild(unitSelect);
      row.appendChild(optLabel);
      row.appendChild(removeBtn);
      container.appendChild(row);
    });
  }

  // ── Equipment selector helpers ─────────────────────────────────────────
  function _filterEquipmentSearch(query) {
    if (!query) return [];
    var q = query.toLowerCase();
    var alreadyLinkedIds = _selectedEquipment
      .filter(function (s) {
        return !s.pending;
      })
      .map(function (s) {
        return s.id;
      });
    var alreadyPendingNames = _selectedEquipment
      .filter(function (s) {
        return s.pending;
      })
      .map(function (s) {
        return s.name.toLowerCase();
      });
    return state.allEquipment
      .filter(function (eq) {
        if (alreadyLinkedIds.indexOf(eq.id) !== -1) return false;
        var catName = (
          state.categoryMap[eq.category] ? state.categoryMap[eq.category].name : ''
        ).toLowerCase();
        return eq.name.toLowerCase().indexOf(q) !== -1 || catName.indexOf(q) !== -1;
      })
      .filter(function (eq) {
        return alreadyPendingNames.indexOf(eq.name.toLowerCase()) === -1;
      })
      .slice(0, 10);
  }

  function _findCloseEquipmentMatch(query) {
    var q = query.toLowerCase().trim();
    if (q.length < 3) return null;
    var alreadyLinkedIds = _selectedEquipment
      .filter(function (s) {
        return !s.pending;
      })
      .map(function (s) {
        return s.id;
      });
    return (
      state.allEquipment.find(function (eq) {
        if (alreadyLinkedIds.indexOf(eq.id) !== -1) return false;
        var name = eq.name.toLowerCase();
        if (name.indexOf(q) !== -1 || q.indexOf(name) !== -1) return true;
        if (Math.abs(name.length - q.length) > 5) return false;
        return _editDistance(name, q, 2) <= 2;
      }) || null
    );
  }

  function _renderEquipmentDropdown(results, query) {
    var dropdown = Symposium.getRef('rec-equip-dropdown');
    dropdown.innerHTML = '';
    if (results.length === 0 && !query) {
      dropdown.classList.add('hidden');
      return;
    }
    if (results.length === 0 && query && !state.equipmentLoaded) {
      var loadingEl = document.createElement('div');
      loadingEl.className = 'selector-dropdown-loading';
      loadingEl.textContent = 'Loading equipment\u2026';
      dropdown.appendChild(loadingEl);
      dropdown.classList.remove('hidden');
      return;
    }
    if (results.length === 0 && query) {
      var addItem = document.createElement('button');
      addItem.type = 'button';
      addItem.className = 'selector-dropdown-item selector-dropdown-add-new';
      addItem.textContent = '+ Add as new equipment: \u201c' + query + '\u201d';
      (function (q) {
        addItem.addEventListener('click', function () {
          _addPendingEquipment(q);
          Symposium.getRef('rec-equip-search').value = '';
          dropdown.classList.add('hidden');
          Symposium.getRef('rec-equip-search').focus();
        });
      })(query);
      dropdown.appendChild(addItem);

      var closeMatch = _findCloseEquipmentMatch(query);
      if (closeMatch) {
        var warnEl = document.createElement('div');
        warnEl.className = 'selector-dropdown-warning';
        warnEl.textContent = '\u26a0 Similar equipment exists: ' + closeMatch.name;
        dropdown.appendChild(warnEl);
      }

      dropdown.classList.remove('hidden');
      return;
    }
    results.forEach(function (eq) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'selector-dropdown-item';
      var catName = state.categoryMap[eq.category]
        ? state.categoryMap[eq.category].name
        : eq.category;
      var nameSpan = document.createElement('span');
      nameSpan.className = 'selector-item-name';
      nameSpan.textContent = eq.name;
      var catBadge = document.createElement('span');
      catBadge.className = 'badge badge-category badge-equipment-cat';
      catBadge.textContent = catName;
      item.appendChild(nameSpan);
      item.appendChild(catBadge);
      item.addEventListener('click', function () {
        _addEquipmentToSelection(eq);
        Symposium.getRef('rec-equip-search').value = '';
        dropdown.classList.add('hidden');
        Symposium.getRef('rec-equip-search').focus();
      });
      dropdown.appendChild(item);
    });
    dropdown.classList.remove('hidden');
  }

  function _addEquipmentToSelection(eq) {
    _selectedEquipment.push({ id: eq.id, name: eq.name });
    _renderSelectedEquipment();
  }

  function _addPendingEquipment(name) {
    _selectedEquipment.push({
      name: name.trim(),
      pending: true,
    });
    _renderSelectedEquipment();
  }

  function _renderSelectedEquipment() {
    var container = Symposium.getRef('rec-selected-equipment');
    container.innerHTML = '';
    _selectedEquipment.forEach(function (sel, index) {
      var row = document.createElement('div');
      row.className = 'selected-item-row';

      var nameBadge = document.createElement('span');
      nameBadge.className = 'selected-item-name';
      nameBadge.textContent = sel.name;

      if (sel.pending) {
        var pendingBadge = document.createElement('span');
        pendingBadge.className = 'badge badge-pending';
        pendingBadge.textContent = 'Uncharted Tool';
        row.appendChild(nameBadge);
        row.appendChild(pendingBadge);
      } else {
        row.appendChild(nameBadge);
      }

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-icon btn-remove-item';
      removeBtn.textContent = '\u2715';
      removeBtn.setAttribute('aria-label', 'Remove ' + sel.name);
      (function (i) {
        removeBtn.addEventListener('click', function () {
          _selectedEquipment.splice(i, 1);
          _renderSelectedEquipment();
        });
      })(index);

      row.appendChild(removeBtn);
      container.appendChild(row);
    });
  }

  // ── Detail view builder ────────────────────────────────────────────────
  function _makeDetailSection(title, content, usesPre) {
    var section = document.createElement('div');
    section.className = 'recipe-detail-section';
    var h3 = document.createElement('h3');
    h3.className = 'recipe-detail-section-title';
    h3.textContent = title;
    section.appendChild(h3);
    var contentEl = document.createElement(usesPre ? 'pre' : 'p');
    contentEl.className = usesPre ? 'recipe-detail-instructions' : 'recipe-detail-text';
    contentEl.textContent = content;
    section.appendChild(contentEl);
    return section;
  }

  function _buildDetailBody(recipe) {
    var frag = document.createDocumentFragment();

    // Meta badges
    var meta = document.createElement('div');
    meta.className = 'ingredient-meta recipe-detail-meta';

    var catBadge = document.createElement('span');
    catBadge.className = 'badge badge-category';
    catBadge.textContent = state.categoryMap[recipe.category]
      ? state.categoryMap[recipe.category].name
      : recipe.category;
    meta.appendChild(catBadge);

    if (recipe.subcategory) {
      var subBadge = document.createElement('span');
      subBadge.className = 'badge badge-subcategory';
      subBadge.textContent = recipe.subcategory;
      meta.appendChild(subBadge);
    }

    if (recipe.favorite) {
      var favBadge = document.createElement('span');
      favBadge.className = 'badge badge-favorite';
      favBadge.textContent = '\u2605 Favorite';
      meta.appendChild(favBadge);
    }

    frag.appendChild(meta);

    // Quick-details row
    var details = document.createElement('div');
    details.className = 'recipe-detail-quickrow';
    var quickItems = [
      ['Glassware', recipe.glassware],
      ['Servings', recipe.servings],
    ];
    if (recipe.garnish) {
      quickItems.push(['Garnish', recipe.garnish]);
    }
    quickItems.forEach(function (pair) {
      var item = document.createElement('span');
      var label = document.createElement('span');
      label.className = 'ingredient-detail-label';
      label.textContent = pair[0] + ': ';
      item.appendChild(label);
      item.appendChild(document.createTextNode(pair[1]));
      details.appendChild(item);
    });
    frag.appendChild(details);

    // Description
    if (recipe.description) {
      frag.appendChild(_makeDetailSection('Description', recipe.description, false));
    }

    // Ingredients list
    var ingSection = document.createElement('div');
    ingSection.className = 'recipe-detail-section';
    var ingTitle = document.createElement('h3');
    ingTitle.className = 'recipe-detail-section-title';
    ingTitle.textContent = 'Ingredients';
    ingSection.appendChild(ingTitle);

    var ingUl = document.createElement('ul');
    ingUl.className = 'recipe-detail-ingredients-list';
    (recipe.ingredients || []).forEach(function (ri) {
      var li = document.createElement('li');
      li.className = 'recipe-detail-ingredient-item';

      var amountText = ri.amount ? ri.amount + '\u00a0' + ri.unit + '\u00a0' : '';
      var optText = ri.optional ? ' (optional)' : '';

      if (ri.pending) {
        var pendingDot = document.createElement('span');
        pendingDot.className = 'recipe-stock-dot stock-dot-pending';
        pendingDot.setAttribute('aria-hidden', 'true');
        li.appendChild(pendingDot);
        li.appendChild(document.createTextNode(amountText + ri.name + optText));
        var pendingTag = document.createElement('span');
        pendingTag.className = 'badge badge-pending';
        pendingTag.textContent = 'Unnamed Offering';
        li.appendChild(document.createTextNode('\u00a0'));
        li.appendChild(pendingTag);
      } else {
        var ing = state.allIngredients.find(function (i) {
          return i.id === ri.id;
        });
        var dot = document.createElement('span');
        dot.className =
          'recipe-stock-dot ' + (ing && ing.inStock ? 'stock-dot-in' : 'stock-dot-out');
        dot.setAttribute('aria-hidden', 'true');
        var ingName = ing ? ing.name : ri.id;
        li.appendChild(dot);
        li.appendChild(document.createTextNode(amountText + ingName + optText));
      }

      ingUl.appendChild(li);
    });
    ingSection.appendChild(ingUl);

    // "Add missing to shopping list" button
    // Only shown when stock data is loaded; only includes known out-of-stock ingredients.
    var missingRefs = state.ingredientsLoaded
      ? (recipe.ingredients || []).filter(function (ri) {
          return !ri.pending && _stockMap.hasOwnProperty(ri.id) && !_stockMap[ri.id];
        })
      : [];
    if (missingRefs.length > 0) {
      var shoppingBtn = document.createElement('button');
      shoppingBtn.type = 'button';
      shoppingBtn.className = 'btn btn-outline recipe-shopping-btn';
      shoppingBtn.textContent =
        'Add ' +
        missingRefs.length +
        ' missing ingredient' +
        (missingRefs.length > 1 ? 's' : '') +
        ' to shopping list';
      (function (refs, btn) {
        btn.addEventListener('click', function () {
          btn.disabled = true;
          Symposium.recipes
            .addMissingToShoppingList(refs)
            .then(function () {
              btn.textContent = 'Added to shopping list';
            })
            .catch(function () {
              btn.disabled = false;
              btn.textContent = 'Failed \u2013 tap to retry';
            });
        });
      })(missingRefs, shoppingBtn);
      ingSection.appendChild(shoppingBtn);
    }

    frag.appendChild(ingSection);

    // Equipment list (if any)
    if (recipe.equipment && recipe.equipment.length > 0) {
      var eqSection = document.createElement('div');
      eqSection.className = 'recipe-detail-section';
      var eqTitle = document.createElement('h3');
      eqTitle.className = 'recipe-detail-section-title';
      eqTitle.textContent = 'Equipment';
      eqSection.appendChild(eqTitle);

      var eqUl = document.createElement('ul');
      eqUl.className = 'recipe-detail-equipment-list';
      recipe.equipment.forEach(function (re) {
        var li = document.createElement('li');
        if (re.pending) {
          li.appendChild(document.createTextNode(re.name + '\u00a0'));
          var pendingTag = document.createElement('span');
          pendingTag.className = 'badge badge-pending';
          pendingTag.textContent = 'Uncharted Tool';
          li.appendChild(pendingTag);
        } else {
          var eq = state.allEquipment.find(function (e) {
            return e.id === re.id;
          });
          li.textContent = eq ? eq.name : re.id;
        }
        eqUl.appendChild(li);
      });
      eqSection.appendChild(eqUl);
      frag.appendChild(eqSection);
    }

    // Instructions (scrollable pre block)
    frag.appendChild(_makeDetailSection('Instructions', recipe.instructions, true));

    // Source
    if (recipe.source) {
      frag.appendChild(_makeDetailSection('Source', recipe.source, false));
    }

    // Tags
    if (recipe.tags && recipe.tags.length > 0) {
      var tagsDiv = document.createElement('div');
      tagsDiv.className = 'ingredient-meta recipe-detail-tags';
      recipe.tags.forEach(function (tag) {
        var tagBadge = document.createElement('span');
        tagBadge.className = 'badge badge-subcategory';
        tagBadge.textContent = tag;
        tagsDiv.appendChild(tagBadge);
      });
      frag.appendChild(tagsDiv);
    }

    return frag;
  }

  // ── Altar of Creation helpers ───────────────────────────────────────────

  function _buildAltarItems(recipe) {
    var items = [];
    (recipe.ingredients || []).forEach(function (ri, idx) {
      if (ri.pending) {
        items.push({
          type: 'ingredient',
          index: idx,
          name: ri.name,
          amount: ri.amount || '',
          unit: ri.unit || 'oz',
          optional: !!ri.optional,
        });
      }
    });
    (recipe.equipment || []).forEach(function (re, idx) {
      if (re.pending) {
        items.push({
          type: 'equipment',
          index: idx,
          name: re.name,
        });
      }
    });
    return items;
  }

  function _findDuplicateIngredient(name) {
    var q = name.toLowerCase().trim();
    var exact = state.allIngredients.find(function (ing) {
      return ing.name.toLowerCase() === q;
    });
    if (exact) return exact;
    if (q.length < 3) return null;
    return (
      state.allIngredients.find(function (ing) {
        var n = ing.name.toLowerCase();
        if (n.indexOf(q) !== -1 || q.indexOf(n) !== -1) return true;
        if (Math.abs(n.length - q.length) > 5) return false;
        return _editDistance(n, q, 2) <= 2;
      }) || null
    );
  }

  function _findDuplicateEquipment(name) {
    var q = name.toLowerCase().trim();
    var exact = state.allEquipment.find(function (eq) {
      return eq.name.toLowerCase() === q;
    });
    if (exact) return exact;
    if (q.length < 3) return null;
    return (
      state.allEquipment.find(function (eq) {
        var n = eq.name.toLowerCase();
        if (n.indexOf(q) !== -1 || q.indexOf(n) !== -1) return true;
        if (Math.abs(n.length - q.length) > 5) return false;
        return _editDistance(n, q, 2) <= 2;
      }) || null
    );
  }

  function _validateAltarStep(item) {
    var catEl = document.getElementById('altar-field-category');
    var subEl = document.getElementById('altar-field-subcategory');
    var errCat = document.getElementById('altar-error-category');
    var errSub = document.getElementById('altar-error-subcategory');
    var valid = true;

    if (errCat) errCat.textContent = '';
    if (errSub) errSub.textContent = '';

    if (!catEl || !catEl.value) {
      if (errCat) errCat.textContent = 'Category is required';
      valid = false;
    }
    if (!subEl || !subEl.value) {
      if (errSub) errSub.textContent = 'Subcategory is required';
      valid = false;
    }

    if (item.type === 'ingredient') {
      var unitEl = document.getElementById('altar-field-unit');
      var errUnit = document.getElementById('altar-error-unit');
      if (errUnit) errUnit.textContent = '';
      if (!unitEl || !unitEl.value) {
        if (errUnit) errUnit.textContent = 'Unit is required';
        valid = false;
      }
    }

    return valid;
  }

  function _renderAltarStep() {
    if (_altarCursor >= _altarItems.length) {
      // All items processed — close
      Symposium.recipes.closeAltar();
      return;
    }

    var item = _altarItems[_altarCursor];
    var stepNum = _altarCursor + 1;

    document.getElementById('altar-subtitle').textContent =
      (item.type === 'ingredient' ? 'Ingredient' : 'Equipment') + ': ' + item.name;
    document.getElementById('altar-progress').textContent =
      'Item ' + stepNum + ' of ' + _altarTotal;

    // Duplicate detection
    _altarDupeTarget = null;
    var dupeWarningEl = document.getElementById('altar-dupe-warning');
    var dupe =
      item.type === 'ingredient'
        ? _findDuplicateIngredient(item.name)
        : _findDuplicateEquipment(item.name);

    if (dupe) {
      document.getElementById('altar-dupe-warning-text').textContent =
        'Similar item already exists: \u201c' + dupe.name + '\u201d';
      var dupeLinkBtn = document.getElementById('altar-dupe-link-btn');
      dupeLinkBtn.textContent = 'Link to existing instead';
      dupeLinkBtn.classList.remove('hidden');
      dupeWarningEl.classList.remove('hidden');
      // Store candidate for _triggerDupeLink
      dupeWarningEl.dataset.dupeId = dupe.id;
      dupeWarningEl.dataset.dupeCollection =
        item.type === 'ingredient' ? 'symposium_ingredients' : 'symposium_equipment';
    } else {
      dupeWarningEl.classList.add('hidden');
      delete dupeWarningEl.dataset.dupeId;
      delete dupeWarningEl.dataset.dupeCollection;
    }

    // Build form
    var container = document.getElementById('altar-form-container');
    container.innerHTML = '';

    var grid = document.createElement('div');
    grid.className = 'altar-form-grid';

    // Name (read-only)
    var nameGroup = document.createElement('div');
    nameGroup.className = 'altar-form-group altar-name-field';
    var nameLabel = document.createElement('label');
    nameLabel.className = 'form-label';
    nameLabel.textContent = 'Name';
    var nameVal = document.createElement('span');
    nameVal.className = 'altar-name-value';
    nameVal.textContent = item.name;
    nameGroup.appendChild(nameLabel);
    nameGroup.appendChild(nameVal);
    grid.appendChild(nameGroup);

    // Category
    var catGroup = document.createElement('div');
    catGroup.className = 'altar-form-group';
    var catLabel = document.createElement('label');
    catLabel.className = 'form-label';
    catLabel.setAttribute('for', 'altar-field-category');
    catLabel.textContent = 'Category';
    var catSelect = document.createElement('select');
    catSelect.className = 'form-select';
    catSelect.id = 'altar-field-category';
    var catPlaceholder = document.createElement('option');
    catPlaceholder.value = '';
    catPlaceholder.textContent = 'Select\u2026';
    catSelect.appendChild(catPlaceholder);
    var catMap =
      item.type === 'ingredient' ? state.ingredientCategoryMap : state.equipmentCategoryMap;
    Object.keys(catMap).forEach(function (id) {
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = catMap[id].name;
      catSelect.appendChild(opt);
    });
    catSelect.addEventListener('change', function () {
      var subEl = document.getElementById('altar-field-subcategory');
      if (subEl) Symposium.populateSubcategoryDropdown(catSelect.value, subEl);
    });
    var catErr = document.createElement('span');
    catErr.className = 'form-error';
    catErr.id = 'altar-error-category';
    catGroup.appendChild(catLabel);
    catGroup.appendChild(catSelect);
    catGroup.appendChild(catErr);
    grid.appendChild(catGroup);

    // Subcategory
    var subGroup = document.createElement('div');
    subGroup.className = 'altar-form-group';
    var subLabel = document.createElement('label');
    subLabel.className = 'form-label';
    subLabel.setAttribute('for', 'altar-field-subcategory');
    subLabel.textContent = 'Subcategory';
    var subSelect = document.createElement('select');
    subSelect.className = 'form-select';
    subSelect.id = 'altar-field-subcategory';
    subSelect.innerHTML = '<option value="">Select category first</option>';
    var subErr = document.createElement('span');
    subErr.className = 'form-error';
    subErr.id = 'altar-error-subcategory';
    subGroup.appendChild(subLabel);
    subGroup.appendChild(subSelect);
    subGroup.appendChild(subErr);
    grid.appendChild(subGroup);

    if (item.type === 'ingredient') {
      // Unit
      var unitGroup = document.createElement('div');
      unitGroup.className = 'altar-form-group';
      var unitLabel = document.createElement('label');
      unitLabel.className = 'form-label';
      unitLabel.setAttribute('for', 'altar-field-unit');
      unitLabel.textContent = 'Unit';
      var unitSelect = document.createElement('select');
      unitSelect.className = 'form-select';
      unitSelect.id = 'altar-field-unit';
      ['oz', 'ml', 'dash', 'splash', 'each'].forEach(function (u) {
        var opt = document.createElement('option');
        opt.value = u;
        opt.textContent = u;
        if (u === item.unit) opt.selected = true;
        unitSelect.appendChild(opt);
      });
      var unitErr = document.createElement('span');
      unitErr.className = 'form-error';
      unitErr.id = 'altar-error-unit';
      unitGroup.appendChild(unitLabel);
      unitGroup.appendChild(unitSelect);
      unitGroup.appendChild(unitErr);
      grid.appendChild(unitGroup);

      // In Stock
      var instockLabel = document.createElement('label');
      instockLabel.className = 'altar-instock-label';
      var instockCheck = document.createElement('input');
      instockCheck.type = 'checkbox';
      instockCheck.className = 'form-checkbox';
      instockCheck.id = 'altar-field-instock';
      instockLabel.appendChild(instockCheck);
      instockLabel.appendChild(document.createTextNode('\u00a0In Stock'));
      grid.appendChild(instockLabel);
    }

    container.appendChild(grid);

    // Reset submit button text
    var submitBtn = document.getElementById('btn-altar-submit');
    if (submitBtn) submitBtn.textContent = 'The Offering is Accepted';
  }

  function _advanceAltarCursor() {
    _altarCursor++;
    // Skip items that are already resolved in the live recipe
    while (_altarCursor < _altarItems.length) {
      var liveRecipe = state.allRecipes.find(function (r) {
        return r.id === _altarRecipeId;
      });
      if (!liveRecipe) break;
      var item = _altarItems[_altarCursor];
      var stillPending =
        item.type === 'ingredient'
          ? (liveRecipe.ingredients || []).some(function (ri) {
              return ri.pending && ri.name === item.name;
            })
          : (liveRecipe.equipment || []).some(function (re) {
              return re.pending && re.name === item.name;
            });
      if (stillPending) break;
      _altarCursor++;
    }
    _altarDupeTarget = null;
    if (_altarCursor >= _altarItems.length) {
      Symposium.recipes.closeAltar();
    } else {
      _renderAltarStep();
    }
  }

  function _submitAltarStep() {
    // If user has chosen "link to existing", delegate
    if (_altarDupeTarget) {
      _linkExistingItem(_altarDupeTarget.id);
      return;
    }

    var item = _altarItems[_altarCursor];
    if (!_validateAltarStep(item)) return;

    var category = document.getElementById('altar-field-category').value;
    var subcategory = document.getElementById('altar-field-subcategory').value;

    // Fetch live recipe
    var liveRecipe = state.allRecipes.find(function (r) {
      return r.id === _altarRecipeId;
    });
    if (!liveRecipe) {
      var errEl = document.getElementById('altar-error-category');
      if (errEl) errEl.textContent = 'Recipe not found. It may have been deleted.';
      return;
    }

    var submitBtn = document.getElementById('btn-altar-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating\u2026';

    var batch = state.db.batch();
    var recipeRef = state.db.collection('symposium_recipes').doc(_altarRecipeId);
    var updatedIngredients = (liveRecipe.ingredients || []).slice();
    var updatedEquipment = (liveRecipe.equipment || []).slice();
    var newPendingCount = Math.max(0, (liveRecipe.pendingCount || 0) - 1);

    if (item.type === 'ingredient') {
      var unitEl = document.getElementById('altar-field-unit');
      var unit = unitEl ? unitEl.value : 'oz';
      var instockEl = document.getElementById('altar-field-instock');
      var isInStock = instockEl ? instockEl.checked : false;
      var trackingType = Symposium.inferTrackingType(unit);
      var stock = trackingType === 'volume' && isInStock ? 1 : 0;
      var qty = trackingType === 'quantity' && isInStock ? 1 : 0;

      var ingData = {
        name: item.name,
        category: category,
        subcategory: subcategory,
        tags: [],
        unit: unit,
        type: 'consumable',
        trackingType: trackingType,
        stock: stock,
        bottleSize: 750,
        bottleSizeUnit: 'ml',
        quantity: qty,
        inStock: Symposium.computeInStock(trackingType, stock, qty),
        notes: '',
        shoppingListDefault: false,
        lowStockThreshold: 0,
        createdAt: state.serverTimestamp(),
        updatedAt: state.serverTimestamp(),
      };

      var newIngRef = state.db.collection('symposium_ingredients').doc();
      batch.set(newIngRef, ingData);

      // Replace the pending entry in the ingredients array by name match (first occurrence)
      var matched = false;
      updatedIngredients = updatedIngredients.map(function (ri) {
        if (!matched && ri.pending && ri.name === item.name) {
          matched = true;
          return {
            id: newIngRef.id,
            amount: item.amount,
            unit: item.unit,
            optional: item.optional,
          };
        }
        return ri;
      });
    } else {
      var eqData = {
        name: item.name,
        category: category,
        subcategory: subcategory,
        tags: [],
        type: 'reusable',
        quantity: 1,
        condition: 'good',
        notes: '',
        createdAt: state.serverTimestamp(),
        updatedAt: state.serverTimestamp(),
      };

      var newEqRef = state.db.collection('symposium_equipment').doc();
      batch.set(newEqRef, eqData);

      var matchedEq = false;
      updatedEquipment = updatedEquipment.map(function (re) {
        if (!matchedEq && re.pending && re.name === item.name) {
          matchedEq = true;
          return { id: newEqRef.id };
        }
        return re;
      });
    }

    var newCanMake = _computeCanMake(updatedIngredients);

    batch.update(recipeRef, {
      ingredients: updatedIngredients,
      equipment: updatedEquipment,
      pendingCount: newPendingCount,
      canMake: newCanMake,
      updatedAt: state.serverTimestamp(),
    });

    batch
      .commit()
      .then(function () {
        _advanceAltarCursor();
      })
      .catch(function (err) {
        console.error('Failed to resolve pending item:', err);
        var errEl = document.getElementById('altar-error-category');
        if (errEl) errEl.textContent = 'Failed to save. Please try again.';
      })
      .finally(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'The Offering is Accepted';
        }
      });
  }

  function _linkExistingItem(existingId) {
    var item = _altarItems[_altarCursor];

    var liveRecipe = state.allRecipes.find(function (r) {
      return r.id === _altarRecipeId;
    });
    if (!liveRecipe) {
      _advanceAltarCursor();
      return;
    }

    var submitBtn = document.getElementById('btn-altar-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Linking\u2026';

    var updatedIngredients = (liveRecipe.ingredients || []).slice();
    var updatedEquipment = (liveRecipe.equipment || []).slice();
    var newPendingCount = Math.max(0, (liveRecipe.pendingCount || 0) - 1);

    if (item.type === 'ingredient') {
      var matchedIng = false;
      updatedIngredients = updatedIngredients.map(function (ri) {
        if (!matchedIng && ri.pending && ri.name === item.name) {
          matchedIng = true;
          return { id: existingId, amount: item.amount, unit: item.unit, optional: item.optional };
        }
        return ri;
      });
    } else {
      var matchedEqLink = false;
      updatedEquipment = updatedEquipment.map(function (re) {
        if (!matchedEqLink && re.pending && re.name === item.name) {
          matchedEqLink = true;
          return { id: existingId };
        }
        return re;
      });
    }

    var newCanMake = _computeCanMake(updatedIngredients);
    var recipeRef = state.db.collection('symposium_recipes').doc(_altarRecipeId);

    recipeRef
      .update({
        ingredients: updatedIngredients,
        equipment: updatedEquipment,
        pendingCount: newPendingCount,
        canMake: newCanMake,
        updatedAt: state.serverTimestamp(),
      })
      .then(function () {
        _advanceAltarCursor();
      })
      .catch(function (err) {
        console.error('Failed to link existing item:', err);
        var errEl = document.getElementById('altar-error-category');
        if (errEl) errEl.textContent = 'Failed to link. Please try again.';
      })
      .finally(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Link to Existing';
        }
      });
  }

  function _waitForRecipeAndOpenAltar(recipeId) {
    var attempts = 0;
    var maxAttempts = 20;
    function tryOpen() {
      attempts++;
      var recipe = state.allRecipes.find(function (r) {
        return r.id === recipeId;
      });
      if (recipe) {
        Symposium.recipes.openAltar(recipe);
      } else if (attempts < maxAttempts) {
        window.setTimeout(tryOpen, 100);
      }
      // If maxAttempts reached silently give up — user can open from detail view
    }
    tryOpen();
  }

  // ── Main module ────────────────────────────────────────────────────────
  Symposium.recipes = {
    renderCategoryGrid: function () {
      var gridEl = Symposium.getRef('category-grid-recipe');
      gridEl.innerHTML = '';

      gridEl.appendChild(
        Symposium.makeCategoryCard(
          'all',
          'All',
          state.allRecipes.length,
          state.recipeActiveFilter === 'all',
          function (id) {
            state.recipeActiveFilter = id;
            Symposium.recipes.renderCategoryGrid();
            Symposium.recipes.renderList();
          }
        )
      );

      Object.keys(state.recipeCategoryMap).forEach(function (id) {
        var count = state.allRecipes.filter(function (r) {
          return r.category === id;
        }).length;
        gridEl.appendChild(
          Symposium.makeCategoryCard(
            id,
            state.recipeCategoryMap[id].name,
            count,
            state.recipeActiveFilter === id,
            function (catId) {
              state.recipeActiveFilter = catId;
              Symposium.recipes.renderCategoryGrid();
              Symposium.recipes.renderList();
            }
          )
        );
      });
    },

    renderList: function () {
      _rebuildStockMap();
      var result = state.allRecipes.slice();

      // 1. Category filter
      if (state.recipeActiveFilter !== 'all') {
        result = result.filter(function (r) {
          return r.category === state.recipeActiveFilter;
        });
      }

      // 2. Search filter
      if (state.recipeSearchQuery) {
        var q = state.recipeSearchQuery.toLowerCase();
        result = result.filter(function (r) {
          var catName = (
            state.categoryMap[r.category] ? state.categoryMap[r.category].name : ''
          ).toLowerCase();
          var tagHit =
            r.tags &&
            r.tags.some(function (t) {
              return t.toLowerCase().indexOf(q) !== -1;
            });
          return r.name.toLowerCase().indexOf(q) !== -1 || catName.indexOf(q) !== -1 || tagHit;
        });
      }

      // 3. Favorite filter
      if (state.recipeFavoriteFilter) {
        result = result.filter(function (r) {
          return r.favorite;
        });
      }

      // 3b. Can Make filter
      if (state.recipeCanMakeFilter) {
        result = result.filter(function (r) {
          return r.canMake;
        });
      }

      // 3c. Pending items filter
      if (state.recipePendingFilter) {
        result = result.filter(function (r) {
          return r.pendingCount > 0;
        });
      }

      // 4. Sort
      if (state.recipeSortOption === 'alpha') {
        result.sort(function (a, b) {
          return a.name.localeCompare(b.name);
        });
      } else if (state.recipeSortOption === 'favorite') {
        result.sort(function (a, b) {
          if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      } else {
        // 'category'
        result.sort(function (a, b) {
          var catA = state.categoryMap[a.category];
          var catB = state.categoryMap[b.category];
          var orderA =
            catA && typeof catA.sortOrder === 'number' ? catA.sortOrder : Number.MAX_SAFE_INTEGER;
          var orderB =
            catB && typeof catB.sortOrder === 'number' ? catB.sortOrder : Number.MAX_SAFE_INTEGER;
          if (orderA !== orderB) return orderA - orderB;
          return a.name.localeCompare(b.name);
        });
      }

      Symposium.renderListSection({
        items: result,
        listEl: Symposium.getRef('recipe-list'),
        emptyEl: Symposium.getRef('empty-state-recipe'),
        countEl: Symposium.getRef('recipe-count'),
        renderCard: Symposium.recipes.renderCard,
        noun: 'recipe',
        getEmptyMessage: function () {
          if (state.recipeSearchQuery) return 'No recipes match that search.';
          if (state.recipeCanMakeFilter)
            return 'No recipes are currently makeable with your stock.';
          if (state.recipePendingFilter) return 'No recipes have items awaiting creation.';
          if (state.recipeFavoriteFilter) return 'No favorites yet. Star a recipe to save it here.';
          if (state.recipeActiveFilter !== 'all' && state.allRecipes.length > 0)
            return 'No recipes in this category yet.';
          return 'The Libations await their first offering.';
        },
      });
      Symposium.recipes.renderPendingBanner();
    },

    renderPendingBanner: function () {
      var banner = Symposium.getRef('pending-banner');
      var count = state.allRecipes.filter(function (r) {
        return r.pendingCount > 0;
      }).length;
      if (count === 0) {
        banner.classList.add('hidden');
        return;
      }
      banner.classList.remove('hidden');
      Symposium.getRef('pending-banner-text').textContent =
        count + (count === 1 ? ' recipe has' : ' recipes have') + ' items awaiting creation.';
    },

    renderCard: function (recipe) {
      var card = document.createElement('div');
      card.className = 'recipe-card' + (recipe.favorite ? ' recipe-card-favorite' : '');

      var header = document.createElement('div');
      header.className = 'recipe-card-header';

      var info = document.createElement('div');
      info.className = 'recipe-card-info';

      // Title row
      var titleRow = document.createElement('div');
      titleRow.className = 'recipe-card-title-row';
      if (recipe.favorite) {
        var starSpan = document.createElement('span');
        starSpan.className = 'recipe-favorite-star';
        starSpan.textContent = '\u2605';
        starSpan.setAttribute('aria-label', 'Favorite');
        titleRow.appendChild(starSpan);
      }
      var name = document.createElement('h3');
      name.className = 'recipe-name';
      name.textContent = recipe.name;
      titleRow.appendChild(name);
      info.appendChild(titleRow);

      // Badges row
      var meta = document.createElement('div');
      meta.className = 'ingredient-meta';

      var catBadge = document.createElement('span');
      catBadge.className = 'badge badge-category';
      catBadge.textContent = state.categoryMap[recipe.category]
        ? state.categoryMap[recipe.category].name
        : recipe.category;
      meta.appendChild(catBadge);

      if (recipe.subcategory) {
        var subBadge = document.createElement('span');
        subBadge.className = 'badge badge-subcategory';
        subBadge.textContent = recipe.subcategory;
        meta.appendChild(subBadge);
      }

      // Availability badge (omitted until ingredient stock data has loaded)
      var availStatus = _getAvailabilityStatus(recipe.ingredients || []);
      if (availStatus !== 'unknown') {
        var statusLabels = { green: 'Can Make', amber: 'Missing Optionals', red: "Can't Make" };
        var availBadge = document.createElement('span');
        availBadge.className = 'badge badge-availability-' + availStatus;
        availBadge.textContent = statusLabels[availStatus];
        meta.appendChild(availBadge);
      }

      // Pending items badge
      if (recipe.pendingCount > 0) {
        var pendingBadge = document.createElement('span');
        pendingBadge.className = 'badge badge-pending';
        pendingBadge.textContent = recipe.pendingCount + ' awaiting altar';
        meta.appendChild(pendingBadge);
      }

      info.appendChild(meta);

      // Quick-info line
      var quickInfo = document.createElement('div');
      quickInfo.className = 'recipe-quick-info';
      var ingCount = (recipe.ingredients || []).length;
      quickInfo.textContent =
        recipe.glassware +
        ' \u00b7 ' +
        recipe.servings +
        (recipe.servings === 1 ? ' serving' : ' servings') +
        ' \u00b7 ' +
        ingCount +
        (ingCount === 1 ? ' ingredient' : ' ingredients');
      info.appendChild(quickInfo);

      // Actions
      var actions = document.createElement('div');
      actions.className = 'ingredient-actions';

      var viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn-icon';
      viewBtn.textContent = 'View';
      viewBtn.addEventListener('click', function () {
        Symposium.recipes.openDetail(recipe);
      });

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-icon btn-edit';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', function () {
        Symposium.recipes.openModal(recipe);
      });

      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-icon btn-delete';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function () {
        Symposium.recipes.handleDelete(recipe);
      });

      actions.appendChild(viewBtn);
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      header.appendChild(info);
      header.appendChild(actions);
      card.appendChild(header);

      return card;
    },

    populateCategorySelect: function () {
      var sel = Symposium.getRef('rec-field-category');
      while (sel.options.length > 1) sel.remove(1);
      Object.keys(state.recipeCategoryMap).forEach(function (id) {
        var opt = document.createElement('option');
        opt.value = id;
        opt.textContent = state.recipeCategoryMap[id].name;
        sel.appendChild(opt);
      });
    },

    openModal: function (recipe) {
      state.recipeEditingId = recipe ? recipe.id : null;
      Symposium.getRef('modal-title-recipe').textContent = recipe ? 'Edit Recipe' : 'Add Recipe';

      // Reset selectors
      _selectedIngredients = [];
      _selectedEquipment = [];
      Symposium.getRef('rec-ing-search').value = '';
      Symposium.getRef('rec-equip-search').value = '';
      Symposium.getRef('rec-ing-dropdown').classList.add('hidden');
      Symposium.getRef('rec-equip-dropdown').classList.add('hidden');

      Symposium.recipes._clearErrors();

      var formEl = Symposium.getRef('recipe-form');

      if (recipe) {
        Symposium.getRef('rec-field-name').value = recipe.name || '';
        Symposium.getRef('rec-field-category').value = recipe.category || '';
        Symposium.populateSubcategoryDropdown(
          recipe.category,
          Symposium.getRef('rec-field-subcategory')
        );
        Symposium.getRef('rec-field-subcategory').value = recipe.subcategory || '';
        Symposium.getRef('rec-field-glassware').value = recipe.glassware || '';
        Symposium.getRef('rec-field-servings').value = recipe.servings || 1;
        Symposium.getRef('rec-field-garnish').value = recipe.garnish || '';
        Symposium.getRef('rec-field-description').value = recipe.description || '';
        Symposium.getRef('rec-field-instructions').value = recipe.instructions || '';
        Symposium.getRef('rec-field-tags').value =
          recipe.tags && Array.isArray(recipe.tags) ? recipe.tags.join(', ') : '';
        Symposium.getRef('rec-field-source').value = recipe.source || '';
        Symposium.getRef('rec-field-favorite').checked = !!recipe.favorite;

        // Pre-populate ingredient selector
        if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
          recipe.ingredients.forEach(function (ri) {
            if (ri.pending) {
              _selectedIngredients.push({
                name: ri.name,
                amount: ri.amount || '',
                unit: ri.unit || 'oz',
                optional: !!ri.optional,
                pending: true,
              });
            } else {
              var ing = state.allIngredients.find(function (i) {
                return i.id === ri.id;
              });
              _selectedIngredients.push({
                id: ri.id,
                name: ing ? ing.name : ri.id,
                amount: ri.amount || '',
                unit: ri.unit || 'oz',
                optional: !!ri.optional,
              });
            }
          });
        }

        // Pre-populate equipment selector
        if (recipe.equipment && Array.isArray(recipe.equipment)) {
          recipe.equipment.forEach(function (re) {
            if (re.pending) {
              _selectedEquipment.push({
                name: re.name,
                pending: true,
              });
            } else {
              var eq = state.allEquipment.find(function (e) {
                return e.id === re.id;
              });
              _selectedEquipment.push({
                id: re.id,
                name: eq ? eq.name : re.id,
              });
            }
          });
        }
      } else {
        formEl.reset();
        Symposium.getRef('rec-field-servings').value = '1';
        Symposium.getRef('rec-field-subcategory').innerHTML =
          '<option value="">Select category first</option>';
      }

      _renderSelectedIngredients();
      _renderSelectedEquipment();

      Symposium.getRef('modal-overlay-recipe').classList.add('open');
      Symposium.getRef('rec-field-name').focus();
    },

    closeModal: function () {
      Symposium.getRef('modal-overlay-recipe').classList.remove('open');
      state.recipeEditingId = null;
      _selectedIngredients = [];
      _selectedEquipment = [];
    },

    openDetail: function (recipe) {
      state.recipeDetailId = recipe.id;
      var titleEl = Symposium.getRef('modal-title-recipe-detail');
      titleEl.textContent = recipe.name + (recipe.favorite ? ' \u2605' : '');

      // Wire action buttons for the current recipe snapshot
      Symposium.getRef('btn-detail-edit').onclick = function () {
        Symposium.recipes.closeDetail();
        Symposium.recipes.openModal(recipe);
      };
      Symposium.getRef('btn-detail-delete').onclick = function () {
        Symposium.recipes.closeDetail();
        Symposium.recipes.handleDelete(recipe);
      };

      // Show / wire the "Visit the Altar" button only when there are pending items
      var resolveBtn = Symposium.getRef('btn-detail-resolve');
      if (recipe.pendingCount > 0) {
        resolveBtn.classList.remove('hidden');
        resolveBtn.onclick = function () {
          Symposium.recipes.closeDetail();
          // Fetch the live recipe snapshot in case it was updated since the detail opened
          var liveRecipe =
            state.allRecipes.find(function (r) {
              return r.id === recipe.id;
            }) || recipe;
          Symposium.recipes.openAltar(liveRecipe);
        };
      } else {
        resolveBtn.classList.add('hidden');
        resolveBtn.onclick = null;
      }

      var body = Symposium.getRef('recipe-detail-body');
      body.innerHTML = '';
      body.appendChild(_buildDetailBody(recipe));

      Symposium.getRef('modal-overlay-recipe-detail').classList.add('open');
    },

    closeDetail: function () {
      Symposium.getRef('modal-overlay-recipe-detail').classList.remove('open');
      state.recipeDetailId = null;
    },

    // ── Altar of Creation — public API ──────────────────────────────────
    openAltar: function (recipe) {
      _altarItems = _buildAltarItems(recipe);
      if (_altarItems.length === 0) return;
      _altarRecipeId = recipe.id;
      _altarTotal = _altarItems.length;
      _altarCursor = 0;
      _altarDupeTarget = null;
      _renderAltarStep();
      document.getElementById('modal-overlay-altar').classList.add('open');
    },

    closeAltar: function () {
      document.getElementById('modal-overlay-altar').classList.remove('open');
      _altarRecipeId = null;
      _altarItems = [];
      _altarTotal = 0;
      _altarCursor = 0;
      _altarDupeTarget = null;
    },

    _skipAltarItem: function () {
      _advanceAltarCursor();
    },

    _submitAltarStep: function () {
      _submitAltarStep();
    },

    _triggerDupeLink: function () {
      var dupeWarningEl = document.getElementById('altar-dupe-warning');
      var dupeId = dupeWarningEl && dupeWarningEl.dataset.dupeId;
      var dupeColl = dupeWarningEl && dupeWarningEl.dataset.dupeCollection;
      if (!dupeId || !dupeColl) return;

      _altarDupeTarget = { id: dupeId, collection: dupeColl };

      // Update the warning text and button
      var warningText = document.getElementById('altar-dupe-warning-text');
      var dupeLinkBtn = document.getElementById('altar-dupe-link-btn');
      var existingName =
        dupeColl === 'symposium_ingredients'
          ? (
              state.allIngredients.find(function (i) {
                return i.id === dupeId;
              }) || {}
            ).name
          : (
              state.allEquipment.find(function (e) {
                return e.id === dupeId;
              }) || {}
            ).name;
      if (warningText)
        warningText.textContent =
          'Will link to existing: \u201c' + (existingName || dupeId) + '\u201d';
      if (dupeLinkBtn) dupeLinkBtn.classList.add('hidden');

      // Update submit button text
      var submitBtn = document.getElementById('btn-altar-submit');
      if (submitBtn) submitBtn.textContent = 'Link to Existing';
    },

    _clearErrors: function () {
      var errors = Symposium.getRef('recipe-form').querySelectorAll('.form-error');
      errors.forEach(function (el) {
        el.textContent = '';
      });
    },

    _setError: function (fieldId, msg) {
      var el = document.getElementById('rec-error-' + fieldId);
      if (el) el.textContent = msg;
    },

    _checkDuplicate: function (name, category) {
      var trimmed = name.trim().toLowerCase();
      return state.allRecipes.some(function (r) {
        return (
          r.id !== state.recipeEditingId &&
          r.name.toLowerCase() === trimmed &&
          r.category === category
        );
      });
    },

    _validateForm: function () {
      Symposium.recipes._clearErrors();
      var valid = true;

      if (!Symposium.getRef('rec-field-name').value.trim()) {
        Symposium.recipes._setError('name', 'Name is required');
        valid = false;
      }
      if (!Symposium.getRef('rec-field-category').value) {
        Symposium.recipes._setError('category', 'Category is required');
        valid = false;
      }
      if (!Symposium.getRef('rec-field-subcategory').value) {
        Symposium.recipes._setError('subcategory', 'Subcategory is required');
        valid = false;
      }
      if (!Symposium.getRef('rec-field-glassware').value.trim()) {
        Symposium.recipes._setError('glassware', 'Glassware is required');
        valid = false;
      }
      var servingsVal = parseInt(Symposium.getRef('rec-field-servings').value, 10);
      if (isNaN(servingsVal) || servingsVal < 1) {
        Symposium.recipes._setError('servings', 'Servings must be at least 1');
        valid = false;
      }
      if (!Symposium.getRef('rec-field-description').value.trim()) {
        Symposium.recipes._setError('description', 'Description is required');
        valid = false;
      }
      if (!Symposium.getRef('rec-field-instructions').value.trim()) {
        Symposium.recipes._setError('instructions', 'Instructions are required');
        valid = false;
      }
      if (_selectedIngredients.length === 0) {
        Symposium.recipes._setError('ingredients', 'At least one ingredient is required');
        valid = false;
      }

      return valid;
    },

    handleSubmit: function (e) {
      e.preventDefault();
      if (!Symposium.recipes._validateForm()) return;

      var name = Symposium.getRef('rec-field-name').value.trim();
      var category = Symposium.getRef('rec-field-category').value;
      if (Symposium.recipes._checkDuplicate(name, category)) {
        Symposium.recipes._setError(
          'name',
          'A recipe with this name already exists in this category'
        );
        return;
      }

      var ingList = _selectedIngredients.map(function (sel) {
        if (sel.pending) {
          return {
            name: sel.name,
            amount: sel.amount,
            unit: sel.unit,
            optional: sel.optional,
            pending: true,
          };
        }
        return {
          id: sel.id,
          amount: sel.amount,
          unit: sel.unit,
          optional: sel.optional,
        };
      });

      var pendingCount =
        _selectedIngredients.filter(function (s) {
          return s.pending;
        }).length +
        _selectedEquipment.filter(function (s) {
          return s.pending;
        }).length;

      var equipList = _selectedEquipment.map(function (sel) {
        if (sel.pending) {
          return { name: sel.name, pending: true };
        }
        return { id: sel.id };
      });

      var canMake = _computeCanMake(ingList);

      var tags = Symposium.getRef('rec-field-tags')
        .value.split(',')
        .map(function (t) {
          return t.trim();
        })
        .filter(Boolean);

      var data = {
        name: name,
        category: category,
        subcategory: Symposium.getRef('rec-field-subcategory').value,
        tags: tags,
        description: Symposium.getRef('rec-field-description').value.trim(),
        instructions: Symposium.getRef('rec-field-instructions').value.trim(),
        ingredients: ingList,
        equipment: equipList,
        garnish: Symposium.getRef('rec-field-garnish').value.trim(),
        glassware: Symposium.getRef('rec-field-glassware').value.trim(),
        servings: parseInt(Symposium.getRef('rec-field-servings').value, 10),
        canMake: canMake,
        pendingCount: pendingCount,
        favorite: Symposium.getRef('rec-field-favorite').checked,
        updatedAt: state.serverTimestamp(),
      };

      // Optional fields: only include if non-empty
      var sourceVal = Symposium.getRef('rec-field-source').value.trim();
      if (sourceVal) {
        data.source = sourceVal;
      }

      var btnSave = Symposium.getRef('btn-save-recipe');
      btnSave.disabled = true;
      btnSave.textContent = 'Saving\u2026';

      var editingId = state.recipeEditingId;
      var promise;
      if (editingId) {
        var existingRcp = state.allRecipes.find(function (r) {
          return r.id === editingId;
        });
        data.createdAt =
          existingRcp && existingRcp.createdAt ? existingRcp.createdAt : state.serverTimestamp();
        promise = state.db.collection('symposium_recipes').doc(editingId).set(data);
      } else {
        data.createdAt = state.serverTimestamp();
        promise = state.db.collection('symposium_recipes').add(data);
      }

      promise
        .then(function (docRef) {
          // docRef is a DocumentReference for new recipes (add), undefined for updates (set)
          var savedId = editingId || (docRef && docRef.id);
          Symposium.recipes.closeModal();
          // Auto-open Altar of Creation if there are pending items to resolve
          if (pendingCount > 0 && savedId) {
            _waitForRecipeAndOpenAltar(savedId);
          }
        })
        .catch(function (err) {
          console.error('Failed to save recipe:', err);
          Symposium.recipes._setError('name', 'Failed to save. Check console for details.');
        })
        .finally(function () {
          btnSave.disabled = false;
          btnSave.textContent = 'Save';
        });
    },

    handleDelete: function (recipe) {
      if (!window.confirm('Remove "' + recipe.name + '" from the Symposium?')) {
        return;
      }
      state.db
        .collection('symposium_recipes')
        .doc(recipe.id)
        .delete()
        .catch(function (err) {
          console.error('Failed to delete recipe:', err);
        });
    },

    // Recomputes canMake for all recipes and writes changed values.
    // Called from _onIngredientsChanged to keep canMake accurate.
    updateCanMakeAll: function () {
      _rebuildStockMap();
      state.allRecipes.forEach(function (recipe) {
        var newCanMake = _computeCanMake(recipe.ingredients || []);
        if (newCanMake !== recipe.canMake) {
          state.db
            .collection('symposium_recipes')
            .doc(recipe.id)
            .update({
              canMake: newCanMake,
              updatedAt: state.serverTimestamp(),
            })
            .catch(function (err) {
              console.error('Failed to update canMake for', recipe.name, err);
            });
        }
      });
    },

    // Marks each missing ingredient's shoppingListDefault as true.
    // Called when user taps "Add missing to shopping list" in recipe detail.
    // Returns a Promise that resolves when all updates are committed.
    addMissingToShoppingList: function (missingRefs) {
      if (!missingRefs || !missingRefs.length) {
        return Promise.resolve();
      }

      var batch = state.db.batch();
      missingRefs.forEach(function (ri) {
        var docRef = state.db.collection('symposium_ingredients').doc(ri.id);
        batch.update(docRef, {
          shoppingListDefault: true,
          updatedAt: state.serverTimestamp(),
        });
      });

      return batch.commit().catch(function (err) {
        console.error('Failed to add ingredient(s) to shopping list:', err);
        throw err;
      });
    },

    // Register once-only event listeners for the ingredient/equipment search inputs.
    // Called from app.js init.
    initSearchListeners: function () {
      var ingSearchEl = Symposium.getRef('rec-ing-search');
      ingSearchEl.addEventListener('input', function () {
        var q = ingSearchEl.value.trim();
        var results = _filterIngredientSearch(q);
        _renderIngredientDropdown(results, q);
      });
      ingSearchEl.addEventListener('blur', function () {
        window.setTimeout(function () {
          Symposium.getRef('rec-ing-dropdown').classList.add('hidden');
        }, 150);
      });

      var equipSearchEl = Symposium.getRef('rec-equip-search');
      equipSearchEl.addEventListener('input', function () {
        var q = equipSearchEl.value.trim();
        var results = _filterEquipmentSearch(q);
        _renderEquipmentDropdown(results, q);
      });
      equipSearchEl.addEventListener('blur', function () {
        window.setTimeout(function () {
          Symposium.getRef('rec-equip-dropdown').classList.add('hidden');
        }, 150);
      });
    },
  };
})();
