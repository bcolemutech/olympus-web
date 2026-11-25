(function () {
  'use strict';

  // An element's photos (planning/the-muse.md §3 IM1; M-104 / #892): the
  // primary image large at the top, the rest in a strip below it, in the
  // element's order. A photo is added by uploading it (into the studio) or by
  // picking one from the studio's library, moved earlier or later, made the
  // primary, or taken off, which leaves it in the studio. Every change saves
  // at once, with the index line when the primary moves (./model.js).
  //
  // Seen from M-203's testing (2026-11-25), as schematics are: the photos open
  // for looking at, the strip a row of small pictures that show one large when
  // tapped (the primary stays as it is). "Edit photos" shows adding, ordering,
  // making the primary and taking off; with none yet, adding shows unasked.
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
    var editing = false; // "Edit photos" is on
    var viewing = null; // the photo shown large while reading, if not the primary
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

    // The one shown large: the primary, or the one tapped while reading.
    function large() {
      var e = element();
      return !editing && viewing && e.images.indexOf(viewing) !== -1 ? viewing : e.primary;
    }

    function tile(id, index, total) {
      var e = element();
      var isPrimary = e.primary === id;
      var li = Muse.el('li', 'muse-photo' + (isPrimary ? ' muse-photo-primary' : ''));
      li.dataset.id = id;
      var frame = Muse.el(editing ? 'div' : 'button', 'muse-photo-frame');
      picture(frame, id, 'muse-photo-img');
      li.appendChild(frame);
      if (isPrimary) li.appendChild(Muse.el('span', 'muse-photo-badge', 'Primary'));
      if (!editing) {
        // Reading: a tap shows it large.
        frame.type = 'button';
        frame.classList.add('muse-photo-view');
        var on = large() === id;
        li.classList.toggle('muse-photo-viewing', on);
        frame.setAttribute('aria-pressed', String(on));
        frame.setAttribute('aria-label', 'Show photo ' + (index + 1) + ' of ' + total + ' large');
        frame.addEventListener('click', function () {
          viewing = id;
          draw();
        });
        return li;
      }
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
      var count = e.images.length;
      strip.textContent = '';
      main.textContent = '';
      var shown = large();
      Muse.show(main, !!shown);
      if (shown) picture(main, shown, 'muse-photo-main-img');
      e.images.forEach(function (id, index) {
        strip.appendChild(tile(id, index, count));
      });
      strip.classList.toggle('muse-photo-strip-read', !editing);
      // Reading one photo, the strip would only show it again.
      Muse.show(strip, count > (editing ? 0 : 1));
      Muse.show(node('-photos-empty'), count === 0);
      node('-photos-count').textContent = count ? String(count) : '';
      var toggle = node('-photos-edit');
      Muse.show(toggle, count > 0);
      toggle.textContent = editing ? 'Done' : 'Edit photos';
      toggle.setAttribute('aria-pressed', String(editing));
      Muse.show(node('-photos-add'), editing || count === 0);
    }

    node('-photos-edit').addEventListener('click', function () {
      editing = !editing;
      viewing = null;
      draw();
    });

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
          // Photos just added are for ordering and choosing the primary.
          editing = true;
          return save(model.addPhotos(photos(), ids));
        });
      },
    });

    return {
      // Draws its photos; called as its page opens.
      show: function () {
        busy = false;
        editing = false;
        viewing = null;
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
