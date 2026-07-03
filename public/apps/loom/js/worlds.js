(function () {
  'use strict';

  var Loom = window.Loom;

  function renderWorldList() {
    var container = Loom.getRef('loom-world-list');
    container.innerHTML = '';

    Loom.WORLDS.forEach(function (world) {
      var card = document.createElement('div');
      card.className = 'app-card loom-world-card';

      var title = document.createElement('h3');
      title.className = 'loom-card-title';
      title.textContent = world.name;

      var tagline = document.createElement('p');
      tagline.className = 'loom-card-tagline';
      tagline.textContent = world.tagline;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-btn';
      btn.textContent = 'Enter';
      btn.addEventListener('click', function () {
        Loom.app.showSaves(world.id, world.name);
      });

      card.appendChild(title);
      card.appendChild(tagline);
      card.appendChild(btn);
      container.appendChild(card);
    });
  }

  Loom.worlds = { renderWorldList: renderWorldList };
})();
