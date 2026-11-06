'use strict';

/**
 * What a save has found of a map's hidden things (planning/maps-from-data.md
 * §3 DA3, §4.5; L-927 / #731), with nothing to require, so ./maps.js can
 * lay it over the map a save stands on.
 *
 * A map hides things two ways: its geometry's `hidden` list (`[{ id, dc? }]`,
 * any shape, door or object in it) and a hazard's own `hidden` setting (`true`
 * or `{ dc }`). A save's state of them is `save.secrets[mapId][key]`:
 *
 *   'found'    noticed or searched out: drawn and usable from then on
 *   'missed'   its passive check was rolled and failed: only Search finds it
 *
 * `key` is the thing's id, a hazard's with `hazard:` before it, so the two
 * can't meet. Nothing here is shared between saves: a thing found is found
 * for that save only.
 *
 *   keyOf(id, isHazard)    the key a thing is kept under
 *   statesOf(save, mapId)  a save's states on a map, `{ [key]: state }`
 *   foundIn(save, mapId)   the keys it has found
 *   reveal(map, save)      the map as the save sees it: what it has found no
 *                          longer hidden (the map itself when nothing is)
 *
 * Pure.
 */

const HAZARD = 'hazard:';
const STATES = Object.freeze(['found', 'missed']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The key a thing is kept under in a save's `secrets`. */
const keyOf = (id, isHazard = false) => (isHazard ? HAZARD + id : id);

/** A save's states of a map's hidden things, `{ [key]: 'found' | 'missed' }`. */
function statesOf(save, mapId) {
  const all = save && isObject(save.secrets) ? save.secrets[mapId] : null;
  return isObject(all) ? all : {};
}

/** The keys of what a save has found on a map. */
function foundIn(save, mapId) {
  const states = statesOf(save, mapId);
  return Object.keys(states).filter((key) => states[key] === 'found');
}

const idOf = (entry) => (typeof entry === 'string' ? entry : entry && entry.id);

// Revealed maps, kept so the same map found the same things is the same
// object (what is worked out from a map is kept by its geometry).
const revealed = new WeakMap();

/**
 * A map as a save sees it: every hidden thing it has found no longer hidden
 * (out of the geometry's `hidden` list, its hazard's `hidden` setting
 * dropped), so the rules and the page read it as shown. A map the save has
 * found nothing on is returned as it is.
 */
function reveal(map, save) {
  if (!map || !map.id) return map;
  const found = foundIn(save, map.id);
  if (!found.length) return map;
  const hidden = map.geometry && Array.isArray(map.geometry.hidden) ? map.geometry.hidden : [];
  const hazards = Array.isArray(map.hazards) ? map.hazards : [];
  const geometryHeld = hidden.some((h) => found.includes(idOf(h)));
  const hazardHeld = hazards.some((h) => h && h.hidden && found.includes(keyOf(h.id, true)));
  if (!geometryHeld && !hazardHeld) return map;
  const key = found.slice().sort().join('|');
  let kept = revealed.get(map);
  if (!kept) revealed.set(map, (kept = new Map()));
  if (kept.has(key)) return kept.get(key);
  const next = { ...map };
  if (geometryHeld) {
    next.geometry = {
      ...map.geometry,
      hidden: hidden.filter((h) => !found.includes(idOf(h))),
    };
  }
  if (hazardHeld) {
    next.hazards = hazards.map((h) => {
      if (!h || !h.hidden || !found.includes(keyOf(h.id, true))) return h;
      const shown = { ...h };
      delete shown.hidden;
      return shown;
    });
  }
  kept.set(key, next);
  return next;
}

module.exports = { HAZARD, STATES, keyOf, statesOf, foundIn, reveal };
