'use strict';

/**
 * Rules at any depth (planning/map-levels.md §4.3, MP2, TV1–TV4; L-903 /
 * #721): play reads the levels model (./levels.js) through frames.
 *
 * A save stands at `save.at` (MP2), its path from the top map down. Today's
 * rules are written for three levels: a region map's places (`locations`),
 * the town inside one (`places` with a `locationId`, and its ground) and
 * battle maps (`battleMaps`). A frame is the world as those rules see it
 * from where the save stands (decided with the user 2026-11-01): the lowest
 * region map on its path is the world map, its places the locations, the
 * area maps under them their towns, and grids their battle maps. The rules
 * run on the frame unchanged; where they move the save (its `location`,
 * `placeId`, `townPoint`, `mapId` and `cell`, read from `at` for the frame),
 * the move is written back as `at` (atOf). What a frame can't hold, going
 * up out of a region map, trips between parents (TV2) and exits across
 * maps (TV3), is ../loom-turn/depth.js; going down into a region map
 * arrives at its way in (a place on it with `entrance`, as a town's gates),
 * the one facing where the traveller came from.
 *
 *   playWorld(world)   the world to play: a world with no top map yet gets
 *                      the migration's plan in memory (./level-plan.js; the
 *                      user's decision: every world plays from the model),
 *                      and places, towns and grids in the new shape with no
 *                      doc of today's shape are seen in it (`native`)
 *   viewFor(play, R)   the frame on region map R: its places as locations,
 *                      its own scale, `frame: { mapId, prefix }`
 *   frameOf(play, save) the frame a save stands in, and its fields read
 *                      from `at` (or, for a save from before, `at` from them)
 *   atOf(view, save)   where the frame's fields put the save, as `at`
 *   legacyOf(play, at) the frame's fields for a path; a square on a grid is
 *                      `cell`, and a point in feet in it `gridPoint` (L-922)
 *   geometryOf(play, id) a map's geometry (L-921): a grid's from its battle
 *                      map, a region or area map's from its map doc
 *
 * In the wilds (planning/off-road-travel.md §4.4, TR6; L-363 / #837), a
 * save's path ends at a point on a region map, not a place: the frame's
 * fields read it as `wild: { x, y }`, with no `location`.
 *
 * An event played in the wilds (L-366, planning/off-road-travel.md §4.6) is on
 * a battle map kept on the save, `wildMaps` (and `wildEvent`, where it is the
 * one the save stands on): the frame's `battleMaps` gain it, and the save
 * keeps its `mapId`, `cell` and `gridPoint` while `at` stays at the camp.
 *
 * Place ids are the world's: `discovered`, `visited` and `waysKnown` stay
 * flat lists by place, which holds by map as well.
 *
 * Pure.
 */

const levels = require('./levels');
const plan = require('./level-plan');
const templates = require('./templates');
const mapPaths = require('./map-paths');
// ./maps.js reads frames' world; required when used, so neither waits on the other.
const maps = () => require('./maps');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const live = (e) => Boolean(e) && !e.retired;
const point = (p) => isObject(p) && Number.isFinite(p.x) && Number.isFinite(p.y);

const played = new WeakMap();

// ── The world to play ────────────────────────────────────────────────

/**
 * The world to play (cached per loaded world): with the levels model, in
 * memory for a world with no top map, and `regionLocations` (by region map,
 * its places as locations), native town places in `places` and native grids
 * in `battleMaps`.
 */
function playWorld(world) {
  if (!world || typeof world !== 'object') return world;
  if (world.regionLocations) return world;
  const cached = played.get(world);
  if (cached) return cached;
  // The model as stored, over the plan of what it holds in today's shape
  // (./level-plan.js modelOf): a world with no top map is planned in memory.
  const out = Object.assign({}, world, plan.modelOf(world));
  // Each place using a template plays its own instance of it (L-906).
  templates.instantiate(out);
  out.tree = levels.treeOf(out);
  addNative(out);
  played.set(world, out);
  return out;
}

