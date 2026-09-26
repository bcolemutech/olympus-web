(function () {
  'use strict';

  var Cartographer = window.Cartographer;
  var state = Cartographer.state;
  var ref = Cartographer.getRef;
  var show = Cartographer.show;

  var STATUS_LABELS = {
    importing: 'Importing',
    draft: 'Draft',
    published: 'Published',
    failed: 'Failed',
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function describeCounts(counts) {
    counts = counts || {};
    var n = Cartographer.formatNumber;
    return [
      n(counts.settlements) + ' settlements',
      n(counts.pointsOfInterest) + ' points of interest',
      n(counts.factions) + ' realms',
      n(counts.regions) + ' regions',
    ].join(' · ');
  }

  function warningsList(warnings) {
    var details = el('details', 'carto-warnings');
    var total = warnings.length;
    details.appendChild(
      el('summary', null, total + (total === 1 ? ' note' : ' notes') + ' from the import')
    );
    var list = el('ul');
    warnings.forEach(function (w) {
      list.appendChild(el('li', null, w.message + (w.count > 1 ? ' (' + w.count + ')' : '')));
    });
    details.appendChild(list);
    return details;
  }

  // ── Publish form ─────────────────────────────────

  function buildPublishForm(world, card) {
    var form = el('form', 'carto-form carto-publish-form');
    var listId = 'carto-start-' + world.id;

    var hookGroup = el('div', 'carto-form-group');
    hookGroup.appendChild(el('label', 'carto-label', 'Opening hook'));
    var hook = el('textarea', 'carto-input');
    hook.rows = 3;
    hook.maxLength = 2000;
    hook.required = true;
    hook.placeholder =
      'How does a new adventure begin? e.g. "A storm drives your ship ashore at Burdendal…"';
    hook.value = world.openingHook || '';
    hookGroup.appendChild(hook);

    var taglineGroup = el('div', 'carto-form-group');
    taglineGroup.appendChild(el('label', 'carto-label', 'Tagline (optional)'));
    var tagline = el('input', 'carto-input');
    tagline.type = 'text';
    tagline.maxLength = 200;
    tagline.value = world.tagline || '';
    taglineGroup.appendChild(tagline);

    var startGroup = el('div', 'carto-form-group');
    startGroup.appendChild(el('label', 'carto-label', 'Starting settlement'));
    var start = el('input', 'carto-input');
    start.type = 'text';
    start.required = true;
    start.placeholder = 'Loading settlements…';
    start.setAttribute('list', listId);
    var datalist = el('datalist');
    datalist.id = listId;
    startGroup.appendChild(start);
    startGroup.appendChild(datalist);

    var error = el('p', 'carto-error hidden');
    error.setAttribute('role', 'alert');
    var actions = el('div', 'carto-form-actions');
    var submit = el('button', 'app-btn', 'Publish to the Loom');
    submit.type = 'submit';
    var cancel = el('button', 'carto-link', 'Cancel');
    cancel.type = 'button';
    actions.appendChild(submit);
    actions.appendChild(cancel);

    form.appendChild(hookGroup);
    form.appendChild(taglineGroup);
    form.appendChild(startGroup);
    form.appendChild(error);
    form.appendChild(actions);

    // Settlement names → ids, loaded when the form opens. The largest capital
    // is suggested as the starting place.
    var idsByName = {};
    state.db
      .collection('loom_worlds')
      .doc(world.id)
      .collection('locations')
      .where('geo.kind', '==', 'settlement')
      .get()
      .then(function (snap) {
        var settlements = snap.docs.map(function (d) {
          return d.data();
        });
        settlements.sort(function (a, b) {
          return a.name.localeCompare(b.name);
        });
        settlements.forEach(function (s) {
          idsByName[s.name.toLowerCase()] = s.id;
          var option = el('option');
          option.value = s.name;
          datalist.appendChild(option);
        });
        var capitals = settlements.filter(function (s) {
          return s.geo && s.geo.capital;
        });
        capitals.sort(function (a, b) {
          return (b.geo.population || 0) - (a.geo.population || 0);
        });
        start.placeholder =
          'Type to search ' + Cartographer.formatNumber(settlements.length) + ' settlements';
        if (capitals[0] && !start.value) start.value = capitals[0].name;
      })
      .catch(function (err) {
        console.error('Failed to load settlements:', err);
        start.placeholder = 'Could not load settlements';
      });

    cancel.addEventListener('click', function () {
      form.remove();
      card.querySelector('.carto-publish-btn').disabled = false;
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      error.classList.add('hidden');
      var startId = idsByName[start.value.trim().toLowerCase()];
      if (!startId) {
        error.textContent = 'Pick a starting settlement from the list.';
        error.classList.remove('hidden');
        return;
      }
      submit.disabled = true;
      state.functions
        .httpsCallable('cartographerPublish')({
          worldId: world.id,
          openingHook: hook.value.trim(),
          tagline: tagline.value.trim(),
          startingLocationId: startId,
        })
        .then(function () {
          loadWorlds();
        })
        .catch(function (err) {
          console.error('Publish failed:', err);
          error.textContent = err.message || 'The world could not be published.';
          error.classList.remove('hidden');
          submit.disabled = false;
        });
    });

    return form;
  }

  // ── World list ───────────────────────────────────

  function renderWorld(world) {
    var card = el('div', 'app-card carto-world-card');
    var header = el('div', 'carto-world-header');
    header.appendChild(el('h3', 'carto-world-name', world.name));
    var status = world.status || 'importing';
    header.appendChild(
      el('span', 'carto-badge carto-badge--' + status, STATUS_LABELS[status] || status)
    );
    card.appendChild(header);

    if (world.tagline) card.appendChild(el('p', 'carto-tagline', world.tagline));
    card.appendChild(el('p', 'carto-meta', describeCounts(world.counts)));
    card.appendChild(
      el(
        'p',
        'carto-meta',
        'From "' +
          ((world.source && world.source.mapName) || 'a map') +
          '" · created ' +
          Cartographer.formatDate(world.createdAtMs) +
          (world.publishedAtMs
            ? ' · published ' + Cartographer.formatDate(world.publishedAtMs)
            : '')
      )
    );
    if (status === 'failed' && world.error) card.appendChild(el('p', 'carto-error', world.error));
    if (world.warnings && world.warnings.length) card.appendChild(warningsList(world.warnings));

    var actions = el('div', 'carto-form-actions');
    if (status === 'draft') {
      var publish = el('button', 'app-btn carto-publish-btn', 'Publish…');
      publish.type = 'button';
      publish.addEventListener('click', function () {
        publish.disabled = true;
        card.appendChild(buildPublishForm(world, card));
      });
      actions.appendChild(publish);
    }
    if (status === 'published') {
      var play = el('a', 'app-btn', 'Play in the Loom');
      play.href = '/apps/loom/';
      actions.appendChild(play);
    }
    if (actions.children.length) card.appendChild(actions);
    return card;
  }

  function loadWorlds() {
    show('carto-worlds-loading', true);
    show('carto-worlds-error', false);
    return state.db
      .collection('loom_worlds')
      .orderBy('createdAtMs', 'desc')
      .get()
      .then(function (snap) {
        var list = ref('carto-world-list');
        list.innerHTML = '';
        snap.docs.forEach(function (doc) {
          list.appendChild(renderWorld(doc.data()));
        });
        show('carto-worlds-empty', snap.empty);
      })
      .catch(function (err) {
        console.error('Failed to load worlds:', err);
        ref('carto-worlds-error').textContent = 'Could not load worlds.';
        show('carto-worlds-error', true);
      })
      .then(function () {
        show('carto-worlds-loading', false);
      });
  }

  Cartographer.worlds = {
    loadWorlds: loadWorlds,
    describeCounts: describeCounts,
    warningsList: warningsList,
  };
})();
