'use strict';

const fields = require('./fields');
const links = require('./links');
const model = require('./model');
const classes = require('./classes');
const { createVersionStore } = require('./version-store');
const { searchText, plainText } = require('./search');

/**
 * The Muse's projects as the server reads and writes them (planning/the-muse.md
 * §3 MC1, MC2, EL5, MS5; M-106 / #894): the Muse connector's store, and the
 * museSearch callable's. Every call is its caller's: a project that isn't
 * theirs is treated exactly as one that isn't there.
 *
 * The writes are the page's own plans (./model.js, ./links.js, ./fields.js,
 * the same files as public/apps/muse/js/, byte for byte), done through the
 * Admin SDK in one batch each, so an element and its index line, and its
 * `mentions`, are always written together. A change to a project or an element
 * keeps a version of it first, in the same batch (./version-store.js `prepare`,
 * by `mcp`; VR1, MS5). Making something new keeps none: there was nothing
 * before. Relationships and classifications aren't versioned things (§4);
 * classes are (D9; M-201 / #914), as are an element's classes.
 *
 *   const store = createMuseStore({ db, FieldValue, images });
 *     images.get(id) → { id, title, kind, link } of a studio image, or null
 */

class MuseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MuseError';
    this.code = code;
  }
}

const invalid = (message) => new MuseError('invalid-argument', message);
const ID = links.ID;
const PROJECT_LIMITS = { title: 200, short: 300, summary: 200000, cover: 200 };
const MENTIONS_READ = 100;
const ELEMENTS_READ = 5000; // the most a search or an outline reads
const RELATIONSHIPS_READ = 1000;
const FIRST_LINE = 160;

const millis = (t) =>
  t && typeof t.toMillis === 'function' ? t.toMillis() : typeof t === 'number' ? t : null;
const iso = (t) => (millis(t) === null ? null : new Date(millis(t)).toISOString());
const byName = (a, b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1);

// A text's first line as a reader sees it, clipped.
function firstLine(markdown) {
  const para = String(markdown || '')
    .split(/\n\s*\n/)
    .map(plainText)
    .find((p) => p);
  if (!para) return '';
  return para.length > FIRST_LINE ? `${para.slice(0, FIRST_LINE - 1).trimEnd()}…` : para;
}

