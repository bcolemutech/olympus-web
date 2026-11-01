'use strict';

/**
 * Map levels to any depth: the model (planning/map-levels.md §4.1, §4.2;
 * L-901 / #719). One shape for every map, in place of the world map, towns
 * and battle maps:
 *
 *   loom_worlds/{worldId}/maps/{mapId}
 *     kind      'region' | 'area' | 'grid' (LV2)
 *     parent    { mapId, placeId }: the place on the map above it opens into
 *               this one; null for the world's top map (`world.topMapId`, MP4)
 *     name, image (a library image, L-704)
 *     space     by kind:
 *                 region { width, height, distance: { unit, perUnit } },
 *                        and `routeKinds` beside it (TV1)
 *                 area   { width, height, size } (metres across, as a town's
 *                        size), and optional ground
 *                 grid   { width, height, squareSize }, with its layers
 *                        (walls, doors, obstacles, features, entries) beside
 *     template, generic, revision, sources, retired
 *
 *   loom_worlds/{worldId}/places/{placeId}, a place in the new shape
 *     mapId     the map it sits on, and where on it: `at` { x, y } on a
 *               region or area map, or a square on a grid
 *     name, kind, description, and what places carry today
 *     opens     { mapId } (the map below) or { template: mapId } (L-906)
 *     links     routes (region) or paths (area)
 *     exits     [{ placeId, seconds, name }] to places on other maps (TV3)
 *
 * Any kind sits inside any kind (MP5); a place with no map below can still
 * be stood at (MP6).
 *
 * A save stands at `save.at` (MP2): [{ mapId, placeId }…] from the top map
 * down, its last step where it is on the last map: a place (`placeId`), a
 * point (`point: { x, y }`) or a square (`cell: { x, y }`). Its discovered
 * places are kept by map (`discovered: { [mapId]: [placeId] }`).
 *
 * Town places from before L-900 share `places` until the migration (L-902):
 * they have a `locationId` and no `mapId`, and the helpers here pass them by.
 * Nothing that plays reads this model yet: the rules move onto it in L-903.
 *
 * Pure: helpers over a CanonWorld with `maps`, `places` and `topMapId`.
 */

const KINDS = ['region', 'area', 'grid'];
const MAX_DEPTH = 32; // deeper than any map tree: guards a parent loop
const MAX_SIDE = { region: 100000, area: 1000, grid: 64 };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 120;
const inside = (p, w, h) =>
  isObject(p) &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  p.x >= 0 &&
  p.y >= 0 &&
  p.x <= w &&
  p.y <= h;

const mapsOf = (world) => (world && world.maps) || {};
const placesOf = (world) => (world && world.places) || {};

/** A map by id, or null (retired maps included: callers decide). */
function mapOf(world, mapId) {
  return (isId(mapId) && mapsOf(world)[mapId]) || null;
}

/** A place in the new shape (one with a `mapId`), or null. */
function placeOf(world, placeId) {
  const place = isId(placeId) ? placesOf(world)[placeId] : null;
  return place && isId(place.mapId) ? place : null;
}

/** The map a place sits on, or null. */
function placeMap(world, placeId) {
  const place = placeOf(world, placeId);
  return place ? mapOf(world, place.mapId) : null;
}

/** The map a place opens into, by its `opens` (a template counts as its map), or null. */
function openedBy(world, placeId) {
  const place = placeOf(world, placeId);
  const opens = place && place.opens;
  if (!isObject(opens)) return null;
  return mapOf(world, opens.mapId || opens.template);
}

/**
 * A map's parent chain, from the top map down to it: [mapId…]. Empty for an
 * unknown map, and cut short (with `broken`) at a parent that isn't there or
 * a loop.
 */
function parentChain(world, mapId) {
  const chain = [];
  const seen = new Set();
  let id = mapId;
  while (id && mapOf(world, id)) {
    if (seen.has(id) || chain.length >= MAX_DEPTH) {
      chain.broken = 'loop';
      break;
    }
    seen.add(id);
    chain.unshift(id);
    const parent = mapOf(world, id).parent;
    id = parent && parent.mapId;
    if (id && !mapOf(world, id)) chain.broken = 'missing';
  }
  return chain;
}

/**
 * The path to a place (MP2): [{ mapId, placeId }…] from the top map down,
 * each step the place on that map that opens the next, the last the place
 * itself. Null when the place or its chain doesn't reach the top map.
 */
function pathTo(world, placeId) {
  const place = placeOf(world, placeId);
  if (!place) return null;
  const chain = parentChain(world, place.mapId);
  if (!chain.length || chain.broken || chain[0] !== world.topMapId) return null;
  const steps = [];
  for (let i = 1; i < chain.length; i++) {
    const parent = mapOf(world, chain[i]).parent;
    steps.push({ mapId: parent.mapId, placeId: parent.placeId });
  }
  steps.push({ mapId: place.mapId, placeId });
  return steps;
}

