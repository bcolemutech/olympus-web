(function () {
  'use strict';

  // Elements on the page (M-102 / #890): the index, read once per project
  // and kept in memory, and the plans from ./model.js done as Firestore
  // batches, so an element and its index line are always written together
  // (the rules refuse either alone).

  var Muse = window.Muse;
  var state = Muse.state;
  var model = Muse.model;

  function projectRef(projectId) {
    return state.db.collection('muse_projects').doc(projectId);
  }

  // A plan's sentinels as Firestore's. The server's time is told by its shape
  // (./versions.js isNow), as plans from ./versions.js carry their own.
  function toFirestore(value) {
    if (Muse.versions.isNow(value)) return firebase.firestore.FieldValue.serverTimestamp();
    if (value === model.DELETE) return firebase.firestore.FieldValue.delete();
    if (Array.isArray(value)) return value.map(toFirestore);
    if (value && typeof value === 'object' && value.constructor === Object) {
      var out = {};
      Object.keys(value).forEach(function (key) {
        out[key] = toFirestore(value[key]);
      });
      return out;
    }
    return value;
  }

  function docAt(path) {
    var parts = path.split('/');
    var ref = state.db.collection(parts[0]).doc(parts[1]);
    for (var i = 2; i < parts.length; i += 2) ref = ref.collection(parts[i]).doc(parts[i + 1]);
    return ref;
  }

  // Does a plan in one batch; the index in memory follows once it's done.
  function commit(writes) {
    var batch = state.db.batch();
    writes.forEach(function (write) {
      var ref = docAt(write.path);
      var data = toFirestore(write.data);
      if (write.op === 'delete') batch.delete(ref);
      else if (write.op === 'set') batch.set(ref, data);
      else if (write.op === 'merge') batch.set(ref, data, { merge: true });
      else batch.update(ref, data);
    });
    return batch.commit().then(function () {
      if (state.index) model.applyToIndex(state.index, writes);
      state.matcher = null;
    });
  }

  function fromDoc(doc) {
    var data = doc.data() || {};
    return {
      id: doc.id,
      type: data.type,
      name: data.name || '',
      aliases: Array.isArray(data.aliases) ? data.aliases : [],
      bio: data.bio || '',
      fields: data.fields && typeof data.fields === 'object' ? data.fields : {},
      images: Array.isArray(data.images) ? data.images : [],
      primary: data.primary === undefined ? null : data.primary,
      mentions: Array.isArray(data.mentions) ? data.mentions : [],
      appearance: data.appearance || '',
      residence: data.residence || null,
      shard: data.shard,
      retired: data.retired === true,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
    };
  }

  // A live element's type, or null: for links and their checks.
  function typeOf(id) {
    var entry = state.index && state.index.entries[id];
    return entry ? entry.type : null;
  }

  function nameOf(id) {
    var entry = state.index && state.index.entries[id];
    return entry ? entry.name : null;
  }

  function defsFor(type) {
    var all = (state.project && state.project.fields) || {};
    return all[type] || [];
  }

  // Live elements of a type, from the index, sorted by name.
  function listOf(type) {
    var entries = (state.index && state.index.entries) || {};
    return Object.keys(entries)
      .filter(function (id) {
        return !type || entries[id].type === type;
      })
      .map(function (id) {
        return Object.assign({ id: id }, entries[id]);
      })
      .sort(function (a, b) {
        return (
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1)
        );
      });
  }

  function counts() {
    var out = {};
    listOf().forEach(function (entry) {
      out[entry.type] = (out[entry.type] || 0) + 1;
    });
    return out;
  }

  // The names the text can link to, rebuilt when the index changes (EL6).
  function matcher() {
    if (!state.matcher) {
      state.matcher = Muse.links.buildMatcher(state.index ? state.index.entries : {}, {
        escape: Muse.markdown.escape,
      });
    }
    return state.matcher;
  }
  Muse.markdown.useMatcher(matcher);

  // Names and aliases matching `query`, best first (EL5).
  function search(query, options) {
    return Muse.links.search(state.index ? state.index.entries : {}, query, options);
  }

  // The live elements whose texts link to `id` (EL6), by name. At most 100
  // are read, which `more` says.
  var MENTIONS_READ = 100;
  function mentionedIn(projectId, id) {
    return projectRef(projectId)
      .collection('elements')
      .where('mentions', 'array-contains', id)
      .limit(MENTIONS_READ)
      .get()
      .then(function (snap) {
        var found = snap.docs
          .map(fromDoc)
          .filter(function (e) {
            return e.id !== id && !e.retired && state.index && state.index.entries[e.id];
          })
          .sort(function (a, b) {
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          });
        return { elements: found, more: snap.docs.length >= MENTIONS_READ };
      });
  }

  Muse.elements = {
    commit: commit,
    matcher: matcher,
    search: search,
    mentionedIn: mentionedIn,
    projectRef: projectRef,
    typeOf: typeOf,
    nameOf: nameOf,
    defsFor: defsFor,
    listOf: listOf,
    counts: counts,

    // Reads a project's index into state.index.
    loadIndex: function (projectId) {
      return projectRef(projectId)
        .collection('index')
        .get()
        .then(function (snap) {
          state.index = model.readIndex(
            snap.docs.map(function (doc) {
              return { id: doc.id, data: doc.data() };
            })
          );
          state.indexOf = projectId;
          state.matcher = null;
          return state.index;
        });
    },

    get: function (projectId, id) {
      return projectRef(projectId)
        .collection('elements')
        .doc(id)
        .get()
        .then(function (doc) {
          return doc.exists ? fromDoc(doc) : null;
        });
    },

    // Makes an element from `input` (name and the rest); gives its id.
    create: function (projectId, type, input) {
      var checked = model.checkElement(type, input, {
        defs: defsFor(type),
        elementType: typeOf,
      });
      if (checked.error) return Promise.reject(new Error(checked.error));
      var id = projectRef(projectId).collection('elements').doc().id;
      return commit(model.planCreate(projectId, id, type, checked.value, state.index)).then(
        function () {
          return id;
        }
      );
    },

    // Saves changes to an element (its name, aliases, bio, fields and, for
    // a character, appearance and residence).
    update: function (projectId, current, input) {
      var checked = model.checkElement(current.type, input, {
        defs: defsFor(current.type),
        elementType: typeOf,
        current: current,
      });
      if (checked.error) return Promise.reject(new Error(checked.error));
      return commit(model.planUpdate(projectId, current, checked.value));
    },

    // Saves an element's photo library: its studio image ids in order, and
    // which is primary (IM1). The index line follows when the primary moves.
    setPhotos: function (projectId, current, photos) {
      var checked = model.checkPhotos(photos);
      if (checked.error) return Promise.reject(new Error(checked.error));
      return commit(model.planUpdate(projectId, current, checked.value));
    },

    retire: function (projectId, current) {
      return commit(model.planRetire(projectId, current));
    },

    restore: function (projectId, current) {
      return commit(model.planRestore(projectId, current));
    },
  };
})();