// The map a place opens, with its id, or null.
function below(play, id, place) {
  const map = levels.openedBy(play, id);
  if (!map) return null;
  return { ...map, id: place.opens.mapId || place.opens.template };
}

// What a link holds besides its kind (L-715): its waypoints and rules.
function routeExtras(link) {
  const out = {};
  if (Array.isArray(link.waypoints) && link.waypoints.length) out.waypoints = link.waypoints;
  if (isObject(link.rules) && Object.keys(link.rules).length) out.rules = link.rules;
  return Object.keys(out).length ? out : null;
}

// A region map's place as today's rules read a location.
function asLocation(play, id, place) {
  const under = below(play, id, place);
  const links = {};
  // A route's line and rules (L-715), as a legacy place keeps them.
  const routes = {};
  for (const l of place.links || []) {
    if (!l || !l.placeId) continue;
    links[l.placeId] = l.kind || null;
    const extras = routeExtras(l);
    if (extras) routes[l.placeId] = extras;
  }
  const kind = under && under.kind === 'area' ? 'settlement' : place.kind || 'place';
  return {
    ...place,
    id,
    name: place.name || id,
    description: place.description || '',
    geo: {
      ...(isObject(place.geo) ? place.geo : {}),
      ...(point(place.at) ? { x: place.at.x, y: place.at.y } : {}),
      kind,
      links,
      ...(Object.keys(routes).length ? { routes } : {}),
    },
    connections: Object.keys(links),
    npcIds: place.npcIds || [],
    factionIds: place.factionIds || [],
    ...(under && under.kind === 'grid' ? { battleMap: { mapId: under.id } } : {}),
    ...(under && under.kind === 'area'
      ? {
          town: {
            ...(isObject(place.town) ? place.town : {}),
            ...(under.ground ? { ground: under.ground } : {}),
            ...(under.space && under.space.size ? { size: under.space.size } : {}),
            ...(under.image ? { image: under.image } : {}),
            // Its geometry (L-921, GE5), read with geometryOf, and its space
            // (L-924: the town view draws it).
            ...(isObject(under.geometry) ? { geometry: under.geometry } : {}),
            ...(under.space && under.space.width
              ? { space: { width: under.space.width, height: under.space.height } }
              : {}),
          },
        }
      : {}),
    ...(under && under.kind === 'region' ? { region: { mapId: under.id } } : {}),
    native: true,
  };
}

// A location in today's shape that uses a template (L-906): its own doc,
// opening its instance (a town, a battle map or a region map below).
function templatedLegacy(location, synth) {
  const out = {
    ...location,
    geo: { ...(location.geo || {}), kind: synth.geo.kind },
    templated: true,
  };
  for (const key of ['town', 'battleMap', 'region']) {
    if (synth[key]) out[key] = synth[key];
    else delete out[key];
  }
  return out;
}

// An area map's place as today's rules read a place in town.
function asTownPlace(play, id, place, settlementId) {
  const under = below(play, id, place);
  return {
    ...place,
    id,
    name: place.name || id,
    description: place.description || '',
    locationId: settlementId,
    ...(point(place.at) ? { position: { x: place.at.x, y: place.at.y } } : {}),
    connections: (place.links || []).map((l) => l && l.placeId).filter(Boolean),
    entrance: place.entrance || null,
    npcIds: place.npcIds || [],
    ...(under && under.kind === 'grid' ? { battleMap: { mapId: under.id } } : {}),
    native: true,
  };
}

// Links both ways: a place's links, and those to it.
function symmetric(byId) {
  for (const [id, loc] of Object.entries(byId)) {
    if (!loc.native) continue;
    for (const other of loc.connections) {
      const there = byId[other];
      if (!there || !there.native || there.connections.includes(id)) continue;
      there.connections.push(id);
      there.geo.links[id] = loc.geo.links[other] || null;
      // Its line and rules too, the line turned round (L-715).
      const extras = (loc.geo.routes || {})[other];
      if (extras) {
        there.geo.routes = {
          ...(there.geo.routes || {}),
          [id]: {
            ...extras,
            ...(extras.waypoints ? { waypoints: extras.waypoints.slice().reverse() } : {}),
          },
        };
      }
    }
  }
  for (const loc of Object.values(byId)) {
    if (loc.native) loc.connections = loc.connections.filter((id) => live(byId[id]));
  }
  return byId;
}

