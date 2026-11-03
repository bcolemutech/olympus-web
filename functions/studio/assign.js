'use strict';

const { FieldValue } = require('firebase-admin/firestore');
const art = require('../loom-canon/art');
const catalog = require('../loom-canon/materials');
const loomCanon = require('../loom-canon');
const { LibraryError } = require('./library');
const { TARGETS, refOf } = require('./assign-targets');
const { FITS, fits, fitFile } = require('./fit');

/**
 * Assigning library images to worlds (planning/the-image-studio.md §4.4;
 * L-704 / #540). A world holds a reference to a library image (A1) for its
 * map, its cover, a town or a battle map, an object kind of its own or a
 * single object (./assign-targets.js; L-925).
 *
 * The kind must fit the target (L1). The world is changed through the
 * Cartographer's versioned writer, and the image's `usedIn` in the same
 * transaction, so "in use" (L5) never drifts. Replacing art drops the old
 * image's use; replacing older art (a Storage path, before L-705) deletes its
 * file, as replacing art always has.
 */

class AssignError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const OBJECT_ID = /^[A-Za-z0-9_-]{1,60}$/;

// Where a map's geometry is kept (maps-from-data.md GE5): a grid's in its
// battle map, as frames.geometryOf reads it, else on the map's doc.
function geometryHome(world, mapId) {
  if ((world.battleMaps || {})[mapId]) {
    return { collection: 'battleMaps', doc: world.battleMaps[mapId] };
  }
  if ((world.maps || {})[mapId]) return { collection: 'maps', doc: world.maps[mapId] };
  return null;
}

// An object kind or an object (L-925): what holds the art, and the art it has.
function objectHolderOf(world, target, id) {
  if (target === 'objectKind') {
    if (!OBJECT_ID.test(id)) {
      throw new AssignError(
        'invalid-argument',
        'An object kind is letters, digits, - and _ (60 at most): "chest", "ship-wheel".'
      );
    }
    const own = (world.objectKinds || {})[id] || {};
    const known = catalog.objectKind(id);
    return {
      name: own.name || (known && known.name) || id,
      previous: art.fromRef(own.art),
      own,
    };
  }
  const [mapId, objectId, extra] = String(id).split('/');
  if (!mapId || !OBJECT_ID.test(objectId || '') || extra !== undefined) {
    throw new AssignError(
      'invalid-argument',
      'Name the object as "<mapId>/<objectId>", the map it is on and its id there.'
    );
  }
  const home = geometryHome(world, mapId);
  if (!home || home.doc.retired) {
    throw new AssignError(
      'not-found',
      mapId.includes('__')
        ? `"${mapId}" is a template's copy for one place: give the art to the object on the template map.`
        : `No map "${mapId}" in this world.`
    );
  }
  const objects = (home.doc.geometry || {}).objects || [];
  const index = objects.findIndex((o) => o && o.id === objectId);
  if (index < 0) {
    throw new AssignError('not-found', `No object "${objectId}" on ${home.doc.name || mapId}.`);
  }
  const object = objects[index];
  const known = catalog.objectKind(object.kind);
  return {
    name: object.name || (known && known.name) || objectId,
    entity: object,
    previous: art.fromRef(object.art),
    home,
    index,
    mapId,
  };
}

// The thing art is for, and the art it holds now.
function holderOf(world, target, id) {
  if (target === 'objectKind' || target === 'object') return objectHolderOf(world, target, id);
  if (target === 'map') return { name: world.name, previous: art.worldMapArt(world) };
  if (target === 'cover') return { name: world.name, previous: art.coverArt(world) };
  if (target === 'town') {
    const settlement = world.locations[id];
    if (!settlement || settlement.retired) {
      throw new AssignError('not-found', `No place "${id}" in this world.`);
    }
    if ((settlement.geo || {}).kind !== 'settlement') {
      throw new AssignError(
        'failed-precondition',
        `${settlement.name} isn't a settlement, so it has no town.`
      );
    }
    return { name: settlement.name, entity: settlement, previous: art.townArt(settlement) };
  }
  const map = (world.battleMaps || {})[id];
  if (!map || map.retired) {
    throw new AssignError('not-found', `No battle map "${id}" in this world.`);
  }
  return { name: map.name, entity: map, previous: art.mapArt(map) };
}

/**
 * Whether art's shape fits what it is drawn on: a battle map's grid, or a
 * town's square (L-356's checks, for every way art arrives).
 */
