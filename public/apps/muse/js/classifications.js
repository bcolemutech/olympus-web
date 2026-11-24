(function () {
  'use strict';

  // The "Classifications" section on a project's home (planning/the-muse.md
  // §3 CL1–CL9; M-201 / #914): each type's classifications, each a tree of
  // classes, made and kept here (CL9). A classification is made for a type,
  // single or multiple, renamed, switched, and deleted when empty; a class is
  // made at the top or beneath another (at most 6 deep, CL4), renamed (never
  // moved, CL8), and deleted when nothing is in it (CL7). Each class links to
  // its page (./class-page.js), with how many live elements are in it or
  // beneath it.

  var Muse = window.Muse;
  var state = Muse.state;
  var C = Muse.classes;
  var open = null; // the inline form or confirmation open now, to close

  function projectHash() {
    return '#/p/' + encodeURIComponent(state.project.id);
  }

  function say(text) {
    Muse.say(Muse.$('muse-cf-error'), text);
  }

  function button(text, label, className, handler) {
    var b = Muse.el('button', 'muse-btn muse-btn-quiet muse-btn-small ' + (className || ''), text);
    b.type = 'button';
    if (label) {
      b.setAttribute('aria-label', label);
      b.title = label;
    }
    b.addEventListener('click', handler);
    return b;
  }

  function close() {
    if (open) open.remove();
    open = null;
  }

  // An inline form under `after`: one box, Save and Cancel. `save(value)`
  // gives a promise; when it fails, the form says why and stays.
  function inline(after, options) {
    close();
    var form = Muse.el('form', 'muse-form muse-cf-inline');
    form.noValidate = true;
    var row = Muse.el('div', 'muse-inline');
    var box = Muse.el('input', 'muse-input');
    box.maxLength = C.LIMITS.name;
    box.autocomplete = 'off';
    box.value = options.value || '';
    box.placeholder = options.placeholder || '';
    box.setAttribute('aria-label', options.label);
    box.className += ' muse-cf-inline-name';
    var save = Muse.el('button', 'muse-btn muse-btn-small', options.submit || 'Save');
    save.type = 'submit';
    var cancel = button('Cancel', null, 'muse-cf-inline-cancel', close);
    row.appendChild(box);
    row.appendChild(save);
    row.appendChild(cancel);
    form.appendChild(row);
    var error = Muse.el('p', 'muse-error hidden');
    error.setAttribute('role', 'alert');
    form.appendChild(error);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      save.disabled = true;
      Muse.say(error, '');
      options
        .save(box.value)
        .then(function () {
          close();
          draw();
        })
        .catch(function (err) {
          Muse.say(error, err.message);
        })
        .then(function () {
          save.disabled = false;
        });
    });
    after.parentNode.insertBefore(form, after.nextSibling);
    open = form;
    box.focus();
  }

  // A confirmation under `after`, for deleting.
  function confirm(after, text, act) {
    close();
    var box = Muse.el('div', 'muse-confirm muse-cf-confirm');
    box.setAttribute('role', 'alertdialog');
    box.appendChild(Muse.el('p', '', text));
    var actions = Muse.el('div', 'muse-actions');
    var yes = Muse.el('button', 'muse-btn muse-btn-danger muse-btn-small', 'Delete');
    yes.type = 'button';
    var no = button('Keep it', null, '', close);
    actions.appendChild(yes);
    actions.appendChild(no);
    box.appendChild(actions);
    var error = Muse.el('p', 'muse-error hidden');
    error.setAttribute('role', 'alert');
    box.appendChild(error);
    yes.addEventListener('click', function () {
      yes.disabled = true;
      act()
        .then(function () {
          close();
          draw();
        })
        .catch(function (err) {
          Muse.say(error, err.message);
          yes.disabled = false;
        });
    });
    after.parentNode.insertBefore(box, after.nextSibling);
    open = box;
    no.focus();
  }

  // ── A class, and its subclasses beneath it ──────
  function classItem(classification, c) {
    var li = Muse.el('li', 'muse-tree-item');
    li.dataset.id = c.id;
    var row = Muse.el('div', 'muse-tree-row');
    var a = Muse.el('a', 'muse-tree-name', c.name);
    a.href = projectHash() + '/c/' + encodeURIComponent(c.id);
    row.appendChild(a);
    var count = C.membersOf(state.tree, state.index ? state.index.entries : {}, c.id).length;
    if (count) row.appendChild(Muse.el('span', 'muse-count', String(count)));
    var actions = Muse.el('span', 'muse-tree-actions');
    if (c.depth < C.LIMITS.depth) {
      actions.appendChild(
        button('+', 'Add a class beneath ' + c.name, 'muse-tree-add', function () {
          inline(row, {
            label: 'New class beneath ' + c.name,
            placeholder: 'New class beneath ' + c.name,
            submit: 'Add',
            save: function (name) {
              return Muse.classStore.createClass({ parent: c.id, name: name });
            },
          });
        })
      );
    }
    actions.appendChild(
      button('Rename', 'Rename ' + c.name, 'muse-tree-rename', function () {
        inline(row, {
          label: 'Rename ' + c.name,
          value: c.name,
          save: function (name) {
            return Muse.classStore.updateClass(c.id, { name: name });
          },
        });
      })
    );
    actions.appendChild(
      button('Delete', 'Delete ' + c.name, 'muse-tree-delete', function () {
        confirm(row, 'Delete ' + c.name + '? Only a class with nothing in it can go.', function () {
          return Muse.classStore.deleteClass(c.id);
        });
      })
    );
    row.appendChild(actions);
    li.appendChild(row);
    var kids = C.children(state.tree, classification.id, c.id);
    if (kids.length) {
      var ul = Muse.el('ul', 'muse-tree');
      kids.forEach(function (k) {
        ul.appendChild(classItem(classification, k));
      });
      li.appendChild(ul);
    }
    return li;
  }

  // ── A classification ────────────────────────────
  function classificationBox(c) {
    var box = Muse.el('div', 'muse-cf');
    box.dataset.id = c.id;
    var head = Muse.el('div', 'muse-cf-head');
    head.appendChild(Muse.el('h4', 'muse-cf-name', c.name));
    head.appendChild(
      Muse.el(
        'span',
        'muse-cf-mode',
        c.multiple ? 'An element may hold several' : 'One class an element'
      )
    );
    var actions = Muse.el('span', 'muse-tree-actions');
    actions.appendChild(
      button('Add class', 'Add a class to ' + c.name, 'muse-cf-add', function () {
        inline(head, {
          label: 'New class in ' + c.name,
          placeholder: 'New class in ' + c.name,
          submit: 'Add',
          save: function (name) {
            return Muse.classStore.createClass({ classification: c.id, name: name });
          },
        });
      })
    );
    actions.appendChild(
      button('Rename', 'Rename ' + c.name, 'muse-cf-rename', function () {
        inline(head, {
          label: 'Rename ' + c.name,
          value: c.name,
          save: function (name) {
            return Muse.classStore.updateClassification(c.id, { name: name });
          },
        });
      })
    );
    actions.appendChild(
      button(
        c.multiple ? 'Make single' : 'Allow several',
        c.multiple
          ? 'Let an element hold only one of ' + c.name + '’s classes'
          : 'Let an element hold several of ' + c.name + '’s classes',
        'muse-cf-mode-btn',
        function (event) {
          var b = event.currentTarget;
          b.disabled = true;
          say('');
          close();
          Muse.classStore
            .updateClassification(c.id, { multiple: !c.multiple })
            .then(draw)
            .catch(function (err) {
              say(err.message);
              b.disabled = false;
            });
        }
      )
    );
    actions.appendChild(
      button('Delete', 'Delete ' + c.name, 'muse-cf-delete', function () {
        confirm(head, 'Delete ' + c.name + '? Only one with no classes can go.', function () {
          return Muse.classStore.deleteClassification(c.id);
        });
      })
    );
    head.appendChild(actions);
    box.appendChild(head);
    var top = C.children(state.tree, c.id);
    if (top.length) {
      var ul = Muse.el('ul', 'muse-tree');
      top.forEach(function (k) {
        ul.appendChild(classItem(c, k));
      });
      box.appendChild(ul);
    } else {
      box.appendChild(Muse.el('p', 'muse-empty', 'No classes yet.'));
    }
    return box;
  }

  function draw() {
    close();
    var list = Muse.$('muse-cf-list');
    list.textContent = '';
    var any = false;
    Muse.TYPES.forEach(function (type) {
      var mine = C.classificationsOf(state.tree, type.id);
      if (!mine.length) return;
      any = true;
      var group = Muse.el('section', 'muse-cf-type');
      group.dataset.type = type.id;
      group.appendChild(Muse.el('h3', 'muse-subheading', type.name));
      mine.forEach(function (c) {
        group.appendChild(classificationBox(c));
      });
      list.appendChild(group);
    });
    Muse.show(Muse.$('muse-cf-empty'), !any);
  }

  function openNew(on) {
    Muse.show(Muse.$('muse-cf-new-form'), on);
    Muse.show(Muse.$('muse-cf-new-open'), !on);
    Muse.say(Muse.$('muse-cf-new-error'), '');
    if (on) {
      Muse.$('muse-cf-new-form').reset();
      Muse.$('muse-cf-new-name').focus();
    }
  }

  Muse.classifications = {
    init: function () {
      var type = Muse.$('muse-cf-new-type');
      Muse.TYPES.forEach(function (t) {
        var option = Muse.el('option', '', t.name);
        option.value = t.id;
        type.appendChild(option);
      });
      Muse.$('muse-cf-new-open').addEventListener('click', function () {
        openNew(true);
      });
      Muse.$('muse-cf-new-cancel').addEventListener('click', function () {
        openNew(false);
      });
      Muse.$('muse-cf-new-form').addEventListener('submit', function (event) {
        event.preventDefault();
        var made = Muse.$('muse-cf-new-btn');
        made.disabled = true;
        Muse.classStore
          .createClassification({
            type: type.value,
            name: Muse.$('muse-cf-new-name').value,
            multiple: Muse.$('muse-cf-new-multiple').checked,
          })
          .then(function () {
            openNew(false);
            draw();
          })
          .catch(function (err) {
            Muse.say(Muse.$('muse-cf-new-error'), err.message);
          })
          .then(function () {
            made.disabled = false;
          });
      });
    },

    // Draws the open project's classifications; called as its home opens.
    show: function () {
      say('');
      openNew(false);
      draw();
    },
  };
})();
