(function () {
  'use strict';

  // A project's document, read and written by the page (D1):
  // muse_projects/{projectId} = { owner, title, short, summary, cover,
  // createdAt, updatedAt } (planning/the-muse.md §4). The rules check its
  // shape and that it is the signed-in user's.

  var Muse = window.Muse;
  var state = Muse.state;
  var COLLECTION = 'muse_projects';

  function now() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function fromDoc(doc) {
    var data = doc.data() || {};
    return {
      id: doc.id,
      owner: data.owner,
      title: data.title || '',
      short: data.short || '',
      summary: data.summary || '',
      cover: data.cover || null,
      fields: data.fields && typeof data.fields === 'object' ? data.fields : {},
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
    };
  }

  // Trims a project's text and checks it against the rules' limits; returns
  // an error to show, or null.
  function check(fields) {
    if ('title' in fields) {
      fields.title = String(fields.title || '').trim();
      if (!fields.title) return 'A project needs a title.';
      if (fields.title.length > Muse.LIMITS.title) {
        return 'A title is at most ' + Muse.LIMITS.title + ' characters.';
      }
    }
    if ('short' in fields) {
      fields.short = String(fields.short || '').trim();
      if (fields.short.length > Muse.LIMITS.short) {
        return 'The short description is at most ' + Muse.LIMITS.short + ' characters.';
      }
    }
    if ('summary' in fields) {
      fields.summary = String(fields.summary || '');
      if (fields.summary.length > Muse.LIMITS.summary) return 'The summary is too long.';
    }
    if ('fields' in fields) {
      var defs = Muse.fields.checkAll(fields.fields);
      if (defs.error) return defs.error;
      fields.fields = defs.value;
    }
    if ('cover' in fields) {
      fields.cover = String(fields.cover || '').trim() || null;
      if (fields.cover && fields.cover.length > Muse.LIMITS.cover)
        return 'That image id is too long.';
    }
    return null;
  }

  var projects = {
    check: check,

    // The owner's projects, last changed first (sorted here, so no index).
    list: function () {
      return state.db
        .collection(COLLECTION)
        .where('owner', '==', state.uid)
        .get()
        .then(function (snap) {
          state.projects = snap.docs.map(fromDoc).sort(function (a, b) {
            return Muse.millis(b.updatedAt) - Muse.millis(a.updatedAt);
          });
          return state.projects;
        });
    },

    get: function (id) {
      return state.db
        .collection(COLLECTION)
        .doc(id)
        .get()
        .then(function (doc) {
          return doc.exists ? fromDoc(doc) : null;
        });
    },

    create: function (fields) {
      var data = { title: fields.title, short: fields.short || '' };
      var error = check(data);
      if (error) return Promise.reject(new Error(error));
      var ref = state.db.collection(COLLECTION).doc();
      return ref
        .set({
          owner: state.uid,
          title: data.title,
          short: data.short,
          summary: '',
          cover: null,
          createdAt: now(),
          updatedAt: now(),
        })
        .then(function () {
          return ref.id;
        });
    },

    // Changes some of title, short, summary, cover and fields (EL2).
    update: function (id, changes) {
      var data = {};
      ['title', 'short', 'summary', 'cover', 'fields'].forEach(function (key) {
        if (key in changes) data[key] = changes[key];
      });
      var error = check(data);
      if (error) return Promise.reject(new Error(error));
      data.updatedAt = now();
      return state.db.collection(COLLECTION).doc(id).update(data);
    },

    // Deletes a project with everything in it.
    remove: function (id) {
      var ref = state.db.collection(COLLECTION).doc(id);
      return Promise.all(
        Muse.PROJECT_PARTS.map(function (part) {
          return ref
            .collection(part)
            .get()
            .then(function (snap) {
              return Promise.all(
                snap.docs.map(function (doc) {
                  return doc.ref.delete();
                })
              );
            });
        })
      ).then(function () {
        return ref.delete();
      });
    },
  };

  // A studio image's picture for a cover (IM1). Until the studio opens for
  // the muse claim (M-104), a muse-only user can't read the library, and a
  // cover shows its monogram instead.
  var covers = {};
  projects.coverLink = function (imageId) {
    if (!imageId) return Promise.resolve(null);
    if (!covers[imageId]) {
      covers[imageId] = state.db
        .collection('studio_images')
        .doc(imageId)
        .get()
        .then(function (doc) {
          var record = doc.exists ? doc.data() : null;
          return (record && record.link) || null;
        })
        .catch(function () {
          return null;
        });
    }
    return covers[imageId];
  };

  // Fills a cover box: the image when it can be shown, else the title's
  // first letter.
  projects.drawCover = function (box, project) {
    box.textContent = '';
    box.classList.add('muse-cover');
    var letter = Muse.el('span', 'muse-cover-letter', (project.title || '?').charAt(0));
    box.appendChild(letter);
    projects.coverLink(project.cover).then(function (link) {
      if (!link) return;
      var img = Muse.el('img', 'muse-cover-img');
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('load', function () {
        letter.classList.add('hidden');
      });
      img.addEventListener('error', function () {
        img.remove();
      });
      img.src = link;
      box.appendChild(img);
    });
  };

  Muse.projects = projects;
})();
