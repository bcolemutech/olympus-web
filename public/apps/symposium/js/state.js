(function () {
  'use strict';

  window.Symposium = window.Symposium || {};
  var S = window.Symposium;

  // ── Amphora bottle-level constants ─────────────
  S.BOTTLE_LEVELS = {
    full: { label: 'Full', fill: 1.0 },
    'three-quarter': { label: '3/4', fill: 0.75 },
    half: { label: 'Half', fill: 0.5 },
    quarter: { label: '1/4', fill: 0.25 },
    empty: { label: 'Empty', fill: 0.0 },
  };

  S.LEVEL_ORDER = ['full', 'three-quarter', 'half', 'quarter', 'empty'];

  // ── Tracking-type helpers ────────────────────────
  S.computeInStock = function (trackingType, stock, quantity) {
    return trackingType === 'volume' ? stock > 0 : quantity > 0;
  };

  S.inferTrackingType = function (unit) {
    return unit === 'each' ? 'quantity' : 'volume';
  };

  // ── Shared mutable state ───────────────────────
  S.state = {
    db: null,
    serverTimestamp: null,
    categoryMap: {},
    ingredientCategoryMap: {},
    equipmentCategoryMap: {},
    recipeCategoryMap: {},
    allIngredients: [],
    ingredientsLoaded: false,
    allEquipment: [],
    allRecipes: [],
    activeFilter: 'all',
    searchQuery: '',
    sortOption: 'category',
    stockFilter: 'all',
    editingId: null,
    amphoraPopoverIng: null,
    equipActiveFilter: 'all',
    equipSearchQuery: '',
    equipSortOption: 'category',
    conditionFilter: 'all',
    equipEditingId: null,
    globalSearchQuery: '',
    currentView: 'ingredients',
    recipeActiveFilter: 'all',
    recipeSearchQuery: '',
    recipeSortOption: 'category',
    recipeFavoriteFilter: false,
    recipeCanMakeFilter: false,
    recipeEditingId: null,
    recipeDetailId: null,
  };

  // ── Lazy-cached DOM ref helpers ────────────────
  var refCache = {};
  S.getRef = function (id) {
    if (!refCache[id]) {
      refCache[id] = document.getElementById(id);
    }
    return refCache[id];
  };

  var queryCache = {};
  S.getQueryRef = function (selector) {
    if (!queryCache[selector]) {
      queryCache[selector] = document.querySelectorAll(selector);
    }
    return queryCache[selector];
  };

  // ── Shared category card builder ──────────────
  S.makeCategoryCard = function (id, name, count, isActive, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'category-card' + (isActive ? ' active' : '');

    var countSpan = document.createElement('span');
    countSpan.className = 'category-card-count';
    countSpan.textContent = count;

    var nameSpan = document.createElement('span');
    nameSpan.className = 'category-card-name';
    nameSpan.textContent = name;

    btn.appendChild(countSpan);
    btn.appendChild(nameSpan);

    btn.addEventListener('click', function () {
      onClick(id);
    });

    return btn;
  };

  // ── Shared list rendering helper ──────────────
  S.renderListSection = function (config) {
    var items = config.items;
    var targetListEl = config.listEl;
    var targetEmptyEl = config.emptyEl;
    var targetCountEl = config.countEl;
    var cardFn = config.renderCard;
    var getEmptyMessage = config.getEmptyMessage;
    var noun = config.noun || 'item';

    targetListEl.innerHTML = '';

    if (items.length === 0) {
      targetEmptyEl.classList.remove('hidden');
      targetCountEl.classList.add('hidden');
      targetEmptyEl.querySelector('.empty-state-text').textContent = getEmptyMessage();
      return;
    }

    targetEmptyEl.classList.add('hidden');
    targetCountEl.classList.remove('hidden');
    targetCountEl.textContent = items.length + (items.length === 1 ? ' ' + noun : ' ' + noun + 's');

    items.forEach(function (item) {
      targetListEl.appendChild(cardFn(item));
    });
  };

  // ── Shared subcategory cascade helper ─────────
  S.populateSubcategoryDropdown = function (categoryId, dropdownEl) {
    dropdownEl.innerHTML = '<option value="">Select\u2026</option>';
    var cat = S.state.categoryMap[categoryId];
    if (cat && cat.subcategories) {
      cat.subcategories.forEach(function (sub) {
        var opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = sub.charAt(0).toUpperCase() + sub.slice(1);
        dropdownEl.appendChild(opt);
      });
    }
  };
})();
