(function () {
  'use strict';

  // Uploading (S5; L-702): each chosen file is put in the editor's upload
  // folder as studio.<ext> (storage.rules), then studioUpload adds it to the
  // library with the kind, title and labels given. Several files are
  // uploaded one after another; each becomes its own image. The grid shows
  // them as they arrive.

  var Studio = window.Studio;
  var state = Studio.state;
  var ref = Studio.getRef;

  function newUploadId() {
    return window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  // A file's type: from the browser, or its name when the browser gives none.
  function typeOf(file) {
    if (Studio.UPLOADS[file.type]) return file.type;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    return {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    }[ext];
  }

  function titleOf(file, given, count) {
    var name =
      file.name
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim() || 'Untitled';
    if (!given) return name.slice(0, 120);
    return (count > 1 ? given + ': ' + name : given).slice(0, 120);
  }

  function setProgress(fraction) {
    Studio.show('studio-progress', fraction !== null);
    ref('studio-progress-bar').style.width = Math.round((fraction || 0) * 100) + '%';
  }

  function put(uploadId, file, type, onProgress) {
    var path = 'cartographer/' + state.uid + '/' + uploadId + '/' + Studio.UPLOADS[type].file;
    var task = state.storage.ref(path).put(file, { contentType: type });
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

  function onSubmit(e) {
    e.preventDefault();
    var status = ref('studio-upload-status');
    var error = ref('studio-upload-error');
    Studio.say(error, '');
    var files = Array.prototype.slice.call(ref('studio-files').files);
    var kind = ref('studio-kind').value;
    var title = ref('studio-title').value.trim();
    var labels = ref('studio-labels')
      .value.split(',')
      .map(function (l) {
        return l.trim();
      })
      .filter(Boolean);
    if (!files.length) return Studio.say(error, 'Choose one or more images.');
    for (var i = 0; i < files.length; i++) {
      var type = typeOf(files[i]);
      if (!type) {
        return Studio.say(error, files[i].name + ' isn’t a PNG, JPEG, WebP or SVG image.');
      }
      var limit = type === 'image/svg+xml' ? Studio.MAX_SVG_BYTES : Studio.MAX_BYTES;
      if (files[i].size > limit) {
        return Studio.say(
          error,
          files[i].name + ' is larger than ' + (limit === Studio.MAX_BYTES ? '30 MB.' : '1 MB.')
        );
      }
    }

    var button = ref('studio-upload-btn');
    button.disabled = true;
    var added = [];
    var failed = [];
    var total = files.reduce(function (sum, f) {
      return sum + f.size;
    }, 0);
    var done = 0;
    setProgress(0);

    var chain = Promise.resolve();
    files.forEach(function (file, index) {
      chain = chain.then(function () {
        var type = typeOf(file);
        var uploadId = newUploadId();
        var prefix = files.length > 1 ? '(' + (index + 1) + ' of ' + files.length + ') ' : '';
        Studio.say(status, prefix + 'Uploading ' + file.name + '…');
        return put(uploadId, file, type, function (f) {
          setProgress((done + f * file.size) / total);
        })
          .then(function () {
            Studio.say(status, prefix + 'Adding ' + file.name + ' to the library…');
            return state.functions.httpsCallable('studioUpload')({
              uploadId: uploadId,
              title: titleOf(file, title, files.length),
              kind: kind,
              labels: labels,
            });
          })
          .then(function (res) {
            added.push(res.data.image);
          })
          .catch(function (err) {
            console.error('Upload failed:', file.name, err);
            failed.push(file.name + ': ' + (err.message || 'it could not be uploaded'));
          })
          .then(function () {
            done += file.size;
          });
      });
    });

    chain.then(function () {
      setProgress(null);
      button.disabled = false;
      Studio.say(
        status,
        added.length
          ? (added.length === 1 ? '“' + added[0].title + '” is' : added.length + ' images are') +
              ' in the library.'
          : ''
      );
      Studio.say(error, failed.join(' '));
      if (!failed.length) {
        ref('studio-files').value = '';
        ref('studio-title').value = '';
      }
    });
  }

  Studio.upload = {
    init: function () {
      var kinds = ref('studio-kind');
      Studio.KINDS.forEach(function (k) {
        kinds.appendChild(new window.Option(k[1], k[0]));
      });
      kinds.value = 'other';
      ref('studio-upload-form').addEventListener('submit', onSubmit);
    },
    typeOf: typeOf,
    titleOf: titleOf,
  };
})();
