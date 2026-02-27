(function () {
  'use strict';

  var Symposium = window.Symposium;
  var state = Symposium.state;

  // ── View tab switching ────────────────────────
  function switchView(view) {
    var tabIngredients = Symposium.getRef('tab-ingredients');
    var tabEquipment = Symposium.getRef('tab-equipment');
    var panelIngredients = Symposium.getRef('panel-ingredients');
    var panelEquipment = Symposium.getRef('panel-equipment');

    tabIngredients.classList.toggle('active', view === 'ingredients');
    tabIngredients.setAttribute('aria-selected', view === 'ingredients' ? 'true' : 'false');
    tabEquipment.classList.toggle('active', view === 'equipment');
    tabEquipment.setAttribute('aria-selected', view === 'equipment' ? 'true' : 'false');

    panelIngredients.classList.toggle('hidden', view !== 'ingredients');
    panelEquipment.classList.toggle('hidden', view !== 'equipment');
  }

  Symposium.app = {
    init: function () {
      // Set up Firestore references
      state.db = firebase.firestore();
      state.serverTimestamp = firebase.firestore.FieldValue.serverTimestamp;

      // ── Wire Firestore callbacks ─────────────────
      Symposium.firestore._onCategoriesLoaded = function () {
        Symposium.ingredients.populateCategorySelect();
        Symposium.equipment.populateCategorySelect();
        Symposium.ingredients.renderCategoryGrid();
        Symposium.equipment.renderCategoryGrid();
      };

      Symposium.firestore._onIngredientsChanged = function () {
        Symposium.ingredients.renderCategoryGrid();
        Symposium.ingredients.renderList();
      };

      Symposium.firestore._onEquipmentChanged = function () {
        Symposium.equipment.renderCategoryGrid();
        Symposium.equipment.renderList();
      };

      // ── Ingredient search ───────────────────────
      var oracleSearchEl = Symposium.getRef('oracle-search');
      var oracleClearEl = Symposium.getRef('oracle-clear');

      oracleSearchEl.addEventListener('input', function () {
        state.searchQuery = oracleSearchEl.value.trim();
        oracleClearEl.classList.toggle('hidden', state.searchQuery === '');
        Symposium.ingredients.renderList();
      });

      oracleClearEl.addEventListener('click', function () {
        oracleSearchEl.value = '';
        state.searchQuery = '';
        oracleClearEl.classList.add('hidden');
        Symposium.ingredients.renderList();
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
      Symposium.getRef('tab-ingredients').addEventListener('click', function () {
        switchView('ingredients');
      });
      Symposium.getRef('tab-equipment').addEventListener('click', function () {
        switchView('equipment');
      });

      // ── Equipment search ────────────────────────
      var equipSearchEl = Symposium.getRef('oracle-search-equip');
      var equipClearEl = Symposium.getRef('oracle-clear-equip');

      equipSearchEl.addEventListener('input', function () {
        state.equipSearchQuery = equipSearchEl.value.trim();
        equipClearEl.classList.toggle('hidden', state.equipSearchQuery === '');
        Symposium.equipment.renderList();
      });

      equipClearEl.addEventListener('click', function () {
        equipSearchEl.value = '';
        state.equipSearchQuery = '';
        equipClearEl.classList.add('hidden');
        Symposium.equipment.renderList();
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

      // ── Init data ───────────────────────────────
      Symposium.firestore
        .loadCategories()
        .then(function () {
          Symposium.firestore.subscribeToIngredients();
          Symposium.firestore.subscribeToEquipment();
        })
        .catch(function (err) {
          console.error('Failed to load categories:', err);
        });
    },
  };
})();
