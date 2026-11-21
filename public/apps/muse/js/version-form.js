(function () {
  'use strict';

  // "Save version" (planning/the-muse.md §3 VR1; M-105 / #893): a name,
  // optional, and a button, put into the element's page and the project's
  // settings. `target()` says what to keep, as { projectId, collection, id }
  // (no collection for the project itself).

  var Muse = window.Muse;

  function mount(box, target) {
    var prefix = box.id;
    box.textContent = '';
    box.appendChild(
      Muse.el(
        'p',
        'muse-hint',
        'Keeps a copy as it was last saved, to come back to. The last ' +
          Muse.versions.KEEP +
          ' are kept, and the connector keeps one before it changes anything.'
      )
    );
    var row = Muse.el('div', 'muse-inline');
    var name = Muse.el('input', 'muse-input');
    name.id = prefix + '-name';
    name.maxLength = Muse.versions.LIMITS.name;
    name.autocomplete = 'off';
    name.placeholder = 'Name (optional)';
    name.setAttribute('aria-label', 'Version name (optional)');
    var button = Muse.el('button', 'muse-btn muse-btn-quiet', 'Save version');
    button.type = 'button';
    button.id = prefix + '-save';
    row.appendChild(name);
    row.appendChild(button);
    box.appendChild(row);
    var error = Muse.el('p', 'muse-error hidden');
    error.id = prefix + '-error';
    error.setAttribute('role', 'alert');
    var done = Muse.el('p', 'muse-done hidden');
    done.id = prefix + '-done';
    done.setAttribute('role', 'status');
    box.appendChild(error);
    box.appendChild(done);

    function keep() {
      var at = target();
      Muse.say(error, '');
      Muse.say(done, '');
      var named = Muse.versions.checkName(name.value);
      if (named.error) {
        Muse.say(error, named.error);
        return;
      }
      button.disabled = true;
      Muse.versionStore
        .save(at.projectId, at.collection, at.id, named.value)
        .then(function (kept) {
          name.value = '';
          Muse.say(
            done,
            kept.dropped.length
              ? 'Version saved. The oldest was deleted: the last ' +
                  Muse.versions.KEEP +
                  ' are kept.'
              : 'Version saved.'
          );
        })
        .catch(function (err) {
          Muse.say(error, 'It couldn’t be saved: ' + err.message);
        })
        .then(function () {
          button.disabled = false;
        });
    }

    button.addEventListener('click', keep);
    name.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        keep();
      }
    });
    return {
      // Clears what a last use left, when the page is opened for another thing.
      reset: function () {
        name.value = '';
        Muse.say(error, '');
        Muse.say(done, '');
      },
    };
  }

  Muse.versionForm = { mount: mount };
})();
