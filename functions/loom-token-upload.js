'use strict';

const tokens = require('./loom-canon/tokens');
const { readImage } = require('./studio/formats');

/**
 * A player's own token, uploaded (planning/tokens.md §4.3, TK2; L-933 /
 * #791). The file is known by its bytes: a PNG, JPEG or WebP of at most
 * 5 MB that `sharp` can read. It is turned upright by its EXIF orientation,
 * squared at the crop the player chose (`{ x, y, zoom }`, as a token's:
 * ./loom-canon/tokens.js), resized to 512 px, and written as WebP with no
 * metadata, at `loom_tokens/{uid}/{saveId}.webp`, readable by its owner only
 * (storage.rules). Its token on the save is `{ file, version, width, height,
 * format }`, with no crop: the crop is in the picture.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const SIDE = 512;
const FORMATS = ['png', 'jpeg', 'webp'];

class UploadError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** The bytes of an upload sent as base64, or a refusal. */
function bytesOf(data) {
  if (typeof data !== 'string' || !data) {
    throw new UploadError('invalid-argument', 'image is the file, base64-encoded.');
  }
  // Base64 is 4 characters for every 3 bytes: refuse a big one before decoding it.
  if (data.length > Math.ceil(MAX_BYTES / 3) * 4 + 4) throw tooBig();
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > MAX_BYTES) throw tooBig();
  return bytes;
}

function tooBig() {
  return new UploadError(
    'invalid-argument',
    `That picture is larger than ${MAX_BYTES / (1024 * 1024)} MB: try a smaller one.`
  );
}

const NOT_AN_IMAGE = 'That file isn’t a picture: use a PNG, JPEG or WebP.';

/**
 * The square to cut for a crop on an image `width` × `height`: its side the
 * shorter side over the zoom, centred on the crop's point and kept inside.
 */
function squareOf(width, height, crop) {
  const { x, y, zoom } = tokens.cropOf({ crop });
  const side = Math.max(1, Math.floor(Math.min(width, height) / zoom));
  const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(v)));
  return {
    left: clamp(x * width - side / 2, width - side),
    top: clamp(y * height - side / 2, height - side),
    width: side,
    height: side,
  };
}

/**
 * The picture made from an upload: `{ bytes, width, height }`, a 512 px
 * square WebP with no metadata. Refuses anything that isn't a PNG, JPEG or
 * WebP sharp can read, or is over 5 MB.
 */
async function makeToken(bytes, crop) {
  const sharp = require('sharp');
  const problems = tokens.validateCrop(crop);
  if (problems.length) throw new UploadError('invalid-argument', problems.join(' '));
  if (bytes.length > MAX_BYTES) throw tooBig();
  let kind;
  try {
    kind = readImage(bytes).format;
  } catch {
    throw new UploadError('invalid-argument', NOT_AN_IMAGE);
  }
  if (!FORMATS.includes(kind)) throw new UploadError('invalid-argument', NOT_AN_IMAGE);
  let upright;
  try {
    // Turned upright by its orientation, so the crop is where the player saw it.
    upright = await sharp(bytes, { failOn: 'error' })
      .rotate()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new UploadError('invalid-argument', NOT_AN_IMAGE);
  }
  const square = squareOf(upright.info.width, upright.info.height, crop);
  // sharp writes no metadata unless asked (withMetadata), so none is kept.
  const out = await sharp(upright.data)
    .extract(square)
    .resize(SIDE, SIDE, { fit: 'cover' })
    .webp({ quality: 85 })
    .toBuffer();
  return { bytes: out, width: SIDE, height: SIDE };
}

/**
 * Takes a player's upload for their save (`uid` must own it): stores the
 * picture and sets `character.token`. Returns `{ token }` as the page draws
 * it. `now` versions the file, so a new one isn't drawn from the old's cache.
 */
async function uploadToken({ db, bucket, uid, saveId, image, crop, now = Date.now }) {
  if (typeof saveId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(saveId)) {
    throw new UploadError('invalid-argument', 'saveId is required.');
  }
  const bytes = bytesOf(image);
  const ref = db.collection('loom_saves').doc(saveId);
  const snap = await ref.get();
  if (!snap.exists) throw new UploadError('not-found', 'Save not found.');
  if (snap.data().ownerUid !== uid) {
    throw new UploadError('permission-denied', 'This is not your save.');
  }
  const made = await makeToken(bytes, crop === null ? undefined : crop);
  const file = tokens.uploadPath(uid, saveId);
  await bucket.file(file).save(made.bytes, {
    resumable: false,
    contentType: 'image/webp',
    metadata: { cacheControl: 'private, max-age=0' },
  });
  const token = { file, version: now(), width: made.width, height: made.height, format: 'webp' };
  try {
    await ref.update({ 'character.token': token });
  } catch (err) {
    // The save went meanwhile: so does the file.
    await bucket
      .file(file)
      .delete()
      .catch(() => {});
    throw err;
  }
  return { token: tokens.forPlayer(token) };
}

/** Deletes a save's uploaded token, if it has one (gone already is fine). */
async function deleteUpload(bucket, uid, saveId) {
  await bucket
    .file(tokens.uploadPath(uid, saveId))
    .delete()
    .catch((err) => {
      if (err && err.code !== 404) throw err;
    });
}

module.exports = { MAX_BYTES, SIDE, UploadError, squareOf, makeToken, uploadToken, deleteUpload };