function addNative(play) {
  const maps = play.maps || {};
  const all = { ...(play.places || {}), ...(play.mapPlaces || {}) };
  const legacyLocations = play.locations || {};
  const regionLocations = {};
  const townPlaces = {};
  const battleMaps = { ...(play.battleMaps || {}) };
  for (const [mapId, map] of Object.entries(maps)) {
    if (map.kind === 'region') {
      const here = mapId === play.topMapId ? { ...legacyLocations } : {};
      for (const id of levels.placesOn(play, mapId)) {
        if (legacyLocations[id] && mapId === play.topMapId) {
          // A place in today's shape using a template (L-906): its instance
          // is what it opens.
          if (all[id].templated)
            here[id] = templatedLegacy(legacyLocations[id], asLocation(play, id, all[id]));
          continue;
        }
        here[id] = asLocation(play, id, all[id]);
      }
      regionLocations[mapId] = symmetric(here);
    } else if (map.kind === 'area' && map.parent) {
      for (const id of levels.placesOn(play, mapId)) {
        if (all[id].locationId) continue;
        townPlaces[id] = asTownPlace(play, id, all[id], map.parent.placeId);
      }
    } else if (map.kind === 'grid' && !battleMaps[mapId]) {
      const { width, height } = map.space || {};
      battleMaps[mapId] = { ...map, id: mapId, width, height, native: true };
    }
  }
  // Town places in the new shape link both ways too.
  for (const [id, p] of Object.entries(townPlaces)) {
    for (const other of p.connections) {
      const there = townPlaces[other];
      if (there && !there.connections.includes(id)) there.connections.push(id);
    }
  }
  play.regionLocations = regionLocations;
  play.places = { ...(play.places || {}), ...townPlaces };
  play.battleMaps = battleMaps;
  if (!regionLocations[play.topMapId]) regionLocations[play.topMapId] = { ...legacyLocations };
}

// ── Frames ────────────────────────────────────────────────────────────

const mapKind = (play, id) => (levels.mapOf(play, id) || {}).kind || null;

/**
 * The frame on region map `mapId`: the play world with that map's places as
 * its locations and its scale as the world map's, and `frame: { mapId,
 * prefix }` (the steps of `at` above it). The top map's frame keeps the
 * world's own map.
 */
function viewFor(play, mapId, prefix = []) {
  const top = mapId === play.topMapId;
  const map = levels.mapOf(play, mapId) || {};
  const space = map.space || {};
  const distance = space.distance;
  // The top map migrated from today's world map keeps the world's own.
  const own =
    top && (play.map || map.migratedFrom === 'world')
      ? play.map
      : {
          width: space.width,
          height: space.height,
          ...(distance
            ? { distance: { unit: distance.unit, perMapUnit: distance.perUnit, own: true } }
            : {}),
          ...(map.image ? { image: map.image } : {}),
          ...(map.backdrop ? { backdrop: map.backdrop } : {}),
          name: map.name || mapId,
        };
  // Its geometry (L-921, GE5), read with geometryOf.
  const geometry = isObject(map.geometry) ? map.geometry : null;
  return Object.assign({}, play, {
    locations: (play.regionLocations || {})[mapId] || {},
    map: geometry ? { ...(own || {}), geometry } : own,
    frame: { mapId, prefix: prefix.map((s) => ({ ...s })) },
  });
}

/**
 * A map's geometry (planning/maps-from-data.md §4.1, GE5; L-921): a grid's
 * from its battle map (the same id as the grid, beside its layers until
 * L-928), a region or area map's from its map doc. Template instances carry
 * their template's. Null when it has none; ./map-geometry.js reads it.
 */
