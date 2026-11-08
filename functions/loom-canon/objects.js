'use strict';

/**
 * An object's rules (planning/maps-from-data.md §3 RD3, §4.4; L-926 /
 * #730): the things on a map you can use. An object is an item of its
 * geometry (./map-geometry.js: `objects`), with its settings:
 *
 *   name, description, cardArt   what it is called, what it looks like to the
 *                                GM and on its card
 *   container                    { contents?, search? } it holds what it
 *                                describes (items once L-770 lands); `search`
 *                                makes opening it a search (a bookshelf)
 *   locked, unlocks, difficulty  it starts locked; `unlocks` { key?, action? }
 *                                what opens it (an item the character carries,
 *                                or an object's id, or "id.action": using that
 *                                unlocks it, a lever elsewhere); else it is
 *                                picked or forced, rolled against `difficulty`
 *   ap, long                     its own cost in AP, and a long action's
 *                                (picking the lock, over turns)
 *   actions                      [{ id, name?, ap?, long?, text? }] its own: a
 *                                lever's Pull
 *
 * A save keeps each such object's state (`save.objects[mapId][id]`: 'closed',
 * 'open' or 'locked'), as it keeps its doors'.
 *
 *   usableOf(map)            the objects there is something to do with (never decor, L-945)
 *   objectOf(map, id)        one by id, or null
 *   stateOf(object, states)  the save's state, else its own, else null
 *   intent(object, action)   what a proposed action is: { act, action? }
 *   actionsOf(object, state, { hasKey })   what the click menu offers
 *   squaresOf(map, object)   the grid squares it covers
 *   unlockedBy(map, id, actionId)          what using it unlocks
 *   forPlayer(item)          the item as the page is sent it (no secrets)
 *
 * Pure.
 */

const geo = require('./map-geometry');
const materials = require('./materials');
const mapPaths = require('./map-paths');