function shapeWarnings(target, entity, size) {
  if (!size || !size.width || !size.height) return [];
  const aspect = size.width / size.height;
  if (target === 'battleMap') {
    const grid = entity.width / entity.height;
    if (Math.abs(aspect - grid) / grid > 0.02) {
      return [
        `Its shape (${size.width} × ${size.height}) isn't the grid's (${entity.width} × ` +
          `${entity.height}), so it is stretched to fit. Use viewBox="0 0 ${entity.width} ` +
          `${entity.height}" (for SVG) or an image of that shape to line cells up exactly.`,
      ];
    }
  } else if (target === 'object') {
    const feet = Array.isArray(entity.size) ? entity.size : null;
    if (feet && feet[0] > 0 && feet[1] > 0) {
      const shape = feet[0] / feet[1];
      if (Math.abs(aspect - shape) / shape > 0.05) {
        return [
          `Its shape (${size.width} × ${size.height}) isn't the object's (${feet[0]} × ${feet[1]} ` +
            'ft), so it is stretched to fit. Make it the same shape to keep it true.',
        ];
      }
    }
  } else if (target === 'town' && Math.abs(aspect - 1) > 0.02) {
    return [
      `It isn't square (${size.width} × ${size.height}): the town view fits it inside the ` +
        'town’s square, centred, and place positions are in that square. Use a square image ' +
        '(viewBox="0 0 1000 1000" for SVG) to line them up exactly.',
    ];
  }
  return [];
}