function geometryOf(play, mapId) {
  const grid = (play.battleMaps || {})[mapId];
  const map = levels.mapOf(play, mapId);
  const stored = grid ? grid.geometry : map && map.geometry;
  return isObject(stored) ? stored : null;
}

/** The index of the lowest region map on a path, or -1. */
function regionIndex(play, at) {
  for (let i = at.length - 1; i >= 0; i--) if (mapKind(play, at[i].mapId) === 'region') return i;
  return -1;
}

const LEGACY = ['location', 'placeId', 'townPoint', 'mapId', 'cell', 'gridPoint', 'wild'];

// Whether a save's own fields are those a path gives (nulls and absence alike).
function sameFields(fields, stored) {
  return LEGACY.every(
    (k) => JSON.stringify(fields[k] || null) === JSON.stringify(stored[k] || null)
  );
}

/**
 * The frame's fields for a path: `{ location, placeId, townPoint, mapId,
 * cell }` (nulls where none), and the frame's region map and prefix.
 */
function legacyOf(play, at) {
  const out = {
    location: null,
    placeId: null,
    townPoint: null,
    mapId: null,
    cell: null,
    gridPoint: null,
    wild: null,
  };
  const r = Array.isArray(at) ? regionIndex(play, at) : -1;
  if (r < 0) return { fields: out, mapId: play.topMapId, prefix: [] };
  out.location = at[r].placeId || null;
  // In the wilds (L-363): a point on the region map.
  if (!out.location && point(at[r].point)) out.wild = { x: at[r].point.x, y: at[r].point.y };
  for (let i = r + 1; i < at.length; i++) {
    const step = at[i];
    const kind = mapKind(play, step.mapId);
    if (kind === 'area') {
      if (step.placeId) out.placeId = step.placeId;
      else if (point(step.point)) out.townPoint = { x: step.point.x, y: step.point.y };
    } else if (kind === 'grid') {
      out.mapId = step.mapId;
      const place = step.placeId && levels.placeOf(play, step.placeId);
      if (point(step.point)) {
        // A point in feet (L-922), and the square it is in.
        out.gridPoint = { x: step.point.x, y: step.point.y };
        out.cell = mapPaths.squareOf(step.point);
      } else {
        out.cell = step.cell
          ? { x: step.cell.x, y: step.cell.y }
          : place && point(place.at)
            ? { x: place.at.x, y: place.at.y }
            : null;
      }
    }
  }
  return { fields: out, mapId: at[r].mapId, prefix: at.slice(0, r) };
}

// The steps from a place down to grid `mapId` (the grid it opens, or one
// below that through exit places: floors), ending on `cell`, or on a point
// in feet in it (L-922) when the save has one there.
function gridSteps(play, hostId, mapId, cell, gridPoint) {
  const inCell = cell && point(gridPoint) && maps().sameCell(mapPaths.squareOf(gridPoint), cell);
  const last = {
    mapId,
    ...(inCell
      ? { point: { x: gridPoint.x, y: gridPoint.y } }
      : cell
        ? { cell: { x: cell.x, y: cell.y } }
        : {}),
  };
  const opened = hostId && levels.openedBy(play, hostId);
  if (!opened || opened === levels.mapOf(play, mapId)) return [last];
  const chain = levels.parentChain(play, mapId);
  const from = chain.indexOf(Object.keys(play.maps).find((id) => play.maps[id] === opened));
  if (from < 0) return [last];
  const steps = [];
  for (let i = from + 1; i < chain.length; i++) {
    steps.push({ mapId: chain[i - 1], placeId: play.maps[chain[i]].parent.placeId });
  }
  steps.push(last);
  return steps;
}

/**
 * Where a frame's fields put a save, as `at`: the frame's prefix, its place
 * on the frame's region map, then its place or point in town and its square
 * on a grid. Null when it stands at no place of the frame.
 */