function createMuseStore({ db, FieldValue, images = { get: async () => null } }) {
  const versionStore = createVersionStore({ db, FieldValue });
  const projectRef = (projectId) => db.collection('muse_projects').doc(projectId);

  // A plan's sentinels as Firestore's: NOW the server's time, DELETE a key taken away.
  function toFirestore(value) {
    if (value && typeof value === 'object' && value.__muse === 'now') {
      return FieldValue.serverTimestamp();
    }
    if (value && typeof value === 'object' && value.__muse === 'delete') return FieldValue.delete();
    if (Array.isArray(value)) return value.map(toFirestore);
    if (value && typeof value === 'object' && value.constructor === Object) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toFirestore(v)]));
    }
    return value;
  }

  // Does a plan's writes in one batch.
  async function commit(writes) {
    const batch = db.batch();
    writes.forEach((write) => {
      const ref = db.doc(write.path);
      if (write.op === 'delete') batch.delete(ref);
      else if (write.op === 'set') batch.set(ref, toFirestore(write.data));
      else if (write.op === 'merge') batch.set(ref, toFirestore(write.data), { merge: true });
      else batch.update(ref, toFirestore(write.data));
    });
    await batch.commit();
  }

  // ── Reading ─────────────────────────────────────

  async function project(uid, projectId) {
    if (typeof projectId !== 'string' || !ID.test(projectId)) {
      throw new MuseError('not-found', 'Project not found.');
    }
    const snap = await projectRef(projectId).get();
    if (!snap.exists || snap.get('owner') !== uid) {
      throw new MuseError('not-found', 'Project not found.');
    }
    const data = snap.data();
    return { id: snap.id, ...data, fields: data.fields || {} };
  }

  async function loadIndex(projectId) {
    const snap = await projectRef(projectId).collection('index').get();
    return model.readIndex(snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })));
  }

  // A project's classifications and classes, as one tree (D4).
  async function loadTree(projectId) {
    const [kinds, all] = await Promise.all([
      projectRef(projectId).collection('classifications').get(),
      projectRef(projectId).collection('classes').get(),
    ]);
    const docs = (snap) => snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    return classes.readTree(docs(kinds), docs(all));
  }

  // A class's path, as the page shows it.
  const classRow = (tree, id) => ({
    id,
    path: classes.pathText(tree, id) || null,
    ...(tree.classes[id] ? {} : { missing: 'That class is no longer there.' }),
  });

  async function element(projectId, id) {
    if (typeof id !== 'string' || !ID.test(id)) {
      throw new MuseError('not-found', 'Element not found.');
    }
    const snap = await projectRef(projectId).collection('elements').doc(id).get();
    if (!snap.exists) throw new MuseError('not-found', 'Element not found.');
    return { id: snap.id, ...snap.data() };
  }

  // Every live element with its texts (for search and the outline).
  async function liveElements(projectId) {
    const snap = await projectRef(projectId)
      .collection('elements')
      .where('retired', '==', false)
      .limit(ELEMENTS_READ)
      .get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  const typeIn = (index) => (id) => (index.entries[id] ? index.entries[id].type : null);
  const nameIn = (index) => (id) => (index.entries[id] ? index.entries[id].name : null);

  // An element named by its id, or by a name or alias only it has, as an id.
  function refIn(index, value) {
    if (value === undefined || value === null || value === '') return value;
    const text = String(value).trim();
    if (index.entries[text]) return text;
    const folded = links.fold(text.replace(/\s+/g, ' '));
    const matches = Object.keys(index.entries).filter((id) => {
      const entry = index.entries[id];
      return [entry.name].concat(entry.aliases || []).some((term) => links.fold(term) === folded);
    });
    return matches.length === 1 ? matches[0] : text;
  }

  // ── Projects ────────────────────────────────────

  function projectRow(p) {
    return {
      id: p.id,
      title: p.title,
      short: p.short || '',
      cover: p.cover || null,
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
    };
  }

  async function checkProject(input, { creating } = {}) {
    const out = {};
    const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
    if (creating || has('title')) {
      out.title = String(input.title || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!out.title) throw invalid('A project needs a title.');
      if (out.title.length > PROJECT_LIMITS.title) {
        throw invalid(`A title is at most ${PROJECT_LIMITS.title} characters.`);
      }
    }
    if (has('short')) {
      out.short = String(input.short || '').trim();
      if (out.short.length > PROJECT_LIMITS.short) {
        throw invalid(`The short description is at most ${PROJECT_LIMITS.short} characters.`);
      }
    }
    if (has('summary')) {
      out.summary = String(input.summary || '');
      if (out.summary.length > PROJECT_LIMITS.summary) throw invalid('The summary is too long.');
    }
    if (has('cover')) {
      out.cover = String(input.cover || '').trim() || null;
      if (
        out.cover &&
        (out.cover.length > PROJECT_LIMITS.cover || !(await images.get(out.cover)))
      ) {
        throw invalid(`No image "${out.cover}" in the studio's library.`);
      }
    }
    return out;
  }

  async function listProjects(uid) {
    const snap = await db.collection('muse_projects').where('owner', '==', uid).get();
    return snap.docs
      .map((doc) => projectRow({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  async function getProject(uid, projectId) {
    const p = await project(uid, projectId);
    const index = await loadIndex(projectId);
    const counts = Object.fromEntries(fields.TYPES.map((t) => [t, 0]));
    Object.values(index.entries).forEach((entry) => {
      counts[entry.type] = (counts[entry.type] || 0) + 1;
    });
    return {
      ...projectRow(p),
      summary: p.summary || '',
      fields: Object.fromEntries(
        fields.TYPES.map((type) => [type, (p.fields[type] || []).map((def) => ({ ...def }))])
      ),
      counts,
    };
  }

  async function createProject(uid, input) {
    const checked = await checkProject(input, { creating: true });
    const ref = db.collection('muse_projects').doc();
    await ref.set({
      owner: uid,
      title: checked.title,
      short: checked.short || '',
      summary: checked.summary || '',
      cover: checked.cover || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return getProject(uid, ref.id);
  }

  // A change to the project's document, with a version of it first.
  async function writeProject(projectId, data) {
    const version = await versionStore.prepare(projectId, null, null, { by: 'mcp' });
    await commit(
      version.writes.concat([
        {
          op: 'update',
          path: `muse_projects/${projectId}`,
          data: { ...data, updatedAt: model.NOW },
        },
      ])
    );
    return { id: version.id, dropped: version.dropped };
  }

  async function updateProject(uid, projectId, input) {
    await project(uid, projectId);
    const checked = await checkProject(input);
    if (!Object.keys(checked).length) {
      throw invalid('Say what to change: title, short, summary or cover.');
    }
    const version = await writeProject(projectId, checked);
    return { project: await getProject(uid, projectId), version };
  }

  // Replaces one type's custom fields (EL2). A field given without a key is
  // new and gets one; a field left out is removed (its values stay on each
  // element until that element is next saved).
  async function setFields(uid, projectId, type, list) {
    const p = await project(uid, projectId);
    if (!fields.TYPES.includes(type)) throw invalid(`There is no element type "${type}".`);
    if (!Array.isArray(list)) throw invalid('Fields must be a list.');
    const before = p.fields[type] || [];
    const taken = before.map((def) => def.key).concat(list.map((def) => def && def.key));
    const keyed = list.map((def) => {
      if (!def || typeof def !== 'object') return def;
      if (def.key) {
        const had = before.find((old) => old.key === def.key);
        if (!had) throw invalid(`The ${type}s have no field with the key "${def.key}".`);
        if (had.kind !== def.kind) {
          throw invalid(`A field's kind can't change ("${had.label}" is ${had.kind}).`);
        }
        return def;
      }
      const key = fields.makeKey(def.label, taken);
      taken.push(key);
      return { ...def, key };
    });
    const checked = fields.checkDefinitions(keyed);
    if (checked.error) throw invalid(checked.error);
    const all = { ...p.fields };
    if (checked.value.length) all[type] = checked.value;
    else delete all[type];
    const version = await writeProject(projectId, { fields: all });
    return { type, fields: checked.value, version };
  }

  // ── Elements ────────────────────────────────────

  function entryRow(id, entry, tree) {
    return {
      id,
      type: entry.type,
      name: entry.name,
      aliases: entry.aliases || [],
      primary: entry.primary === undefined ? null : entry.primary,
      ...(tree && (entry.classes || []).length
        ? { classes: entry.classes.map((c) => classes.pathText(tree, c) || c) }
        : {}),
    };
  }

  // A class named by its id or path, as an id; refused when it isn't one.
  function classIn(tree, ref, type) {
    const found = classes.findClass(tree, ref, type);
    if (found.error) throw invalid(found.error);
    return found.value;
  }

  // The ids of the live elements in a class or beneath it (CL5).
  function inClass(tree, index, ref) {
    const id = classIn(tree, ref);
    return new Set(classes.membersOf(tree, index.entries, id));
  }

  async function listElements(uid, projectId, { type, retired, class: cls } = {}) {
    await project(uid, projectId);
    if (type && !fields.TYPES.includes(type)) throw invalid(`There is no element type "${type}".`);
    if (cls) {
      if (retired) throw invalid('A class lists live elements only.');
      const [index, tree] = await Promise.all([loadIndex(projectId), loadTree(projectId)]);
      const members = inClass(tree, index, cls);
      return [...members]
        .map((id) => entryRow(id, index.entries[id], tree))
        .filter((row) => !type || row.type === type)
        .sort(byName);
    }
    if (retired) {
      let query = projectRef(projectId).collection('elements').where('retired', '==', true);
      if (type) query = query.where('type', '==', type);
      const snap = await query.limit(ELEMENTS_READ).get();
      return snap.docs
        .map((doc) => ({ ...entryRow(doc.id, doc.data()), retired: true }))
        .sort(byName);
    }
    const [index, tree] = await Promise.all([loadIndex(projectId), loadTree(projectId)]);
    return Object.keys(index.entries)
      .map((id) => entryRow(id, index.entries[id], tree))
      .filter((row) => !type || row.type === type)
      .sort(byName);
  }

  // Names and aliases, as the page's box finds them; with `class`, only the
  // elements in it or beneath it (and with no query, all of them by name).
  async function findElements(uid, projectId, query, { types, limit, class: cls } = {}) {
    await project(uid, projectId);
    const [index, tree] = await Promise.all([loadIndex(projectId), loadTree(projectId)]);
    let entries = index.entries;
    if (cls) {
      const members = inClass(tree, index, cls);
      entries = Object.fromEntries([...members].map((id) => [id, index.entries[id]]));
    }
    return links
      .search(entries, query || '', { limit: limit || 10, types })
      .map(({ score, ...row }) => {
        void score;
        const classed = index.entries[row.id].classes || [];
        return classed.length
          ? { ...row, classes: classed.map((c) => classes.pathText(tree, c) || c) }
          : row;
      });
  }

  async function photosOf(el) {
    const out = [];
    for (const id of el.images || []) {
      const image = await images.get(id);
      out.push({
        id,
        title: image ? image.title : null,
        link: image ? image.link : null,
        primary: id === el.primary,
        ...(image ? {} : { missing: 'It is no longer in the studio.' }),
      });
    }
    return out;
  }

  async function relationshipsOf(projectId, id) {
    const snap = await projectRef(projectId)
      .collection('relationships')
      .where('ends', 'array-contains', id)
      .limit(RELATIONSHIPS_READ)
      .get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  function sideRow(index, rel, id) {
    const side = links.sideOf(rel, id);
    const other = index.entries[side.other];
    return {
      id: rel.id,
      kind: side.kind,
      other: other
        ? { id: side.other, name: other.name, type: other.type }
        : { id: side.other, retired: true },
      back: side.back,
      description: side.description,
    };
  }

  // The live elements, and the classes (D5), whose texts link to `id`.
  async function mentionedIn(projectId, index, id) {
    const [els, cls] = await Promise.all(
      ['elements', 'classes'].map((collection) =>
        projectRef(projectId)
          .collection(collection)
          .where('mentions', 'array-contains', id)
          .limit(MENTIONS_READ)
          .get()
      )
    );
    return els.docs
      .filter((doc) => doc.id !== id && index.entries[doc.id])
      .map((doc) => ({ id: doc.id, name: doc.get('name'), type: doc.get('type') }))
      .concat(
        cls.docs
          .filter((doc) => doc.id !== id)
          .map((doc) => ({ id: doc.id, name: doc.get('name'), type: 'class' }))
      )
      .sort(byName);
  }

  // What a text's links name: an element's or a class's name.
  const linkedName = (index, tree) => (id) =>
    index.entries[id] ? index.entries[id].name : tree.classes[id] ? tree.classes[id].name : null;

  // An element in full: its texts, its fields by label, its photos, its
  // relationships from its side, what it links to and what links to it.
  async function detail(p, index, el, tree) {
    const name = nameIn(index);
    const defs = p.fields[el.type] || [];
    const rels = await relationshipsOf(p.id, el.id);
    return {
      id: el.id,
      type: el.type,
      name: el.name,
      aliases: el.aliases || [],
      retired: !!el.retired,
      bio: el.bio || '',
      fields: defs.map((def) => {
        const value = el.fields && el.fields[def.key] !== undefined ? el.fields[def.key] : null;
        return {
          key: def.key,
          label: def.label,
          kind: def.kind,
          value,
          ...(value !== null && (def.kind === 'element' || def.kind === 'date')
            ? { shown: fields.format(def, value, { elementName: name }) }
            : {}),
        };
      }),
      ...(el.type === 'character'
        ? {
            appearance: el.appearance || '',
            residence: el.residence ? { id: el.residence, name: name(el.residence) || null } : null,
          }
        : {}),
      classes: (el.classes || []).map((id) => classRow(tree, id)),
      photos: await photosOf(el),
      primary: el.primary || null,
      relationships: rels
        .map((rel) => sideRow(index, rel, el.id))
        .sort((a, b) => (a.other.name || '').localeCompare(b.other.name || '')),
      mentions: (el.mentions || []).map((id) => ({ id, name: linkedName(index, tree)(id) })),
      mentionedIn: await mentionedIn(p.id, index, el.id),
      createdAt: iso(el.createdAt),
      updatedAt: iso(el.updatedAt),
    };
  }

  async function getElement(uid, projectId, id) {
    const p = await project(uid, projectId);
    const [index, el, tree] = await Promise.all([
      loadIndex(projectId),
      element(projectId, id),
      loadTree(projectId),
    ]);
    return detail(p, index, el, tree);
  }

  // Raw field values for a type, named by key or by label, as one map by key.
  function fieldsByKey(defs, given, index) {
    const out = {};
    Object.keys(given || {}).forEach((name) => {
      const folded = links.fold(name.trim());
      const def =
        defs.find((d) => d.key === name) || defs.find((d) => links.fold(d.label) === folded);
      if (!def) {
        throw invalid(
          defs.length
            ? `No field "${name}" here: it has ${defs.map((d) => `${d.label} (${d.key})`).join(', ')}.`
            : `No field "${name}": this type has no fields (set_fields adds them).`
        );
      }
      out[def.key] = def.kind === 'element' ? refIn(index, given[name]) : given[name];
    });
    return out;
  }

  // What a tool call gives, in the form model.checkElement takes.
  function elementInput(type, input, defs, index, current) {
    const out = {};
    ['name', 'aliases', 'bio', 'appearance'].forEach((key) => {
      if (input[key] !== undefined) out[key] = input[key];
    });
    if (input.residence !== undefined) out.residence = refIn(index, input.residence);
    if (input.fields !== undefined) {
      out.fields = {
        ...((current && current.fields) || {}),
        ...fieldsByKey(defs, input.fields, index),
      };
    }
    return out;
  }

  async function checkImages(ids) {
    for (const id of ids) {
      if (!(await images.get(id))) throw invalid(`No image "${id}" in the studio's library.`);
    }
  }

  async function createElement(uid, projectId, input) {
    const p = await project(uid, projectId);
    const index = await loadIndex(projectId);
    const type = input.type;
    if (!fields.TYPES.includes(type)) throw invalid(`There is no element type "${type}".`);
    const defs = p.fields[type] || [];
    const checked = model.checkElement(type, elementInput(type, input, defs, index), {
      defs,
      elementType: typeIn(index),
    });
    if (checked.error) throw invalid(checked.error);
    let value = checked.value;
    if (input.photos && input.photos.length) {
      const photos = model.checkPhotos({ images: input.photos, primary: input.primary || null });
      if (photos.error) throw invalid(photos.error);
      await checkImages(photos.value.images);
      value = { ...value, ...photos.value };
    }
    const id = projectRef(projectId).collection('elements').doc().id;
    const writes = model.planCreate(projectId, id, type, checked.value, index);
    if (input.classes && input.classes.length) {
      // Its classes go in the same document and index line as it is made.
      const tree = await loadTree(projectId);
      const held = classes.classify(
        tree,
        [],
        input.classes.map((ref) => classIn(tree, ref, type)),
        []
      );
      const ok = classes.checkClasses(tree, type, held);
      if (ok.error) throw invalid(ok.error);
      writes[0].data = { ...writes[0].data, classes: ok.value };
      writes[1].data.entries[id] = model.entryOf(writes[0].data);
    }
    if (value !== checked.value) {
      // The photos go in the same document and index line as it is made.
      writes[0].data = { ...writes[0].data, images: value.images, primary: value.primary };
      writes[1].data.entries[id] = model.entryOf(writes[0].data);
    }
    await commit(writes);
    return getElement(uid, projectId, id);
  }

  // A change to an element, as `plan(current, index)` makes it, with a
  // version of it first.
  async function changeElement(uid, projectId, id, plan) {
    const p = await project(uid, projectId);
    const [index, current] = await Promise.all([loadIndex(projectId), element(projectId, id)]);
    const writes = await plan(current, index, p);
    const version = await versionStore.prepare(projectId, 'elements', id, { by: 'mcp' });
    await commit(version.writes.concat(writes));
    return {
      element: await getElement(uid, projectId, id),
      version: { id: version.id, dropped: version.dropped },
    };
  }

  function updateElement(uid, projectId, id, input) {
    const keys = ['name', 'aliases', 'bio', 'fields', 'appearance', 'residence'];
    if (!keys.some((key) => input[key] !== undefined)) {
      throw invalid(`Say what to change: ${keys.join(', ')}.`);
    }
    return changeElement(uid, projectId, id, async (current, index, p) => {
      const defs = p.fields[current.type] || [];
      const checked = model.checkElement(
        current.type,
        elementInput(current.type, input, defs, index, current),
        { defs, elementType: typeIn(index), current }
      );
      if (checked.error) throw invalid(checked.error);
      return model.planUpdate(projectId, current, checked.value);
    });
  }

  function retireElement(uid, projectId, id, { restore } = {}) {
    return changeElement(uid, projectId, id, async (current) => {
      if (restore) {
        if (!current.retired) throw invalid('It isn’t retired.');
        return model.planRestore(projectId, current);
      }
      if (current.retired) throw invalid('It is already retired.');
      return model.planRetire(projectId, current);
    });
  }

  // Adds an element's classes and takes some off (CL2, D6): `add` and
  // `remove` name classes by id or path. A class added replaces one in its
  // line, and the other of a single classification.
  function classify(uid, projectId, id, { add = [], remove = [] } = {}) {
    if (!add.length && !remove.length) throw invalid('Say which classes to add or remove.');
    return changeElement(uid, projectId, id, async (current) => {
      const tree = await loadTree(projectId);
      const held = current.classes || [];
      const adding = add.map((ref) => classIn(tree, ref, current.type));
      const removing = remove.map((ref) => {
        const found = held.includes(String(ref)) ? String(ref) : classIn(tree, ref, current.type);
        if (!held.includes(found)) {
          throw invalid(`It isn’t in ${classes.pathText(tree, found) || found}.`);
        }
        return found;
      });
      const next = classes.classify(tree, held, adding, removing);
      const checked = classes.checkClasses(tree, current.type, next, held);
      if (checked.error) throw invalid(checked.error);
      return model.planUpdate(projectId, current, { classes: checked.value });
    });
  }

  // Changes the photo library of an element (`id`) or a class (`{ classId }`):
  // `change(photos)` gives the new one.
  function changePhotos(uid, projectId, id, change) {
    if (id && typeof id === 'object') {
      return changeClass(uid, projectId, id.classId, async (current, tree) => {
        const next = await change({ images: current.images, primary: current.primary });
        const checked = model.checkPhotos(next);
        if (checked.error) throw invalid(checked.error);
        return classes.planUpdateClass(projectId, tree, current.id, {}, checked.value);
      });
    }
    return changeElement(uid, projectId, id, async (current) => {
      const next = await change({ images: current.images || [], primary: current.primary || null });
      const checked = model.checkPhotos(next);
      if (checked.error) throw invalid(checked.error);
      return model.planUpdate(projectId, current, checked.value);
    });
  }

  function addPhotos(uid, projectId, id, imageIds, { primary } = {}) {
    if (!Array.isArray(imageIds) || !imageIds.length) throw invalid('Give the images to add.');
    return changePhotos(uid, projectId, id, async (photos) => {
      await checkImages(imageIds);
      const added = model.addPhotos(photos, imageIds);
      return primary ? model.primaryPhoto(added, imageIds[0]) : added;
    });
  }

  function removePhoto(uid, projectId, id, imageId) {
    return changePhotos(uid, projectId, id, async (photos) => {
      if (!photos.images.includes(imageId)) throw invalid('That image isn’t one of its photos.');
      return model.removePhoto(photos, imageId);
    });
  }

  function setPrimary(uid, projectId, id, imageId) {
    return changePhotos(uid, projectId, id, async (photos) => {
      if (!photos.images.includes(imageId)) {
        throw invalid('The primary must be one of its photos: add it first (add_photos).');
      }
      return model.primaryPhoto(photos, imageId);
    });
  }

  // ── Classifications and classes (M-201) ─────────

  // The elements of a type, live and retired, with their classes: those
  // making a classification single must leave none holding two (D6).
  async function holdersOf(projectId, index, type) {
    const retired = await projectRef(projectId)
      .collection('elements')
      .where('retired', '==', true)
      .where('type', '==', type)
      .limit(ELEMENTS_READ)
      .get();
    return Object.keys(index.entries)
      .filter((id) => index.entries[id].type === type)
      .map((id) => ({ id, name: index.entries[id].name, classes: index.entries[id].classes }))
      .concat(retired.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  }

  // Whether any element, live or retired, is in a class (CL7).
  async function classHeld(projectId, id) {
    const snap = await projectRef(projectId)
      .collection('elements')
      .where('classes', 'array-contains', id)
      .limit(1)
      .get();
    return !snap.empty;
  }

  // A classification named by its id, or by a name only one has (of `type`).
  function classificationIn(tree, ref, type) {
    const text = String(ref || '').trim();
    if (tree.classifications[text]) return text;
    const found = classes
      .classificationsOf(tree, type)
      .filter((c) => links.fold(c.name) === links.fold(text));
    if (found.length === 1) return found[0].id;
    throw invalid(
      found.length
        ? `More than one classification is called "${text}": give its id.`
        : `No classification "${text}".`
    );
  }

  // A classification's classes, nested, each with how many live elements are
  // in it (`in`) and in it or beneath it (`all`).
  function nested(tree, index, classificationId) {
    const holders = Object.values(index.entries);
    const direct = (id) => holders.filter((e) => (e.classes || []).includes(id)).length;
    const walk = (key) =>
      (tree.kids[key] || []).map((id) => {
        const c = tree.classes[id];
        return {
          id,
          name: c.name,
          in: direct(id),
          all: classes.membersOf(tree, index.entries, id).length,
          ...(tree.kids[id] ? { classes: walk(id) } : {}),
        };
      });
    return walk(classificationId);
  }

  function classificationRow(tree, index, c) {
    return {
      id: c.id,
      type: c.type,
      name: c.name,
      multiple: c.multiple,
      classes: nested(tree, index, c.id),
    };
  }

  async function listClassifications(uid, projectId, { type } = {}) {
    await project(uid, projectId);
    if (type && !fields.TYPES.includes(type)) throw invalid(`There is no element type "${type}".`);
    const [index, tree] = await Promise.all([loadIndex(projectId), loadTree(projectId)]);
    const out = {};
    fields.TYPES.filter((t) => !type || t === type).forEach((t) => {
      out[t] = classes.classificationsOf(tree, t).map((c) => classificationRow(tree, index, c));
    });
    return { types: out, classes: Object.keys(tree.classes).length };
  }

  async function createClassification(uid, projectId, input) {
    await project(uid, projectId);
    const tree = await loadTree(projectId);
    const id = projectRef(projectId).collection('classifications').doc().id;
    const plan = classes.planCreateClassification(projectId, id, input, tree);
    if (plan.error) throw invalid(plan.error);
    await commit(plan.value);
    classes.applyToTree(tree, plan.value);
    return classificationRow(tree, { entries: {} }, tree.classifications[id]);
  }

  async function updateClassification(uid, projectId, ref, input) {
    await project(uid, projectId);
    const [index, tree] = await Promise.all([loadIndex(projectId), loadTree(projectId)]);
    const id = classificationIn(tree, ref);
    const c = tree.classifications[id];
    const holders =
      input.multiple === false && c.multiple ? await holdersOf(projectId, index, c.type) : [];
    const plan = classes.planUpdateClassification(projectId, tree, id, input, holders);
    if (plan.error) throw invalid(plan.error);
    await commit(plan.value);
    classes.applyToTree(tree, plan.value);
    return classificationRow(tree, index, tree.classifications[id]);
  }

  async function deleteClassification(uid, projectId, ref) {
    await project(uid, projectId);
    const tree = await loadTree(projectId);
    const id = classificationIn(tree, ref);
    const plan = classes.planDeleteClassification(projectId, tree, id);
    if (plan.error) throw invalid(plan.error);
    await commit(plan.value);
    return { deleted: id };
  }

  // A class in full: its path, description, photos, subclasses, the live
  // elements in it and beneath it, and what links to it.
  async function classDetail(p, index, tree, id) {
    const c = tree.classes[id];
    const classification = tree.classifications[c.classification];
    const row = (eid) => ({
      id: eid,
      type: index.entries[eid].type,
      name: index.entries[eid].name,
      classes: (index.entries[eid].classes || []).map((x) => classes.pathText(tree, x) || x),
    });
    const all = classes.membersOf(tree, index.entries, id);
    const direct = all.filter((eid) => (index.entries[eid].classes || []).includes(id));
    const snap = await projectRef(p.id).collection('classes').doc(id).get();
    const stored = snap.exists ? snap.data() : {};
    return {
      id,
      name: c.name,
      classification: {
        id: classification.id,
        name: classification.name,
        type: classification.type,
        multiple: classification.multiple,
      },
      path: classes.pathText(tree, id),
      parents: classes
        .chain(tree, id)
        .slice(0, -1)
        .map((a) => ({ id: a.id, name: a.name })),
      depth: c.depth,
      description: c.description,
      photos: await photosOf(c),
      primary: c.primary,
      subclasses: classes.children(tree, c.classification, id).map((k) => ({
        id: k.id,
        name: k.name,
        all: classes.membersOf(tree, index.entries, k.id).length,
      })),
      elements: direct.map(row).sort(byName),
      beneath: all
        .filter((eid) => !direct.includes(eid))
        .map(row)
        .sort(byName),
      mentions: c.mentions.map((m) => ({ id: m, name: linkedName(index, tree)(m) })),
      mentionedIn: await mentionedIn(p.id, index, id),
      createdAt: iso(stored.createdAt),
      updatedAt: iso(stored.updatedAt),
    };
  }

  async function getClass(uid, projectId, ref) {
    const p = await project(uid, projectId);
    const [index, tree] = await Promise.all([loadIndex(projectId), loadTree(projectId)]);
    return classDetail(p, index, tree, classIn(tree, ref));
  }

  // Makes a class at the top of a classification, or beneath a class
  // (`parent`, by id or path).
  async function createClass(uid, projectId, input) {
    const p = await project(uid, projectId);
    const [index, tree] = await Promise.all([loadIndex(projectId), loadTree(projectId)]);
    const parent = input.parent ? classIn(tree, input.parent) : null;
    let classification = null;
    if (input.classification) {
      classification = classificationIn(tree, input.classification);
    } else if (!parent) {
      throw invalid('Say which classification it is in, or its parent class.');
    }
    const id = projectRef(projectId).collection('classes').doc().id;
    const plan = classes.planCreateClass(
      projectId,
      id,
      {
        classification: classification || undefined,
        parent,
        name: input.name,
        description: input.description,
      },
      tree
    );
    if (plan.error) throw invalid(plan.error);
    await commit(plan.value);
    classes.applyToTree(tree, plan.value);
    return classDetail(p, index, tree, id);
  }

  // A change to a class, as `plan(current, tree)` makes it, with a version
  // of it first (D9).
  async function changeClass(uid, projectId, ref, plan) {
    const p = await project(uid, projectId);
    const [index, tree] = await Promise.all([loadIndex(projectId), loadTree(projectId)]);
    const id = classIn(tree, ref);
    const made = await plan(tree.classes[id], tree);
    if (made.error) throw invalid(made.error);
    const version = await versionStore.prepare(projectId, 'classes', id, { by: 'mcp' });
    await commit(version.writes.concat(made.value));
    classes.applyToTree(tree, made.value);
    return {
      class: await classDetail(p, index, tree, id),
      version: { id: version.id, dropped: version.dropped },
    };
  }

  function updateClass(uid, projectId, ref, input) {
    const changes = {};
    ['name', 'description'].forEach((key) => {
      if (input[key] !== undefined) changes[key] = input[key];
    });
    if (!Object.keys(changes).length) throw invalid('Say what to change: name or description.');
    return changeClass(uid, projectId, ref, async (current, tree) =>
      classes.planUpdateClass(projectId, tree, current.id, changes)
    );
  }

  async function deleteClass(uid, projectId, ref) {
    await project(uid, projectId);
    const tree = await loadTree(projectId);
    const id = classIn(tree, ref);
    const path = classes.pathText(tree, id);
    const plan = classes.planDeleteClass(projectId, tree, id, await classHeld(projectId, id));
    if (plan.error) throw invalid(plan.error);
    await commit(plan.value);
    return { deleted: id, path };
  }

  // ── Relationships ───────────────────────────────

  async function listRelationships(uid, projectId, elementId) {
    await project(uid, projectId);
    const index = await loadIndex(projectId);
    if (elementId) {
      await element(projectId, elementId);
      return (await relationshipsOf(projectId, elementId)).map((rel) =>
        sideRow(index, rel, elementId)
      );
    }
    const snap = await projectRef(projectId)
      .collection('relationships')
      .limit(RELATIONSHIPS_READ)
      .get();
    return snap.docs.map((doc) => relationshipRow(index, doc.id, doc.data()));
  }

  function relationshipRow(index, id, rel) {
    const name = nameIn(index);
    return {
      id,
      a: { id: rel.a, name: name(rel.a) },
      b: { id: rel.b, name: name(rel.b) },
      aToB: rel.aToB,
      bToA: rel.bToA,
      description: rel.description || '',
    };
  }

  // Makes a relationship (no id) or changes one's words (its id; the ends are fixed).
  async function setRelationship(uid, projectId, input) {
    await project(uid, projectId);
    const index = await loadIndex(projectId);
    const a = refIn(index, input.a);
    const b = refIn(index, input.b);
    if (input.relationshipId) {
      const ref = projectRef(projectId)
        .collection('relationships')
        .doc(String(input.relationshipId));
      const snap = ID.test(String(input.relationshipId)) ? await ref.get() : { exists: false };
      if (!snap.exists) throw new MuseError('not-found', 'Relationship not found.');
      const rel = snap.data();
      if ((a && a !== rel.a) || (b && b !== rel.b)) {
        throw invalid('A relationship’s two elements are fixed: remove it and make another.');
      }
      const kinds = links.checkKinds({
        aToB: input.aToB === undefined ? rel.aToB : input.aToB,
        bToA: input.bToA === undefined ? rel.bToA : input.bToA,
        description: input.description === undefined ? rel.description : input.description,
      });
      if (kinds.error) throw invalid(kinds.error);
      await commit(links.planRelationshipUpdate(projectId, snap.id, kinds.value));
      return relationshipRow(index, snap.id, { ...rel, ...kinds.value });
    }
    const checked = links.checkRelationship({ ...input, a, b }, { elementType: typeIn(index) });
    if (checked.error) throw invalid(checked.error);
    const id = projectRef(projectId).collection('relationships').doc().id;
    await commit(links.planRelate(projectId, id, checked.value));
    return relationshipRow(index, id, checked.value);
  }

  async function removeRelationship(uid, projectId, relationshipId) {
    await project(uid, projectId);
    const ok = typeof relationshipId === 'string' && ID.test(relationshipId);
    const snap = ok
      ? await projectRef(projectId).collection('relationships').doc(relationshipId).get()
      : { exists: false };
    if (!snap.exists) throw new MuseError('not-found', 'Relationship not found.');
    await commit(links.planUnrelate(projectId, relationshipId));
    return { removed: relationshipId };
  }

  // ── Reading the bible ───────────────────────────

  // The project's elements by type, each with the first line of its bio.
  async function outline(uid, projectId, { type } = {}) {
    const p = await project(uid, projectId);
    if (type && !fields.TYPES.includes(type)) throw invalid(`There is no element type "${type}".`);
    const [live, tree] = await Promise.all([liveElements(projectId), loadTree(projectId)]);
    const types = {};
    fields.TYPES.filter((t) => !type || t === type).forEach((t) => {
      types[t] = live
        .filter((el) => el.type === t)
        .map((el) => ({
          id: el.id,
          name: el.name,
          aliases: el.aliases || [],
          ...((el.classes || []).length
            ? { classes: el.classes.map((c) => classes.pathText(tree, c) || c) }
            : {}),
          line: firstLine(el.bio),
        }))
        .sort(byName);
    });
    const classifications = {};
    fields.TYPES.filter((t) => !type || t === type).forEach((t) => {
      const list = classes.classificationsOf(tree, t).map((c) => ({
        id: c.id,
        name: c.name,
        multiple: c.multiple,
        classes: classes.flatten(tree, c.id).map((k) => classes.pathText(tree, k.id, true)),
      }));
      if (list.length) classifications[t] = list;
    });
    return {
      project: { id: p.id, title: p.title, short: p.short || '', summary: firstLine(p.summary) },
      types,
      ...(Object.keys(classifications).length ? { classifications } : {}),
      ...(live.length >= ELEMENTS_READ ? { more: true } : {}),
    };
  }

  async function search(uid, projectId, query, { types, limit } = {}) {
    const p = await project(uid, projectId);
    const [live, tree] = await Promise.all([liveElements(projectId), loadTree(projectId)]);
    // Classes are searched too, by name and description (M-201), unless
    // only some element types are asked for.
    const things =
      types && types.length
        ? live
        : live.concat(
            Object.values(tree.classes).map((c) => ({
              id: c.id,
              type: 'class',
              name: c.name,
              aliases: [],
              bio: c.description,
              primary: c.primary,
            }))
          );
    const found = searchText(things, query, { fields: p.fields, types, limit });
    found.results = found.results.map((row) =>
      row.type === 'class' ? { ...row, path: classes.pathText(tree, row.id) } : row
    );
    return { ...found, ...(live.length >= ELEMENTS_READ ? { more: true } : {}) };
  }

  // What the bible says about a name: the element it best names, in full.
  async function lookup(uid, projectId, name) {
    const p = await project(uid, projectId);
    const [index, tree] = await Promise.all([loadIndex(projectId), loadTree(projectId)]);
    const found = links.search({ ...classes.entriesOf(tree), ...index.entries }, name, {
      limit: 6,
    });
    if (!found.length || !String(name || '').trim()) {
      throw new MuseError('not-found', `Nothing is called "${name}".`);
    }
    const [best, ...rest] = found;
    const about =
      best.type === 'class'
        ? { class: await classDetail(p, index, tree, best.id) }
        : { element: await detail(p, index, await element(projectId, best.id), tree) };
    return {
      ...(best.matched ? { matched: best.matched } : {}),
      ...about,
      ...(rest.length
        ? {
            others: rest.map((row) => ({
              id: row.id,
              type: row.type,
              name: row.name,
              matched: row.matched,
            })),
          }
        : {}),
    };
  }

  // A version of an element, a class (`{ classId }`), or the project.
  async function saveVersion(uid, projectId, elementId, name) {
    await project(uid, projectId);
    if (elementId && typeof elementId === 'object') {
      const tree = await loadTree(projectId);
      const id = classIn(tree, elementId.classId);
      return versionStore.save(projectId, 'classes', id, { by: 'mcp', name });
    }
    if (elementId) await element(projectId, elementId);
    const kept = await versionStore.save(
      projectId,
      elementId ? 'elements' : null,
      elementId || null,
      { by: 'mcp', name }
    );
    return kept;
  }

  return {
    listProjects,
    getProject,
    createProject,
    updateProject,
    setFields,
    listElements,
    findElements,
    getElement,
    createElement,
    updateElement,
    retireElement,
    addPhotos,
    removePhoto,
    setPrimary,
    classify,
    listClassifications,
    createClassification,
    updateClassification,
    deleteClassification,
    getClass,
    createClass,
    updateClass,
    deleteClass,
    listRelationships,
    setRelationship,
    removeRelationship,
    outline,
    search,
    lookup,
    saveVersion,
  };
}

// The studio's record of an image as the store needs it, from studio_images.
function studioImages(db) {
  return {
    get: async (id) => {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) return null;
      const snap = await db.collection('studio_images').doc(id).get();
      if (!snap.exists) return null;
      const data = snap.data();
      return { id, title: data.title || '', kind: data.kind || null, link: data.link || null };
    },
  };
}

module.exports = { createMuseStore, studioImages, MuseError };
