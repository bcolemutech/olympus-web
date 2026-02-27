(function () {
  'use strict';

  var Symposium = window.Symposium;
  var state = Symposium.state;

  Symposium.equipment = {
    renderCategoryGrid: function () {
      var gridEl = Symposium.getRef('category-grid-equip');
      gridEl.innerHTML = '';

      gridEl.appendChild(
        Symposium.makeCategoryCard(
          'all',
          'All',
          state.allEquipment.length,
          state.equipActiveFilter === 'all',
          function (id) {
            state.equipActiveFilter = id;
            Symposium.equipment.renderCategoryGrid();
            Symposium.equipment.renderList();
          }
        )
      );

      Object.keys(state.equipmentCategoryMap).forEach(function (id) {
        var count = state.allEquipment.filter(function (e) {
          return e.category === id;
        }).length;
        gridEl.appendChild(
          Symposium.makeCategoryCard(
            id,
            state.equipmentCategoryMap[id].name,
            count,
            state.equipActiveFilter === id,
            function (catId) {
              state.equipActiveFilter = catId;
              Symposium.equipment.renderCategoryGrid();
              Symposium.equipment.renderList();
            }
          )
        );
      });
    },

    renderList: function () {
      var result = state.allEquipment.slice();

      // 1. Category filter
      if (state.equipActiveFilter !== 'all') {
        result = result.filter(function (eq) {
          return eq.category === state.equipActiveFilter;
        });
      }

      // 2. Search filter
      if (state.equipSearchQuery) {
        var q = state.equipSearchQuery.toLowerCase();
        result = result.filter(function (eq) {
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
      }

      // 3. Condition filter
      if (state.conditionFilter !== 'all') {
        result = result.filter(function (eq) {
          return eq.condition === state.conditionFilter;
        });
      }

      // 4. Sort
      if (state.equipSortOption === 'alpha') {
        result.sort(function (a, b) {
          return a.name.localeCompare(b.name);
        });
      } else if (state.equipSortOption === 'condition') {
        var condOrder = { replace: 0, fair: 1, good: 2 };
        result.sort(function (a, b) {
          var orderA = Object.prototype.hasOwnProperty.call(condOrder, a.condition)
            ? condOrder[a.condition]
            : 3;
          var orderB = Object.prototype.hasOwnProperty.call(condOrder, b.condition)
            ? condOrder[b.condition]
            : 3;
          var diff = orderA - orderB;
          return diff !== 0 ? diff : a.name.localeCompare(b.name);
        });
      } else if (state.equipSortOption === 'category') {
        result.sort(function (a, b) {
          var catA = state.categoryMap[a.category];
          var catB = state.categoryMap[b.category];
          var orderA =
            catA && typeof catA.sortOrder === 'number' ? catA.sortOrder : Number.MAX_SAFE_INTEGER;
          var orderB =
            catB && typeof catB.sortOrder === 'number' ? catB.sortOrder : Number.MAX_SAFE_INTEGER;
          var diff = orderA - orderB;
          return diff !== 0 ? diff : a.name.localeCompare(b.name);
        });
      }

      Symposium.renderListSection({
        items: result,
        listEl: Symposium.getRef('equipment-list'),
        emptyEl: Symposium.getRef('empty-state-equip'),
        countEl: Symposium.getRef('equipment-count'),
        renderCard: Symposium.equipment.renderCard,
        noun: 'item',
        getEmptyMessage: function () {
          if (state.equipSearchQuery && state.equipActiveFilter !== 'all') {
            return 'No equipment matches that search in this category.';
          } else if (state.equipSearchQuery) {
            return 'No equipment matches that search.';
          } else if (state.conditionFilter !== 'all') {
            return (
              'No equipment with \u201c' +
              state.conditionFilter +
              '\u201d condition' +
              (state.equipActiveFilter !== 'all' ? ' in this category.' : '.')
            );
          } else if (state.equipActiveFilter !== 'all' && state.allEquipment.length > 0) {
            return 'No equipment in this category yet.';
          }
          return 'The Workshop awaits its first tool.';
        },
      });
    },

    renderCard: function (eq) {
      var card = document.createElement('div');
      card.className = 'equipment-card';

      var header = document.createElement('div');
      header.className = 'ingredient-card-header';

      var info = document.createElement('div');

      var name = document.createElement('h3');
      name.className = 'ingredient-name';
      name.textContent = eq.name;

      var meta = document.createElement('div');
      meta.className = 'ingredient-meta';

      var catBadge = document.createElement('span');
      catBadge.className = 'badge badge-category';
      catBadge.textContent = state.categoryMap[eq.category]
        ? state.categoryMap[eq.category].name
        : eq.category;
      meta.appendChild(catBadge);

      if (eq.subcategory) {
        var subBadge = document.createElement('span');
        subBadge.className = 'badge badge-subcategory';
        subBadge.textContent = eq.subcategory;
        meta.appendChild(subBadge);
      }

      var allowedConditions = ['good', 'fair', 'replace'];
      var condition =
        typeof eq.condition === 'string' && allowedConditions.indexOf(eq.condition) !== -1
          ? eq.condition
          : 'good';
      var condBadge = document.createElement('span');
      condBadge.className = 'badge badge-condition badge-condition-' + condition;
      condBadge.textContent = condition.charAt(0).toUpperCase() + condition.slice(1);
      meta.appendChild(condBadge);

      info.appendChild(name);
      info.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'ingredient-actions';

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-icon btn-edit';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', function () {
        Symposium.equipment.openModal(eq);
      });

      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-icon btn-delete';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function () {
        Symposium.equipment.handleDelete(eq);
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      header.appendChild(info);
      header.appendChild(actions);
      card.appendChild(header);

      // Details row
      var details = document.createElement('div');
      details.className = 'ingredient-details';
      var qtyDetail = document.createElement('span');
      var qtyLabel = document.createElement('span');
      qtyLabel.className = 'ingredient-detail-label';
      qtyLabel.textContent = 'Qty:';
      qtyDetail.appendChild(qtyLabel);
      qtyDetail.appendChild(document.createTextNode(' ' + (eq.quantity || 0)));
      details.appendChild(qtyDetail);
      card.appendChild(details);

      // Tags
      if (eq.tags && Array.isArray(eq.tags) && eq.tags.length > 0) {
        var tagsRow = document.createElement('div');
        tagsRow.className = 'ingredient-meta';
        tagsRow.style.marginTop = '0.5rem';
        eq.tags.forEach(function (tag) {
          var tagBadge = document.createElement('span');
          tagBadge.className = 'badge badge-subcategory';
          tagBadge.textContent = tag;
          tagsRow.appendChild(tagBadge);
        });
        card.appendChild(tagsRow);
      }

      // Notes
      if (eq.notes) {
        var notes = document.createElement('div');
        notes.className = 'ingredient-notes';
        notes.textContent = eq.notes;
        card.appendChild(notes);
      }

      return card;
    },

    populateCategorySelect: function () {
      var eqFieldCategory = Symposium.getRef('eq-field-category');
      Object.keys(state.equipmentCategoryMap).forEach(function (id) {
        var opt = document.createElement('option');
        opt.value = id;
        opt.textContent = state.equipmentCategoryMap[id].name;
        eqFieldCategory.appendChild(opt);
      });
    },

    openModal: function (equipment) {
      state.equipEditingId = equipment ? equipment.id : null;
      Symposium.getRef('modal-title-equip').textContent = equipment
        ? 'Edit Equipment'
        : 'Add Equipment';

      var formEl = Symposium.getRef('equipment-form');
      var eqFieldName = Symposium.getRef('eq-field-name');
      var eqFieldCategory = Symposium.getRef('eq-field-category');
      var eqFieldSubcategory = Symposium.getRef('eq-field-subcategory');
      var eqFieldQuantity = Symposium.getRef('eq-field-quantity');
      var eqFieldCondition = Symposium.getRef('eq-field-condition');
      var eqFieldTags = Symposium.getRef('eq-field-tags');
      var eqFieldNotes = Symposium.getRef('eq-field-notes');

      Symposium.equipment._clearErrors();

      if (equipment) {
        eqFieldName.value = equipment.name || '';
        eqFieldCategory.value = equipment.category || '';
        Symposium.populateSubcategoryDropdown(equipment.category, eqFieldSubcategory);
        eqFieldSubcategory.value = equipment.subcategory || '';
        eqFieldQuantity.value = equipment.quantity != null ? equipment.quantity : 1;
        eqFieldCondition.value = equipment.condition || '';
        eqFieldTags.value =
          equipment.tags && Array.isArray(equipment.tags) ? equipment.tags.join(', ') : '';
        eqFieldNotes.value = equipment.notes || '';
      } else {
        formEl.reset();
        eqFieldQuantity.value = '1';
        eqFieldSubcategory.innerHTML = '<option value="">Select category first</option>';
      }

      Symposium.getRef('modal-overlay-equip').classList.add('open');
      eqFieldName.focus();
    },

    closeModal: function () {
      Symposium.getRef('modal-overlay-equip').classList.remove('open');
      state.equipEditingId = null;
    },

    _clearErrors: function () {
      var errors = Symposium.getRef('equipment-form').querySelectorAll('.form-error');
      errors.forEach(function (el) {
        el.textContent = '';
      });
    },

    _setError: function (fieldId, msg) {
      var el = document.getElementById('eq-error-' + fieldId);
      if (el) el.textContent = msg;
    },

    _validateForm: function () {
      Symposium.equipment._clearErrors();
      var valid = true;

      if (!Symposium.getRef('eq-field-name').value.trim()) {
        Symposium.equipment._setError('name', 'Name is required');
        valid = false;
      }
      if (!Symposium.getRef('eq-field-category').value) {
        Symposium.equipment._setError('category', 'Category is required');
        valid = false;
      }
      if (!Symposium.getRef('eq-field-subcategory').value) {
        Symposium.equipment._setError('subcategory', 'Subcategory is required');
        valid = false;
      }
      var qty = Symposium.getRef('eq-field-quantity');
      if (qty.value === '' || parseInt(qty.value, 10) < 0) {
        Symposium.equipment._setError('quantity', 'Quantity must be 0 or greater');
        valid = false;
      }
      if (!Symposium.getRef('eq-field-condition').value) {
        Symposium.equipment._setError('condition', 'Condition is required');
        valid = false;
      }

      return valid;
    },

    _checkDuplicate: function (name, category) {
      var trimmed = name.trim().toLowerCase();
      return state.allEquipment.some(function (eq) {
        return (
          eq.id !== state.equipEditingId &&
          eq.name.toLowerCase() === trimmed &&
          eq.category === category
        );
      });
    },

    handleSubmit: function (e) {
      e.preventDefault();
      if (!Symposium.equipment._validateForm()) return;

      var eqFieldName = Symposium.getRef('eq-field-name');
      var eqFieldCategory = Symposium.getRef('eq-field-category');
      var eqFieldSubcategory = Symposium.getRef('eq-field-subcategory');
      var eqFieldQuantity = Symposium.getRef('eq-field-quantity');
      var eqFieldCondition = Symposium.getRef('eq-field-condition');
      var eqFieldTags = Symposium.getRef('eq-field-tags');
      var eqFieldNotes = Symposium.getRef('eq-field-notes');

      var name = eqFieldName.value.trim();
      var category = eqFieldCategory.value;

      if (Symposium.equipment._checkDuplicate(name, category)) {
        Symposium.equipment._setError(
          'name',
          'Equipment with this name already exists in this category'
        );
        return;
      }

      var tags = eqFieldTags.value
        .split(',')
        .map(function (t) {
          return t.trim();
        })
        .filter(Boolean);

      var data = {
        name: name,
        category: category,
        subcategory: eqFieldSubcategory.value,
        tags: tags,
        type: 'reusable',
        quantity: parseInt(eqFieldQuantity.value, 10) || 0,
        condition: eqFieldCondition.value,
        notes: eqFieldNotes.value.trim(),
        updatedAt: state.serverTimestamp(),
      };

      var btnSave = Symposium.getRef('btn-save-equip');
      btnSave.disabled = true;
      btnSave.textContent = 'Saving\u2026';

      var promise;
      if (state.equipEditingId) {
        var existingEq = state.allEquipment.find(function (eq) {
          return eq.id === state.equipEditingId;
        });
        data.createdAt = (existingEq && existingEq.createdAt) || state.serverTimestamp();
        promise = state.db.collection('symposium_equipment').doc(state.equipEditingId).set(data);
      } else {
        data.createdAt = state.serverTimestamp();
        promise = state.db.collection('symposium_equipment').add(data);
      }

      promise
        .then(function () {
          Symposium.equipment.closeModal();
        })
        .catch(function (err) {
          console.error('Failed to save equipment:', err);
          Symposium.equipment._setError('name', 'Failed to save. Check console for details.');
        })
        .finally(function () {
          btnSave.disabled = false;
          btnSave.textContent = 'Save';
        });
    },

    handleDelete: function (eq) {
      if (!window.confirm('Remove "' + eq.name + '" from the workshop?')) {
        return;
      }

      state.db
        .collection('symposium_equipment')
        .doc(eq.id)
        .delete()
        .catch(function (err) {
          console.error('Failed to delete equipment:', err);
        });
    },
  };
})();
