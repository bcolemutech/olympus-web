'use strict';

const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const loomCanon = require('../loom-canon');
const { parseAzgaarExport, AzgaarFormatError } = require('./parse');
const { mapToCanon } = require('./map');
const { loadDraftWorld, newWorldId } = require('./load');
const { gradeWorld, gradeLocation, isPlayable } = require('../loom-canon/grading');
const { unplacedCharacters } = require('../loom-canon/positions');
const { ToolError } = require('../mcp/registry');
const { checkSvg } = require('./svg');

// Unplaced characters a publish refusal names before "and N more" (L-683).
const UNPLACED_SHOWN = 3;

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
//   world is playable (its starting location graded Playable, so players can
//   enter it), and publishes it — the Loom then lists and plays it.
//
// townImage(uid, { worldId, locationId, uploadId } | { worldId, locationId, remove })
//   A town's art (planning/the-loom-layered-worlds.md §8; L-347 / #416): reads
//   cartographer/{uid}/{uploadId}/town.png, checks it is a PNG, copies it to
//   worlds/{worldId}/town-{locationId}-{n}.png (a new name each time, so no
//   browser shows an old one) and records it on the settlement as
//   `town.image: { path, width, height }` through the shared, versioned write
//   layer (games see it on their next turn); then deletes the replaced image
//   and the upload. `remove` takes the art away.
//
// mapImage(uid, { worldId, mapId, uploadId } | { worldId, mapId, remove })
//   A battle map's art (L-355 / #417), the same way, from battlemap.png, as
//   the map's `image: { path, width, height }` (stretched to its grid).
//
// drawArt(uid, { worldId, of: 'battleMap' | 'town', id, svg })
//   SVG art Claude draws over MCP (set_art; L-356 / #431); svg null removes
//   it. Uploads may be SVG too (battlemap.svg, town.svg). SVG is checked
//   (./svg.js) and stored as image/svg+xml, with `format: 'svg'` on the image.
//
// worldCompletion({ worldIds })
//   How built each world is, for the Cartographer page: its places by grade
//   (planning/the-loom-layered-worlds.md §4, §6; L-323 / #392). Graded here
//   because the page would otherwise read every entity of every world.
//   (Until the MCP write tools exist, the Cartographer page supplies the hook
//   and starting location at publish time.)

