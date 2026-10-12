(function () {
  'use strict';

  // An image's detail (L-702): the image, its title, kind, labels and prompt,
  // its versions (each can be looked at and downloaded), where it is used,
  // who made it, and its link, with a copy button. Changing an image is done
  // from Claude (studio_update), so the detail only reads.

  var Studio = window.Studio;
  var state = Studio.state;
  var ref = Studio.getRef;
  var el = Studio.el;

  var openId = null;
  var showing = null; // the version on screen
  var names = {}; // 'worldId/collection/id' → a town's or battle map's name

  var VIA = {
    page: 'on this page',
    mcp: 'from Claude',
    upload: 'uploaded',
    backfill: 'moved in from a world',
  };

  function slug(text) {
    return (
      String(text || 'image')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'image'
    );
  }

  // A version's file: readable by editors (storage.rules).
  function versionUrl(version) {
    return state.storage.ref(version.path).getDownloadURL();
  }

  // Downloads a version's original file, named after the image. Falls back
  // to opening it when the browser can't fetch it.
  function download(record, version, button) {
    var name = slug(record.title) + '-v' + version.n + '.' + Studio.EXTENSIONS[version.format];
    button.disabled = true;
    var url;
    return versionUrl(version)
      .then(function (u) {
        url = u;
        return fetch(url);
      })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        var a = document.createElement('a');
        a.href = window.URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(function () {
          window.URL.revokeObjectURL(a.href);
        }, 10000);
      })
      .catch(function (err) {
        console.warn('Download by fetch failed; opening the file instead:', err);
        if (url) window.open(url, '_blank', 'noopener');
      })
      .then(function () {
        button.disabled = false;
      });
  }

  function copy(text, status) {
    var clipboard = window.navigator.clipboard;
    var manual = 'Select the link and copy it.';
    if (!clipboard || !clipboard.writeText) return Studio.say(status, manual);
    clipboard.writeText(text).then(
      function () {
        Studio.say(status, 'Copied.');
        window.setTimeout(function () {
          Studio.say(status, '');
        }, 3000);
      },
      function () {
        Studio.say(status, manual);
      }
    );
  }

  function row(list, label, value) {
    list.appendChild(el('dt', null, label));
    var dd = el('dd');
    if (value instanceof window.Node) dd.appendChild(value);
    else dd.textContent = value;
    list.appendChild(dd);
    return dd;
  }

  // What a use is called: the world, and the town or battle map in it.
  function useName(use, node) {
    var world = state.worlds[use.worldId] || use.worldId;
    var target = Studio.TARGETS[use.target] || use.target;
    if (use.target === 'map' || use.target === 'cover') {
      node.textContent = world + ' · ' + target;
      return;
    }
    var collection = use.target === 'town' ? 'locations' : 'battleMaps';
    var key = use.worldId + '/' + collection + '/' + use.id;
    var draw = function () {
      node.textContent = world + ' · ' + target + ' · ' + (names[key] || use.id);
    };
    draw();
    if (key in names) return;
    state.db
      .collection('loom_worlds')
      .doc(use.worldId)
      .collection(collection)
      .doc(use.id)
      .get()
      .then(function (snap) {
        names[key] = snap.exists ? snap.data().name : use.id;
        draw();
      })
      .catch(function () {
        names[key] = use.id;
      });
  }

  function render(record) {
    var body = ref('studio-detail-body');
    body.innerHTML = '';

    var header = el('div', 'studio-detail-header');
    var title = el('h2', 'studio-detail-title', record.title);
    title.id = 'studio-detail-title';
    header.appendChild(title);
    var close = el('button', 'studio-link', 'Close');
    close.type = 'button';
    close.addEventListener('click', function () {
      Studio.detail.close();
    });
    header.appendChild(close);
    body.appendChild(header);

    // The image: the current version through its link, an earlier one from
    // its file.
    var version =
      record.versions.filter(function (v) {
        return v.n === showing;
      })[0] || Studio.currentVersion(record);
    var figure = el('figure', 'studio-detail-image');
    var img = el('img');
    img.alt = record.title + (version.n === record.current ? '' : ', version ' + version.n);
    if (version.n === record.current) {
      img.src = record.link;
    } else {
      versionUrl(version).then(function (url) {
        img.src = url;
      });
    }
    figure.appendChild(img);
    figure.appendChild(
      el(
        'figcaption',
        'studio-meta',
        'Version ' +
          version.n +
          (version.n === record.current ? ' (current)' : '') +
          ' · ' +
          version.width +
          '×' +
          version.height +
          ' · ' +
          String(version.format).toUpperCase() +
          ' · ' +
          Studio.formatBytes(version.bytes)
      )
    );
    body.appendChild(figure);

    var actions = el('div', 'studio-detail-actions');
    var down = el('button', 'app-btn', 'Download original');
    down.type = 'button';
    down.addEventListener('click', function () {
      download(record, version, down);
    });
    actions.appendChild(down);
    // A reference for the next image made (L-707).
    if (Studio.generate) {
      var useRef = el(
        'button',
        'studio-link',
        Studio.generate.hasReference(record.id) ? 'A reference ✓' : 'Use as a reference'
      );
      useRef.type = 'button';
      useRef.addEventListener('click', function () {
        Studio.generate.addReference(record.id);
        useRef.textContent = 'A reference ✓';
      });
      actions.appendChild(useRef);
    }
    body.appendChild(actions);

    var facts = el('dl', 'studio-facts');
    row(facts, 'Kind', Studio.kindName(record.kind));
    var labels = el('span', 'studio-labels');
    (record.labels || []).forEach(function (label) {
      labels.appendChild(el('span', 'studio-label-pill', label));
    });
    row(facts, 'Labels', (record.labels || []).length ? labels : 'None');
    if (record.prompt) row(facts, 'Prompt', record.prompt).className = 'studio-prompt';
    row(
      facts,
      'Made',
      Studio.formatDate(record.createdAt) +
        ' by ' +
        Studio.who(record.createdBy) +
        (record.via && record.via !== 'backfill' ? ', ' + (VIA[record.via] || record.via) : '')
    );
    if (record.model)
      row(facts, 'Model', record.model + (record.tier ? ' (' + record.tier + ')' : ''));

    // The link, which always serves the current version (A6).
    var link = el('div', 'studio-link-row');
    var code = el('code', 'studio-link-url', record.link);
    link.appendChild(code);
    var copyBtn = el('button', 'app-btn', 'Copy');
    copyBtn.type = 'button';
    var copied = el('span', 'studio-status hidden');
    copied.setAttribute('role', 'status');
    copyBtn.addEventListener('click', function () {
      copy(record.link, copied);
    });
    link.appendChild(copyBtn);
    link.appendChild(copied);
    row(facts, 'Link', link);
    body.appendChild(facts);
    body.appendChild(
      el(
        'p',
        'studio-help',
        'The link always shows the current version, and works anywhere an image does: ' +
          'anyone holding it can see the image.'
      )
    );

    // Where it is used.
    body.appendChild(el('h3', 'studio-subtitle', 'Used in'));
    var uses = record.usedIn || [];
    if (!uses.length) {
      body.appendChild(
        el('p', 'studio-meta', 'No world uses it. Assign it from Claude with studio_assign.')
      );
    } else {
      var useList = el('ul', 'studio-uses');
      uses.forEach(function (use) {
        var item = el('li');
        useName(use, item);
        useList.appendChild(item);
      });
      body.appendChild(useList);
    }

    // Its versions, newest first.
    body.appendChild(el('h3', 'studio-subtitle', 'Versions'));
    var table = el('table', 'studio-versions');
    var head = el('tr');
    ['', 'Size', 'Made', 'Change', ''].forEach(function (h) {
      head.appendChild(el('th', null, h));
    });
    table.appendChild(head);
    record.versions
      .slice()
      .sort(function (a, b) {
        return b.n - a.n;
      })
      .forEach(function (v) {
        var tr = el('tr', v.n === version.n ? 'studio-version-shown' : '');
        tr.appendChild(el('td', null, 'v' + v.n + (v.n === record.current ? ' · current' : '')));
        tr.appendChild(
          el(
            'td',
            null,
            v.width +
              '×' +
              v.height +
              ' ' +
              String(v.format).toUpperCase() +
              ', ' +
              Studio.formatBytes(v.bytes)
          )
        );
        tr.appendChild(
          el('td', null, Studio.formatDate(v.createdAt) + ' by ' + Studio.who(v.createdBy))
        );
        tr.appendChild(el('td', null, v.instruction || (v.n === 1 ? 'First version' : '—')));
        var cell = el('td', 'studio-version-actions');
        if (v.n !== version.n) {
          var view = el('button', 'studio-link', 'View');
          view.type = 'button';
          view.addEventListener('click', function () {
            showing = v.n;
            render(record);
          });
          cell.appendChild(view);
        }
        var get = el('button', 'studio-link', 'Download');
        get.type = 'button';
        get.addEventListener('click', function () {
          download(record, v, get);
        });
        cell.appendChild(get);
        tr.appendChild(cell);
        table.appendChild(tr);
      });
    body.appendChild(table);
  }

  Studio.detail = {
    init: function () {
      var dialog = ref('studio-detail');
      dialog.addEventListener('close', function () {
        openId = null;
      });
      // A click on the backdrop closes it.
      dialog.addEventListener('click', function (e) {
        if (e.target === dialog) Studio.detail.close();
      });
    },
    open: function (id) {
      var record = Studio.library.find(id);
      if (!record) return;
      openId = id;
      showing = record.current;
      render(record);
      var dialog = ref('studio-detail');
      if (!dialog.open) dialog.showModal();
    },
    close: function () {
      var dialog = ref('studio-detail');
      if (dialog.open) dialog.close();
      openId = null;
    },
    // The library changed: redraw the open image, or close it if it is gone.
    refresh: function () {
      if (!openId) return;
      var record = Studio.library.find(openId);
      if (!record) return Studio.detail.close();
      if (
        !record.versions.some(function (v) {
          return v.n === showing;
        })
      ) {
        showing = record.current;
      }
      render(record);
    },
  };
})();
