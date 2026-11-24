(function () {
  'use strict';

  // An element's photos (planning/the-muse.md §3 IM1; M-104 / #892): the
  // primary image large at the top, the rest in a strip below it, in the
  // element's order. A photo is added by uploading it (into the studio) or by
  // picking one from the studio's library, moved earlier or later, made the
  // primary, or taken off, which leaves it in the studio. Every change saves
  // at once, with the index line when the primary moves (./model.js).
  //
  // A class's page has photos too (M-201, CL6): `create(options)` makes a
  // gallery for anything with { images, primary }, in the page's markup with
  // ids starting `options.prefix` (muse-e for an element, muse-c for a class):
  //   thing()          what it is now ({ id, images, primary })
  //   store(next)      saves its photos ({ images, primary }, checked)
  //   reread()         reads it again into the state; gives it, or null
  //   describe()       what an uploaded photo is called in the studio

  var Muse = window.Muse;
  var state = Muse.state;
  var model = Muse.model;

  function create(options) {
    var prefix = options.prefix;
    var busy = false;
    var adding = null; // the add controls, made once
    var element = options.thing;
    var node = function (suffix) {
      return Muse.$(prefix + suffix);
    };

    // Its photos as the model's operations take them.
    function photos() {
      var e = element();
      return { images: e.images.slice(), primary: e.primary };
    }

    function say(text) {
      Muse.say(node('-photos-error'), text);
    }

    // Saves a new set of photos, then draws them from what is stored. A
    // failure is passed on: the controls that asked say it.
    function save(next) {
      var e = element();
      busy = true;
      say('');
      draw();
      return options
        .store(next)
        .then(function () {
          return options.reread(e.id);
        })
        .then(function () {
          busy = false;
          draw();
        })
        .catch(function (err) {
          busy = false;
          draw();
          throw err;
        });
    }

    function act(next) {
      return save(next).catch(function (err) {
        say('It couldn’t be saved: ' + err.message);
      });
    }

    function missing(label) {
      var box = Muse.el('span', 'muse-photo-missing', 'Not in the studio');
      box.title = label || '';
      return box;
    }

    // An image's picture in a frame, or a note that the studio no longer has it.
    function picture(frame, id, className) {
      frame.textContent = '';
      Muse.photos.info(id).then(function (found) {
        if (!found) {
          frame.appendChild(missing(id));
          return;
        }
        var img = Muse.el('img', className);
        img.alt = found.title;
        img.decoding = 'async';
        Muse.photos.thumb(img, found);
        frame.appendChild(img);
      });
    }

    function button(text, label, handler, disabled) {
      var b = Muse.el('button', 'muse-btn muse-btn-quiet muse-photo-btn', text);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.disabled = !!disabled || busy;
      b.addEventListener('click', handler);
      return b;
    }

    function tile(id, index, total) {
      var e = element();
      var isPrimary = e.primary === id;
      var li = Muse.el('li', 'muse-photo' + (isPrimary ? ' muse-photo-primary' : ''));
      li.dataset.id = id;
      var frame = Muse.el('div', 'muse-photo-frame');
      picture(frame, id, 'muse-photo-img');
      li.appendChild(frame);
      if (isPrimary) li.appendChild(Muse.el('span', 'muse-photo-badge', 'Primary'));
      var actions = Muse.el('div', 'muse-photo-actions');
      if (!isPrimary) {
        var primary = button('Make primary', 'Make this photo the primary one', function () {
          act(model.primaryPhoto(photos(), id));
        });
        primary.classList.add('muse-photo-make-primary');
        actions.appendChild(primary);
      }
      var earlier = button(
        '←',
        'Move this photo earlier',
        function () {
          act(model.movePhoto(photos(), id, -1));
        },
        index === 0
      );
      earlier.classList.add('muse-photo-earlier');
      var later = button(
        '→',
        'Move this photo later',
        function () {
          act(model.movePhoto(photos(), id, 1));
        },
        index === total - 1
      );
      later.classList.add('muse-photo-later');
      var remove = button(
        'Remove',
        'Take this photo off this page (it stays in the studio)',
        function () {
          act(model.removePhoto(photos(), id));
        }
      );
      remove.classList.add('muse-photo-remove');
      actions.appendChild(earlier);
      actions.appendChild(later);
      actions.appendChild(remove);
      li.appendChild(actions);
      return li;
    }

    function draw() {
      var e = element();
      if (!e) return;
      var main = node('-photo-main');
      var strip = node('-photo-strip');
      strip.textContent = '';
      main.textContent = '';
      Muse.show(main, !!e.primary);
      if (e.primary) picture(main, e.primary, 'muse-photo-main-img');
      e.images.forEach(function (id, index) {
        strip.appendChild(tile(id, index, e.images.length));
      });
      Muse.show(strip, e.images.length > 0);
      Muse.show(node('-photos-empty'), e.images.length === 0);
      node('-photos-count').textContent = e.images.length ? String(e.images.length) : '';
    }

    adding = Muse.photos.adder(node('-photos-add'), {
      id: prefix + '-photo',
      multiple: true,
      describe: options.describe,
      chosen: function () {
        return element().images;
      },
      onAdd: function (ids) {
        // Read it again first, so an add after a slow upload doesn't
        // overwrite what changed meanwhile.
        return options.reread(element().id).then(function () {
          return save(model.addPhotos(photos(), ids));
        });
      },
    });

    return {
      // Draws its photos; called as its page opens.
      show: function () {
        busy = false;
        say('');
        adding.reset();
        draw();
      },
    };
  }

  var elementGallery = null;

  Muse.gallery = {
    create: create,

    init: function () {
      elementGallery = create({
        prefix: 'muse-e',
        thing: function () {
          return state.element;
        },
        store: function (next) {
          return Muse.elements.setPhotos(state.project.id, state.element, next);
        },
        reread: function (id) {
          return Muse.elements.get(state.project.id, id).then(function (fresh) {
            if (fresh && state.element && state.element.id === id) state.element = fresh;
            return fresh;
          });
        },
        describe: function () {
          var e = state.element;
          return {
            name: e.name,
            kind: Muse.photos.kindOf(e.type),
            labels: [Muse.photos.labelOf(state.project.title)],
          };
        },
      });
    },

    // Draws the open element's photos; called as its page opens.
    show: function () {
      elementGallery.show();
    },
  };
})();
