(function () {
  'use strict';

  var Symposium = window.Symposium;
  var state = Symposium.state;

  // ── Private modal state ────────────────────────────────────────────────
  // ID of the ingredient linked to the current modal item, null for freeform.
  var _linkedIngredientId = null;

  // Shopping list item currently being offered to the cellar.
  var _intakeItem = null;

  // ── Smart suggestion state ─────────────────────────────────────────────
  // Dismissed ingredient IDs for the current session (plain object as ES5 Set).
  var _dismissedIds = {};

  // ── Smart suggestion helpers ───────────────────────────────────────────
  function _computeSuggestions() {
    var onList = {};
    state.allShoppingList.forEach(function (item) {
      if (item.ingredientId) onList[item.ingredientId] = true;
    });

    return state.allIngredients.filter(function (ing) {
      if (onList[ing.id]) return false;
      if (_dismissedIds[ing.id]) return false;
      if (ing.trackingType === 'volume') {
        if (!ing.inStock) return true;
        if (ing.openBottleLevel) {
          var level = Symposium.BOTTLE_LEVELS[ing.openBottleLevel];
          if (level && level.fill <= 0.25) return true;
        }
        return false;
      } else {
        return ing.quantity === 0 && !!ing.shoppingListDefault;
      }
    });
  }

  function _suggestionReason(ing) {
    if (!ing.inStock) return 'Out of Stock';
    if (ing.openBottleLevel) {
      var level = Symposium.BOTTLE_LEVELS[ing.openBottleLevel];
      if (level && level.fill <= 0.25) return 'Low Bottle';
    }
    return 'Out of Stock';
  }

  // ── Ingredient typeahead helpers ───────────────────────────────────────
  function _filterIngredients(query) {
    if (!query) return [];
    var q = query.toLowerCase();
    return state.allIngredients
      .filter(function (ing) {
        var catName = state.categoryMap[ing.category]
          ? state.categoryMap[ing.category].name.toLowerCase()
          : '';
        return ing.name.toLowerCase().indexOf(q) !== -1 || catName.indexOf(q) !== -1;
      })
      .slice(0, 8);
  }

  function _renderDropdown(results) {
    var dropdown = Symposium.getRef('prov-ing-dropdown');
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
      (function (i, cn) {
        item.addEventListener('click', function () {
          _selectIngredient(i, cn);
        });
      })(ing, catName);
      dropdown.appendChild(item);
    });
    dropdown.classList.remove('hidden');
  }

  function _selectIngredient(ing, catName) {
    _linkedIngredientId = ing.id;
    Symposium.getRef('prov-ing-search').value = ing.name;
    Symposium.getRef('prov-ing-dropdown').classList.add('hidden');
    Symposium.getRef('prov-field-unit').value = ing.unit || '';
    Symposium.getRef('prov-field-category').value = catName || '';
  }

  // ── Module ─────────────────────────────────────────────────────────────
  Symposium.shopping = {
    renderList: function () {
      var items = state.allShoppingList.slice();
      var listEl = Symposium.getRef('provision-list');
      var emptyEl = Symposium.getRef('empty-state-provisions');
      var countEl = Symposium.getRef('provision-count');

      listEl.innerHTML = '';

      if (items.length === 0) {
        emptyEl.classList.remove('hidden');
        countEl.classList.add('hidden');
        Symposium.getRef('btn-clear-checked').classList.add('hidden');
        Symposium.getRef('btn-offer-all').classList.add('hidden');
        return;
      }

      emptyEl.classList.add('hidden');
      countEl.classList.remove('hidden');

      var unchecked = items.filter(function (i) {
        return !i.checked;
      }).length;
      countEl.textContent = unchecked + ' item' + (unchecked !== 1 ? 's' : '') + ' remaining';

      var hasChecked = items.some(function (i) {
        return i.checked;
      });
      Symposium.getRef('btn-clear-checked').classList.toggle('hidden', !hasChecked);
      Symposium.getRef('btn-offer-all').classList.toggle('hidden', !hasChecked);

      // Group by category
      var groups = {};
      var groupOrder = [];
      items.forEach(function (item) {
        var cat = item.category || '';
        if (!Object.prototype.hasOwnProperty.call(groups, cat)) {
          groups[cat] = [];
          groupOrder.push(cat);
        }
        groups[cat].push(item);
      });

      groupOrder.sort(function (a, b) {
        return a.localeCompare(b);
      });

      groupOrder.forEach(function (cat) {
        var header = document.createElement('h3');
        header.className = 'provision-category-header';
        header.textContent = cat || 'Uncategorized';
        listEl.appendChild(header);

        // Unchecked first, then checked; preserve Firestore order within each group
        var catItems = groups[cat].slice().sort(function (a, b) {
          if (a.checked !== b.checked) return a.checked ? 1 : -1;
          return 0;
        });

        catItems.forEach(function (item) {
          listEl.appendChild(Symposium.shopping.renderCard(item));
        });
      });
    },

    renderCard: function (item) {
      var row = document.createElement('div');
      row.className = 'provision-item' + (item.checked ? ' provision-item--checked' : '');

      // Checkbox button
      var checkbox = document.createElement('button');
      checkbox.type = 'button';
      checkbox.className =
        'provision-checkbox' + (item.checked ? ' provision-checkbox--checked' : '');
      checkbox.setAttribute(
        'aria-label',
        item.checked ? 'Mark as still needed' : 'Mark as obtained'
      );
      checkbox.textContent = item.checked ? '\u2713' : '';
      (function (i) {
        checkbox.addEventListener('click', function () {
          Symposium.shopping.handleCheckToggle(i);
        });
      })(item);
      row.appendChild(checkbox);

      // Content
      var content = document.createElement('div');
      content.className = 'provision-item-content';

      var nameEl = document.createElement('span');
      nameEl.className = 'provision-item-name';
      nameEl.textContent = item.name;
      content.appendChild(nameEl);

      if (item.quantity != null || item.unit) {
        var metaEl = document.createElement('span');
        metaEl.className = 'provision-item-meta';
        var parts = [];
        if (item.quantity != null) parts.push(item.quantity);
        if (item.unit) parts.push(item.unit);
        metaEl.textContent = parts.join('\u00a0');
        content.appendChild(metaEl);
      }

      if (item.notes) {
        var notesEl = document.createElement('span');
        notesEl.className = 'provision-item-notes';
        notesEl.textContent = item.notes;
        content.appendChild(notesEl);
      }

      (function (i) {
        content.addEventListener('click', function () {
          Symposium.shopping.openModal(i);
        });
      })(item);
      row.appendChild(content);

      // Offer to Cellar button — only shown on checked items
      if (item.checked) {
        var offerBtn = document.createElement('button');
        offerBtn.type = 'button';
        offerBtn.className = 'btn-icon btn-offer provision-item-offer';
        offerBtn.setAttribute('aria-label', 'Offer ' + item.name + ' to the Cellar');
        offerBtn.textContent = '\uD83C\uDFFA';
        (function (i) {
          offerBtn.addEventListener('click', function () {
            Symposium.shopping.openIntakeModal(i);
          });
        })(item);
        row.appendChild(offerBtn);
      }

      // Delete button
      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-icon btn-delete provision-item-delete';
      deleteBtn.setAttribute('aria-label', 'Remove ' + item.name + ' from provisions');
      deleteBtn.textContent = '\u2715';
      (function (i) {
        deleteBtn.addEventListener('click', function () {
          Symposium.shopping.handleDelete(i);
        });
      })(item);
      row.appendChild(deleteBtn);

      return row;
    },

    updateBadge: function () {
      var unchecked = state.allShoppingList.filter(function (i) {
        return !i.checked;
      }).length;
      var badge = Symposium.getRef('tab-provisions-badge');
      badge.textContent = unchecked;
      badge.classList.toggle('hidden', unchecked === 0);
    },

    openModal: function (item) {
      state.shoppingEditingId = item ? item.id : null;
      _linkedIngredientId = item ? (item.ingredientId != null ? item.ingredientId : null) : null;

      Symposium.getRef('prov-ing-search').value = item ? item.name : '';
      Symposium.getRef('prov-ing-dropdown').classList.add('hidden');
      Symposium.getRef('prov-field-quantity').value = item
        ? item.quantity != null
          ? item.quantity
          : 1
        : 1;
      Symposium.getRef('prov-field-unit').value = item ? item.unit || '' : '';
      Symposium.getRef('prov-field-category').value = item ? item.category || '' : '';
      Symposium.getRef('prov-field-notes').value = item ? item.notes || '' : '';
      Symposium.getRef('prov-error-name').textContent = '';

      Symposium.getRef('modal-title-provisions').textContent = item
        ? 'Edit Item'
        : 'Add to Provisions';
      Symposium.getRef('btn-save-provisions').textContent = item ? 'Save' : 'Add to List';

      Symposium.getRef('modal-overlay-provisions').classList.add('open');
      Symposium.getRef('prov-ing-search').focus();
    },

    closeModal: function () {
      Symposium.getRef('modal-overlay-provisions').classList.remove('open');
      state.shoppingEditingId = null;
      _linkedIngredientId = null;
    },

    handleSubmit: function (e) {
      e.preventDefault();

      var name = Symposium.getRef('prov-ing-search').value.trim();
      if (!name) {
        Symposium.getRef('prov-error-name').textContent = 'Name is required';
        return;
      }
      Symposium.getRef('prov-error-name').textContent = '';

      var qty = parseFloat(Symposium.getRef('prov-field-quantity').value) || 0;
      var unit = Symposium.getRef('prov-field-unit').value;
      var category = Symposium.getRef('prov-field-category').value.trim();
      var notes = Symposium.getRef('prov-field-notes').value.trim();

      var data = {
        name: name,
        quantity: qty,
        unit: unit,
        category: category,
        checked: false,
        addedFrom: _linkedIngredientId ? 'auto-suggest' : 'manual',
        ingredientId: _linkedIngredientId || null,
        sourceRecipeId: null,
        notes: notes,
        updatedAt: state.serverTimestamp(),
      };

      var btnSave = Symposium.getRef('btn-save-provisions');
      btnSave.disabled = true;
      btnSave.textContent = 'Saving\u2026';

      var collection = state.db.collection('symposium_shopping_list');
      var promise;

      if (state.shoppingEditingId) {
        var existingItem = state.allShoppingList.find(function (i) {
          return i.id === state.shoppingEditingId;
        });
        if (existingItem) {
          data.checked = existingItem.checked;
          data.createdAt = existingItem.createdAt;
        } else {
          data.createdAt = state.serverTimestamp();
        }
        promise = collection.doc(state.shoppingEditingId).set(data);
      } else {
        data.createdAt = state.serverTimestamp();
        promise = collection.add(data);
      }

      promise
        .then(function () {
          Symposium.shopping.closeModal();
        })
        .catch(function (err) {
          console.error('Failed to save provision:', err);
          Symposium.getRef('prov-error-name').textContent = 'Failed to save. Try again.';
        })
        .finally(function () {
          btnSave.disabled = false;
          btnSave.textContent = state.shoppingEditingId ? 'Save' : 'Add to List';
        });
    },

    handleCheckToggle: function (item) {
      var newChecked = !item.checked;
      var localItem = state.allShoppingList.find(function (i) {
        return i.id === item.id;
      });
      if (localItem) localItem.checked = newChecked;
      Symposium.shopping.renderList();
      Symposium.shopping.updateBadge();

      state.db
        .collection('symposium_shopping_list')
        .doc(item.id)
        .update({ checked: newChecked, updatedAt: state.serverTimestamp() })
        .catch(function () {
          if (localItem) localItem.checked = !newChecked;
          Symposium.shopping.renderList();
          Symposium.shopping.updateBadge();
        });
    },

    handleDelete: function (item) {
      state.db
        .collection('symposium_shopping_list')
        .doc(item.id)
        .delete()
        .catch(function (err) {
          console.error('Failed to delete provision:', err);
        });
    },

    clearChecked: function () {
      var checked = state.allShoppingList.filter(function (i) {
        return i.checked;
      });
      var promises = checked.map(function (item) {
        return state.db.collection('symposium_shopping_list').doc(item.id).delete();
      });
      Promise.all(promises).catch(function (err) {
        console.error('Failed to clear checked provisions:', err);
      });
    },

    renderSuggestions: function () {
      var sectionEl = Symposium.getRef('suggestions-section');
      var listEl = Symposium.getRef('suggestion-list');

      if (!state.ingredientsLoaded || !state.shoppingListLoaded) {
        if (listEl) {
          listEl.innerHTML = '';
        }
        if (sectionEl) {
          sectionEl.classList.add('hidden');
        }
        return;
      }

      var suggestions = _computeSuggestions();

      listEl.innerHTML = '';

      if (suggestions.length === 0) {
        sectionEl.classList.add('hidden');
        return;
      }

      sectionEl.classList.remove('hidden');

      suggestions.forEach(function (ing) {
        var row = document.createElement('div');
        row.className = 'suggestion-item';

        var info = document.createElement('div');
        info.className = 'suggestion-item-info';

        var nameEl = document.createElement('span');
        nameEl.className = 'suggestion-item-name';
        nameEl.textContent = ing.name;
        info.appendChild(nameEl);

        var badges = document.createElement('span');
        badges.className = 'suggestion-item-badges';

        var catName = state.categoryMap[ing.category]
          ? state.categoryMap[ing.category].name
          : ing.category || '';
        if (catName) {
          var catBadge = document.createElement('span');
          catBadge.className = 'badge badge-category';
          catBadge.textContent = catName;
          badges.appendChild(catBadge);
        }

        var reasonBadge = document.createElement('span');
        reasonBadge.className = 'badge badge-reason';
        reasonBadge.textContent = _suggestionReason(ing);
        badges.appendChild(reasonBadge);

        info.appendChild(badges);
        row.appendChild(info);

        var actions = document.createElement('div');
        actions.className = 'suggestion-item-actions';

        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn-add-suggestion';
        addBtn.textContent = '+ Add';
        (function (i, btn) {
          btn.addEventListener('click', function () {
            Symposium.shopping._addSuggestion(i, btn);
          });
        })(ing, addBtn);
        actions.appendChild(addBtn);

        var dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'btn-dismiss-suggestion';
        dismissBtn.setAttribute('aria-label', 'Dismiss suggestion for ' + ing.name);
        dismissBtn.textContent = '\u2715';
        (function (id) {
          dismissBtn.addEventListener('click', function () {
            Symposium.shopping._dismissSuggestion(id);
          });
        })(ing.id);
        actions.appendChild(dismissBtn);

        row.appendChild(actions);
        listEl.appendChild(row);
      });
    },

    _addSuggestion: function (ing, btn) {
      btn.disabled = true;
      btn.textContent = 'Adding\u2026';

      var catName = state.categoryMap[ing.category]
        ? state.categoryMap[ing.category].name
        : ing.category || '';

      var data = {
        name: ing.name,
        quantity: 1,
        unit: ing.unit || '',
        category: catName,
        checked: false,
        addedFrom: 'auto-suggest',
        ingredientId: ing.id,
        sourceRecipeId: null,
        notes: '',
        createdAt: state.serverTimestamp(),
        updatedAt: state.serverTimestamp(),
      };

      state.db
        .collection('symposium_shopping_list')
        .add(data)
        .catch(function (err) {
          console.error('Failed to add suggestion:', err);
          btn.disabled = false;
          btn.textContent = '+ Add';
        });
    },

    _dismissSuggestion: function (ingId) {
      _dismissedIds[ingId] = true;
      Symposium.shopping.renderSuggestions();
    },

    openIntakeModal: function (item) {
      _intakeItem = item;

      Symposium.getRef('intake-item-name').textContent = item.name;
      Symposium.getRef('intake-field-brand').value = '';
      Symposium.getRef('intake-check-full').checked = true;
      Symposium.getRef('intake-error').textContent = '';

      var ingredient = item.ingredientId
        ? state.allIngredients.find(function (i) {
            return i.id === item.ingredientId;
          })
        : null;

      // Show brand input only when there is a linked ingredient
      Symposium.getRef('intake-brand-group').classList.toggle('hidden', !ingredient);
      // Show "Set to Full" checkbox only for volume-tracked linked ingredients
      var isVolume = ingredient && ingredient.trackingType === 'volume';
      Symposium.getRef('intake-full-group').classList.toggle('hidden', !isVolume);

      Symposium.getRef('modal-overlay-intake').classList.add('open');
    },

    closeIntakeModal: function () {
      Symposium.getRef('modal-overlay-intake').classList.remove('open');
      _intakeItem = null;
    },

    confirmIntake: function () {
      var item = _intakeItem;
      if (!item) return;

      var confirmBtn = Symposium.getRef('btn-confirm-intake');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Offering\u2026';
      Symposium.getRef('intake-error').textContent = '';

      var self = this;

      var finish = function () {
        return state.db
          .collection('symposium_shopping_list')
          .doc(item.id)
          .delete()
          .then(function () {
            self.closeIntakeModal();
          });
      };

      var onError = function (err) {
        console.error('Intake failed:', err);
        Symposium.getRef('intake-error').textContent = 'Offering failed. Please try again.';
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Offer to the Cellar';
      };

      if (item.ingredientId) {
        var ingredient = state.allIngredients.find(function (i) {
          return i.id === item.ingredientId;
        });

        if (ingredient) {
          var updateData = { updatedAt: state.serverTimestamp(), inStock: true };

          if (ingredient.trackingType === 'volume') {
            updateData.stock = ingredient.stock + 1;
          } else {
            updateData.quantity = ingredient.quantity + 1;
          }

          if (
            ingredient.trackingType === 'volume' &&
            Symposium.getRef('intake-check-full').checked
          ) {
            updateData.openBottleLevel = 'full';
          }

          var brand = Symposium.getRef('intake-field-brand').value.trim();
          if (brand) {
            updateData.brand = brand;
          }

          state.db
            .collection('symposium_ingredients')
            .doc(ingredient.id)
            .update(updateData)
            .then(finish)
            .catch(onError);
        } else {
          // Linked ingredient no longer exists — just clear the item
          console.warn(
            'Intake: ingredient ' + item.ingredientId + ' not found, removing list item only'
          );
          finish().catch(onError);
        }
      } else {
        // Freeform item — no inventory to update
        finish().catch(onError);
      }
    },

    handleBulkIntake: function () {
      var checked = state.allShoppingList.filter(function (i) {
        return i.checked;
      });

      var promises = checked.map(function (item) {
        var deleteItem = function () {
          return state.db.collection('symposium_shopping_list').doc(item.id).delete();
        };

        if (item.ingredientId) {
          var ingredient = state.allIngredients.find(function (i) {
            return i.id === item.ingredientId;
          });

          if (ingredient) {
            var updateData = {
              updatedAt: state.serverTimestamp(),
              inStock: true,
              openBottleLevel: 'full',
            };

            if (ingredient.trackingType === 'volume') {
              updateData.stock = ingredient.stock + 1;
            } else {
              updateData.quantity = ingredient.quantity + 1;
              // openBottleLevel only applies to volume items
              delete updateData.openBottleLevel;
            }

            return state.db
              .collection('symposium_ingredients')
              .doc(ingredient.id)
              .update(updateData)
              .then(deleteItem);
          }
        }

        return deleteItem();
      });

      Promise.all(promises).catch(function (err) {
        console.error('Bulk intake failed:', err);
      });
    },

    initSearchListeners: function () {
      var searchEl = Symposium.getRef('prov-ing-search');
      searchEl.addEventListener('input', function () {
        // User is typing manually — unlink from any previously selected ingredient
        _linkedIngredientId = null;
        var q = searchEl.value.trim();
        var results = _filterIngredients(q);
        _renderDropdown(results);
      });
      searchEl.addEventListener('blur', function () {
        window.setTimeout(function () {
          Symposium.getRef('prov-ing-dropdown').classList.add('hidden');
        }, 150);
      });
    },
  };
})();