function atOf(view, save) {
  const frame = view && view.frame;
  if (frame && save && !save.location && point(save.wild)) {
    return frame.prefix
      .map((s) => ({ ...s }))
      .concat([{ mapId: frame.mapId, point: { x: save.wild.x, y: save.wild.y } }]);
  }
  if (!frame || !save || !save.location || !view.locations[save.location]) return null;
  const steps = frame.prefix.map((s) => ({ ...s }));
  steps.push({ mapId: frame.mapId, placeId: save.location });
  let host = save.location;
  const townPlace = save.placeId && (view.places || {})[save.placeId];
  if (townPlace && townPlace.locationId === save.location && townPlace.mapId) {
    steps.push({ mapId: townPlace.mapId, placeId: save.placeId });
    host = save.placeId;
  } else if (point(save.townPoint)) {
    const area = levels.openedBy(view, save.location);
    const areaId = area && Object.keys(view.maps).find((id) => view.maps[id] === area);
    if (areaId) {
      steps.push({ mapId: areaId, point: { x: save.townPoint.x, y: save.townPoint.y } });
      host = null;
    }
  }
  if (save.mapId && (view.maps || {})[save.mapId]) {
    steps.push(...gridSteps(view, host, save.mapId, save.cell, save.gridPoint));
  }
  return steps;
}

/**
 * The path a save from before `at` stands at, from its fields: its
 * location's path, and its place, point and square below. Null when its
 * location isn't a place of the model.
 */
function atFromFields(play, save) {
  if (!save || !save.location) return null;
  const path = levels.pathTo(play, save.location);
  if (!path) return null;
  const last = path[path.length - 1];
  if (mapKind(play, last.mapId) !== 'region') return null;
  const view = viewFor(play, last.mapId, path.slice(0, -1));
  return atOf(view, save);
}

/**
 * An event played in the wilds (L-366): the save stands at a camp in the
 * wilds (`at` ends at a point) and on the battle map of the event, which `at`
 * doesn't name, so the fields keep its square.
 */
function keepEventMap(fields, save) {
  const event = save && save.wildEvent;
  if (event && fields.wild && !fields.location && save.mapId && save.mapId === event.mapId) {
    fields.mapId = save.mapId;
    fields.cell = save.cell || null;
    fields.gridPoint = save.gridPoint || null;
  }
  return fields;
}

// The frame with the battle maps its save keeps (L-366: events in the wilds).
function withWildMaps(view, save) {
  const kept = save && save.wildMaps;
  if (!isObject(kept) || !Object.keys(kept).length) return view;
  return { ...view, battleMaps: { ...(view.battleMaps || {}), ...kept } };
}

/**
 * The frame a save stands in: `{ view, save, at }`, `save` with the frame's
 * fields read from its `at` (or, from before `at`, its own, and `at` from
 * them).
 */
function frameOf(play, stored) {
  const usable = Array.isArray(stored.at) && stored.at.length && regionIndex(play, stored.at) >= 0;
  if (usable) {
    const { fields, mapId, prefix } = legacyOf(play, stored.at);
    keepEventMap(fields, stored);
    // Every write keeps the two together: fields written alone (an older
    // writer, a test) are newer than `at`, and `at` follows them.
    if (!stored.location || sameFields(fields, stored)) {
      const view = withWildMaps(viewFor(play, mapId, prefix), stored);
      return { view, save: { ...stored, ...fields }, at: stored.at };
    }
  }
  const at = atFromFields(play, stored);
  const r = at ? regionIndex(play, at) : -1;
  const view = withWildMaps(
    r >= 0 ? viewFor(play, at[r].mapId, at.slice(0, r)) : viewFor(play, play.topMapId, []),
    stored
  );
  return { view, save: { ...stored }, at };
}

/**
 * After a save's fields change (in place): `at` set by the turn rules them
 * (the frame's fields read from it), else `at` follows the fields in the
 * frame. Returns the frame the save now stands in (a new one when `at`
 * moved it to another region map).
 */
