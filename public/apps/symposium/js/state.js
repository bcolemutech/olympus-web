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

  // ── Restock UOM constants and helpers ────────────
  S.VOLUME_RESTOCK_UNITS = ['bottle', 'can', 'box', 'bag', 'pack'];

  S.getRestockUnit = function (ing) {
    if (ing.restockUnit) return ing.restockUnit;
    return ing.trackingType === 'quantity' ? 'each' : 'bottle';
  };

  var _plurals = { box: 'boxes', each: 'each' };
  S.pluralizeUnit = function (unit) {
    return _plurals[unit] || unit + 's';
  };

  S.populateRestockUnitSelect = function (selectEl, selectedValue) {
    selectEl.innerHTML = '';
    S.VOLUME_RESTOCK_UNITS.forEach(function (u) {
      var opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      if (u === selectedValue) opt.selected = true;
      selectEl.appendChild(opt);
    });
  };

  // ── Recipe UOM constants ──────────────────────────
  S.VOLUME_RECIPE_UNITS = [
    'oz',
    'ml',
    'dash',
    'splash',
    'tsp',
    'tbsp',
    'barspoon',
    'rinse',
    'float',
  ];
  S.QUANTITY_RECIPE_UNITS = ['each'];

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
    equipmentLoaded: false,
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
    recipePendingFilter: false,
    recipeEditingId: null,
    recipeDetailId: null,
    allShoppingList: [],
    shoppingListLoaded: false,
    shoppingEditingId: null,
    appellationsEditingId: null,
  };

  // ── Global error toast ────────────────────────
  S.showError = function (message) {
    var toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(function () {
      toast.remove();
    }, 4000);
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
    var pageSize = config.pageSize || 50;

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

    var rendered = 0;
    function renderPage() {
      var end = Math.min(rendered + pageSize, items.length);
      for (var i = rendered; i < end; i++) {
        targetListEl.appendChild(cardFn(items[i]));
      }
      rendered = end;

      var existing = targetListEl.querySelector('.load-more-btn');
      if (existing) existing.remove();

      if (rendered < items.length) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'load-more-btn';
        btn.textContent = 'Load more (' + (items.length - rendered) + ' remaining)';
        btn.addEventListener('click', renderPage);
        targetListEl.appendChild(btn);
      }
    }
    renderPage();
  };

  // ── Category sort helper ───────────────────────
  S.getCategoriesByType = function (type) {
    return Object.keys(S.state.categoryMap)
      .filter(function (id) {
        return S.state.categoryMap[id].type === type;
      })
      .map(function (id) {
        return Object.assign({ id: id }, S.state.categoryMap[id]);
      })
      .sort(function (a, b) {
        return (a.sortOrder || 0) - (b.sortOrder || 0);
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