/**
 * The lowest map that holds both places, directly or through a place that
 * opens into a map holding them (TV2): the deepest map on both chains, or
 * null when they share none.
 */
function lowestCommonMap(world, placeA, placeB) {
  const a = placeOf(world, placeA);
  const b = placeOf(world, placeB);
  if (!a || !b) return null;
  const chainA = parentChain(world, a.mapId);
  const onB = new Set(parentChain(world, b.mapId));
  let lowest = null;
  for (const id of chainA) if (onB.has(id)) lowest = id;
  return lowest;
}

/** The maps directly inside a map: those whose parent is a place on it. */
function childrenOf(world, mapId) {
  return Object.keys(mapsOf(world))
    .filter((id) => {
      const parent = mapsOf(world)[id].parent;
      return parent && parent.mapId === mapId;
    })
    .sort();
}

/** The places on a map, in the new shape: [placeId…]. */
function placesOn(world, mapId) {
  return Object.keys(placesOf(world))
    .filter((id) => placesOf(world)[id].mapId === mapId)
    .sort();
}

/**
 * The world's maps as a tree from its top map: `{ mapId, kind, name, children:
 * [...] }`, or null without a top map. Maps not reached from the top are
 * listed in `orphans` (each with its own subtree), for the tools to report.
 */
function treeOf(world) {
  const reached = new Set();
  const node = (id, depth) => {
    reached.add(id);
    const map = mapOf(world, id);
    return {
      mapId: id,
      kind: map.kind,
      name: map.name || id,
      children:
        depth >= MAX_DEPTH
          ? []
          : childrenOf(world, id)
              .filter((c) => !reached.has(c))
              .map((c) => node(c, depth + 1)),
    };
  };
  const top = mapOf(world, world && world.topMapId) ? node(world.topMapId, 0) : null;
  const orphans = Object.keys(mapsOf(world))
    .filter((id) => !reached.has(id))
    .filter((id) => {
      const parent = mapOf(world, id).parent;
      return !parent || !mapOf(world, parent.mapId);
    })
    .sort()
    .map((id) => node(id, 0));
  return { top, orphans };
}

// ── Checking canon (§4.1) ─────────────────────────────────────────────

/** What's wrong with a map's shape, each named; empty when it's good. */
function validateMap(map, mapId = 'the map') {
  if (!isObject(map)) return [`${mapId} must be an object.`];
  const errors = [];
  if (!KINDS.includes(map.kind)) errors.push(`${mapId}.kind must be one of ${KINDS.join(', ')}.`);
  if (map.parent !== null && map.parent !== undefined) {
    if (!isObject(map.parent) || !isId(map.parent.mapId) || !isId(map.parent.placeId)) {
      errors.push(`${mapId}.parent must be { mapId, placeId }, or null for the top map.`);
    }
  }
  const space = map.space;
  if (!isObject(space)) errors.push(`${mapId}.space is needed: its size.`);
  else if (KINDS.includes(map.kind)) {
    const max = MAX_SIDE[map.kind];
    for (const side of ['width', 'height']) {
      const n = space[side];
      const whole = map.kind === 'grid' ? Number.isInteger(n) : Number.isFinite(n);
      if (!whole || n <= 0 || n > max) {
        errors.push(
          `${mapId}.space.${side} must be ${map.kind === 'grid' ? 'a whole number ' : ''}from 1 to ${max}.`
        );
      }
    }
    if (map.kind === 'region') {
      const d = space.distance;
      if (d !== undefined && (!isObject(d) || typeof d.unit !== 'string' || !(d.perUnit > 0))) {
        errors.push(`${mapId}.space.distance must be { unit, perUnit }: what one map unit is.`);
      }
    }
    if (map.kind === 'area' && space.size !== undefined && !(space.size > 0)) {
      errors.push(`${mapId}.space.size must be the metres across.`);
    }
    if (map.kind === 'grid' && space.squareSize !== undefined && !(space.squareSize > 0)) {
      errors.push(`${mapId}.space.squareSize must be the size of a square.`);
    }
  }
  return errors;
}

