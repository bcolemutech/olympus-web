'use strict';

/**
 * Patching a map's geometry by id (planning/maps-from-data.md §4.8; L-929 /
 * #733, #735 gap 17): the way Claude builds and edits a map over MCP without
 * resending it. A patch is `{ set: [{ id?, ...fields }], remove: [ids] }` on
 * one list of the geometry (./map-geometry.js: ground, lines, walls, doors,
 * windows, objects, zones, spawns, lights, notes, hidden):
 *
 *   - an id already on the list has just the fields given changed (a field
 *     set to null is taken away), so moving a door sends its id and its new
 *     ends; the rest of it stays;
 *   - an id the list hasn't is added, whole; an item with no id is added and
 *     given one (`wall-3`);
 *   - an id in `remove` is taken away, with its place in `hidden`.
 *
 * Everything is checked together against the map's bounds, and nothing comes
 * back changed if any part is refused. Only what the patch makes wrong is
 * reported, so a map with an old fault can still be edited. Ids are unique
 * across a map's shapes, since `hidden` and a door's wall name them.
 *
 *   patch(geometry, list, { set, remove }, bounds)
 *       { geometry, added, changed, removed } (the geometry as stored), or
 *       { problems } each naming what's wrong
 *   patchPoints(items, { set, remove })
 *       the same by id for a grid's features, entries or exits, which are
 *       fields of the map and not geometry: { items, added, changed, removed }
 *       or { problems }
 *
 * Pure.
 */

const geo = require('./map-geometry');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const copyOf = (v) => JSON.parse(JSON.stringify(v));
const idOf = (item) => (typeof item === 'string' ? item : item && item.id);

// What a list's items are called, for what is said of them.
const NAMES = {
  ground: 'ground',
  lines: 'line',
  walls: 'wall',
  doors: 'door',
  windows: 'window',
  objects: 'object',
  zones: 'zone',
  spawns: 'spawn',
  lights: 'light',
  notes: 'note',
  hidden: 'hidden thing',
};

// Merges `fields` over `item`: null takes a field away.
function merged(item, fields) {
  const out = { ...item };
  for (const k of Object.keys(fields)) {
    if (k === 'id') continue;
    if (fields[k] === null) delete out[k];
    else if (fields[k] !== undefined) out[k] = fields[k];
  }
  return out;
}

/**
 * The shared part of a patch over a list of `{ id }` items: `{ list, added
 * (ids, in the order given; an item given none stands for itself, `unnamed`),
 * changed, removed, problems }`. `taken`
 * says which other list an id belongs to, if it does.
 */
function apply(items, { set = [], remove = [] }, label, taken = () => null) {
  const problems = [];
  const list = items.map(copyOf);
  const at = (id) => list.findIndex((item) => idOf(item) === id);
  const added = [];
  const changed = [];
  const removed = [];
  const given = new Set();
  for (const item of set) {
    if (!isObject(item)) {
      problems.push(`Each ${label} to set must be an object with its fields.`);
      continue;
    }
    if (item.id === undefined) continue;
    if (given.has(item.id)) problems.push(`"${item.id}" is set twice.`);
    given.add(item.id);
  }
  for (const id of remove) {
    if (given.has(id)) {
      problems.push(`"${id}" is both set and removed.`);
      continue;
    }
    const i = at(id);
    if (i < 0) problems.push(`"${id}" isn't one of the map's ${label}s, so it can't be removed.`);
    else {
      list.splice(i, 1);
      removed.push(id);
    }
  }
  const unnamed = [];
  for (const item of set) {
    if (!isObject(item)) continue;
    if (item.id === undefined) {
      const whole = copyOf(item);
      list.push(whole);
      unnamed.push(whole);
      added.push(whole);
      continue;
    }
    const i = at(item.id);
    if (i >= 0) {
      list[i] = merged(list[i], item);
      changed.push(item.id);
      continue;
    }
    const other = taken(item.id);
    if (other) {
      problems.push(
        `"${item.id}" is already ${other}: ids are unique across a map's shapes, so name this one differently.`
      );
      continue;
    }
    list.push(copyOf(item));
    added.push(item.id);
  }
  return { list, added, unnamed, changed, removed, problems };
}

function patch(geometry, key, change, bounds, own) {
  if (!geo.LISTS.includes(key)) return { problems: [`"${key}" is no part of a map's geometry.`] };
  const stored = isObject(geometry) ? geometry : {};
  const label = NAMES[key];
  // Which list an id belongs to, for the others.
  const owner = {};
  for (const k of geo.LISTS) {
    if (k === 'hidden') continue;
    for (const item of stored[k] || []) if (idOf(item)) owner[idOf(item)] = k;
  }
  const an = (word) => (/^[aeiou]/i.test(word) ? 'an ' : 'a ') + word;
  const taken = (id) => (owner[id] && owner[id] !== key ? an(NAMES[owner[id]]) : null);
  const done = apply(stored[key] || [], change || {}, label, key === 'hidden' ? () => null : taken);
  const next = { ...stored, [key]: done.list };
  // A thing taken away is no longer hidden.
  const unhidden = [];
  if (key !== 'hidden' && done.removed.length && Array.isArray(stored.hidden)) {
    next.hidden = stored.hidden.filter((h) => {
      const gone = done.removed.includes(idOf(h));
      if (gone) unhidden.push(idOf(h));
      return !gone;
    });
  }
  if (done.problems.length) return { problems: done.problems };
  const after = geo.normalize(next);
  const was = geo.check(geo.normalize(stored), bounds, own);
  const problems = geo.check(after, bounds, own).filter((p) => !was.includes(p));
  if (problems.length) return { problems };
  // Ids given to what had none stand where they were given.
  const added = done.added.map((a) =>
    typeof a === 'string' ? a : (after[key] || [])[done.list.indexOf(a)].id
  );
  return {
    geometry: after,
    added,
    changed: done.changed,
    removed: done.removed,
    ...(unhidden.length ? { unhidden } : {}),
  };
}

function patchPoints(items, change, label = 'item') {
  const done = apply(items, change || {}, label);
  for (const item of done.unnamed) {
    done.problems.push(`A ${label} to add needs an id (${JSON.stringify(item).slice(0, 60)}).`);
  }
  if (done.problems.length) return { problems: done.problems };
  return { items: done.list, added: done.added, changed: done.changed, removed: done.removed };
}

module.exports = { NAMES, patch, patchPoints };
