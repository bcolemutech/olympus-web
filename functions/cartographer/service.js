'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const loomCanon = require('../loom-canon');
const { parseAzgaarExport, AzgaarFormatError } = require('./parse');
const { mapToCanon } = require('./map');
const { loadDraftWorld, newWorldId } = require('./load');
const { gradeWorld, gradeLocation, isPlayable, BANDS } = require('../loom-canon/grading');
const { biggestGaps } = require('../mcp/apps/cartographer/work');
const { unplacedCharacters } = require('../loom-canon/positions');
const { ToolError } = require('../mcp/registry');

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
//   (planning/the-loom-layered-worlds.md §4, §6; L-323 / #392), and its score
//   and band, counts by band for each kind, and its five biggest gaps
//   (planning/the-loom-grading.md §4.5; L-693 / #554). Graded here because
//   the page would otherwise read every entity of every world.
//   (Until the MCP write tools exist, the Cartographer page supplies the hook
//   and starting location at publish time.)

const UPLOAD_ID = /^[A-Za-z0-9_-]{8,64}$/;
const ENTITY_ID = /^[A-Za-z0-9_-]{1,80}$/;
const WORLD_ID = /^[a-z0-9-]{1,64}$/;
const MAX_NAME = 100;
const MAX_HOOK = 2000;
const MAX_TAGLINE = 200;
const MAX_COMPLETION_WORLDS = 20;
const GAPS_SHOWN = 5;
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

    // Optional rendered map image: checked by its header, then added to the
    // image studio's library and assigned as the world's map (L-704), once
    // the world exists. A file that isn't an image is skipped with a warning.
    const pngFile = uploadFile(uid, uploadId, 'map.png');
    const [pngExists] = await pngFile.exists();
    let mapImage = null;
    if (pngExists) {
      const [header] = await pngFile.download({ start: 0, end: 23 });
      if (pngDimensions(header)) {
        const { readImage } = require('../studio/formats');
        mapImage = readImage((await pngFile.download())[0]);
      } else {
        warnings.push({
          code: 'image_invalid',
          message: 'The map image is not a valid PNG and was skipped.',
          count: 1,
        });
      }
    }

    const result = await loadDraftWorld({
      db,
      mapped: { ...mapped, warnings },
      source: parsed.source,
      uploadedBy: uid,
      now,
      worldId,
    });

    let image = null;
    if (mapImage) {
      try {
        const assigned = await studio().addAndAssign(uid, {
          worldId: result.worldId,
          target: 'map',
          file: mapImage,
          via: 'upload',
        });
        image = { imageId: assigned.image.imageId, width: mapImage.width, height: mapImage.height };
      } catch (err) {
        throw asHttps(err);
      }
    }

    await bucket.deleteFiles({ prefix: `cartographer/${uid}/${uploadId}/` }).catch(() => {});
    return {
      worldId: result.worldId,
      name: mapped.canon.name,
      counts: result.counts,
      warnings: result.warnings,
      image,
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
      // Open places, and those Rich or better (the score's bands, L-691).
      const richer = places.rich + places.vivid + places.legendary;
      const bands = (counts) => Object.fromEntries(BANDS.map((band) => [band, counts[band] || 0]));
      worlds[id] = {
        total: places.total,
        playable: places.playable + richer,
        rich: richer,
        share: places.open,
        // The world's score and band, counts by band for each kind, and its
        // five biggest gaps, as list_work orders its score work (L-693).
        score: summary.score,
        band: summary.band,
        counts: {
          places: bands(places),
          inTown: bands(summary.inTown),
          characters: bands(summary.characters),
          battleMaps: bands(summary.battleMaps),
          factions: bands(summary.factions),
          regions: bands(summary.regions),
        },
        gaps: biggestGaps(world, GAPS_SHOWN),
      };
    }
    return { worlds };
  }

  // Art reaches a world through the image studio's library (L-704 / #540;
  // planning/the-image-studio.md §4.4, A3): an upload or an SVG Claude draws
  // becomes a library image, assigned to the town or battle map in one step.
  // The library keeps it (and every earlier image) for reuse; replacing art
  // only moves the world to the new image. Art from before the library is a
  // Storage path; replacing it deletes its file, as before.
  //
  // Art is a PNG, JPEG, WebP or SVG: from the upload folder (kind.file, or
  // the same name ending .svg), or SVG text drawn over MCP (`svg`). SVG is
  // checked (./svg.js) as every SVG is.
  const studio = () => {
    const { createLibrary } = require('../studio/library');
    const { createAssigner } = require('../studio/assign');
    const library = createLibrary({ db, bucket, now });
    return createAssigner({ db, bucket, writer, library });
  };

  // The assigner's and library's refusals, as the callables' errors.
  const asHttps = (err) => {
    if (err instanceof HttpsError) return err;
    if (err && typeof err.code === 'string' && err.message && !(err instanceof ToolError)) {
      const codes = ['invalid-argument', 'not-found', 'failed-precondition'];
      if (codes.includes(err.code)) return new HttpsError(err.code, err.message);
    }
    // The write layer's own refusals (an unknown or uneditable world).
    if (err instanceof ToolError) return new HttpsError('failed-precondition', err.message);
    return err;
  };

  async function attachArt(uid, { worldId, uploadId, remove, svg }, id, kind, via = 'page') {
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
    const { readImage } = require('../studio/formats');
    const read = (bytes) => {
      try {
        return readImage(bytes);
      } catch (err) {
        throw new HttpsError(
          'invalid-argument',
          `The ${kind.label} can't be used: ${err.message}.`
        );
      }
    };

    let file = null;
    if (drawn) {
      file = read(Buffer.from(svg, 'utf8'));
      if (file.format !== 'svg') {
        throw new HttpsError('invalid-argument', `The ${kind.label} can't be used: it is not SVG.`);
      }
    } else if (!remove) {
      const svgUpload = uploadFile(uid, uploadId, kind.file.replace(/\.png$/, '.svg'));
      const pngUpload = uploadFile(uid, uploadId, kind.file);
      const upload = (await svgUpload.exists())[0] ? svgUpload : pngUpload;
      if (!(await upload.exists())[0]) {
        throw new HttpsError('not-found', `Upload the ${kind.label} first.`);
      }
      file = read((await upload.download())[0]);
    }

    let result;
    try {
      result = file
        ? await studio().addAndAssign(uid, {
            worldId,
            target: kind.target,
            id,
            file,
            via: drawn ? 'mcp' : via,
          })
        : await studio().assign(uid, { worldId, target: kind.target, id, imageId: null });
    } catch (err) {
      throw asHttps(err);
    }
    if (!remove && !drawn) {
      await bucket.deleteFiles({ prefix: `cartographer/${uid}/${uploadId}/` }).catch(() => {});
    }
    return {
      worldId,
      [kind.idField]: id,
      name: result.name,
      image: result.image
        ? {
            imageId: result.image.imageId,
            width: result.image.width,
            height: result.image.height,
            format: result.image.format,
          }
        : null,
      ...(result.warnings.length ? { warnings: result.warnings } : {}),
    };
  }

  // A town's art, on its settlement as town.image (L-347).
  const TOWN_ART = {
    file: 'town.png',
    label: 'town image',
    target: 'town',
    idField: 'locationId',
  };

  // A battle map's art, on the map as image (L-355), stretched to its grid.
  const MAP_ART = {
    file: 'battlemap.png',
    label: 'battle-map image',
    target: 'battleMap',
    idField: 'mapId',
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

  // Using a library image for a world's map, cover, town or battle map, or
  // taking it away (imageId null): studio_assign and studio_unassign (L-704).
  async function assignImage(uid, { worldId, target, id, imageId } = {}) {
    if (typeof worldId !== 'string' || !WORLD_ID.test(worldId)) {
      throw new HttpsError('invalid-argument', 'worldId is required.');
    }
    try {
      return await studio().assign(uid, { worldId, target, id, imageId: imageId || null });
    } catch (err) {
      throw asHttps(err);
    }
  }

  return {
    importUpload,
    publishWorld,
    worldCompletion,
    townImage,
    mapImage,
    drawArt,
    assignImage,
  };
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
