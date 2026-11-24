(function () {
  'use strict';

  // An element's page (planning/the-muse.md §3 EL1, EL2; M-102 / #890): its
  // name, aliases, details (a character's residence, then the project's own
  // fields for its type), a character's appearance and the bio, read as
  // Markdown; one form edits them all (a change of name is a rename); and
  // retiring, with confirmation, which a retired element's page undoes.
  // Relationships and "mentioned in" (M-103) are drawn by their own files;
  // typing @ in a text offers elements to link, and an element's name or
  // alias found in a text is shown as a link to it (EL6). Its photos are
  // drawn by ./gallery.js (M-104). "Save version" (./version-form.js, M-105)
  // keeps a copy of it as stored. Its classes (M-201, CL9) show as a row of
  // paths, each step a link, and its form picks them by classification, at
  // any level (CL2). A location's or object's schematics, and where an element
  // is marked on one, are drawn by ./schematic-page.js (M-202).

  var Muse = window.Muse;
  var state = Muse.state;
  var F = Muse.fields;
  var C = Muse.classes;
  var versionBox = null;
  var picked = null; // the classes the open form would save

  function element() {
    return state.element;
  }

  function projectHash() {
    return '#/p/' + encodeURIComponent(state.project.id);
  }

  // A link to an element, by id: its page when it's live, else words.
  function elementLink(id) {
    var name = Muse.elements.nameOf(id);
    if (!name) return Muse.el('span', 'muse-gone', 'A retired element');
    var a = Muse.el('a', 'muse-el-link', name);
    a.href = projectHash() + '/e/' + encodeURIComponent(id);
    a.dataset.el = id;
    return a;
  }

  // ── Reading ─────────────────────────────────────
  function fact(list, label, value, key) {
    var row = Muse.el('div', 'muse-fact');
    if (key) row.dataset.key = key;
    row.appendChild(Muse.el('dt', '', label));
    var dd = Muse.el('dd');
    if (typeof value === 'string') dd.textContent = value;
    else dd.appendChild(value);
    row.appendChild(dd);
    list.appendChild(row);
  }

  function drawFacts() {
    var e = element();
    var list = Muse.$('muse-e-facts');
    list.textContent = '';
    if (e.type === 'character' && e.residence) {
      fact(list, 'Residence', elementLink(e.residence), 'residence');
    }
    Muse.elements.defsFor(e.type).forEach(function (def) {
      var value = e.fields[def.key];
      if (value === undefined || value === null || value === '') return;
      if (def.kind === 'element') fact(list, def.label, elementLink(value), def.key);
      else fact(list, def.label, F.format(def, value), def.key);
    });
    Muse.show(Muse.$('muse-e-facts-empty'), list.children.length === 0);
  }

  // A class's path, each class a link to its page.
  function classPath(id) {
    var wrap = Muse.el('span', 'muse-class-path');
    wrap.dataset.id = id;
    var steps = C.chain(state.tree, id);
    if (!steps.length) {
      wrap.appendChild(Muse.el('span', 'muse-gone', 'A deleted class'));
      return wrap;
    }
    var classification = state.tree.classifications[steps[0].classification];
    if (classification) wrap.appendChild(Muse.el('span', 'muse-c-root', classification.name));
    steps.forEach(function (step) {
      if (wrap.children.length) wrap.appendChild(Muse.el('span', 'muse-c-sep', ' › '));
      var a = Muse.el('a', 'muse-c-step', step.name);
      a.href = projectHash() + '/c/' + encodeURIComponent(step.id);
      wrap.appendChild(a);
    });
    return wrap;
  }

  function drawClasses() {
    var e = element();
    var row = Muse.$('muse-e-classes');
    row.textContent = '';
    (e.classes || []).forEach(function (id) {
      row.appendChild(classPath(id));
    });
    Muse.show(row, (e.classes || []).length > 0);
  }

  function draw() {
    var e = element();
    var t = Muse.TYPE[e.type];
    document.title = e.name + ' — ' + state.project.title;
    var back = Muse.$('muse-e-back');
    back.href = projectHash() + '/t/' + e.type;
    back.textContent = '← ' + t.name;
    Muse.$('muse-e-type').textContent = t.one;
    Muse.$('muse-e-name').textContent = e.name;
    Muse.say(
      Muse.$('muse-e-aliases'),
      e.aliases.length ? 'Also known as ' + e.aliases.join(' · ') : ''
    );
    Muse.show(Muse.$('muse-e-retired'), e.retired);
    Muse.show(Muse.$('muse-e-danger'), !e.retired);
    drawClasses();
    drawFacts();
    var hasLooks = e.type === 'character' && !!e.appearance.trim();
    Muse.show(Muse.$('muse-e-appearance-card'), hasLooks);
    // Its own name isn't linked in its own text.
    var own = { except: e.id };
    if (hasLooks) Muse.markdown.into(Muse.$('muse-e-appearance'), e.appearance, own);
    var bio = Muse.$('muse-e-bio');
    Muse.markdown.into(bio, e.bio, own);
    Muse.show(bio, !!e.bio.trim());
    Muse.show(Muse.$('muse-e-bio-empty'), !e.bio.trim());
  }

  // ── Editing ─────────────────────────────────────
  function labelled(body, text, control, id) {
    var label = Muse.el('label', 'muse-label', text);
    label.htmlFor = id;
    control.id = id;
    body.appendChild(label);
    body.appendChild(control);
    return control;
  }

  function input(className) {
    var node = Muse.el('input', 'muse-input' + (className ? ' ' + className : ''));
    node.autocomplete = 'off';
    return node;
  }

  // A select of live elements (of `types`, or any), with the stored value
  // kept as an option even when it is no longer live.
  function elementSelect(types, value) {
    var select = Muse.el('select', 'muse-input muse-select');
    var none = Muse.el('option', '', '— None —');
    none.value = '';
    select.appendChild(none);
    Muse.elements
      .listOf()
      .filter(function (entry) {
        return !types || !types.length || types.indexOf(entry.type) !== -1;
      })
      .forEach(function (entry) {
        var option = Muse.el(
          'option',
          '',
          types && types.length === 1
            ? entry.name
            : entry.name + ' (' + Muse.TYPE[entry.type].one + ')'
        );
        option.value = entry.id;
        select.appendChild(option);
      });
    if (value && !Muse.elements.nameOf(value)) {
      var gone = Muse.el('option', '', 'A retired element');
      gone.value = value;
      select.appendChild(gone);
    }
    select.value = value || '';
    return select;
  }

  // A Markdown text with Write and Preview.
  function markdownField(body, text, value, id, rows) {
    var label = Muse.el('label', 'muse-label', text);
    label.htmlFor = id;
    body.appendChild(label);
    var tabs = Muse.el('div', 'muse-tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', text + ': write or preview');
    var write = Muse.el('button', 'muse-tab', 'Write');
    var show = Muse.el('button', 'muse-tab', 'Preview');
    write.type = show.type = 'button';
    write.id = id + '-write';
    show.id = id + '-show';
    tabs.appendChild(write);
    tabs.appendChild(show);
    body.appendChild(tabs);
    var area = Muse.el('textarea', 'muse-input muse-textarea');
    area.id = id;
    area.rows = rows;
    area.value = value || '';
    area.placeholder = 'Markdown: # headings, **bold**, *italic*, - lists; @ links an element';
    body.appendChild(area);
    Muse.suggest.mention(area);
    var preview = Muse.el('div', 'muse-reading muse-preview hidden');
    preview.id = id + '-preview';
    body.appendChild(preview);
    function mode(on) {
      if (on) Muse.markdown.into(preview, area.value, { except: element().id });
      Muse.show(area, !on);
      Muse.show(preview, on);
      write.setAttribute('aria-pressed', String(!on));
      show.setAttribute('aria-pressed', String(on));
    }
    write.addEventListener('click', function () {
      mode(false);
    });
    show.addEventListener('click', function () {
      mode(true);
    });
    mode(false);
    return area;
  }

  // One custom field's control; its value is read back by readField.
  function fieldControl(body, def, value) {
    var id = 'muse-e-f-' + def.key;
    var wrap;
    switch (def.kind) {
      case 'number': {
        var number = input();
        number.inputMode = 'decimal';
        number.value = value === undefined || value === null ? '' : String(value);
        wrap = labelled(body, def.label, number, id);
        break;
      }
      case 'date': {
        var label = Muse.el('span', 'muse-label', def.label);
        body.appendChild(label);
        wrap = Muse.el('div', 'muse-inline muse-date');
        wrap.id = id;
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', def.label);
        ['year', 'month', 'day'].forEach(function (part) {
          var box = input('muse-date-' + part);
          box.inputMode = 'numeric';
          box.placeholder = part.charAt(0).toUpperCase() + part.slice(1);
          box.setAttribute('aria-label', def.label + ': ' + part);
          box.dataset.part = part;
          box.value = value && value[part] !== undefined ? String(value[part]) : '';
          wrap.appendChild(box);
        });
        body.appendChild(wrap);
        break;
      }
      case 'element':
        wrap = labelled(body, def.label, elementSelect(def.options, value), id);
        break;
      case 'choice': {
        var select = Muse.el('select', 'muse-input muse-select');
        var none = Muse.el('option', '', '— None —');
        none.value = '';
        select.appendChild(none);
        var options = (def.options || []).slice();
        if (value && options.indexOf(value) === -1) options.push(value);
        options.forEach(function (o) {
          var option = Muse.el(
            'option',
            '',
            (def.options || []).indexOf(o) === -1 ? o + ' (no longer a choice)' : o
          );
          option.value = o;
          select.appendChild(option);
        });
        select.value = value || '';
        wrap = labelled(body, def.label, select, id);
        break;
      }
      default: {
        var text = Muse.el('textarea', 'muse-input muse-textarea muse-textarea-short');
        text.rows = 2;
        text.value = value || '';
        wrap = labelled(body, def.label, text, id);
      }
    }
    wrap.dataset.field = def.key;
    wrap.classList.add('muse-e-field');
    return wrap;
  }

  function readField(node, def) {
    if (def.kind === 'date') {
      var out = {};
      node.querySelectorAll('input').forEach(function (box) {
        if (box.value.trim()) out[box.dataset.part] = box.value.trim();
      });
      return Object.keys(out).length ? out : null;
    }
    return node.value;
  }

  // The classes the form holds, per classification of the element's type:
  // each picked one with a button to take it off, and a list to add one at
  // any level. Adding follows the classification's rule (./classes.js
  // classify): a single one keeps one class, and a class replaces one above
  // or below it in its line.
  function drawPicker() {
    var e = element();
    var box = Muse.$('muse-e-classes-input');
    if (!box) return;
    box.textContent = '';
    C.classificationsOf(state.tree, e.type).forEach(function (cf) {
      var group = Muse.el('div', 'muse-pick');
      group.dataset.classification = cf.id;
      var id = 'muse-e-pick-' + cf.id;
      var label = Muse.el('label', 'muse-label', cf.name);
      label.htmlFor = id;
      group.appendChild(label);
      var chips = Muse.el('div', 'muse-chips');
      picked
        .filter(function (c) {
          return state.tree.classes[c] && state.tree.classes[c].classification === cf.id;
        })
        .forEach(function (c) {
          var chip = Muse.el('span', 'muse-chip');
          chip.dataset.id = c;
          chip.appendChild(Muse.el('span', '', C.pathText(state.tree, c, true)));
          var off = Muse.el('button', 'muse-chip-off', '×');
          off.type = 'button';
          off.setAttribute('aria-label', 'Take off ' + C.pathText(state.tree, c, true));
          off.addEventListener('click', function () {
            picked = C.classify(state.tree, picked, [], [c]);
            drawPicker();
          });
          chip.appendChild(off);
          chips.appendChild(chip);
        });
      group.appendChild(chips);
      var select = Muse.el('select', 'muse-input muse-select');
      select.id = id;
      var none = Muse.el(
        'option',
        '',
        cf.multiple || !chips.children.length ? '— Add a class —' : '— Change its class —'
      );
      none.value = '';
      select.appendChild(none);
      C.flatten(state.tree, cf.id).forEach(function (c) {
        var option = Muse.el('option', '', new Array(c.depth).join('— ') + c.name);
        option.value = c.id;
        option.disabled = picked.indexOf(c.id) !== -1;
        select.appendChild(option);
      });
      select.addEventListener('change', function () {
        if (!select.value) return;
        picked = C.classify(state.tree, picked, [select.value], []);
        drawPicker();
        var again = Muse.$(id);
        if (again) again.focus();
      });
      group.appendChild(select);
      box.appendChild(group);
    });
    // A class no longer in the tree stays until it is taken off.
    picked
      .filter(function (c) {
        return !state.tree.classes[c];
      })
      .forEach(function (c) {
        var chip = Muse.el('span', 'muse-chip muse-gone', 'A deleted class');
        var off = Muse.el('button', 'muse-chip-off', '×');
        off.type = 'button';
        off.setAttribute('aria-label', 'Take off the deleted class');
        off.addEventListener('click', function () {
          picked = picked.filter(function (x) {
            return x !== c;
          });
          drawPicker();
        });
        chip.appendChild(off);
        box.appendChild(chip);
      });
  }

  function buildForm() {
    var e = element();
    var body = Muse.$('muse-e-form-body');
    body.textContent = '';
    var name = input();
    name.maxLength = Muse.model.LIMITS.name;
    name.value = e.name;
    labelled(body, 'Name', name, 'muse-e-name-input');
    var aliases = Muse.el('textarea', 'muse-input muse-textarea muse-textarea-short');
    aliases.rows = 2;
    aliases.placeholder = 'One per line';
    aliases.value = e.aliases.join('\n');
    labelled(body, 'Aliases (one per line)', aliases, 'muse-e-aliases-input');

    if (e.type === 'character') {
      labelled(body, 'Residence', elementSelect(['location'], e.residence), 'muse-e-residence');
    }

    var defs = Muse.elements.defsFor(e.type);
    if (defs.length) {
      var group = Muse.el('fieldset', 'muse-e-fields');
      group.appendChild(Muse.el('legend', 'muse-subheading', 'Fields'));
      defs.forEach(function (def) {
        fieldControl(group, def, e.fields[def.key]);
      });
      body.appendChild(group);
    }

    picked = (e.classes || []).slice();
    if (C.classificationsOf(state.tree, e.type).length || picked.length) {
      var classGroup = Muse.el('fieldset', 'muse-e-fields muse-e-classes-field');
      classGroup.appendChild(Muse.el('legend', 'muse-subheading', 'Classes'));
      var pickers = Muse.el('div', 'muse-picks');
      pickers.id = 'muse-e-classes-input';
      classGroup.appendChild(pickers);
      body.appendChild(classGroup);
      drawPicker();
    }

    if (e.type === 'character') {
      markdownField(body, 'Appearance', e.appearance, 'muse-e-appearance-input', 5);
    }
    markdownField(body, 'Bio', e.bio, 'muse-e-bio-input', 12);
  }

  function readForm() {
    var e = element();
    var input = {
      name: Muse.$('muse-e-name-input').value,
      aliases: Muse.$('muse-e-aliases-input').value.split('\n'),
      bio: Muse.$('muse-e-bio-input').value,
      fields: {},
    };
    Muse.elements.defsFor(e.type).forEach(function (def) {
      var node = Muse.$('muse-e-form-body').querySelector('[data-field="' + def.key + '"]');
      if (node) input.fields[def.key] = readField(node, def);
    });
    if (e.type === 'character') {
      input.appearance = Muse.$('muse-e-appearance-input').value;
      input.residence = Muse.$('muse-e-residence').value || null;
    }
    if (Muse.$('muse-e-classes-input')) input.classes = picked.slice();
    return input;
  }

  function edit(open) {
    Muse.show(Muse.$('muse-e-form'), open);
    Muse.show(Muse.$('muse-e-read'), !open);
    Muse.show(Muse.$('muse-e-edit'), !open);
    Muse.say(Muse.$('muse-e-form-error'), '');
    if (open) {
      buildForm();
      Muse.$('muse-e-name-input').focus();
    } else {
      Muse.$('muse-e-form-body').textContent = '';
    }
  }

  function reload() {
    var e = element();
    return Muse.elements.get(state.project.id, e.id).then(function (fresh) {
      if (fresh) state.element = fresh;
      draw();
    });
  }

  function save(event) {
    event.preventDefault();
    var button = Muse.$('muse-e-save');
    button.disabled = true;
    Muse.say(Muse.$('muse-e-form-error'), '');
    Muse.elements
      .update(state.project.id, element(), readForm())
      .then(reload)
      .then(function () {
        edit(false);
      })
      .catch(function (err) {
        Muse.say(Muse.$('muse-e-form-error'), 'It couldn’t be saved: ' + err.message);
      })
      .then(function () {
        button.disabled = false;
      });
  }

  // ── Retiring ────────────────────────────────────
  function confirmRetire(open) {
    Muse.show(Muse.$('muse-e-retire-confirm'), open);
    Muse.show(Muse.$('muse-e-retire'), !open);
    if (open) {
      Muse.$('muse-e-retire-name').textContent = element().name;
      Muse.$('muse-e-retire-no').focus();
    }
  }

  function act(promise) {
    Muse.say(Muse.$('muse-e-error'), '');
    return promise.then(reload).catch(function (err) {
      Muse.say(Muse.$('muse-e-error'), 'That didn’t work: ' + err.message);
    });
  }

  Muse.element = {
    init: function () {
      Muse.$('muse-e-edit').addEventListener('click', function () {
        edit(true);
      });
      Muse.$('muse-e-cancel').addEventListener('click', function () {
        edit(false);
      });
      Muse.$('muse-e-form').addEventListener('submit', save);
      Muse.$('muse-e-retire').addEventListener('click', function () {
        confirmRetire(true);
      });
      Muse.$('muse-e-retire-no').addEventListener('click', function () {
        confirmRetire(false);
      });
      Muse.$('muse-e-retire-yes').addEventListener('click', function () {
        confirmRetire(false);
        act(Muse.elements.retire(state.project.id, element()));
      });
      Muse.$('muse-e-restore').addEventListener('click', function () {
        act(Muse.elements.restore(state.project.id, element()));
      });
      versionBox = Muse.versionForm.mount(Muse.$('muse-e-versions-box'), function () {
        return { projectId: state.project.id, collection: 'elements', id: element().id };
      });
    },

    // Opens an element by id; false when it or its project isn't there.
    show: function (projectId, id, opts) {
      Muse.say(Muse.$('muse-e-error'), '');
      return Muse.project
        .load(projectId)
        .then(function (found) {
          return found ? Muse.elements.get(projectId, id) : null;
        })
        .catch(function () {
          return null;
        })
        .then(function (e) {
          state.element = e;
          if (!e || !Muse.TYPE[e.type]) return false;
          edit(false);
          confirmRetire(false);
          versionBox.reset();
          draw();
          Muse.gallery.show();
          // Its relationships, and the elements that link to it.
          // Its schematics and where it is marked (M-202).
          return Promise.all([
            Muse.relationships.show(),
            Muse.mentioned.show(),
            Muse.schematicPage.show(opts),
          ]).then(function () {
            return true;
          });
        });
    },
  };
})();
