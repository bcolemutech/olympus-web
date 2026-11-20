(function () {
  'use strict';

  // The home page (planning/the-muse.md §5, M-100; M-101 / #889): the
  // owner's projects as cards, with cover, title and short description, and
  // New project.

  var Muse = window.Muse;
  var state = Muse.state;

  function card(project) {
    var a = Muse.el('a', 'muse-project-card');
    a.href = '#/p/' + encodeURIComponent(project.id);
    a.dataset.id = project.id;
    var cover = Muse.el('div');
    Muse.projects.drawCover(cover, project);
    a.appendChild(cover);
    var body = Muse.el('div', 'muse-project-card-body');
    body.appendChild(Muse.el('h3', 'muse-project-card-title', project.title));
    if (project.short) body.appendChild(Muse.el('p', 'muse-project-card-short', project.short));
    var when = Muse.formatDate(project.updatedAt);
    if (when) body.appendChild(Muse.el('p', 'muse-project-card-when', 'Changed ' + when));
    a.appendChild(body);
    return a;
  }

  function draw() {
    var grid = Muse.$('muse-projects');
    grid.textContent = '';
    state.projects.forEach(function (project) {
      grid.appendChild(card(project));
    });
    Muse.show(Muse.$('muse-projects-empty'), state.projects.length === 0);
  }

  function openForm(open) {
    Muse.show(Muse.$('muse-new-form'), open);
    Muse.show(Muse.$('muse-new-open'), !open);
    Muse.say(Muse.$('muse-new-error'), '');
    if (open) Muse.$('muse-new-title').focus();
  }

  function submit(event) {
    event.preventDefault();
    var button = Muse.$('muse-new-btn');
    var fields = { title: Muse.$('muse-new-title').value, short: Muse.$('muse-new-short').value };
    var error = Muse.projects.check(fields);
    if (error) {
      Muse.say(Muse.$('muse-new-error'), error);
      return;
    }
    button.disabled = true;
    Muse.projects
      .create(fields)
      .then(function (id) {
        Muse.$('muse-new-form').reset();
        openForm(false);
        Muse.go('#/p/' + encodeURIComponent(id));
      })
      .catch(function (err) {
        Muse.say(Muse.$('muse-new-error'), 'The project couldn’t be made: ' + err.message);
      })
      .then(function () {
        button.disabled = false;
      });
  }

  Muse.home = {
    init: function () {
      Muse.$('muse-new-open').addEventListener('click', function () {
        openForm(true);
      });
      Muse.$('muse-new-cancel').addEventListener('click', function () {
        Muse.$('muse-new-form').reset();
        openForm(false);
      });
      Muse.$('muse-new-form').addEventListener('submit', submit);
    },

    show: function () {
      Muse.say(Muse.$('muse-home-error'), '');
      return Muse.projects
        .list()
        .then(draw)
        .catch(function (err) {
          Muse.say(Muse.$('muse-home-error'), 'Your projects couldn’t be loaded: ' + err.message);
        });
    },
  };
})();
