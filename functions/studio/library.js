'use strict';

const crypto = require('crypto');
const { FORMATS } = require('./formats');
const screen = require('./screen');

/**
 * The image studio's library (planning/the-image-studio.md §4.2, §4.6; L-701 /
 * #537): one shared library of images for Cartographer editors, not tied to
 * any world.
 *
 *   studio_images/{imageId}
 *     title, kind (KINDS), labels[] (lower-case words), prompt, model, tier,
 *     styleId, from, references[], parentId,
 *     current (a version number),
 *     versions: [{ n, path, width, height, format, bytes, createdAt,
 *                  createdBy, via, instruction, cost,
 *                  screen: { path, width, height, format, bytes } | null }],
 *     usedIn: [{ worldId, target, id }]   (kept by assignment, L-704)
 *     link, createdBy, via, source, createdAt, updatedAt
 *
 * Files live at studio/{imageId}/v{n}.{ext}, and a version's file never
 * changes.
 *
 * Links (A6; the choice §4.6 left to this story): a Storage download token on
 * a stable copy. Every image has studio/{imageId}/current, a copy of its
 * current version, made with an unguessable download token when the image is
 * made. Its link is that file's download URL, so it needs no function to
 * serve. Making another version current copies that version over the same
 * file with the same token, so the link never changes. It is cached briefly
 * (LINK_CACHE), so a new current version shows within minutes.
 *
 * Screen-sized copies (L-727, ./screen.js): a version bigger than a screen
 * also gets a copy at most 2048 px long, and studio/{imageId}/screen holds the
 * current version's copy (or the version itself) under the same token, so
 * the screen link (screenLinkOf) never changes either.
 *
 * Every write is through the Admin SDK (rules let editors read only).
 */

const KINDS = Object.freeze([
  'worldMap',
  'regionMap',
  'town',
  'battleMap',
  'cover',
  'portrait',
  'token',
  'item',
  'scene',
  'interface',
  'other',
]);
// How an image came in; 'fit': cropped or padded to what it is drawn on (L-396).
const VIAS = Object.freeze(['page', 'mcp', 'upload', 'backfill', 'fit']);
const LINK_CACHE = 'public, max-age=300';
const MAX_TITLE = 120;
const MAX_LABELS = 20;
const MAX_LABEL = 40;
const LABEL = /^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u;

class LibraryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'invalid-argument', 'not-found', 'failed-precondition'
  }
}

/** Labels as the library keeps them: trimmed, lower-case, one space, no repeats. */
function normalizeLabels(labels) {
  if (labels === undefined || labels === null) return [];
  if (!Array.isArray(labels)) throw new LibraryError('invalid-argument', 'labels must be a list.');
  const out = [];
  for (const raw of labels) {
    if (typeof raw !== 'string') {
      throw new LibraryError('invalid-argument', 'Each label must be a word or two.');
    }
    const label = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!label) continue;
    if (label.length > MAX_LABEL || !LABEL.test(label)) {
      throw new LibraryError(
        'invalid-argument',
        `"${raw}" isn't a label: letters, digits, spaces, hyphens and apostrophes, up to ` +
          `${MAX_LABEL} characters.`
      );
    }
    if (!out.includes(label)) out.push(label);
  }
  if (out.length > MAX_LABELS) {
    throw new LibraryError('invalid-argument', `An image has at most ${MAX_LABELS} labels.`);
  }
  return out;
}

function checkTitle(title) {
  if (typeof title !== 'string' || !title.trim()) {
    throw new LibraryError('invalid-argument', 'An image needs a title.');
  }
  if (title.trim().length > MAX_TITLE) {
    throw new LibraryError('invalid-argument', `A title is at most ${MAX_TITLE} characters.`);
  }
  return title.trim();
}

function checkKind(kind) {
  if (!KINDS.includes(kind)) {
    throw new LibraryError('invalid-argument', `The kind must be one of: ${KINDS.join(', ')}.`);
  }
  return kind;
}

const versionPath = (imageId, n, format) => `studio/${imageId}/v${n}.${FORMATS[format].ext}`;
const currentPath = (imageId) => `studio/${imageId}/current`;

// Where download links point: the Storage emulator in tests, else Firebase.
function linkBase() {
  const emulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  return emulator
    ? `http://${emulator.replace(/^https?:\/\//, '')}`
    : 'https://firebasestorage.googleapis.com';
}

