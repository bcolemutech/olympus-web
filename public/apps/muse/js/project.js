(function () {
  'use strict';

  // A project's home (planning/the-muse.md §5, M-100; M-101 / #889): its
  // title, short description, cover and summary (Markdown, with a reading
  // view), its sections, one per element type with counts, and its settings
  // (rename, delete with confirmation). The cover is picked from the Image
  // Studio, uploaded or from its library (IM1; M-104).

  var Muse = window.Muse;
  var state = Muse.state;
  var pendingCover = null; // the cover the open form would save
  var coverAdder = null;
  var versionBox = null;

  function project() {
    return state.project;
  }

  // Saves changes to the open project, then shows it again.
  function save(changes, errorNode, button) {
    var p = project();
    if (!p) return Promise.resolve(false);
    var error = Muse.projects.check(Object.assign({}, changes));
    if (error) {
      Muse.say(errorNode, error);
      return Promise.resolve(false);
    }
    Muse.say(errorNode, '');
    if (button) button.disabled = true;
    return Muse.projects
      .update(p.id, changes)
      .then(function () {
        return Muse.projects.get(p.id);
      })
      .then(function (fresh) {
        state.project = fresh;
        draw();
        return true;
      })
      .catch(function (err) {
        Muse.say(errorNode, 'It couldn’t be saved: ' + err.message);
        return false;
      })
      .then(function (ok) {
        if (button) button.disabled = false;
        return ok;
      });
  }

  // ── The heading: cover, title, short description ──
  function drawHead() {
    var p = project();
    Muse.projects.drawCover(Muse.$('muse-p-cover'), p);
    Muse.$('muse-p-title').textContent = p.title;
    Muse.say(Muse.$('muse-p-short'), p.short);
    document.title = p.title + ' — The Muse';
  }

  function editHead(open) {
    var p = project();
    Muse.show(Muse.$('muse-p-head-form'), open);
    Muse.show(Muse.$('muse-p-head-edit'), !open);
    Muse.say(Muse.$('muse-p-head-error'), '');
    if (open) {
      Muse.$('muse-p-head-title').value = p.title;
      Muse.$('muse-p-head-short').value = p.short;
      coverAdder.reset();
      setCover(p.cover);
      Muse.$('muse-p-head-title').focus();
    }
  }

  // The cover the form shows, and would save: a studio image id, or none.
  function setCover(id) {
    pendingCover = id || null;
    Muse.projects.drawCover(Muse.$('muse-p-head-cover'), {
      title: Muse.$('muse-p-head-title').value || project().title,
      cover: pendingCover,
    });
    Muse.show(Muse.$('muse-p-head-cover-remove'), !!pendingCover);
  }

  // ── The summary: a reading view, and an editor with a preview ──
  function drawSummary() {
    var p = project();
    var view = Muse.$('muse-p-summary');
    Muse.markdown.into(view, p.summary);
    Muse.show(view, !!p.summary.trim());
    Muse.show(Muse.$('muse-p-summary-empty'), !p.summary.trim());
  }

  function editSummary(open) {
    Muse.show(Muse.$('muse-p-summary-form'), open);
    Muse.show(Muse.$('muse-p-summary-read'), !open);
    Muse.say(Muse.$('muse-p-summary-error'), '');
    if (open) {
      var text = Muse.$('muse-p-summary-text');
      text.value = project().summary;
      preview(false);
      text.focus();
    }
  }

  function preview(on) {
    var text = Muse.$('muse-p-summary-text');
    var view = Muse.$('muse-p-summary-preview');
    if (on) Muse.markdown.into(view, text.value);
    Muse.show(text, !on);
    Muse.show(view, on);
    Muse.$('muse-p-summary-write').setAttribute('aria-pressed', String(!on));
    Muse.$('muse-p-summary-show').setAttribute('aria-pressed', String(on));
  }

  // ── Sections: one per element type, with counts, each opening its list ──
  function drawSections() {
    var list = Muse.$('muse-p-sections');
    list.textContent = '';
    var counts = Muse.elements.counts();
    Muse.TYPES.forEach(function (type) {
      var tile = Muse.el('a', 'muse-section-tile');
      tile.href = '#/p/' + encodeURIComponent(project().id) + '/t/' + type.id;
      tile.dataset.type = type.id;
      tile.appendChild(Muse.el('span', 'muse-section-name', type.name));
      tile.appendChild(Muse.el('span', 'muse-section-count', String(counts[type.id] || 0)));
      list.appendChild(tile);
    });
  }

  // ── Settings: rename, delete ──
  function confirmDelete(open) {
    Muse.show(Muse.$('muse-p-delete-confirm'), open);
    Muse.show(Muse.$('muse-p-delete'), !open);
    Muse.say(Muse.$('muse-p-delete-error'), '');
    if (open) {
      Muse.$('muse-p-delete-name').textContent = project().title;
      Muse.$('muse-p-delete-no').focus();
    }
  }

  function remove() {
    var p = project();
    var button = Muse.$('muse-p-delete-yes');
    button.disabled = true;
    Muse.projects
      .remove(p.id)
      .then(function () {
        state.project = null;
        Muse.go('#/');
      })
      .catch(function (err) {
        Muse.say(Muse.$('muse-p-delete-error'), 'It couldn’t be deleted: ' + err.message);
      })
      .then(function () {
        button.disabled = false;
      });
  }

  function draw() {
    drawHead();
    drawSummary();
    drawSections();
    Muse.$('muse-p-rename-title').value = project().title;
  }

  Muse.project = {
    init: function () {
      coverAdder = Muse.photos.adder(Muse.$('muse-p-head-cover-add'), {
        id: 'muse-p-cover',
        multiple: false,
        describe: function () {
          var title = Muse.$('muse-p-head-title').value.trim() || project().title;
          return { name: title, kind: 'cover', labels: [Muse.photos.labelOf(title)] };
        },
        chosen: function () {
          return pendingCover ? [pendingCover] : [];
        },
        onAdd: function (ids) {
          setCover(ids[0]);
          return Promise.resolve();
        },
      });
      Muse.$('muse-p-head-cover-remove').addEventListener('click', function () {
        setCover(null);
      });
      Muse.$('muse-p-head-edit').addEventListener('click', function () {
        editHead(true);
      });
      Muse.$('muse-p-head-cancel').addEventListener('click', function () {
        editHead(false);
      });
      Muse.$('muse-p-head-form').addEventListener('submit', function (event) {
        event.preventDefault();
        save(
          {
            title: Muse.$('muse-p-head-title').value,
            short: Muse.$('muse-p-head-short').value,
            cover: pendingCover || '',
          },
          Muse.$('muse-p-head-error'),
          Muse.$('muse-p-head-save')
        ).then(function (ok) {
          if (ok) editHead(false);
        });
      });

      // Typing @ in the summary offers elements to link (EL6).
      Muse.suggest.mention(Muse.$('muse-p-summary-text'));

      Muse.$('muse-p-summary-edit').addEventListener('click', function () {
        editSummary(true);
      });
      Muse.$('muse-p-summary-cancel').addEventListener('click', function () {
        editSummary(false);
      });
      Muse.$('muse-p-summary-write').addEventListener('click', function () {
        preview(false);
      });
      Muse.$('muse-p-summary-show').addEventListener('click', function () {
        preview(true);
      });
      Muse.$('muse-p-summary-form').addEventListener('submit', function (event) {
        event.preventDefault();
        save(
          { summary: Muse.$('muse-p-summary-text').value },
          Muse.$('muse-p-summary-error'),
          Muse.$('muse-p-summary-save')
        ).then(function (ok) {
          if (ok) editSummary(false);
        });
      });

      Muse.$('muse-p-rename-form').addEventListener('submit', function (event) {
        event.preventDefault();
        save(
          { title: Muse.$('muse-p-rename-title').value },
          Muse.$('muse-p-rename-error'),
          Muse.$('muse-p-rename-btn')
        ).then(function (ok) {
          if (ok) Muse.say(Muse.$('muse-p-rename-done'), 'Renamed.');
        });
      });

      Muse.$('muse-p-delete').addEventListener('click', function () {
        confirmDelete(true);
      });
      Muse.$('muse-p-delete-no').addEventListener('click', function () {
        confirmDelete(false);
      });
      Muse.$('muse-p-delete-yes').addEventListener('click', remove);

      versionBox = Muse.versionForm.mount(Muse.$('muse-p-versions-box'), function () {
        return { projectId: project().id, collection: null, id: null };
      });
    },

    // Reads a project and its index into the state; false when it isn't
    // there (or isn't yours). Every view inside a project starts here.
    load: function (id) {
      state.index = null;
      state.tree = null;
      state.matcher = null;
      return Muse.projects
        .get(id)
        .catch(function () {
          return null;
        })
        .then(function (p) {
          state.project = p;
          if (!p) return false;
          // Its index, and its classifications and classes (D4), once.
          return Promise.all([Muse.elements.loadIndex(id), Muse.classStore.load(id)]).then(
            function () {
              return true;
            }
          );
        })
        .catch(function () {
          return false;
        });
    },

    // Opens a project's home by id; false when it isn't there.
    show: function (id) {
      Muse.say(Muse.$('muse-p-error'), '');
      return Muse.project.load(id).then(function (found) {
        if (!found) return false;
        Muse.fieldEditor.reset();
        editHead(false);
        editSummary(false);
        confirmDelete(false);
        versionBox.reset();
        Muse.say(Muse.$('muse-p-rename-done'), '');
        Muse.say(Muse.$('muse-p-rename-error'), '');
        draw();
        Muse.classifications.show();
        return true;
      });
    },
  };
})();