function settle(view, save, atSet = false) {
  const play = view;
  if (atSet && Array.isArray(save.at)) {
    const { fields, mapId, prefix } = legacyOf(play, save.at);
    Object.assign(save, keepEventMap(fields, save));
    if (mapId === (view.frame || {}).mapId && samePrefix(prefix, view.frame.prefix)) {
      return withWildMaps(view, save);
    }
    return withWildMaps(viewFor(play, mapId, prefix), save);
  }
  const at = atOf(view, save);
  if (at) save.at = at;
  return withWildMaps(view, save);
}

const samePrefix = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

/** The fields of an update with `at` to match, for a partial write of a save. */
function withAt(view, save, update) {
  const touched = LEGACY.some((k) => k in update);
  if (!touched) return update;
  const at = atOf(view, { ...save, ...update });
  return at ? { ...update, at } : update;
}

// ── Region maps' ways in ─────────────────────────────────────────────

/** The live ways in and out of a region map: its places with `entrance`, in id order. */
function waysOf(play, mapId) {
  const here = (play.regionLocations || {})[mapId] || {};
  return Object.values(here)
    .filter((p) => live(p) && p.entrance)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The way into region map `mapId` facing `fromId` (a place on the map
 * above, beside the one that opens it): the way whose position from the
 * map's middle lies nearest the bearing from the opener to `fromId`, else
 * the first. Null when the map has no way in. `open` filters them.
 */
function wayInto(play, mapId, fromId = null, open = () => true) {
  const ways = waysOf(play, mapId).filter(open);
  if (!ways.length) return null;
  const map = levels.mapOf(play, mapId);
  const opener = map && map.parent && levels.placeOf(play, map.parent.placeId);
  const from = fromId && levels.placeOf(play, fromId);
  if (!opener || !from || !point(opener.at) || !point(from.at)) return ways[0];
  const bearing = Math.atan2(from.at.y - opener.at.y, from.at.x - opener.at.x);
  const mx = ((map.space || {}).width || 0) / 2;
  const my = ((map.space || {}).height || 0) / 2;
  let best = null;
  for (const way of ways) {
    const p = way.geo || {};
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || (p.x === mx && p.y === my)) continue;
    const angle = Math.atan2(p.y - my, p.x - mx);
    const off = Math.abs(Math.atan2(Math.sin(angle - bearing), Math.cos(angle - bearing)));
    if (!best || off < best.off - 1e-9) best = { way, off };
  }
  return best ? best.way : ways[0];
}

/**
 * The trail (UI1): each map on a path, `{ mapId, name, kind, placeId? }`
 * (the place the path is at on it, when it is at one), the current one last.
 */
function trailOf(play, at) {
  if (!Array.isArray(at)) return [];
  const out = [];
  for (const step of at) {
    if (out.some((t) => t.mapId === step.mapId)) continue;
    const m = levels.mapOf(play, step.mapId) || {};
    out.push({
      mapId: step.mapId,
      name: m.name || step.mapId,
      kind: m.kind || null,
      ...(step.placeId ? { placeId: step.placeId } : {}),
    });
  }
  return out;
}

/**
 * The frame for peeking at region map `mapId` on a save's path (UI1): the
 * view on that map and the save as it stands there (at the place on it its
 * path goes through, in no town and on no grid). Null when the map isn't a
 * region map on the path.
 */
function peekAt(play, at, mapId) {
  if (!Array.isArray(at)) return null;
  const i = at.findIndex((s) => s.mapId === mapId);
  if (i < 0 || mapKind(play, mapId) !== 'region' || !at[i].placeId) return null;
  return {
    view: viewFor(play, mapId, at.slice(0, i)),
    fields: {
      location: at[i].placeId,
      placeId: null,
      townPoint: null,
      mapId: null,
      cell: null,
      gridPoint: null,
      wild: null,
    },
  };
}

module.exports = {
  LEGACY,
  playWorld,
  viewFor,
  geometryOf,
  regionIndex,
  legacyOf,
  atOf,
  atFromFields,
  frameOf,
  settle,
  withAt,
  waysOf,
  wayInto,
  trailOf,
  peekAt,
};
