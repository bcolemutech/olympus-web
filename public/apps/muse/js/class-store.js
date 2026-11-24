(function () {
  'use strict';

  // Classifications and classes on the page (planning/the-muse.md §3 CL1–CL10,
  // D4, D6; M-201 / #914): the project's tree, read once with its index and
  // kept in memory (state.tree), and the plans from ./classes.js done as
  // batches (./elements.js commit, which keeps the tree and the index in
  // step). What the plans can't know from the tree alone is read here: which
  // elements, live or retired, hold a class (CL7) or two of a classification's
  // (D6).

  var Muse = window.Muse;
  var state = Muse.state;
  var C = Muse.classes;

  function project() {
    return Muse.elements.projectRef(state.project.id);
  }

  function run(plan) {
    if (plan.error) return Promise.reject(new Error(plan.error));
    return Muse.elements.commit(plan.value);
  }

  // The elements of a type, live (from the index) and retired (read), with
  // their classes: for making a classification single.
  function holders(type) {
    var entries = (state.index && state.index.entries) || {};
    var live = Object.keys(entries)
      .filter(function (id) {
        return entries[id].type === type;
      })
      .map(function (id) {
        return { id: id, name: entries[id].name, classes: entries[id].classes };
      });
    return project()
      .collection('elements')
      .where('retired', '==', true)
      .where('type', '==', type)
      .get()
      .then(function (snap) {
        return live.concat(
          snap.docs.map(function (doc) {
            var data = doc.data();
            return { id: doc.id, name: data.name, classes: data.classes || [] };
          })
        );
      });
  }

  // Whether any element, live or retired, is in a class.
  function held(id) {
    return project()
      .collection('elements')
      .where('classes', 'array-contains', id)
      .limit(1)
      .get()
      .then(function (snap) {
        return snap.docs.length > 0;
      });
  }

  function newId(collection) {
    return project().collection(collection).doc().id;
  }

  Muse.classStore = {
    // Reads a project's classifications and classes into state.tree (D4).
    load: function (projectId) {
      var ref = Muse.elements.projectRef(projectId);
      var docs = function (snap) {
        return snap.docs.map(function (doc) {
          return { id: doc.id, data: doc.data() };
        });
      };
      return Promise.all([
        ref.collection('classifications').get(),
        ref.collection('classes').get(),
      ]).then(function (got) {
        state.tree = C.readTree(docs(got[0]), docs(got[1]));
        state.matcher = null;
        return state.tree;
      });
    },

    createClassification: function (input) {
      var id = newId('classifications');
      return run(C.planCreateClassification(state.project.id, id, input, state.tree)).then(
        function () {
          return id;
        }
      );
    },

    updateClassification: function (id, input) {
      var current = state.tree.classifications[id];
      var making = input.multiple === false && current && current.multiple;
      return (making ? holders(current.type) : Promise.resolve([])).then(function (list) {
        return run(C.planUpdateClassification(state.project.id, state.tree, id, input, list));
      });
    },

    deleteClassification: function (id) {
      return run(C.planDeleteClassification(state.project.id, state.tree, id));
    },

    // Makes a class: { classification, parent, name, description }; gives its id.
    createClass: function (input) {
      var id = newId('classes');
      return run(C.planCreateClass(state.project.id, id, input, state.tree)).then(function () {
        return id;
      });
    },

    updateClass: function (id, input) {
      return run(C.planUpdateClass(state.project.id, state.tree, id, input));
    },

    // Saves a class's photos (as an element's: ./model.js checkPhotos).
    setPhotos: function (id, photos) {
      var checked = Muse.model.checkPhotos(photos);
      if (checked.error) return Promise.reject(new Error(checked.error));
      return run(C.planUpdateClass(state.project.id, state.tree, id, {}, checked.value));
    },

    // Deletes a class, refused while anything is in it (CL7).
    deleteClass: function (id) {
      if ((state.tree.kids[id] || []).length) {
        return run(C.planDeleteClass(state.project.id, state.tree, id, false));
      }
      return held(id).then(function (inUse) {
        return run(C.planDeleteClass(state.project.id, state.tree, id, inUse));
      });
    },
  };
})();