/** A short row for lists: no versions, no prompt text beyond a preview. */
function summary(id, data) {
  const version = (data.versions || []).find((v) => v.n === data.current) || {};
  return {
    id,
    title: data.title,
    kind: data.kind,
    labels: data.labels || [],
    current: data.current,
    versions: (data.versions || []).length,
    width: version.width || null,
    height: version.height || null,
    format: version.format || null,
    link: data.link,
    // Its screen-sized copy (L-727), for thumbnails.
    screenLink: screen.screenLinkOf(data.link),
    usedIn: (data.usedIn || []).length,
    styleId: data.styleId || null,
    createdBy: data.createdBy,
    via: data.via,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function createLibrary({ db, bucket, now = () => Date.now() }) {
  const images = () => db.collection('studio_images');

  function linked(path, token, file) {
    return bucket.file(path).save(file.bytes, {
      resumable: false,
      contentType: file.contentType,
      metadata: {
        cacheControl: LINK_CACHE,
        // SVG is stored as svg.js says: shown in an <img>, never opened as a page.
        ...(file.format === 'svg' ? { contentDisposition: 'attachment' } : {}),
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
  }

  /**
   * Makes `file` the image's current one: its link serves it, and its screen
   * link serves `copy` (its screen-sized copy), or the file itself.
   */
  async function writeCurrent(imageId, token, file, copy) {
    await linked(currentPath(imageId), token, file);
    await linked(screen.screenCurrentPath(imageId), token, copy || file);
  }

  // Stores a version's file, and its screen-sized copy when it needs one.
  async function saveVersion(imageId, n, file) {
    const path = versionPath(imageId, n, file.format);
    await bucket.file(path).save(file.bytes, {
      resumable: false,
      contentType: file.contentType,
      metadata: file.format === 'svg' ? { contentDisposition: 'attachment' } : {},
    });
    // A copy that can't be made (a file sharp can't read) costs only speed:
    // the Loom loads the full image instead.
    const copy = await screen.screenCopy(file).catch((err) => {
      console.warn(`No screen copy for ${path}: ${err.message}`);
      return null;
    });
    if (copy) {
      copy.path = screen.screenVersionPath(imageId, n);
      await bucket
        .file(copy.path)
        .save(copy.bytes, { resumable: false, contentType: copy.contentType });
    }
    return { path, copy };
  }

  function screenOf(copy) {
    return copy
      ? {
          path: copy.path,
          width: copy.width,
          height: copy.height,
          format: copy.format,
          bytes: copy.bytes.length,
        }
      : null;
  }

  function versionOf(n, path, file, fields, copy) {
    return {
      n,
      path,
      width: file.width,
      height: file.height,
      format: file.format,
      bytes: file.bytes.length,
      createdAt: now(),
      createdBy: fields.createdBy,
      via: fields.via,
      instruction: fields.instruction || null,
      cost: fields.cost === undefined ? null : fields.cost,
      screen: screenOf(copy),
    };
  }

  /**
   * Adds an image: its first version, its current copy and link, and its
   * record. `file` is what formats.readImage returns.
   */
  async function addImage(fields) {
    const title = checkTitle(fields.title);
    const kind = checkKind(fields.kind);
    const labels = normalizeLabels(fields.labels);
    if (!VIAS.includes(fields.via)) throw new LibraryError('invalid-argument', 'Unknown via.');
    if (typeof fields.createdBy !== 'string' || !fields.createdBy) {
      throw new LibraryError('invalid-argument', 'createdBy is required.');
    }
    const id = `img_${crypto.randomBytes(8).toString('hex')}`;
    const token = crypto.randomUUID();
    const { path, copy } = await saveVersion(id, 1, fields.file);
    await writeCurrent(id, token, fields.file, copy);
    const at = now();
    const record = {
      id,
      title,
      kind,
      labels,
      prompt: fields.prompt || null,
      model: fields.model || null,
      tier: fields.tier || null,
      styleId: fields.styleId || null,
      from: fields.from || null,
      references: fields.references || [],
      parentId: fields.parentId || null,
      current: 1,
      versions: [versionOf(1, path, fields.file, fields, copy)],
      usedIn: [],
      link: `${linkBase()}/v0/b/${bucket.name}/o/${encodeURIComponent(
        currentPath(id)
      )}?alt=media&token=${token}`,
      linkToken: token,
      createdBy: fields.createdBy,
      via: fields.via,
      source: fields.source || null,
      createdAt: at,
      updatedAt: at,
    };
    await images().doc(id).set(record);
    return record;
  }

  async function getImage(imageId) {
    const snap = await images().doc(String(imageId)).get();
    if (!snap.exists) throw new LibraryError('not-found', `No image "${imageId}" in the library.`);
    return snap.data();
  }

  async function fileOf(record, n) {
    const version = record.versions.find((v) => v.n === n);
    if (!version) {
      throw new LibraryError('not-found', `Image "${record.id}" has no version ${n}.`);
    }
    const [bytes] = await bucket.file(version.path).download();
    return { bytes, format: version.format, contentType: FORMATS[version.format].contentType };
  }

  // A version's screen-sized copy, as stored, or null when it has none.
  async function copyOf(record, n) {
    const version = record.versions.find((v) => v.n === n);
    if (!version || !version.screen) return null;
    const [bytes] = await bucket.file(version.screen.path).download();
    return { bytes, format: 'webp', contentType: 'image/webp' };
  }

  /**
   * Adds a version to an image (an edit, E2). It becomes current unless
   * `makeCurrent` is false.
   */
  async function addVersion(imageId, fields) {
    const record = await getImage(imageId);
    const n = Math.max(...record.versions.map((v) => v.n)) + 1;
    const { path, copy } = await saveVersion(record.id, n, fields.file);
    const version = versionOf(n, path, fields.file, fields, copy);
    const makeCurrent = fields.makeCurrent !== false;
    if (makeCurrent) await writeCurrent(record.id, record.linkToken, fields.file, copy);
    const update = {
      versions: record.versions.concat([version]),
      updatedAt: now(),
      ...(makeCurrent ? { current: n } : {}),
      ...(fields.styleId ? { styleId: fields.styleId } : {}),
    };
    await images().doc(record.id).update(update);
    return { ...record, ...update };
  }

  /** Makes a version current: the link serves it from now on. */
  async function setCurrent(imageId, n) {
    const record = await getImage(imageId);
    const file = await fileOf(record, n);
    await writeCurrent(record.id, record.linkToken, file, await copyOf(record, n));
    const update = { current: n, updatedAt: now() };
    await images().doc(record.id).update(update);
    return { ...record, ...update };
  }

  /**
   * Changes an image's title, kind or labels (L-703). A kind is fixed while a
   * world uses the image, since assigning checked it fits (L1).
   */
  async function updateImage(imageId, fields = {}) {
    const record = await getImage(imageId);
    const update = {};
    if (fields.title !== undefined) update.title = checkTitle(fields.title);
    if (fields.labels !== undefined) update.labels = normalizeLabels(fields.labels);
    if (fields.kind !== undefined && fields.kind !== record.kind) {
      update.kind = checkKind(fields.kind);
      const uses = record.usedIn || [];
      if (uses.length) {
        const where = uses.map((use) => `${use.worldId} (${use.target} ${use.id})`).join(', ');
        throw new LibraryError(
          'failed-precondition',
          `"${record.title}" is in use as a ${record.kind} image: ${where}. Unassign it before ` +
            'changing its kind.'
        );
      }
    }
    if (!Object.keys(update).length) return record;
    update.updatedAt = now();
    await images().doc(record.id).update(update);
    return { ...record, ...update };
  }

  /**
   * Searches the library (L3): filters (kind, labels — all of them, worldId
   * used in, styleId, createdBy, after and before dates) and words, each of
   * which must appear in the title, prompt or labels. Newest first, paged.
   * The library is read whole: it is one shared library of hundreds of
   * images, not millions.
   */
  async function search(query = {}) {
    const wanted = normalizeLabels(query.labels);
    const words = String(query.words || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (query.kind !== undefined) checkKind(query.kind);
    const snap = await images().get();
    const rows = snap.docs
      .map((doc) => doc.data())
      .filter((data) => {
        if (query.kind && data.kind !== query.kind) return false;
        if (wanted.some((label) => !(data.labels || []).includes(label))) return false;
        if (query.worldId && !(data.usedIn || []).some((use) => use.worldId === query.worldId)) {
          return false;
        }
        if (query.styleId && data.styleId !== query.styleId) return false;
        if (query.createdBy && data.createdBy !== query.createdBy) return false;
        if (Number.isFinite(query.after) && data.createdAt < query.after) return false;
        if (Number.isFinite(query.before) && data.createdAt >= query.before) return false;
        if (words.length) {
          const text = [data.title, data.prompt || '', (data.labels || []).join(' ')]
            .join(' ')
            .toLowerCase();
          if (words.some((word) => !text.includes(word))) return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
    const offset = Math.max(0, query.offset || 0);
    const limit = Math.max(1, Math.min(query.limit || 50, 200));
    const page = rows.slice(offset, offset + limit).map((data) => summary(data.id, data));
    return {
      total: rows.length,
      offset,
      count: page.length,
      images: page,
      ...(offset + page.length < rows.length ? { nextOffset: offset + page.length } : {}),
    };
  }

  /** The labels in use, with how many images carry each: most used first. */
  async function labels() {
    const counts = new Map();
    const snap = await images().get();
    for (const doc of snap.docs) {
      for (const label of doc.data().labels || []) {
        counts.set(label, (counts.get(label) || 0) + 1);
      }
    }
    return [...counts]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  /**
   * Deletes an image for good (L5), with every version's file and its link.
   * Refused while a world uses it. Cost records (L-706) are kept.
   */
  async function deleteImage(imageId) {
    const record = await getImage(imageId);
    const uses = record.usedIn || [];
    if (uses.length) {
      const where = uses.map((use) => `${use.worldId} (${use.target} ${use.id})`).join(', ');
      throw new LibraryError(
        'failed-precondition',
        `"${record.title}" is in use: ${where}. Unassign it first.`
      );
    }
    const paths = record.versions
      .flatMap((v) => [v.path].concat(v.screen ? [v.screen.path] : []))
      .concat([currentPath(record.id), screen.screenCurrentPath(record.id)]);
    await Promise.all(paths.map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
    await images().doc(record.id).delete();
    return { id: record.id, title: record.title };
  }

  return {
    addImage,
    addVersion,
    fileOf,
    setCurrent,
    updateImage,
    getImage,
    search,
    labels,
    deleteImage,
  };
}

module.exports = {
  createLibrary,
  normalizeLabels,
  summary,
  LibraryError,
  KINDS,
  VIAS,
  LINK_CACHE,
  versionPath,
  currentPath,
};
