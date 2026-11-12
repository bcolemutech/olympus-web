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
    if (status === 'draft' || status === 'published') {
      card.appendChild(Cartographer.brief.briefRow(world, loadWorlds));
      card.appendChild(portraitsRow(world));
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

  // ── Player portraits (L-933) ─────────────────────
  // The portraits a world offers players for their own token
  // (`tokens.player`, set with set_world_tokens), each in its circle at its
  // crop as the Loom's picker shows it.

  var PORTRAIT_PX = 44;

  function portraitCircle(token, side) {
    var circle = el('span', 'carto-portrait' + (side ? ' carto-portrait--' + side : ''));
    circle.style.width = circle.style.height = PORTRAIT_PX + 'px';
    var img = document.createElement('img');
    img.alt = '';
    img.addEventListener('load', function () {
      var crop = token.crop || {};
      var x = typeof crop.x === 'number' ? crop.x : 0.5;
      var y = typeof crop.y === 'number' ? crop.y : 0.5;
      var zoom = typeof crop.zoom === 'number' && crop.zoom >= 1 ? crop.zoom : 1;
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      var k = PORTRAIT_PX / (Math.min(w, h) / zoom);
      img.style.width = w * k + 'px';
      img.style.height = h * k + 'px';
      img.style.left = PORTRAIT_PX / 2 - x * w * k + 'px';
      img.style.top = PORTRAIT_PX / 2 - y * h * k + 'px';
    });
    img.src = token.link;
    circle.appendChild(img);
    return circle;
  }

  function portraitsRow(world) {
    var list = ((world.tokens || {}).player || []).filter(function (t) {
      return t && typeof t.link === 'string';
    });
    var row = el('div', 'carto-portraits');
    row.id = 'carto-portraits-' + world.id;
    if (!list.length) {
      row.appendChild(
        el(
          'p',
          'carto-meta',
          'Player portraits: none, so players upload their own (offer some with set_world_tokens).'
        )
      );
      return row;
    }
    row.appendChild(el('span', 'carto-meta', 'Player portraits:'));
    list.forEach(function (token) {
      row.appendChild(portraitCircle(token));
    });
    return row;
  }

  // ── Token previews (L-934) ───────────────────────
  // Each named character's and stat block's token as the Loom draws it: the
  // picture in its circle at its crop, the ring coloured by side; and those
  // with none listed, behind a toggle. Sent by cartographerCompletion
  // (`tokens`, loom-canon/tokens.js previewsOf).

  var TOKEN_GROUPS = [
    ['characters', 'Characters'],
    ['statBlocks', 'Stat blocks'],
  ];

  function tokenGroup(label, group) {
    var box = el('div', 'carto-token-group');
    box.appendChild(
      el(
        'p',
        'carto-meta',
        label +
          ': ' +
          (group.total - group.withoutCount) +
          ' of ' +
          group.total +
          ' have a token picture'
      )
    );
    if (group.with.length) {
      var row = el('div', 'carto-portraits');
      group.with.forEach(function (who) {
        var item = el('figure', 'carto-token');
        item.title = who.name;
        item.appendChild(portraitCircle(who, who.side));
        item.appendChild(el('figcaption', 'carto-meta', who.name));
        row.appendChild(item);
      });
      box.appendChild(row);
    }
    if (group.without.length) {
      var more = group.withoutCount - group.without.length;
      box.appendChild(
        el(
          'p',
          'carto-meta carto-token-missing',
          'No picture: ' +
            group.without
              .map(function (who) {
                return who.name;
              })
              .join(', ') +
            (more > 0 ? ' and ' + more + ' more' : '') +
            '.'
        )
      );
    }
    return box;
  }

  function renderTokens(tokens) {
    var shown = TOKEN_GROUPS.filter(function (g) {
      return tokens && tokens[g[0]] && tokens[g[0]].total;
    });
    if (!shown.length) return null;
    var details = el('details', 'carto-tokens');
    details.appendChild(el('summary', null, 'Tokens'));
    shown.forEach(function (g) {
      details.appendChild(tokenGroup(g[1], tokens[g[0]]));
    });
    return details;
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
    if (c.maps) node.appendChild(renderMaps(c.maps));
    var tokens = renderTokens(c.tokens);
    if (tokens) node.appendChild(tokens);
  }

  // A world's maps as a tree (L-905; map levels UI4): each with its kind, its
  // band and, while closed, what it lacks; behind a toggle.
  var MAP_KINDS = { region: 'Region', area: 'Area', grid: 'Grid' };

  function countMaps(node) {
    return (
      1 +
      (node.children || []).reduce(function (n, child) {
        return n + countMaps(child);
      }, 0)
    );
  }

  function mapItem(node) {
    var li = el('li', 'carto-map');
    var row = el('div', 'carto-map-row');
    row.appendChild(
      el('span', 'carto-band carto-band--' + node.band, BAND_LABELS[node.band] || node.band)
    );
    row.appendChild(el('span', 'carto-map-name', ' ' + node.name));
    row.appendChild(
      el('span', 'carto-meta carto-map-kind', ' · ' + (MAP_KINDS[node.kind] || node.kind))
    );
    li.appendChild(row);
    if ((node.lacks || []).length && (node.band === 'unbuilt' || node.band === 'stub')) {
      li.appendChild(el('p', 'carto-meta carto-map-lacks', node.lacks.join(' ')));
    }
    if ((node.children || []).length) {
      var list = el('ul', 'carto-map-children');
      node.children.forEach(function (child) {
        list.appendChild(mapItem(child));
      });
      li.appendChild(list);
    }
    return li;
  }

  function renderMaps(tree) {
    var details = el('details', 'carto-maps');
    details.appendChild(el('summary', null, 'Maps (' + countMaps(tree) + ')'));
    var list = el('ul', 'carto-map-tree');
    list.appendChild(mapItem(tree));
    details.appendChild(list);
    return details;
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
    renderCompletion: renderCompletion,
    describeCounts: describeCounts,
    warningsList: warningsList,
  };
})();