function createAssigner({ db, bucket, writer, library }) {
  const imageRef = (imageId) => db.collection('studio_images').doc(imageId);

  /**
   * Assigns an image (imageId) to a target, or takes it away (imageId null).
   * Returns { worldId, target, id, name, image, previous, warnings }.
   */
  /**
   * Art fitted to its target's shape (L-396): a battle map's grid or a town's
   * square, cropped or padded (./fit.js). The image gets a fitted version,
   * made current, and keeps its original as the one before; one used
   * elsewhere is copied instead, so its other uses keep their shape. Returns
   * the record to assign, and a note of what was done, or the record as it
   * was when nothing need change.
   */
  async function fitted(uid, record, { worldId, target, id, fit }) {
    if (!fit || fit === 'stretch' || (target !== 'battleMap' && target !== 'town')) {
      return { record };
    }
    const world = await loomCanon.loadWorld(worldId, { db, playableOnly: false });
    if (!world) throw new AssignError('not-found', 'No such world, or it is still importing.');
    const holder = holderOf(world, target, id);
    const shape =
      target === 'battleMap'
        ? { width: holder.entity.width, height: holder.entity.height }
        : { width: 1, height: 1 };
    const version = record.versions.find((v) => v.n === record.current);
    if (version.format === 'svg') {
      throw new AssignError(
        'failed-precondition',
        `"${record.title}" is SVG: give it the shape with its viewBox ` +
          `("0 0 ${shape.width} ${shape.height}") rather than fit.`
      );
    }
    if (fits(version, shape)) return { record };
    const file = await fitFile(
      {
        ...(await library.fileOf(record, record.current)),
        width: version.width,
        height: version.height,
      },
      shape,
      fit
    );
    const what = `${fit === 'crop' ? 'cropped' : 'padded'} to ${shape.width}:${shape.height}`;
    const elsewhere = (record.usedIn || []).some(
      (u) => !(u.worldId === worldId && u.target === target && u.id === id)
    );
    if (elsewhere) {
      const copy = await library.addImage({
        title: `${record.title} (${what})`.slice(0, 120),
        kind: record.kind,
        labels: record.labels || [],
        file,
        createdBy: uid,
        via: 'fit',
        source: { fittedFrom: record.id, version: record.current },
      });
      return { record: copy, note: `A copy ${what}: the original is used elsewhere, as it was.` };
    }
    const next = await library.addVersion(record.id, {
      file,
      createdBy: uid,
      via: 'fit',
      instruction: what,
    });
    return {
      record: next,
      note: `Version ${next.current}, ${what}; the original is version ${record.current}.`,
    };
  }

  async function assign(uid, { worldId, target, id, imageId, fit }) {
    if (fit !== undefined && fit !== null && !FITS.includes(fit)) {
      throw new AssignError('invalid-argument', `fit must be one of: ${FITS.join(', ')}.`);
    }
    const spec = TARGETS[target];
    if (!spec) {
      throw new AssignError(
        'invalid-argument',
        `The target must be one of: ${Object.keys(TARGETS).join(', ')}.`
      );
    }
    const at = target === 'map' || target === 'cover' ? worldId : id;
    if (typeof at !== 'string' || !at) {
      const which = {
        town: 'settlement',
        objectKind: 'object kind',
        object: 'object ("<mapId>/<objectId>")',
      };
      throw new AssignError('invalid-argument', `Say which ${which[target] || 'battle map'}.`);
    }
    let record = null;
    if (imageId) {
      try {
        record = await library.getImage(imageId);
      } catch (err) {
        if (err instanceof LibraryError) throw new AssignError(err.code, err.message);
        throw err;
      }
      if (record.kind !== spec.kind) {
        throw new AssignError(
          'failed-precondition',
          `"${record.title}" is a ${record.kind} image; ${spec.label} takes ${/^[aeiou]/i.test(spec.kind) ? 'an' : 'a'} ${spec.kind} image.`
        );
      }
    }
    // Fitted to its shape first, if asked (L-396).
    let fitNote = null;
    if (record && fit) {
      const done = await fitted(uid, record, { worldId, target, id: at, fit });
      record = done.record;
      fitNote = done.note || null;
    }
    const ref = record ? refOf(record) : null;
    const use = { worldId, target, id: at };

    const result = await writer.edit(worldId, uid, (e) => {
      const holder = holderOf(e.world, target, at);
      const previous = holder.previous;
      if (!ref && !previous) return { name: holder.name, previous: null, entity: holder.entity };
      if (previous && ref && previous.imageId === ref.imageId) {
        // The same image again: refresh its size, nothing else.
      } else {
        if (previous && previous.imageId) {
          e.update(imageRef(previous.imageId), { usedIn: FieldValue.arrayRemove(use) });
        }
        if (ref) e.update(imageRef(ref.imageId), { usedIn: FieldValue.arrayUnion(use) });
      }
      const value = ref || FieldValue.delete();
      if (target === 'map') {
        e.updateWorld({
          'map.image': value,
          // Older art goes with it (L-705 moves what is left).
          ...(previous && previous.path
            ? {
                'map.imagePath': FieldValue.delete(),
                'map.imageWidth': FieldValue.delete(),
                'map.imageHeight': FieldValue.delete(),
              }
            : {}),
        });
      } else if (target === 'cover') {
        e.updateWorld({ cover: value });
      } else if (target === 'town') {
        e.update(e.ref('locations', at), { 'town.image': value });
      } else if (target === 'objectKind') {
        // Taking the art away from a kind with nothing else of its own
        // takes the kind's entry with it.
        const kept = Object.keys(holder.own).filter((k) => k !== 'art');
        e.updateWorld(
          ref || kept.length
            ? { [`objectKinds.${at}.art`]: value }
            : { [`objectKinds.${at}`]: FieldValue.delete() }
        );
      } else if (target === 'object') {
        // The object's entry in its map's geometry, which is written whole:
        // a list can't be changed in place. Its map's revision moves (a
        // drawn map is cached by it).
        const objects = ((holder.home.doc.geometry || {}).objects || []).map((o, i) => {
          if (i !== holder.index) return o;
          const next = { ...o };
          if (ref) next.art = ref;
          else delete next.art;
          return next;
        });
        e.update(e.ref(holder.home.collection, holder.mapId), {
          'geometry.objects': objects,
          revision: (holder.home.doc.revision || 0) + 1,
        });
      } else {
        e.update(e.ref('battleMaps', at), { image: ref || null });
      }
      return { name: holder.name, previous, entity: holder.entity };
    });

    // Older art's file goes when it is replaced, as it always has.
    if (result.previous && result.previous.path) {
      await bucket
        .file(result.previous.path)
        .delete()
        .catch(() => {});
    }
    return {
      worldId,
      target,
      id: at,
      name: result.name,
      image: ref
        ? { imageId: ref.imageId, width: ref.width, height: ref.height, format: ref.format }
        : null,
      previous: result.previous
        ? result.previous.imageId
          ? { imageId: result.previous.imageId }
          : { path: result.previous.path }
        : null,
      // Stretched on purpose (fit: stretch) isn't warned about.
      warnings: ref && fit !== 'stretch' ? shapeWarnings(target, result.entity, ref) : [],
      ...(fitNote ? { fitted: fitNote } : {}),
    };
  }

  /**
   * Adds a file to the library and assigns it in one step (A3): the
   * Cartographer page's uploads and set_art. If assigning fails, the new
   * image is deleted again.
   */
  async function addAndAssign(uid, { worldId, target, id, file, via, labels, source, fit }) {
    if (!TARGETS[target]) throw new AssignError('invalid-argument', `Unknown target ${target}.`);
    // Check the target first, and name the image after it.
    const world = await loomCanon.loadWorld(worldId, { db, playableOnly: false });
    if (!world) throw new AssignError('not-found', 'No such world, or it is still importing.');
    const holder = holderOf(world, target, target === 'map' || target === 'cover' ? worldId : id);
    const record = await library.addImage({
      title: `${holder.name}: ${TARGETS[target].label}`,
      kind: TARGETS[target].kind,
      labels,
      file,
      createdBy: uid,
      via,
      source: { worldId, target, id: id || worldId, ...(source || {}) },
    });
    try {
      return await assign(uid, { worldId, target, id, imageId: record.id, fit });
    } catch (err) {
      await library.deleteImage(record.id).catch(() => {});
      throw err;
    }
  }

  return { assign, addAndAssign };
}

module.exports = { createAssigner, TARGETS, AssignError, refOf, shapeWarnings };
