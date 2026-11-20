(function () {
  'use strict';

  // The project's own fields per element type, in its settings (EL2; M-102 /
  // #890): add, relabel, order and remove them, and for a choice its list,
  // for a link the types it may point to. Changes are a draft until saved.
  // A field's kind is fixed once made; to change it, remove it and add one.
  // A field removed keeps its values on each element until that element is
  // next saved (./fields.js).

  var Muse = window.Muse;
  var state = Muse.state;
  var F = Muse.fields;

  var draft = {}; // by type, a copy of the project's fields
  var type = 'character';
  var dirty = false;

  function copy(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function list() {
    if (!draft[type]) draft[type] = [];
    return draft[type];
  }

  function changed() {
    dirty = true;
    Muse.$('muse-f-save').disabled = false;
    Muse.$('muse-f-reset').disabled = false;
    Muse.say(Muse.$('muse-f-done'), '');
  }

  function kindName(kind) {
    var found = F.KINDS.filter(function (k) {
      return k.id === kind;
    })[0];
    return found ? found.name : kind;
  }

  function button(text, label, onClick) {
    var b = Muse.el('button', 'muse-btn muse-btn-quiet muse-btn-small', text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  function row(def, i, all) {
    var r = Muse.el('div', 'muse-f-row');
    r.dataset.key = def.key;

    var head = Muse.el('div', 'muse-inline');
    var label = Muse.el('input', 'muse-input muse-f-label');
    label.value = def.label;
    label.maxLength = F.LIMITS.label;
    label.setAttribute('aria-label', 'Label');
    label.addEventListener('input', function () {
      def.label = label.value;
      changed();
    });
    head.appendChild(label);
    head.appendChild(Muse.el('span', 'muse-f-kind', kindName(def.kind)));
    var up = button('↑', 'Move ' + def.label + ' up', function () {
      all.splice(i - 1, 0, all.splice(i, 1)[0]);
      changed();
      draw();
    });
    up.disabled = i === 0;
    var down = button('↓', 'Move ' + def.label + ' down', function () {
      all.splice(i + 1, 0, all.splice(i, 1)[0]);
      changed();
      draw();
    });
    down.disabled = i === all.length - 1;
    head.appendChild(up);
    head.appendChild(down);
    var remove = button('Remove', 'Remove ' + def.label, function () {
      all.splice(i, 1);
      changed();
      draw();
    });
    remove.classList.add('muse-f-remove');
    head.appendChild(remove);
    r.appendChild(head);

    if (def.kind === 'choice') {
      var options = Muse.el('textarea', 'muse-input muse-f-options');
      options.rows = 3;
      options.value = (def.options || []).join('\n');
      options.placeholder = 'One choice per line';
      options.setAttribute('aria-label', def.label + ': its choices, one per line');
      options.addEventListener('input', function () {
        def.options = options.value.split('\n');
        changed();
      });
      r.appendChild(options);
    } else if (def.kind === 'element') {
      var types = Muse.el('div', 'muse-f-types');
      types.appendChild(Muse.el('span', 'muse-hint', 'Links to (none ticked: any type):'));
      Muse.TYPES.forEach(function (t) {
        var box = Muse.el('label', 'muse-check');
        var input = Muse.el('input');
        input.type = 'checkbox';
        input.value = t.id;
        input.checked = (def.options || []).indexOf(t.id) !== -1;
        input.addEventListener('change', function () {
          var chosen = (def.options || []).filter(function (x) {
            return x !== t.id;
          });
          if (input.checked) chosen.push(t.id);
          def.options = chosen;
          changed();
        });
        box.appendChild(input);
        box.appendChild(document.createTextNode(' ' + t.name));
        types.appendChild(box);
      });
      r.appendChild(types);
    }
    return r;
  }

  function drawTabs() {
    var tabs = Muse.$('muse-f-types');
    tabs.textContent = '';
    Muse.TYPES.forEach(function (t) {
      var tab = Muse.el('button', 'muse-tab', t.name);
      tab.type = 'button';
      tab.dataset.type = t.id;
      tab.setAttribute('aria-pressed', String(t.id === type));
      tab.addEventListener('click', function () {
        type = t.id;
        Muse.say(Muse.$('muse-f-error'), '');
        draw();
      });
      tabs.appendChild(tab);
    });
  }

  function draw() {
    drawTabs();
    var box = Muse.$('muse-f-list');
    box.textContent = '';
    var all = list();
    all.forEach(function (def, i) {
      box.appendChild(row(def, i, all));
    });
    Muse.show(Muse.$('muse-f-empty'), all.length === 0);
  }

  function add() {
    var label = Muse.$('muse-f-new-label').value.trim();
    var kind = Muse.$('muse-f-new-kind').value;
    if (!label) {
      Muse.say(Muse.$('muse-f-error'), 'A new field needs a label.');
      return;
    }
    var all = list();
    if (all.length >= F.LIMITS.perType) {
      Muse.say(Muse.$('muse-f-error'), 'A type has at most ' + F.LIMITS.perType + ' fields.');
      return;
    }
    // Keys stay unique against what elements may still hold, so a removed
    // field's values are never read as a new one's.
    var taken = all
      .map(function (d) {
        return d.key;
      })
      .concat(
        ((state.project && state.project.fields && state.project.fields[type]) || []).map(
          function (d) {
            return d.key;
          }
        )
      );
    var def = { key: F.makeKey(label, taken), label: label, kind: kind };
    if (kind === 'choice' || kind === 'element') def.options = [];
    all.push(def);
    Muse.$('muse-f-new-label').value = '';
    Muse.say(Muse.$('muse-f-error'), '');
    changed();
    draw();
    var labels = Muse.$('muse-f-list').querySelectorAll('.muse-f-row');
    var last = labels[labels.length - 1];
    var focus = last && (last.querySelector('.muse-f-options') || last.querySelector('input'));
    if (focus) focus.focus();
  }

  function save() {
    var p = state.project;
    var checked = F.checkAll(draft);
    if (checked.error) {
      Muse.say(Muse.$('muse-f-error'), checked.error);
      return;
    }
    var buttonNode = Muse.$('muse-f-save');
    buttonNode.disabled = true;
    Muse.say(Muse.$('muse-f-error'), '');
    Muse.projects
      .update(p.id, { fields: checked.value })
      .then(function () {
        p.fields = checked.value;
        draft = copy(checked.value);
        dirty = false;
        Muse.$('muse-f-reset').disabled = true;
        draw();
        Muse.say(Muse.$('muse-f-done'), 'Fields saved.');
      })
      .catch(function (err) {
        buttonNode.disabled = false;
        Muse.say(Muse.$('muse-f-error'), 'The fields couldn’t be saved: ' + err.message);
      });
  }

  Muse.fieldEditor = {
    init: function () {
      var kinds = Muse.$('muse-f-new-kind');
      F.KINDS.forEach(function (k) {
        var option = Muse.el('option', '', k.name);
        option.value = k.id;
        kinds.appendChild(option);
      });
      Muse.$('muse-f-add').addEventListener('click', add);
      Muse.$('muse-f-new-label').addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          add();
        }
      });
      Muse.$('muse-f-save').addEventListener('click', save);
      Muse.$('muse-f-reset').addEventListener('click', Muse.fieldEditor.reset);
    },

    // Starts again from the project's saved fields.
    reset: function () {
      draft = copy(state.project && state.project.fields);
      dirty = false;
      Muse.$('muse-f-save').disabled = true;
      Muse.$('muse-f-reset').disabled = true;
      Muse.say(Muse.$('muse-f-error'), '');
      Muse.say(Muse.$('muse-f-done'), '');
      draw();
    },

    dirty: function () {
      return dirty;
    },
  };
})();
