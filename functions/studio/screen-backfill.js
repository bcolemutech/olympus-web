'use strict';

const { FORMATS } = require('./formats');
const { LINK_CACHE, currentPath } = require('./library');
const screen = require('./screen');

/**
 * Screen-sized copies for the library's images from before L-727 (#598;
 * planning/the-map-first-loom.md §3 A1): every version bigger than a screen
 * gets its copy, and every image its screen link (studio/{imageId}/screen,
 * under the image's link token), as ./library.js now makes them.
 *
 *   planScreenBackfill(record) → { copies: [n…], link: bool } still to make,
 *                                from the record alone (the link is checked
 *                                in Storage by applyScreenBackfill)
 *   applyScreenBackfill(...)   → makes them, or with `apply` false only says
 *                                what it would make
 *
 * It is idempotent: a version with its copy, and an image with its screen
 * file, are left alone, so a second run finds nothing to do.
 */

function planScreenBackfill(record) {
  const copies = (record.versions || [])
    .filter((v) => !v.screen && screen.needsCopy(v))
    .map((v) => v.n);
  return { copies };
}

/**
 * Makes the copies and screen links the library's images lack: every image,
 * or the one `imageId`. Returns { images: [{ id, title, copies: [{ n, from,
 * to }], link }], missing: [{ id, n, path }] }, where `from` and `to` are
 * "W × H" and `link` says the screen link is (or would be) written.
 */
async function applyScreenBackfill({ db, bucket, apply, imageId }) {
  const images = db.collection('studio_images');
  const snaps = imageId ? [await images.doc(imageId).get()] : (await images.get()).docs;
  const out = [];
  const missing = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const record = snap.data();
    const plan = planScreenBackfill(record);
    const [linkThere] = await bucket.file(screen.screenCurrentPath(record.id)).exists();
    const current = record.versions.find((v) => v.n === record.current);
    const relink = !linkThere || (current && plan.copies.includes(current.n));
    if (!plan.copies.length && !relink) continue;
    const item = { id: record.id, title: record.title, copies: [], link: relink };
    const versions = record.versions.slice();
    for (const n of plan.copies) {
      const at = versions.findIndex((v) => v.n === n);
      const version = versions[at];
      const size = (w, h) => `${w} × ${h}`;
      if (!apply) {
        const scale = screen.SCREEN_MAX / Math.max(version.width, version.height);
        item.copies.push({
          n,
          from: size(version.width, version.height),
          to: size(Math.round(version.width * scale), Math.round(version.height * scale)),
        });
        continue;
      }
      const [exists] = await bucket.file(version.path).exists();
      if (!exists) {
        missing.push({ id: record.id, n, path: version.path });
        continue;
      }
      const [bytes] = await bucket.file(version.path).download();
      const copy = await screen.screenCopy({ ...version, bytes });
      const path = screen.screenVersionPath(record.id, n);
      await bucket.file(path).save(copy.bytes, { resumable: false, contentType: copy.contentType });
      versions[at] = {
        ...version,
        screen: {
          path,
          width: copy.width,
          height: copy.height,
          format: copy.format,
          bytes: copy.bytes.length,
        },
      };
      item.copies.push({
        n,
        from: size(version.width, version.height),
        to: size(copy.width, copy.height),
      });
    }
    if (apply) {
      if (item.copies.length) await images.doc(record.id).update({ versions });
      if (relink) await writeScreenLink(bucket, record, versions);
    }
    out.push(item);
  }
  return { images: out, missing };
}

// The image's screen link: its current version's copy, or the current file.
async function writeScreenLink(bucket, record, versions) {
  const current = versions.find((v) => v.n === record.current);
  const copy = current && current.screen;
  const [bytes] = await bucket.file(copy ? copy.path : currentPath(record.id)).download();
  const format = copy ? 'webp' : current ? current.format : 'png';
  await bucket.file(screen.screenCurrentPath(record.id)).save(bytes, {
    resumable: false,
    contentType: FORMATS[format].contentType,
    metadata: {
      cacheControl: LINK_CACHE,
      ...(format === 'svg' ? { contentDisposition: 'attachment' } : {}),
      metadata: { firebaseStorageDownloadTokens: record.linkToken },
    },
  });
}

module.exports = { planScreenBackfill, applyScreenBackfill };
