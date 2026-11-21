'use strict';

const fields = require('./fields');
const links = require('./links');
const model = require('./model');
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
 * before. Relationships aren't versioned things (§4).
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

  function entryRow(id, entry) {
    return {
      id,
      type: entry.type,
      name: entry.name,
      aliases: entry.aliases || [],
      primary: entry.primary === undefined ? null : entry.primary,
    };
  }

  async function listElements(uid, projectId, { type, retired } = {}) {
    await project(uid, projectId);
    if (type && !fields.TYPES.includes(type)) throw invalid(`There is no element type "${type}".`);
    if (retired) {
      let query = projectRef(projectId).collection('elements').where('retired', '==', true);
      if (type) query = query.where('type', '==', type);
      const snap = await query.limit(ELEMENTS_READ).get();
      return snap.docs
        .map((doc) => ({ ...entryRow(doc.id, doc.data()), retired: true }))
        .sort(byName);
    }
    const index = await loadIndex(projectId);
    return Object.keys(index.entries)
      .map((id) => entryRow(id, index.entries[id]))
      .filter((row) => !type || row.type === type)
      .sort(byName);
  }

  async function findElements(uid, projectId, query, { types, limit } = {}) {
    await project(uid, projectId);
    const index = await loadIndex(projectId);
    return links
      .search(index.entries, query, { limit: limit || 10, types })
      .map(({ score, ...row }) => {
        void score;
        return row;
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

  async function mentionedIn(projectId, index, id) {
    const snap = await projectRef(projectId)
      .collection('elements')
      .where('mentions', 'array-contains', id)
      .limit(MENTIONS_READ)
      .get();
    return snap.docs
      .filter((doc) => doc.id !== id && index.entries[doc.id])
      .map((doc) => ({ id: doc.id, name: doc.get('name'), type: doc.get('type') }))
      .sort(byName);
  }

  // An element in full: its texts, its fields by label, its photos, its
  // relationships from its side, what it links to and what links to it.
  async function detail(p, index, el) {
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
      photos: await photosOf(el),
      primary: el.primary || null,
      relationships: rels
        .map((rel) => sideRow(index, rel, el.id))
        .sort((a, b) => (a.other.name || '').localeCompare(b.other.name || '')),
      mentions: (el.mentions || []).map((id) => ({ id, name: name(id) })),
      mentionedIn: await mentionedIn(p.id, index, el.id),
      createdAt: iso(el.createdAt),
      updatedAt: iso(el.updatedAt),
    };
  }

  async function getElement(uid, projectId, id) {
    const p = await project(uid, projectId);
    const [index, el] = await Promise.all([loadIndex(projectId), element(projectId, id)]);
    return detail(p, index, el);
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

  // Changes an element's photo library: `change(photos)` gives the new one.
  function changePhotos(uid, projectId, id, change) {
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
    const live = await liveElements(projectId);
    const types = {};
    fields.TYPES.filter((t) => !type || t === type).forEach((t) => {
      types[t] = live
        .filter((el) => el.type === t)
        .map((el) => ({
          id: el.id,
          name: el.name,
          aliases: el.aliases || [],
          line: firstLine(el.bio),
        }))
        .sort(byName);
    });
    return {
      project: { id: p.id, title: p.title, short: p.short || '', summary: firstLine(p.summary) },
      types,
      ...(live.length >= ELEMENTS_READ ? { more: true } : {}),
    };
  }

  async function search(uid, projectId, query, { types, limit } = {}) {
    const p = await project(uid, projectId);
    const live = await liveElements(projectId);
    const found = searchText(live, query, { fields: p.fields, types, limit });
    return { ...found, ...(live.length >= ELEMENTS_READ ? { more: true } : {}) };
  }

  // What the bible says about a name: the element it best names, in full.
  async function lookup(uid, projectId, name) {
    const p = await project(uid, projectId);
    const index = await loadIndex(projectId);
    const found = links.search(index.entries, name, { limit: 6 });
    if (!found.length || !String(name || '').trim()) {
      throw new MuseError('not-found', `Nothing is called "${name}".`);
    }
    const [best, ...rest] = found;
    const el = await element(projectId, best.id);
    return {
      ...(best.matched ? { matched: best.matched } : {}),
      element: await detail(p, index, el),
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

  async function saveVersion(uid, projectId, elementId, name) {
    await project(uid, projectId);
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
