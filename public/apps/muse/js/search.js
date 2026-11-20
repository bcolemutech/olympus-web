(function () {
  'use strict';

  // The search box in the app's header (planning/the-muse.md §3 EL5; M-103 /
  // #891): every name and alias of the open project, from its index in
  // memory, so it answers as you type; a pick opens that element's page.
  // Full text (bios, chapters) is searched through the connector (M-106).
  //
  // The page's own markup holds the box; it is moved into the shared header
  // when the app starts, and shown only inside a project.

  var Muse = window.Muse;
  var state = Muse.state;

  Muse.search = {
    init: function () {
      var wrap = Muse.$('muse-search');
      var box = Muse.$('muse-search-box');
      var header = document.querySelector('.app-header');
      if (header) {
        header.insertBefore(wrap, header.querySelector('.app-header-right'));
        header.classList.add('muse-with-search');
      }
      Muse.suggest.input(box, {
        limit: 8,
        choose: function (result) {
          box.value = '';
          box.blur();
          Muse.go(
            '#/p/' + encodeURIComponent(state.project.id) + '/e/' + encodeURIComponent(result.id)
          );
        },
      });
      box.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') box.value = '';
      });
    },

    // Shown inside a project, cleared when you move.
    sync: function (inProject) {
      var wrap = Muse.$('muse-search');
      if (!wrap) return;
      Muse.show(wrap, inProject);
      Muse.$('muse-search-box').value = '';
    },
  };
})();
