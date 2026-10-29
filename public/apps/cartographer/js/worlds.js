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
    startGroup.appendChild(
      el(
        'p',
        'carto-hint',
        'Players can only enter places that are written up, so write this one up with Claude ' +
          'first. Publishing will say if it still needs anything.'
      )
    );

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
    Cartographer.loadSettlements(world.id)
      .then(function (settlements) {
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
    // A world made from scratch over MCP (L-391) has no import to count or name.
    var scratch = world.source && world.source.kind === 'scratch';
    if (!scratch) card.appendChild(el('p', 'carto-meta', describeCounts(world.counts)));
    card.appendChild(
      el(
        'p',
        'carto-meta',
        (scratch
          ? 'Made from scratch'
          : 'From "' + ((world.source && world.source.mapName) || 'a map') + '"') +
          ' · created ' +
          Cartographer.formatDate(world.createdAtMs) +
          (world.publishedAtMs
            ? ' · published ' + Cartographer.formatDate(world.publishedAtMs)
            : '')
      )
    );
    if (status === 'draft' || status === 'published') {
      var completion = el('div', 'carto-completion');
      completion.appendChild(el('p', 'carto-meta', 'Checking how built it is…'));
      completion.id = 'carto-completion-' + world.id;
      card.appendChild(completion);
    }
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
    if (status === 'draft' || status === 'published') {
      [
        ['town', 'Town art…'],
        ['battleMap', 'Battle-map art…'],
      ].forEach(function (kind) {
        var art = el('button', 'app-btn carto-art-btn', kind[1]);
        art.type = 'button';
        art.setAttribute('data-art', kind[0]);
        art.addEventListener('click', function () {
          art.disabled = true;
          card.appendChild(
            Cartographer.art.buildForm(world, kind[0], function () {
              art.disabled = false;
            })
          );
        });
        actions.appendChild(art);
      });
    }
    if (actions.children.length) card.appendChild(actions);
    return card;
  }

  // ── Completion ───────────────────────────────────
  // How built a world is, graded on the server (cartographerCompletion): how
  // many places are open, the world's score and band, counts by band for each
  // kind, and its biggest gaps, behind a toggle (L-693).

  var BAND_LABELS = {
    unbuilt: 'Unbuilt',
    stub: 'Stub',
    playable: 'Playable',
    rich: 'Rich',
    vivid: 'Vivid',
    legendary: 'Legendary',
  };
  var BAND_ORDER = ['legendary', 'vivid', 'rich', 'playable', 'stub', 'unbuilt'];
  var KIND_LABELS = [
    ['places', 'Places'],
    ['inTown', 'Places in town'],
    ['characters', 'Characters'],
    ['battleMaps', 'Battle maps'],
    ['factions', 'Realms'],
    ['regions', 'Regions'],
  ];

  function percent(share) {
    if (share > 0 && share < 0.01) return '<1%';
    return Math.round(share * 100) + '%';
  }

  function describeCompletion(c) {
    var n = Cartographer.formatNumber;
    return (
      n(c.playable) +
      ' of ' +
      n(c.total) +
      ' places playable (' +
      percent(c.share) +
      ')' +
      (c.rich ? ' · ' + n(c.rich) + ' rich' : '')
    );
  }

  // "Places: 2 rich · 10 playable · 707 unbuilt", leaving out empty bands.
  function describeBands(label, counts) {
    var n = Cartographer.formatNumber;
    var parts = BAND_ORDER.filter(function (band) {
      return counts && counts[band];
    }).map(function (band) {
      return n(counts[band]) + ' ' + BAND_LABELS[band].toLowerCase();
    });
    return parts.length ? label + ': ' + parts.join(' · ') : null;
  }

  function renderCompletion(node, c) {
    node.innerHTML = '';
    if (!c) return;
    if (c.band) {
      var score = el('p', 'carto-score');
      score.appendChild(el('span', 'carto-band carto-band--' + c.band, BAND_LABELS[c.band]));
      score.appendChild(document.createTextNode(' Score ' + Math.round(c.score) + ' of 100'));
      node.appendChild(score);
    }
    node.appendChild(el('p', 'carto-meta carto-completion-places', describeCompletion(c)));
    var counts = el('ul', 'carto-band-counts');
    KIND_LABELS.forEach(function (kind) {
      var line = describeBands(kind[1], (c.counts || {})[kind[0]]);
      if (line) counts.appendChild(el('li', null, line));
    });
    if (counts.children.length) node.appendChild(counts);
    if (c.gaps && c.gaps.length) {
      var details = el('details', 'carto-gaps');
      details.appendChild(el('summary', null, 'Biggest gaps (' + c.gaps.length + ')'));
      var list = el('ol');
      c.gaps.forEach(function (gap) {
        list.appendChild(el('li', null, gap.summary));
      });
      details.appendChild(list);
      node.appendChild(details);
    }
  }

  function loadCompletion(worldIds) {
    if (!worldIds.length) return;
    state.functions
      .httpsCallable('cartographerCompletion')({ worldIds: worldIds.slice(0, 20) })
      .then(function (result) {
        var worlds = (result.data && result.data.worlds) || {};
        worldIds.forEach(function (id) {
          var node = document.getElementById('carto-completion-' + id);
          if (node) renderCompletion(node, worlds[id]);
        });
      })
      .catch(function (err) {
        console.error('Failed to load completion:', err);
        worldIds.forEach(function (id) {
          var node = document.getElementById('carto-completion-' + id);
          if (node) node.textContent = '';
        });
      });
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
        var graded = [];
        snap.docs.forEach(function (doc) {
          var world = doc.data();
          list.appendChild(renderWorld(world));
          if (world.status === 'draft' || world.status === 'published') graded.push(world.id);
        });
        show('carto-worlds-empty', snap.empty);
        loadCompletion(graded);
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
