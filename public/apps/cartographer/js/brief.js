(function () {
  'use strict';

  // A world's brief (L-711; planning/worlds-without-azgaar.md §4.1) and New
  // world. The brief is what kind of world it is: genre, tone, era and art
  // direction. The GM is told it every turn, and the image studio uses the art
  // direction as the world's style when none is set. It is shown and edited on
  // the world's card (cartographerSetBrief); New world makes a draft from
  // scratch with a name, an optional studio map image and the scale
  // (cartographerCreateWorld), as the connector's create_world does.

  var Cartographer = window.Cartographer;
  var state = Cartographer.state;
  var ref = Cartographer.getRef;
  var show = Cartographer.show;

  // Mirrored from functions/loom-canon/brief.js (the server enforces them).
  var FIELDS = [
    {
      key: 'genre',
      label: 'Genre',
      max: 80,
      placeholder: 'dark fantasy, space opera, steampunk…',
    },
    {
      key: 'tone',
      label: 'Tone',
      max: 160,
      placeholder: 'grim, with dry humour',
    },
    {
      key: 'era',
      label: 'Era',
      max: 120,
      placeholder: 'a late-medieval age of plague',
    },
    {
      key: 'artDirection',
      label: 'Art direction',
      max: 600,
      long: true,
      placeholder: 'How it looks: painted, muted colours, soft light… New pictures use this style.',
    },
  ];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // The four fields as form groups in `form`; returns { read(), inputs }.
  function addFields(form, brief, idPrefix) {
    brief = brief || {};
    var inputs = {};
    FIELDS.forEach(function (field) {
      var group = el('div', 'carto-form-group');
      var label = el('label', 'carto-label', field.label);
      var input = el(field.long ? 'textarea' : 'input', 'carto-input');
      if (field.long) input.rows = 3;
      else input.type = 'text';
      input.id = idPrefix + field.key;
      label.setAttribute('for', input.id);
      input.maxLength = field.max;
      input.placeholder = field.placeholder;
      input.value = brief[field.key] || '';
      group.appendChild(label);
      group.appendChild(input);
      form.appendChild(group);
      inputs[field.key] = input;
    });
    return {
      inputs: inputs,
      // Every field, "" for one left empty (so saving clears it).
      read: function () {
        var out = {};
        FIELDS.forEach(function (field) {
          out[field.key] = inputs[field.key].value.trim();
        });
        return out;
      },
    };
  }

  // ── The brief on a world's card ──────────────────

  function describeBrief(brief) {
    brief = brief || {};
    var parts = FIELDS.filter(function (field) {
      return brief[field.key];
    }).map(function (field) {
      return field.label.toLowerCase() + ': ' + brief[field.key];
    });
    return parts.length ? parts.join(' · ') : null;
  }

  // The card's brief: its text, and Edit brief… (or Add a brief…) to change it.
  function briefRow(world, onSaved) {
    var row = el('div', 'carto-brief');
    row.id = 'carto-brief-' + world.id;
    var text = describeBrief(world.brief);
    row.appendChild(
      el(
        'p',
        'carto-meta carto-brief-text',
        text
          ? 'Brief — ' + text
          : 'No brief yet: say what kind of world it is, so the GM and the studio can use it.'
      )
    );
    var edit = el('button', 'carto-link carto-brief-edit', text ? 'Edit brief…' : 'Add a brief…');
    edit.type = 'button';
    edit.addEventListener('click', function () {
      edit.disabled = true;
      row.appendChild(
        buildForm(world, onSaved, function () {
          edit.disabled = false;
        })
      );
    });
    row.appendChild(edit);
    return row;
  }

  function buildForm(world, onSaved, onClose) {
    var form = el('form', 'carto-form carto-brief-form');
    form.appendChild(el('h4', 'carto-subtitle', 'Brief'));
    form.appendChild(
      el(
        'p',
        'carto-hint',
        'The GM is told this every turn. The studio draws new pictures in the art direction ' +
          'when the world has no style of its own. Leave a field empty to clear it.'
      )
    );
    var fields = addFields(form, world.brief, 'carto-brief-' + world.id + '-');
    var error = el('p', 'carto-error hidden');
    error.setAttribute('role', 'alert');
    var actions = el('div', 'carto-form-actions');
    var submit = el('button', 'app-btn', 'Save brief');
    submit.type = 'submit';
    var cancel = el('button', 'carto-link', 'Cancel');
    cancel.type = 'button';
    actions.appendChild(submit);
    actions.appendChild(cancel);
    form.appendChild(error);
    form.appendChild(actions);

    function close() {
      form.remove();
      if (onClose) onClose();
    }
    cancel.addEventListener('click', close);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      error.classList.add('hidden');
      submit.disabled = true;
      state.functions
        .httpsCallable('cartographerSetBrief')({ worldId: world.id, brief: fields.read() })
        .then(function () {
          if (onSaved) onSaved();
        })
        .catch(function (err) {
          console.error('Saving the brief failed:', err);
          error.textContent = err.message || 'The brief could not be saved.';
          error.classList.remove('hidden');
          submit.disabled = false;
        });
    });
    return form;
  }

  // ── New world ────────────────────────────────────

  var DEFAULT_SCALE = 3;
  var fieldsRead = null;

  function setStatus(text) {
    ref('carto-new-status').textContent = text;
    show('carto-new-status', Boolean(text));
  }

  function setError(text) {
    ref('carto-new-error').textContent = text;
    show('carto-new-error', Boolean(text));
  }

  // The library's world-map images, for the picker (readable by the claim).
  function loadMapImages() {
    var select = ref('carto-new-image');
    return state.db
      .collection('studio_images')
      .where('kind', '==', 'worldMap')
      .get()
      .then(function (snap) {
        snap.docs
          .map(function (doc) {
            return { id: doc.id, title: doc.data().title || doc.id };
          })
          .sort(function (a, b) {
            return a.title.localeCompare(b.title);
          })
          .forEach(function (image) {
            var option = el('option', null, image.title);
            option.value = image.id;
            select.appendChild(option);
          });
      })
      .catch(function (err) {
        // The world can still be made with a plain backdrop.
        console.error('Failed to load map images:', err);
      });
  }

  function onSubmit(e) {
    e.preventDefault();
    setError('');
    setStatus('');
    var name = ref('carto-new-name').value.trim();
    if (!name) return setError('Give the world a name.');
    var scale = Number(ref('carto-new-scale').value || DEFAULT_SCALE);
    if (!(scale > 0 && scale <= 1000)) {
      return setError('The scale is miles per map unit: more than 0 and at most 1000.');
    }
    var brief = fieldsRead();
    var imageId = ref('carto-new-image').value;
    var data = { name: name, milesPerUnit: scale };
    if (imageId) data.imageId = imageId;
    // Only the fields with text; an empty brief is none.
    var given = {};
    Object.keys(brief).forEach(function (key) {
      if (brief[key]) given[key] = brief[key];
    });
    if (Object.keys(given).length) data.brief = given;

    var button = ref('carto-new-btn');
    button.disabled = true;
    setStatus('Making the world…');
    state.functions
      .httpsCallable('cartographerCreateWorld')(data)
      .then(function (res) {
        var made = res.data || {};
        setStatus(
          '"' +
            made.name +
            '" is a draft.' +
            (made.warnings && made.warnings.length ? ' ' + made.warnings.join(' ') : '') +
            ' Add its places with Claude, then publish it.'
        );
        ref('carto-new-form').reset();
        ref('carto-new-scale').value = DEFAULT_SCALE;
        Cartographer.worlds.loadWorlds();
      })
      .catch(function (err) {
        console.error('New world failed:', err);
        setStatus('');
        setError(err.message || 'The world could not be made.');
      })
      .then(function () {
        button.disabled = false;
      });
  }

  Cartographer.brief = {
    FIELDS: FIELDS,
    describeBrief: describeBrief,
    briefRow: briefRow,
    init: function () {
      var form = ref('carto-new-form');
      var holder = ref('carto-new-brief');
      fieldsRead = addFields(holder, null, 'carto-new-brief-').read;
      ref('carto-new-scale').value = DEFAULT_SCALE;
      form.addEventListener('submit', onSubmit);
      loadMapImages();
    },
  };
})();
