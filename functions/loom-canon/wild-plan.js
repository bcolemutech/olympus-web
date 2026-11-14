'use strict';

/**
 * A cross-country plan on a frame's region map (planning/off-road-travel.md
 * §4.2, TR3, TR8; L-361 / #835): ./wild-paths.js fed from the world as the
 * rules see it from that map (./frames.js viewFor).
 *
 *   lanesOf(view, state)          the routes on the frame's map as lanes:
 *                                 [{ id, from, to, kind, points, speed, ends? }],
 *                                 each at its kind's speed (clock.timeRules; a
 *                                 straight one slowed by its winding, so it
 *                                 takes the time ./travel.js trip gives), a
 *                                 sea route joined only at its ends, and none the
 *                                 traveller (`state`, a save or character state)
 *                                 can't take by its rules (routes.missingAbility)
 *   regionDangers(view)           { [regionId]: danger } for live regions with one
 *   scaleOf(view)                 the map's distance units per map unit
 *   planOn(view, from, to, opts)  wildPaths.plan on the frame's map, or null:
 *                                 `from` and `to` points ([x, y] or { x, y }) or
 *                                 place ids; opts { state, pace, cells }
 *   groundAt(view, point)         the ground at a point on the frame's map
 *                                 (wildPaths.at): { speed, danger, material },
 *                                 or null (L-363: the camp's danger)
 *   boundsOf(view)                the frame's map's { width, height }, or null
 *
 * Pure.
 */

const clock = require('./clock');
const routes = require('./routes');
const wildPaths = require('./wild-paths');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const live = (e) => Boolean(e) && !e.retired;

// Kinds joined and left only at their ends: a ship doesn't put you ashore
// mid-voyage.
const ENDS_ONLY = new Set(['sea']);

/** Region danger's range and default (EV6). */
const REGION_DANGER = Object.freeze({ min: 0.5, max: 2, default: 1 });

function lanesOf(view, state) {
  const locations = (view && view.locations) || {};
  const speeds = clock.timeRules(view).routeSpeeds;
  const out = [];
  const seen = new Set();
  for (const [id, loc] of Object.entries(locations)) {
    if (!live(loc)) continue;
    const links = (loc.geo && loc.geo.links) || {};
    for (const [otherId, kind] of Object.entries(links)) {
      const key = id < otherId ? `${id}|${otherId}` : `${otherId}|${id}`;
      if (seen.has(key) || !live(locations[otherId])) continue;
      seen.add(key);
      const points = routes.pathOf(view, id, otherId);
      // A straight route winds (routes.WINDING) as its trip does, so its
      // lane takes the time the trip takes.
      const winds = points && points.length === 2 && !routes.ownUnit(view);
      const speed = (speeds[kind] || speeds.trail) / (winds ? routes.WINDING : 1);
      if (!points || !(speed > 0)) continue;
      if (routes.missingAbility(view, id, otherId, state || {})) continue;
      out.push({
        id: key,
        from: id,
        to: otherId,
        kind: kind || 'trail',
        points,
        speed,
        ...(ENDS_ONLY.has(kind) ? { ends: true } : {}),
      });
    }
  }
  return out;
}

function regionDangers(view) {
  const out = {};
  for (const [id, region] of Object.entries((view && view.regions) || {})) {
    if (live(region) && typeof region.danger === 'number') out[id] = region.danger;
  }
  return out;
}

function scaleOf(view) {
  return routes.ownUnit(view) || routes.milesPerMapUnit(view);
}

// A point, or a place's position on the frame's map.
function pointFor(view, p) {
  if (typeof p === 'string') {
    const geo = (((view && view.locations) || {})[p] || {}).geo || {};
    return Number.isFinite(geo.x) && Number.isFinite(geo.y) ? [geo.x, geo.y] : null;
  }
  if (Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) return [p[0], p[1]];
  if (isObject(p) && Number.isFinite(p.x) && Number.isFinite(p.y)) return [p.x, p.y];
  return null;
}

function boundsOf(view) {
  const map = (view && view.map) || {};
  return map.width > 0 && map.height > 0 ? { width: map.width, height: map.height } : null;
}

// The planner's options for the frame's map's ground, or null without any.
function groundOptions(view, cells) {
  const map = (view && view.map) || {};
  const geometry = isObject(map.geometry) ? map.geometry : null;
  const bounds = boundsOf(view);
  if (!geometry || !bounds) return null;
  return {
    geometry,
    bounds,
    cells,
    own: view.materials,
    wilds: view.wilds,
    regions: regionDangers(view),
  };
}

function planOn(view, from, to, opts = {}) {
  const ground = groundOptions(view, opts.cells);
  const a = pointFor(view, from);
  const b = pointFor(view, to);
  if (!ground || !a || !b) return null;
  return wildPaths.plan({
    ...ground,
    from: a,
    to: b,
    scale: scaleOf(view),
    pace: opts.pace,
    routes: lanesOf(view, opts.state),
  });
}

function groundAt(view, point) {
  const ground = groundOptions(view);
  const p = pointFor(view, point);
  return ground && p ? wildPaths.at(ground, p) : null;
}

module.exports = {
  REGION_DANGER,
  lanesOf,
  regionDangers,
  scaleOf,
  planOn,
  groundAt,
  boundsOf,
  pointFor,
};
