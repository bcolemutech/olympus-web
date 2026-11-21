(function () {
  'use strict';

  // Keeping a version from the page (planning/the-muse.md §3 VR1, VR2; M-105
  // / #893): the thing as it is stored now (not as a form shows it), its
  // earlier versions, and ./versions.js's plan done as one batch, so the
  // oldest past the last 50 goes in the same write that keeps the new one.
  // Browsing and reverting come with M-400.

  var Muse = window.Muse;

  // `collection` is 'elements' with the element's `id`, or none for the
  // project itself. Gives { id, dropped }.
  function save(projectId, collection, id, name) {
    var project = Muse.elements.projectRef(projectId);
    var thing = collection ? project.collection(collection).doc(id) : project;
    var of = Muse.versions.ofPath(projectId, collection, id);
    var versions = project.collection('versions');
    return Promise.all([thing.get(), versions.where('of', '==', of).get()]).then(function (got) {
      if (!got[0].exists) throw new Error('It is no longer there.');
      var plan = Muse.versions.planSave({
        projectId: projectId,
        id: versions.doc().id,
        of: of,
        data: got[0].data(),
        existing: got[1].docs.map(function (doc) {
          return { id: doc.id, at: doc.data().at };
        }),
        by: 'page',
        name: name,
      });
      if (plan.error) throw new Error(plan.error);
      return Muse.elements.commit(plan.writes).then(function () {
        return { id: plan.id, dropped: plan.dropped };
      });
    });
  }

  Muse.versionStore = { save: save };
})();
