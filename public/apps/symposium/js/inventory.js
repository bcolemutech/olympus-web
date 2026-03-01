(function () {
  'use strict';

  var Symposium = window.Symposium;
  var state = Symposium.state;

  // ── Low/empty item count ──────────────────────────
  function getLowEmptyCount() {
    var ingLow = state.allIngredients.filter(function (ing) {
      var threshold = Number(ing.lowStockThreshold) || 0;
      var current =
        ing.trackingType === 'volume' ? Number(ing.stock) || 0 : Number(ing.quantity) || 0;
      return !ing.inStock || (threshold > 0 && current <= threshold);
    }).length;
    var equipReplace = state.allEquipment.filter(function (eq) {
      return eq.condition === 'replace';
    }).length;
    return ingLow + equipReplace;
  }

  // ── Dashboard summary card ────────────────────────
  function renderDashboard() {
    Symposium.getRef('dash-ingredient-count').textContent = state.allIngredients.length;
    Symposium.getRef('dash-equipment-count').textContent = state.allEquipment.length;
    Symposium.getRef('dash-recipe-count').textContent = state.allRecipes.length;
    var alertCount = getLowEmptyCount();
    Symposium.getRef('dash-alert-count').textContent = alertCount;
    Symposium.getRef('dash-alert-stat').classList.toggle('has-alerts', alertCount > 0);
  }

  // ── Combined search results ───────────────────────
  function renderCombinedSearch() {
    var q = state.globalSearchQuery.toLowerCase();
    var listEl = Symposium.getRef('combined-list');
    var emptyEl = Symposium.getRef('empty-state-combined');
    var countEl = Symposium.getRef('combined-count');

    var ingResults = state.allIngredients.filter(function (ing) {
      var catName = (
        state.categoryMap[ing.category] ? state.categoryMap[ing.category].name : ''
      ).toLowerCase();
      var tagHit =
        ing.tags &&
        ing.tags.some(function (t) {
          return t.toLowerCase().includes(q);
        });
      return ing.name.toLowerCase().includes(q) || catName.includes(q) || tagHit;
    });

    var equipResults = state.allEquipment.filter(function (eq) {
      var catName = (
        state.categoryMap[eq.category] ? state.categoryMap[eq.category].name : ''
      ).toLowerCase();
      var tagHit =
        eq.tags &&
        eq.tags.some(function (t) {
          return t.toLowerCase().includes(q);
        });
      return eq.name.toLowerCase().includes(q) || catName.includes(q) || tagHit;
    });

    var recipeResults = state.allRecipes.filter(function (r) {
      var catName = (
        state.categoryMap[r.category] ? state.categoryMap[r.category].name : ''
      ).toLowerCase();
      var tagHit =
        r.tags &&
        r.tags.some(function (t) {
          return t.toLowerCase().includes(q);
        });
      return r.name.toLowerCase().includes(q) || catName.includes(q) || tagHit;
    });

    listEl.innerHTML = '';

    var total = ingResults.length + equipResults.length + recipeResults.length;
    if (total === 0) {
      emptyEl.classList.remove('hidden');
      countEl.classList.add('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    countEl.classList.remove('hidden');
    countEl.textContent = total + (total === 1 ? ' result' : ' results');

    ingResults.forEach(function (ing) {
      listEl.appendChild(_makeResultCard(ing, 'ingredient'));
    });
    equipResults.forEach(function (eq) {
      listEl.appendChild(_makeResultCard(eq, 'equipment'));
    });
    recipeResults.forEach(function (r) {
      listEl.appendChild(_makeResultCard(r, 'recipe'));
    });
  }

  function _makeResultCard(item, type) {
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'combined-result-card';

    var badge = document.createElement('span');
    badge.className = 'result-type-badge result-type-' + type;
    badge.textContent =
      type === 'ingredient' ? 'Ingredient' : type === 'equipment' ? 'Equipment' : 'Recipe';

    var name = document.createElement('span');
    name.className = 'combined-result-name';
    name.textContent = item.name;

    var detail = document.createElement('span');
    detail.className = 'combined-result-detail';
    if (type === 'ingredient') {
      detail.textContent = item.inStock ? 'In Stock' : 'Out of Stock';
    } else if (type === 'equipment') {
      detail.textContent = item.condition
        ? item.condition.charAt(0).toUpperCase() + item.condition.slice(1)
        : '';
    } else {
      var catName = state.categoryMap[item.category] ? state.categoryMap[item.category].name : '';
      detail.textContent = catName;
    }

    card.appendChild(badge);
    card.appendChild(name);
    card.appendChild(detail);

    card.addEventListener('click', function () {
      if (type === 'ingredient') {
        Symposium.inventory._switchToTab('ingredients');
        Symposium.ingredients.openModal(item);
      } else if (type === 'equipment') {
        Symposium.inventory._switchToTab('equipment');
        Symposium.equipment.openModal(item);
      } else {
        Symposium.inventory._switchToTab('recipes');
        Symposium.recipes.openDetail(item);
      }
    });

    return card;
  }

  Symposium.inventory = {
    renderDashboard: renderDashboard,
    renderCombinedSearch: renderCombinedSearch,
    _switchToTab: null, // wired up in app.js after init
  };
})();
