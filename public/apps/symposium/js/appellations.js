(function () {
  'use strict';

  var Symposium = window.Symposium;
  var state = Symposium.state;

  // Module-level working array for subcategories in the modal
  var _subcategoriesWorking = [];

  // Category being deleted (set when delete reassign modal opens)
  var _deletingCat = null;
  var _deletingCollections = [];

  Symposium.appellations = {
    renderPanel: function () {
      var container = Symposium.getRef('appellations-list');
      container.innerHTML = '';

      var types = ['ingredient', 'equipment', 'recipe'];
      var hasAny = false;

      types.forEach(function (type) {
        var cats = Symposium.getCategoriesByType(type);
        if (cats.length === 0) return;
        hasAny = true;

        var section = document.createElement('div');
        section.className = 'appellation-section';

        var heading = document.createElement('h3');
        heading.className = 'appellation-section-heading';
        heading.textContent = type.charAt(0).toUpperCase() + type.slice(1) + ' Categories';
        section.appendChild(heading);

        cats.forEach(function (cat, idx) {
          section.appendChild(
            Symposium.appellations._renderCategoryRow(cat, idx, cats.length, cats)
          );
        });

        container.appendChild(section);
      });

      var emptyEl = Symposium.getRef('empty-state-appellations');
      if (emptyEl) {
        emptyEl.classList.toggle('hidden', hasAny);
      }
    },

    _renderCategoryRow: function (cat, idx, total, cats) {
      var row = document.createElement('div');
      row.className = 'appellation-row';

      var nameEl = document.createElement('span');
      nameEl.className = 'appellation-row-name';
      nameEl.textContent = cat.name;

      var metaEl = document.createElement('span');
      metaEl.className = 'appellation-row-meta';

      var subCount = document.createElement('span');
      subCount.className = 'appellation-sub-count';
      var sc = Array.isArray(cat.subcategories) ? cat.subcategories.length : 0;
      subCount.textContent = sc + (sc === 1 ? ' subcategory' : ' subcategories');

      var reorderBtns = document.createElement('div');
      reorderBtns.className = 'appellation-reorder-btns';

      var btnUp = document.createElement('button');
      btnUp.type = 'button';
      btnUp.className = 'btn-reorder';
      btnUp.textContent = '\u25B2';
      btnUp.setAttribute('aria-label', 'Move category up');
      btnUp.title = 'Move up';
      btnUp.disabled = idx === 0;
      btnUp.addEventListener('click', function () {
        btnUp.disabled = true;
        Symposium.firestore
          .swapCategorySortOrder(cat.id, cats[idx - 1].id)
          .catch(function (err) {
            console.error('Reorder failed:', err);
          })
          .finally(function () {
            btnUp.disabled = idx === 0;
          });
      });

      var btnDown = document.createElement('button');
      btnDown.type = 'button';
      btnDown.className = 'btn-reorder';
      btnDown.textContent = '\u25BC';
      btnDown.setAttribute('aria-label', 'Move category down');
      btnDown.title = 'Move down';
      btnDown.disabled = idx === total - 1;
      btnDown.addEventListener('click', function () {
        btnDown.disabled = true;
        Symposium.firestore
          .swapCategorySortOrder(cat.id, cats[idx + 1].id)
          .catch(function (err) {
            console.error('Reorder failed:', err);
          })
          .finally(function () {
            btnDown.disabled = idx === total - 1;
          });
      });

      reorderBtns.appendChild(btnUp);
      reorderBtns.appendChild(btnDown);

      var btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn-icon btn-edit';
      btnEdit.textContent = 'Edit';
      btnEdit.addEventListener('click', function () {
        Symposium.appellations.openModal(cat);
      });

      var btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'btn-icon btn-delete';
      btnDelete.textContent = 'Delete';
      btnDelete.addEventListener('click', function () {
        Symposium.appellations.handleDelete(cat);
      });

      metaEl.appendChild(subCount);
      metaEl.appendChild(reorderBtns);
      metaEl.appendChild(btnEdit);
      metaEl.appendChild(btnDelete);

      row.appendChild(nameEl);
      row.appendChild(metaEl);

      return row;
    },

    openModal: function (category) {
      state.appellationsEditingId = category ? category.id : null;

      Symposium.getRef('app-modal-title').textContent = category
        ? 'Edit Appellation'
        : 'Add Appellation';

      Symposium.getRef('app-field-name').value = category ? category.name : '';
      Symposium.getRef('app-field-type').value = category ? category.type : 'ingredient';
      Symposium.getRef('app-field-type').disabled = !!category;

      var idGroup = Symposium.getRef('app-field-id-group');
      idGroup.classList.toggle('hidden', !!category);
      Symposium.getRef('app-field-id').value = '';

      _subcategoriesWorking = category ? (category.subcategories || []).slice() : [];
      Symposium.appellations._renderSubcategoryChips();
      Symposium.appellations._clearErrors();

      Symposium.getRef('modal-overlay-appellations').classList.add('open');
      Symposium.getRef('app-field-name').focus();
    },

    closeModal: function () {
      Symposium.getRef('modal-overlay-appellations').classList.remove('open');
      state.appellationsEditingId = null;
      _subcategoriesWorking = [];
    },

    _renderSubcategoryChips: function () {
      var container = Symposium.getRef('app-subcategory-chips');
      container.innerHTML = '';

      _subcategoriesWorking.forEach(function (sub, idx) {
        var chip = document.createElement('span');
        chip.className = 'subcategory-chip';

        var label = document.createElement('span');
        label.textContent = sub;

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'subcategory-chip-remove';
        removeBtn.textContent = '\u00D7';
        removeBtn.setAttribute('aria-label', 'Remove ' + sub);
        removeBtn.addEventListener('click', function () {
          _subcategoriesWorking.splice(idx, 1);
          Symposium.appellations._renderSubcategoryChips();
        });

        chip.appendChild(label);
        chip.appendChild(removeBtn);
        container.appendChild(chip);
      });
    },

    _addSubcategory: function () {
      var input = Symposium.getRef('app-subcategory-input');
      var val = input.value.trim().toLowerCase();
      if (!val) return;
      if (_subcategoriesWorking.indexOf(val) !== -1) {
        input.value = '';
        return;
      }
      _subcategoriesWorking.push(val);
      input.value = '';
      Symposium.appellations._renderSubcategoryChips();
      Symposium.appellations._setError('subcategories', '');
    },

    _clearErrors: function () {
      ['name', 'id', 'type', 'subcategories'].forEach(function (field) {
        Symposium.appellations._setError(field, '');
      });
    },

    _setError: function (field, msg) {
      var el = Symposium.getRef('app-error-' + field);
      if (el) el.textContent = msg || '';
    },

    _validateForm: function () {
      var valid = true;
      Symposium.appellations._clearErrors();

      var name = Symposium.getRef('app-field-name').value.trim();
      if (!name) {
        Symposium.appellations._setError('name', 'Name is required.');
        valid = false;
      } else if (name.length > 200) {
        Symposium.appellations._setError('name', 'Name must be 200 characters or fewer.');
        valid = false;
      }

      if (!state.appellationsEditingId) {
        var id = Symposium.getRef('app-field-id').value.trim();
        if (!id) {
          Symposium.appellations._setError('id', 'ID is required.');
          valid = false;
        } else if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
          Symposium.appellations._setError(
            'id',
            'ID may only contain letters, numbers, hyphens, and underscores.'
          );
          valid = false;
        } else if (state.categoryMap[id]) {
          Symposium.appellations._setError('id', 'An appellation with this ID already exists.');
          valid = false;
        }
      }

      var selectedType = Symposium.getRef('app-field-type').value;
      if (selectedType === 'recipe' && _subcategoriesWorking.length === 0) {
        Symposium.appellations._setError(
          'subcategories',
          'Recipe categories require at least one subcategory.'
        );
        valid = false;
      }

      return valid;
    },

    handleSubmit: function (e) {
      e.preventDefault();
      if (!Symposium.appellations._validateForm()) return;

      var name = Symposium.getRef('app-field-name').value.trim();
      var type = Symposium.getRef('app-field-type').value;
      var subcategories = _subcategoriesWorking.slice();
      var btnSave = Symposium.getRef('app-btn-save');
      btnSave.disabled = true;
      btnSave.textContent = 'Saving\u2026';

      var promise;
      if (state.appellationsEditingId) {
        var existing = state.categoryMap[state.appellationsEditingId];
        var data = {
          name: name,
          type: existing.type,
          subcategories: subcategories,
          sortOrder: existing.sortOrder,
        };

        // Warn if subcategories removed that recipes reference
        var removedSubs = (existing.subcategories || []).filter(function (s) {
          return subcategories.indexOf(s) === -1;
        });
        if (removedSubs.length > 0 && existing.type === 'recipe') {
          var affected = state.allRecipes.filter(function (r) {
            return (
              r.category === state.appellationsEditingId &&
              removedSubs.indexOf(r.subcategory) !== -1
            );
          });
          if (
            affected.length > 0 &&
            !window.confirm(
              affected.length +
                ' recipe(s) use subcategories being removed (' +
                removedSubs.join(', ') +
                '). Those recipes will fail their next write until reassigned. Continue?'
            )
          ) {
            btnSave.disabled = false;
            btnSave.textContent = 'Save';
            return;
          }
        }

        promise = Symposium.firestore.updateCategory(state.appellationsEditingId, data);
      } else {
        var id = Symposium.getRef('app-field-id').value.trim();
        var sameType = Symposium.getCategoriesByType(type);
        var maxOrder = sameType.reduce(function (max, c) {
          return Math.max(max, c.sortOrder || 0);
        }, 0);
        var createData = {
          name: name,
          type: type,
          subcategories: subcategories,
          sortOrder: maxOrder + 1,
        };
        promise = Symposium.firestore.createCategory(id, createData);
      }

      promise
        .then(function () {
          Symposium.appellations.closeModal();
        })
        .catch(function (err) {
          console.error('Failed to save appellation:', err);
          Symposium.appellations._setError('name', 'Failed to save. Check console for details.');
        })
        .finally(function () {
          btnSave.disabled = false;
          btnSave.textContent = 'Save';
        });
    },

    handleDelete: function (cat) {
      var collections = {
        ingredient: ['symposium_ingredients'],
        equipment: ['symposium_equipment'],
        recipe: ['symposium_recipes'],
      };
      var relevantCollections = collections[cat.type] || [];

      var countPromises = relevantCollections.map(function (col) {
        return state.db
          .collection(col)
          .where('category', '==', cat.id)
          .get()
          .then(function (snap) {
            return snap.size;
          });
      });

      Promise.all(countPromises).then(function (counts) {
        var totalCount = counts.reduce(function (sum, c) {
          return sum + c;
        }, 0);

        if (totalCount === 0) {
          if (!window.confirm('Delete "' + cat.name + '"? This cannot be undone.')) return;
          Symposium.firestore.deleteCategory(cat.id).catch(function (err) {
            console.error('Delete failed:', err);
          });
        } else {
          Symposium.appellations._openDeleteModal(cat, totalCount, relevantCollections);
        }
      });
    },

    _openDeleteModal: function (cat, count, collections) {
      _deletingCat = cat;
      _deletingCollections = collections;

      var warning = Symposium.getRef('app-delete-warning');
      warning.textContent =
        count +
        ' item(s) are assigned to \u201C' +
        cat.name +
        '\u201D. Choose a new category before deleting.';

      var select = Symposium.getRef('app-delete-reassign-select');
      select.innerHTML = '<option value="">Select a category\u2026</option>';
      // For recipe categories, only offer targets that have at least one subcategory
      // (to guarantee a valid subcategory is available after reassignment).
      var sameType = Symposium.getCategoriesByType(cat.type).filter(function (c) {
        if (c.id === cat.id) return false;
        if (cat.type === 'recipe') {
          return c.subcategories && c.subcategories.length > 0;
        }
        return true;
      });
      sameType.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        select.appendChild(opt);
      });

      var noteEl = Symposium.getRef('app-delete-subcategory-note');
      if (noteEl) {
        noteEl.textContent = '';
        noteEl.classList.add('hidden');
      }

      select.onchange = function () {
        var targetId = select.value;
        if (!targetId || cat.type !== 'recipe') return;
        var targetCat = state.categoryMap[targetId];
        if (targetCat && targetCat.subcategories && targetCat.subcategories.length > 0) {
          if (noteEl) {
            noteEl.textContent =
              'Recipes will be reassigned to \u201C' +
              targetCat.name +
              '\u201D with subcategory set to \u201C' +
              targetCat.subcategories[0] +
              '\u201D.';
            noteEl.classList.remove('hidden');
          }
        }
      };

      Symposium.appellations._setDeleteError('');
      Symposium.getRef('modal-overlay-app-delete').classList.add('open');
    },

    closeDeleteModal: function () {
      Symposium.getRef('modal-overlay-app-delete').classList.remove('open');
      _deletingCat = null;
      _deletingCollections = [];
    },

    _setDeleteError: function (msg) {
      var el = Symposium.getRef('app-delete-error');
      if (el) el.textContent = msg || '';
    },

    confirmDelete: function () {
      var targetId = Symposium.getRef('app-delete-reassign-select').value;
      if (!targetId) {
        Symposium.appellations._setDeleteError('Please select a category to reassign items to.');
        return;
      }

      var targetCat = state.categoryMap[targetId];
      if (!targetCat) {
        Symposium.appellations._setDeleteError('Selected category not found.');
        return;
      }

      var cat = _deletingCat;
      var collections = _deletingCollections;
      var confirmBtn = Symposium.getRef('app-delete-confirm');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Working\u2026';

      var reassignPromises = collections.map(function (colName) {
        if (cat.type === 'recipe') {
          // For recipes, also update subcategory to first in target category
          var newSubcategory =
            targetCat.subcategories && targetCat.subcategories.length > 0
              ? targetCat.subcategories[0]
              : '';
          return state.db
            .collection(colName)
            .where('category', '==', cat.id)
            .get()
            .then(function (snapshot) {
              if (snapshot.empty) return;
              var batch = state.db.batch();
              snapshot.forEach(function (doc) {
                var update = {
                  category: targetId,
                  updatedAt: state.serverTimestamp(),
                };
                if (newSubcategory) {
                  update.subcategory = newSubcategory;
                }
                batch.update(doc.ref, update);
              });
              return batch.commit();
            });
        }
        return Symposium.firestore.reassignItems(colName, cat.id, targetId);
      });

      Promise.all(reassignPromises)
        .then(function () {
          return Symposium.firestore.deleteCategory(cat.id);
        })
        .then(function () {
          Symposium.appellations.closeDeleteModal();
        })
        .catch(function (err) {
          console.error('Delete with reassign failed:', err);
          Symposium.appellations._setDeleteError('Operation failed. Check console for details.');
        })
        .finally(function () {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Reassign & Delete';
        });
    },
  };
})();
