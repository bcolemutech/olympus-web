(function () {
  'use strict';

  // Art (planning/the-loom-layered-worlds.md §8, §9): a town's, drawn behind
  // its places in the Loom's town view (L-347 / #416), and a battle map's,
  // drawn under its grid (L-355 / #417). The page uploads a PNG to the
  // builder's upload folder; the callable checks it, copies it beside the
  // world's map image and records it (games see it on their next turn). Art
  // can be replaced or removed. Claude sees it, with what's placed on it,
  // through the connector's view_image.

  var Cartographer = window.Cartographer;
  var state = Cartographer.state;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // What each kind of art is attached to, and how.
  var KINDS = {
    town: {
      title: 'Town art',
      hint:
        "A town's art is drawn behind its places in the Loom's town view, fitted to a square. " +
        'Set place positions with Claude (0–1000 each way) to line them up with it; Claude can ' +
        'check them with view_image. Upload a PNG or an SVG, or ask Claude to draw one ' +
        '(set_art). Azgaar can open a settlement in Watabou’s Medieval Fantasy City ' +
        'Generator, which exports images that work well.',
      pick: 'Settlement',
      of: 'settlements',
      file: 'town.png',
      callable: 'cartographerTownImage',
      idField: 'locationId',
      load: function (worldId) {
        return Cartographer.loadSettlements(worldId).then(function (settlements) {
          return settlements.map(function (s) {
            return { id: s.id, name: s.name, image: s.town && s.town.image };
          });
        });
      },
    },
    battleMap: {
      title: 'Battle-map art',
      hint:
        "A battle map's art is drawn under its grid in the Loom, stretched to fit it. Draw the " +
        'map with Claude first (set_battle_map). Upload a PNG or an SVG, or ask Claude to draw ' +
        'one (set_art); Claude can check that its entries, exits and features line up with ' +
        'the art, with view_image.',
      pick: 'Battle map',
      of: 'battle maps',
      file: 'battlemap.png',
      callable: 'cartographerMapImage',
      idField: 'mapId',
      load: Cartographer.loadBattleMaps,
    },
  };

  /** The art form of a kind ('town', 'battleMap') for a world's card. */
  function buildForm(world, kindName, onClose) {
    var kind = KINDS[kindName];
    var form = el('form', 'carto-form carto-art-form');
    var listId = 'carto-art-' + kindName + '-' + world.id;

    form.appendChild(el('h4', 'carto-subtitle', kind.title));
    form.appendChild(el('p', 'carto-hint', kind.hint));

    var townGroup = el('div', 'carto-form-group');
    townGroup.appendChild(el('label', 'carto-label', kind.pick));
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
    fileGroup.appendChild(el('label', 'carto-label', 'Image (PNG up to 30 MB, or SVG up to 1 MB)'));
    var file = el('input', 'carto-input');
    file.type = 'file';
    file.accept = '.png,.svg,image/png,image/svg+xml';
    file.required = true;
    fileGroup.appendChild(file);

    var status = el('p', 'carto-status hidden');
    status.setAttribute('role', 'status');
    var error = el('p', 'carto-error hidden');
    error.setAttribute('role', 'alert');
    var actions = el('div', 'carto-form-actions');
    var submit = el('button', 'app-btn', 'Upload ' + kind.title.toLowerCase());
    submit.type = 'submit';
    var close = el('button', 'carto-link', 'Close');
    close.type = 'button';
    actions.appendChild(submit);
    actions.appendChild(close);

    var withArt = el('div', 'carto-art-list');

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

    // Names → items, and the ones that already have art.
    var byName = {};
    function load() {
      return kind
        .load(world.id)
        .then(function (items) {
          byName = {};
          datalist.innerHTML = '';
          items.forEach(function (item) {
            byName[item.name.toLowerCase()] = item;
            var option = el('option');
            option.value = item.name;
            datalist.appendChild(option);
          });
          townInput.placeholder = items.length
            ? 'Type to search ' + Cartographer.formatNumber(items.length) + ' ' + kind.of
            : 'No ' + kind.of + ' yet';
          renderWithArt(
            items.filter(function (item) {
              return item.image;
            })
          );
        })
        .catch(function (err) {
          console.error('Failed to load ' + kind.of + ':', err);
          townInput.placeholder = 'Could not load ' + kind.of;
        });
    }

    function renderWithArt(items) {
      withArt.innerHTML = '';
      if (!items.length) {
        withArt.appendChild(el('p', 'carto-meta', 'None of its ' + kind.of + ' has art yet.'));
        return;
      }
      withArt.appendChild(el('p', 'carto-label', 'With art'));
      var list = el('ul', 'carto-art-rows');
      items.forEach(function (s) {
        var row = el('li');
        row.appendChild(
          el('span', null, s.name + ' · ' + s.image.width + '×' + s.image.height + ' ')
        );
        var remove = el('button', 'carto-link', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', function () {
          remove.disabled = true;
          say(error, '');
          var data = { worldId: world.id, remove: true };
          data[kind.idField] = s.id;
          state.functions
            .httpsCallable(kind.callable)(data)
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
      if (!settlement) return say(error, 'Pick one from the list.');
      if (!image) return say(error, 'Choose a PNG or SVG image.');
      // SVG art (L-356) is checked on the server before it is used.
      var svg = image.type === 'image/svg+xml' || /\.svg$/i.test(image.name);
      if (svg && image.size > Cartographer.MAX_SVG_BYTES) {
        return say(error, 'The SVG is larger than 1 MB.');
      }
      if (!svg && image.size > Cartographer.MAX_PNG_BYTES) {
        return say(error, 'The image is larger than 30 MB.');
      }
      submit.disabled = true;
      var uploadId = Cartographer.upload.newUploadId();
      say(status, 'Uploading…');
      Cartographer.upload
        .uploadFile(
          uploadId,
          svg ? kind.file.replace(/\.png$/, '.svg') : kind.file,
          image,
          svg ? 'image/svg+xml' : 'image/png',
          function (f) {
            say(status, 'Uploading… ' + Math.round(f * 100) + '%');
          }
        )
        .then(function () {
          say(status, 'Checking the image…');
          var data = { worldId: world.id, uploadId: uploadId };
          data[kind.idField] = settlement.id;
          return state.functions.httpsCallable(kind.callable)(data);
        })
        .then(function (res) {
          var size = res.data.image;
          say(
            status,
            res.data.name +
              ' has art (' +
              size.width +
              '×' +
              size.height +
              '). Games see it on their next turn.'
          );
          file.value = '';
          return load();
        })
        .catch(function (err) {
          console.error('Art upload failed:', err);
          say(status, '');
          say(error, err.message || 'The art could not be uploaded.');
        })
        .then(function () {
          submit.disabled = false;
        });
    });

    load();
    return form;
  }

  Cartographer.art = { buildForm: buildForm };
})();