/** What's wrong with a place in the new shape against its world, each named. */
function validatePlace(world, place, placeId = 'the place') {
  if (!isObject(place)) return [`${placeId} must be an object.`];
  const errors = [];
  const map = mapOf(world, place.mapId);
  if (!map) errors.push(`${placeId}.mapId "${place.mapId}" isn't one of the world's maps.`);
  else if (place.at !== undefined) {
    const { width, height } = map.space || {};
    const on =
      map.kind === 'grid'
        ? inside(place.at, width - 1, height - 1) &&
          Number.isInteger(place.at.x) &&
          Number.isInteger(place.at.y)
        : inside(place.at, width, height);
    if (!on)
      errors.push(
        `${placeId}.at must be ${map.kind === 'grid' ? 'a square' : 'a point'} on ${map.name || place.mapId}.`
      );
  }
  if (place.opens !== undefined && place.opens !== null) {
    const below = isObject(place.opens)
      ? mapOf(world, place.opens.mapId || place.opens.template)
      : null;
    if (!below)
      errors.push(
        `${placeId}.opens must name one of the world's maps ({ mapId } or { template }).`
      );
  }
  for (const [i, exit] of (Array.isArray(place.exits) ? place.exits : []).entries()) {
    if (!isObject(exit) || !placeOf(world, exit.placeId)) {
      errors.push(`${placeId}.exits[${i}] must lead to a place on one of the world's maps.`);
    } else if (!(Number.isFinite(exit.seconds) && exit.seconds >= 0)) {
      errors.push(`${placeId}.exits[${i}].seconds must be the time it takes, from 0.`);
    }
  }
  if (place.exits !== undefined && !Array.isArray(place.exits)) {
    errors.push(`${placeId}.exits must be a list.`);
  }
  return errors;
}

/**
 * What's wrong with a save's `at` against canon (MP2), each named; empty when
 * every step holds: the first on the top map; each step's place on its map;
 * each next map the one the step before opens into; the last a place, a
 * point on the map or a square on a grid.
 */
function validateAt(world, at) {
  if (!Array.isArray(at) || !at.length)
    return ['at must be a path of steps from the top map down.'];
  if (at.length > MAX_DEPTH) return [`at is deeper than ${MAX_DEPTH} maps.`];
  const errors = [];
  at.forEach((step, i) => {
    const where = `at[${i}]`;
    const last = i === at.length - 1;
    if (!isObject(step)) return errors.push(`${where} must be { mapId, placeId | point | cell }.`);
    const map = mapOf(world, step.mapId);
    if (!map) return errors.push(`${where}.mapId "${step.mapId}" isn't one of the world's maps.`);
    if (map.retired) errors.push(`${where}: ${map.name || step.mapId} is retired.`);
    if (i === 0 && step.mapId !== world.topMapId) {
      errors.push(`${where} must be on the world's top map.`);
    }
    if (i > 0) {
      const before = at[i - 1];
      if (!before || openedBy(world, before.placeId) !== map) {
        errors.push(
          `${where}: ${map.name || step.mapId} isn't the map ${before && before.placeId ? '"' + before.placeId + '"' : 'the step above'} opens into.`
        );
      }
    }
    const ends = ['placeId', 'point', 'cell'].filter((k) => step[k] !== undefined);
    if (!last && (ends.length !== 1 || !step.placeId)) {
      return errors.push(`${where} must name the place that opens the next map.`);
    }
    if (ends.length !== 1) {
      return errors.push(`${where} must end at one of a place, a point or a square.`);
    }
    if (step.placeId !== undefined) {
      const place = placeOf(world, step.placeId);
      if (!place)
        errors.push(`${where}.placeId "${step.placeId}" isn't one of the world's places.`);
      else if (place.mapId !== step.mapId) {
        errors.push(`${where}: "${step.placeId}" isn't on ${map.name || step.mapId}.`);
      } else if (place.retired) errors.push(`${where}: "${step.placeId}" is retired.`);
    }
    const { width, height } = map.space || {};
    if (step.point !== undefined) {
      if (map.kind === 'grid')
        errors.push(`${where}: a grid is stood on by square (cell), not point.`);
      else if (!inside(step.point, width, height)) {
        errors.push(
          `${where}.point must be on ${map.name || step.mapId} (0–${width}, 0–${height}).`
        );
      }
    }
    if (step.cell !== undefined) {
      if (map.kind !== 'grid') errors.push(`${where}: only a grid has squares.`);
      else if (
        !inside(step.cell, width - 1, height - 1) ||
        !Number.isInteger(step.cell.x) ||
        !Number.isInteger(step.cell.y)
      ) {
        errors.push(`${where}.cell must be a square on ${map.name || step.mapId}.`);
      }
    }
    return undefined;
  });
  return errors;
}

/** The map a save's `at` ends on, or null. */
function mapAt(at) {
  return Array.isArray(at) && at.length ? at[at.length - 1].mapId : null;
}

/**
 * The places a save has discovered on a map (§4.2): `discovered` kept by map
 * (`{ [mapId]: [placeId] }`), or, from before the migration, a list, read as
 * the top map's.
 */
function discoveredOn(world, save, mapId) {
  const d = save && save.discovered;
  if (Array.isArray(d)) return mapId === (world && world.topMapId) ? d.slice() : [];
  return isObject(d) && Array.isArray(d[mapId]) ? d[mapId].slice() : [];
}

module.exports = {
  KINDS,
  MAX_DEPTH,
  mapOf,
  placeOf,
  placeMap,
  openedBy,
  parentChain,
  pathTo,
  lowestCommonMap,
  childrenOf,
  placesOn,
  treeOf,
  validateMap,
  validatePlace,
  validateAt,
  mapAt,
  discoveredOn,
};
