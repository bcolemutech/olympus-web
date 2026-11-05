'use strict';

const geo = require('../loom-canon/map-geometry');
const mapDoors = require('../loom-canon/doors');
const mapObjects = require('../loom-canon/objects');

/**
 * A battle map as far as a save has seen it (planning/the-loom-movement-and-
 * vision.md §5; L-633 / #456, L-922 / #726, L-928 / #732): its exits and
 * geometry on squares it has seen. The grid view is sent this
 * (./map-view.js), and a move is planned on it (./steps.js), so the page's
 * preview and the server's charge are worked out on the same map
 * (../loom-canon/map-paths.js), and nothing hidden leaves the server.
 *
 *   knownMap(map, on, states)  the map cut down to what touches the squares
 *                              `on` says were seen; each door in the save's
 *                              state
 *
 * Geometry (L-921) is cut to what touches a seen square, and only what
 * moving and drawing read (ground, walls, doors, windows, objects, lines and
 * lights); hidden things (`hidden`, L-927) are left out, so a hidden door
 * leaves its wall whole. Since L-928 a map has nothing else: its old layers
 * are stored as geometry and dropped.
 *
 * Pure.
 */

/** The two squares a door stands between (../loom-canon/doors.js). */
const doorSides = mapDoors.sidesOf;

const MOVING = ['ground', 'walls', 'doors', 'windows', 'objects'];
// What the grid view draws besides (L-924): lines and lights.
const DRAWN = MOVING.concat(['lines', 'lights']);
const FEET = geo.FEET_PER_SQUARE;

// The corners of an item's shape, in feet, for whether it touches a square.
function cornersOf(key, item) {
  const out = [];
  const add = (rings) => rings.forEach((ring) => ring.forEach((p) => out.push(p)));
  if (key === 'walls' || key === 'lines') {
    const read = geo.linesOf(item.points);
    if (read.lines) add(read.lines);
  } else if (key === 'lights' && !item.shape) {
    const at = Array.isArray(item.at) ? item.at : item.at ? [item.at.x, item.at.y] : null;
    const r = Number(item.radius) || 0;
    if (at) out.push([at[0] - r, at[1] - r], [at[0] + r, at[1] + r]);
  } else if (key === 'doors' || key === 'windows') {
    [item.from, item.to].forEach((p) => {
      if (Array.isArray(p)) out.push(p);
      else if (p && Number.isFinite(p.x)) out.push([p.x, p.y]);
    });
  } else if (key === 'objects') {
    const at = Array.isArray(item.at) ? item.at : item.at ? [item.at.x, item.at.y] : null;
    const size = Array.isArray(item.size) ? item.size : [item.size, item.size];
    if (at) {
      const half = Math.max(Number(size[0]) || 0, Number(size[1]) || 0) / 2;
      out.push([at[0] - half, at[1] - half], [at[0] + half, at[1] + half]);
    }
  } else {
    const read = geo.ringsOf(item.shape);
    if (read.rings) add(read.rings);
  }
  return out;
}

// Whether a box of corners (in feet) touches a square seen.
function touchesSeen(corners, on) {
  if (!corners.length) return false;
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs) / FEET - 1e-9);
  const x1 = Math.floor(Math.max(...xs) / FEET + 1e-9);
  const y0 = Math.floor(Math.min(...ys) / FEET - 1e-9);
  const y1 = Math.floor(Math.max(...ys) / FEET + 1e-9);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (on({ x, y })) return true;
  return false;
}

// A map's stored geometry cut to what touches a square seen: only what moving
// and drawing read, hidden things left out, each door in the save's state
// (`states`). Null when it has none.
function seenGeometry(map, on, states = {}) {
  const stored = map && map.geometry;
  if (!geo.hasGeometry(stored)) return null;
  const hidden = new Set(
    (stored.hidden || []).map((h) => (typeof h === 'string' ? h : h && h.id)).filter(Boolean)
  );
  const out = {};
  for (const key of DRAWN) {
    const kept = (stored[key] || [])
      .filter((item) => item && !hidden.has(item.id) && touchesSeen(cornersOf(key, item), on))
      .map((item) =>
        key === 'doors'
          ? mapDoors.forPlayer({ ...item, state: mapDoors.stateOf(item, states) })
          : key === 'objects'
            ? playerObject(item)
            : item
      );
    if (kept.length) out[key] = kept;
  }
  return Object.keys(out).length ? out : null;
}

// An object as the page is sent it (L-926): its art and card art as links
// only (A5), and none of what it holds, what unlocks it or how hard its lock is.
function playerObject(item) {
  return mapObjects.forPlayer({
    ...item,
    ...(item.art ? { art: artLink(item.art) } : {}),
    ...(item.cardArt ? { cardArt: artLink(item.cardArt) } : {}),
  });
}

// A library image as the page draws it: its link only, never its record
// (A5; L-924).
function artLink(art) {
  return art && art.link ? { link: art.link } : null;
}

/**
 * A map's geometry as the page draws it, whole (a region or area map's,
 * L-924): what's drawn only, hidden things left out, objects' art as links.
 * Null when it has none.
 */
function drawnGeometry(stored) {
  if (!geo.hasGeometry(stored)) return null;
  const hidden = new Set(
    (stored.hidden || []).map((h) => (typeof h === 'string' ? h : h && h.id)).filter(Boolean)
  );
  const out = {};
  for (const key of DRAWN) {
    const kept = (stored[key] || [])
      .filter((item) => item && !hidden.has(item.id))
      .map((item) =>
        key === 'objects' ? playerObject(item) : key === 'doors' ? mapDoors.forPlayer(item) : item
      );
    if (kept.length) out[key] = kept;
  }
  return Object.keys(out).length ? out : null;
}

/** A battle map as far as a save has seen it (`on`), its doors in the save's `states`. */
function knownMap(map, on, states) {
  const geometry = seenGeometry(map, on, states || {});
  return {
    id: map.id,
    width: map.width,
    height: map.height,
    exits: (map.exits || []).filter(on),
    ...(geometry ? { geometry } : {}),
  };
}

/** The door states a known map's doors carry, for its planner. */
function statesOf(known) {
  return Object.fromEntries(
    (((known && known.geometry) || {}).doors || []).map((d) => [d.id, d.state])
  );
}

module.exports = {
  drawnGeometry,
  artLink,
  doorSides,
  knownMap,
  seenGeometry,
  statesOf,
};
