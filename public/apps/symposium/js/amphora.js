(function () {
  'use strict';

  var Symposium = window.Symposium;
  var state = Symposium.state;

  Symposium.amphora = {
    createSVG: function (level, size) {
      var ns = 'http://www.w3.org/2000/svg';
      var fillPct =
        level && Symposium.BOTTLE_LEVELS[level] ? Symposium.BOTTLE_LEVELS[level].fill : -1;
      var isSealed = fillPct < 0;
      var w = size || 24;
      var h = Math.round(w * 1.4);
      var uid = Math.random().toString(36).substr(2, 6);

      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      svg.setAttribute('viewBox', '0 0 40 56');
      svg.setAttribute('aria-hidden', 'true');

      var defs = document.createElementNS(ns, 'defs');

      var clipPath = document.createElementNS(ns, 'clipPath');
      clipPath.setAttribute('id', 'bc-' + uid);

      var clipShape = document.createElementNS(ns, 'path');
      clipShape.setAttribute(
        'd',
        'M16,8 L16,14 C8,18 4,26 4,34 C4,44 10,52 20,52 C30,52 36,44 36,34 C36,26 32,18 24,14 L24,8 Z'
      );
      clipPath.appendChild(clipShape);
      defs.appendChild(clipPath);

      var grad = document.createElementNS(ns, 'linearGradient');
      grad.setAttribute('id', 'lg-' + uid);
      grad.setAttribute('x1', '0');
      grad.setAttribute('y1', '0');
      grad.setAttribute('x2', '0');
      grad.setAttribute('y2', '1');

      var stop1 = document.createElementNS(ns, 'stop');
      stop1.setAttribute('offset', '0%');
      stop1.setAttribute('stop-color', '#ffd54f');
      var stop2 = document.createElementNS(ns, 'stop');
      stop2.setAttribute('offset', '100%');
      stop2.setAttribute('stop-color', '#ff8a65');
      grad.appendChild(stop1);
      grad.appendChild(stop2);
      defs.appendChild(grad);

      svg.appendChild(defs);

      // Bottle outline
      var outline = document.createElementNS(ns, 'path');
      outline.setAttribute(
        'd',
        'M15,2 L25,2 L25,8 L24,8 L24,14 ' +
          'C32,18 38,26 38,34 C38,46 30,54 20,54 ' +
          'C10,54 2,46 2,34 C2,26 8,18 16,14 L16,8 L15,8 Z'
      );
      outline.setAttribute('fill', 'none');
      outline.setAttribute('stroke', isSealed ? '#37474f' : '#90a4ae');
      outline.setAttribute('stroke-width', '1.5');
      svg.appendChild(outline);

      // Handles
      var handleL = document.createElementNS(ns, 'path');
      handleL.setAttribute('d', 'M8,20 C-2,24 -2,38 8,42');
      handleL.setAttribute('fill', 'none');
      handleL.setAttribute('stroke', isSealed ? '#37474f' : '#90a4ae');
      handleL.setAttribute('stroke-width', '1.5');
      handleL.setAttribute('stroke-linecap', 'round');
      svg.appendChild(handleL);

      var handleR = document.createElementNS(ns, 'path');
      handleR.setAttribute('d', 'M32,20 C42,24 42,38 32,42');
      handleR.setAttribute('fill', 'none');
      handleR.setAttribute('stroke', isSealed ? '#37474f' : '#90a4ae');
      handleR.setAttribute('stroke-width', '1.5');
      handleR.setAttribute('stroke-linecap', 'round');
      svg.appendChild(handleR);

      // Liquid fill
      if (!isSealed && fillPct > 0) {
        var fillGroup = document.createElementNS(ns, 'g');
        fillGroup.setAttribute('clip-path', 'url(#bc-' + uid + ')');

        var fillHeight = 44 * fillPct;
        var fillY = 52 - fillHeight;

        var fillRect = document.createElementNS(ns, 'rect');
        fillRect.setAttribute('x', '0');
        fillRect.setAttribute('y', String(fillY));
        fillRect.setAttribute('width', '40');
        fillRect.setAttribute('height', String(fillHeight));
        fillRect.setAttribute('fill', 'url(#lg-' + uid + ')');
        fillRect.setAttribute('opacity', '0.85');
        fillGroup.appendChild(fillRect);

        svg.appendChild(fillGroup);
      }

      // Empty state: red X
      if (!isSealed && fillPct === 0) {
        var emptyLine1 = document.createElementNS(ns, 'line');
        emptyLine1.setAttribute('x1', '14');
        emptyLine1.setAttribute('y1', '28');
        emptyLine1.setAttribute('x2', '26');
        emptyLine1.setAttribute('y2', '40');
        emptyLine1.setAttribute('stroke', '#ef5350');
        emptyLine1.setAttribute('stroke-width', '1.5');
        emptyLine1.setAttribute('opacity', '0.6');
        svg.appendChild(emptyLine1);

        var emptyLine2 = document.createElementNS(ns, 'line');
        emptyLine2.setAttribute('x1', '26');
        emptyLine2.setAttribute('y1', '28');
        emptyLine2.setAttribute('x2', '14');
        emptyLine2.setAttribute('y2', '40');
        emptyLine2.setAttribute('stroke', '#ef5350');
        emptyLine2.setAttribute('stroke-width', '1.5');
        emptyLine2.setAttribute('opacity', '0.6');
        svg.appendChild(emptyLine2);
      }

      // Sealed state: cork cap
      if (isSealed) {
        var cork = document.createElementNS(ns, 'rect');
        cork.setAttribute('x', '14');
        cork.setAttribute('y', '0');
        cork.setAttribute('width', '12');
        cork.setAttribute('height', '6');
        cork.setAttribute('rx', '2');
        cork.setAttribute('fill', '#37474f');
        svg.appendChild(cork);
      }

      return svg;
    },

    openPopover: function (ing, anchorEl) {
      var popoverEl = Symposium.getRef('amphora-popover');

      if (
        state.amphoraPopoverIng &&
        state.amphoraPopoverIng.id === ing.id &&
        popoverEl.classList.contains('open')
      ) {
        Symposium.amphora.closePopover();
        return;
      }

      state.amphoraPopoverIng = ing;
      Symposium.amphora._renderOptions(ing);

      var rect = anchorEl.getBoundingClientRect();
      var popW = 220;
      var left = rect.left + rect.width / 2 - popW / 2;
      var top = rect.bottom + 8;

      if (left < 8) left = 8;
      if (left + popW > window.innerWidth - 8) left = window.innerWidth - 8 - popW;
      if (top + 300 > window.innerHeight) {
        top = rect.top - 8 - 300;
        if (top < 8) top = 8;
      }

      popoverEl.style.left = left + 'px';
      popoverEl.style.top = top + 'px';
      popoverEl.classList.add('open');
    },

    closePopover: function () {
      Symposium.getRef('amphora-popover').classList.remove('open');
      state.amphoraPopoverIng = null;
    },

    _renderOptions: function (ing) {
      var optionsEl = Symposium.getRef('amphora-level-options');
      optionsEl.innerHTML = '';

      // Stock count display
      var stockInfo = document.createElement('div');
      stockInfo.className = 'amphora-stock-info';
      var stockCount = Number(ing.stock) || 0;
      stockInfo.textContent =
        stockCount + (stockCount === 1 ? ' bottle' : ' bottles') +
        ' (' + (ing.bottleSize || 0) + (ing.bottleSizeUnit || 'ml') + ' each)';
      optionsEl.appendChild(stockInfo);

      var dividerTop = document.createElement('div');
      dividerTop.className = 'amphora-level-divider';
      optionsEl.appendChild(dividerTop);

      Symposium.LEVEL_ORDER.forEach(function (levelKey) {
        var levelInfo = Symposium.BOTTLE_LEVELS[levelKey];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'amphora-level-btn' + (ing.openBottleLevel === levelKey ? ' active' : '');

        btn.appendChild(Symposium.amphora.createSVG(levelKey, 18));

        var labelSpan = document.createElement('span');
        labelSpan.textContent = levelInfo.label;
        btn.appendChild(labelSpan);

        btn.addEventListener('click', function () {
          Symposium.amphora.handleLevelChange(ing, levelKey);
        });

        optionsEl.appendChild(btn);
      });

      var divider = document.createElement('div');
      divider.className = 'amphora-level-divider';
      optionsEl.appendChild(divider);

      var sealedBtn = document.createElement('button');
      sealedBtn.type = 'button';
      sealedBtn.className =
        'amphora-level-btn amphora-sealed-btn' + (!ing.openBottleLevel ? ' active' : '');

      sealedBtn.appendChild(Symposium.amphora.createSVG(null, 18));

      var sealedLabel = document.createElement('span');
      sealedLabel.textContent = 'Sealed (no open bottle)';
      sealedBtn.appendChild(sealedLabel);

      sealedBtn.addEventListener('click', function () {
        Symposium.amphora.handleLevelChange(ing, null);
      });

      optionsEl.appendChild(sealedBtn);
    },

    handleLevelChange: function (ing, newLevel) {
      var oldLevel = ing.openBottleLevel || null;

      if (newLevel === oldLevel) {
        Symposium.amphora.closePopover();
        return;
      }

      var localIng = state.allIngredients.find(function (i) {
        return i.id === ing.id;
      });

      var currentStock = Number(ing.stock) || 0;
      var newStock = currentStock;
      var setShoppingList = false;
      var finalLevel = newLevel;

      // Auto-rotation: when bottle is emptied
      if (newLevel === 'empty') {
        if (currentStock > 1) {
          // More bottles remain — consume this one, rotate to next sealed bottle
          newStock = currentStock - 1;
          finalLevel = null; // reset to sealed
          window.alert(
            'Bottle finished! Stock reduced to ' + newStock + '.'
          );
        } else {
          // Last bottle — out of stock
          newStock = 0;
          finalLevel = 'empty';
          if (
            window.confirm(
              'Last bottle empty! Move "' + ing.name + '" to the shopping list?'
            )
          ) {
            setShoppingList = true;
            if (localIng) localIng.shoppingListDefault = true;
          }
        }
      }

      // Optimistic UI update
      if (localIng) {
        if (finalLevel) {
          localIng.openBottleLevel = finalLevel;
        } else {
          delete localIng.openBottleLevel;
        }
        localIng.stock = newStock;
        localIng.inStock = Symposium.computeInStock(
          localIng.trackingType, newStock, localIng.quantity
        );
      }

      Symposium.ingredients.renderList();
      Symposium.amphora.closePopover();

      // Build Firestore update
      var updateData = {
        updatedAt: state.serverTimestamp(),
        stock: newStock,
        inStock: Symposium.computeInStock(ing.trackingType, newStock, ing.quantity),
      };

      if (setShoppingList) {
        updateData.shoppingListDefault = true;
      }

      if (finalLevel) {
        updateData.openBottleLevel = finalLevel;
      } else {
        updateData.openBottleLevel = firebase.firestore.FieldValue.delete();
      }

      state.db
        .collection('symposium_ingredients')
        .doc(ing.id)
        .update(updateData)
        .catch(function (err) {
          console.error('Failed to update bottle level:', err);
          // Rollback optimistic update
          if (localIng) {
            if (oldLevel) {
              localIng.openBottleLevel = oldLevel;
            } else {
              delete localIng.openBottleLevel;
            }
            localIng.stock = currentStock;
            localIng.inStock = Symposium.computeInStock(
              localIng.trackingType, currentStock, localIng.quantity
            );
          }
          Symposium.ingredients.renderList();
        });
    },
  };
})();
