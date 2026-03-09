(function () {
  'use strict';

  var Symposium = window.Symposium;
  var state = Symposium.state;

  Symposium.firestore = {
    // Callbacks wired by app.js after all modules load
    _onCategoriesLoaded: null,
    _onCategoriesChanged: null,
    _onIngredientsChanged: null,
    _onEquipmentChanged: null,
    _onRecipesChanged: null,
    _onShoppingListChanged: null,

    loadCategories: function () {
      return new Promise(function (resolve, reject) {
        var firstCall = true;
        state.db
          .collection('symposium_categories')
          .orderBy('sortOrder')
          .onSnapshot(function (snapshot) {
            // Rebuild all category maps from scratch
            state.categoryMap = {};
            state.ingredientCategoryMap = {};
            state.equipmentCategoryMap = {};
            state.recipeCategoryMap = {};

            snapshot.forEach(function (doc) {
              var data = doc.data();
              state.categoryMap[doc.id] = data;
              if (data.type === 'equipment') {
                state.equipmentCategoryMap[doc.id] = data;
              } else if (data.type === 'recipe') {
                state.recipeCategoryMap[doc.id] = data;
              } else {
                state.ingredientCategoryMap[doc.id] = data;
              }
            });

            if (firstCall) {
              firstCall = false;
              if (Symposium.firestore._onCategoriesLoaded) {
                Symposium.firestore._onCategoriesLoaded();
              }
              resolve();
            } else {
              if (Symposium.firestore._onCategoriesChanged) {
                Symposium.firestore._onCategoriesChanged();
              }
            }
          }, reject);
      });
    },

    createCategory: function (id, data) {
      return state.db.collection('symposium_categories').doc(id).set(data);
    },

    updateCategory: function (id, data) {
      return state.db.collection('symposium_categories').doc(id).set(data);
    },

    deleteCategory: function (id) {
      return state.db.collection('symposium_categories').doc(id).delete();
    },

    swapCategorySortOrder: function (idA, idB) {
      var catA = state.categoryMap[idA];
      var catB = state.categoryMap[idB];
      if (!catA || !catB) return Promise.reject(new Error('Category not found'));

      var orderA = catA.sortOrder;
      var orderB = catB.sortOrder;

      var batch = state.db.batch();
      var refA = state.db.collection('symposium_categories').doc(idA);
      var refB = state.db.collection('symposium_categories').doc(idB);
      batch.update(refA, { sortOrder: orderB });
      batch.update(refB, { sortOrder: orderA });
      return batch.commit();
    },

    reassignItems: function (collectionName, fromCategoryId, toCategoryId) {
      return state.db
        .collection(collectionName)
        .where('category', '==', fromCategoryId)
        .get()
        .then(function (snapshot) {
          if (snapshot.empty) return;
          var batch = state.db.batch();
          snapshot.forEach(function (doc) {
            batch.update(doc.ref, {
              category: toCategoryId,
              updatedAt: state.serverTimestamp(),
            });
          });
          return batch.commit();
        });
    },

    subscribeToIngredients: function () {
      state.db
        .collection('symposium_ingredients')
        .orderBy('category')
        .orderBy('name')
        .onSnapshot(function (snapshot) {
          state.allIngredients = [];
          snapshot.forEach(function (doc) {
            state.allIngredients.push(Object.assign({ id: doc.id }, doc.data()));
          });
          state.ingredientsLoaded = true;
          if (Symposium.firestore._onIngredientsChanged) {
            Symposium.firestore._onIngredientsChanged();
          }
        });
    },

    subscribeToEquipment: function () {
      state.db
        .collection('symposium_equipment')
        .orderBy('category')
        .orderBy('name')
        .onSnapshot(function (snapshot) {
          state.allEquipment = [];
          snapshot.forEach(function (doc) {
            state.allEquipment.push(Object.assign({ id: doc.id }, doc.data()));
          });
          state.equipmentLoaded = true;
          if (Symposium.firestore._onEquipmentChanged) {
            Symposium.firestore._onEquipmentChanged();
          }
        });
    },

    subscribeToRecipes: function () {
      state.db
        .collection('symposium_recipes')
        .orderBy('category')
        .orderBy('name')
        .onSnapshot(function (snapshot) {
          state.allRecipes = [];
          snapshot.forEach(function (doc) {
            state.allRecipes.push(Object.assign({ id: doc.id }, doc.data()));
          });
          if (Symposium.firestore._onRecipesChanged) {
            Symposium.firestore._onRecipesChanged();
          }
        });
    },

    subscribeToShoppingList: function () {
      state.db
        .collection('symposium_shopping_list')
        .orderBy('category')
        .orderBy('createdAt')
        .onSnapshot(function (snapshot) {
          state.allShoppingList = [];
          snapshot.forEach(function (doc) {
            state.allShoppingList.push(Object.assign({ id: doc.id }, doc.data()));
          });
          state.shoppingListLoaded = true;
          if (Symposium.firestore._onShoppingListChanged) {
            Symposium.firestore._onShoppingListChanged();
          }
        });
    },
  };
})();
