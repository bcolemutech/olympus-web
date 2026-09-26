(function () {
  'use strict';

  var Cartographer = window.Cartographer;
  var state = Cartographer.state;
  var ref = Cartographer.getRef;
  var show = Cartographer.show;

  function newUploadId() {
    return window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function setStatus(text) {
    ref('carto-status').textContent = text;
    show('carto-status', Boolean(text));
  }

  function setError(text) {
    ref('carto-upload-error').textContent = text;
    show('carto-upload-error', Boolean(text));
  }

  function setProgress(fraction) {
    show('carto-progress', fraction !== null);
    ref('carto-progress-bar').style.width = Math.round((fraction || 0) * 100) + '%';
  }

  // Uploads one file to the user's upload folder, reporting byte progress.
  function uploadFile(uploadId, name, file, contentType, onProgress) {
    var path = 'cartographer/' + state.uid + '/' + uploadId + '/' + name;
    var task = state.storage.ref(path).put(file, { contentType: contentType });
    return new Promise(function (resolve, reject) {
      task.on(
        'state_changed',
        function (snap) {
          onProgress(snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0);
        },
        reject,
        resolve
      );
    });
  }

  function renderResult(result) {
    var box = ref('carto-result');
    box.innerHTML = '';
    var title = document.createElement('p');
    title.className = 'carto-result-title';
    title.textContent = '"' + result.name + '" is loaded as a draft.';
    box.appendChild(title);

    var counts = document.createElement('p');
    counts.className = 'carto-meta';
    counts.textContent =
      Cartographer.worlds.describeCounts(result.counts) + (result.image ? ' · map image' : '');
    box.appendChild(counts);

    if (result.warnings && result.warnings.length) {
      box.appendChild(Cartographer.worlds.warningsList(result.warnings));
    }
    show('carto-result', true);
  }

  function onSubmit(e) {
    e.preventDefault();
    setError('');
    show('carto-result', false);

    var json = ref('carto-json').files[0];
    var png = ref('carto-png').files[0];
    var name = ref('carto-name').value.trim();
    if (!json) return setError('Choose the map JSON exported from Azgaar.');
    if (json.size > Cartographer.MAX_JSON_BYTES)
      return setError('The map JSON is larger than 50 MB.');
    if (png && png.size > Cartographer.MAX_PNG_BYTES)
      return setError('The map image is larger than 30 MB.');

    var button = ref('carto-upload-btn');
    button.disabled = true;
    var uploadId = newUploadId();
    var total = json.size + (png ? png.size : 0);

    setStatus('Uploading…');
    setProgress(0);
    uploadFile(uploadId, 'map.json', json, 'application/json', function (f) {
      setProgress((f * json.size) / total);
    })
      .then(function () {
        if (!png) return null;
        return uploadFile(uploadId, 'map.png', png, 'image/png', function (f) {
          setProgress((json.size + f * png.size) / total);
        });
      })
      .then(function () {
        setProgress(null);
        setStatus('Reading the map and building the world…');
        var importMap = state.functions.httpsCallable('cartographerImport', {
          timeout: Cartographer.IMPORT_TIMEOUT_MS,
        });
        return importMap({ uploadId: uploadId, name: name || undefined });
      })
      .then(function (res) {
        setStatus('');
        renderResult(res.data);
        ref('carto-upload-form').reset();
        Cartographer.worlds.loadWorlds();
      })
      .catch(function (err) {
        console.error('Map import failed:', err);
        setProgress(null);
        setStatus('');
        setError(err.message || 'The map could not be loaded.');
      })
      .then(function () {
        button.disabled = false;
      });
  }

  Cartographer.upload = {
    init: function () {
      ref('carto-upload-form').addEventListener('submit', onSubmit);
    },
  };
})();
