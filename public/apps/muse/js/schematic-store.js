(function () {
  'use strict';

  // Schematics on the page (planning/the-muse.md §3 SC1–SC9, D7; M-202 /
  // #915): an element's schematics read from Firestore, where an element is
  // marked (SC9), and ./schematics.js's plans done as batches (./elements.js
  // commit). The page reads a location's or object's schematics when its page
  // opens; nothing is kept in step in memory but the list the page holds.

  var Muse = window.Muse;
  var state = Muse.state;
  var S = Muse.schematics;

  function collection() {
    return Muse.elements.projectRef(state.project.id).collection('schematics');
  }

  function run(plan) {
    if (plan.error) return Promise.reject(new Error(plan.error));
    return Muse.elements.commit(plan.value).then(function () {
      return plan;
    });
  }

  function read(snap) {
    return snap.docs.map(function (doc) {
      return S.read(doc.id, doc.data());
    });
  }

  // What the point checks need: a link is to a live element.
  function options() {
    return { elementType: Muse.elements.typeOf };
  }

  Muse.schematicStore = {
    // An element's schematics, in order.
    forElement: function (elementId) {
      return collection()
        .where('element', '==', elementId)
        .get()
        .then(function (snap) {
          return S.inOrder(read(snap));
        });
    },

    // Where an element is marked (SC9): [{ schematic, points }].
    markedOn: function (elementId) {
      return collection()
        .where('links', 'array-contains', elementId)
        .limit(100)
        .get()
        .then(function (snap) {
          return S.markedOn(read(snap), elementId);
        });
    },

    // Makes a schematic of the open element on a studio picture; gives its id.
    create: function (element, input, siblings) {
      var id = collection().doc().id;
      return run(
        S.planCreate(
          state.project.id,
          id,
          { element: element.id, name: input.name, image: input.image },
          { elementType: element.type, siblings: siblings }
        )
      ).then(function () {
        return id;
      });
    },

    update: function (current, changes) {
      return run(S.planUpdate(state.project.id, current, changes));
    },

    // Moves a schematic earlier (-1) or later (1) among its element's.
    move: function (siblings, id, direction) {
      return run(S.planMove(state.project.id, siblings, id, direction));
    },

    remove: function (id) {
      return run(S.planDelete(state.project.id, id));
    },

    // Adds a point at the end; gives its id.
    addPoint: function (current, input) {
      return run(S.planAddPoint(state.project.id, current, input, options())).then(function (p) {
        return p.id;
      });
    },

    changePoint: function (current, id, input) {
      return run(S.planChangePoint(state.project.id, current, id, input, options()));
    },

    removePoint: function (current, id) {
      return run(S.planRemovePoint(state.project.id, current, id));
    },
  };
})();
