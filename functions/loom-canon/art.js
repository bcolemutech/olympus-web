'use strict';

const { screenLinkOf } = require('../studio/screen');

/**
 * A world's art (planning/the-image-studio.md §4.4; L-704 / #540): its map, a
 * town's art, a battle map's art, and its cover. Art is a library image
 * (functions/studio/), held on the world as a reference:
 *
 *   { imageId, link, width, height, format }
 *
 * `link` serves the image's current version and never changes (the library's
 * stable link, §4.6), so reads need no second lookup; `width` and `height`
 * are the current version's, refreshed when another version is made current
 * (L-708). Art from before the library is a Storage path, readable until
 * L-705 moves it: { path, width, height, format } on towns and battle maps,
 * and `imagePath`, `imageWidth` and `imageHeight` on the world map.
 *
 * artOf(...) reads either into one shape:
 *   { imageId?, path?, url?, width, height, format }   or null
 * where a library image has `imageId` and `url` (its link), and older art its
 * `path`.
 */

function fromRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  if (ref.imageId) {
    return {
      imageId: ref.imageId,
      url: ref.link || null,
      width: ref.width || null,
      height: ref.height || null,
      format: ref.format || null,
    };
  }
  if (ref.path) {
    return {
      path: ref.path,
      width: ref.width || null,
      height: ref.height || null,
      format: ref.format || 'png',
    };
  }
  return null;
}

/** A town's art: its settlement's town.image. */
function townArt(settlement) {
  return fromRef(settlement && settlement.town && settlement.town.image);
}

/** A battle map's art. */
function mapArt(map) {
  return fromRef(map && map.image);
}

/** The world map's art: map.image, else the imported map.imagePath. */
function worldMapArt(world) {
  const map = (world && world.map) || {};
  const ref = fromRef(map.image);
  if (ref) return ref;
  if (!map.imagePath) return null;
  return {
    path: map.imagePath,
    width: map.imageWidth || null,
    height: map.imageHeight || null,
    format: 'png',
  };
}

/** The world's cover image (L-704): shown on the Loom's world list. */
function coverArt(world) {
  return fromRef(world && world.cover);
}

/**
 * What a player is given for art: the file only, never the record (A5). A
 * library image's link, or an older path the page turns into a URL.
 */
function forPlayer(art) {
  if (!art) return null;
  // A library image's screen-sized copy (L-727), which the Loom loads first.
  const screenUrl = art.url ? screenLinkOf(art.url) : null;
  return {
    ...(art.url ? { url: art.url } : { path: art.path }),
    ...(screenUrl ? { screenUrl } : {}),
    width: art.width,
    height: art.height,
  };
}

module.exports = { fromRef, townArt, mapArt, worldMapArt, coverArt, forPlayer };
