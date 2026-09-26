'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const loomCanon = require('../loom-canon');
const { parseAzgaarExport, AzgaarFormatError } = require('./parse');
const { mapToCanon } = require('./map');
const { loadDraftWorld, newWorldId } = require('./load');

// The Cartographer's server side (design planning/the-cartographer-design.md
// §3.1, §3.4; C-5 / #372), behind the cartographerImport and
// cartographerPublish callables. Firestore and the Storage bucket are
// injected so tests can run it against the emulators.
//
// importUpload(uid, { uploadId, name })
//   Reads cartographer/{uid}/{uploadId}/map.json (+ optional map.png) from
//   Storage, runs parse → map → load, copies a valid PNG to
//   worlds/{worldId}/map.png, and deletes the upload.
//
// publishWorld(uid, { worldId, openingHook, startingLocationId, tagline })
//   Applies the given opening hook / starting location / tagline, checks the
//   world is playable, and publishes it — the Loom then lists and plays it.
//   (Until the MCP write tools exist, the Cartographer page supplies the hook
//   and starting location at publish time.)

const UPLOAD_ID = /^[A-Za-z0-9_-]{8,64}$/;
const WORLD_ID = /^[a-z0-9-]{1,64}$/;
const MAX_NAME = 100;
const MAX_HOOK = 2000;
const MAX_TAGLINE = 200;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Width and height from a PNG's IHDR chunk (the first 24 bytes), or null.
function pngDimensions(header) {
  if (!header || header.length < 24 || !header.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (header.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function optionalText(value, max, field) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${field} must be text.`);
  const text = value.trim();
  if (text.length > max) {
    throw new HttpsError('invalid-argument', `${field} must be ${max} characters or fewer.`);
  }
  return text;
}

function createCartographerService({ db, bucket, now = () => Date.now() }) {
  const uploadFile = (uid, uploadId, file) =>
    bucket.file(`cartographer/${uid}/${uploadId}/${file}`);

  async function importUpload(uid, { uploadId, name } = {}) {
    if (typeof uploadId !== 'string' || !UPLOAD_ID.test(uploadId)) {
      throw new HttpsError('invalid-argument', 'A valid uploadId is required.');
    }
    const worldName = optionalText(name, MAX_NAME, 'name');

    const jsonFile = uploadFile(uid, uploadId, 'map.json');
    const [jsonExists] = await jsonFile.exists();
    if (!jsonExists) throw new HttpsError('not-found', 'Upload not found. Upload the map again.');
    const [raw] = await jsonFile.download();

    let parsed;
    try {
      parsed = parseAzgaarExport(raw);
    } catch (err) {
      if (err instanceof AzgaarFormatError) throw new HttpsError('invalid-argument', err.message);
      throw err;
    }
    const mapped = mapToCanon(parsed, { name: worldName });
    const worldId = newWorldId(mapped.canon.name);
    const warnings = [...mapped.warnings];

    // Optional rendered map image: validated by its PNG header, then copied to
    // the world's permanent location before the world is created.
    const pngFile = uploadFile(uid, uploadId, 'map.png');
    const [pngExists] = await pngFile.exists();
    let imagePath = null;
    if (pngExists) {
      const [header] = await pngFile.download({ start: 0, end: 23 });
      const size = pngDimensions(header);
      if (size) {
        imagePath = `worlds/${worldId}/map.png`;
        await pngFile.copy(bucket.file(imagePath));
        mapped.canon.map = {
          ...mapped.canon.map,
          imagePath,
          imageWidth: size.width,
          imageHeight: size.height,
        };
      } else {
        warnings.push({
          code: 'image_invalid',
          message: 'The map image is not a valid PNG and was skipped.',
          count: 1,
        });
      }
    }

    let result;
    try {
      result = await loadDraftWorld({
        db,
        mapped: { ...mapped, warnings },
        source: parsed.source,
        uploadedBy: uid,
        now,
        worldId,
      });
    } catch (err) {
      if (imagePath)
        await bucket
          .file(imagePath)
          .delete()
          .catch(() => {});
      throw err;
    }

    await bucket.deleteFiles({ prefix: `cartographer/${uid}/${uploadId}/` }).catch(() => {});
    return {
      worldId: result.worldId,
      name: mapped.canon.name,
      counts: result.counts,
      warnings: result.warnings,
      image: imagePath
        ? { width: mapped.canon.map.imageWidth, height: mapped.canon.map.imageHeight }
        : null,
    };
  }

  async function publishWorld(uid, { worldId, openingHook, startingLocationId, tagline } = {}) {
    if (typeof worldId !== 'string' || !WORLD_ID.test(worldId)) {
      throw new HttpsError('invalid-argument', 'A valid worldId is required.');
    }
    const hook = optionalText(openingHook, MAX_HOOK, 'openingHook');
    const tag = optionalText(tagline, MAX_TAGLINE, 'tagline');
    if (startingLocationId !== undefined && typeof startingLocationId !== 'string') {
      throw new HttpsError('invalid-argument', 'startingLocationId must be text.');
    }

    const worldRef = db.collection(loomCanon.WORLDS_COLLECTION).doc(worldId);
    const snap = await worldRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'World not found.');
    const meta = snap.data();
    if (meta.status !== 'draft') {
      throw new HttpsError(
        'failed-precondition',
        `Only a draft can be published (this world is ${meta.status}).`
      );
    }

    // Playability checks against the world as it will be published.
    const world = await loomCanon.loadWorld(worldId, { db, playableOnly: false });
    const finalHook = hook !== undefined ? hook : meta.openingHook || '';
    const start =
      startingLocationId !== undefined ? startingLocationId : (meta.rules || {}).startingLocationId;
    const problems = [];
    if (!finalHook) problems.push('an opening hook');
    if (!start || !world.locations[start] || world.locations[start].retired) {
      problems.push('a starting location that exists in this world');
    }
    const broken = Object.values(world.locations).filter((l) =>
      (l.connections || []).some((id) => !world.locations[id])
    );
    if (broken.length)
      problems.push(`valid connections (${broken.length} location(s) point nowhere)`);
    if (problems.length) {
      throw new HttpsError(
        'failed-precondition',
        `Not ready to publish. It needs ${problems.join(', ')}.`
      );
    }

    // Publish atomically, and only if nobody else changed its status meanwhile.
    await db.runTransaction(async (tx) => {
      const current = await tx.get(worldRef);
      if (current.data().status !== 'draft') {
        throw new HttpsError(
          'failed-precondition',
          'This world was published or changed meanwhile.'
        );
      }
      tx.update(worldRef, {
        status: 'published',
        openingHook: finalHook,
        ...(tag !== undefined ? { tagline: tag } : {}),
        rules: { ...(current.data().rules || {}), startingLocationId: start },
        canonVersion: (current.data().canonVersion || 0) + 1,
        publishedAtMs: now(),
        publishedBy: uid,
        updatedAtMs: now(),
      });
    });
    return { worldId, status: 'published' };
  }

  return { importUpload, publishWorld };
}

function requireCartographer(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  const apps = request.auth.token && request.auth.token.apps;
  if (!Array.isArray(apps) || !apps.includes('cartographer')) {
    throw new HttpsError('permission-denied', 'You do not have access to the Cartographer.');
  }
  return request.auth.uid;
}

module.exports = { createCartographerService, requireCartographer, pngDimensions };
