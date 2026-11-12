'use strict';

const { FieldValue } = require('firebase-admin/firestore');
const art = require('../loom-canon/art');
const catalog = require('../loom-canon/materials');
const loomCanon = require('../loom-canon');
const { LibraryError } = require('./library');
const { TARGETS, refOf } = require('./assign-targets');
const { FITS, fits, fitFile } = require('./fit');
const tokens = require('../loom-canon/tokens');
const { tokenRefOf, keptCrop } = require('./token-use');

/**
 * Assigning library images to worlds (planning/the-image-studio.md §4.4;
 * L-704 / #540). A world holds a reference to a library image (A1) for its
 * map, its cover, a town or a battle map, an object kind of its own or a
 * single object (./assign-targets.js; L-925), or as the token of a
 * character, a stat block or a group of figures, with its crop (L-931).
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

// A character, a stat block or a group of figures (L-931): what holds the
// token, and the token it has.
function tokenHolderOf(world, target, id) {
  const held = (entity, name) => ({
    name,
    entity,
    token: entity.token || null,
    previous: art.fromRef(entity.token),
  });
  if (target === 'character') {
    const c = (world.characters || {})[id];
    if (!c || c.retired) throw new AssignError('not-found', `No character "${id}" in this world.`);
    return held(c, c.name);
  }
  if (target === 'playerToken') {
    // A portrait offered to players (L-933): an entry in the world's list,
    // named by its image's id.
    const list = ((world.tokens || {}).player || []).filter(tokens.isToken);
    const index = list.findIndex((t) => t.imageId === id);
    const entry = index >= 0 ? list[index] : null;
    return {
      name: `${world.name}: player portraits`,
      token: entry,
      previous: art.fromRef(entry),
      list,
      index,
    };
  }
  if (target === 'statBlock') {
    const block = (world.statBlocks || {})[id];
    if (!block) {
      throw new AssignError('not-found', `No stat block "${id}" in this world (list_stat_blocks).`);
    }
    return held(block, block.name);
  }
  const [mapId, groupId, extra] = String(id).split('/');
  if (!mapId || !groupId || extra !== undefined) {
    throw new AssignError(
      'invalid-argument',
      'Name the figures as "<mapId>/<groupId>", the battle map and the group’s id there.'
    );
  }
  const map = (world.battleMaps || {})[mapId];
  if (!map || map.retired) {
    throw new AssignError(
      'not-found',
      mapId.includes('__')
        ? `"${mapId}" is a template's copy for one place: give the token to the figures on the template map.`
        : `No battle map "${mapId}" in this world.`
    );
  }
  const groups = map.figures || [];
  const index = groups.findIndex((g) => g && g.id === groupId);
  if (index < 0) {
    throw new AssignError('not-found', `No figures "${groupId}" on ${map.name || mapId}.`);
  }
  return { ...held(groups[index], groups[index].name || groupId), map, index };
}

// A world's own ground material (L-713): its entry, and the art it has.
function materialHolderOf(world, id) {
  const list = Array.isArray(world.materials) ? world.materials : [];
  const index = list.findIndex((m) => m && m.id === id);
  if (index < 0) {
    throw new AssignError(
      'not-found',
      `No material "${id}" of this world’s own (set_world_materials makes one).`
    );
  }
  return { name: list[index].name || id, previous: art.fromRef(list[index].art), list, index };
}

// The thing art is for, and the art it holds now.
function holderOf(world, target, id) {
  if (target === 'material') return materialHolderOf(world, id);
  if (target === 'objectKind' || target === 'object') return objectHolderOf(world, target, id);
  if (TARGETS[target] && TARGETS[target].token) return tokenHolderOf(world, target, id);
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

// A token written to its holder (L-931): a character's or a stat block's
// field, or a group's entry in its battle map's figures, which are written
// whole (a list can't be changed in place).
function writeToken(e, target, at, holder, ref) {
  const value = ref || FieldValue.delete();
  if (target === 'character') return e.update(e.ref('characters', at), { token: value });
  if (target === 'statBlock') return e.update(e.ref('statBlocks', at), { token: value });
  if (target === 'playerToken') {
    // The world's list of player portraits (L-933), written whole: a new one
    // goes at the end, a taken one keeps its place.
    const list = holder.list.slice();
    if (!ref) list.splice(holder.index, holder.index >= 0 ? 1 : 0);
    else if (holder.index >= 0) list[holder.index] = ref;
    else list.push(ref);
    return e.updateWorld({ 'tokens.player': list });
  }
  const groups = (holder.map.figures || []).map((g, i) => {
    if (i !== holder.index) return g;
    const next = { ...g };
    if (ref) next.token = ref;
    else delete next.token;
    return next;
  });
  return e.update(e.ref('battleMaps', holder.map.id), { figures: groups });
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

  async function assign(uid, { worldId, target, id, imageId, fit, crop }) {
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
    // A token's crop (L-931): only a token has one.
    if (crop !== undefined && crop !== null) {
      if (!spec.token) {
        throw new AssignError('invalid-argument', 'Only a token has a crop.');
      }
      const problems = tokens.validateCrop(crop);
      if (problems.length) throw new AssignError('invalid-argument', problems.join(' '));
    }
    // A player portrait is named by its image (L-933).
    const at =
      target === 'map' || target === 'cover'
        ? worldId
        : target === 'playerToken'
          ? id || imageId
          : id;
    if (target === 'playerToken' && imageId && at !== imageId) {
      throw new AssignError(
        'invalid-argument',
        "A player portrait is named by its image's id: leave id out, or give the same one."
      );
    }
    if (typeof at !== 'string' || !at) {
      const which = {
        town: 'settlement',
        objectKind: 'object kind',
        material: 'material',
        object: 'object ("<mapId>/<objectId>")',
        character: 'character',
        statBlock: 'stat block',
        figure: 'group of figures ("<mapId>/<groupId>")',
        playerToken: 'player portrait (its image id)',
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
      if (spec.kinds && !spec.kinds.includes(record.kind)) {
        throw new AssignError(
          'failed-precondition',
          `"${record.title}" is a ${record.kind} image; ${spec.label} takes a ${spec.kinds.join(' or ')} image.`
        );
      }
      if (!spec.kinds && record.kind !== spec.kind) {
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
    const plain = record ? refOf(record) : null;
    const use = { worldId, target, id: at };

    const result = await writer.edit(worldId, uid, (e) => {
      const holder = holderOf(e.world, target, at);
      const previous = holder.previous;
      // A token keeps its crop: the one given, else the one it had for the
      // same image (a new version made current re-assigns it; L-931).
      const ref =
        record && spec.token ? tokenRefOf(record, keptCrop(holder.token, record.id, crop)) : plain;
      if (!ref && !previous) {
        return { name: holder.name, previous: null, entity: holder.entity, ref: null };
      }
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
      } else if (target === 'material') {
        // The world's list, written whole (a list can't be changed in place).
        e.updateWorld({
          materials: holder.list.map((m, i) => {
            if (i !== holder.index) return m;
            const next = { ...m };
            if (ref) next.art = ref;
            else delete next.art;
            return next;
          }),
        });
      } else if (target === 'objectKind') {
        // Taking the art away from a kind with nothing else of its own
        // takes the kind's entry with it.
        const kept = Object.keys(holder.own).filter((k) => k !== 'art');
        e.updateWorld(
          ref || kept.length
            ? { [`objectKinds.${at}.art`]: value }
            : { [`objectKinds.${at}`]: FieldValue.delete() }
        );
      } else if (spec.token) {
        writeToken(e, target, at, holder, ref);
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
      return { name: holder.name, previous, entity: holder.entity, ref };
    });
    const ref = result.ref || null;

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
        ? {
            imageId: ref.imageId,
            width: ref.width,
            height: ref.height,
            format: ref.format,
            ...(spec.token ? { crop: tokens.cropOf(ref) } : {}),
          }
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
