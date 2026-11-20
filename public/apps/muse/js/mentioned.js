(function () {
  'use strict';

  // "Mentioned in" on an element's page (planning/the-muse.md §3 EL6; M-103
  // / #891): the elements whose bio or appearance links to it with an @-link,
  // from their `mentions` (a query on the element, nothing to keep in step).
  // Hidden when nothing links here.

  var Muse = window.Muse;
  var state = Muse.state;

  Muse.mentioned = {
    show: function () {
      var section = Muse.$('muse-e-mentions');
      var list = Muse.$('muse-m-list');
      list.textContent = '';
      Muse.show(section, false);
      Muse.show(Muse.$('muse-m-more'), false);
      var id = state.element.id;
      return Muse.elements
        .mentionedIn(state.project.id, id)
        .then(function (found) {
          if (state.element.id !== id) return;
          found.elements.forEach(function (e) {
            var a = Muse.el('a', 'muse-el-row');
            a.href =
              '#/p/' + encodeURIComponent(state.project.id) + '/e/' + encodeURIComponent(e.id);
            a.dataset.id = e.id;
            a.appendChild(Muse.el('span', 'muse-el-row-name', e.name));
            a.appendChild(Muse.el('span', 'muse-el-row-aliases', Muse.TYPE[e.type].one));
            list.appendChild(a);
          });
          Muse.show(Muse.$('muse-m-more'), found.more);
          Muse.show(section, found.elements.length > 0);
        })
        .catch(function () {
          // Nothing to show is no worse than a broken page.
        });
    },
  };
})();
