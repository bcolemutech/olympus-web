(function () {
  'use strict';

  var Symposium = window.Symposium;
  var state = Symposium.state;

  // ── Dashboard Overview panel ──────────────────────
  var _toastTimer = null;

  function showDashToast(msg) {
    var el = Symposium.getRef('dash-toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    if (_toastTimer) window.clearTimeout(_toastTimer);
    _toastTimer = window.setTimeout(function () {
      el.classList.add('hidden');
      _toastTimer = null;
    }, 3000);
  }

  function renderDashboardPanel() {
    var ingredients = state.allIngredients;
    var equipment = state.allEquipment;
    var recipes = state.allRecipes;
    var shopping = state.allShoppingList;

    // Ingredient stats
    var inStock = ingredients.filter(function (ing) {
      return ing.inStock;
    }).length;
    var low = ingredients.filter(function (ing) {
      var threshold = Number(ing.lowStockThreshold) || 0;
      var current =
        ing.trackingType === 'volume' ? Number(ing.stock) || 0 : Number(ing.quantity) || 0;
      return !ing.inStock || (threshold > 0 && current <= threshold);
    }).length;

    // Equipment stats
    var needsReplace = equipment.filter(function (eq) {
      return eq.condition === 'replace';
    }).length;

    // Recipe stats
    var canMake = recipes.filter(function (r) {
      return r.canMake;
    }).length;

    // Update stat cards
    Symposium.getRef('dash-ing-total').textContent = ingredients.length;
    Symposium.getRef('dash-ing-in-stock').textContent = inStock;
    var dashIngLowEl = Symposium.getRef('dash-ing-low');
    dashIngLowEl.textContent = low;
    dashIngLowEl.classList.toggle('dash-sub-alert', low > 0);
    Symposium.getRef('dash-rec-total').textContent = recipes.length;
    Symposium.getRef('dash-rec-can-make').textContent = canMake;
    Symposium.getRef('dash-eq-total').textContent = equipment.length;
    Symposium.getRef('dash-eq-replace').textContent = needsReplace;
    Symposium.getRef('dash-shop-count').textContent = shopping.length;

    // Alert state on equipment card
    Symposium.getRef('dash-eq-card').classList.toggle('has-alert', needsReplace > 0);

    // Recently added recipes (up to 5, sorted newest first)
    var recent = recipes
      .filter(function (r) {
        return r.createdAt && r.createdAt.seconds;
      })
      .sort(function (a, b) {
        return b.createdAt.seconds - a.createdAt.seconds;
      })
      .slice(0, 5);

    var recentEl = Symposium.getRef('dash-recent-recipes');
    recentEl.innerHTML = '';

    if (recent.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'empty-state-text';
      empty.textContent = 'No recipes yet. Add your first to get started.';
      recentEl.appendChild(empty);
      return;
    }

    recent.forEach(function (recipe) {
      var catName = state.recipeCategoryMap[recipe.category]
        ? state.recipeCategoryMap[recipe.category].name
        : recipe.category || '';

      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'dash-recent-item' + (recipe.canMake ? ' dash-recent-can-make' : '');
      row.dataset.recipeId = recipe.id;

      var nameEl = document.createElement('span');
      nameEl.className = 'dash-recent-name';
      nameEl.textContent = recipe.name;

      var catEl = document.createElement('span');
      catEl.className = 'dash-recent-cat';
      catEl.textContent = catName;

      row.appendChild(nameEl);
      row.appendChild(catEl);
      recentEl.appendChild(row);
    });
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
    renderDashboardPanel: renderDashboardPanel,
    showDashToast: showDashToast,
    renderCombinedSearch: renderCombinedSearch,
    _switchToTab: null, // wired up in app.js after init
  };
})();