const UPLOAD_ID = /^[A-Za-z0-9_-]{8,64}$/;
const ENTITY_ID = /^[A-Za-z0-9_-]{1,80}$/;
const WORLD_ID = /^[a-z0-9-]{1,64}$/;
const MAX_NAME = 100;
const MAX_HOOK = 2000;
const MAX_TAGLINE = 200;
const MAX_COMPLETION_WORLDS = 20;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Width and height from a PNG's IHDR chunk (the first 24 bytes), or null.
function pngDimensions(header) {
  if (!header || header.length < 24 || !header.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (header.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

// Why a place isn't Playable, for a refusal: "Burdendal: its description is
// still the imported text".
function whyClosed(world, locationId) {
  const reasons = gradeLocation(world, world.locations[locationId])
    .checklist.filter((item) => item.for === 'playable')
    .map((item) => item.message.charAt(0).toLowerCase() + item.message.slice(1, -1));
  return `${world.locations[locationId].name}: ${reasons.join('; ')}`;
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

function createCartographerService({ db, bucket, writer, now = () => Date.now() }) {
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
    } else if (!isPlayable(world, world.locations[start])) {
      // Players can only enter Playable places (Layered Worlds §5; L-322).
      problems.push(`a starting location players can enter (${whyClosed(world, start)})`);
    }
    // No text-only worlds (L-686): a world map, and every live location on it.
    const size = world.map || {};
    if (!(size.width > 0 && size.height > 0)) problems.push('a world map');
    const unmapped = Object.values(world.locations).filter(
      (l) => !l.retired && !(l.geo && Number.isFinite(l.geo.x) && Number.isFinite(l.geo.y))
    );
    if (unmapped.length) {
      problems.push(`coordinates for every location (${unmapped.length} without)`);
    }
    // Everyone has a place (L-683): a square, a town point or a world point.
    const unplaced = unplacedCharacters(world);
    if (unplaced.length) {
      const shown = unplaced
        .slice(0, UNPLACED_SHOWN)
        .map(({ character, problem }) => `${character.name}: ${problem}`);
      const more = unplaced.length - shown.length;
      problems.push(
        `a position for every character (${shown.join('; ')}` +
          `${more ? `; and ${more} more` : ''})`
      );
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

  async function worldCompletion({ worldIds } = {}) {
    if (
      !Array.isArray(worldIds) ||
      worldIds.length > MAX_COMPLETION_WORLDS ||
      !worldIds.every((id) => typeof id === 'string' && WORLD_ID.test(id))
    ) {
      throw new HttpsError(
        'invalid-argument',
        `worldIds must be up to ${MAX_COMPLETION_WORLDS} world ids.`
      );
    }
    const worlds = {};
    for (const id of new Set(worldIds)) {
      const world = await loomCanon.loadWorld(id, { db, playableOnly: false });
      const summary = world && gradeWorld(world);
      if (!summary || !summary.graded) continue;
      const { places } = summary;
      worlds[id] = {
        total: places.total,
        playable: places.playable + places.rich,
        rich: places.rich,
        share: places.open,
      };
    }
    return { worlds };
  }

  // Attaches, replaces or removes a piece of art (L-347, L-355): checks the
  // upload is a PNG, copies it beside the world's map image under a new name
  // (so no browser shows an old one), records it through the write layer, and
  // then deletes the replaced image and the upload. A refused attach leaves
  // no copy behind.
  //   kind: { file (upload name), label, name (for the path), place(e) → the
  //           entity, apply(e, entity, image | null) → its previous image }
  // Art is a PNG or (L-356) an SVG: from the upload folder (kind.file, or
  // the same name ending .svg), or as SVG text drawn over MCP (`svg`). SVG is
  // checked (./svg.js) and stored as image/svg+xml, to be downloaded, never
  // shown, if opened directly.
  async function attachArt(uid, { worldId, uploadId, remove, svg }, id, kind) {
    if (typeof worldId !== 'string' || !WORLD_ID.test(worldId)) {
      throw new HttpsError('invalid-argument', 'worldId is required.');
    }
    if (typeof id !== 'string' || !ENTITY_ID.test(id)) {
      throw new HttpsError('invalid-argument', `${kind.idField} is required.`);
    }
    const drawn = typeof svg === 'string';
    if (!remove && !drawn && (typeof uploadId !== 'string' || !UPLOAD_ID.test(uploadId))) {
      throw new HttpsError('invalid-argument', 'uploadId is required.');
    }

    let image = null;
    const pathFor = (ext) =>
      `worlds/${worldId}/${kind.name}-${id}-${now().toString(36)}${crypto
        .randomBytes(3)
        .toString('hex')}.${ext}`;
    const saveSvg = async (text) => {
      let checked;
      try {
        checked = checkSvg(text);
      } catch (err) {
        throw new HttpsError(
          'invalid-argument',
          `The ${kind.label} can't be used: ${err.message}.`
        );
      }
      image = { path: pathFor('svg'), width: checked.width, height: checked.height, format: 'svg' };
      await bucket.file(image.path).save(checked.svg, {
        contentType: 'image/svg+xml',
        metadata: { contentDisposition: 'attachment' },
      });
    };
    if (drawn) {
      await saveSvg(svg);
    } else if (!remove) {
      const svgUpload = uploadFile(uid, uploadId, kind.file.replace(/\.png$/, '.svg'));
      const pngUpload = uploadFile(uid, uploadId, kind.file);
      if ((await svgUpload.exists())[0]) {
        const [bytes] = await svgUpload.download();
        await saveSvg(bytes.toString('utf8'));
      } else {
        const [exists] = await pngUpload.exists();
        if (!exists) throw new HttpsError('not-found', `Upload the ${kind.label} first.`);
        const [header] = await pngUpload.download({ start: 0, end: 23 });
        const size = pngDimensions(header);
        if (!size) {
          throw new HttpsError('invalid-argument', `The ${kind.label} is not a valid PNG.`);
        }
        image = { path: pathFor('png'), ...size };
        await pngUpload.copy(bucket.file(image.path));
      }
    }

    let result;
    try {
      result = await writer.edit(worldId, uid, (e) => {
        const entity = kind.place(e.world, id);
        const previous = kind.apply(e, entity, image);
        return { name: entity.name, previous };
      });
    } catch (err) {
      if (image)
        await bucket
          .file(image.path)
          .delete()
          .catch(() => {});
      if (err instanceof HttpsError) throw err;
      // The write layer's own refusals (an unknown or uneditable world).
      if (err instanceof ToolError) throw new HttpsError('failed-precondition', err.message);
      throw err;
    }

    if (result.previous && (!image || result.previous.path !== image.path)) {
      await bucket
        .file(result.previous.path)
        .delete()
        .catch(() => {});
    }
    if (!remove && !drawn) {
      await bucket.deleteFiles({ prefix: `cartographer/${uid}/${uploadId}/` }).catch(() => {});
    }
    return {
      worldId,
      [kind.idField]: id,
      name: result.name,
      image: image
        ? { width: image.width, height: image.height, format: image.format || 'png' }
        : null,
    };
  }

  // A town's art, on its settlement as town.image (L-347).
  const TOWN_ART = {
    file: 'town.png',
    label: 'town image',
    name: 'town',
    idField: 'locationId',
    place(world, id) {
      const settlement = world.locations[id];
      if (!settlement || settlement.retired) {
        throw new HttpsError('not-found', 'No such place in this world.');
      }
      if ((settlement.geo || {}).kind !== 'settlement') {
        throw new HttpsError(
          'failed-precondition',
          `${settlement.name} isn't a settlement, so it has no town.`
        );
      }
      return settlement;
    },
    apply(e, settlement, image) {
      const previous = (settlement.town && settlement.town.image) || null;
      if (image || previous) {
        e.update(e.ref('locations', settlement.id), {
          'town.image': image || FieldValue.delete(),
        });
      }
      return previous;
    },
  };

  // A battle map's art, on the map as image (L-355), stretched to its grid.
  const MAP_ART = {
    file: 'battlemap.png',
    label: 'battle-map image',
    name: 'map',
    idField: 'mapId',
    place(world, id) {
      const map = (world.battleMaps || {})[id];
      if (!map || map.retired) {
        throw new HttpsError('not-found', 'No such battle map in this world.');
      }
      return map;
    },
    apply(e, map, image) {
      const previous = map.image || null;
      if (image || previous) e.update(e.ref('battleMaps', map.id), { image: image || null });
      return previous;
    },
  };

  const townImage = (uid, data = {}) => attachArt(uid, data, data.locationId, TOWN_ART);
  const mapImage = (uid, data = {}) => attachArt(uid, data, data.mapId, MAP_ART);

  // SVG art drawn over MCP (set_art, L-356): `svg` text, or null to remove.
  const drawArt = (uid, { worldId, of, id, svg }) =>
    attachArt(
      uid,
      { worldId, svg: svg === null ? undefined : svg, remove: svg === null },
      id,
      of === 'town' ? TOWN_ART : MAP_ART
    );

  return { importUpload, publishWorld, worldCompletion, townImage, mapImage, drawArt };
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

module.exports = { createCartographerService, requireCartographer, pngDimensions, whyClosed };
