'use strict';

/**
 * Templates (planning/map-levels.md §4.6, SC1, TM1–TM4; L-906 / #724):
 * ordinary places use a template of their kind and open at once.
 *
 * A template is a map marked `template: true`, with its places (and any maps
 * inside them), built like any map ("a barren moon", "a hamlet") and shared
 * read-only. A place uses one with `opens: { template: mapId }`
 * (assign_template, TM2).
 *
 * Each place that uses a template plays its own instance of it, made when the
 * world is loaded for play (./frames.js playWorld): the template's maps and
 * places copied with ids ending `__<placeId>` (the place's own: a moon's
 * surface `tpl_moon__pl_io`), its parent the place. So what a save keeps by
 * map and by place (doors, fog, discovered places, taken items) is kept per
 * place, as the rules already keep them, and two moons from one template
 * never share a door.
 *
 * Filling (TM1, TM4; decided with the user 2026-11-01: named slots): in a
 * template's names and descriptions, {place} is the using place's name and
 * {placeDescription} its description; a template place's fill tables,
 * `fill: { shop: ['a smithy', 'a chandler', …] }`, each roll one entry for
 * {shop}, seeded by the using place, the template place and the slot, so
 * each use differs and a given place is always the same.
 *
 * Pure.
 */

const SEP = '__';
const MAX_DEPTH = 8; // maps inside a template's places, at most this deep
const SLOT = /\{([a-zA-Z][a-zA-Z0-9_]{0,30})\}/g;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The instance id of a template's map or place for the place using it. */
const instanceId = (id, placeId) => id + SEP + placeId;

/** A 32-bit hash of a string (FNV-1a), for seeded rolls. */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** One entry of a list, picked by a seed: the same seed always the same one. */
function pick(seed, list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[hash(seed) % list.length];
}

/**
 * A template place's slots rolled for the place using it: `{ slot: entry }`,
 * seeded by the using place, the template place and the slot.
 */
function rollFill(usingPlaceId, templatePlaceId, fill) {
  const out = {};
  for (const [slot, list] of Object.entries(isObject(fill) ? fill : {})) {
    const entry = pick(usingPlaceId + '|' + templatePlaceId + '|' + slot, list);
    if (entry !== null && entry !== undefined) out[slot] = String(entry);
  }
  return out;
}

/** Text with its {slots} filled; a slot with no value is left as it is. */
function fillText(text, values) {
  if (typeof text !== 'string') return text;
  return text.replace(SLOT, (whole, slot) =>
    Object.prototype.hasOwnProperty.call(values, slot) ? values[slot] : whole
  );
}

/** Whether a map is a template. */
const isTemplate = (map) => Boolean(map && map.template);

/**
 * The world with every place that uses a template given its instance (in
 * place): `maps`, `mapPlaces` and `battleMaps` gain the copies, and the
 * place's `opens` names its instance (`{ mapId, template }`). Template maps
 * stay as they are, apart from the tree (no place opens them).
 */
function instantiate(world) {
  const maps = world.maps || {};
  const templates = Object.keys(maps).filter((id) => isTemplate(maps[id]));
  if (!templates.length) return world;
  const all = { ...(world.places || {}), ...(world.mapPlaces || {}) };
  const placesOn = (mapId) => Object.keys(all).filter((id) => all[id].mapId === mapId);
  const childrenOf = (mapId) =>
    Object.keys(maps).filter((id) => maps[id].parent && maps[id].parent.mapId === mapId);
  const newMaps = {};
  const newPlaces = {};
  const newGrids = {};
  const opened = {};

  // A template map and everything inside it, copied for the place using it.
  const copy = (mapId, usingId, using, parent, depth) => {
    const id = instanceId(mapId, usingId);
    const values = { place: using.name || usingId, placeDescription: using.description || '' };
    const map = maps[mapId];
    newMaps[id] = {
      ...map,
      template: undefined,
      instanceOf: mapId,
      instanceFor: usingId,
      parent,
      name: fillText(map.name, values),
    };
    delete newMaps[id].template;
    const grid = (world.battleMaps || {})[mapId];
    if (grid) newGrids[id] = { ...grid, id, name: fillText(grid.name || map.name, values) };
    const inside = new Set(placesOn(mapId));
    for (const placeId of inside) {
      const q = all[placeId];
      const rolled = { ...values, ...rollFill(usingId, placeId, q.fill) };
      const qid = instanceId(placeId, usingId);
      const doc = {
        ...q,
        id: qid,
        mapId: id,
        name: fillText(q.name, rolled),
        description: fillText(q.description, rolled),
        instanceOf: placeId,
        links: (q.links || [])
          .filter((l) => l && inside.has(l.placeId))
          .map((l) => ({ ...l, placeId: instanceId(l.placeId, usingId) })),
        exits: (q.exits || []).map((x) => ({ ...x })),
      };
      delete doc.fill;
      delete doc.opens;
      newPlaces[qid] = doc;
    }
    if (depth >= MAX_DEPTH) return id;
    for (const child of childrenOf(mapId)) {
      const opener = maps[child].parent.placeId;
      if (!inside.has(opener)) continue;
      const childId = copy(
        child,
        usingId,
        using,
        { mapId: id, placeId: instanceId(opener, usingId) },
        depth + 1
      );
      newPlaces[instanceId(opener, usingId)].opens = { mapId: childId };
    }
    return id;
  };

  for (const [placeId, place] of Object.entries(all)) {
    const t = isObject(place.opens) ? place.opens.template : null;
    if (!t || !isTemplate(maps[t]) || !place.mapId) continue;
    const id = copy(t, placeId, place, { mapId: place.mapId, placeId }, 0);
    opened[placeId] = { mapId: id, template: t };
  }

  world.maps = { ...maps, ...newMaps };
  world.battleMaps = { ...(world.battleMaps || {}), ...newGrids };
  const withOpens = (bag) =>
    Object.fromEntries(
      Object.entries(bag || {}).map(([id, p]) =>
        opened[id] ? [id, { ...p, opens: opened[id], templated: true }] : [id, p]
      )
    );
  world.places = withOpens(world.places);
  world.mapPlaces = { ...withOpens(world.mapPlaces), ...newPlaces };
  return world;
}

module.exports = { SEP, instanceId, hash, pick, rollFill, fillText, isTemplate, instantiate };
