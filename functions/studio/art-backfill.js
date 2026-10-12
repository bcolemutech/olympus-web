'use strict';

const crypto = require('crypto');
const { createLibrary, VIAS } = require('./library');
const { readImage } = require('./formats');
const { refOf, TARGETS } = require('./assign-targets');
const art = require('../loom-canon/art');

/**
 * Today's art into the library (planning/the-image-studio.md §3 S6; L-705 /
 * #541): every world map, town art and battle-map art still held as a
 * Storage path (from before L-704) becomes a library image, and the world
 * points at it, as L-704's assigning would have done.
 *
 *   planArtBackfill(world)  → the art still on a path: [{ target, id, name,
 *                             path, width, height, format }]
 *   applyArtBackfill(...)   → moves it, and says what it did
 *
 * - Each image is labelled with its world's id and where it came from ("town
 *   art"), with via 'backfill', and its source records the old path and the
 *   file's SHA-256.
 * - Art isn't duplicated: a file whose bytes are already in the library (the
 *   same art in several worlds, or a run cut short) reuses that image.
 * - It is idempotent: moved art is no longer a path, so a second run finds
 *   nothing to do.
 * - The world's writes go in batches, then one canonVersion bump, so every
 *   game reloads it; the old files are deleted only after that.
 *
 * No firebase-admin of its own: the caller passes `FieldValue`, so the
 * scripts (with their own firebase-admin) can use it, as they use
 * ../cartographer/backfill.js.
 */

const LABELS = { map: 'world map', town: 'town art', battleMap: 'battle-map art' };
const BATCH_SIZE = 400;

function planArtBackfill(world) {
  const items = [];
  const map = art.worldMapArt(world);
  if (map && map.path) items.push({ target: 'map', id: world.id, name: world.name, ...map });
  for (const location of Object.values(world.locations || {})) {
    const town = art.townArt(location);
    if (town && town.path) {
      items.push({ target: 'town', id: location.id, name: location.name, ...town });
    }
  }
  for (const battleMap of Object.values(world.battleMaps || {})) {
    const piece = art.mapArt(battleMap);
    if (piece && piece.path) {
      items.push({ target: 'battleMap', id: battleMap.id, name: battleMap.name, ...piece });
    }
  }
  return items;
}

/**
 * Moves one world's art into the library. With `apply` false it only checks
 * each file is there. Returns { moved: [{ target, id, name, path, imageId,
 * reused }], missing: [{ target, id, name, path }], canonVersion }.
 */
async function applyArtBackfill({ db, bucket, FieldValue, world, apply, now = () => Date.now() }) {
  if (!VIAS.includes('backfill')) throw new Error('the library has no backfill via');
  const items = planArtBackfill(world);
  const moved = [];
  const missing = [];
  const library = createLibrary({ db, bucket, now });
  const images = db.collection('studio_images');
  const worldRef = db.collection('loom_worlds').doc(world.id);

  const writes = []; // [ref, fields]
  const worldFields = {};
  for (const item of items) {
    const file = bucket.file(item.path);
    const [exists] = await file.exists();
    if (!exists) {
      missing.push({ target: item.target, id: item.id, name: item.name, path: item.path });
      continue;
    }
    if (!apply) {
      moved.push({ target: item.target, id: item.id, name: item.name, path: item.path });
      continue;
    }
    const [bytes] = await file.download();
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    // The same bytes already in the library: one image, used twice.
    const same = await images.where('source.sha256', '==', sha256).limit(1).get();
    let record;
    let reused = false;
    if (!same.empty) {
      record = same.docs[0].data();
      reused = true;
    } else {
      record = await library.addImage({
        title: `${item.name}: ${LABELS[item.target]}`,
        kind: TARGETS[item.target].kind,
        labels: [world.id, LABELS[item.target]],
        file: readImage(bytes),
        createdBy: 'backfill',
        via: 'backfill',
        source: { worldId: world.id, target: item.target, id: item.id, path: item.path, sha256 },
      });
    }
    const ref = refOf(record);
    const use = { worldId: world.id, target: item.target, id: item.id };
    writes.push([images.doc(record.id), { usedIn: FieldValue.arrayUnion(use) }]);
    if (item.target === 'map') {
      Object.assign(worldFields, {
        'map.image': ref,
        'map.imagePath': FieldValue.delete(),
        'map.imageWidth': FieldValue.delete(),
        'map.imageHeight': FieldValue.delete(),
      });
    } else if (item.target === 'town') {
      writes.push([worldRef.collection('locations').doc(item.id), { 'town.image': ref }]);
    } else {
      writes.push([worldRef.collection('battleMaps').doc(item.id), { image: ref }]);
    }
    moved.push({
      target: item.target,
      id: item.id,
      name: item.name,
      path: item.path,
      imageId: record.id,
      reused,
    });
  }

  if (!apply || !moved.length) return { moved, missing, canonVersion: null };
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const [ref, fields] of writes.slice(i, i + BATCH_SIZE)) batch.update(ref, fields);
    await batch.commit();
  }
  const canonVersion = await db.runTransaction(async (tx) => {
    const snap = await tx.get(worldRef);
    const next = (snap.data().canonVersion || 0) + 1;
    tx.update(worldRef, { ...worldFields, canonVersion: next, updatedAtMs: now() });
    return next;
  });
  // The old files go once the world points at the library.
  await Promise.all(
    moved.map((m) =>
      bucket
        .file(m.path)
        .delete()
        .catch(() => {})
    )
  );
  return { moved, missing, canonVersion };
}

module.exports = { planArtBackfill, applyArtBackfill, LABELS };
