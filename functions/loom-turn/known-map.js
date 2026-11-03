'use strict';

const geo = require('../loom-canon/map-geometry');
const layers = require('../loom-canon/layers');

/**
 * A battle map as far as a save has seen it (planning/the-loom-movement-and-
 * vision.md §5; L-633 / #456, L-922 / #726): the walls, doors, obstacles,
 * exits and geometry on squares it has seen. The grid view is sent this
 * (./map-view.js), and a move is planned on it (./steps.js), so the page's
 * preview and the server's charge are worked out on the same map
 * (../loom-canon/map-paths.js), and nothing hidden leaves the server.
 *
 *   knownMap(map, on, states)  the map cut down to the squares `on` says
 *                              were seen; each door, of its layers and its
 *                              geometry, in the save's state
 *
 * Geometry (L-921) is cut to what touches a seen square, and only what
 * moving and drawing read (ground, walls, doors, windows, objects); hidden
 * things (`hidden`, L-927) are left out, so a hidden door leaves its wall
 * whole.
 *
 * Pure.
 */

/** The two squares a door stands between. */
function doorSides(door) {
  const { from, to } = door;
  if (from.x === to.x) {
    const y = Math.min(from.y, to.y);
    return [
      { x: from.x - 1, y },
      { x: from.x, y },
    ];
  }
  const x = Math.min(from.x, to.x);
  return [
    { x, y: from.y - 1 },
    { x, y: from.y },
  ];
}

// The runs of a map's walls along the sides of squares seen (`on`): each wall
// is cut at the sides of squares not seen on either hand, every run kept
// running the way its wall did.
function seenWalls(map, on) {
  const runs = [];
  (map.walls || []).forEach((wall) => {
    const points = wall.points || [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const dx = Math.sign(b.x - a.x);
      const dy = Math.sign(b.y - a.y);
      if (Boolean(dx) === Boolean(dy)) continue; // not along a grid line
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      let start = null;
      for (let k = 0; k <= length; k++) {
        // The side from a + k to a + k + 1, between the squares either hand.
        let seenSide = false;
        if (k < length) {
          const x = a.x + dx * k + Math.min(dx, 0);
          const y = a.y + dy * k + Math.min(dy, 0);
          seenSide = dx ? on({ x, y: y - 1 }) || on({ x, y }) : on({ x: x - 1, y }) || on({ x, y });
        }
        if (seenSide && start === null) start = k;
        if (!seenSide && start !== null) {
          runs.push({
            points: [
              { x: a.x + dx * start, y: a.y + dy * start },
              { x: a.x + dx * k, y: a.y + dy * k },
            ],
          });
          start = null;
        }
      }
    }
  });
  return runs;
}

// A map's obstacles on squares seen (`on`): whole where all of it is seen,
// else cut into its seen runs along each row.
function seenObstacles(map, on) {
  const pieces = [];
  (map.obstacles || []).forEach((o) => {
    const w = o.w || 1;
    const h = o.h || 1;
    const piece = (x, y, width) => ({ id: o.id, name: o.name, kind: o.kind, x, y, w: width, h: 1 });
    const rows = [];
    for (let y = o.y; y < o.y + h; y++) {
      let start = null;
      for (let x = o.x; x <= o.x + w; x++) {
        const seenHere = x < o.x + w && on({ x, y });
        if (seenHere && start === null) start = x;
        if (!seenHere && start !== null) {
          rows.push(piece(start, y, x - start));
          start = null;
        }
      }
    }
    if (rows.length === h && rows.every((r) => r.w === w)) {
      pieces.push({ id: o.id, name: o.name, kind: o.kind, x: o.x, y: o.y, w, h });
    } else {
      pieces.push(...rows);
    }
  });
  return pieces;
}

// A map's doors beside a square seen, each in the save's state (L-624).
function seenDoors(map, on, states) {
  return (map.doors || [])
    .filter((d) => doorSides(d).some(on))
    .map((d) => ({
      id: d.id,
      name: d.name,
      from: d.from,
      to: d.to,
      state: layers.doorState(d, states),
      ...(Number.isInteger(d.ap) ? { ap: d.ap } : {}),
    }));
}

const MOVING = ['ground', 'walls', 'doors', 'windows', 'objects'];
const FEET = geo.FEET_PER_SQUARE;

// The corners of an item's shape, in feet, for whether it touches a square.
function cornersOf(key, item) {
  const out = [];
  const add = (rings) => rings.forEach((ring) => ring.forEach((p) => out.push(p)));
  if (key === 'walls') {
    const read = geo.linesOf(item.points);
    if (read.lines) add(read.lines);
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
  for (const key of MOVING) {
    const kept = (stored[key] || [])
      .filter((item) => item && !hidden.has(item.id) && touchesSeen(cornersOf(key, item), on))
      .map((item) =>
        key === 'doors' && states[item.id] ? { ...item, state: states[item.id] } : item
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
    walls: seenWalls(map, on),
    doors: seenDoors(map, on, states),
    obstacles: seenObstacles(map, on),
    exits: (map.exits || []).filter(on),
    ...(geometry ? { geometry } : {}),
  };
}

/** The door states a known map's doors carry, for its planner. */
function statesOf(known) {
  return Object.fromEntries((known.doors || []).map((d) => [d.id, d.state]));
}

module.exports = {
  doorSides,
  knownMap,
  seenWalls,
  seenObstacles,
  seenDoors,
  seenGeometry,
  statesOf,
};
