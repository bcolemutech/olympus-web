(function () {
  'use strict';

  var Symposium = window.Symposium;
  var state = Symposium.state;

  // ── Module-level private state for selectors ───────────────────────────
  // Each ingredient entry: { id, name, amount, unit, optional }
  // Each equipment entry: { id, name }
  var _selectedIngredients = [];
  var _selectedEquipment = [];

  // ── canMake computation ────────────────────────────────────────────────
  function _computeCanMake(recipeIngredients) {
    return recipeIngredients.every(function (ri) {
      if (ri.optional) return true;
      var ing = state.allIngredients.find(function (i) {
        return i.id === ri.id;
      });
      return ing && ing.inStock;
    });
  }

  // ── Three-state availability computation ───────────────────────────────
  // Returns 'green' (all in stock), 'amber' (all required in stock, some optional
  // missing), or 'red' (at least one required ingredient out of stock).
  function _getAvailabilityStatus(recipeIngredients) {
    var hasRequiredMissing = recipeIngredients.some(function (ri) {
      if (ri.optional) return false;
      var ing = state.allIngredients.find(function (i) {
        return i.id === ri.id;
      });
      return !ing || !ing.inStock;
    });
    if (hasRequiredMissing) return 'red';
    var hasOptionalMissing = recipeIngredients.some(function (ri) {
      if (!ri.optional) return false;
      var ing = state.allIngredients.find(function (i) {
        return i.id === ri.id;
      });
      return !ing || !ing.inStock;
    });
    return hasOptionalMissing ? 'amber' : 'green';
  }

  // ── Ingredient selector helpers ────────────────────────────────────────
  function _filterIngredientSearch(query) {
    if (!query) return [];
    var q = query.toLowerCase();
    var alreadySelected = _selectedIngredients.map(function (s) {
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

  function _renderIngredientDropdown(results) {
    var dropdown = Symposium.getRef('rec-ing-dropdown');
    dropdown.innerHTML = '';
    if (results.length === 0) {
      dropdown.classList.add('hidden');
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

  function _renderSelectedIngredients() {
    var container = Symposium.getRef('rec-selected-ingredients');
    container.innerHTML = '';

    _selectedIngredients.forEach(function (sel, index) {
      var row = document.createElement('div');
      row.className = 'selected-item-row';

      var nameBadge = document.createElement('span');
      nameBadge.className = 'selected-item-name';
      nameBadge.textContent = sel.name;

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

      row.appendChild(nameBadge);
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
    var alreadySelected = _selectedEquipment.map(function (s) {
      return s.id;
    });
    return state.allEquipment
      .filter(function (eq) {
        if (alreadySelected.indexOf(eq.id) !== -1) return false;
        var catName = (
          state.categoryMap[eq.category] ? state.categoryMap[eq.category].name : ''
        ).toLowerCase();
        return eq.name.toLowerCase().indexOf(q) !== -1 || catName.indexOf(q) !== -1;
      })
      .slice(0, 10);
  }

  function _renderEquipmentDropdown(results) {
    var dropdown = Symposium.getRef('rec-equip-dropdown');
    dropdown.innerHTML = '';
    if (results.length === 0) {
      dropdown.classList.add('hidden');
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

  function _renderSelectedEquipment() {
    var container = Symposium.getRef('rec-selected-equipment');
    container.innerHTML = '';
    _selectedEquipment.forEach(function (sel, index) {
      var row = document.createElement('div');
      row.className = 'selected-item-row';

      var nameBadge = document.createElement('span');
      nameBadge.className = 'selected-item-name';
      nameBadge.textContent = sel.name;

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

      row.appendChild(nameBadge);
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
      var ing = state.allIngredients.find(function (i) {
        return i.id === ri.id;
      });
      var li = document.createElement('li');
      li.className = 'recipe-detail-ingredient-item';

      var dot = document.createElement('span');
      dot.className = 'recipe-stock-dot ' + (ing && ing.inStock ? 'stock-dot-in' : 'stock-dot-out');
      dot.setAttribute('aria-hidden', 'true');

      var ingName = ing ? ing.name : ri.id;
      var amountText = ri.amount ? ri.amount + '\u00a0' + ri.unit + '\u00a0' : '';
      var optText = ri.optional ? ' (optional)' : '';

      li.appendChild(dot);
      li.appendChild(document.createTextNode(amountText + ingName + optText));
      ingUl.appendChild(li);
    });
    ingSection.appendChild(ingUl);

    // "Add missing to shopping list" button
    var missingRefs = (recipe.ingredients || []).filter(function (ri) {
      var ing = state.allIngredients.find(function (i) {
        return i.id === ri.id;
      });
      return !ing || !ing.inStock;
    });
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
          Symposium.recipes.addMissingToShoppingList(refs);
          btn.textContent = 'Added to shopping list';
          btn.disabled = true;
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
        var eq = state.allEquipment.find(function (e) {
          return e.id === re.id;
        });
        var li = document.createElement('li');
        li.textContent = eq ? eq.name : re.id;
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
          if (state.recipeCanMakeFilter) return 'No recipes are currently makeable with your stock.';
          if (state.recipeFavoriteFilter) return 'No favorites yet. Star a recipe to save it here.';
          if (state.recipeActiveFilter !== 'all' && state.allRecipes.length > 0)
            return 'No recipes in this category yet.';
          return 'The Libations await their first offering.';
        },
      });
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

      // Availability badge
      var availStatus = _getAvailabilityStatus(recipe.ingredients || []);
      var statusLabels = { green: 'Can Make', amber: 'Missing Optionals', red: "Can't Make" };
      var availBadge = document.createElement('span');
      availBadge.className = 'badge badge-availability-' + availStatus;
      availBadge.textContent = statusLabels[availStatus];
      meta.appendChild(availBadge);

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
          });
        }

        // Pre-populate equipment selector
        if (recipe.equipment && Array.isArray(recipe.equipment)) {
          recipe.equipment.forEach(function (re) {
            var eq = state.allEquipment.find(function (e) {
              return e.id === re.id;
            });
            _selectedEquipment.push({
              id: re.id,
              name: eq ? eq.name : re.id,
            });
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

      var body = Symposium.getRef('recipe-detail-body');
      body.innerHTML = '';
      body.appendChild(_buildDetailBody(recipe));

      Symposium.getRef('modal-overlay-recipe-detail').classList.add('open');
    },

    closeDetail: function () {
      Symposium.getRef('modal-overlay-recipe-detail').classList.remove('open');
      state.recipeDetailId = null;
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
        return {
          id: sel.id,
          amount: sel.amount,
          unit: sel.unit,
          optional: sel.optional,
        };
      });

      var equipList = _selectedEquipment.map(function (sel) {
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

      var promise;
      if (state.recipeEditingId) {
        var existingRcp = state.allRecipes.find(function (r) {
          return r.id === state.recipeEditingId;
        });
        data.createdAt =
          existingRcp && existingRcp.createdAt ? existingRcp.createdAt : state.serverTimestamp();
        promise = state.db.collection('symposium_recipes').doc(state.recipeEditingId).set(data);
      } else {
        data.createdAt = state.serverTimestamp();
        promise = state.db.collection('symposium_recipes').add(data);
      }

      promise
        .then(function () {
          Symposium.recipes.closeModal();
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
    addMissingToShoppingList: function (missingRefs) {
      missingRefs.forEach(function (ri) {
        state.db
          .collection('symposium_ingredients')
          .doc(ri.id)
          .update({ shoppingListDefault: true, updatedAt: state.serverTimestamp() })
          .catch(function (err) {
            console.error('Failed to add ingredient to shopping list:', err);
          });
      });
    },

    // Register once-only event listeners for the ingredient/equipment search inputs.
    // Called from app.js init.
    initSearchListeners: function () {
      var ingSearchEl = Symposium.getRef('rec-ing-search');
      ingSearchEl.addEventListener('input', function () {
        var results = _filterIngredientSearch(ingSearchEl.value.trim());
        _renderIngredientDropdown(results);
      });
      ingSearchEl.addEventListener('blur', function () {
        window.setTimeout(function () {
          Symposium.getRef('rec-ing-dropdown').classList.add('hidden');
        }, 150);
      });

      var equipSearchEl = Symposium.getRef('rec-equip-search');
      equipSearchEl.addEventListener('input', function () {
        var results = _filterEquipmentSearch(equipSearchEl.value.trim());
        _renderEquipmentDropdown(results);
      });
      equipSearchEl.addEventListener('blur', function () {
        window.setTimeout(function () {
          Symposium.getRef('rec-equip-dropdown').classList.add('hidden');
        }, 150);
      });
    },
  };
})();
