(function () {
  'use strict';

  // A class's page (planning/the-muse.md §3 CL6, D9; M-201 / #914): its path,
  // each step a link; its name and description (Markdown, with @-links and a
  // reading view), edited in one form; its photos, as an element's (M-104);
  // its subclasses, with "New subclass"; the live elements in it, and those
  // beneath it with their own class; what links to it; "Save version"; and
  // deleting it, refused while anything is in it (CL7). No relationships or
  // custom fields.

  var Muse = window.Muse;
  var state = Muse.state;
  var C = Muse.classes;
  var gallery = null;
  var versionBox = null;
  var openId = null;

  function current() {
    return state.tree && state.tree.classes[openId];
  }

  function projectHash() {
    return '#/p/' + encodeURIComponent(state.project.id);
  }

  function classHash(id) {
    return projectHash() + '/c/' + encodeURIComponent(id);
  }

  function elementRow(id, path) {
    var entry = state.index.entries[id];
    var a = Muse.el('a', 'muse-el-row');
    a.href = projectHash() + '/e/' + encodeURIComponent(id);
    a.dataset.id = id;
    a.appendChild(Muse.el('span', 'muse-el-row-name', entry.name));
    a.appendChild(Muse.el('span', 'muse-el-row-aliases', path || Muse.TYPE[entry.type].one));
    return a;
  }

  function byName(ids) {
    return ids.sort(function (a, b) {
      return state.index.entries[a].name.localeCompare(state.index.entries[b].name, undefined, {
        sensitivity: 'base',
      });
    });
  }

  // ── Reading ─────────────────────────────────────
  function drawPath(c) {
    var nav = Muse.$('muse-c-path');
    nav.textContent = '';
    var classification = state.tree.classifications[c.classification];
    var home = Muse.el('a', 'muse-c-step', classification ? classification.name : '');
    home.href = projectHash();
    nav.appendChild(home);
    C.chain(state.tree, c.id).forEach(function (step) {
      nav.appendChild(Muse.el('span', 'muse-c-sep', ' › '));
      if (step.id === c.id) {
        var here = Muse.el('span', 'muse-c-step muse-c-here', step.name);
        here.setAttribute('aria-current', 'page');
        nav.appendChild(here);
      } else {
        var a = Muse.el('a', 'muse-c-step', step.name);
        a.href = classHash(step.id);
        nav.appendChild(a);
      }
    });
  }

  function drawSubclasses(c) {
    var list = Muse.$('muse-c-subs');
    list.textContent = '';
    var kids = C.children(state.tree, c.classification, c.id);
    kids.forEach(function (k) {
      var a = Muse.el('a', 'muse-el-row');
      a.href = classHash(k.id);
      a.dataset.id = k.id;
      a.appendChild(Muse.el('span', 'muse-el-row-name', k.name));
      var count = C.membersOf(state.tree, state.index.entries, k.id).length;
      a.appendChild(
        Muse.el('span', 'muse-el-row-aliases', count === 1 ? '1 element' : count + ' elements')
      );
      list.appendChild(a);
    });
    Muse.show(Muse.$('muse-c-subs-empty'), !kids.length);
    Muse.show(Muse.$('muse-c-sub-open'), c.depth < C.LIMITS.depth);
  }

  function drawMembers(c) {
    var all = C.membersOf(state.tree, state.index.entries, c.id);
    var direct = byName(
      all.filter(function (id) {
        return (state.index.entries[id].classes || []).indexOf(c.id) !== -1;
      })
    );
    var below = byName(
      all.filter(function (id) {
        return direct.indexOf(id) === -1;
      })
    );
    var inList = Muse.$('muse-c-in');
    inList.textContent = '';
    direct.forEach(function (id) {
      inList.appendChild(elementRow(id));
    });
    var belowList = Muse.$('muse-c-below');
    belowList.textContent = '';
    below.forEach(function (id) {
      // Each with its own class beneath this one.
      var mine = (state.index.entries[id].classes || []).filter(function (x) {
        return C.beneath(state.tree, c.id).indexOf(x) !== -1;
      });
      belowList.appendChild(
        elementRow(
          id,
          mine
            .map(function (x) {
              return C.pathText(state.tree, x, true);
            })
            .join(' · ')
        )
      );
    });
    Muse.show(Muse.$('muse-c-below-wrap'), below.length > 0);
    Muse.show(Muse.$('muse-c-in-empty'), !all.length);
  }

  function drawMentions(c) {
    var section = Muse.$('muse-c-mentions');
    var list = Muse.$('muse-c-m-list');
    list.textContent = '';
    Muse.show(section, false);
    var id = c.id;
    return Muse.elements
      .mentionedIn(state.project.id, id)
      .then(function (found) {
        if (openId !== id) return;
        found.elements.forEach(function (e) {
          var a = Muse.el('a', 'muse-el-row');
          a.href =
            e.type === 'class' ? classHash(e.id) : projectHash() + '/e/' + encodeURIComponent(e.id);
          a.dataset.id = e.id;
          a.appendChild(Muse.el('span', 'muse-el-row-name', e.name));
          a.appendChild(
            Muse.el(
              'span',
              'muse-el-row-aliases',
              e.type === 'class' ? 'Class' : Muse.TYPE[e.type].one
            )
          );
          list.appendChild(a);
        });
        Muse.show(section, found.elements.length > 0);
      })
      .catch(function () {
        // Nothing to show is no worse than a broken page.
      });
  }

  function draw() {
    var c = current();
    var classification = state.tree.classifications[c.classification];
    var type = classification && Muse.TYPE[classification.type];
    document.title = c.name + ' — ' + state.project.title;
    var back = Muse.$('muse-c-back');
    back.href = projectHash();
    back.textContent = '← ' + state.project.title;
    Muse.$('muse-c-kind').textContent = 'Class' + (type ? ' of ' + type.name.toLowerCase() : '');
    Muse.$('muse-c-name').textContent = c.name;
    drawPath(c);
    var view = Muse.$('muse-c-description');
    Muse.markdown.into(view, c.description, { except: c.id });
    Muse.show(view, !!c.description.trim());
    Muse.show(Muse.$('muse-c-description-empty'), !c.description.trim());
    drawSubclasses(c);
    drawMembers(c);
    gallery.show();
  }

  // ── Editing ─────────────────────────────────────
  function preview(on) {
    var text = Muse.$('muse-c-text');
    var view = Muse.$('muse-c-preview');
    if (on) Muse.markdown.into(view, text.value, { except: openId });
    Muse.show(text, !on);
    Muse.show(view, on);
    Muse.$('muse-c-write').setAttribute('aria-pressed', String(!on));
    Muse.$('muse-c-show').setAttribute('aria-pressed', String(on));
  }

  function edit(on) {
    Muse.show(Muse.$('muse-c-form'), on);
    Muse.show(Muse.$('muse-c-read'), !on);
    Muse.show(Muse.$('muse-c-edit'), !on);
    Muse.say(Muse.$('muse-c-form-error'), '');
    if (on) {
      var c = current();
      Muse.$('muse-c-name-input').value = c.name;
      Muse.$('muse-c-text').value = c.description;
      preview(false);
      Muse.$('muse-c-name-input').focus();
    }
  }

  function save(event) {
    event.preventDefault();
    var button = Muse.$('muse-c-save');
    button.disabled = true;
    Muse.classStore
      .updateClass(openId, {
        name: Muse.$('muse-c-name-input').value,
        description: Muse.$('muse-c-text').value,
      })
      .then(function () {
        edit(false);
        draw();
        drawMentions(current());
      })
      .catch(function (err) {
        Muse.say(Muse.$('muse-c-form-error'), 'It couldn’t be saved: ' + err.message);
      })
      .then(function () {
        button.disabled = false;
      });
  }

  function newSub(on) {
    Muse.show(Muse.$('muse-c-sub-form'), on);
    Muse.show(Muse.$('muse-c-sub-open'), !on && current().depth < C.LIMITS.depth);
    Muse.say(Muse.$('muse-c-sub-error'), '');
    if (on) {
      Muse.$('muse-c-sub-form').reset();
      Muse.$('muse-c-sub-name').focus();
    }
  }

  function confirmDelete(on) {
    Muse.show(Muse.$('muse-c-delete-confirm'), on);
    Muse.show(Muse.$('muse-c-delete'), !on);
    Muse.say(Muse.$('muse-c-delete-error'), '');
    if (on) {
      Muse.$('muse-c-delete-name').textContent = current().name;
      Muse.$('muse-c-delete-no').focus();
    }
  }

  Muse.classPage = {
    init: function () {
      Muse.$('muse-c-edit').addEventListener('click', function () {
        edit(true);
      });
      Muse.$('muse-c-cancel').addEventListener('click', function () {
        edit(false);
      });
      Muse.$('muse-c-form').addEventListener('submit', save);
      Muse.$('muse-c-write').addEventListener('click', function () {
        preview(false);
      });
      Muse.$('muse-c-show').addEventListener('click', function () {
        preview(true);
      });
      Muse.suggest.mention(Muse.$('muse-c-text'));

      Muse.$('muse-c-sub-open').addEventListener('click', function () {
        newSub(true);
      });
      Muse.$('muse-c-sub-cancel').addEventListener('click', function () {
        newSub(false);
      });
      Muse.$('muse-c-sub-form').addEventListener('submit', function (event) {
        event.preventDefault();
        var button = Muse.$('muse-c-sub-btn');
        button.disabled = true;
        Muse.classStore
          .createClass({ parent: openId, name: Muse.$('muse-c-sub-name').value })
          .then(function () {
            newSub(false);
            draw();
          })
          .catch(function (err) {
            Muse.say(Muse.$('muse-c-sub-error'), err.message);
          })
          .then(function () {
            button.disabled = false;
          });
      });

      Muse.$('muse-c-delete').addEventListener('click', function () {
        confirmDelete(true);
      });
      Muse.$('muse-c-delete-no').addEventListener('click', function () {
        confirmDelete(false);
      });
      Muse.$('muse-c-delete-yes').addEventListener('click', function () {
        var button = Muse.$('muse-c-delete-yes');
        button.disabled = true;
        var parent = current().parent;
        Muse.classStore
          .deleteClass(openId)
          .then(function () {
            Muse.go(parent ? classHash(parent) : projectHash());
          })
          .catch(function (err) {
            Muse.say(Muse.$('muse-c-delete-error'), err.message);
          })
          .then(function () {
            button.disabled = false;
          });
      });

      gallery = Muse.gallery.create({
        prefix: 'muse-c',
        thing: current,
        store: function (next) {
          return Muse.classStore.setPhotos(openId, next);
        },
        reread: function () {
          return Muse.classStore.load(state.project.id).then(current);
        },
        describe: function () {
          var c = current();
          var classification = state.tree.classifications[c.classification];
          return {
            name: c.name,
            kind: Muse.photos.kindOf(classification ? classification.type : null),
            labels: [Muse.photos.labelOf(state.project.title)],
          };
        },
      });
      versionBox = Muse.versionForm.mount(Muse.$('muse-c-versions-box'), function () {
        return { projectId: state.project.id, collection: 'classes', id: openId };
      });
    },

    // Opens a class by id; false when it or its project isn't there.
    show: function (projectId, id) {
      Muse.say(Muse.$('muse-c-error'), '');
      return Muse.project.load(projectId).then(function (found) {
        if (!found || !state.tree.classes[id]) return false;
        openId = id;
        edit(false);
        newSub(false);
        confirmDelete(false);
        versionBox.reset();
        draw();
        return drawMentions(current()).then(function () {
          return true;
        });
      });
    },
  };
})();
