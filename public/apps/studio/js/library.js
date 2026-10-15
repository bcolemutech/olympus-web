(function () {
  'use strict';

  // The library's grid (L-702): every image, newest first, with search and
  // filters as studio_find has them (L3): words matched in the title, prompt
  // and labels (each word must appear), a kind, a label and a world it is
  // used in. The library is one shared library of hundreds of images, so the
  // page keeps it all and filters as you type. It follows changes live, so an
  // upload, or Claude's labelling, shows at once.

  var Studio = window.Studio;
  var state = Studio.state;
  var ref = Studio.getRef;
  var el = Studio.el;
  var unsubscribe = null;

  function filters() {
    return {
      words: ref('studio-words').value.toLowerCase().split(/\s+/).filter(Boolean),
      kind: ref('studio-filter-kind').value,
      label: ref('studio-filter-label').value,
      worldId: ref('studio-filter-world').value,
    };
  }

  function matches(record, f) {
    if (f.kind && record.kind !== f.kind) return false;
    if (f.label && (record.labels || []).indexOf(f.label) === -1) return false;
    if (
      f.worldId &&
      !(record.usedIn || []).some(function (use) {
        return use.worldId === f.worldId;
      })
    ) {
      return false;
    }
    if (f.words.length) {
      var text = [record.title, record.prompt || '', (record.labels || []).join(' ')]
        .join(' ')
        .toLowerCase();
      return f.words.every(function (word) {
        return text.indexOf(word) !== -1;
      });
    }
    return true;
  }

  function card(record) {
    var version = Studio.currentVersion(record);
    var item = el('button', 'studio-card');
    item.type = 'button';
    item.dataset.id = record.id;
    item.setAttribute('aria-label', record.title);
    var frame = el('div', 'studio-thumb');
    var img = el('img');
    Studio.thumb(img, record); // its screen-sized copy (L-727)
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    frame.appendChild(img);
    item.appendChild(frame);
    var body = el('div', 'studio-card-body');
    body.appendChild(el('span', 'studio-card-title', record.title));
    var meta = el('span', 'studio-card-meta');
    meta.appendChild(el('span', 'studio-kind', Studio.kindName(record.kind)));
    if (version.width) {
      meta.appendChild(document.createTextNode(' ' + version.width + '×' + version.height));
    }
    if ((record.usedIn || []).length) {
      meta.appendChild(el('span', 'studio-used', 'in use'));
    }
    body.appendChild(meta);
    if ((record.labels || []).length) {
      var labels = el('span', 'studio-labels');
      record.labels.forEach(function (label) {
        labels.appendChild(el('span', 'studio-label-pill', label));
      });
      body.appendChild(labels);
    }
    item.appendChild(body);
    item.addEventListener('click', function () {
      Studio.detail.open(record.id);
    });
    return item;
  }

  function render() {
    var f = filters();
    var grid = ref('studio-grid');
    var shown = state.images.filter(function (record) {
      return matches(record, f);
    });
    grid.innerHTML = '';
    shown.forEach(function (record) {
      grid.appendChild(card(record));
    });
    var filtered = f.words.length || f.kind || f.label || f.worldId;
    ref('studio-count').textContent = state.images.length
      ? filtered
        ? shown.length + ' of ' + state.images.length + ' images'
        : state.images.length + (state.images.length === 1 ? ' image' : ' images')
      : '';
    Studio.say(
      ref('studio-empty'),
      shown.length
        ? ''
        : state.images.length
          ? 'No images match.'
          : 'The library is empty. Upload an image, or make one with Claude.'
    );
  }

  // Keeps a select's options, keeping its choice if it is still there.
  function setOptions(select, first, options) {
    var chosen = select.value;
    select.innerHTML = '';
    select.appendChild(new window.Option(first, ''));
    options.forEach(function (o) {
      select.appendChild(new window.Option(o[1], o[0]));
    });
    select.value = options.some(function (o) {
      return o[0] === chosen;
    })
      ? chosen
      : '';
  }

  // The labels in use, most used first (studio_labels), for the filter and
  // the upload form's suggestions.
  function renderLabels() {
    var counts = {};
    state.images.forEach(function (record) {
      (record.labels || []).forEach(function (label) {
        counts[label] = (counts[label] || 0) + 1;
      });
    });
    var labels = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b);
    });
    setOptions(
      ref('studio-filter-label'),
      'Any label',
      labels.map(function (label) {
        return [label, label + ' (' + counts[label] + ')'];
      })
    );
    var list = ref('studio-label-list');
    list.innerHTML = '';
    labels.forEach(function (label) {
      list.appendChild(new window.Option(label));
    });
  }

  // The worlds images are used in, by name.
  function renderWorlds() {
    var ids = {};
    state.images.forEach(function (record) {
      (record.usedIn || []).forEach(function (use) {
        ids[use.worldId] = true;
      });
    });
    var missing = Object.keys(ids).filter(function (id) {
      return !(id in state.worlds);
    });
    var draw = function () {
      setOptions(
        ref('studio-filter-world'),
        'Any world',
        Object.keys(ids)
          .map(function (id) {
            return [id, state.worlds[id] || id];
          })
          .sort(function (a, b) {
            return a[1].localeCompare(b[1]);
          })
      );
    };
    draw();
    if (!missing.length) return;
    Promise.all(
      missing.map(function (id) {
        return state.db
          .collection('loom_worlds')
          .doc(id)
          .get()
          .then(function (snap) {
            state.worlds[id] = snap.exists ? snap.data().name : id;
          })
          .catch(function () {
            state.worlds[id] = id;
          });
      })
    ).then(draw);
  }

  function load() {
    if (unsubscribe) unsubscribe();
    Studio.show('studio-grid-loading', true);
    unsubscribe = state.db
      .collection('studio_images')
      .orderBy('createdAt', 'desc')
      .onSnapshot(
        function (snap) {
          state.images = snap.docs.map(function (doc) {
            return doc.data();
          });
          Studio.show('studio-grid-loading', false);
          Studio.say(ref('studio-grid-error'), '');
          renderLabels();
          renderWorlds();
          render();
          Studio.detail.refresh();
          // A new image may have cost something (L-706).
          if (Studio.costs) Studio.costs.refresh();
        },
        function (err) {
          console.error('Failed to load the library:', err);
          Studio.show('studio-grid-loading', false);
          Studio.say(ref('studio-grid-error'), 'The library could not be loaded.');
        }
      );
  }

  Studio.library = {
    init: function () {
      var kinds = ref('studio-filter-kind');
      Studio.KINDS.forEach(function (k) {
        kinds.appendChild(new window.Option(k[1], k[0]));
      });
      ref('studio-filters').addEventListener('submit', function (e) {
        e.preventDefault();
      });
      ref('studio-words').addEventListener('input', render);
      ['studio-filter-kind', 'studio-filter-label', 'studio-filter-world'].forEach(function (id) {
        ref(id).addEventListener('change', render);
      });
      load();
    },
    find: function (id) {
      return state.images.filter(function (record) {
        return record.id === id;
      })[0];
    },
    matches: matches,
  };
})();
