(function () {
  'use strict';

  // A town's art (planning/the-loom-layered-worlds.md §8; L-347 / #416): a
  // PNG drawn behind the town's places in the Loom's town view. The page
  // uploads it to the builder's upload folder; cartographerTownImage checks
  // it, copies it beside the world's map image and records it on the
  // settlement (games see it on their next turn). Art can be replaced or
  // removed.

  var Cartographer = window.Cartographer;
  var state = Cartographer.state;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** The "Town art" form for a world's card; `onClose` runs when it closes. */
  function buildForm(world, onClose) {
    var form = el('form', 'carto-form carto-town-art-form');
    var listId = 'carto-town-' + world.id;

    form.appendChild(el('h4', 'carto-subtitle', 'Town art'));
    form.appendChild(
      el(
        'p',
        'carto-hint',
        "A town's art is drawn behind its places in the Loom's town view, fitted to a square. " +
          'Set place positions with Claude (0–1000 each way) to line them up with it. Azgaar ' +
          "can open a settlement in Watabou's Medieval Fantasy City Generator, which exports a " +
          'PNG that works well.'
      )
    );

    var townGroup = el('div', 'carto-form-group');
    townGroup.appendChild(el('label', 'carto-label', 'Settlement'));
    var townInput = el('input', 'carto-input');
    townInput.type = 'text';
    townInput.required = true;
    townInput.placeholder = 'Loading settlements…';
    townInput.setAttribute('list', listId);
    var datalist = el('datalist');
    datalist.id = listId;
    townGroup.appendChild(townInput);
    townGroup.appendChild(datalist);

    var fileGroup = el('div', 'carto-form-group');
    fileGroup.appendChild(el('label', 'carto-label', 'Image (PNG, up to 30 MB)'));
    var file = el('input', 'carto-input');
    file.type = 'file';
    file.accept = '.png,image/png';
    file.required = true;
    fileGroup.appendChild(file);

    var status = el('p', 'carto-status hidden');
    status.setAttribute('role', 'status');
    var error = el('p', 'carto-error hidden');
    error.setAttribute('role', 'alert');
    var actions = el('div', 'carto-form-actions');
    var submit = el('button', 'app-btn', 'Upload town art');
    submit.type = 'submit';
    var close = el('button', 'carto-link', 'Close');
    close.type = 'button';
    actions.appendChild(submit);
    actions.appendChild(close);

    var withArt = el('div', 'carto-town-art-list');

    form.appendChild(townGroup);
    form.appendChild(fileGroup);
    form.appendChild(status);
    form.appendChild(error);
    form.appendChild(actions);
    form.appendChild(withArt);

    function say(node, text) {
      node.textContent = text || '';
      node.classList.toggle('hidden', !text);
    }

    // Settlement names → ids, and the towns that already have art.
    var byName = {};
    function load() {
      return Cartographer.loadSettlements(world.id)
        .then(function (settlements) {
          byName = {};
          datalist.innerHTML = '';
          settlements.forEach(function (s) {
            byName[s.name.toLowerCase()] = s;
            var option = el('option');
            option.value = s.name;
            datalist.appendChild(option);
          });
          townInput.placeholder =
            'Type to search ' + Cartographer.formatNumber(settlements.length) + ' settlements';
          renderWithArt(
            settlements.filter(function (s) {
              return s.town && s.town.image;
            })
          );
        })
        .catch(function (err) {
          console.error('Failed to load settlements:', err);
          townInput.placeholder = 'Could not load settlements';
        });
    }

    function renderWithArt(towns) {
      withArt.innerHTML = '';
      if (!towns.length) {
        withArt.appendChild(el('p', 'carto-meta', 'No town has art yet.'));
        return;
      }
      withArt.appendChild(el('p', 'carto-label', 'Towns with art'));
      var list = el('ul', 'carto-town-art-rows');
      towns.forEach(function (s) {
        var row = el('li');
        row.appendChild(
          el('span', null, s.name + ' · ' + s.town.image.width + '×' + s.town.image.height + ' ')
        );
        var remove = el('button', 'carto-link', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', function () {
          remove.disabled = true;
          say(error, '');
          state.functions
            .httpsCallable('cartographerTownImage')({
              worldId: world.id,
              locationId: s.id,
              remove: true,
            })
            .then(function () {
              say(status, s.name + "'s art is removed.");
              return load();
            })
            .catch(function (err) {
              console.error('Removing town art failed:', err);
              say(error, err.message || 'The art could not be removed.');
              remove.disabled = false;
            });
        });
        row.appendChild(remove);
        list.appendChild(row);
      });
      withArt.appendChild(list);
    }

    close.addEventListener('click', function () {
      form.remove();
      onClose();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      say(error, '');
      var settlement = byName[townInput.value.trim().toLowerCase()];
      var image = file.files[0];
      if (!settlement) return say(error, 'Pick a settlement from the list.');
      if (!image) return say(error, 'Choose a PNG image.');
      if (image.size > Cartographer.MAX_PNG_BYTES) {
        return say(error, 'The image is larger than 30 MB.');
      }
      submit.disabled = true;
      var uploadId = Cartographer.upload.newUploadId();
      say(status, 'Uploading…');
      Cartographer.upload
        .uploadFile(uploadId, 'town.png', image, 'image/png', function (f) {
          say(status, 'Uploading… ' + Math.round(f * 100) + '%');
        })
        .then(function () {
          say(status, 'Checking the image…');
          return state.functions.httpsCallable('cartographerTownImage')({
            worldId: world.id,
            locationId: settlement.id,
            uploadId: uploadId,
          });
        })
        .then(function (res) {
          var size = res.data.image;
          say(
            status,
            res.data.name +
              ' has town art (' +
              size.width +
              '×' +
              size.height +
              '). Games see it on their next turn.'
          );
          file.value = '';
          return load();
        })
        .catch(function (err) {
          console.error('Town art upload failed:', err);
          say(status, '');
          say(error, err.message || 'The town art could not be uploaded.');
        })
        .then(function () {
          submit.disabled = false;
        });
    });

    load();
    return form;
  }

  Cartographer.townArt = { buildForm: buildForm };
})();
