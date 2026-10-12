(function () {
  'use strict';

  // Making images (planning/the-image-studio.md §4.3; L-707 / #543): the form
  // starts a job through studioGenerate and returns at once; the jobs list
  // follows studio_jobs live, so each image appears as it finishes (and in
  // the grid, since it is in the library). References are library images,
  // chosen from an image's detail ("Use as a reference").

  var Studio = window.Studio;
  var state = Studio.state;
  var ref = Studio.getRef;
  var el = Studio.el;

  var RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
  var MAX_REFERENCES = 6;
  var references = [];
  var unsubscribe = null;

  var STATES = {
    queued: 'Waiting',
    running: 'Drawing…',
    done: 'Done',
    failed: 'Failed',
  };

  function renderReferences() {
    var box = ref('studio-refs');
    box.innerHTML = '';
    if (!references.length) {
      box.appendChild(
        el(
          'span',
          'studio-meta',
          'None. Open an image in the library and choose “Use as a reference”.'
        )
      );
      return;
    }
    references.forEach(function (id) {
      var record = Studio.library.find(id);
      var chip = el('span', 'studio-ref');
      if (record) {
        var img = el('img');
        img.src = record.link;
        img.alt = '';
        chip.appendChild(img);
      }
      chip.appendChild(el('span', null, record ? record.title : id));
      var remove = el('button', 'studio-link', 'Remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove ' + (record ? record.title : id));
      remove.addEventListener('click', function () {
        references = references.filter(function (r) {
          return r !== id;
        });
        renderReferences();
      });
      chip.appendChild(remove);
      box.appendChild(chip);
    });
  }

  function jobRow(job) {
    var r = job.request || {};
    var item = el('li', 'studio-job studio-job-' + job.state);
    var head = el('div', 'studio-job-head');
    head.appendChild(el('span', 'studio-job-state', STATES[job.state] || job.state));
    head.appendChild(
      el(
        'span',
        'studio-meta',
        [Studio.kindName(r.kind), r.tier || r.model, r.size, r.aspectRatio]
          .filter(Boolean)
          .join(' · ') +
          (job.cost !== null && job.cost !== undefined ? ' · ' + Studio.costs.money(job.cost) : '')
      )
    );
    item.appendChild(head);
    item.appendChild(el('p', 'studio-job-prompt', r.prompt));
    if (job.state === 'done' && job.imageId) {
      var open = el('button', 'studio-link', 'Open “' + (r.title || 'the image') + '”');
      open.type = 'button';
      open.addEventListener('click', function () {
        Studio.detail.open(job.imageId);
      });
      item.appendChild(open);
    }
    if (job.error) item.appendChild(el('p', 'studio-error', job.error));
    return item;
  }

  function follow() {
    if (unsubscribe) unsubscribe();
    unsubscribe = state.db
      .collection('studio_jobs')
      .orderBy('createdAt', 'desc')
      .limit(12)
      .onSnapshot(
        function (snap) {
          var list = ref('studio-jobs');
          list.innerHTML = '';
          if (!snap.docs.length) {
            list.appendChild(el('li', 'studio-meta', 'No images made yet.'));
            return;
          }
          snap.docs.forEach(function (doc) {
            list.appendChild(jobRow(doc.data()));
          });
        },
        function (err) {
          console.error('Failed to follow jobs:', err);
        }
      );
  }

  function onSubmit(e) {
    e.preventDefault();
    var error = ref('studio-generate-error');
    Studio.say(error, '');
    var prompt = ref('studio-prompt').value.trim();
    if (!prompt) return Studio.say(error, 'Say what to draw.');
    var data = {
      prompt: prompt,
      kind: ref('studio-gen-kind').value,
      tier: ref('studio-tier').value,
      references: references.slice(),
      labels: ref('studio-gen-labels')
        .value.split(',')
        .map(function (l) {
          return l.trim();
        })
        .filter(Boolean),
    };
    var title = ref('studio-gen-title').value.trim();
    if (title) data.title = title;
    var ratio = ref('studio-ratio').value;
    if (ratio) data.aspectRatio = ratio;
    var button = ref('studio-generate-btn');
    button.disabled = true;
    state.functions
      .httpsCallable('studioGenerate')(data)
      .then(function () {
        ref('studio-gen-title').value = '';
      })
      .catch(function (err) {
        console.error('Generate failed:', err);
        Studio.say(error, err.message || 'The image could not be started.');
      })
      .then(function () {
        button.disabled = false;
      });
  }

  Studio.generate = {
    init: function () {
      var kinds = ref('studio-gen-kind');
      Studio.KINDS.forEach(function (k) {
        kinds.appendChild(new window.Option(k[1], k[0]));
      });
      kinds.value = 'worldMap';
      var ratios = ref('studio-ratio');
      RATIOS.forEach(function (r) {
        ratios.appendChild(new window.Option(r, r));
      });
      ref('studio-generate-form').addEventListener('submit', onSubmit);
      renderReferences();
      follow();
    },
    addReference: function (id) {
      if (references.indexOf(id) !== -1) return;
      if (references.length >= MAX_REFERENCES) references.shift();
      references.push(id);
      renderReferences();
    },
    hasReference: function (id) {
      return references.indexOf(id) !== -1;
    },
  };
})();