const FEET = mapPaths.FEET;
const STATES = Object.freeze(['closed', 'open', 'locked']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const hiddenIds = (geometry) =>
  new Set(
    ((geometry && geometry.hidden) || [])
      .map((h) => (typeof h === 'string' ? h : h && h.id))
      .filter(Boolean)
  );

/** Every object of a map's geometry that isn't hidden (L-927 finds those). */
function allOf(map) {
  const g = mapPaths.geometryOf(map);
  const hidden = hiddenIds(g);
  return (g.objects || []).filter((o) => isObject(o) && o.id && !hidden.has(o.id));
}

/**
 * Whether there is anything to do with an object: it opens, or has actions.
 * Decor (L-945) only dresses a room: it has no click menu and nothing to do,
 * whatever else it says.
 */
function isUsable(object) {
  return Boolean(
    object &&
    !materials.isDecor(object) &&
    (object.container || object.locked || (Array.isArray(object.actions) && object.actions.length))
  );
}

/** The objects of a map there is something to do with. */
function usableOf(map) {
  return allOf(map).filter(isUsable);
}

/** One of a map's objects by id, or null. */
function objectOf(map, id) {
  return allOf(map).find((o) => o.id === id) || null;
}

/** What an object is called in the narration: its name, else its kind's. */
function nameOf(object) {
  if (object.name) return object.name;
  const kind = materials.objectKind(object.kind);
  return 'the ' + String((kind && kind.name) || object.kind || 'object').toLowerCase();
}

/** Its state for a save: the save's, else its own start ('locked', 'closed'), else null. */
function stateOf(object, states) {
  const saved = states && object && states[object.id];
  if (STATES.includes(saved)) return saved;
  if (!object || !object.container) return null;
  return object.locked ? 'locked' : 'closed';
}

/** The inventory item that unlocks an object, or null. */
function keyOf(object) {
  return (object && isObject(object.unlocks) && object.unlocks.key) || null;
}

/** What a container holds, as text, or null. */
function contentsOf(object) {
  const c = object && object.container;
  return isObject(c) && typeof c.contents === 'string' && c.contents.trim() ? c.contents : null;
}

/** Whether opening it is searching it (a bookshelf, a corpse). */
const searches = (object) => Boolean(isObject(object.container) && object.container.search);

const capitalised = (text) => String(text).charAt(0).toUpperCase() + String(text).slice(1);

const UNLOCK = /^(unlock|pick|force|break|bash|jimmy|lockpick|crack|smash|kick|pry)/;
const OPEN = /^(open|unlatch|lift|raise|unbar)/;
const SEARCH = /^(search|loot|rummage|ransack|rifle|check|look_in|look_inside)/;
const HANDLE = /^(use|pull|push|press|turn|activate|operate|flip|touch|throw|move|work|try)/;

/**
 * What a proposed action does to an object: `{ act, action? }`. `act` is
 * 'open' or 'search' (a container), 'unlock' (picking or forcing, or the key),
 * or 'action' (one of its own, `action` it); or null when it is none of its
 * things. The menu names its action in `params.act`; a typed one by its verb.
 */
function intent(object, proposed) {
  if (!object) return null;
  const params = (proposed && proposed.params) || {};
  const act = String(params.act || '').toLowerCase();
  const verb = String((proposed && proposed.verb) || '').toLowerCase();
  const own = Array.isArray(object.actions) ? object.actions : [];
  const named = (word) =>
    own.find((a) => a.id === word || (a.name && a.name.toLowerCase() === word)) || null;
  const mine = named(act) || named(verb);
  if (mine) return { act: 'action', action: mine };
  const word = act || verb;
  if (object.container) {
    if (UNLOCK.test(word)) return { act: 'unlock' };
    if (OPEN.test(word) || SEARCH.test(word) || /^(use|try)/.test(word)) {
      return { act: searches(object) || SEARCH.test(word) ? 'search' : 'open' };
    }
  }
  if (own.length === 1 && HANDLE.test(word)) return { act: 'action', action: own[0] };
  return null;
}

/**
 * What the click menu offers for an object in a state (L-926): each
 * `{ id, name, spend, own?, long?, key? }`: `spend` the AP price it pays
 * ('object', or 'lock' to pick one), `own` its own cost, `long` the AP of a
 * long action. `hasKey`: the character carries its key.
 */
function actionsOf(object, state, { hasKey = false } = {}) {
  const out = [];
  // An entry without a field it has no value for.
  const entry = (fields) => {
    const e = {};
    for (const k of Object.keys(fields)) if (fields[k] !== undefined) e[k] = fields[k];
    return e;
  };
  if (object.container) {
    if (state === 'locked') {
      out.push(
        hasKey
          ? entry({
              id: 'unlock',
              name: 'Unlock',
              spend: 'object',
              own: object.ap,
              key: keyOf(object),
            })
          : entry({
              id: 'unlock',
              name: 'Pick the lock',
              spend: 'lock',
              long: object.long ? object.long.ap : undefined,
            })
      );
    } else if (state === 'closed') {
      const word = searches(object) ? 'search' : 'open';
      out.push(entry({ id: word, name: capitalised(word), spend: 'object', own: object.ap }));
    }
  }
  (object.actions || []).forEach((a) => {
    out.push(
      entry({
        id: a.id,
        name: a.name || capitalised(a.id),
        spend: 'object',
        own: a.ap !== undefined ? a.ap : object.ap,
        long: a.long ? a.long.ap : undefined,
      })
    );
  });
  return out;
}

/**
 * The grid squares an object covers: those its footprint touches, at least
 * its middle's, on the map. For reach (beside any of them) and sight.
 */
function squaresOf(map, object) {
  const c = geo.compile(mapPaths.geometryOf(map));
  const entry = c.objects.find((o) => o.item.id === object.id);
  const points = entry ? entry.rings.flat() : [];
  const at = Array.isArray(object.at) ? object.at : object.at ? [object.at.x, object.at.y] : null;
  if (!points.length && at) points.push(at);
  if (!points.length) return [];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const sq = (v, edge) => Math.floor(v / FEET + (edge ? -1e-9 : 1e-9));
  const x0 = Math.max(0, sq(Math.min(...xs)));
  const y0 = Math.max(0, sq(Math.min(...ys)));
  const x1 = Math.min((map.width || 1) - 1, Math.max(x0, sq(Math.max(...xs), true)));
  const y1 = Math.min((map.height || 1) - 1, Math.max(y0, sq(Math.max(...ys), true)));
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

/**
 * What using an object (one of its `actions`, `actionId`) unlocks: the doors
 * and objects of the map whose `unlocks.action` names it: `[{ list:
 * 'doors' | 'objects', item }]`. An item names "id" (any use) or
 * "id.action" (that one).
 */
function unlockedBy(map, objectId, actionId) {
  const g = mapPaths.geometryOf(map);
  const hidden = hiddenIds(g);
  const out = [];
  for (const list of ['doors', 'objects']) {
    for (const item of g[list] || []) {
      const u = isObject(item) && item.unlocks;
      if (!u || typeof u.action !== 'string' || hidden.has(item.id)) continue;
      const [id, action] = u.action.split('.');
      if (id === objectId && (action === undefined || action === actionId)) {
        out.push({ list, item });
      }
    }
  }
  return out;
}

/**
 * An object as the page is sent it: what it looks like and what it's called,
 * its actions' ids and names, never what it holds, what unlocks it or how
 * hard its lock is.
 */
function forPlayer(item) {
  const out = { ...item };
  delete out.unlocks;
  delete out.difficulty;
  delete out.locked;
  delete out.ap;
  delete out.long;
  if (out.container !== undefined) {
    out.container = isObject(out.container) && out.container.search ? { search: true } : true;
  }
  if (Array.isArray(out.actions)) {
    out.actions = out.actions.map((a) => ({ id: a.id, ...(a.name ? { name: a.name } : {}) }));
  }
  return out;
}

module.exports = {
  STATES,
  allOf,
  isUsable,
  usableOf,
  objectOf,
  nameOf,
  stateOf,
  keyOf,
  contentsOf,
  searches,
  intent,
  actionsOf,
  squaresOf,
  unlockedBy,
  forPlayer,
};
