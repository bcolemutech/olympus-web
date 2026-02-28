(function () {
  'use strict';

  var Symposium = window.Symposium;
  var state = Symposium.state;

  Symposium.firestore = {
    // Callbacks wired by app.js after all modules load
    _onCategoriesLoaded: null,
    _onIngredientsChanged: null,
    _onEquipmentChanged: null,
    _onRecipesChanged: null,

    loadCategories: function () {
      return state.db
        .collection('symposium_categories')
        .orderBy('sortOrder')
        .get()
        .then(function (snapshot) {
          snapshot.forEach(function (doc) {
            state.categoryMap[doc.id] = doc.data();
          });
          // Split categories by type
          Object.keys(state.categoryMap).forEach(function (id) {
            if (state.categoryMap[id].type === 'equipment') {
              state.equipmentCategoryMap[id] = state.categoryMap[id];
            } else if (state.categoryMap[id].type === 'recipe') {
              state.recipeCategoryMap[id] = state.categoryMap[id];
            } else {
              state.ingredientCategoryMap[id] = state.categoryMap[id];
            }
          });
          if (Symposium.firestore._onCategoriesLoaded) {
            Symposium.firestore._onCategoriesLoaded();
          }
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
  };
})();
