'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const { readImage } = require('./formats');
const { createLibrary, summary, LibraryError } = require('./library');

/**
 * The image studio's callables (planning/the-image-studio.md §4.1; L-701 /
 * #537). Anyone with the `cartographer` claim uses the studio (S1).
 *
 * upload(uid, { uploadId, title, kind, labels, prompt })
 *   Adds an uploaded image to the library (S5). The page puts the file in the
 *   editor's upload folder first, as studio.png, studio.jpg, studio.webp or
 *   studio.svg (storage.rules); the file is read by its bytes, never its
 *   name, and an SVG is cleaned as set_art cleans it. The upload is removed
 *   once it is in the library.
 */

const UPLOAD_ID = /^[A-Za-z0-9_-]{8,64}$/;
const UPLOAD_FILES = ['studio.png', 'studio.jpg', 'studio.webp', 'studio.svg'];
const MAX_PROMPT = 4000;

// The library's refusals, as the callables' errors.
function asHttps(err) {
  if (err instanceof LibraryError) return new HttpsError(err.code, err.message);
  return err;
}

function createStudioService({ db, bucket, now = () => Date.now() }) {
  const library = createLibrary({ db, bucket, now });

  async function upload(uid, { uploadId, title, kind, labels, prompt } = {}) {
    if (typeof uploadId !== 'string' || !UPLOAD_ID.test(uploadId)) {
      throw new HttpsError('invalid-argument', 'uploadId is required.');
    }
    if (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > MAX_PROMPT)) {
      throw new HttpsError('invalid-argument', `A prompt is text, up to ${MAX_PROMPT} characters.`);
    }
    const files = UPLOAD_FILES.map((name) =>
      bucket.file(`cartographer/${uid}/${uploadId}/${name}`)
    );
    let found = null;
    for (const file of files) {
      if ((await file.exists())[0]) {
        found = file;
        break;
      }
    }
    if (!found) throw new HttpsError('not-found', 'Upload the image first.');
    const [bytes] = await found.download();
    let image;
    try {
      image = readImage(bytes);
    } catch (err) {
      throw new HttpsError('invalid-argument', `The image can't be used: ${err.message}.`);
    }
    let record;
    try {
      record = await library.addImage({
        title,
        kind,
        labels,
        prompt: prompt || null,
        file: image,
        createdBy: uid,
        via: 'upload',
        source: { upload: found.name.split('/').pop() },
      });
    } catch (err) {
      throw asHttps(err);
    }
    await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
    return { image: summary(record.id, record) };
  }

  return { upload, library };
}

module.exports = { createStudioService, asHttps, UPLOAD_FILES };
