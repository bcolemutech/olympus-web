(function () {
  'use strict';

  // The Muse's way into the Image Studio (planning/the-muse.md §3 IM1; M-104 /
  // #892). Photos are studio images: the studio keeps the pictures, and the
  // Muse keeps which ones are an element's (its `images` and `primary`) or a
  // project's cover. This file reads an image's links, adds an image (a file
  // uploaded into the studio, or one picked from its library) and draws the
  // "add a photo" controls the element's photos and the cover share.
  //
  // The page reads studio_images directly (the rules let the `muse` claim
  // read it) and uploads as the studio's own page does: the file goes to the
  // editor's upload folder in Storage, then studioUpload adds it to the
  // library (storage.rules, functions/studio/service.js).

  var Muse = window.Muse;
  var state = Muse.state;

  // The upload's name by type, and its limit (storage.rules).
  var UPLOADS = {
    'image/png': 'studio.png',
    'image/jpeg': 'studio.jpg',
    'image/webp': 'studio.webp',
    'image/svg+xml': 'studio.svg',
  };
  var TYPES_BY_EXTENSION = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };
  var MAX_BYTES = 30 * 1024 * 1024;
  var MAX_SVG_BYTES = 1024 * 1024;
  var MAX_TITLE = 120;
  var MAX_LABEL = 40;
  var LIBRARY_READ = 400; // the newest images the picker reads

  // What an element's photo is called in the studio, by its type.
  var KIND_OF_TYPE = {
    character: 'portrait',
    location: 'scene',
    object: 'item',
    faction: 'other',
    concept: 'other',
  };

  // ── What the studio says about an image ─────────
  // { id, title, kind, link, screenLink }, or null when the image isn't in
  // the studio (taken out of it since). Kept, so a list asks once.
  var cache = {};

  function fromRecord(id, data) {
    var link = typeof data.link === 'string' ? data.link : '';
    return {
      id: id,
      title: data.title || 'Untitled',
      kind: data.kind || 'other',
      labels: Array.isArray(data.labels) ? data.labels : [],
      link: link,
      screenLink: link.replace('%2Fcurrent?', '%2Fscreen?'),
    };
  }

  function remember(id, data) {
    var info = fromRecord(id, data);
    cache[id] = Promise.resolve(info);
    return info;
  }

  function info(id) {
    if (!id) return Promise.resolve(null);
    if (!cache[id]) {
      cache[id] = state.db
        .collection('studio_images')
        .doc(id)
        .get()
        .then(function (doc) {
          return doc.exists && doc.data().link ? fromRecord(id, doc.data()) : null;
        })
        .catch(function () {
          // Not readable now: try again next time.
          delete cache[id];
          return null;
        });
    }
    return cache[id];
  }

  // Shows an image in `img`: its screen-sized copy, or the whole image when
  // the studio kept no such copy (an image from before the copies were made).
  function thumb(img, picture) {
    img.addEventListener(
      'error',
      function () {
        if (picture.link && img.getAttribute('src') !== picture.link) img.src = picture.link;
      },
      { once: true }
    );
    img.src = picture.screenLink || picture.link;
  }

  // The newest images in the library, for the picker: one read.
  function library() {
    return state.db
      .collection('studio_images')
      .orderBy('createdAt', 'desc')
      .limit(LIBRARY_READ)
      .get()
      .then(function (snap) {
        return snap.docs
          .filter(function (doc) {
            return doc.data().link;
          })
          .map(function (doc) {
            return remember(doc.id, doc.data());
          });
      });
  }

  // ── What a photo is called in the studio ────────
  // The project's label: its title as a studio label (letters, digits,
  // spaces, hyphens and apostrophes, lower case, up to 40 characters).
  function labelOf(title) {
    var label = String(title || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N} '-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .slice(0, MAX_LABEL)
      .trim();
    return label || 'muse';
  }

  function titleOf(name, file, count) {
    var title = String(name || '').trim() || 'Untitled';
    if (count > 1)
      title +=
        ': ' +
        file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[_-]+/g, ' ')
          .trim();
    return title.slice(0, MAX_TITLE).trim();
  }

  function typeOf(file) {
    if (UPLOADS[file.type]) return file.type;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    return TYPES_BY_EXTENSION[ext] || null;
  }

  function newUploadId() {
    return window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  // Why a file can't be used, or null.
  function problemWith(file) {
    var type = typeOf(file);
    if (!type) return file.name + ' isn’t a PNG, JPEG, WebP or SVG image.';
    var limit = type === 'image/svg+xml' ? MAX_SVG_BYTES : MAX_BYTES;
    if (file.size > limit) {
      return file.name + ' is larger than ' + (type === 'image/svg+xml' ? '1 MB.' : '30 MB.');
    }
    return null;
  }

  // Puts one file in the studio; gives its image's id. `options`: { title,
  // kind, labels }.
  function upload(file, options) {
    var type = typeOf(file);
    var uploadId = newUploadId();
    var path = 'cartographer/' + state.uid + '/' + uploadId + '/' + UPLOADS[type];
    return firebase
      .storage()
      .ref(path)
      .put(file, { contentType: type })
      .then(function () {
        return firebase.functions().httpsCallable('studioUpload')({
          uploadId: uploadId,
          title: options.title,
          kind: options.kind,
          labels: options.labels || [],
        });
      })
      .then(function (res) {
        var image = res.data.image;
        remember(image.id, image);
        return image.id;
      });
  }

  // ── The "add a photo" controls ──────────────────
  // Upload (a file or several) and Pick from the library, inside `box`.
  // `options`:
  //   id        a prefix for the controls' ids
  //   multiple  whether several images may be added at once
  //   describe  () => { name, kind, labels }: what the studio is told
  //   onAdd     (ids) => Promise: what to do with the images added
  //   chosen    () => ids already in use, marked in the picker
  function adder(box, options) {
    var prefix = options.id;
    var busy = false;
    var picked = null; // the library as read, for the picker's filter

    var row = Muse.el('div', 'muse-photo-add');
    var file = Muse.el('input');
    file.type = 'file';
    file.id = prefix + '-file';
    file.accept = 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg';
    file.multiple = !!options.multiple;
    file.className = 'muse-sr';
    file.setAttribute('aria-label', options.multiple ? 'Photos to upload' : 'A photo to upload');
    var up = Muse.el(
      'button',
      'muse-btn muse-btn-quiet',
      options.multiple ? 'Upload photos' : 'Upload a photo'
    );
    up.type = 'button';
    up.id = prefix + '-upload';
    var pick = Muse.el('button', 'muse-btn muse-btn-quiet', 'Pick from the library');
    pick.type = 'button';
    pick.id = prefix + '-pick';
    pick.setAttribute('aria-expanded', 'false');
    row.appendChild(up);
    row.appendChild(pick);
    row.appendChild(file);
    box.appendChild(row);

    var status = Muse.el('p', 'muse-done hidden');
    status.id = prefix + '-status';
    status.setAttribute('role', 'status');
    var error = Muse.el('p', 'muse-error hidden');
    error.id = prefix + '-error';
    error.setAttribute('role', 'alert');
    box.appendChild(status);
    box.appendChild(error);

    var panel = Muse.el('div', 'muse-picker hidden');
    panel.id = prefix + '-picker';
    var search = Muse.el('input', 'muse-input');
    search.type = 'search';
    search.id = prefix + '-search';
    search.autocomplete = 'off';
    search.placeholder = 'Search the library by title or label';
    search.setAttribute('aria-label', 'Search the studio’s library');
    var grid = Muse.el('div', 'muse-picker-grid');
    grid.id = prefix + '-grid';
    var note = Muse.el('p', 'muse-empty hidden');
    panel.appendChild(search);
    panel.appendChild(note);
    panel.appendChild(grid);
    box.appendChild(panel);

    function setBusy(on) {
      busy = on;
      up.disabled = on;
      pick.disabled = on;
    }

    function add(ids) {
      return Promise.resolve(options.onAdd(ids));
    }

    function drawPicker() {
      var words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
      var used = options.chosen ? options.chosen() : [];
      grid.textContent = '';
      var shown = (picked || []).filter(function (picture) {
        var text = (picture.title + ' ' + picture.labels.join(' ')).toLowerCase();
        return words.every(function (word) {
          return text.indexOf(word) !== -1;
        });
      });
      shown.forEach(function (picture) {
        var tile = Muse.el('button', 'muse-picker-tile');
        tile.type = 'button';
        tile.dataset.id = picture.id;
        var on = used.indexOf(picture.id) !== -1;
        tile.setAttribute('aria-label', picture.title + (on ? ' (already here)' : ''));
        var frame = Muse.el('span', 'muse-picker-frame');
        var img = Muse.el('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        thumb(img, picture);
        frame.appendChild(img);
        tile.appendChild(frame);
        tile.appendChild(Muse.el('span', 'muse-picker-title', picture.title));
        if (on) tile.classList.add('muse-picker-used');
        tile.addEventListener('click', function () {
          if (busy) return;
          Muse.say(error, '');
          setBusy(true);
          add([picture.id])
            .then(function () {
              if (!options.multiple) openPicker(false);
              else drawPicker();
            })
            .catch(function (err) {
              Muse.say(error, 'It couldn’t be added: ' + err.message);
            })
            .then(function () {
              setBusy(false);
            });
        });
        grid.appendChild(tile);
      });
      Muse.say(
        note,
        shown.length
          ? ''
          : picked && picked.length
            ? 'No images match.'
            : 'The studio’s library is empty.'
      );
    }

    function openPicker(open) {
      Muse.show(panel, open);
      pick.setAttribute('aria-expanded', String(open));
      if (!open) return;
      Muse.say(note, 'Loading the library…');
      grid.textContent = '';
      library()
        .then(function (found) {
          picked = found;
          drawPicker();
        })
        .catch(function (err) {
          Muse.say(note, 'The library couldn’t be read: ' + err.message);
        });
    }

    function onFiles() {
      var files = Array.prototype.slice.call(file.files);
      file.value = '';
      if (!files.length || busy) return;
      Muse.say(error, '');
      Muse.say(status, '');
      for (var i = 0; i < files.length; i++) {
        var problem = problemWith(files[i]);
        if (problem) return Muse.say(error, problem);
      }
      var describe = options.describe();
      var ids = [];
      var failed = [];
      setBusy(true);
      var chain = Promise.resolve();
      files.forEach(function (one, index) {
        chain = chain.then(function () {
          Muse.say(
            status,
            (files.length > 1 ? '(' + (index + 1) + ' of ' + files.length + ') ' : '') +
              'Uploading ' +
              one.name +
              '…'
          );
          return upload(one, {
            title: titleOf(describe.name, one, files.length),
            kind: describe.kind,
            labels: describe.labels,
          })
            .then(function (id) {
              ids.push(id);
            })
            .catch(function (err) {
              failed.push(one.name + ': ' + (err.message || 'it could not be uploaded'));
            });
        });
      });
      chain
        .then(function () {
          return ids.length ? add(ids) : null;
        })
        .then(function () {
          Muse.say(
            status,
            ids.length
              ? ids.length === 1
                ? 'Added to the studio.'
                : ids.length + ' added to the studio.'
              : ''
          );
        })
        .catch(function (err) {
          failed.push('It couldn’t be added: ' + err.message);
        })
        .then(function () {
          Muse.say(error, failed.join(' '));
          setBusy(false);
        });
    }

    up.addEventListener('click', function () {
      file.click();
    });
    file.addEventListener('change', onFiles);
    pick.addEventListener('click', function () {
      openPicker(panel.classList.contains('hidden'));
    });
    search.addEventListener('input', drawPicker);

    return {
      // Closes the picker and clears its messages (a new page, a new edit).
      reset: function () {
        openPicker(false);
        Muse.say(status, '');
        Muse.say(error, '');
        search.value = '';
        picked = null;
      },
    };
  }

  Muse.photos = {
    KIND_OF_TYPE: KIND_OF_TYPE,
    info: info,
    thumb: thumb,
    library: library,
    labelOf: labelOf,
    titleOf: titleOf,
    typeOf: typeOf,
    problemWith: problemWith,
    upload: upload,
    adder: adder,
    kindOf: function (type) {
      return KIND_OF_TYPE[type] || 'other';
    },
  };
})();
