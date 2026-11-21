(function () {
  'use strict';

  // Searching all of a project's text (planning/the-muse.md §3 EL5; M-106 /
  // #894): names, aliases, bios, appearances and text fields, on the server
  // by the museSearch callable, which runs the Muse connector's own search
  // (functions/muse/search.js). Reached from the header box's last row,
  // "Search all text", at #/p/<id>/s/<words>; each result shows where the
  // words were found, with a snippet and the matches marked.

  var Muse = window.Muse;
  var state = Muse.state;
  var asked = 0; // the latest search, so an older answer never draws over it

  function projectHash() {
    return '#/p/' + encodeURIComponent(state.project.id);
  }

  // A snippet's text with its marks ([[start, end], …]) as <mark>s.
  function snippetNode(snippet) {
    var p = Muse.el('span', 'muse-s-snippet');
    var at = 0;
    (snippet.marks || []).forEach(function (mark) {
      if (mark[0] < at) return;
      p.appendChild(document.createTextNode(snippet.text.slice(at, mark[0])));
      p.appendChild(Muse.el('mark', '', snippet.text.slice(mark[0], mark[1])));
      at = mark[1];
    });
    p.appendChild(document.createTextNode(snippet.text.slice(at)));
    return p;
  }

  var WHERE = { name: 'name', aliases: 'aliases', bio: 'bio', appearance: 'appearance' };

  function draw(found) {
    var list = Muse.$('muse-s-list');
    list.textContent = '';
    found.results.forEach(function (result) {
      var a = Muse.el('a', 'muse-el-row muse-s-row');
      a.href = projectHash() + '/e/' + encodeURIComponent(result.id);
      a.dataset.id = result.id;
      a.appendChild(Muse.el('span', 'muse-el-row-name', result.name));
      var type = Muse.TYPE[result.type] ? Muse.TYPE[result.type].one : result.type;
      var where = (result.where || [])
        .map(function (w) {
          return WHERE[w] || w;
        })
        .join(', ');
      a.appendChild(Muse.el('span', 'muse-el-row-aliases', type + ' · in ' + where));
      if (result.snippet) a.appendChild(snippetNode(result.snippet));
      list.appendChild(a);
    });
    var shown = found.results.length;
    Muse.$('muse-s-status').textContent = !shown
      ? 'Nothing holds those words.'
      : found.total > shown
        ? 'The first ' + shown + ' of ' + found.total + '.'
        : shown === 1
          ? 'One element.'
          : shown + ' elements.';
  }

  function run(query) {
    var mine = ++asked;
    Muse.$('muse-s-list').textContent = '';
    Muse.say(Muse.$('muse-s-error'), '');
    Muse.$('muse-s-status').textContent = 'Searching…';
    return firebase
      .functions()
      .httpsCallable('museSearch')({ projectId: state.project.id, query: query, limit: 30 })
      .then(function (answer) {
        if (mine === asked) draw(answer.data);
      })
      .catch(function (err) {
        if (mine !== asked) return;
        Muse.$('muse-s-status').textContent = '';
        Muse.say(Muse.$('muse-s-error'), 'The search didn’t work: ' + err.message);
      });
  }

  Muse.textSearch = {
    init: function () {
      Muse.$('muse-s-form').addEventListener('submit', function (event) {
        event.preventDefault();
        var text = Muse.$('muse-s-box').value.trim();
        if (!text) return;
        Muse.go(projectHash() + '/s/' + encodeURIComponent(text));
      });
    },

    // Opens a project's search for `query`; false when the project isn't there.
    show: function (projectId, query) {
      return Muse.project.load(projectId).then(function (found) {
        if (!found) return false;
        var back = Muse.$('muse-s-back');
        back.href = projectHash();
        back.textContent = '← ' + state.project.title;
        Muse.$('muse-s-title').textContent = '“' + query + '”';
        Muse.$('muse-s-box').value = query;
        document.title = 'Search — ' + state.project.title;
        run(query);
        return true;
      });
    },
  };
})();
