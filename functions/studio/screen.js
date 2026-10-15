'use strict';

/**
 * Screen-sized copies (planning/the-map-first-loom.md §3 A1, §4.3; L-727 /
 * #598): when the studio stores a version bigger than a screen, it also
 * stores a copy at most SCREEN_MAX px on its long side, as WebP (small, and it
 * keeps transparency). The Loom loads the copy first and the full image once
 * the camera zooms past it. The M2 trial's biggest maps are 5504 × 3072, so a
 * copy and the full image are enough: no tiles (A1).
 *
 *   studio/{imageId}/v{n}-screen.webp   a version's copy (never changes)
 *   studio/{imageId}/screen             the current version's copy, or the
 *                                       current version itself when it is
 *                                       small or SVG, under the image's link
 *                                       token, so its link never changes
 *
 * sharp is loaded only when a copy is made, so code that reads the library
 * without making images (the scripts) doesn't need it.
 */

const SCREEN_MAX = 2048;
const QUALITY = 82;

const screenVersionPath = (imageId, n) => `studio/${imageId}/v${n}-screen.webp`;
const screenCurrentPath = (imageId) => `studio/${imageId}/screen`;

/** Whether a file needs a copy: a raster image longer than SCREEN_MAX on a side. */
function needsCopy(file) {
  return file.format !== 'svg' && Math.max(file.width, file.height) > SCREEN_MAX;
}

/**
 * A file's screen-sized copy: { bytes, width, height, format: 'webp',
 * contentType }, or null when it needs none.
 */
async function screenCopy(file) {
  if (!needsCopy(file)) return null;
  const sharp = require('sharp');
  const { data, info } = await sharp(file.bytes)
    .resize(SCREEN_MAX, SCREEN_MAX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: data,
    width: info.width,
    height: info.height,
    format: 'webp',
    contentType: 'image/webp',
  };
}

/**
 * The link to an image's current screen copy, from its link (the same token
 * on the file beside it). Null for anything that isn't a library link.
 */
function screenLinkOf(link) {
  if (typeof link !== 'string') return null;
  const at = link.indexOf('%2Fcurrent?');
  if (at === -1 || link.indexOf('/o/studio%2F') === -1) return null;
  return link.slice(0, at) + '%2Fscreen?' + link.slice(at + '%2Fcurrent?'.length);
}

module.exports = {
  SCREEN_MAX,
  needsCopy,
  screenCopy,
  screenLinkOf,
  screenVersionPath,
  screenCurrentPath,
};
