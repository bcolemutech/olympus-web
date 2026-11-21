(function () {
  'use strict';

  // A list of one type's elements (M-102 / #890), from the index, sorted by
  // name, with each one's aliases; and New, which makes one by its name and
  // opens its page.

  var Muse = window.Muse;
  var state = Muse.state;
  var type = null;

  function projectHash() {
    return '#/p/' + encodeURIComponent(state.project.id);
  }

  // The element's primary photo from the index (M-104), or its first letter.
  function thumbOf(entry) {
    var box = Muse.el('span', 'muse-el-thumb');
    box.appendChild(Muse.el('span', 'muse-el-thumb-letter', entry.name.charAt(0)));
    if (entry.primary) {
      Muse.photos.info(entry.primary).then(function (picture) {
        if (!picture) return;
        var img = Muse.el('img', 'muse-el-thumb-img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        Muse.photos.thumb(img, picture);
        box.appendChild(img);
      });
    }
    return box;
  }

  function draw() {
    var t = Muse.TYPE[type];
    var box = Muse.$('muse-t-list');
    box.textContent = '';
    var items = Muse.elements.listOf(type);
    items.forEach(function (entry) {
      var a = Muse.el('a', 'muse-el-row');
      a.href = projectHash() + '/e/' + encodeURIComponent(entry.id);
      a.dataset.id = entry.id;
      a.appendChild(thumbOf(entry));
      a.appendChild(Muse.el('span', 'muse-el-row-name', entry.name));
      if (entry.aliases.length) {
        a.appendChild(Muse.el('span', 'muse-el-row-aliases', entry.aliases.join(' · ')));
      }
      box.appendChild(a);
    });
    Muse.say(Muse.$('muse-t-empty'), items.length ? '' : 'No ' + t.name.toLowerCase() + ' yet.');
  }

  function openForm(open) {
    Muse.show(Muse.$('muse-t-new-form'), open);
    Muse.show(Muse.$('muse-t-new-open'), !open);
    Muse.say(Muse.$('muse-t-new-error'), '');
    if (open) Muse.$('muse-t-new-name').focus();
  }

  function submit(event) {
    event.preventDefault();
    var name = Muse.$('muse-t-new-name').value;
    var checked = Muse.model.checkNames(name, []);
    if (checked.error) {
      Muse.say(Muse.$('muse-t-new-error'), checked.error);
      return;
    }
    var button = Muse.$('muse-t-new-btn');
    button.disabled = true;
    Muse.elements
      .create(state.project.id, type, { name: name })
      .then(function (id) {
        Muse.$('muse-t-new-form').reset();
        openForm(false);
        Muse.go(projectHash() + '/e/' + encodeURIComponent(id));
      })
      .catch(function (err) {
        Muse.say(Muse.$('muse-t-new-error'), 'It couldn’t be made: ' + err.message);
      })
      .then(function () {
        button.disabled = false;
      });
  }

  Muse.typeList = {
    init: function () {
      Muse.$('muse-t-new-open').addEventListener('click', function () {
        openForm(true);
      });
      Muse.$('muse-t-new-cancel').addEventListener('click', function () {
        Muse.$('muse-t-new-form').reset();
        openForm(false);
      });
      Muse.$('muse-t-new-form').addEventListener('submit', submit);
    },

    // Opens a project's list of a type; false when either isn't there.
    show: function (projectId, typeId) {
      if (!Muse.TYPE[typeId]) return Promise.resolve(false);
      type = typeId;
      Muse.say(Muse.$('muse-t-error'), '');
      return Muse.project.load(projectId).then(function (found) {
        if (!found) return false;
        var t = Muse.TYPE[type];
        Muse.$('muse-t-title').textContent = t.name;
        Muse.$('muse-t-new-open').textContent = 'New ' + t.one.toLowerCase();
        var back = Muse.$('muse-t-back');
        back.href = projectHash();
        back.textContent = '← ' + state.project.title;
        document.title = t.name + ' — ' + state.project.title;
        Muse.$('muse-t-new-form').reset();
        openForm(false);
        draw();
        return true;
      });
    },
  };
})();
