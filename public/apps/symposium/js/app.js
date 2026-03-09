(function () {
  'use strict';

  var Symposium = window.Symposium;
  var state = Symposium.state;

  // ── Scroll position memory ────────────────────────
  var tabScrollPositions = {};

  // ── View tab switching ────────────────────────────
  function switchView(view) {
    var tabDashboard = Symposium.getRef('tab-dashboard');
    var tabIngredients = Symposium.getRef('tab-ingredients');
    var tabEquipment = Symposium.getRef('tab-equipment');
    var tabRecipes = Symposium.getRef('tab-recipes');
    var tabProvisions = Symposium.getRef('tab-provisions');
    var tabAppellations = Symposium.getRef('tab-appellations');
    var panelDashboard = Symposium.getRef('panel-dashboard');
    var panelIngredients = Symposium.getRef('panel-ingredients');
    var panelEquipment = Symposium.getRef('panel-equipment');
    var panelRecipes = Symposium.getRef('panel-recipes');
    var panelProvisions = Symposium.getRef('panel-provisions');
    var panelAppellations = Symposium.getRef('panel-appellations');

    // Save current tab's scroll position before switching
    if (state.currentView) {
      tabScrollPositions[state.currentView] = window.scrollY;
    }
    state.currentView = view;

    tabDashboard.classList.toggle('active', view === 'dashboard');
    tabDashboard.setAttribute('aria-selected', view === 'dashboard' ? 'true' : 'false');
    tabIngredients.classList.toggle('active', view === 'ingredients');
    tabIngredients.setAttribute('aria-selected', view === 'ingredients' ? 'true' : 'false');
    tabEquipment.classList.toggle('active', view === 'equipment');
    tabEquipment.setAttribute('aria-selected', view === 'equipment' ? 'true' : 'false');
    tabRecipes.classList.toggle('active', view === 'recipes');
    tabRecipes.setAttribute('aria-selected', view === 'recipes' ? 'true' : 'false');
    tabProvisions.classList.toggle('active', view === 'provisions');
    tabProvisions.setAttribute('aria-selected', view === 'provisions' ? 'true' : 'false');
    tabAppellations.classList.toggle('active', view === 'appellations');
    tabAppellations.setAttribute('aria-selected', view === 'appellations' ? 'true' : 'false');

    // Hide combined panel, show the selected tab panel
    Symposium.getRef('panel-combined').classList.add('hidden');
    panelDashboard.classList.toggle('hidden', view !== 'dashboard');
    panelIngredients.classList.toggle('hidden', view !== 'ingredients');
    panelEquipment.classList.toggle('hidden', view !== 'equipment');
    panelRecipes.classList.toggle('hidden', view !== 'recipes');
    panelProvisions.classList.toggle('hidden', view !== 'provisions');
    panelAppellations.classList.toggle('hidden', view !== 'appellations');

    // Clear global search when switching tabs
    state.globalSearchQuery = '';
    var globalSearchEl = Symposium.getRef('oracle-search-global');
    if (globalSearchEl) {
      globalSearchEl.value = '';
      Symposium.getRef('oracle-clear-global').classList.add('hidden');
    }

    // Clear recipe search when switching tabs
    state.recipeSearchQuery = '';
    var recipeSearchEl = Symposium.getRef('oracle-search-recipe');
    if (recipeSearchEl) {
      recipeSearchEl.value = '';
      Symposium.getRef('oracle-clear-recipe').classList.add('hidden');
    }

    // Ensure recipes list reflects cleared search when viewing Recipes
    if (
      view === 'recipes' &&
      Symposium.recipes &&
      typeof Symposium.recipes.renderList === 'function'
    ) {
      Symposium.recipes.renderList();
    }
    // Restore scroll position
    window.scrollTo(0, tabScrollPositions[view] || 0);
  }

  Symposium.app = {
    init: function () {
      // Set up Firestore references
      state.db = firebase.firestore();
      state.serverTimestamp = firebase.firestore.FieldValue.serverTimestamp;

      // Wire switchView into inventory module for cross-tab navigation
      Symposium.inventory._switchToTab = switchView;

      // ── Wire Firestore callbacks ─────────────────
      Symposium.firestore._onCategoriesLoaded = function () {
        Symposium.ingredients.populateCategorySelect();
        Symposium.equipment.populateCategorySelect();
        Symposium.recipes.populateCategorySelect();
        Symposium.ingredients.renderCategoryGrid();
        Symposium.equipment.renderCategoryGrid();
        Symposium.recipes.renderCategoryGrid();
      };

      Symposium.firestore._onCategoriesChanged = function () {
        Symposium.ingredients.populateCategorySelect();
        Symposium.equipment.populateCategorySelect();
        Symposium.recipes.populateCategorySelect();
        Symposium.ingredients.renderCategoryGrid();
        Symposium.equipment.renderCategoryGrid();
        Symposium.recipes.renderCategoryGrid();
        Symposium.ingredients.renderList();
        Symposium.equipment.renderList();
        Symposium.recipes.renderList();
        if (state.currentView === 'appellations') {
          Symposium.appellations.renderPanel();
        }
      };

      Symposium.firestore._onIngredientsChanged = function () {
        Symposium.ingredients.renderCategoryGrid();
        Symposium.ingredients.renderList();
        Symposium.inventory.renderDashboardPanel();
        if (state.globalSearchQuery) Symposium.inventory.renderCombinedSearch();
        if (state.allRecipes.length > 0) Symposium.recipes.updateCanMakeAll();
        Symposium.shopping.renderSuggestions();
      };

      Symposium.firestore._onEquipmentChanged = function () {
        Symposium.equipment.renderCategoryGrid();
        Symposium.equipment.renderList();
        Symposium.inventory.renderDashboardPanel();
        if (state.globalSearchQuery) Symposium.inventory.renderCombinedSearch();
      };

      Symposium.firestore._onRecipesChanged = function () {
        Symposium.recipes.renderCategoryGrid();
        Symposium.recipes.renderList();
        Symposium.recipes.renderPendingBanner();
        Symposium.inventory.renderDashboardPanel();
        if (state.globalSearchQuery) Symposium.inventory.renderCombinedSearch();
        // If ingredients already loaded, recompute canMake for newly-arrived recipes
        if (state.allIngredients.length > 0) Symposium.recipes.updateCanMakeAll();
      };

      Symposium.firestore._onShoppingListChanged = function () {
        Symposium.shopping.renderList();
        Symposium.shopping.updateBadge();
        Symposium.shopping.renderSuggestions();
        Symposium.inventory.renderDashboardPanel();
      };

      // ── Global search ────────────────────────────
      var globalSearchEl = Symposium.getRef('oracle-search-global');
      var globalClearEl = Symposium.getRef('oracle-clear-global');

      globalSearchEl.addEventListener('input', function () {
        state.globalSearchQuery = globalSearchEl.value.trim();
        globalClearEl.classList.toggle('hidden', state.globalSearchQuery === '');
        var hasQuery = state.globalSearchQuery !== '';
        Symposium.getRef('panel-combined').classList.toggle('hidden', !hasQuery);
        Symposium.getRef('panel-dashboard').classList.toggle(
          'hidden',
          hasQuery || state.currentView !== 'dashboard'
        );
        Symposium.getRef('panel-ingredients').classList.toggle(
          'hidden',
          hasQuery || state.currentView !== 'ingredients'
        );
        Symposium.getRef('panel-equipment').classList.toggle(
          'hidden',
          hasQuery || state.currentView !== 'equipment'
        );
        Symposium.getRef('panel-recipes').classList.toggle(
          'hidden',
          hasQuery || state.currentView !== 'recipes'
        );
        Symposium.getRef('panel-provisions').classList.toggle(
          'hidden',
          hasQuery || state.currentView !== 'provisions'
        );
        Symposium.getRef('panel-appellations').classList.toggle(
          'hidden',
          hasQuery || state.currentView !== 'appellations'
        );
        if (hasQuery) Symposium.inventory.renderCombinedSearch();
      });

      globalClearEl.addEventListener('click', function () {
        globalSearchEl.value = '';
        state.globalSearchQuery = '';
        globalClearEl.classList.add('hidden');
        Symposium.getRef('panel-combined').classList.add('hidden');
        Symposium.getRef('panel-' + state.currentView).classList.remove('hidden');
      });

      // ── Ingredient sort ─────────────────────────
      var sortSelectEl = Symposium.getRef('sort-select');
      sortSelectEl.addEventListener('change', function () {
        state.sortOption = sortSelectEl.value;
        Symposium.ingredients.renderList();
      });

      // ── Stock filter toggle ─────────────────────
      var stockBtns = Symposium.getQueryRef('.stock-toggle-btn');
      stockBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.stockFilter = btn.dataset.filter;
          stockBtns.forEach(function (b) {
            b.classList.toggle('active', b === btn);
          });
          Symposium.ingredients.renderList();
        });
      });

      // ── Ingredient modal ────────────────────────
      var modalEl = Symposium.getRef('modal-overlay');

      Symposium.getRef('btn-add').addEventListener('click', function () {
        Symposium.ingredients.openModal(null);
      });

      Symposium.getRef('btn-cancel').addEventListener('click', function () {
        Symposium.ingredients.closeModal();
      });

      modalEl.addEventListener('click', function (e) {
        if (e.target === modalEl) Symposium.ingredients.closeModal();
      });

      Symposium.getRef('field-category').addEventListener('change', function () {
        Symposium.populateSubcategoryDropdown(
          Symposium.getRef('field-category').value,
          Symposium.getRef('field-subcategory')
        );
      });

      Symposium.getRef('field-unit').addEventListener('change', function () {
        Symposium.ingredients._toggleTrackingFields(Symposium.getRef('field-unit').value);
      });

      Symposium.getRef('ingredient-form').addEventListener('submit', function (e) {
        Symposium.ingredients.handleSubmit(e);
      });

      // ── Keyboard / global click ─────────────────
      var amphoraPopoverEl = Symposium.getRef('amphora-popover');
      var equipModalEl = Symposium.getRef('modal-overlay-equip');

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          if (amphoraPopoverEl.classList.contains('open')) {
            Symposium.amphora.closePopover();
          } else if (modalEl.classList.contains('open')) {
            Symposium.ingredients.closeModal();
          } else if (equipModalEl.classList.contains('open')) {
            Symposium.equipment.closeModal();
          } else if (recipeModalEl.classList.contains('open')) {
            Symposium.recipes.closeModal();
          } else if (recipeDetailModalEl.classList.contains('open')) {
            Symposium.recipes.closeDetail();
          } else if (altarModalEl && altarModalEl.classList.contains('open')) {
            Symposium.recipes.closeAltar();
          } else if (provisionsModalEl.classList.contains('open')) {
            Symposium.shopping.closeModal();
          } else if (intakeModalEl && intakeModalEl.classList.contains('open')) {
            Symposium.shopping.closeIntakeModal();
          } else if (appellationsModalEl.classList.contains('open')) {
            Symposium.appellations.closeModal();
          } else if (appDeleteModalEl.classList.contains('open')) {
            Symposium.appellations.closeDeleteModal();
          }
        }
      });

      document.addEventListener('click', function (e) {
        if (
          amphoraPopoverEl.classList.contains('open') &&
          !amphoraPopoverEl.contains(e.target) &&
          !e.target.closest('.amphora-indicator')
        ) {
          Symposium.amphora.closePopover();
        }
      });

      window.addEventListener(
        'scroll',
        function () {
          if (amphoraPopoverEl.classList.contains('open')) {
            Symposium.amphora.closePopover();
          }
        },
        true
      );

      window.addEventListener('resize', function () {
        if (amphoraPopoverEl.classList.contains('open')) {
          Symposium.amphora.closePopover();
        }
      });

      // ── View tabs ───────────────────────────────
      Symposium.getRef('tab-dashboard').addEventListener('click', function () {
        switchView('dashboard');
      });
      Symposium.getRef('tab-ingredients').addEventListener('click', function () {
        switchView('ingredients');
      });
      Symposium.getRef('tab-equipment').addEventListener('click', function () {
        switchView('equipment');
      });
      Symposium.getRef('tab-recipes').addEventListener('click', function () {
        switchView('recipes');
      });
      Symposium.getRef('tab-provisions').addEventListener('click', function () {
        switchView('provisions');
      });
      Symposium.getRef('tab-appellations').addEventListener('click', function () {
        switchView('appellations');
        Symposium.appellations.renderPanel();
      });

      // ── Dashboard quick actions ──────────────────
      Symposium.getRef('btn-what-can-i-make').addEventListener('click', function () {
        state.recipeCanMakeFilter = true;
        Symposium.getRef('can-make-btn').classList.add('active');
        Symposium.recipes.renderList();
        switchView('recipes');
      });

      Symposium.getRef('btn-random-libation').addEventListener('click', function () {
        var makeable = state.allRecipes.filter(function (r) {
          return r.canMake;
        });
        if (makeable.length === 0) {
          Symposium.inventory.showDashToast("The cellar can't make any recipes right now.");
          return;
        }
        var recipe = makeable[Math.floor(Math.random() * makeable.length)];
        switchView('recipes');
        Symposium.recipes.openDetail(recipe);
      });

      // ── Recently added recipe click delegation ───
      Symposium.getRef('dash-recent-recipes').addEventListener('click', function (e) {
        var item = e.target.closest('.dash-recent-item');
        if (!item) return;
        var recipe = state.allRecipes.find(function (r) {
          return r.id === item.dataset.recipeId;
        });
        if (recipe) {
          switchView('recipes');
          Symposium.recipes.openDetail(recipe);
        }
      });

      // ── Equipment sort ──────────────────────────
      var equipSortSelectEl = Symposium.getRef('sort-select-equip');
      equipSortSelectEl.addEventListener('change', function () {
        state.equipSortOption = equipSortSelectEl.value;
        Symposium.equipment.renderList();
      });

      // ── Condition filter toggle ─────────────────
      var condBtns = Symposium.getQueryRef('.condition-toggle-btn');
      condBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.conditionFilter = btn.dataset.filter;
          condBtns.forEach(function (b) {
            b.classList.toggle('active', b === btn);
          });
          Symposium.equipment.renderList();
        });
      });

      // ── Equipment modal ─────────────────────────
      Symposium.getRef('btn-add-equipment').addEventListener('click', function () {
        Symposium.equipment.openModal(null);
      });

      Symposium.getRef('btn-cancel-equip').addEventListener('click', function () {
        Symposium.equipment.closeModal();
      });

      equipModalEl.addEventListener('click', function (e) {
        if (e.target === equipModalEl) Symposium.equipment.closeModal();
      });

      Symposium.getRef('eq-field-category').addEventListener('change', function () {
        Symposium.populateSubcategoryDropdown(
          Symposium.getRef('eq-field-category').value,
          Symposium.getRef('eq-field-subcategory')
        );
      });

      Symposium.getRef('equipment-form').addEventListener('submit', function (e) {
        Symposium.equipment.handleSubmit(e);
      });

      // ── Recipe sort ─────────────────────────────
      var recipeSortSelectEl = Symposium.getRef('sort-select-recipe');
      recipeSortSelectEl.addEventListener('change', function () {
        state.recipeSortOption = recipeSortSelectEl.value;
        Symposium.recipes.renderList();
      });

      // ── Recipe search ────────────────────────────
      var recipeSearchEl = Symposium.getRef('oracle-search-recipe');
      var recipeClearEl = Symposium.getRef('oracle-clear-recipe');

      recipeSearchEl.addEventListener('input', function () {
        state.recipeSearchQuery = recipeSearchEl.value.trim();
        recipeClearEl.classList.toggle('hidden', state.recipeSearchQuery === '');
        Symposium.recipes.renderList();
      });

      recipeClearEl.addEventListener('click', function () {
        recipeSearchEl.value = '';
        state.recipeSearchQuery = '';
        recipeClearEl.classList.add('hidden');
        Symposium.recipes.renderList();
      });

      // ── Favorite filter toggle ──────────────────
      var favBtns = Symposium.getQueryRef('.favorite-toggle-btn');
      favBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.recipeFavoriteFilter = btn.dataset.filter === 'favorites';
          favBtns.forEach(function (b) {
            b.classList.toggle('active', b === btn);
          });
          Symposium.recipes.renderList();
        });
      });

      // ── Can Make filter toggle ──────────────────
      Symposium.getRef('can-make-btn').addEventListener('click', function () {
        state.recipeCanMakeFilter = !state.recipeCanMakeFilter;
        Symposium.getRef('can-make-btn').classList.toggle('active', state.recipeCanMakeFilter);
        Symposium.recipes.renderList();
      });

      // ── Pending items filter toggle ─────────────
      Symposium.getRef('pending-filter-btn').addEventListener('click', function () {
        state.recipePendingFilter = !state.recipePendingFilter;
        Symposium.getRef('pending-filter-btn').classList.toggle(
          'active',
          state.recipePendingFilter
        );
        Symposium.recipes.renderList();
      });

      // ── Recipe modal ────────────────────────────
      var recipeModalEl = Symposium.getRef('modal-overlay-recipe');
      var recipeDetailModalEl = Symposium.getRef('modal-overlay-recipe-detail');

      Symposium.getRef('btn-add-recipe').addEventListener('click', function () {
        Symposium.recipes.openModal(null);
      });

      Symposium.getRef('btn-cancel-recipe').addEventListener('click', function () {
        Symposium.recipes.closeModal();
      });

      recipeModalEl.addEventListener('click', function (e) {
        if (e.target === recipeModalEl) Symposium.recipes.closeModal();
      });

      recipeDetailModalEl.addEventListener('click', function (e) {
        if (e.target === recipeDetailModalEl) Symposium.recipes.closeDetail();
      });

      Symposium.getRef('btn-detail-close').addEventListener('click', function () {
        Symposium.recipes.closeDetail();
      });

      // ── Altar of Creation modal ──────────────────
      var altarModalEl = document.getElementById('modal-overlay-altar');

      altarModalEl.addEventListener('click', function (e) {
        if (e.target === altarModalEl) Symposium.recipes.closeAltar();
      });

      document.getElementById('btn-altar-later').addEventListener('click', function () {
        Symposium.recipes.closeAltar();
      });

      document.getElementById('btn-altar-skip').addEventListener('click', function () {
        Symposium.recipes._skipAltarItem();
      });

      document.getElementById('btn-altar-submit').addEventListener('click', function () {
        Symposium.recipes._submitAltarStep();
      });

      document.getElementById('altar-dupe-link-btn').addEventListener('click', function () {
        Symposium.recipes._triggerDupeLink();
      });

      // Delegate category change inside the altar form container for subcategory cascade
      document.getElementById('altar-form-container').addEventListener('change', function (e) {
        if (e.target && e.target.id === 'altar-field-category') {
          var subEl = document.getElementById('altar-field-subcategory');
          if (subEl) Symposium.populateSubcategoryDropdown(e.target.value, subEl);
        }
      });

      Symposium.getRef('rec-field-category').addEventListener('change', function () {
        Symposium.populateSubcategoryDropdown(
          Symposium.getRef('rec-field-category').value,
          Symposium.getRef('rec-field-subcategory')
        );
      });

      Symposium.getRef('recipe-form').addEventListener('submit', function (e) {
        Symposium.recipes.handleSubmit(e);
      });

      // Register ingredient/equipment search typeahead listeners
      Symposium.recipes.initSearchListeners();

      // ── Provisions modal ─────────────────────────
      var provisionsModalEl = Symposium.getRef('modal-overlay-provisions');

      Symposium.getRef('btn-add-provision').addEventListener('click', function () {
        Symposium.shopping.openModal(null);
      });

      Symposium.getRef('btn-cancel-provisions').addEventListener('click', function () {
        Symposium.shopping.closeModal();
      });

      provisionsModalEl.addEventListener('click', function (e) {
        if (e.target === provisionsModalEl) Symposium.shopping.closeModal();
      });

      Symposium.getRef('btn-clear-checked').addEventListener('click', function () {
        Symposium.shopping.clearChecked();
      });

      Symposium.getRef('provisions-form').addEventListener('submit', function (e) {
        Symposium.shopping.handleSubmit(e);
      });

      // Register provisions ingredient typeahead listeners
      Symposium.shopping.initSearchListeners();

      // ── Intake modal ("Offering to the Cellar") ──
      var intakeModalEl = Symposium.getRef('modal-overlay-intake');

      Symposium.getRef('btn-offer-all').addEventListener('click', function () {
        Symposium.shopping.handleBulkIntake();
      });

      Symposium.getRef('btn-cancel-intake').addEventListener('click', function () {
        Symposium.shopping.closeIntakeModal();
      });

      Symposium.getRef('btn-confirm-intake').addEventListener('click', function () {
        Symposium.shopping.confirmIntake();
      });

      intakeModalEl.addEventListener('click', function (e) {
        if (e.target === intakeModalEl) Symposium.shopping.closeIntakeModal();
      });

      // ── Recipe batch selection bar ────────────────────────────────────────
      Symposium.getRef('btn-batch-add-provisions').addEventListener('click', function (e) {
        var btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Adding\u2026';
        Symposium.recipes
          .addMissingFromBatch()
          .then(function () {
            btn.disabled = false;
            btn.textContent = 'Add Missing to Provisions';
          })
          .catch(function () {
            btn.disabled = false;
            btn.textContent = 'Failed \u2013 try again';
          });
      });

      Symposium.getRef('btn-batch-clear').addEventListener('click', function () {
        Symposium.recipes.clearBatchSelection();
      });

      // ── Appellations modal ───────────────────────
      var appellationsModalEl = Symposium.getRef('modal-overlay-appellations');
      var appDeleteModalEl = Symposium.getRef('modal-overlay-app-delete');

      Symposium.getRef('btn-add-appellation').addEventListener('click', function () {
        Symposium.appellations.openModal(null);
      });

      Symposium.getRef('app-btn-cancel').addEventListener('click', function () {
        Symposium.appellations.closeModal();
      });

      appellationsModalEl.addEventListener('click', function (e) {
        if (e.target === appellationsModalEl) Symposium.appellations.closeModal();
      });

      Symposium.getRef('appellation-form').addEventListener('submit', function (e) {
        Symposium.appellations.handleSubmit(e);
      });

      Symposium.getRef('app-subcategory-add-btn').addEventListener('click', function () {
        Symposium.appellations._addSubcategory();
      });

      Symposium.getRef('app-subcategory-input').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          Symposium.appellations._addSubcategory();
        }
      });

      // Auto-fill ID from name (create mode only)
      Symposium.getRef('app-field-name').addEventListener('input', function () {
        if (!state.appellationsEditingId) {
          var slug = Symposium.getRef('app-field-name')
            .value.trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
          Symposium.getRef('app-field-id').value = slug;
        }
      });

      Symposium.getRef('app-delete-cancel').addEventListener('click', function () {
        Symposium.appellations.closeDeleteModal();
      });

      appDeleteModalEl.addEventListener('click', function (e) {
        if (e.target === appDeleteModalEl) Symposium.appellations.closeDeleteModal();
      });

      Symposium.getRef('app-delete-confirm').addEventListener('click', function () {
        Symposium.appellations.confirmDelete();
      });

      // ── Init data ───────────────────────────────
      Symposium.firestore
        .loadCategories()
        .then(function () {
          Symposium.firestore.subscribeToIngredients();
          Symposium.firestore.subscribeToEquipment();
          Symposium.firestore.subscribeToRecipes();
          Symposium.firestore.subscribeToShoppingList();
        })
        .catch(function (err) {
          console.error('Failed to load categories:', err);
        });

      // Start on the Overview tab
      switchView('dashboard');
    },
  };
})();
