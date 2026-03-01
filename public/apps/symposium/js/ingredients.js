(function () {
  'use strict';

  var Symposium = window.Symposium;
  var state = Symposium.state;

  Symposium.ingredients = {
    renderCategoryGrid: function () {
      var gridEl = Symposium.getRef('category-grid');
      gridEl.innerHTML = '';

      gridEl.appendChild(
        Symposium.makeCategoryCard(
          'all',
          'All',
          state.allIngredients.length,
          state.activeFilter === 'all',
          function (id) {
            state.activeFilter = id;
            Symposium.ingredients.renderCategoryGrid();
            Symposium.ingredients.renderList();
          }
        )
      );

      Object.keys(state.ingredientCategoryMap).forEach(function (id) {
        var count = state.allIngredients.filter(function (i) {
          return i.category === id;
        }).length;
        gridEl.appendChild(
          Symposium.makeCategoryCard(
            id,
            state.ingredientCategoryMap[id].name,
            count,
            state.activeFilter === id,
            function (catId) {
              state.activeFilter = catId;
              Symposium.ingredients.renderCategoryGrid();
              Symposium.ingredients.renderList();
            }
          )
        );
      });
    },

    renderList: function () {
      var result = state.allIngredients.slice();

      // 1. Category filter
      if (state.activeFilter !== 'all') {
        result = result.filter(function (ing) {
          return ing.category === state.activeFilter;
        });
      }

      // 2. Search filter — name, category name, or tags (case-insensitive)
      if (state.searchQuery) {
        var q = state.searchQuery.toLowerCase();
        result = result.filter(function (ing) {
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
      }

      // 3. Stock filter
      if (state.stockFilter === 'in-stock') {
        result = result.filter(function (ing) {
          return ing.inStock;
        });
      } else if (state.stockFilter === 'out-of-stock') {
        result = result.filter(function (ing) {
          return !ing.inStock;
        });
      }

      // 4. Sort
      if (state.sortOption === 'alpha') {
        result.sort(function (a, b) {
          return a.name.localeCompare(b.name);
        });
      } else if (state.sortOption === 'stock') {
        result.sort(function (a, b) {
          if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      } else if (state.sortOption === 'category') {
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
        listEl: Symposium.getRef('ingredient-list'),
        emptyEl: Symposium.getRef('empty-state'),
        countEl: Symposium.getRef('ingredient-count'),
        renderCard: Symposium.ingredients.renderCard,
        noun: 'ingredient',
        getEmptyMessage: function () {
          if (state.searchQuery && state.activeFilter !== 'all') {
            return 'The Oracle finds nothing matching that name in this category.';
          } else if (state.searchQuery) {
            return 'The Oracle finds nothing by that name.';
          } else if (state.stockFilter === 'in-stock') {
            return state.activeFilter !== 'all'
              ? 'No in-stock ingredients in this category.'
              : 'No in-stock ingredients found.';
          } else if (state.stockFilter === 'out-of-stock') {
            return state.activeFilter !== 'all'
              ? 'No out-of-stock ingredients in this category.'
              : 'No out-of-stock ingredients found.';
          } else if (state.activeFilter !== 'all' && state.allIngredients.length > 0) {
            return 'No ingredients in this category yet.';
          }
          return 'The Cellar awaits its first offering.';
        },
      });
    },

    renderCard: function (ing) {
      var isVolume = ing.trackingType === 'volume';
      var card = document.createElement('div');
      card.className = 'ingredient-card';

      var header = document.createElement('div');
      header.className = 'ingredient-card-header';

      var info = document.createElement('div');

      var name = document.createElement('h3');
      name.className = 'ingredient-name';
      name.textContent = ing.name;

      var meta = document.createElement('div');
      meta.className = 'ingredient-meta';

      var catBadge = document.createElement('span');
      catBadge.className = 'badge badge-category';
      catBadge.textContent = state.categoryMap[ing.category]
        ? state.categoryMap[ing.category].name
        : ing.category;
      meta.appendChild(catBadge);

      if (ing.subcategory) {
        var subBadge = document.createElement('span');
        subBadge.className = 'badge badge-subcategory';
        subBadge.textContent = ing.subcategory;
        meta.appendChild(subBadge);
      }

      var stockBadge = document.createElement('span');
      stockBadge.className =
        'badge badge-stock ' + (ing.inStock ? 'badge-in-stock' : 'badge-out-of-stock');
      stockBadge.textContent = ing.inStock ? 'In Stock' : 'Out of Stock';
      meta.appendChild(stockBadge);

      info.appendChild(name);
      info.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'ingredient-actions';

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-icon btn-edit';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', function () {
        Symposium.ingredients.openModal(ing);
      });

      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-icon btn-delete';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function () {
        Symposium.ingredients.handleDelete(ing);
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      header.appendChild(info);

      // Amphora bottle level indicator — only for volume items
      if (isVolume) {
        var amphoraBtn = document.createElement('button');
        amphoraBtn.type = 'button';
        amphoraBtn.className =
          'amphora-indicator' + (!ing.openBottleLevel ? ' amphora-sealed' : '');
        amphoraBtn.title = ing.openBottleLevel
          ? 'Bottle level: ' + (Symposium.BOTTLE_LEVELS[ing.openBottleLevel] || {}).label
          : 'No open bottle (sealed)';

        amphoraBtn.appendChild(Symposium.amphora.createSVG(ing.openBottleLevel, 24));

        var amphoraLabelEl = document.createElement('span');
        amphoraLabelEl.className = 'amphora-label';
        amphoraLabelEl.textContent = ing.openBottleLevel
          ? (Symposium.BOTTLE_LEVELS[ing.openBottleLevel] || {}).label || '?'
          : 'Sealed';
        amphoraBtn.appendChild(amphoraLabelEl);

        amphoraBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          Symposium.amphora.openPopover(ing, amphoraBtn);
        });

        header.appendChild(amphoraBtn);
      }

      header.appendChild(actions);
      card.appendChild(header);

      // Details row
      var details = document.createElement('div');
      details.className = 'ingredient-details';

      if (isVolume) {
        // Stock count with +/- controls
        var stockDetail = document.createElement('span');
        stockDetail.className = 'stock-controls';

        var stockLabel = document.createElement('span');
        stockLabel.className = 'ingredient-detail-label';
        stockLabel.textContent = 'Stock:';
        stockDetail.appendChild(stockLabel);

        var minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'btn-adjust btn-adjust-minus';
        minusBtn.textContent = '\u2212';
        minusBtn.addEventListener('click', function () {
          Symposium.ingredients.adjustStock(ing, -1);
        });
        stockDetail.appendChild(minusBtn);

        var stockValue = document.createElement('span');
        stockValue.className = 'adjust-value';
        stockValue.textContent = Number(ing.stock) || 0;
        stockDetail.appendChild(stockValue);

        var plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'btn-adjust btn-adjust-plus';
        plusBtn.textContent = '+';
        plusBtn.addEventListener('click', function () {
          Symposium.ingredients.adjustStock(ing, 1);
        });
        stockDetail.appendChild(plusBtn);

        details.appendChild(stockDetail);

        // Bottle size info
        var sizeDetail = document.createElement('span');
        var sizeLabel = document.createElement('span');
        sizeLabel.className = 'ingredient-detail-label';
        sizeLabel.textContent = 'Bottle:';
        sizeDetail.appendChild(sizeLabel);
        sizeDetail.appendChild(
          document.createTextNode(' ' + (ing.bottleSize || 0) + (ing.bottleSizeUnit || 'ml'))
        );
        details.appendChild(sizeDetail);
      } else {
        // Quantity with +/- controls
        var qtyDetail = document.createElement('span');
        qtyDetail.className = 'qty-controls';

        var qtyLabel = document.createElement('span');
        qtyLabel.className = 'ingredient-detail-label';
        qtyLabel.textContent = 'Qty:';
        qtyDetail.appendChild(qtyLabel);

        var qtyMinusBtn = document.createElement('button');
        qtyMinusBtn.type = 'button';
        qtyMinusBtn.className = 'btn-adjust btn-adjust-minus';
        qtyMinusBtn.textContent = '\u2212';
        qtyMinusBtn.addEventListener('click', function () {
          Symposium.ingredients.adjustQuantity(ing, -1);
        });
        qtyDetail.appendChild(qtyMinusBtn);

        var qtyValue = document.createElement('span');
        qtyValue.className = 'adjust-value';
        qtyValue.textContent = Number(ing.quantity) || 0;
        qtyDetail.appendChild(qtyValue);

        var qtyPlusBtn = document.createElement('button');
        qtyPlusBtn.type = 'button';
        qtyPlusBtn.className = 'btn-adjust btn-adjust-plus';
        qtyPlusBtn.textContent = '+';
        qtyPlusBtn.addEventListener('click', function () {
          Symposium.ingredients.adjustQuantity(ing, 1);
        });
        qtyDetail.appendChild(qtyPlusBtn);

        details.appendChild(qtyDetail);
      }

      if (ing.lowStockThreshold > 0) {
        var threshDetail = document.createElement('span');
        var threshLabel = document.createElement('span');
        threshLabel.className = 'ingredient-detail-label';
        threshLabel.textContent = 'Low at:';
        threshDetail.appendChild(threshLabel);
        threshDetail.appendChild(document.createTextNode(' ' + ing.lowStockThreshold));
        details.appendChild(threshDetail);
      }

      card.appendChild(details);

      if (ing.tags && Array.isArray(ing.tags) && ing.tags.length > 0) {
        var tagsRow = document.createElement('div');
        tagsRow.className = 'ingredient-meta';
        tagsRow.style.marginTop = '0.5rem';
        ing.tags.forEach(function (tag) {
          var tagBadge = document.createElement('span');
          tagBadge.className = 'badge badge-subcategory';
          tagBadge.textContent = tag;
          tagsRow.appendChild(tagBadge);
        });
        card.appendChild(tagsRow);
      }

      if (ing.notes) {
        var notes = document.createElement('div');
        notes.className = 'ingredient-notes';
        notes.textContent = ing.notes;
        card.appendChild(notes);
      }

      return card;
    },

    adjustStock: function (ing, delta) {
      var currentStock = Number(ing.stock) || 0;
      var newStock = Math.max(0, currentStock + delta);
      if (newStock === currentStock) return;

      var localIng = state.allIngredients.find(function (i) {
        return i.id === ing.id;
      });
      if (localIng) {
        localIng.stock = newStock;
        localIng.inStock = Symposium.computeInStock('volume', newStock, 0);
      }
      Symposium.ingredients.renderList();

      state.db
        .collection('symposium_ingredients')
        .doc(ing.id)
        .update({
          stock: newStock,
          inStock: Symposium.computeInStock('volume', newStock, 0),
          updatedAt: state.serverTimestamp(),
        })
        .catch(function (err) {
          console.error('Failed to update stock:', err);
          if (localIng) {
            localIng.stock = currentStock;
            localIng.inStock = Symposium.computeInStock('volume', currentStock, 0);
          }
          Symposium.ingredients.renderList();
        });
    },

    adjustQuantity: function (ing, delta) {
      var currentQty = Number(ing.quantity) || 0;
      var newQty = Math.max(0, currentQty + delta);
      if (newQty === currentQty) return;

      var localIng = state.allIngredients.find(function (i) {
        return i.id === ing.id;
      });
      if (localIng) {
        localIng.quantity = newQty;
        localIng.inStock = Symposium.computeInStock('quantity', 0, newQty);
      }
      Symposium.ingredients.renderList();

      state.db
        .collection('symposium_ingredients')
        .doc(ing.id)
        .update({
          quantity: newQty,
          inStock: Symposium.computeInStock('quantity', 0, newQty),
          updatedAt: state.serverTimestamp(),
        })
        .catch(function (err) {
          console.error('Failed to update quantity:', err);
          if (localIng) {
            localIng.quantity = currentQty;
            localIng.inStock = Symposium.computeInStock('quantity', 0, currentQty);
          }
          Symposium.ingredients.renderList();
        });
    },

    populateCategorySelect: function () {
      var fieldCategory = Symposium.getRef('field-category');
      Object.keys(state.ingredientCategoryMap).forEach(function (id) {
        var opt = document.createElement('option');
        opt.value = id;
        opt.textContent = state.ingredientCategoryMap[id].name;
        fieldCategory.appendChild(opt);
      });
    },

    _toggleTrackingFields: function (unit) {
      var isVolume = Symposium.inferTrackingType(unit) === 'volume';
      Symposium.getRef('volume-fields-stock').classList.toggle('hidden', !isVolume);
      Symposium.getRef('volume-fields-size').classList.toggle('hidden', !isVolume);
      Symposium.getRef('quantity-fields').classList.toggle('hidden', isVolume);
    },

    openModal: function (ingredient) {
      state.editingId = ingredient ? ingredient.id : null;
      Symposium.getRef('modal-title').textContent = ingredient
        ? 'Edit Ingredient'
        : 'Add Ingredient';

      var formEl = Symposium.getRef('ingredient-form');
      var fieldName = Symposium.getRef('field-name');
      var fieldCategory = Symposium.getRef('field-category');
      var fieldSubcategory = Symposium.getRef('field-subcategory');
      var fieldUnit = Symposium.getRef('field-unit');
      var fieldQuantity = Symposium.getRef('field-quantity');
      var fieldStock = Symposium.getRef('field-stock');
      var fieldBottleSize = Symposium.getRef('field-bottle-size');
      var fieldBottleSizeUnit = Symposium.getRef('field-bottle-size-unit');
      var fieldTags = Symposium.getRef('field-tags');
      var fieldNotes = Symposium.getRef('field-notes');
      var fieldShopping = Symposium.getRef('field-shopping');
      var fieldThreshold = Symposium.getRef('field-threshold');

      Symposium.ingredients._clearErrors();

      if (ingredient) {
        fieldName.value = ingredient.name || '';
        fieldCategory.value = ingredient.category || '';
        Symposium.populateSubcategoryDropdown(ingredient.category, fieldSubcategory);
        fieldSubcategory.value = ingredient.subcategory || '';
        fieldUnit.value = ingredient.unit || '';
        fieldStock.value = ingredient.stock != null ? ingredient.stock : 0;
        fieldBottleSize.value = ingredient.bottleSize != null ? ingredient.bottleSize : 750;
        fieldBottleSizeUnit.value = ingredient.bottleSizeUnit || 'ml';
        fieldQuantity.value = ingredient.quantity != null ? ingredient.quantity : 0;
        fieldTags.value =
          ingredient.tags && Array.isArray(ingredient.tags) ? ingredient.tags.join(', ') : '';
        fieldNotes.value = ingredient.notes || '';
        fieldShopping.checked = !!ingredient.shoppingListDefault;
        fieldThreshold.value =
          ingredient.lowStockThreshold != null ? ingredient.lowStockThreshold : 0;
        Symposium.ingredients._toggleTrackingFields(ingredient.unit || '');
      } else {
        formEl.reset();
        fieldStock.value = '0';
        fieldBottleSize.value = '750';
        fieldBottleSizeUnit.value = 'ml';
        fieldQuantity.value = '0';
        fieldThreshold.value = '0';
        fieldSubcategory.innerHTML = '<option value="">Select category first</option>';
        Symposium.ingredients._toggleTrackingFields('');
      }

      Symposium.getRef('modal-overlay').classList.add('open');
      fieldName.focus();
    },

    closeModal: function () {
      Symposium.getRef('modal-overlay').classList.remove('open');
      state.editingId = null;
    },

    _clearErrors: function () {
      var errors = Symposium.getRef('ingredient-form').querySelectorAll('.form-error');
      errors.forEach(function (el) {
        el.textContent = '';
      });
    },

    _setError: function (fieldId, msg) {
      var el = document.getElementById('error-' + fieldId);
      if (el) el.textContent = msg;
    },

    _validateForm: function () {
      Symposium.ingredients._clearErrors();
      var valid = true;

      if (!Symposium.getRef('field-name').value.trim()) {
        Symposium.ingredients._setError('name', 'Name is required');
        valid = false;
      }
      if (!Symposium.getRef('field-category').value) {
        Symposium.ingredients._setError('category', 'Category is required');
        valid = false;
      }
      if (!Symposium.getRef('field-subcategory').value) {
        Symposium.ingredients._setError('subcategory', 'Subcategory is required');
        valid = false;
      }

      var unit = Symposium.getRef('field-unit').value;
      if (!unit) {
        Symposium.ingredients._setError('unit', 'Unit is required');
        valid = false;
      }

      var trackingType = Symposium.inferTrackingType(unit);
      if (trackingType === 'volume') {
        var stock = Symposium.getRef('field-stock');
        if (stock.value === '' || parseInt(stock.value, 10) < 0) {
          Symposium.ingredients._setError('stock', 'Stock must be 0 or greater');
          valid = false;
        }
        var bottleSize = Symposium.getRef('field-bottle-size');
        if (bottleSize.value === '' || parseFloat(bottleSize.value) < 0) {
          Symposium.ingredients._setError('bottle-size', 'Bottle size must be 0 or greater');
          valid = false;
        }
      } else {
        var qty = Symposium.getRef('field-quantity');
        if (qty.value === '' || parseInt(qty.value, 10) < 0) {
          Symposium.ingredients._setError('quantity', 'Quantity must be 0 or greater');
          valid = false;
        }
      }

      return valid;
    },

    _checkDuplicate: function (name, category) {
      var trimmed = name.trim().toLowerCase();
      return state.allIngredients.some(function (ing) {
        return (
          ing.id !== state.editingId &&
          ing.name.toLowerCase() === trimmed &&
          ing.category === category
        );
      });
    },

    handleSubmit: function (e) {
      e.preventDefault();
      if (!Symposium.ingredients._validateForm()) return;

      var fieldName = Symposium.getRef('field-name');
      var fieldCategory = Symposium.getRef('field-category');
      var fieldSubcategory = Symposium.getRef('field-subcategory');
      var fieldUnit = Symposium.getRef('field-unit');
      var fieldQuantity = Symposium.getRef('field-quantity');
      var fieldStock = Symposium.getRef('field-stock');
      var fieldBottleSize = Symposium.getRef('field-bottle-size');
      var fieldBottleSizeUnit = Symposium.getRef('field-bottle-size-unit');
      var fieldTags = Symposium.getRef('field-tags');
      var fieldNotes = Symposium.getRef('field-notes');
      var fieldShopping = Symposium.getRef('field-shopping');
      var fieldThreshold = Symposium.getRef('field-threshold');

      var name = fieldName.value.trim();
      var category = fieldCategory.value;

      if (Symposium.ingredients._checkDuplicate(name, category)) {
        Symposium.ingredients._setError(
          'name',
          'An ingredient with this name already exists in this category'
        );
        return;
      }

      var tags = fieldTags.value
        .split(',')
        .map(function (t) {
          return t.trim();
        })
        .filter(Boolean);

      var unit = fieldUnit.value;
      var trackingType = Symposium.inferTrackingType(unit);

      var stock = trackingType === 'volume' ? parseInt(fieldStock.value, 10) || 0 : 0;
      var bottleSize = trackingType === 'volume' ? parseFloat(fieldBottleSize.value) || 0 : 0;
      var bottleSizeUnit = trackingType === 'volume' ? fieldBottleSizeUnit.value : 'ml';
      var quantity = trackingType === 'quantity' ? parseInt(fieldQuantity.value, 10) || 0 : 0;

      var data = {
        name: name,
        category: category,
        subcategory: fieldSubcategory.value,
        tags: tags,
        unit: unit,
        type: 'consumable',
        trackingType: trackingType,
        stock: stock,
        bottleSize: bottleSize,
        bottleSizeUnit: bottleSizeUnit,
        quantity: quantity,
        inStock: Symposium.computeInStock(trackingType, stock, quantity),
        notes: fieldNotes.value.trim(),
        shoppingListDefault: fieldShopping.checked,
        lowStockThreshold: parseInt(fieldThreshold.value, 10) || 0,
        updatedAt: state.serverTimestamp(),
      };

      var btnSave = Symposium.getRef('btn-save');
      btnSave.disabled = true;
      btnSave.textContent = 'Saving\u2026';

      var promise;
      if (state.editingId) {
        var existingIng = state.allIngredients.find(function (ing) {
          return ing.id === state.editingId;
        });
        if (existingIng && existingIng.createdAt) {
          data.createdAt = existingIng.createdAt;
        } else {
          data.createdAt = state.serverTimestamp();
        }
        if (existingIng && existingIng.openBottleLevel) {
          data.openBottleLevel = existingIng.openBottleLevel;
        }
        promise = state.db.collection('symposium_ingredients').doc(state.editingId).set(data);
      } else {
        data.createdAt = state.serverTimestamp();
        promise = state.db.collection('symposium_ingredients').add(data);
      }

      promise
        .then(function () {
          Symposium.ingredients.closeModal();
        })
        .catch(function (err) {
          console.error('Failed to save ingredient:', err);
          Symposium.ingredients._setError('name', 'Failed to save. Check console for details.');
        })
        .finally(function () {
          btnSave.disabled = false;
          btnSave.textContent = 'Save';
        });
    },

    handleDelete: function (ing) {
      if (!window.confirm('Remove "' + ing.name + '" from the cellar?')) {
        return;
      }

      state.db
        .collection('symposium_ingredients')
        .doc(ing.id)
        .delete()
        .catch(function (err) {
          console.error('Failed to delete ingredient:', err);
        });
    },
  };
})();
